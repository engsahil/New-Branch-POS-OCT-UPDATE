/** Load delivery orders and rider settings from the existing local services. */

import { useCallback, useEffect, useState } from 'react';
import { deliveryService } from '@/services/deliveryService';
import type { DeliveryRider, OrderRecord } from '@/types/domain';

export interface UseDeliveriesResult {
  deliveries: OrderRecord[];
  riders: DeliveryRider[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useDeliveries(): UseDeliveriesResult {
  const [deliveries, setDeliveries] = useState<OrderRecord[]>([]);
  const [riders, setRiders] = useState<DeliveryRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextDeliveries, nextRiders] = await Promise.all([
        deliveryService.list(),
        deliveryService.listRiders(),
      ]);
      setDeliveries(nextDeliveries);
      setRiders(nextRiders);
      setError(null);
    } catch {
      setError('Could not load delivery orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { deliveries, riders, loading, error, reload: load };
}
