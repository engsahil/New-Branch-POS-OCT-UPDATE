import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreSource = await readFile(path.join(root, 'src/services/dataPortCore.ts'), 'utf8');
const compiled = ts.transpileModule(coreSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
});
const core = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
);

const allStores = [
  'admin',
  'restaurant',
  'menuItems',
  'itemPrices',
  'inventory',
  'deals',
  'orders',
  'orderItems',
  'sales',
  'customers',
  'toppings',
  'addOns',
  'settings',
  'syncQueue',
];
const backupStores = allStores.filter((name) => !['admin', 'syncQueue'].includes(name));
const legacyBackupStores = allStores.filter((name) => name !== 'syncQueue');
const excludedStores = {
  admin: 'device-local sign-in credentials',
  syncQueue: 'transport queue only',
};
const config = {
  format: 'pos-data-backup',
  version: 2,
  legacyVersion: 1,
  applicationName: 'POS',
  applicationVersion: '3.1.0',
  dataSchemaVersion: 1,
  databaseName: 'pos-db',
  databaseVersion: 6,
  allStores,
  backupStores,
  legacyBackupStores,
  excludedStores,
  orderSequenceSettingId: 'order.sequence',
  uniqueIndexes: { orders: 'orderNumber', sales: 'orderId' },
};
const timestamp = '2026-10-02T12:00:00.000Z';
const earlier = '2026-10-01T12:00:00.000Z';
const future = '2026-10-03T12:00:00.000Z';
const base = (id, updatedAt = timestamp) => ({
  id,
  createdAt: earlier,
  updatedAt,
  deletedAt: null,
  rev: 1,
});

const records = {
  restaurant: [
    {
      ...base('restaurant-main'),
      name: 'North Star Kitchen',
      logo: {
        dataUrl: 'data:image/png;base64,AA==',
        type: 'image/png',
        width: 512,
        height: 256,
        bytes: 1,
        fileName: 'logo.png',
      },
      address: '1 Main Street',
      phone: '555-1000',
      email: 'hello@example.test',
      receiptInfo: 'Tax ID 123',
      receiptFooter: 'Thank you',
      taxPercent: 0,
      taxInclusive: true,
    },
  ],
  menuItems: [
    {
      ...base('product-burger'),
      name: 'Burger',
      description: '',
      category: 'Food',
      image: null,
      isActive: 1,
      tracksInventory: 1,
      variantKind: 'size',
    },
    {
      ...base('product-tea'),
      name: 'Tea',
      description: '',
      category: 'Beverages',
      image: null,
      isActive: 1,
      tracksInventory: 0,
      variantKind: 'volume',
    },
    {
      ...base('product-fries'),
      name: 'Fries',
      description: '',
      category: 'Food',
      image: null,
      isActive: 1,
      tracksInventory: 1,
      variantKind: 'size',
    },
  ],
  itemPrices: [
    { ...base('burger-small'), menuItemId: 'product-burger', label: 'Small', price: 500, isDefault: 1 },
    { ...base('burger-medium'), menuItemId: 'product-burger', label: 'Medium', price: 700, isDefault: 0 },
    { ...base('burger-large'), menuItemId: 'product-burger', label: 'Large', price: 900, isDefault: 0 },
    { ...base('tea-250ml'), menuItemId: 'product-tea', label: '250 ml', price: 250, isDefault: 1 },
  ],
  inventory: [
    {
      ...base('stock-burger'),
      menuItemId: 'product-burger',
      name: 'Burger patties',
      sku: 'PAT-01',
      unit: 'unit',
      quantity: 28,
      isAvailable: 1,
      isOutOfStock: 0,
      quantityBeforeOutOfStock: null,
      reorderLevel: 4,
    },
  ],
  deals: [
    {
      ...base('deal-combo'),
      name: 'Burger Combo',
      description: 'Burger and fries',
      image: null,
      pricingType: 'fixed',
      price: 1100,
      percentOff: null,
      items: [
        { menuItemId: 'product-burger', sizeLabel: 'Medium', quantity: 1 },
        { menuItemId: 'product-fries', sizeLabel: 'Small', quantity: 1 },
      ],
      isPublished: 1,
      startsAt: null,
      endsAt: null,
    },
  ],
  customers: [
    {
      ...base('customer-1'),
      name: 'Avery Customer',
      phone: '555-2000',
      phoneKey: '5552000',
      email: 'avery@example.test',
      address: '2 Second Street',
      note: 'Call on arrival',
    },
  ],
  orders: [
    {
      ...base('order-today'),
      orderNumber: 'A-0101',
      status: 'completed',
      orderType: 'delivery',
      subtotal: 1800,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 1800,
      paymentMethod: 'cash',
      amountPaid: 2000,
      changeDue: 200,
      customerName: 'Avery Customer',
      customerPhone: '555-2000',
      customerId: 'customer-1',
      deliveryAddress: '2 Second Street',
      deliveryNotes: 'Leave at front desk',
      deliveryStatus: 'delivered',
      assignedRiderId: 'rider-1',
      deliveryCompletedAt: timestamp,
      deliveryHistory: [{ status: 'delivered', at: timestamp, message: 'Handed over' }],
      completedAt: timestamp,
    },
    {
      ...base('order-history'),
      orderNumber: 'A-0099',
      status: 'completed',
      orderType: 'takeaway',
      subtotal: 700,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 700,
      paymentMethod: 'card',
      amountPaid: 700,
      changeDue: 0,
      customerName: 'Avery Customer',
      customerId: 'customer-1',
      completedAt: earlier,
    },
  ],
  orderItems: [
    {
      ...base('line-today'),
      orderId: 'order-today',
      menuItemId: 'product-burger',
      itemPriceId: 'burger-large',
      name: 'Burger',
      sizeLabel: 'Large',
      unitPrice: 900,
      quantity: 2,
      discount: 0,
      lineTotal: 1800,
      toppings: [],
      addOns: [],
    },
    {
      ...base('line-history'),
      orderId: 'order-history',
      menuItemId: 'product-burger',
      itemPriceId: 'burger-medium',
      name: 'Burger',
      sizeLabel: 'Medium',
      unitPrice: 700,
      quantity: 1,
      discount: 0,
      lineTotal: 700,
      toppings: [],
      addOns: [],
    },
  ],
  sales: [
    {
      ...base('sale-today'),
      orderId: 'order-today',
      orderNumber: 'A-0101',
      businessDate: '2026-10-02',
      completedAt: timestamp,
      subtotal: 1800,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 1800,
      paymentMethod: 'cash',
      itemCount: 2,
      customerId: 'customer-1',
    },
    {
      ...base('sale-history'),
      orderId: 'order-history',
      orderNumber: 'A-0099',
      businessDate: '2026-10-01',
      completedAt: earlier,
      subtotal: 700,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 700,
      paymentMethod: 'card',
      itemCount: 1,
      customerId: 'customer-1',
    },
  ],
  toppings: [
    { ...base('topping-cheese'), name: 'Cheese', price: 50, isActive: 1 },
  ],
  addOns: [
    { ...base('addon-sauce'), name: 'Sauce', price: 25, isActive: 1 },
  ],
  settings: [
    { ...base('order.sequence'), value: 101 },
    {
      ...base('delivery.riders'),
      value: [{ id: 'rider-1', name: 'Riley Rider', phone: '555-3000', isActive: true }],
    },
    { ...base('receipt.width'), value: '80mm' },
    { ...base('receipt.autoShow'), value: true },
  ],
};

class MemoryPortDatabase {
  constructor(initial = {}) {
    this.data = new Map(allStores.map((name) => [name, structuredClone(initial[name] ?? [])]));
    this.transactionCount = 0;
  }

  async getAll(store) {
    return structuredClone(this.data.get(store) ?? []);
  }

  async transaction(names, mode, work) {
    assert.ok(mode === 'readonly' || mode === 'readwrite');
    this.transactionCount += 1;
    const staged = new Map(names.map((name) => [name, structuredClone(this.data.get(name) ?? [])]));
    const tx = {
      getAll: async (store) => structuredClone(staged.get(store) ?? []),
      put: async (store, record) => {
        assert.equal(mode, 'readwrite', 'read-only snapshots cannot write');
        const rows = staged.get(store);
        assert.ok(rows, `transaction includes ${store}`);
        const index = rows.findIndex((row) => row.id === record.id);
        if (index >= 0) rows[index] = structuredClone(record);
        else rows.push(structuredClone(record));
      },
    };
    const result = await work(tx);
    if (mode === 'readwrite') {
      for (const [name, rows] of staged) this.data.set(name, rows);
    }
    return result;
  }
}

const serviceFor = (database) =>
  core.createDataPortService(database, config, () => 'https://source.example.test');
const sourceDb = new MemoryPortDatabase(records);
const sourceService = serviceFor(sourceDb);
const exported = await sourceService.exportBackup();

assert.equal(exported.format, 'pos-data-backup');
assert.equal(exported.version, 2);
assert.equal(exported.application.version, '3.1.0');
assert.equal(exported.schema.database, 'pos-db');
assert.deepEqual(exported.schema.stores, backupStores);
assert.deepEqual(Object.keys(exported.stores), backupStores);
assert.ok(!Object.hasOwn(exported.stores, 'admin'));
assert.ok(!Object.hasOwn(exported.stores, 'syncQueue'));
assert.equal(exported.stores.restaurant[0].logo.dataUrl, records.restaurant[0].logo.dataUrl);

// This JSON serialization/deserialization is the same portable file boundary
// used by Blob download and file.text() in the UI.
const fileRoundTrip = JSON.parse(JSON.stringify(exported));
const preview = sourceService.previewBackup(fileRoundTrip);
assert.equal(preview.applicationVersion, '3.1.0');
assert.equal(preview.totalRecords, Object.values(records).reduce((sum, rows) => sum + rows.length, 0));
assert.equal(preview.storeCounts.orders, records.orders.length);
assert.deepEqual(preview.excludedStores, excludedStores);

const localAdmin = {
  ...base('admin.credentials'),
  username: 'destination-admin',
  password: 'destination-only-hash',
  role: 'admin',
  mustChangePassword: false,
  sessionTokenHash: 'destination-token-hash',
};
const queueRecord = { ...base('queue-1'), entity: 'menuItems', status: 'pending' };
const destinationDb = new MemoryPortDatabase({ admin: [localAdmin], syncQueue: [queueRecord] });
const destinationService = serviceFor(destinationDb);
const imported = await destinationService.importBackup(fileRoundTrip);

assert.equal(imported.added, preview.totalRecords);
assert.equal(imported.updated, 0);
assert.equal(imported.skipped, 0);
assert.equal(destinationDb.data.get('admin')[0].username, 'destination-admin');
assert.deepEqual(destinationDb.data.get('syncQueue'), [queueRecord]);
for (const name of backupStores) {
  assert.deepEqual(destinationDb.data.get(name), records[name] ?? [], `${name} restored`);
}

const restoredItems = destinationDb.data.get('itemPrices');
assert.deepEqual(
  restoredItems.filter((row) => row.menuItemId === 'product-burger').map((row) => row.label).sort(),
  ['Large', 'Medium', 'Small'],
);
assert.equal(destinationDb.data.get('orders')[0].customerId, 'customer-1');
assert.equal(destinationDb.data.get('orders')[0].assignedRiderId, 'rider-1');
assert.equal(destinationDb.data.get('orderItems')[0].orderId, 'order-today');
assert.equal(destinationDb.data.get('sales')[0].orderId, 'order-today');
assert.equal(destinationDb.data.get('settings').find((row) => row.id === 'delivery.riders').value[0].id, 'rider-1');
assert.equal(
  destinationDb.data.get('sales').filter((sale) => sale.businessDate === '2026-10-02').reduce((sum, sale) => sum + sale.grandTotal, 0),
  1800,
  'report totals remain derivable from restored sales',
);

// Re-importing the same backup is deterministic and does not create duplicates.
const secondImport = await destinationService.importBackup(fileRoundTrip);
assert.equal(secondImport.added, 0);
assert.equal(secondImport.updated, 0);
assert.equal(secondImport.skipped, preview.totalRecords);
assert.equal(destinationDb.data.get('orders').length, 2);

// A newer record updates by stable id; it does not re-key relationships.
const newerBackup = structuredClone(fileRoundTrip);
newerBackup.stores.customers[0].name = 'Avery Updated';
newerBackup.stores.customers[0].updatedAt = future;
const updateResult = await destinationService.importBackup(newerBackup);
assert.equal(updateResult.updated, 1);
assert.equal(destinationDb.data.get('customers')[0].name, 'Avery Updated');
assert.equal(destinationDb.data.get('orders')[0].customerId, 'customer-1');

// Never lower the order sequence, even when an older copy contains a higher value.
const sequenceDatabase = new MemoryPortDatabase({
  ...records,
  settings: [{ ...records.settings[0], value: 150, updatedAt: future }],
});
const sequenceResult = await serviceFor(sequenceDatabase).importBackup(fileRoundTrip);
assert.equal(sequenceDatabase.data.get('settings').find((row) => row.id === 'order.sequence').value, 150);
assert.ok(sequenceResult.skipped >= 1);

// If a destination lacks the counter, existing order numbers still set its floor.
const missingSequenceDatabase = new MemoryPortDatabase({
  ...records,
  orders: [...records.orders, { ...base('local-high-order'), orderNumber: 'A-0200' }],
  settings: records.settings.filter((row) => row.id !== 'order.sequence'),
});
await serviceFor(missingSequenceDatabase).importBackup(fileRoundTrip);
assert.equal(
  missingSequenceDatabase.data.get('settings').find((row) => row.id === 'order.sequence').value,
  200,
);

// A unique secondary-index collision rejects the entire multi-store transaction.
const conflictingDatabase = new MemoryPortDatabase({
  orders: [{ ...base('other-order'), orderNumber: 'A-0101' }],
});
const beforeConflict = Object.fromEntries(
  await Promise.all(allStores.map(async (name) => [name, await conflictingDatabase.getAll(name)])),
);
await assert.rejects(
  serviceFor(conflictingDatabase).importBackup(fileRoundTrip),
  /cannot be merged safely/i,
);
for (const name of allStores) {
  assert.deepEqual(conflictingDatabase.data.get(name), beforeConflict[name], `${name} unchanged after conflict`);
}

// Unsupported versions and malformed/missing stores are rejected before a transaction.
const untouchedDb = new MemoryPortDatabase({ customers: [{ ...base('local-customer'), name: 'Keep me' }] });
const untouchedService = serviceFor(untouchedDb);
const beforeInvalid = Object.fromEntries(
  await Promise.all(allStores.map(async (name) => [name, await untouchedDb.getAll(name)])),
);
const badVersion = structuredClone(fileRoundTrip);
badVersion.version = 99;
assert.throws(() => untouchedService.previewBackup(badVersion), /not supported/i);
const incompatibleApp = structuredClone(fileRoundTrip);
incompatibleApp.application.name = 'Another Application';
assert.throws(() => untouchedService.previewBackup(incompatibleApp), /incompatible/i);
const mismatchedSchema = structuredClone(fileRoundTrip);
mismatchedSchema.schema.databaseVersion -= 1;
assert.throws(() => untouchedService.previewBackup(mismatchedSchema), /versions do not match/i);
const missingStore = structuredClone(fileRoundTrip);
delete missingStore.stores.inventory;
assert.throws(() => untouchedService.previewBackup(missingStore), /manifest/i);
for (const name of allStores) assert.deepEqual(untouchedDb.data.get(name), beforeInvalid[name]);
assert.equal(untouchedDb.transactionCount, 0);

// Import the old v1 shape emitted by the previous release; keep its credential local.
const legacyStores = { ...structuredClone(fileRoundTrip.stores), admin: [localAdmin] };
const legacyBackup = {
  format: 'pos-data-backup',
  version: 1,
  exportedAt: timestamp,
  source: { origin: 'https://old.example.test', database: 'pos-db', databaseVersion: 6 },
  stores: Object.fromEntries(legacyBackupStores.map((name) => [name, legacyStores[name] ?? []])),
};
const legacyDestination = new MemoryPortDatabase({ admin: [{ ...localAdmin, username: 'keep-this-admin' }] });
const legacyService = serviceFor(legacyDestination);
const legacyPreview = legacyService.previewBackup(legacyBackup);
assert.equal(legacyPreview.legacy, true);
assert.equal(legacyPreview.excludedCredentialRecords, 1);
const legacyResult = await legacyService.importBackup(legacyBackup);
assert.equal(legacyResult.excludedCredentialRecords, 1);
assert.equal(legacyDestination.data.get('admin')[0].username, 'keep-this-admin');
assert.equal(legacyDestination.data.get('orders').length, 2);

console.log(
  `Data backup checks passed: ${preview.totalRecords} business records exported/restored across ${backupStores.length} stores; IDs and delivery/report relationships preserved; merge, re-import, safe-conflict rollback, version validation, and v1 compatibility verified.`,
);
