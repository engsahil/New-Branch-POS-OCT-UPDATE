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
import { buildEntity } from '@/data/repositories/createRepository';
import { db } from '@/data/db/indexedDb';
import { STORES } from '@/config/storage.config';
import type {
  NotificationKind,
  NotificationRecord,
  NotificationSeverity,
} from '@/types/domain';
import { settingsService } from './settingsService';
import type { SettingRecord } from '@/types/domain';
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

export interface NotificationSnapshot {
  notifications: NotificationRecord[];
  unreadCount: number;
  preferences: NotificationPreferences;
}

/** Critical stock warnings remain accessible when ordinary alerts are muted. */
export function notificationEligible(
  record: Pick<NotificationRecord, 'kind' | 'severity'>,
  preferences: NotificationPreferences,
): boolean {
  return record.severity === 'critical' ||
    (preferences.enabled && preferences.kinds[record.kind]);
}

export function compareNotifications(a: NotificationRecord, b: NotificationRecord): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);
}

type Listener = () => void;
const listeners = new Set<Listener>();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('pos.notifications.changed') : null;
if (channel) channel.onmessage = () => { for (const listener of listeners) listener(); };

/** Tell mounted views that the notification list or read state changed. */
export function notifyNotificationsChanged(): void {
  for (const listener of listeners) listener();
  channel?.postMessage('changed');
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
    // Both controls commit together. Existing read timestamps are untouched.
    await db.transaction([STORES.settings], 'readwrite', async (stores) => {
      const store = stores[STORES.settings]!;
      for (const [id, value] of [
        [NOTIFICATION_SETTING_KEYS.enabled, safe.enabled],
        [NOTIFICATION_SETTING_KEYS.kinds, safe.kinds],
      ] as const) {
        const current = await db.request(store.get(id)) as SettingRecord | undefined;
        const timestamp = nowISO();
        await db.request(store.put({
          ...current, id, value, createdAt: current?.createdAt ?? timestamp,
          updatedAt: timestamp, deletedAt: null, rev: (current?.rev ?? 0) + 1,
        }));
      }
    });
    notifyNotificationsChanged();
  },

  /**
   * Create a notification unless one with the same key already exists or the
   * operator has muted this kind. Never throws into a checkout or stock flow:
   * a notification is useful, but not worth failing a sale over.
   */
  async create(input: NotificationInput): Promise<NotificationRecord | null> {
    try {
      const key = input.key.trim();
      if (!key) return null;
      // Preferences, deduplication and insertion share one transaction.
      const { record, created } = await db.transaction([STORES.notifications, STORES.settings], 'readwrite', async (stores) => {
        const settings = stores[STORES.settings]!;
        const [enabled, kinds] = await Promise.all([
          db.request(settings.get(NOTIFICATION_SETTING_KEYS.enabled)) as Promise<SettingRecord<boolean> | undefined>,
          db.request(settings.get(NOTIFICATION_SETTING_KEYS.kinds)) as Promise<SettingRecord<NotificationPreferences['kinds']> | undefined>,
        ]);
        const preferences = normalisePreferences({ enabled: enabled?.value ?? true, kinds: kinds?.value ?? DEFAULT_NOTIFICATION_PREFERENCES.kinds });
        const severity = input.severity ?? 'info';
        if (!notificationEligible({ kind: input.kind, severity }, preferences)) return { record: null, created: false };
        const store = stores[STORES.notifications]!;
        const matches = await db.request(store.index('by_key').getAll(key)) as NotificationRecord[];
        const existing = matches.find((entry) => !entry.deletedAt);
        if (existing) return { record: existing, created: false };
        const record = buildEntity<NotificationRecord>({
          key, kind: input.kind, severity,
          title: input.title.slice(0, 120), body: input.body?.slice(0, 300),
          link: input.link ?? null, readAt: null,
        });
        await db.request(store.put(record));
        return { record, created: true };
      });
      if (created) notifyNotificationsChanged();
      return record;
    } catch {
      return null;
    }
  },

  /** One read transaction supplies row state, badge and preferences. */
  async snapshot(limit = 40): Promise<NotificationSnapshot> {
    return db.transaction([STORES.notifications, STORES.settings], 'readonly', async (stores) => {
      const settings = stores[STORES.settings]!;
      const [rows, enabled, kinds] = await Promise.all([
        db.request(stores[STORES.notifications]!.getAll()) as Promise<NotificationRecord[]>,
        db.request(settings.get(NOTIFICATION_SETTING_KEYS.enabled)) as Promise<SettingRecord<boolean> | undefined>,
        db.request(settings.get(NOTIFICATION_SETTING_KEYS.kinds)) as Promise<SettingRecord<NotificationPreferences['kinds']> | undefined>,
      ]);
      const preferences = normalisePreferences({ enabled: enabled?.value ?? true, kinds: kinds?.value ?? DEFAULT_NOTIFICATION_PREFERENCES.kinds });
      const eligible = rows.filter((row) => !row.deletedAt && notificationEligible(row, preferences));
      return {
        notifications: eligible.sort(compareNotifications).slice(0, Math.max(1, limit)),
        unreadCount: eligible.filter((row) => !row.readAt).length,
        preferences,
      };
    });
  },

  async list(limit = 40): Promise<NotificationRecord[]> {
    return (await this.snapshot(limit)).notifications;
  },

  async unreadCount(): Promise<number> {
    return (await this.snapshot(Number.MAX_SAFE_INTEGER)).unreadCount;
  },

  /** Preserve the first read timestamp, including under concurrent readers. */
  async markReadMany(ids: readonly string[]): Promise<number> {
    const requested = new Set(ids);
    const changed = await db.transaction([STORES.notifications], 'readwrite', async (stores) => {
      const store = stores[STORES.notifications]!;
      let count = 0;
      for (const id of requested) {
        const current = await db.request(store.get(id)) as NotificationRecord | undefined;
        if (!current || current.deletedAt || current.readAt) continue;
        const timestamp = nowISO();
        await db.request(store.put({ ...current, readAt: timestamp, updatedAt: timestamp, rev: (current.rev ?? 1) + 1 }));
        count += 1;
      }
      return count;
    });
    if (changed) notifyNotificationsChanged();
    return changed;
  },

  async markRead(id: string): Promise<void> { await this.markReadMany([id]); },

  async markAllRead(): Promise<number> {
    const eligible = await this.list(Number.MAX_SAFE_INTEGER);
    return this.markReadMany(eligible.map((entry) => entry.id));
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
