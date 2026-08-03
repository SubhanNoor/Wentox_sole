# Milestone 2 — Sale Bill & Sale Return

**Goal:** The first two entries under the sidebar's TRANSACTIONS section: Sale Bill and Sale Return,
fully working end to end (create, list, edit, post/unpost, drafts). This is the core revenue flow
and the template every later transaction screen (Purchase, Receipts, Expenses) follows.

**v4.3 note:** `store_id` is nullable but `bill_no`/`gp_no`/`bilty_no`/`adda_id` are `NOT NULL` on
sale bills and returns — the old "Without Bilty"/"Without Adda" dispatch-later workflow no longer
exists; every document has a bilty and adda from creation. All multi-write operations (bill + items,
post/unpost) run inside a single DB transaction (`withTransaction`).

**Posting rules** (see `database_schema_v4.3.md` → Design Decisions):
- Post sale bill: debit customer chart account / credit SALES; negative SALE stock movements per item.
- Post sale return: reverse of bill; positive SALE_RETURN movements.
- Unpost: delete the document's ledger + stock rows (same transaction).

**Live schema amendments (post-v4.3, folded directly into `database/schema.sql` — a fresh import
needs only that one file, verified against a disposable scratch database):** the `status` column
was dropped from `sale_bills`/`sale_returns` — "posted" is now derived from whether
`ledger_entries` rows exist for that document, not a stored flag (it never actually toggled in
practice, since Confirm creates+posts atomically and editing an already-posted document
reverses+reapplies its ledger inline). `due_date` (nullable) was re-added to `sale_bills` for an
upcoming notification feature. See `database_schema_v4.3.md`'s "Post-v4.3 amendments" note.

## Module 2.1 — Sale Bill (UC-18, UC-19)
- [x] `saleBills` (ipc handler/service/repository) — create with items (one transaction), server-side totals (pairs = cartons × packing, line/invoice discounts, net value); `bilty_no`/`adda_id` required at creation (no dispatch-later path)
- [x] `draftSaleBills`/`draftSaleBillItems` — dummy/unconfirmed bills that deduct stock on save and restore it on delete; `confirm` behaves as create+post in one step per the real workflow (reverses the draft's stock deduction, inserts the real bill as `CONFIRMED`, posts ledger + stock, deletes the draft) — schema §5.6.1
- [x] `sale-bills:list` with weekly/monthly/overall/date-range + customer/sub-customer/bill-no filters
- [x] `sale-bills:get` with items (for edit + print)
- [x] Update (UNPOSTED only) — replace items, recompute totals; blocked with a clear error once `CONFIRMED`
- [x] `sale-bills:post` and `sale-bills:unpost` — ledger + stock writes in one transaction; both guarded against double-post/double-unpost
- [x] Verify: create → post → check `ledger_entries` + `stock_movements` rows; unpost removes them — re-verified end-to-end against a live SQL Server (`wentox_db`) alongside Module 2.2, see below

## Module 2.2 — Sale Return (UC-21, UC-22)
- [x] `saleReturns` (ipc handler/service/repository) — mirror of sale bills (create/list/get/update/post/unpost); no `main_ac_id`/`delivery_type`/`delivery_address` (not on `sale_returns`)
- [x] `draftSaleReturns`/`draftSaleReturnItems` — mirrored draft pattern (schema §5.6.2), reversed sign: draft-save restores stock (positive ADJUSTMENT), draft-delete deducts it back out (negative ADJUSTMENT)
- [x] Post/unpost reversed vs. sale bills: debit SALES / credit customer BA, positive `SALE_RETURN` stock movements
- [x] Password re-verification (revised): editing an already-posted bill/return now reverses+reapplies its ledger/stock atomically inside `update()` itself (no separate visible unpost step) — `sale-bills:update`/`sale-returns:update` require `payload.password` only when the existing row is currently posted (checked via `auth:verify-password`/`authService.verifyPassword` after an IPC-layer `is_posted` lookup, before the write); editing a not-yet-posted row needs no password. `post()` always requires the password (the Confirm/Save action). `unpost()` reverted to a plain standalone action, no longer part of the edit flow, no password guard
- [x] `status` dropped from `sale_bills`/`sale_returns` (baked directly into `database/schema.sql`, per client confirmation it never actually changed value in practice) — `is_posted` is now computed at read time (`repository.isPosted`, `EXISTS` against `ledger_entries`) and attached to every `findById` result; `post`/`unpost`/`update` all branch on `is_posted` instead of a stored status string; `setStatus` removed from both repositories; draft-confirm flows no longer build a `status` field
- [x] Verify: create → post a return against an existing bill's customer; confirm reversing stock/ledger direction vs. Module 2.1 — run end-to-end against a live SQL Server (`wentox_db`): sale bill post writes debit customer BA / credit SALES with a negative `SALE` stock movement, sale return post writes debit SALES / credit customer BA with a positive `SALE_RETURN` movement (confirmed opposite of the bill); unpost on both removes the ledger/stock rows; draft-return create/delete correctly restore/deduct stock; draft-return confirm correctly reverses the draft's restoration and posts once. Password guard (`auth:verify-password` / `verifyPassword`) confirmed rejecting wrong passwords and accepting the right one.
- [x] `due_date` re-added to `sale_bills` (nullable), baked directly into `database/schema.sql` — deliberately reverses the v4.3 doc's removal of this column, per explicit client instruction, ahead of a planned payment-overdue notification feature (details TBD). Wired through `saleBills.repository.js` (`insert`, `updateHeader`) and `saleBills.service.js` (`buildBillFields`); verified live — round-trips through create (with and without a value) and update. Not added to `sale_returns` (schema note: "a return is not a payable").
- [x] Consolidated both amendments directly into `database/schema.sql` (no longer separate `src/db/migrations/*.sql` files) so a fresh install only needs to run `schema.sql` — verified by applying it alone to a disposable scratch database and confirming `sale_bills` has `due_date`/no `status` and `sale_returns` has no `status`, then dropping the scratch database. The already-migrated `wentox_db` is untouched by this (its `schema_migrations` history already reflects the same end state).
