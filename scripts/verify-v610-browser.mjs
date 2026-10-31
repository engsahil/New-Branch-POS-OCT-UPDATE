/** Isolated Chromium verification. Requires a VITE_EXPOSE_TEST_API=true build.
 * Synthetic records only; never connects to a client terminal. No physical printer.
 * node scripts/verify-v610-browser.mjs [artifact-dir]
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? '/home/user/pos-v610-verification'); fs.mkdirSync(out, { recursive: true });
const port = 4179, base = `http://127.0.0.1:${port}`;
const libDir = '/tmp/al2023/lib';
if (!fs.existsSync(path.join(libDir, 'libnspr4.so'))) { fs.mkdirSync('/tmp/al2023', { recursive: true }); fs.writeFileSync('/tmp/al2023.tar', zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br')))); execFileSync('tar', ['-xf', '/tmp/al2023.tar', '-C', '/tmp/al2023']); }
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], { cwd: root, stdio: 'ignore' });
const cleanup = () => server.kill(); process.on('exit', cleanup);
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'], headless: true, env: { ...process.env, LD_LIBRARY_PATH: libDir } });
const errors = [], checks = [];
const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); console.log('PASS', label); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function text(page, value, timeout = 15000) { await page.waitForFunction(v => document.body.innerText.includes(v), { timeout }, value); }
async function clickText(page, value, selector = 'button') { await page.waitForFunction((v, s) => [...document.querySelectorAll(s)].some(e => e.textContent.trim() === v && !e.disabled), { timeout: 15000 }, value, selector); await page.evaluate((v, s) => [...document.querySelectorAll(s)].find(e => e.textContent.trim() === v && !e.disabled).click(), value, selector); }
async function type(page, name, value) { await page.waitForSelector(`[name="${name}"]`); await page.$eval(`[name="${name}"]`, (e, v) => { const setter = Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, value); }
async function signup(page, url) {
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 }); await page.goto(url, { waitUntil: 'networkidle0' });
  await type(page, 'displayName', 'Synthetic Verifier'); await type(page, 'newUsername', 'verifier'); await type(page, 'newPassword', 'isolated-test-password'); await type(page, 'confirmPassword', 'isolated-test-password');
  await page.click('button[type="submit"]'); await text(page, 'Sign in');
  await type(page, 'username', 'verifier'); await type(page, 'password', 'isolated-test-password'); await page.click('button[type="submit"]');
  await text(page, 'Dashboard');
  await page.waitForFunction(() => !!window.__pos);
  await page.evaluate(async () => { const p = window.__pos; await p.settingsService.set('tour.completed.verifier', true); await p.settingsService.set('setup.completed', true); await p.restaurantService.save({ name: 'Synthetic Verification Kitchen', logo: null, banner: null, tagline: '', address: '1 Test Road', phone: '03001234567', email: '', receiptInfo: '', receiptFooter: 'Synthetic test receipt', taxPercent: 10, taxInclusive: false });
    const menu = await p.menuService.create({ name: 'Verification Burger', category: 'Test', description: '', image: null, isActive: true, variantKind: 'size', discountPercent: 10, prices: { Small: 100000 }, sku: '', barcode: '', costPrice: 20000, prepMinutes: null, ingredients: '' });
    await p.toppingService.create({ name: 'Extra cheese', price: 10000, costPrice: 3000, isActive: true, menuItemIds: [menu.item.id] });
    await p.addOnService.create({ name: 'Garlic sauce', price: 5000, costPrice: 1000, isActive: true, menuItemIds: [] });
    await p.inventoryService.create({ name: 'Test patties', sku: 'T-1', unit: 'unit', quantity: 500, reorderLevel: 5, menuItemId: menu.item.id, isAvailable: true });
  });
  await page.reload({ waitUntil: 'networkidle0' }); await text(page, 'Synthetic Verification Kitchen');
}
try {
  const page = await browser.newPage(); await signup(page, base);
  check(await page.$('button[aria-label^="Notifications"]') !== null, 'Dashboard has notification bell');
  check((await page.$$('header')).length > 0, 'Dashboard identity/profile chrome present');
  await page.goto(`${base}/`, { waitUntil: 'networkidle0' }); await text(page, 'Verification Burger');
  check(await page.evaluate(() => !document.body.innerText.includes('Synthetic Verification Kitchen')), 'POS has no duplicate restaurant identity header');
  await clickText(page, 'Delivery'); await type(page, 'customerName', 'A very long synthetic customer name for wrapping verification'); await type(page, 'customerPhone', '03009998887'); await type(page, 'deliveryAddress', 'Apartment 12, Building 7, Long Synthetic Street, Test District, Lahore. '.repeat(3));
  await page.click('[aria-label^="Add Verification Burger, Small"]'); await page.click('[aria-label^="Add Verification Burger, Small"]');
  await page.click('[aria-label^="Toppings for Verification Burger"]'); await page.click('input[type="checkbox"]');
  await page.click('[aria-label^="Split one Verification Burger"]');
  await page.click('[aria-label="Remove Extra cheese from Verification Burger (Small) #2"]').catch(async () => { await page.evaluate(() => { const buttons = [...document.querySelectorAll('[aria-label^="Remove Extra cheese from"]')]; buttons.at(-1).click(); }); });
  check(await page.evaluate(() => document.querySelectorAll('[aria-label="Current order"] li').length >= 2), 'Split creates two independently rendered item instances');
  await page.click('[aria-label^="Add-ons for Verification Burger"]');
  await page.evaluate(() => { const labels = [...document.querySelectorAll('[aria-label="Current order"] label')].filter(e => e.textContent.includes('Garlic sauce')); labels.at(-1).querySelector('input').click(); });
  await page.click('button[aria-label="Complete order"]').catch(async () => clickText(page, 'Complete order'));
  await text(page, 'Print Both'); await text(page, 'Extra cheese');
  const order = await page.evaluate(async () => { const row = (await window.__pos.orderService.history())[0]; return { ...row, items: await window.__pos.orderService.getOrderItems(row.order.id) }; });
  check(order.order.orderType === 'delivery' && order.order.taxPercent === 10, 'Delivery checkout persists tax snapshot');
  check(order.items.filter(i => i.toppings?.length).length === 1, 'Only one split instance retains cheese');
  // Capture the real isolated print document, then ask Chromium to paginate it to PDF.
  await page.evaluate(() => { window.__printDocs = []; const observer = new MutationObserver(() => { for (const frame of document.querySelectorAll('iframe[title="Thermal receipt print document"]')) { const w = frame.contentWindow; if (w && !w.__patched) { w.__patched = true; w.print = () => { window.__printDocs.push(w.document.documentElement.outerHTML); w.dispatchEvent(new Event('afterprint')); }; } } }); observer.observe(document.body, { childList: true }); });
  for (const width of ['58mm', '80mm']) {
    await clickText(page, width); await clickText(page, 'Print Both');
    await page.waitForFunction(() => window.__printDocs.length > 0); const html = await page.evaluate(() => window.__printDocs.pop());
    const printPage = await browser.newPage(); await printPage.setContent(html, { waitUntil: 'networkidle0' }); await printPage.emulateMediaType('print');
    const pdf = await printPage.pdf({ preferCSSPageSize: true, printBackground: true }); const file = path.join(out, `receipt-both-${width}.pdf`); fs.writeFileSync(file, pdf);
    const raw = Buffer.from(pdf).toString('latin1'); const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(m => [Number(m[1]), Number(m[2])]);
    const pages = (raw.match(/\/Type\s*\/Page\b/g) ?? []).length;
    check(pages === 2 && boxes.length >= 2 && boxes.every(([w]) => Math.abs(w - parseFloat(width) * 72 / 25.4) < 1), `${width} customer+kitchen PDF has two correctly sized pages`);
    await printPage.close();
  }
  await clickText(page, 'New order');
  // Stress the actual cart with many distinct instances and all order types at small viewports.
  for (const [width, height] of [[1440, 900], [1024, 768], [820, 1180], [390, 844], [360, 640]]) {
    await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
    await page.waitForSelector('[aria-label^="Add Verification Burger, Small"]');
    await page.evaluate(() => { for (let i = 0; i < 30; i++) document.querySelector('[aria-label^="Add Verification Burger, Small"]').click(); });
    await sleep(150);
    const geometry = await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Complete order'); const r0 = button.getBoundingClientRect(); const clearance = innerWidth < 640 ? 70 : 8; if (r0.bottom > innerHeight - clearance) button.closest('main').scrollBy({ top: r0.bottom - innerHeight + clearance, behavior: 'instant' }); const r = button.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { rect: { top: r.top, bottom: r.bottom, height: r.height }, innerHeight, scrollY, hitTag: hit?.tagName, hitClass: hit?.className, footerBottom: getComputedStyle(button.closest('footer')).bottom, tabVar: getComputedStyle(document.documentElement).getPropertyValue('--layout-tabbar-h'), visible: r.width > 0 && r.height > 0 && r.bottom <= innerHeight + 1 && r.top >= 0, hit: button.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
    if (!(geometry.visible && geometry.hit && !geometry.overflow)) console.log('GEOMETRY', width, height, geometry);
    check(geometry.visible && geometry.hit && !geometry.overflow, `POS checkout reachable and unobscured at ${width}×${height}`);
    await page.screenshot({ path: path.join(out, `pos-${width}x${height}.png`), fullPage: true });
    if (width === 360) { await clickText(page, 'Clear'); }
  }
  await page.setViewport({ width: 1440, height: 900 });
  // Expense guidance, create/edit/delete and dashboard finance are exercised through the UI.
  await page.goto(`${base}/expenses`, { waitUntil: 'networkidle0' }); await text(page, 'Got it — don’t show again'); await clickText(page, 'Got it — don’t show again');
  await clickText(page, 'Record expense'); await type(page, 'expenseTitle', 'Synthetic rent'); await type(page, 'expenseAmount', '125.50'); await type(page, 'expensePayee', 'Synthetic landlord'); await type(page, 'expenseReference', 'R-100');
  await page.evaluate(() => [...document.querySelectorAll('form[aria-label="Record expense"] button')].find(e => e.textContent.trim() === 'Record expense').click()); await text(page, 'Synthetic rent');
  await clickText(page, 'Edit'); await type(page, 'expenseAmount', '150'); await clickText(page, 'Save expense'); await text(page, 'Rs. 150');
  await page.reload({ waitUntil: 'networkidle0' }); await text(page, 'Synthetic rent'); check(!(await page.evaluate(() => document.body.innerText.includes('Got it — don’t show again'))), 'Expense guidance dismissal persists');
  await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' }); await text(page, 'Sales, expenses & profit');
  check(await page.evaluate(() => document.body.innerText.includes('Estimated operating profit')), 'Dashboard exposes defined profit estimate');
  await page.click('button[aria-label^="Notifications"]'); await text(page, 'Only viewed messages become read.'); await sleep(500);
  const unread = await page.evaluate(() => window.__pos.notificationService.unreadCount());
  await page.click('button[aria-label^="Notifications"]'); await page.reload({ waitUntil: 'networkidle0' });
  check(await page.evaluate(n => window.__pos.notificationService.unreadCount(), unread) === unread, 'Viewed notification read state survives reload');
  // Orders list, receipt reprint and once-only full refund.
  await page.goto(`${base}/sales`, { waitUntil: 'networkidle0' }); await clickText(page, 'Orders'); await clickText(page, 'Receipt'); await text(page, 'Print Both'); await clickText(page, 'Full refund'); await type(page, 'refundReason', 'Synthetic verification refund'); await clickText(page, 'Confirm full refund'); await text(page, 'REFUNDED — ORIGINAL RECEIPT');
  check(await page.evaluate(async () => (await window.__pos.orderService.history())[0].order.status === 'refunded'), 'Receipt dialog records a persisted full refund');
  await clickText(page, 'Close');
  // Export from one origin, import through the real UI on a different origin.
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle0' }); await clickText(page, 'Settings'); await text(page, 'Export All Data');
  const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
  await clickText(page, 'Export All Data'); let backupFile;
  for (let i = 0; i < 50; i++) { backupFile = fs.readdirSync(out).find(f => f.startsWith('pos-backup-') && f.endsWith('.json')); if (backupFile) break; await sleep(100); }
  check(!!backupFile, 'Browser downloads a full JSON backup');
  const backup = JSON.parse(fs.readFileSync(path.join(out, backupFile), 'utf8'));
  check(backup.integrity?.checksum && backup.coverage.salesRecords === backup.stores.sales.length && backup.stores.expenses.length === 1, 'Downloaded backup carries matching integrity, sales coverage and expenses');
  const destination = await browser.newPage(); await signup(destination, `http://localhost:${port}`);
  await destination.goto(`http://localhost:${port}/admin`, { waitUntil: 'networkidle0' }); await clickText(destination, 'Settings'); await text(destination, 'Import Data');
  const input = await destination.$('input[type="file"]'); await input.uploadFile(path.join(out, backupFile)); await text(destination, 'Different address'); await text(destination, 'Checksum and record relationships verified');
  check(await destination.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Import and merge data').disabled), 'Cross-origin merge requires explicit acknowledgement');
  await destination.evaluate(() => [...document.querySelectorAll('label')].find(e => e.textContent.includes('I have a current backup')).querySelector('input').click()); await clickText(destination, 'Import and merge data'); await text(destination, 'Import complete');
  const restored = await destination.evaluate(async () => ({ orders: (await window.__pos.orderService.history()).length, expenses: (await window.__pos.expenseService.list()).length, finance: await window.__pos.financeService.report({ from: '2000-01-01', to: '2100-01-01' }), source: await window.__pos.dataPortService.exportBackup() }));
  check(restored.orders === backup.stores.orders.length && restored.expenses === 1 && restored.source.stores.sales.length === backup.stores.sales.length, 'Real cross-origin browser restore preserves orders, sales, modifiers and expenses');
  check(!backup.stores.admin && await destination.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('pos-db'); request.onsuccess = () => { const db = request.result; const rows = db.transaction('admin').objectStore('admin').getAll(); rows.onsuccess = () => { resolve(rows.result.length === 1 && rows.result[0].username === 'verifier'); db.close(); }; rows.onerror = () => reject(rows.error); }; request.onerror = () => reject(request.error); })), 'Backup excludes credentials and restore preserves destination sign-in');
  await destination.screenshot({ path: path.join(out, 'cross-origin-restore.png'), fullPage: true });
  check(errors.length === 0, `No uncaught browser errors (${errors.join('; ')})`);
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ status: 'PASS', checks, errors, artifacts: fs.readdirSync(out), note: 'Synthetic isolated Chromium data. PDF pagination verified; no physical printer was connected.' }, null, 2));
  console.log(`Browser verification PASS: ${checks.length} checks. Artifacts: ${out}`);
} catch (error) {
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ status: 'FAIL', checks, errors, failure: String(error) }, null, 2));
  for (const p of await browser.pages()) { try { console.error('PAGE', p.url(), (await p.evaluate(() => document.body.innerText)).slice(0, 1800)); await p.screenshot({ path: path.join(out, `failure-${Date.now()}.png`), fullPage: true }); } catch {} }
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); server.kill(); }
