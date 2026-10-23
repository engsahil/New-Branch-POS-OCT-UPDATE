import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTE_PATHS } from '@/app/routes';
import { PageHeader } from '@/components/layout/PageHeader';
import { WeekChart } from '@/components/sales';
import { Button, EmptyState } from '@/components/ui';
import {
  AdminIcon,
  CustomersIcon,
  DeliveryIcon,
  InventoryIcon,
  MenuBookIcon,
  PosIcon,
  SalesIcon,
  TagIcon,
} from '@/components/ui/Icons';
import { useDisplayPreferences } from '@/hooks/useDisplayPreferences';
import { customerService } from '@/services/customerService';
import { inventoryService } from '@/services/inventoryService';
import { orderService } from '@/services/orderService';
import { restaurantService } from '@/services/restaurantService';
import {
  dateKey,
  salesService,
  type ReportBucket,
  type SalesOverview,
} from '@/services/salesService';
import type { InventoryItemView } from '@/services/inventoryService';
import type { OrderRecord, RestaurantRecord } from '@/types/domain';
import { formatMoney } from '@/utils/currency';
import { formatDate, formatTime } from '@/utils/date';
import { formatPaymentMethod } from '@/utils/payment';
import { receiptOrderTypeLabel } from '@/utils/receipt';
import styles from './DashboardPage.module.css';

interface DashboardData {
  profile: RestaurantRecord | undefined;
  overview: SalesOverview;
  weekOrderType: ReportBucket[];
  payment: ReportBucket[];
  bestSellers: { name: string; quantity: number; amount: number }[];
  recent: OrderRecord[];
  lowStock: InventoryItemView[];
  stats: {
    dineInTables: number;
    pendingDeliveries: number;
    unpaidOrders: number;
    todayOrders: number;
  };
  newCustomers: number;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  // Presentation only: switching a block off never changes a figure.
  const display = useDisplayPreferences();

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const today = dateKey(new Date());
        const week = salesService.resolvePresetRange('this-week');

        const [profile, liveOverview, report, recent, stock, customers, stats] =
          await Promise.all([
            restaurantService.getRecord(),
            salesService.overview(),
            salesService.report(week),
            orderService.recentOrders(6),
            inventoryService.list(),
            customerService.list(),
            orderService.dayStats(today),
          ]);

        if (!active) return;

        setData({
          profile,
          overview: liveOverview,
          weekOrderType: report.byOrderType,
          payment: report.byPayment,
          bestSellers: report.topProducts.slice(0, 5),
          recent,
          lowStock: stock
            .filter(
              (item) =>
                item.status === 'low-stock' || item.status === 'out-of-stock',
            )
            .slice(0, 5),
          stats,
          newCustomers: customers.filter(
            (customer) => dateKey(new Date(customer.createdAt)) === today,
          ).length,
        });
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Dashboard unavailable"
          description="The stored data could not be read. Reload the page to try again."
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
  const today = sales.today;

  const quickActions = [
    { label: 'New order', path: ROUTE_PATHS.pos, icon: PosIcon, tour: 'pos' },
    { label: 'Sales', path: ROUTE_PATHS.sales, icon: SalesIcon, tour: 'sales' },
    {
      label: 'Customers',
      path: ROUTE_PATHS.customers,
      icon: CustomersIcon,
      tour: 'customers',
    },
    { label: 'Menu', path: ROUTE_PATHS.menu, icon: MenuBookIcon, tour: 'menu' },
    { label: 'Deals', path: ROUTE_PATHS.deals, icon: TagIcon, tour: 'deals' },
    {
      label: 'Inventory',
      path: ROUTE_PATHS.inventory,
      icon: InventoryIcon,
      tour: 'inventory',
    },
    {
      label: 'Deliveries',
      path: ROUTE_PATHS.deliveries,
      icon: DeliveryIcon,
      tour: 'deliveries',
    },
    { label: 'Admin', path: ROUTE_PATHS.admin, icon: AdminIcon, tour: 'admin' },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={formatDate(new Date())}
        actions={
          <Button onClick={() => navigate(ROUTE_PATHS.pos)}>New order</Button>
        }
      />

      {/* Restaurant banner. Real profile data, no placeholder imagery. */}
      <section className={styles.banner} aria-label="Restaurant">
        <div className={styles.bannerMain}>
          {profile?.logo?.dataUrl ? (
            <img
              src={profile.logo.dataUrl}
              alt=""
              className={styles.bannerLogo}
            />
          ) : (
            <span className={styles.bannerMark} aria-hidden="true">
              <PosIcon width={22} height={22} />
            </span>
          )}
          <div className={styles.bannerText}>
            <h2 className={styles.bannerName}>
              {profile?.name?.trim() || 'Restaurant profile not configured'}
            </h2>
            <p className={styles.bannerMeta}>
              {[profile?.address, profile?.phone]
                .filter((value) => Boolean(value && value.trim()))
                .join(' · ') || 'Add the restaurant name and contact details in Admin'}
            </p>
          </div>
        </div>
      </section>

      {display.dashboard.metrics ? (
      <section className={styles.metrics} aria-label="Today">
        <article className={`${styles.metric} ${styles.metricPrimary}`}>
          <span className={styles.metricLabel}>Sales today</span>
          <span className={styles.metricValue}>{formatMoney(today.total)}</span>
          <span className={styles.metricFoot}>
            {today.orderCount} order{today.orderCount === 1 ? '' : 's'}
          </span>
        </article>
        <article className={styles.metric}>
          <span className={styles.metricLabel}>Orders today</span>
          <span className={styles.metricValue}>{stats.todayOrders}</span>
          <span className={styles.metricFoot}>
            Average {formatMoney(today.averageOrder)}
          </span>
        </article>
        <article className={styles.metric}>
          <span className={styles.metricLabel}>Dine-in tables</span>
          <span className={styles.metricValue}>{stats.dineInTables}</span>
          <span className={styles.metricFoot}>Used today</span>
        </article>
        <article className={styles.metric}>
          <span className={styles.metricLabel}>New customers</span>
          <span className={styles.metricValue}>{data.newCustomers}</span>
          <span className={styles.metricFoot}>Added today</span>
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
            data-tour={`quick-${action.tour}`}
          >
            <action.icon width={18} height={18} />
            <span>{action.label}</span>
          </button>
        ))}
      </section>
      ) : null}

      {display.dashboard.trends ||
      display.dashboard.bestSellers ||
      display.dashboard.stockAlerts ||
      display.dashboard.recentOrders ? (
      <div className={styles.columns}>
        {display.dashboard.trends ? (
        <section className={`${styles.card} ${styles.chartCard}`} aria-label="Sales this week">
          <WeekChart days={sales.weekDays} />
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => navigate(ROUTE_PATHS.sales)}
          >
            Open reports
          </button>
        </section>
        ) : null}

        {display.dashboard.trends ? (
        <section className={styles.card} aria-label="Payment summary">
          <h3 className={styles.cardTitle}>Payments this week</h3>
          <ul className={styles.bars}>
            {data.payment.map((entry) => {
              const total = data.payment.reduce((sum, row) => sum + row.amount, 0);
              const share = total > 0 ? (entry.amount / total) * 100 : 0;
              return (
                <li key={entry.label} className={styles.barRow}>
                  <span className={styles.barLabel}>{entry.label}</span>
                  <span className={styles.barTrack} aria-hidden="true">
                    <span
                      className={styles.barFill}
                      style={{ width: `${share}%` }}
                    />
                  </span>
                  <span className={styles.barValue}>
                    {formatMoney(entry.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        ) : null}

        {display.dashboard.trends ? (
        <section className={styles.card} aria-label="Order types">
          <h3 className={styles.cardTitle}>Order types this week</h3>
          <ul className={styles.bars}>
            {data.weekOrderType.map((entry) => {
              const total = data.weekOrderType.reduce(
                (sum, row) => sum + row.orderCount,
                0,
              );
              const share = total > 0 ? (entry.orderCount / total) * 100 : 0;
              return (
                <li key={entry.label} className={styles.barRow}>
                  <span className={styles.barLabel}>{entry.label}</span>
                  <span className={styles.barTrack} aria-hidden="true">
                    <span
                      className={`${styles.barFill} ${styles.barFillAlt}`}
                      style={{ width: `${share}%` }}
                    />
                  </span>
                  <span className={styles.barValue}>{entry.orderCount}</span>
                </li>
              );
            })}
          </ul>
        </section>
        ) : null}

        {display.dashboard.bestSellers ? (
        <section className={styles.card} aria-label="Best sellers">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>Best sellers</h3>
            <span className={styles.cardMeta}>This week</span>
          </div>
          {data.bestSellers.length === 0 ? (
            <p className={styles.muted}>No items sold this week yet.</p>
          ) : (
            <ol className={styles.rankList}>
              {data.bestSellers.map((item) => (
                <li key={item.name} className={styles.rankRow}>
                  <span className={styles.rankName}>{item.name}</span>
                  <span className={styles.rankQty}>{item.quantity}</span>
                </li>
              ))}
            </ol>
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

        {display.dashboard.recentOrders ? (
        <section className={`${styles.card} ${styles.recentCard}`} aria-label="Recent orders">
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
                <li key={order.id} className={styles.recentRow}>
                  <span className={styles.recentNumber}>#{order.orderNumber}</span>
                  <span className={styles.recentMeta}>
                    {receiptOrderTypeLabel(order.orderType)}
                    {order.tableLabel ? ` · Table ${order.tableLabel}` : ''}
                    {order.customerName ? ` · ${order.customerName}` : ''}
                    {' · '}
                    {formatTime(order.completedAt ?? order.createdAt)}
                    {' · '}
                    {formatPaymentMethod(order.paymentMethod ?? 'cash')}
                  </span>
                  <span className={styles.recentTotal}>
                    {formatMoney(order.grandTotal)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        ) : null}
      </div>
      ) : null}

      {display.dashboard.operations ? (
      <section className={styles.secondary} aria-label="Operational summary">
        <div className={styles.secondaryItem}>
          <span className={styles.secondaryValue}>{stats.pendingDeliveries}</span>
          <span className={styles.secondaryLabel}>Deliveries in progress</span>
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
          <span className={styles.secondaryValue}>
            {sales.month.orderCount}
          </span>
          <span className={styles.secondaryLabel}>Orders this month</span>
        </div>
      </section>
      ) : null}

      {Object.values(display.dashboard).some(Boolean) ? null : (
        <p className={styles.muted}>
          Every Dashboard block is hidden. Turn sections back on in Admin,
          Settings and customisation.
        </p>
      )}
    </div>
  );
}
