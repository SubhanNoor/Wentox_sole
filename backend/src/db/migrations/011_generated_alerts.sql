-- Alerts stop being computed live on every alerts:list call — a startup job (electron/main.js,
-- runs once per app launch, no repeat) now computes cheque-due/sale-bill-due alerts and persists
-- them here; alerts:list just reads this table (filtered against the existing alert_dismissals).
-- Severity ('overdue' vs 'due-soon') is deliberately NOT stored — it's derived from alert_date vs
-- today at read time in alerts.service.js#list(), so it never goes stale between job runs.

-- GUARDED, same reason as 005/010: this table was also folded into database/schema.sql, so on a
-- FRESH database it already exists and the bare CREATE fails ("There is already an object named
-- 'generated_alerts'"), blocking the install. No-op where it already exists.
IF OBJECT_ID('dbo.generated_alerts', 'U') IS NULL
BEGIN
CREATE TABLE dbo.generated_alerts (
  alert_id    INT IDENTITY(1,1) NOT NULL,
  alert_key   VARCHAR(100)  NOT NULL,               -- 'CHEQUE_DUE:<cheque_id>' | 'PAYMENT_OVERDUE:<bill_id>'
  kind        VARCHAR(20)   NOT NULL,
  title       NVARCHAR(200) NOT NULL,
  detail      NVARCHAR(300) NULL,
  alert_date  DATE          NOT NULL,                -- the cheque/bill due date driving this alert
  amount      DECIMAL(14,2) NOT NULL,
  target_page VARCHAR(50)   NOT NULL,
  target_tab  VARCHAR(50)   NULL,
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_galerts_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_galerts_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_generated_alerts     PRIMARY KEY (alert_id),
  CONSTRAINT UQ_generated_alerts_key UNIQUE (alert_key),
  CONSTRAINT CK_generated_alerts_kind CHECK (kind IN ('CHEQUE_DUE','PAYMENT_OVERDUE'))
);
CREATE INDEX IX_generated_alerts_date ON dbo.generated_alerts(alert_date);
END
GO
