/**
 * Stock receiving.
 *
 * A purchase record is written in the same transaction as the stock increase,
 * so the history can never disagree with the quantity on hand. Records are
 * append-only: a mistake is corrected by receiving a negative adjustment
 * through "Record adjustment", which keeps the audit trail intact.
 */

import { inventoryRepository, purchasesRepository } from '@/data/repositories';
import type { PurchaseRecord } from '@/types/domain';
import type { ID } from '@/types/common';
import { nowISO } from '@/utils/date';
import { clampStock, sanitiseText } from '@/utils/validate';
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

    const item = await inventoryRepository.getById(input.inventoryId);
    if (!item || item.deletedAt) {
      throw new PurchaseError('That stock line no longer exists.');
    }

    const nextQuantity = clampStock(item.quantity + quantity);
    if (item.quantity + quantity < 0) {
      throw new PurchaseError(
        `Only ${item.quantity} ${item.unit} on hand; that adjustment is too large.`,
      );
    }

    const unitCost =
      input.unitCost === null || !Number.isFinite(input.unitCost)
        ? null
        : Math.max(0, Math.round(input.unitCost));

    await inventoryRepository.update(item.id, {
      quantity: nextQuantity,
      // Receiving stock makes a line sellable again.
      isOutOfStock: nextQuantity > 0 ? 0 : 1,
      quantityBeforeOutOfStock: nextQuantity > 0 ? null : undefined,
      ...(unitCost !== null ? { costPerUnit: unitCost } : {}),
    });

    return purchasesRepository.create({
      inventoryId: item.id,
      itemName: item.name,
      quantity,
      unitCost,
      supplier: sanitiseText(input.supplier, 120),
      reference: sanitiseText(input.reference, 60),
      note: sanitiseText(input.note, 200),
      receivedAt: input.receivedAt ?? nowISO(),
      quantityAfter: nextQuantity,
    });
  },

  /** Total spend recorded in a window, for the receiving summary. */
  async spendSummary(records: PurchaseRecord[]): Promise<number> {
    return records.reduce((sum, record) => {
      if (record.unitCost === null || record.quantity <= 0) return sum;
      return sum + record.unitCost * record.quantity;
    }, 0);
  },

  /** Stock lines available to receive against. */
  async stockLines(): Promise<InventoryItemView[]> {
    return inventoryService.list();
  },
};
