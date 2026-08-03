# Milestone 3 — Purchase & Purchase Return

**Goal:** The next two sidebar TRANSACTIONS entries: Purchase and Purchase Return. Same
create/list/get/update/post/unpost shape as Milestone 2, against vendors instead of customers.

**v4.3 note:** no `due_date`/payment-overdue tracking (removed in v4.3) — only cheque-due alerts
remain (Milestone 9).

**Live schema amendments (post-v4.3, folded directly into `database/schema.sql`, verified against
a disposable scratch database, same pattern used for Sale Bill/Return):** `status` dropped from
`purchases`/`purchase_returns` — `is_posted` is derived from whether `ledger_entries` rows exist
for that document, same as Sale Bill/Return. `draft_purchases`/`draft_purchase_items` and
`draft_purchase_returns`/`draft_purchase_return_items` added as their own tables (per client
instruction — not a status value on the real tables), mirroring `draft_sale_bills`/
`draft_sale_returns`, **except**: saving/deleting a draft purchase (or return) has **zero** effect
on `vendor_stock_movements` — nothing physically arrives before a purchase is actually recorded,
unlike Sale Bill's dispatch-before-paperwork case. There is no password guard anywhere on Purchase/
Purchase Return — per explicit client confirmation, there is no "edit a posted purchase" UI flow,
so `update()` simply blocks entirely once posted (must `unpost()` first), rather than
reversing+reapplying like Sale Bill/Return's `update()` does.

## Module 3.1 — Purchase (UC-23)
- [x] `purchases` (ipc handler/service/repository) — create with material lines (one transaction), server-side totals (`total_price = quantity × price_per_unit` per line, no packing/discount concept)
- [x] `materials` self-registration (schema §4.3) — a line supplies an existing `material_id` or a new `material_name`, auto-registered via `materials.repository.js:resolveOrCreate` inside the same transaction (case-insensitive name match, so re-typing an existing name in different casing resolves to the same row, never a duplicate)
- [x] `draftPurchases`/`draftPurchaseItems` — pure scratch rows, zero vendor-stock effect until confirmed; `confirm` behaves as create+post in one step (inserts the real purchase, posts ledger + vendor stock, deletes the draft) — schema addendum above
- [x] `purchases:list` with weekly/monthly/overall/date-range + vendor filters
- [x] `purchases:get` with lines (for edit + print)
- [x] Update (not-yet-posted only) — replace header/items, recompute totals; blocked with a clear error once posted (no password — see schema-amendments note above)
- [x] `purchases:post` and `purchases:unpost` — ledger + vendor-stock writes in one transaction; both guarded against double-post/double-unpost
- [x] Vendor stock movement rows written alongside ledger entries — purchases never touch `stock_movements` (finished-goods/pairs), only `vendor_stock_movements` (material units), per UC-23
- [x] Verify: create (auto-registering a new material, then reusing it via different-case name) → post → check `ledger_entries` (debit PURCHASES / credit vendor BA) + `vendor_stock_movements` (positive `PURCHASE`) rows; update-while-posted blocked; unpost removes the rows — verified end-to-end against a live SQL Server (`wentox_db`)

## Module 3.2 — Purchase Return (UC-24)
- [x] `purchaseReturns` (ipc handler/service/repository) — mirror of purchases (create/list/get/update/post/unpost)
- [x] `draftPurchaseReturns`/`draftPurchaseReturnItems` — mirrors `draftPurchases`, same zero-vendor-stock-effect-until-confirmed rule
- [x] Post/unpost reversed vs. purchases: debit vendor BA / credit PURCHASES chart account, negative `PURCHASE_RETURN` vendor-stock movements
- [x] Verify: create → post a return against an existing purchase's vendor; confirm reversing stock/ledger direction vs. Module 3.1 — verified end-to-end: debit vendor BA / credit PURCHASES, negative `PURCHASE_RETURN` vendor-stock row (confirmed opposite of the purchase); draft-return create/delete confirmed zero vendor-stock effect; draft-return confirm posts exactly one negative movement and deletes the draft row
