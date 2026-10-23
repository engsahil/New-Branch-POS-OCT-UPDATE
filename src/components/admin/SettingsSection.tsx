import { useEffect, useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import { Button, Input } from '@/components/ui';
import { APP_CONFIG, CURRENCY } from '@/config/app.config';
import { VENDOR } from '@/content/legal';
import {
  NOTIFICATION_KINDS,
  notificationService,
  type NotificationPreferences,
} from '@/services/notificationService';
import {
  DASHBOARD_SECTION_LABELS,
  DEFAULT_DISPLAY_PREFERENCES,
  ORDER_LIST_LABELS,
  displayPreferencesService,
  type DisplayPreferences,
} from '@/services/displayPreferencesService';
import { onboardingService } from '@/services/onboardingService';
import { SETTING_KEYS, settingsService } from '@/services/settingsService';
import { DataSection } from './DataSection';
import styles from './PanelSection.module.css';

/**
 * Terminal preferences.
 *
 * Deliberately small: only settings that already affect behaviour elsewhere
 * in the app are offered, so nothing here is a dead switch.
 */
export interface SettingsSectionProps {
  /** Opens the About section, where the legal documents live. */
  onOpenAbout?: () => void;
}

const NOTIFICATION_LABELS: Record<string, string> = {
  order: 'Completed orders',
  stock: 'Low and out-of-stock alerts',
  payment: 'Payment problems',
  audit: 'Receipt corrections and cancellations',
  system: 'Application notices',
};

export function SettingsSection({ onOpenAbout }: SettingsSectionProps = {}) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationPreferences | null>(
    null,
  );
  const [notificationSaved, setNotificationSaved] = useState(false);
  const [display, setDisplay] = useState<DisplayPreferences>(
    DEFAULT_DISPLAY_PREFERENCES,
  );
  const [displaySaved, setDisplaySaved] = useState(false);
  const [displaySaving, setDisplaySaving] = useState(false);
  const [tourStarted, setTourStarted] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [autoShow, setAutoShow] = useState(true);
  const [lowStock, setLowStock] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [p, a, l] = await Promise.all([
        settingsService.get<string>(SETTING_KEYS.orderNumberPrefix, ''),
        settingsService.get<boolean>(SETTING_KEYS.autoShowReceipt, true),
        settingsService.get<number | null>(SETTING_KEYS.lowStockDefault, null),
      ]);
      const preferences = await notificationService.preferences();
      const storedDisplay = await displayPreferencesService.get();
      if (!active) return;
      setNotifications(preferences);
      setDisplay(storedDisplay);
      setPrefix(p);
      setAutoShow(a);
      setLowStock(l === null ? '' : String(l));
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        settingsService.set(SETTING_KEYS.orderNumberPrefix, prefix.trim()),
        settingsService.set(SETTING_KEYS.autoShowReceipt, autoShow),
        settingsService.set(
          SETTING_KEYS.lowStockDefault,
          lowStock.trim() === '' ? null : Number(lowStock),
        ),
      ]);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotifications(): Promise<void> {
    if (!notifications) return;
    await notificationService.savePreferences(notifications);
    setNotificationSaved(true);
    window.setTimeout(() => setNotificationSaved(false), 2500);
  }

  async function saveDisplay(next: DisplayPreferences): Promise<void> {
    setDisplaySaving(true);
    try {
      setDisplay(await displayPreferencesService.save(next));
      setDisplaySaved(true);
      window.setTimeout(() => setDisplaySaved(false), 2500);
    } finally {
      setDisplaySaving(false);
    }
  }

  async function resetDisplay(): Promise<void> {
    setDisplaySaving(true);
    try {
      setDisplay(await displayPreferencesService.reset());
      setDisplaySaved(true);
      window.setTimeout(() => setDisplaySaved(false), 2500);
    } finally {
      setDisplaySaving(false);
    }
  }

  function toggleKind(kind: string): void {
    setNotifications((current) => {
      if (!current) return current;
      return {
        ...current,
        kinds: {
          ...current.kinds,
          [kind]: !current.kinds[kind as keyof typeof current.kinds],
        },
      };
    });
  }

  if (!loaded) {
    return <p className={styles.loading}>Loading settings…</p>;
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>Preferences</h3>
          <span className={styles.status} aria-live="polite">
            {saved ? 'Saved' : ''}
          </span>
        </div>

        <Input
          label="Order number prefix"
          name="orderPrefix"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.slice(0, 6))}
          hint="Optional. Shown in front of order numbers, e.g. A-0001."
          autoComplete="off"
          fullWidth
        />

        <Input
          label="Default low stock level"
          name="lowStockDefault"
          value={lowStock}
          onChange={(e) => {
            const next = e.target.value;
            if (next !== '' && !/^\d{0,5}$/.test(next)) return;
            setLowStock(next);
          }}
          hint="Optional. Pre-fills the low stock alert when adding inventory."
          inputMode="numeric"
          autoComplete="off"
          fullWidth
        />

        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            name="autoShowReceipt"
            className={styles.checkbox}
            checked={autoShow}
            onChange={(e) => setAutoShow(e.target.checked)}
          />
          <span>
            <span className={styles.toggleLabel}>
              Show the receipt after completing an order
            </span>
            <span className={styles.toggleHint}>
              Turn off to return straight to a new order.
            </span>
          </span>
        </label>

        <div className={styles.actions}>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving' : 'Save settings'}
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>Dashboard and order list</h3>
          <span className={styles.status} aria-live="polite">
            {displaySaved ? 'Saved' : ''}
          </span>
        </div>
        <p className={styles.hint}>
          Choose which Dashboard blocks and which order-row details are shown.
          Hiding a block never changes a figure: the same data is still recorded
          and still exported from Sales.
        </p>

        {(Object.keys(DASHBOARD_SECTION_LABELS) as Array<
          keyof DisplayPreferences['dashboard']
        >).map((key) => (
          <label key={key} className={styles.toggleRow}>
            <input
              type="checkbox"
              name={`dashboard-${key}`}
              className={styles.checkbox}
              checked={display.dashboard[key]}
              onChange={() =>
                setDisplay((current) => ({
                  ...current,
                  dashboard: {
                    ...current.dashboard,
                    [key]: !current.dashboard[key],
                  },
                }))
              }
            />
            <span>
              <span className={styles.toggleLabel}>
                {DASHBOARD_SECTION_LABELS[key]}
              </span>
            </span>
          </label>
        ))}

        {(Object.keys(ORDER_LIST_LABELS) as Array<
          keyof DisplayPreferences['orderList']
        >).map((key) => (
          <label key={key} className={styles.toggleRow}>
            <input
              type="checkbox"
              name={`order-list-${key}`}
              className={styles.checkbox}
              checked={display.orderList[key]}
              onChange={() =>
                setDisplay((current) => ({
                  ...current,
                  orderList: {
                    ...current.orderList,
                    [key]: !current.orderList[key],
                  },
                }))
              }
            />
            <span>
              <span className={styles.toggleLabel}>
                Order rows: {ORDER_LIST_LABELS[key]}
              </span>
            </span>
          </label>
        ))}

        <p className={styles.hint}>
          The colour theme, currency and language are fixed at build time so
          receipts and reports stay consistent.
        </p>

        <div className={styles.actions}>
          <Button
            onClick={() => void saveDisplay(display)}
            disabled={displaySaving}
          >
            {displaySaving ? 'Saving' : 'Save display settings'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void resetDisplay()}
            disabled={displaySaving}
          >
            Reset to default
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>Notifications</h3>
          <span className={styles.status} aria-live="polite">
            {notificationSaved ? 'Saved' : ''}
          </span>
        </div>
        <p className={styles.hint}>
          Choose which events appear in the notification centre.
        </p>

        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            name="notificationsEnabled"
            className={styles.checkbox}
            checked={notifications?.enabled ?? true}
            onChange={(event) =>
              setNotifications((current) =>
                current ? { ...current, enabled: event.target.checked } : current,
              )
            }
          />
          <span>
            <span className={styles.toggleLabel}>Show notifications</span>
            <span className={styles.toggleHint}>
              Turning this off stops new entries; existing ones stay visible.
            </span>
          </span>
        </label>

        {NOTIFICATION_KINDS.map((kind) => (
          <label key={kind} className={styles.toggleRow}>
            <input
              type="checkbox"
              name={`notifications-${kind}`}
              className={styles.checkbox}
              checked={notifications?.kinds[kind] ?? true}
              disabled={!notifications?.enabled}
              onChange={() => toggleKind(kind)}
            />
            <span>
              <span className={styles.toggleLabel}>
                {NOTIFICATION_LABELS[kind] ?? kind}
              </span>
            </span>
          </label>
        ))}

        <div className={styles.actions}>
          <Button onClick={() => void saveNotifications()}>
            Save notifications
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Guided tour</h3>
        <p className={styles.hint}>
          Replay the short interface tour. It is never shown again automatically
          once you have finished or skipped it.
        </p>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              void onboardingService.restartTour(user?.username ?? 'admin');
              setTourStarted(true);
              window.setTimeout(() => setTourStarted(false), 2500);
            }}
          >
            {tourStarted ? 'Tour started' : 'Restart guided tour'}
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Fixed configuration</h3>
        <p className={styles.hint}>
          Set at build time and not editable from the terminal.
        </p>
        <dl className={styles.details}>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Currency</dt>
            <dd className={styles.rowValue}>
              {CURRENCY.symbol} ({CURRENCY.code})
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Locale</dt>
            <dd className={styles.rowValue}>{APP_CONFIG.locale}</dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Time zone</dt>
            <dd className={styles.rowValue}>{APP_CONFIG.timezone}</dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Version</dt>
            <dd className={styles.rowValue}>{APP_CONFIG.version}</dd>
          </div>
        </dl>
      </section>

      <DataSection />

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>About &amp; legal</h3>
        <p className={styles.hint}>
          Application information, Privacy Policy and Terms &amp; Regulations.
          {' '}
          {VENDOR.poweredBy}.
        </p>
        {onOpenAbout ? (
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onOpenAbout}>
              Open About
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
