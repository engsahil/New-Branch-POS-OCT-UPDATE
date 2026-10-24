import type { ISODateString } from './common';
import type { AdminRecord } from './domain';

/**
 * Persisted admin credential record. Never contains a plaintext password.
 * Alias of the canonical AdminRecord so there is one shape, one store.
 */
export type AdminCredentials = AdminRecord;

/** The signed-in user as exposed to the UI. */
export interface AuthUser {
  username: string;
  role: 'admin';
  lastLoginAt?: ISODateString | null;
  mustChangePassword: boolean;
  /** Optional display name, falling back to the username in the UI. */
  displayName?: string;
  email?: string;
  phone?: string;
}

/** Persisted session. Holds no credential material. */
export interface AuthSession {
  token: string;
  username: string;
  issuedAt: number;
  expiresAt: number;
}

export type AuthStatus =
  | 'initialising'
  | 'authenticated'
  | 'unauthenticated'
  | 'error';

export interface LoginResult {
  ok: boolean;
  /** Human-readable, deliberately non-specific on credential failure. */
  error?: string;
  /**
   * Present when sign-in was attempted before any administrator account
   * exists. The UI routes to the one-time Sign-Up screen in that case.
   * There is deliberately no lockout/cooldown field: a wrong password may
   * always be retried immediately.
   */
  needsInitialSetup?: boolean;
}

/** Result of the one-time first-run account creation. */
export interface CreateInitialAdminResult {
  ok: boolean;
  /** Human-readable reason when account creation did not happen. */
  error?: string;
  /**
   * True when account creation was refused because an administrator account
   * already exists — initial setup is single-use and is never offered again
   * (including to a second tab submitting at the same moment).
   */
  alreadySetUp?: boolean;
  /** The username that was created. Never carries password material. */
  username?: string;
}
