/**
 * Pure backup/restore logic. The browser-specific IndexedDB adapter lives in
 * dataPortService.ts; keeping validation and merge planning independent makes
 * it possible to verify a full backup round-trip against an isolated store.
 */

export interface DataPortRecord extends Record<string, unknown> {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface DataPortTransaction {
  getAll(store: string): Promise<unknown[]>;
  put(store: string, record: unknown): Promise<void>;
}

export interface DataPortDatabase {
  getAll(store: string): Promise<unknown[]>;
  transaction<T>(
    stores: string[],
    mode: 'readonly' | 'readwrite',
    work: (transaction: DataPortTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface DataPortConfiguration {
  format: string;
  version: number;
  legacyVersion: number;
  applicationName: string;
  applicationVersion: string;
  dataSchemaVersion: number;
  databaseName: string;
  databaseVersion: number;
  /** Every store in the live IndexedDB schema, in schema order. */
  allStores: string[];
  /** Persistent POS data stores, excluding per-device/runtime-only stores. */
  backupStores: string[];
  /** Store list written by the original v1 exporter. */
  legacyBackupStores: string[];
  /** Explicitly disclosed security/transport exclusions. */
  excludedStores: Record<string, string>;
  orderSequenceSettingId: string;
  /** Store -> unique secondary-index field, as defined by IndexedDB. */
  uniqueIndexes: Record<string, string>;
}

export interface BackupPreview {
  exportedAt: string;
  sourceOrigin: string;
  applicationVersion: string;
  legacy: boolean;
  totalRecords: number;
  storeCounts: Record<string, number>;
  excludedStores: Record<string, string>;
  excludedCredentialRecords: number;
}

export interface StoreImportTally {
  added: number;
  updated: number;
  skipped: number;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  /** A tally is included for every business store in the backup. */
  stores: Record<string, StoreImportTally>;
  /** Legacy v1 files carried admin records; credentials are never restored. */
  excludedCredentialRecords: number;
}

interface NormalisedBackup {
  exportedAt: string;
  sourceOrigin: string;
  applicationVersion: string;
  legacy: boolean;
  stores: Record<string, DataPortRecord[]>;
  excludedStores: Record<string, string>;
  excludedCredentialRecords: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireStoreManifest(
  actual: unknown,
  expected: string[],
  label: string,
): void {
  if (!Array.isArray(actual) || actual.some((entry) => typeof entry !== 'string')) {
    throw new Error(`The backup ${label} manifest is missing or invalid.`);
  }

  const actualSet = new Set(actual as string[]);
  if (actualSet.size !== actual.length || actualSet.size !== expected.length) {
    throw new Error(`The backup ${label} manifest does not match this POS schema.`);
  }
  for (const name of expected) {
    if (!actualSet.has(name)) {
      throw new Error(`The backup is missing the required “${name}” store.`);
    }
  }
}

function assertRecordShape(store: string, input: unknown): DataPortRecord {
  if (!isRecord(input)) {
    throw new Error(`A record in the “${store}” store is not an object.`);
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new Error(`A record in the “${store}” store has no valid id.`);
  }
  if (!isValidTimestamp(input.createdAt) || !isValidTimestamp(input.updatedAt)) {
    throw new Error(
      `A record in the “${store}” store has invalid creation/update timestamps.`,
    );
  }

  // Validate the fields required by the IndexedDB indexes and by the
  // persistent setting/order models. Other fields are preserved as-is so a
  // backup never loses fields added by a later compatible application build.
  if (store === 'settings' && !hasOwn(input, 'value')) {
    throw new Error('A settings record is missing its value.');
  }
  if (store === 'orders' && (typeof input.orderNumber !== 'string' || !input.orderNumber)) {
    throw new Error('An order record is missing its order number.');
  }
  if (store === 'orderItems' && (typeof input.orderId !== 'string' || !input.orderId)) {
    throw new Error('An order item is missing its parent order id.');
  }
  if (store === 'sales' && (typeof input.orderId !== 'string' || !input.orderId)) {
    throw new Error('A sale record is missing its parent order id.');
  }
  if (
    store === 'itemPrices' &&
    (typeof input.menuItemId !== 'string' || !finiteNumber(input.price))
  ) {
    throw new Error('A product variant has an invalid product link or price.');
  }
  if (store === 'deals' && !Array.isArray(input.items)) {
    throw new Error('A deal record is missing its item list.');
  }
  if (
    store === 'inventory' &&
    input.quantity !== undefined &&
    !finiteNumber(input.quantity)
  ) {
    throw new Error('An inventory record has an invalid stock quantity.');
  }

  return input as DataPortRecord;
}

function parseAndValidate(
  input: unknown,
  config: DataPortConfiguration,
): NormalisedBackup {
  if (!isRecord(input) || input.format !== config.format) {
    throw new Error(
      'This file is not a supported POS data backup. Choose a backup exported by this POS.',
    );
  }

  if (!Number.isInteger(input.version)) {
    throw new Error('The backup format version is missing or invalid.');
  }

  const version = input.version as number;
  const isLegacy = version === config.legacyVersion;
  if (!isLegacy && version !== config.version) {
    throw new Error(
      `Backup format version ${String(version)} is not supported by this POS. No data was changed.`,
    );
  }

  if (!isValidTimestamp(input.exportedAt)) {
    throw new Error('The backup export timestamp is missing or invalid.');
  }
  if (!isRecord(input.source)) {
    throw new Error('The backup source metadata is missing or invalid.');
  }
  if (
    input.source.database !== config.databaseName ||
    typeof input.source.origin !== 'string' ||
    !Number.isInteger(input.source.databaseVersion) ||
    (input.source.databaseVersion as number) < 1
  ) {
    throw new Error('The backup database metadata is incompatible or invalid.');
  }
  if ((input.source.databaseVersion as number) > config.databaseVersion) {
    throw new Error(
      'This backup was created by a newer database schema. Update the POS before importing it. No data was changed.',
    );
  }
  if (!isRecord(input.stores)) {
    throw new Error('The backup does not contain a valid stores object.');
  }

  let sourceStoreNames: string[];
  let excludedStores = { ...config.excludedStores };
  let applicationVersion = 'Earlier POS build (legacy backup)';

  if (isLegacy) {
    // v1 is the exact format emitted by the previous application release:
    // it included the admin store in the file but deliberately omitted the
    // transport-only sync queue. Admin credentials are validated, then kept
    // local and never imported.
    sourceStoreNames = config.legacyBackupStores;
  } else {
    if (
      !isRecord(input.application) ||
      input.application.name !== config.applicationName ||
      typeof input.application.version !== 'string'
    ) {
      throw new Error('The backup application metadata is missing or incompatible.');
    }
    applicationVersion = input.application.version;

    if (!isRecord(input.schema)) {
      throw new Error('The backup schema metadata is missing or invalid.');
    }
    if (input.schema.database !== config.databaseName) {
      throw new Error('The backup belongs to a different POS database.');
    }
    if (input.schema.databaseVersion !== input.source.databaseVersion) {
      throw new Error('The backup source and schema database versions do not match.');
    }
    if (
      !Number.isInteger(input.schema.databaseVersion) ||
      (input.schema.databaseVersion as number) < 1 ||
      (input.schema.databaseVersion as number) > config.databaseVersion
    ) {
      throw new Error(
        'This backup uses an unsupported IndexedDB schema. Update the POS before importing it. No data was changed.',
      );
    }
    if (
      !Number.isInteger(input.schema.dataVersion) ||
      (input.schema.dataVersion as number) < 0 ||
      (input.schema.dataVersion as number) > config.dataSchemaVersion
    ) {
      throw new Error(
        'This backup uses an unsupported POS data schema. Update the POS before importing it. No data was changed.',
      );
    }
    requireStoreManifest(input.schema.stores, config.backupStores, 'store');
    const suppliedExcludedStores = input.excludedStores;
    if (!isRecord(suppliedExcludedStores)) {
      throw new Error('The backup exclusion manifest is missing or invalid.');
    }
    const excludedNames = Object.keys(suppliedExcludedStores);
    requireStoreManifest(excludedNames, Object.keys(config.excludedStores), 'exclusion');
    for (const [name, reason] of Object.entries(config.excludedStores)) {
      if (typeof suppliedExcludedStores[name] !== 'string' || typeof reason !== 'string') {
        throw new Error(`The backup exclusion entry for “${name}” is invalid.`);
      }
    }
    excludedStores = Object.fromEntries(
      Object.keys(config.excludedStores).map((name) => [name, suppliedExcludedStores[name] as string]),
    );
    sourceStoreNames = config.backupStores;
  }

  const keys = Object.keys(input.stores);
  requireStoreManifest(keys, sourceStoreNames, 'data');

  const stores: Record<string, DataPortRecord[]> = {};
  let excludedCredentialRecords = 0;

  for (const name of sourceStoreNames) {
    const rows = input.stores[name];
    if (!Array.isArray(rows)) {
      throw new Error(`The backup store “${name}” is not an array.`);
    }

    const seen = new Set<string>();
    const validated = rows.map((row) => {
      const record = assertRecordShape(name, row);
      if (
        name === 'settings' &&
        record.id === config.orderSequenceSettingId &&
        (!finiteNumber(record.value) ||
          !Number.isSafeInteger(record.value) ||
          record.value < 0)
      ) {
        throw new Error('The order-sequence setting must be a non-negative integer.');
      }
      if (seen.has(record.id)) {
        throw new Error(`The backup contains duplicate ids in the “${name}” store.`);
      }
      seen.add(record.id);
      return record;
    });

    if (isLegacy && name === 'admin') {
      excludedCredentialRecords = validated.length;
      continue;
    }
    stores[name] = validated;
  }

  return {
    exportedAt: input.exportedAt,
    sourceOrigin: input.source.origin,
    applicationVersion,
    legacy: isLegacy,
    stores,
    excludedStores,
    excludedCredentialRecords,
  };
}

function asRecord(record: DataPortRecord): Record<string, unknown> {
  return record as Record<string, unknown>;
}

function isNewer(incoming: DataPortRecord, existing: DataPortRecord): boolean {
  return Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt);
}

function orderSequenceValue(record: DataPortRecord | undefined): number {
  const value = record ? asRecord(record).value : 0;
  return finiteNumber(value) && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function orderNumberSequence(record: DataPortRecord): number {
  const orderNumber = asRecord(record).orderNumber;
  if (typeof orderNumber !== 'string') return 0;
  const suffix = orderNumber.match(/(\d+)$/)?.[1];
  if (!suffix) return 0;
  const value = Number(suffix);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function maximumOrderNumberSequence(records: DataPortRecord[]): number {
  return records.reduce(
    (maximum, record) => Math.max(maximum, orderNumberSequence(record)),
    0,
  );
}

function makeStorePlan(
  store: string,
  incoming: DataPortRecord[],
  existing: DataPortRecord[],
  orderSequenceFloor: number,
  config: DataPortConfiguration,
  result: ImportResult,
): DataPortRecord[] {
  const tally: StoreImportTally = { added: 0, updated: 0, skipped: 0 };
  const byId = new Map(existing.map((record) => [record.id, record]));
  const writes: DataPortRecord[] = [];

  for (const record of incoming) {
    const current = byId.get(record.id);

    if (store === 'settings' && record.id === config.orderSequenceSettingId) {
      const maxSequence = Math.max(
        orderSequenceFloor,
        orderSequenceValue(record),
        orderSequenceValue(current),
      );
      const base = current && !isNewer(record, current) ? current : record;
      const merged: DataPortRecord = { ...base, value: maxSequence };
      if (!current) {
        writes.push(merged);
        tally.added += 1;
      } else if (JSON.stringify(merged) !== JSON.stringify(current)) {
        writes.push(merged);
        tally.updated += 1;
      } else {
        tally.skipped += 1;
      }
      continue;
    }

    if (!current) {
      writes.push(record);
      tally.added += 1;
    } else if (isNewer(record, current)) {
      writes.push(record);
      tally.updated += 1;
    } else {
      tally.skipped += 1;
    }
  }

  result.stores[store] = tally;
  result.added += tally.added;
  result.updated += tally.updated;
  result.skipped += tally.skipped;
  return writes;
}

function assertUniqueIndexes(
  store: string,
  existing: DataPortRecord[],
  writes: DataPortRecord[],
  config: DataPortConfiguration,
): void {
  const field = config.uniqueIndexes[store];
  if (!field) return;

  const finalById = new Map(existing.map((record) => [record.id, record]));
  for (const record of writes) finalById.set(record.id, record);

  const owners = new Map<string, string>();
  for (const record of finalById.values()) {
    const value = asRecord(record)[field];
    if (typeof value !== 'string' || value === '') continue;
    const owner = owners.get(value);
    if (owner && owner !== record.id) {
      throw new Error(
        `The backup cannot be merged safely: “${value}” already belongs to another ${store} record. Existing data was left unchanged.`,
      );
    }
    owners.set(value, record.id);
  }
}

/**
 * Construct the portable service with an IndexedDB adapter and actual schema
 * metadata. Imports are non-destructive merges and are committed atomically.
 */
export function createDataPortService(
  database: DataPortDatabase,
  config: DataPortConfiguration,
  getOrigin: () => string,
) {
  function previewBackup(input: unknown): BackupPreview {
    const backup = parseAndValidate(input, config);
    const storeCounts = Object.fromEntries(
      Object.entries(backup.stores).map(([name, rows]) => [name, rows.length]),
    ) as Record<string, number>;
    const totalRecords = Object.values(storeCounts).reduce((sum, count) => sum + count, 0);

    return {
      exportedAt: backup.exportedAt,
      sourceOrigin: backup.sourceOrigin,
      applicationVersion: backup.applicationVersion,
      legacy: backup.legacy,
      totalRecords,
      storeCounts,
      excludedStores: { ...backup.excludedStores },
      excludedCredentialRecords: backup.excludedCredentialRecords,
    };
  }

  return {
    /** Read-only snapshot of every business store in the live schema. */
    async exportBackup() {
      const stores = await database.transaction(
        config.backupStores,
        'readonly',
        async (transaction) => {
          const entries = await Promise.all(
            config.backupStores.map(
              async (name) => [name, await transaction.getAll(name)] as const,
            ),
          );
          return Object.fromEntries(entries) as Record<string, unknown[]>;
        },
      );

      return {
        format: config.format,
        version: config.version,
        exportedAt: new Date().toISOString(),
        application: {
          name: config.applicationName,
          version: config.applicationVersion,
        },
        schema: {
          database: config.databaseName,
          databaseVersion: config.databaseVersion,
          dataVersion: config.dataSchemaVersion,
          stores: [...config.backupStores],
        },
        source: {
          origin: getOrigin(),
          database: config.databaseName,
          databaseVersion: config.databaseVersion,
        },
        excludedStores: { ...config.excludedStores },
        stores,
      };
    },

    /** Validate the whole file before showing the explicit import prompt. */
    previewBackup,

    /**
     * Merge records by stable id. Newer updatedAt wins; an older/equal copy is
     * skipped. No store is cleared and no record is deleted. All stores are
     * planned and validated before the first write, then committed in one
     * IndexedDB readwrite transaction.
     */
    async importBackup(input: unknown): Promise<ImportResult> {
      const backup = parseAndValidate(input, config);
      const result: ImportResult = {
        added: 0,
        updated: 0,
        skipped: backup.excludedCredentialRecords,
        stores: {},
        excludedCredentialRecords: backup.excludedCredentialRecords,
      };

      const storeNames = config.backupStores.filter((name) => hasOwn(backup.stores, name));
      return database.transaction(storeNames, 'readwrite', async (transaction) => {
        const existingByStore = new Map<string, DataPortRecord[]>();
        for (const name of storeNames) {
          const rows = await transaction.getAll(name);
          existingByStore.set(
            name,
            rows.map((row) => assertRecordShape(name, row)),
          );
        }

        const orderSequenceFloor = Math.max(
          maximumOrderNumberSequence(existingByStore.get('orders') ?? []),
          maximumOrderNumberSequence(backup.stores.orders ?? []),
        );
        const writesByStore = new Map<string, DataPortRecord[]>();
        for (const name of storeNames) {
          const existing = existingByStore.get(name) ?? [];
          const writes = makeStorePlan(
            name,
            backup.stores[name] ?? [],
            existing,
            orderSequenceFloor,
            config,
            result,
          );
          assertUniqueIndexes(name, existing, writes, config);
          writesByStore.set(name, writes);
        }

        // No writes are issued until every store and unique-index constraint
        // has passed preflight. A later IndexedDB failure aborts this single
        // transaction, so the import cannot leave a half-restored database.
        for (const name of storeNames) {
          for (const record of writesByStore.get(name) ?? []) {
            await transaction.put(name, record);
          }
        }

        return result;
      });
    },
  };
}
