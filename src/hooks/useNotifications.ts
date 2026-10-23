/**
 * Notification list state.
 *
 * One shared listener set, like the other collection hooks: anything that
 * writes a notification refreshes every mounted consumer. No interval and no
 * polling — the list is read when it changes and when it is first mounted.
 */

import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async () => {
    try {
      setNotifications(await notificationService.list(limit));
    } finally {
      setLoading(false);
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
    unreadCount: notifications.filter((entry) => !entry.readAt).length,
    loading,
    reload: load,
    markRead,
    markAllRead,
  };
}
