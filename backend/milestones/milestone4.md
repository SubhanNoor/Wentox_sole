# Milestone 4 — Receipts (Jamma) & Expenses (Kharch)

**Goal:** The last two sidebar TRANSACTIONS entries: Receipts and Expenses, plus the cheque
lifecycle both screens can produce. Ledger-only postings (no stock movements).

**Posting rules:** Post receipt: debit CASH / credit customer. Post expense: debit expense head
(business account) / credit CASH. **Reverse-never-erase:** bounced cheques/receipts get a
reversing entry, not a deleted row (schema §6.1).

## Module 4.1 — Receipts / Jamma & Cheque Disposal (UC-25, UC-27)
- [ ] `receipts` (routes/controller/service/repository) CRUD + post/unpost (ledger only)
- [ ] `draftReceipts` — dummy/unconfirmed receipts (same draft pattern)
- [ ] `bankAccounts`/`cheques` (routes/controller/service/repository) — shared cheque lifecycle row (received → deposited/bounced/cleared), `bounced_date` drives the reversal; bounce writes a reversing ledger entry, never deletes the original (reverse-never-erase, schema §6.1)
- [ ] Weekly/Monthly/Overall list filters
- [ ] Verify: record a cheque receipt → mark bounced → confirm a reversing ledger entry exists and the original row is untouched

## Module 4.2 — Expenses / Kharch (UC-26)
- [ ] `expenses` (routes/controller/service/repository) CRUD + post/unpost (ledger only), expense head = business account
- [ ] `draftExpenses` — dummy/unconfirmed expenses (same draft pattern)
- [ ] Weekly/Monthly/Overall list filters
- [ ] Note: payment-overdue alert is dropped in v4.3 — only cheque-due alerts remain (Milestone 9)
