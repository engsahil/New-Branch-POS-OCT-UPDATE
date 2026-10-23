import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { Spinner } from '@/components/ui';
import { AuthProvider } from './AuthContext';
import { RequireAuth } from './RequireAuth';
import { appRoutes } from './routes';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SetupPage = lazy(() => import('@/pages/SetupPage'));

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<Spinner fullscreen label="Loading" />}>
          <Routes>
            {/*
              Public. /setup is the one-time first-run Sign-Up screen; it
              redirects to /login as soon as an account exists, so it is
              never an open registration page.
            */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />

            {/* Everything else requires an authenticated admin */}
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              {appRoutes.map((route) =>
                route.index ? (
                  <Route key={route.id} index element={route.element} />
                ) : (
                  <Route
                    key={route.id}
                    path={route.path}
                    element={route.element}
                  />
                ),
              )}
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}
