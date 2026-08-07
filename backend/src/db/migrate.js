const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const config = require('../config');

async function migrate() {
  const pool = await new sql.ConnectionPool(config.db).connect();

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'schema_migrations')
    CREATE TABLE dbo.schema_migrations (
      filename   VARCHAR(255) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
      applied_at DATETIME2(0) NOT NULL CONSTRAINT DF_schema_migrations_applied DEFAULT (SYSUTCDATETIME())
    )
  `);

  // Schema source of truth lives at repo root in dev (../../../database/schema.sql from here),
  // not inside backend/ — but a packaged app only ships what's under backend/ (package.json's
  // "files"), so package.json's extraResources copies it into resources/database/schema.sql for
  // that case instead. Tracked as one migration file named by its basename, same as anything
  // under migrations/.
  let isPackaged = false;
  try { isPackaged = require('electron').app.isPackaged; } catch { /* not running inside Electron (CLI/script use) */ }
  const schemaFile = isPackaged
    ? path.join(process.resourcesPath, 'database', 'schema.sql')
    : path.join(__dirname, '..', '..', '..', 'database', 'schema.sql');
  const dir = path.join(__dirname, 'migrations');
  const laterMigrations = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => path.join(dir, f))
    : [];
  // schema.sql must always run FIRST regardless of filename — sorting it in
  // alphabetically breaks on a fresh database, since numbered migrations like
  // "001_..." sort before "schema.sql" ('0' < 's'), and would try to ALTER
  // tables schema.sql hasn't created yet.
  const sortedMigrations = laterMigrations
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const files = [schemaFile, ...sortedMigrations];

  for (const filePath of files) {
    const file = path.basename(filePath);
    const already = await pool.request()
      .input('filename', sql.VarChar, file)
      .query('SELECT 1 FROM dbo.schema_migrations WHERE filename = @filename');
    if (already.recordset.length > 0) continue;

    const script = fs.readFileSync(filePath, 'utf8');
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      // Split on GO batch separators (own line, case-insensitive) — mssql runs one batch per request.
      const batches = script.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
      for (const batch of batches) {
        await new sql.Request(transaction).query(batch);
      }
      await new sql.Request(transaction)
        .input('filename', sql.VarChar, file)
        .query('INSERT INTO dbo.schema_migrations (filename) VALUES (@filename)');
      await transaction.commit();
      console.log(`applied ${file}`);
    } catch (err) {
      await transaction.rollback();
      console.error(`failed ${file}:`, err.message);
      process.exitCode = 1;
      break;
    }
  }
  await pool.close();
}

module.exports = migrate;

// `npm run migrate` runs this file directly — keep that working. When required as a module
// instead (electron/main.js, on every app startup), the caller decides when to run it.
if (require.main === module) {
  migrate().catch((err) => {
    console.error('migrate failed:', err.message);
    process.exitCode = 1;
  });
}
