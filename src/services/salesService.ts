/**
 * Sales analytics.
 *
 * Every figure is derived from stored `sales` records written when an order
 * was completed. Nothing is estimated, projected or invented: with no orders,
 * every total is zero.
 *
 * Periods are calendar-based (the week starts on Monday), computed in local
 * time so "today" matches the operator's day rather than UTC.
 */

import {
  menuItemsRepository,
  orderItemsRepository,
  ordersRepository,
  salesRepository,
} from '@/data/repositories';
import type { OrderType, PaymentMethod, SaleRecord } from '@/types/domain';
import type { Paisa } from '@/types/common';

export type PeriodKey = 'today' | 'week' | 'month';

export interface PeriodSummary {
  key: PeriodKey;
  label: string;
  /** Sum of grand totals for completed, non-refunded sales. */
  total: Paisa;
  orderCount: number;
  /** Total items sold across those orders. */
  itemCount: number;
  /** total / orderCount, or 0 when there are no orders. */
  averageOrder: Paisa;
  /** Inclusive local-date bounds, as YYYY-MM-DD. */
  from: string;
  to: string;
}

export interface DayPoint {
  /** YYYY-MM-DD */
  date: string;
  /** Short weekday label, e.g. "Mon". */
  label: string;
  total: Paisa;
  orderCount: number;
  isToday: boolean;
}

/** Money received per payment method, in paisa. */
export interface PaymentMethodTotals {
  cash: Paisa;
  card: Paisa;
  digital: Paisa;
  other: Paisa;
}

/**
 * Cash-flow figures derived from completed, non-cancelled sales — the
 * actual payable amount per method (post-discount), never an estimate.
 */
export interface PaymentFlow {
  today: PaymentMethodTotals;
  week: PaymentMethodTotals;
  all: PaymentMethodTotals;
}

export interface SalesOverview {
  today: PeriodSummary;
  week: PeriodSummary;
  month: PeriodSummary;
  /** Current calendar week, Monday to Sunday, for the daily chart. */
  weekDays: DayPoint[];
  /** Received money per payment method over three windows. */
  paymentFlow: PaymentFlow;
  /**
   * Most recent sales, newest first — includes cancelled rows so history
   * keeps its audit trail (flagged, never counted in any total).
   */
  recent: SaleRecord[];
  /** True when no sale has ever been recorded. */
  isEmpty: boolean;
}

/** Local calendar date key, matching how orderService stamps businessDate. */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday of the calendar week containing `date`. */
export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday. Shift so Monday is the first day.
  const offset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - offset);
  return result;
}

export function startOfMonth(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * A sale counts towards analytics and cash flow only while it is a real,
 * completed sale: cancelled and refunded rows are excluded from every
 * figure but kept in the record itself for the audit trail.
 * Soft-deleted records are already excluded by the repository.
 */
export function isCountable(sale: SaleRecord): boolean {
  return !sale.refundedAt && !sale.cancelledAt;
}

/** Treat a non-finite stored value as zero rather than poisoning the sum. */
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function emptyFlow(): PaymentMethodTotals {
  return { cash: 0, card: 0, digital: 0, other: 0 };
}

/** Route a sale's amount into the right per-method bucket. */
function addToFlow(
  flow: PaymentMethodTotals,
  method: SaleRecord['paymentMethod'],
  amount: number,
): void {
  switch (method) {
    case 'cash':
      flow.cash += amount;
      break;
    case 'card':
      flow.card += amount;
      break;
    case 'digital':
      flow.digital += amount;
      break;
    default:
      flow.other += amount;
  }
}

function summarise(
  key: PeriodKey,
  label: string,
  sales: SaleRecord[],
  from: string,
  to: string,
): PeriodSummary {
  const inRange = sales.filter(
    (s) => s.businessDate >= from && s.businessDate <= to,
  );

  /*
   * Defensive aggregation. Validation now prevents bad rows being written,
   * but a database may already contain one from an earlier build, and a
   * single NaN would otherwise make the whole day's figure unreadable.
   */
  const total = inRange.reduce((sum, s) => sum + safeNumber(s.grandTotal), 0);
  const itemCount = inRange.reduce((sum, s) => sum + safeNumber(s.itemCount), 0);
  const orderCount = inRange.length;

  return {
    key,
    label,
    total,
    orderCount,
    itemCount,
    // Guard the division: no orders means zero, never NaN.
    averageOrder: orderCount > 0 ? Math.round(total / orderCount) : 0,
    from,
    to,
  };
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];


/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export type ReportPreset =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'custom';

export interface DateRange {
  /** Inclusive local date, YYYY-MM-DD. */
  from: string;
  /** Inclusive local date, YYYY-MM-DD. */
  to: string;
}

export interface ReportBucket {
  /** Present on daily buckets; preserves the local reporting date. */
  date?: string;
  label: string;
  amount: Paisa;
  orderCount: number;
}

export interface ProductPerformance {
  name: string;
  quantity: number;
  amount: Paisa;
}

export interface SalesReport extends DateRange {
  grossSales: Paisa;
  netSales: Paisa;
  discounts: Paisa;
  taxTotal: Paisa;
  refunds: Paisa;
  refundCount: number;
  orderCount: number;
  itemCount: number;
  averageOrder: Paisa;
  byPayment: ReportBucket[];
  byOrderType: ReportBucket[];
  byDay: ReportBucket[];
  byHour: ReportBucket[];
  topProducts: ProductPerformance[];
  topCategories: ProductPerformance[];
  /** Countable sales in the range, newest first. */
  sales: SaleRecord[];
}

function dayLabel(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return key;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Inclusive list of local date keys between two dates. */
function eachDay(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return [];
  }
  const days: string[] = [];
  const cursor = new Date(start);
  // Safety bound: a decade of daily rows is far beyond any real report.
  while (cursor <= end && days.length < 3660) {
    days.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  digital: 'Digital',
  other: 'Other',
};

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  'dine-in': 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

export const REPORT_PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'custom', label: 'Custom range' },
];

/** Resolve a preset to concrete inclusive date bounds. */
export function resolvePresetRange(
  preset: ReportPreset,
  now: Date = new Date(),
): DateRange {
  const today = dateKey(now);
  switch (preset) {
    case 'yesterday': {
      const yesterday = addDays(now, -1);
      const key = dateKey(yesterday);
      return { from: key, to: key };
    }
    case 'this-week': {
      return { from: dateKey(startOfWeek(now)), to: today };
    }
    case 'last-week': {
      const start = addDays(startOfWeek(now), -7);
      const end = addDays(start, 6);
      return { from: dateKey(start), to: dateKey(end) };
    }
    case 'this-month': {
      return { from: dateKey(startOfMonth(now)), to: today };
    }
    case 'last-month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: dateKey(start), to: dateKey(end) };
    }
    case 'custom':
      return { from: today, to: today };
    case 'today':
    default:
      return { from: today, to: today };
  }
}

/**
 * Build a complete report for an inclusive date range.
 *
 * Definitions match the accounting logic used at checkout:
 *  - gross sales   = sum of order subtotals before discount and tax,
 *  - discounts     = item-level plus order-level discounts,
 *  - tax           = tax collected (inclusive or exclusive, as configured),
 *  - net sales     = grand totals actually charged (what the till received),
 *  - refunds/voids = cancelled or refunded sales, excluded from revenue.
 * Net sales is revenue, never profit: product cost is not tracked as a
 * guaranteed figure here, so no profit number is presented.
 */
async function buildReport(range: DateRange): Promise<SalesReport> {
  const { from, to } = range;
  const all = await salesRepository.list();
  const inRange = all.filter(
    (sale) => sale.businessDate >= from && sale.businessDate <= to,
  );
  const countable = inRange.filter(isCountable);
  const voided = inRange.filter((sale) => !isCountable(sale));

  const grossSales = countable.reduce((sum, s) => sum + safeNumber(s.subtotal), 0);
  const netSales = countable.reduce((sum, s) => sum + safeNumber(s.grandTotal), 0);
  const discounts = countable.reduce(
    (sum, s) => sum + safeNumber(s.discountTotal),
    0,
  );
  const taxTotal = countable.reduce((sum, s) => sum + safeNumber(s.taxTotal), 0);
  const itemCount = countable.reduce((sum, s) => sum + safeNumber(s.itemCount), 0);
  const refunds = voided.reduce((sum, s) => sum + safeNumber(s.grandTotal), 0);

  /* Order type: prefer the value stored on the sale; fall back to the order
     record for sales written before v5.1.9 added the field. */
  const needsOrder = countable.some((sale) => !sale.orderType);
  const orderTypes = new Map<string, OrderType>();
  if (needsOrder) {
    const orders = await ordersRepository.list();
    for (const order of orders) orderTypes.set(order.id, order.orderType);
  }

  const paymentTotals = new Map<PaymentMethod, ReportBucket>();
  for (const method of ['cash', 'card', 'digital', 'other'] as PaymentMethod[]) {
    paymentTotals.set(method, {
      label: PAYMENT_LABELS[method],
      amount: 0,
      orderCount: 0,
    });
  }

  const typeTotals = new Map<OrderType, ReportBucket>();
  for (const type of ['dine-in', 'takeaway', 'delivery'] as OrderType[]) {
    typeTotals.set(type, {
      label: ORDER_TYPE_LABELS[type],
      amount: 0,
      orderCount: 0,
    });
  }

  const dayTotals = new Map<string, ReportBucket>();
  for (const day of eachDay(from, to)) {
    dayTotals.set(day, { date: day, label: dayLabel(day), amount: 0, orderCount: 0 });
  }

  const hourTotals = new Map<number, ReportBucket>();
  for (let hour = 0; hour < 24; hour += 1) {
    hourTotals.set(hour, {
      label: `${String(hour).padStart(2, '0')}:00`,
      amount: 0,
      orderCount: 0,
    });
  }

  for (const sale of countable) {
    const amount = safeNumber(sale.grandTotal);

    const method = paymentTotals.get(sale.paymentMethod) ?? paymentTotals.get('other');
    if (method) {
      method.amount += amount;
      method.orderCount += 1;
    }

    const type = sale.orderType ?? orderTypes.get(sale.orderId) ?? 'takeaway';
    const typeBucket = typeTotals.get(type);
    if (typeBucket) {
      typeBucket.amount += amount;
      typeBucket.orderCount += 1;
    }

    const dayBucket = dayTotals.get(sale.businessDate);
    if (dayBucket) {
      dayBucket.amount += amount;
      dayBucket.orderCount += 1;
    }

    const completed = new Date(sale.completedAt);
    if (Number.isFinite(completed.getTime())) {
      const hourBucket = hourTotals.get(completed.getHours());
      if (hourBucket) {
        hourBucket.amount += amount;
        hourBucket.orderCount += 1;
      }
    }
  }

  /* Product and category performance, from the actual order lines of the
     countable sales in range. One read of the order-item store, grouped in
     memory: for a single restaurant this is the cheapest correct join. */
  const inRangeOrderIds = new Set(countable.map((sale) => sale.orderId));
  const [allItems, menuItems] = await Promise.all([
    orderItemsRepository.list(),
    menuItemsRepository.list(),
  ]);

  const categoryByItem = new Map<string, string>();
  for (const item of menuItems) {
    categoryByItem.set(item.id, item.category?.trim() || 'Uncategorised');
  }

  const productTotals = new Map<string, ProductPerformance>();
  const categoryTotals = new Map<string, ProductPerformance>();

  for (const line of allItems) {
    if (!inRangeOrderIds.has(line.orderId)) continue;
    const quantity = safeNumber(line.quantity);
    if (quantity <= 0) continue;
    const amount =
      safeNumber(line.lineTotal) + safeNumber(line.discount);

    const productKey = line.name.trim() || 'Unnamed item';
    const product = productTotals.get(productKey) ?? {
      name: productKey,
      quantity: 0,
      amount: 0,
    };
    product.quantity += quantity;
    product.amount += amount;
    productTotals.set(productKey, product);

    const category =
      (line.menuItemId ? categoryByItem.get(line.menuItemId) : undefined) ??
      'Uncategorised';
    const categoryEntry = categoryTotals.get(category) ?? {
      name: category,
      quantity: 0,
      amount: 0,
    };
    categoryEntry.quantity += quantity;
    categoryEntry.amount += amount;
    categoryTotals.set(category, categoryEntry);
  }

  const topProducts = [...productTotals.values()]
    .sort((a, b) => b.quantity - a.quantity || b.amount - a.amount)
    .slice(0, 10);
  const topCategories = [...categoryTotals.values()]
    .sort((a, b) => b.amount - a.amount || b.quantity - a.quantity)
    .slice(0, 8);

  return {
    from,
    to,
    grossSales,
    netSales,
    discounts,
    taxTotal,
    refunds,
    refundCount: voided.length,
    orderCount: countable.length,
    itemCount,
    averageOrder: countable.length > 0 ? Math.round(netSales / countable.length) : 0,
    byPayment: [...paymentTotals.values()],
    byOrderType: [...typeTotals.values()],
    byDay: [...dayTotals.values()],
    byHour: [...hourTotals.values()],
    topProducts,
    topCategories,
    sales: [...countable].sort((a, b) =>
      b.completedAt.localeCompare(a.completedAt),
    ),
  };
}

export const salesService = {
  dateKey,
  startOfWeek,
  startOfMonth,

  report: buildReport,
  resolvePresetRange,
  REPORT_PRESETS,

  /** Every countable sale record. */
  async allSales(): Promise<SaleRecord[]> {
    const sales = await salesRepository.list();
    return sales.filter(isCountable);
  },

  /**
   * Daily, weekly and monthly figures plus a per-day breakdown of the
   * current week. `now` is injectable so the calculation is testable.
   */
  async overview(now: Date = new Date()): Promise<SalesOverview> {
    const all = await salesRepository.list();
    // Totals use only countable sales; `all` (including cancelled) feeds
    // the history list so a cancelled order stays visible but flagged.
    const sales = all.filter(isCountable);

    const todayKey = dateKey(now);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    const weekKey = dateKey(weekStart);

    const today = summarise('today', 'Today', sales, todayKey, todayKey);
    const week = summarise(
      'week',
      'This week',
      sales,
      dateKey(weekStart),
      todayKey,
    );
    const month = summarise(
      'month',
      'This month',
      sales,
      dateKey(monthStart),
      todayKey,
    );

    // Per-day totals for the current week, including days with no sales so
    // the chart shows a real, gap-free week rather than only busy days.
    const weekDays: DayPoint[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(weekStart, i);
      const key = dateKey(day);
      const daySales = sales.filter((s) => s.businessDate === key);
      weekDays.push({
        date: key,
        label: WEEKDAY_LABELS[i] ?? '',
        total: daySales.reduce((sum, s) => sum + safeNumber(s.grandTotal), 0),
        orderCount: daySales.length,
        isToday: key === todayKey,
      });
    }

    // Cash flow: actual post-discount amounts per payment method, from
    // completed sales only (cancelled/refunded rows never contribute).
    const paymentFlow: PaymentFlow = {
      today: emptyFlow(),
      week: emptyFlow(),
      all: emptyFlow(),
    };
    for (const sale of sales) {
      const amount = safeNumber(sale.grandTotal);
      addToFlow(paymentFlow.all, sale.paymentMethod, amount);
      if (sale.businessDate === todayKey) {
        addToFlow(paymentFlow.today, sale.paymentMethod, amount);
      }
      if (sale.businessDate >= weekKey) {
        addToFlow(paymentFlow.week, sale.paymentMethod, amount);
      }
    }

    const recent = [...all]
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .slice(0, 10);

    return {
      today,
      week,
      month,
      weekDays,
      paymentFlow,
      recent,
      isEmpty: all.length === 0,
    };
  },
};
