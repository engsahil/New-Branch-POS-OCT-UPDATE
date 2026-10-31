import { useEffect, useState } from 'react';
import { restaurantService, subscribeRestaurantProfile } from '@/services/restaurantService';
import type { RestaurantRecord } from '@/types/domain';

/** One persisted restaurant record, shared by shell branding and receipts. */
export function useRestaurantBranding() {
  const [profile, setProfile] = useState<RestaurantRecord | null>(null);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const sequence = ++request;
      void restaurantService.getRecord()
        .then((record) => { if (active && sequence === request) setProfile(record ?? null); })
        .catch(() => { if (active && sequence === request) setProfile(null); });
    };
    load();
    const unsubscribe = subscribeRestaurantProfile(load);
    return () => { active = false; request += 1; unsubscribe(); };
  }, []);
  return profile;
}
