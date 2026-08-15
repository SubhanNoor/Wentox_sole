/* ============================================================================
   021 — Adda Routes (AD-01)

   WHY: An adda used to carry a single region_id/city_id. The client wants an adda to serve a
        whole ROUTE of cities instead (the transporter picks up/drops at several towns, not one),
        selected as a checklist against dbo.cities.

   dbo.adda_routes is a plain many-to-many junction: one row per (adda, city) it serves.

   addas.region_id/city_id are NOT dropped — they stay as historical/audit fields for addas
   created before this migration, but the creation/edit screen stops populating them and starts
   writing adda_routes instead. region_id is relaxed to nullable so a new adda (which no longer
   collects a region at all) doesn't trip CK/NOT NULL on insert.

   No backfill: an existing adda's route starts empty after this migration (confirmed with the
   client) — someone re-picks its cities by hand via the edit screen, rather than the migration
   guessing a multi-city route from a single old city_id.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'adda_routes' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.adda_routes (
    adda_id    INT NOT NULL,
    city_id    INT NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_adda_routes_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_adda_routes      PRIMARY KEY (adda_id, city_id),
    CONSTRAINT FK_adda_routes_adda FOREIGN KEY (adda_id) REFERENCES dbo.addas(adda_id) ON DELETE CASCADE,
    CONSTRAINT FK_adda_routes_city FOREIGN KEY (city_id) REFERENCES dbo.cities(city_id)
  );
  CREATE INDEX IX_adda_routes_city ON dbo.adda_routes(city_id);
END

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.addas') AND name = 'region_id' AND is_nullable = 0
)
  ALTER TABLE dbo.addas ALTER COLUMN region_id INT NULL;
