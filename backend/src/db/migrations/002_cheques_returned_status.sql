-- Module 4.1: adds a "returned to sender" cheque disposition, distinct from a bank BOUNCE — same
-- reverse-never-delete mechanics (customer credited back, allocations reversed), but for a reason
-- that isn't a bank bounce (e.g. a due-date issue). Catches the live DB up to schema.sql, which was
-- edited directly (schema.sql is already applied — see 001_bank_accounts_and_duplicate_check.sql's
-- own note on this).

ALTER TABLE dbo.cheques ADD returned_date DATE NULL, return_reason NVARCHAR(500) NULL;
GO

ALTER TABLE dbo.cheques DROP CONSTRAINT CK_cheques_status;
GO
ALTER TABLE dbo.cheques ADD CONSTRAINT CK_cheques_status CHECK (cheque_status IN
      ('PENDING','DEPOSITED','ENDORSED','PARTIALLY_ENDORSED','CLEARED','BOUNCED','RETURNED'));
GO

ALTER TABLE dbo.cheques ADD CONSTRAINT CK_cheques_returned CHECK (
      (returned_date IS NULL     AND cheque_status <> 'RETURNED')
   OR (returned_date IS NOT NULL AND cheque_status =  'RETURNED'));
