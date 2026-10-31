import { useEffect, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ModifierProductScope } from './ModifierProductScope';
import { PriceInput } from './PriceInput';
import { addOnService, type AddOnInput } from '@/services/addOnService';
import type { ID, Paisa } from '@/types/common';
import type { AddOnRecord } from '@/types/domain';
import { notifyAddOnsChanged } from '@/hooks/useAddOns';
import { formatMoney } from '@/utils/currency';
import styles from './PanelSection.module.css';

export function AddOnsSection() {
  const [items, setItems] = useState<AddOnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(0);
  const [cost, setCost] = useState<Paisa | null>(null);
  const [productIds, setProductIds] = useState<ID[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setItems(await addOnService.list());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    const input: AddOnInput = {
      name: name.trim(),
      price: price ?? 0,
      isActive: true,
      costPrice: cost,
      menuItemIds: productIds,
    };
    try {
      if (editingId) {
        await addOnService.update(editingId, input);
      } else {
        await addOnService.create(input);
      }
      setName('');
      setPrice(0);
      setCost(null);
      setProductIds([]);
      setEditingId(null);
      await load();
      notifyAddOnsChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save this option.');
    }
  }

  async function handleDelete(id: string) {
    await addOnService.remove(id);
    await load();
    notifyAddOnsChanged();
  }

  function startEdit(item: AddOnRecord) {
    setEditingId(item.id);
    setName(item.name);
    setPrice(item.price);
    setCost(item.costPrice ?? null);
    setProductIds(item.menuItemIds ?? []);
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{editingId ? 'Edit add-on' : 'Add add-on'}</h3>
        <form onSubmit={handleSave} className={styles.stack}>
          <Input
            label="Name"
            name="addOnName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <PriceInput label="Extra price" name="addOnPrice" value={price} onChange={setPrice} />
          <PriceInput label="Known cost per serving (optional)" name="addOnCost" value={cost} onChange={setCost} hint="Used only for new sales' estimated profit. Leave blank if unknown." />
          <ModifierProductScope name="addOn" value={productIds} onChange={setProductIds} />
          {error ? <p className={styles.failure}>{error}</p> : null}
          <div className={styles.actions}>
            {editingId ? (
              <Button variant="ghost" type="button" onClick={() => { setEditingId(null); setName(''); setPrice(0); setCost(null); setProductIds([]); }}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit">{editingId ? 'Save' : 'Add'}</Button>
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Add-ons ({items.length})</h3>
        {loading ? <p className={styles.loading}>Loading…</p> : null}
        {!loading && items.length === 0 ? <p className={styles.hint}>No add-ons yet.</p> : null}
        <div className={styles.details}>
          {items.map((t) => (
            <div key={t.id} className={styles.row}>
              <span className={styles.rowLabel}>{t.name} · {formatMoney(t.price)}<small className={styles.rowLabel}> · {t.menuItemIds?.length ? `${t.menuItemIds.length} products` : 'All products'}</small></span>
              <span className={styles.actions}>
                <Button variant="ghost" size="sm" onClick={() => startEdit(t)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => void handleDelete(t.id)}>Delete</Button>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
