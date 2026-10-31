/** Focused synthetic regressions for reporting, profile and notification read state. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const Module = require('node:module'); const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.indexedDB = indexedDB; globalThis.IDBKeyRange = IDBKeyRange;
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) { return resolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, isMain, options); };
Module._extensions['.ts'] = (module, filename) => { const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.env\b/g, '({})'); module._compile(ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename); };
const load = (file) => require(path.join(root, 'src', file));
const { db } = load('data/db/indexedDb.ts'); await db.openDatabase();
const { reportingService, resolveReportingPreset, previousReportRange, groupReportDays, analyticsCsvRows, assertReportRange } = load('services/reportingService.ts');
const { authService } = load('services/authService.ts');
const { ADMIN_CREDENTIALS_ID } = load('config/auth.config.ts');
const { notificationService } = load('services/notificationService.ts');
const { adminRepository, ordersRepository, salesRepository, orderItemsRepository, menuItemsRepository } = load('data/repositories/index.ts');
const { buildCsv } = load('utils/csv.ts');

// Period boundaries are local-calendar based and include leap-day validation.
assert.deepEqual(resolveReportingPreset('this-year', new Date(2026, 9, 31)), { from: '2026-01-01', to: '2026-10-31' });
assert.deepEqual(resolveReportingPreset('last-year', new Date(2026, 9, 31)), { from: '2025-01-01', to: '2025-12-31' });
assert.deepEqual(previousReportRange({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-08-31', to: '2026-09-30' });
assert.throws(() => assertReportRange({ from: '2026-02-30', to: '2026-03-01' }), /valid/);
assert.throws(() => assertReportRange({ from: '2000-01-01', to: '2026-01-01' }), /ten years/);
const grouped = groupReportDays([{ date: '2026-10-05', label: 'a', amount: 100, orderCount: 1 }, { date: '2026-10-06', label: 'b', amount: 200, orderCount: 2 }, { date: '2026-10-12', label: 'c', amount: 50, orderCount: 1 }], 'week');
assert.deepEqual(grouped.map((row) => [row.date, row.amount, row.orderCount]), [['2026-10-05', 300, 3], ['2026-10-12', 50, 1]]);

// Synthetic completed/refunded/cancelled records exercise real joins and exclusions.
const base = { createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', deletedAt: null, rev: 1 };
const menu = await menuItemsRepository.create({ name: 'Synthetic product', category: 'Synthetic category', description: '', image: null, isActive: 1, variantKind: 'size', discountPercent: null, sku: '', barcode: '', costPrice: null, prepMinutes: null, ingredients: '' });
async function sale(id, day, status, method, taxInclusive) {
  const order = await ordersRepository.create({ ...base, id: `order-${id}`, orderNumber: id, status, orderType: 'takeaway', subtotal: 10000, discountTotal: 1000, taxTotal: 900, grandTotal: 9900, paymentMethod: method, completedAt: `${day}T10:00:00.000Z`, cancelledAt: status === 'cancelled' ? `${day}T11:00:00.000Z` : null });
  await salesRepository.create({ ...base, id: `sale-${id}`, orderId: order.id, orderNumber: id, businessDate: day, completedAt: `${day}T10:00:00.000Z`, subtotal: 10000, discountTotal: 1000, taxTotal: 900, grandTotal: 9900, taxPercent: 10, taxInclusive, paymentMethod: method, itemCount: 1, orderType: 'takeaway', refundedAt: status === 'refunded' ? `${day}T11:00:00.000Z` : null, cancelledAt: status === 'cancelled' ? `${day}T11:00:00.000Z` : null });
  await orderItemsRepository.create({ ...base, orderId: order.id, menuItemId: menu.id, name: 'Synthetic product', sizeLabel: 'Medium', unitPrice: 10000, quantity: 1, discount: 1000, lineTotal: 9000 });
}
await sale('A', '2026-10-10', 'completed', 'cash', false);
await sale('B', '2026-10-10', 'completed', 'card', true);
await sale('C', '2026-10-10', 'refunded', 'cash', false);
await sale('D', '2026-10-10', 'cancelled', 'digital', false);
await sale('E', '2026-09-10', 'completed', 'cash', false);
const report = await reportingService.report({ from: '2026-10-01', to: '2026-10-31' }, 'week', true);
assert.equal(report.current.orderCount, 2); assert.equal(report.current.netSales, 19800); assert.equal(report.current.taxTotal, 1800);
assert.equal(report.previous.netSales, 9900); assert.equal(report.netChangePercent, 100);
assert.deepEqual(report.statuses.map((row) => [row.status, row.count]), [['completed', 2], ['cancelled', 1], ['refunded', 1], ['draft', 0], ['held', 0]]);
assert.equal(report.taxSummary[0].count, 1); assert.equal(report.taxSummary[1].count, 1);
assert.equal(report.current.topProducts[0].quantity, 2); assert.equal(report.current.topCategories[0].name, 'Synthetic category');
const csv = buildCsv(analyticsCsvRows(report)); assert.ok(csv.includes('Charged sales,198.00')); assert.ok(csv.includes('Refunded,1,99.00'));
const empty = await reportingService.report({ from: '2020-01-01', to: '2020-01-31' }, 'day', false);
assert.equal(empty.current.orderCount, 0); assert.equal(empty.previous, null); assert.equal(empty.netChangePercent, null);

// Profile is additive on the existing admin record; credentials/session stay untouched.
await authService.createInitialAdmin({ displayName: 'Synthetic Owner', username: 'owner', password: 'isolated-profile-password', confirmPassword: 'isolated-profile-password' });
await authService.login('owner', 'isolated-profile-password');
const before = await adminRepository.getById(ADMIN_CREDENTIALS_ID);
assert.equal((await authService.updateProfile({ displayName: '', email: '', phone: '' })).ok, false);
assert.equal((await authService.updateProfile({ displayName: 'Owner', email: 'bad', phone: '' })).ok, false);
const avatar = { dataUrl: 'data:image/png;base64,aGVsbG8=', type: 'image/png', width: 64, height: 64, bytes: 5, fileName: 'synthetic.png' };
assert.equal((await authService.updateProfile({ displayName: 'Synthetic Updated Owner', email: 'owner@example.test', phone: '03001234567', jobTitle: 'Manager', department: 'Operations', address: '1 Synthetic Road', bio: 'Isolated test profile', avatar })).ok, true);
const after = await adminRepository.getById(ADMIN_CREDENTIALS_ID);
assert.deepEqual(after.password, before.password); assert.equal(after.username, before.username); assert.equal(after.sessionTokenHash, before.sessionTokenHash);
const user = await authService.currentUser(); assert.equal(user.displayName, 'Synthetic Updated Owner'); assert.equal(user.avatar.fileName, 'synthetic.png'); assert.equal(user.jobTitle, 'Manager');
assert.equal((await authService.updateProfile({ displayName: 'Owner', email: '', phone: '', avatar: null })).ok, true);
assert.equal((await authService.currentUser()).avatar, null);

// One read action is idempotent, deduplicated and persisted; unread rows stay unread.
const first = await notificationService.create({ key: 'ui-read-1', kind: 'system', title: 'First' });
const duplicate = await notificationService.create({ key: 'ui-read-1', kind: 'system', title: 'First' });
const second = await notificationService.create({ key: 'ui-read-2', kind: 'system', title: 'Second' });
assert.equal(first.id, duplicate.id); assert.equal(await notificationService.unreadCount(), 2);
await notificationService.markRead(first.id); await notificationService.markRead(first.id);
assert.equal(await notificationService.unreadCount(), 1);
let snapshot = await notificationService.snapshot(); assert.ok(snapshot.notifications.find((row) => row.id === first.id).readAt); assert.equal(snapshot.notifications.find((row) => row.id === second.id).readAt, null);
await notificationService.markAllRead(); assert.equal(await notificationService.unreadCount(), 0);
snapshot = await notificationService.snapshot(); assert.ok(snapshot.notifications.every((row) => row.readAt));
console.log('UI/reporting checks passed: calendar presets/comparison, weekly grouping, real sales joins, status/tax/product/category summaries, CSV, empty states, additive profile persistence with unchanged credentials, picture removal, notification dedupe and idempotent read/mark-all.');
