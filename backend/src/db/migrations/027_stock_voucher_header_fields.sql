/* ============================================================================
   027 — Stock Voucher header fields: On Account/Main A/C, Bill No./Bilty No./IGP No., Delivery

   Adds the remaining reference-screen fields (ref-pics/batch2/stock.png) the 2026-08-30 scope
   decision deferred: this document now also carries a real ledger footprint, plus manual
   reference numbers and a delivery destination, same shape as Sale Bill's own fields.

   On Account / Main A/C, per the user (2026-08-30 follow-up — upgraded from the earlier
   "reference only" default to real ledger posting):
     on_account_ba_id — user-picked business account, editable, defaults to the new STOCK
                        TRANSFER business account (reservedAccounts.js) on a fresh voucher.
     main_ac_id       — snapshot of on_account_ba_id's own parent chart account at save time,
                        same pattern as dbo.sale_bills.main_ac_id snapshotting the customer's.

   POSTS AS (see stockVouchers.service.js#post): Dr STOCK TRANSFER BA (fixed) / Cr on_account_ba_id
   for the voucher's total_value — the reserved STOCK TRANSFER account absorbs the stock value
   received, countered against whichever account the office is charging it to. Skipped entirely
   when total_value is 0 (an all-zero-rate voucher has nothing to post).

   Bill No./Bilty No./IGP No. — INT, per the user: optional reference numbers, fillable at or
   after save time, same convention as Sale Bill's own gp_no/bilty_no (never required, nothing
   downstream depends on them).

   Delivery — Same/Custom, mirroring Sale Bill's own delivery_type/delivery_address pair, but
   Custom here is a free-text address only (no sub-customer — Stock Voucher has no customer at
   all), per the user's 2026-08-30 follow-up.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'bill_no')
BEGIN
  ALTER TABLE dbo.stock_vouchers ADD bill_no INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'bilty_no')
BEGIN
  ALTER TABLE dbo.stock_vouchers ADD bilty_no INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'igp_no')
BEGIN
  ALTER TABLE dbo.stock_vouchers ADD igp_no INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'delivery_type')
BEGIN
  ALTER TABLE dbo.stock_vouchers ADD delivery_type VARCHAR(10) NOT NULL
    CONSTRAINT DF_sv_delivery_type DEFAULT ('SAME')
    CONSTRAINT CK_sv_delivery_type CHECK (delivery_type IN ('SAME','CUSTOM'));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'delivery_address')
BEGIN
  ALTER TABLE dbo.stock_vouchers ADD delivery_address NVARCHAR(300) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'on_account_ba_id')
BEGIN
  ALTER TABLE dbo.stock_vouchers ADD on_account_ba_id INT NULL
    CONSTRAINT FK_sv_on_account FOREIGN KEY REFERENCES dbo.business_accounts(ba_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'main_ac_id')
BEGIN
  ALTER TABLE dbo.stock_vouchers ADD main_ac_id INT NULL
    CONSTRAINT FK_sv_main_ac FOREIGN KEY REFERENCES dbo.chart_of_accounts(ac_id);
END
GO

/* ---- ledger_entries.source_type is a closed list; open it for STOCK_VOUCHER (same pattern as
   016_journal_vouchers.sql opening it for JOURNAL_VOUCHER) ---- */
ALTER TABLE dbo.ledger_entries DROP CONSTRAINT CK_ledger_entries_src;
GO

ALTER TABLE dbo.ledger_entries ADD CONSTRAINT CK_ledger_entries_src CHECK (source_type IN
      ('SALE_BILL','SALE_RETURN','RECEIPT','COMMISSION','EXPENSE',
       'PURCHASE','PURCHASE_RETURN','CHEQUE_ALLOCATION','OPENING',
       'WAGE_RUN','SALARY_RUN',
       'TRANSFER',
       'DEPOSIT',
       'SETTLEMENT',
       'JOURNAL_VOUCHER',
       -- Value of stock manually added, countered against on_account_ba_id — see
       -- dbo.stock_vouchers above and stockVouchers.service.js#post.
       'STOCK_VOUCHER'));
GO
