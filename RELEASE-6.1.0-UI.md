# POS 6.1.0 — focused UI update verification

Version intentionally remains **6.1.0**. No schema migration, new backend or new
runtime dependency was added. All browser records were synthetic and isolated.

## Root cause found before the cart fix

The cart state already used unique line keys and per-line handlers. The failure
was layout: the non-shrinking payment/checkout footer consumed the bounded panel,
while the item list had `min-height:0` and a zero flex basis. Measured before the
fix, the item list was **0 px at 820×600**; at 1024×768 the second product's
controls were below the clipped list viewport. The fix gives the item region a
usable minimum height, separates lines into cards, moves detailed payment fields
into the scrollable order body, and removes the sticky mobile footer overlay.

## Executed checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` (8 suites incl. new UI/reporting suite) | PASS |
| `node scripts/verify-ui-browser.mjs` | PASS — 33 checks, no console/runtime errors |
| `node scripts/verify-v610-browser.mjs` (prior regression suite) | PASS — 23 checks, incl. 58/80 mm PDFs and cross-origin backup restore |
| Normal production `npm run build` | PASS (see final package verification) |
| Clean ZIP extract + `npm ci` + typecheck + test + build | PASS (see final package verification) |
| `git diff --check` | PASS |

## Browser coverage (33 checks)

- Separate products/sizes; independent +/-; multiple toppings/add-ons; split
  instance modifier independence; selected-line removal.
- Nine-line stress cart with a long product name at 1440×900, 1366×768,
  1024×768, 820×1180, 820×600, 390×844 and 360×640. Every row's controls were
  scroll-reachable and hit-testable; no horizontal overflow.
- Discount/tax/grand-total visibility; checkout persisted all lines and the
  entered discount; saved tax followed the existing post-discount rule.
- Reports analytics modules, period filter, real CSV download and truthful empty
  state; Sales transaction interface/receipt actions still present.
- Settings logo upload replaced the sidebar default immediately and after
  refresh; receipt used the same logo.
- Profile picture/fields saved and survived refresh; picture removal persisted.
- Unread notifications stayed unread until interaction; one click/open marked the
  target read and reduced the badge; read state survived refresh; mark-all-read
  cleared the persisted count.

## Limitations / disclosures

- No physical printer was connected. Browser PDF pagination and ESC/POS streams
  are not hardware certification.
- No client production data was accessed. The earlier production missing-sales
  incident remains outside this UI update.
- Reports product/category amounts are gross merchandise before order-level
  discount/tax; category labels come from the current menu catalogue. Historical
  tax mode is shown as unavailable when not stored, never guessed.
- Profile details live on the local admin record. Business backups intentionally
  exclude credentials/admin records, so profile details are not exported with
  business data. Username changes remain in Security (current password required).
- `npm audit --omit=dev` still reports 2 moderate React Router advisories; the
  only npm fix is a breaking Router 7 upgrade and was not forced.
