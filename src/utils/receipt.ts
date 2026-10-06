import type { OrderType } from '@/types/domain';

/** Consistent human-readable order type for customer and kitchen receipts. */
export function receiptOrderTypeLabel(type: OrderType): string {
  switch (type) {
    case 'dine-in':
      return 'Dine-In';
    case 'delivery':
      return 'Delivery';
    default:
      return 'Takeaway';
  }
}
