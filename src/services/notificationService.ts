/**
 * In-app notification centre.
 *
 * Notifications are persisted in IndexedDB so the unread count survives a
 * refresh and every terminal restart. Each event carries a stable dedupe key:
 * the same key is only ever written once, which is what stops a page refresh
 * (or a repeated sale/stock evaluation) from duplicating entries.
 *
 * There is no polling loop and no push dependency. Views refresh when the
 * `notifyNotificationsChanged` event fires, which the services below emit
 * after a successful write.
 */

import { notificationsRepository } from '@/data/repositories';
import type {
  NotificationKind,
  NotificationRecord,
  NotificationSeverity,
} from '@/types/domain';
import { settingsService } from './settingsService';
import { nowISO } from '@/utils/date';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'order',
  'stock',
  'payment',
  'audit',
  'system',
];

export const NOTIFICATION_SETTING_KEYS = {
  enabled: 'notifications.enabled',
  kinds: 'notifications.kinds',
} as const;

export type NotificationPreferences = {
  enabled: boolean;
  kinds: Record<NotificationKind, boolean>;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  kinds: { order: true, stock: true, payment: true, audit: true, system: true },
};

type Listener = () => void;
const listeners = new Set<Listener>();

/** Tell mounted views that the notification list or read state changed. */
export function notifyNotificationsChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeNotifications(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalisePreferences(
  stored: NotificationPreferences | null | undefined,
): NotificationPreferences {
  if (!stored || typeof stored !== 'object') {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  const kinds = { ...DEFAULT_NOTIFICATION_PREFERENCES.kinds };
  for (const kind of NOTIFICATION_KINDS) {
    const value = stored.kinds?.[kind];
    if (typeof value === 'boolean') kinds[kind] = value;
  }
  return {
    enabled:
      typeof stored.enabled === 'boolean'
        ? stored.enabled
        : DEFAULT_NOTIFICATION_PREFERENCES.enabled,
    kinds,
  };
}

type SettingsReader = Pick<typeof settingsService, 'get'>;

async function readPreferences(
  settings: SettingsReader,
): Promise<NotificationPreferences> {
  const [enabled, kinds] = await Promise.all([
    settings.get<boolean>(NOTIFICATION_SETTING_KEYS.enabled, true),
    settings.get<Record<NotificationKind, boolean> | null>(
      NOTIFICATION_SETTING_KEYS.kinds,
      null,
    ),
  ]);
  return normalisePreferences({ enabled, kinds: kinds as never });
}

export interface NotificationInput {
  /** Stable dedupe key — one notification per key, ever. */
  key: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string | null;
  severity?: NotificationSeverity;
}

export const notificationService = {
  async preferences(): Promise<NotificationPreferences> {
    return readPreferences(settingsService);
  },

  async savePreferences(preferences: NotificationPreferences): Promise<void> {
    const safe = normalisePreferences(preferences);
    await Promise.all([
      settingsService.set(NOTIFICATION_SETTING_KEYS.enabled, safe.enabled),
      settingsService.set(NOTIFICATION_SETTING_KEYS.kinds, safe.kinds),
    ]);
    notifyNotificationsChanged();
  },

  /**
   * Create a notification unless one with the same key already exists or the
   * operator has muted this kind. Never throws into a checkout or stock flow:
   * a notification is useful, but not worth failing a sale over.
   */
  async create(input: NotificationInput): Promise<NotificationRecord | null> {
    try {
      const preferences = await readPreferences(settingsService);
      if (!preferences.enabled || !preferences.kinds[input.kind]) return null;

      const key = input.key.trim();
      if (!key) return null;

      const existing = await notificationsRepository.findByIndex('by_key', key);
      if (existing.length > 0) return existing[0] ?? null;

      const record = await notificationsRepository.create({
        key,
        kind: input.kind,
        severity: input.severity ?? 'info',
        title: input.title.slice(0, 120),
        body: input.body?.slice(0, 300),
        link: input.link ?? null,
        readAt: null,
      });
      notifyNotificationsChanged();
      return record;
    } catch {
      return null;
    }
  },

  async list(limit = 40): Promise<NotificationRecord[]> {
    const all = await notificationsRepository.list();
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit));
  },

  async unreadCount(): Promise<number> {
    const all = await notificationsRepository.list();
    return all.filter((entry) => !entry.readAt).length;
  },

  async markRead(id: string): Promise<void> {
    const record = await notificationsRepository.getById(id);
    if (!record || record.readAt) return;
    await notificationsRepository.update(id, { readAt: nowISO() });
    notifyNotificationsChanged();
  },

  async markAllRead(): Promise<number> {
    const all = await notificationsRepository.list();
    const unread = all.filter((entry) => !entry.readAt);
    if (unread.length === 0) return 0;

    const timestamp = nowISO();
    for (const entry of unread) {
      await notificationsRepository.update(entry.id, { readAt: timestamp });
    }
    notifyNotificationsChanged();
    return unread.length;
  },

  /** Remove read notifications older than the retention window. */
  async prune(readOlderThanDays = 30): Promise<number> {
    const cutoff =
      Date.now() - Math.max(1, readOlderThanDays) * 24 * 60 * 60 * 1000;
    const all = await notificationsRepository.list();
    let removed = 0;
    for (const entry of all) {
      if (!entry.readAt) continue;
      if (Date.parse(entry.readAt) >= cutoff) continue;
      await notificationsRepository.remove(entry.id);
      removed += 1;
    }
    if (removed > 0) notifyNotificationsChanged();
    return removed;
  },
};
