# Milestone 5 — Current Stock, Reports & Search/Bilty-Adda Updation

**Goal:** The sidebar's REPORTS section, in order: Current Stock, Reports, Search & Bilty Adda
Updation. Everything here reads from the ledger/stock tables written by Milestones 2–4; nothing
here writes financial data.

## Module 5.1 — Current Stock & Stock/Production Entry (UC-28)
- [x] `stock` (ipc handler/service/repository) — `stock:log-production` (PRODUCTION movement: input_qty + input_unit CARTONS/PAIRS, packing snapshot, qty_pairs normalized in the main process). Logging against a color that doesn't exist yet on the article auto-creates it via `productColorsService.resolveOrCreate()` (UC-28); a repeat log against the same article+color resolves to the same `variant_id` rather than creating a duplicate. Effective packing = `COALESCE(article_colors.packing, articles.packing)` used to normalize CARTONS → pairs and snapshotted onto the row regardless of which unit was typed (kept for audit even when pairs were typed directly)
- [x] `stock:adjust` — OPENING/ADJUSTMENT movements, signed qty_pairs; `input_qty`/`input_unit`/`packing` are always `NULL` on these rows (PRODUCTION-only columns per the schema's own comments) — a zero `qty_pairs` is rejected as a friendly 400 (a no-op adjustment is meaningless, though the DB itself doesn't forbid it — `CK_stock_movements_sign` leaves OPENING/ADJUSTMENT unconstrained on sign)
- [x] `stock:movements` (payload: `{ article_id }` or `{ variant_id }` — the milestone's original "product_id" phrasing meant article-level, but stock is tracked per-variant, so both granularities are supported; at least one required) — movement history, "the Product Ledger" per `article_colors.repository.js`'s own comment
- [x] `reports:stock` — current stock per variant: `SUM(qty_pairs)` across every movement type, displayed as cartons + extra pairs via effective packing (Current Stock tab) — thin pass-through from `reports.service.js` to `stock.service.js#currentStock()`, kept as its own `reports:stock` channel per the milestone's naming rather than merging the two modules
- [x] `reports:production` — production logs (PRODUCTION movements only) with daily/weekly/monthly/overall date filters (same `resolveDateRange()` convention as `saleBills.service.js`/`purchases.service.js`) + article/category/name-or-code search
- [x] Verify: production in CARTONS auto-creates a new color and normalizes correctly (5 cartons × packing 12 = 60 pairs); a second production log in PAIRS against the same color resolves to the same variant, not a duplicate; an ADJUSTMENT of -3 recorded; movement history returns all 3 rows for the article; current stock correctly shows 65 total pairs → 5 cartons + 5 extra pairs (packing 12); production report with a date range correctly excludes the ADJUSTMENT (PRODUCTION-only); invalid `input_unit` and zero-`qty_pairs` adjustment both rejected — all run live against `wentox_db`, debugger review clean

## Module 5.2 — Reports
**Deliberately deferred — not built this pass**, per explicit instruction. All 9 items below remain untouched:
- [ ] `reports:product-ledger` — per-product movement history (UC-29, UC-38)
- [ ] `reports:vendor-stock` — stock movements against vendor-supplied goods (UC-30)
- [ ] `reports:sale-analysis` — analytical sale breakdown (UC-31)
- [ ] `reports:sale-report` — sale bill listing/report (UC-32)
- [ ] `reports:vendor-report` — vendor purchase/payment summary (UC-33)
- [ ] `reports:payment-trail` — receipt/payment history per account (UC-34)
- [ ] `reports:account-ledger` — chart-account ledger (Khaata): date range, Summary / Detail / Customer views, opening balance + running balance (UC-35)
- [ ] `reports:business-ledger` — business accounts ledger: Code / Description / Main Account / City (City comes from `business_accounts.city_id` directly, not inherited from a customer) (UC-36)
- [ ] `reports:cash-book` — per-date cash summary from CASH-account ledger entries: receipts in, expenses out, opening/closing balance (UC-37)

## Module 5.3 — Search & Bilty/Adda Updation (UC-20)
- [x] `sale-bills:bilty-search` — filters: date range, customer, sub-customer, bill no (no "Without Bilty/Adda" option — every bill has both from creation); added to the existing `saleBills` module rather than a new feature, with joined customer/sub-customer/adda display names
- [x] `sale-bills:update-bilty` — update bilty_no + adda_id (allowed on POSTED bills; non-financial) — genuinely never touches `ledger_entries`/`stock_movements`/any other header field, so unlike the full `update()` it doesn't need to check (or care about) posted status at all
- [x] Verify: bilty-search by customer_id and by bill_no both return correct joined rows; `update-bilty` on an existing bill changes `bilty_no`/`adda_id` while `is_posted` is confirmed unchanged before/after; missing `bilty_no` rejected — all run live against `wentox_db`, debugger review clean
