import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import {
  printerService,
  type TransportKind,
  type TransportSupport,
} from '@/services/printerService';
import {
  renderKitchenPlainText,
  renderPlainText,
} from '@/services/escpos';
import type {
  KitchenReceiptModel,
  ReceiptModel,
  ReceiptWidth,
} from '@/services/receiptService';
import styles from './PrintPanel.module.css';

export interface PrintPanelProps {
  model: ReceiptModel;
  kitchenModel?: KitchenReceiptModel;
  width: ReceiptWidth;
  onClose: () => void;
}

/**
 * Direct-printer controls. ESC/POS sends only receipt lines and a short cut
 * command; it never creates a paper page. Customer and kitchen tickets are
 * separately encoded and cut at their own content length.
 */
export function PrintPanel({ model, kitchenModel, width, onClose }: PrintPanelProps) {
  const [support, setSupport] = useState<TransportSupport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(
    printerService.activeTransport()?.label ?? null,
  );
  const [preview, setPreview] = useState(false);
  const [receiptType, setReceiptType] = useState<'customer' | 'kitchen'>('customer');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [encoding, setEncoding] = useState(false);

  useEffect(() => {
    setSupport(printerService.detectSupport());
  }, []);

  useEffect(() => {
    let active = true;
    setEncoding(true);
    setBytes(null);
    setError(null);
    const output =
      receiptType === 'kitchen' && kitchenModel
        ? Promise.resolve(printerService.encodeKitchen(kitchenModel, width))
        : printerService.encode(model, width);

    void output
      .then((encoded) => {
        if (active) setBytes(encoded);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not prepare printer output.');
        }
      })
      .finally(() => {
        if (active) setEncoding(false);
      });

    return () => {
      active = false;
    };
  }, [kitchenModel, model, receiptType, width]);

  const plain =
    receiptType === 'kitchen' && kitchenModel
      ? renderKitchenPlainText(kitchenModel, width)
      : renderPlainText(model, width);

  async function connect(kind: TransportKind) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const transport = await printerService.connect(kind);
      setConnected(transport.label);
      setStatus(`Connected to ${transport.label}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /No device selected|cancelled/i.test(message)
          ? 'No printer was selected.'
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendSelected() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (receiptType === 'kitchen' && kitchenModel) {
        await printerService.printKitchenReceipt(kitchenModel, width);
        setStatus('Compact kitchen ticket sent; it ends with its own cut command.');
      } else {
        await printerService.printReceipt(model, width);
        setStatus('Customer receipt sent with the saved logo when available.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send to printer.');
    } finally {
      setBusy(false);
    }
  }

  async function sendBoth() {
    if (!kitchenModel) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await printerService.printBothReceipts(model, kitchenModel, width);
      setStatus('Customer and kitchen tickets sent as two independently cut receipts.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send both receipts.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!bytes) return;
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receiptType}-receipt-${model.orderNumber}-${width}.bin`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const usbUsable = support?.usb && support.secureContext;
  const serialUsable = support?.serial && support.secureContext;
  const selectedLabel = receiptType === 'customer' ? 'Customer receipt' : 'Kitchen ticket';

  return (
    <section className={styles.panel} aria-label="Direct printer">
      <header className={styles.head}>
        <h2 className={styles.title}>Thermal printer</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      <p className={styles.explain}>
        Sends printer-native ESC/POS bytes directly to the device. Text stays
        crisp, the customer logo is converted at printer dot resolution, and
        each ticket is cut immediately after its own content. This is separate
        from the browser Print button and its printer-driver page settings.
      </p>

      <dl className={styles.support}>
        <div className={styles.supportRow}>
          <dt>Paper</dt>
          <dd>
            {width} · {width === '58mm' ? 32 : 48} columns
          </dd>
        </div>
        <div className={styles.supportRow}>
          <dt>WebUSB</dt>
          <dd>{support?.usb ? 'Available' : 'Not supported'}</dd>
        </div>
        <div className={styles.supportRow}>
          <dt>Web Serial</dt>
          <dd>{support?.serial ? 'Available' : 'Not supported'}</dd>
        </div>
        <div className={styles.supportRow}>
          <dt>Secure context</dt>
          <dd>{support?.secureContext ? 'Yes' : 'No (HTTPS required)'}</dd>
        </div>
        <div className={styles.supportRow}>
          <dt>Connection</dt>
          <dd>{connected ?? 'Not connected'}</dd>
        </div>
      </dl>

      {!support?.secureContext ? (
        <p className={styles.note}>
          Direct printing needs a secure context. Serve the app over HTTPS (or
          use localhost) to enable it.
        </p>
      ) : !support.usb && !support.serial ? (
        <p className={styles.note}>
          This browser does not expose WebUSB or Web Serial. Chrome or Edge on
          desktop is required for direct printing; the browser Print button
          works elsewhere.
        </p>
      ) : null}

      {kitchenModel ? (
        <div className={styles.receiptTypes} role="group" aria-label="Direct receipt type">
          <Button
            variant={receiptType === 'customer' ? 'primary' : 'secondary'}
            aria-pressed={receiptType === 'customer'}
            onClick={() => setReceiptType('customer')}
          >
            Customer
          </Button>
          <Button
            variant={receiptType === 'kitchen' ? 'primary' : 'secondary'}
            aria-pressed={receiptType === 'kitchen'}
            onClick={() => setReceiptType('kitchen')}
          >
            Kitchen
          </Button>
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={() => void connect('usb')}
          disabled={busy || !usbUsable}
        >
          Connect USB
        </Button>
        <Button
          variant="secondary"
          onClick={() => void connect('serial')}
          disabled={busy || !serialUsable}
        >
          Connect Serial
        </Button>
        <Button onClick={() => void sendSelected()} disabled={busy || !connected}>
          {busy ? 'Sending…' : `Send ${receiptType === 'customer' ? 'customer' : 'kitchen'} ticket`}
        </Button>
        {kitchenModel ? (
          <Button onClick={() => void sendBoth()} disabled={busy || !connected}>
            Send Both (2 cuts)
          </Button>
        ) : null}
      </div>

      {status ? (
        <p className={styles.status} role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.tools}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPreview((value) => !value)}
          aria-expanded={preview}
        >
          {preview ? 'Hide' : 'Show'} {selectedLabel.toLowerCase()} output
        </Button>
        <Button variant="ghost" size="sm" onClick={download} disabled={!bytes || encoding}>
          {encoding ? 'Preparing printer output…' : `Download .bin (${bytes?.length ?? 0} bytes)`}
        </Button>
      </div>

      {preview ? (
        <div className={styles.previewWrap}>
          <p className={styles.previewLabel}>
            {selectedLabel} text at {width === '58mm' ? 32 : 48} columns. The
            customer logo is included as a raster command when it can be decoded.
          </p>
          <pre className={styles.preview} data-testid="escpos-preview">
            {plain}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
