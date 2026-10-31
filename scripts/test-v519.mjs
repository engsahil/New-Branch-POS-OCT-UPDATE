/**
 * Focused checks for the v5.1.9 features:
 *  - saved-customer reuse (no duplicate records),
 *  - notification persistence and dedupe,
 *  - date-bounded sales reporting with real totals and breakdowns,
 *  - controlled receipt corrections with audit history and stock adjustment,
 *  - first-run setup detection for a new versus an existing installation.
 *
 * Runs against an isolated in-memory IndexedDB. It never reads the real
 * browser database and writes no fixtures outside the test process.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

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

const ts = require('typescript');
Module._extensions['.ts'] = (module, filename) => {
  const source = fs
    .readFileSync(filename, 'utf8')
    .replace(/\bimport\.meta\.env\b/g, '({})');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  module._compile(output.outputText, filename);
};

const { db } = require(path.join(root, 'src/data/db/indexedDb.ts'));
const { STORES } = require(path.join(root, 'src/config/storage.config.ts'));
const { customerService } = require(path.join(root, 'src/services/customerService.ts'));
const { notificationService } = require(path.join(
  root,
  'src/services/notificationService.ts',
));
const { salesService } = require(path.join(root, 'src/services/salesService.ts'));
const { receiptEditService, ReceiptEditError } = require(path.join(
  root,
  'src/services/receiptEditService.ts',
));
const {
  DEFAULT_DISPLAY_PREFERENCES,
  displayPreferencesService,
} = require(path.join(root, 'src/services/displayPreferencesService.ts'));
const { purchaseService, PurchaseError } = require(
  path.join(root, 'src/services/purchaseService.ts'),
);
const { inventoryService } = require(path.join(root, 'src/services/inventoryService.ts'));
const { onboardingService } = require(path.join(
  root,
  'src/services/onboardingService.ts',
));

await db.openDatabase();

const now = new Date();
const iso = now.toISOString();
const earlier = new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString();
const todayKey = salesService.dateKey(now);
const yesterdayKey = salesService.dateKey(
  new Date(now.getTime() - 24 * 60 * 60 * 1000),
);
const base = (id, at = iso) => ({
  id,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  rev: 1,
});

/* ---------------- Customer reuse ---------------- */

const created = await customerService.create({
  name: 'Avery Customer',
  phone: '0300 1234567',
  address: '12 Mall Road',
});
const reused = await customerService.upsertFromCheckout({
  name: 'Avery C.',
  phone: '0300-1234567',
});
assert.equal(reused.id, created.id, 'a matching phone reuses the existing customer');
assert.equal(reused.name, 'Avery C.', 'the reused record keeps the latest name');
assert.equal(
  (await customerService.list()).length,
  1,
  'checkout did not create a duplicate customer',
);

const byName = await customerService.upsertFromCheckout({ name: 'Guest Without Phone' });
assert.ok(byName.id, 'a name-only guest still gets a record when details are entered');

/* ---------------- Notifications ---------------- */

const first = await notificationService.create({
  key: 'test:stock:1',
  kind: 'stock',
  severity: 'warning',
  title: 'Flour is low',
  body: '2 kg left',
  link: '/inventory',
});
assert.ok(first?.id, 'a notification is written');

const duplicate = await notificationService.create({
  key: 'test:stock:1',
  kind: 'stock',
  title: 'Flour is low again',
});
assert.equal(duplicate?.id, first.id, 'the same key never creates a second entry');
assert.equal(
  (await notificationService.list()).filter((n) => n.key === 'test:stock:1').length,
  1,
  'one entry per dedupe key',
);

await notificationService.create({
  key: 'test:order:1',
  kind: 'order',
  title: 'Order completed',
});
assert.equal(await notificationService.unreadCount(), 2, 'unread count is accurate');

await notificationService.markRead(first.id);
assert.equal(await notificationService.unreadCount(), 1, 'marking read lowers the count');

await notificationService.markAllRead();
assert.equal(await notificationService.unreadCount(), 0, 'mark all read clears the count');

/* ---------------- Checkout links the selected customer ---------------- */

const { orderService } = require(path.join(root, 'src/services/orderService.ts'));

const checkout = await orderService.complete({
  lines: [
    {
      key: 'checkout-line',
      kind: 'item',
      menuItemId: 'menu-checkout',
      dealId: null,
      itemPriceId: null,
      name: 'Checkout item',
      sizeLabel: 'Regular',
      unitPrice: 1200,
      quantity: 1,
      toppings: [],
      addOns: [],
      discountPercent: null,
    },
  ],
  paymentMethod: 'cash',
  amountPaid: 1200,
  orderType: 'takeaway',
  customerName: 'Avery C.',
  customerPhone: '0300-1234567',
  customerId: created.id,
});
assert.equal(
  checkout.order.customerId,
  created.id,
  'checkout links the selected saved customer',
);
assert.equal(
  (await customerService.list()).length,
  2,
  'checkout did not create a duplicate customer for the selected record',
);
assert.equal(checkout.sale.orderType, 'takeaway', 'the sale stores the order type');
assert.ok(
  (await notificationService.list()).some(
    (entry) => entry.key === `order:${checkout.order.id}`,
  ),
  'a completed order raises one persisted notification',
);

/* ---------------- Receipt fixtures ---------------- */

await db.put(STORES.restaurant, {
  ...base('restaurant-profile'),
  name: 'North Star Kitchen',
  logo: null,
  address: '1 Main Street',
  phone: '555-1000',
  email: '',
  receiptInfo: '',
  receiptFooter: '',
  taxPercent: 0,
  taxInclusive: false,
});

await db.put(STORES.menuItems, {
  ...base('menu-burger'),
  name: 'Burger',
  description: '',
  category: 'Food',
  image: null,
  isActive: 1,
  tracksInventory: 1,
});
await db.put(STORES.menuItems, {
  ...base('menu-fries'),
  name: 'Fries',
  description: '',
  category: 'Sides',
  image: null,
  isActive: 1,
  tracksInventory: 1,
});
await db.put(STORES.menuItems, {
  ...base('menu-tea'),
  name: 'Tea',
  description: '',
  category: 'Drinks',
  image: null,
  isActive: 1,
  tracksInventory: 0,
});

await db.put(STORES.inventory, {
  ...base('stock-burger'),
  menuItemId: 'menu-burger',
  name: 'Burger patties',
  sku: 'BUR',
  unit: 'unit',
  quantity: 10,
  isAvailable: 1,
  isOutOfStock: 0,
  quantityBeforeOutOfStock: null,
  reorderLevel: 2,
});
await db.put(STORES.inventory, {
  ...base('stock-fries'),
  menuItemId: 'menu-fries',
  name: 'Fries portions',
  sku: 'FRY',
  unit: 'unit',
  quantity: 2,
  isAvailable: 1,
  isOutOfStock: 0,
  quantityBeforeOutOfStock: null,
  reorderLevel: 1,
});

const order = {
  ...base('order-a'),
  orderNumber: 'A-0101',
  status: 'completed',
  orderType: 'delivery',
  subtotal: 2700,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 2700,
  paymentMethod: 'cash',
  amountPaid: 2700,
  changeDue: 0,
  customerId: created.id,
  customerName: 'Avery C.',
  customerPhone: '0300-1234567',
  deliveryAddress: '12 Mall Road',
  completedAt: iso,
  stockDeductions: { 'menu-burger': 2, 'menu-fries': 1 },
};
await db.put(STORES.orders, order);

const burgerLine = {
  ...base('line-burger'),
  orderId: order.id,
  menuItemId: 'menu-burger',
  name: 'Burger',
  sizeLabel: 'Large',
  unitPrice: 900,
  quantity: 2,
  discount: 0,
  lineTotal: 1800,
};
const friesLine = {
  ...base('line-fries'),
  orderId: order.id,
  menuItemId: 'menu-fries',
  name: 'Fries',
  sizeLabel: 'Regular',
  unitPrice: 900,
  quantity: 1,
  discount: 0,
  lineTotal: 900,
};
await db.put(STORES.orderItems, burgerLine);
await db.put(STORES.orderItems, friesLine);
await db.put(STORES.sales, {
  ...base('sale-a'),
  orderId: order.id,
  orderNumber: order.orderNumber,
  businessDate: todayKey,
  completedAt: iso,
  subtotal: 2700,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 2700,
  paymentMethod: 'cash',
  itemCount: 3,
  orderType: 'delivery',
  customerId: created.id,
});

// A previous-day takeaway sale, and a cancelled sale that must never be
// counted as revenue.
await db.put(STORES.orders, {
  ...base('order-b', earlier),
  orderNumber: 'A-0100',
  status: 'completed',
  orderType: 'takeaway',
  subtotal: 500,
  discountTotal: 100,
  taxTotal: 0,
  grandTotal: 400,
  paymentMethod: 'card',
  amountPaid: 400,
  completedAt: earlier,
});
await db.put(STORES.orderItems, {
  ...base('line-tea', earlier),
  orderId: 'order-b',
  menuItemId: 'menu-tea',
  name: 'Tea',
  unitPrice: 500,
  quantity: 1,
  discount: 100,
  lineTotal: 400,
});
await db.put(STORES.sales, {
  ...base('sale-b', earlier),
  orderId: 'order-b',
  orderNumber: 'A-0100',
  businessDate: yesterdayKey,
  completedAt: earlier,
  subtotal: 500,
  discountTotal: 100,
  taxTotal: 0,
  grandTotal: 400,
  paymentMethod: 'card',
  itemCount: 1,
  orderType: 'takeaway',
});
await db.put(STORES.orders, {
  ...base('order-c', earlier),
  orderNumber: 'A-0099',
  status: 'cancelled',
  orderType: 'dine-in',
  subtotal: 1000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 1000,
  paymentMethod: 'cash',
  amountPaid: 1000,
  completedAt: earlier,
  cancelledAt: iso,
});
await db.put(STORES.sales, {
  ...base('sale-c', earlier),
  orderId: 'order-c',
  orderNumber: 'A-0099',
  businessDate: yesterdayKey,
  completedAt: earlier,
  subtotal: 1000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 1000,
  paymentMethod: 'cash',
  itemCount: 1,
  orderType: 'dine-in',
  cancelledAt: iso,
});

/* ---------------- Reporting ---------------- */

const todayReport = await salesService.report({ from: todayKey, to: todayKey });
assert.equal(todayReport.netSales, 3900, 'today net sales match the completed sales');
assert.equal(todayReport.grossSales, 3900, 'gross sales match the stored subtotals');
assert.equal(todayReport.orderCount, 2, 'only today’s sales are in range');
assert.equal(todayReport.averageOrder, 1950, 'average order is derived, not guessed');
assert.equal(
  todayReport.byPayment.find((entry) => entry.label === 'Cash').amount,
  3900,
  'payment breakdown uses the stored method',
);
assert.equal(
  todayReport.byOrderType.find((entry) => entry.label === 'Delivery').amount,
  2700,
  'order type breakdown uses the sale’s stored type',
);
assert.equal(todayReport.byDay.length, 1, 'a single-day range produces one bucket');
assert.equal(todayReport.topProducts[0].name, 'Burger', 'best seller is by quantity');

const bothDays = await salesService.report({ from: yesterdayKey, to: todayKey });
assert.equal(bothDays.orderCount, 3, 'cancelled sales are excluded from order counts');
assert.equal(bothDays.netSales, 4300, 'net sales include every countable sale');
assert.equal(bothDays.discounts, 100, 'discounts are reported separately');
assert.equal(bothDays.refunds, 1000, 'cancelled value is reported as a refund/void figure');
assert.equal(bothDays.refundCount, 1, 'void count is reported');

const preset = salesService.resolvePresetRange('this-week', now);
assert.ok(preset.from <= preset.to, 'preset ranges are ordered');

/* ---------------- Receipt correction ---------------- */

const voidedFries = await receiptEditService.adjustLine({
  orderId: order.id,
  itemId: friesLine.id,
  quantity: 0,
  reason: 'Customer did not receive the fries',
  editor: 'admin',
});
assert.equal(voidedFries.order.subtotal, 1800, 'subtotal is recalculated after a void');
assert.equal(voidedFries.order.grandTotal, 1800, 'grand total is recalculated');
assert.equal(voidedFries.order.editCount, 1, 'the edit counter advances');
assert.equal(voidedFries.sale.grandTotal, 1800, 'the sale mirrors the corrected total');
assert.equal(voidedFries.item.deletedAt !== null, true, 'the voided line is soft-deleted');

const friesStock = await db.get(STORES.inventory, 'stock-fries');
assert.equal(friesStock.quantity, 3, 'voiding a line returns its stock exactly once');

const reduced = await receiptEditService.adjustLine({
  orderId: order.id,
  itemId: burgerLine.id,
  quantity: 1,
  reason: 'Ordered one burger instead of two',
  editor: 'admin',
});
assert.equal(reduced.order.grandTotal, 900, 'quantity corrections recalculate the total');
assert.equal(
  (await db.get(STORES.inventory, 'stock-burger')).quantity,
  11,
  'reducing a quantity restores the difference',
);

const audits = await receiptEditService.auditsFor(order.id);
assert.equal(audits.length, 2, 'every correction is recorded in the audit trail');
assert.equal(audits[0].previousQuantity, 2, 'audit stores the original quantity');
assert.equal(audits[0].newQuantity, 1, 'audit stores the corrected quantity');
assert.equal(audits[0].editor, 'admin', 'audit stores the operator');
assert.equal(audits[0].reason.length > 0, true, 'audit stores the reason');
assert.equal(audits[1].before.grandTotal, 2700, 'audit stores the original total');

await assert.rejects(
  receiptEditService.adjustLine({
    orderId: order.id,
    itemId: burgerLine.id,
    quantity: 999,
    reason: 'Too many',
    editor: 'admin',
  }),
  (error) => error instanceof ReceiptEditError,
  'an edit cannot oversell stock',
);

await assert.rejects(
  receiptEditService.adjustLine({
    orderId: order.id,
    itemId: burgerLine.id,
    quantity: 0,
    reason: 'Empty the order',
    editor: 'admin',
  }),
  (error) => error instanceof ReceiptEditError,
  'the last remaining line cannot be voided',
);

await assert.rejects(
  receiptEditService.adjustLine({
    orderId: order.id,
    itemId: burgerLine.id,
    quantity: 2,
    reason: 'x',
    editor: 'admin',
  }),
  (error) => error instanceof ReceiptEditError,
  'a correction needs a real reason',
);

await assert.rejects(
  receiptEditService.adjustLine({
    orderId: 'order-c',
    itemId: burgerLine.id,
    quantity: 1,
    reason: 'Cancelled order test',
    editor: 'admin',
  }),
  (error) => error instanceof ReceiptEditError,
  'a cancelled order cannot be edited',
);

/* ---------------- Setup detection ---------------- */

await db.put(STORES.settings, {
  ...base('setup.completed'),
  value: false,
});
assert.equal(
  await onboardingService.needsSetup(),
  false,
  'an installation with a restaurant profile and orders skips setup',
);
assert.equal(
  (await db.get(STORES.settings, 'setup.completed')).value,
  true,
  'setup is marked complete so it never reopens',
);

/* ---------------- Display preferences ---------------- */

assert.deepEqual(
  await displayPreferencesService.get(),
  DEFAULT_DISPLAY_PREFERENCES,
  'display preferences default to showing everything',
);

const savedDisplay = await displayPreferencesService.save({
  dashboard: {
    ...DEFAULT_DISPLAY_PREFERENCES.dashboard,
    bestSellers: false,
    operations: false,
  },
  orderList: { ...DEFAULT_DISPLAY_PREFERENCES.orderList, payment: false },
});
assert.equal(savedDisplay.dashboard.bestSellers, false, 'a hidden block stays hidden');
assert.equal(savedDisplay.dashboard.metrics, true, 'untouched switches keep their default');
assert.equal(savedDisplay.orderList.payment, false, 'order-row details can be hidden');

assert.equal(
  (await displayPreferencesService.get()).dashboard.bestSellers,
  false,
  'display preferences survive a reload',
);

await displayPreferencesService.reset();
assert.deepEqual(
  await displayPreferencesService.get(),
  DEFAULT_DISPLAY_PREFERENCES,
  'reset restores every display default',
);

/* ---------------- Purchases (stock receiving) ---------------- */

const stockLine = await inventoryService.create({
  name: 'Test patties',
  sku: 'PATTY-1',
  unit: 'unit',
  quantity: 4,
  reorderLevel: 2,
  menuItemId: null,
  isAvailable: true,
});

const receipt = await purchaseService.record({
  inventoryId: stockLine.id,
  quantity: 10,
  unitCost: 12500,
  supplier: 'Test supplier',
  reference: 'INV-1',
  note: 'Delivered',
});
assert.equal(receipt.quantityAfter, 14, 'a receipt adds to the quantity on hand');
assert.equal(
  (await inventoryService.getById(stockLine.id)).record.quantity,
  14,
  'the stock line was actually updated',
);
assert.equal(
  (await purchaseService.list()).length >= 1,
  true,
  'the receipt is kept in history',
);

await assert.rejects(
  purchaseService.record({
    inventoryId: stockLine.id,
    quantity: -50,
    unitCost: null,
    supplier: '',
    reference: '',
    note: '',
  }),
  (error) => error instanceof PurchaseError,
  'an adjustment larger than the stock on hand is refused',
);
assert.equal(
  (await inventoryService.getById(stockLine.id)).record.quantity,
  14,
  'a refused adjustment leaves the quantity untouched',
);

console.log(
  'v5.1.9 checks passed: saved-customer reuse without duplicates, persistent deduped notifications with accurate unread counts, date-bounded sales reports excluding cancelled sales, audited receipt corrections with exact stock movement and refusal cases, and setup detection that preserves existing installations, plus display preferences that persist but never alter the underlying data, and stock receipts that update inventory atomically and reject impossible adjustments.',
);

// Quantity lines must be separable without sharing subsequent modifiers.
const { splitCartLine } = require(path.join(root, 'src/hooks/useCart.ts'));
const { calculateTotals } = require(path.join(root, 'src/services/orderService.ts'));
const burger = { key: 'burger', kind: 'item', menuItemId: 'burger', itemPriceId: null,
  dealId: null, name: 'Burger', sizeLabel: 'Regular', unitPrice: 50000, quantity: 2,
  toppings: [], addOns: [] };
const split = splitCartLine([burger], 'burger', 'burger-split');
assert.deepEqual(split.map(line => line.quantity), [1, 1]);
const configured = split.map(line => line.key === 'burger-split'
  ? { ...line, toppings: [{ name: 'Cheese', price: 10000 }] } : line);
assert.deepEqual(configured[0].toppings, []);
assert.equal(calculateTotals(configured, 0, false, 0).subtotal, 110000);
assert.equal(splitCartLine(split, 'burger', 'another').length, 2);
console.log('Split-line modifier pricing check passed.');
const { receiptService } = require(path.join(root, 'src/services/receiptService.ts'));
await db.put(STORES.toppings, { ...base('test-cheese'), name: 'Cheese', price: 10000, isActive: 1 });
const splitCheckout = await orderService.complete({ lines: configured, paymentMethod: 'cash' });
assert.equal(splitCheckout.order.subtotal, 110000);
const savedLines = await orderService.getOrderItems(splitCheckout.order.id);
assert.equal(savedLines.length, 2);
assert.equal(savedLines.filter(line => line.toppings?.some(t => t.name === 'Cheese')).length, 1);
const receiptModel = await receiptService.build(splitCheckout.order, savedLines);
assert.equal(receiptModel.lines.filter(line => line.toppings.some(t => t.name === 'Cheese')).length, 1);
console.log('Split-line checkout, saved modifiers and receipt-model checks passed.');
await Promise.all(Array.from({ length: 8 }, () => notificationService.create({
  key: 'concurrent-dedupe-check', kind: 'order', title: 'Concurrent test',
})));
assert.equal((await notificationService.list(1000)).filter(n => n.key === 'concurrent-dedupe-check').length, 1);
console.log('Concurrent notification deduplication check passed.');
