/**
 * Notification list state.
 *
 * One shared listener set, like the other collection hooks: anything that
 * writes a notification refreshes every mounted consumer. No interval and no
 * polling — the list is read when it changes and when it is first mounted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  notificationService,
  subscribeNotifications,
  type NotificationSnapshot,
} from '@/services/notificationService';
import type { NotificationRecord } from '@/types/domain';

export interface UseNotificationsResult {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  preferences: NotificationSnapshot['preferences'];
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotifications(limit = 40): UseNotificationsResult {
  const [snapshot, setSnapshot] = useState<NotificationSnapshot>({
    notifications: [], unreadCount: 0,
    preferences: { enabled: true, kinds: { order: true, stock: true, payment: true, audit: true, system: true } },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const next = await notificationService.snapshot(limit);
      if (sequence === request.current) { setSnapshot(next); setError(null); }
    } catch {
      if (sequence === request.current) setError('Notifications could not be loaded. Please retry.');
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    let active = true;
    const run = () => { if (active) void load(); };
    run();
    const unsubscribe = subscribeNotifications(run);
    return () => { active = false; request.current += 1; unsubscribe(); };
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    await notificationService.markRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    await notificationService.markAllRead();
  }, []);

  return {
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    preferences: snapshot.preferences,
    loading,
    error,
    reload: load,
    markRead,
    markAllRead,
  };
}
