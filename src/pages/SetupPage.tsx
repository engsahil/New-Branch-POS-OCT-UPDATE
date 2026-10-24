import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { APP_CONFIG } from '@/config/app.config';
import { AUTH_CONFIG } from '@/config/auth.config';
import { authService } from '@/services/authService';
import { Button, Input, Spinner } from '@/components/ui';
import {
  AlertIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  UserIcon,
} from '@/components/ui/Icons';
// The two authentication screens share one style module on purpose:
// identical layout, type and controls, no duplicated CSS.
import styles from './LoginPage.module.css';

interface LocationState {
  from?: string;
}

type FieldErrors = {
  username?: string;
  password?: string;
  confirm?: string;
};

/**
 * First-run Sign-Up.
 *
 * Shown only while no administrator account exists on this terminal. The
 * operator chooses their own username and password; the account is created
 * through `authService.createInitialAdmin` (PBKDF2 hash, atomic write,
 * re-read verification). Success does NOT open the dashboard — the operator
 * is sent to Sign-In and authenticates like every later visit. Once an
 * account exists this screen redirects away, so it is never an open
 * registration page.
 */
export default function SetupPage() {
  const { status, isAuthenticated, needsInitialSetup, refreshSetupState } =
    useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;
  const nameRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /*
   * Set as soon as account creation succeeds (or turns out to be already
   * done), BEFORE the shared setup flag is refreshed. Once the flag flips
   * to "set up", the guard below would fire its own redirect to /login and
   * race — and overwrite — the success navigation that carries the
   * confirmation message. This local flag keeps the guard out of the way
   * while the component performs that one deliberate navigation itself.
   */
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  if (status === 'initialising' || needsInitialSetup === null) {
    return <Spinner fullscreen label="Checking session" />;
  }

  // Already signed in — there is nothing to set up.
  if (isAuthenticated) {
    return <Navigate to={state?.from ?? '/'} replace />;
  }

  // Navigation to Sign-In is already in progress after a successful
  // submission; render nothing interactive in the meantime.
  if (completed) {
    return <Spinner fullscreen label="Account created" />;
  }

  // An account already exists: initial setup is single-use. Everyone else
  // signs in; no further accounts can be created from this screen. The
  // incoming navigation state is forwarded so a post-Sign-Up confirmation
  // would survive this redirect.
  if (!needsInitialSetup) {
    return <Navigate to="/login" replace state={state} />;
  }

  const clearFieldError = (key: keyof FieldErrors) =>
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    // Mirrors the service rules so mistakes are explained field-by-field;
    // the service re-validates everything before writing.
    const found: FieldErrors = {};
    if (username.trim().length < AUTH_CONFIG.minUsernameLength) {
      found.username = `Username must be at least ${AUTH_CONFIG.minUsernameLength} characters.`;
    } else if (!/^[\w.@-]+$/.test(username.trim())) {
      found.username = 'Use only letters, numbers and . _ - @.';
    }
    if (password.length < AUTH_CONFIG.minPasswordLength) {
      found.password = `Password must be at least ${AUTH_CONFIG.minPasswordLength} characters.`;
    } else if (password !== confirmPassword) {
      found.confirm = 'Passwords do not match.';
    }
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const result = await authService.createInitialAdmin({
        displayName,
        username,
        password,
        confirmPassword,
      });

      // Never leave secrets sitting in component state.
      setPassword('');
      setConfirmPassword('');

      if (!result.ok) {
        if (result.alreadySetUp) {
          // Setup was completed (possibly in another tab at the same
          // moment). From here on, this terminal signs in normally.
          setCompleted(true);
          await refreshSetupState();
          navigate('/login', {
            replace: true,
            state: {
              from: state?.from,
              setupComplete: true,
              notice:
                'An administrator account has already been set up. Please sign in.',
            },
          });
          return;
        }
        setError(result.error ?? 'The account could not be created.');
        setSubmitting(false);
        return;
      }

      // Confirm from persisted state that setup is complete, then go to
      // Sign-In. Registration never signs the operator in by itself.
      setCompleted(true);
      await refreshSetupState();
      navigate('/login', {
        replace: true,
        state: {
          from: state?.from,
          setupComplete: true,
          accountCreated: true,
          username: result.username ?? username.trim(),
        },
      });
    } catch (err) {
      // Hand the form back (also clears the completed flag if the post-create
      // refresh/navigation failed, so the operator is never stuck).
      setCompleted(false);
      setError(
        err instanceof Error
          ? err.message
          : 'The account could not be created. Please try again.',
      );
      setPassword('');
      setConfirmPassword('');
      setSubmitting(false);
    }
  };

  const passwordType = showPasswords ? 'text' : 'password';
  const revealButton = (label: string) => (
    <button
      type="button"
      className={styles.reveal}
      onClick={() => setShowPasswords((v) => !v)}
      aria-label={showPasswords ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={showPasswords}
      tabIndex={-1}
    >
      {showPasswords ? (
        <EyeOffIcon width={17} height={17} />
      ) : (
        <EyeIcon width={17} height={17} />
      )}
    </button>
  );

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
          <h1 className={styles.title}>Create your account</h1>
          <p className={styles.subtitle}>
            First-time setup. Create the administrator account for this
            terminal and set a password. You will sign in with it next.
          </p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Input
            ref={nameRef}
            id="displayName"
            name="displayName"
            label="Your name (optional)"
            autoComplete="name"
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={submitting}
            fullWidth
          />

          <Input
            id="newUsername"
            name="newUsername"
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              clearFieldError('username');
            }}
            leadingIcon={<UserIcon />}
            invalid={Boolean(fieldErrors.username)}
            hint={
              fieldErrors.username ??
              `At least ${AUTH_CONFIG.minUsernameLength} characters. You will sign in with this.`
            }
            disabled={submitting}
            fullWidth
          />

          <div className={styles.passwordField}>
            <Input
              id="newPassword"
              name="newPassword"
              label="Password"
              type={passwordType}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError('password');
              }}
              leadingIcon={<LockIcon />}
              invalid={Boolean(fieldErrors.password)}
              hint={
                fieldErrors.password ??
                `At least ${AUTH_CONFIG.minPasswordLength} characters.`
              }
              disabled={submitting}
              fullWidth
              className={styles.passwordInput}
            />
            {revealButton('password')}
          </div>

          <div className={styles.passwordField}>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              label="Confirm password"
              type={passwordType}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                clearFieldError('confirm');
              }}
              leadingIcon={<LockIcon />}
              invalid={Boolean(fieldErrors.confirm)}
              hint={fieldErrors.confirm}
              disabled={submitting}
              fullWidth
              className={styles.passwordInput}
            />
            {revealButton('confirm password')}
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
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </main>

      <p className={styles.version}>
        {APP_CONFIG.name} v{APP_CONFIG.version}
      </p>
    </div>
  );
}
