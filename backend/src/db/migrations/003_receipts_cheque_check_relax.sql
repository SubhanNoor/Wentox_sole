-- Module 4.1: CK_receipts_cheque as originally written requires cheque_id IS NOT NULL whenever
-- payment_mode='CHEQUE' — but SQL Server evaluates CHECK constraints per-statement, not deferred
-- to transaction commit, so the schema's OWN documented two-step insert plan ("(1) INSERT receipts
-- with cheque_id NULL, (2) INSERT cheques pointing back at it, then UPDATE receipts SET cheque_id")
-- is literally impossible to satisfy as originally written: step (1) alone violates the constraint
-- immediately. Relaxed to still forbid a non-CHEQUE receipt ever carrying a cheque_id (the bug
-- class actually worth catching at the DB level), while allowing a CHEQUE receipt's cheque_id to be
-- NULL momentarily inside the insert transaction. The "every CHEQUE receipt eventually gets a real
-- cheque_id" guarantee moves to the application layer — receipts.service.js#create() always does
-- both inserts + the link update in one withTransaction, so no CHEQUE receipt is ever left
-- unlinked once the transaction commits.

ALTER TABLE dbo.receipts DROP CONSTRAINT CK_receipts_cheque;
GO
ALTER TABLE dbo.receipts ADD CONSTRAINT CK_receipts_cheque CHECK (
      (payment_mode <> 'CHEQUE' AND cheque_id IS NULL)
   OR (payment_mode =  'CHEQUE'));
