/* ============================================================================
   049 — Settle bounced cheque records that were entered again

   WHY: a cheque that bounced and was then entered AGAIN as a new receipt (same party, same cheque
   number) leaves two records for one piece of paper. The new one is the live cheque — deposited,
   endorsed or still in hand — while the old BOUNCED one kept showing in the Cheques screen's Open
   list with its full amount "unallocated" and an Issue button (CHEQUE_REENTERED refuses it, so it
   could only ever fail). The directory then showed that amount twice, and its Unallocated total
   ran ahead of CHEQUES IN HAND by exactly the stale record's amount (client, 2026-11-17: 4,315,000
   against 4,215,000, the 100,000 being cheque 10948663).

   The books were never wrong: a bounce reverses the receipt, so CHEQUES IN HAND holds nothing for
   the old record. Only its status was stale. The screen now hides such a record on its own
   (cheques.repository.js#list, `reentered`); this settles the ones already in the data, the same
   way Return to Sender would on that record — a status flip, no ledger rows.

   WHAT: every BOUNCED cheque whose party entered the same cheque number again on a LATER receipt
   that is posted and not itself returned becomes RETURNED, dated the day the later receipt was
   entered, with a reason saying why.

   GUARDED: touches only BOUNCED cheques with such a later posted record; nothing else. Safe to
   re-run (a second run finds no BOUNCED row matching) and on a database with none.
   ============================================================================ */

DECLARE @settled TABLE (cheque_id INT, receipt_id INT, returned_date DATE);

INSERT INTO @settled (cheque_id, receipt_id, returned_date)
SELECT ch.cheque_id, r.receipt_id,
       (SELECT MIN(r2.receipt_date)
          FROM dbo.cheques ch2
          JOIN dbo.receipts r2 ON r2.receipt_id = ch2.receipt_id
         WHERE r2.ba_id = r.ba_id AND r2.status = 'CONFIRMED' AND r2.receipt_id > r.receipt_id
           AND ch2.cheque_status <> 'RETURNED'
           AND LTRIM(RTRIM(ch2.cheque_no)) = LTRIM(RTRIM(ch.cheque_no)))
FROM dbo.cheques ch
JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
WHERE ch.cheque_status = 'BOUNCED'
  AND EXISTS (
        SELECT 1
          FROM dbo.cheques ch2
          JOIN dbo.receipts r2 ON r2.receipt_id = ch2.receipt_id
         WHERE r2.ba_id = r.ba_id AND r2.status = 'CONFIRMED' AND r2.receipt_id > r.receipt_id
           AND ch2.cheque_status <> 'RETURNED'
           AND LTRIM(RTRIM(ch2.cheque_no)) = LTRIM(RTRIM(ch.cheque_no)));

UPDATE ch
   SET cheque_status = 'RETURNED',
       returned_date = s.returned_date,
       return_reason = N'Entered again as a new receipt — this bounced record is settled (migration 049)',
       updated_at    = SYSUTCDATETIME()
  FROM dbo.cheques ch
  JOIN @settled s ON s.cheque_id = ch.cheque_id;

DECLARE @n INT = (SELECT COUNT(*) FROM @settled);
PRINT CONCAT('049: ', @n, ' bounced cheque record(s) that were entered again settled');
GO
