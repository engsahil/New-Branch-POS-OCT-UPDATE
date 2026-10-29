import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { AlertIcon, BellIcon, CheckIcon } from '@/components/ui/Icons';
import { useNotifications } from '@/hooks/useNotifications';
import { formatRelativeTime } from '@/utils/date';
import type { NotificationRecord } from '@/types/domain';
import styles from './NotificationBell.module.css';

function severityClass(notification: NotificationRecord): string {
  if (notification.severity === 'critical') return styles.critical ?? '';
  if (notification.severity === 'warning') return styles.warning ?? '';
  return styles.info ?? '';
}

/**
 * Header bell with unread badge and recent notifications.
 *
 * The unread count is derived from persisted records, so it is correct after
 * a refresh. Visible entries are marked read when they enter the panel’s
 * viewport; clicking an item also opens its linked module.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(30);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pendingRead = useRef(new Set<string>());

  // Only rows intersecting the scroll viewport have actually been viewed.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.unreadId;
        if (!entry.isIntersecting || !id || pendingRead.current.has(id)) continue;
        pendingRead.current.add(id);
        void markRead(id).catch(() => {}).finally(() => pendingRead.current.delete(id));
      }
    }, { root: list, threshold: 0.5 });
    list.querySelectorAll('[data-unread-id]').forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [open, notifications, markRead]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function openNotification(notification: NotificationRecord) {
    await markRead(notification.id);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.bell}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        data-tour="notifications"
      >
        <BellIcon width={19} height={19} />
        {unreadCount > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <header className={styles.head}>
            <span className={styles.title}>Notifications</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Mark all read
            </Button>
          </header>

          {notifications.length === 0 ? (
            <p className={styles.empty}>No notifications yet.</p>
          ) : (
            <ul className={styles.list} ref={listRef}>
              {notifications.map((notification) => (
                <li key={notification.id} data-unread-id={notification.readAt ? undefined : notification.id}>
                  <button
                    type="button"
                    className={`${styles.item} ${notification.readAt ? '' : styles.unread}`}
                    onClick={() => void openNotification(notification)}
                  >
                    <span className={`${styles.dot} ${severityClass(notification)}`} aria-hidden="true">
                      {notification.severity === 'critical' ? (
                        <AlertIcon width={13} height={13} />
                      ) : notification.readAt ? (
                        <CheckIcon width={12} height={12} />
                      ) : null}
                    </span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{notification.title}</span>
                      {notification.body ? (
                        <span className={styles.itemText}>{notification.body}</span>
                      ) : null}
                      <span className={styles.itemTime}>
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
