import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { printReceipt } from '@/services/printService';
import {
  RECEIPT_WIDTHS,
  receiptService,
  type KitchenReceiptModel,
  type ReceiptModel,
  type ReceiptWidth,
} from '@/services/receiptService';
import { PrintPanel } from './PrintPanel';
import { Receipt } from './Receipt';
import { KitchenReceipt } from './KitchenReceipt';
import styles from './ReceiptView.module.css';

export interface ReceiptViewProps {
  model: ReceiptModel;
  kitchenModel?: KitchenReceiptModel;
  deliveryReceipt?: boolean;
  actions?: React.ReactNode;
}

export function ReceiptView({
  model,
  kitchenModel,
  deliveryReceipt = false,
  actions,
}: ReceiptViewProps) {
  const [width, setWidth] = useState<ReceiptWidth | null>(null);
  const [showPrinter, setShowPrinter] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'customer' | 'kitchen'>('customer');
  const customerRef = useRef<HTMLDivElement>(null);
  const kitchenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void receiptService.getWidth().then((stored) => {
      if (active) setWidth(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  function choose(next: ReceiptWidth) {
    setWidth(next);
    void receiptService.setWidth(next);
  }

  if (width === null) {
    return <p className={styles.loading}>Loading receipt…</p>;
  }

  const kitchen: KitchenReceiptModel = kitchenModel ?? {
    orderNumber: model.orderNumber,
    orderId: model.orderId,
    date: model.date,
    time: model.time,
    orderType: model.orderType,
    tableLabel: model.tableLabel,
    customerName: model.customerName,
    customerPhone: model.customerPhone,
    deliveryAddress: model.deliveryAddress,
    deliveryNotes: model.deliveryNotes,
    note: model.note,
    lines: model.lines,
    itemCount: model.itemCount,
  };

  const currentRef = activeTab === 'customer' ? customerRef : kitchenRef;

  function receiptElement(ref: React.RefObject<HTMLDivElement>): HTMLElement | null {
    return ref.current?.querySelector<HTMLElement>('[data-receipt-width]') ?? null;
  }

  async function printCurrent() {
    setPrintError(null);
    setPrintStatus(null);
    setPrinting(true);
    try {
      await printReceipt({
        width: width as ReceiptWidth,
        container: receiptElement(currentRef),
      });
      setPrintStatus('Receipt print dialog closed. Confirm the selected printer accepted the job.');
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Could not print the receipt.');
    } finally {
      setPrinting(false);
    }
  }

  /**
   * Each receipt gets its own print document and its own measured page height.
   * Putting both on one tall @page made the shorter kitchen ticket inherit the
   * customer receipt's physical length; two separate jobs avoid that blank roll.
   */
  async function printBoth() {
    const customer = receiptElement(customerRef);
    const kitchenReceipt = receiptElement(kitchenRef);
    if (!customer && !kitchenReceipt) {
      await printCurrent();
      return;
    }

    setPrintError(null);
    setPrintStatus(null);
    setPrinting(true);
    try {
      if (customer) {
        await printReceipt({ width: width as ReceiptWidth, container: customer });
      }
      if (kitchenReceipt) {
        await printReceipt({ width: width as ReceiptWidth, container: kitchenReceipt });
      }
      setPrintStatus('Both print dialogs closed. Confirm the selected printer accepted both jobs.');
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Could not print both receipts.');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar} data-print-hide>
        <div className={styles.widths} role="group" aria-label="Receipt paper width">
          {RECEIPT_WIDTHS.map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.widthButton} ${width === option ? styles.widthActive : ''}`}
              aria-pressed={width === option}
              onClick={() => choose(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setShowPrinter((v) => !v)} aria-expanded={showPrinter}>
            Thermal printer
          </Button>
          <Button variant="secondary" disabled={printing} onClick={() => void printCurrent()}>
            {printing
              ? 'Printing…'
              : deliveryReceipt && activeTab === 'customer'
                ? 'Print Delivery Receipt'
                : `Print ${activeTab === 'customer' ? 'Customer' : 'Kitchen'}`}
          </Button>
          <Button variant="secondary" disabled={printing} onClick={() => void printBoth()}>
            {printing ? 'Printing…' : 'Print Both (2 jobs)'}
          </Button>
          {actions}
        </div>
      </div>

      <div className={styles.toolbar} data-print-hide>
        <div className={styles.widths} role="group" aria-label="Receipt type">
          <button
            type="button"
            className={`${styles.widthButton} ${activeTab === 'customer' ? styles.widthActive : ''}`}
            aria-pressed={activeTab === 'customer'}
            onClick={() => setActiveTab('customer')}
          >
            {deliveryReceipt ? 'Delivery Receipt' : 'Customer Receipt'}
          </button>
          <button
            type="button"
            className={`${styles.widthButton} ${activeTab === 'kitchen' ? styles.widthActive : ''}`}
            aria-pressed={activeTab === 'kitchen'}
            onClick={() => setActiveTab('kitchen')}
          >
            Kitchen Receipt
          </button>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
          Order #{model.orderNumber} • {model.orderType}
          {model.tableLabel ? ` • Table ${model.tableLabel}` : ''} • Same order
        </span>
      </div>

      {printStatus ? (
        <p className={styles.printStatus} role="status">{printStatus}</p>
      ) : null}
      {printError ? (
        <p className={styles.printError} role="alert">{printError}</p>
      ) : null}

      {showPrinter ? (
        <div data-print-hide>
          <PrintPanel
            model={model}
            kitchenModel={kitchen}
            width={width}
            onClose={() => setShowPrinter(false)}
          />
        </div>
      ) : null}

      <div className={styles.paperArea}>
        <div className={styles.paper} ref={customerRef} style={{ display: activeTab === 'customer' ? 'block' : 'none' }}>
          <Receipt model={model} width={width} />
        </div>
        <div className={styles.paper} ref={kitchenRef} style={{ display: activeTab === 'kitchen' ? 'block' : 'none' }}>
          <KitchenReceipt model={kitchen} width={width} />
        </div>
      </div>
    </div>
  );
}
