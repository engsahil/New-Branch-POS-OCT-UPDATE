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
if (preview.totalRecords !== 13 || preview.storeCounts.itemPrices !== 1) {
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
  'IndexedDB checks passed: isolated schema migration, 12-store export snapshot, relationship preservation, backup preview/exclusions, safe merge and monotonic sequence, unique-conflict preflight, local credential/queue preservation, and atomic rollback.',
);
