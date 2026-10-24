/* ============================================================================
   045 — ledger_entries.is_internal: postings the books keep but the Cash Book does not print

   WHY: re-using a cheque that bounced all the way back to its customer first re-credits that
   customer (cheques.service.js#recreditIfBounced), then posts the real action. Both pairs carry the
   action's date, so the Cash Book printed two entries for one hand-over — endorsing two such
   cheques showed four (reported 2026-10-23). The re-credit is bookkeeping that undoes the bounce,
   not a movement anyone made that day, so it stays on the customer's and CHEQUES IN HAND's ledgers
   but is skipped by the Cash Book (per the user, 2026-10-24: "15 Oct shows the deliver to xyz
   vendor, that's it").

   Nothing is deleted or re-posted: a marker column, plus flipping it on the re-credit rows already
   written. Those rows are recognisable only by the narration recreditIfBounced has always given
   them; from here on the flag is set when the row is written, and nothing reads the narration.
   ============================================================================ */

IF COL_LENGTH('dbo.ledger_entries', 'is_internal') IS NULL
  ALTER TABLE dbo.ledger_entries ADD is_internal BIT NOT NULL
    CONSTRAINT DF_ledger_entries_is_internal DEFAULT 0;
GO

UPDATE dbo.ledger_entries
   SET is_internal = 1
 WHERE source_type IN ('RECEIPT', 'COMMISSION')
   AND narration LIKE N'Bounce reversal undone (re-credit)%'
   AND is_internal = 0;
GO
