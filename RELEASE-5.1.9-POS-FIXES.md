# v5.1.9 — POS full-screen order & receipt fixes

Field report: after placing an order, the Print Receipt option could
disappear or appear "merged" in the order list. A full audit of the POS
(order placement → confirmation → print → order list → receipt dialog) in a
real Chromium found several independent defects that together explain the
report. Each is fixed at its root cause below; nothing here changes receipt
formatting, paper settings, printer integration, money math, or data shapes.

## Confirmed defects and fixes

1. **Receipt load failures silently removed printing (the main cause).**
   - A deal record from an older backup without an `items` array made
     `receiptService.build` throw `TypeError: ... reading 'map'`. The build
     is now tolerant of missing legacy fields (`deal.items ?? []`,
     `menuItem.name?.trim()`), matching guards already used in the same file.
   - Neither consumer caught build errors: the order confirmation stayed on
     its no-print summary card forever, and the order-list receipt dialog
     stayed on "Loading receipt…" forever — with an unhandled rejection.
     Both now show a clear error with a **Retry** action; the order itself
     was always saved and remains printable from Sales → Orders.
   - A failed paper-width preference read left `ReceiptView` on
     "Loading receipt…" with no toolbar at all. It now falls back to the
     default width, renders the receipt and print actions, and says so.
   - A failed order-history load in Sales showed "No orders found"; it now
     shows an error and keeps any rows already on screen.

2. **The guided tour covered the receipt dialog's print buttons.**
   The tour card used the toast layer (z 501) while dialogs are at the modal
   layer (z 400), and — worse — the receipt dialog was rendered inside the
   page, whose entry-animation transform traps fixed elements in the page's
   stacking context. At 640px the tour covered *Print Customer*, at 360px
   *Print Both*. The tour now sits at the overlay layer (301, above
   navigation, below modals), and `OrderReceiptDialog` is portaled to
   `<body>` so it is positioned against the viewport and layers correctly.

3. **Mobile (≤819px) cart lines collapsed to 0px.**
   The stacked POS grid was viewport-height, so both rows were compressed;
   the cart's line list shrank to 0px and its quantity steppers were painted
   over by the totals footer — quantities could not be viewed or changed on
   phones. The stacked layout is now content-height with page scroll, and
   the line list caps at 38vh with internal scrolling (desktop unchanged).

4. **Last controls were trapped under the fixed phone tab bar (≤639px).**
   `.page` shrank to the scrollport height while its content spilled past
   its box, so the tab-bar clearance padding on the scroll container could
   never be scrolled into: *Complete order* and the last order rows'
   *Receipt* buttons stayed under the tab bar. At ≤639px `.page` is now
   `flex: 1 0 auto`, ending at the true content end.

5. **A post-commit preference read could report a saved order as failed.**
   `PosPage.handleComplete` read the "auto-show receipt" setting after the
   sale committed; a storage failure there landed in the generic catch and
   told the cashier the order failed (inviting a duplicate). The read now
   defaults to showing the receipt on failure.

## Verified not defective (tested, unchanged)

- Rapid double-click on **Complete order** creates exactly one order
  (buttons disable during submission; stock deducts once per sale).
- Print buttons are single-flight (both disable as "Printing…" during a
  job), the isolated print document contains only the selected order's
  receipt, and printing is available again afterwards (reprint).
- The order list shows a Receipt action on every row (including page 2 and
  cancelled orders) and opens the selected order.
- Cart math: quantity steppers, discount cap, underpayment block, change.
- Confirmation and dialog print actions are visible and hit-testable at
  1440×900, 1280×800, 1024×768, 834×1112, 768×1024, 700×900, 640×900,
  480×900, 390×844, 360×640 and 844×390 with no horizontal overflow.

## Tests

- `npm run typecheck`, `npm test` (all suites), production build: pass.
- `scripts/smoke-pos.mjs` (Happy DOM): real orders end-to-end — 30 checks.
- `scripts/smoke-pos-browser.mjs` (real Chromium via `@sparticuz/chromium`):
  38 checks covering every fix above, including failure injection at the
  shared receipt-service seam and geometry/hit-testing with the tour active.
- Existing `smoke-ui.mjs` / `smoke-setup.mjs` continue to pass.

## Environment limitations

No physical printer is available in the test environment: browser printing
is verified up to the isolated print document and the print-dialog
lifecycle in headless Chromium, and ESC/POS output remains covered by
`scripts/test-receipts.mjs`. Physical printer behaviour (paper, cutter,
driver margins) still needs a once-over on real hardware after deployment.
