-- "Cheque Return" page follow-up: a cheque WE wrote (CHEQUE_ISSUED) had no bounce/return path at
-- all — the schema deliberately gave it no pending state (deduct-on-write, see the expenses
-- table's own comment). This adds the same reverse-never-delete lifecycle CHEQUE_ENDORSED already
-- gets via dbo.cheques' bounced_date/returned_date/return_reason, just kept on this row instead —
-- a cheque we write still isn't a dbo.cheques row (that table is for cheques RECEIVED).
--
-- GUARDED, for the same reason as 005: database/schema.sql has since had all of this folded into
-- it, so on a FRESH database every object below already exists and the unguarded statements fail
-- ("Column name 'issued_cheque_status' in table 'dbo.expenses' is specified more than once"),
-- making a fresh install impossible. Each block is a no-op on a database that already has the
-- object, so the older already-migrated database is unaffected too.

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('dbo.expenses') AND name = 'issued_cheque_status')
  ALTER TABLE dbo.expenses ADD
    issued_cheque_status        VARCHAR(20)   NOT NULL CONSTRAINT DF_expenses_issued_cheque_status DEFAULT ('PENDING'),
    issued_cheque_bounced_date  DATE          NULL,
    issued_cheque_returned_date DATE          NULL,
    issued_cheque_return_reason NVARCHAR(500) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_expenses_issued_cheque_status')
  ALTER TABLE dbo.expenses ADD CONSTRAINT CK_expenses_issued_cheque_status CHECK (
        issued_cheque_status IN ('PENDING','BOUNCED','RETURNED'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_expenses_issued_cheque_bounced')
  ALTER TABLE dbo.expenses ADD CONSTRAINT CK_expenses_issued_cheque_bounced CHECK (
        (issued_cheque_bounced_date IS NULL     AND issued_cheque_status <> 'BOUNCED')
     OR (issued_cheque_bounced_date IS NOT NULL AND issued_cheque_status =  'BOUNCED'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_expenses_issued_cheque_returned')
  ALTER TABLE dbo.expenses ADD CONSTRAINT CK_expenses_issued_cheque_returned CHECK (
        (issued_cheque_returned_date IS NULL     AND issued_cheque_status <> 'RETURNED')
     OR (issued_cheque_returned_date IS NOT NULL AND issued_cheque_status =  'RETURNED'));
GO

-- "Cheque Return" page's issued-cheque list (mirrors IX_cheques_endorsable).
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_expenses_issued_cheque_returnable' AND object_id = OBJECT_ID('dbo.expenses'))
  CREATE INDEX IX_expenses_issued_cheque_returnable ON dbo.expenses(payment_mode, issued_cheque_status)
         WHERE payment_mode = 'CHEQUE_ISSUED' AND issued_cheque_status = 'PENDING';
GO
