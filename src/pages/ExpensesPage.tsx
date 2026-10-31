import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExpenseForm } from '@/components/expenses/ExpenseForm';
import { Button, EmptyState, Input } from '@/components/ui';
import { DownloadIcon, PlusIcon, ReportsIcon } from '@/components/ui/Icons';
import { CHART_COLORS, DonutChart } from '@/components/charts/Charts';
import { FinanceTrend } from '@/components/charts/FinanceTrend';
import { expenseService, EXPENSE_CATEGORIES, EXPENSE_GUIDE_KEY, EXPENSE_PAGE_SIZE, filterExpenses, type ExpenseFilters } from '@/services/expenseService';
import { financeService, type FinanceReport } from '@/services/financeService';
import { REPORT_PRESETS, dateKey, resolvePresetRange, type DateRange, type ReportPreset } from '@/services/salesService';
import { settingsService } from '@/services/settingsService';
import type { ExpenseRecord } from '@/types/domain';
import { formatMoney } from '@/utils/currency';
import { formatDate } from '@/utils/date';
import { formatPaymentMethod } from '@/utils/payment';
import { downloadCsv, fileStamp } from '@/utils/csv';
import { paginate } from '@/utils/pagination';
import styles from './ExpensesPage.module.css';

const unavailable = 'Unavailable';
export default function ExpensesPage() {
  const [range, setRange] = useState<DateRange>(() => resolvePresetRange('this-month'));
  const [preset, setPreset] = useState<ReportPreset>('this-month');
  const [customFrom, setCustomFrom] = useState(dateKey(new Date()));
  const [customTo, setCustomTo] = useState(dateKey(new Date()));
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [categories, setCategories] = useState<string[]>([...EXPENSE_CATEGORIES]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [guide, setGuide] = useState(false);
  const [guideError, setGuideError] = useState('');
  const [form, setForm] = useState<{ record?: ExpenseRecord } | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState('');
  const [direction, setDirection] = useState<NonNullable<ExpenseFilters['direction']>>('newest');
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const formRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError('');
    try {
      const [nextReport, nextRecords, nextCategories] = await Promise.all([
        financeService.report(range), expenseService.list(), expenseService.categories(),
      ]);
      if (sequence === request.current) { setReport(nextReport); setRecords(nextRecords); setCategories(nextCategories); }
    } catch {
      if (sequence === request.current) setError('Financial records could not be loaded. Existing values may be out of date; retry before making decisions.');
    } finally { if (sequence === request.current) setLoading(false); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    void settingsService.get<boolean>(EXPENSE_GUIDE_KEY, false)
      .then((done) => { if (active) setGuide(!done); })
      .catch(() => { if (active) setGuide(true); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => filterExpenses(records, {
    ...range, query: deferredQuery, category, direction,
  }), [records, range, deferredQuery, category, direction]);
  const pagination = paginate(filtered, page, EXPENSE_PAGE_SIZE);
  useEffect(() => { if (page !== pagination.page) setPage(pagination.page); }, [page, pagination.page]);
  useEffect(() => { setPage(1); }, [range, deferredQuery, category, direction]);
  const filteredTotal = filtered.reduce((sum, row) => sum + row.amount, 0);

  async function dismissGuide() {
    try { await settingsService.set(EXPENSE_GUIDE_KEY, true); setGuide(false); setGuideError(''); }
    catch { setGuideError('Could not save guide completion. Please retry.'); }
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await expenseService.remove(id); setConfirmDelete(null); setNotice('Expense deleted. It is excluded from financial totals.'); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not delete expense.'); }
    finally { setBusy(false); }
  }
  function openForm(record?: ExpenseRecord) {
    setForm({ record });
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }
  function choosePeriod(next: ReportPreset) {
    setPreset(next);
    if (next !== 'custom') setRange(resolvePresetRange(next));
  }
  function exportReport() {
    if (!report) return;
    downloadCsv(`expense-profit-${range.from}-${range.to}-${fileStamp()}.csv`, [
      ['Expense & Profit Tracking', 'Estimated operating report; not audited accounts'],
      ['From', report.from, 'To', report.to],
      ['Net sales (amount charged, incl. tax)', (report.netSales / 100).toFixed(2)],
      ['Sales revenue (excl. tax)', (report.revenue / 100).toFixed(2)],
      ['Operating expenses', (report.operatingExpenses / 100).toFixed(2)],
      ['COGS (complete snapshots only)', report.cogs === null ? unavailable : (report.cogs / 100).toFixed(2)],
      ['Estimated operating profit', report.operatingProfit === null ? unavailable : (report.operatingProfit / 100).toFixed(2)],
      ['Known-cost coverage (%)', (report.costCoverage * 100).toFixed(1)],
      ['Stock purchases (excluded from profit)', (report.purchaseSpend / 100).toFixed(2)], [],
      ['Date', 'Title', 'Category', 'Amount', 'Payment', 'Payee', 'Reference', 'Description', 'Notes'],
      ...[...report.expenses].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.id.localeCompare(b.id)).map((row) =>
        [row.expenseDate, row.title, row.category, (row.amount / 100).toFixed(2), formatPaymentMethod(row.paymentMethod), row.payee, row.reference, row.description, row.notes]),
    ]);
  }

  return <div className="page">
    <PageHeader title="Expense & Profit Tracking" subtitle="Operating costs, sales and transparent profit estimates." actions={<>
      <Button variant="secondary" size="sm" onClick={() => setGuide(true)}>Quick guide</Button>
      <Button size="sm" leadingIcon={<PlusIcon width={16} height={16} />} onClick={() => openForm()}>Record expense</Button>
    </>} />
    {guide ? <section className={styles.guide} aria-labelledby="expense-guide-title">
      <div><span className={styles.eyebrow}>NEW IN VERSION 6.1.0</span><h2 id="expense-guide-title">Understand where your sales go</h2></div>
      <p>Record operating expenses and review sales, expense and profit trends. Profit figures depend on the completeness of your sales, inventory-cost and expense data.</p>
      <ol><li>Record an expense with its date, category and amount.</li><li>Select a reporting period; cards, graphs and the period report use the same dates.</li><li>Compare sales revenue (excluding tax) with operating expenses and read the category breakdown.</li><li>Profit is estimated only when every sold unit has a complete cost snapshot. Missing costs show “Unavailable”, never zero.</li><li>Search the expense ledger below and open any record to edit it. Stock purchases are shown separately.</li></ol>
      <Button size="sm" onClick={() => void dismissGuide()}>Got it — don’t show again</Button>
      {guideError ? <p role="alert">{guideError}</p> : null}
    </section> : null}
    <div ref={formRef}>{form ? <ExpenseForm key={form.record?.id ?? 'new'} record={form.record} categories={categories} onCancel={() => setForm(null)} onSaved={() => { setForm(null); setNotice('Expense saved. Financial totals have been updated.'); void load(); }} /> : null}</div>
    <section className={styles.filters} aria-label="Reporting period">
      <div className={styles.presets}>{REPORT_PRESETS.map((option) => <button type="button" key={option.id} className={preset === option.id ? styles.activePreset : styles.preset} aria-pressed={preset === option.id} onClick={() => choosePeriod(option.id)}>{option.label}</button>)}</div>
      {preset === 'custom' ? <div className={styles.custom}><Input label="From" name="financeFrom" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /><Input label="To" name="financeTo" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /><Button variant="secondary" onClick={() => {
        if (!customFrom || !customTo || customFrom > customTo) { setError('Choose a valid start and end date.'); return; }
        setRange({ from: customFrom, to: customTo });
      }}>Apply</Button></div> : <span className={styles.hint}>{formatDate(`${range.from}T12:00:00`)} – {formatDate(`${range.to}T12:00:00`)}</span>}
      <Button variant="secondary" size="sm" onClick={exportReport} disabled={!report || loading || Boolean(error)} leadingIcon={<DownloadIcon width={15} height={15} />}>Export period report</Button>
    </section>
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {error ? <div className={styles.error} role="alert">{error} <Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button></div> : null}
    {loading && !report ? <p className={styles.hint} role="status">Loading financial records…</p> : null}
    {report ? <div className={styles.content} aria-busy={loading}>
      <section className={styles.kpis} aria-label="Financial summary">
        {[
          ['Net sales', formatMoney(report.netSales), 'Charged after discounts, including tax'],
          ['Sales revenue', formatMoney(report.revenue), 'Net sales minus stored tax'],
          ['Operating expenses', formatMoney(report.operatingExpenses), `${report.expenseCount} expense records`],
          ['Estimated COGS', report.cogs === null ? unavailable : formatMoney(report.cogs), `${Math.round(report.costCoverage * 100)}% of sold units have known costs`],
          ['Gross profit', report.grossProfit === null ? unavailable : formatMoney(report.grossProfit), 'Sales revenue − complete COGS'],
          ['Est. operating profit', report.operatingProfit === null ? unavailable : formatMoney(report.operatingProfit), 'Gross profit − operating expenses'],
          ['Operating margin', report.profitMargin === null ? unavailable : `${report.profitMargin.toFixed(1)}%`, 'Operating profit ÷ revenue; revenue must be positive'],
          ['Discounts', formatMoney(report.discounts), 'Item and order discounts on counted sales'],
        ].map(([label, value, hint]) => <article className={styles.kpi} key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}
      </section>
      {report.cogs === null ? <p className={styles.warning}>Profit is unavailable: {report.missingCostUnits} sold unit(s) across {report.missingCostOrders} order(s) lack complete portion or modifier costs. Older sales do not have cost snapshots. Enter known costs in Menu and modifier settings for future sales; historical profit is not invented.</p> : <p className={styles.hint}>COGS uses costs saved at checkout, including known modifier and deal-component costs. These are estimated portion costs, not a physical stock count or an audited inventory-costing method.</p>}
      <div className={styles.chartGrid}>
        <section className={styles.card}><h2>Sales revenue vs operating expenses</h2><p className={styles.hint}>Daily totals · revenue excludes tax · selected period</p><FinanceTrend rows={report.byDay} /></section>
        <section className={styles.card}><h2>Expenses by category</h2><DonutChart slices={report.byCategory.map((entry, index) => ({ label: entry.category, value: entry.amount, color: CHART_COLORS[index % CHART_COLORS.length]! }))} centreValue={formatMoney(report.operatingExpenses, { withSymbol: false })} centreLabel="expenses" formatValue={(value) => formatMoney(value, { withSymbol: false })} summary={report.byCategory.map((entry) => `${entry.category}: ${formatMoney(entry.amount)}`).join('; ') || 'No expenses in this period'} /></section>
      </div>
      <section className={styles.card}><h2>Profit trend</h2><p className={styles.hint}>Estimated operating profit by day. Days with missing costs are gaps, not zero-profit days.</p><FinanceTrend rows={report.byDay} profit /></section>
      <details className={styles.definitions}><summary>Calculations, scope and cash-flow differences</summary><dl>
        <dt>Gross sales</dt><dd>{formatMoney(report.grossSales)} before discounts and exclusive tax, matching Sales.</dd>
        <dt>Net sales / revenue</dt><dd>Net sales is the amount charged after discounts, including stored tax. Sales revenue subtracts that tax before calculating profit. Tax is not income.</dd>
        <dt>Cancelled / refunded orders</dt><dd>{report.refundCount} fully voided/refunded orders ({formatMoney(report.refunds)}) are excluded from revenue and COGS. Quantity corrections use the corrected saved amount; separate partial-refund records are not supported.</dd>
        <dt>Operating expenses</dt><dd>Non-deleted expenses whose local expense date falls in the selected period. No payments, payroll accruals or depreciation are inferred.</dd>
        <dt>Stock purchases</dt><dd>{formatMoney(report.purchaseSpend)} of positive stock receipts with known costs; {report.unknownPurchaseCostCount} more lack a cost. Buying stock is not consuming it. Purchases are excluded from both operating expenses and COGS to avoid double counting.</dd>
        <dt>Limitations</dt><dd>This is an operating-profit estimate, not cash flow or audited accounting. Ingredient usage without portion costs, unpaid bills, asset depreciation and owner drawings are not inferred. Do not record the same stock purchase again as an expense.</dd>
      </dl></details>
      <section className={styles.ledger} aria-labelledby="expense-ledger-title">
        <div className={styles.ledgerHead}><h2 id="expense-ledger-title">Expense records</h2><span className={styles.hint}>{filtered.length} records · {formatMoney(filteredTotal)}</span></div>
        <div className={styles.tableFilters}>
          <Input label="Search expenses" name="expenseSearch" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, payee, reference or notes" fullWidth />
          <label className={styles.field}>Category<select name="expenseCategoryFilter" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className={styles.field}>Sort<select name="expenseSort" value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="newest">Newest date</option><option value="oldest">Oldest date</option><option value="amount-high">Amount: high to low</option><option value="amount-low">Amount: low to high</option></select></label>
        </div>
        {filtered.length === 0 ? <EmptyState icon={<ReportsIcon />} title="No expenses in this view" description="Choose another period or record an operating expense. No sample transactions have been added." action={<Button variant="secondary" onClick={() => openForm()}>Record expense</Button>} /> : <div className={styles.tableScroll} ref={tableRef} tabIndex={0} aria-label="Scrollable expense records"><table className={styles.table}>
          <thead><tr><th>Date / title</th><th>Category</th><th>Payment / payee</th><th className={styles.amount}>Amount</th><th>Actions</th></tr></thead>
          <tbody>{pagination.pageRows.map((row) => <tr key={row.id}>
            <td><strong>{row.title}</strong><small>{row.expenseDate}</small>{row.reference ? <small>Ref: {row.reference}</small> : null}{row.description ? <small>{row.description}</small> : null}{row.notes ? <small>{row.notes}</small> : null}</td>
            <td>{row.category}</td><td>{formatPaymentMethod(row.paymentMethod)}<small>{row.payee || 'No payee recorded'}</small></td><td className={styles.amount}>{formatMoney(row.amount)}</td>
            <td>{confirmDelete === row.id ? <div className={styles.rowActions}><span>Delete this expense?</span><Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(row.id)}>{busy ? 'Deleting…' : 'Confirm delete'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(null)}>Keep</Button></div> : <div className={styles.rowActions}><Button size="sm" variant="secondary" onClick={() => openForm(row)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDelete(row.id)}>Delete</Button></div>}</td>
          </tr>)}</tbody>
        </table></div>}
        <div className={styles.pagination}><Button size="sm" variant="ghost" disabled={pagination.page <= 1} onClick={() => { setPage(pagination.page - 1); tableRef.current?.scrollTo({ top: 0 }); }}>Previous</Button><span>Page {pagination.page} of {pagination.pageCount} · {pagination.first}–{pagination.last} of {pagination.total}</span><Button size="sm" variant="ghost" disabled={pagination.page >= pagination.pageCount} onClick={() => { setPage(pagination.page + 1); tableRef.current?.scrollTo({ top: 0 }); }}>Next</Button></div>
      </section>
    </div> : null}
  </div>;
}

