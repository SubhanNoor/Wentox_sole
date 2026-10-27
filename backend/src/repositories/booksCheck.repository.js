// Repository layer: SQL only — the read-only queries behind the Books Check (booksCheck.service.js).
// Every query here is a SELECT; nothing in this file writes.
const { sql, query } = require('../db/pool');

async function trialBalance() {
  const result = await query(
    'SELECT ISNULL(SUM(debit), 0) AS total_debit, ISNULL(SUM(credit), 0) AS total_credit FROM dbo.ledger_entries',
  );
  const row = result.recordset[0];
  return { debit: Number(row.total_debit), credit: Number(row.total_credit) };
}

// CHEQUES IN HAND two ways: its ledger balance, and the cheques that are actually still in hand —
// every posted cheque receipt not bounced or returned, less what has been deposited or handed on.
async function chequesInHand(chequesBaId) {
  const ledger = await query(
    'SELECT ISNULL(SUM(debit), 0) - ISNULL(SUM(credit), 0) AS net FROM dbo.ledger_entries WHERE ba_id = @baId',
    { baId: { type: sql.Int, value: chequesBaId } },
  );
  const held = await query(
    `SELECT ISNULL(SUM(r.amount - ISNULL(a.allocated, 0)), 0) AS net
     FROM dbo.receipts r
     JOIN dbo.cheques ch ON ch.cheque_id = r.cheque_id
     LEFT JOIN (SELECT receipt_id, SUM(amount) AS allocated FROM dbo.cheque_allocations
                WHERE status = 'ACTIVE' GROUP BY receipt_id) a ON a.receipt_id = r.receipt_id
     WHERE r.status = 'CONFIRMED' AND ch.cheque_status NOT IN ('BOUNCED', 'RETURNED')`,
  );
  return { ledger: Number(ledger.recordset[0].net), held: Number(held.recordset[0].net) };
}

// One paper cheque on two live records: same party, same cheque number, neither returned.
async function duplicateCheques() {
  const result = await query(
    `SELECT LTRIM(RTRIM(ch.cheque_no)) AS cheque_no, ba.name AS party, COUNT(*) AS records,
            STRING_AGG(CONCAT('receipt #', r.receipt_id, ' (', LOWER(ch.cheque_status), ', ', CAST(r.amount AS DECIMAL(14, 0)), ')'), '; ')
              WITHIN GROUP (ORDER BY r.receipt_id) AS detail
     FROM dbo.cheques ch
     JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     WHERE r.status = 'CONFIRMED' AND ch.cheque_status <> 'RETURNED'
       AND ch.cheque_no IS NOT NULL AND LTRIM(RTRIM(ch.cheque_no)) <> ''
     GROUP BY LTRIM(RTRIM(ch.cheque_no)), r.ba_id, ba.name
     HAVING COUNT(*) > 1
     ORDER BY ba.name, cheque_no`,
  );
  return result.recordset;
}

async function overAllocatedCheques() {
  const result = await query(
    `SELECT ch.cheque_no, ba.name AS party, r.receipt_id, r.amount, SUM(ca.amount) AS allocated
     FROM dbo.cheque_allocations ca
     JOIN dbo.receipts r ON r.receipt_id = ca.receipt_id
     JOIN dbo.cheques ch ON ch.cheque_id = r.cheque_id
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     WHERE ca.status = 'ACTIVE'
     GROUP BY ch.cheque_no, ba.name, r.receipt_id, r.amount
     HAVING SUM(ca.amount) > r.amount`,
  );
  return result.recordset;
}

// Documents with more ledger rows than one posting writes — what a double post or double reversal
// leaves behind. Same checks as scripts/audit-double-entries.sql, one row per document.
async function doublePostings() {
  const result = await query(
    `SELECT 'Receipt posted twice' AS problem, source_id AS doc_id FROM dbo.ledger_entries
       WHERE source_type = 'RECEIPT' AND narration = CONCAT('Receipt #', source_id)
       GROUP BY source_id HAVING COUNT(*) > 2
     UNION ALL
     -- A receipt may be reversed again each time a re-credit (cheques.service.js#recreditIfBounced)
     -- brought it back — bounced, re-used, then returned is two reversals and one re-credit. So the
     -- limit is one reversal pair per re-credit, plus one.
     SELECT 'Receipt reversed twice', source_id FROM dbo.ledger_entries
       WHERE source_type = 'RECEIPT'
       GROUP BY source_id
       HAVING SUM(CASE WHEN narration LIKE 'BOUNCED reversal of receipt #%' OR narration LIKE 'RETURNED reversal of receipt #%' THEN 1 ELSE 0 END)
            > 2 + SUM(CASE WHEN narration LIKE 'Bounce reversal undone%' THEN 1 ELSE 0 END)
     UNION ALL
     SELECT 'Expense posted twice', source_id FROM dbo.ledger_entries
       WHERE source_type = 'EXPENSE' AND narration = CONCAT('Expense #', source_id)
       GROUP BY source_id HAVING COUNT(*) > 2
     UNION ALL
     SELECT 'Issued cheque reversed twice', source_id FROM dbo.ledger_entries
       WHERE source_type = 'EXPENSE' AND (narration LIKE 'BOUNCED reversal of expense #%' OR narration LIKE 'RETURNED reversal of expense #%')
       GROUP BY source_id HAVING COUNT(*) > 2
     UNION ALL
     SELECT 'Cheque step reversed twice', source_id FROM dbo.ledger_entries
       WHERE source_type = 'CHEQUE_ALLOCATION' AND narration LIKE '%reversal%'
       GROUP BY source_id HAVING COUNT(*) > 2
     UNION ALL
     SELECT 'Transfer posted twice', source_id FROM dbo.ledger_entries
       WHERE source_type = 'TRANSFER' GROUP BY source_id HAVING COUNT(*) > 2
     UNION ALL
     SELECT 'Deposit posted twice', source_id FROM dbo.ledger_entries
       WHERE source_type = 'DEPOSIT' GROUP BY source_id HAVING COUNT(*) > 2
     UNION ALL
     SELECT 'Journal voucher posted twice', le.source_id FROM dbo.ledger_entries le
       JOIN (SELECT jv_id, COUNT(*) AS lines FROM dbo.journal_voucher_lines GROUP BY jv_id) l ON l.jv_id = le.source_id
       WHERE le.source_type = 'JOURNAL_VOUCHER' GROUP BY le.source_id, l.lines HAVING COUNT(*) > l.lines
     ORDER BY problem, doc_id`,
  );
  return result.recordset;
}

module.exports = { trialBalance, chequesInHand, duplicateCheques, overAllocatedCheques, doublePostings };
