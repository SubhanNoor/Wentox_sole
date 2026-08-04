-- Module 4.2: dbo.expenses.payment_mode and dbo.draft_expenses.payment_mode are VARCHAR(10), sized
-- for the OLD single-word modes (CASH, ONLINE, CHEQUE — all <= 6 chars). When payment_mode split
-- into CHEQUE_ENDORSED (15 chars) / CHEQUE_ISSUED (13 chars) per cash_and_bank.md §6, the column
-- width was never widened to match — CK_expenses_mode/CK_draft_expenses_mode already allow these
-- longer values, but the column itself would silently truncate or (as hit live) reject the insert
-- outright with a TDS protocol error, since the driver sends the value at its declared length.
-- Widened to VARCHAR(20), matching the width already used for cheque_status elsewhere.

ALTER TABLE dbo.expenses ALTER COLUMN payment_mode VARCHAR(20) NOT NULL;
GO
ALTER TABLE dbo.draft_expenses ALTER COLUMN payment_mode VARCHAR(20) NOT NULL;
