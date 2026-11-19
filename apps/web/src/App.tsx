import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from './components/AppShell';
import { Skeleton, TooltipProvider } from './components/ui/primitives';
import { useMe } from './lib/queries';
import { RealtimeProvider } from './lib/realtime';
import { useTheme } from './lib/theme';
import { LoginPage, RegisterPage } from './pages/Auth';
import { LandingPage } from './pages/Landing';
import { NotFoundPage } from './pages/NotFound';

const DashboardPage = lazy(() => import('./pages/Dashboard'));
const MarketsPage = lazy(() => import('./pages/Markets'));
const StockPage = lazy(() => import('./pages/Stock'));
const PortfolioPage = lazy(() => import('./pages/Portfolio'));
const LeaderboardPage = lazy(() => import('./pages/Leaderboard'));
const TraderPage = lazy(() => import('./pages/Trader'));
const NewsPage = lazy(() => import('./pages/News'));
const AdminPage = lazy(() => import('./pages/Admin'));

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-72" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <PageFallback />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && me.data.role !== 'ADMIN') return <NotFoundPage forbidden />;
  return <>{children}</>;
}

function Home() {
  const me = useMe();
  if (me.isLoading) return <PageFallback />;
  return me.data ? <Navigate to="/dashboard" replace /> : <LandingPage />;
}

export function App() {
  const { theme } = useTheme();
  return (
    <BrowserRouter>
      <TooltipProvider>
        <RealtimeProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              element={
                <AppShell>
                  <Suspense fallback={<PageFallback />}>
                    <AppRoutes />
                  </Suspense>
                </AppShell>
              }
              path="*"
            />
          </Routes>
          <Toaster
            theme={theme}
            position="bottom-right"
            closeButton
            toastOptions={{ className: '!bg-surface-2 !border-border !text-fg', descriptionClassName: '!text-fg-muted' }}
          />
        </RealtimeProvider>
      </TooltipProvider>
    </BrowserRouter>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/markets" element={<MarketsPage />} />
      <Route path="/stocks/:ticker" element={<StockPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route path="/traders/:username" element={<TraderPage />} />
      <Route path="/news" element={<NewsPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/portfolio"
        element={
          <RequireAuth>
            <PortfolioPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth admin>
            <AdminPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
