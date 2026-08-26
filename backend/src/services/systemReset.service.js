// Service layer for the admin-only "Reset Database" danger-zone action (Settings). No repository
// file — this is server-admin DDL (DROP/CREATE DATABASE), the same shape backup.service.js uses,
// not app-table CRUD.
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const config = require('../config');
const { getBackupDbFolder, getExternalBackupFolder } = require('../config/appConfig');
const { closePool } = require('../db/pool');
const migrate = require('../db/migrate');
const seed = require('../db/seeds/run');
const backupService = require('./backup.service');
const authService = require('./auth.service');

// Bracket identifiers can't be parameterized in DDL; both names come from config, never from user
// input, but escaping the one character that would break out of a bracketed identifier is cheap
// insurance regardless — same reasoning as backup.service.js's own escapeIdentifier.
function escapeIdentifier(name) {
  return name.replace(/]/g, ']]');
}

async function dropDatabaseIfExists(masterPool, dbName) {
  const escaped = escapeIdentifier(dbName);
  await masterPool.request()
    .input('name', sql.NVarChar, dbName)
    .query(`
      IF EXISTS (SELECT 1 FROM sys.databases WHERE name = @name)
      BEGIN
        ALTER DATABASE [${escaped}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [${escaped}];
      END
    `);
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error(`Reset: failed to delete ${filePath}:`, err.message);
  }
}

// Deletes the backup mirror's .mdf/.ldf files left behind after DROP DATABASE (SQL Server does
// not delete the physical files itself) and the external-drive .bak + its instructions text, if
// either is configured. Best-effort — a stray leftover file must never fail the reset itself,
// since the far more important main-database wipe has already committed by the time this runs.
function cleanupBackupFiles() {
  const folder = getBackupDbFolder();
  if (folder) {
    safeUnlink(path.join(folder, `${config.backupDbName}.mdf`));
    safeUnlink(path.join(folder, `${config.backupDbName}_log.ldf`));
  }
  const externalFolder = getExternalBackupFolder();
  if (externalFolder) {
    safeUnlink(path.join(externalFolder, `${config.db.database}.bak`));
    safeUnlink(path.join(externalFolder, 'RESTORE-INSTRUCTIONS.txt'));
  }
}

// The critical, admin-only, double-password-gated "factory reset": drops and recreates the main
// database (the only reliable way to guarantee every IDENTITY column restarts at 1 across ~40
// FK-linked tables, versus truncating each one by hand in dependency order), reseeds it exactly
// like a fresh install (admin/user logins, reserved chart accounts, default store), then flushes
// the backup mirror database and external .bak and remounts a fresh empty mirror at the same
// configured path so backups keep working afterward.
//
// `userId`/`password` re-verify the CALLING admin's own login password (auth.service's own
// verifyPassword — the same check used to gate other sensitive actions) — the ipc layer already
// required an ADMIN session, this is the second, explicit "prove it's really you" gate the
// destructiveness of this action calls for.
async function resetDatabase(userId, password) {
  await authService.verifyPassword(userId, password);

  await closePool(); // release the app's own pooled connections before DROP DATABASE needs exclusive access

  const masterPool = await new sql.ConnectionPool({ ...config.db, database: 'master' }).connect();
  try {
    await dropDatabaseIfExists(masterPool, config.backupDbName);
    await dropDatabaseIfExists(masterPool, config.db.database);
  } finally {
    await masterPool.close();
  }

  cleanupBackupFiles();

  // seed() is deliberately NOT chained behind migrate()'s success. The database has already been
  // dropped by this point, so a migrate() that throws here would skip seeding and leave the user
  // locked out of the app they just reset — no admin, no way back in. Seeding is what restores
  // admin/admin123, and it only needs tables schema.sql creates (which migrate applies first), so
  // it runs regardless; a migration failure is re-thrown afterwards so the caller still hears
  // about it, but never at the cost of a login.
  let migrateError = null;
  try {
    await migrate();
  } catch (err) {
    migrateError = err;
    console.error('Reset: migrate failed — seeding anyway so the app still has a login:', err);
  }
  await seed();
  if (migrateError) throw migrateError;

  // Recreates the backup mirror at the same configured folder and takes a first (now-empty) sync
  // — mirrors ensureInitialBackup()'s own startup behavior. "Remounted at the same path."
  if (getBackupDbFolder()) {
    try {
      await backupService.sync();
    } catch (err) {
      // Not fatal to the reset itself — the main database is already clean and usable; the
      // periodic sync timer will pick this back up on its own.
      console.error('Reset: recreating the backup mirror failed:', err.message);
    }
  }

  return { ok: true };
}

module.exports = { resetDatabase };
