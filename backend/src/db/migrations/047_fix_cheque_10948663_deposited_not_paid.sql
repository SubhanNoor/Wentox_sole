/* ============================================================================
   047 — Cheque 10948663 (DILSHAD CHAPAL HYDERABAD): it went to the bank, not to Dasti

   WHY: 046 never ran on the client. Before 1.11.0 reached them, the re-entered record (left
   showing as a cheque still in hand) was deposited into BANK ALHABIB on 04/11, so 046's guard saw an
   allocation on the re-entry and stepped aside. The user confirmed (2026-11-07) the paper cheque
   really was deposited into BANK ALHABIB and DASTI LAIN DAIN never got it — so the 23/10 payment to
   Dasti on the OLD bounced record is the false entry, and with it the re-credit that payment wrote
   (cheques.service.js#recreditIfBounced).

   WHAT, in one transaction (migrate.js wraps every file in one):
     1. delete the 23/10 "Bounce reversal undone (re-credit)" pair on the old receipt;
     2. delete the 23/10 payment to Dasti (the old receipt's one ACTIVE allocation) and its postings;
     3. the old record goes back to BOUNCED.
   The deposit into BANK ALHABIB stays. Dilshad's balance rises by 100,000 (credited once, as on
   22/09), Dasti's falls by the 100,000 they never got, CHEQUES IN HAND and BANK ALHABIB unchanged.

   GUARDED: records found by party name and cheque number, never by id, and the fix only runs if the
   data is still EXACTLY in this state — one old record (CLEARED, bounced, paid to DASTI LAIN DAIN
   as its only ACTIVE allocation, the re-credit pair balanced at its amount) and one re-entry
   (CLEARED, never bounced, deposited in full as its only ACTIVE allocation). Anything else — a
   database 046 already repaired, one without this cheque — is left untouched.
   ============================================================================ */

DECLARE @party INT = (SELECT ba_id FROM dbo.business_accounts WHERE name = N'DILSHAD CHAPAL HYDERABAD');
DECLARE @dasti INT = (SELECT ba_id FROM dbo.business_accounts WHERE name = N'DASTI LAIN DAIN');

DECLARE @old TABLE (cheque_id INT, receipt_id INT, amount DECIMAL(14,2));
DECLARE @new TABLE (cheque_id INT, receipt_id INT, amount DECIMAL(14,2));

INSERT INTO @old
SELECT ch.cheque_id, r.receipt_id, r.amount
FROM dbo.cheques ch JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
WHERE LTRIM(RTRIM(ch.cheque_no)) = '10948663' AND r.ba_id = @party AND r.status = 'CONFIRMED'
  AND ch.cheque_status = 'CLEARED' AND ch.bounced_date IS NOT NULL;

INSERT INTO @new
SELECT ch.cheque_id, r.receipt_id, r.amount
FROM dbo.cheques ch JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
WHERE LTRIM(RTRIM(ch.cheque_no)) = '10948663' AND r.ba_id = @party AND r.status = 'CONFIRMED'
  AND ch.cheque_status = 'CLEARED' AND ch.bounced_date IS NULL;

IF (SELECT COUNT(*) FROM @old) <> 1 OR (SELECT COUNT(*) FROM @new) <> 1
BEGIN
  PRINT '047: cheque 10948663 is not in the expected state on this database; nothing changed';
  RETURN;
END;

DECLARE @oldCheque INT, @oldReceipt INT, @amount DECIMAL(14,2), @newReceipt INT;
SELECT @oldCheque = cheque_id, @oldReceipt = receipt_id, @amount = amount FROM @old;
SELECT @newReceipt = receipt_id FROM @new;

DECLARE @recredit TABLE (entry_id INT, debit DECIMAL(14,2), credit DECIMAL(14,2));
INSERT INTO @recredit
SELECT entry_id, debit, credit FROM dbo.ledger_entries
WHERE source_type = 'RECEIPT' AND source_id = @oldReceipt
  AND narration LIKE N'Bounce reversal undone (re-credit)%';

-- The payment to Dasti: the old receipt's only ACTIVE allocation, the full amount to DASTI LAIN DAIN.
DECLARE @payment INT = (
  SELECT MIN(allocation_id) FROM dbo.cheque_allocations
  WHERE receipt_id = @oldReceipt AND status = 'ACTIVE' AND amount = @amount
    AND disposition_type = 'EXPENSE_PAYMENT' AND target_ba_id = @dasti AND expense_id IS NULL
  HAVING COUNT(*) = 1);

DECLARE @paymentRows TABLE (entry_id INT, debit DECIMAL(14,2), credit DECIMAL(14,2));
INSERT INTO @paymentRows
SELECT entry_id, debit, credit FROM dbo.ledger_entries
WHERE source_type = 'CHEQUE_ALLOCATION' AND source_id = @payment;

IF (SELECT COUNT(*) FROM @recredit) <> 2
   -- with a commission the re-credit also wrote COMMISSION rows, which this fix does not undo
   OR (SELECT commission FROM dbo.receipts WHERE receipt_id = @oldReceipt) <> 0
   OR (SELECT SUM(debit) FROM @recredit) <> @amount
   OR (SELECT SUM(credit) FROM @recredit) <> @amount
   OR @payment IS NULL
   OR (SELECT COUNT(*) FROM dbo.cheque_allocations WHERE receipt_id = @oldReceipt AND status = 'ACTIVE') <> 1
   OR (SELECT COUNT(*) FROM @paymentRows) <> 2
   OR (SELECT SUM(debit) FROM @paymentRows) <> @amount
   OR (SELECT SUM(credit) FROM @paymentRows) <> @amount
   -- the re-entry went to the bank in full, and nothing else
   OR (SELECT COUNT(*) FROM dbo.cheque_allocations WHERE receipt_id = @newReceipt AND status = 'ACTIVE') <> 1
   OR NOT EXISTS (SELECT 1 FROM dbo.cheque_allocations
                  WHERE receipt_id = @newReceipt AND status = 'ACTIVE' AND disposition_type = 'DEPOSIT' AND amount = @amount)
BEGIN
  PRINT '047: cheque 10948663 does not match the expected postings on this database; nothing changed';
  RETURN;
END;

DELETE FROM dbo.ledger_entries WHERE entry_id IN (SELECT entry_id FROM @recredit);
DELETE FROM dbo.ledger_entries WHERE entry_id IN (SELECT entry_id FROM @paymentRows);
DELETE FROM dbo.cheque_allocations WHERE allocation_id = @payment;

UPDATE dbo.cheques SET cheque_status = 'BOUNCED', updated_at = SYSUTCDATETIME() WHERE cheque_id = @oldCheque;

PRINT CONCAT('047: cheque 10948663 repaired (receipt ', @oldReceipt, ' back to bounced, payment ', @payment, ' to Dasti removed)');
GO
