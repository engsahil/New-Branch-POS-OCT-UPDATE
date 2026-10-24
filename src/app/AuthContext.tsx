import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authService } from '@/services/authService';
import type { AuthStatus, AuthUser, LoginResult } from '@/types/auth';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  isAuthenticated: boolean;
  /**
   * Whether this terminal still needs its one-time first-run account
   * creation. `null` while the persisted account state is being read.
   * Sourced from the actual credential record, never a local flag.
   */
  needsInitialSetup: boolean | null;
  /** Set when bootstrap/restore fails (e.g. storage unavailable). */
  error: string | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  /** Re-read the user after a credential change. */
  refresh: () => Promise<void>;
  /** Re-read whether initial setup is still required (e.g. after Sign-Up). */
  refreshSetupState: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initialising');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsInitialSetup, setNeedsInitialSetup] = useState<boolean | null>(
    null,
  );

  // Restore any existing session on mount so a refresh keeps the user in.
  // The initial-setup state is read from the same persisted account record
  // in the same pass, so the first screen can be decided correctly: a fresh
  // terminal goes to Sign-Up, an existing one to Sign-In.
  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const restored = await authService.restore();
        if (!active) return;
        setUser(restored);
        setStatus(restored ? 'authenticated' : 'unauthenticated');
        // An authenticated session proves an account exists; only an
        // unauthenticated terminal needs the setup check.
        setNeedsInitialSetup(
          restored ? false : await authService.needsInitialSetup(),
        );
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : 'Failed to start authentication.',
        );
        setStatus('error');
        // Storage could not be read, so setup state is unknowable. Fall
        // through to Sign-In (which surfaces the real error on submit)
        // instead of leaving route guards waiting on `null` forever.
        setNeedsInitialSetup(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      const result = await authService.login(username, password);
      if (result.ok) {
        const current = await authService.currentUser();
        setUser(current);
        setStatus(current ? 'authenticated' : 'unauthenticated');
        if (current) setNeedsInitialSetup(false);
      } else if (result.needsInitialSetup) {
        setNeedsInitialSetup(true);
      }
      return result;
    },
    [],
  );

  const logout = useCallback(() => {
    // Clear local state immediately; token invalidation is best effort and
    // must never delay signing out.
    void authService.logout();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const refresh = useCallback(async () => {
    const current = await authService.currentUser();
    setUser(current);
    setStatus(current ? 'authenticated' : 'unauthenticated');
  }, []);

  const refreshSetupState = useCallback(async () => {
    setNeedsInitialSetup(await authService.needsInitialSetup());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated' && user !== null,
      needsInitialSetup,
      error,
      login,
      logout,
      refresh,
      refreshSetupState,
    }),
    [
      status,
      user,
      needsInitialSetup,
      error,
      login,
      logout,
      refresh,
      refreshSetupState,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}
