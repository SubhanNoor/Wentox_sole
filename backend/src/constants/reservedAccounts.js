// Reserved chart-of-accounts codes (schema.sql §8 / database_schema_v4.3.md §8). Single source of
// truth shared by db/seeds/run.js (which creates these rows) and any service that posts to one of
// them (e.g. saleBills.service.js resolving SALES) — never hardcode one of these codes elsewhere.
module.exports = {
  CUSTOMERS_ACCOUNTS: '100001',
  VENDORS_ACCOUNTS: '200001',
  CASH_IN_HAND: '100002',
  CASH_AT_BANKS: '100003',
  SALES: '300001',
  PURCHASES: '400001',
  COMMISSION_ALLOWED: '400002',
  CHEQUES_IN_HAND: '100004',
  BUSINESS_RUNNING_EXPENSES: '400003',
  DIRECTORS_DRAWINGS: '400004',
  EMPLOYEES: '400005',
  VENDORS_SUPPLIERS: '200002',
};
