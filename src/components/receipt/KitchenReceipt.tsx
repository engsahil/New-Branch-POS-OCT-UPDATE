import type { KitchenReceiptModel, ReceiptWidth } from '@/services/receiptService';
import { receiptOrderTypeLabel } from '@/utils/receipt';
import styles from './Receipt.module.css';

export interface KitchenReceiptProps {
  model: KitchenReceiptModel;
  width: ReceiptWidth;
}

export function KitchenReceipt({ model, width }: KitchenReceiptProps) {
  return (
    <article
      className={`${styles.sheet} ${
        width === '58mm' ? styles.w58 : styles.w80
      } ${styles.kitchenSheet}`}
      data-receipt-width={width}
      aria-label={`Kitchen receipt for order ${model.orderNumber}`}
    >
      <header className={styles.kitchenHeader}>
        <h1 className={styles.kitchenTitle}>KITCHEN</h1>
      </header>

      <div className={styles.rule} />

      <dl className={styles.meta}>
        <div className={styles.metaRow}>
          <dt>Order</dt>
          <dd className={styles.metaValue}>#{model.orderNumber}</dd>
        </div>
        <div className={styles.metaRow}>
          <dt>Type</dt>
          <dd className={styles.metaValue}>{receiptOrderTypeLabel(model.orderType)}</dd>
        </div>
        {model.tableLabel ? (
          <div className={styles.metaRow}>
            <dt>Table</dt>
            <dd className={styles.metaValue}>{model.tableLabel}</dd>
          </div>
        ) : null}
        {/* The kitchen needs fulfilment context, not customer contact details. */}
        <div className={styles.metaRow}>
          <dt>Time</dt>
          <dd className={styles.metaValue}>{model.time}</dd>
        </div>
      </dl>

      <div className={styles.rule} />

      <ul className={styles.kitchenItems}>
        {model.lines.map((line) => (
          <li key={line.id} className={styles.kitchenItem}>
            <div className={styles.kitchenItemHead}>
              <span className={styles.kitchenQuantity}>{line.quantity}×</span>
              <span className={styles.kitchenName}>
                <strong>{line.name}</strong>
                {line.sizeLabel ? <span className={styles.size}> ({line.sizeLabel})</span> : null}
                {line.isDeal ? <span className={styles.dealTag}> DEAL</span> : null}
              </span>
            </div>

            {line.toppings.length > 0 ? (
              <ul className={styles.kitchenModifiers}>
                {line.toppings.map((topping, index) => (
                  <li key={`topping-${index}`}>Topping: {topping.name}</li>
                ))}
              </ul>
            ) : null}
            {line.addOns.length > 0 ? (
              <ul className={styles.kitchenModifiers}>
                {line.addOns.map((addOn, index) => (
                  <li key={`addon-${index}`}>Add-on: {addOn.name}</li>
                ))}
              </ul>
            ) : null}
            {line.isDeal && line.dealContents.length > 0 ? (
              <ul className={styles.kitchenModifiers}>
                {line.dealContents.map((entry, index) => (
                  <li key={`deal-${index}`}>{entry}</li>
                ))}
              </ul>
            ) : null}
            {line.note ? <p className={styles.kitchenNote}>Note: {line.note}</p> : null}
          </li>
        ))}
      </ul>

      {model.deliveryNotes ? (
        <p className={styles.kitchenNote}>Delivery instructions: {model.deliveryNotes}</p>
      ) : null}
      {model.note ? <p className={styles.kitchenNote}>Order note: {model.note}</p> : null}
    </article>
  );
}
