import { addOnsRepository } from '@/data/repositories';
import type { AddOnRecord } from '@/types/domain';
import type { ID, Paisa } from '@/types/common';
import { assertText, sanitisePrice } from '@/utils/validate';

export interface AddOnInput {
  name: string;
  price: Paisa;
  isActive: boolean;
  costPrice?: Paisa | null;
  menuItemIds?: ID[];
}

async function validateName(value: string, excludeId?: string): Promise<string> {
  const name = assertText(value, 'Add-on name', { max: 80 });
  const rows = await addOnsRepository.list();
  if (rows.some((row) => row.id !== excludeId && row.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('A add-on with this name already exists. Use a distinct name.');
  }
  return name;
}

export const addOnService = {
  async list(): Promise<AddOnRecord[]> {
    const all = await addOnsRepository.list();
    return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  },

  async listActive(): Promise<AddOnRecord[]> {
    const all = await this.list();
    return all.filter((t) => t.isActive === 1);
  },

  async create(input: AddOnInput): Promise<AddOnRecord> {
    return addOnsRepository.create({
      name: await validateName(input.name),
      price: sanitisePrice(input.price) ?? 0,
      isActive: input.isActive ? 1 : 0,
      costPrice: input.costPrice == null ? null : sanitisePrice(input.costPrice),
      menuItemIds: [...new Set(input.menuItemIds ?? [])],
    });
  },

  async update(id: string, input: AddOnInput): Promise<AddOnRecord> {
    return addOnsRepository.update(id, {
      name: await validateName(input.name, id),
      price: sanitisePrice(input.price) ?? 0,
      isActive: input.isActive ? 1 : 0,
      costPrice: input.costPrice == null ? null : sanitisePrice(input.costPrice),
      menuItemIds: [...new Set(input.menuItemIds ?? [])],
    });
  },

  async remove(id: string): Promise<void> {
    await addOnsRepository.remove(id, { hard: true });
  },

  async count(): Promise<number> {
    return (await addOnsRepository.list()).length;
  },
};
