# POS 6.1.0 — implementation and verification report

In-place upgrade of the existing offline-first Restaurant POS. Runtime
dependencies are unchanged (React, React DOM, React Router). IndexedDB remains
the system of record; database v9 adds only the `expenses` store.

## Status checklist

| Area | Status | Evidence / scope |
| --- | --- | --- |
| Startup, Sign-Up/Sign-In, legacy account preservation | PASS | `test-auth.mjs` fresh and legacy modes; browser Sign-Up → Sign-In → Dashboard |
| Dashboard-only identity/bell/profile; other module headers | FIXED | Browser checks: bell/profile on Dashboard, no duplicate restaurant identity on POS |
| Notifications, viewed-read, unread counts, preferences, dedupe | FIXED | Atomic snapshot/preference/read transactions; v5.1.9/v6.1.0 tests; browser reload read-state check |
| Order history ordering/pagination/receipt actions | FIXED | Stable timestamp+ID comparator, continuous-page assertions, browser Receipt/refund flow |
| Independent modifiers, split lines, pricing/cost snapshots | FIXED | Service tests + browser split/modifier checkout and saved-order assertions |
| POS overflow, long delivery data, mobile checkout | FIXED | Browser hit-testing at 1440×900, 1024×768, 820×1180, 390×844, 360×640 with a 30-item stress cart |
| Customer/kitchen receipts, reprints, edits, refunds | FIXED | Shared receipt models; 58/80 mm tests; browser reprint/refund; cancelled/refunded banners |
| 58/80 mm browser PDF pagination | PASS | Real Chromium print document captured and paginated: two pages per Print Both job; widths ≈163.92 pt (58 mm) and ≈226.77 pt (80 mm) |
| Physical thermal printer | BLOCKED | No printer hardware connected. ESC/POS byte streams and browser PDFs are not hardware certification |
| Expenses CRUD/categories/dates/search/sort/pagination/CSV/guide | ADDED | Service tests + browser create/edit/guide dismissal persistence |
| Dashboard finance and profit definitions | ADDED | Shared finance service; missing-cost coverage; purchases separated from COGS/expenses |
| Full backup/import integrity and cross-origin restore | FIXED | Count/checksum/coverage/relationship validation; atomic merge; real browser download from 127.0.0.1 and UI import on localhost |
| CSV formula safety | FIXED | String formula guard regression; numeric cells preserved |
| Version declarations | FIXED | package/lock, app config, About/sidebar consumers, index metadata, manifest, SW cache prefix, README/changelog = 6.1.0; historical/dependency versions retained |
| Original production missing-recent-sales incident | PARTIAL | No client production data was accessed. Isolated multi-week round trips pass, but the exact historical field cause remains unproven |

## Executed checks (2026-10-30/31 UTC)

| Check | Result |
| --- | --- |
| `npm ci` | PASS (lockfile install; audit advisory below) |
| `npm run typecheck` | PASS, no diagnostics |
| `npm test` | PASS: IndexedDB/migration, data-port, receipts, v5.1.9, v6.1.0, auth fresh + legacy |
| `npm run build` (normal, no test API) | PASS; Vite build + 73-file service-worker precache |
| Test-API build scan | Normal `dist` contains no `window.__pos`, test password or test-API bridge |
| `node scripts/verify-v610-browser.mjs` | PASS, 23 checks, no uncaught browser errors (isolated synthetic data) |
| `git diff --check` | PASS |

The browser run used a temporary `VITE_EXPOSE_TEST_API=true` build and synthetic
records only, then the normal build was regenerated. Browser artifacts (PDFs,
screenshots, JSON result) are kept outside the source archive.

### Known limitations / disclosures

- Profit is an operating estimate: revenue = charged amount − stored tax;
  COGS = saved portion/modifier costs; operating profit = revenue − COGS −
  operating expenses. Missing costs make profit unavailable. Purchases are not
  consumption and are not double-counted. Historical rows keep their stored tax
  basis; new checkout/edit tax is post-discount and saves rate/mode.
- Full refunds are supported and restore stock once; partial refunds and payment
  gateway/till money movement are not implemented.
- Backup CRC32 is a corruption check, not a cryptographic signature. Import is a
  non-destructive newer-by-`updatedAt` merge, not a destructive replacement.
- `npm audit --omit=dev` reports 2 moderate React Router advisories
  (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg). npm's only proposed fix is a breaking
  React Router 7 upgrade; it was not forced. This app uses internal navigation
  and no SSR hydration. Track the advisory before accepting untrusted redirect
  targets or adding SSR.
- No physical printer, no client production database, and no exact reproduction
  of the original missing-sales incident were available. No production data was
  read, reset or modified.

## Upgrade / backup

1. Export All Data from the old installation and retain the file.
2. Upgrade at the same web address; close other tabs during the v9 schema load.
3. Verify Dashboard, Sales/Orders, Inventory, Purchases and Expenses.
4. For a different address/device, import the backup, review origin/checksum/
   coverage/counts, acknowledge the merge, and verify again. Sign-in stays local.

Do not clear IndexedDB, browser storage or the service-worker cache as an upgrade
step. The service worker changes only its asset cache; business data is untouched.
