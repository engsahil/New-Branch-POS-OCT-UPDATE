import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { CloseIcon, MinusIcon, PlusIcon } from '@/components/ui/Icons';
import {
  lineDiscount,
  lineTotal,
  lineUnitTotal,
  type CartLine,
  type CartTotals,
} from '@/services/orderService';
import { formatMoney, parseMoney } from '@/utils/currency';
import { PAYMENT_METHOD_OPTIONS } from '@/utils/payment';
import type { Paisa } from '@/types/common';
import type { PaymentMethod, AddOnRecord, ToppingRecord } from '@/types/domain';
import { useToppings } from '@/hooks/useToppings';
import { useAddOns } from '@/hooks/useAddOns';
import type { SelectedAddOn, SelectedTopping } from '@/types/domain';
import styles from './CartPanel.module.css';

export interface CartCompletionInput {
  amountPaid: Paisa;
  discount: Paisa;
  paymentMethod: PaymentMethod;
}

export interface CartPanelProps {
  lines: CartLine[];
  totals: CartTotals;
  completing: boolean;
  /** Push the typed discount into the cart so totals recalculate live. */
  onDiscountChange: (value: Paisa) => void;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  onRemove: (key: string) => void;
  onSplit: (key: string) => void;
  onClear: () => void;
  onComplete: (input: CartCompletionInput) => void;
  onUpdateToppings: (key: string, toppings: SelectedTopping[]) => void;
  onUpdateAddOns: (key: string, addOns: SelectedAddOn[]) => void;
}

export function CartPanel({
  lines,
  totals,
  completing,
  onDiscountChange,
  onIncrement,
  onDecrement,
  onRemove,
  onSplit,
  onClear,
  onComplete,
  onUpdateToppings,
  onUpdateAddOns,
}: CartPanelProps) {
  const empty = lines.length === 0;
  const { items: availableToppings } = useToppings(true);
  const { items: availableAddOns } = useAddOns(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picker, setPicker] = useState<'toppings' | 'addons' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paymentOpen) paymentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [paymentOpen]);

  /*
   * Customer paid amount. Empty means the customer pays the exact total,
   * which keeps the common case one tap; a typed amount immediately drives
   * the return calculation below.
   */
  const [paidText, setPaidText] = useState('');
  /* Discount entry, kept as text so partial input like "12." stays editable. */
  const [discountText, setDiscountText] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

  useEffect(() => {
    if (lines.length === 0) {
      setPaidText('');
      setDiscountText('');
      setPaymentMethod('cash');
      setPaymentOpen(false);
      setExpanded(null);
      setPicker(null);
    }
  }, [lines.length]);

  // Push the typed discount into the cart so totals recalculate immediately.
  useEffect(() => {
    const parsed =
      discountText.trim() === '' ? 0 : (parseMoney(discountText) ?? 0);
    onDiscountChange(parsed);
  }, [discountText, onDiscountChange]);

  const total = totals.grandTotal;
  const paid: Paisa =
    paidText.trim() === '' ? total : (parseMoney(paidText) ?? total);
  const shortfall: Paisa =
    paidText.trim() === '' ? 0 : Math.max(0, total - paid);
  const returnAmount: Paisa = Math.max(0, paid - total);

  const enteredDiscount: Paisa =
    discountText.trim() === '' ? 0 : (parseMoney(discountText) ?? 0);
  // Item-level discounts already use part of the subtotal, so the order
  // discount may only fill what is left.
  const discountRoom = Math.max(
    0,
    totals.subtotal - totals.itemDiscountTotal,
  );
  const discountInvalid = enteredDiscount > discountRoom;

  function handlePaidChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    // Digits and at most one decimal point — same rule as PriceInput.
    if (next !== '' && !/^\d*\.?\d{0,2}$/.test(next)) return;
    setPaidText(next);
  }

  function handleDiscountChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    if (next !== '' && !/^\d*\.?\d{0,2}$/.test(next)) return;
    setDiscountText(next);
  }

  function toggleExpand(key: string, type: 'toppings' | 'addons') {
    if (expanded === key && picker === type) {
      setExpanded(null);
      setPicker(null);
    } else {
      setExpanded(key);
      setPicker(type);
    }
  }

  function applicable(record: AddOnRecord | ToppingRecord, line: CartLine) {
    return !record.menuItemIds?.length || Boolean(line.menuItemId && record.menuItemIds.includes(line.menuItemId));
  }

  function toggleTopping(line: CartLine, record: ToppingRecord) {
    const exists = line.toppings.some((t) => t.modifierId === record.id || (!t.modifierId && t.name === record.name));
    const next = exists
      ? line.toppings.filter((t) => t.modifierId ? t.modifierId !== record.id : t.name !== record.name)
      : [...line.toppings, { modifierId: record.id, name: record.name, price: record.price }];
    onUpdateToppings(line.key, next);
  }

  function toggleAddOn(line: CartLine, record: AddOnRecord) {
    const exists = line.addOns.some((a) => a.modifierId === record.id || (!a.modifierId && a.name === record.name));
    const next = exists
      ? line.addOns.filter((a) => a.modifierId ? a.modifierId !== record.id : a.name !== record.name)
      : [...line.addOns, { modifierId: record.id, name: record.name, price: record.price }];
    onUpdateAddOns(line.key, next);
  }

  return (
    <aside className={styles.panel} aria-label="Current order">
      <header className={styles.header}>
        <h2 className={styles.title}>Current order</h2>
        {!empty ? (
          <span className={styles.count}>
            {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </header>

      {empty ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>No items yet</p>
          <p className={styles.emptyHint}>
            Tap a size on an item to add it to the order.
          </p>
        </div>
      ) : (
        <div className={styles.orderBody}>
          <div className={styles.listHeading}>
            <span>Order items</span>
            <span>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
          </div>
          <ul className={styles.lines} aria-label="Order items">
            {lines.map((line, lineIndex) => {
              const label = line.sizeLabel ? `${line.name} (${line.sizeLabel})` : line.name;
              const isExpanded = expanded === line.key;
              const instanceLabel = `${label}, item ${lineIndex + 1}`;
              const itemSaving = lineDiscount(line);
              const lineGross = lineTotal(line);
              const modifiers = [
                ...line.toppings.map((entry, index) => ({ ...entry, type: 'Topping', key: `topping-${entry.modifierId ?? index}` })),
                ...line.addOns.map((entry, index) => ({ ...entry, type: 'Add-on', key: `addon-${entry.modifierId ?? index}` })),
              ];
              return (
                <li key={line.key} className={styles.line} data-cart-line={line.key} aria-label={instanceLabel}>
                  <div className={styles.lineHeading}>
                    <h3 className={styles.lineName}>{line.name}</h3>
                    <button type="button" className={styles.remove} onClick={() => onRemove(line.key)}
                      aria-label={`Remove ${instanceLabel}`} title="Remove item" disabled={completing}>
                      <CloseIcon width={16} height={16} />
                    </button>
                  </div>
                  <dl className={styles.lineDetails}>
                    <div><dt>{line.kind === 'deal' ? 'Type' : 'Size'}</dt><dd>{line.sizeLabel || (line.kind === 'deal' ? 'Deal' : 'Standard')}</dd></div>
                    <div><dt>Unit price</dt><dd>{formatMoney(lineUnitTotal(line))}</dd></div>
                  </dl>
                  {modifiers.length ? <ul className={styles.modifierSummary} aria-label={`Selected options for ${instanceLabel}`}>
                    {modifiers.map((entry) => <li key={entry.key}>
                      <span>{entry.name}<small>{entry.type}</small></span>
                      <span>{entry.price ? `+${formatMoney(entry.price)}` : 'Free'}</span>
                    </li>)}
                  </ul> : <p className={styles.noModifiers}>No add-ons or toppings selected</p>}
                  <div className={styles.lineControls}>
                    <div className={styles.stepper} role="group" aria-label={`Quantity for ${instanceLabel}`}>
                      <button type="button" className={styles.stepButton} onClick={() => onDecrement(line.key)}
                        aria-label={`Decrease ${instanceLabel} quantity`} disabled={completing}><MinusIcon width={16} height={16} /></button>
                      <span className={styles.quantity} aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
                      <button type="button" className={styles.stepButton} onClick={() => onIncrement(line.key)}
                        aria-label={`Increase ${instanceLabel} quantity`} disabled={completing}><PlusIcon width={16} height={16} /></button>
                    </div>
                    <div className={styles.lineSubtotal}><span>Item subtotal</span><strong>{formatMoney(lineGross - itemSaving)}</strong></div>
                  </div>
                  {itemSaving > 0 ? <p className={styles.saving}>Includes {line.discountPercent}% item discount · save {formatMoney(itemSaving)}</p> : null}
                  <div className={styles.modifierActions}>
                    {(['toppings', 'addons'] as const).map((type) => {
                      const count = type === 'toppings' ? line.toppings.length : line.addOns.length;
                      return <button key={type} type="button" className={styles.modifierButton}
                        aria-label={`${type === 'toppings' ? 'Toppings' : 'Add-ons'} for ${instanceLabel}`}
                        aria-expanded={isExpanded && picker === type} aria-controls={isExpanded && picker === type ? `modifier-picker-${lineIndex}` : undefined}
                        disabled={completing} onClick={() => toggleExpand(line.key, type)}>
                        {type === 'toppings' ? 'Toppings' : 'Add-ons'}{count ? ` (${count})` : ''}
                      </button>;
                    })}
                    {line.quantity > 1 ? <button type="button" className={styles.splitButton} disabled={completing}
                      aria-label={`Split one ${instanceLabel}`} onClick={() => onSplit(line.key)}>Split one item</button> : null}
                  </div>
                  {line.quantity > 1 ? <p className={styles.lineHint}>Options apply to all {line.quantity} units. Split one to customise a single item.</p> : null}
                  {isExpanded ? <div className={styles.modifierPicker} id={`modifier-picker-${lineIndex}`}>
                    {(() => {
                      const catalog = picker === 'toppings' ? availableToppings : availableAddOns;
                      const choices = catalog.filter((record) => applicable(record, line));
                      const selected = picker === 'toppings' ? line.toppings : line.addOns;
                      return <>
                        <p className={styles.lineHint}>Changes apply only to this order line.{line.kind === 'deal' ? ' Product-specific options belong to individual products.' : ''}</p>
                        {choices.length === 0 ? <span className={styles.lineHint}>No applicable {picker === 'toppings' ? 'toppings' : 'add-ons'} configured. Manage these in Settings.</span> : choices.map((record) => {
                          const checked = selected.some((entry) => entry.modifierId === record.id || (!entry.modifierId && entry.name === record.name));
                          return <label key={record.id} className={styles.modifierChoice}>
                            <input type="checkbox" checked={checked} onChange={() => picker === 'toppings' ? toggleTopping(line, record as ToppingRecord) : toggleAddOn(line, record as AddOnRecord)} />
                            <span>{record.name}</span><span>{record.price ? `+${formatMoney(record.price)}` : 'Free'}</span>
                          </label>;
                        })}
                        {selected.length ? <div className={styles.selectedModifiers}>
                          {selected.map((entry, index) => <button type="button" key={entry.modifierId ?? `${entry.name}-${index}`}
                            aria-label={`Remove ${entry.name} from ${instanceLabel}`}
                            onClick={() => picker === 'toppings'
                              ? onUpdateToppings(line.key, line.toppings.filter((_, i) => i !== index))
                              : onUpdateAddOns(line.key, line.addOns.filter((_, i) => i !== index))}>
                            {entry.name} · {formatMoney(entry.price)} ×
                          </button>)}
                        </div> : null}
                      </>;
                    })()}
                  </div> : null}
                </li>
              );
            })}
          </ul>
        {!empty && paymentOpen ? (
          <div className={styles.payment} id="cart-payment-fields" ref={paymentRef}>
            <Input
              label="Discount"
              name="discount"
              value={discountText}
              onChange={handleDiscountChange}
              placeholder={`0 (max ${formatMoney(discountRoom)})`}
              inputMode="decimal"
              autoComplete="off"
              disabled={completing}
              invalid={discountInvalid}
              hint={
                discountInvalid
                  ? `Discount cannot exceed ${formatMoney(discountRoom)}.`
                  : undefined
              }
              fullWidth
            />
            <Input
              label="Customer paid"
              name="amountPaid"
              value={paidText}
              onChange={handlePaidChange}
              placeholder={formatMoney(total)}
              inputMode="decimal"
              autoComplete="off"
              disabled={completing}
              invalid={shortfall > 0}
              hint={
                shortfall > 0 ? `Short by ${formatMoney(shortfall)}.` : undefined
              }
              fullWidth
            />
            <div className={styles.returnRow}>
              <span className={styles.returnLabel}>Return / Change</span>
              <span
                className={
                  returnAmount > 0
                    ? `${styles.returnValue} ${styles.returnValueActive}`
                    : styles.returnValue
                }
              >
                {formatMoney(returnAmount)}
              </span>
            </div>

            <div
              className={styles.methods}
              role="radiogroup"
              aria-label="Payment method"
            >
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <label key={option.value} className={styles.method}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    className={styles.methodInput}
                    checked={paymentMethod === option.value}
                    onChange={() => setPaymentMethod(option.value)}
                    disabled={completing}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        </div>
      )}

      <footer className={`${styles.footer}`}>
        <dl className={styles.totals}>
          <div className={styles.totalRow}>
            <dt>Subtotal</dt>
            <dd>{formatMoney(totals.subtotal)}</dd>
          </div>

          <div className={`${styles.totalRow} ${styles.discountRow}`}>
            <dt>Discount</dt><dd>{totals.discountTotal > 0 ? '−' : ''}{formatMoney(totals.discountTotal)}</dd>
          </div>

          <div className={styles.totalRow}><dt>Tax ({totals.taxPercent}%{totals.taxInclusive ? ', included' : ''})</dt><dd>{formatMoney(totals.taxTotal)}</dd></div>

          <div className={`${styles.totalRow} ${styles.grandRow}`}>
            <dt>Grand total</dt>
            <dd className={styles.grandValue}>
              {formatMoney(totals.grandTotal)}
            </dd>
          </div>
        </dl>



        {!empty ? <button type="button" className={styles.paymentToggle} aria-expanded={paymentOpen}
          aria-controls="cart-payment-fields" onClick={() => setPaymentOpen((value) => !value)}>
          <span>Discount & payment</span><span>{paymentOpen ? 'Hide' : 'Edit'}</span>
        </button> : null}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={onClear}
            disabled={empty || completing}
          >
            Clear
          </Button>
          <Button
            onClick={() =>
              onComplete({
                amountPaid: paid,
                // Only the discount typed here: item-level discounts are
                // recomputed from the lines themselves inside complete().
                discount: enteredDiscount,
                paymentMethod,
              })
            }
            disabled={empty || completing || shortfall > 0 || discountInvalid}
            fullWidth
          >
            {completing ? 'Completing' : 'Complete order'}
          </Button>
        </div>
      </footer>
    </aside>
  );
}
