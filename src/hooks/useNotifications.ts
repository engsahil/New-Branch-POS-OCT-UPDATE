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
} from '@/services/notificationService';
import type { NotificationRecord } from '@/types/domain';

export interface UseNotificationsResult {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotifications(limit = 40): UseNotificationsResult {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const request = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const [items, count] = await Promise.all([
        notificationService.list(limit), notificationService.unreadCount(),
      ]);
      if (sequence === request.current) {
        setNotifications(items);
        setUnreadCount(count);
      }
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    let active = true;
    const run = () => {
      if (active) void load();
    };
    void load();
    const unsubscribe = subscribeNotifications(run);
    return () => {
      active = false;
      request.current += 1;
      unsubscribe();
    };
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    await notificationService.markRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    await notificationService.markAllRead();
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    reload: load,
    markRead,
    markAllRead,
  };
}
