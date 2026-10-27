/* ============================================================================
   Audit: double entries left behind by the double-click / retry bugs fixed 2026-10-24
   READ-ONLY. Every statement is a SELECT — nothing here changes data. Run it in SSMS against the
   live database and review each result set; any correction is a separate, deliberate step.

   An empty result set means that problem never happened in this data.
   ============================================================================ */

-- 1. A receipt POSTED twice: more than one original "Receipt #N" pair (RECEIPT rows only — a
--    commission has its own COMMISSION pair). Expected: exactly 2 rows per receipt.
SELECT 'receipt posted twice' AS problem, le.source_id AS receipt_id, COUNT(*) AS original_rows
FROM dbo.ledger_entries le
WHERE le.source_type = 'RECEIPT' AND le.narration = CONCAT('Receipt #', le.source_id)
GROUP BY le.source_id
HAVING COUNT(*) > 2;

-- 2. A receipt REVERSED twice (bounce / return-to-sender run twice at once). Each re-credit
--    ("Bounce reversal undone") legitimately allows one more reversal — bounced, re-used, returned.
SELECT 'receipt reversed twice' AS problem, le.source_id AS receipt_id,
       SUM(CASE WHEN le.narration LIKE 'BOUNCED reversal of receipt #%' OR le.narration LIKE 'RETURNED reversal of receipt #%' THEN 1 ELSE 0 END) AS reversal_rows,
       SUM(CASE WHEN le.narration LIKE 'Bounce reversal undone%' THEN 1 ELSE 0 END) AS recredit_rows
FROM dbo.ledger_entries le
WHERE le.source_type = 'RECEIPT'
GROUP BY le.source_id
HAVING SUM(CASE WHEN le.narration LIKE 'BOUNCED reversal of receipt #%' OR le.narration LIKE 'RETURNED reversal of receipt #%' THEN 1 ELSE 0 END)
     > 2 + SUM(CASE WHEN le.narration LIKE 'Bounce reversal undone%' THEN 1 ELSE 0 END);

-- 3. An expense POSTED twice.
SELECT 'expense posted twice' AS problem, le.source_id AS expense_id, COUNT(*) AS original_rows
FROM dbo.ledger_entries le
WHERE le.source_type = 'EXPENSE' AND le.narration = CONCAT('Expense #', le.source_id)
GROUP BY le.source_id
HAVING COUNT(*) > 2;

-- 4. An issued cheque BOUNCED / RETURNED twice (payee credited back twice).
SELECT 'issued cheque reversed twice' AS problem, le.source_id AS expense_id, COUNT(*) AS reversal_rows
FROM dbo.ledger_entries le
WHERE le.source_type = 'EXPENSE'
  AND (le.narration LIKE 'BOUNCED reversal of expense #%' OR le.narration LIKE 'RETURNED reversal of expense #%')
GROUP BY le.source_id
HAVING COUNT(*) > 2;

-- 5. One allocation (endorsement / deposit) with more than one reversal pair.
SELECT 'allocation reversed twice' AS problem, le.source_id AS allocation_id, COUNT(*) AS reversal_rows
FROM dbo.ledger_entries le
WHERE le.source_type = 'CHEQUE_ALLOCATION' AND le.narration LIKE '%reversal%'
GROUP BY le.source_id
HAVING COUNT(*) > 2;

-- 6. A cheque handed over for more than it is worth (two endorsements/deposits at once).
SELECT 'cheque over-allocated' AS problem, ch.cheque_id, ch.cheque_no, r.receipt_id, r.amount AS cheque_amount,
       SUM(ca.amount) AS active_allocated
FROM dbo.cheque_allocations ca
JOIN dbo.receipts r ON r.receipt_id = ca.receipt_id
JOIN dbo.cheques ch ON ch.cheque_id = r.cheque_id
WHERE ca.status = 'ACTIVE'
GROUP BY ch.cheque_id, ch.cheque_no, r.receipt_id, r.amount
HAVING SUM(ca.amount) > r.amount;

-- 7. A bounced cheque re-credited more than once per bounce (should be impossible; checked anyway).
SELECT 'cheque re-credited more than bounced' AS problem, r.receipt_id,
       SUM(CASE WHEN le.narration LIKE 'Bounce reversal undone%' THEN 1 ELSE 0 END) / 2 AS recredits,
       SUM(CASE WHEN le.narration LIKE 'BOUNCED reversal of receipt #%' THEN 1 ELSE 0 END) / 2 AS full_bounces
FROM dbo.receipts r
JOIN dbo.ledger_entries le ON le.source_type = 'RECEIPT' AND le.source_id = r.receipt_id
GROUP BY r.receipt_id
HAVING SUM(CASE WHEN le.narration LIKE 'Bounce reversal undone%' THEN 1 ELSE 0 END)
     > SUM(CASE WHEN le.narration LIKE 'BOUNCED reversal of receipt #%' THEN 1 ELSE 0 END);

-- 8. Transfers, deposits and journal vouchers posted twice: more ledger rows than the document has
--    lines (a transfer and a deposit write exactly 2; a JV writes one per line).
SELECT 'transfer posted twice' AS problem, source_id AS transfer_id, COUNT(*) AS rows_written
FROM dbo.ledger_entries WHERE source_type = 'TRANSFER' GROUP BY source_id HAVING COUNT(*) > 2;

SELECT 'deposit posted twice' AS problem, source_id AS deposit_id, COUNT(*) AS rows_written
FROM dbo.ledger_entries WHERE source_type = 'DEPOSIT' GROUP BY source_id HAVING COUNT(*) > 2;

SELECT 'journal voucher posted twice' AS problem, le.source_id AS jv_id, COUNT(*) AS rows_written, l.lines
FROM dbo.ledger_entries le
JOIN (SELECT jv_id, COUNT(*) AS lines FROM dbo.journal_voucher_lines GROUP BY jv_id) l ON l.jv_id = le.source_id
WHERE le.source_type = 'JOURNAL_VOUCHER'
GROUP BY le.source_id, l.lines
HAVING COUNT(*) > l.lines;
