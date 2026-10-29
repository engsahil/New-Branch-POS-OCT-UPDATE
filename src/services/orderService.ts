/**
 * Billing and order completion.
 *
 * Cart state lives in the UI; this module owns the money maths and the
 * permanent record of a completed order. Everything runs against locally
 * stored data — no network is involved, so billing works fully offline.
 *
 * All money is integer paisa. Rupee values never enter the arithmetic.
 */

import { STORES } from '@/config/storage.config';
import { db } from '@/data/db/indexedDb';
import { trackChange } from '@/data/repositories/changeTracker';
import {
  customersRepository,
  dealsRepository,
  orderItemsRepository,
  ordersRepository,
  salesRepository,
} from '@/data/repositories';
import { getTaxConfig } from './restaurantService';
import { customerService } from './customerService';
import { notificationService } from './notificationService';
import { settingsService, SETTING_KEYS } from './settingsService';
import { syncQueueService } from './syncQueueService';
import type {
  InventoryRecord,
  OrderItemRecord,
  OrderRecord,
  OrderType,
  PaymentMethod,
  SaleRecord,
  SelectedAddOn,
  SelectedTopping,
} from '@/types/domain';
import type { ID, Paisa } from '@/types/common';
import { createId } from '@/utils/id';
import { nowISO } from '@/utils/date';
import {
  assertPaisa,
  assertQuantity,
  assertText,
  isFiniteNumber,
  ValidationError,
} from '@/utils/validate';

/**
 * A line in the cart, before it becomes an order item.
 *
 * A line is either a menu item at a size, or a deal. Deals carry `dealId`
 * and no size; the two are distinguished by `kind`.
 */
export interface CartLine {
  /** Stable key: menu item + size, or the deal id. */
  key: string;
  kind: 'item' | 'deal';
  menuItemId: ID | null;
  dealId: ID | null;
  itemPriceId: ID | null;
  name: string;
  sizeLabel: string | null;
  unitPrice: Paisa;
  quantity: number;
  toppings: SelectedTopping[];
  addOns: SelectedAddOn[];
  /**
   * Item-level discount percentage carried from the menu item (0–100).
   * Null/absent means this line has no discount. Deal lines never have one:
   * the deal's own pricing is the discount.
   */
  discountPercent?: number | null;
}

export interface CartTotals {
  /** Sum of line gross totals, before any discount. */
  subtotal: Paisa;
  /** Sum of the item-level (menu item percentage) discounts. */
  itemDiscountTotal: Paisa;
  /** Item discounts plus the order-level discount, each clamped. */
  discountTotal: Paisa;
  taxTotal: Paisa;
  grandTotal: Paisa;
  itemCount: number;
  taxPercent: number;
  taxInclusive: boolean;
}

export const MAX_LINE_QUANTITY = 999;

/** Stable key so the same item+size stacks instead of duplicating. */
export function cartLineKey(menuItemId: ID, size: string): string {
  return `${menuItemId}::${size}`;
}

/** Stable key for a deal line. */
export function dealLineKey(dealId: ID): string {
  return `deal::${dealId}`;
}

function sumToppings(toppings: SelectedTopping[]): Paisa {
  return toppings.reduce((s, t) => s + (isFiniteNumber(t.price) ? Math.max(0, t.price) : 0), 0);
}

function sumAddOns(addOns: SelectedAddOn[]): Paisa {
  return addOns.reduce((s, a) => s + (isFiniteNumber(a.price) ? Math.max(0, a.price) : 0), 0);
}

export function lineUnitTotal(line: CartLine): Paisa {
  const base = isFiniteNumber(line.unitPrice) ? Math.max(0, line.unitPrice) : 0;
  return base + sumToppings(line.toppings) + sumAddOns(line.addOns);
}

export function lineTotal(line: CartLine): Paisa {
  const unit = lineUnitTotal(line);
  const qty = isFiniteNumber(line.quantity) ? Math.max(0, Math.floor(line.quantity)) : 0;
  return unit * qty;
}

/**
 * Paisa amount the line saves through its menu item's discount percentage.
 * Zero for deal lines and for items without a configured discount, so an
 * undiscounted item never shows discount information anywhere.
 */
export function lineDiscount(line: CartLine): Paisa {
  const pct = line.discountPercent;
  if (!isFiniteNumber(pct) || pct <= 0) return 0;
  const gross = lineTotal(line);
  if (gross <= 0) return 0;
  const applied = Math.min(100, pct);
  return Math.min(gross, Math.round((gross * applied) / 100));
}

/**
 * Compute totals for a cart.
 *
 * Exclusive tax is added on top of the subtotal. Inclusive tax is extracted
 * from it, so the grand total still equals the sum of the displayed prices.
 * Rounding happens once, at the tax figure, to avoid per-line drift.
 *
 * Discounts come from two places and are simply added together:
 * - item-level percentages from each menu item (never global), and
 * - an optional order-level `discount` typed at checkout.
 * Each is clamped so the grand total can never go negative, and a cart with
 * no discounts totals exactly as it did before discounts existed.
 */
export function calculateTotals(
  lines: CartLine[],
  taxPercent: number,
  taxInclusive: boolean,
  discount = 0,
): CartTotals {
  const safeLineTotal = (line: CartLine): number => {
    const total = lineTotal(line);
    return isFiniteNumber(total) ? Math.max(0, total) : 0;
  };

  const gross = lines.reduce((sum, line) => sum + safeLineTotal(line), 0);
  const itemDiscountTotal = lines.reduce(
    (sum, line) => sum + lineDiscount(line),
    0,
  );
  const itemCount = lines.reduce(
    (sum, line) =>
      sum + (isFiniteNumber(line.quantity) ? Math.max(0, Math.floor(line.quantity)) : 0),
    0,
  );
  const rate = Number.isFinite(taxPercent)
    ? Math.min(100, Math.max(0, taxPercent))
    : 0;

  let base: Omit<CartTotals, 'itemDiscountTotal' | 'discountTotal'>;
  if (rate === 0) {
    base = {
      subtotal: gross,
      taxTotal: 0,
      grandTotal: gross,
      itemCount,
      taxPercent: 0,
      taxInclusive,
    };
  } else if (taxInclusive) {
    const net = Math.round((gross * 100) / (100 + rate));
    base = {
      subtotal: net,
      taxTotal: gross - net,
      grandTotal: gross,
      itemCount,
      taxPercent: rate,
      taxInclusive,
    };
  } else {
    const taxTotal = Math.round((gross * rate) / 100);
    base = {
      subtotal: gross,
      taxTotal,
      grandTotal: gross + taxTotal,
      itemCount,
      taxPercent: rate,
      taxInclusive,
    };
  }

  // The order-level discount may not push the payable total below zero and
  // may not overlap the item-level discounts already applied.
  const checkoutRoom = Math.max(0, base.subtotal - itemDiscountTotal);
  const checkoutDiscount = isFiniteNumber(discount)
    ? Math.min(Math.max(0, Math.round(discount)), checkoutRoom)
    : 0;
  const discountTotal = itemDiscountTotal + checkoutDiscount;

  return {
    ...base,
    itemDiscountTotal,
    discountTotal,
    grandTotal: Math.max(0, base.grandTotal - discountTotal),
  };
}

/**
 * How many units of each menu item a sale removes from stock, keyed by
 * menu item ID (never by display name).
 *
 * Direct cart lines contribute their quantity; a deal line contributes
 * every contained product multiplied by the number of bundles. Quantities
 * that are not finite and positive are ignored so a malformed record can
 * never poison stock arithmetic.
 */
async function stockDeductions(lines: CartLine[]): Promise<Map<ID, number>> {
  const deductions = new Map<ID, number>();
  const add = (menuItemId: ID, quantity: number): void => {
    if (!isFiniteNumber(quantity) || quantity <= 0) return;
    deductions.set(menuItemId, (deductions.get(menuItemId) ?? 0) + quantity);
  };

  for (const line of lines) {
    if (line.kind === 'item' && line.menuItemId) {
      add(line.menuItemId, line.quantity);
      continue;
    }
    if (line.kind === 'deal' && line.dealId) {
      const deal = await dealsRepository.getById(line.dealId);
      if (!deal || deal.deletedAt) continue;
      for (const part of deal.items) {
        add(part.menuItemId, part.quantity * line.quantity);
      }
    }
  }
  return deductions;
}

/**
 * Zero-padded, per-installation sequential order number, e.g. "0001".
 */
async function nextOrderNumber(): Promise<string> {
  const [current, prefix] = await Promise.all([
    settingsService.get<number>(SETTING_KEYS.orderSequence, 0),
    settingsService.get<string>(SETTING_KEYS.orderNumberPrefix, ''),
  ]);

  const next = current + 1;
  await settingsService.set(SETTING_KEYS.orderSequence, next);
  return `${prefix ?? ''}${String(next).padStart(4, '0')}`;
}

export interface CompleteOrderInput {
  lines: CartLine[];
  paymentMethod?: PaymentMethod;
  amountPaid?: Paisa;
  /** Order-level discount in paisa; clamped to the subtotal. */
  discount?: Paisa;
  orderType?: OrderType;
  tableLabel?: string;
  customerName?: string;
  customerPhone?: string;
  /**
   * Customer chosen from the saved-customer picker. When set, that record is
   * linked directly and its stored details fill any field the operator left
   * blank — so picking a customer never creates a duplicate record.
   */
  customerId?: ID | null;
  note?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;
}

export interface CompletedOrder {
  order: OrderRecord;
  items: OrderItemRecord[];
  sale: SaleRecord;
}

function businessDateOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const orderService = {
  calculateTotals,

  async taxConfig() {
    return getTaxConfig();
  },

  async complete(input: CompleteOrderInput): Promise<CompletedOrder> {
    const { lines } = input;
    if (lines.length === 0) {
      throw new Error('Cannot complete an empty order.');
    }

    const validated: CartLine[] = lines.map((line, index) => ({
      ...line,
      name: assertText(line.name, `Item ${index + 1} name`, { max: 120 }),
      unitPrice: assertPaisa(line.unitPrice, `Item "${line.name}" price`),
      quantity: assertQuantity(line.quantity, `Item "${line.name}" quantity`),
      toppings: (line.toppings ?? []).map((t) => ({
        name: assertText(t.name, 'Topping name', { max: 80 }),
        price: assertPaisa(t.price, `Topping "${t.name}" price`),
      })),
      addOns: (line.addOns ?? []).map((a) => ({
        name: assertText(a.name, 'Add-on name', { max: 80 }),
        price: assertPaisa(a.price, `Add-on "${a.name}" price`),
      })),
    }));

    const { taxPercent, taxInclusive } = await getTaxConfig();
    const totals = calculateTotals(
      validated,
      taxPercent,
      taxInclusive,
      input.discount ?? 0,
    );

    if (
      !Number.isSafeInteger(totals.grandTotal) ||
      !Number.isSafeInteger(totals.subtotal) ||
      !Number.isSafeInteger(totals.discountTotal) ||
      totals.grandTotal < 0
    ) {
      throw new ValidationError('Order total could not be calculated safely.');
    }

    const orderNumber = await nextOrderNumber();
    const timestamp = nowISO();
    const orderId = createId();
    const paymentMethod: PaymentMethod = input.paymentMethod ?? 'cash';
    const amountPaid = input.amountPaid ?? totals.grandTotal;

    const orderType: OrderType = input.orderType ?? 'takeaway';
    const tableLabel = input.tableLabel?.trim() ? input.tableLabel.trim().slice(0, 20) : undefined;
    const customerName = input.customerName?.trim() ? input.customerName.trim().slice(0, 80) : undefined;
    const customerPhone = input.customerPhone?.trim() ? input.customerPhone.trim().slice(0, 30) : undefined;
    const note = input.note?.trim() ? input.note.trim().slice(0, 300) : undefined;
    const deliveryAddress = input.deliveryAddress?.trim()
      ? input.deliveryAddress.trim().slice(0, 300)
      : undefined;
    const deliveryNotes = input.deliveryNotes?.trim()
      ? input.deliveryNotes.trim().slice(0, 500)
      : undefined;

    /*
     * Customer resolution, in order of precedence:
     *  1. an explicitly selected saved customer (linked as-is, never cloned),
     *  2. an existing record matched by phone then exact name, or
     *  3. a new record created from whatever checkout captured.
     * Guest orders (no name and no phone) stay unlinked.
     */
    const selectedCustomer = input.customerId
      ? await customersRepository.getById(input.customerId)
      : undefined;

    const resolvedName =
      customerName ?? selectedCustomer?.name?.trim() ?? undefined;
    const resolvedPhone =
      customerPhone ?? selectedCustomer?.phone?.trim() ?? undefined;

    const customer = selectedCustomer
      ? selectedCustomer
      : await customerService.upsertFromCheckout({
          name: resolvedName,
          phone: resolvedPhone,
        });

    const effectiveName = resolvedName ?? selectedCustomer?.name ?? undefined;
    const effectivePhone = resolvedPhone ?? selectedCustomer?.phone ?? undefined;
    const effectiveAddress =
      deliveryAddress ?? selectedCustomer?.address?.trim() ?? undefined;

    if (orderType === 'delivery' && !effectiveAddress) {
      throw new ValidationError('Delivery address is required.');
    }

    const order: OrderRecord = {
      id: orderId,
      orderNumber,
      status: 'completed',
      orderType,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      paymentMethod,
      amountPaid,
      changeDue: Math.max(0, amountPaid - totals.grandTotal),
      tableLabel,
      customerName: effectiveName,
      customerPhone: effectivePhone,
      customerId: customer?.id ?? null,
      note,
      ...(orderType === 'delivery'
        ? {
            deliveryAddress: effectiveAddress,
            deliveryNotes,
            deliveryStatus: 'pending' as const,
            assignedRiderId: null,
            deliveryHistory: [
              {
                status: 'pending' as const,
                at: timestamp,
                message: 'Delivery order created.',
              },
            ],
          }
        : {}),
      completedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      rev: 1,
    };

    const items: OrderItemRecord[] = validated.map((line) => {
      const toppingTotal = sumToppings(line.toppings);
      const addOnTotal = sumAddOns(line.addOns);
      return {
        id: createId(),
        orderId,
        menuItemId: line.menuItemId,
        dealId: line.dealId,
        itemPriceId: line.itemPriceId,
        name: line.name,
        sizeLabel: line.sizeLabel ?? undefined,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        // Item-level discount only (order-level lives on the header).
        discount: lineDiscount(line),
        lineTotal: lineTotal(line) - lineDiscount(line),
        toppings: line.toppings.length ? line.toppings : undefined,
        addOns: line.addOns.length ? line.addOns : undefined,
        toppingTotal: toppingTotal || undefined,
        addOnTotal: addOnTotal || undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        rev: 1,
      };
    });

    const sale: SaleRecord = {
      id: createId(),
      orderId,
      orderNumber,
      businessDate: businessDateOf(new Date()),
      completedAt: timestamp,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      paymentMethod,
      itemCount: totals.itemCount,
      orderType,
      customerId: customer?.id ?? null,
      refundedAt: null,
      cancelledAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      rev: 1,
    };

    // Resolve stock movements before the transaction: direct lines plus
    // the products inside any deal on the order.
    const deductions = await stockDeductions(validated);
    const stockWrites: InventoryRecord[] = [];

    await db.transaction(
      [
        STORES.orders,
        STORES.orderItems,
        STORES.sales,
        STORES.inventory,
      ],
      'readwrite',
      async (stores) => {
        const orderStore = stores[STORES.orders];
        const itemStore = stores[STORES.orderItems];
        const saleStore = stores[STORES.sales];
        const inventoryStore = stores[STORES.inventory];
        if (!orderStore || !itemStore || !saleStore || !inventoryStore) {
          throw new Error('Order stores are unavailable.');
        }

        for (const item of items) {
          await db.request(itemStore.put(item));
        }
        await db.request(saleStore.put(sale));

        /*
         * Deduct stock in the SAME transaction as the order. That is what
         * ties stock to the completed sale: a checkout that fails commits
         * nothing (order and stock both unchanged), and because this runs
         * only here — never on cart changes, receipt printing or sync
         * replay — the same order cannot deduct twice.
         *
         * Stock is matched by the linked menuItemId (not by name) and is
         * clamped at zero, so an over-sold line reads 0 rather than going
         * negative. Lines with no linked stock record are simply skipped.
         */
        const applied: Record<ID, number> = {};
        for (const [menuItemId, sold] of deductions) {
          const matches = (await db.request(
            inventoryStore.index('by_menuItemId').getAll(menuItemId),
          )) as InventoryRecord[];
          const record = matches.find((row) => !row.deletedAt);
          if (!record || !isFiniteNumber(record.quantity)) continue;

          const next = Math.max(
            0,
            Number((record.quantity - sold).toFixed(3)),
          );
          const deducted = Number((record.quantity - next).toFixed(3));
          if (deducted > 0) {
            applied[menuItemId] = (applied[menuItemId] ?? 0) + deducted;
          }
          const updated: InventoryRecord = {
            ...record,
            quantity: next,
            isOutOfStock: next <= 0 ? 1 : record.isOutOfStock,
            updatedAt: nowISO(),
            rev: (record.rev ?? 1) + 1,
          };
          await db.request(inventoryStore.put(updated));
          stockWrites.push(updated);
        }

        // The order header goes in last, stamped with what stock actually
        // moved, so cancellation can restore exactly these amounts later.
        order.stockDeductions = applied;
        await db.request(orderStore.put(order));
      },
    );

    try {
      await syncQueueService.enqueue({
        entity: STORES.orders,
        entityId: orderId,
        operation: 'create',
        payload: { order, items, sale },
      });

      // Stock movements ride the same outbox as every other inventory
      // write, so a later sync sees the post-sale quantity exactly once.
      for (const updated of stockWrites) {
        await trackChange(STORES.inventory, updated.id, 'update', updated);
      }

      void import('./sync/syncEngine')
        .then(({ syncEngine }) => {
          void syncEngine.refresh();
        })
        .catch(() => {
          /* the order is stored; a background sync module failure is not fatal */
        });
    } catch {
      /* the order is safely stored; sync can be reconciled later */
    }

    /*
     * Notifications are written after the sale has committed, and never throw
     * back into checkout: a failed notification must not undo a paid order.
     */
    const orderLabel = `${orderType === 'delivery' ? 'Delivery' : orderType === 'dine-in' ? 'Dine-in' : 'Takeaway'} order #${order.orderNumber}`;
    await notificationService.create({
      key: `order:${order.id}`,
      kind: 'order',
      title: `${orderLabel} completed`,
      body: `Rs. ${(order.grandTotal / 100).toFixed(2)} · ${order.paymentMethod ?? 'cash'}`,
      link: '/sales',
    });

    for (const line of stockWrites) {
      if (line.isOutOfStock === 1) {
        await notificationService.create({
          key: `stock:${line.id}:out-of-stock`,
          kind: 'stock',
          severity: 'critical',
          title: `${line.name} is out of stock`,
          body: 'Linked menu items are hidden from the POS until restocked.',
          link: '/inventory',
        });
      } else if (
        line.reorderLevel !== null &&
        line.reorderLevel !== undefined &&
        line.quantity <= line.reorderLevel
      ) {
        await notificationService.create({
          key: `stock:${line.id}:low-stock`,
          kind: 'stock',
          severity: 'warning',
          title: `${line.name} is low on stock`,
          body: `${line.quantity} ${line.unit} left · reorder level ${line.reorderLevel}`,
          link: '/inventory',
        });
      }
    }

    return { order, items, sale };
  },

  /**
   * Cancel a completed order.
   *
   * The order stays in history, clearly marked CANCELLED, and its sale row
   * is flagged so every summary, cash-flow figure and customer total stops
   * counting it. Stock is restored from the exact amounts recorded when the
   * order completed — never more (an over-sold line), never twice (the
   * status guard allows the transition once), and not at all when nothing
   * was deducted.
   */
  async cancel(orderId: ID): Promise<OrderRecord> {
    const order = await ordersRepository.getById(orderId);
    if (!order || order.deletedAt) {
      throw new Error('Order not found.');
    }
    if (order.status !== 'completed') {
      throw new Error('Only a completed order can be cancelled.');
    }

    const items = await orderItemsRepository.findByIndex('by_orderId', orderId);
    const sale = await salesRepository.findOneByIndex('by_orderId', orderId);
    const timestamp = nowISO();

    // Prefer the snapshot stamped at completion. Orders completed before
    // that field existed fall back to deriving from their stored lines.
    let restore: Record<ID, number> = { ...(order.stockDeductions ?? {}) };
    if (!order.stockDeductions) {
      restore = {};
      for (const line of items) {
        if (line.dealId) {
          const deal = await dealsRepository.getById(line.dealId);
          if (!deal || deal.deletedAt) continue;
          for (const part of deal.items) {
            restore[part.menuItemId] =
              (restore[part.menuItemId] ?? 0) + part.quantity * line.quantity;
          }
        } else if (line.menuItemId) {
          restore[line.menuItemId] =
            (restore[line.menuItemId] ?? 0) + line.quantity;
        }
      }
    }

    const cancelled: OrderRecord = {
      ...order,
      status: 'cancelled',
      cancelledAt: timestamp,
      updatedAt: timestamp,
      rev: (order.rev ?? 1) + 1,
    };
    const inventoryWrites: InventoryRecord[] = [];

    await db.transaction(
      [STORES.orders, STORES.sales, STORES.inventory],
      'readwrite',
      async (stores) => {
        const orderStore = stores[STORES.orders];
        const saleStore = stores[STORES.sales];
        const inventoryStore = stores[STORES.inventory];
        if (!orderStore || !saleStore || !inventoryStore) {
          throw new Error('Order stores are unavailable.');
        }

        // Re-check inside the transaction so two rapid cancels restore
        // stock exactly once, not twice.
        const current = (await db.request(
          orderStore.get(orderId),
        )) as OrderRecord | undefined;
        if (!current || current.status !== 'completed') {
          throw new Error('Order is no longer cancellable.');
        }

        await db.request(orderStore.put(cancelled));

        if (sale) {
          const cancelledSale: SaleRecord = {
            ...sale,
            cancelledAt: timestamp,
            updatedAt: timestamp,
            rev: (sale.rev ?? 1) + 1,
          };
          await db.request(saleStore.put(cancelledSale));
        }

        for (const [menuItemId, units] of Object.entries(restore)) {
          if (!isFiniteNumber(units) || units <= 0) continue;
          const matches = (await db.request(
            inventoryStore.index('by_menuItemId').getAll(menuItemId),
          )) as InventoryRecord[];
          const record = matches.find((row) => !row.deletedAt);
          if (!record || !isFiniteNumber(record.quantity)) continue;

          const next = Number((record.quantity + units).toFixed(3));
          const updated: InventoryRecord = {
            ...record,
            quantity: next,
            // Stock is back: the item becomes sellable again unless it is
            // still at zero (or was withheld for a separate reason).
            isOutOfStock: next > 0 ? 0 : 1,
            updatedAt: nowISO(),
            rev: (record.rev ?? 1) + 1,
          };
          await db.request(inventoryStore.put(updated));
          inventoryWrites.push(updated);
        }
      },
    );

    await notificationService.create({
      key: `void:${cancelled.id}`,
      kind: 'audit',
      severity: 'warning',
      title: `Order #${cancelled.orderNumber} was cancelled`,
      body: 'The sale is excluded from totals and its stock has been restored.',
      link: '/sales',
    });

    try {
      await trackChange(STORES.orders, cancelled.id, 'update', cancelled);
      if (sale) {
        await trackChange(STORES.sales, sale.id, 'update', {
          ...sale,
          cancelledAt: timestamp,
        });
      }
      for (const updated of inventoryWrites) {
        await trackChange(STORES.inventory, updated.id, 'update', updated);
      }
    } catch {
      /* the cancellation is stored; sync can be reconciled later */
    }

    return cancelled;
  },

  async getOrder(id: ID): Promise<OrderRecord | undefined> {
    return ordersRepository.getById(id);
  },

  async getOrderItems(orderId: ID): Promise<OrderItemRecord[]> {
    return orderItemsRepository.findByIndex('by_orderId', orderId);
  },

  /**
   * Full order history with the matching sale row, newest first.
   *
   * Used by the Sales screen and receipt history. The list is read in one
   * pass and joined in memory; a single restaurant's history fits comfortably
   * in memory and this avoids a query per order.
   */
  async history(): Promise<Array<{ order: OrderRecord; sale?: SaleRecord }>> {
    const [orders, sales] = await Promise.all([
      ordersRepository.list(),
      salesRepository.list(),
    ]);
    const saleByOrder = new Map(sales.map((sale) => [sale.orderId, sale]));
    return orders
      // Newest creation time first; stable ID breaks timestamp ties.
      .sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .map((order) => ({ order, sale: saleByOrder.get(order.id) }));
  },

  async recentOrders(limit = 20): Promise<OrderRecord[]> {
    const orders = await ordersRepository.list();
    return orders
      .filter((order) => order.status === 'completed')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .slice(0, limit);
  },

  /**
   * Operational figures for the dashboard, all derived from stored orders.
   *
   *  - dineInTables: distinct table labels used by dine-in orders today,
   *  - pendingDeliveries: delivery orders not yet delivered or cancelled,
   *  - unpaidOrders: completed orders where less than the total was taken.
   * Nothing is inferred: an empty database reports zero.
   */
  async dayStats(todayKey: string): Promise<{
    dineInTables: number;
    pendingDeliveries: number;
    unpaidOrders: number;
    todayOrders: number;
  }> {
    const orders = await ordersRepository.list();
    const today = orders.filter((order) => {
      const at = order.completedAt ?? order.createdAt;
      return (at ?? '').slice(0, 10) === todayKey;
    });

    const tables = new Set(
      today
        .filter((order) => order.orderType === 'dine-in' && order.tableLabel)
        .map((order) => order.tableLabel as string),
    );

    const pendingDeliveries = orders.filter(
      (order) =>
        order.orderType === 'delivery' &&
        order.status === 'completed' &&
        order.deliveryStatus !== 'delivered' &&
        order.deliveryStatus !== 'cancelled',
    ).length;

    const unpaidOrders = today.filter(
      (order) =>
        order.status === 'completed' &&
        typeof order.amountPaid === 'number' &&
        order.amountPaid < order.grandTotal,
    ).length;

    return {
      dineInTables: tables.size,
      pendingDeliveries,
      unpaidOrders,
      todayOrders: today.filter((order) => order.status === 'completed').length,
    };
  },

  async count(): Promise<number> {
    return (await ordersRepository.list()).length;
  },

  async salesCount(): Promise<number> {
    return (await salesRepository.list()).length;
  },
};
