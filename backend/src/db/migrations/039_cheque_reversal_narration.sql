-- Cheque reversal narrations used to name the INTERNAL allocation id ("Endorsement reversal of
-- allocation #47", "BOUNCED reversal of allocation #47"). Per the user (2026-09-30) a returned
-- cheque's ledger/cash book line must instead say which cheque it was: its number and due date.
-- cheques.service.js#chequeRef now writes "Endorsement reversal — Cheque #68795 — Due 15/10/2026"
-- for new rows; this rewrites every row stored in the old format the same way, keeping any
-- trailing " — <remarks>". NCHAR(8212) is the em dash, spelled out so file encoding can't mangle it.
-- CONVERT style 103 = dd/mm/yyyy, matching reports.service.js#dmy.
UPDATE le
-- LEFT(..., 500): the new wording is longer than the old, and narration is NVARCHAR(500) — a row
-- whose remarks already filled it would otherwise fail the whole migration on every app start.
SET le.narration = LEFT(REPLACE(
  le.narration,
  N' of allocation #' + CAST(le.source_id AS NVARCHAR(20)),
  N' ' + NCHAR(8212) + N' '
    + CASE WHEN ch.cheque_no IS NOT NULL AND ch.cheque_no <> '' THEN N'Cheque #' + ch.cheque_no ELSE N'Cheque' END
    + CASE WHEN ch.cheque_date IS NOT NULL THEN N' ' + NCHAR(8212) + N' Due ' + CONVERT(NVARCHAR(10), ch.cheque_date, 103) ELSE N'' END
), 500)
FROM dbo.ledger_entries le
JOIN dbo.cheque_allocations ca ON ca.allocation_id = le.source_id
-- Same join as cheques.repository.js#findAllocationById (cheques.receipt_id is NOT NULL), not via
-- receipts.cheque_id, which is only linked in app code and could be NULL on an old row.
JOIN dbo.cheques ch ON ch.receipt_id = ca.receipt_id
WHERE le.source_type = 'CHEQUE_ALLOCATION'
  AND le.narration LIKE N'% reversal of allocation #%';
