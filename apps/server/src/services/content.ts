/** Fictional parody news posts and per-user watchlists. */
import { CANONICAL_TICKERS, PARODY_LABEL, SEED_NEWS, WATCHLIST_MAX, type NewsPostRequest, type NewsPostView } from '@aez/shared';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { iso } from '../lib/json.js';
import { enqueueOutbox, rooms } from '../lib/outbox.js';

interface NewsRow {
  id: string;
  ticker: string | null;
  headline: string;
  body: string;
  hidden: boolean;
  created_at: Date;
  author: string | null;
}

const NEWS_SELECT = `
  SELECT n.id, n.ticker, n.headline, n.body, n.hidden, n.created_at, u.username AS author
    FROM news_posts n LEFT JOIN users u ON u.id = n.author_user_id`;

function newsView(r: NewsRow): NewsPostView {
  return {
    id: r.id,
    ticker: r.ticker,
    headline: r.headline,
    body: r.body,
    parody: true,
    label: PARODY_LABEL,
    author: r.author ? `AEZ Desk (${r.author})` : 'AEZ Desk',
    hidden: r.hidden,
    createdAt: iso(r.created_at)!,
  };
}

export async function listNews(
  q: Queryable,
  opts: { ticker?: string; limit: number; includeHidden?: boolean; before?: string },
): Promise<NewsPostView[]> {
  const r = await q.query<NewsRow>(
    `${NEWS_SELECT}
      WHERE ($1::text IS NULL OR n.ticker = $1) AND ($3::boolean OR NOT n.hidden)
        AND ($4::timestamptz IS NULL OR n.created_at < $4)
      ORDER BY n.created_at DESC, n.id LIMIT $2`,
    [opts.ticker ?? null, opts.limit, opts.includeHidden ?? false, opts.before ?? null],
  );
  return r.rows.map(newsView);
}

export async function createNews(pool: pg.Pool, actor: { adminId: string; ip: string }, input: NewsPostRequest): Promise<NewsPostView> {
  if (input.ticker !== null && !CANONICAL_TICKERS.has(input.ticker)) throw badRequest('UNKNOWN_TICKER', 'Unknown ticker');
  return withTx(pool, async (c) => {
    const ins = await c.query<{ id: string }>(
      `INSERT INTO news_posts (ticker, headline, body, author_user_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.ticker, input.headline, input.body, actor.adminId],
    );
    const id = ins.rows[0]!.id;
    const view = newsView((await c.query<NewsRow>(`${NEWS_SELECT} WHERE n.id = $1`, [id])).rows[0]!);
    await audit(c, { actorUserId: actor.adminId, action: 'NEWS_CREATE', targetType: 'news', targetId: id, details: { ticker: input.ticker, headline: input.headline }, ip: actor.ip });
    await enqueueOutbox(c, [{ event: 'news', room: rooms.market, payload: { post: view } }]);
    return view;
  });
}

export async function setNewsHidden(pool: pg.Pool, actor: { adminId: string; ip: string }, id: string, hidden: boolean): Promise<NewsPostView> {
  return withTx(pool, async (c) => {
    const r = await c.query(`UPDATE news_posts SET hidden = $2 WHERE id = $1`, [id, hidden]);
    if (r.rowCount === 0) throw notFound('News post');
    await audit(c, { actorUserId: actor.adminId, action: hidden ? 'NEWS_HIDE' : 'NEWS_UNHIDE', targetType: 'news', targetId: id, ip: actor.ip });
    return newsView((await c.query<NewsRow>(`${NEWS_SELECT} WHERE n.id = $1`, [id])).rows[0]!);
  });
}

/** Idempotent: inserts each default story once (by seed key). */
export async function seedNews(c: Queryable): Promise<number> {
  let inserted = 0;
  for (const [i, s] of SEED_NEWS.entries()) {
    const r = await c.query(
      `INSERT INTO news_posts (ticker, headline, body, seed_key, created_at)
       VALUES ($1, $2, $3, $4, now() - ($5::int * interval '37 minutes'))
       ON CONFLICT (seed_key) DO NOTHING`,
      [s.ticker, s.headline, s.body, s.seedKey, i],
    );
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

/* -------------------------------- Watchlist ------------------------------- */

export async function getWatchlist(q: Queryable, userId: string): Promise<string[]> {
  const r = await q.query<{ ticker: string }>(
    `SELECT w.ticker FROM watchlist_items w WHERE w.user_id = $1 ORDER BY w.created_at, w.ticker`,
    [userId],
  );
  return r.rows.map((x) => x.ticker);
}

export async function addToWatchlist(pool: pg.Pool, userId: string, ticker: string): Promise<string[]> {
  if (!CANONICAL_TICKERS.has(ticker)) throw notFound('Security');
  return withTx(pool, async (c) => {
    // Serialize per user so the size cap cannot be raced past.
    await c.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const n = await c.query<{ n: bigint }>(`SELECT COUNT(*)::bigint AS n FROM watchlist_items WHERE user_id = $1`, [userId]);
    if (n.rows[0]!.n >= BigInt(WATCHLIST_MAX)) throw conflict('WATCHLIST_FULL', 'Watchlist is full');
    await c.query(`INSERT INTO watchlist_items (user_id, ticker) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, ticker]);
    return getWatchlist(c, userId);
  });
}

export async function removeFromWatchlist(pool: pg.Pool, userId: string, ticker: string): Promise<string[]> {
  await pool.query(`DELETE FROM watchlist_items WHERE user_id = $1 AND ticker = $2`, [userId, ticker]);
  return getWatchlist(pool, userId);
}
