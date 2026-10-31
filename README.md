# POS — v6.1.0

Offline-first Restaurant Point of Sale application. Version **6.1.0**.

## v6.1.0 — focused UI update (this source package)

Version remains **6.1.0**; no database migration is added by this update.

- **Current Order:** each cart line is a separate card with name, size, unit
  price, selected options, independent quantity controls, remove, split-one and
  line subtotal. The item region keeps a usable height; detailed discount/payment
  fields expand inside the scrollable order body so totals/checkout cannot squeeze
  the product list to zero. Stacked mobile layouts use an internal item scroll and
  a static checkout footer (no sticky overlay covering controls).
- **Sales vs Reports:** Sales is unchanged. `/reports` now has a dedicated
  analytics page: day/week/month/year/custom ranges, previous-period comparison,
  charged sales/revenue/orders/average/discount KPIs, trend line, payment doughnut,
  product/category bars, status and stored-tax summaries, period table and CSV.
  Product/category values are gross merchandise before order-level discount/tax;
  categories use the current menu. Refunded/cancelled orders are excluded from
  sales KPIs and shown separately. No sample data is generated.
- **Branding:** the saved restaurant logo replaces the sidebar default mark and
  is shared with receipts. Upload/remove in Settings → Restaurant; transparent
  PNG/WebP/JPG are contained without distortion. Invalid images fall back to the
  default mark. The duplicate in-page POS logo was removed.
- **Profile:** local administrator profile adds picture upload/replace/remove,
  full name, email, phone, job title, department, address and bio. Username and
  business name remain read-only here and are changed through the existing
  Security/Restaurant settings. Profile fields are additive optional fields on
  the existing admin record; passwords, sessions and permissions are untouched.
  Business backups intentionally continue to exclude the admin/credential store.
- **Notifications:** one click/open updates read state immediately, persists the
  first read timestamp, refreshes the badge, and survives reload. Mark-all-read,
  dedupe and category preferences are preserved.

Focused verification: `npm test` includes `scripts/test-ui-reporting.mjs`.
With a test-API build and temporary browser tools, run
`node scripts/verify-ui-browser.mjs` (33 synthetic Chromium checks). See
`RELEASE-6.1.0-UI.md` for the executed record and limitations.

## v6.1.0 — upgrade notes

- **Database v9 (additive):** adds `expenses` only. Existing IndexedDB records,
  sign-in, menu, orders, sales, stock, purchases and settings are preserved.
  Close other tabs before the first upgrade load. **Export All Data before
  upgrading** and keep that file until you have checked the new version.
- **Dashboard-only identity chrome:** restaurant name/banner, notification bell
  and account menu live on Dashboard; other modules keep their own page headers
  and navigation without a duplicate global header.
- **Notifications:** persisted, deduplicated, preference-filtered and counted
  from the same snapshot. Only rows actually viewed in the bell become read;
  unmuting a category does not mark it read. Order, payment, stock, audit and
  backup/system events use the matching category.
- **POS:** independent modifier choices per cart instance, split-one-item,
  catalog-validated modifier prices/costs, stale-deal refusal, saved deal
  savings, post-discount tax, underpayment refusal and a reachable sticky
  checkout block on small screens.
- **Receipts:** customer/kitchen HTML and ESC/POS output include per-portion
  modifier prices, saved tax mode, order type and cancelled/refunded banners.
  Full refunds are explicit, atomic and restore stock once; they do not move
  money. Partial refunds are not supported. 58/80 mm browser PDF pagination was
  verified; **no physical printer was tested**.
- **Expenses & Profit:** `/expenses` provides validated CRUD, categories, dates,
  payee/payment/reference/notes, search/filter/sort/pagination, CSV and a
  dismissible guide. Dashboard and Expenses share the same finance service.
  Revenue = amount charged minus stored tax. COGS uses saved per-portion costs;
  missing costs make profit unavailable, never zero. Operating profit = revenue
  − COGS − operating expenses. Stock purchases are shown separately and are not
  counted again as expenses/COGS. This is an estimate, not cash flow or audited
  accounting. Historical rows retain their stored tax basis; new checkouts save
  the tax rate/mode used.
- **Backups:** full business-store JSON snapshots with counts, sales coverage,
  CRC32 corruption checksum (not a security signature), relationship checks,
  explicit historical manifests and origin disclosure. Import is a validated,
  atomic, non-destructive merge by stable id (newer `updatedAt` wins); it never
  clears a store and never replaces the destination administrator/session.
  Review coverage and acknowledge the merge before import. A system notice is
  recorded after a successful import. The checksum/coverage metadata is additive;
  older supported files remain importable.
- **CSV:** untrusted text cells that could start a spreadsheet formula are
  neutralised; numeric cells remain numeric.

### Upgrade / restore

1. On the old version open Settings → Data source → **Export All Data**.
2. Deploy/refresh v6.1.0 at the **same web address** to keep the same IndexedDB.
   A different address/device has a separate database; use the backup to move.
3. Check Dashboard, Sales/Orders, Inventory, Purchases and Expenses. The upgrade
   does not seed demo records or reset data.
4. To move/merge, open Settings → Data source → **Import Data**, review origin,
   checksum, coverage and per-store counts, then acknowledge and merge. Re-import
   is idempotent. Keep the pre-upgrade backup until satisfied.

See `CHANGELOG.md` and `RELEASE-6.1.0.md` for the executed verification record.
The historical v5.1.9 notes below are retained as release history.

The sections below document the original architecture (still accurate) and the
earlier 3.x behaviour. Later sections were written for those releases and are
kept as history; where they conflict with the current application, the v5.1.9
notes below take precedence.

## v5.1.9 — what changed

- **Light Clean & Fresh theme** applied through `src/styles/tokens.css` (white
  cards on `#F7FAF8`, restaurant green `#176B4D`, mint accent `#E4F4EC`). The
  existing font stack is unchanged; no font was downloaded.
- **Saved-customer selection for all three order types.** Dine-in, Takeaway and
  Delivery now use the same search/select control (`CustomerPicker`). Picking a
  customer fills the saved name, phone and address, and the order is linked to
  that customer id — so checkout updates the existing record instead of
  creating a duplicate. Guest orders remain possible.
- **Dashboard** at `/dashboard` with real figures (today's sales and orders,
  dine-in tables used, new customers, this week's payment/order-type mix, best
  sellers, low-stock alerts, recent orders) and working shortcuts to every
  module. Navigation gained a Dashboard entry; `/` is still the POS.
- **Notification centre**: persisted notifications with dedupe keys, unread
  count, mark-one/mark-all read, per-kind preferences and links into the
  relevant module. Generated from completed orders, stock thresholds, order
  cancellations and receipt corrections. No polling, no duplicate entries.
- **Sales reports** with Today / Yesterday / This week / Last week / This month
  / Last month / custom ranges. Reports show gross and net sales, discounts,
  tax, refunds/voids, order count, items, average order, payment and order-type
  breakdowns, daily and hourly bars, and product/category performance — all
  from stored sales and order lines. CSV export uses the same range and figures.
- **Order history and receipt corrections**: searchable, date-filtered,
  paginated order list with a receipt preview that reuses the real receipt
  components. Authorised corrections change one line quantity (or void it),
  recalculate totals/tax/discounts, move stock by the exact difference, write
  an append-only audit row (before/after, editor, reason, timestamp), and mark
  the receipt "Recently edited". Deal lines and cancelled/refunded sales are
  locked.
- **First-run setup wizard** for a genuinely new installation (restaurant
  details, tax, receipt footer, administrator password) and a **guided tour**
  anchored to the real navigation. Existing installations are detected and
  marked complete without any prompt; the tour is per user and can be replayed
  from Admin → Settings.
- **Database v7** adds `notifications` and `receiptAudits`. Both migrations are
  additive; no existing store, record or index is dropped or rewritten.
- **Centralised customisation** in Admin → Settings: which Dashboard blocks and
  which order-row details are shown, notification kinds, receipt paper and
  auto-open behaviour, and a reset-to-default action. Preferences are stored in
  the existing `settings` store under `display.preferences`; they hide blocks
  and details only and never filter or change a stored figure. The colour
  theme, currency and locale stay fixed at build time so receipts and exported
  reports cannot disagree with each other.
- **New tests**: `scripts/test-v519.mjs` covers customer reuse, notification
  dedupe/unread counts, report totals and filters, receipt corrections with
  stock movement and refusal cases, setup detection, and display preferences
  (persist, merge with defaults, reset).

## v5.1.9 — interface conversion

The screens were rebuilt against the supplied reference design. Business logic,
storage and routes are unchanged; only presentation plus the few genuinely new
capabilities below were added.

- **One dashboard.** `/dashboard` is the only dashboard; the duplicate
  "Dashboard" section was removed from the Settings area. The dashboard now has
  a hero banner, KPI cards with real day-over-day deltas, a sales trend line,
  order-type and payment-method doughnuts, top selling items, recent orders
  (click to open the real receipt) and quick actions to every module.
- **Banner image.** A professional restaurant banner is built into the app
  (bundled 1600×500 asset, precached for offline use) and shows on the
  dashboard by default, with only the restaurant name, a "Welcome back."
  greeting and an optional configured tagline over it — no editing controls on
  the banner itself. Customisation lives in Settings → Appearance (wide
  preview, upload/replace, restore default, explicit save) and in Settings →
  Restaurant's banner picker, centre-cropped to 16:5 and re-encoded before
  storage, so a phone photo becomes a ~100 KB image in the restaurant record.
  Removing a custom banner restores the built-in one.
- **Administrator menu and profile.** The header shows the account menu (My
  profile, Settings, Sign out). `/profile` shows username, role, email, phone,
  last sign-in and the restaurant, and saves display name, email and phone to
  the admin record. Passwords are never read or displayed there.
- **Navigation** now matches the reference: Dashboard, POS, Sales, Customers,
  Menu, Deals, Inventory, Purchases, Reports, Delivery, Settings. Every entry opens
  a working module. Reports reuses the sales report screen; Settings is the
  former Admin panel.
- **Purchases.** New `/purchases` screen records stock receipts: it increases the
  chosen inventory line and stores the receipt (item, quantity, unit cost,
  supplier, reference, note, resulting quantity) in a new additive `purchases`
  store. Impossible adjustments are refused and change nothing.
- **Customers.** Now a table with name, phone, email, order count, spend, last
  order, search across all three fields, pagination, and View/Edit actions. Spend
  and counts come from one pass over the orders store (`statsForAll`), not one
  query per row.
- **Menu items** gained optional SKU, barcode, cost price, preparation time and
  ingredients. Cost price is compared with the selling price in the form; none
  of these fields changes checkout pricing.
- **Charts** are hand-drawn SVG (`src/components/charts`) — a trend line and a
  doughnut — with no charting dependency, no animation and accessible summaries.
- **Database v8** adds the `purchases` store. Additive only, and older backups
  restore because the store is optional in the backup manifest.

## Verification (v5.1.9)

Every command below was executed in this working tree; the results are
reproduced verbatim from the run, not predicted.

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc -b --noEmit` | exit 0, no diagnostics |
| Unit/service tests | `npm test` | 4 suites pass (IndexedDB, data port, receipts, v5.1.9) + auth fresh/legacy suites |
| Production build | `npm run build` | typecheck + build succeed, 61 precached files |
| UI smoke (development only) | `node scripts/smoke-ui.mjs` | mounts, signs in, renders 10 routes, settings/appearance save, no duplicate dashboard, bell present, wizard skipped, no console errors |
| First-run smoke (development only) | `node scripts/smoke-setup.mjs` | fresh terminal opens Sign-Up, registration returns to Sign-In, 6 wrong passwords retryable with no cooldown, sign-in opens the Dashboard, built-in banner with no overlay, custom banner preview/restore, Settings banner card, sign-out/returning-user guards |
| Auth + banner browser smoke (development only) | `node scripts/verify-auth-banner-browser.mjs` | real Chromium: Setup at `/setup` on desktop and mobile, registration → Sign-In (no session), wrong password rejected, correct password → Dashboard, banner paints real pixels with no controls, exact name + greeting, Settings upload/Save card, banner renders offline, sign-out and protected-route guards |
| POS smoke (development only) | `node scripts/smoke-pos.mjs` | places real orders through the POS (steppers, discount cap, shortfall/change), print actions after every order, selected-order print document, single-flight printing, exact-once stock, Receipt on every order-list row incl. page 2 |
| POS browser smoke (development only) | `node scripts/smoke-pos-browser.mjs` | real Chromium layout/hit-testing: tour never covers print actions, receipt failures show Retry, legacy-deal receipts build, mobile cart steppers usable, last controls clear the tab bar, double-click places one order |

`npm test` is dependency-free and offline. The UI smoke run needs two
development-only packages that are **not** in `package.json`:

```bash
npm install --no-save happy-dom fake-indexeddb
VITE_ADMIN_PASSWORD=smoke-test-password npm run build   # throwaway build
node scripts/smoke-ui.mjs
npm run build                                          # rebuild without the test password
```

`node scripts/smoke-setup.mjs` runs against the final normal `npm run build`
output above (never the throwaway provisioned build): it starts from an empty
database, completes the first-run Sign-Up through the real form, and checks
the no-cooldown, banner and returning-user behaviour listed in the table.

`node scripts/smoke-pos.mjs` runs against the same throwaway provisioned
build as the UI smoke and needs the same two development-only packages. The
browser smoke additionally needs a real Chromium; it uses the
`@sparticuz/chromium` npm tarball (no browser download) and spawns its own
preview server:

```bash
npm install --no-save puppeteer-core @sparticuz/chromium
VITE_ADMIN_PASSWORD=smoke-test-password VITE_EXPOSE_TEST_API=true npm run build
node scripts/smoke-pos-browser.mjs
npm run build                                          # rebuild normally
```

The smoke run loads the built bundle in Happy DOM against a fake IndexedDB,
signs in through the real form, then visits `/dashboard`, `/sales`,
`/customers`, `/menu`, `/inventory`, `/admin`, `/purchases`, `/reports`,
`/profile` and `/`, asserting each screen renders, that the appearance switches
persist, that Settings has no second dashboard, and that nothing logs a console
error. It is not a substitute for a browser: layout, CSS painting and printing
still require a real device.

The auth/banner browser smoke runs against a **normal** build (no provisioned
password, so the first screen really is Sign-Up) and needs the same packages:

```bash
npm install --no-save puppeteer-core @sparticuz/chromium
npm run build                                 # a normal build: no password, no test API
node scripts/verify-auth-banner-browser.mjs   # screenshots to /tmp/pos-v519-ui
```

**Not verified:** no physical thermal printer and no touch device were
available in this environment. Printing is verified at the calculation and
encoder level only (see Printing); no claim is made that a specific printer
produced a correct page. Layout and painting of the auth screens and the
dashboard banner *were* checked in real Chromium (desktop 1440×900 and mobile
390×844).

## Stack

React 18 · TypeScript (strict) · Vite 5 · React Router 6 · CSS Modules + design tokens.

Runtime dependencies: **3** (`react`, `react-dom`, `react-router-dom`). No UI kit,
no icon library, no state library, no IndexedDB wrapper — all hand-rolled and minimal.

## First run

```bash
cp .env.example .env      # set your own admin credentials
npm install
npm run dev        # dev server on :5173
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build on :4173
npm run typecheck  # types only
```

## Running a production build locally

```bash
npm run build
npm run serve      # then open the printed http://localhost:4173
```

**Opening `dist/index.html` directly (a `file://` URL) shows a white screen.**
That is not a fault in the build: browsers block ES modules loaded over
`file://` under the CORS policy (`origin 'null'`), so the scripts never
execute. Verified against a minimal two-line test page - any external
`type="module"` script fails the same way. A build must be served over
`http://`.

`npm run serve` uses only Node's standard library (no extra dependency) and
includes the single-page-app fallback, so deep links such as `/menu` work on a
full page load. Any static server works equally well.

Assets are emitted with **relative** paths (`base: './'`), so the build also
runs correctly from a sub-path such as `https://example.com/pos/`. The router
derives its basename from the served directory, so routing works there too.
Set `VITE_BASE=/your/path/` at build time if you need an absolute public path.

## Structure

```
public/
  manifest.webmanifest   PWA manifest
  sw.js                  app-shell service worker
  icons/                 svg + 192/512 + maskable png
src/
  app/
    App.tsx              router composition + error boundary
    AuthContext.tsx      auth provider & useAuth hook
    RequireAuth.tsx      route guard
    routes.tsx           route & navigation registry (single source of truth)
  components/
    layout/              AppLayout, Sidebar, TabBar, OfflineBanner, PageHeader,
                         GlobalHeader (notification bell), NotificationBell,
                         ErrorBoundary
    admin/               AdminNav, DashboardSection, ManageLinkSection,
                         AboutSection, LegalDocumentView,
                         RestaurantProfileForm, PrinterSection,
                         SecuritySection, LicenseSection, SettingsSection,
                         LogoField, ImageField, PriceInput
    deals/               DealForm, DealList, DealProductPicker
    inventory/           InventoryForm, InventoryList
    pos/                 ItemGrid, DealGrid, CartPanel, OrderConfirmation
    receipt/             Receipt (58/80mm layout), ReceiptView, PrintPanel,
                         OrderReceiptDialog (preview + print actions)
    sales/               SummaryCard, WeekChart
    menu/                MenuItemForm, MenuItemList
    onboarding/           SetupWizard (first run), AppTour (guided tour)
    charts/              TrendChart (SVG line), DonutChart (SVG ring)
    ui/                  Button, Card, EmptyState, Input, Spinner, Textarea,
                         Icons
  content/
    legal.ts             Privacy Policy, Terms, vendor identity, app info
  config/
    app.config.ts        version, locale, CURRENCY (PKR only)
    license.config.ts    licence public key, policy, optional API URL
    sync.config.ts       sync endpoint, batching, backoff
    auth.config.ts       provisioning, session & password policy
    storage.config.ts    DB name/version, object stores & indexes
  data/
    db/indexedDb.ts      promise wrapper over IndexedDB
    db/migrations.ts     versioned, idempotent schema migrations
    repositories/        generic typed repository factory + registry
    storage/             safe localStorage for UI preferences
  hooks/                 useOnlineStatus, useMenu, useInventory, useDeals,
                         useCart, useSales, useCustomers, useSyncStatus,
                         useInstallState, useNotifications, useDisplayPreferences
  pages/                 Login, Dashboard, Pos, Sales, Customers, Menu, Deals,
                         Inventory, Purchases, Delivery, Admin, Profile, NotFound
  services/              authService (login, session, credentials)
                         customerService (records, stats, order history),
                         databaseService (startup, diagnostics, reset)
                         dealService, escpos (ESC/POS encoder), inventoryService,
                         menuService, orderService, printService,
                         licenseService, license/validator (pluggable),
                         printerService, receiptService, receiptEditService,
                         restaurantService, salesService, settingsService,
                         notificationService, onboardingService,
                         displayPreferencesService, purchaseService,
                         syncQueueService
  pwa/                   service worker registration, sw.template.js,
                         installService (install capability detection)
  styles/                tokens.css, reset.css, global.css, print.css
  types/                 common + domain entity types
  utils/                 currency, crypto (PBKDF2), date, id, cn, image
```

## Local database

All data lives in IndexedDB (`pos-db`, version 8) so the terminal keeps working
without a network connection. There is no demo data — the database starts
completely empty apart from the admin account created on first sign-in.

**There is no server database.** No `DATABASE_URL`, no ORM, no connection
string, and no backend is involved in storing or reading records. Vercel (or
any other static host) only serves this application's files; the records stay
in the browser.

### Data is kept per address (origin)

Because the database is browser storage, it is partitioned by **origin** —
scheme + host + port:

| Address | Database |
| --- | --- |
| `https://pos.example.com` | its own `pos-db` |
| `https://pos-abc123.vercel.app` | a different, separate `pos-db` |
| `http://localhost:5173` | another separate `pos-db` |
| a file downloaded and opened locally | yet another |

**This is why a newly opened deployment can look empty while an older copy
still shows the client's data.** The deployment did not lose anything and
nothing was deleted: the records are still in the browser profile of the device
and address where they were entered. A new address simply opens a new, empty
database of its own.

Practical consequences:

- Keep using **one** production address. Deployment-specific preview URLs are
  temporary origins and must not be treated as the terminal.
- Installing the app (see Install) keeps the address stable and requests
  persistent storage so the browser will not evict it.
- To move existing records to a new address, use **Admin → Data**: Export on
  the address that has the data, then Restore on the address that needs it.
  Restore is a **merge** — it only ever writes, never clears or resets.
- A genuinely shared, multi-device database needs the optional sync backend
  (`VITE_SYNC_API_URL`, see Synchronisation). Until it is configured, every
  address is standalone by design.

### Stores

| Store | Contents |
| --- | --- |
| `admin` | Admin account and password hash (unique `by_username`) |
| `restaurant` | Restaurant profile, tax configuration |
| `menuItems` | Menu items, including each item's optional discount percent |
| `itemPrices` | Sizes and prices per menu item |
| `inventory` | Stock levels and reorder points |
| `deals` | Deals and combo definitions |
| `orders` | Order headers (unique `by_orderNumber`; indexed by status and customer) |
| `orderItems` | Order line items |
| `sales` | Completed sales, indexed by business date |
| `customers` | Customer records (unique by normalised phone when present) |
| `license` | Licence/activation state |
| `settings` | Key/value preferences |
| `syncQueue` | Pending local changes awaiting upload |

### Guarantees

- **Stable IDs** — every record gets a collision-resistant string `id`.
- **Timestamps** — `createdAt` is written once and never changes; `updatedAt`
  advances on every write; `rev` increments for conflict resolution.
- **Durable** — data survives page refresh *and* a full browser restart. It is
  not held in React state or memory.
- **Soft deletes** — `remove()` sets `deletedAt` so the deletion can be synced
  later; `list()` hides those rows. Pass `{ hard: true }` to erase.
- **Migrations** — versioned and idempotent in `src/data/db/migrations.ts`.
  Never edit a shipped migration; always add a new one.
- **Offline-first** — local writes are the source of truth and are queued in
  `syncQueue` for a future backend. Nothing is uploaded yet.

Repositories are the only supported way to touch the database:

```ts
import { menuItemsRepository } from '@/data/repositories';

const item = await menuItemsRepository.create({ name: 'Chicken Karahi', ... });
await menuItemsRepository.update(item.id, { name: 'Chicken Karahi (Full)' });
```

## Synchronisation

```
offline change -> local database -> sync queue
               -> internet available -> synchronise
               -> confirm success -> mark synced
```

Sync is **off unless `VITE_SYNC_API_URL` is set**. Unset, the app is purely
local - but changes still queue durably, so connecting a backend later uploads
everything recorded in the meantime. The contract is in
`src/services/sync/README.md`.

**Billing is never blocked.** Completing an order writes locally and returns;
queueing happens afterwards and its failures are swallowed. A sale completed in
**64ms** during testing while sync was mid-error.

### Guarantees

**No duplicate orders.** Each queue item carries an idempotency key generated
once at enqueue and reused on every retry. This covers the dangerous case
where the server commits but the response is lost: the retry returns
`duplicate`, which counts as success. Verified by making the mock server
commit and then kill the connection - the retry produced no second order.

**No data loss.** Items are removed only after the server confirms them. A
failure returns the item to the queue with exponential backoff (1s, 5s, 15s,
60s, 5m); after 5 attempts it is parked as `failed` and surfaced with a Retry
action. Nothing is ever discarded.

**Safe retry.** Backoff, an attempt cap, a single-flight lock so two drains
cannot overlap, recovery of items left `syncing` by an interrupted run, and a
hard bound on batches per drain so sync always terminates.

**Safe conflicts.** Orders, order items and sales are immutable history and are
never overwritten. Mutable config resolves last-write-wins, and a server-won
conflict is applied locally so both sides converge.

### Change tracking

Every repository write funnels through
`data/repositories/changeTracker.ts`, so a new feature cannot forget to queue
its changes - "no data loss" is a property of the architecture, not of
discipline. Orders enqueue a composite payload (header + items + sale) so a
sale stays atomic on the wire. The queue, settings, admin credentials and
licence are per-terminal and excluded.

### Status indicator

Offline / Syncing / Synced / Sync error, with a pending count and a Retry
action on error. It renders nothing when no backend is configured, so a local
install gains no dead chrome.

## Performance and motion

Measured with 60 menu items, 12 deals and 30 stock lines - performance with a
single record proves nothing.

| Metric | Result |
| --- | --- |
| Screen render | 133-197ms across all six screens |
| Add to cart | 25ms |
| Complete an order | ~0.5s |
| Frame pacing | 16.6ms average, p95 16.8ms |
| Dropped frames | 0 |
| Cumulative layout shift | 0.000 |

### Motion

Every animation targets `transform` and `opacity` only, so it runs on the
compositor and is not capped by layout work. Three animations were converted
during this audit: the sales chart and the sidebar active marker both animated
`height` (forcing layout on every frame), and the chart's transition became a
`scaleY` keyframe from a fixed origin.

Durations come from four tokens (90/150/220/320ms) with a single shared
easing curve, so motion feels consistent rather than assembled. Everything is
disabled under `prefers-reduced-motion`, verified to leave zero animated
elements.

Frame rate is bounded by the display, not the application: with no layout work
in any animation, the compositor is free to present at whatever refresh rate
the hardware offers. The headless browser used for testing caps at 60Hz, so
60fps with zero dropped frames is the ceiling that could be measured here -
higher-refresh hardware was not available to verify 90fps directly.

### Touch targets

Cart controls are visually compact so the panel is not dominated by chrome,
but expand to a 44x44 hit area on touch devices via a pseudo-element, which
costs no layout space.

## Security posture

A dedicated audit (Step 19) probed authentication, credentials, input
validation, persistence, destructive actions, licence handling, secrets, local
storage, sync and error handling. It found **12 issues, all now fixed**. The
notes below record the resulting design.

### No secrets in the bundle

A bundled application cannot keep a secret: anything read through
`import.meta.env` is inlined into the JavaScript served to the browser. The
audit confirmed the previous build shipped the admin password in
`dist/assets/index-*.js`.

The application no longer ships one. On first run it opens a one-time
Sign-Up screen where the operator creates the administrator account and sets
their own password; only its PBKDF2 hash is stored. Registration then returns
to Sign-In — it never opens the dashboard by itself — and once an account
exists the Sign-Up screen is closed for good. `VITE_ADMIN_PASSWORD` is still
honoured for test automation and kiosk provisioning (seeding a
must-change-password account), and `.env.example` states plainly that
anything set there is readable by anyone.

### Session tokens are bound to the account

A session in `localStorage` is only honoured if its token hashes to the value
recorded on the admin record at sign-in. Before this fix, a hand-written
session object granted full admin access with no password - an authentication
bypass. Signing out and changing credentials both invalidate the stored token.

### Validation at the service boundary

`utils/validate.ts` guards every value that reaches storage. UI validation
alone was insufficient: anything bypassing a form reached the database
unchecked, and a single `NaN` price made the entire day's sales total `null`.

| Value | Rule |
| --- | --- |
| Order price | Finite, non-negative, bounded, rounded to integer paisa |
| Order quantity | Whole number, at least 1, bounded |
| Stock level | Non-finite becomes 0; clamped and rounded to 3 decimals |
| Menu price | Invalid becomes `null` (not offered) rather than `NaN` |
| Percentages | Clamped to 0-100 |
| Text | Trimmed and length-bounded |

Aggregation is defensive too: sales totals treat a non-finite stored value as
zero, so a bad row written by an earlier build cannot corrupt today's figures.

### Destructive actions

Deleting a menu item, stock line or deal, marking stock out, and deactivating
a licence all require explicit confirmation and can be cancelled.

## About, legal and branding

**Admin > About** holds application information, the Privacy Policy, the
Terms & Regulations, and the vendor attribution.

### Application information

Version, currency (Pakistani Rupees, `Rs.`), currency code, locale, time
zone, storage model and provider - all read from `config/app.config.ts` so
they cannot drift from the real build.

### Legal documents

`src/content/legal.ts` holds both documents as structured data rather than
markup, so the same text could be exported or printed without duplication.
The wording describes this application's **actual** behaviour: all business
data is stored locally, there is no telemetry, and nothing is transmitted
unless the operator configures a sync or licence endpoint. If that behaviour
changes, these documents must be updated to match.

Three fields are left as bracketed placeholders because only the operator can
supply them: registered business name, contact email and jurisdiction.

### Branding is confined to About

`VENDOR` is defined once in `content/legal.ts` and rendered only in the About
section. The POS, Sales, Menu, Inventory, Deals and login screens carry no
vendor branding, and receipts show the operator's own restaurant identity.
This is enforced by tests that scan each screen for the vendor name.

## Installing the application

The POS is a full PWA: manifest, service worker, offline caching, standalone
display, maskable icons and app shortcuts.

### Install support is reported honestly

An install button is **only** shown when the browser has actually given the
app a usable install prompt. `pwa/installService.ts` resolves to one of:

| State | Browser | What Admin > Install shows |
| --- | --- | --- |
| `promptable` | Chrome, Edge, Samsung | A real **Install application** button |
| `manual-ios` | Safari on iOS/iPadOS | The genuine Share -> Add to Home Screen steps |
| `unsupported` | Firefox desktop, others | An explanation, and no button |
| `installed` | Running standalone | Confirmation it is installed |

No browser is ever shown a button that would do nothing.

### Startup experience

`index.html` carries inlined boot styles and a small spinner so a standalone
launch goes OS splash -> branded background -> app, with no white flash. The
placeholder is removed as soon as React paints.

### Standalone behaviour

When running installed, the app honours display cutouts via safe-area insets,
disables overscroll rubber-banding, suppresses the tap-highlight flash, and
turns off text selection on chrome while keeping inputs and receipts
selectable. None of this affects the browser experience.

### Shortcuts

The app icon exposes jump targets for New order, Sales and Menu.

## Offline-first

The application is designed to run with no internet at all. Normal billing
never touches the network.

### What makes it work

- **All data is local.** Orders, menu, inventory, deals, sales, settings and
  licence state live in IndexedDB. There is no API call anywhere in the
  billing path.
- **The whole build is precached.** `scripts/build-sw.mjs` runs after every
  build and injects a manifest of every emitted file into the service worker,
  so all 38 assets are cached on install. Runtime caching alone was not
  enough: a route the operator had never opened while online would fail
  offline.
- **Navigations are served cache-first**, then refreshed in the background, so
  deep links work offline and updates are still picked up.
- **Connectivity is verified, not assumed.** After a page load served from
  cache, `navigator.onLine` can report `true` with no connection. A small
  same-origin probe against an intentionally un-cached file confirms the real
  state, so the offline indicator is accurate.

### Known limits, stated plainly

Direct ESC/POS printing still needs the platform to allow it (Chromium with
WebUSB/Web Serial, secure context) - that is a platform constraint, not a
network one, and receipt generation and browser printing work offline
regardless. If a licence API is ever configured, activation of a *new* key
would need connectivity; an already-activated terminal stays activated
offline indefinitely.

## Licensing

Every installation starts **NOT ACTIVATED**. Entering a valid key in
**Admin > License** moves it to **ACTIVATED**, and that state persists locally.

### How a key is judged valid

Keys are `POS1.<payload>.<signature>` where the signature is **Ed25519** over
the payload, verified in the browser against the public key embedded in
`config/license.config.ts`. Forging a key without the private signing key is
not feasible.

The private signing key lives outside the repository in `.secrets/` (which is
git-ignored) and must never ship. Only the public key belongs in the app.

### What this is not

**A client-side check is not secure server-side licensing.** Verification runs
on the customer's machine in code they can read and modify, so a determined
user can patch it out. Signature verification raises the effort required; it
cannot make the check authoritative. Only a server that holds licence state
and refuses service can do that. The Admin UI states this plainly rather than
implying otherwise.

### Connecting a real licence server

Set `VITE_LICENSE_API_URL` at build time. `createValidator()` then returns the
remote validator instead of the offline one - the service, storage shape and UI
are untouched. The expected request/response contract is documented in
`src/services/license/README.md`.

If the server is unreachable, activation falls back to the offline signature
check, so a genuine key still activates while the connection is down. A forged
key still fails.

### Offline policy

Once activated, the licence stays active offline **indefinitely** until
explicitly deactivated. This is deliberate for a POS: a till must never stop
trading because the internet is down. A failed re-verification caused by a
network problem never deactivates a working terminal; only a key that fails
signature verification outright is marked invalid.

## Admin panel

**Admin** is a single screen with one section per concern in a
keyboard-navigable rail (arrow keys, Home/End). The open section is remembered
for the session.

| Section | Contents |
| --- | --- |
| Dashboard | Today's sales and orders, items available, stock alerts, links to each screen |
| Menu / Inventory / Deals | Live counts plus a link to the dedicated screen |
| Restaurant Profile | The Step 5 profile form |
| Printer | Default paper width (58mm / 80mm) and direct-printing capability |
| Security | Change admin username and password |
| License | Local licence record |
| Settings | Order number prefix, default low stock level, receipt behaviour, and Data Management |

Data Management is inside Settings. It shows this terminal's database details and record counts, offers one-click JSON backup, and supports a reviewed import. See [Data backup and restore](#data-backup-and-restore) below.

Menu, Inventory and Deals already own full screens, so Admin **links to them
rather than duplicating the UI** - one implementation each, no risk of two
copies drifting apart.

### Security

Changing the username or password always requires the **current password**, so
an unlocked terminal alone is not enough to take over the account. Passwords
are validated for length and confirmation, hashed with the existing PBKDF2
path, and cleared from component state after saving. The active session is
updated in place, so changing the username does not sign the operator out.

### Settings actually take effect

Nothing here is a dead switch:

- **Order number prefix** is applied by `orderService` to every new order
  number (`A-0001`).
- **Default low stock level** pre-fills the alert field when adding inventory.
- **Show receipt after completing an order** is honoured by the POS.
- **Paper width** is the default every new receipt opens with.
- **Dashboard and order list** switches in Admin → Settings drive
  `useDisplayPreferences()`; the Dashboard and the Sales order list re-render
  immediately when they are saved. Reset to default clears the stored key.
- **Notification kinds** are checked by `notificationService` before an entry
  is written, so turning a kind off stops new entries of that kind only.

### Data backup and restore

Settings → Data Management provides a one-click JSON export and a reviewed import
for moving a POS installation. The `pos-data-backup` v2 envelope includes the
current app/database/schema versions, creation time, store list and explicit
exclusion notes. The business payload currently covers restaurant profile/logo,
menu items and prices, inventory, deals, orders and order lines, sales,
customers, toppings, add-ons and application settings. This schema has no
vendor store; no vendor records or fields are fabricated.

Import is a **merge**, not a destructive restore: records are matched by stable
ID, newer source records replace the matching local record, and records not in
the file stay untouched. Unique order/sale conflicts are preflighted and the
IndexedDB transaction is rolled back if a write fails. The UI previews counts
and exclusions and requires explicit confirmation before import. Invalid or
incompatible files are rejected before any transaction starts. Legacy v1
backups are also accepted.

Device-local administrator credentials and the sync transport queue are not
portable: the former remain on the destination terminal, while the latter is
transient delivery state rather than the business records being moved. These
exclusions are shown in the UI and recorded in the backup metadata.

### License - honest scope

There is **no licence server and no validation**. A key entered here is stored
locally and reported as *unverified*; it does not activate or unlock anything.
The UI states this plainly. The record exists so a real activation check can
be added later without changing the storage shape.

## Sales analytics

The **Sales** section reports what was actually sold. Every figure is derived
from `sales` records written when an order was completed - nothing is
estimated, projected or invented. With no orders, every total is `Rs. 0` and
every count is `0`, and the page shows an empty state rather than a zeroed
dashboard.

### Periods

Calendar-based, computed in local time so "today" matches the operator's day:

| Period | Range |
| --- | --- |
| Today | The current local calendar day |
| This week | **Monday** to today |
| This month | The 1st to today |

Because weeks start on Monday, the weekly total can legitimately exceed the
monthly total in the first days of a month - the week reaches back into the
previous one. This is correct, not a bug.

Refunded sales (`refundedAt` set) are excluded from every figure, and so are
cancelled orders: cancellation sets `cancelledAt` on the order and its `sales`
row in the same transaction that restores stock, and every total filters
through `isCountable`. The row stays in the Sales list with a `CANCELLED`
badge, but no total, count or average on this page ever includes it. Averages
guard the division, so no orders yields `0`, never `NaN`.

### Cash flow

Under the chart, the **Cash flow** table reports money received per payment
method — Cash, Card, Digital Payment and Other — for **Today**, **This week**
and **All time**. Each figure is the sum of `amount` on completed orders with
that `paymentMethod`; cancelled orders are excluded, so cancelling an order
removes its contribution from the method it was paid with. With no completed
orders every cell reads `Rs. 0`.

### Visualisation

One lightweight bar chart of the current week, drawn with plain CSS - seven
values do not justify a charting dependency, so the runtime stays at three
packages. Days with no sales render an empty track rather than being omitted,
and any day with real sales gets a minimum bar height so a small figure is
never mistaken for an empty day.

## Customers

The **Customers** section (between Sales and Menu) is the lightweight customer
record the POS asked for: it exists to attach a name and phone number to
orders, and to look those orders up again.

- **Customers are created automatically.** Completing an order that carries a
  name or a phone number upserts a customer record from the POS's optional
  customer fields. A phone number that already exists reuses that record
  instead of creating a duplicate, so repeat customers accumulate history
  rather than rows.
- **The list** shows name and (only when one was given) phone, with a search
  box filtering on both. Empty state: "No customers yet".
- **The detail panel** shows Orders completed, Total spent and Last order,
  plus the order history: number, date, type (Dine-In/Takeaway/Delivery),
  payment method and amount. Cancelled orders are listed with a `CANCELLED`
  badge but are not counted in the stats and contribute nothing to the total.
- **Manual records** — "Add customer" works without ever placing an order, and
  details can be edited from the detail panel.

Customer records may also include an optional address entered by the operator;
Delivery Management reuses that saved address when creating a delivery order.
No loyalty tiers or other generated customer data are added. The section is
available on the sidebar, the mobile tab bar and at `/customers`.

## POS billing

The **POS** screen is the billing workflow. Every priced variant (size or
drink volume) is its own button, so selecting an item and its variant and
adding it to the cart is one tap. Adding the same item and variant again
stacks the line instead of duplicating it; a different variant becomes its own
line.

The cart supports quantity steppers, per-line removal and Clear, and shows
**Subtotal**, an optional **Discount** and **Total** (plus a tax row when a
rate is configured). Two kinds of discount exist and simply add together:

- **Item discounts** — a percentage configured per menu item (Menu screen),
  applied to every line of that item. The cart line shows it inline
  ("350 ml · Rs. 100 · 10% off"), the receipt's line amount is already
  discounted, and the menu list carries a "10% OFF" badge. Deal lines never
  take an item discount.
- **Order discount** — the **Discount** field at checkout takes a rupee amount
  that reduces the payable total the moment it is typed. Values above the
  remaining room are flagged ("Discount cannot exceed ...") and block
  completion, so the two discounts can never overlap and the total can never
  go negative.

The footer also captures the **Customer paid** amount and
calculates **Return / Change** immediately as it is typed: an empty field
means the customer pays the exact total, an overpayment shows the change due,
and an underpayment blocks completion with a "Short by ..." hint until it is
covered — with or without a discount applied.

The payment method is chosen with one radio — **Cash**, **Card** or
**Digital Payment** (default Cash). It is stored on the order and sale, shown
on the receipt ("Payment method"), and listed next to each order on the Sales
screen. The paid and return figures are stored on the order and shown on the
confirmation and receipt. Completing an order writes it permanently and shows
the order ID.

### Money

All money is integer **paisa**; rupee floats never enter the arithmetic.
Display goes through one formatter, so the currency is Pakistani Rupees only:
`Rs. 500`, `Rs. 1,250.50`. Tax is rounded once, at the tax figure, to avoid
per-line drift. Exclusive tax is added on top; inclusive tax is extracted from
the price so the total still equals the sum of the displayed prices.

Tax comes from **Admin > Restaurant** (`Sales tax (%)` and `Prices include
tax`). It starts at **0**, so no rate is ever invented — with no tax
configured, total equals subtotal.

### What a completed order writes

One `orders` header, one `orderItems` row per line, and one `sales` row for
reporting — all in a **single atomic transaction**, so a failure can never
leave a half-recorded sale. Item names and sizes are denormalised onto the
order items, so a receipt still reads correctly if the menu item is later
renamed or repriced.

Order IDs are UUIDs; order **numbers** are a zero-padded per-installation
sequence (`0001`, `0002`, ...) backed by a counter in `settings`, so they
continue correctly across restarts.

Linked stock is decremented in the **same transaction** as the order, by the
quantity sold — deal lines deduct their included products multiplied by the
bundle quantity — so a completed sale can never skip its stock movement and a
failed checkout can never perform one. Quantities are clamped at zero, so
stock never goes negative and a stock write can never fail the payment; an
item that reaches zero is marked out of stock and disappears from the POS.

### Cancelling an order

Orders on the Sales screen can be cancelled — deliberately not a single
accidental click: the Cancel button opens an explicit confirmation ("cancel
this order?", with an `aria-describedby` link to the order number) and only
"Yes, cancel" proceeds.

Cancelling runs as one atomic operation that:

- flips the order's status to `cancelled` (a new `by_status` index reads them),
- sets `cancelledAt` on the order **and its `sales` row**, so revenue, order
  counts, averages and the cash-flow table drop the amount immediately (the
  row itself stays for history, and `isCountable` filters it from every
  figure),
- **restores linked stock** by exactly the quantities that order deducted, and
- leaves the order itself in place for history.

A cancelled order keeps its number and details in the Sales list and in the
customer's history, shown with a `CANCELLED` badge, is excluded from customer
stats, and cannot be cancelled twice (its Cancel button is gone). All of it
survives a reload.

### Offline

Billing reads locally stored menu data and writes to IndexedDB. **No network
is involved** — verified by completing an order with the browser forced
offline.

## Delivery Management

The `/deliveries` section works with existing completed POS orders. Choose
**Delivery** in POS to require an address and optionally enter delivery
instructions; selecting a saved customer pre-fills their name, phone and saved
address. Orders remain ordinary sales, with delivery fulfilment stored as
optional fields on the existing order record.

Delivery Management provides a status/today overview, order search, status and
rider filters, date range, order/payment/item details and a progress history.
Operators can assign or change riders, update an address or instructions, and
track Pending, Confirmed, Preparing, Ready for Delivery, Assigned, Out for
Delivery, Delivered and Cancelled. The rider roster uses the existing settings
store (`delivery.riders`); no new IndexedDB store or migration is introduced.
Sales totals and payment data remain owned by the existing order workflow.

The order detail reuses the customer and compact kitchen receipt layouts,
including delivery contact/address and notes where available. The kitchen
receipt omits prices and customer totals. Printing uses the saved restaurant
profile logo without adding another upload workflow.

## Printing

Two genuinely different paths, deliberately not conflated:

| | Browser print | ESC/POS direct |
| --- | --- | --- |
| Route | OS print dialog then printer driver | Bytes straight to the device |
| Code | `printService.ts` + `styles/print.css` | `escpos.ts` + `printerService.ts` |
| Works in | Every browser | Chromium (WebUSB / Web Serial) |
| Scaling | Browser and driver may rescale | None; printer renders the bytes |

**Browser printing is not equivalent to native ESC/POS communication.** It
renders a page and hands it to the operating system, which depends on the user
selecting the right printer and paper. ESC/POS sends commands with no dialog,
no driver rasterisation and no scaling.

### Print stylesheet

The browser pipeline is `printService.ts` plus `src/styles/print.css`. Each
receipt is cloned into a dedicated, receipt-only print iframe; it does not
print the application viewport or rely on a scrollable Admin/POS ancestor. The
print stylesheet hides all non-receipt content with `display: none`.

**Content-sized media:** after fonts and receipt images settle, `printService`
measures the selected receipt, rounds its height up to 0.1mm, adds only a
0.6mm feed tail, and injects a valid two-length rule such as
`@page { size: 58mm 97mm; margin: 0 }`. `size: 58mm auto` is invalid and can
make browsers silently ignore the requested roll size. Printer drivers may
still override CSS page size; choose the matching 58mm/80mm roll, zero margins
and 100% scale in the system dialog when needed.

**Print Both** creates two separate content-sized print jobs, customer first
and kitchen second. This avoids sizing a short kitchen ticket to the taller
customer receipt or placing both tickets on one shared page. The user may need
to dismiss the first system print dialog before the second opens.

### ESC/POS

`escpos.ts` lays text into the printer's fixed character grid: **32 columns at
58mm, 48 at 80mm** (Font A). Amount columns are protected from long item names;
wrapped text is retained rather than clipped. Text remains printer-native for
crisp output, non-ASCII characters are transliterated for common single-byte
code pages, and the existing profile logo is proportionally rasterized at
printer-dot resolution. Customer and kitchen encoders are separate; “Send
Both” emits two independently cut ticket streams. Each text line already ends
in a line feed, so the final partial cut advances only one dot instead of
feeding an extra full blank line.

`printerService.ts` implements WebUSB and Web Serial transports behind one
interface, so another transport (Bluetooth, a native bridge) can be added
without touching the encoder. The printer panel can preview/download the exact
encoded bytes before sending.

**Not verified against hardware.** No thermal printer exists in the
development environment, so physical text density, logo darkness, custom-page
driver behavior and the end-to-end USB/Serial transports could not be checked.
The isolated automated checks validate layout calculations, content-height
rules, wrapped ticket text, encoder/cut commands, and mocked proportional logo
raster dimensions; this is not a claim of successful physical printing.

## Receipts

Completing an order opens its customer receipt. Delivery Management can reopen
a stored order and print it again. The thermal preview supports **58mm** and
**80mm** paper, switchable from the receipt toolbar; the chosen width is saved
as the default for the next receipt. Customer and kitchen receipts can be
printed separately or together.

Customer receipts show the saved restaurant name, logo, contact details and
receipt info when available; readable order type, number, and date with time on
one row; item name/size/quantity/prices and modifiers; totals/payment; and
saved order, item and delivery notes. Delivery receipts additionally show the customer's phone,
delivery address and instructions when present. The customer logo is reused
from the existing restaurant profile, keeps its aspect ratio and is omitted
cleanly when absent or unavailable.

Kitchen tickets contain order context, quantities, products/modifiers and
available notes, but no prices or customer totals. They are compact and share
the selected 58mm/80mm width so staff can read the fulfilment details without
printing billing information.

### How the layout is kept from breaking

- The sheet uses a **fixed physical width** (58mm / 80mm); the item name gets
  the flexible column while quantity and money columns remain aligned.
- Long names, addresses and notes wrap rather than clip or overflow; optional
  rows are omitted rather than rendered blank.
- **No fixed receipt height.** The sheet grows with its content. Browser print
  measures the selected ticket, rounds up to 0.1mm and adds only a 0.6mm feed
  tail. One item prints a short slip; additional wrapped lines add only the
  height they need.
- Paper is spent on **type, not whitespace**: compact 1.4–1.6mm vertical
  padding and tight section gaps leave room for bold customer text (15px at
  80mm, 13px at 58mm). Kitchen type is slightly smaller (14px / 12px) while
  quantities and item names remain prominent.
- The logo is proportionally bounded to 54×24mm at 80mm and 42×20mm at 58mm.
  It contributes to height only when present — there is no reserved empty box.
- Long names, prices, addresses and notes wrap rather than clip or overlap;
  optional rows are omitted rather than rendered blank. Narrow receipt rows
  use fixed quantity/price/amount columns while the name column takes the rest.
- Browser printing uses one content-sized job per ticket; direct ESC/POS uses
  crisp text, a raster logo and an independent cut per ticket. Neither path has
  been physically verified on a thermal printer in this environment.
- **Printing is read-only.** Building and printing a receipt only reads orders,
  items and the restaurant profile; it never writes, updates or deletes
  business data.

## Deals

The **Deals** section bundles menu products at a better price. Nothing is
seeded: no example deals, no fake prices. A fresh install shows "No deals yet"
and a new deal form is completely empty.

A deal has a name, description, optional image, a set of included products
(each at a chosen size and quantity), and a **Published** switch.

### Pricing

Two pricing modes, chosen per deal:

| Mode | Behaviour |
| --- | --- |
| Fixed | You set the bundle price; that is what the customer pays |
| Percentage | A discount off the sum of the included products |

Percentage discounts are rounded **once**, at the end, so no per-line rounding
drift accumulates. Only the field belonging to the selected mode is stored, so
a stale value from the other mode can never be applied by accident. The form
shows a live preview of items total, deal price and customer saving, all in
Pakistani Rupees.

### Publishing

`isPublished` is the single control asked for by "enable/disable" and
"publish/unpublish": published deals appear in the POS, unpublished deals stay
saved and editable but are never sellable. The POS additionally withholds any
deal whose included products no longer resolve to a real price, so a deal that
cannot be fulfilled is never offered.

Deals appear in their own section above the individual items in the POS, and
add to the cart as a single priced line. Deals are recorded on the order with
a `dealId`, and completing the order also decrements linked stock for their
included products (contents × bundle quantity, aggregated by menu item) in
the same transaction as everything else.

## Inventory management

The **Inventory** section tracks stock. Lines are standalone, so anything can
be tracked (flour, cups, gas cylinders), and each may **optionally be linked**
to a menu item. Entering a stock-line name that exactly matches a single menu
item pre-selects that link for you — a manual choice is never overridden —
and the field's hint explains what the link does. Nothing is seeded: a fresh
install has zero stock lines and shows "No inventory items yet".

### Status

Status is derived, never stored twice:

| Status | Condition |
| --- | --- |
| Out of stock | Marked out of stock, or quantity is zero |
| Unavailable | Availability switched off (quantity untouched) |
| Low stock | Quantity at or below the low-stock alert |
| In stock | Everything else |

`isAvailable` and `isOutOfStock` are deliberately separate from `quantity`:
switching an item unavailable does not destroy its count, and marking it out of
stock remembers the previous quantity in `quantityBeforeOutOfStock` so
**Restore** can bring it back exactly.

### Effect on the POS

A linked line that is out of stock or unavailable **withholds its menu item
from the POS**, so staff cannot sell what is not there. `useInventory` notifies
menu subscribers as well as its own, so the POS updates the moment stock
changes — no reload.

Destructive actions (delete, mark out of stock) require inline confirmation.

## Menu management

The **Menu** section (5th nav item) manages what the POS can sell. Nothing is
seeded: no default products, no demo items, no sample prices. A fresh install
shows "No menu items yet".

Each item supports a name, category, description, image, an availability
toggle, and a variant selector: **Food sizes** (Small, Medium, Large, Extra
Large, XL) or **Cold drink volume** for beverages. Food sizes are the fixed
predefined set; volumes combine the predefined starting points (250 ml, 330
ml, 500 ml / Half Liter, 1 Liter, 1.5 Liter) with a **custom volume row** —
enter any value and unit (`Volume [350] Unit [ml] Price [100]` gives
"350 ml", `Volume [2] Unit [L] Price [300]` gives "2 Liter") and it becomes a
normal stored label like any other. Custom volumes are never restricted to a
hardcoded list: they round-trip through Add/Edit, appear as their own buttons
in the Menu list and POS, and flow through the cart, orders and both
receipts. Both kinds use the same variant/price rows, so nothing about
storage or sale flow differs. Every price is optional — leave a size or
volume blank and the item simply is not sold in it. Prices are entered and
displayed in Pakistani Rupees only, and stored as integer paisa so no
floating-point drift is possible.

### Item discount

Each item may also carry an optional **discount percent** (`Item discount (%)`
in Add/Edit, saved with the item). Its effects follow the item everywhere:

- The menu list shows a compact badge — `10% OFF` — beside the name.
- POS tiles and cart lines show the discount inline ("350 ml · Rs. 100 ·
  10% off"), and the line amount is reduced immediately.
- The receipt's line **Amount** is already discounted, and the order's Discount
  row reports the sum. Deal lines are never discounted.
- Empty or `0` disables it; the form accepts only `0–100` ("Enter a
  percentage between 0 and 100.") with the service sanitising what is stored,
  and the checkout calculation clamps defensively so the discount can never
  exceed the line. Editing the field survives an item edit round-trip, and the
  discount is stored per item so a later price change keeps it.

This is independent of the rupee order-level **Discount** typed at checkout —
the two simply add, each clamped so the payable total can never go negative
(see POS billing).

### Storage shape

An item is one `menuItems` record plus one `itemPrices` row per offered
variant. Keeping prices in their own store means new labels, cost prices or
per-size stock can be added without reshaping the item record. Deleting an
item removes it and its price rows in a **single atomic transaction**, so
orphaned prices cannot be left behind.

### Live updates to the POS

`src/hooks/useMenu.ts` is a small publish/subscribe store over the database.
Saving, toggling or deleting an item notifies every mounted consumer, so the
POS reflects the change immediately without a reload or a state library. The
POS subscribes with `activeOnly`, so disabled items are never sellable while
remaining saved and editable in Menu.

## Restaurant profile

Configured from **Admin > Restaurant**. One profile record per terminal, saved
under the fixed key `restaurant-profile` in the `restaurant` store.

Editable fields: restaurant name, logo, address, phone, email, receipt
information and receipt footer message. **Every field starts empty** — no
example name, address, phone number or logo is ever shipped or written. The
record itself is not created until the operator saves for the first time.

### Logo handling

Logos are optimised in the browser before they are stored, so a multi-megabyte
photo becomes a few kilobytes:

- Downscaled so the longest edge is at most **512px**.
- Re-encoded as **WebP** (quality 0.86) with a PNG fallback; the smaller of the
  two wins.
- Transparency is preserved — no white matte is painted behind the image.
- SVGs are passed through untouched since vector data is already compact.
- Files over 8 MB are rejected before decoding.

The result is stored as a data URL inside the profile record, so the profile is
one self-contained row with no separate blob store to keep in sync.

## Authentication

Admin sign-in gates the entire application; every route except `/login` and
the one-time `/setup` is wrapped in `RequireAuth`.

**First run is Sign-Up, not Sign-In.** Whether an account exists is read from
the persisted credential record in IndexedDB, never a frontend flag. With no
account, `RequireAuth` routes to `/setup`, where the operator creates the
single administrator account (`authService.createInitialAdmin()`: validated,
PBKDF2-hashed, written atomically with `add` so simultaneous submissions
cannot both win, then re-read to verify). Success redirects to `/login` with
"Account created successfully. Please sign in." — registration creates no
session. Signing in then opens the **Dashboard**; a visitor redirected here
from a protected URL is returned to that URL instead. Afterwards `/setup` redirects to `/login`, so there is no open
public registration. Existing accounts (including older ones still flagged
`mustChangePassword`) are recognised as set up and are never sent to Sign-Up
or replaced by it.

**Credentials are configurable.** `VITE_ADMIN_USERNAME` / `VITE_ADMIN_PASSWORD`
in `.env` seed a must-change-password account on first run only (test
automation / kiosk provisioning). After that the credentials live
in the local database and are changed at runtime via
`authService.changeCredentials()` — editing `.env` later will not reset a live
account. `.env` is git-ignored; `.env.example` documents the format.

**Passwords are never stored in plaintext.** They are hashed with PBKDF2-SHA256
(150,000 iterations, per-account random salt) via the Web Crypto API, and
verified with a constant-time comparison. Only the hash, salt and parameters
are persisted.

**Sessions** hold an opaque random token, the username and an expiry — no
credential material. They live in localStorage so a refresh or terminal restart
keeps the operator signed in, and expire after 12 hours.

**Hardening.** Login failures always return one generic message so the response
cannot be used to enumerate usernames; both the username and password checks
always run so timing cannot reveal which failed. There is deliberately **no
timed cooldown or lockout after a wrong password**: the attempt is rejected
and the operator may retry immediately. The earlier five-failures/one-minute
lockout was a `localStorage` timer that anyone with physical access to the
terminal could clear, so it only locked out legitimate operators; what slows
guessing is the 150,000-iteration PBKDF2 verification paid on every attempt,
which cannot be switched off. Wrong credentials still never authenticate, and
a stale lockout record left by an older build is deleted on startup/sign-in
so an upgrade frees anyone who was mid-lockout.

## Key decisions

**Version** — `5.1.9` in `package.json` and `src/config/app.config.ts` (the service worker cache revision is derived from the built assets).

**Currency** — Pakistani Rupees only. Money is stored as **integer paisa** to avoid
floating-point drift and formatted through `formatMoney()` so `Rs.` is never
hard-coded in the UI. `parseMoney()` accepts `Rs. 1,250.50`, `1,250`, `PKR 300`.

**Routing** — `src/app/routes.tsx` is the single registry. Pages are lazy-loaded
and code-split; the sidebar and mobile tab bar are generated from `NAV_ITEMS`,
so navigation can never drift out of sync with the router. The eight sections
are POS (`/`), Sales (`/sales`), Customers (`/customers`), Menu (`/menu`),
Deals (`/deals`), Inventory (`/inventory`), Admin (`/admin`) and Delivery
Management (`/deliveries`).

**Storage** — IndexedDB is the system of record, ready for offline-first. Every
record carries `createdAt` / `updatedAt` / `deletedAt` / `rev`, deletes are soft
by default, and an `outbox` store is already provisioned to queue mutations for a
future sync engine. New domains need one entry in `STORE_SCHEMAS` plus one line
in the repository registry.

**Styling** — The Light Clean & Fresh theme: white cards on a subtle
mint-tinted off-white background (`#F7FAF8`), deep restaurant green
(`#176B4D`) for primary actions, and a soft mint accent (`#E4F4EC`). All
colour, spacing, type, radius, elevation, z-index and layout values live in
`src/styles/tokens.css`; components use CSS Modules and reference tokens only.

**Motion** — Short, purposeful transitions: a 320ms page fade-and-rise, a
growing bar on the active nav item, hover/focus fades on every control, and a
scale-down on button press. All of it collapses under
`prefers-reduced-motion: reduce`.

**Responsive** — Desktop (≥1024px) full sidebar with labels · Tablet
(640–1023px) compact icon rail · Mobile (<640px) horizontally scrollable bottom
tab bar carrying all eight sections. Touch targets are 44px minimum, inputs use
16px text to avoid iOS zoom-on-focus, and safe-area insets are respected.

**PWA** — Manifest, icons (incl. maskable), theme colour and an app-shell service
worker are in place. The worker is registered in production builds only so dev
hot reload is unaffected.

**No chrome** — A slim header exists only to host the notification centre and the
configured restaurant name; there is no footer, marketing section or promotional
content. Each screen renders its own `PageHeader`, and the offline banner appears
only when the connection drops. All sections remain reachable from the
horizontally scrollable mobile tab bar, so there is no hamburger menu or drawer.

**No invented data** — Every section is a professional empty state. The only
figures shown anywhere are genuine runtime facts on the Admin screen (version,
currency, locale, database name/version, storage availability, connection).

## v3.1.0 verification

Checks run for this change:

- `npm ci`, `npm run typecheck`, `npm run build` and `npm test` passed. The
  build still reports the existing Vite mixed static/dynamic-import warnings
  for sync/settings modules.
- `scripts/test-indexeddb.mjs` runs the real database and backup services
  against isolated in-memory IndexedDB, checking the 14-store snapshot,
  relationships, preview/exclusions, merge, monotonic order sequence, unique
  conflict preflight, device-local data preservation and transaction rollback.
- `scripts/test-data-port.mjs` additionally runs the backup core against an
  isolated in-memory transactional adapter: 23 business records across 14
  stores, IDs/relationships, logo and settings, merge/re-import, order sequence,
  conflict rollback, invalid-version rejection and v1 compatibility.
- `scripts/test-receipts.mjs` checks the authored 58mm/80mm typography/logo/
  wrapping CSS rules, content-height measurement, explicit browser `@page`
  dimensions, long printer-text wrapping, totals, kitchen privacy/content,
  compact ESC/POS streams/cut bytes, and bounded proportional logo raster
  dimensions with mocked canvas/image APIs. These are code-level checks, not a
  rendered browser print preview.
- A real browser/print-to-PDF run could not be completed: no browser binary is
  installed, and the isolated Chromium download failed because the network
  connection reset. No physical thermal printer is available either. The
  tests above validate the pipeline's measurable rules/bytes, not printed
  paper output. The import UI itself is not browser-driven in this environment.

## Archived baseline verification

The following browser and performance checks are historical records for the
pre-3.1.0 baseline; they do not claim browser verification of the new delivery
workflow or physical-printer verification of the receipt changes.

Checked in a real headless browser at 1440x900, 834x1112 and 390x844:

- `npm run build` — passes, zero TypeScript errors (strict, `noUncheckedIndexedAccess`).
- All routes render with no console errors, page errors or horizontal overflow.
- Sidebar/rail/tab-bar appear at the correct breakpoints; exactly one nav item
  is marked active per route.
- Navigation, the empty-state CTA, hover states, and input focus rings all work.
- Mobile tab targets are ≥44px tall.
- **All text meets WCAG AA contrast (4.5:1)** on every surface in the palette.

Authentication (39 automated browser assertions):

- Correct login, incorrect password, unknown username, and empty submit.
- Logout from both the sidebar and the Admin screen, on desktop and mobile.
- All four routes redirect to `/login` when unauthenticated, and remain blocked
  after logout.
- Refresh, hard reload on a deep route, and re-visiting `/login` while signed in.
- Redirect back to the originally requested route after signing in.
- Lockout after repeated failures, including refusing the correct password while locked.
- No plaintext password in the DOM, in localStorage, or in IndexedDB.
- Credential changes: wrong current password and too-short passwords rejected;
  username and password changes apply and invalidate the old password.

Local database (27 persistence assertions + 6 migration assertions, run against
a persistent on-disk browser profile so the browser is genuinely restarted):

- Database opens at v2 with all 12 stores, each keyed by a stable `id`.
- Database starts empty: zero records in every business store, and the admin
  store is empty until the first sign-in creates exactly one account.
- A record written to every one of the 12 stores survives a **full browser
  restart**, not just a refresh — values, nested objects and `createdAt` intact.
- `update()` preserves `createdAt`, advances `updatedAt`, increments `rev`,
  and the change survives a reload.
- Unique indexes enforced (duplicate order number rejected); index lookups
  return linked rows; multi-store transactions commit atomically.
- Soft delete hides a row from `list()` while retaining it for sync.
- A genuine v1 database upgrades to v2 automatically, drops the retired
  `products`/`categories`/`outbox` stores, and preserves pre-existing data.
- Reset clears business data while preserving the admin account.

Restaurant profile (54 assertions, persistent on-disk browser profile):

- All seven fields start empty on a fresh install; no restaurant record exists
  until the first save; the rendered form contains no fake name, phone,
  address or email.
- Name is required and an invalid email is rejected; nothing is persisted while
  the form is invalid.
- A 138 KB test image was stored at 34.8 KB as WebP; a 900px image was
  downscaled to 512px with its alpha channel intact; an SVG stayed vector.
- Every field, including the logo, reloads correctly after a **full browser
  restart**, and again after a second restart.
- Editing updates the single record in place (no duplicate), preserves
  `createdAt`, advances `updatedAt` and increments `rev`.
- Discard reverts to the last saved values; removing the logo persists as null
  without disturbing the other fields.
- No horizontal overflow at 1440px, 834px or 390px; all text meets WCAG AA.

Menu management (69 assertions, persistent on-disk browser profile):

- Fresh install shows "No menu items yet" with an "Add Item" action and zero
  item/price rows in the database; the add form's fields are all empty and
  contain no example product name or price.
- Name is required; nothing is saved while invalid; the price field rejects
  letters and accepts two decimals.
- Prices round-trip as integer paisa (250.50 -> 25050) and render as "Rs. ...".
- A 120 KB photo was stored at 28.5 KB as WebP, downscaled to 400px.
- Items, prices and images survive a **full browser restart**, twice.
- Editing loads the real saved values, updates in place without duplicating,
  preserves `createdAt`, and clearing a size deletes just that price row.
- Disabling hides an item from the POS while keeping it in Menu; re-enabling
  restores it. Deleting asks for confirmation, can be cancelled, and leaves no
  orphaned price rows.
- New and changed items appear in the POS immediately, with no reload.
- The availability switch is keyboard focusable and togglable with Space.
- No horizontal overflow at 1440 / 834 / 390 px; all five nav sections
  reachable; WCAG AA across every new screen and state.

Inventory management (58 assertions + 6 migration assertions):

- Fresh install is completely empty: zero stock rows, "No inventory items yet",
  and the add form shows a blank quantity rather than a fabricated 0.
- Name and quantity are required; negative values and letters are blocked;
  nothing is written while the form is invalid.
- Standalone and menu-linked lines both save, with unit, SKU and low-stock
  alert, and survive **two full browser restarts**.
- The quantity stepper persists increases and decreases and is keyboard
  operable.
- Mark out of stock asks for confirmation, zeroes the quantity, remembers the
  previous figure, and **Restore** brings back exactly that figure.
- Turning availability off withholds the item without touching its quantity.
- A linked item that is out of stock or unavailable disappears from the POS and
  returns when restored.
- Delete asks for confirmation and can be cancelled.
- A genuine v2 database upgrades to v3, gains the new index, and keeps its
  existing rows intact.
- No horizontal overflow at 1440 / 834 / 390 px; WCAG AA across every state.

POS billing (71 assertions, persistent on-disk browser profile):

- Totals verified directly against the calculator: exact paisa sums, exclusive
  tax added on top, inclusive tax extracted with the total unchanged, integer
  rounding, and zero for an empty cart.
- Select item, select size, add to cart; same item+size stacks into one line
  while a different size becomes its own line; multiple products at once.
- Quantity increment/decrement update totals; stepping to zero removes the
  line; remove and Clear work; Complete is disabled on an empty cart.
- A four-unit, two-product order completed to `Rs. 900.50` and persisted with
  correct subtotal, quantities and line totals across `orders`, `orderItems`
  and `sales`.
- Order IDs are unique and order numbers are sequential (`0001`, `0002`, ...),
  continuing correctly after a **full browser restart**.
- A 16% tax rate set in Admin produced `Rs. 400 + Rs. 64 = Rs. 464` and
  persisted exactly.
- Completing an order deducted linked stock (5 -> 3 -> 0), auto-marked the line
  out of stock, and removed the item from the POS.
- An order was completed with the browser **forced offline** and persisted.
- Prices render only as `Rs.`; no other currency symbol appears anywhere.
- Keyboard operable end to end; WCAG AA on every state; no overflow at
  1440 / 834 / 390 px.

Deals (84 assertions + 7 migration assertions, persistent browser profile):

- Pricing verified directly: items total from live menu prices, fixed price
  used as-is, percentage applied and rounded to integer paisa, savings
  computed, and a deal containing an unpriced size flagged not sellable.
- Fresh install has zero deals; the create form is entirely empty with no
  example name, price, product or image, and defaults to unpublished.
- Name, at least one product, and a price/percentage are all required;
  nothing is written while invalid.
- Create: two products totalling `Rs. 570` bundled at `Rs. 500`, live preview
  showing `Customer saves Rs. 70`, persisted as 50000 paisa.
- Publish: the deal appears in the POS with its price, original total struck
  through, and the saving. Unpublish removes it from the POS while keeping it
  saved.
- Add to order: a published deal added to the cart at its deal price, stacked
  on repeat, mixed with a normal item (`Rs. 1,080`), and completed — recorded
  as its own order line carrying `dealId` rather than `menuItemId`.
- Edit: switching fixed -> 25% recalculated to `Rs. 427.50`, cleared the stale
  fixed price, preserved `createdAt` and incremented `rev`, with no duplicate.
- Delete: confirmation required and cancellable; deleting a deal leaves past
  order lines intact.
- Everything survived two **full browser restarts**.
- A genuine v3 database upgraded to v4, dropped the stale `by_isActive` index,
  created `by_isPublished`, and preserved its existing deal.
- Keyboard operable (publish switch and deal tiles); WCAG AA on eight states;
  no overflow at 1440 / 834 / 390 px.

Receipts (137 assertions, driven through the real POS UI on both widths):

- Every required field renders: restaurant name, address, phone, email,
  receipt info, order ID, date, time, item, size, quantity, unit price,
  subtotal, deal savings, total and footer. Currency is `Rs.` only.
- Optional fields are omitted cleanly when unconfigured, with no blank gaps.
- Scenarios covered at **both 58mm and 80mm**: 1 item, 5 items, 12 items,
  very long item names (67-character single word), multiple sizes of one
  product, large quantities, deals, and a 74-character restaurant name with a
  logo and a long footer.
- For every scenario the suite asserts: the sheet is exactly 58mm/80mm, the
  content does not overflow it, **no element renders outside the paper**, no
  element clips its own text, the page never scrolls sideways, the TOTAL is
  present, all item lines are rendered, and there is no excess trailing space.
- Deal lines are flagged `DEAL`, itemised with their contents, and their
  savings are shown and totalled.
- The width toggle switches live, is keyboard operable, exposes `aria-pressed`,
  and persists as the default.
- Print media hides the app chrome and leaves the receipt visible.
- WCAG AA on the receipt view; no overflow at 1440 / 834 / 390 px.

Thermal printing (Step 11):

- ESC/POS encoder unit-tested: 32/48 column widths, word wrap, hard-splitting
  of over-long words with nothing lost, two-column lines padded to exactly the
  paper width with the amount preserved when the label is too long, ASCII byte
  values, and non-ASCII transliteration.
- Byte stream structure verified: starts with `ESC @`, uses bold and centre
  alignment, ends with feed + partial cut.
- **Real PDFs generated through the browser print path** for short, long
  (15 items), long-product-name, multi-size and deal receipts at both widths,
  then inspected with pypdf: every page is exactly 58mm (163.9pt) or 80mm
  (227pt) wide, single page, no blank pages, TOTAL present, and no text
  extending beyond the paper.
- Printer panel reports WebUSB / Web Serial / secure-context availability
  honestly, disables sending with no printer connected, and fails loudly
  rather than silently when asked to print without a connection.
- WCAG AA on the receipt view, printer panel and output preview; print
  controls are excluded from the printed page.

A real defect was found and fixed during this phase: `@page { size: 58mm auto }`
was silently dropped by the browser, so every print job used a Letter sheet.
Confirmed via the CSSOM and fixed by emitting two explicit lengths.

Sales analytics (44 assertions):

- With no sales: today/week/month totals and order counts are all 0, the
  average is 0 rather than NaN, the week chart still renders 7 days, and the
  page shows an empty state instead of zeroed cards.
- Period arithmetic verified against deliberately seeded records spanning
  today, the week start, the day before the week start, the month start and
  the day before it: each period sums exactly the rows inside its bounds and
  excludes the rest.
- Week boundaries verified directly: a Wednesday and the following Sunday both
  resolve to the same Monday, and the next Monday starts a new week.
- Refunded sales are excluded from totals and counts.
- Rendered figures match the service exactly, in `Rs.` only.
- Completing a real order raises today's total by exactly the order total and
  the count by one, live.
- WCAG AA with data and empty; no overflow at 1440 / 834 / 390 px.

Admin panel (54 assertions):

- All nine sections present, exactly nine, with no extra header/footer chrome.
- Dashboard shows real figures (Rs. 0 on an empty install, never invented).
- Menu/Inventory/Deals sections link out rather than duplicating their UI.
- Printer: both widths offered with their column counts; the selection
  persists to the database and survives a **full browser restart**.
- License: starts unlicensed, states plainly that it is not verified, and a
  saved key persists across a restart.
- Settings: prefix, low stock default and receipt behaviour all persist across
  a restart **and are verified to take effect** - a completed order was
  numbered `A-0001`, the receipt step was skipped when turned off and returned
  when turned on, and the inventory form pre-filled the configured level.
- Security: wrong current password, mismatched confirmation and too-short
  passwords are all rejected with nothing written; changing both username and
  password succeeded, the **old credentials then failed and the new ones
  signed in**, and the fields were cleared after saving.
- Arrow-key navigation between sections; WCAG AA on all nine; no overflow at
  1440 / 834 / 390 px.

Licence system (48 assertions):

- Initial state is **NOT ACTIVATED**; the UI states the validation method,
  that no licence server is configured, the offline policy, and that a
  client-side check is not secure server-side licensing.
- Invalid flows all rejected with specific messages and **no state written**:
  gibberish, a key signed by a different private key (forged), a tampered
  genuine key, a genuinely-signed but expired key, and an unsupported version.
- A valid key activates, showing licence ID, holder, plan, dates and method,
  with the key **masked** rather than printed in full.
- Activation survives a **full browser restart**, twice.
- Stays ACTIVATED while offline, and an offline re-verify does not deactivate.
- A stored key corrupted directly in the database is caught on re-verify and
  marked INVALID; reactivating with the genuine key restores it.
- Deactivation requires confirmation, is cancellable, and clears the key and
  all licence details.
- Validator unit checks map each failure to the right reason code.
- WCAG AA in both states; no overflow at 1440 / 834 / 390 px.

Offline-first (46 assertions, network requests hard-aborted):

- Verified with the context offline **and** a route handler aborting every
  request, so any hidden network dependency fails loudly. 12 blocked attempts
  were recorded; none were required.
- Offline: the application opens, login works, and POS, Menu, Inventory,
  Deals, Sales and Admin all load - including routes never opened while
  online.
- Offline: menu, inventory, deals, restaurant settings, printer settings and
  an ACTIVATED licence are all available.
- Offline: an order with items and a deal totalled `Rs. 2,530`, completed and
  saved, produced a receipt at both 58mm and 80mm, and generated 930 bytes of
  ESC/POS output.
- **The application was then closed and reopened, still offline:** the order
  existed, sales showed `Rs. 2,530` from 1 order, stock had been deducted
  20 -> 18, and menu, inventory and deals were all intact.
- A second offline order saved with a unique number and the daily total
  accumulated correctly.
- Back online, both offline orders and their totals were still present.

Synchronisation (41 assertions, against a real mock backend):

- A mock server (`scripts/mock-sync-server.mjs`, test-only) implements the
  documented contract with fault injection, so sync is proven end to end
  rather than assumed.
- Offline: status reads **Offline**, three orders saved locally, six changes
  queued, and **no orders reached the backend**.
- Reconnect: the queue drained, status became **Synced**, all three orders
  arrived with matching totals, items and sale records, and **no duplicates**.
- **Duplicate protection:** the server was made to commit and then drop the
  response. The client retried; the order count went 3 -> 4 and stayed at 4.
- **Retry/error:** a 500 surfaced as **Sync error** with the item retained and
  a Retry action; **an order was completed normally during the error**; the
  queue then drained fully with nothing lost.
- **Conflicts:** a server-won conflict was applied locally so config
  converged, while order records were untouched.
- **Bulk:** five offline orders synced with five unique ids and an empty queue.
- With sync disabled the indicator renders nothing and no errors occur.

Two real bugs were found and fixed during this phase: applying a server
conflict re-enqueued the change and looped sync forever, and the status
indicator reported `pending: 0` while work was actually queued.

PWA installation (45 assertions):

- Manifest valid and fetchable with name, short_name, standalone display,
  start_url, scope, theme and background colours, 192/512 icons, **maskable
  icons at both sizes**, and three app shortcuts. Every icon and every
  shortcut target was fetched and confirmed to resolve.
- Service worker active, one cache version, whole build precached.
- **Honesty rule verified**: no install button is rendered unless the browser
  reports it can prompt, and the reason is explained when it cannot.
- Simulated iOS Safari is reported as `MANUAL INSTALL`, given the real Share
  steps, and shown **no** install button.
- Standalone: detected correctly, app renders, boot placeholder removed, and
  installService reports `installed`.
- **Offline relaunch**: the app bootstrapped, the previous order and sales
  total survived, the menu remained available, and **a new order was
  completed** - all with the network hard-aborted.
- No horizontal overflow at 1440 / 834 / 390 px in standalone; WCAG AA across
  every Admin section.

**Environment limitation, stated plainly:** the headless Chromium available
here never fires `beforeinstallprompt` - I verified this by serving a
textbook-minimal reference PWA alongside the POS and confirming *neither*
triggers it. The install prompt itself therefore could not be exercised
end-to-end; everything it depends on was verified instead. Chromium's `--app`
flag also yields `about:blank` in this build, so standalone was simulated
through the same display-mode query the application reads.

Settings, privacy and branding (50 assertions):

- Application information shows Version `5.1.9`, `Pakistani Rupees (Rs.)`,
  `PKR`, locale, time zone, local storage and provider.
- Privacy Policy renders with 10 correctly numbered sections covering what is
  stored, the absence of analytics, when data leaves the device, PBKDF2
  password hashing, retention and deletion, and contact.
- Terms & Regulations renders with 13 correctly numbered sections covering the
  licence, activation, operator responsibilities, tax and records, local
  storage risk, printing caveats, warranty disclaimer, liability limitation
  and governing law.
- Policy claims were checked against the running application: sync really is
  disabled by default, and a local database really is in use.
- **Branding containment verified**: the vendor name appears nowhere on POS,
  Sales, Menu, Deals, Inventory or the login screen, and a printed receipt
  shows the restaurant's name rather than the vendor's.
- Settings cross-links to About; WCAG AA on all three views; no overflow at
  1440 / 834 / 390 px.

Security and data-integrity audit (Step 19):

**12 issues found and fixed.**

| Severity | Issue | Fix |
| --- | --- | --- |
| HIGH | Admin password shipped in the JS bundle | Random one-time setup password; no secret in the build |
| HIGH | Forged `localStorage` session granted admin access | Session token bound to a hash on the account record |
| HIGH | Negative price accepted -> negative order total | `assertPaisa` rejects at the service boundary |
| HIGH | Negative quantity accepted -> negative total | `assertQuantity` requires >= 1 |
| HIGH | Float price produced non-integer paisa | Rounded to integer paisa |
| HIGH | `NaN` price accepted -> order total `NaN` | Rejected; aggregation also made defensive |
| HIGH | One bad order made the day's sales total `null` | Non-finite values treated as zero when summing |
| HIGH | `NaN` stock quantity persisted | `clampStock` converts to 0 |
| HIGH | `NaN` menu price persisted | `sanitisePrice` converts to `null` |
| MED | Zero-quantity line accepted | Rejected |
| MED | `Infinity` price accepted | Rejected |
| MED | Absurd quantity (1e9) accepted | Bounded |

Verified after the fixes: forged, expired and wrong-user sessions are all
rejected; repeated wrong passwords are always rejected but retryable
immediately (the one-minute lockout was later removed as a client-side timer
with no real protective value — see Authentication); junk, empty and
unsigned licence keys are rejected; admin credentials are stored as
PBKDF2-SHA256 with a 150,000-iteration salt and no plaintext; queued sync
payloads carry no password, salt, session token or licence key; and every
destructive action confirms.

Usability was explicitly checked - a normal order still completes in ~0.6s and
all form validation behaves as before.

UI and performance audit (Step 20):

Measured before changing anything, then re-measured after. Six issues found
and fixed:

| Area | Issue | Fix |
| --- | --- | --- |
| Motion | Sales chart animated `height`, forcing layout per frame | Composited `scaleY` keyframe |
| Motion | Sidebar active marker animated `height` | Composited `scaleY` from centre |
| Touch | Cart controls were 36px on touch (44px is the guideline) | Expanded hit area via pseudo-element |
| Dead code | `data/storage/localStorage.ts` unreferenced | Removed |
| Dead code | `hooks/useMediaQuery.ts` unreferenced | Removed |
| Tokens | `taupe-400` was darker than `taupe-500` after the Step 8 contrast fix | Scale reordered; rendered colours unchanged |

Verified after the fixes: 35/35 checks passed - every screen renders in under
200ms with a realistic dataset, an order completes in 541ms, zero dropped
frames, no layout-thrashing transitions remain, WCAG AA holds on all six
screens, and there is no horizontal overflow at 1440 / 834 / 390 px.

Confirmed already clean and left alone: 6 font sizes on one family, 4 border
radii, no fake or demo content, no unnecessary header or footer, all five
empty states have a heading and an action, validation messages are visible,
and no runtime dependency is unused (react, react-dom, react-router-dom).

v2.1.5 regression (Step 21, headless Chromium at 1440x900):

- `tsc --noEmit` — clean under strict mode with `noUncheckedIndexedAccess`.
- `npm run build` — passes; the new Customers page and hook ship as their own
  code-split chunks; service worker precaches 42 files.
- 24/24 automated browser assertions, in one run with zero console errors:
  version `2.1.5`; menu items with custom volume, XL and item discounts;
  editing keeps the custom volume; inventory lines 99/20/50; POS volume and
  XL buttons; Order A (Dine-In 10x Coke, item discount, order discount, cash
  overpay: subtotal 1000, discount -100, total 900, paid 1000, change 100);
  receipt rows including the item-discount line amount; Print Customer (1
  page), Print Kitchen (1 page, `KITCHEN`-marked) and Print Both (2 pages,
  split with the 80mm width set); stock 89 after the prints; Sales cash
  900 with the discount meta; Orders B (XL, card, 5%) / C (customer phone,
  digital) / D (underpayment blocked, exact completes); Customers records and
  stats; cash flow 900 / 237.50 / 150; cancel Order A (badge, cash to 0,
  stock back to 99, TODAY to 387.50, customer stats to 0, no Cancel button
  twice); reload persistence; offline completion deducts stock once with Print
  Both still working, stock 98 and cash 90 after; customer history shows 1
  completed + 1 cancelled; menu discount badges; all seven routes render; and
  no console errors across the whole run.
- UI reviewed screen by screen in screenshots: POS cart with item and order
  discounts, thermal receipt, menu list with `10% OFF` / `5% OFF` badges,
  Sales summary with the cash-flow table, and the post-cancellation zeroed
  state — spacing, hierarchy and states consistent with the existing design
  tokens.
