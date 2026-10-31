/**
 * Domain entity shapes for the persistent data layer.
 *
 * These describe the structure of records held in IndexedDB. Business rules
 * and UI for each domain arrive in their own steps; defining the shapes here
 * keeps persistence type-safe from the start.
 *
 * All money fields are integer paisa (see utils/currency.ts).
 */

import type { BaseEntity, ID, ISODateString, Paisa } from './common';
import type { PasswordHash } from '@/utils/crypto';

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface AdminRecord extends BaseEntity {
  username: string;
  password: PasswordHash;
  role: 'admin';
  mustChangePassword: boolean;
  lastLoginAt?: ISODateString | null;
  /**
   * SHA-256 of the currently valid session token.
   *
   * A session in localStorage is only honoured if its token hashes to this
   * value. Without it, anyone could hand-write a session object and gain
   * admin access without knowing the password. Stored hashed so reading the
   * database does not yield a usable token.
   */
  sessionTokenHash?: string | null;
  /**
   * Optional contact details for the administrator. Purely informational —
   * they are never used to authenticate and carry no credential material.
   */
  displayName?: string;
  email?: string;
  phone?: string;
}

/* ------------------------------------------------------------------ */
/* Restaurant                                                          */
/* ------------------------------------------------------------------ */

/**
 * Optimised image.
 *
 * Stored as a compressed data URL so the owning record is self-contained and
 * survives export/backup without a separate blob store.
 */
export interface StoredImage {
  /** Compressed image as a data URL (WebP where supported). */
  dataUrl: string;
  /** Encoded MIME type, e.g. `image/webp`. */
  type: string;
  width: number;
  height: number;
  /** Encoded size in bytes, after compression. */
  bytes: number;
  /** Original file name, shown in the UI for recognition. */
  fileName: string;
}

/** The restaurant logo is a stored image. Kept as an alias for readability. */
export type RestaurantLogo = StoredImage;

/**
 * Restaurant profile. A single record identified by RESTAURANT_PROFILE_ID —
 * one terminal configures one restaurant.
 *
 * Every text field defaults to an empty string rather than being absent, so
 * the edit form always has a defined value and never renders placeholder or
 * example data.
 */
export interface RestaurantRecord extends BaseEntity {
  name: string;
  logo: RestaurantLogo | null;
  /** Full street address; free text so it suits any locale. */
  address: string;
  phone: string;
  email: string;
  /** Extra details printed on the receipt, e.g. tax or registration numbers. */
  receiptInfo: string;
  /** Thank-you line printed at the very bottom of a receipt. */
  receiptFooter: string;

  /**
   * Dashboard hero image. Optional: records written before this field existed
   * simply render the default banner treatment. Stored in the same optimised
   * form as the logo, so it is a few tens of kilobytes, not megabytes.
   */
  banner?: StoredImage | null;
  /** Optional one-line tagline shown over the banner. Empty means none. */
  tagline?: string;

  /** Sales tax percentage applied at billing, e.g. 16 for 16%. */
  taxPercent: number;
  /** Whether displayed prices already include tax. */
  taxInclusive: boolean;

  /* Reserved for later phases; not editable yet. */
  orderNumberPrefix?: string;
}

/* ------------------------------------------------------------------ */
/* Menu items and their sizes/prices                                   */
/* ------------------------------------------------------------------ */

/**
 * Which variant set a menu item is priced in:
 * - `size`   food sizes (Small / Medium / Large / Extra Large / XL)
 * - `volume` cold drink volumes (250 ml, 500 ml / Half Liter, 1 Liter, ...)
 */
export type VariantKind = 'size' | 'volume';

export interface MenuItemRecord extends BaseEntity {
  name: string;
  description: string;
  /** Free-text category. Empty string when uncategorised. */
  category: string;
  /** Optimised item photo, or null when none has been uploaded. */
  image: StoredImage | null;
  /**
   * Whether the item is offered for sale. IndexedDB cannot index booleans,
   * so this is stored as 0 | 1.
   */
  isActive: 0 | 1;
  /** Whether stock is decremented when this item is sold. */
  tracksInventory: 0 | 1;
  /**
   * Variant label set the item is priced in. Optional because records
   * created before this field existed simply read as 'size'.
   */
  variantKind?: VariantKind;
  /**
   * Item-level discount percentage (0–100), applied to this item's lines at
   * checkout. `null`/absent means no discount. Deliberately per-item: there
   * is no system-wide automatic discount.
   */
  discountPercent?: number | null;
  sortOrder?: number;
  /**
   * Optional commercial details. All are free-form or numeric extras an
   * operator may keep for their own records; none of them changes checkout
   * pricing, which always comes from the item's price rows and discount.
   */
  sku?: string;
  barcode?: string;
  /** Cost per portion in paisa, used to show margin in the item form. */
  costPrice?: Paisa | null;
  /** Rough preparation time in minutes. */
  prepMinutes?: number | null;
  /** Ingredients or composition, free text. */
  ingredients?: string;
}

/** A purchasable size/variant of a menu item, e.g. Small / Large. */
export interface ItemPriceRecord extends BaseEntity {
  menuItemId: ID;
  /**
   * Size or variant label. Free text so both food sizes ("Large",
   * "Extra Large", "XL") and drink volumes ("250 ml", "1 Liter") live in
   * the same rows; the label sets are defined in services/menuService.
   */
  label: string;
  price: Paisa;
  /** Optional cost for margin reporting. */
  costPrice?: Paisa;
  isDefault: 0 | 1;
  sortOrder?: number;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export type InventoryUnit =
  | 'unit'
  | 'kg'
  | 'g'
  | 'litre'
  | 'ml'
  | 'pack'
  | 'box'
  | 'bottle';

/**
 * A stock line.
 *
 * Inventory is standalone: it can track anything (cups, flour, gas cylinders),
 * and may OPTIONALLY be linked to a menu item via `menuItemId`. When a linked
 * line is unavailable or out of stock, the menu item is withheld from the POS
 * so staff cannot sell what is not there.
 */
export interface InventoryRecord extends BaseEntity {
  /** Linked menu item, or null when this is a standalone supply. */
  menuItemId: ID | null;
  name: string;
  sku: string;
  unit: InventoryUnit;
  /** Current quantity on hand. Never negative. */
  quantity: number;
  /**
   * Operator's availability switch, independent of quantity. IndexedDB cannot
   * index booleans, so this is stored as 0 | 1.
   */
  isAvailable: 0 | 1;
  /**
   * Explicitly marked out of stock. Kept separate from `quantity` so the
   * previous quantity survives and can be restored.
   */
  isOutOfStock: 0 | 1;
  /** Quantity captured when marked out of stock, used to restore it. */
  quantityBeforeOutOfStock: number | null;
  /** Threshold at or below which the line is considered low. */
  reorderLevel: number | null;
  costPerUnit?: Paisa;
}

/* ------------------------------------------------------------------ */
/* Deals                                                               */
/* ------------------------------------------------------------------ */

/**
 * How a deal is priced.
 * - `fixed`      one bundle price for the whole deal
 * - `percentage` a discount off the sum of the included products
 */
export type DealPricingType = 'fixed' | 'percentage';

/** A product included in a deal, at a specific size. */
export interface DealLine {
  menuItemId: ID;
  /** Size label, e.g. "Small". Empty when the item has no priced sizes. */
  sizeLabel: string;
  quantity: number;
}

export interface DealRecord extends BaseEntity {
  name: string;
  description: string;
  /** Optimised deal photo, or null when none has been uploaded. */
  image: StoredImage | null;
  pricingType: DealPricingType;
  /** Bundle price when `pricingType` is 'fixed'. */
  price: Paisa | null;
  /** Discount percentage when `pricingType` is 'percentage'. */
  percentOff: number | null;
  items: DealLine[];
  /**
   * Visible and sellable in the POS. IndexedDB cannot index booleans, so
   * this is stored as 0 | 1. Unpublished deals stay saved and editable.
   */
  isPublished: 0 | 1;
  startsAt?: ISODateString | null;
  endsAt?: ISODateString | null;
}

/* ------------------------------------------------------------------ */
/* Orders and order items                                              */
/* ------------------------------------------------------------------ */

export type OrderStatus =
  | 'draft'
  | 'held'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export type OrderType = 'dine-in' | 'takeaway' | 'delivery';

/** Fulfilment progress for delivery orders; financial order status stays separate. */
export type DeliveryStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready-for-delivery'
  | 'assigned'
  | 'out-for-delivery'
  | 'delivered'
  | 'cancelled';

/** A small local delivery-person roster stored in the existing settings store. */
export interface DeliveryRider {
  id: ID;
  name: string;
  phone?: string;
  isActive: boolean;
}

export interface DeliveryHistoryEntry {
  status: DeliveryStatus;
  at: ISODateString;
  message: string;
}

/**
 * How the customer settled the order. `other` predates the explicit
 * `digital` option and is still accepted for orders stored before it.
 */
export type PaymentMethod = 'cash' | 'card' | 'digital' | 'other';

export interface OrderRecord extends BaseEntity {
  /** Human-readable sequential number, unique per installation. */
  orderNumber: string;
  status: OrderStatus;
  orderType: OrderType;
  /** Sum of line totals before discount and tax. */
  subtotal: Paisa;
  discountTotal: Paisa;
  taxTotal: Paisa;
  /** Final payable amount. */
  grandTotal: Paisa;
  /** Checkout tax configuration; absent on historical orders. */
  taxPercent?: number;
  taxInclusive?: boolean;
  paymentMethod?: PaymentMethod | null;
  amountPaid?: Paisa;
  changeDue?: Paisa;
  tableLabel?: string;
  customerName?: string;
  customerPhone?: string;
  /** Linked customer record, set when the order carried customer details. */
  customerId?: ID | null;
  note?: string;
  /** Delivery-only information; these fields do not affect the sale total. */
  deliveryAddress?: string;
  deliveryNotes?: string;
  deliveryStatus?: DeliveryStatus;
  assignedRiderId?: ID | null;
  deliveryCompletedAt?: ISODateString | null;
  deliveryHistory?: DeliveryHistoryEntry[];
  completedAt?: ISODateString | null;
  /** Set when the order is cancelled; keeps the audit trail on the order. */
  cancelledAt?: ISODateString | null;
  /**
   * Set whenever an authorised receipt correction (quantity change or line
   * void) has been applied after completion. The original figures remain in
   * the receiptAudits store; these fields are the quick "was edited" marker.
   */
  editedAt?: ISODateString | null;
  editCount?: number;
  /**
   * Units actually deducted from each inventory line when this order
   * completed, keyed by menu item ID. Cancellation restores exactly this
   * amount — never more (an over-sold line that clamped to zero) and never
   * twice (cancellation is only allowed once).
   */
  stockDeductions?: Record<ID, number>;
}

export interface SelectedTopping {
  costPrice?: Paisa | null;
  /** Optional for receipts saved before stable modifier IDs were captured. */
  modifierId?: ID;
  name: string;
  price: Paisa;
}

export interface SelectedAddOn {
  costPrice?: Paisa | null;
  modifierId?: ID;
  name: string;
  price: Paisa;
}

export interface OrderItemRecord extends BaseEntity {
  orderId: ID;
  menuItemId?: ID | null;
  itemPriceId?: ID | null;
  dealId?: ID | null;
  /** Denormalised so a receipt still reads correctly if the item is edited. */
  name: string;
  sizeLabel?: string;
  unitPrice: Paisa;
  /** Complete known portion cost incl. modifiers; null/absent = unavailable. */
  unitCost?: Paisa | null;
  /** Total bundle saving at checkout, not a later recomputation at menu prices. */
  dealSavings?: Paisa;
  quantity: number;
  discount: Paisa;
  /** unitPrice * quantity - discount + toppings/add-ons */
  lineTotal: Paisa;
  note?: string;
  toppings?: SelectedTopping[];
  addOns?: SelectedAddOn[];
  toppingTotal?: Paisa;
  addOnTotal?: Paisa;
}

export interface ToppingRecord extends BaseEntity {
  name: string;
  price: Paisa;
  costPrice?: Paisa | null;
  /** Absent/empty preserves the legacy all-products behaviour. */
  menuItemIds?: ID[];
  isActive: 0 | 1;
}

export interface AddOnRecord extends BaseEntity {
  name: string;
  price: Paisa;
  costPrice?: Paisa | null;
  menuItemIds?: ID[];
  isActive: 0 | 1;
}

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export interface SaleRecord extends BaseEntity {
  orderId: ID;
  orderNumber: string;
  /** Local calendar date (YYYY-MM-DD) used for daily reporting. */
  businessDate: string;
  completedAt: ISODateString;
  subtotal: Paisa;
  discountTotal: Paisa;
  taxTotal: Paisa;
  grandTotal: Paisa;
  taxPercent?: number;
  taxInclusive?: boolean;
  paymentMethod: PaymentMethod;
  itemCount: number;
  /**
   * Order type copied at completion so report breakdowns need no join.
   * Optional because sales written before v5.1.9 have no such field; the
   * reporting code falls back to the linked order for those rows.
   */
  orderType?: OrderType;
  /** Linked customer record when the order carried customer details. */
  customerId?: ID | null;
  /** Set when the sale is later refunded. */
  refundedAt?: ISODateString | null;
  /** Set when a permitted receipt correction changed this sale's figures. */
  editedAt?: ISODateString | null;
  /**
   * Set when the order is cancelled. The row is kept for the audit trail
   * but excluded from every total, report and cash-flow figure.
   */
  cancelledAt?: ISODateString | null;
}

/* ------------------------------------------------------------------ */
/* Purchases (stock receiving)                                         */
/* ------------------------------------------------------------------ */

/**
 * One recorded stock receipt.
 *
 * It records what was received and from whom, and is never edited afterwards:
 * a mistake is corrected by recording an adjustment, so the receiving history
 * stays an audit trail like the sales ledger.
 */
export interface PurchaseRecord extends BaseEntity {
  /** Stock line that was topped up, or null if the line was deleted later. */
  inventoryId: ID | null;
  /** Name copied at receipt time so history survives an item rename. */
  itemName: string;
  quantity: number;
  /** Unit cost in paisa at the time of receipt, or null when unknown. */
  unitCost: Paisa | null;
  supplier: string;
  /** Invoice or delivery-note number, free text. */
  reference: string;
  note: string;
  /** When the stock physically arrived (ISO). */
  receivedAt: ISODateString;
  /** Quantity on hand after this receipt, for a readable history. */
  quantityAfter: number;
}

/** Operating expense. Money is integer paisa; expenseDate is a local calendar day. */
export interface ExpenseRecord extends BaseEntity {
  title: string;
  description: string;
  category: string;
  amount: Paisa;
  expenseDate: ISODateString;
  paymentMethod: PaymentMethod;
  payee: string;
  reference: string;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Lightweight customer record. Created automatically from the POS name or
 * phone fields at checkout, or manually from the Customers screen. Matching
 * is by normalised phone number first, then exact name — never by loose
 * name matching when a phone exists.
 */
export interface CustomerRecord extends BaseEntity {
  name: string;
  /** Phone exactly as entered, for display. */
  phone?: string;
  /** Digits-only key used to find the same person again. Empty when none. */
  phoneKey?: string;
  email?: string;
  address?: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export type NotificationKind =
  | 'order'
  | 'stock'
  | 'payment'
  | 'audit'
  | 'system';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

/**
 * A single in-app notification.
 *
 * Persisted so the unread count survives a refresh and repeated app starts
 * cannot duplicate the same event: `key` is the dedupe key and is unique in
 * practice (see notificationService, which checks before writing).
 */
export interface NotificationRecord extends BaseEntity {
  key: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  /** In-app route the notification opens, e.g. /sales. */
  link?: string | null;
  readAt?: ISODateString | null;
}

/* ------------------------------------------------------------------ */
/* Receipt edit audit                                                  */
/* ------------------------------------------------------------------ */

/** Snapshot of a receipt line as it was before/after a correction. */
export interface ReceiptAuditLine {
  itemId: ID;
  name: string;
  quantity: number;
  lineTotal: Paisa;
}

/** Snapshot of the financial header before/after a correction. */
export interface ReceiptAuditTotals {
  subtotal: Paisa;
  discountTotal: Paisa;
  taxTotal: Paisa;
  grandTotal: Paisa;
  itemCount: number;
}

/**
 * Append-only record of an authorised correction to a completed receipt.
 *
 * Never updated or deleted by the application: it is the audit trail that
 * proves what changed, who changed it, when, and why.
 */
export interface ReceiptAuditRecord extends BaseEntity {
  orderId: ID;
  orderNumber: string;
  itemId: ID;
  itemName: string;
  previousQuantity: number;
  newQuantity: number;
  reason: string;
  editor: string;
  before: ReceiptAuditTotals;
  after: ReceiptAuditTotals;
  beforeLine: ReceiptAuditLine;
  afterLine: ReceiptAuditLine;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Generic keyed setting so new preferences need no schema change. */
export interface SettingRecord<T = unknown> extends BaseEntity {
  /** The record id doubles as the setting key. */
  value: T;
}

/* ------------------------------------------------------------------ */
/* Sync queue                                                          */
/* ------------------------------------------------------------------ */

export type SyncOperation = 'create' | 'update' | 'delete';
export type SyncQueueStatus = 'pending' | 'syncing' | 'failed' | 'synced';

export interface SyncQueueRecord extends BaseEntity {
  /** Store the mutation applies to. */
  entity: string;
  entityId: ID;
  operation: SyncOperation;
  payload: unknown;
  status: SyncQueueStatus;
  attempts: number;
  lastAttemptAt?: ISODateString | null;
  lastError?: string | null;
  /**
   * Stable per-item key sent with every attempt. The server uses it to make
   * retries idempotent, which is what prevents duplicate orders when a
   * response is lost after the server already committed.
   */
  idempotencyKey?: string;
  /** Earliest time this item may be retried (exponential backoff). */
  nextAttemptAt?: ISODateString | null;
}
