# Restaurant POS v5.1.9 — First-Time Authentication Flow + Dashboard Banner Polish

Scoped update on top of the merged v5.1.9 redesign. No framework, database or
deployment changes; no new dependencies; no production data touched.

## 1. First-time setup: Sign-Up first, then Sign-In

**Before:** opening a fresh terminal showed Sign-In and silently
auto-created an `admin` account with a random one-time password shown on
that screen.

**Now:** whether an account exists is read from the real persisted
credential record in IndexedDB (`admin.credentials`) — never a frontend
flag.

- **First visit → `/setup` (Sign-Up):** "Create your account" with optional
  name, username, password and password confirmation, field validation,
  show/hide password, and a loading state — visually identical to Sign-In
  (one shared style module).
- Submitting calls `authService.createInitialAdmin()`: service-side
  validation, **PBKDF2-SHA256 only** (150,000 iterations, per-account salt;
  plaintext never stored), written in a single read-write IndexedDB
  transaction with `add` so two simultaneous setup submissions cannot both
  succeed or overwrite each other, then **re-read and verified** before
  success is reported.
- **Registration does not sign in.** It redirects to Sign-In with
  “Account created successfully. Please sign in.” and the username
  prefilled. No session is created by Sign-Up.
- **Returning visits:** signed-out users get Sign-In; `/setup` redirects to
  `/login` once an account exists — this is a single-administrator product,
  so there is no open public registration after setup.
- Protected routes (`RequireAuth`) send signed-out users to `/setup` only
  while no account exists, otherwise to `/login`, preserving the intended
  destination. Directly opening `/dashboard` signed-out never renders it.
- Sessions, token binding, logout, roles and Settings → Security behaviour
  are unchanged. Existing accounts — including terminals still on a legacy
  initial password (`mustChangePassword`) and build-time provisioned
  accounts (`VITE_ADMIN_PASSWORD`, test/kiosk only) — are recognised as set
  up, never sent to Sign-Up, and never replaced or reset by it.

Architecture note: this application is **offline-first and frontend-only**
(IndexedDB is the system of record; the optional sync backend is inert
unless configured and never carries credentials). The change uses that
existing mechanism as-is and does not pretend client-side storage is a
remote identity provider: password verification is enforced on every
sign-in, sessions are token-bound to the account record, and authentication
protects the terminal UI exactly as before.

## 2. Wrong-password cooldown removed at the source

**Exact cause found:** `authService` counted failures in `localStorage`
(`pos.auth.attempts`) and, after 5, locked sign-in for 60 seconds
(`AUTH_CONFIG.maxFailedAttempts` / `lockoutDurationMs`). There is no
backend auth endpoint, middleware rate limiter or third-party auth provider
in this project — the application code above was the entire source.

**Fix:** the counter, the lockout gate, the configuration values and the
“Too many failed attempts” message were deleted (not hidden). Every attempt
is verified against the stored PBKDF2 hash on its own merits:

- Wrong password → “Incorrect username or password.” and the form is
  immediately usable again — on the 1st, 6th or 60th failure.
- Correct password immediately after any number of failures → signs in.
- Wrong credentials never authenticate; password verification, session
  binding and protected routes are untouched. The 150k-iteration PBKDF2
  cost is still paid on every attempt and cannot be cleared from storage
  (the old timer could be, by anyone at the terminal — which is why it
  only punished legitimate operators).
- Upgrade safety: a stale lockout record written by an older build is
  deleted on startup/sign-in, so nobody stays locked out after updating.

## 3. Dashboard banner polish

- The **“Change banner” / “Add banner” overlay button is gone** from the
  dashboard (markup and CSS removed). The banner is presentation-only.
- A **professional built-in restaurant banner** ships with the app
  (`src/assets/default-restaurant-banner.jpg`, 1600×500, ~111 KB,
  generated for this project — no watermark, no remote URL) and is
  **precached by the service worker**, so it renders immediately and
  offline. `scripts/build-sw.mjs` now precaches `.jpg/.jpeg/.webp` build
  assets for this reason.
- Banner content is minimal: **restaurant name + “Welcome back.”** plus the
  configured tagline only if one exists. The “N orders completed today”
  statistic was removed from the banner (it remains on the KPI cards, as
  before).
- **Customisation is in Settings:** a new “Dashboard banner” card in
  **Settings → Appearance** shows a wide preview of the active banner,
  upload/replace, **Restore default**, and an explicit **Save banner**
  with Saved/error feedback. Saving re-reads the profile and changes only
  the banner field. The existing banner picker in **Settings → Restaurant**
  keeps working and now previews the built-in default when no custom
  banner is set. Choices persist in the restaurant record as before and
  survive refreshes and restarts.

## Verification (actually run)

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no diagnostics |
| `npm test` (IndexedDB, data port, receipts, v5.1.9, **auth fresh**, **auth legacy**) | all pass |
| `node scripts/smoke-setup.mjs` (new, Happy DOM, normal build) | 31 checks pass: fresh → Sign-Up, validation, redirect to Sign-In (no session), 6 wrong passwords with immediate retry and no cooldown text, correct password works, built-in banner + no overlay, Settings → Appearance banner card, sign-out → Sign-In, protected-route and closed-`/setup` guards, later sign-ins |
| `node scripts/smoke-ui.mjs` (existing, provisioned throwaway build, rebuilt normal afterwards) | all 18 checks pass: sign-in, 10 routes, appearance persistence, no duplicate dashboard, wizard skipped for existing installs |
| `npm run build` (normal) | succeeds; service worker precaches 61 files incl. the banner; bundle contains no test password |

`scripts/test-auth.mjs` covers at service level (isolated in-memory
IndexedDB, real PBKDF2): setup-required detection, no account created by
merely opening the app or by failed validation, simultaneous setup races
(exactly one winner), PBKDF2-only storage, no auto-session, no repeat
registration, 12 wrong passwords with no lockout followed by a successful
sign-in, forged/replayed session rejection, banner persistence/default
restore, plus legacy-account preservation, rotation and business-data
intactness in `AUTH_TEST_MODE=legacy`.

**Production data statement:** all tests ran against isolated in-memory
databases (`fake-indexeddb`). No production/terminal database was opened,
reset or modified; no users were deleted; no business records were touched.
Existing terminals upgrade in place: their account record is simply
recognised as “set up”.

## Known limitations (unchanged from the existing architecture)

- Authentication is local to the terminal (offline-first PWA). It gates the
  application UI and holdings on that device/browser profile; it is not a
  multi-device identity system. Someone who deletes the browser's site
  data deletes the terminal's database *and* its account — as with every
  record in this app — so terminals should use the existing backup/export.
- No timed lockout now exists by design (see §2). Physical terminal access
  controls and a strong operator password remain the effective protections,
  together with the per-attempt PBKDF2 cost.
- Happy DOM smoke tests verify behaviour and DOM, not pixel layout; banner
  cropping uses the same `object-fit: cover` rules as the previous custom
  banner and was checked at the asset's 16:5 crop.
