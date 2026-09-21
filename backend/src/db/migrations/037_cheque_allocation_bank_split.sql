-- Lets one cheque be deposited across more than one bank. Previously dbo.cheques.bank_id was set
-- once on a cheque's first DEPOSIT allocation, and every later deposit had to match it
-- (cheques.service.js#deposit — "one cheque is never split across banks", §9.3). Client request
-- 2026-09-22 reversed that: the unallocated balance of a cheque can now be deposited into different
-- banks across separate allocations. The bank now lives per-allocation on
-- cheque_allocations.bank_id, mirroring how target_vendor_id/target_ba_id already work for the
-- other disposition types. dbo.cheques.bank_id itself is left in place (still set on the cheque's
-- first-ever deposit) purely as a "primary bank" display fallback for the common single-bank case —
-- it is no longer read by deposit()'s validation, reverseCheque()'s reversal lookup, or the Cash
-- Book's per-allocation bank column, all of which now read the allocation's own bank_id.
--
-- WITH NOCHECK on both constraints below (2026-09-22 incident): the first version of this migration
-- added them as trusted, and it broke a real client's app the very day it shipped — their
-- production data had at least one old DEPOSIT allocation whose cheque.bank_id was already NULL
-- (root cause never fully traced; not reproducible from app code alone, so assume production data
-- can always be messier than any dev/test DB), so the backfill left that row's bank_id NULL and the
-- new CK_cheque_allocations_target then failed validation against EXISTING data, which rolled the
-- whole transaction back — meaning the column/FK/backfill never landed AT ALL, while the
-- already-shipped app code unconditionally tried to write cheque_allocations.bank_id, so every
-- single cheque deposit (not just a split one) failed with "Internal error" (SQL 207, "Invalid
-- column name 'bank_id'"). WITH NOCHECK creates the constraint but skips validating rows that exist
-- BEFORE this migration runs — it still fully applies to every row inserted or updated afterward
-- (the app always sets bank_id on new deposits), so nothing here weakens the guarantee for anything
-- created via cheques.service.js from this point on.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cheque_allocations') AND name = 'bank_id')
  ALTER TABLE dbo.cheque_allocations ADD bank_id INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cheque_allocations_bank')
  ALTER TABLE dbo.cheque_allocations
    WITH NOCHECK ADD CONSTRAINT FK_cheque_allocations_bank FOREIGN KEY (bank_id) REFERENCES dbo.bank_accounts(bank_id);
GO

-- Backfill every existing DEPOSIT allocation from the cheque it belongs to — the best available
-- source for the bank any deposit went to before this migration. Rows this can't resolve (the
-- cheque itself has no bank_id either) are simply left NULL rather than blocking the migration —
-- see the incident note above.
UPDATE ca
SET ca.bank_id = ch.bank_id
FROM dbo.cheque_allocations ca
JOIN dbo.cheques ch ON ch.receipt_id = ca.receipt_id
WHERE ca.disposition_type = 'DEPOSIT' AND ca.bank_id IS NULL AND ch.bank_id IS NOT NULL;
GO

-- Widen the existing target-shape CHECK so DEPOSIT now requires its own bank_id, the same way
-- VENDOR_PAYMENT/EXPENSE_PAYMENT already require target_vendor_id/target_ba_id — but WITH NOCHECK,
-- so any pre-existing row this migration's own backfill couldn't resolve is grandfathered in
-- instead of blocking every future deposit on every other cheque in the database.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_cheque_allocations_target')
  ALTER TABLE dbo.cheque_allocations DROP CONSTRAINT CK_cheque_allocations_target;
GO

ALTER TABLE dbo.cheque_allocations WITH NOCHECK ADD CONSTRAINT CK_cheque_allocations_target CHECK (
      (disposition_type = 'DEPOSIT'         AND target_vendor_id IS NULL     AND target_ba_id IS NULL AND bank_id IS NOT NULL)
   OR (disposition_type = 'VENDOR_PAYMENT'  AND target_vendor_id IS NOT NULL AND target_ba_id IS NULL AND bank_id IS NULL)
   OR (disposition_type = 'EXPENSE_PAYMENT' AND target_vendor_id IS NULL     AND target_ba_id IS NOT NULL AND bank_id IS NULL)
);
GO
