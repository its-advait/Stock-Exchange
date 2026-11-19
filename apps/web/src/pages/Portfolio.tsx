import { Briefcase, PieChart, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, PriceKindBadge, SecurityLink, StatBlock } from '@/components/common';
import { MyTradesTable, OrdersTable, TableSkeleton } from '@/components/trading';
import { Button } from '@/components/ui/button';
import { LineTabsList, LineTabsTrigger, Panel, PanelHeader, Skeleton, Tabs, TabsContent } from '@/components/ui/primitives';
import { bpsOf, dateTime, int, money, pct, signedMoney } from '@/lib/format';
import { useCashLedger, useMyTrades, useOrders, usePortfolio, usePositionLedger } from '@/lib/queries';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { PortfolioHero } from './Dashboard';

const PALETTE = ['var(--up)', '#6aa8ff', '#f2b84b', '#c084fc', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#94a3b8'];
const pnl = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-fg-muted');

export default function PortfolioPage() {
  usePageTitle('Portfolio');
  const pf = usePortfolio();
  const open = useOrders('open');
  const all = useOrders('all');
  const trades = useMyTrades();
  const cash = useCashLedger();
  const pos = usePositionLedger();
  const p = pf.data;
  const holdings = (p?.holdings ?? []).filter((h) => h.quantity > 0);
  const closed = (p?.holdings ?? []).filter((h) => h.quantity === 0 && h.realizedPnlCents !== 0);

  // Composition by market value (cash included), in basis points of total equity.
  const comp = p
    ? [
        ...holdings.map((h) => ({ key: h.ticker, value: h.marketValueCents })),
        { key: 'Cash', value: p.cashCents },
      ]
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-fg-muted">Average-cost basis. Realized P/L is locked in by sells; unrealized P/L marks open positions to the last trade.</p>
        </div>
        {p?.rank && (
          <Link to="/leaderboard" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-border-strong">
            <Trophy className="size-4 text-warn" /> Rank <b className="num">#{p.rank}</b> <span className="text-fg-subtle">of {p.rankedUsers}</span>
          </Link>
        )}
      </div>

      <Panel className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 lg:grid-cols-6">
        <StatBlock label="Net worth" value={money(p?.totalValueCents)} sub={p ? <span className={pnl(p.totalPnlCents)}>{signedMoney(p.totalPnlCents)} ({pct(bpsOf(p.totalPnlCents, p.startingCashCents))})</span> : undefined} />
        <StatBlock label="Available cash" value={money(p?.availableCashCents)} sub="Buying power" />
        <StatBlock label="Reserved cash" value={money(p?.reservedCashCents)} sub="Held by resting buys" />
        <StatBlock label="Holdings value" value={money(p?.holdingsValueCents)} />
        <StatBlock label="Unrealized P/L" value={<span className={pnl(p?.unrealizedPnlCents ?? 0)}>{signedMoney(p?.unrealizedPnlCents)}</span>} />
        <StatBlock label="Realized P/L" value={<span className={pnl(p?.realizedPnlCents ?? 0)}>{signedMoney(p?.realizedPnlCents)}</span>} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <PortfolioHero compact />
        <Panel>
          <PanelHeader title="Composition" subtitle="Share of total equity" action={<PieChart className="size-4 text-fg-subtle" />} />
          {!p ? (
            <Skeleton className="mx-4 mb-4 h-40" />
          ) : (
            <div className="px-4 pb-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-surface-3" role="img" aria-label="Portfolio composition">
                {comp.map((c, i) => (
                  <div key={c.key} style={{ width: `${(c.value / p.totalValueCents) * 100}%`, background: c.key === 'Cash' ? 'var(--border-strong)' : PALETTE[i % PALETTE.length] }} />
                ))}
              </div>
              <ul className="mt-4 space-y-2">
                {comp.map((c, i) => (
                  <li key={c.key} className="flex items-center gap-2.5 text-[13px]">
                    <span className="size-2.5 rounded-sm" style={{ background: c.key === 'Cash' ? 'var(--border-strong)' : PALETTE[i % PALETTE.length] }} />
                    {c.key === 'Cash' ? <span className="text-fg-muted">Cash</span> : <Link to={`/stocks/${c.key}`} className="font-mono font-semibold hover:text-up">{c.key}</Link>}
                    <span className="num ml-auto text-fg-muted">{money(c.value)}</span>
                    <span className="num w-16 text-right font-medium">{pct(bpsOf(c.value, p.totalValueCents))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Holdings" subtitle={`${holdings.length} open position${holdings.length === 1 ? '' : 's'}`} />
        {pf.isLoading ? (
          <TableSkeleton rows={4} />
        ) : holdings.length ? (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                  <th className="px-4 py-2 font-medium">Security</th>
                  <th className="py-2 text-right font-medium">Shares</th>
                  <th className="py-2 text-right font-medium">Avg cost</th>
                  <th className="py-2 text-right font-medium">Mark</th>
                  <th className="py-2 text-right font-medium">Market value</th>
                  <th className="py-2 text-right font-medium">Cost basis</th>
                  <th className="py-2 text-right font-medium">Unrealized</th>
                  <th className="px-4 py-2 text-right font-medium">Realized</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.ticker} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <SecurityLink ticker={h.ticker} name={h.name} />
                    </td>
                    <td className="num py-2.5 text-right">
                      {int(h.quantity)}
                      {h.reservedQuantity > 0 && <div className="text-[11px] text-warn">{int(h.reservedQuantity)} reserved</div>}
                    </td>
                    <td className="num py-2.5 text-right text-fg-muted">{money(Math.round(h.costBasisCents / h.quantity))}</td>
                    <td className="py-2.5 text-right">
                      <div className="num">{money(h.markPriceCents)}</div>
                      {h.markPriceKind !== 'LAST_TRADE' && <PriceKindBadge kind={h.markPriceKind} className="mt-0.5" />}
                    </td>
                    <td className="num py-2.5 text-right font-medium">{money(h.marketValueCents)}</td>
                    <td className="num py-2.5 text-right text-fg-muted">{money(h.costBasisCents)}</td>
                    <td className={cn('num py-2.5 text-right', pnl(h.unrealizedPnlCents))}>
                      {signedMoney(h.unrealizedPnlCents)}
                      <div className="text-[11px] opacity-80">{pct(bpsOf(h.unrealizedPnlCents, h.costBasisCents))}</div>
                    </td>
                    <td className={cn('num px-4 py-2.5 text-right', pnl(h.realizedPnlCents))}>{signedMoney(h.realizedPnlCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Briefcase />}
            title="No positions yet"
            action={
              <Button variant="primary" size="sm" asChild>
                <Link to="/markets">Browse the market</Link>
              </Button>
            }
          >
            You have {money(p?.availableCashCents)} of buying power waiting.
          </EmptyState>
        )}
        {closed.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-[13px] text-fg-muted">
            Closed positions:{' '}
            {closed.map((h, i) => (
              <span key={h.ticker}>
                {i > 0 && ', '}
                <Link to={`/stocks/${h.ticker}`} className="font-mono font-semibold text-fg hover:text-up">
                  {h.ticker}
                </Link>{' '}
                <span className={pnl(h.realizedPnlCents)}>{signedMoney(h.realizedPnlCents)}</span>
              </span>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <Tabs defaultValue="open">
          <div className="px-4 pt-3">
            <LineTabsList>
              <LineTabsTrigger value="open">
                Open orders {open.data?.length ? <span className="num ml-1 rounded bg-warn-soft px-1 text-[11px] text-warn">{open.data.length}</span> : null}
              </LineTabsTrigger>
              <LineTabsTrigger value="trades">Executions</LineTabsTrigger>
              <LineTabsTrigger value="orders">All orders</LineTabsTrigger>
              <LineTabsTrigger value="cash">Cash ledger</LineTabsTrigger>
              <LineTabsTrigger value="positions">Position ledger</LineTabsTrigger>
            </LineTabsList>
          </div>
          <TabsContent value="open">
            <OrdersTable orders={open.data} loading={open.isLoading} emptyText="No resting orders." />
          </TabsContent>
          <TabsContent value="trades">
            <MyTradesTable trades={trades.data} loading={trades.isLoading} />
          </TabsContent>
          <TabsContent value="orders">
            <OrdersTable orders={all.data} loading={all.isLoading} />
          </TabsContent>
          <TabsContent value="cash">
            {cash.isLoading ? (
              <TableSkeleton />
            ) : (
              <LedgerTable
                rows={(cash.data ?? []).map((e) => ({
                  id: e.id,
                  at: e.createdAt,
                  reason: e.reason,
                  ref: e.tradeId ? `Trade #${e.tradeId}` : '—',
                  delta: <span className={pnl(e.amountCents)}>{signedMoney(e.amountCents)}</span>,
                  after: money(e.balanceAfterCents),
                }))}
                deltaLabel="Amount"
                afterLabel="Cash after"
              />
            )}
          </TabsContent>
          <TabsContent value="positions">
            {pos.isLoading ? (
              <TableSkeleton />
            ) : (
              <LedgerTable
                rows={(pos.data ?? []).map((e) => ({
                  id: e.id,
                  at: e.createdAt,
                  reason: e.reason,
                  ref: (
                    <Link to={`/stocks/${e.ticker}`} className="font-mono font-semibold hover:text-up">
                      {e.ticker}
                    </Link>
                  ),
                  delta: <span className={pnl(e.quantityDelta)}>{e.quantityDelta > 0 ? '+' : ''}{int(e.quantityDelta)}</span>,
                  after: int(e.quantityAfter),
                }))}
                deltaLabel="Shares"
                afterLabel="Position after"
                refLabel="Security"
              />
            )}
          </TabsContent>
        </Tabs>
      </Panel>
    </div>
  );
}

function LedgerTable({
  rows,
  deltaLabel,
  afterLabel,
  refLabel = 'Reference',
}: {
  rows: { id: number; at: string; reason: string; ref: React.ReactNode; delta: React.ReactNode; after: React.ReactNode }[];
  deltaLabel: string;
  afterLabel: string;
  refLabel?: string;
}) {
  if (!rows.length) return <EmptyState title="No ledger entries yet" />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[600px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="px-4 py-2 font-medium">Time</th>
            <th className="py-2 font-medium">Entry</th>
            <th className="py-2 font-medium">{refLabel}</th>
            <th className="py-2 text-right font-medium">{deltaLabel}</th>
            <th className="px-4 py-2 text-right font-medium">{afterLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2.5 text-fg-muted">{dateTime(r.at)}</td>
              <td className="py-2.5 text-xs font-medium tracking-wide">{r.reason.replaceAll('_', ' ')}</td>
              <td className="py-2.5 text-fg-muted">{r.ref}</td>
              <td className="num py-2.5 text-right">{r.delta}</td>
              <td className="num px-4 py-2.5 text-right">{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
