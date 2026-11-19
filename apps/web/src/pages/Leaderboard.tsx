import type { ActivityRow, BigTradeRow, LeaderRow } from '@aez/shared';
import { Crown, Flame, Info, Skull, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { ChangePill, EmptyState } from '@/components/common';
import { TableSkeleton } from '@/components/trading';
import { Button } from '@/components/ui/button';
import { LineTabsList, LineTabsTrigger, Panel, Skeleton, Tabs, TabsContent } from '@/components/ui/primitives';
import { compactMoney, dateTime, int, money, pct, signedMoney } from '@/lib/format';
import { useBoards, useLeaderboard, useMe } from '@/lib/queries';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';

const pnl = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-fg-muted');

export default function LeaderboardPage() {
  usePageTitle('Leaderboard');
  const b = useBoards();
  const full = useLeaderboard(200);
  const me = useMe();
  const d = b.data;
  const top = d?.topTrader;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="text-sm text-fg-muted">Ranked by total portfolio equity (cash + holdings at the last trade). Bragging rights only — no prizes, no real money.</p>
      </div>

      {/* Top trader */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel className="relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -right-8 -top-10 text-warn/[0.06]" aria-hidden>
            <Crown className="size-56" />
          </div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-warn">
            <Crown className="size-3.5" /> Top Trader
          </p>
          {b.isLoading ? (
            <Skeleton className="mt-4 h-20 w-72" />
          ) : top ? (
            <div className="relative mt-4">
              <Link to={`/traders/${top.username}`} className="text-3xl font-bold tracking-tight hover:text-up">
                {top.username}
              </Link>
              <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-fg-subtle">Total equity</p>
                  <p className="num text-3xl font-semibold">{money(top.totalValueCents)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-fg-subtle">Profit</p>
                  <p className={cn('num text-xl font-semibold', pnl(top.pnlCents))}>{signedMoney(top.pnlCents)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-fg-subtle">Return</p>
                  <p className={cn('num text-xl font-semibold', pnl(top.returnBps))}>{pct(top.returnBps)}</p>
                </div>
              </div>
              <p className="mt-4 text-[13px] text-fg-muted">
                {top.pnlCents > 0
                  ? 'Currently the brother with the most conviction and, apparently, the best judgment.'
                  : 'Leading the pack. Nobody has made money yet, so this is mostly alphabetical courage.'}
              </p>
            </div>
          ) : (
            <EmptyState icon={<Trophy />} title="The throne is empty" action={<Button variant="primary" size="sm" asChild><Link to="/register">Claim it</Link></Button>} />
          )}
        </Panel>
        <Panel className="grid grid-cols-2 gap-px overflow-hidden bg-border p-0">
          <MiniStat label="Ranked traders" value={d ? int(d.rankedUsers) : null} />
          <MiniStat label="Starting cash" value={d ? money(d.startingCashCents) : null} />
          <MiniStat
            label="Biggest win"
            value={d ? (d.biggestWins[0] ? <span className="text-up">{signedMoney(d.biggestWins[0].realizedPnlCents)}</span> : '—') : null}
            sub={d?.biggestWins[0] ? `${d.biggestWins[0].username} · ${d.biggestWins[0].ticker}` : undefined}
          />
          <MiniStat
            label="Most active"
            value={d ? (d.mostActive[0] ? `${int(d.mostActive[0].trades)} trades` : '—') : null}
            sub={d?.mostActive[0]?.username}
          />
        </Panel>
      </div>

      <Panel>
        <Tabs defaultValue="richest">
          <div className="px-4 pt-3">
            <LineTabsList>
              <LineTabsTrigger value="richest"><span className="inline-flex items-center gap-1.5"><Trophy className="size-3.5" />Richest</span></LineTabsTrigger>
              <LineTabsTrigger value="poorest"><span className="inline-flex items-center gap-1.5"><Skull className="size-3.5" />Poorest</span></LineTabsTrigger>
              <LineTabsTrigger value="profit">Highest profit</LineTabsTrigger>
              <LineTabsTrigger value="return">Highest return</LineTabsTrigger>
              <LineTabsTrigger value="active"><span className="inline-flex items-center gap-1.5"><Flame className="size-3.5" />Most active</span></LineTabsTrigger>
              <LineTabsTrigger value="wins"><span className="inline-flex items-center gap-1.5"><TrendingUp className="size-3.5" />Largest win</span></LineTabsTrigger>
              <LineTabsTrigger value="losses"><span className="inline-flex items-center gap-1.5"><TrendingDown className="size-3.5" />Largest loss</span></LineTabsTrigger>
              <LineTabsTrigger value="all">Full ranking</LineTabsTrigger>
            </LineTabsList>
          </div>
          {b.isLoading ? (
            <TableSkeleton />
          ) : (
            <>
              <TabsContent value="richest"><EquityTable rows={d?.richest} meId={me.data?.id} /></TabsContent>
              <TabsContent value="poorest">
                <Note>The other end of the order book. Ranked by lowest total equity.</Note>
                <EquityTable rows={d?.poorest} meId={me.data?.id} />
              </TabsContent>
              <TabsContent value="profit"><EquityTable rows={d?.highestProfit} meId={me.data?.id} emphasize="pnl" /></TabsContent>
              <TabsContent value="return">
                <Note>Everyone starts with the same {money(d?.startingCashCents)}, so % return ranks identically to absolute profit.</Note>
                <EquityTable rows={d?.highestReturn} meId={me.data?.id} emphasize="return" />
              </TabsContent>
              <TabsContent value="active"><ActivityTable rows={d?.mostActive} meId={me.data?.id} /></TabsContent>
              <TabsContent value="wins">
                <Note>Single sell executions ranked by realized P/L versus the seller’s average cost — recorded by the exchange at execution time.</Note>
                <BigTradeTable rows={d?.biggestWins} />
              </TabsContent>
              <TabsContent value="losses">
                <Note>Single sell executions with the largest realized loss versus average cost.</Note>
                <BigTradeTable rows={d?.biggestLosses} />
              </TabsContent>
              <TabsContent value="all">
                {full.isLoading ? (
                  <TableSkeleton />
                ) : (
                  <EquityTable
                    meId={me.data?.id}
                    rows={full.data?.map((e) => ({
                      rank: e.rank,
                      userId: e.userId,
                      username: e.username,
                      totalValueCents: e.totalValueCents,
                      pnlCents: e.pnlCents,
                      returnBps: d?.startingCashCents ? Number((BigInt(e.pnlCents) * 10000n) / BigInt(d.startingCashCents)) : 0,
                    }))}
                  />
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      </Panel>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-4 pt-3 text-xs text-fg-subtle">
      <Info className="size-3.5" /> {children}
    </p>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: React.ReactNode | null; sub?: string }) {
  return (
    <div className="bg-surface p-5">
      <p className="text-[11px] uppercase tracking-wider text-fg-subtle">{label}</p>
      {value === null ? <Skeleton className="mt-2 h-6 w-24" /> : <p className="num mt-1.5 text-xl font-semibold">{value}</p>}
      {sub && <p className="mt-0.5 truncate text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}

function EquityTable({ rows, meId, emphasize }: { rows: LeaderRow[] | undefined; meId?: string; emphasize?: 'pnl' | 'return' }) {
  if (!rows?.length) return <EmptyState icon={<Trophy />} title="No ranked traders yet" />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="w-16 px-4 py-2 font-medium">Rank</th>
            <th className="py-2 font-medium">Trader</th>
            <th className="py-2 text-right font-medium">Total equity</th>
            <th className="py-2 text-right font-medium">Profit</th>
            <th className="px-4 py-2 text-right font-medium">Return</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className={cn('border-b border-border/60 last:border-0 hover:bg-surface-2/50', r.userId === meId && 'bg-up-soft/40')}>
              <td className="px-4 py-2.5">
                <RankBadge rank={r.rank} />
              </td>
              <td className="py-2.5">
                <Link to={`/traders/${r.username}`} className="font-medium hover:text-up">
                  {r.username}
                </Link>
                {r.userId === meId && <span className="ml-1.5 text-[11px] text-up">you</span>}
              </td>
              <td className={cn('num py-2.5 text-right', !emphasize && 'font-semibold')}>{money(r.totalValueCents)}</td>
              <td className={cn('num py-2.5 text-right', pnl(r.pnlCents), emphasize === 'pnl' && 'font-semibold')}>{signedMoney(r.pnlCents)}</td>
              <td className="px-4 py-2.5 text-right">
                <ChangePill bps={r.returnBps} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'bg-warn-soft text-warn' : rank === 2 ? 'bg-surface-3 text-fg' : rank === 3 ? 'bg-[#cd7f32]/15 text-[#e0a36b]' : 'text-fg-subtle';
  return <span className={cn('num inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-bold', cls)}>#{rank}</span>;
}

function ActivityTable({ rows, meId }: { rows: ActivityRow[] | undefined; meId?: string }) {
  if (!rows?.length) return <EmptyState icon={<Flame />} title="No trades yet" />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="w-16 px-4 py-2 font-medium">#</th>
            <th className="py-2 font-medium">Trader</th>
            <th className="py-2 text-right font-medium">Executions</th>
            <th className="py-2 text-right font-medium">Shares traded</th>
            <th className="px-4 py-2 text-right font-medium">Notional</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.userId} className={cn('border-b border-border/60 last:border-0', r.userId === meId && 'bg-up-soft/40')}>
              <td className="px-4 py-2.5"><RankBadge rank={i + 1} /></td>
              <td className="py-2.5"><Link to={`/traders/${r.username}`} className="font-medium hover:text-up">{r.username}</Link></td>
              <td className="num py-2.5 text-right font-semibold">{int(r.trades)}</td>
              <td className="num py-2.5 text-right">{int(r.sharesTraded)}</td>
              <td className="num px-4 py-2.5 text-right">{compactMoney(r.notionalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BigTradeTable({ rows }: { rows: BigTradeRow[] | undefined }) {
  if (!rows?.length) return <EmptyState icon={<TrendingUp />} title="Nothing here yet">Realized gains and losses appear when traders sell shares.</EmptyState>;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="w-16 px-4 py-2 font-medium">#</th>
            <th className="py-2 font-medium">Trader</th>
            <th className="py-2 font-medium">Security</th>
            <th className="py-2 text-right font-medium">Sold</th>
            <th className="py-2 text-right font-medium">Realized P/L</th>
            <th className="px-4 py-2 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.tradeId} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2.5"><RankBadge rank={i + 1} /></td>
              <td className="py-2.5"><Link to={`/traders/${r.username}`} className="font-medium hover:text-up">{r.username}</Link></td>
              <td className="py-2.5"><Link to={`/stocks/${r.ticker}`} className="font-mono font-semibold hover:text-up">{r.ticker}</Link></td>
              <td className="num py-2.5 text-right">{int(r.quantity)} @ {money(r.priceCents)}</td>
              <td className={cn('num py-2.5 text-right font-semibold', pnl(r.realizedPnlCents))}>{signedMoney(r.realizedPnlCents)}</td>
              <td className="px-4 py-2.5 text-right text-fg-muted">{dateTime(r.executedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
