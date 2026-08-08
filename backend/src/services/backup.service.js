// Backup-DB service (Milestone 9 follow-up). The "backup database" is a second, real SQL Server
// database on the same instance, kept in sync via SQL Server's own native BACKUP/RESTORE rather
// than replaying writes row-by-row: replaying inserts independently against two databases risks
// IDENTITY columns drifting apart (e.g. a sale bill's header id vs its item rows), silently
// corrupting the "mirror" over time. BACKUP DATABASE ... TO DISK + RESTORE DATABASE ... WITH
// REPLACE instead copies the exact committed state, ids included, every time — so it can never
// drift. Never runs inside the same transaction as a main-DB write; a failure here is caught and
// logged, never rolled back into the main write (explicit requirement: main writes never wait on
// this).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sql, getPool, consumeDirty, isDirty } = require('../db/pool');
const config = require('../config');
const { getBackupDbFolder } = require('../config/appConfig');
const ApiError = require('../errors/ApiError');

let lastSyncAt = null;
let lastSyncError = null;
let syncInFlight = null; // Promise, so a manual click during an auto-sync just awaits it instead of racing a second RESTORE.

// Bracket identifiers ([name]) can't be parameterized in DDL. config.backupDbName/config.db.database
// come from env/config rather than typed user input, but escaping the one character that would
// break out of a bracketed identifier (`]`) is cheap insurance regardless of how trusted the
// source is.
function escapeIdentifier(name) {
  return name.replace(/]/g, ']]');
}

function backupDataFilePath(folder) {
  return path.join(folder, `${config.backupDbName}.mdf`);
}

function backupLogFilePath(folder) {
  return path.join(folder, `${config.backupDbName}_log.ldf`);
}

// Runs once, lazily, the first time a sync is attempted — not at every app startup — since most
// startups the backup DB already exists and this would just be a wasted round-trip.
async function ensureBackupDatabase(folder) {
  const pool = await getPool();
  const existsResult = await pool.request()
    .input('name', sql.NVarChar, config.backupDbName)
    .query('SELECT database_id FROM sys.databases WHERE name = @name');
  if (existsResult.recordset.length > 0) return;

  fs.mkdirSync(folder, { recursive: true });
  await pool.request().query(`
    CREATE DATABASE [${escapeIdentifier(config.backupDbName)}]
    ON PRIMARY (NAME = N'${config.backupDbName}', FILENAME = N'${backupDataFilePath(folder)}')
    LOG ON (NAME = N'${config.backupDbName}_log', FILENAME = N'${backupLogFilePath(folder)}')
  `);
}

async function runSyncNow() {
  const folder = getBackupDbFolder();
  if (!folder) {
    throw ApiError.conflict('Backup folder not configured — reinstall or set it in Settings', 'BACKUP_NOT_CONFIGURED');
  }

  await ensureBackupDatabase(folder);

  const pool = await getPool();
  const tempBakPath = path.join(os.tmpdir(), `${config.db.database}_sync_${Date.now()}.bak`);
  try {
    await pool.request()
      .input('bakPath', sql.NVarChar, tempBakPath)
      .query(`BACKUP DATABASE [${escapeIdentifier(config.db.database)}] TO DISK = @bakPath WITH INIT`);

    // The backup set's logical file names are whatever the MAIN database was created with (e.g.
    // `wentox`/`wentox_log`), never `${config.backupDbName}` — a plain `RESTORE ... WITH REPLACE`
    // with no MOVE clause tries to restore onto the ORIGINAL database's own file paths (since it
    // reuses the backup set's file metadata as-is), which would silently target the main DB's own
    // .mdf/.ldf rather than the backup folder. RESTORE FILELISTONLY reads the actual logical names
    // out of the backup set so the MOVE clauses are always correct regardless of what the main DB
    // was named/created with.
    const fileList = await pool.request()
      .input('bakPath', sql.NVarChar, tempBakPath)
      .query('RESTORE FILELISTONLY FROM DISK = @bakPath');
    const moveClauses = fileList.recordset
      .map((f) => {
        const dest = f.Type === 'L' ? backupLogFilePath(folder) : backupDataFilePath(folder);
        return `MOVE N'${f.LogicalName}' TO N'${dest}'`;
      })
      .join(', ');

    // Restoring requires no other connections hold the backup DB open — this app never opens a
    // second pool against it (it's write-only, never read for normal operation), so the only
    // thing that could hold a lock is a prior sync's own connection, which SINGLE_USER clears.
    await pool.request().query(`ALTER DATABASE [${escapeIdentifier(config.backupDbName)}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
    try {
      await pool.request()
        .input('bakPath', sql.NVarChar, tempBakPath)
        .query(`RESTORE DATABASE [${escapeIdentifier(config.backupDbName)}] FROM DISK = @bakPath WITH REPLACE, ${moveClauses}`);
    } finally {
      // Runs even if RESTORE failed, so a failed sync never leaves the backup DB stuck in
      // SINGLE_USER (which would otherwise block every future sync attempt too).
      await pool.request().query(`ALTER DATABASE [${escapeIdentifier(config.backupDbName)}] SET MULTI_USER`).catch((err) => {
        console.error('Failed to restore backup DB to MULTI_USER after sync:', err);
      });
    }
  } finally {
    fs.unlink(tempBakPath, () => {}); // best-effort cleanup of the scratch .bak; a leftover temp file isn't worth failing the sync over
  }
}

// Shared by both the manual "Backup Now" button and the auto-sync timer, so a manual click while
// an auto-sync is mid-flight waits on the same run instead of starting a second, conflicting one.
// Only clears the dirty flag when actually STARTING a new run (not when joining one already in
// flight) — otherwise a write landing after an in-flight BACKUP DATABASE has already taken its
// snapshot could get silently marked "captured" even though that run never saw it.
async function sync() {
  if (syncInFlight) return syncInFlight;
  consumeDirty();
  syncInFlight = runSyncNow()
    .then(() => { lastSyncAt = new Date(); lastSyncError = null; })
    .catch((err) => { lastSyncError = err.message || String(err); throw err; })
    .finally(() => { syncInFlight = null; });
  return syncInFlight;
}

// Called on the auto-sync timer — skips the (comparatively expensive) BACKUP/RESTORE entirely
// when nothing has been written since the last sync. Peeks the flag rather than consuming it here
// — sync() itself is what actually consumes it, at the point it commits to a new run.
async function syncIfDirty() {
  if (!isDirty()) return;
  try {
    await sync();
  } catch (err) {
    console.error('Auto backup sync failed:', err);
  }
}

// Called once at startup. Without this the chosen backup folder just sits EMPTY after install,
// which reads as "the backup feature is broken": the backup database was only ever created
// lazily by the first sync, and syncIfDirty() no-ops until something is actually written, so on a
// fresh install nothing appeared there for at least the first 10-minute tick — often never, if
// the app was closed before then.
//
// Only does the full BACKUP/RESTORE when the backup database doesn't exist yet, so this costs
// nothing on every subsequent launch; from then on the timer keeps it current.
async function ensureInitialBackup() {
  const folder = getBackupDbFolder();
  if (!folder) return; // not configured (dev machine, or a hand-edited config) — nothing to do

  try {
    const pool = await getPool();
    const exists = await pool.request()
      .input('name', sql.NVarChar, config.backupDbName)
      .query('SELECT database_id FROM sys.databases WHERE name = @name');
    if (exists.recordset.length > 0) return;

    console.log('Backup database not present yet — creating and taking a first backup...');
    await sync();
    console.log(`Backup database created at ${folder}`);
  } catch (err) {
    // Best-effort, exactly like the periodic sync: a backup problem must never block startup.
    console.error('Initial backup setup failed:', err);
  }
}

function status() {
  return { lastSyncAt, lastSyncError, configured: Boolean(getBackupDbFolder()) };
}

module.exports = { sync, syncIfDirty, ensureInitialBackup, status };
