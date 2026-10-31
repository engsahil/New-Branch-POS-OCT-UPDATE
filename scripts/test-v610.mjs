/** v6.1.0 regressions. All records are synthetic and live only in fake-indexeddb. */
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
Module._extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.env\b/g, '({})');
  module._compile(ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
};
const load = (file) => require(path.join(root, 'src', file));
const { db } = load('data/db/indexedDb.ts'); const { STORES, STORE_SCHEMAS, DB_NAME } = load('config/storage.config.ts');
const { orderService, calculateTotals, OrderError } = load('services/orderService.ts');
const { menuService, EMPTY_MENU_ITEM } = load('services/menuService.ts');
const { dealService, EMPTY_DEAL } = load('services/dealService.ts');
const { restaurantService, EMPTY_RESTAURANT_PROFILE } = load('services/restaurantService.ts');
const { inventoryService, EMPTY_INVENTORY_INPUT } = load('services/inventoryService.ts');
const { purchaseService } = load('services/purchaseService.ts');
const { expenseService, filterExpenses } = load('services/expenseService.ts');
const { financeService } = load('services/financeService.ts'); const { salesService } = load('services/salesService.ts');
const { receiptEditService } = load('services/receiptEditService.ts');
const { toppingService } = load('services/toppingService.ts'); const { addOnService } = load('services/addOnService.ts');
const { notificationService } = load('services/notificationService.ts');
const { paginate, compareOrderSequence } = load('utils/pagination.ts'); const { buildCsv } = load('utils/csv.ts');
const { splitCartLine } = load('hooks/useCart.ts');

// Open a genuine v8 database first, then upgrade through the real v9 migration.
const old = await new Promise((done, fail) => {
  const request = indexedDB.open(DB_NAME, 8);
  request.onupgradeneeded = () => { for (const schema of STORE_SCHEMAS.filter(s => s.name !== 'expenses')) {
    const store = request.result.createObjectStore(schema.name, { keyPath: schema.keyPath });
    for (const index of schema.indexes ?? []) store.createIndex(index.name, index.keyPath, { unique: !!index.unique, multiEntry: !!index.multiEntry });
  } };
  request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error);
});
const legacy = { id: 'legacy-order', orderNumber: 'A-0001', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', deletedAt: null, rev: 1, status: 'completed', grandTotal: 500 };
await new Promise((done, fail) => { const tx = old.transaction('orders', 'readwrite'); tx.objectStore('orders').put(legacy); tx.oncomplete = done; tx.onerror = () => fail(tx.error); });
old.close();
await db.openDatabase();
assert.deepEqual(await db.get(STORES.orders, legacy.id), legacy, 'v8 order survives v9 upgrade');
assert.deepEqual(await db.getAll(STORES.expenses), [], 'new expense store starts empty');
assert.equal((await db.openDatabase()).version, 9);

await restaurantService.save({ ...EMPTY_RESTAURANT_PROFILE, name: 'Synthetic test kitchen', taxPercent: 10, taxInclusive: false });
const menu = await menuService.create({ ...EMPTY_MENU_ITEM, name: 'Burger', category: 'Test', costPrice: 20000, prices: { ...EMPTY_MENU_ITEM.prices, Small: 100000 } });
const cheese = await toppingService.create({ name: 'Cheese', price: 10000, costPrice: 3000, isActive: true, menuItemIds: [menu.item.id] });
await assert.rejects(toppingService.create({ name: ' cheese ', price: 1, isActive: true }), /already exists/i);
await assert.rejects(addOnService.create({ name: 'Sauce', price: 1, isActive: true }).then(() => addOnService.create({ name: 'SAUCE', price: 1, isActive: true })), /already exists/i);
const line = (key, quantity = 1, toppings = []) => ({ key, kind: 'item', menuItemId: menu.item.id, itemPriceId: menu.priceRows?.[0]?.id ?? null, dealId: null, name: 'Burger', sizeLabel: 'Small', unitPrice: 100000, quantity, toppings, addOns: [], discountPercent: 10 });
// 1100 gross, 110 item discount, 90 order discount => 900 taxable; exclusive tax 90.
const exclusive = calculateTotals([line('a', 1, [{ modifierId: cheese.id, name: cheese.name, price: cheese.price }])], 10, false, 9000);
assert.deepEqual([exclusive.subtotal, exclusive.discountTotal, exclusive.taxTotal, exclusive.grandTotal], [110000, 20000, 9000, 99000]);
const inclusive = calculateTotals([line('b', 1, [{ modifierId: cheese.id, name: cheese.name, price: cheese.price }])], 10, true, 9000);
assert.deepEqual([inclusive.subtotal, inclusive.discountTotal, inclusive.taxTotal, inclusive.grandTotal], [110000, 20000, 8182, 90000]);
await assert.rejects(orderService.complete({ lines: [line('under')], paymentMethod: 'cash', amountPaid: 1 }), /less than/i);
const split = splitCartLine([line('split', 2, [{ modifierId: cheese.id, name: cheese.name, price: cheese.price }])], 'split', 'split-one');
assert.equal(split[0].quantity, 1); assert.equal(split[1].quantity, 1);
const independent = [split[0], { ...split[1], toppings: [] }];
const completed = await orderService.complete({ lines: independent, discount: 9000, orderType: 'delivery', customerName: 'Synthetic guest', customerPhone: '03001234567', deliveryAddress: '1 Test Road', paymentMethod: 'cash', amountPaid: 200000 });
assert.equal(completed.order.taxPercent, 10); assert.equal(completed.order.taxInclusive, false);
assert.equal(completed.items.filter(item => item.toppings?.length).length, 1);
assert.equal(completed.items.find(item => item.toppings?.length).unitCost, 23000);
const edited = await receiptEditService.adjustLine({ orderId: completed.order.id, itemId: completed.items.find(item => item.toppings?.length).id, quantity: 2, reason: 'Synthetic quantity correction', editor: 'test' });
assert.equal(edited.item.unitCost, 23000, 'unit cost stays per portion; quantity multiplies it once');
assert.equal(edited.order.taxTotal, Math.round((edited.order.subtotal - edited.order.discountTotal) * .1));
const today = salesService.dateKey(new Date()); const range = { from: today, to: today };
const rent = await expenseService.create({ title: 'Rent', category: 'Rent', amount: 10000, expenseDate: today, paymentMethod: 'cash', payee: 'Synthetic landlord', reference: '=HYPERLINK("test")', notes: 'isolated' });
await assert.rejects(expenseService.create({ title: 'Bad date', category: 'Rent', amount: 1, expenseDate: '2026-02-31', paymentMethod: 'cash' }), /valid expense date/i);
await expenseService.update(rent.id, { title: 'Rent corrected', category: 'Rent', amount: 12000, expenseDate: today, paymentMethod: 'card', payee: 'Landlord', reference: 'R-1', notes: '' });
assert.equal(filterExpenses(await expenseService.list(), { query: 'landlord' }).length, 1);
const finance = await financeService.report(range);
assert.equal(finance.operatingExpenses, 12000); assert.equal(finance.revenue, finance.netSales - finance.taxTotal);
assert.equal(finance.missingCostUnits, 0); assert.equal(finance.cogs, 23000 * 2 + 20000);
assert.equal(finance.operatingProfit, finance.revenue - finance.cogs - 12000);
assert.equal(finance.purchaseSpend, 0, 'purchases are not counted as expenses');
const stock = await inventoryService.create({ ...EMPTY_INVENTORY_INPUT, name: 'Test patties', quantity: 10, menuItemId: menu.item.id });
await Promise.all(Array.from({ length: 6 }, (_, i) => purchaseService.record({ inventoryId: stock.id, quantity: 1.001, unitCost: 1000, supplier: 'Synthetic supplier', reference: `P-${i}`, note: '', receivedAt: new Date().toISOString() })));
assert.equal((await inventoryService.getById(stock.id)).record.quantity, 16.006, 'concurrent receipts are serialised');
assert.equal((await purchaseService.list()).length, 6);
assert.equal((await financeService.report(range)).purchaseSpend, 6006);
// Force a failure after inventory put but before purchase put: both must roll back.
const originalRequest = db.request; const originalTransaction = db.transaction;
db.transaction = (names, mode, work) => originalTransaction(names, mode, async (stores) => {
  let calls = 0;
  db.request = (request) => { calls += 1; return calls === 3 ? Promise.reject(new Error('Synthetic purchase write failure')) : originalRequest(request); };
  try { return await work(stores); } finally { db.request = originalRequest; }
});
await assert.rejects(purchaseService.record({ inventoryId: stock.id, quantity: 1, unitCost: 1000, supplier: '', reference: '', note: '', receivedAt: new Date().toISOString() }), /Synthetic purchase write failure/);
db.transaction = originalTransaction;
assert.equal((await inventoryService.getById(stock.id)).record.quantity, 16.006); assert.equal((await purchaseService.list()).length, 6);
// A published deal is checked at checkout, not trusted from stale cart state.
const deal = await dealService.create({ ...EMPTY_DEAL, name: 'Combo', pricingType: 'fixed', price: 80000, isPublished: true, items: [{ menuItemId: menu.item.id, sizeLabel: 'Small', quantity: 1 }] });
const dealLine = { key: 'deal', kind: 'deal', menuItemId: null, dealId: deal.id, itemPriceId: null, name: deal.name, sizeLabel: null, unitPrice: 80000, quantity: 1, toppings: [], addOns: [], dealVersion: `${deal.updatedAt}:${deal.rev ?? 1}` };
await dealService.update(deal.id, { ...EMPTY_DEAL, name: 'Combo', pricingType: 'fixed', price: 85000, isPublished: true, items: deal.items });
await assert.rejects(orderService.complete({ lines: [dealLine] }), /changed after it was added/i);
const currentDeal = await dealService.getById(deal.id);
const dealOrder = await orderService.complete({ lines: [{ ...dealLine, unitPrice: 85000, dealVersion: `${currentDeal.record.updatedAt}:${currentDeal.record.rev ?? 1}` }] });
assert.equal(dealOrder.items[0].dealSavings, 15000);
await menuService.update(menu.item.id, { ...EMPTY_MENU_ITEM, name: 'Burger', category: 'Test', costPrice: 20000, prices: { ...EMPTY_MENU_ITEM.prices, Small: 120000 } });
const { receiptService } = load('services/receiptService.ts');
assert.equal((await receiptService.build(dealOrder.order, dealOrder.items)).savingsTotal, 15000, 'saved deal savings survive later menu prices');
const refunded = await orderService.refund(dealOrder.order.id, 'Synthetic full refund');
assert.equal(refunded.status, 'refunded'); assert.ok(refunded.refundedAt);
await assert.rejects(orderService.refund(dealOrder.order.id, 'Duplicate refund'), /Only a completed order can be cancelled or refunded/i);
assert.equal((await financeService.report(range)).refundCount, 1);
assert.equal((await receiptService.build(refunded, dealOrder.items)).status, 'refunded');
// Notification eligibility, immediate counts, stable boundaries and continuous pages.
await notificationService.savePreferences({ enabled: true, kinds: { order: false, stock: true, payment: false, audit: false, system: true } });
const muted = await notificationService.create({ key: 'muted-order', kind: 'order', title: 'Muted' }); assert.equal(muted, null);
const seen = await notificationService.create({ key: 'seen-stock', kind: 'stock', title: 'Seen' });
await notificationService.markRead([seen.id]); const before = await notificationService.unreadCount();
await notificationService.savePreferences({ enabled: true, kinds: { order: true, stock: true, payment: true, audit: true, system: true } });
assert.ok(await notificationService.unreadCount() > before, 'unmuting makes existing unread events eligible without marking them read');
const rows = Array.from({ length: 25 }, (_, i) => ({ id: `id-${i}`, createdAt: '2026-10-01T00:00:00Z' })).sort(compareOrderSequence);
const pages = [1, 2, 3].map(page => paginate(rows, page, 10));
assert.deepEqual(pages.flatMap(page => page.pageRows.map(row => row.id)), rows.map(row => row.id));
assert.equal(paginate(rows, 999, 10).page, 3); assert.equal(paginate([], 1, 10).first, 0);
assert.equal(buildCsv([['=1+1', ' +cmd', '@x', '-2+1', -5, 7]]), "'=1+1,' +cmd,'@x,'-2+1,-5,7");
await expenseService.remove(rent.id); assert.equal((await expenseService.list()).length, 0);
await assert.rejects(expenseService.update(rent.id, { title: 'Revive', category: 'Rent', amount: 1, expenseDate: today, paymentMethod: 'cash' }), /no longer exists/i);
console.log('v6.1.0 checks passed: v8→v9 data preservation, discounted inclusive/exclusive tax, underpayment refusal, independent split modifiers and per-portion costs, audited edits, expense CRUD/date/search, exact profit and purchase separation, concurrent/atomic stock receipts, stale-deal refusal and saved savings, once-only full refunds, notification preferences, stable pagination and CSV formula safety.');
