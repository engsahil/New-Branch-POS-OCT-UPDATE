import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from '@/components/ui';
import { EditIcon } from '@/components/ui/Icons';
import { ReceiptView } from '@/components/receipt';
import { orderService } from '@/services/orderService';
import {
  ReceiptEditError,
  receiptEditService,
} from '@/services/receiptEditService';
import { receiptService } from '@/services/receiptService';
import type {
  KitchenReceiptModel,
  ReceiptModel,
} from '@/services/receiptService';
import type { OrderItemRecord, ReceiptAuditRecord } from '@/types/domain';
import { formatMoney } from '@/utils/currency';
import { formatDateTime } from '@/utils/date';
import styles from './OrderReceiptDialog.module.css';

export interface OrderReceiptDialogProps {
  orderId: string;
  editor: string;
  onClose: () => void;
  /** Called after a successful correction so lists can refresh. */
  onEdited?: () => void;
}

/**
 * Receipt history detail: the latest saved receipt, its kitchen ticket, the
 * permitted correction workflow, and the audit trail. Reuses the same receipt
 * components and print service as checkout, so there is one receipt layout in
 * the application rather than a second preview-only rendering.
 */
export function OrderReceiptDialog({
  orderId,
  editor,
  onClose,
  onEdited,
}: OrderReceiptDialogProps) {
  const [model, setModel] = useState<ReceiptModel | null>(null);
  const [kitchen, setKitchen] = useState<KitchenReceiptModel | null>(null);
  const [items, setItems] = useState<OrderItemRecord[]>([]);
  const [audits, setAudits] = useState<ReceiptAuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoadFailed(false);
    try {
      const order = await orderService.getOrder(orderId);
      if (!order) {
        setError('Order not found.');
        setLoadFailed(true);
        return;
      }
      const orderItems = await orderService.getOrderItems(orderId);
      const [receipt, kitchenReceipt, history] = await Promise.all([
        receiptService.build(order, orderItems),
        receiptService.buildKitchen(order, orderItems),
        receiptEditService.auditsFor(orderId),
      ]);

      setModel(receipt);
      setKitchen(kitchenReceipt);
      setItems(orderItems);
      setAudits(history);
      setQuantities(
        Object.fromEntries(orderItems.map((item) => [item.id, item.quantity])),
      );
    } catch {
      // Keep any already-loaded receipt on screen; when nothing loaded,
      // the dialog must say so and offer a retry instead of sitting on
      // "Loading receipt…" with the print actions silently absent.
      setError('The receipt could not be loaded. The order is saved; please try again.');
      setLoadFailed(true);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function saveCorrection(itemId: string) {
    const quantity = quantities[itemId];
    if (quantity === undefined) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await receiptEditService.adjustLine({
        orderId,
        itemId,
        quantity,
        reason,
        editor,
      });
      await load();
      setReason('');
      setEditing(false);
      setNotice('Receipt corrected and added to the audit trail.');
      onEdited?.();
    } catch (err) {
      setError(
        err instanceof ReceiptEditError
          ? err.message
          : 'The correction could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  // Portal to <body>: pages animate a transform on entry (.page), which
  // makes them a containing block + stacking context. Rendered in place,
  // this fixed overlay was positioned against the page (not the viewport)
  // and its z-index could never outrank shell-level fixed elements such
  // as the guided tour — which then covered the print actions.
  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={model ? `Receipt ${model.orderNumber}` : 'Receipt'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>
              Receipt {model ? `#${model.orderNumber}` : ''}
            </h2>
            <p className={styles.meta}>
              {model
                ? `${model.orderType} · ${model.date} ${model.time}`
                : loadFailed
                  ? 'Receipt unavailable'
                  : 'Loading receipt…'}
            </p>
          </div>
          <div className={styles.headActions}>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<EditIcon width={15} height={15} />}
              onClick={() => setEditing((value) => !value)}
              aria-pressed={editing}
            >
              {editing ? 'Cancel edit' : 'Edit receipt'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </header>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}

        {editing ? (
          <section className={styles.editor} aria-label="Edit receipt">
            <h3 className={styles.editorTitle}>Line quantities</h3>
            <p className={styles.editorHint}>
              Change a quantity, enter the reason, then apply the correction to
              that line. Set a quantity to 0 to void it.
            </p>

            <ul className={styles.editList}>
              {items.map((item) => (
                <li key={item.id} className={styles.editRow}>
                  <span className={styles.editName}>
                    {item.name}
                    {item.sizeLabel ? ` (${item.sizeLabel})` : ''}
                    {item.dealId ? (
                      <span className={styles.lockedTag}>Deal · locked</span>
                    ) : null}
                  </span>
                  <span className={styles.editTotal}>
                    {formatMoney(item.lineTotal)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    value={quantities[item.id] ?? item.quantity}
                    disabled={Boolean(item.dealId) || saving}
                    aria-label={`Quantity for ${item.name}`}
                    className={styles.qtyInput}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setQuantities((prev) => ({
                        ...prev,
                        [item.id]: Number.isFinite(next)
                          ? Math.max(0, Math.min(999, Math.floor(next)))
                          : item.quantity,
                      }));
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      Boolean(item.dealId) ||
                      saving ||
                      (quantities[item.id] ?? item.quantity) === item.quantity
                    }
                    onClick={() => void saveCorrection(item.id)}
                  >
                    Apply
                  </Button>
                </li>
              ))}
            </ul>

            <Input
              label="Reason for correction"
              name="editReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Customer returned one item"
              maxLength={200}
              required
              fullWidth
            />
          </section>
        ) : null}

        <div className={styles.receiptArea}>
          {model ? (
            <ReceiptView
              model={model}
              kitchenModel={kitchen ?? undefined}
              actions={
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              }
            />
          ) : loadFailed ? (
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          ) : (
            <p className={styles.loading}>Loading receipt…</p>
          )}
        </div>

        <section className={styles.audits} aria-label="Receipt edit history">
          <h3 className={styles.auditTitle}>Edit history</h3>
          {audits.length === 0 ? (
            <p className={styles.auditEmpty}>This receipt has not been edited.</p>
          ) : (
            <ul className={styles.auditList}>
              {audits.map((audit) => (
                <li key={audit.id} className={styles.auditRow}>
                  <span className={styles.auditMain}>
                    {audit.itemName}: {audit.previousQuantity} →{' '}
                    {audit.newQuantity}
                  </span>
                  <span className={styles.auditMeta}>
                    {formatDateTime(audit.createdAt)} · {audit.editor} ·{' '}
                    {formatMoney(audit.before.grandTotal)} →{' '}
                    {formatMoney(audit.after.grandTotal)}
                  </span>
                  <span className={styles.auditReason}>“{audit.reason}”</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </div>,
    document.body,
  );
}
