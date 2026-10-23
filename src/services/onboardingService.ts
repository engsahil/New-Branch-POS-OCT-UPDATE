/**
 * First-time setup and product-tour state.
 *
 * Both flags live in the existing settings store, so no schema change is
 * needed and both survive refreshes. The setup flag is deliberately
 * installation-wide; the tour flag is per user so a second account is not
 * forced through a tour somebody else already completed.
 *
 * Existing installations are never sent through setup: a terminal that
 * already has a restaurant profile or any recorded order is marked complete
 * on first read, which is the upgrade path described in the README.
 */

import { ordersRepository } from '@/data/repositories';
import { settingsService } from './settingsService';
import { restaurantService } from './restaurantService';

export const SETUP_COMPLETED_KEY = 'setup.completed';

export function tourCompletedKey(username: string): string {
  return `tour.completed.${username.trim().toLowerCase() || 'admin'}`;
}

/** Screens the guided tour explains, anchored to real navigation targets. */
export const TOUR_STEPS = [
  {
    target: 'nav-dashboard',
    title: 'Dashboard',
    body: 'Today’s sales, stock alerts and shortcuts to every module start here.',
  },
  {
    target: 'nav-pos',
    title: 'POS',
    body: 'Build an order, choose Dine-in, Takeaway or Delivery, select a saved customer and take payment.',
  },
  {
    target: 'nav-sales',
    title: 'Sales and reports',
    body: 'Filter by period, review totals and breakdowns, export CSV, and open a receipt to view, reprint or correct it.',
  },
  {
    target: 'nav-customers',
    title: 'Customers',
    body: 'Saved customers are reused across all three order types, with their history and totals.',
  },
  {
    target: 'nav-inventory',
    title: 'Inventory',
    body: 'Stock levels, low-stock alerts and menu links. Linked items that run out are hidden from the POS.',
  },
  {
    target: 'nav-admin',
    title: 'Admin',
    body: 'Restaurant profile, printer and receipt settings, security and application settings live here.',
  },
  {
    target: 'notifications',
    title: 'Notifications',
    body: 'New orders, stock alerts and receipt corrections appear here. Unread counts persist across reloads.',
  },
] as const;

export const onboardingService = {
  /**
   * True only for a genuinely new, unconfigured installation.
   * Existing installations are marked complete instead of being interrupted.
   */
  async needsSetup(): Promise<boolean> {
    const completed = await settingsService.get<boolean>(
      SETUP_COMPLETED_KEY,
      false,
    );
    if (completed) return false;

    const configured = await restaurantService.isConfigured();
    if (configured) {
      await settingsService.set(SETUP_COMPLETED_KEY, true);
      return false;
    }

    const orders = await ordersRepository.list();
    if (orders.length > 0) {
      await settingsService.set(SETUP_COMPLETED_KEY, true);
      return false;
    }

    return true;
  },

  async completeSetup(): Promise<void> {
    await settingsService.set(SETUP_COMPLETED_KEY, true);
  },

  async isTourCompleted(username: string): Promise<boolean> {
    return settingsService.get<boolean>(tourCompletedKey(username), false);
  },

  async completeTour(username: string): Promise<void> {
    await settingsService.set(tourCompletedKey(username), true);
  },

  /** Called from Settings so the tour can be replayed deliberately. */
  async restartTour(username: string): Promise<void> {
    await settingsService.set(tourCompletedKey(username), false);
    window.dispatchEvent(new Event('pos:start-tour'));
  },
};
