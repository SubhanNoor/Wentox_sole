/* ============================================================================
   038 — CHEQUES IN HAND: from its own chart head to a business account under BANKS

   WHAT: CHEQUES IN HAND was a chart account of its own (code 100004) that
         ledger_entries posted to directly via ac_id — unlike every real bank,
         which is a business account under the BANK ACCOUNTS head (100003) that
         postings reach via ba_id. Per the user (2026-09-26): "cheque in hand
         will be an account under banks — all its current ledger and future
         entries under that bank account."

   THIS MIGRATION (existing databases only):
     1. creates a CHEQUES IN HAND business account under BANK ACCOUNTS, marked
        with link_code = 'CHEQUES_IN_HAND' (the stable token code resolves it by
        — see constants/reservedAccounts.js and businessAccounts.service),
     2. repoints every ledger_entries row from the old chart account onto that
        business account (ba_id set, ac_id cleared — the table's CK_..._one
        constraint requires exactly one of the two),
     3. closes the old 100004 chart account (kept, not deleted, so its history
        and any report name-lookups still resolve).

   FRESH INSTALL: chart accounts do not exist yet at migrate() time (seed runs
   after), so the guard below skips this entirely and seed's
   ensureChequesInHandAccount() creates the business account from scratch. On an
   already-migrated database the whole block is an idempotent no-op: the business
   account already carries the link_code and no ledger row still points at 100004.
   ============================================================================ */

-- Gated on the old head still being ACTIVE — that is the "not migrated yet" signal. Once this has
-- run it is CLOSED, so a re-run (or a manual replay) skips the whole block cleanly instead of
-- re-comparing a now-emptied @netBefore against the already-moved balance. On a fresh install the
-- chart accounts do not exist at migrate() time at all, so this is likewise skipped and seed
-- creates the business account from scratch.
IF EXISTS (SELECT 1 FROM dbo.chart_of_accounts WHERE code = '100004' AND status = 'ACTIVE')
   AND EXISTS (SELECT 1 FROM dbo.chart_of_accounts WHERE code = '100003')
BEGIN
  DECLARE @oldChequesAc INT = (SELECT ac_id FROM dbo.chart_of_accounts WHERE code = '100004');
  DECLARE @bankAc       INT = (SELECT ac_id FROM dbo.chart_of_accounts WHERE code = '100003');

  -- Net balance sitting on the old chart account before the move, so we can prove it survives.
  DECLARE @netBefore DECIMAL(18,2) =
    (SELECT ISNULL(SUM(debit - credit), 0) FROM dbo.ledger_entries WHERE ac_id = @oldChequesAc);

  -- The CHEQUES IN HAND business account under BANK ACCOUNTS — resolved by its stable marker, or
  -- created with the next free serial code under BANK ACCOUNTS (exactly like a real bank account).
  DECLARE @chequesBa INT =
    (SELECT TOP 1 ba_id FROM dbo.business_accounts WHERE link_code = 'CHEQUES_IN_HAND' ORDER BY ba_id);

  IF @chequesBa IS NULL
  BEGIN
    DECLARE @serial INT =
      (SELECT ISNULL(MAX(TRY_CAST(RIGHT(code, 4) AS INT)), 0) + 1
         FROM dbo.business_accounts WHERE LEN(code) = 10 AND LEFT(code, 6) = '100003');
    DECLARE @code VARCHAR(20) = '100003' + RIGHT('0000' + CAST(@serial AS VARCHAR(10)), 4);
    INSERT INTO dbo.business_accounts (code, name, ac_id, link_code)
    VALUES (@code, N'CHEQUES IN HAND', @bankAc, 'CHEQUES_IN_HAND');
    SET @chequesBa = SCOPE_IDENTITY();
  END

  -- Repoint the historical ledger. ac_id -> NULL, ba_id -> the new account, in one statement so the
  -- exactly-one-of constraint is never momentarily violated.
  UPDATE dbo.ledger_entries
     SET ba_id = @chequesBa, ac_id = NULL
   WHERE ac_id = @oldChequesAc;

  -- Integrity guards: nothing may still point at the old head, and the moved balance must match.
  IF EXISTS (SELECT 1 FROM dbo.ledger_entries WHERE ac_id = @oldChequesAc)
    RAISERROR('038: ledger rows still reference the old CHEQUES IN HAND chart account after the move', 16, 1);

  DECLARE @netMoved DECIMAL(18,2) =
    (SELECT ISNULL(SUM(debit - credit), 0) FROM dbo.ledger_entries
      WHERE ba_id = @chequesBa AND source_type IN ('RECEIPT', 'CHEQUE_ALLOCATION'));
  -- @netMoved covers exactly the source types that ever posted to CHEQUES IN HAND; if the account
  -- was freshly created above it equals @netBefore. A mismatch means something unexpected shared
  -- the account, so fail loudly rather than leave the books silently off. (RAISERROR's %d takes
  -- only ints, so the decimals are formatted into the message string first.)
  IF @netMoved <> @netBefore
  BEGIN
    DECLARE @msg NVARCHAR(200) = CONCAT(
      '038: CHEQUES IN HAND net balance changed during the move (before ',
      CONVERT(VARCHAR(30), @netBefore), ', after ', CONVERT(VARCHAR(30), @netMoved), ')');
    RAISERROR(@msg, 16, 1);
  END

  -- Keep the old head, just close it: its rows are gone but its name still resolves for history,
  -- and a closed account can never be posted to again.
  UPDATE dbo.chart_of_accounts SET status = 'CLOSED' WHERE ac_id = @oldChequesAc;
END
GO
