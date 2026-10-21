/* ============================================================================
   044 — A bounced cheque can be used again (deposited, endorsed, returned, bounced a second time)

   WHY: CK_cheques_bounced said bounced_date exists IF AND ONLY IF cheque_status = 'BOUNCED'. That
   made a bounce a dead end — the moment the cheque moved on to DEPOSITED / ENDORSED / etc., the
   bounce date had to be wiped. The client wants the cheque to keep showing "marked bounced" on the
   Cheques screen and in the Cheque Ledger permanently, while the cheque itself goes on being
   operated (user request, 2026-10-21). The ledger stays append-only: the bounce reversal rows stay,
   and the first later action posts a fresh re-credit (see cheques.service.js#recreditIfBounced).

   NEW RULE: a BOUNCED cheque must have a bounced_date; any other status MAY still carry one (it
   bounced earlier and was re-used). Only that one constraint changes; no data is touched.
   ============================================================================ */

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_cheques_bounced' AND parent_object_id = OBJECT_ID('dbo.cheques'))
  ALTER TABLE dbo.cheques DROP CONSTRAINT CK_cheques_bounced;
GO

ALTER TABLE dbo.cheques ADD CONSTRAINT CK_cheques_bounced CHECK (
      cheque_status <> 'BOUNCED' OR bounced_date IS NOT NULL);
GO
