-- Module 4.1: adds a "returned to sender" cheque disposition, distinct from a bank BOUNCE — same
-- reverse-never-delete mechanics (customer credited back, allocations reversed), but for a reason
-- that isn't a bank bounce (e.g. a due-date issue). Catches the live DB up to schema.sql, which was
-- edited directly (schema.sql is already applied — see 001_bank_accounts_and_duplicate_check.sql's
-- own note on this).
--
-- Every step guarded so this is a safe no-op on a fresh database created from the current
-- schema.sql (which already includes RETURNED directly) — see 001's header for why.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cheques') AND name = 'returned_date')
  ALTER TABLE dbo.cheques ADD returned_date DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cheques') AND name = 'return_reason')
  ALTER TABLE dbo.cheques ADD return_reason NVARCHAR(500) NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE object_id = OBJECT_ID('dbo.CK_cheques_status') AND definition NOT LIKE '%RETURNED%'
)
BEGIN
  ALTER TABLE dbo.cheques DROP CONSTRAINT CK_cheques_status;
  ALTER TABLE dbo.cheques ADD CONSTRAINT CK_cheques_status CHECK (cheque_status IN
        ('PENDING','DEPOSITED','ENDORSED','PARTIALLY_ENDORSED','CLEARED','BOUNCED','RETURNED'));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CK_cheques_returned'))
  ALTER TABLE dbo.cheques ADD CONSTRAINT CK_cheques_returned CHECK (
        (returned_date IS NULL     AND cheque_status <> 'RETURNED')
     OR (returned_date IS NOT NULL AND cheque_status =  'RETURNED'));
