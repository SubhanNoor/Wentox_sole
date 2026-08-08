-- Module 4.2: dbo.expenses.payment_mode and dbo.draft_expenses.payment_mode are VARCHAR(10), sized
-- for the OLD single-word modes (CASH, ONLINE, CHEQUE — all <= 6 chars). When payment_mode split
-- into CHEQUE_ENDORSED (15 chars) / CHEQUE_ISSUED (13 chars) per cash_and_bank.md §6, the column
-- width was never widened to match — CK_expenses_mode/CK_draft_expenses_mode already allow these
-- longer values, but the column itself would silently truncate or (as hit live) reject the insert
-- outright with a TDS protocol error, since the driver sends the value at its declared length.
-- Widened to VARCHAR(20), matching the width already used for cheque_status elsewhere.
--
-- GUARDED (edited after this file had already been applied to the dev database, which the
-- "never edit an applied migration" rule normally forbids — but the guard makes it a no-op there,
-- so that database is unaffected, and without it a FRESH install cannot be created at all):
-- database/schema.sql has since had this width folded into it, so on a fresh database the column
-- is already VARCHAR(20) and this ALTER is redundant. It doesn't merely waste work, it FAILS:
-- schema.sql also creates the filtered index IX_expenses_issued_cheque_returnable over
-- payment_mode, and SQL Server refuses ALTER COLUMN on a column an index depends on
-- ("ALTER TABLE ALTER COLUMN payment_mode failed because one or more objects access this column").
-- Only ALTER when the column is genuinely still too narrow, i.e. on an older database.
-- max_length is in bytes for VARCHAR, so VARCHAR(10) reports 10 and VARCHAR(20) reports 20.

IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.expenses') AND name = 'payment_mode' AND max_length < 20)
  ALTER TABLE dbo.expenses ALTER COLUMN payment_mode VARCHAR(20) NOT NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.draft_expenses') AND name = 'payment_mode' AND max_length < 20)
  ALTER TABLE dbo.draft_expenses ALTER COLUMN payment_mode VARCHAR(20) NOT NULL;
