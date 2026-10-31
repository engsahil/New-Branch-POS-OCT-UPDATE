/** Dedicated business reporting. Reads existing records; never invents data.
 * Sales remains the transaction workspace. This service adds period comparison,
 * status/tax summaries and report exports without changing checkout rules.
 */
import { ordersRepository, salesRepository } from '@/data/repositories';
import type { OrderStatus, SaleRecord } from '@/types/domain';
import type { Paisa } from '@/types/common';
import { downloadCsv, fileStamp, type CsvCell } from '@/utils/csv';
import { dateKey, salesService, startOfMonth, startOfWeek, type DateRange, type ReportBucket, type SalesReport } from './salesService';

export type ReportingPreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'this-year' | 'last-year' | 'custom';
export type ReportGrouping = 'day' | 'week' | 'month' | 'year';
export const REPORTING_PRESETS: { id: ReportingPreset; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' }, { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' }, { id: 'last-month', label: 'Last month' },
  { id: 'this-year', label: 'This year' }, { id: 'last-year', label: 'Last year' },
  { id: 'custom', label: 'Custom range' },
];
export interface StatusSummary { status: OrderStatus; label: string; count: number; amount: Paisa }
export interface TaxSummary { label: string; count: number; taxable: Paisa; tax: Paisa }
export interface AnalyticsReport {
  range: DateRange;
  current: SalesReport;
  previous: { range: DateRange; netSales: Paisa; orderCount: Paisa; averageOrder: Paisa } | null;
  netChangePercent: number | null;
  orderChangePercent: number | null;
  statuses: StatusSummary[];
  taxSummary: TaxSummary[];
  /** Adaptive chart buckets; the table can use a finer grouping. */
  chartTrend: ReportBucket[];
  grouping: ReportGrouping;
  trend: ReportBucket[];
}
function addDays(date: Date, days: number): Date { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && dateKey(date) === value;
}
export function assertReportRange(range: DateRange): void {
  if (!validDate(range.from) || !validDate(range.to) || range.from > range.to) throw new Error('Choose a valid start and end date.');
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  if (days > 3660) throw new Error('Choose a reporting range of ten years or less.');
}
export function resolveReportingPreset(preset: ReportingPreset, now = new Date()): DateRange {
  const today = dateKey(now);
  switch (preset) {
    case 'yesterday': { const key = dateKey(addDays(now, -1)); return { from: key, to: key }; }
    case 'this-week': return { from: dateKey(startOfWeek(now)), to: today };
    case 'last-week': { const start = addDays(startOfWeek(now), -7); return { from: dateKey(start), to: dateKey(addDays(start, 6)) }; }
    case 'this-month': return { from: dateKey(startOfMonth(now)), to: today };
    case 'last-month': return { from: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case 'this-year': return { from: `${now.getFullYear()}-01-01`, to: today };
    case 'last-year': return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` };
    default: return { from: today, to: today };
  }
}
export function previousReportRange(range: DateRange): DateRange {
  assertReportRange(range);
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  return { from: dateKey(addDays(start, -days)), to: dateKey(addDays(end, -days)) };
}
function bucketKey(day: string, grouping: ReportGrouping): string {
  const date = new Date(`${day}T00:00:00`);
  if (grouping === 'week') return dateKey(startOfWeek(date));
  if (grouping === 'month') return day.slice(0, 7);
  if (grouping === 'year') return day.slice(0, 4);
  return day;
}
export function groupReportDays(days: readonly ReportBucket[], grouping: ReportGrouping): ReportBucket[] {
  const buckets = new Map<string, ReportBucket>();
  for (const day of days) {
    if (!day.date) continue;
    const key = bucketKey(day.date, grouping);
    const label = grouping === 'week' ? `Week of ${key}` : key;
    const bucket = buckets.get(key) ?? { date: key, label, amount: 0, orderCount: 0 };
    bucket.amount += day.amount; bucket.orderCount += day.orderCount;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}
function adaptiveGrouping(range: DateRange): ReportGrouping {
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  return days <= 31 ? 'day' : days <= 120 ? 'week' : days <= 1100 ? 'month' : 'year';
}
function change(current: number, previous: number): number | null { return previous > 0 ? (current - previous) / previous * 100 : null; }
const STATUS_LABELS: Record<OrderStatus, string> = { completed: 'Completed', cancelled: 'Cancelled', refunded: 'Refunded', draft: 'Draft', held: 'Held' };

export async function buildAnalyticsReport(range: DateRange, grouping: ReportGrouping = 'day', compare = true): Promise<AnalyticsReport> {
  assertReportRange(range);
  const previousRange = compare ? previousReportRange(range) : null;
  const [current, previous, orders, sales] = await Promise.all([
    salesService.report(range), previousRange ? salesService.report(previousRange) : Promise.resolve(null),
    ordersRepository.list(), salesRepository.list(),
  ]);
  const saleByOrder = new Map<string, SaleRecord>(sales.map((sale) => [sale.orderId, sale]));
  const statuses = new Map<OrderStatus, StatusSummary>(['completed', 'cancelled', 'refunded', 'draft', 'held'].map((status) => [status as OrderStatus, { status: status as OrderStatus, label: STATUS_LABELS[status as OrderStatus], count: 0, amount: 0 }]));
  for (const order of orders) {
    const sale = saleByOrder.get(order.id);
    const day = sale?.businessDate ?? dateKey(new Date(order.completedAt ?? order.createdAt));
    if (day < range.from || day > range.to) continue;
    const bucket = statuses.get(order.status);
    if (!bucket) continue;
    bucket.count += 1; bucket.amount += order.grandTotal;
  }
  const taxSummary: TaxSummary[] = [
    { label: 'Tax added at checkout', count: 0, taxable: 0, tax: 0 },
    { label: 'Tax included in prices', count: 0, taxable: 0, tax: 0 },
    { label: 'Historical mode not recorded', count: 0, taxable: 0, tax: 0 },
  ];
  for (const sale of current.sales) {
    const bucket = taxSummary[sale.taxInclusive === true ? 1 : sale.taxInclusive === false ? 0 : 2]!;
    bucket.count += 1; bucket.tax += sale.taxTotal; bucket.taxable += sale.grandTotal - sale.taxTotal;
  }
  return {
    range, current,
    previous: previous && previousRange ? { range: previousRange, netSales: previous.netSales, orderCount: previous.orderCount, averageOrder: previous.averageOrder } : null,
    netChangePercent: previous ? change(current.netSales, previous.netSales) : null,
    orderChangePercent: previous ? change(current.orderCount, previous.orderCount) : null,
    statuses: [...statuses.values()], taxSummary,
    chartTrend: groupReportDays(current.byDay, adaptiveGrouping(range)),
    grouping, trend: groupReportDays(current.byDay, grouping),
  };
}
const money = (value: Paisa): string => (value / 100).toFixed(2);
export function analyticsCsvRows(report: AnalyticsReport): CsvCell[][] {
  const c = report.current;
  return [
    ['Business performance report'], ['From', report.range.from], ['To', report.range.to],
    ['Basis', 'Completed non-refunded sales; amounts in PKR; charged totals include stored tax. Product/category amounts are gross merchandise before order-level discount and tax. Categories use the current menu catalogue.'], [],
    ['Metric', 'Value'], ['Charged sales', money(c.netSales)], ['Revenue excluding stored tax', money(c.netSales - c.taxTotal)],
    ['Orders', c.orderCount], ['Average order', money(c.averageOrder)], ['Items sold', c.itemCount],
    ['Gross merchandise', money(c.grossSales)], ['Discounts', money(c.discounts)], ['Stored tax', money(c.taxTotal)],
    ['Refunded/cancelled original value', money(c.refunds)], ['Refunded/cancelled orders', c.refundCount], [],
    ['Period', 'Orders', 'Charged sales'], ...report.trend.map((row) => [row.date ?? row.label, row.orderCount, money(row.amount)]), [],
    ['Payment method', 'Orders', 'Charged sales'], ...c.byPayment.map((row) => [row.label, row.orderCount, money(row.amount)]), [],
    ['Order type', 'Orders', 'Charged sales'], ...c.byOrderType.map((row) => [row.label, row.orderCount, money(row.amount)]), [],
    ['Order status', 'Orders', 'Original order value'], ...report.statuses.map((row) => [row.label, row.count, money(row.amount)]), [],
    ['Tax basis', 'Orders', 'Stored tax'], ...report.taxSummary.map((row) => [row.label, row.count, money(row.tax)]), [],
    ['Best-selling product', 'Units', 'Gross merchandise'], ...c.topProducts.map((row) => [row.name, row.quantity, money(row.amount)]), [],
    ['Current menu category', 'Units', 'Gross merchandise'], ...c.topCategories.map((row) => [row.name, row.quantity, money(row.amount)]),
  ];
}
export function exportAnalyticsReport(report: AnalyticsReport): void {
  downloadCsv(`business-report-${report.range.from}-to-${report.range.to}-${fileStamp()}.csv`, analyticsCsvRows(report));
}
export const reportingService = { report: buildAnalyticsReport, resolvePreset: resolveReportingPreset, exportCsv: exportAnalyticsReport };
