import { toppingsRepository } from '@/data/repositories';
import type { ToppingRecord } from '@/types/domain';
import type { ID, Paisa } from '@/types/common';
import { assertText, sanitisePrice } from '@/utils/validate';

export interface ToppingInput {
  name: string;
  price: Paisa;
  isActive: boolean;
  costPrice?: Paisa | null;
  menuItemIds?: ID[];
}

async function validateName(value: string, excludeId?: string): Promise<string> {
  const name = assertText(value, 'Topping name', { max: 80 });
  const rows = await toppingsRepository.list();
  if (rows.some((row) => row.id !== excludeId && row.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('A topping with this name already exists. Use a distinct name.');
  }
  return name;
}

export const toppingService = {
  async list(): Promise<ToppingRecord[]> {
    const all = await toppingsRepository.list();
    return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  },

  async listActive(): Promise<ToppingRecord[]> {
    const all = await this.list();
    return all.filter((t) => t.isActive === 1);
  },

  async create(input: ToppingInput): Promise<ToppingRecord> {
    return toppingsRepository.create({
      name: await validateName(input.name),
      price: sanitisePrice(input.price) ?? 0,
      isActive: input.isActive ? 1 : 0,
      costPrice: input.costPrice == null ? null : sanitisePrice(input.costPrice),
      menuItemIds: [...new Set(input.menuItemIds ?? [])],
    });
  },

  async update(id: string, input: ToppingInput): Promise<ToppingRecord> {
    return toppingsRepository.update(id, {
      name: await validateName(input.name, id),
      price: sanitisePrice(input.price) ?? 0,
      isActive: input.isActive ? 1 : 0,
      costPrice: input.costPrice == null ? null : sanitisePrice(input.costPrice),
      menuItemIds: [...new Set(input.menuItemIds ?? [])],
    });
  },

  async remove(id: string): Promise<void> {
    await toppingsRepository.remove(id, { hard: true });
  },

  async count(): Promise<number> {
    return (await toppingsRepository.list()).length;
  },
};
