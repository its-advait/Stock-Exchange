import type { SecurityView } from '@aez/shared';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Change, EmptyState, PriceKindBadge, TickerMark, TradingStatus, WatchButton } from '@/components/common';
import { Input, Panel, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { int, money, pct, signedMoney } from '@/lib/format';
import { useSecurities, useStatus, useSummary } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'gainers' | 'losers' | 'traded' | 'active' | 'halted';
type SortKey = 'rank' | 'ticker' | 'name' | 'price' | 'chg' | 'pct' | 'volume' | 'bid' | 'ask' | 'status';
type Basis = '24h' | 'listing';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'traded', label: 'Most traded' },
  { id: 'active', label: 'Active' },
  { id: 'halted', label: 'Halted / restricted' },
];

function changeOf(s: SecurityView, basis: Basis): { cents: number | null; bps: number | null } {
  if (s.lastPriceCents === null) return { cents: null, bps: null }; // never traded: no change to report
  if (basis === '24h') return { cents: s.change24hCents, bps: s.change24hBps };
  return {
    cents: s.referencePriceCents !== null ? s.lastPriceCents - s.referencePriceCents : null,
    bps: s.changeFromReferenceBps,
  };
}

const isHalted = (s: SecurityView) =>
  s.symbolHalted || s.listingStatus === 'HALTED' || s.listingStatus === 'SUSPENDED' || s.listingStatus === 'UNLISTED' || s.tradingBlockReason === 'MARKET_HALTED';

export default function MarketsPage() {
  usePageTitle('Markets');
  const secs = useSecurities();
  const summary = useSummary();
  const status = useStatus();
  const nav = useNavigate();
  const { lastTick } = useRealtime();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filter = (params.get('f') as Filter) || 'all';
  const [basis, setBasis] = useState<Basis>('24h');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v && v !== 'all') p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const all = secs.data ?? [];
  const counts = useMemo(
    () => ({
      all: all.length,
      gainers: all.filter((s) => (changeOf(s, basis).bps ?? 0) > 0).length,
      losers: all.filter((s) => (changeOf(s, basis).bps ?? 0) < 0).length,
      traded: all.filter((s) => s.volume24h > 0).length,
      active: all.filter((s) => s.tradable).length,
      halted: all.filter(isHalted).length,
    }),
    [all, basis],
  );

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let r = all.filter((s) => !term || s.ticker.toLowerCase().includes(term) || s.name.toLowerCase().includes(term));
    if (filter === 'gainers') r = r.filter((s) => (changeOf(s, basis).bps ?? 0) > 0);
    if (filter === 'losers') r = r.filter((s) => (changeOf(s, basis).bps ?? 0) < 0);
    if (filter === 'traded') r = r.filter((s) => s.volume24h > 0);
    if (filter === 'active') r = r.filter((s) => s.tradable);
    if (filter === 'halted') r = r.filter(isHalted);
    // "Most traded" defaults to volume order unless the user picked a column.
    const eff = filter === 'traded' && sort.key === 'rank' ? { key: 'volume' as SortKey, dir: -1 as const } : sort;
    const val = (s: SecurityView): number | string | null => {
      switch (eff.key) {
        case 'rank': return s.originalRank;
        case 'ticker': return s.ticker;
        case 'name': return s.name;
        case 'price': return s.displayPriceCents;
        case 'chg': return changeOf(s, basis).cents;
        case 'pct': return changeOf(s, basis).bps;
        case 'volume': return s.volume24h;
        case 'bid': return s.bestBidCents;
        case 'ask': return s.bestAskCents;
        case 'status': return s.tradable ? 0 : 1;
      }
    };
    return [...r].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null && vb === null) return a.originalRank - b.originalRank;
      if (va === null) return 1; // nulls last regardless of direction
      if (vb === null) return -1;
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * eff.dir || a.originalRank - b.originalRank;
    });
  }, [all, q, filter, sort, basis]);

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th className={cn('py-2.5 font-medium', right ? 'text-right' : 'text-left')} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          className={cn('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg', right && 'flex-row-reverse')}
          onClick={() => setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === 'ticker' || k === 'name' || k === 'rank' ? 1 : -1 }))}
        >
          {children}
          <Icon className={cn('size-3', !active && 'opacity-40')} />
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Markets</h1>
          <p className="text-sm text-fg-muted">
            All 45 AEZ brothers.{' '}
            {summary.data && (
              <>
                {summary.data.tradableSecurities} tradable · {int(summary.data.trades24h)} trades and {int(summary.data.volume24h)} shares in 24h.
              </>
            )}
          </p>
        </div>
        {status.data && !status.data.open && (
          <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-1.5 text-[13px] text-warn">Exchange halted: {status.data.marketHalt?.reason}</p>
        )}
      </div>

      <Panel>
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center">
          <div className="relative lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={q}
              onChange={(e) => set('q', e.target.value)}
              placeholder="Search by ticker or brother name"
              className="pl-9"
              aria-label="Search securities"
            />
          </div>
          <div className="flex flex-1 gap-1.5 overflow-x-auto scrollbar-thin" role="group" aria-label="Filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => set('f', f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
                  filter === f.id ? 'border-up/40 bg-up-soft text-up' : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {f.label}
                <span className="num text-[11px] opacity-70">{secs.data ? counts[f.id] : ''}</span>
              </button>
            ))}
          </div>
          <Tabs value={basis} onValueChange={(v) => setBasis(v as Basis)}>
            <TabsList aria-label="Change basis">
              <TabsTrigger value="24h">24h change</TabsTrigger>
              <TabsTrigger value="listing">Since listing</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-subtle">
                <th className="w-10 py-2.5 pl-3" aria-label="Watch" />
                <Th k="rank">#</Th>
                <Th k="ticker">Ticker</Th>
                <Th k="name">Brother</Th>
                <Th k="price" right>Price</Th>
                <Th k="chg" right>Change</Th>
                <Th k="pct" right>% Change</Th>
                <Th k="volume" right>Volume 24h</Th>
                <Th k="bid" right>Bid</Th>
                <Th k="ask" right>Ask</Th>
                <th className="py-2.5 pl-6 pr-4 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {secs.isLoading
                ? Array.from({ length: 12 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td colSpan={11} className="px-4 py-2">
                        <Skeleton className="h-8" />
                      </td>
                    </tr>
                  ))
                : rows.map((s) => {
                    const ch = changeOf(s, basis);
                    const tick = lastTick[s.ticker];
                    const flash = tick && Date.now() - tick.at < 1500 ? (tick.dir === 'up' ? 'flash-up' : 'flash-down') : '';
                    return (
                      <tr
                        key={s.ticker}
                        tabIndex={0}
                        onClick={() => nav(`/stocks/${s.ticker}`)}
                        onKeyDown={(e) => e.key === 'Enter' && nav(`/stocks/${s.ticker}`)}
                        className={cn('cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2/60 focus-visible:bg-surface-2 focus-visible:outline-none', flash)}
                        aria-label={`${s.ticker} ${s.name}`}
                      >
                        <td className="py-2 pl-3">
                          <WatchButton ticker={s.ticker} />
                        </td>
                        <td className="num py-2 text-fg-subtle">{s.originalRank}</td>
                        <td className="py-2">
                          <span className="flex items-center gap-2.5">
                            <TickerMark ticker={s.ticker} size="sm" />
                            <span className="font-mono font-semibold">{s.ticker}</span>
                          </span>
                        </td>
                        <td className="max-w-56 truncate py-2 text-fg-muted">{s.name}</td>
                        <td className="py-2 text-right">
                          <div className="num font-medium">{money(s.displayPriceCents)}</div>
                          {s.displayPriceKind && s.displayPriceKind !== 'LAST_TRADE' && <PriceKindBadge kind={s.displayPriceKind} className="mt-0.5" />}
                        </td>
                        <td className={cn('num py-2 text-right', ch.cents ? (ch.cents > 0 ? 'text-up' : 'text-down') : 'text-fg-subtle')}>{signedMoney(ch.cents)}</td>
                        <td className="py-2 text-right">{ch.bps === null ? <span className="text-fg-subtle">—</span> : <Change bps={ch.bps} />}</td>
                        <td className="num py-2 text-right">{s.volume24h ? int(s.volume24h) : <span className="text-fg-subtle">0</span>}</td>
                        <td className="num py-2 text-right text-up/90">{money(s.bestBidCents)}</td>
                        <td className="num py-2 text-right text-down/90">{money(s.bestAskCents)}</td>
                        <td className="py-2 pl-6 pr-4">
                          <TradingStatus s={s} />
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!secs.isLoading && rows.length === 0 && (
            <EmptyState icon={<SearchX />} title="No brothers match">
              {q ? `Nothing for “${q}”` : 'No securities match this filter right now.'}
              {filter !== 'all' && ` (${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()})`}
            </EmptyState>
          )}
        </div>
        <p className="border-t border-border px-4 py-2.5 text-[11px] text-fg-subtle">
          Price is the last execution, or the reference price when a brother hasn’t traded (labeled). Change is shown only after real trades — {basis === '24h' ? 'vs. the price 24h ago' : 'vs. the reference price'} ({pct(0)} is a real zero).
        </p>
      </Panel>
    </div>
  );
}
