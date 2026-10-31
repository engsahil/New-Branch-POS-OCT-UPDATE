/** Focused isolated Chromium QA for the requested UI update. Synthetic data only.
 * Requires VITE_EXPOSE_TEST_API=true build. node scripts/verify-ui-browser.mjs [out]
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? '/home/user/pos-ui-verification'); fs.mkdirSync(out, { recursive: true });
const port = 4181, base = `http://127.0.0.1:${port}`;
const libDir = '/tmp/al2023/lib';
if (!fs.existsSync(path.join(libDir, 'libnspr4.so'))) { fs.mkdirSync('/tmp/al2023', { recursive: true }); fs.writeFileSync('/tmp/al2023.tar', zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br')))); execFileSync('tar', ['-xf', '/tmp/al2023.tar', '-C', '/tmp/al2023']); }
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'], headless: true, env: { ...process.env, LD_LIBRARY_PATH: libDir } });
const errors = [], checks = [];
const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); console.log('PASS', label); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function text(page, value, timeout = 15000) { await page.waitForFunction(v => document.body.innerText.includes(v), { timeout }, value); }
async function clickText(page, value, selector = 'button') { await page.waitForFunction((v, s) => [...document.querySelectorAll(s)].some(e => e.textContent.trim() === v && !e.disabled), { timeout: 15000 }, value, selector); await page.evaluate((v, s) => [...document.querySelectorAll(s)].find(e => e.textContent.trim() === v && !e.disabled).click(), value, selector); }
async function type(page, name, value) { await page.waitForSelector(`[name="${name}"]`); await page.$eval(`[name="${name}"]`, (e, v) => { const setter = Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, value); }
async function signup(page) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1440, height: 900 }); await page.goto(base, { waitUntil: 'networkidle0' });
  for (const [n, v] of Object.entries({ displayName: 'Synthetic UI Auditor', newUsername: 'uiauditor', newPassword: 'isolated-ui-password', confirmPassword: 'isolated-ui-password' })) await type(page, n, v);
  await page.click('button[type="submit"]'); await text(page, 'Sign in');
  await type(page, 'username', 'uiauditor'); await type(page, 'password', 'isolated-ui-password'); await page.click('button[type="submit"]');
  await page.waitForFunction(() => !!window.__pos);
  await page.evaluate(async () => { const p = window.__pos; await p.settingsService.set('tour.completed.uiauditor', true); await p.settingsService.set('setup.completed', true);
    await p.restaurantService.save({ name: 'Synthetic UI Kitchen', logo: null, banner: null, tagline: '', address: '1 Test Road', phone: '03001234567', email: '', receiptInfo: '', receiptFooter: 'Synthetic receipt', taxPercent: 10, taxInclusive: false });
    const names = ['Classic burger', 'Chicken pizza', 'Club sandwich', 'Beef wrap', 'Loaded fries', 'Grilled bowl', 'Family bucket', 'Signature long product name for wrapping and control visibility verification'];
    for (const name of names) await p.menuService.create({ name, category: name.includes('pizza') ? 'Pizza' : 'Mains', description: '', image: null, isActive: true, variantKind: 'size', discountPercent: 0, prices: { Small: 100000, Medium: 150000, Large: 200000 }, sku: '', barcode: '', costPrice: 20000, prepMinutes: null, ingredients: '' });
    const menu = await p.menuService.list(); const burger = menu.find(m => m.item.name === 'Classic burger');
    await p.toppingService.create({ name: 'Extra cheese', price: 10000, costPrice: 3000, isActive: true, menuItemIds: [] });
    await p.toppingService.create({ name: 'Jalapeno', price: 5000, costPrice: 1000, isActive: true, menuItemIds: [] });
    await p.addOnService.create({ name: 'Garlic sauce', price: 5000, costPrice: 1000, isActive: true, menuItemIds: [] });
    await p.addOnService.create({ name: 'House sauce', price: 3000, costPrice: 500, isActive: true, menuItemIds: [] });
    await p.inventoryService.create({ name: 'Synthetic stock', sku: 'UI-1', unit: 'unit', quantity: 10000, reorderLevel: 5, menuItemId: burger.item.id, isAvailable: true });
  });
  await page.reload({ waitUntil: 'networkidle0' });
}
async function add(page, name, size) { await page.click(`[aria-label^="Add ${name}, ${size}"]`); }
async function cartRows(page) { return page.$$('[aria-label="Current order"] [data-cart-line]'); }
async function rowAction(page, index, prefix) { const rows = await cartRows(page); await rows[index].evaluate((row, p) => { const button = [...row.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith(p)); button.click(); }, prefix); }
async function geometry(page, label) {
  const result = await page.evaluate(() => {
    const panel = document.querySelector('[aria-label="Current order"]');
    const body = panel.querySelector('ul[aria-label="Order items"]').parentElement;
    const rows = [...panel.querySelectorAll('[data-cart-line]')];
    const footer = panel.querySelector('footer');
    const mobile = innerWidth <= 819;
    const main = document.querySelector('main');
    const reveal = (el) => {
      if (mobile) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); const f = footer.getBoundingClientRect(); if (f.top < innerHeight && r.bottom > f.top - 8) main.scrollBy({ top: r.bottom - f.top + 8, behavior: 'instant' }); const r2 = el.getBoundingClientRect(); if (r2.top < 8) main.scrollBy({ top: r2.top - 8, behavior: 'instant' }); }
      else { body.scrollTop = el.offsetTop - body.offsetTop - 8; if (panel.scrollHeight > panel.clientHeight) panel.scrollTop = Math.max(0, el.offsetTop - panel.offsetTop - 8); }
    };
    const issues = []; let sample = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]; reveal(row);
      const r = row.getBoundingClientRect();
      if (r.height < 120) issues.push(`row ${i} compressed ${r.height}`);
      if (i > 0) { const prev = rows[i - 1].getBoundingClientRect(); if (r.top < prev.bottom - 1) issues.push(`row ${i} overlaps previous`); }
      for (const button of row.querySelectorAll('button')) {
        reveal(button); const b = button.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        if (b.width < 20 || b.height < 20 || !button.contains(hit)) { issues.push(`control hidden ${button.getAttribute('aria-label')}`); if (!sample) sample = { button: button.getAttribute('aria-label'), rect: { top: b.top, bottom: b.bottom }, hit: hit?.tagName + '.' + hit?.className, footer: footer.getBoundingClientRect().toJSON(), mainScroll: main.scrollTop, mainHeight: main.clientHeight, scrollY: scrollY }; }
      }
      const name = row.querySelector('h3'); if (!name || name.getBoundingClientRect().height === 0) issues.push(`name hidden ${i}`);
    }
    const checkout = [...panel.querySelectorAll('button')].find(b => b.textContent.trim() === 'Complete order');
    if (mobile) { const r = checkout.getBoundingClientRect(); main.scrollBy({ top: r.bottom - innerHeight + 80, behavior: 'instant' }); } else if (panel.scrollHeight > panel.clientHeight) panel.scrollTop = panel.scrollHeight;
    const c = checkout.getBoundingClientRect(); const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
    if (!checkout.contains(hit)) issues.push('checkout obscured');
    return { viewport: [innerWidth, innerHeight], rows: rows.length, bodyHeight: body.getBoundingClientRect().height, issues, sample, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  if (result.issues.length || result.horizontalOverflow) console.log('GEOMETRY', label, JSON.stringify(result));
  check(result.issues.length === 0 && !result.horizontalOverflow, `Cart rows and controls usable at ${label}`);
  await page.screenshot({ path: path.join(out, `cart-${label.replace(/[×\/]/g, 'x')}.png`), fullPage: true });
}
try {
  const page = await browser.newPage(); await signup(page);
  await page.goto(`${base}/`, { waitUntil: 'networkidle0' }); await text(page, 'Classic burger');
  await add(page, 'Classic burger', 'Medium'); await add(page, 'Classic burger', 'Medium');
  await add(page, 'Chicken pizza', 'Large'); await add(page, 'Signature long product name for wrapping and control visibility verification', 'Small');
  check((await cartRows(page)).length === 3, 'Different products and sizes render as three separate cart lines');
  await rowAction(page, 0, 'Increase'); await rowAction(page, 0, 'Decrease'); await rowAction(page, 1, 'Increase'); await rowAction(page, 1, 'Decrease');
  check(await page.evaluate(() => [...document.querySelectorAll('[data-cart-line] span[aria-label^="Quantity"]')].map(e => e.textContent).join(',') === '2,1,1'), 'Quantity controls update only their own line');
  await rowAction(page, 0, 'Toppings for'); await page.evaluate(() => { const row = document.querySelectorAll('[data-cart-line]')[0]; [...row.querySelectorAll('label')].find(l => l.textContent.includes('Extra cheese')).querySelector('input').click(); });
  await page.evaluate(() => { const row = document.querySelectorAll('[data-cart-line]')[0]; [...row.querySelectorAll('label')].find(l => l.textContent.includes('Jalapeno')).querySelector('input').click(); });
  await rowAction(page, 0, 'Add-ons for'); await page.evaluate(() => { const row = document.querySelectorAll('[data-cart-line]')[0]; [...row.querySelectorAll('label')].find(l => l.textContent.includes('Garlic sauce')).querySelector('input').click(); });
  check(await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-cart-line]')]; return rows[0].textContent.includes('Extra cheese') && rows[0].textContent.includes('Garlic sauce') && !rows[1].textContent.includes('Extra cheese') && !rows[2].textContent.includes('Garlic sauce'); }), 'Multiple toppings/add-ons attach only to the selected product');
  await rowAction(page, 0, 'Split one');
  check((await cartRows(page)).length === 4, 'Split quantity creates an independently editable instance');
  await rowAction(page, 1, 'Toppings for'); await page.evaluate(() => { const row = document.querySelectorAll('[data-cart-line]')[1]; [...row.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('Remove Extra cheese')).click(); });
  check(await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-cart-line]')]; const selected = (row) => row.querySelector('[aria-label^="Selected options"]')?.textContent ?? ''; return selected(rows[0]).includes('Extra cheese') && !selected(rows[1]).includes('Extra cheese'); }), 'Changing a split instance does not change the original');
  await rowAction(page, 3, 'Remove '); check((await cartRows(page)).length === 3, 'Remove deletes only the selected product');
  // Many distinct lines, long names and all requested viewport classes.
  for (const [name, size] of [['Club sandwich', 'Medium'], ['Beef wrap', 'Large'], ['Loaded fries', 'Small'], ['Grilled bowl', 'Medium'], ['Family bucket', 'Large'], ['Signature long product name for wrapping and control visibility verification', 'Large']]) await add(page, name, size);
  const stressLines = [['Classic burger', 'Medium'], ['Chicken pizza', 'Large'], ['Club sandwich', 'Medium'], ['Beef wrap', 'Large'], ['Loaded fries', 'Small'], ['Grilled bowl', 'Medium'], ['Family bucket', 'Large'], ['Signature long product name for wrapping and control visibility verification', 'Large'], ['Classic burger', 'Small']];
  for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [820, 1180], [820, 600], [390, 844], [360, 640]]) {
    await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 }); await sleep(200);
    // Changing mobile emulation can reload the page; rebuild the synthetic cart through the UI.
    if ((await cartRows(page)).length === 0) { for (const [name, size] of stressLines) await add(page, name, size); }
    await geometry(page, `${width}×${height}`);
  }
  await page.setViewport({ width: 1440, height: 900 }); await sleep(200);
  if ((await cartRows(page)).length === 0) { for (const [name, size] of stressLines) await add(page, name, size); }
  if (!(await page.evaluate(() => document.querySelector('[data-cart-line] [aria-label^="Selected options"]')?.textContent.includes('Extra cheese')))) {
    await rowAction(page, 0, 'Toppings for'); await page.evaluate(() => { const row = document.querySelector('[data-cart-line]'); [...row.querySelectorAll('label')].find(l => l.textContent.includes('Extra cheese')).querySelector('input').click(); });
  }
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Current order"] button')].find(b => b.textContent.includes('Discount & payment')).click());
  await type(page, 'discount', '300'); await text(page, 'Grand total');
  const totalsText = await page.$eval('[aria-label="Current order"] footer', e => e.innerText);
  check(totalsText.includes('Discount') && totalsText.includes('Tax (10%)') && totalsText.includes('Grand total'), 'Discount, tax and grand total remain visible');
  await clickText(page, 'Complete order'); await text(page, 'Print Both');
  const order = await page.evaluate(async () => { const row = (await window.__pos.orderService.history())[0]; return { ...row, items: await window.__pos.orderService.getOrderItems(row.order.id) }; });
  check(order.items.length === 9 && order.order.discountTotal === 30000, 'Checkout persists every cart line and the entered discount');
  const charged = order.items.reduce((sum, item) => sum + item.lineTotal, 0) - order.order.discountTotal;
  check(order.order.taxTotal === Math.round(charged * 0.1) && order.order.grandTotal === charged + order.order.taxTotal, 'Persisted subtotal, discount, tax and grand total follow existing rules');
  check(order.items.filter(i => i.toppings?.some(t => t.name === 'Extra cheese')).length === 1, 'Receipt/order data preserves independent split modifiers');
  await page.screenshot({ path: path.join(out, 'order-confirmation.png'), fullPage: true });
  // Reports is a different page and exports real data.
  await page.goto(`${base}/reports`, { waitUntil: 'networkidle0' }); await text(page, 'Business performance from recorded sales');
  check(await page.evaluate(() => document.body.innerText.includes('Payment methods') && document.body.innerText.includes('Order status') && document.body.innerText.includes('Tax summary')), 'Reports has dedicated analytics, status and tax modules');
  await clickText(page, 'This month'); await sleep(300);
  check(await page.evaluate(() => document.body.innerText.includes('Completed orders') && document.body.innerText.includes('Average order')), 'Reports period filter renders KPI analytics');
  const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
  await clickText(page, 'Export report CSV'); let csvFile; for (let i = 0; i < 50; i++) { csvFile = fs.readdirSync(out).find(f => f.startsWith('business-report-') && f.endsWith('.csv')); if (csvFile) break; await sleep(100); }
  check(!!csvFile && fs.readFileSync(path.join(out, csvFile), 'utf8').includes('Charged sales'), 'Reports CSV downloads recorded totals');
  await page.evaluate(() => { const set = (name, value) => { const e = document.querySelector(`[name="${name}"]`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, value); e.dispatchEvent(new Event('input', { bubbles: true })); }; set('reportFrom', '2020-01-01'); set('reportTo', '2020-01-31'); });
  await clickText(page, 'Apply range'); await text(page, 'No completed sales in this period'); check(true, 'Reports shows a truthful empty state');
  await page.screenshot({ path: path.join(out, 'reports-empty.png'), fullPage: true });
  await page.goto(`${base}/sales`, { waitUntil: 'networkidle0' }); await text(page, 'Orders'); await clickText(page, 'Orders'); await text(page, 'Receipt'); check(true, 'Sales retains its transaction interface and receipt actions');
  // Branding through the real Settings upload, then refresh and receipt.
  const logoData = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 96; c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#176B4D'; x.fillRect(0, 0, 96, 48); x.fillStyle = '#fff'; x.font = 'bold 20px sans-serif'; x.fillText('UI', 30, 30); return c.toDataURL('image/png').split(',')[1]; });
  const logoPath = path.join(out, 'synthetic-logo.png'); fs.writeFileSync(logoPath, Buffer.from(logoData, 'base64'));
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle0' }); await clickText(page, 'Restaurant'); await text(page, 'Upload logo');
  const logoInput = await page.$('input[type="file"]'); await logoInput.uploadFile(logoPath); await text(page, 'synthetic-logo.png'); await clickText(page, 'Save changes'); await text(page, 'Profile saved.');
  check(await page.evaluate(() => !!document.querySelector('aside[aria-label="Main"] img[alt="Synthetic UI Kitchen logo"]')), 'Uploaded logo replaces the sidebar default immediately');
  await page.reload({ waitUntil: 'networkidle0' }); check(await page.evaluate(() => !!document.querySelector('aside[aria-label="Main"] img[alt="Synthetic UI Kitchen logo"]')), 'Uploaded logo survives refresh');
  await page.goto(`${base}/sales`, { waitUntil: 'networkidle0' }); await clickText(page, 'Orders'); await clickText(page, 'Receipt'); await text(page, 'Print Both');
  check(await page.evaluate(() => [...document.querySelectorAll('img')].some(i => i.src.startsWith('data:image/') && i.closest('[data-receipt-width]'))), 'Receipt uses the same uploaded logo'); await clickText(page, 'Close');
  // Profile picture and fields through the real form.
  await page.goto(`${base}/profile`, { waitUntil: 'networkidle0' }); await text(page, 'Personal information');
  const avatarInput = await page.$('input[type="file"]'); await avatarInput.uploadFile(logoPath); await text(page, 'synthetic-logo.png');
  for (const [n, v] of Object.entries({ displayName: 'Synthetic Updated Auditor', profileEmail: 'auditor@example.test', profilePhone: '03007654321', jobTitle: 'Operations Manager', department: 'Operations', profileAddress: '2 Synthetic Avenue', bio: 'Isolated browser verification profile.' })) await type(page, n, v);
  await clickText(page, 'Save changes'); await text(page, 'Profile saved on this device.');
  await page.reload({ waitUntil: 'networkidle0' });
  check(await page.evaluate(() => document.querySelector('[name="displayName"]').value === 'Synthetic Updated Auditor' && document.querySelector('[name="jobTitle"]').value === 'Operations Manager' && !!document.querySelector('img[alt="Synthetic Updated Auditor profile picture"]')), 'Profile fields and picture persist after refresh');
  await clickText(page, 'Remove picture'); await clickText(page, 'Save changes'); await text(page, 'Profile saved on this device.'); await page.reload({ waitUntil: 'networkidle0' });
  check(await page.evaluate(() => !document.querySelector('img[alt$="profile picture"]')), 'Profile picture removal persists');
  // Notifications: one click, immediate badge, refresh, mark all.
  await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { await window.__pos.notificationService.create({ key: 'ui-click-one', kind: 'system', title: 'Synthetic click target', link: '/reports' }); await window.__pos.notificationService.create({ key: 'ui-click-two', kind: 'system', title: 'Synthetic second notice' }); });
  await sleep(250); const before = await page.evaluate(() => window.__pos.notificationService.unreadCount());
  check(before >= 2, 'Unread notifications remain unread until the panel is opened');
  await page.reload({ waitUntil: 'networkidle0' });
  check(await page.evaluate(n => window.__pos.notificationService.unreadCount(), before) === before, 'Unread count survives refresh before interaction');
  await page.click('button[aria-label^="Notifications"]'); await text(page, 'Synthetic click target');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').includes('notification: Synthetic click target')).click());
  await page.waitForFunction(() => location.pathname === '/reports'); await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' });
  const after = await page.evaluate(() => window.__pos.notificationService.unreadCount());
  const targetRead = await page.evaluate(async () => (await window.__pos.notificationService.list()).find(n => n.key === 'ui-click-one')?.readAt);
  check(after < before && !!targetRead, 'One click/open marks the target read and reduces the unread count without repeated clicks');
  await page.reload({ waitUntil: 'networkidle0' }); check(await page.evaluate(n => window.__pos.notificationService.unreadCount(), after) === after, 'Notification read state survives refresh');
  await page.evaluate(async () => { for (let i = 0; i < 12; i++) await window.__pos.notificationService.create({ key: `ui-mark-all-${i}`, kind: 'system', title: `Synthetic mark-all target ${i}` }); });
  await page.reload({ waitUntil: 'networkidle0' }); await page.click('button[aria-label^="Notifications"]'); await clickText(page, 'Mark all read'); await sleep(300);
  check(await page.evaluate(() => window.__pos.notificationService.unreadCount()) === 0, 'Mark all read clears the persisted unread count');
  check(errors.length === 0, `No browser console/runtime errors (${errors.join('; ')})`);
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ status: 'PASS', checks, errors, artifacts: fs.readdirSync(out), note: 'Synthetic isolated Chromium data; no physical printer or production data.' }, null, 2));
  console.log(`Focused browser verification PASS: ${checks.length} checks. Artifacts: ${out}`);
} catch (error) {
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ status: 'FAIL', checks, errors, failure: String(error) }, null, 2));
  for (const p of await browser.pages()) { try { console.error('PAGE', p.url(), (await p.evaluate(() => document.body.innerText)).slice(0, 1500)); await p.screenshot({ path: path.join(out, `failure-${Date.now()}.png`), fullPage: true }); } catch {} }
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); server.kill(); }
