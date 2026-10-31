/** Transparent operating-profit estimates, never audited accounts or cash flow. */
import { expensesRepository, orderItemsRepository, purchasesRepository } from '@/data/repositories';
import { salesService, dateKey, type DateRange } from './salesService';
import { isExpenseDate } from './expenseService';
import type { ExpenseRecord, PurchaseRecord, SaleRecord } from '@/types/domain';
import type { Paisa } from '@/types/common';

export interface FinanceDay {
  date: string;
  netSales: Paisa;
  /** Amount charged minus stored tax: the revenue basis for profit. */
  revenue: Paisa;
  expenses: Paisa;
  /** Null when any sold line on this day lacks a complete cost snapshot. */
  cogs: Paisa | null;
  grossProfit: Paisa | null;
  operatingProfit: Paisa | null;
}
export interface FinanceReport extends DateRange {
  grossSales: Paisa;
  netSales: Paisa;
  revenue: Paisa;
  discounts: Paisa;
  taxTotal: Paisa;
  refunds: Paisa;
  refundCount: number;
  orderCount: number;
  operatingExpenses: Paisa;
  expenseCount: number;
  cogs: Paisa | null;
  grossProfit: Paisa | null;
  operatingProfit: Paisa | null;
  profitMargin: number | null;
  /** Fraction of sold units with a complete cost snapshot (0..1). */
  costCoverage: number;
  missingCostUnits: number;
  missingCostOrders: number;
  /** Positive stock receipts with known costs; NOT expenses or COGS. */
  purchaseSpend: Paisa;
  unknownPurchaseCostCount: number;
  byCategory: { category: string; amount: Paisa; count: number }[];
  byDay: FinanceDay[];
  expenses: ExpenseRecord[];
  sales: SaleRecord[];
  purchases: PurchaseRecord[];
}

function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function validRange(range: DateRange): void {
  if (!isExpenseDate(range.from) || !isExpenseDate(range.to) || range.from > range.to) {
    throw new Error('Choose a valid start and end date.');
  }
}

export const financeService = {
  async report(range: DateRange): Promise<FinanceReport> {
    validRange(range);
    // Sales use exactly the same countability, date and rounding rules as Sales.
    const [salesReport, expenseRows, purchaseRows, lines] = await Promise.all([
      salesService.report(range), expensesRepository.list(), purchasesRepository.list(), orderItemsRepository.list(),
    ]);
    const expenses = expenseRows.filter((row) => !row.deletedAt && row.expenseDate >= range.from && row.expenseDate <= range.to);
    const purchases = purchaseRows.filter((row) => {
      const day = dateKey(new Date(row.receivedAt));
      return day >= range.from && day <= range.to;
    });
    const saleIds = new Set(salesReport.sales.map((sale) => sale.orderId));
    const costByOrder = new Map<string, { cost: number; units: number; missing: number }>();
    for (const line of lines) {
      if (!saleIds.has(line.orderId) || line.deletedAt) continue;
      const entry = costByOrder.get(line.orderId) ?? { cost: 0, units: 0, missing: 0 };
      entry.units += line.quantity;
      if (typeof line.unitCost === 'number' && Number.isFinite(line.unitCost) && line.unitCost >= 0) {
        entry.cost += line.unitCost * line.quantity;
      } else entry.missing += line.quantity;
      costByOrder.set(line.orderId, entry);
    }
    let knownCost = 0;
    let missingCostUnits = 0;
    let missingCostOrders = 0;
    for (const sale of salesReport.sales) {
      const entry = costByOrder.get(sale.orderId);
      knownCost += entry?.cost ?? 0;
      const missing = (entry?.missing ?? 0) + (!entry ? sale.itemCount : 0);
      missingCostUnits += missing;
      if (missing > 0) missingCostOrders += 1;
    }
    const operatingExpenses = sum(expenses.map((row) => row.amount));
    const revenue = salesReport.netSales - salesReport.taxTotal;
    const cogs = missingCostUnits === 0 ? knownCost : null;
    const grossProfit = cogs === null ? null : revenue - cogs;
    const operatingProfit = grossProfit === null ? null : grossProfit - operatingExpenses;
    const categories = new Map<string, { category: string; amount: number; count: number }>();
    const expensesByDay = new Map<string, number>();
    for (const expense of expenses) {
      const category = categories.get(expense.category) ?? { category: expense.category, amount: 0, count: 0 };
      category.amount += expense.amount; category.count += 1;
      categories.set(expense.category, category);
      expensesByDay.set(expense.expenseDate, (expensesByDay.get(expense.expenseDate) ?? 0) + expense.amount);
    }
    const days = [...new Set([...salesReport.byDay.map((bucket) => bucket.date!), ...expenses.map((row) => row.expenseDate)])].sort();
    const byDay: FinanceDay[] = days.map((date) => {
      const bucket = salesReport.byDay.find((entry) => entry.date === date);
      const daySales = salesReport.sales.filter((sale) => sale.businessDate === date);
      const dayRevenue = sum(daySales.map((sale) => sale.grandTotal - sale.taxTotal));
      const dayCost = daySales.reduce((total, sale) => total + (costByOrder.get(sale.orderId)?.cost ?? 0), 0);
      const complete = daySales.every((sale) => (costByOrder.get(sale.orderId)?.missing ?? 0) === 0 && costByOrder.has(sale.orderId));
      const dayCogs = complete ? dayCost : null;
      const dayExpenses = expensesByDay.get(date) ?? 0;
      return { date, netSales: bucket?.amount ?? 0, revenue: dayRevenue, expenses: dayExpenses,
        cogs: dayCogs, grossProfit: dayCogs === null ? null : dayRevenue - dayCogs,
        operatingProfit: dayCogs === null ? null : dayRevenue - dayCogs - dayExpenses };
    });
    return {
      ...range, grossSales: salesReport.grossSales, netSales: salesReport.netSales, revenue,
      discounts: salesReport.discounts, taxTotal: salesReport.taxTotal,
      refunds: salesReport.refunds, refundCount: salesReport.refundCount, orderCount: salesReport.orderCount,
      operatingExpenses, expenseCount: expenses.length, cogs, grossProfit, operatingProfit,
      profitMargin: operatingProfit !== null && revenue > 0 ? operatingProfit / revenue * 100 : null,
      costCoverage: salesReport.itemCount > 0 ? (salesReport.itemCount - missingCostUnits) / salesReport.itemCount : 1,
      missingCostUnits, missingCostOrders,
      purchaseSpend: sum(purchases.filter((row) => row.quantity > 0 && row.unitCost !== null).map((row) => Math.round(row.quantity * row.unitCost!))),
      unknownPurchaseCostCount: purchases.filter((row) => row.quantity > 0 && row.unitCost === null).length,
      byCategory: [...categories.values()].sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category)),
      byDay, expenses: expenses.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id.localeCompare(a.id)),
      sales: salesReport.sales, purchases,
    };
  },
};
