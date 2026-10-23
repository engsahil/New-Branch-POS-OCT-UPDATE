/**
 * Development smoke test for the built application.
 *
 * Loads the production bundle inside Happy DOM, signs in through the real
 * sign-in form, and renders the main routes. It proves the application mounts,
 * that the header/notification centre is present, that the v5.1.9 Dashboard
 * renders with real (empty) data rather than crashing, and that nothing logs a
 * console error along the way.
 *
 * Happy DOM and fake-indexeddb are development-only tools and are not saved to
 * package.json:
 *
 *   npm install --no-save happy-dom fake-indexeddb
 *   VITE_ADMIN_PASSWORD=smoke-test-password npm run build
 *   node scripts/smoke-ui.mjs
 *
 * It is intentionally not part of `npm test`, which stays dependency-free and
 * offline. Never ship a build made with this test password: rebuild normally
 * afterwards.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const USERNAME = 'admin';
const PASSWORD = 'smoke-test-password';

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

// Mirror the production index.html mount points before the bundle runs.
document.body.innerHTML =
  '<div id="root"></div><div id="app-boot"><span></span></div>';

// Vite's code-splitting helper waits for `load` events on the stylesheet links
// it injects. Happy DOM does not fetch file:// stylesheets, so those events
// never fire and lazy routes would hang forever. Resolve them ourselves: the
// CSS itself is irrelevant to this DOM-level smoke test.
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

async function waitFor(predicate, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await predicate();
    if (value) return value;
    await settle(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Set a React-controlled input value and notify React of the change. */
function typeInto(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  );
  descriptor.set.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

const files = await readdir(assets);
const entry = files.find((name) => /^index-.*\.js$/.test(name));
if (!entry) throw new Error('No built entry bundle found. Run npm run build first.');

await import(pathToFileURL(path.join(assets, entry)).href);
await waitFor(() => document.querySelector('#root > *'), 'application mount');
console.log('PASS  application mounts into #root');

// Seed a restaurant profile through the same IndexedDB the app uses, so the
// first-run wizard recognises an existing installation and stays closed.
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

await waitFor(
  () => document.body.textContent.includes('Sign in'),
  'sign-in screen',
);
console.log('PASS  sign-in screen renders');

const usernameInput = await waitFor(
  () => document.querySelector('input[name="username"]'),
  'username field',
);
const passwordInput = document.querySelector('input[name="password"]');
const form = document.querySelector('form');
if (!passwordInput || !form) throw new Error('The sign-in form is incomplete.');

typeInto(usernameInput, USERNAME);
typeInto(passwordInput, PASSWORD);
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

await waitFor(
  () => !document.body.textContent.includes('Administrator access is required'),
  'sign-in to complete',
);
await waitFor(() => document.querySelector('#main-content'), 'application shell');
console.log('PASS  sign-in succeeds with the provisioned credentials');

const routes = [
  ['/dashboard', 'Dashboard'],
  ['/sales', 'Sales'],
  ['/customers', 'Customers'],
  ['/menu', 'Menu'],
  ['/inventory', 'Inventory'],
  ['/admin', 'Admin'],
  ['/', 'POS'],
];

for (const [route, expected] of routes) {
  history.pushState({}, '', route);
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await waitFor(
    () => document.body.textContent.includes(expected),
    `route ${route}`,
  );
  console.log(`PASS  route ${route} renders`);
}

// Customisation panel: hide one Dashboard block, save, and confirm it persisted.
history.pushState({}, '', '/admin');
window.dispatchEvent(new window.PopStateEvent('popstate'));
const settingsTab = await waitFor(
  () => document.getElementById('admin-tab-settings'),
  'Admin settings tab',
);
settingsTab.click();
await waitFor(
  () => document.body.textContent.includes('Dashboard and order list'),
  'display customisation card',
);
const bestSellersSwitch = document.querySelector(
  'input[name="dashboard-bestSellers"]',
);
if (!bestSellersSwitch) throw new Error('The Dashboard switches are missing.');
if (!bestSellersSwitch.checked) bestSellersSwitch.click();
bestSellersSwitch.click();
const saveDisplay = Array.from(document.querySelectorAll('button')).find(
  (button) => button.textContent.trim() === 'Save display settings',
);
if (!saveDisplay) throw new Error('The display save button is missing.');
saveDisplay.click();

const storedDisplay = await waitFor(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.open('pos-db');
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const tx = request.result.transaction('settings');
        const get = tx.objectStore('settings').get('display.preferences');
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => resolve(null);
      };
    }),
  'display preferences to be stored',
);
if (storedDisplay?.value?.dashboard?.bestSellers !== false) {
  throw new Error('Saving the display switches did not persist.');
}
console.log('PASS  display customisation saves to the settings store');

if (!document.querySelector('[data-tour="notifications"]')) {
  throw new Error('The notification bell is missing from the application header.');
}
console.log('PASS  notification bell is present in the header');

// The seeded profile must suppress the first-run wizard for existing installs.
if (document.querySelector('#setup-title')) {
  throw new Error('The first-run wizard appeared even though a profile exists.');
}
console.log('PASS  first-run wizard is skipped for an existing installation');

const relevantErrors = errors.filter(
  (message) => !/Not implemented|Could not parse CSS|service worker/i.test(message),
);
if (relevantErrors.length > 0) {
  originalError(relevantErrors.join('\n'));
  throw new Error(`${relevantErrors.length} console error(s) were reported.`);
}

console.log('Smoke run completed with no uncaught console errors.');
// Happy DOM keeps timers/observers alive; exit explicitly instead of hanging.
process.exit(0);
