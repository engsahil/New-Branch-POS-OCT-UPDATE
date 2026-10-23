/**
 * Controlled corrections to a completed receipt.
 *
 * Day-to-day money math lives in orderService; this module owns the one
 * workflow that is allowed to change a receipt after the sale was committed.
 * It is deliberately narrow and auditable:
 *
 *  - only a single line quantity can change (change it to 0 to void the line),
 *  - deal lines are fixed-price bundles and are therefore locked,
 *  - stock is adjusted by the exact difference, never re-deducted in full,
 *  - totals, tax and the sale record are recalculated with the same rules the
 *    checkout uses,
 *  - an append-only audit row records the before/after figures, the operator
 *    and the reason.
 *
 * Nothing here touches an order that is cancelled or refunded, and the audit
 * row is written inside the same IndexedDB transaction as the change, so an
 * edit can never be applied without its trail.
 */

import { STORES } from '@/config/storage.config';
import { db } from '@/data/db/indexedDb';
import { buildEntity } from '@/data/repositories';
import {
  orderItemsRepository,
  ordersRepository,
  receiptAuditsRepository,
  salesRepository,
} from '@/data/repositories';
import { notificationService } from './notificationService';
import { getTaxConfig } from './restaurantService';
import { MAX_LINE_QUANTITY } from './orderService';
import type {
  InventoryRecord,
  OrderItemRecord,
  OrderRecord,
  ReceiptAuditRecord,
  SaleRecord,
} from '@/types/domain';
import type { ID, Paisa } from '@/types/common';
import { nowISO } from '@/utils/date';

export interface ReceiptEditInput {
  orderId: ID;
  itemId: ID;
  quantity: number;
  reason: string;
  editor: string;
}

export interface ReceiptEditResult {
  order: OrderRecord;
  item: OrderItemRecord;
  sale: SaleRecord | undefined;
  audit: ReceiptAuditRecord;
}

export class ReceiptEditError extends Error {}

function perUnitGross(item: OrderItemRecord): Paisa {
  const toppings =
    typeof item.toppingTotal === 'number'
      ? item.toppingTotal
      : (item.toppings ?? []).reduce((sum, entry) => sum + entry.price, 0);
  const addOns =
    typeof item.addOnTotal === 'number'
      ? item.addOnTotal
      : (item.addOns ?? []).reduce((sum, entry) => sum + entry.price, 0);
  return Math.max(0, item.unitPrice) + Math.max(0, toppings) + Math.max(0, addOns);
}

/**
 * Recalculate a line for a new quantity, scaling its item-level discount so
 * a percentage discount behaves the same as it did at checkout.
 */
export function lineForQuantity(
  item: OrderItemRecord,
  quantity: number,
): { gross: Paisa; discount: Paisa; lineTotal: Paisa } {
  const unit = perUnitGross(item);
  const gross = unit * quantity;
  const previousQuantity = Math.max(1, item.quantity);
  const previousDiscount = Math.max(0, item.discount ?? 0);
  const discount = Math.min(
    gross,
    Math.round((previousDiscount * quantity) / previousQuantity),
  );
  return { gross, discount, lineTotal: Math.max(0, gross - discount) };
}

function totalsFromLines(
  items: OrderItemRecord[],
  taxPercent: number,
  taxInclusive: boolean,
  orderLevelDiscount: Paisa,
): {
  subtotal: Paisa;
  discountTotal: Paisa;
  taxTotal: Paisa;
  grandTotal: Paisa;
  itemCount: number;
} {
  /*
   * These are the exact rules orderService.calculateTotals applies at
   * checkout: gross is the line value before any discount, tax is computed on
   * that gross (inclusive or exclusive as configured), the order-level
   * discount is clamped to what remains after item discounts, and rounding
   * happens once at the tax figure. Reusing the stored line figures avoids
   * any percentage round-trip drift.
   */
  const gross = items.reduce(
    (sum, item) => sum + Math.max(0, item.lineTotal + item.discount),
    0,
  );
  const itemDiscountTotal = items.reduce(
    (sum, item) => sum + Math.max(0, item.discount),
    0,
  );
  const itemCount = items.reduce(
    (sum, item) => sum + Math.max(0, item.quantity),
    0,
  );

  const rate = Number.isFinite(taxPercent)
    ? Math.min(100, Math.max(0, taxPercent))
    : 0;

  let taxTotal = 0;
  let baseGrand = gross;
  if (rate > 0) {
    if (taxInclusive) {
      const net = Math.round((gross * 100) / (100 + rate));
      taxTotal = gross - net;
    } else {
      taxTotal = Math.round((gross * rate) / 100);
      baseGrand = gross + taxTotal;
    }
  }

  const checkoutRoom = Math.max(0, gross - itemDiscountTotal);
  const checkoutDiscount = Math.min(
    Math.max(0, Math.round(orderLevelDiscount)),
    checkoutRoom,
  );
  const discountTotal = itemDiscountTotal + checkoutDiscount;

  return {
    subtotal: gross,
    discountTotal,
    taxTotal,
    grandTotal: Math.max(0, baseGrand - discountTotal),
    itemCount,
  };
}

export const receiptEditService = {
  /** Audit rows for an order, newest first. */
  async auditsFor(orderId: ID): Promise<ReceiptAuditRecord[]> {
    const rows = await receiptAuditsRepository.findByIndex('by_orderId', orderId);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /**
   * Apply a quantity correction to one line of a completed order.
   * Throws ReceiptEditError with a user-facing message on any refusal.
   */
  async adjustLine(input: ReceiptEditInput): Promise<ReceiptEditResult> {
    const reason = input.reason.trim();
    if (reason.length < 4) {
      throw new ReceiptEditError('Enter a reason for the correction.');
    }
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 0 ||
      input.quantity > MAX_LINE_QUANTITY
    ) {
      throw new ReceiptEditError('Enter a valid quantity.');
    }

    const order = await ordersRepository.getById(input.orderId);
    if (!order || order.deletedAt) {
      throw new ReceiptEditError('Order not found.');
    }
    if (order.status !== 'completed') {
      throw new ReceiptEditError('Only a completed order can be corrected.');
    }

    const items = await orderItemsRepository.findByIndex('by_orderId', order.id);
    const target = items.find((item) => item.id === input.itemId);
    if (!target) throw new ReceiptEditError('That line is no longer on the order.');
    if (target.dealId) {
      throw new ReceiptEditError(
        'Deal lines are fixed-price bundles and cannot be edited. Void the deal line in a new order instead.',
      );
    }
    if (target.quantity === input.quantity) {
      throw new ReceiptEditError('The quantity is unchanged.');
    }

    const previousQuantity = target.quantity;
    const delta = input.quantity - previousQuantity;

    const sale = await salesRepository.findOneByIndex('by_orderId', order.id);
    if (!sale) throw new ReceiptEditError('The sale record for this order is missing.');
    if (sale.cancelledAt || sale.refundedAt) {
      throw new ReceiptEditError('A cancelled or refunded sale cannot be edited.');
    }

    const { taxPercent, taxInclusive } = await getTaxConfig();

    // The order-level discount typed at checkout must survive a line edit.
    const previousItemDiscount = items.reduce(
      (sum, item) => sum + Math.max(0, item.discount ?? 0),
      0,
    );
    const orderLevelDiscount = Math.max(
      0,
      (order.discountTotal ?? 0) - previousItemDiscount,
    );

    const recalculated = lineForQuantity(target, input.quantity);
    const updatedItem: OrderItemRecord = {
      ...target,
      quantity: input.quantity,
      discount: recalculated.discount,
      lineTotal: recalculated.lineTotal,
      deletedAt: input.quantity === 0 ? nowISO() : null,
      updatedAt: nowISO(),
      rev: (target.rev ?? 1) + 1,
    };

    const nextItems = items.map((item) =>
      item.id === target.id ? updatedItem : item,
    );
    const activeItems = nextItems.filter((item) => !item.deletedAt);
    if (activeItems.length === 0) {
      throw new ReceiptEditError(
        'An order cannot be emptied by editing. Cancel the order instead.',
      );
    }

    const totals = totalsFromLines(
      activeItems,
      taxPercent,
      taxInclusive,
      orderLevelDiscount,
    );

    const timestamp = nowISO();
    const updatedOrder: OrderRecord = {
      ...order,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      editedAt: timestamp,
      editCount: (order.editCount ?? 0) + 1,
      updatedAt: timestamp,
      rev: (order.rev ?? 1) + 1,
    };

    const updatedSale: SaleRecord = {
      ...sale,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      itemCount: totals.itemCount,
      editedAt: timestamp,
      updatedAt: timestamp,
      rev: (sale.rev ?? 1) + 1,
    };

    /* Stock: move exactly the difference. A reduction returns stock; an
       increase takes stock and is refused when there is not enough on hand,
       which prevents an edit from overselling an inventory line. */
    const stockDeductions = { ...(order.stockDeductions ?? {}) };
    const inventoryWrites: InventoryRecord[] = [];

    if (input.quantity === 0) {
      const deducted = stockDeductions[target.menuItemId ?? ''] ?? previousQuantity;
      const restore = Math.min(previousQuantity, deducted);
      if (target.menuItemId && restore > 0) {
        const record = await findInventoryForItem(target.menuItemId);
        if (record) {
          const next = Number((record.quantity + restore).toFixed(3));
          const updated: InventoryRecord = {
            ...record,
            quantity: next,
            isOutOfStock: next > 0 ? 0 : record.isOutOfStock,
            updatedAt: timestamp,
            rev: (record.rev ?? 1) + 1,
          };
          inventoryWrites.push(updated);
          stockDeductions[target.menuItemId] = Math.max(0, deducted - restore);
        }
      }
    } else {
      const unitDelta = delta; // direct menu-item line: 1 unit = 1 stock unit
      if (target.menuItemId && unitDelta !== 0) {
        const record = await findInventoryForItem(target.menuItemId);
        if (record) {
          if (unitDelta > 0) {
            if (record.quantity < unitDelta) {
              throw new ReceiptEditError(
                `Not enough stock for ${target.name}: ${record.quantity} ${record.unit} available.`,
              );
            }
            const next = Number((record.quantity - unitDelta).toFixed(3));
            inventoryWrites.push({
              ...record,
              quantity: next,
              isOutOfStock: next <= 0 ? 1 : record.isOutOfStock,
              updatedAt: timestamp,
              rev: (record.rev ?? 1) + 1,
            });
            stockDeductions[target.menuItemId] =
              (stockDeductions[target.menuItemId] ?? 0) + unitDelta;
          } else {
            // Never return more than this order actually took out of stock:
            // an over-sold line that clamped at zero cannot inflate stock.
            const recorded = stockDeductions[target.menuItemId];
            const restore =
              typeof recorded === 'number'
                ? Math.min(-unitDelta, Math.max(0, recorded))
                : -unitDelta;
            const next = Number((record.quantity + restore).toFixed(3));
            inventoryWrites.push({
              ...record,
              quantity: next,
              isOutOfStock: next > 0 ? 0 : record.isOutOfStock,
              updatedAt: timestamp,
              rev: (record.rev ?? 1) + 1,
            });
            stockDeductions[target.menuItemId] = Math.max(
              0,
              (stockDeductions[target.menuItemId] ?? 0) - restore,
            );
          }
        }
      }
    }

    const audit: ReceiptAuditRecord = buildEntity<ReceiptAuditRecord>({
      orderId: order.id,
      orderNumber: order.orderNumber,
      itemId: target.id,
      itemName: target.name,
      previousQuantity,
      newQuantity: input.quantity,
      reason: reason.slice(0, 200),
      editor: input.editor,
      before: {
        subtotal: order.subtotal,
        discountTotal: order.discountTotal,
        taxTotal: order.taxTotal,
        grandTotal: order.grandTotal,
        itemCount: items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
      },
      after: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        itemCount: totals.itemCount,
      },
      beforeLine: {
        itemId: target.id,
        name: target.name,
        quantity: previousQuantity,
        lineTotal: target.lineTotal,
      },
      afterLine: {
        itemId: target.id,
        name: target.name,
        quantity: input.quantity,
        lineTotal: recalculated.lineTotal,
      },
    });

    await db.transaction(
      [STORES.orders, STORES.orderItems, STORES.sales, STORES.inventory, STORES.receiptAudits],
      'readwrite',
      async (stores) => {
        const orderStore = stores[STORES.orders];
        const itemStore = stores[STORES.orderItems];
        const saleStore = stores[STORES.sales];
        const inventoryStore = stores[STORES.inventory];
        const auditStore = stores[STORES.receiptAudits];
        if (!orderStore || !itemStore || !saleStore || !inventoryStore || !auditStore) {
          throw new ReceiptEditError('The receipt stores are unavailable.');
        }

        // Re-read inside the transaction so a concurrent cancel cannot be
        // overwritten by this edit.
        const current = (await db.request(orderStore.get(order.id))) as
          | OrderRecord
          | undefined;
        if (!current || current.status !== 'completed') {
          throw new ReceiptEditError('This order can no longer be edited.');
        }

        updatedOrder.stockDeductions = stockDeductions;
        await db.request(itemStore.put(updatedItem));
        await db.request(orderStore.put(updatedOrder));
        await db.request(saleStore.put(updatedSale));
        for (const record of inventoryWrites) {
          await db.request(inventoryStore.put(record));
        }
        await db.request(auditStore.put(audit));
      },
    );

    await notificationService.create({
      key: `receipt-edit:${audit.id}`,
      kind: 'audit',
      severity: 'warning',
      title: `Receipt #${order.orderNumber} was edited`,
      body: `${target.name}: ${previousQuantity} → ${input.quantity}. ${input.editor}`,
      link: '/sales',
    });

    return {
      order: updatedOrder,
      item: updatedItem,
      sale: updatedSale,
      audit,
    };
  },
};

/** First live inventory line linked to a menu item, if any. */
async function findInventoryForItem(menuItemId: ID): Promise<InventoryRecord | undefined> {
  const rows = await db.getAllByIndex<InventoryRecord>(
    STORES.inventory,
    'by_menuItemId',
    menuItemId,
  );
  return rows.find((row) => !row.deletedAt);
}
