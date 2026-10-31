import type { OrderType, OrderStatus, SelectedAddOn, SelectedTopping } from '@/types/domain';
import { formatMoney } from './currency';

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

/** A modifier price is per portion; the extended price covers the whole line. */
export function receiptModifierLabel(entry: SelectedTopping | SelectedAddOn, quantity: number): string {
  return `${entry.name} x${quantity} @ ${formatMoney(entry.price, { withSymbol: false })} = ${formatMoney(entry.price * quantity, { withSymbol: false })}`;
}
export function receiptStatusLabel(status: OrderStatus): string | null {
  return status === 'cancelled' ? 'CANCELLED — NOT A VALID SALE' : status === 'refunded' ? 'REFUNDED — ORIGINAL RECEIPT' : null;
}
