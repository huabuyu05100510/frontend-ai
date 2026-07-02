import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './auth/store';
import { Layout } from './shell/components/Layout';
import { Dashboard } from './shell/components/Dashboard';
import { Profile } from './shell/components/Profile';
import { NotFound } from './shell/components/NotFound';
import { Login } from './shell/components/Login';

const SystemARoutes = lazy(() => import('./modules/system-a/routes'));
const SystemBRoutes = lazy(() => import('./modules/system-b/routes'));
const SystemCRoutes = lazy(() => import('./modules/system-c/routes'));

import { resolveBasename } from './config/domains';

function Loading() {
  return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore(s => s.isLoggedIn());
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function LayoutRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  // 锁定 basename：避免 hot reload / 异步状态变化导致 basename 漂移
  const [basename] = useState(() => resolveBasename());

  return (
    <BrowserRouter basename={basename}>
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* 登录页不需要 Layout */}
          <Route path="/login" element={<Login />} />

          {/* 主壳层 */}
          <Route path="/" element={<LayoutRoute><Dashboard /></LayoutRoute>} />
          <Route path="/profile" element={<LayoutRoute><Profile /></LayoutRoute>} />

          {/* 系统 A 路由 */}
          <Route
            path="/system-a/*"
            element={
              <LayoutRoute>
                <Suspense fallback={<Loading />}>
                  <SystemARoutes />
                </Suspense>
              </LayoutRoute>
            }
          />

          {/* 系统 B 路由 */}
          <Route
            path="/system-b/*"
            element={
              <LayoutRoute>
                <Suspense fallback={<Loading />}>
                  <SystemBRoutes />
                </Suspense>
              </LayoutRoute>
            }
          />

          {/* 系统 C 路由 */}
          <Route
            path="/system-c/*"
            element={
              <LayoutRoute>
                <Suspense fallback={<Loading />}>
                  <SystemCRoutes />
                </Suspense>
              </LayoutRoute>
            }
          />

          {/* 404 */}
          <Route path="*" element={<LayoutRoute><NotFound /></LayoutRoute>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}