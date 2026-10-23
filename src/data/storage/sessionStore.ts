/**
 * Session persistence.
 *
 * The session lives in localStorage so a refresh or an app restart keeps the
 * operator signed in — important for a POS terminal that may reload. It stores
 * only an opaque token, the username and expiry: no password material.
 */

import type { AuthSession } from '@/types/auth';

const SESSION_KEY = 'pos.auth.session';
/**
 * Legacy failed-attempt/lockout key written by older builds.
 *
 * The wrong-password cooldown has been removed at its source, so nothing
 * reads or writes this value anymore. The key is only kept so `clearAttempts`
 * can delete a stale lockout record left behind by an older build — an
 * operator who was mid-lockout when the terminal updated must be able to
 * sign in straight away.
 */
const ATTEMPTS_KEY = 'pos.auth.attempts';

function available(): boolean {
  try {
    const probe = '__pos_session_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const enabled = typeof window !== 'undefined' && available();

/** In-memory fallback so auth still works in private/blocked-storage modes. */
let memorySession: AuthSession | null = null;

function isSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.token === 'string' &&
    typeof s.username === 'string' &&
    typeof s.issuedAt === 'number' &&
    typeof s.expiresAt === 'number'
  );
}

export const sessionStore = {
  read(): AuthSession | null {
    if (!enabled) return memorySession;
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isSession(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },

  write(session: AuthSession): void {
    memorySession = session;
    if (!enabled) return;
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage full — the in-memory copy still works for this tab */
    }
  },

  clear(): void {
    memorySession = null;
    if (!enabled) return;
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* no-op */
    }
  },

  /**
   * Delete any legacy failed-attempt/lockout record.
   *
   * Failed attempts are no longer counted and sign-in is never locked, so
   * this is purely an upgrade cleanup: it makes sure a lockout written by an
   * older build can never be honoured again.
   */
  clearAttempts(): void {
    if (!enabled) return;
    try {
      window.localStorage.removeItem(ATTEMPTS_KEY);
    } catch {
      /* no-op */
    }
  },
};
