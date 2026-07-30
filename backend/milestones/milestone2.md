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
- [ ] `saleBills` (ipc handler/service/repository) — create with items (one transaction), server-side totals (pairs = cartons × packing, line/invoice discounts, net value); `bilty_no`/`adda_id` required at creation (no dispatch-later path)
- [ ] `draftSaleBills`/`draftSaleBillItems` — dummy/unconfirmed bills that deduct stock on save and restore it on delete, no ledger entry until confirmed into a real sale bill (schema §5.6.1)
- [ ] `sale-bills:list` with weekly/monthly/overall/date-range + customer/sub-customer/bill-no filters
- [ ] `sale-bills:get` with items (for edit + print)
- [ ] Update (UNPOSTED only) — replace items, recompute totals
- [ ] `sale-bills:post` and `sale-bills:unpost` — ledger + stock writes in one transaction
- [ ] Verify: create → post → check `ledger_entries` + `stock_movements` rows; unpost removes them

## Module 2.2 — Sale Return (UC-21, UC-22)
- [ ] `saleReturns` (ipc handler/service/repository) — mirror of sale bills (create/list/get/update/post/unpost)
- [ ] `draftSaleReturns`/`draftSaleReturnItems` — mirrored draft pattern (schema §5.6.2)
- [ ] Verify: create → post a return against an existing bill's customer; confirm reversing stock/ledger direction vs. Module 2.1
