import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROUTE_PATHS } from '@/app/routes';
import { BarChart, CHART_COLORS, DonutChart, TrendChart } from '@/components/charts/Charts';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, EmptyState, Input, Spinner } from '@/components/ui';
import { DownloadIcon, ReportsIcon } from '@/components/ui/Icons';
import { subscribeSales } from '@/hooks/useSales';
import { dateKey } from '@/services/salesService';
import { REPORTING_PRESETS, reportingService, type AnalyticsReport, type ReportGrouping, type ReportingPreset } from '@/services/reportingService';
import { formatMoney } from '@/utils/currency';
import styles from './ReportsPage.module.css';

function percent(value: number | null): string {
  if (value === null) return 'No previous-period baseline';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}% vs previous period`;
}
export default function ReportsPage() {
  const [preset, setPreset] = useState<ReportingPreset>('this-month');
  const [range, setRange] = useState(() => reportingService.resolvePreset('this-month'));
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [grouping, setGrouping] = useState<ReportGrouping>('day');
  const [compare, setCompare] = useState(true);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError(null);
    try { const next = await reportingService.report(range, grouping, compare); if (sequence === request.current) setReport(next); }
    catch (err) { if (sequence === request.current) setError(err instanceof Error ? err.message : 'Reports could not be loaded.'); }
    finally { if (sequence === request.current) setLoading(false); }
  }, [range, grouping, compare]);
  useEffect(() => { void load(); return subscribeSales(() => void load()); }, [load]);
  function choose(next: ReportingPreset) {
    setPreset(next);
    if (next !== 'custom') { const bounds = reportingService.resolvePreset(next); setRange(bounds); setFrom(bounds.from); setTo(bounds.to); }
  }
  function apply() {
    if (!from || !to || from > to) { setError('Choose a valid start and end date.'); return; }
    setPreset('custom'); setRange({ from, to });
  }
  const current = report?.current;
  const revenue = current ? current.netSales - current.taxTotal : 0;
  const trendPoints = useMemo(() => report?.chartTrend.map((row) => ({ label: row.label, value: row.amount })) ?? [], [report]);
  const exportCsv = () => { if (report) reportingService.exportCsv(report); };
  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Business performance from recorded sales. Manage transactions in Sales."
        actions={<Button variant="secondary" leadingIcon={<DownloadIcon width={16} height={16} />} disabled={!report || loading} onClick={exportCsv}>Export report CSV</Button>} />
      <section className={styles.filters} aria-label="Report filters">
        <div className={styles.presets} role="group" aria-label="Reporting period">
          {REPORTING_PRESETS.map((entry) => <button key={entry.id} type="button" aria-pressed={preset === entry.id}
            className={`${styles.preset} ${preset === entry.id ? styles.active : ''}`} onClick={() => choose(entry.id)}>{entry.label}</button>)}
        </div>
        <div className={styles.controls}>
          <Input label="From" name="reportFrom" type="date" value={from} max={dateKey(new Date())} onChange={(event) => setFrom(event.target.value)} />
          <Input label="To" name="reportTo" type="date" value={to} max={dateKey(new Date())} onChange={(event) => setTo(event.target.value)} />
          <Button variant="secondary" onClick={apply}>Apply range</Button>
          <label className={styles.select}>Group table by
            <select value={grouping} onChange={(event) => setGrouping(event.target.value as ReportGrouping)}>
              <option value="day">Day</option><option value="week">Week (Monday)</option><option value="month">Month</option><option value="year">Year</option>
            </select>
          </label>
          <label className={styles.compare}><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />Compare previous period</label>
        </div>
        <p className={styles.basis}>Charged sales include stored tax. Revenue excludes stored tax. Refunded and cancelled orders are excluded from sales KPIs and shown separately. Product/category values are gross merchandise before order-level discounts and tax; categories reflect the current menu.</p>
      </section>
      {error ? <div className={styles.error} role="alert">{error} <Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button></div> : null}
      {loading && !report ? <Spinner label="Building reports" /> : null}
      {current && report ? <div className={styles.content} aria-busy={loading}>
        <div className={styles.period}><strong>{report.range.from} — {report.range.to}</strong><Link to={ROUTE_PATHS.sales}>Open Sales transactions</Link></div>
        {current.orderCount === 0 ? <EmptyState icon={<ReportsIcon />} title="No completed sales in this period" description="Choose another date range or record a sale in POS. No sample analytics are shown." /> : null}
        <section className={styles.kpis} aria-label="Sales performance overview">
          <article><span>Charged sales</span><strong>{formatMoney(current.netSales)}</strong><small>{compare ? percent(report.netChangePercent) : 'Includes stored tax'}</small></article>
          <article><span>Revenue excl. tax</span><strong>{formatMoney(revenue)}</strong><small>Charged sales minus stored tax</small></article>
          <article><span>Completed orders</span><strong>{current.orderCount}</strong><small>{compare ? percent(report.orderChangePercent) : 'Excludes refunds and cancellations'}</small></article>
          <article><span>Average order</span><strong>{formatMoney(current.averageOrder)}</strong><small>Charged sales ÷ completed orders</small></article>
          <article><span>Items sold</span><strong>{current.itemCount}</strong><small>Units on completed orders</small></article>
          <article><span>Discounts</span><strong>{formatMoney(current.discounts)}</strong><small>{current.grossSales > 0 ? `${(current.discounts / current.grossSales * 100).toFixed(1)}% of gross merchandise` : 'No gross merchandise'}</small></article>
        </section>
        {report.previous ? <p className={styles.comparison}>Comparison: {report.previous.range.from} to {report.previous.range.to} · charged sales {formatMoney(report.previous.netSales)} · {report.previous.orderCount} orders.</p> : null}
        <div className={styles.grid}>
          <section className={styles.cardWide} aria-label="Sales trend"><h2>Sales trend</h2>
            <TrendChart points={trendPoints} summary={`Charged sales trend from ${report.range.from} to ${report.range.to}`} axisEvery={Math.ceil(trendPoints.length / 8)} />
          </section>
          <section className={styles.card} aria-label="Payment method breakdown"><h2>Payment methods</h2>
            <DonutChart slices={current.byPayment.map((row, index) => ({ label: row.label, value: row.amount, count: row.orderCount, color: CHART_COLORS[index % CHART_COLORS.length] ?? 'var(--chart-1)' }))}
              centreValue={String(current.orderCount)} centreLabel="orders" formatValue={(value) => formatMoney(value)} summary="Charged sales by payment method" />
          </section>
          <section className={styles.card} aria-label="Best-selling products"><h2>Best-selling products</h2>
            <BarChart rows={current.topProducts.slice(0, 8).map((row) => ({ label: row.name, value: row.quantity, detail: `${formatMoney(row.amount)} gross merchandise` }))} formatValue={(value) => `${value} units`} summary="Best-selling products by units" />
          </section>
          <section className={styles.card} aria-label="Product category performance"><h2>Category performance</h2>
            <BarChart rows={current.topCategories.map((row) => ({ label: row.name, value: row.amount, detail: `${row.quantity} units` }))} formatValue={(value) => formatMoney(value)} summary="Current menu category gross merchandise" />
          </section>
          <section className={styles.card} aria-label="Order status summary"><h2>Order status</h2>
            <table className={styles.table}><thead><tr><th>Status</th><th>Orders</th><th>Original value</th></tr></thead><tbody>
              {report.statuses.map((row) => <tr key={row.status}><td>{row.label}</td><td>{row.count}</td><td>{formatMoney(row.amount)}</td></tr>)}
            </tbody></table><p className={styles.note}>Refunded/cancelled value is the original order amount, not a cash movement.</p>
          </section>
          <section className={styles.card} aria-label="Tax summary"><h2>Tax summary</h2>
            <table className={styles.table}><thead><tr><th>Saved basis</th><th>Orders</th><th>Tax</th></tr></thead><tbody>
              {report.taxSummary.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.count}</td><td>{formatMoney(row.tax)}</td></tr>)}
            </tbody></table><p className={styles.note}>Stored tax totals: {formatMoney(current.taxTotal)}. Historical rows without a saved mode are not guessed.</p>
          </section>
          <section className={styles.cardWide} aria-label="Period sales table"><h2>{grouping === 'day' ? 'Daily' : grouping === 'week' ? 'Weekly' : grouping === 'month' ? 'Monthly' : 'Yearly'} sales</h2>
            <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Period</th><th>Orders</th><th>Charged sales</th><th>Average order</th></tr></thead><tbody>
              {report.trend.map((row) => <tr key={row.date ?? row.label}><td>{row.label}</td><td>{row.orderCount}</td><td>{formatMoney(row.amount)}</td><td>{row.orderCount ? formatMoney(Math.round(row.amount / row.orderCount)) : '—'}</td></tr>)}
            </tbody><tfoot><tr><th>Total</th><th>{current.orderCount}</th><th>{formatMoney(current.netSales)}</th><th>{formatMoney(current.averageOrder)}</th></tr></tfoot></table></div>
          </section>
        </div>
      </div> : null}
    </div>
  );
}
