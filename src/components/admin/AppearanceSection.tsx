import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import {
  DASHBOARD_SECTION_LABELS,
  DEFAULT_DISPLAY_PREFERENCES,
  ORDER_LIST_LABELS,
  displayPreferencesService,
  type DisplayPreferences,
} from '@/services/displayPreferencesService';
import { restaurantService } from '@/services/restaurantService';
import type { StoredImage } from '@/types/domain';
import defaultBannerUrl from '@/assets/default-restaurant-banner.jpg';
import { BannerField } from './BannerField';
import styles from './PanelSection.module.css';

/** Palette read straight from the live tokens, so this panel cannot drift. */
const PALETTE: Array<{ token: string; label: string }> = [
  { token: '--color-primary', label: 'Primary' },
  { token: '--color-accent', label: 'Secondary' },
  { token: '--color-accent-soft', label: 'Mint' },
  { token: '--color-accent-orange', label: 'Accent orange' },
  { token: '--color-accent-blue', label: 'Supporting blue' },
  { token: '--color-accent-gold', label: 'Supporting gold' },
];

export interface AppearanceSectionProps {
  /** Jump to another Settings section, e.g. the restaurant profile. */
  onOpenSection?: (id: string) => void;
}

/**
 * Appearance.
 *
 * The palette is fixed at build time and shown here read-only: a per-terminal
 * colour switch would let two tills render the same report differently. What
 * an operator can change is what the screens show, which is what this panel
 * controls — and every switch hides presentation only, never a figure.
 */
export function AppearanceSection({ onOpenSection }: AppearanceSectionProps = {}) {
  const [display, setDisplay] = useState<DisplayPreferences>(
    DEFAULT_DISPLAY_PREFERENCES,
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [colors, setColors] = useState<Record<string, string>>({});

  /*
   * Dashboard banner. Customisation lives here (and in the Restaurant
   * profile form) — never as an overlay on the dashboard itself.
   * `banner` is the value being edited; `savedBanner` is what is stored.
   * A null banner means the built-in restaurant banner bundled with the
   * app is active, which is what the preview below shows.
   */
  const [banner, setBanner] = useState<StoredImage | null>(null);
  const [savedBanner, setSavedBanner] = useState<StoredImage | null>(null);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerSaved, setBannerSaved] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const bannerTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void restaurantService
      .getProfile()
      .then((profile) => {
        if (!active) return;
        setBanner(profile.banner);
        setSavedBanner(profile.banner);
        setBannerLoaded(true);
      })
      .catch(() => {
        if (active) {
          setBannerError('Could not load the current banner.');
          setBannerLoaded(true);
        }
      });
    return () => {
      active = false;
      if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    };
  }, []);

  const bannerDirty =
    (banner?.dataUrl ?? null) !== (savedBanner?.dataUrl ?? null);

  async function saveBanner() {
    setBannerBusy(true);
    setBannerError(null);
    try {
      // Re-read the profile so only the banner changes: name, logo, tax and
      // every other saved field are written back exactly as stored.
      const current = await restaurantService.getProfile();
      await restaurantService.save({ ...current, banner });
      // Confirm from storage what is now active before claiming success.
      const stored = await restaurantService.getProfile();
      setBanner(stored.banner);
      setSavedBanner(stored.banner);
      setBannerSaved(true);
      if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
      bannerTimer.current = window.setTimeout(() => setBannerSaved(false), 3000);
    } catch {
      setBannerError('The banner could not be saved. Please try again.');
    } finally {
      setBannerBusy(false);
    }
  }

  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    setColors(
      Object.fromEntries(
        PALETTE.map((entry) => [
          entry.token,
          computed.getPropertyValue(entry.token).trim(),
        ]),
      ),
    );
  }, []);

  useEffect(() => {
    let active = true;
    void displayPreferencesService
      .get()
      .then((value) => {
        if (active) setDisplay(value);
      })
      .catch(() => {
        /* keep the defaults if the stored value cannot be read */
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(next: DisplayPreferences) {
    setBusy(true);
    try {
      setDisplay(await displayPreferencesService.save(next));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      setDisplay(await displayPreferencesService.reset());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  const dashboardKeys = Object.keys(
    DASHBOARD_SECTION_LABELS,
  ) as Array<keyof DisplayPreferences['dashboard']>;
  const orderKeys = Object.keys(
    ORDER_LIST_LABELS,
  ) as Array<keyof DisplayPreferences['orderList']>;

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>Theme</h3>
          <span className={styles.status}>Light Clean &amp; Fresh</span>
        </div>
        <p className={styles.hint}>
          The palette is part of the build so receipts, reports and every till
          stay identical. These are the live values used across the app.
        </p>
        <ul className={styles.palette}>
          {PALETTE.map((entry) => (
            <li key={entry.token} className={styles.swatchRow}>
              <span
                className={styles.swatch}
                style={{ backgroundColor: colors[entry.token] || undefined }}
                aria-hidden="true"
              />
              <span className={styles.swatchText}>
                <span className={styles.swatchLabel}>{entry.label}</span>
                <span className={styles.swatchValue}>
                  {colors[entry.token] || '-'}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {onOpenSection ? (
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => onOpenSection('restaurant')}>
              Restaurant profile and logo
            </Button>
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>Dashboard banner</h3>
          <span className={styles.status} aria-live="polite">
            {bannerSaved ? 'Saved' : bannerDirty ? 'Unsaved changes' : ''}
          </span>
        </div>
        <p className={styles.hint}>
          The image shown at the top of the Dashboard. A professional
          restaurant banner is built in and used by default — upload your own
          to replace it, or restore the default at any time. The dashboard
          shows only your restaurant name and greeting over it; editing
          happens here, not on the banner itself.
        </p>

        <img
          src={banner?.dataUrl ?? defaultBannerUrl}
          alt={
            banner
              ? 'Preview of your custom dashboard banner'
              : 'Preview of the built-in dashboard banner'
          }
          className={styles.bannerPreview}
          width={banner?.width ?? 1600}
          height={banner?.height ?? 500}
          loading="eager"
          decoding="async"
        />
        <p className={styles.hint} aria-live="polite">
          {bannerDirty ? 'After saving: ' : 'Currently active: '}
          {banner
            ? `your custom banner (${banner.fileName}).`
            : 'the built-in restaurant banner.'}
        </p>

        <BannerField
          value={banner}
          onChange={(next) => {
            setBanner(next);
            setBannerSaved(false);
            setBannerError(null);
          }}
          disabled={!bannerLoaded || bannerBusy}
        />

        {bannerError ? (
          <p className={styles.failure} role="alert">
            {bannerError}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button
            onClick={() => void saveBanner()}
            disabled={!bannerLoaded || bannerBusy || !bannerDirty}
          >
            {bannerBusy ? 'Saving' : 'Save banner'}
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>Dashboard and order list</h3>
          <span className={styles.status} aria-live="polite">
            {saved ? 'Saved' : ''}
          </span>
        </div>
        <p className={styles.hint}>
          Choose which Dashboard blocks and which order-row details are shown.
          Hiding a block never changes a figure: the same data is still recorded
          and still exported from Reports.
        </p>

        {dashboardKeys.map((key) => (
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

        {orderKeys.map((key) => (
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

        <div className={styles.actions}>
          <Button onClick={() => void save(display)} disabled={busy}>
            {busy ? 'Saving' : 'Save display settings'}
          </Button>
          <Button variant="secondary" onClick={() => void reset()} disabled={busy}>
            Reset to default
          </Button>
        </div>
      </section>
    </div>
  );
}
