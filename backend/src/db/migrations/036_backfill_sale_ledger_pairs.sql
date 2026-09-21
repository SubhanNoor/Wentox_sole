/* ============================================================================
   036 — Backfill ledger_entries.pairs for Sale Bill / Sale Return rows

   WHY: until this fix, saleBills.service.js and saleReturns.service.js never
        passed a `pairs` value into insertLedgerEntries() for SALE_BILL/
        SALE_RETURN postings, so every such row was written with pairs = NULL.
        The Customer Khaata Ledger's "Pairs" column (frontend/src/pages/
        ReportKhaataPage.tsx) reads that column directly, so every historical
        Sale Bill/Return row showed "-" instead of the actual quantity moved.

        The document header already has the right number (sale_bills.total_pairs
        / sale_returns.total_pairs, the same rolled-up total the fixed code now
        computes going forward), so this just copies it onto both ledger legs
        of each already-posted document.

   Idempotent: WHERE pairs IS NULL means re-running touches nothing once a row
   has been backfilled, and a database with no pre-fix rows is a no-op.
   ============================================================================ */

UPDATE le
SET le.pairs = sb.total_pairs
FROM dbo.ledger_entries le
JOIN dbo.sale_bills sb ON sb.bill_id = le.source_id
WHERE le.source_type = 'SALE_BILL' AND le.pairs IS NULL;
GO

UPDATE le
SET le.pairs = sr.total_pairs
FROM dbo.ledger_entries le
JOIN dbo.sale_returns sr ON sr.return_id = le.source_id
WHERE le.source_type = 'SALE_RETURN' AND le.pairs IS NULL;
GO
