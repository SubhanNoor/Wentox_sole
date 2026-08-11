/* ============================================================================
   019 — Backfill the ledger pair for cheques already deposited into a bank

   WHY: until 2026-08-10 cheques.service.js#deposit() wrote NO ledger row. It
        deferred to cash_and_bank.md §10's derived-balance helper
        (`balance(bank) = ... + Σ cheque DEPOSITs where the cheque's bank_id = B`),
        but that helper was never built — every balance the app shows is read
        straight out of ledger_entries. So a deposited (even CLEARED) cheque
        never reached the bank and never left CHEQUES IN HAND.

        Both figures were wrong by the same amount in opposite directions, so the
        trial balance stayed at zero throughout and never flagged it.

   deposit() now writes Dr bank BA / Cr CHEQUES IN HAND like every other money
   movement. This file gives the same treatment to deposits made BEFORE that fix.

   Scope — only ACTIVE deposit allocations:
     - REVERSED ones (bounced/returned after depositing) wrote nothing and were
       reversed against nothing, so their two errors already cancel; inserting
       one side now would CREATE an imbalance rather than fix one.
     - A cheque whose bank has no linked business account (ba_id IS NULL) has
       nowhere to post; those are left alone and reported by the SELECT below.

   Idempotent: NOT EXISTS on allocation_id means re-running inserts nothing, and
   a database that never had a pre-fix deposit is a no-op.
   ============================================================================ */

-- migrate.js runs every migration BEFORE the seeds, so on a brand-new database this reserved
-- chart account does not exist yet. That is not an error here: no chart account means no cheques
-- and no allocations, so there is nothing to backfill. Guarded rather than thrown, because
-- throwing would abort `npm run migrate` on every fresh install.
DECLARE @chequesInHandAcId INT =
  (SELECT ac_id FROM dbo.chart_of_accounts WHERE code = '100004');

IF @chequesInHandAcId IS NOT NULL
-- Both legs in one statement so a half-written pair is impossible: the row set is
-- the allocations needing a backfill, CROSS APPLYed against the two sides.
INSERT INTO dbo.ledger_entries (entry_date, ac_id, ba_id, debit, credit, source_type, source_id, narration)
-- Narration is worded EXACTLY as cheques.service.js#deposit() writes it, with no "backfilled by
-- migration 019" marker. It shows verbatim in the Narration column of the account and cheque
-- ledgers, which the client reads — and this is the same business event either way, so a note about
-- which code path happened to write the row is developer detail leaking onto a customer's statement.
-- The `applied_at` timestamp in dbo.schema_migrations is where that belongs.
SELECT ca.allocation_date, leg.ac_id, leg.ba_id, leg.debit, leg.credit,
       'CHEQUE_ALLOCATION', ca.allocation_id,
       'Cheque #' + CAST(ch.cheque_id AS VARCHAR(12)) + ' deposited into ' + b.name
FROM dbo.cheque_allocations ca
JOIN dbo.cheques ch       ON ch.receipt_id = ca.receipt_id
JOIN dbo.bank_accounts b  ON b.bank_id = ch.bank_id
CROSS APPLY (VALUES
  (CAST(NULL AS INT), b.ba_id,             ca.amount, CAST(0 AS DECIMAL(14,2))),  -- Dr the bank
  (@chequesInHandAcId, CAST(NULL AS INT),  CAST(0 AS DECIMAL(14,2)), ca.amount)   -- Cr cheques in hand
) AS leg(ac_id, ba_id, debit, credit)
WHERE ca.disposition_type = 'DEPOSIT'
  AND ca.status = 'ACTIVE'
  AND b.ba_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dbo.ledger_entries le
    WHERE le.source_type = 'CHEQUE_ALLOCATION' AND le.source_id = ca.allocation_id
  );
GO

-- Anything left unposted is a data problem, not a migration failure — a bank row with no linked
-- business account. Reported rather than thrown so the migration still completes.
SELECT 'WARNING: deposited cheque on a bank with no ledger account — not backfilled' AS note,
       ch.cheque_id, ch.cheque_no, b.bank_id, b.name AS bank_name, ca.amount
FROM dbo.cheque_allocations ca
JOIN dbo.cheques ch      ON ch.receipt_id = ca.receipt_id
JOIN dbo.bank_accounts b ON b.bank_id = ch.bank_id
WHERE ca.disposition_type = 'DEPOSIT' AND ca.status = 'ACTIVE' AND b.ba_id IS NULL;
GO
