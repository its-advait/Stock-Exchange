import type { HoldingView, MyTradeView, OrderBookView, OrderView, PlaceOrderRequest, PlaceOrderResponse, SecurityDetailView, TradeView } from '@aez/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownUp, CheckCircle2, Clock3, Info, Loader2, Lock, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { centsToInput, clock, int, money, parseMoneyInput, timeAgo } from '@/lib/format';
import { estimateFill, maxAffordable, newIdempotencyKey } from '@/lib/orderMath';
import { qk, useCancelOrder, useOrders } from '@/lib/queries';
import { API_ERRORS, cancelMessage, rejectMessage, REJECT_REASONS } from '@/lib/reasons';
import { cn } from '@/lib/utils';
import { EmptyState, OrderStatusBadge, SideText } from './common';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/dialog';
import { Input, Label, Skeleton } from './ui/primitives';

/* =============================== Order book =============================== */

export function OrderBook({ book, loading, onPick, rows = 10 }: { book: OrderBookView | undefined; loading?: boolean; onPick?: (priceCents: number) => void; rows?: number }) {
  const prev = useRef<OrderBookView | undefined>(undefined);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!book) return;
    const p = prev.current;
    if (p && p.bookVersion !== book.bookVersion) {
      const key = (side: string, l: { priceCents: number; quantity: number }) => `${side}${l.priceCents}:${l.quantity}`;
      const old = new Set([...p.bids.map((l) => key('b', l)), ...p.asks.map((l) => key('a', l))]);
      const s = new Set<string>();
      for (const l of book.bids) if (!old.has(key('b', l))) s.add(`b${l.priceCents}`);
      for (const l of book.asks) if (!old.has(key('a', l))) s.add(`a${l.priceCents}`);
      setChanged(s);
      const t = setTimeout(() => setChanged(new Set()), 1100);
      prev.current = book;
      return () => clearTimeout(t);
    }
    prev.current = book;
  }, [book]);

  if (loading || !book)
    return (
      <div className="space-y-1.5 p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
    );
  const asks = book.asks.slice(0, rows);
  const bids = book.bids.slice(0, rows);
  const maxQ = Math.max(1, ...asks.map((l) => l.quantity), ...bids.map((l) => l.quantity));
  const Row = ({ l, side }: { l: { priceCents: number; quantity: number; orders: number }; side: 'a' | 'b' }) => (
    <button
      type="button"
      onClick={() => onPick?.(l.priceCents)}
      className={cn(
        'relative grid w-full grid-cols-3 px-4 py-[3px] text-right text-xs num hover:bg-surface-2 focus-visible:bg-surface-2',
        changed.has(`${side}${l.priceCents}`) && (side === 'a' ? 'flash-down' : 'flash-up'),
      )}
      title={onPick ? 'Use this price for a limit order' : undefined}
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-0 right-0', side === 'a' ? 'bg-down-soft' : 'bg-up-soft')}
        style={{ width: `${(l.quantity / maxQ) * 100}%` }}
      />
      <span className={cn('relative text-left font-medium', side === 'a' ? 'text-down' : 'text-up')}>{money(l.priceCents)}</span>
      <span className="relative text-fg">{int(l.quantity)}</span>
      <span className="relative text-fg-subtle">{l.orders}</span>
    </button>
  );
  const empty = asks.length === 0 && bids.length === 0;
  return (
    <div>
      <div className="grid grid-cols-3 px-4 pb-1.5 text-right text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        <span className="text-left">Price</span>
        <span>Shares</span>
        <span>Orders</span>
      </div>
      {empty ? (
        <EmptyState icon={<ArrowDownUp />} title="The book is empty" className="py-8">
          No resting orders. A limit order placed now would be first in line.
        </EmptyState>
      ) : (
        <>
          <div className="flex min-h-[40px] flex-col justify-end">
            {[...asks].reverse().map((l) => (
              <Row key={`a${l.priceCents}`} l={l} side="a" />
            ))}
            {asks.length === 0 && <p className="px-4 py-2 text-xs text-fg-subtle">No asks</p>}
          </div>
          <div className="my-1 flex items-center justify-between border-y border-border bg-bg-subtle px-4 py-1.5 text-xs">
            <span className="text-fg-subtle">Spread</span>
            <span className="num font-medium text-fg">{book.spreadCents !== null ? money(book.spreadCents) : '—'}</span>
          </div>
          <div>
            {bids.map((l) => (
              <Row key={`b${l.priceCents}`} l={l} side="b" />
            ))}
            {bids.length === 0 && <p className="px-4 py-2 text-xs text-fg-subtle">No bids</p>}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================== Trade ticket ============================== */

type Side = 'BUY' | 'SELL';
type Kind = 'MARKET' | 'LIMIT';

interface Result {
  response?: PlaceOrderResponse;
  rejected?: OrderView;
  error?: string;
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; className?: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 rounded-md text-[13px] font-semibold transition-colors',
            value === o.value ? (o.className ?? 'bg-surface-3 text-fg shadow-sm') : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TradeTicket({
  security,
  book,
  holding,
  availableCashCents,
  authed,
  pickedPrice,
}: {
  security: SecurityDetailView;
  book: OrderBookView | undefined;
  holding: HoldingView | undefined;
  availableCashCents: number | null;
  authed: boolean;
  pickedPrice?: { cents: number; n: number } | null;
}) {
  const qc = useQueryClient();
  const loc = useLocation();
  const [side, setSide] = useState<Side>('BUY');
  const [kind, setKind] = useState<Kind>('MARKET');
  const [qtyStr, setQtyStr] = useState('');
  const [limitStr, setLimitStr] = useState('');
  const [capStr, setCapStr] = useState('');
  const [capTouched, setCapTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const keyRef = useRef<string | null>(null);
  const tickerOrders = useOrders('all', security.ticker);

  useEffect(() => {
    if (pickedPrice) {
      setKind('LIMIT');
      setLimitStr(centsToInput(pickedPrice.cents));
    }
  }, [pickedPrice]);

  const qty = /^\d{1,7}$/.test(qtyStr.trim()) ? Number(qtyStr.trim()) : null;
  const limit = parseMoneyInput(limitStr);
  const availableShares = holding?.availableQuantity ?? 0;

  const est = useMemo(
    () => (qty ? estimateFill(side, qty, book, { limitPriceCents: kind === 'LIMIT' ? limit : null }) : null),
    [qty, side, book, kind, limit],
  );

  // Market-buy budget: default to the exact cost of the visible asks; editable.
  useEffect(() => {
    if (!capTouched && kind === 'MARKET' && side === 'BUY') setCapStr(est && est.notionalCents > 0 ? centsToInput(est.notionalCents) : '');
  }, [est, capTouched, kind, side]);
  const cap = parseMoneyInput(capStr);
  const capEst = useMemo(
    () => (qty && kind === 'MARKET' && side === 'BUY' && cap ? estimateFill('BUY', qty, book, { maxSpendCents: cap }) : null),
    [qty, kind, side, cap, book],
  );

  const issues: string[] = [];
  if (qtyStr && !qty) issues.push('Enter a whole number of shares.');
  if (qty !== null && qty < 1) issues.push('Quantity must be at least 1 share.');
  if (kind === 'LIMIT' && limitStr && limit === null) issues.push('Enter a limit price like 12.50.');
  if (kind === 'LIMIT' && limit === 0) issues.push('Limit price must be above $0.00.');
  if (kind === 'MARKET' && side === 'BUY' && capStr && !cap) issues.push('Enter a valid spending cap.');
  const cost = side === 'BUY' ? (kind === 'LIMIT' ? (qty && limit ? qty * limit : null) : cap) : null;
  if (authed && side === 'BUY' && cost !== null && availableCashCents !== null && cost > availableCashCents)
    issues.push(`This needs ${money(cost)} but your buying power is ${money(availableCashCents)}.`);
  if (authed && side === 'SELL' && qty && qty > availableShares)
    issues.push(availableShares === 0 ? `You have no available ${security.ticker} shares to sell. Short selling is disabled.` : `You only have ${int(availableShares)} available shares.`);

  const ready = authed && security.tradable && !!qty && (kind === 'MARKET' ? (side === 'SELL' ? true : !!cap) : !!limit) && issues.length === 0;

  const body: PlaceOrderRequest | null = ready
    ? kind === 'LIMIT'
      ? { ticker: security.ticker, side, type: 'LIMIT', quantity: qty!, limitPriceCents: limit! }
      : side === 'BUY'
        ? { ticker: security.ticker, side, type: 'MARKET', quantity: qty!, maxSpendCents: cap! }
        : { ticker: security.ticker, side, type: 'MARKET', quantity: qty! }
    : null;

  const submit = useMutation({
    mutationFn: async (b: PlaceOrderRequest) => {
      const key = keyRef.current!;
      try {
        return await api.placeOrder(b, key);
      } catch (e) {
        // One safe retry on a network failure: same Idempotency-Key, so it can never double-execute.
        if (e instanceof ApiError && e.status === 0) return api.placeOrder(b, key);
        throw e;
      }
    },
    onSuccess: (r) => {
      setResult({ response: r });
      setConfirm(false);
      const o = r.order;
      const avg = o.averageFillPriceCents !== null ? ` @ avg ${money(o.averageFillPriceCents)}` : '';
      if (o.status === 'FILLED') toast.success(`${o.side === 'BUY' ? 'Bought' : 'Sold'} ${int(o.filledQuantity)} ${o.ticker}${avg}`, { description: 'Order filled — confirmed by the exchange.' });
      else if (o.status === 'PARTIALLY_FILLED') toast.success(`Partially filled: ${int(o.filledQuantity)}/${int(o.quantity)} ${o.ticker}${avg}`, { description: `${int(o.remainingQuantity)} shares resting on the book.` });
      else if (o.status === 'OPEN') toast(`Limit order resting on the book`, { description: `${o.side} ${int(o.quantity)} ${o.ticker} @ ${money(o.limitPriceCents)} — not filled yet.` });
      else if (o.status === 'CANCELLED')
        toast.warning(o.filledQuantity > 0 ? `Filled ${int(o.filledQuantity)} of ${int(o.quantity)} ${o.ticker}` : `Order not filled`, { description: cancelMessage(o.cancelReason) });
      setQtyStr('');
      setCapTouched(false);
    },
    onError: (e) => {
      setConfirm(false);
      if (e instanceof ApiError && e.status === 422) {
        const o = (e.body as { order?: OrderView } | undefined)?.order;
        setResult({ rejected: o, error: rejectMessage(o?.rejectReason) });
        toast.error('Order rejected', { description: rejectMessage(o?.rejectReason) });
      } else {
        const m = errorMessage(e, { ...API_ERRORS, ...REJECT_REASONS });
        setResult({ error: m });
        toast.error('Order not placed', { description: m });
      }
    },
    onSettled: () => {
      keyRef.current = null;
      void qc.invalidateQueries({ queryKey: ['account'] });
      void qc.invalidateQueries({ queryKey: qk.book(security.ticker) });
      void qc.invalidateQueries({ queryKey: qk.trades(security.ticker) });
      void qc.invalidateQueries({ queryKey: qk.security(security.ticker) });
    },
  });

  const openConfirm = () => {
    if (!body) return;
    keyRef.current = newIdempotencyKey(); // one key per user action; reused if the request is retried
    setResult(null);
    setConfirm(true);
  };

  const setMax = () => {
    if (side === 'SELL') setQtyStr(String(availableShares));
    else if (availableCashCents !== null) {
      if (kind === 'LIMIT' && limit) setQtyStr(String(Math.floor(availableCashCents / limit)));
      else if (book) setQtyStr(String(maxAffordable(book.asks, availableCashCents)));
    }
  };

  const isBuy = side === 'BUY';
  const disabledReason = !security.tradable ? rejectMessage(security.tradingBlockReason) : null;

  return (
    <div className="p-4">
      <Segmented
        label="Order side"
        value={side}
        onChange={(v) => {
          setSide(v);
          setResult(null);
        }}
        options={[
          { value: 'BUY', label: 'Buy', className: 'bg-up text-[#04140b]' },
          { value: 'SELL', label: 'Sell', className: 'bg-down text-white' },
        ]}
      />
      <div className="mt-3">
        <Segmented
          label="Order type"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setResult(null);
          }}
          options={[
            { value: 'MARKET', label: 'Market' },
            { value: 'LIMIT', label: 'Limit' },
          ]}
        />
      </div>

      {disabledReason && (
        <div className="mt-4 flex gap-2.5 rounded-lg border border-warn/30 bg-warn-soft p-3 text-[13px] text-warn">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Trading unavailable</p>
            <p className="mt-0.5 text-warn/90">{disabledReason}</p>
            {security.tradingRestriction && <p className="mt-1 text-warn/80">Original restriction: {security.tradingRestriction}</p>}
          </div>
        </div>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          openConfirm();
        }}
      >
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="qty">Shares</Label>
            {authed && (
              <button type="button" className="text-[11px] font-medium text-up hover:underline disabled:opacity-40" onClick={setMax} disabled={!security.tradable}>
                Max
              </button>
            )}
          </div>
          <Input
            id="qty"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            className="num mt-1.5 text-right text-base"
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value.replace(/[^\d]/g, '').slice(0, 7))}
            disabled={!security.tradable}
            aria-invalid={!!qtyStr && !qty}
          />
        </div>
        {kind === 'LIMIT' && (
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="limit">Limit price</Label>
              {book && (isBuy ? book.bestAskCents : book.bestBidCents) !== null && (
                <button
                  type="button"
                  className="text-[11px] font-medium text-fg-muted hover:text-fg"
                  onClick={() => setLimitStr(centsToInput((isBuy ? book.bestAskCents : book.bestBidCents)!))}
                >
                  Use best {isBuy ? 'ask' : 'bid'} {money(isBuy ? book.bestAskCents : book.bestBidCents)}
                </button>
              )}
            </div>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">$</span>
              <Input
                id="limit"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="num pl-7 text-right text-base"
                value={limitStr}
                onChange={(e) => setLimitStr(e.target.value.replace(/[^\d.]/g, '').slice(0, 10))}
                disabled={!security.tradable}
                aria-invalid={!!limitStr && limit === null}
              />
            </div>
          </div>
        )}
        {kind === 'MARKET' && isBuy && (
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="cap">Spending cap</Label>
              <span className="text-[11px] text-fg-subtle">Required for market buys</span>
            </div>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">$</span>
              <Input
                id="cap"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="num pl-7 text-right"
                value={capStr}
                onChange={(e) => {
                  setCapTouched(true);
                  setCapStr(e.target.value.replace(/[^\d.]/g, '').slice(0, 12));
                }}
                disabled={!security.tradable}
              />
            </div>
          </div>
        )}

        {/* Estimate */}
        <div className="rounded-lg border border-border bg-bg-subtle p-3 text-[13px]">
          <EstimateRows
            side={side}
            kind={kind}
            qty={qty}
            limit={limit}
            est={kind === 'MARKET' && isBuy ? capEst ?? est : est}
            cap={cap}
            availableCashCents={availableCashCents}
            availableShares={availableShares}
            authed={authed}
          />
        </div>

        {issues.length > 0 && (
          <ul className="space-y-1 text-[12px] text-down" role="alert">
            {issues.map((i) => (
              <li key={i} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {i}
              </li>
            ))}
          </ul>
        )}

        {authed ? (
          <Button type="submit" variant={isBuy ? 'primary' : 'sell'} size="lg" className="w-full" disabled={!ready || submit.isPending}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : null}
            Review {isBuy ? 'buy' : 'sell'} order
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`}>Sign in to trade</Link>
          </Button>
        )}
      </form>

      {result && (
        <OrderResult
          result={result}
          live={result.response ? tickerOrders.data?.find((o) => o.id === result.response!.order.id) : undefined}
          onDismiss={() => setResult(null)}
        />
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !submit.isPending && setConfirm(o)}
        title={`Confirm ${kind.toLowerCase()} ${side.toLowerCase()} · ${security.ticker}`}
        description={
          kind === 'MARKET'
            ? 'Market orders execute immediately against resting orders, at their prices. Any unfilled remainder is cancelled — market orders never rest on the book.'
            : 'Any part that can match executes immediately at resting prices. The rest waits on the book, and its funds or shares stay reserved until it fills or you cancel it.'
        }
        confirmLabel={submit.isPending ? 'Submitting…' : `Place ${side.toLowerCase()} order`}
        tone={isBuy ? 'primary' : 'sell'}
        busy={submit.isPending}
        onConfirm={() => body && submit.mutate(body)}
      >
        {body && (
          <dl className="space-y-1.5 rounded-lg border border-border bg-bg-subtle p-3 text-[13px] num">
            <Row k="Security" v={`${security.ticker} · ${security.name}`} />
            <Row k="Side / type" v={`${side} · ${kind}`} />
            <Row k="Shares" v={int(body.quantity)} />
            {body.limitPriceCents !== undefined && <Row k="Limit price" v={money(body.limitPriceCents)} />}
            {body.maxSpendCents !== undefined && <Row k="Spending cap" v={money(body.maxSpendCents)} />}
            {est && est.fillableQty > 0 && <Row k="Executes now (est.)" v={`${int(est.fillableQty)} @ ~${money(est.avgPriceCents)}`} />}
            {kind === 'LIMIT' && est && est.shortfallQty > 0 && <Row k="Rests on book (est.)" v={`${int(est.shortfallQty)} shares`} />}
          </dl>
        )}
        <p className="mt-2 text-[11px] text-fg-subtle">Estimates come from the current book and can change. The exchange’s confirmation is final. Virtual money only.</p>
      </ConfirmDialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="text-right font-medium text-fg">{v}</dd>
    </div>
  );
}

function EstimateRows({
  side,
  kind,
  qty,
  limit,
  est,
  cap,
  availableCashCents,
  availableShares,
  authed,
}: {
  side: Side;
  kind: Kind;
  qty: number | null;
  limit: number | null;
  est: ReturnType<typeof estimateFill> | null;
  cap: number | null;
  availableCashCents: number | null;
  availableShares: number;
  authed: boolean;
}) {
  const isBuy = side === 'BUY';
  const lines: [string, React.ReactNode, string?][] = [];
  if (authed) lines.push(isBuy ? ['Buying power', money(availableCashCents)] : ['Available shares', int(availableShares)]);
  if (kind === 'LIMIT') {
    const total = qty && limit ? qty * limit : null;
    lines.push([isBuy ? 'Max cost (reserved)' : 'Min proceeds', money(total)]);
    if (est && qty) {
      if (est.fillableQty > 0) lines.push(['Executes immediately', `${int(est.fillableQty)} @ ~${money(est.avgPriceCents)}`, 'text-up']);
      if (est.shortfallQty > 0) lines.push(['Rests on the book', `${int(est.shortfallQty)} @ ${money(limit)}`, 'text-warn']);
    }
  } else {
    if (est && qty) {
      lines.push([isBuy ? 'Estimated cost' : 'Estimated proceeds', money(est.notionalCents)]);
      lines.push(['Avg / worst price', est.avgPriceCents ? `${money(est.avgPriceCents)} / ${money(est.worstPriceCents)}` : '—']);
      if (est.shortfallQty > 0)
        lines.push([
          'Not fillable now',
          `${int(est.shortfallQty)} shares`,
          'text-warn',
        ]);
    } else lines.push([isBuy ? 'Estimated cost' : 'Estimated proceeds', '—']);
    if (isBuy && cap) lines.push(['Spending cap', money(cap)]);
  }
  return (
    <dl className="space-y-1.5">
      {lines.map(([k, v, cls]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-fg-muted">{k}</dt>
          <dd className={cn('num text-right font-medium text-fg', cls)}>{v}</dd>
        </div>
      ))}
      {kind === 'MARKET' && est && qty && est.shortfallQty > 0 && (
        <p className="flex gap-1.5 pt-1 text-[11px] text-warn">
          <Info className="mt-px size-3 shrink-0" />
          {est.fillableQty === 0
            ? `No ${isBuy ? 'sellers' : 'buyers'} on the book right now — a market order would be cancelled unfilled. Try a limit order.`
            : `Only ${int(est.fillableQty)} shares of ${isBuy ? 'ask' : 'bid'} liquidity are visible; the rest would be cancelled.`}
        </p>
      )}
    </dl>
  );
}

/** Shows the exchange's response, then follows the order's live status (fills/cancels after submission). */
function OrderResult({ result, live, onDismiss }: { result: Result; live?: OrderView; onDismiss: () => void }) {
  const submitted = result.response?.order;
  const o = live && submitted && live.updatedAt >= submitted.updatedAt ? live : (submitted ?? result.rejected);
  const status = o?.status;
  const Icon = status === 'FILLED' ? CheckCircle2 : status === 'PARTIALLY_FILLED' || status === 'OPEN' ? Clock3 : XCircle;
  const toneCls =
    status === 'FILLED'
      ? 'border-up/30 bg-up-soft'
      : status === 'PARTIALLY_FILLED' || status === 'OPEN'
        ? 'border-info/30 bg-info-soft'
        : status === 'CANCELLED' && (o?.filledQuantity ?? 0) > 0
          ? 'border-warn/30 bg-warn-soft'
          : 'border-down/30 bg-down-soft';
  let headline = result.error ?? '';
  let detail: string | null = null;
  if (o) {
    if (status === 'FILLED') headline = `Filled ${int(o.filledQuantity)} shares @ avg ${money(o.averageFillPriceCents)}`;
    if (status === 'PARTIALLY_FILLED') {
      headline = `Partially filled: ${int(o.filledQuantity)} of ${int(o.quantity)}`;
      detail = `${int(o.remainingQuantity)} shares are resting on the book at ${money(o.limitPriceCents)}. They are NOT filled yet.`;
    }
    if (status === 'OPEN') {
      headline = 'Order accepted — resting on the book';
      detail = `Nothing has filled yet. ${o.side === 'BUY' ? `${money(o.reservedCents)} is reserved` : `${int(o.reservedQuantity)} shares are reserved`} until it fills or you cancel it.`;
    }
    if (status === 'CANCELLED') {
      headline = o.filledQuantity > 0 ? `Filled ${int(o.filledQuantity)} of ${int(o.quantity)} @ avg ${money(o.averageFillPriceCents)}` : 'Not filled';
      detail = cancelMessage(o.cancelReason);
    }
    if (status === 'REJECTED') {
      headline = 'Order rejected';
      detail = rejectMessage(o.rejectReason);
    }
  }
  return (
    <div className={cn('mt-4 rounded-lg border p-3 text-[13px]', toneCls)} role="status" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {status && <OrderStatusBadge status={status} />}
            {result.response?.replayed && <span className="text-[11px] text-fg-muted">(replayed — not executed twice)</span>}
          </div>
          <p className="mt-1.5 font-semibold text-fg">{headline}</p>
          {detail && <p className="mt-0.5 text-fg-muted">{detail}</p>}
          {result.response && result.response.fills.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-fg-muted num">
              {result.response.fills.map((f) => (
                <li key={f.tradeId}>
                  Trade #{f.tradeId}: {int(f.quantity)} @ {money(f.priceCents)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-fg-subtle hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ============================== Orders table ============================== */

export function OrdersTable({ orders, loading, showTicker = true, emptyText = 'No orders yet.' }: { orders: OrderView[] | undefined; loading?: boolean; showTicker?: boolean; emptyText?: string }) {
  const cancel = useCancelOrder();
  const [pending, setPending] = useState<OrderView | null>(null);
  if (loading) return <TableSkeleton rows={4} />;
  if (!orders?.length) return <EmptyState icon={<Clock3 />} title={emptyText} />;
  return (
    <>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
              <th className="px-4 py-2 font-medium">Placed</th>
              {showTicker && <th className="py-2 font-medium">Security</th>}
              <th className="py-2 font-medium">Side</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 text-right font-medium">Filled / Qty</th>
              <th className="py-2 text-right font-medium">Limit</th>
              <th className="py-2 text-right font-medium">Avg fill</th>
              <th className="py-2 pl-4 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const open = o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED';
              return (
                <tr key={o.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2.5 text-fg-muted">{timeAgo(o.createdAt)}</td>
                  {showTicker && (
                    <td className="py-2.5">
                      <Link to={`/stocks/${o.ticker}`} className="font-mono font-semibold hover:text-up">
                        {o.ticker}
                      </Link>
                    </td>
                  )}
                  <td className="py-2.5">
                    <SideText side={o.side} />
                  </td>
                  <td className="py-2.5 text-fg-muted">{o.type === 'LIMIT' ? 'Limit' : 'Market'}</td>
                  <td className="num py-2.5 text-right">
                    {int(o.filledQuantity)} / {int(o.quantity)}
                  </td>
                  <td className="num py-2.5 text-right text-fg-muted">{money(o.limitPriceCents)}</td>
                  <td className="num py-2.5 text-right">{money(o.averageFillPriceCents)}</td>
                  <td className="py-2.5 pl-4">
                    <div className="flex flex-col gap-0.5">
                      <OrderStatusBadge status={o.status} />
                      {(o.cancelReason || o.rejectReason) && (
                        <span className="max-w-56 truncate text-[11px] text-fg-subtle" title={o.rejectReason ? rejectMessage(o.rejectReason) : cancelMessage(o.cancelReason)}>
                          {(o.rejectReason ?? o.cancelReason)!.replaceAll('_', ' ').toLowerCase()}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {open && (
                      <Button size="sm" variant="danger" onClick={() => setPending(o)} disabled={cancel.isPending}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Cancel this order?"
        description={
          pending
            ? `${pending.side} ${int(pending.remainingQuantity)} remaining ${pending.ticker} @ ${money(pending.limitPriceCents)}. ${pending.side === 'BUY' ? `${money(pending.reservedCents)} of reserved cash` : `${int(pending.reservedQuantity)} reserved shares`} will be released. Any shares already filled stay filled.`
            : undefined
        }
        confirmLabel="Cancel order"
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => pending && cancel.mutate(pending.id, { onSettled: () => setPending(null) })}
      />
    </>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-7" />
      ))}
    </div>
  );
}

/* =============================== Trade lists ============================== */

export function TradesList({ trades, loading, showTicker, names }: { trades: (TradeView & { name?: string })[] | undefined; loading?: boolean; showTicker?: boolean; names?: boolean }) {
  const seen = useRef<Set<number> | null>(null);
  const fresh = new Set<number>();
  if (trades) {
    if (seen.current) for (const t of trades) if (!seen.current.has(t.id)) fresh.add(t.id);
    seen.current = new Set(trades.map((t) => t.id));
  }
  if (loading) return <TableSkeleton rows={6} />;
  if (!trades?.length)
    return (
      <EmptyState icon={<ArrowDownUp />} title="No executions yet">
        Trades appear here the moment the exchange matches two orders.
      </EmptyState>
    );
  return (
    <ul className="divide-y divide-border/60">
      {trades.map((t) => (
        <li key={t.id} className={cn('flex items-center gap-3 px-4 py-2 text-[13px]', fresh.has(t.id) && (t.aggressorSide === 'BUY' ? 'flash-up' : 'flash-down'))}>
          {showTicker && (
            <Link to={`/stocks/${t.ticker}`} className="w-16 shrink-0 font-mono font-semibold hover:text-up">
              {t.ticker}
            </Link>
          )}
          {names && t.name && <span className="hidden min-w-0 flex-1 truncate text-fg-muted sm:block">{t.name}</span>}
          <span className={cn('num w-20 font-medium', t.aggressorSide === 'BUY' ? 'text-up' : 'text-down')}>{money(t.priceCents)}</span>
          <span className="num flex-1 text-right text-fg sm:flex-none sm:w-16">{int(t.quantity)}</span>
          <span className="num w-20 text-right text-xs text-fg-subtle">{clock(t.executedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MyTradesTable({ trades, loading, showTicker = true }: { trades: MyTradeView[] | undefined; loading?: boolean; showTicker?: boolean }) {
  if (loading) return <TableSkeleton rows={5} />;
  if (!trades?.length) return <EmptyState icon={<ArrowDownUp />} title="No executions yet">Your fills will show up here once the exchange matches your orders.</EmptyState>;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[620px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="px-4 py-2 font-medium">Time</th>
            {showTicker && <th className="py-2 font-medium">Security</th>}
            <th className="py-2 font-medium">Side</th>
            <th className="py-2 text-right font-medium">Shares</th>
            <th className="py-2 text-right font-medium">Price</th>
            <th className="py-2 text-right font-medium">Total</th>
            <th className="px-4 py-2 text-right font-medium">Liquidity</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={`${t.id}-${t.side}`} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
              <td className="px-4 py-2.5 text-fg-muted">{new Date(t.executedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              {showTicker && (
                <td className="py-2.5">
                  <Link to={`/stocks/${t.ticker}`} className="font-mono font-semibold hover:text-up">
                    {t.ticker}
                  </Link>
                </td>
              )}
              <td className="py-2.5">
                <SideText side={t.side} />
              </td>
              <td className="num py-2.5 text-right">{int(t.quantity)}</td>
              <td className="num py-2.5 text-right">{money(t.priceCents)}</td>
              <td className={cn('num py-2.5 text-right font-medium', t.side === 'BUY' ? 'text-fg' : 'text-up')}>
                {t.side === 'BUY' ? '-' : '+'}
                {money(t.notionalCents)}
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-fg-subtle">{t.liquidity === 'MAKER' ? 'Maker (resting)' : 'Taker'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
