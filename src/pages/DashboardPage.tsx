import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ROUTE_PATHS } from '@/app/routes';
import { CHART_COLORS, DonutChart, TrendChart } from '@/components/charts/Charts';
import { PageHeader } from '@/components/layout/PageHeader';
import { OrderReceiptDialog } from '@/components/receipt/OrderReceiptDialog';
import { Button, EmptyState } from '@/components/ui';
import {
  CustomersIcon,
  DeliveryIcon,
  InventoryIcon,
  MenuBookIcon,
  PosIcon,
  PurchasesIcon,
  ReportsIcon,
  SalesIcon,
  SettingsIcon,
  TagIcon,
} from '@/components/ui/Icons';
import { useDisplayPreferences } from '@/hooks/useDisplayPreferences';
import { customerService } from '@/services/customerService';
import { inventoryService } from '@/services/inventoryService';
import { orderService } from '@/services/orderService';
import { restaurantService } from '@/services/restaurantService';
import {
  dateKey,
  resolvePresetRange,
  salesService,
  type ReportBucket,
  type SalesOverview,
  type SalesReport,
} from '@/services/salesService';
import type { InventoryItemView } from '@/services/inventoryService';
import type { OrderRecord, RestaurantRecord } from '@/types/domain';
import { formatMoney } from '@/utils/currency';
import { formatDate, formatTime } from '@/utils/date';
import { formatPaymentMethod } from '@/utils/payment';
import { receiptOrderTypeLabel } from '@/utils/receipt';
// Bundled with the app (1600×500, ~110 KB) and precached by the service
// worker, so the default banner is available immediately and offline with
// no external image request. A custom banner from Settings replaces it.
import defaultBannerUrl from '@/assets/default-restaurant-banner.jpg';
import styles from './DashboardPage.module.css';

/** Windows offered above the trend chart. One report query per change. */
const RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: 'This week', days: 7 },
  { id: 'month', label: 'This month', days: 30 },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

interface DashboardData {
  profile: RestaurantRecord | undefined;
  overview: SalesOverview;
  report: SalesReport;
  payment: ReportBucket[];
  orderTypes: ReportBucket[];
  bestSellers: { name: string; quantity: number; amount: number }[];
  categories: { name: string; quantity: number; amount: number }[];
  recent: OrderRecord[];
  lowStock: InventoryItemView[];
  stats: {
    dineInTables: number;
    pendingDeliveries: number;
    unpaidOrders: number;
    todayOrders: number;
  };
  newCustomers: number;
  /** Today and yesterday totals, for the deltas on the KPI cards. */
  todayTotal: number;
  yesterdayTotal: number;
  todayOrders: number;
  yesterdayOrders: number;
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded === 0) return <span className={styles.deltaNeutral}>No change</span>;
  const up = rounded > 0;
  return (
    <span className={up ? styles.deltaUp : styles.deltaDown}>
      {up ? '+' : ''}
      {rounded}%
    </span>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const display = useDisplayPreferences();
  const [range, setRange] = useState<RangeId>('week');
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(() => {
    try {
      return window.localStorage.getItem('pos.setupReminderDismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const today = dateKey(new Date());
        const days = RANGES.find((entry) => entry.id === range)?.days ?? 7;
        const from = new Date();
        from.setDate(from.getDate() - (days - 1));
        const window = { from: dateKey(from), to: today };

        const [profile, overview, report, recent, stock, customers, stats] =
          await Promise.all([
            restaurantService.getRecord(),
            salesService.overview(),
            salesService.report(window),
            orderService.recentOrders(6),
            inventoryService.list(),
            customerService.list(),
            orderService.dayStats(today),
          ]);

        if (!active) return;

        const byDay = report.byDay;
        const todayBucket = byDay.find((entry) => entry.label === formatBucket(today));
        const yesterdayKey = dateKey(
          new Date(new Date().setDate(new Date().getDate() - 1)),
        );
        const yesterdayBucket = byDay.find(
          (entry) => entry.label === formatBucket(yesterdayKey),
        );

        setData({
          profile,
          overview,
          report,
          payment: report.byPayment,
          orderTypes: report.byOrderType,
          bestSellers: report.topProducts.slice(0, 5),
          categories: report.topCategories.slice(0, 4),
          recent,
          lowStock: stock
            .filter(
              (item) =>
                item.status === 'low-stock' || item.status === 'out-of-stock',
            )
            .slice(0, 4),
          stats,
          newCustomers: customers.filter(
            (customer) => dateKey(new Date(customer.createdAt)) === today,
          ).length,
          todayTotal: todayBucket?.amount ?? report.netSales,
          yesterdayTotal: yesterdayBucket?.amount ?? 0,
          todayOrders: stats.todayOrders,
          yesterdayOrders: yesterdayBucket?.orderCount ?? 0,
        });
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setRefreshing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [range]);

  const trendPoints = useMemo(() => {
    if (!data) return [];
    if (range === 'today') {
      return data.report.byHour.map((entry) => ({
        label: entry.label,
        value: entry.amount,
      }));
    }
    return data.report.byDay.map((entry) => ({
      label: entry.label,
      value: entry.amount,
    }));
  }, [data, range]);

  if (failed) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Dashboard unavailable"
          description="The stored data could not be read. Reload the page to try again."
          action={<Button onClick={() => window.location.reload()}>Reload</Button>}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" />
        <p className={styles.loading}>Loading dashboard…</p>
      </div>
    );
  }

  const { profile, overview: sales, stats } = data;
  const salesDelta = pctChange(data.todayTotal, data.yesterdayTotal);
  const ordersDelta = pctChange(
    data.todayOrders,
    data.yesterdayOrders,
  );

  const quickActions = [
    { label: 'New order', hint: 'POS', path: ROUTE_PATHS.pos, icon: PosIcon },
    { label: 'Sales', hint: 'Transactions', path: ROUTE_PATHS.sales, icon: SalesIcon },
    { label: 'Reports', hint: 'Analysis', path: ROUTE_PATHS.reports, icon: ReportsIcon },
    {
      label: 'Customers',
      hint: 'People',
      path: ROUTE_PATHS.customers,
      icon: CustomersIcon,
    },
    { label: 'Menu', hint: 'Items', path: ROUTE_PATHS.menu, icon: MenuBookIcon },
    { label: 'Deals', hint: 'Offers', path: ROUTE_PATHS.deals, icon: TagIcon },
    {
      label: 'Inventory',
      hint: 'Stock',
      path: ROUTE_PATHS.inventory,
      icon: InventoryIcon,
    },
    {
      label: 'Purchases',
      hint: 'Receive',
      path: ROUTE_PATHS.purchases,
      icon: PurchasesIcon,
    },
  ];

  // Banner content stays minimal: the restaurant name and a short greeting
  // (plus the configured tagline, if one exists). No statistics or actions.
  const restaurantName = profile?.name?.trim() || 'Welcome back';
  const customBanner = profile?.banner?.dataUrl ? profile.banner : null;

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={formatDate(new Date())}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(ROUTE_PATHS.reports)}>
              Reports
            </Button>
            <Button onClick={() => navigate(ROUTE_PATHS.pos)}>New order</Button>
          </>
        }
      />

      {/*
        Optional setup reminder. Shown while the profile has no name or the
        terminal still uses its one-time setup password; dismissal is a local
        UI preference and never changes the underlying state.
      */}
      {!reminderDismissed && (!profile?.name?.trim() || user?.mustChangePassword) ? (
        <div className={styles.reminder} role="status">
          <span className={styles.reminderText}>
            <strong>Finish setting up this terminal.</strong>{' '}
            {!profile?.name?.trim()
              ? 'Add the restaurant name and banner in Settings.'
              : 'Choose your own administrator password in Settings, Security.'}
          </span>
          <span className={styles.reminderActions}>
            <button
              type="button"
              className={styles.reminderButton}
              onClick={() => navigate(ROUTE_PATHS.admin)}
            >
              Open Settings
            </button>
            <button
              type="button"
              className={styles.reminderDismiss}
              aria-label="Dismiss reminder"
              onClick={() => {
                setReminderDismissed(true);
                try {
                  window.localStorage.setItem('pos.setupReminderDismissed', '1');
                } catch {
                  /* dismissal is best effort */
                }
              }}
            >
              Dismiss
            </button>
          </span>
        </div>
      ) : null}

      {/*
        Hero banner. Shows the operator's custom image when one is saved in
        Settings, otherwise the built-in restaurant banner bundled with the
        app. Deliberately no editing controls here — banner customisation
        lives in Settings (Appearance / Restaurant profile) so the banner
        itself stays clean.
      */}
      <section className={styles.hero} aria-label="Restaurant banner">
        <img
          src={customBanner ? customBanner.dataUrl : defaultBannerUrl}
          alt=""
          className={styles.heroImage}
          width={customBanner ? customBanner.width : 1600}
          height={customBanner ? customBanner.height : 500}
          loading="eager"
          decoding="async"
        />
        <div className={styles.heroOverlay}>
          <div className={styles.heroText}>
            <h2 className={styles.heroTitle}>{restaurantName}</h2>
            <p className={styles.heroLine}>
              {profile?.name?.trim()
                ? 'Welcome back.'
                : 'Add your restaurant name in Settings.'}
            </p>
            {profile?.tagline ? (
              <p className={styles.heroTagline}>{profile.tagline}</p>
            ) : null}
          </div>
        </div>
      </section>

      {display.dashboard.metrics ? (
        <section className={styles.metrics} aria-label="Today">
          <article className={`${styles.metric} ${styles.metricPrimary}`}>
            <span className={styles.metricLabel}>Sales today</span>
            <span className={styles.metricValue}>{formatMoney(sales.today.total)}</span>
            <span className={styles.metricFoot}>
              <Delta value={salesDelta} />
              <span className={styles.metricNote}>vs yesterday</span>
            </span>
          </article>
          <article className={styles.metric}>
            <span className={styles.metricLabel}>Total orders</span>
            <span className={styles.metricValue}>{stats.todayOrders}</span>
            <span className={styles.metricFoot}>
              <Delta value={ordersDelta} />
              <span className={styles.metricNote}>vs yesterday</span>
            </span>
          </article>
          <article className={styles.metric}>
            <span className={styles.metricLabel}>Dine-in tables</span>
            <span className={styles.metricValue}>{stats.dineInTables}</span>
            <span className={styles.metricFoot}>
              <span className={styles.metricNote}>Used today</span>
            </span>
          </article>
          <article className={styles.metric}>
            <span className={styles.metricLabel}>New customers</span>
            <span className={styles.metricValue}>{data.newCustomers}</span>
            <span className={styles.metricFoot}>
              <span className={styles.metricNote}>Added today</span>
            </span>
          </article>
        </section>
      ) : null}

      {display.dashboard.quickActions ? (
        <section className={styles.quick} aria-label="Quick actions">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={styles.quickItem}
              onClick={() => navigate(action.path)}
              data-tour={`quick-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <span className={styles.quickIcon} aria-hidden="true">
                <action.icon width={18} height={18} />
              </span>
              <span className={styles.quickLabel}>{action.label}</span>
              <span className={styles.quickHint}>{action.hint}</span>
            </button>
          ))}
        </section>
      ) : null}

      {display.dashboard.trends ? (
        <section className={styles.card} aria-label="Sales trend">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>Sales trend</h3>
            <div className={styles.segmented} role="group" aria-label="Period">
              {RANGES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.segment} ${
                    range === option.id ? styles.segmentActive : ''
                  }`}
                  aria-pressed={range === option.id}
                  onClick={() => {
                    setRefreshing(true);
                    setRange(option.id);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.chartBody} aria-busy={refreshing}>
            <TrendChart
              points={trendPoints}
              summary={`Sales for ${range === 'today' ? 'today by hour' : 'the selected period'}: ${formatMoney(
                data.report.netSales,
              )} across ${data.report.orderCount} orders.`}
            />
          </div>
          <dl className={styles.totals}>
            <div>
              <dt>Net sales</dt>
              <dd>{formatMoney(data.report.netSales)}</dd>
            </div>
            <div>
              <dt>Orders</dt>
              <dd>{data.report.orderCount}</dd>
            </div>
            <div>
              <dt>Average</dt>
              <dd>{formatMoney(data.report.averageOrder)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatMoney(data.report.taxTotal)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className={styles.columns}>
        {display.dashboard.trends ? (
          <section className={styles.card} aria-label="Order types">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>Order types</h3>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => navigate(ROUTE_PATHS.reports)}
              >
                Open reports
              </button>
            </div>
            <DonutChart
              slices={data.orderTypes.map((entry, index) => ({
                label: entry.label,
                value: entry.amount,
                count: entry.orderCount,
                color: CHART_COLORS[index % CHART_COLORS.length]!,
              }))}
              centreValue={String(data.report.orderCount)}
              centreLabel="orders"
              formatValue={(value) => formatMoney(value, { withSymbol: false })}
              summary={`Order type split: ${data.orderTypes
                .map((entry) => `${entry.label} ${formatMoney(entry.amount)}`)
                .join(', ')}`}
            />
          </section>
        ) : null}

        {display.dashboard.trends ? (
          <section className={styles.card} aria-label="Payment methods">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>Payment methods</h3>
            </div>
            <DonutChart
              slices={data.payment.map((entry, index) => ({
                label: formatPaymentMethod(entry.label),
                value: entry.amount,
                color: CHART_COLORS[(index + 1) % CHART_COLORS.length]!,
              }))}
              centreValue={formatMoney(data.report.netSales, { withSymbol: false })}
              centreLabel="received"
              formatValue={(value) => formatMoney(value, { withSymbol: false })}
              summary={`Payments: ${data.payment
                .map((entry) => `${entry.label} ${formatMoney(entry.amount)}`)
                .join(', ')}`}
            />
          </section>
        ) : null}

        {display.dashboard.bestSellers ? (
          <section className={styles.card} aria-label="Top selling items">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>Top selling items</h3>
              <span className={styles.cardMeta}>
                {RANGES.find((entry) => entry.id === range)?.label}
              </span>
            </div>
            {data.bestSellers.length === 0 ? (
              <p className={styles.muted}>No items sold in this period yet.</p>
            ) : (
              <ol className={styles.rankList}>
                {data.bestSellers.map((item, index) => (
                  <li key={item.name} className={styles.rankRow}>
                    <span className={styles.rankIndex}>{index + 1}</span>
                    <span className={styles.rankName}>{item.name}</span>
                    <span className={styles.rankQty}>{item.quantity} sold</span>
                    <span className={styles.rankAmount}>
                      {formatMoney(item.amount, { withSymbol: false })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}

        {display.dashboard.recentOrders ? (
          <section className={styles.card} aria-label="Recent orders">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>Recent orders</h3>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => navigate(ROUTE_PATHS.sales)}
              >
                All orders
              </button>
            </div>
            {data.recent.length === 0 ? (
              <p className={styles.muted}>No completed orders yet.</p>
            ) : (
              <ul className={styles.recentList}>
                {data.recent.map((order) => (
                  <li key={order.id}>
                    <button
                      type="button"
                      className={styles.recentRow}
                      onClick={() => setOpenOrderId(order.id)}
                    >
                      <span className={styles.recentNumber}>#{order.orderNumber}</span>
                      <span className={styles.recentMeta}>
                        {receiptOrderTypeLabel(order.orderType)}
                        {order.tableLabel ? ` · Table ${order.tableLabel}` : ''}
                        {order.customerName ? ` · ${order.customerName}` : ''}
                        {' · '}
                        {formatTime(order.completedAt ?? order.createdAt)}
                      </span>
                      <span className={styles.recentAmount}>
                        {formatMoney(order.grandTotal)}
                      </span>
                      <span className={styles.statusTag}>Completed</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {display.dashboard.stockAlerts ? (
          <section className={styles.card} aria-label="Stock alerts">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>Stock alerts</h3>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => navigate(ROUTE_PATHS.inventory)}
              >
                Inventory
              </button>
            </div>
            {data.lowStock.length === 0 ? (
              <p className={styles.muted}>No stock alerts.</p>
            ) : (
              <ul className={styles.alertList}>
                {data.lowStock.map((item) => (
                  <li key={item.record.id} className={styles.alertRow}>
                    <span className={styles.alertName}>{item.record.name}</span>
                    <span
                      className={
                        item.status === 'out-of-stock'
                          ? `${styles.alertTag} ${styles.alertCritical}`
                          : `${styles.alertTag} ${styles.alertWarning}`
                      }
                    >
                      {item.status === 'out-of-stock'
                        ? 'Out of stock'
                        : `${item.record.quantity} ${item.record.unit}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {display.dashboard.operations ? (
        <section className={styles.secondary} aria-label="Operational summary">
          <div className={styles.secondaryItem}>
            <span className={styles.secondaryValue}>{stats.pendingDeliveries}</span>
            <span className={styles.secondaryLabel}>
              <DeliveryIcon width={14} height={14} /> Deliveries in progress
            </span>
          </div>
          <div className={styles.secondaryItem}>
            <span className={styles.secondaryValue}>{stats.unpaidOrders}</span>
            <span className={styles.secondaryLabel}>Orders short of payment</span>
          </div>
          <div className={styles.secondaryItem}>
            <span className={styles.secondaryValue}>
              {data.lowStock.filter((item) => item.status === 'out-of-stock').length}
            </span>
            <span className={styles.secondaryLabel}>Out-of-stock lines</span>
          </div>
          <div className={styles.secondaryItem}>
            <span className={styles.secondaryValue}>{sales.month.orderCount}</span>
            <span className={styles.secondaryLabel}>Orders this month</span>
          </div>
          <button
            type="button"
            className={styles.secondaryLink}
            onClick={() => navigate(ROUTE_PATHS.admin)}
          >
            <SettingsIcon width={15} height={15} />
            Settings
          </button>
        </section>
      ) : null}

      {Object.values(display.dashboard).every((on) => !on) ? (
        <p className={styles.muted}>
          Every Dashboard block is hidden. Turn sections back on in Settings,
          Appearance.
        </p>
      ) : null}

      {openOrderId ? (
        <OrderReceiptDialog
          orderId={openOrderId}
          editor={user?.username ?? 'admin'}
          onClose={() => setOpenOrderId(null)}
          onEdited={() => setRange((current) => current)}
        />
      ) : null}
    </div>
  );
}

/** `report.byDay` labels are formatted dates; compare using the same formatter. */
function formatBucket(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return key;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Default export stays compatible with the existing route registry. */
export { resolvePresetRange };
