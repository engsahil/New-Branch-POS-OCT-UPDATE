/**
 * Browser adapter for safe, offline-first POS backup and restore.
 *
 * IndexedDB is the system of record. This service snapshots the actual store
 * schema in storage.config.ts and delegates format validation/merge planning
 * to dataPortCore.ts. The admin credential store and sync transport queue are
 * deliberately disclosed exclusions: credentials remain device-local, and
 * queued transport state is not business data (the underlying records are).
 */

import { APP_CONFIG } from '@/config/app.config';
import {
  ALL_STORES,
  DB_NAME,
  DB_VERSION,
  STORE_SCHEMAS,
  STORES,
  type StoreName,
} from '@/config/storage.config';
import { SYNC_API_URL } from '@/config/sync.config';
import { db } from '@/data/db/indexedDb';
import {
  createDataPortService,
  type DataPortDatabase,
  type DataPortTransaction,
  type ImportResult,
} from './dataPortCore';

export type { BackupPreview, ImportResult } from './dataPortCore';

const BACKUP_FORMAT = 'pos-data-backup';
const BACKUP_VERSION = 2;

const EXCLUDED_STORES: Record<string, string> = {
  [STORES.admin]:
    'Local administrator credentials and session-binding hashes are security-sensitive and stay on this installation.',
  [STORES.syncQueue]:
    'The sync queue is transport state, not business data; all source records are backed up from their owning stores.',
};

const backupStores = ALL_STORES.filter(
  (name) => !Object.prototype.hasOwnProperty.call(EXCLUDED_STORES, name),
);
const legacyBackupStores = ALL_STORES.filter((name) => name !== STORES.syncQueue);

/** Unique indexes are derived from the real IndexedDB schema, not guessed. */
const uniqueIndexes = Object.fromEntries(
  STORE_SCHEMAS.flatMap((schema) =>
    (schema.indexes ?? [])
      .filter((index) => index.unique && typeof index.keyPath === 'string')
      .map((index) => [schema.name, index.keyPath as string]),
  ),
);

export interface StorageSource {
  origin: string;
  databaseName: string;
  databaseVersion: number;
  persisted: boolean;
  counts: Record<StoreName, number>;
  totalRecords: number;
  syncEnabled: boolean;
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Refuse a partial export if the live database and declared schema disagree. */
async function assertLiveSchema(): Promise<void> {
  const database = await db.openDatabase();
  const actual = Array.from(database.objectStoreNames);
  const missing = ALL_STORES.filter((name) => !actual.includes(name));
  const unrecognised = actual.filter(
    (name) => !(ALL_STORES as readonly string[]).includes(name),
  );

  if (missing.length > 0 || unrecognised.length > 0) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      unrecognised.length ? `unrecognised: ${unrecognised.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `The local database schema does not match this POS build (${details}). No backup was created.`,
    );
  }
}

const databaseAdapter: DataPortDatabase = {
  getAll(store) {
    return db.getAll(store as StoreName);
  },

  transaction<T>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    work: (transaction: DataPortTransaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(storeNames as StoreName[], mode, async (stores) => {
      const transaction: DataPortTransaction = {
        async getAll(store) {
          const objectStore = stores[store];
          if (!objectStore) throw new Error(`The “${store}” store is unavailable.`);
          return db.request(objectStore.getAll()) as Promise<unknown[]>;
        },
        async put(store, record) {
          const objectStore = stores[store];
          if (!objectStore) throw new Error(`The “${store}” store is unavailable.`);
          await db.request(objectStore.put(record));
        },
      };
      return work(transaction);
    });
  },
};

const portableData = createDataPortService(
  databaseAdapter,
  {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    legacyVersion: 1,
    applicationName: APP_CONFIG.name,
    applicationVersion: APP_CONFIG.version,
    dataSchemaVersion: APP_CONFIG.schemaVersion,
    databaseName: DB_NAME,
    databaseVersion: DB_VERSION,
    allStores: [...ALL_STORES],
    backupStores: [...backupStores],
    legacyBackupStores: [...legacyBackupStores],
    excludedStores: EXCLUDED_STORES,
    orderSequenceSettingId: 'order.sequence',
    uniqueIndexes,
  },
  currentOrigin,
);

export const dataPortService = {
  async describeSource(): Promise<StorageSource> {
    const counts = db.isSupported()
      ? await db.countAll()
      : (Object.fromEntries(ALL_STORES.map((name) => [name, 0])) as Record<
          StoreName,
          number
        >);

    const persisted =
      db.isSupported() &&
      typeof navigator !== 'undefined' &&
      navigator.storage?.persisted
        ? await navigator.storage.persisted()
        : false;

    return {
      origin: currentOrigin(),
      databaseName: DB_NAME,
      databaseVersion: DB_VERSION,
      persisted,
      counts,
      totalRecords: Object.values(counts).reduce((sum, count) => sum + count, 0),
      syncEnabled: SYNC_API_URL.trim().length > 0,
    };
  },

  async exportBackup() {
    if (!db.isSupported()) throw new Error('IndexedDB is not available in this browser.');
    await assertLiveSchema();
    return portableData.exportBackup();
  },

  previewBackup: portableData.previewBackup,

  async importBackup(input: unknown): Promise<ImportResult> {
    if (!db.isSupported()) throw new Error('IndexedDB is not available in this browser.');
    await assertLiveSchema();
    return portableData.importBackup(input);
  },
};
