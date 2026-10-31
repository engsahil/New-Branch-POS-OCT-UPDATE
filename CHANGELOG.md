# Changelog

## 6.1.0 — 2026-10-30

### Added
- Expenses & Profit module, dashboard finance summary, persistent first-time guidance and finance CSV.
- Additive IndexedDB v9 expense store; full backup coverage for expenses.
- Per-instance cart modifiers, split-one-item, saved modifier/deal cost and savings snapshots.
- Explicit full refunds with once-only stock restoration and receipt banners.
- Backup checksum, sales coverage, origin disclosure, relationship validation and import acknowledgement/system notice.
- v6.1.0 service and real-browser regression scripts, including 58/80 mm PDF pagination and cross-origin restore.

### Fixed
- Duplicate global identity chrome outside Dashboard; notification read/unread/preference consistency.
- Tax now applies after item/order discounts; inclusive/exclusive mode and rate are saved on new orders/sales.
- Underpayment refusal, stale/changed deal refusal, concurrent atomic stock receipts, purchase spend rounding.
- Stable order pagination, reachable mobile checkout, receipt modifier prices and cancelled/refunded tender display.
- CSV formula-injection guard and JSON-safe backup checksum normalisation.

### Compatibility
- No runtime dependency added. Existing local/offline architecture and optional sync remain.
- Historical records are not rewritten. Legacy backups use an explicit historical manifest; missing newer stores are left unchanged and disclosed.
- Profit is an estimate with disclosed missing-cost coverage; purchases are not COGS or operating expenses.
- Physical printer compatibility remains unverified; browser PDF and ESC/POS byte tests are not hardware certification.

## 5.1.9 and earlier

See the retained release notes (`RELEASE-5.1.9*.md`) and the historical sections of README.md. Dependency versions and historical release documents are intentionally unchanged.
