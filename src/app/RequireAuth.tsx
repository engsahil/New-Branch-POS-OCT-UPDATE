import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from '@/components/ui';

/**
 * Route guard. Blocks rendering until the session — and, on a fresh
 * terminal, the initial-setup state — has been resolved. Unauthenticated
 * visitors are then sent to the Sign-Up screen when no account exists yet,
 * otherwise to Sign-In, remembering where they were headed either way.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, isAuthenticated, needsInitialSetup } = useAuth();
  const location = useLocation();

  if (status === 'initialising' || (!isAuthenticated && needsInitialSetup === null)) {
    return <Spinner fullscreen label="Checking session" />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to={needsInitialSetup ? '/setup' : '/login'}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  return <>{children}</>;
}
