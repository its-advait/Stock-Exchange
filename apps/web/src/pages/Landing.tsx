import { ArrowRight, BookOpen, Gauge, Scale, ShieldCheck, Sparkles, Trophy, Zap } from 'lucide-react';
import { Link } from 'react-router';
import { ChangePill, EmptyState, Logo, ParodyLabel, PriceKindBadge, SecurityLink, TickerMark, TradingStatus } from '@/components/common';
import { TradesList } from '@/components/trading';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';
import { int, money, signedMoney, timeAgo } from '@/lib/format';
import { useBoards, useMovers, useNews, useSecurities, useSummary, useTape } from '@/lib/queries';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function LandingPage() {
  usePageTitle(null);
  const secs = useSecurities();
  const summary = useSummary();
  const movers = useMovers();
  const tape = useTape(8);
  const boards = useBoards();
  const news = useNews(undefined, 3);

  const priced = (secs.data ?? []).filter((s) => s.displayPriceCents !== null);
  const snapshot = [...(secs.data ?? [])]
    .sort((a, b) => b.volume24h - a.volume24h || (b.displayPriceCents ?? -1) - (a.displayPriceCents ?? -1) || a.originalRank - b.originalRank)
    .slice(0, 7);

  return (
    <div className="-mt-5">
      {/* Hero */}
      <section className="relative grid gap-10 py-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-muted">
            <span className="size-1.5 rounded-full bg-up" /> Fictional simulation · Virtual money only
          </span>
          <h1 className="mt-6 text-[44px] font-bold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
            AEZ STOCK
            <br />
            EXCHANGE
          </h1>
          <p className="mt-5 text-xl font-medium tracking-tight text-fg sm:text-2xl">
            Invest in your brothers. <span className="text-fg-muted">Short their potential.</span>
          </p>
          <p className="mt-2 text-xs text-fg-subtle">
            *The tagline is a joke. Short selling is disabled — you can only sell shares you own.
          </p>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-fg-muted">
            All 45 brothers of Alpha Epsilon Zeta are listed on a real price-time-priority limit order book. Everyone starts with{' '}
            <b className="text-fg">$10,000 in virtual AEZ dollars</b>. Prices only move when two people actually trade, and the leaderboard ranks
            total portfolio equity.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="primary" size="lg" asChild>
              <Link to="/register">
                Open an account — get $10,000 <ArrowRight />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/markets">Explore the market</Link>
            </Button>
            <Button variant="ghost" size="lg" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </div>

        {/* Live snapshot */}
        <Panel className="shadow-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Logo compact />
              <div>
                <p className="text-[13px] font-semibold">Market snapshot</p>
                <p className="text-[11px] text-fg-subtle">Live from the exchange</p>
              </div>
            </div>
            <Link to="/markets" className="text-xs font-medium text-up hover:underline">
              All 45 →
            </Link>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
            {[
              ['Listed', summary.data ? `${summary.data.securities}` : null],
              ['Tradable', summary.data ? `${summary.data.tradableSecurities}` : null],
              ['24h volume', summary.data ? `${int(summary.data.volume24h)} sh` : null],
            ].map(([k, v]) => (
              <div key={k} className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-fg-subtle">{k}</p>
                {v === null ? <Skeleton className="mt-1.5 h-5 w-14" /> : <p className="num mt-1 text-lg font-semibold">{v}</p>}
              </div>
            ))}
          </div>
          {secs.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {snapshot.map((s) => (
                <li key={s.ticker}>
                  <Link to={`/stocks/${s.ticker}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <TickerMark ticker={s.ticker} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[13px] font-semibold">{s.ticker}</p>
                      <p className="truncate text-xs text-fg-muted">{s.name}</p>
                    </div>
                    {s.displayPriceCents !== null ? (
                      <div className="text-right">
                        <p className="num text-sm font-medium">{money(s.displayPriceCents)}</p>
                        <PriceKindBadge kind={s.displayPriceKind} className="mt-0.5" />
                      </div>
                    ) : (
                      <TradingStatus s={s} />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!secs.isLoading && priced.length === 0 && (
            <p className="border-t border-border px-4 py-3 text-xs text-fg-muted">
              All brothers are listed, but no verified reference prices have been imported yet, so nothing is tradable. Prices here are never
              invented.
            </p>
          )}
        </Panel>
      </section>

      {/* Disclaimer */}
      <section className="flex flex-col gap-3 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-4 text-[13px] text-fg sm:flex-row sm:items-center">
        <ShieldCheck className="size-5 shrink-0 text-warn" />
        <p>
          <b>Virtual money only.</b> AEZ dollars have no cash value. There are no deposits, withdrawals, payments or prizes, and nothing here is
          investment advice. Brother “companies”, profiles and news are fictional parody.
        </p>
      </section>

      {/* How it works */}
      <section className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
        {[
          [BookOpen, 'A real order book', 'Market and limit orders match by price, then time. Partial fills, resting orders and cancels all work like a real exchange.'],
          [Gauge, 'Prices move on trades', 'No random walks. The last price is the last actual execution between two brothers.'],
          [Scale, 'Honest accounting', 'Integer-cent ledgers, reserved cash for resting orders, and average-cost basis for every position.'],
          [Trophy, 'Ranked by equity', 'The leaderboard ranks total portfolio value — cash plus holdings at market — not just cash.'],
        ].map(([Icon, t, d]) => {
          const I = Icon as typeof BookOpen;
          return (
            <div key={t as string} className="bg-surface p-5">
              <I className="size-5 text-up" />
              <p className="mt-3 text-sm font-semibold">{t as string}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{d as string}</p>
            </div>
          );
        })}
      </section>

      {/* Performers / activity / leaderboard */}
      <section className="mt-12 grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Top performing brothers" subtitle="Change from reference, real trades only" action={<Sparkles className="size-4 text-fg-subtle" />} />
          {movers.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : movers.data?.gainers.length ? (
            <ul className="divide-y divide-border/60 pb-1">
              {movers.data.gainers.map((s) => (
                <li key={s.ticker} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <SecurityLink ticker={s.ticker} name={s.name} />
                  <div className="text-right">
                    <p className="num text-sm font-medium">{money(s.displayPriceCents)}</p>
                    <ChangePill bps={s.changeFromReferenceBps} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Sparkles />} title="No gainers yet">
              Performance appears once brothers start trading above their reference prices.
            </EmptyState>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Market activity" subtitle="Latest executions across the exchange" action={<Zap className="size-4 text-fg-subtle" />} />
          <TradesList trades={tape.data} loading={tape.isLoading} showTicker />
        </Panel>
        <Panel>
          <PanelHeader
            title="Leaderboard"
            subtitle="Total portfolio equity"
            action={
              <Link to="/leaderboard" className="text-xs font-medium text-up hover:underline">
                Full rankings →
              </Link>
            }
          />
          {boards.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : boards.data?.richest.length ? (
            <ol className="divide-y divide-border/60 pb-1">
              {boards.data.richest.slice(0, 6).map((r) => (
                <li key={r.userId}>
                  <Link to={`/traders/${r.username}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <span className={cn('num w-6 text-center text-xs font-bold', r.rank === 1 ? 'text-warn' : 'text-fg-subtle')}>#{r.rank}</span>
                    <span className="flex-1 truncate text-sm font-medium">{r.username}</span>
                    <span className="text-right">
                      <span className="num block text-sm">{money(r.totalValueCents)}</span>
                      <span className={cn('num block text-[11px]', r.pnlCents > 0 ? 'text-up' : r.pnlCents < 0 ? 'text-down' : 'text-fg-subtle')}>
                        {signedMoney(r.pnlCents)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={<Trophy />} title="No traders yet" action={<Button variant="primary" size="sm" asChild><Link to="/register">Be the first</Link></Button>} />
          )}
        </Panel>
      </section>

      {/* News */}
      <section className="mt-12">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <ParodyLabel />
            <h2 className="mt-2 text-xl font-semibold tracking-tight">From the AEZ newsroom</h2>
          </div>
          <Link to="/news" className="text-sm font-medium text-up hover:underline">
            All stories →
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {news.isLoading
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)
            : news.data?.map((p) => (
                <Link key={p.id} to={p.ticker ? `/stocks/${p.ticker}` : '/news'} className="panel group p-4 transition-colors hover:border-border-strong">
                  <div className="flex items-center gap-2 text-xs text-fg-subtle">
                    {p.ticker && <span className="font-mono font-semibold text-fg">{p.ticker}</span>}
                    <span>· {timeAgo(p.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-[15px] font-semibold leading-snug group-hover:text-up">{p.headline}</p>
                  <p className="mt-2 line-clamp-2 text-[13px] text-fg-muted">{p.body}</p>
                  <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-warn">Parody · not real news</p>
                </Link>
              ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mt-14 flex flex-col items-start justify-between gap-6 rounded-2xl border border-border bg-surface p-8 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Your brothers are waiting to be valued.</h2>
          <p className="mt-1.5 text-fg-muted">Open an account in seconds. $10,000 of virtual buying power, zero real-world consequences.</p>
        </div>
        <Button variant="primary" size="lg" asChild>
          <Link to="/register">
            Start trading <ArrowRight />
          </Link>
        </Button>
      </section>
    </div>
  );
}
