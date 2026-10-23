import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, EmptyState, Input, Textarea } from '@/components/ui';
import { PurchasesIcon } from '@/components/ui/Icons';
import { notifyInventoryChanged } from '@/hooks/useInventory';
import {
  purchaseService,
  PurchaseError,
  type PurchaseInput,
} from '@/services/purchaseService';
import type { InventoryItemView } from '@/services/inventoryService';
import type { PurchaseRecord } from '@/types/domain';
import { formatMoney } from '@/utils/currency';
import { formatDateTime } from '@/utils/date';
import styles from './PurchasesPage.module.css';

/**
 * Purchases — stock receiving.
 *
 * Every receipt increases a real stock line and is stored with it, so the
 * history and the quantity on hand can never disagree. There is no seeded
 * supplier list and no example data: an operator picks a stock line that
 * already exists (Inventory) and records what arrived.
 */
export default function PurchasesPage() {
  const [stock, setStock] = useState<InventoryItemView[] | null>(null);
  const [records, setRecords] = useState<PurchaseRecord[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [lines, history] = await Promise.all([
      purchaseService.stockLines(),
      purchaseService.list(),
    ]);
    setStock(lines);
    setRecords(history);
    setSelected((current) =>
      current && lines.some((line) => line.record.id === current)
        ? current
        : lines[0]?.record.id ?? '',
    );
  }, []);

  useEffect(() => {
    void load().catch(() => setError('Stock data could not be read.'));
  }, [load]);

  const selectedLine = useMemo(
    () => stock?.find((line) => line.record.id === selected),
    [stock, selected],
  );

  const spend = useMemo(
    () =>
      records.reduce(
        (sum, record) =>
          record.unitCost === null || record.quantity <= 0
            ? sum
            : sum + record.unitCost * record.quantity,
        0,
      ),
    [records],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const amount = Number(quantity);
    if (!selectedLine) {
      setError('Add a stock line in Inventory before recording a purchase.');
      return;
    }
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Enter the quantity received.');
      return;
    }

    const input: PurchaseInput = {
      inventoryId: selectedLine.record.id,
      quantity: amount,
      unitCost: unitCost.trim() === '' ? null : Math.round(Number(unitCost) * 100),
      supplier,
      reference,
      note,
    };

    setSaving(true);
    try {
      await purchaseService.record(input);
      await load();
      notifyInventoryChanged();
      setQuantity('');
      setUnitCost('');
      setSupplier('');
      setReference('');
      setNote('');
      setNotice(
        `Recorded ${amount} ${selectedLine.record.unit} of ${selectedLine.record.name}.`,
      );
      window.setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setError(
        err instanceof PurchaseError
          ? err.message
          : 'The purchase could not be recorded.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Purchases"
        subtitle="Receive stock and keep the cost history."
      />

      {stock && stock.length === 0 ? (
        <EmptyState
          fill
          icon={<PurchasesIcon />}
          title="No stock lines to receive"
          description="Purchases increase an existing inventory line. Add the item in Inventory first, then record what arrives here."
        />
      ) : (
        <div className={styles.grid}>
          <section className={styles.card} aria-label="Record a purchase">
            <h2 className={styles.cardTitle}>Record a receipt</h2>
            <p className={styles.hint}>
              The quantity is added to the stock line immediately and the entry
              below is kept as history. Records are not edited afterwards.
            </p>

            <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
              <label className={styles.field}>
                <span className={styles.label}>Stock line</span>
                <select
                  name="purchaseItem"
                  className={styles.select}
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  disabled={saving || !stock}
                >
                  {(stock ?? []).map((line) => (
                    <option key={line.record.id} value={line.record.id}>
                      {line.record.name} — {line.record.quantity} {line.record.unit} on hand
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.pair}>
                <Input
                  label={`Quantity received${selectedLine ? ` (${selectedLine.record.unit})` : ''}`}
                  name="purchaseQuantity"
                  value={quantity}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next !== '' && !/^-?\d{0,6}(\.\d{0,3})?$/.test(next)) return;
                    setQuantity(next);
                  }}
                  inputMode="decimal"
                  disabled={saving}
                  fullWidth
                />
                <Input
                  label="Unit cost (optional)"
                  name="purchaseCost"
                  value={unitCost}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next !== '' && !/^\d{0,7}(\.\d{0,2})?$/.test(next)) return;
                    setUnitCost(next);
                  }}
                  inputMode="decimal"
                  hint="Stored against the item as its cost price."
                  disabled={saving}
                  fullWidth
                />
              </div>

              <div className={styles.pair}>
                <Input
                  label="Supplier (optional)"
                  name="purchaseSupplier"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  maxLength={120}
                  disabled={saving}
                  fullWidth
                />
                <Input
                  label="Invoice or note number (optional)"
                  name="purchaseReference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  maxLength={60}
                  disabled={saving}
                  fullWidth
                />
              </div>

              <Textarea
                label="Note (optional)"
                name="purchaseNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={200}
                disabled={saving}
                fullWidth
              />

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

              <div className={styles.actions}>
                <Button type="submit" disabled={saving || !stock?.length}>
                  {saving ? 'Recording' : 'Record purchase'}
                </Button>
              </div>
            </form>
          </section>

          <section className={styles.card} aria-label="Purchase history">
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Recent receipts</h2>
              <span className={styles.cardMeta}>
                {records.length} entr{records.length === 1 ? 'y' : 'ies'}
                {spend > 0 ? ` · ${formatMoney(spend)} recorded` : ''}
              </span>
            </div>

            {records.length === 0 ? (
              <p className={styles.hint}>
                Nothing received yet. Recorded purchases appear here with the
                quantity added to stock.
              </p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Received</th>
                      <th scope="col">Item</th>
                      <th scope="col" className={styles.numeric}>
                        Qty
                      </th>
                      <th scope="col" className={styles.numeric}>
                        Unit cost
                      </th>
                      <th scope="col">Supplier</th>
                      <th scope="col">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td>{formatDateTime(record.receivedAt)}</td>
                        <td>{record.itemName}</td>
                        <td className={styles.numeric}>{record.quantity}</td>
                        <td className={styles.numeric}>
                          {record.unitCost === null
                            ? '-'
                            : formatMoney(record.unitCost)}
                        </td>
                        <td>{record.supplier || '-'}</td>
                        <td>{record.reference || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
