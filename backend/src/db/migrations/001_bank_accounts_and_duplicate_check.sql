-- Catches up the live DB to schema.sql, which was edited directly across several passes without
-- a migration (schema.sql was already applied on 2026-08-03, so those edits never reached this
-- DB). Bundles everything: Module 4.3 (Bank Accounts) plus the earlier field-removal and
-- reactivate-instead-of-reject duplicate-check schema changes.
--
-- Every statement is guarded (IF EXISTS/IF NOT EXISTS): on an old DB predating these schema.sql
-- edits, it performs the catch-up as originally written; on a FRESH database created from the
-- current schema.sql (which already reflects every change below directly), each guard is false
-- and the statement is a safe no-op — schema.sql is the one place that defines the "final" shape,
-- this migration just reconciles anyone who applied an earlier version of it.

-- vendors: address removed (kept phone)
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.vendors') AND name = 'address')
  ALTER TABLE dbo.vendors DROP COLUMN address;

-- customers / sub_customers: phone removed (kept address)
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.customers') AND name = 'phone')
  ALTER TABLE dbo.customers DROP COLUMN phone;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.sub_customers') AND name = 'phone')
  ALTER TABLE dbo.sub_customers DROP COLUMN phone;

-- Reactivate-instead-of-reject: two vendors / two sub-customers can legitimately share a name
-- (different phone / different person) — duplicate handling moved to the service layer
-- (name+phone / name-only), so these DB-level UNIQUE(name) constraints are now wrong.
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.UQ_vendors_name'))
  ALTER TABLE dbo.vendors DROP CONSTRAINT UQ_vendors_name;
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.UQ_sub_customers_name'))
  ALTER TABLE dbo.sub_customers DROP CONSTRAINT UQ_sub_customers_name;

-- Module 4.3: bank_accounts gains account_no/branch (milestone spec fields not yet on the table);
-- UNIQUE(name) dropped for the same reason as vendors above (name+account_no is the real key).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.bank_accounts') AND name = 'account_no')
  ALTER TABLE dbo.bank_accounts ADD account_no NVARCHAR(50) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.bank_accounts') AND name = 'branch')
  ALTER TABLE dbo.bank_accounts ADD branch NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.UQ_bank_accounts_name'))
  ALTER TABLE dbo.bank_accounts DROP CONSTRAINT UQ_bank_accounts_name;

-- Module 4.3: CODES.CASH_AT_BANKS renamed to CODES.BANK_ACCOUNTS (same code, 100003) — the seed
-- script is insert-only and won't rename an already-seeded row, so do it here explicitly. A plain
-- UPDATE is naturally idempotent (no-op if already renamed, or if the row doesn't exist) — no
-- guard needed.
UPDATE dbo.chart_of_accounts SET name = 'BANK ACCOUNTS' WHERE code = '100003';
