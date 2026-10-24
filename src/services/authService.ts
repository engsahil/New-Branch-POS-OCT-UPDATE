/**
 * Authentication service.
 *
 * Owns first-run account creation, credential verification, session lifecycle
 * and credential changes. Pure logic with no React dependency so it can be
 * tested directly.
 *
 * Security notes:
 *  - Passwords are stored only as PBKDF2-SHA256 hashes with a per-account salt.
 *  - No account is created automatically. On a fresh installation the
 *    operator creates the single administrator account on the Sign-Up screen
 *    (`createInitialAdmin`); anything else asking "who am I?" before that
 *    point is told initial setup is required instead of being handed a
 *    silently generated account. (The one exception is a build-time
 *    provisioned password for test automation / kiosk provisioning — see
 *    auth.config.ts — which is documented as insecure.)
 *  - Login failures return a single generic message so the response cannot be
 *    used to enumerate valid usernames.
 *  - There is deliberately no timed lockout after failed attempts: a wrong
 *    password is rejected and may be retried immediately. The old lockout was
 *    a localStorage timer that a physically present attacker could simply
 *    clear, so it only ever locked out legitimate operators. The PBKDF2 work
 *    factor on every attempt remains and cannot be switched off.
 */

import { ADMIN_CREDENTIALS_ID, AUTH_CONFIG } from '@/config/auth.config';
import { STORES } from '@/config/storage.config';
import { db } from '@/data/db/indexedDb';
import { adminRepository, buildEntity } from '@/data/repositories';
import { sessionStore } from '@/data/storage/sessionStore';
import type {
  AdminCredentials,
  AuthSession,
  AuthUser,
  CreateInitialAdminResult,
  LoginResult,
} from '@/types/auth';
import {
  createToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '@/utils/crypto';
import { nowISO } from '@/utils/date';

const GENERIC_FAILURE = 'Incorrect username or password.';
const SETUP_REQUIRED =
  'No administrator account exists yet. Create your account to continue.';
const ALREADY_SET_UP =
  'An administrator account has already been set up. Please sign in.';

/**
 * Usernames for new accounts: letters, digits and the separators an operator
 * might reasonably use, including `@` for an email-style username. Applied
 * when the account is created — sign-in always compares against whatever is
 * stored, so existing accounts are never affected.
 */
const USERNAME_PATTERN = /^[\w.@-]+$/;

function toUser(record: AdminCredentials): AuthUser {
  return {
    username: record.username,
    role: 'admin',
    lastLoginAt: record.lastLoginAt ?? null,
    mustChangePassword: record.mustChangePassword,
    displayName: record.displayName ?? '',
    email: record.email ?? '',
    phone: record.phone ?? '',
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readCredentials(): Promise<AdminCredentials | undefined> {
  return adminRepository.getById(ADMIN_CREDENTIALS_ID);
}

/**
 * Materialise the build-time PROVISIONED account, if one was configured.
 *
 * In a normal build `VITE_ADMIN_PASSWORD` is empty and this returns whatever
 * account the operator created on the Sign-Up screen — or `null` when no
 * account exists yet. It never generates an account out of thin air.
 *
 * When a password WAS provisioned at build time (test automation / kiosk
 * provisioning), the first call creates that account flagged
 * `mustChangePassword`, exactly as before. Subsequent calls are a no-op, so
 * changing the env vars later never silently resets a live account.
 */
async function ensureBootstrapped(): Promise<AdminCredentials | null> {
  const existing = await readCredentials();
  if (existing) return existing;

  if (!AUTH_CONFIG.usingProvisionedPassword) return null;

  try {
    return await adminRepository.create({
      id: ADMIN_CREDENTIALS_ID,
      username: AUTH_CONFIG.bootstrapUsername,
      password: await hashPassword(AUTH_CONFIG.provisionedPassword),
      role: 'admin',
      // The operator must set their own password before trading.
      mustChangePassword: true,
      lastLoginAt: null,
    });
  } catch {
    // A concurrent first run may have created the record first.
    return (await readCredentials()) ?? null;
  }
}

/** Read the account for an authenticated-only operation, or fail cleanly. */
async function requireCredentials(): Promise<AdminCredentials> {
  const record = await ensureBootstrapped();
  if (!record) {
    throw new Error(SETUP_REQUIRED);
  }
  return record;
}

/**
 * Mint a session and bind it to the account record.
 *
 * The token's hash is stored on the account, so a session object written by
 * hand into localStorage cannot be honoured: its token will not match.
 */
async function createSession(username: string): Promise<AuthSession> {
  const issuedAt = Date.now();
  const token = createToken();

  await adminRepository.update(ADMIN_CREDENTIALS_ID, {
    sessionTokenHash: await hashToken(token),
  } as Partial<AdminCredentials>);

  return {
    token,
    username,
    issuedAt,
    expiresAt: issuedAt + AUTH_CONFIG.sessionDurationMs,
  };
}

export const authService = {
  ensureBootstrapped,

  /**
   * True when this terminal has no administrator account yet and the
   * one-time Sign-Up screen must be shown.
   *
   * This reads the real persisted account record (IndexedDB) — never a
   * frontend flag — so the answer stays correct across refreshes, restarts
   * and updates. A build-time provisioned account counts as set up.
   */
  async needsInitialSetup(): Promise<boolean> {
    return (await ensureBootstrapped()) === null;
  },

  /**
   * Create the single administrator account on first run.
   *
   *  - Validates username, password length and confirmation server-side
   *    (well, service-side: never trust the form alone).
   *  - Stores only a PBKDF2 hash; the plaintext password is never persisted.
   *  - Writes the record inside a single read-write transaction using
   *    `add`, so two setup forms submitted at the same moment cannot both
   *    succeed or overwrite each other — the second is told the account
   *    already exists.
   *  - Re-reads the stored record and verifies the hash matches what was
   *    written before reporting success.
   *  - Deliberately does NOT create a session: the operator signs in with
   *    the password they just set, like every later visit.
   */
  async createInitialAdmin(input: {
    displayName?: string;
    username: string;
    password: string;
    confirmPassword: string;
  }): Promise<CreateInitialAdminResult> {
    const username = input.username.trim();
    const displayName = (input.displayName ?? '').trim().slice(0, 60);

    if (username.length < AUTH_CONFIG.minUsernameLength) {
      return {
        ok: false,
        error: `Username must be at least ${AUTH_CONFIG.minUsernameLength} characters.`,
      };
    }
    if (!USERNAME_PATTERN.test(username) || username.length > 40) {
      return {
        ok: false,
        error:
          'Use only letters, numbers and . _ - @ in the username (maximum 40 characters).',
      };
    }
    if (input.password.length < AUTH_CONFIG.minPasswordLength) {
      return {
        ok: false,
        error: `Password must be at least ${AUTH_CONFIG.minPasswordLength} characters.`,
      };
    }
    if (input.password !== input.confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }

    /*
     * If an account already exists (created earlier, imported with the
     * terminal's data, or provisioned at build time) initial setup is
     * closed. This is what stops open-ended public sign-up: there is
     * exactly one administrator account and it can be created only once.
     */
    const existing = await ensureBootstrapped();
    if (existing) {
      return { ok: false, error: ALREADY_SET_UP, alreadySetUp: true };
    }

    // Hash BEFORE opening the transaction: IndexedDB transactions
    // auto-commit while they idle, and PBKDF2 takes real time.
    const hashed = await hashPassword(input.password);

    const record = buildEntity<AdminCredentials>({
      id: ADMIN_CREDENTIALS_ID,
      username,
      password: hashed,
      role: 'admin',
      // The operator chose this password; there is no forced rotation.
      mustChangePassword: false,
      lastLoginAt: null,
      displayName,
      sessionTokenHash: null,
    });

    try {
      await db.transaction([STORES.admin], 'readwrite', async (stores) => {
        const store = stores[STORES.admin];
        if (!store) throw new Error('Admin store unavailable.');
        const found = await db.request(store.get(ADMIN_CREDENTIALS_ID));
        if (found !== undefined) {
          throw new Error(ALREADY_SET_UP);
        }
        // `add` (not `put`) fails loudly instead of overwriting an account
        // that appeared between the check and the write.
        await db.request(store.add(record));
      });
    } catch (err) {
      // Lost a simultaneous setup race: the other account wins and this
      // caller is sent to Sign-In like everyone else.
      if (await readCredentials()) {
        return { ok: false, error: ALREADY_SET_UP, alreadySetUp: true };
      }
      throw err;
    }

    // Prove the account really landed in storage before reporting success.
    const stored = await readCredentials();
    const persisted =
      stored !== undefined &&
      stored.username === username &&
      stored.password.hash === hashed.hash &&
      stored.password.salt === hashed.salt;
    if (!persisted) {
      return {
        ok: false,
        error: 'The account could not be saved. Please try again.',
      };
    }

    return { ok: true, username };
  },

  /** Resolve the current user from a stored, unexpired session. */
  async restore(): Promise<AuthUser | null> {
    // One-time upgrade cleanup: drop a legacy lockout record, if any.
    sessionStore.clearAttempts();

    const session = sessionStore.read();
    if (!session) return null;

    if (Date.now() >= session.expiresAt) {
      sessionStore.clear();
      return null;
    }

    const record = await readCredentials();
    if (!record) {
      sessionStore.clear();
      return null;
    }

    // Username changes invalidate an existing session.
    if (record.username !== session.username) {
      sessionStore.clear();
      return null;
    }

    /*
     * Verify the token against the hash bound to the account at sign-in.
     * Without this a session object written by hand into localStorage would
     * be accepted, granting admin access with no password - an authentication
     * bypass found during the security audit.
     */
    const expected = record.sessionTokenHash;
    if (!expected) {
      sessionStore.clear();
      return null;
    }

    const presented = await hashToken(session.token);
    if (presented !== expected) {
      sessionStore.clear();
      return null;
    }

    return toUser(record);
  },

  async login(username: string, password: string): Promise<LoginResult> {
    /*
     * No lockout gate, no failure counter: every attempt is verified against
     * the stored hash on its own merits, so an operator who mistypes can
     * retry immediately while wrong credentials never authenticate.
     */
    sessionStore.clearAttempts();

    const record = await ensureBootstrapped();
    if (!record) {
      return { ok: false, error: SETUP_REQUIRED, needsInitialSetup: true };
    }

    const usernameMatches =
      record.username.toLowerCase() === username.trim().toLowerCase();
    const passwordMatches = await verifyPassword(password, record.password);

    // Both checks always run so timing does not reveal which one failed.
    if (!usernameMatches || !passwordMatches) {
      return { ok: false, error: GENERIC_FAILURE };
    }

    sessionStore.write(await createSession(record.username));

    await adminRepository.update(record.id, { lastLoginAt: nowISO() });

    return { ok: true };
  },

  async logout(): Promise<void> {
    sessionStore.clear();
    // Invalidate the token so a copied session cannot be replayed later.
    try {
      await adminRepository.update(ADMIN_CREDENTIALS_ID, {
        sessionTokenHash: null,
      } as Partial<AdminCredentials>);
    } catch {
      /* the local session is already cleared; this is best effort */
    }
  },

  /** Current user, or null. Reads persisted state only. */
  async currentUser(): Promise<AuthUser | null> {
    return this.restore();
  },

  /**
   * Save the administrator's contact details.
   *
   * Independent of credentials: this never touches the password, the username
   * or the session, so it cannot be used to weaken account security.
   */
  async updateProfile(input: {
    displayName: string;
    email: string;
    phone: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const record = await requireCredentials();
    const email = input.email.trim();
    const phone = input.phone.trim();

    if (email && !EMAIL_PATTERN.test(email)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    if (phone && phone.replace(/\D/g, '').length < 6) {
      return { ok: false, error: 'Enter a valid phone number.' };
    }

    await adminRepository.update(record.id, {
      displayName: input.displayName.trim().slice(0, 60),
      email: email.slice(0, 120),
      phone: phone.slice(0, 30),
    } as Partial<AdminCredentials>);

    return { ok: true };
  },

  /**
   * Change username and/or password. Requires the current password.
   * Used by Admin settings.
   */
  async changeCredentials(input: {
    currentPassword: string;
    newUsername?: string;
    newPassword?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const record = await requireCredentials();

    const valid = await verifyPassword(input.currentPassword, record.password);
    if (!valid) {
      return { ok: false, error: 'Current password is incorrect.' };
    }

    const nextUsername = input.newUsername?.trim() || record.username;
    if (nextUsername.length < AUTH_CONFIG.minUsernameLength) {
      return {
        ok: false,
        error: `Username must be at least ${AUTH_CONFIG.minUsernameLength} characters.`,
      };
    }

    let password = record.password;
    let mustChangePassword = record.mustChangePassword;

    if (input.newPassword) {
      if (input.newPassword.length < AUTH_CONFIG.minPasswordLength) {
        return {
          ok: false,
          error: `Password must be at least ${AUTH_CONFIG.minPasswordLength} characters.`,
        };
      }
      password = await hashPassword(input.newPassword);
      mustChangePassword = false;
    }

    await adminRepository.update(record.id, {
      username: nextUsername,
      password,
      mustChangePassword,
    });

    /*
     * A password change must not leave an old session usable. Re-bind the
     * current session so this device stays signed in while any other copy
     * of the previous token stops working.
     */
    const current = sessionStore.read();
    if (current) {
      const rebound = await createSession(nextUsername);
      sessionStore.write(rebound);
    }

    // Keep the active session valid under the new username.
    const session = sessionStore.read();
    if (session) {
      sessionStore.write({ ...session, username: nextUsername });
    }

    return { ok: true };
  },
};
