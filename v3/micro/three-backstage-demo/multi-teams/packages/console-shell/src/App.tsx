import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { SubAppLoader } from './router/SubAppLoader';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore(s => s.isLoggedIn());
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/system-a/*"
          element={
            <ProtectedRoute>
              <Layout>
                <SubAppLoader />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/system-b/*"
          element={
            <ProtectedRoute>
              <Layout>
                <SubAppLoader />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/system-c/*"
          element={
            <ProtectedRoute>
              <Layout>
                <SubAppLoader />
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}