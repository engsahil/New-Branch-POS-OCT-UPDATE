import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTE_PATHS } from '@/app/routes';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  CartPanel,
  CustomerPicker,
  DealGrid,
  ItemGrid,
  OrderConfirmation,
} from '@/components/pos';
import { Button, EmptyState, Input, Textarea } from '@/components/ui';
import { PosIcon, SearchIcon } from '@/components/ui/Icons';
import { useCart } from '@/hooks/useCart';
import { useDeals } from '@/hooks/useDeals';
import { notifyCustomersChanged, useCustomers } from '@/hooks/useCustomers';
import { notifyInventoryChanged } from '@/hooks/useInventory';
import { notifySalesChanged } from '@/hooks/useSales';
import { useMenu } from '@/hooks/useMenu';
import { orderService, type CompletedOrder } from '@/services/orderService';
import { restaurantService } from '@/services/restaurantService';
import { SETTING_KEYS, settingsService } from '@/services/settingsService';
import type { CustomerRecord, OrderType } from '@/types/domain';
import type { CartCompletionInput } from '@/components/pos/CartPanel';
import styles from './PosPage.module.css';

export default function PosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { items, loading } = useMenu({ activeOnly: true, inStockOnly: true });
  const { deals } = useDeals(true);
  const { customers } = useCustomers();
  const cart = useCart();

  const [query, setQuery] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState<CompletedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the default POS flow unchanged; Delivery Management can open POS
  // directly in its existing delivery order mode using ?type=delivery.
  const [orderType, setOrderType] = useState<OrderType>(() =>
    new URLSearchParams(location.search).get('type') === 'delivery'
      ? 'delivery'
      : 'takeaway',
  );
  const [tableLabel, setTableLabel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(
    null,
  );
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [businessBranding, setBusinessBranding] = useState<{
    name: string;
    logoDataUrl: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void restaurantService
      .getRecord()
      .then((profile) => {
        if (!active || !profile?.logo?.dataUrl) return;
        setBusinessBranding({
          name: profile.name ?? '',
          logoDataUrl: profile.logo.dataUrl,
        });
      })
      .catch(() => {
        // The existing POS branding remains in place if profile storage fails.
      });
    return () => {
      active = false;
    };
  }, []);

  const term = query.trim().toLowerCase();
  const visible = term
    ? items.filter(
        (entry) =>
          entry.item.name.toLowerCase().includes(term) ||
          (entry.item.category ?? '').toLowerCase().includes(term),
      )
    : items;

  const visibleDeals = term
    ? deals.filter((view) => view.record.name.toLowerCase().includes(term))
    : deals;

  const hasSellable = items.length > 0 || deals.length > 0;
  const nothingMatched = visible.length === 0 && visibleDeals.length === 0;

  /**
   * Selecting a saved customer fills the order fields from that record.
   * Order type changes keep the selection, so switching from Takeaway to
   * Delivery never loses the details already entered.
   */
  function handleCustomerSelect(customer: CustomerRecord | null): void {
    setSelectedCustomer(customer);
    if (!customer) return;
    setCustomerName(customer.name ?? '');
    setCustomerPhone(customer.phone ?? '');
    // Replace the address rather than leaving the previous customer's one.
    setDeliveryAddress(customer.address ?? '');
  }

  function handleSelect(
    entry: (typeof items)[number],
    size: string,
  ): void {
    const price = entry.prices[size];
    if (price === null || price === undefined) return;

    cart.addLine({
      menuItemId: entry.item.id,
      itemPriceId: null,
      name: entry.item.name,
      sizeLabel: size,
      unitPrice: price,
      discountPercent: entry.item.discountPercent ?? null,
    });
  }

  async function handleComplete(payment: CartCompletionInput) {
    if (cart.isEmpty) return;

    // Validate table for dine-in
    if (orderType === 'dine-in' && !tableLabel.trim()) {
      setError('Enter table number for Dine-In.');
      return;
    }
    if (orderType === 'delivery' && !deliveryAddress.trim()) {
      setError('Enter a delivery address.');
      return;
    }

    setCompleting(true);
    setError(null);
    try {
      const result = await orderService.complete({
        lines: cart.lines,
        amountPaid: payment.amountPaid,
        discount: payment.discount,
        paymentMethod: payment.paymentMethod,
        orderType,
        tableLabel: orderType === 'dine-in' ? tableLabel.trim() : undefined,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerId: selectedCustomer?.id ?? null,
        deliveryAddress: orderType === 'delivery' ? deliveryAddress : undefined,
        deliveryNotes: orderType === 'delivery' ? deliveryNotes : undefined,
      });
      cart.clear();

      const autoShow = await settingsService.get<boolean>(
        SETTING_KEYS.autoShowReceipt,
        true,
      );
      setCompleted(autoShow ? result : null);
      notifyInventoryChanged();
      notifySalesChanged();
      notifyCustomersChanged();
    } catch {
      setError('Could not complete the order. Please try again.');
    } finally {
      setCompleting(false);
    }
  }

  if (completed) {
    return (
      <div className="page">
        <PageHeader title="POS" subtitle="Order saved to this device." />
        <OrderConfirmation
          completed={completed}
          onNewOrder={() => setCompleted(null)}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="POS"
        subtitle="Build an order and take payment."
        actions={
          hasSellable ? (
            <Input
              type="search"
              name="pos-search"
              placeholder="Search items"
              aria-label="Search items"
              leadingIcon={<SearchIcon />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null
        }
      />

      {businessBranding ? (
        <div className={styles.storeBrand}>
          <img
            src={businessBranding.logoDataUrl}
            alt={businessBranding.name ? `${businessBranding.name} logo` : 'Business logo'}
            className={styles.storeLogo}
            onError={() => setBusinessBranding(null)}
          />
          {businessBranding.name ? (
            <span className={styles.storeName}>{businessBranding.name}</span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className={styles.loading}>Loading menu…</p>
      ) : !hasSellable ? (
        <EmptyState
          fill
          icon={<PosIcon />}
          title="No items available"
          description="Add items to your menu and they will appear here, ready to be added to an order. Items that are out of stock are hidden automatically."
          action={
            <Button
              variant="secondary"
              onClick={() => navigate(ROUTE_PATHS.menu)}
            >
              Go to Menu
            </Button>
          }
        />
      ) : (
        <div className={styles.layout}>
          <div className={styles.items}>
            <div className={styles.orderTypes} role="group" aria-label="Order type">
              {(['dine-in', 'takeaway', 'delivery'] as OrderType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOrderType(type)}
                  className={`${styles.orderTypeButton} ${orderType === type ? styles.orderTypeActive : ''}`}
                  aria-pressed={orderType === type}
                >
                  {type === 'dine-in' ? 'Dine-In' : type === 'takeaway' ? 'Takeaway' : 'Delivery'}
                </button>
              ))}
            </div>

            <div className={styles.orderDetails}>
              {orderType === 'dine-in' ? (
                <Input
                  name="tableLabel"
                  label="Table number"
                  placeholder="Table number"
                  value={tableLabel}
                  onChange={(e) => setTableLabel(e.target.value)}
                />
              ) : null}

              <CustomerPicker
                customers={customers}
                selected={selectedCustomer}
                onSelect={handleCustomerSelect}
                emptyHint={
                  orderType === 'delivery'
                    ? 'Optional. Pick a saved customer to fill their phone and address.'
                    : 'Optional. Guest orders do not need a customer.'
                }
              />

              <div className={styles.customerFields}>
                <Input
                  name="customerName"
                  label="Customer name"
                  placeholder="Customer name"
                  value={customerName}
                  onChange={(e) => {
                    setSelectedCustomer(null);
                    setCustomerName(e.target.value);
                  }}
                />
                <Input
                  name="customerPhone"
                  label="Phone"
                  placeholder="Phone"
                  value={customerPhone}
                  onChange={(e) => {
                    setSelectedCustomer(null);
                    setCustomerPhone(e.target.value);
                  }}
                />
              </div>

              {orderType === 'delivery' ? (
                <div className={styles.deliveryFields}>
                  <Textarea
                    name="deliveryAddress"
                    label="Delivery address"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    rows={2}
                    maxLength={300}
                    fullWidth
                  />
                  <Textarea
                    name="deliveryNotes"
                    label="Special instructions (optional)"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    rows={2}
                    maxLength={500}
                    fullWidth
                  />
                </div>
              ) : null}
            </div>

            {nothingMatched ? (
              <EmptyState
                fill
                icon={<SearchIcon />}
                title="No items match your search"
                description={`Nothing found for "${query.trim()}".`}
                action={
                  <Button variant="secondary" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <>
                {visibleDeals.length > 0 ? (
                  <DealGrid
                    deals={visibleDeals}
                    onSelect={(view) =>
                      cart.addDeal({
                        dealId: view.record.id,
                        name: view.record.name,
                        unitPrice: view.dealPrice,
                      })
                    }
                  />
                ) : null}

                {visible.length > 0 ? (
                  <>
                    {visibleDeals.length > 0 ? (
                      <h2 className={styles.sectionTitle}>Items</h2>
                    ) : null}
                    <ItemGrid items={visible} onSelect={handleSelect} />
                  </>
                ) : null}
              </>
            )}
          </div>

          <div className={styles.cart}>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <CartPanel
              lines={cart.lines}
              totals={cart.totals}
              completing={completing}
              onDiscountChange={cart.setDiscount}
              onIncrement={cart.incrementLine}
              onDecrement={cart.decrementLine}
              onRemove={cart.removeLine}
              onClear={cart.clear}
              onComplete={(input) => void handleComplete(input)}
              onUpdateToppings={cart.updateLineToppings}
              onUpdateAddOns={cart.updateLineAddOns}
            />
          </div>
        </div>
      )}
    </div>
  );
}
