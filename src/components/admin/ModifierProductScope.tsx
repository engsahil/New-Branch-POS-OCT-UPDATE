import { useMenu } from '@/hooks/useMenu';
import type { ID } from '@/types/common';
import styles from './PanelSection.module.css';

/** Empty selection deliberately means all products, including legacy records. */
export function ModifierProductScope({ value, onChange, name }: {
  value: ID[]; onChange: (value: ID[]) => void; name: string;
}) {
  const { items, loading, error } = useMenu();
  return <fieldset className={styles.scope}>
    <legend>Applicable products</legend>
    <p className={styles.hint}>Leave all unchecked to offer this on every product and deal. Select products to restrict it; restricted options are not offered on whole deals.</p>
    {loading ? <p className={styles.hint}>Loading products…</p> : error ? <p className={styles.failure}>{error}</p> : items.length === 0 ? <p className={styles.hint}>Add menu products to restrict this option.</p> : null}
    <div className={styles.scopeOptions}>
      {items.map(({ item }) => <label key={item.id}>
        <input type="checkbox" name={`${name}-products`} checked={value.includes(item.id)} onChange={() => onChange(value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id])} />
        {item.name}
      </label>)}
    </div>
    {value.length ? <span className={styles.hint}>{value.length} selected product(s)</span> : <span className={styles.hint}>All products and deals</span>}
  </fieldset>;
}
