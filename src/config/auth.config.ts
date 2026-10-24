/**
 * Authentication configuration.
 *
 * SECURITY NOTE
 *
 * A bundled application cannot keep a secret. Anything referenced here through
 * `import.meta.env` is inlined into the JavaScript that is served to the
 * browser, where anyone can read it. An audit confirmed the previous build
 * shipped the bootstrap password in plain text inside `dist/assets/index-*.js`.
 *
 * The fix is not to obfuscate it but to stop shipping one. On first run the
 * application opens an account-creation (Sign-Up) screen where the operator
 * chooses their own username and password. No account exists — and nothing
 * secret is embedded in the build — until they submit that form. Once the
 * account exists, the Sign-Up screen is closed and every later visit goes
 * through Sign-In.
 *
 * `VITE_ADMIN_PASSWORD` is still honoured for automated testing and for
 * controlled kiosk provisioning, but it is explicitly documented as insecure
 * and the UI warns when it is in use.
 */

const env = import.meta.env;

const DEFAULT_USERNAME = 'admin';

/**
 * A provisioning password supplied at build time.
 *
 * Empty in a normal build. When set, it is visible in the bundle - acceptable
 * only for test automation or a device that is provisioned and then has its
 * password changed immediately.
 */
const PROVISIONED_PASSWORD = (env.VITE_ADMIN_PASSWORD ?? '').trim();

export const AUTH_CONFIG = {
  /** Seed username for first run. */
  bootstrapUsername: (env.VITE_ADMIN_USERNAME ?? DEFAULT_USERNAME).trim(),

  /**
   * Build-time password, if one was provisioned. Empty means the application
   * generates a random setup password instead.
   */
  provisionedPassword: PROVISIONED_PASSWORD,

  /** True when a password was baked into the build, which is not secure. */
  usingProvisionedPassword: PROVISIONED_PASSWORD.length > 0,

  /** How long a signed-in session stays valid. */
  sessionDurationMs: 12 * 60 * 60 * 1000, // 12 hours

  /*
   * Failed sign-ins are NOT subject to a timed cooldown or account lockout
   * (product policy): a wrong password returns an error and the operator may
   * retry immediately. An earlier version locked the form for 60 seconds
   * after 5 failures; that timer lived in localStorage, so anyone with
   * physical access to the terminal could clear it anyway — it inconvenienced
   * legitimate operators without stopping a real attacker. What actually
   * slows password guessing here is the PBKDF2 work factor below, which is
   * paid on every attempt and cannot be cleared from storage. Password
   * verification itself is unchanged: wrong credentials never authenticate.
   */

  /** Minimum length enforced for a username. */
  minUsernameLength: 3,

  /** Minimum length enforced when setting or changing the password. */
  minPasswordLength: 6,

  /** PBKDF2 parameters. */
  pbkdf2Iterations: 150_000,
  saltBytes: 16,
  keyBytes: 32,
} as const;

/** Record id used for the admin credential document in the settings store. */
export const ADMIN_CREDENTIALS_ID = 'admin.credentials';
