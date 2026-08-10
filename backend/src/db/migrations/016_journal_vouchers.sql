/* ============================================================================
   016 — Journal Voucher (JV)

   WHAT: goodwill written off a party's balance — "eidi" on what a customer owes,
         a concession a vendor grants us, a compensation of any kind. The party's
         balance moves and the JOURNAL VOUCHER account carries the other side.

   NOT COMMISSION. dbo.receipts.commission (§7) is payment-time trade discount:
         it only exists attached to a receipt and only for a customer. A JV is
         standalone, needs no payment, and can name ANY business account.

   NOT A DEPOSIT either, though the shape is close. dbo.deposits (Module 4b) is a
         one-sided adjustment against the MISCELLANEOUS ADJUSTMENTS *chart*
         account, for owner capital and bank fees. A JV counters against a real
         *business* account so that "what have we given away in JVs" is an
         openable ledger, not a figure buried in a mixed adjustments head. Both
         are kept: two clearly-named tools beat one overloaded one.

   POSTS AS (see journalVouchers.service.js), both legs ba_id:
     CREDIT (the eidi case)  Dr JOURNAL VOUCHER BA / Cr party BA
                             -> what the party owes us goes DOWN
     DEBIT  (the reverse)    Dr party BA / Cr JOURNAL VOUCHER BA
                             -> what we owe the party goes DOWN
   ============================================================================ */

CREATE TABLE dbo.journal_vouchers (
  jv_id       INT IDENTITY(1,1) NOT NULL,
  jv_date     DATE          NOT NULL,
  -- The party the JV is granted to (or received from). Any business account.
  ba_id       INT           NOT NULL,
  -- CREDIT reduces what they owe us; DEBIT reduces what we owe them. Same two words
  -- dbo.deposits.direction uses, so the one concept reads the same in both places.
  direction   VARCHAR(10)   NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  -- Why it was granted ("Eid compensation", "damaged stock allowance"). Required: an
  -- unexplained write-off against a party balance is exactly the entry an auditor asks
  -- about, so it must never be blank. Mirrors dbo.deposits.source being NOT NULL.
  reason      NVARCHAR(200) NOT NULL,
  remarks     NVARCHAR(500) NULL,
  -- DRAFT by default: nothing with no ledger effect until post() should be able to
  -- arrive CONFIRMED by omission (same reasoning as dbo.settlements).
  status      VARCHAR(10)   NOT NULL CONSTRAINT DF_jv_status  DEFAULT ('DRAFT'),
  created_by  INT           NULL,
  updated_by  INT           NULL,
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_jv_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_jv_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_journal_vouchers        PRIMARY KEY (jv_id),
  CONSTRAINT FK_journal_vouchers_ba     FOREIGN KEY (ba_id)      REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_journal_vouchers_cby    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_journal_vouchers_uby    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_journal_vouchers_amount CHECK (amount > 0),
  CONSTRAINT CK_journal_vouchers_dir    CHECK (direction IN ('CREDIT','DEBIT')),
  CONSTRAINT CK_journal_vouchers_status CHECK (status IN ('CONFIRMED','DRAFT'))
);
GO

CREATE INDEX IX_journal_vouchers_date ON dbo.journal_vouchers(jv_date);
CREATE INDEX IX_journal_vouchers_ba   ON dbo.journal_vouchers(ba_id, jv_date);
GO

/* ---- ledger_entries.source_type is a closed list; open it for JOURNAL_VOUCHER ---- */
ALTER TABLE dbo.ledger_entries DROP CONSTRAINT CK_ledger_entries_src;
GO

ALTER TABLE dbo.ledger_entries ADD CONSTRAINT CK_ledger_entries_src CHECK (source_type IN
      ('SALE_BILL','SALE_RETURN','RECEIPT','COMMISSION','EXPENSE',
       'PURCHASE','PURCHASE_RETURN','CHEQUE_ALLOCATION','OPENING',
       'WAGE_RUN','SALARY_RUN',
       'TRANSFER',
       'DEPOSIT',
       'SETTLEMENT',
       -- Goodwill written off a party's balance, countered against the JOURNAL
       -- VOUCHER business account -- see dbo.journal_vouchers above.
       'JOURNAL_VOUCHER'));
GO
