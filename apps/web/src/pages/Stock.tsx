import { CANONICAL_TICKERS } from '@aez/shared';
import { BarChart2, CandlestickChart, History, LineChart, Newspaper, NotebookText, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PriceChart, type ChartStyle } from '@/components/charts';
import { Change, EmptyState, ParodyLabel, PriceKindBadge, StatBlock, TickerMark, TradingStatus, WatchButton } from '@/components/common';
import { MyTradesTable, OrderBook, OrdersTable, TradeTicket, TradesList } from '@/components/trading';
import { Badge, LineTabsList, LineTabsTrigger, Panel, PanelHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Tip } from '@/components/ui/primitives';
import type { HistoryInterval } from '@/lib/api';
import { bpsOf, dateTime, int, money, pct, signedMoney, timeAgo } from '@/lib/format';
import { useAuthed, useBook, useHistory, useMyTrades, useNews, useOrders, usePortfolio, useSecurity, useTrades } from '@/lib/queries';
import { useTickerRoom } from '@/lib/realtime';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { NotFoundPage } from './NotFound';

const INTERVALS: { id: HistoryInterval; label: string }[] = [
  { id: 'trade', label: 'Tick' },
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '1d', label: '1D' },
];

export default function StockPage() {
  const ticker = (useParams().ticker ?? '').toUpperCase();
  if (!CANONICAL_TICKERS.has(ticker)) return <NotFoundPage />;
  return <StockView key={ticker} ticker={ticker} />;
}

function StockView({ ticker }: { ticker: string }) {
  useTickerRoom([ticker]);
  const sec = useSecurity(ticker);
  const book = useBook(ticker);
  const trades = useTrades(ticker);
  const authed = useAuthed();
  const pf = usePortfolio();
  const [interval, setInterval] = useState<HistoryInterval>('trade');
  const [style, setStyle] = useState<ChartStyle>('line');
  const hist = useHistory(ticker, interval);
  const [picked, setPicked] = useState<{ cents: number; n: number } | null>(null);
  const s = sec.data;
  usePageTitle(s ? `${s.ticker} ${money(s.displayPriceCents, '')}`.trim() : ticker);

  const holding = pf.data?.holdings.find((h) => h.ticker === ticker);
  const refLabel = s?.referencePriceKind === 'SIMULATED' ? 'Ref (SIMULATED)' : 'Reference';
  const lastTrade = trades.data?.[0];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-4">
          <TickerMark ticker={ticker} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-3xl font-bold tracking-tight">{ticker}</h1>
              <WatchButton ticker={ticker} />
              {s && <TradingStatus s={s} size="md" />}
              {s?.symbolHalted && <Badge tone="warn">Symbol halt</Badge>}
            </div>
            {s ? (
              <p className="mt-0.5 text-[15px] text-fg-muted">
                {s.name} <span className="text-fg-subtle">· Original rank #{s.originalRank}</span>
              </p>
            ) : (
              <Skeleton className="mt-1 h-5 w-48" />
            )}
            {s && (
              <Tip content="Fictional sector, for fun only.">
                <span className="mt-1.5 inline-block cursor-help text-xs text-fg-subtle">{s.profile.sector} · fictional</span>
              </Tip>
            )}
          </div>
        </div>
        <div className="md:text-right">
          {s ? (
            <>
              <div className="flex items-center gap-2 md:justify-end">
                <PriceKindBadge kind={s.displayPriceKind} />
              </div>
              <p className="num mt-1 text-4xl font-semibold tracking-tight">{money(s.displayPriceCents, 'No price')}</p>
              {s.lastPriceCents !== null ? (
                <div className="mt-1 flex flex-wrap gap-x-4 text-[13px] md:justify-end">
                  <span>
                    <Change cents={s.change24hCents} bps={s.change24hBps} /> <span className="text-fg-subtle">24h</span>
                  </span>
                  <span>
                    <Change
                      cents={s.referencePriceCents !== null ? s.lastPriceCents - s.referencePriceCents : null}
                      bps={s.changeFromReferenceBps}
                    />{' '}
                    <span className="text-fg-subtle">since listing</span>
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-[13px] text-fg-subtle">{s.displayPriceCents !== null ? 'No executions yet — showing the reference price.' : 'No verified price has been imported.'}</p>
              )}
            </>
          ) : (
            <Skeleton className="h-16 w-56" />
          )}
        </div>
      </div>

      {sec.isError && <EmptyState title="Couldn’t load this security">Please refresh.</EmptyState>}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          {/* Chart */}
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
              <Tabs value={interval} onValueChange={(v) => setInterval(v as HistoryInterval)}>
                <TabsList aria-label="Chart interval">
                  {INTERVALS.map((i) => (
                    <TabsTrigger key={i.id} value={i.id}>
                      {i.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Tabs value={style} onValueChange={(v) => setStyle(v as ChartStyle)}>
                <TabsList aria-label="Chart style">
                  <TabsTrigger value="line" aria-label="Line chart">
                    <LineChart className="size-3.5" /> Line
                  </TabsTrigger>
                  <TabsTrigger value="candles" aria-label="Candlestick chart">
                    <CandlestickChart className="size-3.5" /> Candles
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="px-4 pb-3 pt-3">
              {hist.isLoading || !s ? (
                <Skeleton className="h-[340px]" />
              ) : hist.data && hist.data.points.length > 0 ? (
                <PriceChart points={hist.data.points} style={style} referencePriceCents={s.referencePriceCents} referenceLabel={refLabel} />
              ) : (
                <FlatReference reference={s.referencePriceCents} kind={s.referencePriceKind} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-border px-4 py-3.5 sm:grid-cols-4 lg:grid-cols-8">
              <StatBlock label="Bid" value={<span className="text-up">{money(book.data?.bestBidCents ?? s?.bestBidCents)}</span>} />
              <StatBlock label="Ask" value={<span className="text-down">{money(book.data?.bestAskCents ?? s?.bestAskCents)}</span>} />
              <StatBlock label="Spread" value={money(book.data?.spreadCents)} />
              <StatBlock label="Volume 24h" value={int(s?.volume24h)} />
              <StatBlock label="Trades 24h" value={int(s?.trades24h)} />
              <StatBlock label={refLabel} value={money(s?.referencePriceCents)} />
              <StatBlock label="Shares issued" value={s ? int(s.sharesOutstanding) : '—'} />
              <StatBlock label="Last trade" value={s?.lastTradeAt ? timeAgo(s.lastTradeAt) : '—'} />
            </div>
          </Panel>

          {/* Book + tape */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Order book" subtitle="Live · click a price to use it in a limit order" action={book.data && <span className="num text-[11px] text-fg-subtle">v{book.data.bookVersion}</span>} />
              <div className="pb-3">
                <OrderBook book={book.data} loading={book.isLoading} onPick={(c) => setPicked((p) => ({ cents: c, n: (p?.n ?? 0) + 1 }))} />
              </div>
            </Panel>
            <Panel>
              <Tabs defaultValue="trades">
                <div className="px-4 pt-3">
                  <LineTabsList>
                    <LineTabsTrigger value="trades">Recent trades</LineTabsTrigger>
                    <LineTabsTrigger value="history">Price history</LineTabsTrigger>
                  </LineTabsList>
                </div>
                <TabsContent value="trades" className="max-h-[420px] overflow-y-auto scrollbar-thin">
                  {lastTrade && <p className="px-4 pt-2 text-[11px] text-fg-subtle">Green = buyer initiated · red = seller initiated</p>}
                  <TradesList trades={trades.data} loading={trades.isLoading} />
                </TabsContent>
                <TabsContent value="history" className="max-h-[420px] overflow-y-auto scrollbar-thin">
                  <PriceHistoryTable points={hist.data?.points} loading={hist.isLoading} />
                </TabsContent>
              </Tabs>
            </Panel>
          </div>

          {authed && <MyActivity ticker={ticker} />}

          {/* Profile + news */}
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <Panel className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold">
                  <NotebookText className="size-4 text-fg-subtle" /> Company profile
                </h2>
                <Badge tone="warn">Fictional profile</Badge>
              </div>
              {s ? (
                <>
                  <p className="mt-3 text-lg font-semibold tracking-tight">{s.profile.tagline}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{s.profile.profile}</p>
                  {s.description && <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">{s.description}</p>}
                  {s.background && <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{s.background}</p>}
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-[13px]">
                    <div>
                      <dt className="text-xs text-fg-subtle">Sector (fictional)</dt>
                      <dd className="mt-0.5">{s.profile.sector}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-fg-subtle">Listing status</dt>
                      <dd className="mt-0.5">{s.listingStatus ?? 'Unverified'}</dd>
                    </div>
                    {s.tradingRestriction && (
                      <div className="col-span-2">
                        <dt className="text-xs text-fg-subtle">Original trading restriction</dt>
                        <dd className="mt-0.5">{s.tradingRestriction}</dd>
                      </div>
                    )}
                  </dl>
                  {s.historicalNotes.length > 0 && (
                    <div className="mt-4 rounded-lg border border-border bg-bg-subtle p-3">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                        <History className="size-3.5" /> Historical assignment note
                      </p>
                      {s.historicalNotes.map((n, i) => (
                        <p key={i} className="mt-1.5 text-[13px]">
                          {n.changeBps !== null && <span className={cn('num mr-2 font-semibold', n.changeBps > 0 ? 'text-up' : 'text-down')}>{pct(n.changeBps)}</span>}
                          <span className="text-fg-muted">{n.note ?? 'No note recorded.'}</span>
                        </p>
                      ))}
                      <p className="mt-2 text-[11px] text-fg-subtle">Annotation only — it never moved the price and isn’t a trade.</p>
                    </div>
                  )}
                </>
              ) : (
                <Skeleton className="mt-3 h-32" />
              )}
            </Panel>
            <TickerNews ticker={ticker} />
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4 xl:sticky xl:top-28 xl:self-start">
          <Panel>
            <PanelHeader title={`Trade ${ticker}`} subtitle="Virtual AEZ dollars only" />
            {s ? (
              <TradeTicket
                security={s}
                book={book.data}
                holding={holding}
                availableCashCents={pf.data?.availableCashCents ?? null}
                authed={authed}
                pickedPrice={picked}
              />
            ) : (
              <Skeleton className="m-4 h-80" />
            )}
          </Panel>
          {authed && (
            <Panel>
              <PanelHeader title="Your position" />
              {holding && holding.quantity > 0 ? (
                <div className="grid grid-cols-2 gap-4 px-4 pb-4">
                  <StatBlock label="Shares" value={int(holding.quantity)} sub={holding.reservedQuantity ? `${int(holding.reservedQuantity)} reserved` : undefined} />
                  <StatBlock label="Market value" value={money(holding.marketValueCents)} />
                  <StatBlock label="Avg cost" value={money(Math.round(holding.costBasisCents / holding.quantity))} />
                  <StatBlock
                    label="Unrealized P/L"
                    value={<span className={holding.unrealizedPnlCents > 0 ? 'text-up' : holding.unrealizedPnlCents < 0 ? 'text-down' : ''}>{signedMoney(holding.unrealizedPnlCents)}</span>}
                    sub={pct(bpsOf(holding.unrealizedPnlCents, holding.costBasisCents))}
                  />
                  <StatBlock label="Realized P/L" value={<span className={holding.realizedPnlCents > 0 ? 'text-up' : holding.realizedPnlCents < 0 ? 'text-down' : ''}>{signedMoney(holding.realizedPnlCents)}</span>} />
                  <StatBlock label="Buying power" value={money(pf.data?.availableCashCents)} />
                </div>
              ) : (
                <div className="px-4 pb-4 text-[13px] text-fg-muted">
                  You don’t own {ticker}.{' '}
                  {holding && holding.realizedPnlCents !== 0 && (
                    <>Realized P/L from past trades: <span className={holding.realizedPnlCents > 0 ? 'text-up' : 'text-down'}>{signedMoney(holding.realizedPnlCents)}</span>. </>
                  )}
                  Buying power: <span className="num text-fg">{money(pf.data?.availableCashCents)}</span>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function FlatReference({ reference, kind }: { reference: number | null; kind: 'VERIFIED' | 'SIMULATED' | null }) {
  return (
    <div className="relative flex h-[340px] flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-bg-subtle text-center">
      {reference !== null && (
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-fg-subtle/40" aria-hidden>
          <span className="num absolute -top-3 right-2 rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-fg-muted">{money(reference)}</span>
        </div>
      )}
      <div className="relative rounded-xl bg-bg-subtle/90 px-6 py-4">
        <BarChart2 className="mx-auto size-6 text-fg-subtle" />
        <p className="mt-2 text-sm font-medium">No executions yet</p>
        <p className="mt-1 max-w-sm text-[13px] text-fg-muted">
          {reference !== null
            ? `The dashed line is the ${kind === 'SIMULATED' ? 'SIMULATED (admin-set, not original)' : 'verified'} reference price. The chart starts with the first real trade — no history is invented.`
            : 'No verified reference price has been imported for this brother, so there is nothing to chart.'}
        </p>
      </div>
    </div>
  );
}

function PriceHistoryTable({ points, loading }: { points: import('@/lib/api').HistoryPoint[] | undefined; loading: boolean }) {
  if (loading) return <div className="p-4"><Skeleton className="h-40" /></div>;
  if (!points?.length) return <EmptyState icon={<ScrollText />} title="No price history">History starts with the first execution.</EmptyState>;
  const rows = [...points].reverse().slice(0, 200);
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-fg-subtle">
          <th className="px-4 py-2 font-medium">Time</th>
          {rows[0]!.kind === 'bar' ? (
            <>
              <th className="py-2 text-right font-medium">Open</th>
              <th className="py-2 text-right font-medium">High</th>
              <th className="py-2 text-right font-medium">Low</th>
              <th className="py-2 text-right font-medium">Close</th>
            </>
          ) : (
            <th className="py-2 text-right font-medium">Price</th>
          )}
          <th className="px-4 py-2 text-right font-medium">Volume</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.kind === 'trade' ? p.tradeId : p.at} className="border-b border-border/50">
            <td className="px-4 py-1.5 text-fg-muted">{dateTime(p.at)}</td>
            {p.kind === 'bar' ? (
              <>
                <td className="num py-1.5 text-right">{money(p.openCents)}</td>
                <td className="num py-1.5 text-right">{money(p.highCents)}</td>
                <td className="num py-1.5 text-right">{money(p.lowCents)}</td>
                <td className="num py-1.5 text-right font-medium">{money(p.closeCents)}</td>
                <td className="num px-4 py-1.5 text-right">{int(p.volume)}</td>
              </>
            ) : (
              <>
                <td className="num py-1.5 text-right font-medium">{money(p.priceCents)}</td>
                <td className="num px-4 py-1.5 text-right">{int(p.quantity)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MyActivity({ ticker }: { ticker: string }) {
  const open = useOrders('open', ticker);
  const all = useOrders('all', ticker);
  const trades = useMyTrades();
  const mine = trades.data?.filter((t) => t.ticker === ticker);
  return (
    <Panel>
      <Tabs defaultValue="open">
        <div className="px-4 pt-3">
          <LineTabsList>
            <LineTabsTrigger value="open">
              Open orders {open.data?.length ? <span className="num ml-1 rounded bg-warn-soft px-1 text-[11px] text-warn">{open.data.length}</span> : null}
            </LineTabsTrigger>
            <LineTabsTrigger value="all">Order history</LineTabsTrigger>
            <LineTabsTrigger value="fills">Your fills</LineTabsTrigger>
          </LineTabsList>
        </div>
        <TabsContent value="open">
          <OrdersTable orders={open.data} loading={open.isLoading} showTicker={false} emptyText={`No open ${ticker} orders.`} />
        </TabsContent>
        <TabsContent value="all">
          <OrdersTable orders={all.data} loading={all.isLoading} showTicker={false} emptyText={`You haven’t placed any ${ticker} orders.`} />
        </TabsContent>
        <TabsContent value="fills">
          <MyTradesTable trades={mine} loading={trades.isLoading} showTicker={false} />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

function TickerNews({ ticker }: { ticker: string }) {
  const news = useNews(ticker, 10);
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <Newspaper className="size-4 text-fg-subtle" /> {ticker} news
        </h2>
        <ParodyLabel />
      </div>
      {news.isLoading ? (
        <Skeleton className="mt-4 h-24" />
      ) : news.data?.length ? (
        <ul className="mt-3 divide-y divide-border">
          {news.data.map((p) => (
            <li key={p.id} className="py-3">
              <p className="text-[15px] font-semibold leading-snug">{p.headline}</p>
              {p.body && <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{p.body}</p>}
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                {p.author} · {timeAgo(p.createdAt)} · <span className="text-warn">Parody</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Newspaper />} title="No stories yet" className="py-8">
          The AEZ newsroom hasn’t covered {ticker}. Yet.{' '}
          <Link to="/news" className="text-up hover:underline">
            All news
          </Link>
        </EmptyState>
      )}
    </Panel>
  );
}
