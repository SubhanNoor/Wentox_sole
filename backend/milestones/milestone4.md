# Milestone 4 — Transactions & Posting

**Goal:** The heart of the system: sale bills, returns, receipts, expenses, and the posting engine
that writes `ledger_entries` + `stock_movements` atomically. All multi-write operations run inside
a single DB transaction (`withTransaction`).

**Posting rules** (see database_schema.md → Design Decisions):
- Post sale bill: debit customer chart account / credit SALES; negative SALE stock movements per item.
- Post sale return: reverse of bill; positive SALE_RETURN movements.
- Post receipt: debit CASH / credit customer. Post expense: debit expense head / credit CASH.
- Unpost: delete the document's ledger + stock rows (same transaction). Financial edits only while UNPOSTED.

## Module 4.1 — Sale Bills (UC-01, UC-02)
- [ ] `saleBills` (routes/controller/service/repository) — create with items (one transaction), server-side totals (pairs = cartons × packing, line/invoice discounts, net value)
- [ ] `GET` list with weekly/monthly/overall/date-range + customer/sub-customer/bill-no filters
- [ ] `GET /:id` with items (for edit + print)
- [ ] Update (UNPOSTED only) — replace items, recompute totals
- [ ] `POST /:id/post` and `POST /:id/unpost` — ledger + stock writes in one transaction

## Module 4.2 — Sale Returns (UC-03, UC-04)
- [ ] `saleReturns` (routes/controller/service/repository) — mirror of sale bills (create/list/get/update/post/unpost)

## Module 4.3 — Receipts / Jamma (UC-05)
- [ ] `receipts` (routes/controller/service/repository) CRUD + post/unpost (ledger only)
- [ ] Weekly/Monthly/Overall list filters

## Module 4.4 — Expenses / Kharch (UC-06)
- [ ] `expenses` (routes/controller/service/repository) CRUD + post/unpost (ledger only), expense head = business account
- [ ] Weekly/Monthly/Overall list filters

## Module 4.5 — Bilty/Adda Update (UC-07)
- [ ] `GET /api/sale-bills/bilty-search` — filters: date range, customer, sub-customer, bill no, radio All / Without Bilty / Without Adda / With Bilty (uses partial indexes)
- [ ] `PATCH /api/sale-bills/:id/bilty` — update bilty_no + adda_id (allowed on POSTED bills; non-financial)

## Module 4.6 — Stock & Production Entry (UC-08)
- [ ] `stock` (routes/controller/service/repository) — `POST /api/stock/production` (PRODUCTION movement: input_qty + input_unit CARTONS/PAIRS, packing snapshot, qty_pairs normalized server-side)
- [ ] `POST /api/stock/adjustments` — OPENING/ADJUSTMENT movements, signed qty
- [ ] `GET /api/stock/movements?product_id=` — movement history
