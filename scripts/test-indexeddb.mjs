import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
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

Module._extensions['.ts'] = (module, filename) => {
  // Vite normally inlines import.meta.env. Give Node's isolated test a blank
  // environment while still loading the real database and data-port modules.
  const source = fs
    .readFileSync(filename, 'utf8')
    .replace(/\bimport\.meta\.env\b/g, '({})');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(output.outputText, filename);
};

const { db } = require(path.join(root, 'src/data/db/indexedDb.ts'));
const { STORES } = require(path.join(root, 'src/config/storage.config.ts'));
const { dataPortService } = require(path.join(root, 'src/services/dataPortService.ts'));

const now = '2026-10-02T12:00:00.000Z';
const earlier = '2026-10-01T12:00:00.000Z';
const future = '2026-10-03T12:00:00.000Z';
const base = (id, updatedAt = now) => ({
  id,
  createdAt: earlier,
  updatedAt,
  deletedAt: null,
  rev: 1,
});

await db.openDatabase();

// These objects live only in fake-indexeddb, an in-memory isolated database.
// All relationships and values are realistic records from the current schema.
const fixtures = {
  restaurant: [{ ...base('restaurant-main'), name: 'North Star', logo: { dataUrl: 'data:image/png;base64,AA==', type: 'image/png' } }],
  menuItems: [
    { ...base('product-burger'), name: 'Burger', category: 'Food', isActive: 1 },
    { ...base('product-tea'), name: 'Tea', category: 'Drinks', isActive: 1 },
  ],
  itemPrices: [{ ...base('burger-large'), menuItemId: 'product-burger', label: 'Large', price: 900 }],
  inventory: [{ ...base('stock-burger'), menuItemId: 'product-burger', name: 'Patties', quantity: 12 }],
  deals: [{ ...base('deal-combo'), name: 'Combo', items: [{ menuItemId: 'product-burger', quantity: 1 }] }],
  orders: [{ ...base('order-1'), orderNumber: 'A-0001', status: 'completed', customerId: 'customer-1', grandTotal: 900 }],
  orderItems: [{ ...base('line-1'), orderId: 'order-1', menuItemId: 'product-burger', itemPriceId: 'burger-large', quantity: 1 }],
  sales: [{ ...base('sale-1'), orderId: 'order-1', businessDate: '2026-10-02', grandTotal: 900 }],
  customers: [{ ...base('customer-1'), name: 'Avery Customer', phone: '555-2000', phoneKey: '5552000' }],
  toppings: [{ ...base('topping-cheese'), name: 'Cheese', price: 50 }],
  addOns: [{ ...base('addon-sauce'), name: 'Sauce', price: 25 }],
  settings: [{ ...base('order.sequence'), value: 40 }],
  notifications: [
    {
      ...base('notification-order'),
      key: 'order:order-1',
      kind: 'order',
      severity: 'info',
      title: 'Order A-0001 completed',
      readAt: null,
    },
  ],
  receiptAudits: [
    {
      ...base('audit-1'),
      orderId: 'order-1',
      orderNumber: 'A-0001',
      itemId: 'line-1',
      itemName: 'Burger',
      previousQuantity: 2,
      newQuantity: 1,
      reason: 'Customer returned one item',
      editor: 'admin',
      before: { subtotal: 1800, discountTotal: 0, taxTotal: 0, grandTotal: 1800, itemCount: 2 },
      after: { subtotal: 900, discountTotal: 0, taxTotal: 0, grandTotal: 900, itemCount: 1 },
      beforeLine: { itemId: 'line-1', name: 'Burger', quantity: 2, lineTotal: 1800 },
      afterLine: { itemId: 'line-1', name: 'Burger', quantity: 1, lineTotal: 900 },
    },
  ],
  purchases: [
    {
      ...base('purchase-1'),
      inventoryId: 'stock-burger',
      itemName: 'Patties',
      quantity: 24,
      unitCost: 15000,
      supplier: 'Local supplier',
      reference: 'INV-77',
      note: '',
      receivedAt: '2026-10-02T09:00:00.000Z',
      quantityAfter: 36,
    },
  ],
};

for (const [store, records] of Object.entries(fixtures)) {
  for (const record of records) await db.put(store, record);
}
const localAdmin = {
  ...base('admin.credentials'),
  username: 'destination-admin',
  passwordHash: 'destination-only-hash',
  role: 'admin',
};
const localQueue = { ...base('queue-local'), entity: 'orders', status: 'pending' };
await db.put(STORES.admin, localAdmin);
await db.put(STORES.syncQueue, localQueue);

const backup = JSON.parse(JSON.stringify(await dataPortService.exportBackup()));
const expectedStores = Object.keys(fixtures);
if (JSON.stringify(Object.keys(backup.stores)) !== JSON.stringify(expectedStores)) {
  console.error('expected', expectedStores);
  console.error('actual  ', Object.keys(backup.stores));
  throw new Error('Export did not include each business store in schema order.');
}
if (Object.hasOwn(backup.stores, 'admin') || Object.hasOwn(backup.stores, 'syncQueue')) {
  throw new Error('Device-local credentials or transport queue leaked into the backup.');
}
if (backup.stores.orderItems[0].orderId !== backup.stores.orders[0].id) {
  throw new Error('Export broke the order/order-item relationship.');
}
if (backup.stores.sales[0].orderId !== backup.stores.orders[0].id) {
  throw new Error('Export broke the sale/order relationship.');
}
const preview = dataPortService.previewBackup(backup);
if (preview.totalRecords !== 16 || preview.storeCounts.itemPrices !== 1) {
  throw new Error('Backup preview returned incorrect record counts.');
}
if (!Object.hasOwn(preview.excludedStores, 'admin') || !Object.hasOwn(preview.excludedStores, 'syncQueue')) {
  throw new Error('Backup preview did not disclose excluded stores.');
}

// A newer backup record should replace the older local copy, but the order
// number sequence must never move backwards when the destination is ahead.
await db.put(STORES.menuItems, { ...fixtures.menuItems[0], updatedAt: earlier, name: 'Older local name' });
await db.put(STORES.settings, { ...base('order.sequence', future), value: 90 });
const result = await dataPortService.importBackup(backup);
if (result.updated < 1 || (await db.get(STORES.menuItems, 'product-burger')).name !== 'Burger') {
  throw new Error('The newer backup record did not merge into the destination.');
}
if ((await db.get(STORES.settings, 'order.sequence')).value !== 90) {
  throw new Error('Import decreased the destination order sequence.');
}
if ((await db.get(STORES.admin, localAdmin.id)).username !== 'destination-admin') {
  throw new Error('Import replaced the device-local administrator.');
}
if (!(await db.get(STORES.syncQueue, localQueue.id))) {
  throw new Error('Import changed the destination sync queue.');
}

// A later unique order-number conflict must be rejected before any store write.
const conflict = structuredClone(backup);
conflict.stores.menuItems.push({ ...base('must-not-partially-write', future), name: 'Atomic preflight guard' });
conflict.stores.orders.push({ ...base('order-conflict', future), orderNumber: 'A-0001', status: 'completed' });
conflict.storeCounts.menuItems++;
conflict.storeCounts.orders++;
let conflictRejected = false;
try {
  await dataPortService.importBackup(conflict);
} catch (error) {
  conflictRejected = error instanceof Error && /cannot be merged safely/i.test(error.message);
}
if (!conflictRejected) throw new Error('A conflicting unique order number was not rejected.');
if (await db.get(STORES.menuItems, 'must-not-partially-write')) {
  throw new Error('A preflight failure partially wrote the menu record.');
}
if (await db.get(STORES.orders, 'order-conflict')) {
  throw new Error('A conflicting order was written.');
}

// Exercise the real db.transaction wrapper: a failure after successful puts
// must abort all writes in the actual IndexedDB transaction implementation.
const rollbackMenu = { ...base('atomic-rollback-menu'), name: 'Rollback test' };
const rollbackSetting = { ...base('atomic-rollback-setting'), value: 'must roll back' };
let originalErrorReturned = false;
try {
  await db.transaction([STORES.menuItems, STORES.settings], 'readwrite', async (stores) => {
    await db.request(stores[STORES.menuItems].put(rollbackMenu));
    await db.request(stores[STORES.settings].put(rollbackSetting));
    throw new Error('intentional isolated rollback test');
  });
} catch (error) {
  originalErrorReturned = error instanceof Error && error.message === 'intentional isolated rollback test';
}
if (!originalErrorReturned) throw new Error('The transaction did not return the original callback error.');
if (await db.get(STORES.menuItems, rollbackMenu.id) || await db.get(STORES.settings, rollbackSetting.id)) {
  throw new Error('A failed transaction left partial IndexedDB writes.');
}

// A real unique-index request error must also abort an earlier successful put.
const requestRollbackMenu = { ...base('request-rollback-menu'), name: 'Request failure test' };
const duplicateOrder = {
  ...base('request-rollback-order', future),
  orderNumber: 'A-0001',
  status: 'completed',
};
let requestErrorObserved = false;
try {
  await db.transaction([STORES.menuItems, STORES.orders], 'readwrite', async (stores) => {
    await db.request(stores[STORES.menuItems].put(requestRollbackMenu));
    await db.request(stores[STORES.orders].put(duplicateOrder));
  });
} catch {
  requestErrorObserved = true;
}
if (!requestErrorObserved) throw new Error('The unique-index request error was not returned.');
if (await db.get(STORES.menuItems, requestRollbackMenu.id) || await db.get(STORES.orders, duplicateOrder.id)) {
  throw new Error('A failed IndexedDB request left a partial transaction write.');
}

const unsupported = structuredClone(backup);
unsupported.version = 999;
let invalidRejected = false;
try {
  await dataPortService.importBackup(unsupported);
} catch {
  invalidRejected = true;
}
if (!invalidRejected) throw new Error('Unsupported backup format was accepted.');
if (await db.get(STORES.menuItems, 'must-not-partially-write')) {
  throw new Error('Invalid backup changed persistent data.');
}

console.log(
  'IndexedDB checks passed: isolated schema migration, 15-store export snapshot, relationship preservation, backup preview/exclusions, safe merge and monotonic sequence, unique-conflict preflight, local credential/queue preservation, and atomic rollback.',
);

// Multi-week round trip through the actual IndexedDB adapter, in this test's
// isolated fake database only. No browser or restaurant data is touched.
const assert = require('node:assert/strict');
const { salesService } = require(path.join(root, 'src/services/salesService.ts'));
const { orderService } = require(path.join(root, 'src/services/orderService.ts'));
// Complete the minimal legacy fixture for the report's product breakdown.
await db.put(STORES.orderItems, { ...fixtures.orderItems[0], name: 'Burger', unitPrice: 900, lineTotal: 900 });
await db.put(STORES.sales, { ...fixtures.sales[0], completedAt: now, subtotal: 900, discountTotal: 0,
  taxTotal: 0, itemCount: 1, paymentMethod: 'cash', orderType: 'takeaway' });
const dates = [];
for (let i = 0; i < 35; i++) {
  const day = new Date(Date.UTC(2026, 8, 1 + i, 12));
  const at = day.toISOString();
  const date = at.slice(0, 10);
  dates.push(date);
  const orderId = `multi-order-${i}`;
  const number = `W-${String(i + 1).padStart(4, '0')}`;
  const amount = 110000 + i;
  await db.put(STORES.orders, { ...base(orderId, at), createdAt: at, orderNumber: number,
    status: i === 3 ? 'cancelled' : 'completed', orderType: 'takeaway', completedAt: at,
    customerId: 'customer-1', subtotal: amount, discountTotal: 0, taxTotal: 0, grandTotal: amount });
  await db.put(STORES.orderItems, { ...base(`multi-line-${i}`, at), createdAt: at,
    orderId, menuItemId: 'product-burger', name: 'Burger', unitPrice: 50000, quantity: 1,
    discount: 0, lineTotal: 60000, toppings: [{ name: 'Cheese', price: 10000 }] });
  await db.put(STORES.sales, { ...base(`multi-sale-${i}`, at), createdAt: at, orderId,
    orderNumber: number, businessDate: date, completedAt: at, orderType: 'takeaway',
    customerId: 'customer-1', subtotal: amount, discountTotal: 0, taxTotal: 0,
    grandTotal: amount, paymentMethod: 'cash', itemCount: 1,
    cancelledAt: i === 3 ? at : null, refundedAt: i === 4 ? at : null });
}
const period = { from: dates[0], to: dates[dates.length - 1] };
const beforeReport = await salesService.report(period);
const multiBackup = JSON.parse(JSON.stringify(await dataPortService.exportBackup()));
const multiPreview = dataPortService.previewBackup(multiBackup);
assert.equal(multiPreview.storeCounts.sales, multiBackup.stores.sales.length);
assert.equal(multiBackup.storeCounts.sales, multiBackup.stores.sales.length);
const truncated = structuredClone(multiBackup);
truncated.stores.sales.pop();
await assert.rejects(dataPortService.importBackup(truncated), /counts do not match/);
assert.equal(multiBackup.stores.sales.filter(row => row.id.startsWith('multi-sale-')).length, 35);
// Clearing is deliberately restricted to this isolated fake-indexeddb instance.
for (const store of Object.keys(multiBackup.stores)) await db.clear(store);
await dataPortService.importBackup(multiBackup);
for (const [store, rows] of Object.entries(multiBackup.stores)) {
  assert.deepEqual(await db.getAll(store), rows, `${store} round trips unchanged`);
}
const afterReport = await salesService.report(period);
assert.equal(afterReport.netSales, beforeReport.netSales);
assert.equal(afterReport.orderCount, beforeReport.orderCount);
assert.ok(afterReport.sales.some(row => row.id === 'multi-sale-34'), 'latest week is present in report');
const history = (await orderService.history()).filter(row => row.order.id.startsWith('multi-order-'));
assert.equal(history.length, 35);
assert.deepEqual(history.map(row => row.order.id), [...history].sort((a, b) =>
  b.order.createdAt.localeCompare(a.order.createdAt) || b.order.id.localeCompare(a.order.id)).map(row => row.order.id));
assert.equal(new Set(Array.from({ length: Math.ceil(history.length / 10) }, (_, page) =>
  history.slice(page * 10, (page + 1) * 10)).flat().map(row => row.order.id)).size, 35);
const repeated = await dataPortService.importBackup(multiBackup);
assert.equal(repeated.added, 0);
assert.equal((await db.getAll(STORES.sales)).length, multiBackup.stores.sales.length);
console.log('Multi-week IndexedDB backup: snapshot, clean restore, history and report totals verified in isolation.');
