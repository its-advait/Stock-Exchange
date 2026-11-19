import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Briefcase,
  LayoutDashboard,
  LogOut,
  Moon,
  Newspaper,
  Search,
  Shield,
  Sun,
  Trophy,
  User,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useMe, usePortfolio, useSecurities, useStatus } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { ChangePill, Logo } from './common';
import { SearchPalette } from './SearchPalette';
import { Button } from './ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/dialog';
import { Kbd, Tip } from './ui/primitives';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, auth: true },
  { to: '/markets', label: 'Markets', icon: BarChart3 },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase, auth: true },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/news', label: 'News', icon: Newspaper },
];

function ConnectionDot() {
  const { state } = useRealtime();
  const map = {
    live: ['bg-up', 'Live', 'Real-time updates connected'],
    connecting: ['bg-fg-subtle', 'Connecting', 'Connecting to real-time feed…'],
    reconnecting: ['bg-warn animate-pulse', 'Reconnecting', 'Connection lost. Data may be stale; it will refresh automatically on reconnect.'],
    offline: ['bg-down', 'Offline', 'Real-time feed unavailable. Showing the last loaded snapshot.'],
  } as const;
  const [cls, label, tip] = map[state];
  return (
    <Tip content={tip} side="bottom">
      <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-muted sm:inline-flex" role="status" aria-live="polite">
        <span className={cn('size-1.5 rounded-full', cls)} />
        {label}
      </span>
    </Tip>
  );
}

function MarketPill() {
  const st = useStatus();
  if (!st.data) return null;
  return st.data.open ? null : (
    <Tip content={st.data.marketHalt?.reason ?? 'Trading halted'} side="bottom">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-xs font-semibold text-warn">
        <span className="size-1.5 rounded-full bg-warn" /> Market halted
      </span>
    </Tip>
  );
}

function TickerTape() {
  const secs = useSecurities();
  const { lastTick } = useRealtime();
  const priced = (secs.data ?? []).filter((s) => s.displayPriceCents !== null);
  if (priced.length === 0) return null;
  const items = [...priced, ...priced];
  return (
    <div className="relative overflow-hidden border-b border-border bg-bg-subtle" aria-label="Ticker tape">
      <div className="ticker-track flex w-max gap-6 px-4 py-1.5">
        {items.map((s, i) => {
          const tick = lastTick[s.ticker];
          const flash = tick && Date.now() - tick.at < 1500 ? (tick.dir === 'up' ? 'flash-up' : 'flash-down') : '';
          return (
            <Link
              key={`${s.ticker}-${i}`}
              to={`/stocks/${s.ticker}`}
              tabIndex={i >= priced.length ? -1 : 0}
              className={cn('inline-flex items-center gap-2 rounded px-1 text-xs hover:text-fg', flash)}
            >
              <span className="font-mono font-semibold text-fg">{s.ticker}</span>
              <span className="num text-fg-muted">{money(s.displayPriceCents)}</span>
              <span className={cn('num', (s.changeFromReferenceBps ?? 0) > 0 ? 'text-up' : (s.changeFromReferenceBps ?? 0) < 0 ? 'text-down' : 'text-fg-subtle')}>
                {s.changeFromReferenceBps === null ? '—' : <ChangePill bps={s.changeFromReferenceBps} />}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const me = useMe();
  const user = me.data;
  const pf = usePortfolio();
  const { theme, toggle } = useTheme();
  const [search, setSearch] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement).tagName))) {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ queryKey: ['account'] });
      toast.success('Signed out');
      nav('/');
    }
  };

  const links = NAV.filter((n) => !n.auth || user);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface-3 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 lg:px-6">
          <Link to={user ? '/dashboard' : '/'} aria-label="AEZ Stock Exchange home" className="mr-2">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
            {links.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn('rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', isActive ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg')
                }
              >
                {n.label}
              </NavLink>
            ))}
            {user?.role === 'ADMIN' && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn('ml-1 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium', isActive ? 'bg-warn-soft text-warn' : 'text-warn/80 hover:text-warn')
                }
              >
                <Shield className="size-3.5" /> Admin
              </NavLink>
            )}
          </nav>
          <div className="flex-1" />
          <button
            onClick={() => setSearch(true)}
            className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-fg-subtle transition-colors hover:border-border-strong lg:flex"
            aria-label="Search securities"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search brothers…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSearch(true)} aria-label="Search securities">
            <Search />
          </Button>
          <MarketPill />
          <ConnectionDot />
          <Tip content={theme === 'dark' ? 'Light theme' : 'Dark theme'} side="bottom">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle color theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </Tip>
          {user ? (
            <Menu>
              <MenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg border border-border bg-surface py-1 pl-1 pr-2.5 text-left hover:border-border-strong" aria-label="Account menu">
                  <span className="flex size-7 items-center justify-center rounded-md bg-up-soft font-mono text-[11px] font-bold uppercase text-up">
                    {user.username.slice(0, 2)}
                  </span>
                  <span className="hidden leading-tight sm:block">
                    <span className="block text-xs font-medium text-fg">{user.username}</span>
                    <span className="num block text-[11px] text-fg-subtle">{pf.data ? money(pf.data.totalValueCents) : '…'}</span>
                  </span>
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>
                  Signed in as <b className="text-fg">{user.username}</b>
                  {user.role === 'ADMIN' && <span className="ml-1 text-warn">· admin</span>}
                </MenuLabel>
                <MenuSeparator />
                <MenuItem onSelect={() => nav('/portfolio')}>
                  <Briefcase /> Portfolio
                </MenuItem>
                <MenuItem onSelect={() => nav(`/traders/${user.username}`)}>
                  <User /> Public profile
                </MenuItem>
                {user.role === 'ADMIN' && (
                  <MenuItem onSelect={() => nav('/admin')}>
                    <Shield /> Admin console
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem onSelect={() => void logout()}>
                  <LogOut /> Sign out
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            !me.isLoading && (
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`}>Sign in</Link>
                </Button>
                <Button variant="primary" size="sm" asChild>
                  <Link to="/register">Get $10,000</Link>
                </Button>
              </div>
            )
          )}
        </div>
        <TickerTape />
      </header>

      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-24 pt-5 lg:px-6 md:pb-10">
        {children ?? <Outlet />}
      </main>

      <footer className="border-t border-border pb-20 md:pb-0">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-6 text-xs text-fg-subtle lg:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Logo compact />
            <span>
              <b className="text-fg-muted">Virtual money only.</b> AEZ Stock Exchange is a fictional simulation for the Alpha Epsilon Zeta brotherhood. No real money,
              deposits, withdrawals or prizes. Short selling is disabled. All news is parody.
            </span>
          </div>
          <span className="shrink-0">Not investment advice. Not an actual exchange.</span>
        </div>
      </footer>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 backdrop-blur-md md:hidden" aria-label="Mobile">
        <div className="grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
          {(user ? NAV : [{ to: '/', label: 'Home', icon: LayoutDashboard }, ...NAV.filter((n) => !n.auth)]).slice(0, 5).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-up' : 'text-fg-subtle')}
            >
              <n.icon className="size-5" />
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <SearchPalette open={search} onOpenChange={setSearch} />
    </div>
  );
}
