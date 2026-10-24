/**
 * Authentication checks for the v5.1.9 first-run Sign-Up flow and the
 * removal of the wrong-password cooldown.
 *
 * Two isolated scenarios, selected with AUTH_TEST_MODE:
 *
 *   node scripts/test-auth.mjs                      fresh terminal (default)
 *   AUTH_TEST_MODE=legacy node scripts/test-auth.mjs  existing account
 *
 * Fresh mode proves: no account exists until Sign-Up is submitted, setup
 * validation failures persist nothing, simultaneous setup attempts produce
 * exactly one account, registration does NOT sign the operator in, repeat
 * wrong passwords never trigger a cooldown, the correct password works
 * immediately after them, forged/replayed sessions are rejected, and the
 * dashboard banner default + Settings persistence behave.
 *
 * Legacy mode proves an account created by an older build (still flagged
 * mustChangePassword) is recognised as set up, cannot be replaced through
 * initial setup, keeps signing in, has no cooldown either, and can still
 * rotate its password — with business data left untouched.
 *
 * Runs against an isolated in-memory IndexedDB with the real services and
 * the real PBKDF2 parameters. It never reads a browser database.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const MODE = process.env.AUTH_TEST_MODE === 'legacy' ? 'legacy' : 'fresh';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith('@/')
    ? path.join(root, 'src', request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

const ts = require('typescript');
Module._extensions['.ts'] = (module, filename) => {
  const source = fs
    .readFileSync(filename, 'utf8')
    .replace(/\bimport\.meta\.env\b/g, '({})');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  module._compile(output.outputText, filename);
};

const { db } = require(path.join(root, 'src/data/db/indexedDb.ts'));
const { adminRepository } = require(path.join(root, 'src/data/repositories/index.ts'));
const { sessionStore } = require(path.join(root, 'src/data/storage/sessionStore.ts'));
const { ADMIN_CREDENTIALS_ID, AUTH_CONFIG } = require(
  path.join(root, 'src/config/auth.config.ts'),
);
const { authService } = require(path.join(root, 'src/services/authService.ts'));
const { hashPassword } = require(path.join(root, 'src/utils/crypto.ts'));
const { restaurantService } = require(path.join(root, 'src/services/restaurantService.ts'));
const { customerService } = require(path.join(root, 'src/services/customerService.ts'));

await db.openDatabase();

const GENERIC = 'Incorrect username or password.';

/**
 * The cooldown must be gone at the source, not merely hidden: every failed
 * result is the plain credential error, with no lockout field, however many
 * attempts precede it — and the correct password works immediately after.
 */
async function assertNoCooldown(username, correctPassword, attempts = 12) {
  for (let i = 1; i <= attempts; i += 1) {
    const result = await authService.login(username, `wrong-password-${i}`);
    assert.equal(result.ok, false, `attempt ${i} must fail`);
    assert.equal(result.error, GENERIC, `attempt ${i} returns the generic error`);
    assert.equal(
      'lockedUntil' in result,
      false,
      `attempt ${i} must not carry a lockout`,
    );
    assert.equal(
      result.needsInitialSetup ?? false,
      false,
      `attempt ${i} must not reroute to setup`,
    );
  }

  const wrongUser = await authService.login('nobody-here', 'whatever-123');
  assert.equal(wrongUser.ok, false, 'an unknown username fails');
  assert.equal(wrongUser.error, GENERIC, 'an unknown username gets the generic error');

  const ok = await authService.login(username, correctPassword);
  assert.equal(
    ok.ok,
    true,
    'the correct password signs in immediately after repeated failures',
  );
}

function sourceIncludes(rel, needle) {
  return fs.readFileSync(path.join(root, rel), 'utf8').includes(needle);
}

if (MODE === 'fresh') {
  /* ---------------- A fresh terminal needs Sign-Up first ---------------- */

  assert.equal(
    await authService.needsInitialSetup(),
    true,
    'a fresh terminal reports that initial setup is required',
  );

  const tooEarly = await authService.login('admin', 'anything-123');
  assert.equal(tooEarly.ok, false, 'sign-in before setup cannot succeed');
  assert.equal(
    tooEarly.needsInitialSetup,
    true,
    'sign-in before setup routes the UI to Sign-Up',
  );
  assert.equal(
    await adminRepository.count(),
    0,
    'merely opening the app / attempting sign-in created no account',
  );

  /* ---------------- Validation failures persist nothing ---------------- */

  const shortUser = await authService.createInitialAdmin({
    username: 'ab',
    password: 'long-enough-1',
    confirmPassword: 'long-enough-1',
  });
  assert.equal(shortUser.ok, false, 'a two-character username is rejected');

  const spacedUser = await authService.createInitialAdmin({
    username: 'has spaces',
    password: 'long-enough-1',
    confirmPassword: 'long-enough-1',
  });
  assert.equal(spacedUser.ok, false, 'a username with spaces is rejected');

  const shortPass = await authService.createInitialAdmin({
    username: 'valid-user',
    password: '12345',
    confirmPassword: '12345',
  });
  assert.equal(shortPass.ok, false, 'a password under the minimum is rejected');

  const mismatch = await authService.createInitialAdmin({
    username: 'valid-user',
    password: 'long-enough-1',
    confirmPassword: 'long-enough-2',
  });
  assert.equal(mismatch.ok, false, 'a mismatched confirmation is rejected');
  assert.match(mismatch.error ?? '', /do not match/, 'mismatch is explained');

  assert.equal(
    await adminRepository.count(),
    0,
    'failed setup attempts persisted no account',
  );
  assert.equal(
    await authService.needsInitialSetup(),
    true,
    'the terminal still needs setup after failed attempts',
  );

  /* -------- Simultaneous setup attempts create exactly one account ------ */

  const credsA = {
    displayName: 'Owner A',
    username: 'owner-a',
    password: 'correct-a-pass',
    confirmPassword: 'correct-a-pass',
  };
  const credsB = {
    username: 'owner-b',
    password: 'correct-b-pass',
    confirmPassword: 'correct-b-pass',
  };

  const [resultA, resultB] = await Promise.all([
    authService.createInitialAdmin(credsA),
    authService.createInitialAdmin(credsB),
  ]);

  const winners = [resultA, resultB].filter((r) => r.ok);
  const losers = [resultA, resultB].filter((r) => !r.ok);
  assert.equal(winners.length, 1, 'exactly one simultaneous setup succeeds');
  assert.equal(losers.length, 1, 'the other simultaneous setup is refused');
  assert.equal(
    losers[0].alreadySetUp,
    true,
    'the refused setup is told an account already exists',
  );

  const winner = resultA.ok ? credsA : credsB;
  const loser = resultA.ok ? credsB : credsA;

  assert.equal(await adminRepository.count(), 1, 'exactly one account record exists');
  assert.equal(
    await authService.needsInitialSetup(),
    false,
    'setup is complete once the account is saved (no return to Sign-Up on refresh)',
  );

  const record = await adminRepository.getById(ADMIN_CREDENTIALS_ID);
  assert.ok(record, 'the account record is readable back from storage');
  assert.equal(record.username, winner.username, 'the winning username was stored');
  assert.equal(record.role, 'admin', 'the account keeps the admin role');
  assert.equal(
    record.mustChangePassword,
    false,
    'an operator-chosen password needs no forced rotation',
  );
  assert.equal(
    record.password.algorithm,
    'PBKDF2-SHA256',
    'the password is stored as a PBKDF2 hash',
  );
  assert.notEqual(
    record.password.hash,
    winner.password,
    'the plaintext password is never stored',
  );
  assert.ok(record.password.salt.length > 0, 'a per-account salt is stored');
  assert.equal(
    record.password.iterations,
    AUTH_CONFIG.pbkdf2Iterations,
    'the configured PBKDF2 work factor is used',
  );
  if (winner.displayName) {
    assert.equal(record.displayName, winner.displayName, 'the display name was saved');
  }

  /* ---------------- Registration does not sign the user in --------------- */

  assert.equal(sessionStore.read(), null, 'Sign-Up created no session');
  assert.equal(
    record.sessionTokenHash ?? null,
    null,
    'Sign-Up bound no session token to the account',
  );
  assert.equal(
    await authService.restore(),
    null,
    'there is no authenticated user until they sign in',
  );

  /* ------------- A second (public) sign-up can never happen ------------- */

  const third = await authService.createInitialAdmin({
    username: 'someone-else',
    password: 'another-pass-1',
    confirmPassword: 'another-pass-1',
  });
  assert.equal(third.ok, false, 'initial setup cannot be repeated');
  assert.equal(third.alreadySetUp, true, 'repeat setup is refused as already set up');
  assert.equal(await adminRepository.count(), 1, 'still exactly one account');

  const loserLogin = await authService.login(loser.username, loser.password);
  assert.equal(loserLogin.ok, false, 'the overwritten/losing credentials never work');
  assert.equal(loserLogin.error, GENERIC, 'losing credentials get the generic error');

  /* ------------------- No wrong-password cooldown ---------------------- */

  assert.equal(
    typeof sessionStore.readAttempts,
    'undefined',
    'no failed-attempt counter is read anymore',
  );
  assert.equal(
    typeof sessionStore.writeAttempts,
    'undefined',
    'no failed-attempt counter is written anymore',
  );

  await assertNoCooldown(winner.username, winner.password, 12);

  /* ----------------- Session restore / forgery / logout ----------------- */

  const user = await authService.restore();
  assert.ok(user, 'a persisted session restores after sign-in (refresh-safe)');
  assert.equal(user.username, winner.username, 'the restored user is the account owner');
  assert.equal(user.role, 'admin', 'the restored role is admin');

  const liveSession = sessionStore.read();
  assert.ok(liveSession, 'a session exists while signed in');

  await authService.logout();
  assert.equal(await authService.restore(), null, 'logout ends the session');

  sessionStore.write(liveSession);
  assert.equal(
    await authService.restore(),
    null,
    'replaying the pre-logout session does not authenticate',
  );

  sessionStore.write({
    token: 'hand-written-forgery-token',
    username: winner.username,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  assert.equal(
    await authService.restore(),
    null,
    'a hand-written session object does not authenticate',
  );

  const again = await authService.login(winner.username, winner.password);
  assert.equal(again.ok, true, 'normal sign-in still works after the forgery checks');
  await authService.logout();

  /* --------- Banner: built-in default + Settings persistence ------------ */

  const emptyProfile = await restaurantService.getProfile();
  assert.equal(
    emptyProfile.banner,
    null,
    'no custom banner is stored initially (the built-in default is active)',
  );

  const named = { ...emptyProfile, name: 'Test Kitchen' };
  await restaurantService.save(named);

  const customBanner = {
    dataUrl: 'data:image/webp;base64,AAAA',
    type: 'image/webp',
    width: 1600,
    height: 500,
    bytes: 3,
    fileName: 'custom.webp',
  };
  // The Appearance save path: re-read, change only the banner, save.
  const currentProfile = await restaurantService.getProfile();
  await restaurantService.save({ ...currentProfile, banner: customBanner });

  const withBanner = await restaurantService.getProfile();
  assert.equal(
    withBanner.banner?.dataUrl,
    customBanner.dataUrl,
    'a custom banner saved from Settings persists',
  );
  assert.equal(withBanner.name, 'Test Kitchen', 'saving the banner kept the profile name');

  await restaurantService.removeBanner();
  const restored = await restaurantService.getProfile();
  assert.equal(restored.banner, null, 'restoring the default clears the custom banner');
  assert.equal(restored.name, 'Test Kitchen', 'restoring the default kept the profile');

  /* ---- Source-level guards: overlay gone, default wired, SW precaches -- */

  assert.equal(
    sourceIncludes('src/pages/DashboardPage.tsx', 'Change banner'),
    false,
    'the dashboard has no Change Banner control',
  );
  assert.equal(
    sourceIncludes('src/pages/DashboardPage.tsx', 'Add banner'),
    false,
    'the dashboard has no Add Banner control',
  );
  assert.equal(
    sourceIncludes('src/pages/DashboardPage.tsx', 'heroAction'),
    false,
    'no banner edit overlay remains on the dashboard',
  );
  assert.equal(
    sourceIncludes('src/pages/DashboardPage.tsx', 'default-restaurant-banner.jpg'),
    true,
    'the dashboard uses the bundled default banner asset',
  );
  assert.equal(
    sourceIncludes('src/services/authService.ts', 'Too many failed attempts'),
    false,
    'no cooldown message remains in the auth service',
  );
  assert.equal(
    sourceIncludes('src/config/auth.config.ts', 'maxFailedAttempts'),
    false,
    'no failed-attempt threshold remains in auth configuration',
  );
  assert.equal(
    sourceIncludes('scripts/build-sw.mjs', "'.jpg'"),
    true,
    'the service worker precaches the bundled banner for offline use',
  );
  assert.ok(
    fs.existsSync(path.join(root, 'src/assets/default-restaurant-banner.jpg')),
    'the default banner is a local project asset (no remote URL)',
  );

  console.log(
    'Auth checks passed (fresh): Sign-Up required before Sign-In, atomic single account ' +
      'creation with PBKDF2 only, no auto sign-in, no public re-registration, no ' +
      'wrong-password cooldown, forgery/replay rejected, banner default + persistence.',
  );
} else {
  /* ---------- An account from an older build must be preserved --------- */

  await customerService.create({
    name: 'Existing Customer',
    phone: '0300 9999999',
    address: '1 Existing Road',
  });

  const legacyPassword = 'legacy-setup-pass';
  const seeded = await adminRepository.create({
    id: ADMIN_CREDENTIALS_ID,
    username: 'legacy-admin',
    password: await hashPassword(legacyPassword),
    role: 'admin',
    // Exactly how older builds left terminals that never rotated the
    // one-time setup password.
    mustChangePassword: true,
    lastLoginAt: null,
    displayName: 'Legacy Owner',
  });
  const seededHash = seeded.password.hash;

  assert.equal(
    await authService.needsInitialSetup(),
    false,
    'an existing installation is never sent back to Sign-Up',
  );

  const hijack = await authService.createInitialAdmin({
    username: 'replacement-user',
    password: 'replacement-pass',
    confirmPassword: 'replacement-pass',
  });
  assert.equal(hijack.ok, false, 'initial setup cannot replace an existing account');
  assert.equal(hijack.alreadySetUp, true, 'the refusal is explicit');

  const untouched = await adminRepository.getById(ADMIN_CREDENTIALS_ID);
  assert.equal(untouched.username, 'legacy-admin', 'the existing username is unchanged');
  assert.equal(untouched.password.hash, seededHash, 'the existing password hash is unchanged');
  assert.equal(await adminRepository.count(), 1, 'no extra account was created');

  await assertNoCooldown('legacy-admin', legacyPassword, 10);

  const legacyUser = await authService.restore();
  assert.ok(legacyUser, 'the legacy account restores a session');
  assert.equal(
    legacyUser.mustChangePassword,
    true,
    'the legacy must-change-password flag survives the upgrade',
  );
  assert.equal(legacyUser.displayName, 'Legacy Owner', 'existing profile fields survive');

  const wrongCurrent = await authService.changeCredentials({
    currentPassword: 'not-the-password',
    newPassword: 'brand-new-pass',
  });
  assert.equal(wrongCurrent.ok, false, 'rotation still requires the current password');

  const rotated = await authService.changeCredentials({
    currentPassword: legacyPassword,
    newPassword: 'brand-new-pass',
  });
  assert.equal(rotated.ok, true, 'the legacy password can still be rotated');

  const afterRotation = await authService.currentUser();
  assert.equal(
    afterRotation?.mustChangePassword,
    false,
    'rotation clears the must-change flag',
  );

  await authService.logout();
  const oldPassword = await authService.login('legacy-admin', legacyPassword);
  assert.equal(oldPassword.ok, false, 'the old password stops working after rotation');

  await assertNoCooldown('legacy-admin', 'brand-new-pass', 6);
  await authService.logout();

  assert.equal(
    (await customerService.list()).length,
    1,
    'business data on the terminal was not touched by any auth operation',
  );

  console.log(
    'Auth checks passed (legacy): existing account preserved and never sent to Sign-Up, ' +
      'cannot be replaced via setup, no wrong-password cooldown, rotation still works, ' +
      'business data untouched.',
  );
}
