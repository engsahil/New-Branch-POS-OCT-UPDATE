import { useState, type FormEvent } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { PriceInput } from '@/components/admin/PriceInput';
import { CURRENCY } from '@/config/app.config';
import { expenseService, type ExpenseInput } from '@/services/expenseService';
import { dateKey } from '@/services/salesService';
import type { ExpenseRecord, PaymentMethod } from '@/types/domain';
import type { Paisa } from '@/types/common';
import { PAYMENT_METHOD_OPTIONS } from '@/utils/payment';
import styles from './ExpenseForm.module.css';

export function ExpenseForm({ record, categories, onSaved, onCancel }: {
  record?: ExpenseRecord; categories: string[]; onSaved: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(record?.title ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [category, setCategory] = useState(record?.category ?? 'Miscellaneous');
  const [amount, setAmount] = useState<Paisa | null>(record?.amount ?? null);
  const [expenseDate, setExpenseDate] = useState(record?.expenseDate ?? dateKey(new Date()));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(record?.paymentMethod ?? 'cash');
  const [payee, setPayee] = useState(record?.payee ?? '');
  const [reference, setReference] = useState(record?.reference ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(''); setSaving(true);
    try {
      const input: ExpenseInput = { title, description, category, amount: amount ?? 0,
        expenseDate, paymentMethod, payee, reference, notes };
      if (record) await expenseService.update(record.id, input);
      else await expenseService.create(input);
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The expense could not be saved.');
    } finally { setSaving(false); }
  }
  return <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={record ? 'Edit expense' : 'Record expense'}>
    <h2>{record ? 'Edit expense' : 'Record an expense'}</h2>
    <p className={styles.hint}>Record operating costs here. Stock received through Purchases is already tracked separately; do not enter it again as an ingredient expense. Amounts use {CURRENCY.code}.</p>
    <div className={styles.grid}>
      <Input label="Expense title" name="expenseTitle" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} fullWidth />
      <Input label="Category" name="expenseCategory" list="expense-categories" value={category} onChange={(event) => setCategory(event.target.value)} required maxLength={60} hint="Choose a suggestion or type your own category." fullWidth />
      <datalist id="expense-categories">{categories.map((value) => <option key={value} value={value} />)}</datalist>
      <PriceInput label={`Amount (${CURRENCY.symbol})`} name="expenseAmount" value={amount} onChange={setAmount} disabled={saving} />
      <Input label="Expense date" name="expenseDate" type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required fullWidth />
      <label className={styles.field}>Payment method
        <select name="expensePayment" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} disabled={saving}>
          {PAYMENT_METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <Input label="Supplier / payee (optional)" name="expensePayee" value={payee} onChange={(event) => setPayee(event.target.value)} maxLength={120} fullWidth />
      <Input label="Reference (optional)" name="expenseReference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={80} fullWidth />
      <Input label="Description (optional)" name="expenseDescription" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} fullWidth />
    </div>
    <Textarea label="Notes (optional)" name="expenseNotes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={2} fullWidth />
    <p className={styles.hint}>Receipt attachments are not stored in this local-only release. Keep the original receipt and enter its reference above.</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.actions}><Button type="submit" disabled={saving}>{saving ? 'Saving…' : record ? 'Save expense' : 'Record expense'}</Button><Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button></div>
  </form>;
}
