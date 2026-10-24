import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { ROUTE_PATHS } from '@/app/routes';
import { APP_CONFIG } from '@/config/app.config';
import { Button, Input, Spinner } from '@/components/ui';
import {
  AlertIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  UserIcon,
} from '@/components/ui/Icons';
import styles from './LoginPage.module.css';

interface LocationState {
  from?: string;
  /** Set right after the one-time Sign-Up, to confirm and prefill. */
  accountCreated?: boolean;
  /** Generic one-line notice (e.g. setup was completed in another tab). */
  notice?: string;
  username?: string;
  /**
   * Set by the Sign-Up screen after the service has verified the account
   * is persisted. Prevents a one-render bounce back to /setup while the
   * auth context's setup flag is still catching up after navigation.
   */
  setupComplete?: boolean;
}

export default function LoginPage() {
  const { status, isAuthenticated, needsInitialSetup, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Right after Sign-Up the username is known: prefill it so the operator
  // only has to type the password they just set.
  const [username, setUsername] = useState(state?.username ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const notice = state?.accountCreated
    ? 'Account created successfully. Please sign in.'
    : (state?.notice ?? null);

  /*
   * Where a successful sign-in goes.
   *
   * The intended flow is Setup -> Sign-In -> Dashboard, so a plain visit to
   * the app opens the Dashboard rather than dropping the operator straight
   * onto the till. A visitor redirected here from a protected URL still
   * returns to exactly that URL; the index path ('/') is not a deep link,
   * so it is treated as a plain visit.
   */
  const destination =
    state?.from && state.from !== ROUTE_PATHS.pos
      ? state.from
      : ROUTE_PATHS.dashboard;

  useEffect(() => {
    if (state?.username) {
      passwordRef.current?.focus();
    } else {
      usernameRef.current?.focus();
    }
    // Focus once on mount; the location state does not change under us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'initialising' || needsInitialSetup === null) {
    return <Spinner fullscreen label="Checking session" />;
  }

  // Already signed in — bounce to wherever they were headed, or the
  // Dashboard when they simply opened the app.
  if (isAuthenticated) {
    return <Navigate to={destination} replace />;
  }

  // No account exists yet on this terminal: the first screen is Sign-Up,
  // not a login form for credentials nobody has created.
  if (needsInitialSetup && !state?.setupComplete) {
    return <Navigate to="/setup" replace state={{ from: state?.from }} />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(username, password);

      if (!result.ok) {
        // The account disappeared or was never created (e.g. storage was
        // cleared in another tab): route to first-run setup.
        if (result.needsInitialSetup) {
          navigate('/setup', { replace: true });
          return;
        }
        /*
         * Wrong credentials: show the error and hand the form straight
         * back. There is no cooldown, countdown or lockout — the next
         * attempt can be made immediately.
         */
        setError(result.error ?? 'Sign in failed.');
        setPassword('');
        setSubmitting(false);
        passwordRef.current?.focus();
        return;
      }

      navigate(destination, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Sign in failed. Please try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <main className={styles.panel}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path
                d="M5 8.5h14M5 8.5 6.5 18h11L19 8.5M5 8.5 7.5 5h9L19 8.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.subtitle}>
            Administrator access is required to use this terminal.
          </p>
        </div>

        {notice ? (
          <p className={styles.notice} role="status">
            <CheckIcon width={16} height={16} className={styles.noticeIcon} />
            <span>{notice}</span>
          </p>
        ) : null}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Input
            ref={usernameRef}
            id="username"
            name="username"
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            leadingIcon={<UserIcon />}
            disabled={submitting}
            fullWidth
          />

          <div className={styles.passwordField}>
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leadingIcon={<LockIcon />}
              disabled={submitting}
              fullWidth
              className={styles.passwordInput}
            />
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOffIcon width={17} height={17} />
              ) : (
                <EyeIcon width={17} height={17} />
              )}
            </button>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              <AlertIcon width={16} height={16} className={styles.errorIcon} />
              <span>{error}</span>
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={submitting}
            className={styles.submit}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </main>

      <p className={styles.version}>
        {APP_CONFIG.name} v{APP_CONFIG.version}
      </p>
    </div>
  );
}
