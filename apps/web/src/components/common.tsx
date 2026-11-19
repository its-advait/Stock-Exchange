import type { DisplayPriceKind, OrderStatus, SecurityView } from '@aez/shared';
import { ArrowDownRight, ArrowUpRight, FlaskConical, Newspaper, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { pct, signedMoney, tone } from '@/lib/format';
import { useAuthed, useToggleWatch, useWatchlist } from '@/lib/queries';
import { BLOCK_LABEL } from '@/lib/reasons';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge, Tip } from './ui/primitives';

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--surface-3)" />
        <path d="M7 22.5 13 15l4 4 8-9.5" fill="none" stroke="var(--up)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="25" cy="9.5" r="2.2" fill="var(--up)" />
      </svg>
      {!compact && (
        <span className="leading-none">
          <span className="block text-[13px] font-bold tracking-[0.14em] text-fg">AEZ</span>
          <span className="block text-[9px] font-semibold tracking-[0.22em] text-fg-subtle">STOCK EXCHANGE</span>
        </span>
      )}
    </span>
  );
}

const toneText = { up: 'text-up', down: 'text-down', flat: 'text-fg-muted' } as const;

/** Signed % change with arrow. `bps` null renders an em dash. */
export function Change({ bps, cents, className, showArrow = true }: { bps: number | null | undefined; cents?: number | null; className?: string; showArrow?: boolean }) {
  const t = tone(bps ?? cents);
  const Icon = t === 'down' ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={cn('num inline-flex items-center gap-0.5 font-medium', toneText[t], className)}>
      {showArrow && t !== 'flat' && <Icon className="size-3.5" aria-hidden />}
      {cents !== undefined && cents !== null && <span>{signedMoney(cents)}</span>}
      {cents !== undefined && cents !== null && bps !== null && bps !== undefined && <span className="opacity-60">·</span>}
      {(bps !== null && bps !== undefined) || cents === undefined ? <span>{pct(bps)}</span> : null}
    </span>
  );
}

export function ChangePill({ bps }: { bps: number | null | undefined }) {
  const t = tone(bps);
  return (
    <span
      className={cn(
        'num inline-flex min-w-16 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold',
        t === 'up' ? 'bg-up-soft text-up' : t === 'down' ? 'bg-down-soft text-down' : 'bg-surface-3 text-fg-muted',
      )}
    >
      {pct(bps)}
    </span>
  );
}

export function PriceKindBadge({ kind, className }: { kind: DisplayPriceKind | null; className?: string }) {
  if (!kind) return <Badge tone="outline" className={className}>No price</Badge>;
  if (kind === 'LAST_TRADE') return <Badge tone="up" className={className}>Last trade</Badge>;
  if (kind === 'REFERENCE_VERIFIED') return <Badge tone="info" className={className}>Reference · verified</Badge>;
  return (
    <Tip content="This reference price was set by an admin for testing. It is NOT from the original AEZ document.">
      <Badge tone="warn" className={cn('cursor-help', className)}>
        <FlaskConical className="size-3" /> SIMULATED
      </Badge>
    </Tip>
  );
}

/** Trading status as the backend reports it. */
export function TradingStatus({ s, size = 'sm' }: { s: Pick<SecurityView, 'tradable' | 'tradingBlockReason' | 'listingStatus'>; size?: 'sm' | 'md' }) {
  if (s.tradable)
    return (
      <Badge tone="up" className={size === 'md' ? 'text-xs' : ''}>
        <span className="size-1.5 rounded-full bg-up" /> Trading
      </Badge>
    );
  const r = s.tradingBlockReason ?? 'UNKNOWN';
  const t = r === 'STATUS_UNVERIFIED' || r === 'REFERENCE_PRICE_UNVERIFIED' ? 'neutral' : r === 'SECURITY_SUSPENDED' || r === 'SECURITY_UNLISTED' ? 'down' : 'warn';
  return (
    <Badge tone={t} className={size === 'md' ? 'text-xs' : ''}>
      <span className={cn('size-1.5 rounded-full', t === 'down' ? 'bg-down' : t === 'warn' ? 'bg-warn' : 'bg-fg-subtle')} />
      {BLOCK_LABEL[r] ?? r}
    </Badge>
  );
}

const ORDER_TONE: Record<OrderStatus, 'up' | 'info' | 'warn' | 'neutral' | 'down'> = {
  FILLED: 'up',
  PARTIALLY_FILLED: 'info',
  OPEN: 'warn',
  CANCELLED: 'neutral',
  REJECTED: 'down',
};
const ORDER_LABEL: Record<OrderStatus, string> = {
  FILLED: 'Filled',
  PARTIALLY_FILLED: 'Partially filled',
  OPEN: 'Open · resting',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONE[status]}>{ORDER_LABEL[status]}</Badge>;
}

export function SideText({ side }: { side: 'BUY' | 'SELL' }) {
  return <span className={cn('text-xs font-semibold tracking-wide', side === 'BUY' ? 'text-up' : 'text-down')}>{side}</span>;
}

/** Deterministic monogram avatar for a brother ticker. */
export function TickerMark({ ticker, size = 'md', className }: { ticker: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const dims = { sm: 'h-7 w-7 text-[9px]', md: 'h-9 w-9 text-[10px]', lg: 'h-12 w-12 text-xs', xl: 'h-16 w-16 text-sm' }[size];
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-xl font-mono font-semibold tracking-tight', dims, className)}
      style={{ background: `hsl(${h} 30% 50% / 0.14)`, color: `hsl(${h} 55% 70%)`, boxShadow: `inset 0 0 0 1px hsl(${h} 40% 60% / 0.18)` }}
    >
      {ticker.slice(0, 4)}
    </span>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-3 rounded-xl border border-border bg-surface-2 p-2.5 text-fg-subtle [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[13px] leading-relaxed text-fg-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ParodyLabel({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn', className)}>
      <Newspaper className="size-3" /> Fictional AEZ Market News · Parody
    </span>
  );
}

export function WatchButton({ ticker, className }: { ticker: string; className?: string }) {
  const authed = useAuthed();
  const wl = useWatchlist();
  const m = useToggleWatch();
  const nav = useNavigate();
  const loc = useLocation();
  const watched = !!wl.data?.includes(ticker);
  return (
    <Tip content={authed ? (watched ? 'Remove from watchlist' : 'Add to watchlist') : 'Sign in to use a watchlist'}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(watched && 'text-warn hover:text-warn', className)}
        aria-pressed={watched}
        aria-label={watched ? `Remove ${ticker} from watchlist` : `Add ${ticker} to watchlist`}
        disabled={m.isPending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!authed) return void nav(`/login?next=${encodeURIComponent(loc.pathname)}`);
          m.mutate({ ticker, watched });
        }}
      >
        <Star className={cn(watched && 'fill-current')} />
      </Button>
    </Tip>
  );
}

export function StatBlock({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="num mt-1 truncate text-[15px] font-semibold text-fg">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-fg-muted">{sub}</div>}
    </div>
  );
}

export function SecurityLink({ ticker, name, className }: { ticker: string; name?: string; className?: string }) {
  return (
    <Link to={`/stocks/${ticker}`} className={cn('group inline-flex min-w-0 items-center gap-2.5', className)}>
      <TickerMark ticker={ticker} size="sm" />
      <span className="min-w-0">
        <span className="block font-mono text-[13px] font-semibold text-fg group-hover:text-up">{ticker}</span>
        {name && <span className="block truncate text-xs text-fg-muted">{name}</span>}
      </span>
    </Link>
  );
}
