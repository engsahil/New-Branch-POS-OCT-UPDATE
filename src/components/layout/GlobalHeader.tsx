import { useEffect, useState } from 'react';
import { restaurantService } from '@/services/restaurantService';
import { NotificationBell } from './NotificationBell';
import styles from './GlobalHeader.module.css';

/**
 * Slim application header.
 *
 * It exists to host the notification centre, which has to be reachable from
 * every module. The only other content is the configured restaurant name, so
 * the bar carries real information and no decoration.
 */
export function GlobalHeader() {
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
  }, []);

  return (
    <header className={styles.header} data-print-hide>
      <span className={styles.restaurantName} data-tour="restaurant">
        {restaurantName}
      </span>
      <NotificationBell />
    </header>
  );
}
