import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { DB_NAME, DB_VERSION } from '@/config/storage.config';
import {
  dataPortService,
  type BackupPreview,
  type ImportResult,
  type StorageSource,
} from '@/services/dataPortService';
import styles from './PanelSection.module.css';

interface PendingImport {
  fileName: string;
  input: unknown;
  preview: BackupPreview;
}

/**
 * Data source and full business-data portability. The backup is a validated,
 * versioned JSON snapshot of every business store declared by the live POS
 * schema. Restores merge by stable record id and never clear existing data.
 */
export function DataSection() {
  const [source, setSource] = useState<StorageSource | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    void dataPortService
      .describeSource()
      .then(setSource)
      .catch(() => setSource(null));
  }, []);

  useEffect(refresh, [refresh]);

  async function downloadBackup() {
    setExporting(true);
    setFailure(null);
    setResult(null);
    setPending(null);
    try {
      const backup = await dataPortService.exportBackup();
      const host = source?.origin
        ? source.origin.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/gi, '-')
        : 'terminal';
      const stamp = backup.exportedAt.slice(0, 10);
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pos-backup-${host}-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Some mobile browsers begin the download after click() returns.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Could not create the backup.',
      );
    } finally {
      setExporting(false);
    }
  }

  async function inspectFile(file: File) {
    setFailure(null);
    setResult(null);
    setPending(null);
    try {
      const input: unknown = JSON.parse(await file.text());
      const preview = dataPortService.previewBackup(input);
      setPending({ fileName: file.name, input, preview });
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : 'Could not validate that backup file.',
      );
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setImporting(true);
    setFailure(null);
    setResult(null);
    try {
      const outcome = await dataPortService.importBackup(pending.input);
      setResult(outcome);
      setPending(null);
      refresh();
      // All data-reading hooks get a clean read of the restored database.
      // Keep the result visible briefly before reloading the authenticated app.
      window.setTimeout(() => window.location.reload(), 1800);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Could not import that backup.',
      );
    } finally {
      setImporting(false);
    }
  }

  if (!source) {
    return <p className={styles.loading}>Reading storage…</p>;
  }

  const populated = Object.entries(source.counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>Data source</h3>
          <span
            className={`${styles.badge} ${
              source.totalRecords > 0 ? styles.badgeOk : styles.badgeWarn
            }`}
          >
            {source.totalRecords > 0 ? 'Records present' : 'Empty'}
          </span>
        </div>

        <p className={styles.hint}>
          This terminal stores its records in IndexedDB in this browser, under
          this exact web address. A different address or device has a separate
          database. Export a backup here before moving to another installation;
          importing the file restores the business records without replacing
          this terminal&apos;s administrator login.
        </p>

        <dl className={styles.details}>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Address</dt>
            <dd className={styles.rowValue}>{source.origin}</dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Database</dt>
            <dd className={styles.rowValue}>
              {DB_NAME} · v{DB_VERSION}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Records stored here</dt>
            <dd className={styles.rowValue}>{source.totalRecords}</dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Shared backend</dt>
            <dd className={styles.rowValue}>
              {source.syncEnabled
                ? 'Configured — changes upload in the background'
                : 'None — this terminal is standalone'}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Browser persistence</dt>
            <dd className={styles.rowValue}>
              {source.persisted
                ? 'Granted — storage will not be evicted'
                : 'Not granted — install the app to request it'}
            </dd>
          </div>
        </dl>

        {populated.length > 0 ? (
          <>
            <p className={styles.hint}>Records by IndexedDB store:</p>
            <dl className={styles.details}>
              {populated.map(([store, count]) => (
                <div className={styles.row} key={store}>
                  <dt className={styles.rowLabel}>{store}</dt>
                  <dd className={styles.rowValue}>{count}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className={styles.note}>No records are stored at this address yet.</p>
        )}
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Data management</h3>
        <p className={styles.hint}>
          Export creates one portable JSON file containing the records from all
          business stores in this POS schema: restaurant profile and logo, menu
          products and variants, inventory, deals, orders and line items, sales,
          customers, toppings, add-ons, delivery records and rider/settings
          data. The export uses the real IndexedDB store list and refuses to
          create a partial backup if the database schema does not match.
        </p>
        <p className={styles.hint}>
          Administrator password hashes, active sessions and the sync transport
          queue are not moved. This keeps sign-in local to each installation;
          the queue is operational transport state, while its underlying POS
          records are included.
        </p>

        <div className={styles.actions}>
          <Button onClick={() => void downloadBackup()} disabled={exporting || importing}>
            {exporting ? 'Preparing backup…' : 'Export All Data'}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void inspectFile(file);
            }}
          />
          <Button
            variant="secondary"
            disabled={importing || exporting}
            onClick={() => fileRef.current?.click()}
          >
            Import Data
          </Button>
        </div>

        {pending ? (
          <div className={styles.note} role="group" aria-labelledby="backup-confirm-title">
            <h4 id="backup-confirm-title">Review backup before importing</h4>
            <p className={styles.confirmText}>
              <strong>
                Importing this backup will merge data into the current POS.
                Existing data will not be deleted. Continue?
              </strong>
            </p>
            <dl className={styles.details}>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>File</dt>
                <dd className={styles.rowValue}>{pending.fileName}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>Exported</dt>
                <dd className={styles.rowValue}>
                  {new Date(pending.preview.exportedAt).toLocaleString()}
                </dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>Application</dt>
                <dd className={styles.rowValue}>
                  {pending.preview.applicationVersion}
                  {pending.preview.legacy ? ' · legacy backup' : ''}
                </dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>Business records</dt>
                <dd className={styles.rowValue}>{pending.preview.totalRecords}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>Source address</dt>
                <dd className={styles.rowValue}>{pending.preview.sourceOrigin}</dd>
              </div>
            </dl>
            <p className={styles.confirmText}><strong>Records in this file:</strong></p>
            <dl className={styles.details}>
              {Object.entries(pending.preview.storeCounts).map(([store, count]) => (
                <div className={styles.row} key={store}>
                  <dt className={styles.rowLabel}>{store}</dt>
                  <dd className={styles.rowValue}>{count}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.confirmText}><strong>Not included:</strong></p>
            <ul className={styles.confirmList}>
              {Object.entries(pending.preview.excludedStores).map(([store, reason]) => (
                <li key={store}><strong>{store}:</strong> {reason}</li>
              ))}
              <li>Active sign-in sessions stay on this terminal.</li>
            </ul>
            {pending.preview.excludedCredentialRecords > 0 ? (
              <p className={styles.confirmText}>
                {pending.preview.excludedCredentialRecords} legacy administrator record(s)
                are present in this older file and will not be restored.
              </p>
            ) : null}
            <p className={styles.confirmText}>
              Records with matching IDs are updated only when the backup has a
              newer timestamp. Duplicate/older records are skipped. A unique
              order-number conflict stops the whole import before any writes.
            </p>
            <div className={styles.actions}>
              <Button
                variant="ghost"
                disabled={importing}
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button disabled={importing} onClick={() => void confirmImport()}>
                {importing ? 'Importing…' : 'Import and merge data'}
              </Button>
            </div>
          </div>
        ) : null}

        {result ? (
          <p className={styles.note} role="status">
            Import complete: added {result.added}, updated {result.updated},
            skipped {result.skipped}. Existing data was not deleted. The POS
            will refresh to load the restored records.
            {result.excludedCredentialRecords > 0
              ? ` ${result.excludedCredentialRecords} legacy administrator credential record(s) were kept local.`
              : ''}
          </p>
        ) : null}

        {failure ? (
          <p className={styles.failure} role="alert">
            {failure}
          </p>
        ) : null}
      </section>
    </div>
  );
}
