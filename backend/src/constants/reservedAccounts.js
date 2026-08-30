// Reserved chart-of-accounts codes (schema.sql §8 / database_schema_v4.3.md §8). Single source of
// truth shared by db/seeds/run.js (which creates these rows) and any service that posts to one of
// them (e.g. saleBills.service.js resolving SALES) — never hardcode one of these codes elsewhere.
module.exports = {
  CUSTOMERS_ACCOUNTS: '100001',
  VENDORS_ACCOUNTS: '200001',
  CASH_IN_HAND: '100002',
  BANK_ACCOUNTS: '100003', // renamed from CASH_AT_BANKS — see cash_and_bank.md §11 item 6 (naming correction)
  SALES: '300001',
  PURCHASES: '400001',
  COMMISSION_ALLOWED: '400002',
  CHEQUES_IN_HAND: '100004',
  BUSINESS_RUNNING_EXPENSES: '400003',
  DIRECTORS_DRAWINGS: '400004',
  EMPLOYEES: '400005',
  VENDORS_SUPPLIERS: '200002',
  // Module 4.5 (payroll.md §6) — two heads per staff type: what's owed (LIABILITY) and the cost of
  // paying it (EXPENSES). WORKER_WAGES/WAGES_EXPENSE were already referenced in the frontend demo
  // seed; SALARIES_PAYABLE/SALARIES_EXPENSE are new.
  WORKER_WAGES: '220001',
  SALARIES_PAYABLE: '220002',
  WAGES_EXPENSE: '410001',
  SALARIES_EXPENSE: '410002',
  // Module 4b — counter-account for Deposit's one-sided manual credit/debit adjustments (owner
  // capital, bank fees, etc). Generic on purpose — Deposit's free-text `source` field carries the
  // specific reason, same as how PURCHASES doesn't care what was bought.
  MISC_ADJUSTMENTS: '400006',
  // Module 4c — Journal Voucher's counter-account. Unlike MISC_ADJUSTMENTS above, this one also
  // gets a single business account seeded beneath it (db/seeds/run.js), because "what have we
  // given away in JVs" has to be an openable ledger, not a figure inside a mixed adjustments head.
  JOURNAL_VOUCHER: '400007',
  // The other side of every opening balance. Before this existed, business_accounts.opening_balance
  // was a stored number that netBalance() added into a balance with NO counter-entry anywhere — so
  // the trial balance went out by the total of all opening balances (proved: one 100,000 opening
  // threw it out by exactly 100,000). Equity sits under LIABILITY here because there is no EQUITY
  // account class; what the business owes its owners is the closest existing fit.
  OPENING_BALANCE_EQUITY: '200003',
  // Journal Voucher's smart-default counter-account (post multi-line rebuild): the common case is
  // still one real party account plus a write-off, so the JV entry form auto-fills an untouched
  // second line against this account to balance the first — matching the reference screenshot's
  // own example (jv2.0.jpeg: one line credits a customer, the other debits this exact account
  // name). Unlike the old fixed-counter-account model, this is only a convenience default — the
  // user can still edit or remove that line, or add more lines, for a real multi-account journal.
  DISCOUNTS_CLAIMS_COMMISSIONS: '400008',
  // Stock Voucher's counter-account (2026-08-30 follow-up): Dr STOCK TRANSFER / Cr the
  // user-picked On Account, for the voucher's total line value — same "fixed head + one real
  // business account beneath it" shape as JOURNAL_VOUCHER above, see stockVouchers.service.js#post.
  STOCK_TRANSFER: '400009',
};
