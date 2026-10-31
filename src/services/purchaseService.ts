/**
 * Stock receiving.
 *
 * A purchase record is written in the same transaction as the stock increase,
 * so the history can never disagree with the quantity on hand. Records are
 * append-only: a mistake is corrected by receiving a negative adjustment
 * through "Record adjustment", which keeps the audit trail intact.
 */

import { STORES } from '@/config/storage.config';
import { db } from '@/data/db/indexedDb';
import { buildEntity, inventoryRepository, purchasesRepository } from '@/data/repositories';
import { trackChange } from '@/data/repositories/changeTracker';
import { notificationService } from './notificationService';
import type { PurchaseRecord } from '@/types/domain';
import type { ID } from '@/types/common';
import { nowISO } from '@/utils/date';
import { assertPaisa, clampStock, sanitiseText } from '@/utils/validate';
import { inventoryService, type InventoryItemView } from './inventoryService';

export interface PurchaseInput {
  inventoryId: ID;
  quantity: number;
  unitCost: number | null;
  supplier: string;
  reference: string;
  note: string;
  /** Defaults to now when omitted. */
  receivedAt?: string;
}

export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseError';
  }
}

export const purchaseService = {
  /** Receiving history, newest first. */
  async list(limit = 100): Promise<PurchaseRecord[]> {
    const records = await purchasesRepository.list();
    return records
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
  },

  async forItem(inventoryId: ID): Promise<PurchaseRecord[]> {
    const records = await purchasesRepository.findByIndex(
      'by_inventoryId',
      inventoryId,
    );
    return records.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  },

  /**
   * Record a receipt and increase the linked stock line by the same amount.
   *
   * Refuses an unknown stock line, a zero quantity, and a reduction that would
   * take the quantity below zero. Nothing is written when a check fails.
   */
  async record(input: PurchaseInput): Promise<PurchaseRecord> {
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) {
      throw new PurchaseError('Enter a quantity other than zero.');
    }

    if (Math.abs(quantity) > 1_000_000 || Math.abs(Math.round(quantity * 1000) - quantity * 1000) > 1e-7) {
      throw new PurchaseError('Use a stock quantity within ±1,000,000, with at most three decimal places.');
    }
    const receivedAt = input.receivedAt ?? nowISO();
    if (!Number.isFinite(Date.parse(receivedAt))) throw new PurchaseError('Enter a valid receiving date.');
    let unitCost: number | null;
    try { unitCost = input.unitCost === null ? null : assertPaisa(input.unitCost, 'Unit cost'); }
    catch { throw new PurchaseError('Unit cost must be a non-negative amount in integer paisa.'); }

    const record = await db.transaction([STORES.inventory, STORES.purchases], 'readwrite', async (stores) => {
      // The transactional read prevents two concurrent receipts from using the same stale quantity.
      const item = await db.request(stores[STORES.inventory]!.get(input.inventoryId)) as import('@/types/domain').InventoryRecord | undefined;
      if (!item || item.deletedAt) throw new PurchaseError('That stock line no longer exists.');
      const total = Number((item.quantity + quantity).toFixed(3));
      if (total < 0) throw new PurchaseError(`Only ${item.quantity} ${item.unit} on hand; that adjustment is too large.`);
      if (total > 1_000_000) throw new PurchaseError('This receipt would exceed the maximum stock quantity of 1,000,000.');
      const nextQuantity = clampStock(total);
      const timestamp = nowISO();
      const updated = { ...item, quantity: nextQuantity, isOutOfStock: nextQuantity > 0 ? 0 : 1,
        quantityBeforeOutOfStock: nextQuantity > 0 ? null : item.quantityBeforeOutOfStock,
        ...(unitCost !== null ? { costPerUnit: unitCost } : {}), updatedAt: timestamp, rev: (item.rev ?? 1) + 1 };
      const purchase = buildEntity<PurchaseRecord>({ inventoryId: item.id, itemName: item.name,
        quantity, unitCost, supplier: sanitiseText(input.supplier, 120), reference: sanitiseText(input.reference, 60),
        note: sanitiseText(input.note, 200), receivedAt, quantityAfter: nextQuantity });
      await db.request(stores[STORES.inventory]!.put(updated));
      await db.request(stores[STORES.purchases]!.put(purchase));
      return purchase;
    });
    // Optional transport/notification failures cannot reverse a committed receipt.
    try {
      await trackChange(STORES.inventory, record.inventoryId!, 'update', await inventoryRepository.getById(record.inventoryId!));
      await notificationService.create({ key: `purchase:${record.id}`, kind: 'stock',
        title: `Stock received: ${record.itemName}`, body: `${record.quantity} received · ${record.supplier || 'No supplier specified'}`, link: '/purchases' });
    } catch { /* The receipt is committed; optional outbox/notification failure must not invite a duplicate receipt. */ }
    return record;
  },

  /** Total spend recorded in a window, for the receiving summary. */
  async spendSummary(records: PurchaseRecord[]): Promise<number> {
    return records.reduce((sum, record) => {
      if (record.unitCost === null || record.quantity <= 0) return sum;
      return sum + Math.round(record.unitCost * record.quantity);
    }, 0);
  },

  /** Stock lines available to receive against. */
  async stockLines(): Promise<InventoryItemView[]> {
    return inventoryService.list();
  },
};
