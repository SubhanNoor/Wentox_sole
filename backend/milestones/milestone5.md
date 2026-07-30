# Milestone 5 — Current Stock, Reports & Search/Bilty-Adda Updation

**Goal:** The sidebar's REPORTS section, in order: Current Stock, Reports, Search & Bilty Adda
Updation. Everything here reads from the ledger/stock tables written by Milestones 2–4; nothing
here writes financial data.

## Module 5.1 — Current Stock & Stock/Production Entry (UC-28)
- [ ] `stock` (routes/controller/service/repository) — `POST /api/stock/production` (PRODUCTION movement: input_qty + input_unit CARTONS/PAIRS, packing snapshot, qty_pairs normalized server-side)
- [ ] `POST /api/stock/adjustments` — OPENING/ADJUSTMENT movements, signed qty
- [ ] `GET /api/stock/movements?product_id=` — movement history
- [ ] `GET /api/reports/stock` — current stock per product: `SUM(qty_pairs)`, displayed as cartons + extra pairs via packing (Current Stock tab)
- [ ] `GET /api/reports/production` — production logs (PRODUCTION movements) with daily/weekly/monthly/overall date filters + article/category search

## Module 5.2 — Reports
- [ ] `GET /api/reports/product-ledger` — per-product movement history (UC-29, UC-38)
- [ ] `GET /api/reports/vendor-stock` — stock movements against vendor-supplied goods (UC-30)
- [ ] `GET /api/reports/sale-analysis` — analytical sale breakdown (UC-31)
- [ ] `GET /api/reports/sale-report` — sale bill listing/report (UC-32)
- [ ] `GET /api/reports/vendor-report` — vendor purchase/payment summary (UC-33)
- [ ] `GET /api/reports/payment-trail` — receipt/payment history per account (UC-34)
- [ ] `GET /api/reports/account-ledger` — chart-account ledger (Khaata): date range, Summary / Detail / Customer views, opening balance + running balance (UC-35)
- [ ] `GET /api/reports/business-ledger` — business accounts ledger: Code / Description / Main Account / City (City comes from `business_accounts.city_id` directly, not inherited from a customer) (UC-36)
- [ ] `GET /api/reports/cash-book` — per-date cash summary from CASH-account ledger entries: receipts in, expenses out, opening/closing balance (UC-37)

## Module 5.3 — Search & Bilty/Adda Updation (UC-20)
- [ ] `GET /api/sale-bills/bilty-search` — filters: date range, customer, sub-customer, bill no (no "Without Bilty/Adda" option — every bill has both from creation)
- [ ] `PATCH /api/sale-bills/:id/bilty` — update bilty_no + adda_id (allowed on POSTED bills; non-financial)
