import type { PortfolioHistoryView } from '@aez/shared';
import { Activity, Flame, LineChart, Star, TrendingDown, TrendingUp, Trophy, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ValueChart } from '@/components/charts';
import { Change, ChangePill, EmptyState, OrderStatusBadge, SecurityLink, SideText, StatBlock, TradingStatus, WatchButton } from '@/components/common';
import { TradesList } from '@/components/trading';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { bpsOf, dateTime, int, money, signedMoney, timeAgo } from '@/lib/format';
import { useBoards, useMe, useMovers, useMyTrades, useOrders, usePortfolio, usePortfolioHistory, useSecurities, useTape, useWatchlist } from '@/lib/queries';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';

const RANGES: PortfolioHistoryView['range'][] = ['1D', '1W', '1M', 'ALL'];

export function PortfolioHero({ compact }: { compact?: boolean }) {
  const pf = usePortfolio();
  const [range, setRange] = useState<PortfolioHistoryView['range']>('1W');
  const hist = usePortfolioHistory(range);
  const [hover, setHover] = useState<{ at: string; valueCents: number } | null>(null);
  const p = pf.data;
  const points = hist.data?.points ?? [];
  const first = points[0]?.valueCents;
  const shown = hover?.valueCents ?? p?.totalValueCents;
  const rangeChange = hover && first !== undefined ? hover.valueCents - first : p && first !== undefined ? p.totalValueCents - first : null;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Portfolio value</p>
          {p ? (
            <p className="num mt-1 text-4xl font-semibold tracking-tight sm:text-[44px]">{money(shown)}</p>
          ) : (
            <Skeleton className="mt-2 h-11 w-64" />
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            {hover ? (
              <span className="text-fg-muted">
                <Change cents={rangeChange} bps={first ? bpsOf(rangeChange ?? 0, first) : null} /> <span className="ml-1">{dateTime(hover.at)}</span>
              </span>
            ) : p ? (
              <>
                <span className="flex items-center gap-1.5">
                  <Change cents={p.dayChangeCents} bps={bpsOf(p.dayChangeCents, p.dayStartValueCents)} />
                  <span className="text-fg-subtle">today</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Change cents={p.totalPnlCents} bps={bpsOf(p.totalPnlCents, p.startingCashCents)} />
                  <span className="text-fg-subtle">all time</span>
                </span>
              </>
            ) : (
              <Skeleton className="h-4 w-48" />
            )}
          </div>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)}>
          <TabsList aria-label="Chart range">
            {RANGES.map((r) => (
              <TabsTrigger key={r} value={r}>
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="mt-2 px-2">
        {hist.isLoading || !p ? (
          <Skeleton className="mx-3 mb-3 h-[260px]" />
        ) : points.length > 1 ? (
          <ValueChart points={points} baselineCents={first ?? p.startingCashCents} height={compact ? 220 : 280} onHover={setHover} />
        ) : (
          <EmptyState icon={<LineChart />} title="Your history starts with your first trade" className="h-[260px]">
            The chart is rebuilt from your actual ledger entries and executions — nothing is simulated.
          </EmptyState>
        )}
      </div>
    </Panel>
  );
}

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const me = useMe();
  const pf = usePortfolio();
  const p = pf.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Good {greeting()}, {me.data?.username}</h1>
          <p className="text-sm text-fg-muted">Here’s how your brothers are doing.</p>
        </div>
        <Button variant="primary" asChild>
          <Link to="/markets">Find a brother to trade</Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <PortfolioHero />
        <Panel className="flex flex-col">
          <PanelHeader title="Buying power" action={<Wallet className="size-4 text-fg-subtle" />} />
          <div className="px-4 pb-4">
            {p ? <p className="num text-3xl font-semibold tracking-tight">{money(p.availableCashCents)}</p> : <Skeleton className="h-9 w-40" />}
            <p className="mt-1 text-xs text-fg-subtle">Available AEZ dollars for new orders</p>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-border p-4">
            <StatBlock label="Cash balance" value={money(p?.cashCents)} />
            <StatBlock label="Reserved" value={money(p?.reservedCashCents)} sub="Held by resting buys" />
            <StatBlock label="Holdings" value={money(p?.holdingsValueCents)} />
            <StatBlock
              label="Rank"
              value={p?.rank ? `#${p.rank}` : '—'}
              sub={p ? (p.rank ? `of ${int(p.rankedUsers)} traders` : 'Admins are not ranked') : undefined}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-border p-4">
            <StatBlock label="Realized P/L" value={<span className={pnlCls(p?.realizedPnlCents)}>{signedMoney(p?.realizedPnlCents)}</span>} />
            <StatBlock label="Unrealized P/L" value={<span className={pnlCls(p?.unrealizedPnlCents)}>{signedMoney(p?.unrealizedPnlCents)}</span>} />
          </div>
          <div className="mt-auto border-t border-border p-3">
            <Button variant="ghost" size="sm" className="w-full" asChild>
              <Link to="/portfolio">View full portfolio →</Link>
            </Button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Movers />
        <Trending />
        <WatchlistPanel />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Recently executed" subtitle="Exchange-wide tape" action={<Activity className="size-4 text-fg-subtle" />} />
          <TapePanel />
        </Panel>
        <RecentActivity />
        <MiniLeaderboard />
      </div>
    </div>
  );
}

const pnlCls = (v: number | null | undefined) => (v ? (v > 0 ? 'text-up' : 'text-down') : '');

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

function TapePanel() {
  const tape = useTape(10);
  return <TradesList trades={tape.data} loading={tape.isLoading} showTicker />;
}

function Movers() {
  const m = useMovers();
  const [tab, setTab] = useState<'gainers' | 'losers'>('gainers');
  const rows = m.data?.[tab] ?? [];
  return (
    <Panel>
      <PanelHeader
        title="Market movers"
        subtitle="vs. reference price"
        action={
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="gainers">
                <TrendingUp className="size-3.5" /> Gainers
              </TabsTrigger>
              <TabsTrigger value="losers">
                <TrendingDown className="size-3.5" /> Losers
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      {m.isLoading ? (
        <ListSkeleton />
      ) : rows.length ? (
        <ul className="divide-y divide-border/60 pb-1">
          {rows.map((s) => (
            <li key={s.ticker} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <SecurityLink ticker={s.ticker} name={s.name} />
              <div className="flex items-center gap-3">
                <span className="num text-sm">{money(s.displayPriceCents)}</span>
                <ChangePill bps={s.changeFromReferenceBps} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={tab === 'gainers' ? <TrendingUp /> : <TrendingDown />} title={`No ${tab} yet`}>
          Movers appear once securities trade away from their reference prices.
        </EmptyState>
      )}
    </Panel>
  );
}

function Trending() {
  const secs = useSecurities();
  const rows = [...(secs.data ?? [])].filter((s) => s.trades24h > 0).sort((a, b) => b.trades24h - a.trades24h || b.volume24h - a.volume24h).slice(0, 5);
  return (
    <Panel>
      <PanelHeader title="Trending brothers" subtitle="Most executions in the last 24h" action={<Flame className="size-4 text-fg-subtle" />} />
      {secs.isLoading ? (
        <ListSkeleton />
      ) : rows.length ? (
        <ul className="divide-y divide-border/60 pb-1">
          {rows.map((s) => (
            <li key={s.ticker} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <SecurityLink ticker={s.ticker} name={s.name} />
              <div className="text-right">
                <p className="num text-sm">{money(s.displayPriceCents)}</p>
                <p className="num text-[11px] text-fg-subtle">
                  {int(s.trades24h)} trades · {int(s.volume24h)} sh
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Flame />} title="Nothing trending yet">
          No executions in the last 24 hours.
        </EmptyState>
      )}
    </Panel>
  );
}

function WatchlistPanel() {
  const wl = useWatchlist();
  const secs = useSecurities();
  const rows = (wl.data ?? []).map((t) => secs.data?.find((s) => s.ticker === t)).filter((s) => !!s);
  return (
    <Panel>
      <PanelHeader title="Watchlist" subtitle="Saved to your account" action={<Star className="size-4 text-fg-subtle" />} />
      {wl.isLoading || secs.isLoading ? (
        <ListSkeleton />
      ) : rows.length ? (
        <ul className="max-h-[300px] divide-y divide-border/60 overflow-y-auto pb-1 scrollbar-thin">
          {rows.map((s) => (
            <li key={s.ticker} className="flex items-center justify-between gap-2 py-2 pl-4 pr-2">
              <SecurityLink ticker={s.ticker} name={s.name} />
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="num text-sm">{money(s.displayPriceCents)}</p>
                  {s.tradable ? <Change bps={s.changeFromReferenceBps} className="text-[11px]" /> : <TradingStatus s={s} />}
                </div>
                <WatchButton ticker={s.ticker} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Star />}
          title="Your watchlist is empty"
          action={
            <Button size="sm" variant="secondary" asChild>
              <Link to="/markets">Browse brothers</Link>
            </Button>
          }
        >
          Tap the star on any brother to keep an eye on them.
        </EmptyState>
      )}
    </Panel>
  );
}

function RecentActivity() {
  const trades = useMyTrades();
  const orders = useOrders('all');
  type Item = { key: string; at: string; node: React.ReactNode };
  const items: Item[] = [
    ...(trades.data ?? []).slice(0, 10).map((t) => ({
      key: `t${t.id}${t.side}`,
      at: t.executedAt,
      node: (
        <>
          <SideText side={t.side} />
          <span className="text-fg">
            {t.side === 'BUY' ? 'Bought' : 'Sold'} {int(t.quantity)}{' '}
            <Link to={`/stocks/${t.ticker}`} className="font-mono font-semibold hover:text-up">
              {t.ticker}
            </Link>{' '}
            @ {money(t.priceCents)}
          </span>
        </>
      ),
    })),
    ...(orders.data ?? [])
      .filter((o) => o.status !== 'FILLED')
      .slice(0, 10)
      .map((o) => ({
        key: `o${o.id}`,
        at: o.createdAt,
        node: (
          <>
            <OrderStatusBadge status={o.status} />
            <span className="truncate text-fg-muted">
              {o.type.toLowerCase()} {o.side.toLowerCase()} {int(o.quantity)}{' '}
              <Link to={`/stocks/${o.ticker}`} className="font-mono font-semibold text-fg hover:text-up">
                {o.ticker}
              </Link>
              {o.limitPriceCents !== null && ` @ ${money(o.limitPriceCents)}`}
            </span>
          </>
        ),
      })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 9);
  return (
    <Panel>
      <PanelHeader
        title="Your recent activity"
        action={
          <Link to="/portfolio" className="text-xs font-medium text-up hover:underline">
            History →
          </Link>
        }
      />
      {trades.isLoading || orders.isLoading ? (
        <ListSkeleton />
      ) : items.length ? (
        <ul className="divide-y divide-border/60 pb-1">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px]">
              {i.node}
              <span className="ml-auto shrink-0 text-[11px] text-fg-subtle">{timeAgo(i.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Activity />} title="No activity yet">
          Place your first order from any brother’s page.
        </EmptyState>
      )}
    </Panel>
  );
}

function MiniLeaderboard() {
  const b = useBoards();
  const me = useMe();
  return (
    <Panel>
      <PanelHeader
        title="Leaderboard"
        subtitle="Total equity"
        action={
          <Link to="/leaderboard" className="text-xs font-medium text-up hover:underline">
            All →
          </Link>
        }
      />
      {b.isLoading ? (
        <ListSkeleton />
      ) : b.data?.richest.length ? (
        <ol className="divide-y divide-border/60 pb-1">
          {b.data.richest.slice(0, 7).map((r) => (
            <li key={r.userId}>
              <Link
                to={`/traders/${r.username}`}
                className={cn('flex items-center gap-3 px-4 py-2 hover:bg-surface-2', r.userId === me.data?.id && 'bg-up-soft/50')}
              >
                <span className={cn('num w-6 text-xs font-bold', r.rank === 1 ? 'text-warn' : 'text-fg-subtle')}>{r.rank === 1 ? <Trophy className="size-3.5" /> : `#${r.rank}`}</span>
                <span className="flex-1 truncate text-[13px] font-medium">
                  {r.username}
                  {r.userId === me.data?.id && <span className="ml-1 text-[11px] text-up">(you)</span>}
                </span>
                <span className="num text-[13px]">{money(r.totalValueCents)}</span>
                <ChangePill bps={r.returnBps} />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={<Trophy />} title="No ranked traders yet" />
      )}
    </Panel>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 px-4 pb-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}
