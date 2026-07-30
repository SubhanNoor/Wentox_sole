# Milestone 3 — Purchase & Purchase Return

**Goal:** The next two sidebar TRANSACTIONS entries: Purchase and Purchase Return. Same
create/list/get/update/post/unpost shape as Milestone 2, against vendors instead of customers.

**v4.3 note:** no `due_date`/payment-overdue tracking (removed in v4.3) — only cheque-due alerts
remain (Milestone 9).

## Module 3.1 — Purchase (UC-23)
- [ ] `purchases` (routes/controller/service/repository) — create with material lines (one transaction), server-side totals
- [ ] `GET` list with weekly/monthly/overall/date-range + vendor filters
- [ ] `GET /:id` with lines (for edit + print)
- [ ] Update (UNPOSTED only)
- [ ] `POST /:id/post` and `POST /:id/unpost` — credit vendor, debit per schema; adds quantities to Vendor Stock (UC-30); ledger + stock writes in one transaction
- [ ] Vendor stock movement rows written alongside product stock movements

## Module 3.2 — Purchase Return (UC-24)
- [ ] `purchaseReturns` (routes/controller/service/repository) — mirror of purchases (create/list/get/update/post/unpost)
- [ ] Verify: create → post a return against an existing purchase's vendor; confirm reversing stock/ledger direction vs. Module 3.1
