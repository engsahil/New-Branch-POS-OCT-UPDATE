/**
 * Delivery management built on the existing orders, customers and settings
 * stores. Financial order status and totals remain owned by orderService;
 * this service only records delivery progress and a small rider roster.
 */

import {
  customersRepository,
  orderItemsRepository,
  ordersRepository,
} from '@/data/repositories';
import { settingsService } from './settingsService';
import type {
  CustomerRecord,
  DeliveryHistoryEntry,
  DeliveryRider,
  DeliveryStatus,
  OrderItemRecord,
  OrderRecord,
} from '@/types/domain';
import type { ID } from '@/types/common';
import { createId } from '@/utils/id';
import { nowISO } from '@/utils/date';
import { sanitiseText } from '@/utils/validate';

export const DELIVERY_RIDERS_KEY = 'delivery.riders';

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready-for-delivery',
  'assigned',
  'out-for-delivery',
  'delivered',
  'cancelled',
];

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  'ready-for-delivery': 'Ready for Delivery',
  assigned: 'Assigned',
  'out-for-delivery': 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function deliveryStatusLabel(status: DeliveryStatus): string {
  return STATUS_LABELS[status];
}

export function getDeliveryStatus(order: OrderRecord): DeliveryStatus {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.deliveryStatus && DELIVERY_STATUSES.includes(order.deliveryStatus)) {
    return order.deliveryStatus;
  }
  return 'pending';
}

export interface DeliveryDetails {
  order: OrderRecord;
  items: OrderItemRecord[];
  customer?: CustomerRecord;
  rider?: DeliveryRider;
}

export interface DeliveryUpdateInput {
  status: DeliveryStatus;
  assignedRiderId: ID | null;
  address: string;
  notes: string;
}

function cleanRiders(value: unknown): DeliveryRider[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rider): rider is DeliveryRider =>
      Boolean(rider) &&
      typeof rider.id === 'string' &&
      typeof rider.name === 'string' &&
      typeof rider.isActive === 'boolean',
  );
}

export const deliveryService = {
  /** Delivery orders are existing completed sales with delivery metadata. */
  async list(): Promise<OrderRecord[]> {
    const orders = await ordersRepository.list();
    return orders
      .filter(
        (order) =>
          order.orderType === 'delivery' &&
          (order.status === 'completed' ||
            order.status === 'cancelled' ||
            order.status === 'refunded'),
      )
      .sort((a, b) =>
        (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt),
      );
  },

  async getDetails(orderId: ID): Promise<DeliveryDetails | undefined> {
    const order = await ordersRepository.getById(orderId);
    if (!order || order.deletedAt || order.orderType !== 'delivery') {
      return undefined;
    }

    const [items, customer, riders] = await Promise.all([
      orderItemsRepository.findByIndex('by_orderId', orderId),
      order.customerId
        ? customersRepository.getById(order.customerId)
        : Promise.resolve(undefined),
      this.listRiders(),
    ]);

    return {
      order,
      items: items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      customer: customer?.deletedAt ? undefined : customer,
      rider: riders.find((rider) => rider.id === order.assignedRiderId),
    };
  },

  async listRiders(): Promise<DeliveryRider[]> {
    return cleanRiders(
      await settingsService.get<unknown>(DELIVERY_RIDERS_KEY, []),
    ).sort((a, b) => a.name.localeCompare(b.name));
  },

  async addRider(input: { name: string; phone?: string }): Promise<DeliveryRider> {
    const name = sanitiseText(input.name, 80);
    if (!name) throw new Error('Rider name is required.');

    const rider: DeliveryRider = {
      id: createId(),
      name,
      phone: sanitiseText(input.phone, 30) || undefined,
      isActive: true,
    };
    await settingsService.set(DELIVERY_RIDERS_KEY, [
      ...(await this.listRiders()),
      rider,
    ]);
    return rider;
  },

  async updateRider(
    riderId: ID,
    input: { name: string; phone?: string },
  ): Promise<DeliveryRider> {
    const name = sanitiseText(input.name, 80);
    if (!name) throw new Error('Rider name is required.');
    const riders = await this.listRiders();
    const current = riders.find((rider) => rider.id === riderId);
    if (!current) throw new Error('Rider not found.');

    const updated: DeliveryRider = {
      ...current,
      name,
      phone: sanitiseText(input.phone, 30) || undefined,
    };
    await settingsService.set(
      DELIVERY_RIDERS_KEY,
      riders.map((rider) => (rider.id === riderId ? updated : rider)),
    );
    return updated;
  },

  async setRiderActive(riderId: ID, isActive: boolean): Promise<void> {
    const riders = await this.listRiders();
    if (!riders.some((rider) => rider.id === riderId)) {
      throw new Error('Rider not found.');
    }
    await settingsService.set(
      DELIVERY_RIDERS_KEY,
      riders.map((rider) =>
        rider.id === riderId ? { ...rider, isActive } : rider,
      ),
    );
  },

  /** Update the fulfilment record without changing any sale or payment data. */
  async update(
    orderId: ID,
    input: DeliveryUpdateInput,
  ): Promise<OrderRecord> {
    if (!DELIVERY_STATUSES.includes(input.status)) {
      throw new Error('Choose a valid delivery status.');
    }

    const order = await ordersRepository.getById(orderId);
    if (!order || order.deletedAt || order.orderType !== 'delivery') {
      throw new Error('Delivery order not found.');
    }
    if (order.status !== 'completed') {
      throw new Error('This sale is no longer active.');
    }

    const address = sanitiseText(input.address, 300);
    if (!address) throw new Error('Delivery address is required.');

    const riders = await this.listRiders();
    const selectedRider = input.assignedRiderId
      ? riders.find((rider) => rider.id === input.assignedRiderId)
      : undefined;
    if (
      input.assignedRiderId &&
      (!selectedRider ||
        (!selectedRider.isActive && selectedRider.id !== order.assignedRiderId))
    ) {
      throw new Error('Choose an active rider.');
    }

    const previousStatus = getDeliveryStatus(order);
    const previousRiderId = order.assignedRiderId ?? null;
    const nextRiderId = selectedRider?.id ?? null;
    const timestamp = nowISO();
    const history: DeliveryHistoryEntry[] = [...(order.deliveryHistory ?? [])];

    if (input.status !== previousStatus) {
      history.push({
        status: input.status,
        at: timestamp,
        message: `Status changed to ${deliveryStatusLabel(input.status)}.`,
      });
    }
    if (nextRiderId !== previousRiderId) {
      history.push({
        status: input.status,
        at: timestamp,
        message: selectedRider
          ? `Assigned to ${selectedRider.name}.`
          : 'Rider assignment removed.',
      });
    }

    return ordersRepository.update(orderId, {
      deliveryStatus: input.status,
      assignedRiderId: nextRiderId,
      deliveryAddress: address,
      deliveryNotes: sanitiseText(input.notes, 500) || undefined,
      deliveryCompletedAt:
        input.status === 'delivered'
          ? order.deliveryCompletedAt ?? timestamp
          : null,
      deliveryHistory: history,
    });
  },
};
