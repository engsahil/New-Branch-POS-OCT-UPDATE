import { useId, useState } from 'react';
import { Button, Input } from '@/components/ui';
import type { CustomerRecord } from '@/types/domain';
import styles from './CustomerPicker.module.css';

export interface CustomerPickerProps {
  customers: CustomerRecord[];
  selected: CustomerRecord | null;
  onSelect: (customer: CustomerRecord | null) => void;
  /** Section label. */
  label?: string;
  /** Shown when nothing is selected, e.g. "Guest order". */
  emptyHint?: string;
}

/**
 * Saved-customer search, shared by Dine-in, Takeaway and Delivery.
 *
 * Selecting a customer is a display concern here: the POS copies the saved
 * details into the order fields and pass the customer id through to
 * orderService, which links that record instead of creating a duplicate.
 */
export function CustomerPicker({
  customers,
  selected,
  onSelect,
  label = 'Customer',
  emptyHint = 'Optional. Search a saved customer or enter details below.',
}: CustomerPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();

  const term = query.trim().toLowerCase();
  const matches = (
    term
      ? customers.filter(
          (customer) =>
            customer.name.toLowerCase().includes(term) ||
            (customer.phone ?? '').toLowerCase().includes(term),
        )
      : customers
  ).slice(0, 6);

  if (selected) {
    return (
      <div className={styles.selected} aria-live="polite">
        <div className={styles.selectedMain}>
          <span className={styles.selectedLabel}>{label}</span>
          <span className={styles.selectedName}>{selected.name}</span>
          <span className={styles.selectedMeta}>
            {selected.phone ? selected.phone : 'No phone on file'}
            {selected.address ? ` · ${selected.address}` : ''}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.picker}>
      <Input
        name="customerSearch"
        label={label}
        placeholder="Search name or phone"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        fullWidth
      />

      <p className={styles.hint}>{emptyHint}</p>

      {open && term.length > 0 ? (
        <ul className={styles.results} id={listId} aria-label="Matching customers">
          {matches.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className={styles.result}
                onClick={() => {
                  onSelect(customer);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span className={styles.resultName}>{customer.name}</span>
                <span className={styles.resultMeta}>
                  {customer.phone ?? 'No phone'}
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li className={styles.noMatch}>
              No saved customer matches “{query.trim()}”. Enter the details below
              to create one with this order.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
