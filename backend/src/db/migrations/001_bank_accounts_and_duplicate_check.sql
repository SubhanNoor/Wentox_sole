-- Catches up the live DB to schema.sql, which was edited directly across several passes without
-- a migration (schema.sql was already applied on 2026-08-03, so those edits never reached this
-- DB). Bundles everything: Module 4.3 (Bank Accounts) plus the earlier field-removal and
-- reactivate-instead-of-reject duplicate-check schema changes.

-- vendors: address removed (kept phone)
ALTER TABLE dbo.vendors DROP COLUMN address;

-- customers / sub_customers: phone removed (kept address)
ALTER TABLE dbo.customers DROP COLUMN phone;
ALTER TABLE dbo.sub_customers DROP COLUMN phone;

-- Reactivate-instead-of-reject: two vendors / two sub-customers can legitimately share a name
-- (different phone / different person) — duplicate handling moved to the service layer
-- (name+phone / name-only), so these DB-level UNIQUE(name) constraints are now wrong.
ALTER TABLE dbo.vendors DROP CONSTRAINT UQ_vendors_name;
ALTER TABLE dbo.sub_customers DROP CONSTRAINT UQ_sub_customers_name;

-- Module 4.3: bank_accounts gains account_no/branch (milestone spec fields not yet on the table);
-- UNIQUE(name) dropped for the same reason as vendors above (name+account_no is the real key).
ALTER TABLE dbo.bank_accounts ADD account_no NVARCHAR(50) NULL, branch NVARCHAR(100) NULL;
ALTER TABLE dbo.bank_accounts DROP CONSTRAINT UQ_bank_accounts_name;

-- Module 4.3: CODES.CASH_AT_BANKS renamed to CODES.BANK_ACCOUNTS (same code, 100003) — the seed
-- script is insert-only and won't rename an already-seeded row, so do it here explicitly.
UPDATE dbo.chart_of_accounts SET name = 'BANK ACCOUNTS' WHERE code = '100003';
