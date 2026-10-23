import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { NAV_ITEMS, ROUTE_PATHS } from '@/app/routes';
import { restaurantService } from '@/services/restaurantService';
import { AdminMenu } from './AdminMenu';
import { NotificationBell } from './NotificationBell';
import styles from './GlobalHeader.module.css';

/** Longest label that still fits the slim bar next to the bell and account. */
function titleFor(pathname: string): string {
  if (pathname.startsWith(ROUTE_PATHS.dashboard)) return 'Dashboard';
  if (pathname.startsWith(ROUTE_PATHS.profile)) return 'My profile';
  const match = [...NAV_ITEMS]
    .filter((item) => item.path !== '/')
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
  return match?.label ?? 'Point of sale';
}

/**
 * Application header.
 *
 * Carries the signed-in restaurant, the current section, the notification
 * centre and the administrator menu. The notification centre lives here only
 * so it is reachable from every screen without repeating the bell elsewhere.
 */
export function GlobalHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [restaurantName, setRestaurantName] = useState<string>('');

  useEffect(() => {
    let active = true;
    void restaurantService
      .getRecord()
      .then((profile) => {
        if (active) setRestaurantName(profile?.name?.trim() ?? '');
      })
      .catch(() => {
        /* the header simply shows no name if the profile cannot be read */
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <header className={styles.header} data-print-hide>
      <div className={styles.leading}>
        <span className={styles.restaurantName} data-tour="restaurant">
          {restaurantName}
        </span>
        <span className={styles.sectionName}>{titleFor(pathname)}</span>
      </div>

      <div className={styles.trailing}>
        <NotificationBell />
        <AdminMenu
          name={user?.displayName || 'Admin'}
          onSignOut={() => {
            logout();
            navigate(ROUTE_PATHS.pos);
          }}
          onProfile={() => navigate(ROUTE_PATHS.profile)}
          onSettings={() => navigate(ROUTE_PATHS.admin)}
        />
        <span className={styles.signedInAs}>
          {user ? `Signed in as ${user.username}` : null}
        </span>
      </div>
    </header>
  );
}
