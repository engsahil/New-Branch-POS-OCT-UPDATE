import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import styles from './AdminMenu.module.css';

export interface AdminMenuProps {
  /** Display name for the account, falling back to "Admin". */
  name?: string;
  /** Called when the operator chooses Sign out. */
  onSignOut: () => void;
  /** Called when the operator opens My profile. */
  onProfile: () => void;
  /** Called by the settings link. */
  onSettings: () => void;
}

const ChevronIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6.5 9.5 5.5 5 5.5-5" />
  </svg>
);

/**
 * Administrator menu in the top-right of the dashboard header.
 *
 * It shows the signed-in account and links only to screens that exist. The
 * account itself is a single administrator, so the role line states that
 * plainly rather than inventing a team model.
 */
export function AdminMenu({
  name,
  onSignOut,
  onProfile,
  onSettings,
}: AdminMenuProps) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatar = user?.avatar?.dataUrl;
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} style={{ overflow: 'hidden' }} aria-hidden="true">
          {avatar && failedAvatar !== avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} onError={() => setFailedAvatar(avatar)} /> :
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" /></svg>}
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{name?.trim() || 'Admin'}</span>
          <span className={styles.role}>Administrator</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open ? (
        <div className={styles.panel} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              setOpen(false);
              onProfile();
            }}
          >
            My profile
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            Settings
          </button>
          <div className={styles.separator} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
