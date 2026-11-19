import { RESET_CONFIRMATION_PHRASE, SIMULATION_ACKNOWLEDGEMENT, STOCK_UNIVERSE, type SecurityView } from '@aez/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Pause, Play, RefreshCw, Settings2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PriceKindBadge, TradingStatus } from '@/components/common';
import { TableSkeleton } from '@/components/trading';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge, Input, Label, LineTabsList, LineTabsTrigger, NativeSelect, Panel, PanelHeader, Tabs, TabsContent, Textarea } from '@/components/ui/primitives';
import { api, errorMessage, type AdminUser } from '@/lib/api';
import { dateTime, int, money, parseMoneyInput, timeAgo } from '@/lib/format';
import { useMe, useNews, useSecurities, useStatus, useSummary } from '@/lib/queries';
import { usePageTitle } from '@/lib/theme';
import { cn } from '@/lib/utils';

const ak = {
  users: ['admin', 'users'] as const,
  mm: ['admin', 'mm'] as const,
  trades: ['admin', 'trades'] as const,
  audit: ['admin', 'audit'] as const,
  halts: ['admin', 'halts'] as const,
  integrity: ['admin', 'integrity'] as const,
  news: ['admin', 'news'] as const,
  resets: ['admin', 'resets'] as const,
};

/** Run an admin action, toast the outcome, refresh everything it may have touched. */
function useAdminAction<A>(fn: (a: A) => Promise<unknown>, success: (a: A) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_r, a) => {
      toast.success(success(a));
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export default function AdminPage() {
  usePageTitle('Admin');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-warn">
            <ShieldAlert className="size-3.5" /> Administrator console
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">Exchange operations</h1>
          <p className="text-sm text-fg-muted">Every action here is authorized server-side and written to the immutable audit log.</p>
        </div>
      </div>
      <Tabs defaultValue="overview">
        <LineTabsList>
          {['overview', 'securities', 'users', 'market maker', 'executions', 'news', 'audit', 'reset'].map((t) => (
            <LineTabsTrigger key={t} value={t} className="capitalize">
              {t}
            </LineTabsTrigger>
          ))}
        </LineTabsList>
        <div className="pt-4">
          <TabsContent value="overview"><Overview /></TabsContent>
          <TabsContent value="securities"><Securities /></TabsContent>
          <TabsContent value="users"><Users /></TabsContent>
          <TabsContent value="market maker"><MarketMaker /></TabsContent>
          <TabsContent value="executions"><Executions /></TabsContent>
          <TabsContent value="news"><NewsAdmin /></TabsContent>
          <TabsContent value="audit"><Audit /></TabsContent>
          <TabsContent value="reset"><Reset /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/* --------------------------------- shared --------------------------------- */

function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason('');
        onOpenChange(o);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      busy={busy || reason.trim().length < 3}
      onConfirm={() => onSubmit(reason.trim())}
    >
      <Label htmlFor="reason">Reason (recorded in the audit log)</Label>
      <Textarea id="reason" className="mt-1.5 min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 3 characters" autoFocus />
    </ConfirmDialog>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

/* -------------------------------- Overview -------------------------------- */

function Overview() {
  const status = useStatus();
  const summary = useSummary();
  const integrity = useQuery({ queryKey: ak.integrity, queryFn: api.admin.integrity, enabled: false });
  const halts = useQuery({ queryKey: ak.halts, queryFn: api.admin.halts });
  const mm = useQuery({ queryKey: ak.mm, queryFn: api.admin.marketMaker });
  const [dialog, setDialog] = useState<'halt' | 'resume' | null>(null);
  const halt = useAdminAction((r: string) => api.admin.haltMarket(r), () => 'Market halted');
  const resume = useAdminAction((r: string) => api.admin.resumeMarket(r), () => 'Market resumed');
  const open = status.data?.open;
  const activeHalts = (halts.data ?? []).filter((h) => !h.ended_at);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="p-5 lg:col-span-1">
        <p className="text-[11px] uppercase tracking-wider text-fg-subtle">Market status</p>
        <div className="mt-2 flex items-center gap-2">
          <span className={cn('size-2.5 rounded-full', open ? 'bg-up' : 'bg-warn')} />
          <p className="text-2xl font-semibold">{status.data ? (open ? 'Open' : 'Halted') : '…'}</p>
        </div>
        {status.data?.marketHalt && (
          <p className="mt-1 text-[13px] text-fg-muted">
            “{status.data.marketHalt.reason}” · since {timeAgo(status.data.marketHalt.startedAt)}
          </p>
        )}
        <p className="mt-1 text-xs text-fg-subtle">Epoch #{status.data?.epoch}</p>
        <div className="mt-4">
          {open ? (
            <Button variant="danger" onClick={() => setDialog('halt')}>
              <Pause /> Halt all trading
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setDialog('resume')}>
              <Play /> Resume trading
            </Button>
          )}
        </div>
        <ReasonDialog
          open={dialog === 'halt'}
          onOpenChange={(o) => !o && setDialog(null)}
          title="Halt the entire exchange?"
          description="New orders are rejected with MARKET_HALTED until trading is resumed. Resting orders stay on the book."
          confirmLabel="Halt market"
          tone="danger"
          busy={halt.isPending}
          onSubmit={(r) => halt.mutate(r, { onSuccess: () => setDialog(null) })}
        />
        <ReasonDialog
          open={dialog === 'resume'}
          onOpenChange={(o) => !o && setDialog(null)}
          title="Resume trading?"
          description="This ends the market-wide halt only. Symbol halts and original listing restrictions stay in force."
          confirmLabel="Resume"
          busy={resume.isPending}
          onSubmit={(r) => resume.mutate(r, { onSuccess: () => setDialog(null) })}
        />
      </Panel>

      <Panel className="grid grid-cols-2 gap-px overflow-hidden bg-border lg:col-span-2">
        {[
          ['Tradable securities', summary.data ? `${summary.data.tradableSecurities} / ${summary.data.securities}` : '…'],
          ['Halted / restricted', summary.data ? int(summary.data.haltedSecurities) : '…'],
          ['Trades 24h', summary.data ? int(summary.data.trades24h) : '…'],
          ['Notional 24h', summary.data ? money(summary.data.notional24hCents) : '…'],
          ['Active traders 24h', summary.data ? int(summary.data.activeTraders24h) : '…'],
          ['Market maker cash', mm.data?.account ? money(mm.data.account.cashCents) : '…'],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface p-4">
            <p className="text-[11px] uppercase tracking-wider text-fg-subtle">{k}</p>
            <p className="num mt-1 text-lg font-semibold">{v}</p>
          </div>
        ))}
      </Panel>

      <Panel className="lg:col-span-2">
        <PanelHeader title="Active halts" subtitle="Market and symbol halts currently in force" />
        {halts.isLoading ? (
          <TableSkeleton rows={2} />
        ) : activeHalts.length ? (
          <ul className="divide-y divide-border">
            {activeHalts.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <Badge tone="warn">{h.scope}</Badge>
                {h.ticker && <Link to={`/stocks/${h.ticker}`} className="font-mono font-semibold hover:text-up">{h.ticker}</Link>}
                <span className="flex-1 truncate text-fg-muted">{h.reason}</span>
                <span className="text-xs text-fg-subtle">{timeAgo(h.started_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-[13px] text-fg-muted">No active halts.</p>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold">Ledger integrity</p>
          <Button size="sm" variant="secondary" onClick={() => void integrity.refetch()} disabled={integrity.isFetching}>
            <RefreshCw className={cn(integrity.isFetching && 'animate-spin')} /> Run check
          </Button>
        </div>
        {integrity.data ? (
          <div className="mt-3 text-[13px]">
            <p className={cn('flex items-center gap-1.5 font-semibold', integrity.data.ok ? 'text-up' : 'text-down')}>
              {integrity.data.ok ? <CheckCircle2 className="size-4" /> : <AlertOctagon className="size-4" />}
              {integrity.data.ok ? 'All invariants hold' : `${integrity.data.violations.length} violation(s)`}
            </p>
            <dl className="mt-2 space-y-1 text-fg-muted num">
              <div className="flex justify-between"><dt>Total cash</dt><dd>{money(Number(integrity.data.stats.totalCashCents))}</dd></div>
              <div className="flex justify-between"><dt>Granted cash</dt><dd>{money(Number(integrity.data.stats.grantedCashCents))}</dd></div>
              <div className="flex justify-between"><dt>Trades</dt><dd>{int(integrity.data.stats.trades)}</dd></div>
              <div className="flex justify-between"><dt>Open orders</dt><dd>{int(integrity.data.stats.openOrders)}</dd></div>
            </dl>
            {!integrity.data.ok && <pre className="mt-2 max-h-40 overflow-auto rounded bg-bg-subtle p-2 text-[11px]">{JSON.stringify(integrity.data.violations, null, 2)}</pre>}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-fg-muted">Checks cash conservation, reservations, ledgers vs balances, issuance and the book.</p>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------- Securities ------------------------------- */

function Securities() {
  const secs = useSecurities();
  const [manage, setManage] = useState<SecurityView | null>(null);
  const [haltT, setHaltT] = useState<{ s: SecurityView; action: 'halt' | 'resume' } | null>(null);
  const halt = useAdminAction(({ t, r }: { t: string; r: string }) => api.admin.haltSymbol(t, r), (a) => `${a.t} halted`);
  const resume = useAdminAction(({ t, r }: { t: string; r: string }) => api.admin.resumeSymbol(t, r), (a) => `${a.t} resumed`);
  return (
    <Panel>
      <PanelHeader title="Securities & restrictions" subtitle="Original restrictions can only be lifted with a documented authorization reference" />
      {secs.isLoading ? (
        <TableSkeleton rows={10} />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="py-2 font-medium">Ticker</th>
                <th className="py-2 font-medium">Brother</th>
                <th className="py-2 font-medium">Listing</th>
                <th className="py-2 text-right font-medium">Reference</th>
                <th className="py-2 text-right font-medium">Last</th>
                <th className="py-2 pl-6 font-medium">Trading</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {secs.data?.map((s) => (
                <tr key={s.ticker} className="border-b border-border/60 last:border-0">
                  <td className="num px-4 py-2 text-fg-subtle">{s.originalRank}</td>
                  <td className="py-2"><Link to={`/stocks/${s.ticker}`} className="font-mono font-semibold hover:text-up">{s.ticker}</Link></td>
                  <td className="py-2 text-fg-muted">{s.name}</td>
                  <td className="py-2">{s.listingStatus ? <Badge tone={s.listingStatus === 'ACTIVE' ? 'up' : 'warn'}>{s.listingStatus}</Badge> : <Badge>UNVERIFIED</Badge>}</td>
                  <td className="py-2 text-right">
                    <div className="num">{money(s.referencePriceCents)}</div>
                    {s.referencePriceKind && <PriceKindBadge kind={s.referencePriceKind === 'SIMULATED' ? 'REFERENCE_SIMULATED' : 'REFERENCE_VERIFIED'} className="mt-0.5" />}
                  </td>
                  <td className="num py-2 text-right">{money(s.lastPriceCents)}</td>
                  <td className="py-2 pl-6"><TradingStatus s={s} /></td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant={s.symbolHalted ? 'primary' : 'danger'} onClick={() => setHaltT({ s, action: s.symbolHalted ? 'resume' : 'halt' })}>
                        {s.symbolHalted ? <Play /> : <Pause />} {s.symbolHalted ? 'Resume' : 'Halt'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setManage(s)}>
                        <Settings2 /> Manage
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReasonDialog
        open={!!haltT}
        onOpenChange={(o) => !o && setHaltT(null)}
        title={haltT ? `${haltT.action === 'halt' ? 'Halt' : 'Resume'} ${haltT.s.ticker}?` : ''}
        description={
          haltT?.action === 'halt'
            ? 'New orders for this symbol will be rejected with SYMBOL_HALTED.'
            : 'This ends the admin symbol halt only. It never lifts an original listing restriction.'
        }
        confirmLabel={haltT?.action === 'halt' ? 'Halt symbol' : 'Resume symbol'}
        tone={haltT?.action === 'halt' ? 'danger' : 'primary'}
        busy={halt.isPending || resume.isPending}
        onSubmit={(r) => {
          if (!haltT) return;
          const m = haltT.action === 'halt' ? halt : resume;
          m.mutate({ t: haltT.s.ticker, r }, { onSuccess: () => setHaltT(null) });
        }}
      />
      {manage && <ManageSecurity s={manage} onClose={() => setManage(null)} />}
    </Panel>
  );
}

function ManageSecurity({ s, onClose }: { s: SecurityView; onClose: () => void }) {
  const listing = useAdminAction(
    (b: { status: string; reason: string; authorizationReference: string }) => api.admin.listingStatus(s.ticker, b),
    () => `${s.ticker} listing status updated`,
  );
  const sim = useAdminAction(
    (b: { referencePriceCents: number; activate: boolean; note: string; acknowledgement: string }) => api.admin.simulatedReference(s.ticker, b),
    () => `${s.ticker} simulated reference set`,
  );
  const [status, setStatus] = useState(s.listingStatus ?? 'ACTIVE');
  const [reason, setReason] = useState('');
  const [authRef, setAuthRef] = useState('');
  const [price, setPrice] = useState('');
  const [activate, setActivate] = useState(false);
  const [note, setNote] = useState('');
  const [ack, setAck] = useState('');
  const priceCents = parseMoneyInput(price);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Manage ${s.ticker} · ${s.name}`} description="Changes are audited and broadcast to all connected clients." className="max-w-xl">
        <form
          className="space-y-3 rounded-xl border border-border p-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            listing.mutate({ status, reason, authorizationReference: authRef }, { onSuccess: onClose });
          }}
        >
          <p className="text-[13px] font-semibold">Listing status (documented authorization)</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {['ACTIVE', 'HALTED', 'SUSPENDED', 'UNLISTED'].map((x) => <option key={x}>{x}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Authorization reference" hint="e.g. exec board vote, minutes item">
              <Input value={authRef} onChange={(e) => setAuthRef(e.target.value)} required minLength={3} />
            </Field>
          </div>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          </Field>
          <Button type="submit" variant="secondary" disabled={listing.isPending || reason.length < 3 || authRef.length < 3}>Update listing status</Button>
        </form>

        <form
          className="mt-4 space-y-3 rounded-xl border border-warn/30 bg-warn-soft/30 p-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!priceCents) return;
            sim.mutate({ referencePriceCents: priceCents, activate, note, acknowledgement: ack }, { onSuccess: onClose });
          }}
        >
          <p className="text-[13px] font-semibold text-warn">Simulated reference price (testing only)</p>
          <p className="text-xs text-fg-muted">Labeled SIMULATED everywhere. A verified import replaces it. Refused once the security has traded.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price ($)">
              <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="10.00" aria-invalid={!!price && !priceCents} />
            </Field>
            <label className="mt-6 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} className="size-4 accent-[var(--up)]" />
              Also mark listing ACTIVE (simulation)
            </label>
          </div>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Field label="Type the acknowledgement exactly" hint={SIMULATION_ACKNOWLEDGEMENT}>
            <Input value={ack} onChange={(e) => setAck(e.target.value)} aria-invalid={!!ack && ack !== SIMULATION_ACKNOWLEDGEMENT} />
          </Field>
          <Button type="submit" variant="secondary" disabled={sim.isPending || !priceCents || note.length < 3 || ack !== SIMULATION_ACKNOWLEDGEMENT}>
            Set simulated reference
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- Users --------------------------------- */

function Users() {
  const me = useMe();
  const users = useQuery({ queryKey: ak.users, queryFn: api.admin.users });
  const update = useAdminAction(({ id, b }: { id: string; b: { role?: 'USER' | 'ADMIN'; status?: 'ACTIVE' | 'DISABLED' } }) => api.admin.updateUser(id, b), () => 'User updated');
  const create = useAdminAction((b: { username: string; password: string; role: 'USER' | 'ADMIN' }) => api.admin.createUser(b), (b) => `Created ${b.username} with $10,000`);
  const [pending, setPending] = useState<{ u: AdminUser; b: { role?: 'USER' | 'ADMIN'; status?: 'ACTIVE' | 'DISABLED' }; text: string } | null>(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'USER' as 'USER' | 'ADMIN' });

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <Panel>
        <PanelHeader title="Accounts" subtitle={users.data ? `${users.data.length} accounts` : undefined} />
        {users.isLoading ? (
          <TableSkeleton />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                  <th className="px-4 py-2 font-medium">Username</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Created</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data?.map((u) => {
                  const self = u.id === me.data?.id;
                  const mm = u.accountType !== 'HUMAN';
                  return (
                    <tr key={u.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{u.username}{self && <span className="ml-1.5 text-[11px] text-up">you</span>}</td>
                      <td className="py-2.5 text-fg-muted">{u.accountType === 'MARKET_MAKER' ? 'Market maker' : u.accountType === 'SIMULATION' ? 'Simulation desk' : 'Human'}</td>
                      <td className="py-2.5"><Badge tone={u.role === 'ADMIN' ? 'warn' : 'neutral'}>{u.role}</Badge></td>
                      <td className="py-2.5"><Badge tone={u.status === 'ACTIVE' ? 'up' : 'down'}>{u.status}</Badge></td>
                      <td className="py-2.5 text-fg-muted">{dateTime(u.createdAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {!mm && !self && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setPending({ u, b: { role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' }, text: u.role === 'ADMIN' ? `Remove admin rights from ${u.username}?` : `Grant ${u.username} full admin rights?` })}>
                              {u.role === 'ADMIN' ? 'Make user' : 'Make admin'}
                            </Button>
                            <Button size="sm" variant={u.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => setPending({ u, b: { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }, text: u.status === 'ACTIVE' ? `Disable ${u.username}? Their sessions are revoked and open orders cancelled.` : `Re-enable ${u.username}?` })}>
                              {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel className="self-start p-4">
        <p className="text-[13px] font-semibold">Create account</p>
        <p className="mt-0.5 text-xs text-fg-muted">Starts with exactly $10,000. No admin can edit wallet balances.</p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(form, { onSuccess: () => setForm({ username: '', password: '', role: 'USER' }) });
          }}
        >
          <Field label="Username"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" /></Field>
          <Field label="Initial password" hint="At least 10 characters; share it privately."><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Role">
            <NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'USER' | 'ADMIN' })}>
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </NativeSelect>
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={create.isPending || form.username.length < 3 || form.password.length < 10}>Create account</Button>
        </form>
      </Panel>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Confirm account change"
        description={pending?.text}
        tone={pending?.b.status === 'DISABLED' ? 'danger' : 'primary'}
        busy={update.isPending}
        onConfirm={() => pending && update.mutate({ id: pending.u.id, b: pending.b }, { onSettled: () => setPending(null) })}
      />
    </div>
  );
}

/* ------------------------------ Market maker ------------------------------ */

function parseLevels(s: string): { offsetBps: number; quantity: number }[] | null {
  if (!s.trim()) return [];
  const out: { offsetBps: number; quantity: number }[] = [];
  for (const part of s.split(',')) {
    const m = /^\s*(-?\d+)\s*:\s*(\d+)\s*$/.exec(part);
    if (!m) return null;
    out.push({ offsetBps: Number(m[1]), quantity: Number(m[2]) });
  }
  return out;
}

function MarketMaker() {
  const mm = useQuery({ queryKey: ak.mm, queryFn: api.admin.marketMaker });
  const secs = useSecurities();
  const configure = useAdminAction(
    (a: { t: string; b: Parameters<typeof api.admin.configureMM>[1] }) => api.admin.configureMM(a.t, a.b),
    (a) => `Liquidity config saved for ${a.t}`,
  );
  const openL = useAdminAction((t: string) => api.admin.openMM(t), (t) => `Opening liquidity placed for ${t}`);
  const [f, setF] = useState({ ticker: 'SNIG', inventory: '1000', asks: '0:200, 300:300, 600:500', bids: '-300:100, -600:100', note: '' });
  const [openT, setOpenT] = useState<string | null>(null);
  const asks = parseLevels(f.asks);
  const bids = parseLevels(f.bids);
  const ref = secs.data?.find((s) => s.ticker === f.ticker);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Panel className="grid grid-cols-3 gap-px overflow-hidden bg-border">
          {[
            ['Cash', money(mm.data?.account?.cashCents)],
            ['Reserved', money(mm.data?.account?.reservedCashCents)],
            ['Positions', mm.data ? int(mm.data.inventory.length) : '…'],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface p-4">
              <p className="text-[11px] uppercase tracking-wider text-fg-subtle">Market maker {k}</p>
              <p className="num mt-1 text-lg font-semibold">{v}</p>
            </div>
          ))}
        </Panel>
        <Panel>
          <PanelHeader title="Liquidity configs" subtitle="Admin-approved. Opening issues inventory through the immutable issuance ledger, once per epoch." />
          {mm.isLoading ? (
            <TableSkeleton rows={3} />
          ) : mm.data?.configs.length ? (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                    <th className="px-4 py-2 font-medium">Ticker</th>
                    <th className="py-2 text-right font-medium">Inventory</th>
                    <th className="py-2 font-medium pl-4">Asks (bps:qty)</th>
                    <th className="py-2 font-medium">Bids</th>
                    <th className="py-2 font-medium">Opened</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {mm.data.configs.map((c) => (
                    <tr key={c.ticker} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-mono font-semibold">{c.ticker}</td>
                      <td className="num py-2.5 text-right">{int(Number(c.inventory_shares))}</td>
                      <td className="py-2.5 pl-4 font-mono text-xs text-fg-muted">{c.ask_levels.map((l) => `${l.offsetBps}:${l.quantity}`).join(', ') || '—'}</td>
                      <td className="py-2.5 font-mono text-xs text-fg-muted">{c.bid_levels.map((l) => `${l.offsetBps}:${l.quantity}`).join(', ') || '—'}</td>
                      <td className="py-2.5 text-fg-muted">{c.opened_epoch ? `Epoch ${c.opened_epoch}` : 'Not yet'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="primary" disabled={!!c.opened_epoch || !c.enabled} onClick={() => setOpenT(c.ticker)}>Open liquidity</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-fg-muted">No liquidity configured yet.</p>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Inventory" />
          {mm.data?.inventory.length ? (
            <ul className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {mm.data.inventory.map((i) => (
                <li key={i.ticker} className="bg-surface px-4 py-2.5 text-[13px]">
                  <span className="font-mono font-semibold">{i.ticker}</span>
                  <span className="num ml-2 text-fg-muted">{int(i.quantity)} sh</span>
                  {i.reservedQuantity > 0 && <span className="num ml-1 text-[11px] text-warn">({int(i.reservedQuantity)} on book)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-fg-muted">The market maker holds no shares.</p>
          )}
        </Panel>
      </div>
      <Panel className="self-start p-4">
        <p className="text-[13px] font-semibold">Configure opening liquidity</p>
        <p className="mt-0.5 text-xs text-fg-muted">Levels are offsets from the reference price in basis points (100 = 1%). Asks ≥ 0, bids &lt; 0.</p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!asks || !bids) return;
            configure.mutate({ t: f.ticker, b: { inventoryShares: Number(f.inventory), askLevels: asks, bidLevels: bids, enabled: true, note: f.note } });
          }}
        >
          <Field label="Security" hint={ref ? `Reference: ${money(ref.referencePriceCents)}${ref.referencePriceKind === 'SIMULATED' ? ' (SIMULATED)' : ''}` : undefined}>
            <NativeSelect value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })}>
              {STOCK_UNIVERSE.map((s) => <option key={s.ticker} value={s.ticker}>{s.ticker} · {s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Inventory shares to issue"><Input inputMode="numeric" value={f.inventory} onChange={(e) => setF({ ...f, inventory: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Ask levels (bps:qty, …)"><Input value={f.asks} onChange={(e) => setF({ ...f, asks: e.target.value })} aria-invalid={!asks} className="font-mono text-xs" /></Field>
          <Field label="Bid levels (bps:qty, …)"><Input value={f.bids} onChange={(e) => setF({ ...f, bids: e.target.value })} aria-invalid={!bids} className="font-mono text-xs" /></Field>
          <Field label="Approval note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Why this liquidity is approved" /></Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={configure.isPending || !asks || !bids || f.note.length < 3 || !f.inventory}>Save config</Button>
        </form>
      </Panel>
      <ConfirmDialog
        open={!!openT}
        onOpenChange={(o) => !o && setOpenT(null)}
        title={`Open liquidity for ${openT}?`}
        description="Issues the configured inventory to the market maker (immutable issuance ledger) and places its quotes on the book. This can happen once per epoch."
        busy={openL.isPending}
        confirmLabel="Open liquidity"
        onConfirm={() => openT && openL.mutate(openT, { onSettled: () => setOpenT(null) })}
      />
    </div>
  );
}

/* ------------------------------- Executions ------------------------------- */

function Executions() {
  const trades = useQuery({ queryKey: ak.trades, queryFn: () => api.admin.trades(200) });
  const users = useQuery({ queryKey: ak.users, queryFn: api.admin.users });
  const name = (id: string) => users.data?.find((u) => u.id === id)?.username ?? id.slice(0, 8);
  return (
    <Panel>
      <PanelHeader title="Recent executions" subtitle="Every trade, with both counterparties" action={<Button size="sm" variant="ghost" onClick={() => void trades.refetch()}><RefreshCw /> Refresh</Button>} />
      {trades.isLoading ? (
        <TableSkeleton />
      ) : trades.data?.length ? (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                <th className="px-4 py-2 font-medium">ID</th>
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 font-medium">Ticker</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Price</th>
                <th className="py-2 pl-4 font-medium">Buyer</th>
                <th className="py-2 font-medium">Seller</th>
                <th className="px-4 py-2 font-medium">Aggressor</th>
              </tr>
            </thead>
            <tbody>
              {trades.data.map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0">
                  <td className="num px-4 py-2 text-fg-subtle">#{t.id}</td>
                  <td className="py-2 text-fg-muted">{dateTime(t.executed_at)}</td>
                  <td className="py-2 font-mono font-semibold">{t.ticker}</td>
                  <td className="num py-2 text-right">{int(t.quantity)}</td>
                  <td className="num py-2 text-right">{money(t.price_cents)}</td>
                  <td className="py-2 pl-4">{name(t.buyer_id)}</td>
                  <td className="py-2">{name(t.seller_id)}</td>
                  <td className="px-4 py-2"><span className={t.aggressor_side === 'BUY' ? 'text-up' : 'text-down'}>{t.aggressor_side}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 pb-4 text-[13px] text-fg-muted">No executions yet.</p>
      )}
    </Panel>
  );
}

/* ---------------------------------- News ---------------------------------- */

function NewsAdmin() {
  const posts = useQuery({ queryKey: ak.news, queryFn: api.admin.news });
  const qc = useQueryClient();
  const create = useAdminAction((b: { ticker: string | null; headline: string; body: string }) => api.admin.createNews(b), () => 'Story published (labeled parody)');
  const hide = useAdminAction(({ id, h }: { id: string; h: boolean }) => api.admin.setNewsHidden(id, h), (a) => (a.h ? 'Story hidden' : 'Story restored'));
  const [f, setF] = useState({ ticker: '', headline: '', body: '' });
  useNews(); // keep public cache warm for preview
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Panel className="self-start p-4">
        <p className="text-[13px] font-semibold">Publish a fictional story</p>
        <p className="mt-0.5 text-xs text-fg-muted">Always shown with “Fictional AEZ Market News · Parody”. Keep it obviously satirical — no real-world claims, contact details or private info.</p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { ticker: f.ticker || null, headline: f.headline.trim(), body: f.body.trim() },
              { onSuccess: () => { setF({ ticker: '', headline: '', body: '' }); void qc.invalidateQueries({ queryKey: ['news'] }); } },
            );
          }}
        >
          <Field label="Brother (optional)">
            <NativeSelect value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })}>
              <option value="">Market-wide</option>
              {STOCK_UNIVERSE.map((s) => <option key={s.ticker} value={s.ticker}>{s.ticker} · {s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Headline" hint={`${f.headline.length}/160`}><Input value={f.headline} maxLength={160} onChange={(e) => setF({ ...f, headline: e.target.value })} /></Field>
          <Field label="Body" hint={`${f.body.length}/4000`}><Textarea value={f.body} maxLength={4000} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Button type="submit" variant="primary" className="w-full" disabled={create.isPending || f.headline.trim().length < 3}>Publish parody story</Button>
        </form>
      </Panel>
      <Panel>
        <PanelHeader title="All stories" subtitle="Including hidden" />
        {posts.isLoading ? (
          <TableSkeleton />
        ) : (
          <ul className="divide-y divide-border">
            {posts.data?.map((p) => (
              <li key={p.id} className={cn('flex items-start gap-3 px-4 py-3', p.hidden && 'opacity-50')}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{p.ticker && <span className="mr-1.5 font-mono text-fg-muted">{p.ticker}</span>}{p.headline}</p>
                  <p className="mt-0.5 text-[11px] text-fg-subtle">{p.author} · {timeAgo(p.createdAt)} {p.hidden && '· hidden'}</p>
                </div>
                <Button size="sm" variant={p.hidden ? 'secondary' : 'danger'} disabled={hide.isPending} onClick={() => hide.mutate({ id: p.id, h: !p.hidden })}>
                  {p.hidden ? 'Unhide' : 'Hide'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------- Audit --------------------------------- */

function Audit() {
  const audit = useQuery({ queryKey: ak.audit, queryFn: () => api.admin.audit(200) });
  const users = useQuery({ queryKey: ak.users, queryFn: api.admin.users });
  const name = (id: string | null) => (id ? users.data?.find((u) => u.id === id)?.username ?? id.slice(0, 8) : 'system');
  return (
    <Panel>
      <PanelHeader title="Audit log" subtitle="Append-only. Cannot be edited or deleted." action={<Button size="sm" variant="ghost" onClick={() => void audit.refetch()}><RefreshCw /> Refresh</Button>} />
      {audit.isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="py-2 font-medium">Actor</th>
                <th className="py-2 font-medium">Action</th>
                <th className="py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.map((a) => (
                <tr key={a.id} className="border-b border-border/60 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{dateTime(a.created_at)}</td>
                  <td className="py-2">{name(a.actor_user_id)}</td>
                  <td className="py-2"><Badge tone="info">{a.action}</Badge></td>
                  <td className="py-2 font-mono text-xs text-fg-muted">{a.target_type ? `${a.target_type}:${a.target_id ?? ''}`.slice(0, 40) : '—'}</td>
                  <td className="max-w-md px-4 py-2 font-mono text-[11px] text-fg-subtle"><span className="line-clamp-2 break-all">{JSON.stringify(a.details)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------- Reset --------------------------------- */

function Reset() {
  const status = useStatus();
  const resets = useQuery({ queryKey: ak.resets, queryFn: api.admin.resets });
  const qc = useQueryClient();
  const [f, setF] = useState({ confirmation: '', password: '', reason: '' });
  const [confirm, setConfirm] = useState(false);
  const reset = useMutation({
    mutationFn: () => api.admin.reset(f),
    onSuccess: () => {
      toast.success('Simulation reset', { description: 'All accounts are back to $10,000 in a new epoch.' });
      setF({ confirmation: '', password: '', reason: '' });
      setConfirm(false);
      void qc.invalidateQueries();
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(errorMessage(e, { UNAUTHENTICATED: 'Re-authentication failed: wrong password.', MARKET_NOT_HALTED: 'Halt the market before resetting.' }));
    },
  });
  const halted = status.data && !status.data.open;
  const valid = f.confirmation === RESET_CONFIRMATION_PHRASE && f.password.length > 0 && f.reason.trim().length >= 5 && halted;
  return (
    <div className="grid gap-4 xl:grid-cols-[480px_1fr]">
      <Panel className="border-down/30 p-5">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-down"><AlertOctagon className="size-5" /> Reset the simulation</p>
        <p className="mt-1.5 text-[13px] text-fg-muted">
          Deletes all orders, trades, ledgers and price history, starts a new epoch and re-grants every account exactly $10,000. Users, securities,
          verified reference data, issuance history and the audit log are preserved.
        </p>
        {!halted && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <ShieldCheck className="size-4" /> Halt the market first (Overview tab).
          </p>
        )}
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) setConfirm(true); }}>
          <Field label="Type the confirmation phrase" hint={RESET_CONFIRMATION_PHRASE}>
            <Input value={f.confirmation} onChange={(e) => setF({ ...f, confirmation: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Your admin password (re-authentication)">
            <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="Reason"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="min-h-16" /></Field>
          <Button type="submit" variant="danger" className="w-full" disabled={!valid || reset.isPending}>Reset simulation…</Button>
        </form>
      </Panel>
      <Panel>
        <PanelHeader title="Reset history" />
        {resets.data?.length ? (
          <ul className="divide-y divide-border">
            {resets.data.map((r, i) => (
              <li key={i} className="px-4 py-2.5 font-mono text-[11px] text-fg-muted break-all">{JSON.stringify(r)}</li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-[13px] text-fg-muted">No resets yet.</p>
        )}
      </Panel>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="This permanently wipes all trading activity"
        description="Every order, trade, ledger entry and price point in this epoch is deleted. This cannot be undone."
        confirmLabel="Reset now"
        tone="danger"
        busy={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </div>
  );
}
