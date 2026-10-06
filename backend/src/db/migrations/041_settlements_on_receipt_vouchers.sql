/* ============================================================================
   041 — An endorsement (direct settlement) can be a line of a receipt voucher

   Per the user (2026-10-05): an entry endorsed on the Receipts screen used to save as a
   standalone settlement — it never showed in the voucher's detail rows, and Post on screen
   posted only the endorsement. It now belongs to the voucher it was entered on: listed among
   its lines (marked Endorsed), posted/unposted/deleted with it, counted in its total.

   NULLable: endorsements saved before this stay standalone (the user's choice), and the
   settlements service still accepts one with no voucher.
   Idempotent, matching the rest of this folder.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.settlements') AND name = 'voucher_id')
BEGIN
  ALTER TABLE dbo.settlements ADD voucher_id INT NULL
    CONSTRAINT FK_settlements_voucher FOREIGN KEY (voucher_id) REFERENCES dbo.receipt_vouchers(voucher_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_settlements_voucher' AND object_id = OBJECT_ID('dbo.settlements'))
  CREATE INDEX IX_settlements_voucher ON dbo.settlements(voucher_id);
GO
