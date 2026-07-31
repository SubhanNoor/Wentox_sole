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
- Unpost: delete the document's ledger + stock rows (same transaction). Financial edits only while UNPOSTED.

## Module 2.1 — Sale Bill (UC-18, UC-19)
- [x] `saleBills` (ipc handler/service/repository) — create with items (one transaction), server-side totals (pairs = cartons × packing, line/invoice discounts, net value); `bilty_no`/`adda_id` required at creation (no dispatch-later path)
- [x] `draftSaleBills`/`draftSaleBillItems` — dummy/unconfirmed bills that deduct stock on save and restore it on delete; `confirm` behaves as create+post in one step per the real workflow (reverses the draft's stock deduction, inserts the real bill as `CONFIRMED`, posts ledger + stock, deletes the draft) — schema §5.6.1
- [x] `sale-bills:list` with weekly/monthly/overall/date-range + customer/sub-customer/bill-no filters
- [x] `sale-bills:get` with items (for edit + print)
- [x] Update (UNPOSTED only) — replace items, recompute totals; blocked with a clear error once `CONFIRMED`
- [x] `sale-bills:post` and `sale-bills:unpost` — ledger + stock writes in one transaction; both guarded against double-post/double-unpost
- [x] Verify: create → post → check `ledger_entries` + `stock_movements` rows; unpost removes them — verified with stubbed-dependency tests (no live SQL Server yet)

## Module 2.2 — Sale Return (UC-21, UC-22)
- [ ] `saleReturns` (ipc handler/service/repository) — mirror of sale bills (create/list/get/update/post/unpost)
- [ ] `draftSaleReturns`/`draftSaleReturnItems` — mirrored draft pattern (schema §5.6.2)
- [ ] Verify: create → post a return against an existing bill's customer; confirm reversing stock/ledger direction vs. Module 2.1
