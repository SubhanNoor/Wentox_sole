-- Adds dbo.stock_vouchers / dbo.stock_voucher_lines — the new Stock Voucher document type,
-- replacing the old inline "+ Add Stock" flow on the Current Stock report. Folded into
-- database/schema.sql directly (see the block there for the full WHAT/WHY/POSTS AS note), but
-- schema.sql had already been applied to this database before that edit landed, so migrate.js's
-- one-time "schema.sql" tracking row skips re-running it — this migration carries the same DDL
-- so it actually reaches an already-migrated database.

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
CREATE INDEX IX_stock_voucher_lines_voucher ON dbo.stock_voucher_lines(stock_voucher_id);
GO
