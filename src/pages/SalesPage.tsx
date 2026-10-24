import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { ROUTE_PATHS } from '@/app/routes';
import { CHART_COLORS, DonutChart, TrendChart } from '@/components/charts/Charts';
import { PageHeader } from '@/components/layout/PageHeader';
import { OrderReceiptDialog } from '@/components/receipt/OrderReceiptDialog';
import { Button, EmptyState, Input } from '@/components/ui';
import { DownloadIcon, ReceiptIcon, SalesIcon } from '@/components/ui/Icons';
import { useDisplayPreferences } from '@/hooks/useDisplayPreferences';
import { notifyCustomersChanged } from '@/hooks/useCustomers';
import { notifyInventoryChanged } from '@/hooks/useInventory';
import { notifySalesChanged } from '@/hooks/useSales';
import { orderService } from '@/services/orderService';
import {
  REPORT_PRESETS,
  dateKey,
  resolvePresetRange,
  salesService,
  type DateRange,
  type ReportPreset,
  type SalesReport,
} from '@/services/salesService';
import type { OrderRecord, SaleRecord } from '@/types/domain';
import { formatMoney } from '@/utils/currency';
import { downloadCsv, fileStamp } from '@/utils/csv';
import { formatDateTime } from '@/utils/date';
import { formatPaymentMethod } from '@/utils/payment';
import { receiptOrderTypeLabel } from '@/utils/receipt';
import styles from './SalesPage.module.css';

type Tab = 'reports' | 'orders';

const PAGE_SIZE = 10;

interface HistoryRow {
  order: OrderRecord;
  sale?: SaleRecord;
}

/** Recent order is "recently edited" for a day after a correction. */
function wasRecentlyEdited(order: OrderRecord): boolean {
  if (!order.editedAt) return false;
  return Date.now() - Date.parse(order.editedAt) < 24 * 60 * 60 * 1000;
}

export default function SalesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Presentation only: which details appear on each order row.
  const display = useDisplayPreferences();
  const [tab, setTab] = useState<Tab>('reports');

  /* ---------------- Reports ---------------- */
  const [preset, setPreset] = useState<ReportPreset>('today');
  const [range, setRange] = useState<DateRange>(() => resolvePresetRange('today'));
  const [customFrom, setCustomFrom] = useState(dateKey(new Date()));
  const [customTo, setCustomTo] = useState(dateKey(new Date()));
  const [report, setReport] = useState<SalesReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(true);

  const loadReport = useCallback(async (next: DateRange) => {
    setReportLoading(true);
    setReportError(null);
    try {
      const result = await salesService.report(next);
      setReport(result);
    } catch {
      setReportError('Could not build the report.');
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport(range);
  }, [loadReport, range]);

  /* ---------------- Orders ---------------- */
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [orderFrom, setOrderFrom] = useState('');
  const [orderTo, setOrderTo] = useState('');
  const [page, setPage] = useState(1);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await orderService.history());
      setHistoryError(null);
    } catch {
      // Keep whatever rows are already on screen; a storage failure must
      // not be presented as an empty order history.
      setHistoryError('Order history could not be loaded from this device.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const term = query.trim().toLowerCase();
  const filteredHistory = useMemo(
    () =>
      history.filter(({ order }) => {
        const at = order.completedAt ?? order.createdAt;
        const day = dateKey(new Date(at));
        if (orderFrom && day < orderFrom) return false;
        if (orderTo && day > orderTo) return false;
        if (!term) return true;
        return [
          order.orderNumber,
          order.customerName,
          order.customerPhone,
          order.tableLabel,
        ].some((value) => value?.toLowerCase().includes(term));
      }),
    [history, orderFrom, orderTo, term],
  );

  const pageCount = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredHistory.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  async function handleCancel(orderId: string) {
    setBusyId(orderId);
    setConfirmId(null);
    try {
      await orderService.cancel(orderId);
      await Promise.all([loadHistory(), loadReport(range)]);
      notifySalesChanged();
      notifyInventoryChanged();
      notifyCustomersChanged();
    } catch {
      /* the row simply remains completed; the reason stays visible on screen */
    } finally {
      setBusyId(null);
    }
  }

  function choosePreset(next: ReportPreset) {
    setPreset(next);
    if (next === 'custom') {
      setRange({ from: customFrom, to: customTo });
      return;
    }
    setRange(resolvePresetRange(next));
  }

  function applyCustom() {
    if (!customFrom || !customTo || customFrom > customTo) {
      setReportError('Choose a valid start and end date.');
      return;
    }
    setPreset('custom');
    setRange({ from: customFrom, to: customTo });
  }

  function exportCsv() {
    if (!report) return;
    const rows: (string | number)[][] = [
      ['Sales report'],
      ['From', report.from],
      ['To', report.to],
      ['Generated', formatDateTime(new Date().toISOString())],
      [],
      ['Metric', 'Value'],
      ['Gross sales', (report.grossSales / 100).toFixed(2)],
      ['Net sales', (report.netSales / 100).toFixed(2)],
      ['Discounts', (report.discounts / 100).toFixed(2)],
      ['Tax', (report.taxTotal / 100).toFixed(2)],
      ['Refunds and voids', (report.refunds / 100).toFixed(2)],
      ['Orders', report.orderCount],
      ['Items sold', report.itemCount],
      ['Average order', (report.averageOrder / 100).toFixed(2)],
      [],
      ['Payment method', 'Orders', 'Amount'],
      ...report.byPayment.map((entry) => [
        entry.label,
        entry.orderCount,
        (entry.amount / 100).toFixed(2),
      ]),
      [],
      ['Order type', 'Orders', 'Amount'],
      ...report.byOrderType.map((entry) => [
        entry.label,
        entry.orderCount,
        (entry.amount / 100).toFixed(2),
      ]),
      [],
      ['Date', 'Orders', 'Net sales'],
      ...report.byDay.map((entry) => [
        entry.label,
        entry.orderCount,
        (entry.amount / 100).toFixed(2),
      ]),
      [],
      ['Product', 'Quantity', 'Amount'],
      ...report.topProducts.map((entry) => [
        entry.name,
        entry.quantity,
        (entry.amount / 100).toFixed(2),
      ]),
      [],
      [
        'Order',
        'Date',
        'Type',
        'Customer',
        'Items',
        'Subtotal',
        'Discount',
        'Tax',
        'Total',
        'Payment',
      ],
      ...report.sales.map((sale) => {
        const order = history.find((row) => row.order.id === sale.orderId)?.order;
        return [
          sale.orderNumber,
          formatDateTime(sale.completedAt),
          order ? receiptOrderTypeLabel(order.orderType) : '',
          order?.customerName ?? '',
          sale.itemCount,
          (sale.subtotal / 100).toFixed(2),
          (sale.discountTotal / 100).toFixed(2),
          (sale.taxTotal / 100).toFixed(2),
          (sale.grandTotal / 100).toFixed(2),
          formatPaymentMethod(sale.paymentMethod),
        ];
      }),
    ];

    downloadCsv(
      `sales-report-${report.from}-to-${report.to}-${fileStamp()}.csv`,
      rows,
    );
  }

  if (historyLoading && reportLoading) {
    return (
      <div className="page">
        <PageHeader title="Sales" subtitle="Reports and order history." />
        <p className={styles.loading}>Loading sales…</p>
      </div>
    );
  }

  const isEmpty = !reportLoading && (!report || report.orderCount === 0);

  return (
    <div className="page">
      <PageHeader
        title="Sales"
        subtitle="Reports, order history and receipt corrections."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(ROUTE_PATHS.pos)}
          >
            New order
          </Button>
        }
      />

      <div className={styles.tabs} role="tablist" aria-label="Sales sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reports'}
          className={`${styles.tab} ${tab === 'reports' ? styles.tabActive : ''}`}
          onClick={() => setTab('reports')}
        >
          Reports
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'orders'}
          className={`${styles.tab} ${tab === 'orders' ? styles.tabActive : ''}`}
          onClick={() => setTab('orders')}
        >
          Orders
        </button>
      </div>

      {tab === 'reports' ? (
        <div className={styles.stack}>
          <div className={styles.filters} role="group" aria-label="Report period">
            <div className={styles.presets}>
              {REPORT_PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.preset} ${preset === option.id ? styles.presetActive : ''}`}
                  aria-pressed={preset === option.id}
                  onClick={() => choosePreset(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {preset === 'custom' ? (
              <div className={styles.customRange}>
                <Input
                  label="From"
                  name="reportFrom"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
                <Input
                  label="To"
                  name="reportTo"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
                <Button variant="secondary" onClick={applyCustom}>
                  Apply
                </Button>
              </div>
            ) : (
              <span className={styles.rangeLabel}>
                {range.from} to {range.to}
              </span>
            )}

            <Button
              variant="secondary"
              size="sm"
              disabled={!report || report.orderCount === 0}
              leadingIcon={<DownloadIcon width={15} height={15} />}
              onClick={exportCsv}
            >
              Export CSV
            </Button>
          </div>

          {reportError ? (
            <p className={styles.error} role="alert">
              {reportError}
            </p>
          ) : null}

          {reportLoading ? (
            <p className={styles.loading}>Building report…</p>
          ) : isEmpty ? (
            <EmptyState
              icon={<SalesIcon />}
              title="No sales in this period"
              description="Choose another period or complete an order. Every figure here comes from saved sales."
              action={
                <Button variant="secondary" onClick={() => navigate(ROUTE_PATHS.pos)}>
                  Go to POS
                </Button>
              }
            />
          ) : report ? (
            <>
              <section className={styles.kpis} aria-label="Totals">
                {[
                  { label: 'Net sales', value: formatMoney(report.netSales), tone: styles.kpiPrimary },
                  { label: 'Gross sales', value: formatMoney(report.grossSales) },
                  { label: 'Discounts', value: formatMoney(report.discounts) },
                  { label: 'Tax', value: formatMoney(report.taxTotal) },
                  { label: 'Refunds and voids', value: formatMoney(report.refunds) },
                  { label: 'Orders', value: String(report.orderCount) },
                  { label: 'Items sold', value: String(report.itemCount) },
                  { label: 'Average order', value: formatMoney(report.averageOrder) },
                ].map((kpi) => (
                  <article
                    key={kpi.label}
                    className={`${styles.kpi} ${kpi.tone ?? ''}`}
                  >
                    <span className={styles.kpiLabel}>{kpi.label}</span>
                    <span className={styles.kpiValue}>{kpi.value}</span>
                  </article>
                ))}
              </section>

              <p className={styles.definition}>
                Net sales is the amount charged (after discounts, including
                tax). Gross sales is the value before discount and tax. Tax is
                shown separately; these are revenue figures, not profit.
              </p>

              <div className={styles.chartGrid}>
                <section className={styles.card} aria-label="Sales trend">
                  <h2 className={styles.cardTitle}>Sales trend</h2>
                  <TrendChart
                    points={report.byDay.map((entry) => ({
                      label: entry.label,
                      value: entry.amount,
                    }))}
                    summary={`Sales by day: ${report.byDay
                      .map((entry) => `${entry.label} ${formatMoney(entry.amount)}`)
                      .join(', ')}`}
                  />
                </section>

                <section className={styles.card} aria-label="Sales by hour">
                  <h2 className={styles.cardTitle}>Sales by hour</h2>
                  <BarRows
                    rows={report.byHour
                      .filter((entry) => entry.orderCount > 0)
                      .map((entry) => ({
                        label: entry.label,
                        value: entry.amount,
                        detail: `${entry.orderCount}`,
                      }))}
                    currency
                    emptyLabel="No sales recorded in this period."
                  />
                </section>

                <section className={styles.card} aria-label="Payment methods">
                  <h2 className={styles.cardTitle}>Payment methods</h2>
                  <DonutChart
                    slices={report.byPayment.map((entry, index) => ({
                      label: formatPaymentMethod(entry.label),
                      value: entry.amount,
                      count: entry.orderCount,
                      color: CHART_COLORS[(index + 1) % CHART_COLORS.length]!,
                    }))}
                    centreValue={formatMoney(report.netSales, { withSymbol: false })}
                    centreLabel="received"
                    formatValue={(value) => formatMoney(value, { withSymbol: false })}
                    summary={`Payments: ${report.byPayment
                      .map((entry) => `${entry.label} ${formatMoney(entry.amount)}`)
                      .join(', ')}`}
                  />
                </section>

                <section className={styles.card} aria-label="Order types">
                  <h2 className={styles.cardTitle}>Order types</h2>
                  <DonutChart
                    slices={report.byOrderType.map((entry, index) => ({
                      label: entry.label,
                      value: entry.amount,
                      count: entry.orderCount,
                      color: CHART_COLORS[index % CHART_COLORS.length]!,
                    }))}
                    centreValue={String(report.orderCount)}
                    centreLabel="orders"
                    formatValue={(value) => formatMoney(value, { withSymbol: false })}
                    summary={`Order types: ${report.byOrderType
                      .map((entry) => `${entry.label} ${formatMoney(entry.amount)}`)
                      .join(', ')}`}
                  />
                </section>

                <section className={styles.card} aria-label="Top products">
                  <h2 className={styles.cardTitle}>Top products</h2>
                  <BarRows
                    rows={report.topProducts.map((entry) => ({
                      label: entry.name,
                      value: entry.quantity,
                      detail: formatMoney(entry.amount),
                    }))}
                    emptyLabel="No products sold in this period."
                  />
                </section>

                <section className={styles.card} aria-label="Top categories">
                  <h2 className={styles.cardTitle}>Categories</h2>
                  <BarRows
                    rows={report.topCategories.map((entry) => ({
                      label: entry.name,
                      value: entry.amount,
                      detail: `${entry.quantity} sold`,
                    }))}
                    currency
                    emptyLabel="No categories recorded in this period."
                  />
                </section>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className={styles.stack}>
          <div className={styles.filters}>
            <Input
              label="Search orders"
              name="orderSearch"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Order, customer, phone or table"
              autoComplete="off"
              fullWidth
            />
            <div className={styles.customRange}>
              <Input
                label="From"
                name="orderFrom"
                type="date"
                value={orderFrom}
                onChange={(event) => {
                  setOrderFrom(event.target.value);
                  setPage(1);
                }}
              />
              <Input
                label="To"
                name="orderTo"
                type="date"
                value={orderTo}
                onChange={(event) => {
                  setOrderTo(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {historyError ? (
            <p className={styles.error} role="alert">
              {historyError}
            </p>
          ) : null}

          {historyLoading ? (
            <p className={styles.loading}>Loading orders…</p>
          ) : pageRows.length === 0 ? (
            <EmptyState
              icon={<ReceiptIcon />}
              title="No orders found"
              description="Orders appear here as soon as a sale is completed."
            />
          ) : (
            <ul className={styles.list}>
              {pageRows.map(({ order, sale }) => {
                const cancelled = order.status === 'cancelled' || Boolean(sale?.cancelledAt);
                const confirming = confirmId === order.id;
                return (
                  <li
                    key={order.id}
                    className={`${styles.row} ${cancelled ? styles.rowCancelled : ''}`}
                  >
                    <div className={styles.rowMain}>
                      <span className={styles.orderNumberRow}>
                        <span className={styles.orderNumber}>
                          #{order.orderNumber}
                        </span>
                        <span className={styles.typeTag}>
                          {receiptOrderTypeLabel(order.orderType)}
                        </span>
                        {cancelled ? (
                          <span className={styles.cancelledBadge}>Cancelled</span>
                        ) : null}
                        {wasRecentlyEdited(order) ? (
                          <span className={styles.editedBadge}>Recently edited</span>
                        ) : null}
                      </span>
                      <span className={styles.rowMeta}>
                        {[
                          formatDateTime(order.completedAt ?? order.createdAt),
                          display.orderList.customer
                            ? order.customerName || 'Guest'
                            : null,
                          display.orderList.table && order.tableLabel
                            ? `Table ${order.tableLabel}`
                            : null,
                          display.orderList.itemCount
                            ? `${sale?.itemCount ?? 0} item${(sale?.itemCount ?? 0) === 1 ? '' : 's'}`
                            : null,
                          display.orderList.payment
                            ? formatPaymentMethod(order.paymentMethod ?? 'cash')
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>

                    <span className={styles.rowActions}>
                      {!cancelled ? (
                        confirming ? (
                          <>
                            <span className={styles.confirmText}>
                              Cancel this order?
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmId(null)}
                              disabled={busyId === order.id}
                            >
                              No
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => void handleCancel(order.id)}
                              disabled={busyId === order.id}
                            >
                              Yes, cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmId(order.id)}
                            disabled={busyId === order.id}
                          >
                            Cancel
                          </Button>
                        )
                      ) : null}

                      <Button
                        variant="secondary"
                        size="sm"
                        leadingIcon={<ReceiptIcon width={15} height={15} />}
                        onClick={() => setOpenReceipt(order.id)}
                      >
                        Receipt
                      </Button>

                      <span className={styles.rowTotal}>
                        {formatMoney(order.grandTotal)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {filteredHistory.length > PAGE_SIZE ? (
            <div className={styles.pagination}>
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <span className={styles.pageLabel}>
                Page {currentPage} of {pageCount} · {filteredHistory.length} orders
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {openReceipt ? (
        <OrderReceiptDialog
          orderId={openReceipt}
          editor={user?.username ?? 'admin'}
          onClose={() => setOpenReceipt(null)}
          onEdited={() => {
            void loadHistory();
            void loadReport(range);
            notifySalesChanged();
            notifyInventoryChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** Lightweight horizontal bars — seven to twenty-four values need no library. */
function BarRows({
  rows,
  currency = false,
  emptyLabel = 'Nothing recorded in this period.',
}: {
  rows: { label: string; value: number; detail: string }[];
  currency?: boolean;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className={styles.muted}>{emptyLabel}</p>;
  }

  const peak = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className={styles.bars}>
      {rows.map((row, index) => (
        <li key={`${row.label}-${index}`} className={styles.barRow}>
          <span className={styles.barLabel} title={row.label}>
            {row.label}
          </span>
          <span className={styles.barTrack} aria-hidden="true">
            <span
              className={styles.barFill}
              style={{ width: `${(row.value / peak) * 100}%` }}
            />
          </span>
          <span className={styles.barValue}>
            {currency ? formatMoney(row.value) : row.value}
            <span className={styles.barDetail}>{row.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

