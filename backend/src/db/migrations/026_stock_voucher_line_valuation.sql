-- Adds valuation columns to dbo.stock_voucher_lines — Rate/D%/DV/Value, matching the legacy
-- "Finished Stock Transfer" reference screen (ref-pics/batch2/stock.png). Stock Voucher stays a
-- single-store manual quantity-add document (no On Account/Main A/C/transfer-to concept, no
-- Bill/IGP/Brty No — see the 2026-08-30 scope decision); this only adds pricing to each line.
--
-- value = round(rate * pairs, 2) - discount_value; discount_value = round(rate * pairs *
-- discount_pct / 100, 2) — computed server-side in stockVouchers.service.js#resolveLines, never
-- trusted from the client. All four default to 0 so existing rows (and any insert that omits
-- them) stay valid.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_voucher_lines') AND name = 'rate')
BEGIN
  ALTER TABLE dbo.stock_voucher_lines ADD rate DECIMAL(18,4) NOT NULL CONSTRAINT DF_svl_rate DEFAULT (0);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_voucher_lines') AND name = 'discount_pct')
BEGIN
  ALTER TABLE dbo.stock_voucher_lines ADD discount_pct DECIMAL(9,4) NOT NULL CONSTRAINT DF_svl_discount_pct DEFAULT (0);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_voucher_lines') AND name = 'discount_value')
BEGIN
  ALTER TABLE dbo.stock_voucher_lines ADD discount_value DECIMAL(18,4) NOT NULL CONSTRAINT DF_svl_discount_value DEFAULT (0);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_voucher_lines') AND name = 'value')
BEGIN
  ALTER TABLE dbo.stock_voucher_lines ADD value DECIMAL(18,4) NOT NULL CONSTRAINT DF_svl_value DEFAULT (0);
END
GO
