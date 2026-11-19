import { STOCK_UNIVERSE } from '@aez/shared';
import { Newspaper } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ParodyLabel, TickerMark } from '@/components/common';
import { NativeSelect, Panel, Skeleton } from '@/components/ui/primitives';
import { money, timeAgo } from '@/lib/format';
import { useNews, useSecurities } from '@/lib/queries';
import { usePageTitle } from '@/lib/theme';

export default function NewsPage() {
  usePageTitle('Fictional AEZ Market News');
  const [params, setParams] = useSearchParams();
  const ticker = params.get('ticker') ?? undefined;
  const news = useNews(ticker, 50);
  const secs = useSecurities();
  const [lead, ...rest] = news.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <ParodyLabel />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">AEZ Market News</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            Satirical, fictional coverage of the brothers’ “companies”. None of this is real reporting, none of it is a claim about anyone’s actual
            life, and none of it moves prices — only trades do.
          </p>
        </div>
        <div className="w-56">
          <NativeSelect
            aria-label="Filter by brother"
            value={ticker ?? ''}
            onChange={(e) => setParams(e.target.value ? { ticker: e.target.value } : {}, { replace: true })}
          >
            <option value="">All brothers</option>
            {STOCK_UNIVERSE.map((s) => (
              <option key={s.ticker} value={s.ticker}>
                {s.ticker} · {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {news.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : !lead ? (
        <Panel>
          <EmptyState icon={<Newspaper />} title="No stories here yet">
            The AEZ newsroom hasn’t covered {ticker ?? 'anyone'} yet.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel className="p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
              <span className="rounded bg-warn-soft px-1.5 py-0.5 font-semibold uppercase tracking-wider text-warn">Parody</span>
              {lead.ticker && <StockChip ticker={lead.ticker} price={secs.data?.find((s) => s.ticker === lead.ticker)?.displayPriceCents ?? null} />}
              <span>{lead.author} · {timeAgo(lead.createdAt)}</span>
            </div>
            <h2 className="mt-3 max-w-3xl text-balance text-3xl font-bold leading-tight tracking-tight">{lead.headline}</h2>
            {lead.body && <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-fg-muted">{lead.body}</p>}
          </Panel>
          <div className="grid gap-4 md:grid-cols-2">
            {rest.map((p) => (
              <Panel key={p.id} className="p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn">Parody</span>
                  {p.ticker && <StockChip ticker={p.ticker} price={secs.data?.find((s) => s.ticker === p.ticker)?.displayPriceCents ?? null} />}
                  <span>{timeAgo(p.createdAt)}</span>
                </div>
                <h3 className="mt-2.5 text-[17px] font-semibold leading-snug">{p.headline}</h3>
                {p.body && <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{p.body}</p>}
                <p className="mt-3 text-[11px] text-fg-subtle">{p.author} · {p.label}</p>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StockChip({ ticker, price }: { ticker: string; price: number | null }) {
  return (
    <Link to={`/stocks/${ticker}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 hover:border-border-strong">
      <TickerMark ticker={ticker} size="sm" className="!h-4 !w-4 !rounded !text-[0px]" />
      <span className="font-mono font-semibold text-fg">{ticker}</span>
      {price !== null && <span className="num text-fg-muted">{money(price)}</span>}
    </Link>
  );
}
