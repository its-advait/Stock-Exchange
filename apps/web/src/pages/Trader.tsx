import { Lock, UserX } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ChangePill, EmptyState, StatBlock } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Badge, Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';
import { dateTime, int, money, pct, signedMoney } from '@/lib/format';
import { useMe, useTrader } from '@/lib/queries';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';

const PALETTE = ['var(--up)', '#6aa8ff', '#f2b84b', '#c084fc', '#f472b6', '#22d3ee', '#a3e635', '#fb923c'];

export default function TraderPage() {
  const username = useParams().username ?? '';
  const t = useTrader(username);
  const me = useMe();
  usePageTitle(t.data ? `${t.data.username} · trader` : 'Trader');
  if (t.isError)
    return (
      <EmptyState icon={<UserX />} className="py-24" title="Trader not found" action={<Button asChild><Link to="/leaderboard">Back to leaderboard</Link></Button>}>
        There’s no active trader called “{username}”.
      </EmptyState>
    );
  const d = t.data;
  const isMe = d && me.data?.username.toLowerCase() === d.username.toLowerCase();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Panel className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-up-soft font-mono text-lg font-bold uppercase text-up">{username.slice(0, 2)}</span>
            <div>
              {d ? <h1 className="text-2xl font-bold tracking-tight">{d.username}</h1> : <Skeleton className="h-7 w-40" />}
              <p className="mt-0.5 text-sm text-fg-muted">
                {d ? <>Trading since {new Date(d.joinedAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</> : '…'}
                {isMe && <Badge tone="up" className="ml-2">This is you</Badge>}
              </p>
            </div>
          </div>
          {d?.rank && (
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-fg-subtle">Rank</p>
              <p className="num text-3xl font-bold">#{d.rank}</p>
              <p className="text-xs text-fg-subtle">of {d.rankedUsers}</p>
            </div>
          )}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-5 border-t border-border pt-5 sm:grid-cols-4">
          <StatBlock label="Total equity" value={money(d?.totalValueCents)} />
          <StatBlock label="Profit" value={<span className={cls(d?.pnlCents)}>{signedMoney(d?.pnlCents)}</span>} sub={d ? <ChangePill bps={d.returnBps} /> : undefined} />
          <StatBlock label="Realized P/L" value={<span className={cls(d?.realizedPnlCents)}>{signedMoney(d?.realizedPnlCents)}</span>} />
          <StatBlock label="Executions" value={int(d?.trades)} />
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <PanelHeader title="Allocation" subtitle="Weights only — no balances or share counts" />
          {!d ? (
            <Skeleton className="mx-4 mb-4 h-32" />
          ) : d.composition.length ? (
            <div className="px-4 pb-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-surface-3">
                {d.composition.map((c, i) => (
                  <div key={c.ticker} style={{ width: `${c.weightBps / 100}%`, background: c.ticker === 'CASH' ? 'var(--border-strong)' : PALETTE[i % PALETTE.length] }} />
                ))}
              </div>
              <ul className="mt-4 space-y-2">
                {d.composition.map((c, i) => (
                  <li key={c.ticker} className="flex items-center gap-2.5 text-[13px]">
                    <span className="size-2.5 rounded-sm" style={{ background: c.ticker === 'CASH' ? 'var(--border-strong)' : PALETTE[i % PALETTE.length] }} />
                    {c.ticker === 'CASH' ? <span className="text-fg-muted">Cash</span> : <Link to={`/stocks/${c.ticker}`} className="font-mono font-semibold hover:text-up">{c.ticker}</Link>}
                    <span className="num ml-auto font-medium">{pct(c.weightBps)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState title="No equity to allocate" />
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Best trade" subtitle="Largest realized gain on a single sell" />
          {!d ? (
            <Skeleton className="mx-4 mb-4 h-24" />
          ) : d.biggestWin ? (
            <div className="px-4 pb-5">
              <p className="num text-3xl font-semibold text-up">{signedMoney(d.biggestWin.realizedPnlCents)}</p>
              <p className="mt-1 text-[13px] text-fg-muted">
                Sold {int(d.biggestWin.quantity)}{' '}
                <Link to={`/stocks/${d.biggestWin.ticker}`} className="font-mono font-semibold text-fg hover:text-up">
                  {d.biggestWin.ticker}
                </Link>{' '}
                @ {money(d.biggestWin.priceCents)} · {dateTime(d.biggestWin.executedAt)}
              </p>
            </div>
          ) : (
            <EmptyState title="No winning sells yet" className="py-8" />
          )}
        </Panel>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <Lock className="size-3.5" /> Public profiles never show open orders, exact cash or share balances, or any account details.
      </p>
    </div>
  );
}

const cls = (v: number | null | undefined) => cn(v ? (v > 0 ? 'text-up' : 'text-down') : '');
