import { loginSchema, registerSchema } from '@aez/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Logo } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { API_ERRORS } from '@/lib/reasons';
import { usePageTitle } from '@/lib/theme';

function safeNext(n: string | null): string {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard';
}

function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_520px]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-bg-subtle lg:flex lg:flex-col lg:justify-between lg:p-10">
        <Link to="/">
          <Logo />
        </Link>
        <div>
          <p className="max-w-md text-balance text-3xl font-semibold leading-tight tracking-tight">
            Invest in your brothers.
            <br />
            <span className="text-fg-muted">Short their potential.</span>
          </p>
          <p className="mt-4 max-w-md text-sm text-fg-muted">
            A real limit-order-book exchange where all 45 AEZ brothers are listed. Prices only move when trades execute.
          </p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
            <ShieldCheck className="size-4 text-up" /> Virtual money only. No deposits, withdrawals or prizes. Short selling is (sadly) disabled.
          </p>
        </div>
        <svg viewBox="0 0 400 120" className="absolute bottom-24 right-0 w-[70%] opacity-[0.07]" aria-hidden>
          <path d="M0 100 L60 80 L100 90 L150 50 L200 62 L260 20 L320 40 L400 8" fill="none" stroke="var(--up)" strokeWidth="3" />
        </svg>
        <p className="text-xs text-fg-subtle">A fictional simulation for Alpha Epsilon Zeta · UC Berkeley</p>
      </aside>
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <Link to="/" className="mb-10 lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-sm text-fg-muted">{footer}</div>
        </div>
      </div>
    </div>
  );
}

function useAuthSubmit(kind: 'login' | 'register') {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = { username: String(fd.get('username') ?? ''), password: String(fd.get('password') ?? '') };
    const parsed = (kind === 'login' ? loginSchema : registerSchema).safeParse(raw);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      setFieldErrors(fe);
      return;
    }
    if (kind === 'register' && raw.password !== String(fd.get('confirm') ?? '')) {
      setFieldErrors({ confirm: 'Passwords don’t match' });
      return;
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      const r = kind === 'login' ? await api.login(parsed.data.username, parsed.data.password) : await api.register(parsed.data.username, parsed.data.password);
      qc.setQueryData(qk.me, r.user);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      toast.success(kind === 'login' ? `Welcome back, ${r.user.username}` : `Welcome to the exchange, ${r.user.username}`, {
        description: kind === 'register' ? 'Your account was funded with $10,000.00 in virtual AEZ dollars.' : undefined,
      });
      nav(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(errorMessage(err, { ...API_ERRORS, UNAUTHENTICATED: 'Incorrect username or password.' }));
    } finally {
      setBusy(false);
    }
  };
  return { submit, busy, error, fieldErrors };
}

export function LoginPage() {
  usePageTitle('Sign in');
  const { submit, busy, error, fieldErrors } = useAuthSubmit('login');
  const [params] = useSearchParams();
  return (
    <AuthFrame
      title="Sign in"
      subtitle="Welcome back to the floor."
      footer={
        <>
          New here?{' '}
          <Link className="font-medium text-up hover:underline" to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>
            Create an account and get $10,000
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="username" label="Username" autoComplete="username" error={fieldErrors.username} />
        <Field id="password" label="Password" type="password" autoComplete="current-password" error={fieldErrors.password} />
        {error && (
          <p role="alert" className="rounded-lg border border-down/30 bg-down-soft px-3 py-2 text-[13px] text-down">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
    </AuthFrame>
  );
}

export function RegisterPage() {
  usePageTitle('Create account');
  const { submit, busy, error, fieldErrors } = useAuthSubmit('register');
  return (
    <AuthFrame
      title="Open your account"
      subtitle="Start with exactly $10,000.00 in virtual AEZ dollars."
      footer={
        <>
          Already trading?{' '}
          <Link className="font-medium text-up hover:underline" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="username" label="Username" autoComplete="username" hint="3–32 characters: letters, numbers, underscore. Shown on the leaderboard." error={fieldErrors.username} />
        <Field id="password" label="Password" type="password" autoComplete="new-password" hint="At least 10 characters." error={fieldErrors.password} />
        <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" error={fieldErrors.confirm} />
        {error && (
          <p role="alert" className="rounded-lg border border-down/30 bg-down-soft px-3 py-2 text-[13px] text-down">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Create account
        </Button>
        <p className="text-[11px] leading-relaxed text-fg-subtle">
          This is a fictional simulation. Balances are virtual and have no cash value. There are no deposits, withdrawals or prizes.
        </p>
      </form>
    </AuthFrame>
  );
}

function Field({ id, label, hint, error, ...props }: { id: string; label: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} className="mt-1.5" aria-invalid={!!error} aria-describedby={`${id}-msg`} {...props} />
      <p id={`${id}-msg`} className={error ? 'mt-1 text-xs text-down' : 'mt-1 text-xs text-fg-subtle'}>
        {error ?? hint ?? ''}
      </p>
    </div>
  );
}
