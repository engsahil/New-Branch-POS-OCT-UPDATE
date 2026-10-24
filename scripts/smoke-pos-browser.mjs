/**
 * Real-browser regression smoke for the POS full-screen order/receipt flow.
 *
 * Covers what Happy DOM cannot: actual layout, occlusion, scrolling and
 * hit-testing in Chromium — including the three defects behind the field
 * report "Print Receipt disappears / merges after placing an order":
 *
 *   1. the guided tour rendering above modal dialogs and covering the
 *      receipt dialog's print actions on narrow screens;
 *   2. receipt/preference load failures silently stranding the cashier
 *      without print actions (now: visible error + Retry, width fallback,
 *      and a tolerant receipt build for legacy deal records);
 *   3. the mobile (<=819px) cart line list collapsing to 0px, taking the
 *      quantity steppers with it.
 *
 * Plus: rapid double-click on "Complete order" creates exactly one order.
 *
 * Development-only, like the other smokes. Chromium comes from the
 * @sparticuz/chromium npm tarball (no browser download); on minimal Linux
 * images its bundled AL2023 libraries are extracted automatically.
 *
 *   npm install --no-save puppeteer-core @sparticuz/chromium
 *   VITE_ADMIN_PASSWORD=smoke-test-password VITE_EXPOSE_TEST_API=true npm run build
 *   node scripts/smoke-pos-browser.mjs
 *   npm run build   # rebuild normally afterwards
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}`;

/* ----------------------- Chromium library bootstrap ---------------------- */
const libDir = '/tmp/al2023/lib';
if (!fs.existsSync(path.join(libDir, 'libnspr4.so'))) {
  const br = path.join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br');
  fs.mkdirSync('/tmp/al2023', { recursive: true });
  fs.writeFileSync('/tmp/al2023.tar', zlib.brotliDecompressSync(fs.readFileSync(br)));
  execFileSync('tar', ['-xf', '/tmp/al2023.tar', '-C', '/tmp/al2023']);
}

/* ------------------------------ Preview server --------------------------- */
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  cwd: root, stdio: 'ignore',
});
process.on('exit', () => server.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('preview server did not start');
}
await waitServer();

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: libDir },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

let checks = 0;
function check(condition, label) {
  checks += 1;
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`PASS  ${label}`);
}
const text = (t, timeout = 15000) => page.waitForFunction(
  (x) => document.body.textContent.includes(x), { timeout }, t);
const btn = (label) => page.evaluateHandle((t) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === t), label);
const clickText = (label) => page.evaluate((t) => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === t);
  if (!b) throw new Error(`missing button ${t}`);
  b.click();
}, label);
/** Is the centre of this button actually hit-testable (not covered)? */
const uncovered = (label) => page.evaluate((t) => {
  const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === t);
  if (!el) return `missing:${t}`;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return `zero-size:${t}`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (hit === el || el.contains(hit)) return true;
  const chain = [];
  let n = hit;
  while (n && chain.length < 4) { chain.push(`${n.tagName}.${String(n.className).slice(0, 36)}`); n = n.parentElement; }
  return `covered:${t} by ${chain.join(' < ')} rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}]`;
}, label);

/* --------------------------------- Setup --------------------------------- */
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE, { waitUntil: 'networkidle2' });
await text('Sign in');
await page.type('input[name="username"]', 'admin');
await page.type('input[name="password"]', 'smoke-test-password');
await page.$eval('form', (f) => f.requestSubmit());
await page.waitForSelector('#main-content');

// Fresh-install seed (tour NOT completed): profile + five priced items.
await page.evaluate(async () => {
  const now = new Date().toISOString();
  const base = (id) => ({ id, createdAt: now, updatedAt: now, deletedAt: null, rev: 1 });
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('pos-db');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction(['restaurant', 'menuItems', 'itemPrices', 'deals', 'orders', 'orderItems', 'sales'], 'readwrite');
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    tx.objectStore('restaurant').put({
      ...base('restaurant-profile'), name: 'Smoke Test Kitchen', logo: null, banner: null,
      tagline: '', address: '1 Test Road', phone: '555-0000', email: '', receiptInfo: '',
      receiptFooter: 'Thank you!', taxPercent: 0, taxInclusive: false,
    });
    for (let i = 1; i <= 5; i += 1) {
      tx.objectStore('menuItems').put({
        ...base(`item-${i}`), name: `Test Item ${i}`, description: '', category: 'Mains',
        image: null, isActive: 1, tracksInventory: 0, variantKind: 'size', discountPercent: null,
      });
      tx.objectStore('itemPrices').put({
        ...base(`price-${i}`), menuItemId: `item-${i}`, label: 'Large', price: 10000 * i, isDefault: 1,
      });
    }
    // A legacy deal record from before the items array existed, plus a
    // completed order whose only line is that deal (the historical crash).
    tx.objectStore('deals').put({ ...base('deal-legacy'), name: 'Legacy Deal', price: 10000, isActive: 1 });
    tx.objectStore('orders').put({
      ...base('order-legacy'), orderNumber: 'L001', status: 'completed', orderType: 'takeaway',
      subtotal: 10000, discountTotal: 0, taxTotal: 0, grandTotal: 10000, paymentMethod: 'cash',
      amountPaid: 10000, changeDue: 0, customerId: null, completedAt: now,
    });
    tx.objectStore('orderItems').put({
      ...base('oi-legacy'), orderId: 'order-legacy', menuItemId: null, dealId: 'deal-legacy',
      itemPriceId: null, name: 'Legacy Deal', unitPrice: 10000, quantity: 1, discount: 0, lineTotal: 10000,
    });
    tx.objectStore('sales').put({
      ...base('sale-legacy'), orderId: 'order-legacy', orderNumber: 'L001', businessDate: now.slice(0, 10),
      completedAt: now, subtotal: 10000, discountTotal: 0, taxTotal: 0, grandTotal: 10000,
      paymentMethod: 'cash', itemCount: 1, orderType: 'takeaway', customerId: null,
      refundedAt: null, cancelledAt: null,
    });
  });
});
// Signing in opens the Dashboard (v5.1.9 flow); the POS lives at '/'.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.waitForSelector('#main-content');
await page.waitForFunction(() => window.__pos?.receiptService, { timeout: 15000 });
await text('Test Item 1');
console.log('setup ok');

/* --------------- A. Tour never covers print actions ---------------------- */
await text('Skip tour');
check(true, 'guided tour auto-starts on a fresh install');
await page.click('button[aria-label^="Add Test Item 1"]');
await clickText('Complete order');
await text('Print Customer');
await sleep(400);
for (const [w, h] of [[1440, 900], [834, 1112], [390, 844]]) {
  await page.setViewport({ width: w, height: h });
  await sleep(500);
  for (const label of ['Print Customer', 'Print Both', 'New order']) {
    check((await uncovered(label)) === true,
      `tour active: ${label} hit-testable on confirmation at ${w}x${h}`);
  }
}
// Same check inside the modal receipt dialog (the original overlap).
await page.setViewport({ width: 1440, height: 900 });
await page.evaluate(() => document.querySelector('a[href="/sales"]')?.click());
await text('Gross sales');
await page.evaluate(() => Array.from(document.querySelectorAll('button[role="tab"]'))
  .find((b) => b.textContent.trim() === 'Orders')?.click());
await text('#L001');
await clickText('Receipt');
await text('Receipt #');
await sleep(600);
for (const [w, h] of [[640, 900], [360, 640]]) {
  await page.setViewport({ width: w, height: h });
  await sleep(500);
  for (const label of ['Print Customer', 'Print Both']) {
    const state = await uncovered(label);
    if (state !== true) {
      await page.screenshot({ path: `/tmp/dialog-covered-${w}.png` });
      console.log('COVER STATE:', state);
    }
    check(state === true,
      `tour active: ${label} hit-testable in receipt dialog at ${w}x${h}`);
  }
}
await page.keyboard.press('Escape');
await sleep(300);
// Escape closes the tour as well (it has its own handler); click Skip only
// if it is still up.
await page.evaluate(() => Array.from(document.querySelectorAll('button'))
  .find((b) => b.textContent.trim() === 'Skip tour')?.click());
await sleep(300);
check(true, 'tour dismissed after dialog checks');

/* --------- B. Receipt failures are visible and retryable ----------------- */
await page.setViewport({ width: 1440, height: 900 });
// B1: confirmation screen
await page.evaluate(() => {
  const rs = window.__pos.receiptService;
  rs.__realBuild = rs.build;
  rs.build = () => Promise.reject(new Error('injected storage failure'));
});
await page.evaluate(() => document.querySelector('a[href="/"]')?.click());
await text('Test Item 1');
await page.click('button[aria-label^="Add Test Item 2"]');
await clickText('Complete order');
await text('Retry receipt');
check(true, 'failing receipt build shows an error with Retry (order still saved)');
check((await page.evaluate(() => document.body.textContent.includes('Order saved, but the receipt could not be prepared'))),
  'confirmation explains the order is saved and where to reprint');
await page.evaluate(() => { const rs = window.__pos.receiptService; rs.build = rs.__realBuild; });
await clickText('Retry receipt');
await text('Print Customer');
check(true, 'Retry receipt restores the print actions after recovery');

// B2: order-list dialog
await page.evaluate(() => { const rs = window.__pos.receiptService; rs.build = () => Promise.reject(new Error('injected storage failure')); });
await page.evaluate(() => document.querySelector('a[href="/sales"]')?.click());
await text('Gross sales');
await page.evaluate(() => Array.from(document.querySelectorAll('button[role="tab"]'))
  .find((b) => b.textContent.trim() === 'Orders')?.click());
await clickText('Receipt');
await text('Retry');
check(true, 'failing dialog load shows Retry instead of endless "Loading receipt…"');
await page.evaluate(() => { const rs = window.__pos.receiptService; rs.build = rs.__realBuild; });
await clickText('Retry');
await text('Print Customer');
check(true, 'dialog Retry loads the receipt with print actions');
await page.keyboard.press('Escape');
await sleep(300);

// B3: paper-width read failure falls back, toolbar intact
await page.evaluate(() => {
  const rs = window.__pos.receiptService;
  rs.__realGetWidth = rs.getWidth;
  rs.getWidth = () => Promise.reject(new Error('injected settings failure'));
});
await clickText('Receipt');
await text('Print Customer');
check(true, 'failing paper-width read still renders receipt + print actions');
check((await page.evaluate(() => document.body.textContent.includes('Could not load the saved paper width'))),
  'width fallback is announced to the cashier');
await page.evaluate(() => { const rs = window.__pos.receiptService; rs.getWidth = rs.__realGetWidth; });
await page.keyboard.press('Escape');
await sleep(300);

// B4: legacy deal record receipts build and print
await page.evaluate(() => {
  Array.from(document.querySelectorAll('li')).find((li) => li.textContent.includes('#L001'))
    ?.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Receipt') b.click(); });
});
await text('Receipt #L001');
await text('Print Customer');
check(true, 'order whose deal predates the items array still gets a printable receipt');
await page.keyboard.press('Escape');
await sleep(300);

// B5: the error-state confirmation card stays fully usable on a small phone
await page.evaluate(() => { const rs = window.__pos.receiptService; rs.build = () => Promise.reject(new Error('injected storage failure')); });
await page.setViewport({ width: 360, height: 640 });
await page.evaluate(() => document.querySelector('a[href="/"]')?.click());
await text('Test Item 1');
for (let i = 1; i <= 5; i += 1) {
  await page.evaluate((n) => document.querySelector(`button[aria-label^="Add Test Item ${n}"]`)?.click(), i);
}
await clickText('Complete order');
await text('Retry receipt');
for (const label of ['Retry receipt', 'New order']) {
  await page.evaluate((t) => Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent.trim() === t)?.scrollIntoView({ block: 'center' }), label);
  await sleep(900);
  check((await uncovered(label)) === true,
    `error-state confirmation: ${label} reachable at 360x640`);
}
await page.evaluate(() => { const rs = window.__pos.receiptService; rs.build = rs.__realBuild; });
await clickText('Retry receipt');
await text('Print Customer');
check(true, 'error-state card recovers to a printable receipt on the small phone');
await clickText('New order');
await text('Test Item 1');

/* ---------------- C. Mobile cart: lines and steppers work ---------------- */
await page.evaluate(() => document.querySelector('a[href="/"]')?.click());
await text('Test Item 1');
await page.setViewport({ width: 390, height: 844 });
await sleep(300);
for (let i = 1; i <= 5; i += 1) {
  await page.evaluate((n) => document.querySelector(`button[aria-label^="Add Test Item ${n}"]`)?.click(), i);
}
await text('5 items');
const ulH = await page.evaluate(() =>
  document.querySelector('aside[aria-label="Current order"] ul')?.clientHeight ?? 0);
check(ulH > 80, `mobile cart line list has real height (${ulH}px, was 0)`);
await page.evaluate(() => document
  .querySelector('aside[aria-label="Current order"] button[aria-label^="Increase"]')
  .scrollIntoView({ block: 'center' }));
await sleep(900); // smooth scrolling
const stepperHit = await page.evaluate(() => {
  const el = document.querySelector('aside[aria-label="Current order"] button[aria-label^="Increase"]');
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit === el || el.contains(hit);
});
check(stepperHit, 'mobile quantity stepper is hit-testable after scrolling');
const plus = await page.$('aside[aria-label="Current order"] button[aria-label^="Increase"]');
const pbox = await plus.boundingBox();
await page.mouse.click(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2, { delay: 10 });
await text('6 items');
check(true, 'real mouse click on the mobile stepper increments the quantity');
const completeBox = await (await btn('Complete order')).boundingBox().catch(() => null);
await page.evaluate(() => Array.from(document.querySelectorAll('button'))
  .find((b) => b.textContent.trim() === 'Complete order')?.scrollIntoView({ block: 'center' }));
await sleep(900);
const completeState = await uncovered('Complete order');
if (completeState !== true) console.log('COMPLETE STATE:', completeState);
check(completeState === true,
  'Complete order is reachable and uncovered on mobile after scrolling');
// Stacked-tablet width (cart below items, no tab bar): same reachability.
await page.setViewport({ width: 700, height: 900 });
await sleep(300);
await page.evaluate(() => Array.from(document.querySelectorAll('button'))
  .find((b) => b.textContent.trim() === 'Complete order')?.scrollIntoView({ block: 'center' }));
await sleep(900);
check((await uncovered('Complete order')) === true,
  'Complete order is reachable and uncovered at stacked-tablet width 700px');
void completeBox;

/* ------------- D. Double-click Complete creates one order ---------------- */
await page.setViewport({ width: 1440, height: 900 });
await sleep(300);
const before = await page.evaluate(() => window.__pos.orderService.history().then((h) => h.length));
const handle = await btn('Complete order');
const box = await handle.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 5 });
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 5 });
await text('Print Customer');
await sleep(600);
const after = await page.evaluate(() => window.__pos.orderService.history().then((h) => h.length));
check(after === before + 1, `rapid double-click creates exactly one order (${before} -> ${after})`);

/* ------------- E. Desktop confirmation + list spot checks ---------------- */
for (const label of ['Print Customer', 'Print Both', 'New order']) {
  check((await uncovered(label)) === true, `${label} hit-testable on confirmation at 1440x900`);
}
await page.evaluate(() => document.querySelector('a[href="/sales"]')?.click());
await text('Gross sales');
await page.evaluate(() => Array.from(document.querySelectorAll('button[role="tab"]'))
  .find((b) => b.textContent.trim() === 'Orders')?.click());
await text('#L001');
const rowsOk = await page.evaluate(() => {
  const receipts = Array.from(document.querySelectorAll('button'))
    .filter((b) => b.textContent.trim() === 'Receipt');
  return receipts.length >= 3 && receipts.every((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.right <= window.innerWidth + 1;
  });
});
check(rowsOk, 'every order row shows a visible, in-viewport Receipt action');
// On a phone the LAST row's Receipt must scroll clear of the fixed tab bar.
await page.setViewport({ width: 390, height: 844 });
await sleep(300);
await page.evaluate(() => {
  const receipts = Array.from(document.querySelectorAll('button'))
    .filter((b) => b.textContent.trim() === 'Receipt');
  receipts[receipts.length - 1]?.scrollIntoView({ block: 'center' });
});
await sleep(900);
const lastRowClear = await page.evaluate(() => {
  const receipts = Array.from(document.querySelectorAll('button'))
    .filter((b) => b.textContent.trim() === 'Receipt');
  const el = receipts[receipts.length - 1];
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit === el || el.contains(hit);
});
check(lastRowClear, 'last order row Receipt scrolls clear of the tab bar at 390px');

const jsErrors = pageErrors.filter((m) => !/injected/.test(m));
check(jsErrors.length === 0, `no unhandled page errors (got: ${jsErrors.join(' | ') || 'none'})`);

await browser.close();
server.kill();
console.log(`\nPOS browser smoke: all ${checks} checks passed.`);
process.exit(0);
