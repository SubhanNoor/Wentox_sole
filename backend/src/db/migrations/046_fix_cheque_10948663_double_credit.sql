/* ============================================================================
   046 — Cheque 10948663 (DILSHAD CHAPAL HYDERABAD): undo the second credit

   WHY: the cheque bounced on 22/09 and was entered again as a new receipt the same day. On 23/10
   the OLD bounced record was paid to DASTI LAIN DAIN instead of the re-entry, so
   cheques.service.js#recreditIfBounced credited Dilshad a second time (+100,000), and the re-entry
   kept showing as a cheque still in hand. The user confirmed Dasti really got the cheque on 23/10
   (2026-10-27); only the re-credit is wrong. The code now refuses this (CHEQUE_REENTERED, 1.11.0);
   this migration repairs the one case already written.

   WHAT, in one transaction (migrate.js wraps every file in one):
     1. delete the 23/10 "Bounce reversal undone (re-credit)" pair on the old receipt;
     2. move the Dasti payment (the old receipt's one ACTIVE allocation) onto the re-entry, and
        relabel its two postings with the re-entry's cheque id;
     3. the re-entry becomes CLEARED (what the old record was), the old record goes back to BOUNCED.
   Dilshad's balance rises by 100,000, CHEQUES IN HAND falls by 100,000, Dasti is unchanged.

   GUARDED: the records are found by party name and cheque number, never by id, and the fix only
   runs if the data is still EXACTLY in the broken state below — one old record and one re-entry,
   the re-credit pair balanced at the cheque's amount, the payment the only ACTIVE allocation on
   the old receipt, nothing allocated on the re-entry. Anything else (already fixed, fixed by hand,
   a database without this cheque) is left untouched, so this is safe on every install.
   ============================================================================ */

DECLARE @party INT = (SELECT ba_id FROM dbo.business_accounts WHERE name = N'DILSHAD CHAPAL HYDERABAD');

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
  AND ch.cheque_status = 'PENDING' AND ch.bounced_date IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.cheque_allocations ca WHERE ca.receipt_id = r.receipt_id AND ca.status = 'ACTIVE');

IF (SELECT COUNT(*) FROM @old) <> 1 OR (SELECT COUNT(*) FROM @new) <> 1
BEGIN
  PRINT '046: cheque 10948663 is not in the broken state on this database; nothing changed';
  RETURN;
END;

DECLARE @oldCheque INT, @oldReceipt INT, @amount DECIMAL(14,2), @newCheque INT, @newReceipt INT;
SELECT @oldCheque = cheque_id, @oldReceipt = receipt_id, @amount = amount FROM @old;
SELECT @newCheque = cheque_id, @newReceipt = receipt_id FROM @new;

DECLARE @recredit TABLE (entry_id INT, debit DECIMAL(14,2), credit DECIMAL(14,2));
INSERT INTO @recredit
SELECT entry_id, debit, credit FROM dbo.ledger_entries
WHERE source_type = 'RECEIPT' AND source_id = @oldReceipt
  AND narration LIKE N'Bounce reversal undone (re-credit)%';

DECLARE @allocation INT = (
  SELECT MIN(allocation_id) FROM dbo.cheque_allocations
  WHERE receipt_id = @oldReceipt AND status = 'ACTIVE' AND amount = @amount
  HAVING COUNT(*) = 1);

IF (SELECT COUNT(*) FROM @recredit) <> 2
   OR (SELECT SUM(debit) FROM @recredit) <> @amount
   OR (SELECT SUM(credit) FROM @recredit) <> @amount
   OR @allocation IS NULL
   OR (SELECT COUNT(*) FROM dbo.cheque_allocations WHERE receipt_id = @oldReceipt AND status = 'ACTIVE') <> 1
BEGIN
  PRINT '046: cheque 10948663 does not match the expected postings on this database; nothing changed';
  RETURN;
END;

DELETE FROM dbo.ledger_entries WHERE entry_id IN (SELECT entry_id FROM @recredit);

UPDATE dbo.cheque_allocations SET receipt_id = @newReceipt, updated_at = SYSUTCDATETIME()
WHERE allocation_id = @allocation;

UPDATE dbo.ledger_entries
   SET narration = REPLACE(narration, CONCAT('Cheque #', @oldCheque, ' '), CONCAT('Cheque #', @newCheque, ' ')),
       updated_at = SYSUTCDATETIME()
 WHERE source_type = 'CHEQUE_ALLOCATION' AND source_id = @allocation;

UPDATE dbo.cheques SET cheque_status = 'CLEARED', updated_at = SYSUTCDATETIME() WHERE cheque_id = @newCheque;
UPDATE dbo.cheques SET cheque_status = 'BOUNCED', updated_at = SYSUTCDATETIME() WHERE cheque_id = @oldCheque;

PRINT CONCAT('046: cheque 10948663 repaired (receipt ', @oldReceipt, ' -> ', @newReceipt, ', allocation ', @allocation, ')');
GO
