import { useState } from 'react';
import { useRestaurantBranding } from '@/hooks/useRestaurantBranding';
import styles from './BrandMark.module.css';

/** Replaces the default mark when a valid saved logo exists; never both. */
export function BrandMark() {
  const profile = useRestaurantBranding();
  const logo = profile?.logo?.dataUrl?.startsWith('data:image/') ? profile.logo.dataUrl : null;
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={styles.mark}>
    {logo && failed !== logo ? <img src={logo} alt={profile?.name ? `${profile.name} logo` : 'Restaurant logo'} className={styles.logo} onError={() => setFailed(logo)} /> :
      <svg viewBox="0 0 24 24" fill="none" width="17" height="17" aria-hidden="true"><path d="M5 8.5h14M5 8.5 6.5 18h11L19 8.5M5 8.5 7.5 5h9L19 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
  </span>;
}
