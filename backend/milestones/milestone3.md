# Milestone 3 — Purchase & Purchase Return

**Goal:** The next two sidebar TRANSACTIONS entries: Purchase and Purchase Return. Same
create/list/get/update/post/unpost shape as Milestone 2, against vendors instead of customers.

**v4.3 note:** no `due_date`/payment-overdue tracking (removed in v4.3) — only cheque-due alerts
remain (Milestone 9).

## Module 3.1 — Purchase (UC-23)
- [ ] `purchases` (ipc handler/service/repository) — create with material lines (one transaction), server-side totals
- [ ] `purchases:list` with weekly/monthly/overall/date-range + vendor filters
- [ ] `purchases:get` with lines (for edit + print)
- [ ] Update (UNPOSTED only)
- [ ] `purchases:post` and `purchases:unpost` — credit vendor, debit per schema; adds quantities to Vendor Stock (UC-30); ledger + stock writes in one transaction
- [ ] Vendor stock movement rows written alongside product stock movements

## Module 3.2 — Purchase Return (UC-24)
- [ ] `purchaseReturns` (ipc handler/service/repository) — mirror of purchases (create/list/get/update/post/unpost)
- [ ] Verify: create → post a return against an existing purchase's vendor; confirm reversing stock/ledger direction vs. Module 3.1
