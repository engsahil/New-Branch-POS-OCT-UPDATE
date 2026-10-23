import { APP_CONFIG } from '@/config/app.config';
import type { ISODateString } from '@/types/common';

export function nowISO(): ISODateString {
  return new Date().toISOString();
}

export function formatDate(value: ISODateString | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(APP_CONFIG.locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTime(value: ISODateString | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(APP_CONFIG.locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateTime(value: ISODateString | Date): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/**
 * Short, human relative time for notification timestamps.
 * Falls back to a plain date once the entry is more than a week old.
 */
export function formatRelativeTime(value: ISODateString | Date, now = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';

  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return formatDate(date);
}
