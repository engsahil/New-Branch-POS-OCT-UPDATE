# POS 5.1.9 — implementation and verification report

Theme 2 (Light Clean & Fresh) upgrade of the existing Restaurant POS. This is an
in-place upgrade of the original application: identity, module list, business
logic, IndexedDB schema and navigation are preserved, and every migration is
additive.

- Version: **5.1.9** (`package.json`, `src/config/app.config.ts`, README).
- Baseline commit: `88e208a` (branch `main`).
- Runtime dependencies: unchanged — `react`, `react-dom`, `react-router-dom`.
- Database: `pos-db` v7. No store, index or record is dropped or rewritten.

---

## 1. Verification summary

All rows below were executed in this working tree; the output is quoted from the
run, not predicted.

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc -b --noEmit` | exit 0, no diagnostics |
| Service/unit tests | `npm test` | 4 suites pass |
| Production build | `npm run build` | success, 52 precached files |
| UI smoke (dev-only) | `node scripts/smoke-ui.mjs` | 19 assertions pass, exit 0 |
| Test credential in build | `grep -r "smoke-test-password" dist` | no match |
| Emoji scan | `src/`, `public/`, `README.md`, `scripts/` | none found |
| Secret scan | `.env` absent from the tree | no env file committed |

### Test output

```
IndexedDB checks passed: isolated schema migration, 14-store export snapshot,
relationship preservation, backup preview/exclusions, safe merge and monotonic
sequence, unique-conflict preflight, local credential/queue preservation, and
atomic rollback.

Data backup checks passed: 23 business records exported/restored across 14
stores; IDs and delivery/report relationships preserved; merge, re-import,
safe-conflict rollback, version validation, and v1 compatibility verified.

Receipt checks passed: 58/80mm text-column wrapping, long names/values,
customer/kitchen isolation, one-call Print Both ordering with independently
measured page sizes, compact ESC/POS streams and cuts, content-height
measurement, zero-margin page sizing, and bounded logo raster dimensions.

v5.1.9 checks passed: saved-customer reuse without duplicates, persistent
deduped notifications with accurate unread counts, date-bounded sales reports
excluding cancelled sales, audited receipt corrections with exact stock
movement and refusal cases, and setup detection that preserves existing
installations, plus display preferences that persist but never alter the
underlying data.
```

### UI smoke run

`scripts/smoke-ui.mjs` loads the **built** bundle in Happy DOM against a fake
IndexedDB, signs in through the real form, and asserts:

```
PASS  application mounts into #root
PASS  restaurant profile written to IndexedDB
PASS  sign-in screen renders
PASS  sign-in succeeds with the provisioned credentials
PASS  route /dashboard renders
PASS  route /sales renders
PASS  route /customers renders
PASS  route /menu renders
PASS  route /inventory renders
PASS  route /admin renders
PASS  route / renders
PASS  display customisation saves to the settings store
PASS  notification bell is present in the header
PASS  first-run wizard is skipped for an existing installation
Smoke run completed with no uncaught console errors.
```

It is development-only and not part of `npm test` (which stays offline and
dependency-free). It needs `happy-dom` and `fake-indexeddb`, both installed with
`--no-save` and absent from `package.json`:

```bash
npm install --no-save happy-dom fake-indexeddb
VITE_ADMIN_PASSWORD=smoke-test-password npm run build   # throwaway build
node scripts/smoke-ui.mjs
npm run build                                          # rebuild without the test password
```

---

## 1a. Interface conversion (latest pass)

- Unified dashboard at `/dashboard`: hero banner (upload/replace/crop/preview/
  remove), four KPI cards with real day-over-day deltas, sales trend line,
  order-type and payment doughnuts, top selling items, recent orders that open
  the real receipt dialog, and quick actions to every module.
- The duplicate Dashboard section was removed from the Settings area; Settings
  now opens on Restaurant and gained an Appearance section (live palette,
  banner shortcut, dashboard/order-list switches, reset to default).
- Header administrator menu (My profile, Settings, Sign out) and a `/profile`
  page that saves display name, email and phone without touching credentials.
- Navigation matches the reference: Dashboard, POS, Sales, Customers, Menu,
  Deals, Inventory, Purchases, Reports, Delivery, Settings.
- New `/purchases` module records stock receipts against real inventory lines
  (new additive `purchases` store, database v8).
- Customers is now a searchable, paginated table with order counts and spend
  from a single pass over the orders store.
- Menu items gained optional SKU, barcode, cost price, prep time and
  ingredients.
- First-run setup can be deferred: "Skip for now" on the password step and
  "Setup later" on the first step, both without weakening authentication; the
  dashboard shows a dismissible reminder until the terminal is configured.
- Charts are hand-drawn SVG with no new dependency; the runtime dependency list
  is unchanged.

## 2. What changed

### Theme 2 — Light Clean & Fresh

`src/styles/tokens.css` was re-pointed to the required palette; the whole app
consumes tokens, so no component was rewritten to re-theme.

| Token | Value |
| --- | --- |
| Background | `#F7FAF8` |
| Surface | `#FFFFFF` |
| Primary green / accent | `#176B4D` / `#25845F` |
| Mint | `#E4F4EC` |
| Border | `#DCE7E1` |
| Text / secondary | `#172923` / `#65756D` |
| Success / warning / error | `#168653` / `#D99421` / `#D94343` |
| Muted surface | `#F0F5F2` |

Legacy `--c-*` aliases were kept so every existing CSS Module keeps resolving.
Fonts are untouched (system stack). `index.html` and the PWA manifest were
updated to the new background/accent. The only literals left outside the token
file are in the print stylesheet, which must not depend on screen tokens.

`CartPanel`'s few inline styles reference `--color-*` custom properties, so they
follow the theme automatically; no colour literals remain in it.

### Customer allocation for all order types

`src/components/pos/CustomerPicker.tsx` (+ CSS) is one search/select control
used by Dine-in, Takeaway and Delivery. It searches the `customers` store,
fills name/phone/address, and stores `customerId` on the order, so checkout
updates the existing record instead of inserting a duplicate. Switching order
type keeps the cart, the selected customer and the totals. Guest orders remain
possible. Covered by the `test-v519` checkout-linkage case (order keeps
`customerId`, no duplicate record, order type on the sale, exactly one
notification).

### Dashboard

`src/pages/DashboardPage.tsx` (+ CSS): real figures from `salesService`,
`orderService`, `inventoryService`, `customerService` — today's sales and
orders, average order, dine-in tables, new customers, this week's sales chart,
payment and order-type mix, best sellers, low-stock alerts, recent orders and an
operational summary. Quick actions navigate to the existing routes. The banner
uses the stored restaurant profile (no placeholder imagery). Added
`/dashboard` to the route registry; `/` is still the POS, so nothing was
replaced.

### Sales, reports and exports

`salesService.report()` and `SalesPage` provide Today / Yesterday / This week /
Last week / This month / Last month / custom range, with gross and net sales,
discounts, refunds and voided totals (excluded from revenue and reported
separately), tax, order count, items, average order, payment mix, order-type
mix, daily and hourly trends, product and category performance, and best
sellers. CSV export uses the exact on-screen range and figures
(`src/utils/csv.ts`, no library). The printable report is produced through the
existing print path (no PDF library added).

### Order history and audited receipt corrections

`SalesPage` lists orders with search, date filter, pagination, a "Recently
edited" badge, and a receipt preview via `OrderReceiptDialog`, which reuses the
real `ReceiptView`/`PrintPanel`.

`src/services/receiptEditService.ts` performs controlled corrections:

- quantity changes only (or voiding a line); deal lines are locked;
- cancelled/refunded sales are refused;
- totals, discounts and tax are recalculated transactionally;
- stock moves by exactly the delta, clamped to what the sale actually deducted,
  and is refused when stock is insufficient;
- an append-only row is written to `receiptAudits` (before/after, editor,
  reason, timestamp) — financial history is never silently overwritten;
- a notification is created on success.

### Receipts and printing

`OrderReceiptDialog` + `PrintPanel` drive Customer Receipt, Kitchen Receipt and
Print Both from one layout definition. The print path keeps:

- `@page` sizing derived from measured content height (no `auto` height),
- zero margins, content-sized media, one job per ticket for Print Both,
- separate customer and kitchen layouts,
- reprints that never re-charge or re-deduct stock,
- no optimistic "printed" claim — the UI reports the state the browser actually
  reached.

Persisted "show logo" receipt setting and toggle were added
(`receiptService`, `Receipt.tsx`, `PrinterSection.tsx`).

**Not verified:** no physical thermal printer, USB/Serial device or browser was
available. Layout arithmetic, wrapping, page sizing and ESC/POS encoding are
covered by `scripts/test-receipts.mjs`; nothing in this report claims a physical
page printed correctly. See README → Printing for the honest limits and the
manual checks to run on a real 58 mm/80 mm device.

### Notifications

`src/services/notificationService.ts` + `src/components/layout/NotificationBell`
+ `GlobalHeader`: persisted entries with dedupe keys, unread count, mark
one/mark all read, per-kind preferences, deep links, no polling. Emitted for
completed orders, low/out-of-stock thresholds, order cancellations and receipt
corrections.

### Onboarding

`src/components/onboarding/SetupWizard.tsx` (first genuinely new install:
restaurant details, tax, receipt footer, administrator password; persistent
completion) and `AppTour.tsx` (Next/Back/Skip/Finish, keyboard and focus
handling, reduced-motion aware, persisted per user, restartable from
Admin → Settings). `onboardingService.needsSetup()` returns false whenever a
restaurant profile or any order exists, so existing installations are never
prompted. Passwords continue to be hashed with the existing PBKDF2 path; no
plaintext credential is stored.

### Customisation

`src/services/displayPreferencesService.ts` + `useDisplayPreferences()` +
Admin → Settings: which Dashboard blocks and which order-row details are shown,
notification kinds, receipt paper/auto-open, guided-tour replay, and
**Reset to default**. Preferences persist in the existing `settings` store under
`display.preferences` (additive; no schema change). They only hide presentation
— never filter, re-total or export a different figure — and the Dashboard and
order list react immediately through a window event.

### Data portability and the schema bump

`dataPortCore.ts` gained an `optionalStores` concept so a backup made before
5.1.9 (no `notifications`, no `receiptAudits`) still restores, while unknown,
duplicate or out-of-order stores are still rejected. Covered by a
"pre-upgrade backup" case in `scripts/test-data-port.mjs`.

### Small hardening

- `orderService` no longer lets a background-sync module failure fail checkout
  (dynamic import wrapped in `.catch`).
- Receipt-increase stock restore is clamped to the sale's recorded deductions,
  so an over-sold (zero-clamped) line cannot inflate stock.
- Reduced-motion support in `global.css`.

---

## 3. Decisions and trade-offs (documented, minimal-change)

1. **One theme, no theme switcher.** The brief mandates Theme 2; a user-facing
   palette switch would violate it and could make printed receipts and reports
   disagree. The palette, currency (`PKR`) and locale (`en-PK`) stay in
   `app.config.ts` and are shown read-only in Admin → Settings.
2. **No date/currency format switch.** The terminal is single-currency and
   single-locale; changing display formats per device would make historical
   reports and reprints inconsistent. Both remain fixed and are labelled as such.
3. **`display.preferences` is stored, not a new store.** Reusing the existing
   `settings` store avoids a migration and keeps backups compatible.
4. **Permissions.** The application has a single administrator account, so
   "permission-aware" means everything in Admin (including customisation) sits
   behind the authenticated route guard; there are no roles to enforce. No
   server-side enforcement is claimed because there is no server — all data is
   local IndexedDB.
5. **Exports are hand-rolled.** CSV is generated in `utils/csv.ts`; the PDF path
   reuses the print stylesheet. No `xlsx`, `jspdf` or `pdf-lib` dependency was
   added.
6. **Corrections are deliberately narrow** (quantity/void, no free-form price
   editing) to keep the audit trail meaningful and the stock arithmetic exact.

---

## 4. Install, upgrade and printing

```bash
cp .env.example .env     # optional; leave VITE_ADMIN_PASSWORD unset in production
npm install
npm run dev              # http://localhost:5173
npm run build            # typecheck + production build to dist/
npm run serve            # serves dist/ with SPA fallback (stdlib only)
```

- **Upgrading an existing terminal:** deploy the new build over the old one and
  reload. The database upgrades from v6 (or earlier) to v7 additively; no
  prompt, no data loss. `dist/index.html` opened over `file://` shows a blank
  page by design — serve it over HTTP.
- **Printing:** open a receipt and choose Customer, Kitchen or Both. In the
  system dialog select the matching 58 mm or 80 mm roll, zero margins and 100 %
  scale (drivers may still override CSS page size). ESC/POS output is available
  from the printer panel on Chromium via WebUSB/Web Serial.

---

## 5. Known limitations

- No physical printer, browser or touch device in the build environment:
  printing, layout painting and touch target sizing are verified only at the
  calculation/encoder/static level.
- No role system exists in the application, so no per-role permission matrix
  could be added without inventing accounts; the single authenticated
  administrator guards every admin surface.
- Sync remains optional and off unless `VITE_SYNC_API_URL` is configured; the
  app is local-first by design.
- `VITE_EXPOSE_TEST_API` stays unset/false. It is documented in `.env.example`
  as a development bridge only.

## 6. Files

56 files changed or added: 31 modified, 25 new (see `git status`). New modules
are listed in README → Structure. Nothing was deleted; no module was removed.
