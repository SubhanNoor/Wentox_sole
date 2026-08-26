/* ============================================================================
   025 — Stock Voucher

   WHAT: a manual "add stock" document (legacy Journal Entry-style bound-record
         screen, per the user 2026-08-26) — N lines, each a finished-goods
         variant + cartons/pairs, entered under one Date/Store/Remarks header.
         Replaces the old inline "+ Add Stock" flow on the Current Stock report
         (ReportStockPage.tsx), which called stock:log-production and recorded
         every manual addition AS production — this is its own document type
         instead, same architecture as Journal Voucher: one table, DRAFT by
         default, status flips to CONFIRMED only on post().

   Store is header-only/informational (per the user, 2026-08-26: "informational
   only") — dbo.stock_movements has no store_id column and stays store-agnostic;
   nothing downstream depends on store_id being set or accurate.

   POSTS AS: one dbo.stock_movements row per line, movement_type='ADJUSTMENT'
   (already unconstrained-sign — no CHECK-list change needed), qty_pairs=+pairs,
   source_type='STOCK_VOUCHER', source_id=stock_voucher_id. unpost() deletes
   those same rows by source_type+source_id, mirroring how SALE_BILL/
   SALE_RETURN movements are already looked up.
   ============================================================================ */

CREATE TABLE dbo.stock_vouchers (
  stock_voucher_id INT IDENTITY(1,1) NOT NULL,
  voucher_date     DATE          NOT NULL,
  store_id         INT           NULL,
  remarks          NVARCHAR(500) NULL,
  status           VARCHAR(10)   NOT NULL CONSTRAINT DF_sv_status  DEFAULT ('DRAFT'),
  created_by       INT           NULL,
  updated_by       INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sv_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sv_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_stock_vouchers        PRIMARY KEY (stock_voucher_id),
  CONSTRAINT FK_stock_vouchers_store  FOREIGN KEY (store_id)   REFERENCES dbo.stores(store_id),
  CONSTRAINT FK_stock_vouchers_cby    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_stock_vouchers_uby    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_stock_vouchers_status CHECK (status IN ('CONFIRMED','DRAFT'))
);
GO

CREATE INDEX IX_stock_vouchers_date ON dbo.stock_vouchers(voucher_date);
GO

CREATE TABLE dbo.stock_voucher_lines (
  line_id          INT IDENTITY(1,1) NOT NULL,
  stock_voucher_id INT          NOT NULL,
  line_no          INT          NOT NULL,
  variant_id       INT          NOT NULL,
  cartons          INT          NOT NULL CONSTRAINT DF_svl_cartons DEFAULT (0),
  pairs            INT          NOT NULL,
  created_at       DATETIME2(0) NOT NULL CONSTRAINT DF_svl_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0) NOT NULL CONSTRAINT DF_svl_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_stock_voucher_lines PRIMARY KEY (line_id),
  CONSTRAINT FK_svl_voucher         FOREIGN KEY (stock_voucher_id) REFERENCES dbo.stock_vouchers(stock_voucher_id) ON DELETE CASCADE,
  CONSTRAINT FK_svl_variant         FOREIGN KEY (variant_id)       REFERENCES dbo.article_colors(variant_id),
  CONSTRAINT CK_svl_cartons_nonneg  CHECK (cartons >= 0),
  CONSTRAINT CK_svl_pairs_positive  CHECK (pairs > 0)
);
GO

CREATE INDEX IX_stock_voucher_lines_voucher ON dbo.stock_voucher_lines(stock_voucher_id);
GO
