/* ============================================================================
   015 — Direct Settlement

   WHAT: a customer who owes us pays one of OUR creditors directly, instead of
         paying us and us then paying them. Both obligations shrink; no money
         passes through our cash, bank, or cheque drawer at any point.

   WHY A NEW TABLE rather than reusing dbo.transfers, which has the identical
   shape (from_ba_id / to_ba_id / amount / CK from <> to):
   transfers means "money moved between OUR OWN accounts" and its own schema.sql
   note says "USED BY: every cash/bank balance (both sides); Cash Book" —
   cash_and_bank.md §10's balance formula includes transfers by definition. A
   settlement is the opposite: it moves an obligation between two THIRD PARTIES
   and must never touch a cash balance. Overloading dbo.transfers would mean
   auditing every consumer of source_type='TRANSFER' and hoping none was missed;
   a separate table keeps the invariant "every TRANSFER is cash" true.

   POSTS AS (see settlements.service.js):
     Dr to_ba_id     -- what we owe our creditor goes down
     Cr from_ba_id   -- what our debtor owes us goes down
   BOTH legs are ba_id. No ac_id is written at all, so no chart account —
   and therefore no CASH IN HAND, no bank account, no CHEQUES IN HAND — can be
   touched. That is a structural guarantee, not a rule someone has to remember.

   NOT the same thing as cheque endorsement (dbo.cheque_allocations, UC-27),
   which requires a physical cheque already sitting in CHEQUES IN HAND. A
   settlement needs no instrument whatsoever.
   ============================================================================ */

CREATE TABLE dbo.settlements (
  settlement_id   INT IDENTITY(1,1) NOT NULL,
  settlement_date DATE          NOT NULL,
  -- Our debtor: they owed us, and discharged it by paying our creditor. Credited.
  from_ba_id      INT           NOT NULL,
  -- Our creditor: we owed them, and they were paid by our debtor. Debited.
  to_ba_id        INT           NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  -- How the debtor paid our creditor. INFORMATION ONLY -- unlike receipts.payment_mode, this
  -- does NOT select a posting target, because a settlement never posts to cash, a bank or
  -- CHEQUES IN HAND whichever mode is chosen. It is recorded so the books can later say
  -- "Ahmed paid Al-Madina by cheque #77341290" rather than just "somehow".
  -- Nullable: the settlement is entered from the Receipts screen's Endorse option, and how the
  -- two other parties transacted is second-hand knowledge we may simply not have.
  payment_mode    VARCHAR(10)   NULL,
  cheque_no       VARCHAR(50)   NULL,
  cheque_date     DATE          NULL,
  -- The narration source. Both ledger legs also get a generated narration naming
  -- the other side, so each account's Khaata explicitly says where the money went.
  remarks         NVARCHAR(500) NULL,
  -- Defaults to DRAFT, unlike the older document tables which default CONFIRMED
  -- and rely on their service inserting 'DRAFT' explicitly. A document that has
  -- no ledger effect until post() should not be able to arrive CONFIRMED by
  -- omission; the service still passes it explicitly regardless.
  status          VARCHAR(10)   NOT NULL CONSTRAINT DF_stl_status  DEFAULT ('DRAFT'),
  created_by      INT           NULL,
  updated_by      INT           NULL,
  created_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_stl_created DEFAULT (SYSUTCDATETIME()),
  updated_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_stl_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_settlements        PRIMARY KEY (settlement_id),
  CONSTRAINT FK_settlements_from   FOREIGN KEY (from_ba_id) REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_settlements_to     FOREIGN KEY (to_ba_id)   REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_settlements_cby    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_settlements_uby    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_settlements_amount CHECK (amount > 0),
  CONSTRAINT CK_settlements_status CHECK (status IN ('CONFIRMED','DRAFT')),
  -- Settling an account against itself is a no-op that would still write two
  -- ledger rows, so it is blocked rather than tolerated (same reasoning as
  -- CK_transfers_distinct).
  CONSTRAINT CK_settlements_distinct CHECK (from_ba_id <> to_ba_id),
  CONSTRAINT CK_settlements_mode     CHECK (payment_mode IS NULL
                                            OR payment_mode IN ('CASH','CHEQUE','ONLINE')),
  -- A cheque number on a non-cheque settlement is a data-entry slip, not a nuance worth keeping.
  CONSTRAINT CK_settlements_cheque   CHECK (payment_mode = 'CHEQUE'
                                            OR (cheque_no IS NULL AND cheque_date IS NULL))
);
GO

CREATE INDEX IX_settlements_date ON dbo.settlements(settlement_date);
CREATE INDEX IX_settlements_from ON dbo.settlements(from_ba_id, settlement_date);
CREATE INDEX IX_settlements_to   ON dbo.settlements(to_ba_id, settlement_date);
GO

/* ---- ledger_entries.source_type is a closed list; open it for SETTLEMENT ---- */
ALTER TABLE dbo.ledger_entries DROP CONSTRAINT CK_ledger_entries_src;
GO

ALTER TABLE dbo.ledger_entries ADD CONSTRAINT CK_ledger_entries_src CHECK (source_type IN
      ('SALE_BILL','SALE_RETURN','RECEIPT','COMMISSION','EXPENSE',
       'PURCHASE','PURCHASE_RETURN','CHEQUE_ALLOCATION','OPENING',
       'WAGE_RUN','SALARY_RUN',
       'TRANSFER',
       'DEPOSIT',
       -- A debtor paid one of our creditors directly. Dr creditor / Cr debtor,
       -- both ba_id, no cash account involved -- see dbo.settlements above.
       'SETTLEMENT'));
GO
