/** Operating expenses, persisted in the existing IndexedDB architecture. */
import { expensesRepository } from '@/data/repositories';
import type { ExpenseRecord, PaymentMethod } from '@/types/domain';
import type { ID, Paisa } from '@/types/common';
import { assertPaisa, assertText, ValidationError } from '@/utils/validate';
import { PAYMENT_METHOD_OPTIONS } from '@/utils/payment';

export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries', 'Utilities', 'Ingredients', 'Maintenance',
  'Delivery', 'Marketing', 'Miscellaneous',
] as const;
export const EXPENSE_PAGE_SIZE = 12;
export const EXPENSE_GUIDE_KEY = 'expenses.guide.v6.1.0';
export interface ExpenseInput {
  title: string;
  description?: string;
  category: string;
  amount: Paisa;
  expenseDate: string;
  paymentMethod: PaymentMethod;
  payee?: string;
  reference?: string;
  notes?: string;
}
export interface ExpenseFilters {
  from?: string;
  to?: string;
  category?: string;
  query?: string;
  direction?: 'newest' | 'oldest' | 'amount-high' | 'amount-low';
}

/** Reject impossible calendar dates rather than normalising 31 February. */
export function isExpenseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validate(input: ExpenseInput): Omit<ExpenseRecord, 'id' | 'createdAt' | 'updatedAt'> {
  const amount = assertPaisa(input.amount, 'Expense amount');
  if (amount === 0) throw new ValidationError('Expense amount must be greater than zero.');
  if (!isExpenseDate(input.expenseDate)) throw new ValidationError('Enter a valid expense date.');
  if (!PAYMENT_METHOD_OPTIONS.some((option) => option.value === input.paymentMethod)) {
    throw new ValidationError('Choose a supported payment method.');
  }
  return {
    title: assertText(input.title, 'Expense title', { max: 120 }),
    description: assertText(input.description ?? '', 'Description', { min: 0, max: 500 }),
    category: assertText(input.category, 'Category', { max: 60 }),
    amount, expenseDate: input.expenseDate, paymentMethod: input.paymentMethod,
    payee: assertText(input.payee ?? '', 'Payee', { min: 0, max: 120 }),
    reference: assertText(input.reference ?? '', 'Reference', { min: 0, max: 80 }),
    notes: assertText(input.notes ?? '', 'Notes', { min: 0, max: 1000 }),
    deletedAt: null,
  };
}

export function filterExpenses(records: readonly ExpenseRecord[], filters: ExpenseFilters): ExpenseRecord[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? '';
  return records.filter((row) => !row.deletedAt &&
    (!filters.from || row.expenseDate >= filters.from) &&
    (!filters.to || row.expenseDate <= filters.to) &&
    (!filters.category || row.category === filters.category) &&
    (!query || [row.title, row.description, row.category, row.payee, row.reference, row.notes]
      .some((value) => value.toLocaleLowerCase().includes(query))))
    .sort((a, b) => {
      if (filters.direction === 'amount-high') return b.amount - a.amount || b.id.localeCompare(a.id);
      if (filters.direction === 'amount-low') return a.amount - b.amount || a.id.localeCompare(b.id);
      const order = Date.parse(a.expenseDate) - Date.parse(b.expenseDate) || a.id.localeCompare(b.id);
      return filters.direction === 'oldest' ? order : -order;
    });
}

export const expenseService = {
  async list(filters: ExpenseFilters = {}): Promise<ExpenseRecord[]> {
    return filterExpenses(await expensesRepository.list(), filters);
  },
  async categories(): Promise<string[]> {
    const records = await expensesRepository.list();
    return [...new Set([...EXPENSE_CATEGORIES, ...records.map((row) => row.category)])].sort((a, b) => a.localeCompare(b));
  },
  async create(input: ExpenseInput): Promise<ExpenseRecord> {
    return expensesRepository.create(validate(input));
  },
  async update(id: ID, input: ExpenseInput): Promise<ExpenseRecord> {
    const current = await expensesRepository.getById(id);
    if (!current || current.deletedAt) throw new ValidationError('This expense no longer exists. Refresh the list.');
    return expensesRepository.update(id, validate(input));
  },
  /** Soft deletion preserves the backup/sync tombstone and prevents resurrection by an older merge. */
  async remove(id: ID): Promise<void> {
    const current = await expensesRepository.getById(id);
    if (!current || current.deletedAt) throw new ValidationError('This expense no longer exists.');
    await expensesRepository.remove(id);
  },
};
