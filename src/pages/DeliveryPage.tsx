import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTE_PATHS } from '@/app/routes';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReceiptView } from '@/components/receipt';
import { Button, EmptyState, Input, Textarea } from '@/components/ui';
import {
  ChevronRightIcon,
  DeliveryIcon,
  PlusIcon,
  SearchIcon,
} from '@/components/ui/Icons';
import { useDeliveries } from '@/hooks/useDeliveries';
import {
  DELIVERY_STATUSES,
  deliveryService,
  deliveryStatusLabel,
  getDeliveryStatus,
  type DeliveryDetails,
} from '@/services/deliveryService';
import { receiptService } from '@/services/receiptService';
import type { DeliveryRider, DeliveryStatus, OrderRecord } from '@/types/domain';
import { formatMoney } from '@/utils/currency';
import { formatDate, formatDateTime, formatTime } from '@/utils/date';
import { formatPaymentMethod } from '@/utils/payment';
import styles from './DeliveryPage.module.css';

function localDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function displayTime(value: string): string {
  return Number.isFinite(new Date(value).getTime())
    ? formatDateTime(value)
    : 'Time unavailable';
}

function riderName(order: OrderRecord, riders: DeliveryRider[]): string {
  if (!order.assignedRiderId) return 'Unassigned';
  return (
    riders.find((rider) => rider.id === order.assignedRiderId)?.name ??
    'Former rider'
  );
}

function statusClass(status: DeliveryStatus): string {
  switch (status) {
    case 'delivered':
      return styles.statusDelivered ?? '';
    case 'cancelled':
      return styles.statusCancelled ?? '';
    case 'preparing':
    case 'ready-for-delivery':
    case 'assigned':
    case 'out-for-delivery':
      return styles.statusActive ?? '';
    case 'confirmed':
      return styles.statusConfirmed ?? '';
    default:
      return styles.statusPending ?? '';
  }
}

export default function DeliveryPage() {
  const navigate = useNavigate();
  const { deliveries, riders, loading, error, reload } = useDeliveries();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('');
  const [riderFilter, setRiderFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showRiders, setShowRiders] = useState(false);
  const [riderNameInput, setRiderNameInput] = useState('');
  const [riderPhoneInput, setRiderPhoneInput] = useState('');
  const [riderError, setRiderError] = useState<string | null>(null);
  const [savingRider, setSavingRider] = useState(false);

  const today = localDateKey(new Date());
  const term = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      deliveries.filter((order) => {
        const currentStatus = getDeliveryStatus(order);
        if (statusFilter && currentStatus !== statusFilter) return false;
        if (riderFilter === 'unassigned' && order.assignedRiderId) return false;
        if (riderFilter && riderFilter !== 'unassigned' && order.assignedRiderId !== riderFilter) return false;
        const orderDate = localDateKey(order.completedAt ?? order.createdAt);
        if (dateFrom && orderDate < dateFrom) return false;
        if (dateTo && orderDate > dateTo) return false;
        if (!term) return true;
        return [
          order.orderNumber,
          order.customerName,
          order.customerPhone,
          order.deliveryAddress,
        ].some((value) => value?.toLowerCase().includes(term));
      }),
    [deliveries, dateFrom, dateTo, riderFilter, statusFilter, term],
  );

  const metrics: {
    label: string;
    status?: DeliveryStatus;
    today?: boolean;
    value: number;
    tone: string | undefined;
  }[] = [
    {
      label: 'Pending',
      status: 'pending',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'pending').length,
      tone: styles.metricPending,
    },
    {
      label: 'Confirmed',
      status: 'confirmed',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'confirmed').length,
      tone: styles.metricConfirmed,
    },
    {
      label: 'Preparing',
      status: 'preparing',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'preparing').length,
      tone: styles.metricPreparing,
    },
    {
      label: 'Ready for delivery',
      status: 'ready-for-delivery',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'ready-for-delivery').length,
      tone: styles.metricReady,
    },
    {
      label: 'Assigned',
      status: 'assigned',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'assigned').length,
      tone: styles.metricAssigned,
    },
    {
      label: 'Out for delivery',
      status: 'out-for-delivery',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'out-for-delivery').length,
      tone: styles.metricOut,
    },
    {
      label: 'Delivered',
      status: 'delivered',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'delivered').length,
      tone: styles.metricDelivered,
    },
    {
      label: 'Cancelled',
      status: 'cancelled',
      value: deliveries.filter((order) => getDeliveryStatus(order) === 'cancelled').length,
      tone: styles.metricCancelled,
    },
    {
      label: 'Today’s orders',
      today: true,
      value: deliveries.filter(
        (order) => localDateKey(order.completedAt ?? order.createdAt) === today,
      ).length,
      tone: styles.metricToday,
    },
  ];

  async function addRider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingRider(true);
    setRiderError(null);
    try {
      await deliveryService.addRider({
        name: riderNameInput,
        phone: riderPhoneInput,
      });
      setRiderNameInput('');
      setRiderPhoneInput('');
      await reload();
    } catch (err) {
      setRiderError(err instanceof Error ? err.message : 'Could not save rider.');
    } finally {
      setSavingRider(false);
    }
  }

  async function toggleRider(rider: DeliveryRider) {
    setRiderError(null);
    try {
      await deliveryService.setRiderActive(rider.id, !rider.isActive);
      await reload();
    } catch {
      setRiderError('Could not update rider availability.');
    }
  }

  if (selectedOrderId) {
    return (
      <DeliveryDetailView
        orderId={selectedOrderId}
        riders={riders}
        onBack={() => setSelectedOrderId(null)}
        onUpdated={() => void reload()}
      />
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Delivery Management"
        subtitle="Track delivery orders, customers, riders and fulfilment progress."
        actions={
          <Button
            onClick={() => navigate(`${ROUTE_PATHS.pos}?type=delivery`)}
            leadingIcon={<PlusIcon width={16} height={16} />}
          >
            New delivery order
          </Button>
        }
      />

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.metrics} aria-label="Delivery overview">
        {metrics.map((metric) => (
          <button
            key={metric.label}
            type="button"
            className={`${styles.metric} ${metric.tone ?? ''}`}
            onClick={() => {
              setStatusFilter(metric.status ?? '');
              if (metric.today) {
                setDateFrom(today);
                setDateTo(today);
              }
              setSelectedOrderId(null);
            }}
            title={
              metric.today
                ? "Filter today's deliveries"
                : `Filter ${metric.label.toLowerCase()} deliveries`
            }
          >
            <span className={styles.metricValue}>{metric.value}</span>
            <span className={styles.metricLabel}>{metric.label}</span>
          </button>
        ))}
      </section>

      <section className={styles.panel} aria-label="Delivery orders">
        <div className={styles.filters}>
          <Input
            type="search"
            name="deliverySearch"
            label="Search deliveries"
            placeholder="Order, customer, phone or address"
            leadingIcon={<SearchIcon width={16} height={16} />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className={styles.filterField}>
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as DeliveryStatus | '')}
              className={styles.select}
            >
              <option value="">All statuses</option>
              {DELIVERY_STATUSES.map((status) => (
                <option key={status} value={status}>{deliveryStatusLabel(status)}</option>
              ))}
            </select>
          </label>
          <label className={styles.filterField}>
            <span>Rider</span>
            <select
              value={riderFilter}
              onChange={(event) => setRiderFilter(event.target.value)}
              className={styles.select}
            >
              <option value="">All riders</option>
              <option value="unassigned">Unassigned</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>{rider.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.filterField}>
            <span>From</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={styles.dateInput} />
          </label>
          <label className={styles.filterField}>
            <span>To</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={styles.dateInput} />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setStatusFilter('');
              setRiderFilter('');
              setDateFrom('');
              setDateTo('');
            }}
          >
            Clear filters
          </Button>
        </div>

        {showRiders ? (
          <div className={styles.riderManager}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Delivery riders</h2>
                <p className={styles.sectionHint}>Add the delivery people available for assignment.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowRiders(false)}>Close</Button>
            </div>
            <form className={styles.riderForm} onSubmit={(event) => void addRider(event)}>
              <Input
                label="Rider name"
                name="riderName"
                value={riderNameInput}
                onChange={(event) => setRiderNameInput(event.target.value)}
                required
                maxLength={80}
              />
              <Input
                label="Phone (optional)"
                name="riderPhone"
                type="tel"
                value={riderPhoneInput}
                onChange={(event) => setRiderPhoneInput(event.target.value)}
                maxLength={30}
              />
              <Button type="submit" disabled={savingRider || !riderNameInput.trim()}>
                {savingRider ? 'Saving' : 'Add rider'}
              </Button>
            </form>
            {riderError ? <p className={styles.error} role="alert">{riderError}</p> : null}
            {riders.length ? (
              <ul className={styles.riderList}>
                {riders.map((rider) => (
                  <li key={rider.id} className={styles.riderRow}>
                    <span>
                      <strong>{rider.name}</strong>
                      {rider.phone ? <small>{rider.phone}</small> : null}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => void toggleRider(rider)}>
                      {rider.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.sectionHint}>No riders added yet.</p>}
          </div>
        ) : null}

        <div className={styles.listHead}>
          <div>
            <h2 className={styles.sectionTitle}>Delivery orders</h2>
            <p className={styles.sectionHint}>{visible.length} of {deliveries.length} orders</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowRiders(true)}>
            Manage riders
          </Button>
        </div>

        {loading ? (
          <p className={styles.emptyMessage}>Loading delivery orders…</p>
        ) : deliveries.length === 0 ? (
          <EmptyState
            icon={<DeliveryIcon />}
            title="No delivery orders yet"
            description="Create a delivery order from POS to track its progress here."
            action={<Button onClick={() => navigate(`${ROUTE_PATHS.pos}?type=delivery`)}>Create delivery order</Button>}
          />
        ) : visible.length === 0 ? (
          <p className={styles.emptyMessage}>No delivery orders match these filters.</p>
        ) : (
          <ul className={styles.orderList}>
            {visible.map((order) => {
              const status = getDeliveryStatus(order);
              const when = order.completedAt ?? order.createdAt;
              return (
                <li key={order.id}>
                  <button
                    type="button"
                    className={styles.orderRow}
                    onClick={() => setSelectedOrderId(order.id)}
                  >
                    <span className={styles.orderMain}>
                      <span className={styles.orderTitle}>
                        <strong>#{order.orderNumber}</strong>
                        <span className={`${styles.statusBadge} ${statusClass(status)}`}>
                          {deliveryStatusLabel(status)}
                        </span>
                      </span>
                      <span className={styles.orderMeta}>
                        {order.customerName || 'Customer not recorded'}
                        {order.customerPhone ? ` · ${order.customerPhone}` : ''}
                        {' · '}{formatDate(when)} at {formatTime(when)}
                      </span>
                      <span className={styles.orderMeta}>
                        {order.deliveryAddress || 'No delivery address recorded'}
                        {' · '}{riderName(order, riders)}
                      </span>
                    </span>
                    <span className={styles.orderTotal}>{formatMoney(order.grandTotal)}</span>
                    <ChevronRightIcon width={18} height={18} className={styles.rowArrow} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DeliveryDetailView({
  orderId,
  riders,
  onBack,
  onUpdated,
}: {
  orderId: string;
  riders: DeliveryRider[];
  onBack: () => void;
  onUpdated: () => void;
}) {
  const [details, setDetails] = useState<DeliveryDetails | null>(null);
  const [status, setStatus] = useState<DeliveryStatus>('pending');
  const [assignedRiderId, setAssignedRiderId] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof receiptService.build>> | null>(null);

  const loadDetails = useCallback(async (): Promise<void> => {
    const loaded = await deliveryService.getDetails(orderId);
    if (!loaded) {
      setDetails(null);
      setError('This delivery order could not be found.');
      return;
    }
    setDetails(loaded);
    setStatus(getDeliveryStatus(loaded.order));
    setAssignedRiderId(loaded.order.assignedRiderId ?? '');
    setAddress(loaded.order.deliveryAddress || loaded.customer?.address || '');
    setNotes(loaded.order.deliveryNotes ?? '');
  }, [orderId]);

  useEffect(() => {
    let active = true;
    void loadDetails().catch(() => {
      if (active) setError('Could not load delivery details.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadDetails]);

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    setSaving(true);
    setError(null);
    try {
      await deliveryService.update(orderId, {
        status,
        assignedRiderId: assignedRiderId || null,
        address,
        notes,
      });
      await loadDetails();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update delivery.');
    } finally {
      setSaving(false);
    }
  }

  async function openReceipt() {
    if (!details) return;
    setReceiptLoading(true);
    setError(null);
    try {
      const receiptOrder: OrderRecord = {
        ...details.order,
        customerName: details.order.customerName || details.customer?.name,
        customerPhone: details.order.customerPhone || details.customer?.phone,
        deliveryAddress:
          details.order.deliveryAddress || details.customer?.address,
      };
      setReceipt(await receiptService.build(receiptOrder, details.items));
      setShowReceipt(true);
    } catch {
      setError('Could not prepare the delivery receipt.');
    } finally {
      setReceiptLoading(false);
    }
  }

  if (showReceipt && receipt) {
    return (
      <div className="page">
        <PageHeader title="Delivery receipt" subtitle={`Order #${receipt.orderNumber}`} />
        <ReceiptView
          model={receipt}
          deliveryReceipt
          actions={<Button variant="secondary" onClick={() => setShowReceipt(false)}>Back to delivery</Button>}
        />
      </div>
    );
  }

  if (loading) {
    return <div className="page"><p className={styles.emptyMessage}>Loading delivery details…</p></div>;
  }
  if (!details) {
    return (
      <div className="page">
        <PageHeader title="Delivery details" />
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <Button variant="secondary" onClick={onBack}>Back to deliveries</Button>
      </div>
    );
  }

  const { order, items, customer, rider } = details;
  const currentStatus = getDeliveryStatus(order);
  const orderAt = order.completedAt ?? order.createdAt;
  const displayName = customer?.name || order.customerName || 'Customer not recorded';
  const displayPhone = customer?.phone || order.customerPhone;
  const storedHistory = order.deliveryHistory ?? [];
  const history = storedHistory.length
    ? storedHistory[storedHistory.length - 1]?.status === currentStatus
      ? storedHistory
      : [
          ...storedHistory,
          {
            status: currentStatus,
            at: order.cancelledAt ?? order.completedAt ?? order.createdAt,
            message: currentStatus === 'cancelled' ? 'Order cancelled.' : `Status is ${deliveryStatusLabel(currentStatus)}.`,
          },
        ]
    : [{
        status: currentStatus,
        at: order.completedAt ?? order.createdAt,
        message: 'Delivery order created.',
      }];
  const amountPaid = order.amountPaid;
  const paymentState = amountPaid == null
    ? 'Not recorded'
    : amountPaid >= order.grandTotal
      ? 'Paid'
      : amountPaid > 0
        ? 'Partially paid'
        : 'Unpaid';
  const canUpdate = order.status === 'completed';

  return (
    <div className="page">
      <PageHeader
        title={`Delivery #${order.orderNumber}`}
        subtitle={`${displayName} · ${formatDate(orderAt)} at ${formatTime(orderAt)}`}
        actions={<Button variant="secondary" onClick={onBack}>Back to deliveries</Button>}
      />

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!canUpdate ? <p className={styles.notice}>The related sale is {order.status}; delivery updates are locked.</p> : null}

      <div className={styles.detailGrid}>
        <section className={styles.panel}>
          <div className={styles.detailHeading}>
            <div>
              <h2 className={styles.sectionTitle}>Order details</h2>
              <span className={`${styles.statusBadge} ${statusClass(currentStatus)}`}>
                {deliveryStatusLabel(currentStatus)}
              </span>
            </div>
            <Button variant="secondary" onClick={() => void openReceipt()} disabled={receiptLoading}>
              {receiptLoading ? 'Preparing receipt' : 'Delivery receipt'}
            </Button>
          </div>

          <dl className={styles.facts}>
            <div><dt>Order type</dt><dd>Delivery</dd></div>
            <div><dt>Customer</dt><dd>{displayName}</dd></div>
            {displayPhone ? <div><dt>Phone</dt><dd>{displayPhone}</dd></div> : null}
            <div><dt>Address</dt><dd>{order.deliveryAddress || customer?.address || 'No delivery address recorded'}</dd></div>
            {rider ? <div><dt>Assigned rider</dt><dd>{rider.name}{rider.phone ? ` · ${rider.phone}` : ''}</dd></div> : null}
            <div><dt>Order date</dt><dd>{displayTime(orderAt)}</dd></div>
            {order.deliveryCompletedAt ? <div><dt>Delivered</dt><dd>{displayTime(order.deliveryCompletedAt)}</dd></div> : null}
          </dl>

          <h3 className={styles.subheading}>Items</h3>
          {items.length ? (
            <ul className={styles.itemList}>
              {items.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.quantity} × {item.name}{item.sizeLabel ? ` (${item.sizeLabel})` : ''}</strong>
                    {item.toppings?.length ? <small>{item.toppings.map((entry) => entry.name).join(', ')}</small> : null}
                    {item.addOns?.length ? <small>{item.addOns.map((entry) => entry.name).join(', ')}</small> : null}
                    {item.note ? <small>Note: {item.note}</small> : null}
                  </span>
                  <strong>{formatMoney(item.lineTotal)}</strong>
                </li>
              ))}
            </ul>
          ) : <p className={styles.sectionHint}>No item details were saved for this order.</p>}

          <dl className={styles.facts}>
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotal)}</dd></div>
            {order.discountTotal > 0 ? <div><dt>Discount</dt><dd>-{formatMoney(order.discountTotal)}</dd></div> : null}
            {order.taxTotal > 0 ? <div><dt>Tax</dt><dd>{formatMoney(order.taxTotal)}</dd></div> : null}
            <div className={styles.grandTotal}><dt>Order total</dt><dd>{formatMoney(order.grandTotal)}</dd></div>
            <div><dt>Payment status</dt><dd>{paymentState}</dd></div>
            {amountPaid != null ? <div><dt>Paid · {formatPaymentMethod(order.paymentMethod ?? 'other')}</dt><dd>{formatMoney(amountPaid)}</dd></div> : null}
            {order.changeDue != null && order.changeDue > 0 ? <div><dt>Change</dt><dd>{formatMoney(order.changeDue)}</dd></div> : null}
          </dl>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.sectionTitle}>Delivery progress</h2>
          <form className={styles.updateForm} onSubmit={(event) => void saveDetails(event)}>
            <label className={styles.filterField}>
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as DeliveryStatus)} className={styles.select} disabled={!canUpdate || saving}>
                {DELIVERY_STATUSES.map((entry) => <option key={entry} value={entry}>{deliveryStatusLabel(entry)}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Rider</span>
              <select value={assignedRiderId} onChange={(event) => setAssignedRiderId(event.target.value)} className={styles.select} disabled={!canUpdate || saving}>
                <option value="">Unassigned</option>
                {riders.filter((entry) => entry.isActive || entry.id === order.assignedRiderId).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}{entry.isActive ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </label>
            <Textarea
              label="Delivery address"
              name="deliveryAddressEdit"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              rows={2}
              maxLength={300}
              required
              disabled={!canUpdate || saving}
              fullWidth
            />
            <Textarea
              label="Special instructions"
              name="deliveryNotesEdit"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={500}
              disabled={!canUpdate || saving}
              fullWidth
            />
            <Button type="submit" disabled={!canUpdate || saving}>
              {saving ? 'Saving' : 'Save delivery updates'}
            </Button>
          </form>

          <h3 className={styles.subheading}>Progress history</h3>
          <ol className={styles.history}>
            {history.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <span className={styles.historyDot} />
                <span className={styles.historyBody}>
                  <strong>{entry.message || deliveryStatusLabel(entry.status)}</strong>
                  <small>{displayTime(entry.at)}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
