/**
 * Display preferences.
 *
 * A single stored object that decides which parts of the Dashboard and which
 * details of the order list are shown. Everything here is presentation only:
 * no metric, sale or report is filtered by these switches, so turning a
 * section off can never change a number — it only hides the block.
 *
 * The palette, currency and locale are deliberately NOT preferences. The
 * terminal ships one approved theme (Light Clean & Fresh) and one currency,
 * both set in `app.config.ts` at build time, so a stray toggle can never make
 * historical screenshots, receipts and reports disagree.
 */

import { SETTING_KEYS, settingsService } from './settingsService';

export interface DashboardPreferences {
  /** Today's headline figures. */
  metrics: boolean;
  /** Shortcut buttons to the working screens. */
  quickActions: boolean;
  /** Week chart, payment mix and order-type mix. */
  trends: boolean;
  /** Sales/expense/profit summary; presentation never changes its figures. */
  finance: boolean;
  bestSellers: boolean;
  stockAlerts: boolean;
  recentOrders: boolean;
  /** Dine-in/delivery/unpaid counts and new customers. */
  operations: boolean;
}

export interface OrderListPreferences {
  customer: boolean;
  table: boolean;
  itemCount: boolean;
  payment: boolean;
}

export interface DisplayPreferences {
  dashboard: DashboardPreferences;
  orderList: OrderListPreferences;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  dashboard: {
    metrics: true,
    quickActions: true,
    trends: true,
    finance: true,
    bestSellers: true,
    stockAlerts: true,
    recentOrders: true,
    operations: true,
  },
  orderList: {
    customer: true,
    table: true,
    itemCount: true,
    payment: true,
  },
};

/** Human labels, in the order the switches are shown. */
export const DASHBOARD_SECTION_LABELS: Record<
  keyof DashboardPreferences,
  string
> = {
  metrics: 'Today’s sales, orders and average order value',
  quickActions: 'Quick actions',
  trends: 'Sales trend, payment mix and order types',
  finance: 'Sales, expenses and estimated profit',
  bestSellers: 'Best sellers',
  stockAlerts: 'Stock alerts',
  recentOrders: 'Recent orders',
  operations: 'Operational summary',
};

export const ORDER_LIST_LABELS: Record<keyof OrderListPreferences, string> = {
  customer: 'Customer name',
  table: 'Table label',
  itemCount: 'Item count',
  payment: 'Payment method',
};

/** Event fired on the window whenever preferences are saved or reset. */
export const DISPLAY_PREFERENCES_EVENT = 'pos:display-preferences';

function merge(stored: unknown): DisplayPreferences {
  const value = (stored ?? {}) as Partial<DisplayPreferences>;
  return {
    dashboard: {
      ...DEFAULT_DISPLAY_PREFERENCES.dashboard,
      ...(value.dashboard ?? {}),
    },
    orderList: {
      ...DEFAULT_DISPLAY_PREFERENCES.orderList,
      ...(value.orderList ?? {}),
    },
  };
}

function announce(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DISPLAY_PREFERENCES_EVENT));
}

export const displayPreferencesService = {
  async get(): Promise<DisplayPreferences> {
    const stored = await settingsService.get<Partial<DisplayPreferences> | null>(
      SETTING_KEYS.displayPreferences,
      null,
    );
    return merge(stored);
  },

  async save(preferences: DisplayPreferences): Promise<DisplayPreferences> {
    const value = merge(preferences);
    await settingsService.set(SETTING_KEYS.displayPreferences, value);
    announce();
    return value;
  },

  /** Forget every override; the app returns to showing everything. */
  async reset(): Promise<DisplayPreferences> {
    await settingsService.remove(SETTING_KEYS.displayPreferences);
    announce();
    return merge(null);
  },
};
