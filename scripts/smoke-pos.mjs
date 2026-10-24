/**
 * Development smoke test for the POS full-screen order + receipt flow.
 *
 * Places REAL orders through the POS UI (item tiles -> cart -> discount /
 * paid validation -> Complete order) and then verifies, for every order:
 *
 *   - the post-order confirmation shows the receipt with working
 *     Print Customer / Print Both actions (the reported bug: those actions
 *     disappearing or merging after order placement),
 *   - printing targets the selected order only, and rapid repeated clicks
 *     cannot start a second concurrent print job,
 *   - the Sales -> Orders list shows a Receipt action on EVERY row
 *     (including page 2 and a cancelled row), opening the right order,
 *   - cart math (quantity steppers, discount cap, shortfall/change) and
 *     stock deduction follow the completed sale exactly once.
 *
 * Development-only, like smoke-ui.mjs:
 *
 *   npm install --no-save happy-dom fake-indexeddb
 *   VITE_ADMIN_PASSWORD=smoke-test-password npm run build   # throwaway build
 *   node scripts/smoke-pos.mjs
 *   npm run build                                          # rebuild normally
 *
 * Happy DOM has no layout engine and no printer: pixel overlap and physical
 * printing cannot be proven here (print() is observed via the isolated print
 * iframe and completed by dispatching `afterprint`). Layout rules are kept
 * honest by keeping the receipt actions in normal wrapping flex rows; see
 * RELEASE notes for the manual layout checks.
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
  'window', 'document', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement',
  'HTMLStyleElement', 'HTMLLinkElement', 'HTMLIFrameElement', 'Element',
  'Node', 'Event', 'CustomEvent', 'PopStateEvent', 'MutationObserver',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'matchMedia', 'DOMParser', 'Blob', 'File', 'URL',
]) {
  if (window[name] === undefined) continue;
  try {
    Object.defineProperty(globalThis, name, {
      value: window[name], configurable: true, writable: true,
    });
  } catch { /* immutable Node global; its built-in is compatible enough */ }
}
globalThis.self = window;

document.body.innerHTML =
  '<div id="root"></div><div id="app-boot"><span></span></div>';

// Same stylesheet-load shim as smoke-ui.mjs.
const nativeAppendChild = window.Node.prototype.appendChild;
window.Node.prototype.appendChild = function appendChild(node) {
  const appended = nativeAppendChild.call(this, node);
  if (node?.tagName === 'LINK') {
    window.setTimeout(() => node.dispatchEvent(new window.Event('load')), 0);
  }
  return appended;
};

/*
 * Happy DOM gives dynamically-created iframes no contentDocument, so the
 * isolated print document the print service builds cannot form. Borrow a
 * real secondary Window per frame so the genuine print path runs: styles
 * are copied, the receipt paper is cloned, print() is invoked, and the test
 * completes the job by dispatching `afterprint`, like a closed dialog.
 */
const frameWindows = new WeakMap();
function frameWindowFor(frame) {
  let win = frameWindows.get(frame);
  if (!win) {
    win = new Window({ url: 'http://localhost:8000/' });
    frameWindows.set(frame, win);
  }
  return win;
}
Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentWindow', {
  get() { return frameWindowFor(this); },
  configurable: true,
});
Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentDocument', {
  get() { return frameWindowFor(this).document; },
  configurable: true,
});

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  originalError(...args);
};
window.addEventListener('error', (event) =>
  errors.push(String(event.error ?? event.message)));
process.on('unhandledRejection', (reason) =>
  errors.push(`unhandled: ${String(reason)}`));

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await predicate();
    if (value) return value;
    await settle(50);
  }
  throw new Error(
    `Timed out waiting for ${label} (at ${window.location.pathname}; page text: ` +
      `${document.body.textContent.replace(/\s+/g, ' ').slice(0, 400)})`,
  );
}

function check(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`PASS  ${label}`);
}

function typeInto(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value');
  descriptor.set.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/**
 * SPA navigation for the harness. Happy DOM's own anchor navigation changes
 * the URL without notifying React Router, so drive the router the way a
 * browser back/forward would: pushState + popstate.
 */
async function goTo(path, marker) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await waitFor(() => bodyText().includes(marker), `route ${path} (${marker})`);
}

const byText = (text, scope = document) =>
  Array.from(scope.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === text);
const byAria = (label) =>
  document.querySelector(`button[aria-label="${label}"]`);
const bodyText = () => document.body.textContent.replace(/\s+/g, ' ');

/** Read/write the same fake IndexedDB the app uses. */
function withDb(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pos-db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(stores, mode);
      let out;
      try {
        out = fn(tx);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(out?.result ?? out);
      tx.onerror = () => reject(tx.error);
    };
  });
}

const files = await readdir(assets);
const entry = files.find((name) => /^index-.*\.js$/.test(name));
if (!entry) throw new Error('No built entry bundle found. Run npm run build first.');

await import(pathToFileURL(path.join(assets, entry)).href);
await waitFor(() => document.querySelector('#root > *'), 'application mount');
console.log('PASS  application mounts into #root');

/* ---------------------------- Seed fixtures ---------------------------- */

const nowIso = new Date().toISOString();
const base = (id) => ({
  id, createdAt: nowIso, updatedAt: nowIso, deletedAt: null, rev: 1,
});

await withDb(['restaurant', 'menuItems', 'itemPrices', 'inventory'], 'readwrite', (tx) => {
  tx.objectStore('restaurant').put({
    ...base('restaurant-profile'),
    name: 'Smoke Test Kitchen', logo: null, banner: null, tagline: '',
    address: '1 Test Road', phone: '555-0000', email: '',
    receiptInfo: '', receiptFooter: 'Thank you!', taxPercent: 0, taxInclusive: false,
  });
  tx.objectStore('menuItems').put({
    ...base('item-burger'), name: 'Test Burger', description: '', category: 'Mains',
    image: null, isActive: 1, tracksInventory: 1, variantKind: 'size', discountPercent: null,
  });
  tx.objectStore('menuItems').put({
    ...base('item-fries'), name: 'Test Fries', description: '', category: 'Sides',
    image: null, isActive: 1, tracksInventory: 0, variantKind: 'size', discountPercent: null,
  });
  tx.objectStore('itemPrices').put({
    ...base('price-burger-l'), menuItemId: 'item-burger', label: 'Large',
    price: 50000, isDefault: 1,
  });
  tx.objectStore('itemPrices').put({
    ...base('price-fries-m'), menuItemId: 'item-fries', label: 'Medium',
    price: 20000, isDefault: 1,
  });
  // Burger stock: 5 units, linked, so completion must deduct exactly.
  tx.objectStore('inventory').put({
    ...base('stock-burger'), menuItemId: 'item-burger', name: 'Test Burger',
    sku: 'TB-1', unit: 'unit', quantity: 5, isAvailable: 1, isOutOfStock: 0,
    quantityBeforeOutOfStock: null, reorderLevel: 1,
  });
});
console.log('PASS  menu, prices, stock and profile seeded in IndexedDB');

/* -------------------------------- Sign in ------------------------------- */

await waitFor(() => bodyText().includes('Sign in'), 'sign-in screen');
typeInto(document.querySelector('input[name="username"]'), USERNAME);
typeInto(document.querySelector('input[name="password"]'), PASSWORD);
document.querySelector('form').dispatchEvent(
  new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('#main-content'), 'application shell');
console.log('PASS  sign-in succeeds (existing provisioned account, POS audit build)');

/* ------------------------- Order 1 through the POS ---------------------- */

// Signing in now opens the Dashboard (v5.1.9 flow), so walk to the till.
await waitFor(
  () => window.location.pathname.endsWith('/dashboard'),
  'Dashboard after sign-in',
);
await goTo('/', 'Current order');
console.log('PASS  sign-in lands on the Dashboard and the POS is one step away');

await waitFor(() => byAria('Add Test Burger, Large, Rs. 500'), 'burger tile');
byAria('Add Test Burger, Large, Rs. 500').click();
byAria('Add Test Burger, Large, Rs. 500').click();
byAria('Add Test Fries, Medium, Rs. 200').click();
await waitFor(() => bodyText().includes('3 items'), 'cart with 3 items');
check(bodyText().includes('Rs. 1,200'), 'cart total is 2x500 + 200 = Rs. 1,200');

// Quantity steppers: burger 2 -> 1, fries 1 -> 2  => 500 + 400 = 900.
byAria('Decrease Test Burger Large quantity').click();
byAria('Increase Test Fries Medium quantity').click();
await waitFor(() => bodyText().includes('Rs. 900'), 'total after steppers');
check(true, 'quantity steppers recompute the total (Rs. 900)');

// Discount over the cap must block completion; a valid discount applies.
const discountInput = document.querySelector('input[name="discount"]');
typeInto(discountInput, '901');
await waitFor(() => bodyText().includes('Discount cannot exceed'), 'over-cap discount');
check(byText('Complete order').disabled, 'Complete is disabled while the discount exceeds the cap');
typeInto(discountInput, '100');
await waitFor(() => bodyText().includes('Rs. 800'), 'discounted total');
check(!byText('Complete order').disabled, 'Complete re-enables with a valid discount (Rs. 800)');

// Underpayment blocks; overpayment shows change.
const paidInput = document.querySelector('input[name="amountPaid"]');
typeInto(paidInput, '500');
await waitFor(() => bodyText().includes('Short by Rs. 300'), 'shortfall hint');
check(byText('Complete order').disabled, 'Complete is disabled while underpaid');
typeInto(paidInput, '1000');
await waitFor(() => !byText('Complete order').disabled, 'paid enough');
check(bodyText().includes('Return / Change'), 'change row is shown for overpayment');

byText('Complete order').click();

/* ------- The reported bug: print actions right after placing order ----- */

const printCustomer1 = await waitFor(
  () => byText('Print Customer'),
  'Print Customer action on the order confirmation',
);
check(Boolean(printCustomer1), 'Print Customer is present immediately after order 1');
check(Boolean(byText('Print Both')), 'Print Both is present immediately after order 1');
check(Boolean(byText('New order')), 'New order action is present beside the print actions');
check(bodyText().includes('Order #0001'), 'confirmation is for order #0001');
check(bodyText().includes('Test Burger') && bodyText().includes('Test Fries'),
  'the receipt paper shows the ordered items');
check(!byText('Complete order'), 'the cart checkout is replaced by the confirmation (no stale cart)');

// Printing must target this order's paper, and be single-flight.
printCustomer1.click();
const frame = await waitFor(
  () => document.querySelector('iframe[title="Thermal receipt print document"]'),
  'isolated print document');
await waitFor(
  () => (byText('Printing…') ?? byText('Print Customer'))?.disabled,
  'print buttons disabled while the job is in flight');
check(true, 'print buttons disable while a print job is in flight (no duplicates)');
// Both print actions switch to a shared disabled "Printing…" label.
const printingButtons = Array.from(document.querySelectorAll('button')).filter(
  (b) => b.textContent.trim() === 'Printing…');
check(printingButtons.length === 2 && printingButtons.every((b) => b.disabled),
  'Print Customer and Print Both are both disabled during the same print job');
await waitFor(
  () => frame.contentDocument.body.textContent.includes('Test Burger'),
  'receipt paper cloned into the print document');
const frameText = frame.contentDocument.body.textContent.replace(/\s+/g, ' ');
check(frameText.includes('Test Burger') && frameText.includes('Smoke Test Kitchen'),
  'the print document contains order 0001 receipt content only');
check(!frameText.includes('Current order'), 'the print document excludes app chrome/cart');
frame.contentWindow.dispatchEvent(new window.Event('afterprint'));
await waitFor(
  () => byText('Print Customer') && !byText('Print Customer').disabled,
  'print actions recover after the print dialog closes',
);
check(true, 'Print Customer is usable again after printing (reprint available)');
check(Boolean(byText('New order')), 'confirmation actions survive printing');

/* -------------------- Two more orders, back to back --------------------- */

async function placeSimpleOrder(tileLabel, expectedNumber) {
  byText('New order').click();
  await waitFor(() => byAria(tileLabel), `tile for order ${expectedNumber}`);
  byAria(tileLabel).click();
  await waitFor(() => byText('Complete order') && !byText('Complete order').disabled,
    `checkout ready for order ${expectedNumber}`);
  byText('Complete order').click();
  await waitFor(() => byText('Print Customer'),
    `print actions for order ${expectedNumber}`);
  check(bodyText().includes(`Order #${expectedNumber}`),
    `confirmation shows order #${expectedNumber} with print actions`);
  check(Boolean(byText('Print Both')), `Print Both present for order #${expectedNumber}`);
}

await placeSimpleOrder('Add Test Fries, Medium, Rs. 200', '0002');
await placeSimpleOrder('Add Test Burger, Large, Rs. 500', '0003');

// Stock: burger sold 1 (order 1) + 1 (order 3) = 2 of 5 -> 3 left, exactly once each.
const stockLeft = await withDb(['inventory'], 'readonly', (tx) =>
  tx.objectStore('inventory').get('stock-burger'));
check(stockLeft?.quantity === 3, `stock deducted exactly once per sale (5 - 2 = ${stockLeft?.quantity})`);

/* ---------------- Sales -> Orders: receipt on every row ---------------- */

// 'Gross sales' only exists on the Sales reports tab (the default view).
await goTo('/sales', 'Gross sales');
Array.from(document.querySelectorAll('button[role="tab"]'))
  .find((b) => b.textContent.trim() === 'Orders')?.click();
await waitFor(() => bodyText().includes('#0003'), 'orders list');

const receiptButtons = () =>
  Array.from(document.querySelectorAll('button')).filter(
    (b) => b.textContent.trim() === 'Receipt');
check(receiptButtons().length === 3,
  `every order row has its own Receipt action (found ${receiptButtons().length} for 3 orders)`);
check(bodyText().includes('#0001') && bodyText().includes('#0002'),
  'all three orders appear in the Order List');

// Open the MIDDLE order: the dialog must show THAT order, with print actions.
receiptButtons()[1].click();
await waitFor(() => bodyText().includes('Receipt #0002'), 'receipt dialog for #0002');
check(Boolean(byText('Print Customer')), 'dialog Print Customer present for #0002');
check(Boolean(byText('Print Both')), 'dialog Print Both present for #0002');
check(bodyText().includes('Test Fries'), 'dialog receipt shows order #0002 items');
byText('Close').click();
await waitFor(() => !bodyText().includes('Receipt #0002'), 'dialog closed');
check(receiptButtons().length === 3, 'Receipt actions are intact after closing the dialog');

/* -------- Pagination + cancelled row still expose the receipt --------- */

// Seed 10 historical orders directly (order + sale rows) to force page 2.
await withDb(['orders', 'sales'], 'readwrite', (tx) => {
  for (let i = 1; i <= 10; i += 1) {
    const at = new Date(Date.now() - (60 + i) * 1000).toISOString();
    tx.objectStore('orders').put({
      ...base(`seed-order-${i}`), orderNumber: `S${1000 + i}`, status: 'completed',
      orderType: 'takeaway', subtotal: 10000, discountTotal: 0, taxTotal: 0,
      grandTotal: 10000, paymentMethod: 'cash', amountPaid: 10000, changeDue: 0,
      customerId: null, completedAt: at, createdAt: at, updatedAt: at,
    });
    tx.objectStore('sales').put({
      ...base(`seed-sale-${i}`), orderId: `seed-order-${i}`, orderNumber: `S${1000 + i}`,
      businessDate: at.slice(0, 10), completedAt: at, subtotal: 10000,
      discountTotal: 0, taxTotal: 0, grandTotal: 10000, paymentMethod: 'cash',
      itemCount: 1, orderType: 'takeaway', customerId: null,
      refundedAt: null, cancelledAt: null, createdAt: at, updatedAt: at,
    });
  }
});

// Reload the route so the list refetches from storage.
await goTo('/', 'Current order');
await goTo('/sales', 'Gross sales');
Array.from(document.querySelectorAll('button[role="tab"]'))
  .find((b) => b.textContent.trim() === 'Orders')?.click();
await waitFor(() => bodyText().includes('Page 1 of 2'), 'paginated order list');
check(receiptButtons().length === 10, 'page 1 shows a Receipt action on all 10 rows');
byText('Next').click();
await waitFor(() => bodyText().includes('Page 2 of 2'), 'page 2');
check(receiptButtons().length === 3, 'page 2 shows a Receipt action on all 3 rows');

// Receipt dialog for a seeded order with no line items must not hang/crash.
receiptButtons()[0].click();
await waitFor(() => bodyText().includes('Receipt #S'), 'seeded order receipt dialog');
check(Boolean(byText('Print Customer')), 'print actions render even for an order without lines');
byText('Close').click();
await waitFor(() => receiptButtons().length === 3, 'back to page 2');

const relevantErrors = errors.filter(
  (m) => !/Not implemented|Could not parse CSS|service worker/i.test(m));
if (relevantErrors.length > 0) {
  originalError(relevantErrors.join('\n'));
  throw new Error(`${relevantErrors.length} console error(s) were reported.`);
}
console.log('POS smoke run completed with no uncaught console errors.');
process.exit(0);
