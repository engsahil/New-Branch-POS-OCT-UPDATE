/**
 * Development smoke test for the first-run Sign-Up flow (v5.1.9).
 *
 * Loads a NORMAL production build (no provisioned password) inside Happy
 * DOM against an empty IndexedDB and drives the real UI through the whole
 * first-time journey:
 *
 *   fresh visit -> Sign-Up (not Sign-In) -> validation -> account created
 *   -> redirected to Sign-In (NOT the dashboard) -> repeated wrong
 *   passwords with immediate retry and no cooldown -> correct password
 *   -> dashboard with the built-in banner and no edit overlay
 *   -> banner controls present in Settings -> Appearance
 *   -> sign out -> returning visit goes to Sign-In, /setup stays closed
 *   -> protected routes stay protected while signed out
 *
 * Happy DOM and fake-indexeddb are development-only and are not saved to
 * package.json:
 *
 *   npm install --no-save happy-dom fake-indexeddb
 *   npm run build            # a normal build, no VITE_ADMIN_PASSWORD
 *   node scripts/smoke-setup.mjs
 *
 * Like smoke-ui.mjs this is intentionally not part of `npm test`, which
 * stays dependency-free (the service-level equivalent is test-auth.mjs).
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const USERNAME = 'first-owner';
const PASSWORD = 'first-owner-pass';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'dist', 'assets');

const window = new Window({ url: 'http://localhost:8000/', width: 1440, height: 900 });
window.indexedDB = indexedDB;
window.IDBKeyRange = IDBKeyRange;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

for (const name of [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLFormElement',
  'Node',
  'Event',
  'CustomEvent',
  'PopStateEvent',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
  'DOMParser',
  'Blob',
  'File',
  'URL',
]) {
  if (window[name] === undefined) continue;
  try {
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
      writable: true,
    });
  } catch {
    /* an immutable Node global; its built-in is compatible enough */
  }
}
globalThis.self = window;

document.body.innerHTML =
  '<div id="root"></div><div id="app-boot"><span></span></div>';

// Same stylesheet-load shim as smoke-ui.mjs: Happy DOM never fires `load`
// for the CSS links Vite injects, which would hang lazy routes forever.
const nativeAppendChild = window.Node.prototype.appendChild;
window.Node.prototype.appendChild = function appendChild(node) {
  const appended = nativeAppendChild.call(this, node);
  if (node?.tagName === 'LINK') {
    window.setTimeout(() => {
      node.dispatchEvent(new window.Event('load'));
    }, 0);
  }
  return appended;
};

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  originalError(...args);
};
window.addEventListener('error', (event) =>
  errors.push(String(event.error ?? event.message)),
);
process.on('unhandledRejection', (reason) => errors.push(`unhandled: ${String(reason)}`));

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await predicate();
    if (value) return value;
    await settle(50);
  }
  throw new Error(
    `Timed out waiting for ${label} (at ${window.location.pathname}; ` +
      `page text: ${document.body.textContent.replace(/\s+/g, ' ').slice(0, 400)})`,
  );
}

function typeInto(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  );
  descriptor.set.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function submitForm() {
  const form = document.querySelector('form');
  if (!form) throw new Error('No form is rendered.');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

function check(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`PASS  ${label}`);
}

/**
 * Read or patch the saved restaurant profile straight from the same
 * IndexedDB the application uses. This seeds the *stored* state, so the
 * assertions below prove the UI reads and writes real persistence rather
 * than component state.
 */
function withProfileStore(mode, mutate) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pos-db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction('restaurant', mode);
      const store = tx.objectStore('restaurant');
      const get = store.get('restaurant-profile');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        try {
          resolve(mutate(store, get.result));
        } catch (err) {
          reject(err);
        }
      };
      tx.oncomplete = () => database.close();
      tx.onerror = () => reject(tx.error);
    };
  });
}

function readStoredBanner() {
  return withProfileStore('readonly', (_store, profile) => profile?.banner ?? null);
}

const files = await readdir(assets);
const entry = files.find((name) => /^index-.*\.js$/.test(name));
if (!entry) throw new Error('No built entry bundle found. Run npm run build first.');

await import(pathToFileURL(path.join(assets, entry)).href);
await waitFor(() => document.querySelector('#root > *'), 'application mount');
console.log('PASS  application mounts into #root');

/* ------------------ First visit: Sign-Up, not Sign-In ----------------- */

await waitFor(
  () => document.body.textContent.includes('Create your account'),
  'first-run Sign-Up screen',
);
check(true, 'a fresh terminal opens the Sign-Up / initial setup screen');
check(
  !document.querySelector('input[name="password"]'),
  'the Sign-In form is not shown before an account exists',
);
check(
  window.location.pathname.endsWith('/setup'),
  'the first screen is routed at /setup',
);

const usernameField = document.querySelector('input[name="newUsername"]');
const passwordField = document.querySelector('input[name="newPassword"]');
const confirmField = document.querySelector('input[name="confirmPassword"]');
const nameField = document.querySelector('input[name="displayName"]');
if (!usernameField || !passwordField || !confirmField) {
  throw new Error('The Sign-Up form is incomplete.');
}

typeInto(nameField, 'First Owner');
typeInto(usernameField, USERNAME);
typeInto(passwordField, PASSWORD);
typeInto(confirmField, 'not-the-same-pass');
submitForm();

await waitFor(
  () => document.body.textContent.includes('Passwords do not match.'),
  'mismatched confirmation error',
);
check(true, 'a mismatched password confirmation is rejected with a clear error');
check(
  window.location.pathname.endsWith('/setup'),
  'failed Sign-Up validation stays on /setup',
);

typeInto(confirmField, PASSWORD);
submitForm();

if (process.env.SMOKE_DEBUG) {
  await settle(3000);
  const adminRecords = await new Promise((resolve) => {
    const request = indexedDB.open('pos-db');
    request.onerror = () => resolve('open-error');
    request.onsuccess = () => {
      const tx = request.result.transaction('admin');
      const get = tx.objectStore('admin').getAll();
      get.onsuccess = () =>
        resolve((get.result ?? []).map((r) => ({ id: r.id, username: r.username })));
      get.onerror = () => resolve('get-error');
    };
  });
  console.log('DEBUG path:', window.location.pathname);
  console.log('DEBUG history.state:', JSON.stringify(window.history.state));
  console.log('DEBUG admin records:', JSON.stringify(adminRecords));
  console.log(
    'DEBUG login username value:',
    document.querySelector('input[name="username"]')?.value ?? '(no login form)',
  );
  console.log(
    'DEBUG body:',
    document.body.textContent.replace(/\s+/g, ' ').slice(0, 500),
  );
  console.log('DEBUG collected errors:', errors.slice(0, 5));
}

/* ------------- After Sign-Up: Sign-In, never the dashboard ------------- */

await waitFor(
  () => document.body.textContent.includes('Account created successfully. Please sign in.'),
  'post-Sign-Up confirmation on the Sign-In screen',
);
check(true, 'successful Sign-Up redirects to Sign-In with a confirmation');
check(
  !document.querySelector('#main-content'),
  'registration did not open the dashboard automatically',
);
check(
  window.localStorage.getItem('pos.auth.session') === null,
  'registration created no signed-in session',
);

const loginUsername = document.querySelector('input[name="username"]');
check(
  loginUsername?.value === USERNAME,
  'the Sign-In form is prefilled with the new username',
);

// Seed a restaurant profile (as smoke-ui.mjs does) so the post-login
// restaurant wizard recognises a configured terminal and stays closed.
await new Promise((resolve, reject) => {
  const request = indexedDB.open('pos-db');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const tx = database.transaction('restaurant', 'readwrite');
    const now = new Date().toISOString();
    tx.objectStore('restaurant').put({
      id: 'restaurant-profile',
      name: 'Smoke Test Kitchen',
      logo: null,
      banner: null,
      tagline: '',
      address: '1 Test Road',
      phone: '555-0000',
      email: '',
      receiptInfo: '',
      receiptFooter: '',
      taxPercent: 0,
      taxInclusive: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      rev: 1,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  };
});
console.log('PASS  restaurant profile written to IndexedDB');

/* ------------- Wrong passwords: immediate retry, no cooldown ---------- */

for (let attempt = 1; attempt <= 6; attempt += 1) {
  const loginPassword = document.querySelector('input[name="password"]');
  typeInto(loginPassword, `wrong-pass-${attempt}`);
  submitForm();
  // The field is cleared by the failure path; use that as the settled signal.
  await waitFor(
    () =>
      document.body.textContent.includes('Incorrect username or password.') &&
      document.querySelector('input[name="password"]')?.value === '',
    `wrong-password attempt ${attempt} rejected`,
  );
  const submit = Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent.trim().startsWith('Sign in'),
  );
  check(
    submit && !submit.disabled,
    `attempt ${attempt + 1} is available immediately (form re-enabled)`,
  );
}
check(
  !/too many|try again shortly|wait|locked/i.test(document.body.textContent),
  'no cooldown / lockout message after repeated wrong passwords',
);
check(
  !document.querySelector('#main-content'),
  'wrong passwords never reached the dashboard',
);

/* ------------------- Correct password: dashboard ----------------------- */

typeInto(document.querySelector('input[name="password"]'), PASSWORD);
submitForm();

await waitFor(() => document.querySelector('#main-content'), 'application shell');
check(true, 'the correct password signs in right after the failures');

// A plain visit (the app was opened at the root) must land on the Dashboard,
// which is the documented flow: Setup -> Sign-In -> Dashboard.
await waitFor(
  () =>
    window.location.pathname.endsWith('/dashboard') &&
    Boolean(document.querySelector('section[aria-label="Restaurant banner"]')),
  'Dashboard after a plain sign-in',
);
check(true, 'a successful sign-in opens the Dashboard');

history.pushState({}, '', '/dashboard');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await waitFor(
  () => document.querySelector('section[aria-label="Restaurant banner"]'),
  'dashboard banner',
);

const bannerImage = document.querySelector(
  'section[aria-label="Restaurant banner"] img',
);
check(
  Boolean(bannerImage?.getAttribute('src')?.includes('default-restaurant-banner')),
  'the built-in restaurant banner shows by default',
);
check(
  !/Change banner|Add banner/.test(document.body.textContent),
  'no Change/Add Banner control is rendered over the dashboard banner',
);
check(
  document.body.textContent.includes('Smoke Test Kitchen') &&
    document.body.textContent.includes('Welcome back.'),
  'the banner shows only the restaurant name and greeting',
);

/* ----------------- Banner management lives in Settings ----------------- */

history.pushState({}, '', '/admin');
window.dispatchEvent(new window.PopStateEvent('popstate'));
const appearanceTab = await waitFor(
  () => document.getElementById('admin-tab-appearance'),
  'Appearance tab',
);
appearanceTab.click();
await waitFor(
  () => document.body.textContent.includes('Dashboard banner'),
  'banner card in Settings -> Appearance',
);
check(true, 'banner customisation is available in Settings -> Appearance');
check(
  document.body.textContent.includes('Built-in restaurant banner'),
  'Appearance shows the built-in banner as the active default',
);
const saveBanner = Array.from(document.querySelectorAll('button')).find(
  (button) => button.textContent.trim() === 'Save banner',
);
check(Boolean(saveBanner), 'Appearance provides an explicit Save banner action');

/* -------- A saved custom banner: persists, previews, restores default --- */

const CUSTOM_BANNER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// Seed a saved custom banner exactly as a previous Settings save would.
await withProfileStore('readwrite', (store, profile) => {
  store.put({
    ...profile,
    banner: {
      dataUrl: CUSTOM_BANNER,
      type: 'image/png',
      width: 1200,
      height: 375,
      bytes: 70,
      fileName: 'operator-banner.png',
    },
  });
});
check(
  (await readStoredBanner())?.dataUrl === CUSTOM_BANNER,
  'a custom banner can be stored in the restaurant profile',
);

// A fresh visit to the Dashboard (not a state carry-over) must show it.
history.pushState({}, '', '/sales');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await waitFor(() => document.body.textContent.includes('Sales'), 'Sales route');
history.pushState({}, '', '/dashboard');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await waitFor(
  () =>
    document
      .querySelector('section[aria-label="Restaurant banner"] img')
      ?.getAttribute('src') === CUSTOM_BANNER,
  'saved custom banner on the Dashboard',
);
check(true, 'a saved custom banner is shown after revisiting the Dashboard');

// Settings previews the same stored banner and can restore the default.
history.pushState({}, '', '/admin');
window.dispatchEvent(new window.PopStateEvent('popstate'));
const appearanceTabAgain = await waitFor(
  () => document.getElementById('admin-tab-appearance'),
  'Appearance tab again',
);
appearanceTabAgain.click();
await waitFor(
  () =>
    document.body.textContent.includes('your custom banner (operator-banner.png)'),
  'Appearance previewing the saved custom banner',
);
check(true, 'Appearance previews the saved custom banner');

const restoreDefault = Array.from(document.querySelectorAll('button')).find(
  (button) => button.textContent.trim() === 'Restore default',
);
check(Boolean(restoreDefault), 'Appearance offers Restore default');
restoreDefault.click();

const saveRestored = await waitFor(
  () =>
    Array.from(document.querySelectorAll('button')).find(
      (button) =>
        button.textContent.trim() === 'Save banner' && !button.disabled,
    ),
  'Save banner enabled after restoring the default',
);
saveRestored.click();
await waitFor(async () => (await readStoredBanner()) === null, 'default restored');
check(true, 'Restore default clears the custom banner in storage');
await waitFor(
  () =>
    document.body.textContent.includes('Currently active: the built-in restaurant banner'),
  'Appearance reporting the built-in banner as active',
);
check(true, 'Appearance reports the built-in banner as active again');

history.pushState({}, '', '/dashboard');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await waitFor(
  () =>
    Boolean(
      document
        .querySelector('section[aria-label="Restaurant banner"] img')
        ?.getAttribute('src')
        ?.includes('default-restaurant-banner'),
    ),
  'built-in banner back on the Dashboard',
);
check(true, 'the Dashboard shows the built-in banner again');

/* ------------- Sign out, then returning-user behaviour ----------------- */

history.pushState({}, '', '/dashboard');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await waitFor(
  () => document.querySelector('section[aria-label="Restaurant banner"]'),
  'dashboard again before sign-out',
);
const signOut = await waitFor(
  () =>
    Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent.trim().includes('Sign out'),
    ),
  'Sign out control',
);
signOut.click();

await waitFor(
  () => document.body.textContent.includes('Administrator access is required'),
  'Sign-In screen after sign-out',
);
check(true, 'sign-out returns to the Sign-In screen');
check(
  !document.body.textContent.includes('Create your account'),
  'a returning user is not sent back to Sign-Up',
);

// A protected URL while signed out must bounce to Sign-In.
history.pushState({}, '', '/dashboard');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await waitFor(
  () => document.body.textContent.includes('Administrator access is required'),
  'protected route guard',
);
check(true, 'opening /dashboard while signed out redirects to Sign-In');

// A deep link is preserved: signing in from that redirect returns the
// operator to the page they asked for, not the Dashboard.
typeInto(document.querySelector('input[name="username"]'), USERNAME);
typeInto(document.querySelector('input[name="password"]'), PASSWORD);
submitForm();
await waitFor(
  () =>
    window.location.pathname.endsWith('/dashboard') &&
    Boolean(document.querySelector('section[aria-label="Restaurant banner"]')),
  'deep-linked sign-in',
);
check(true, 'signing in from a protected URL returns to that URL');

// Sign out again so the remaining checks run signed out.
const secondSignOut = await waitFor(
  () =>
    Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent.trim().includes('Sign out'),
    ),
  'Sign out control (second sign-in)',
);
secondSignOut.click();
await waitFor(
  () => document.body.textContent.includes('Administrator access is required'),
  'Sign-In screen after the deep-link sign-out',
);

// And /setup itself is closed once an account exists.
history.pushState({}, '', '/setup');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await waitFor(
  () =>
    window.location.pathname.endsWith('/login') &&
    document.body.textContent.includes('Administrator access is required'),
  '/setup closed after account creation',
);
check(true, '/setup redirects to Sign-In once an account exists (no public sign-up)');

// Existing credentials still sign in normally afterwards.
typeInto(document.querySelector('input[name="username"]'), USERNAME);
typeInto(document.querySelector('input[name="password"]'), PASSWORD);
submitForm();
await waitFor(() => document.querySelector('#main-content'), 'second sign-in');
check(true, 'the created account keeps signing in on later visits');

const relevantErrors = errors.filter(
  (message) => !/Not implemented|Could not parse CSS|service worker/i.test(message),
);
if (relevantErrors.length > 0) {
  originalError(relevantErrors.join('\n'));
  throw new Error(`${relevantErrors.length} console error(s) were reported.`);
}

console.log('Setup smoke run completed with no uncaught console errors.');
process.exit(0);
