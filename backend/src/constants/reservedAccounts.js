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
};
