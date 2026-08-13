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
const path = require('path');
const { sql, getPool, consumeDirty, isDirty } = require('../db/pool');
const config = require('../config');
const { getBackupDbFolder, getExternalBackupFolder } = require('../config/appConfig');
const ApiError = require('../errors/ApiError');

// Written to the external drive alongside the .bak. Fixed name, like the .bak itself — overwritten
// every run rather than accumulating.
const EXTERNAL_BACKUP_FILENAME = `${config.db.database}.bak`;
const RESTORE_INSTRUCTIONS_FILENAME = 'RESTORE-INSTRUCTIONS.txt';

let lastSyncAt = null;
let lastSyncError = null;
let syncInFlight = null; // Promise, so a manual click during an auto-sync just awaits it instead of racing a second RESTORE.

let lastExternalAt = null;
let lastExternalError = null;
let lastExternalSizeBytes = null;
let externalInFlight = null; // Same guard as syncInFlight: a double-click must not run two BACKUPs at the same file.

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
  // Staged inside the mirror's OWN folder, not os.tmpdir(). SQL Server is the process that writes
  // this file, and on Windows it runs as the virtual account NT Service\MSSQLSERVER (no
  // /SQLSVCACCOUNT is passed at install — see build/setup-sqlserver.ps1), which has no rights to
  // the logged-in user's %TEMP%: the BACKUP failed there with "Operating system error 5 (Access is
  // denied)". This folder is somewhere SQL Server demonstrably CAN write — it already hosts the
  // mirror's own .mdf/.ldf. Fixed name rather than a timestamped one: the sync is single-flight,
  // WITH INIT overwrites, and a crash therefore leaves one reused scratch file instead of a
  // growing pile of orphans.
  const tempBakPath = path.join(folder, `${config.db.database}_sync.bak`);
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

// --- External-drive backup ----------------------------------------------------------------------
// A plain .bak file on a drive the user can unplug and carry away — the one copy that survives the
// PC itself dying, which neither the main database nor the mirror above does (both live on the same
// disk, on the same SQL Server instance). Manual only, by explicit decision: nothing here runs on a
// timer, because the drive is not expected to be connected most of the time.
//
// SQL Server writes the file directly rather than the app backing up locally and copying it across:
// one ~400MB write instead of two, and it avoids needing a staging folder that BOTH the SQL Server
// service account and the logged-in user can write to.

// Turns a raw mssql/Tedious error into something the person standing at the PC can act on. wrap.js
// flattens anything that isn't an ApiError into "Internal error", and here the SQL Server text IS
// the useful part — "Cannot open backup device ... Operating system error 5" says exactly what to
// fix — so it is preserved rather than swallowed.
function externalBackupError(err, folder) {
  // The useful message is NOT err.message. A failed BACKUP raises two errors: the real cause
  // ("Cannot open backup device '...'. Operating system error 5(Access is denied.)") and then
  // "BACKUP DATABASE is terminating abnormally." mssql puts the first in .precedingErrors and the
  // last in .message — so reading only .message loses the entire reason, which is exactly what this
  // whole function exists to preserve. Cause first: it reads naturally and it is what to act on.
  const detail = [...(err?.precedingErrors || []).map((e) => e?.message || String(e)), err?.message || String(err)]
    .filter(Boolean)
    .join(' ');

  if (/operating system error (5|3)\b/i.test(detail) || /access is denied/i.test(detail)) {
    return ApiError.conflict(
      `Windows blocked SQL Server from writing to ${folder}. Check the drive isn't write-protected, or pick a different folder on it. (${detail})`,
      'EXTERNAL_ACCESS_DENIED',
    );
  }
  if (/operating system error 112\b/i.test(detail) || /not enough space|insufficient disk/i.test(detail)) {
    return ApiError.conflict(
      `Not enough free space on the drive for the backup. (${detail})`,
      'EXTERNAL_DISK_FULL',
    );
  }
  return ApiError.conflict(`Backup to the external drive failed: ${detail}`, 'EXTERNAL_BACKUP_FAILED');
}

// The drive should explain itself. Whoever is holding it in an emergency may not have this app, or
// any of this project's documentation, in front of them. Best-effort: failing to write a text file
// must never turn a good backup into a reported failure.
function writeRestoreInstructions(folder, bakPath) {
  const db = config.db.database;
  const text = [
    'WENTOX DATABASE BACKUP',
    '======================',
    '',
    `Backup file : ${path.basename(bakPath)}`,
    `Database    : ${db}`,
    `Taken       : ${new Date().toString()}`,
    '',
    'This is a full Microsoft SQL Server backup. It is replaced each time the backup',
    'is run from Wentox, so it always holds the most recent copy and no older ones.',
    '',
    'TO RESTORE IT',
    '-------------',
    'On a PC with SQL Server installed, open SQL Server Management Studio (or sqlcmd)',
    'as an administrator, and run step 1 to see what is inside the backup:',
    '',
    `  RESTORE FILELISTONLY FROM DISK = '${bakPath}';`,
    '',
    `That lists the logical file names, normally "${db}" and "${db}_log". Use them in`,
    'step 2, pointing MOVE at the SQL Server data folder on the target PC (usually',
    'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA):',
    '',
    `  RESTORE DATABASE [${db}]`,
    `  FROM DISK = '${bakPath}'`,
    '  WITH REPLACE,',
    `       MOVE '${db}'     TO 'C:\\...\\DATA\\${db}.mdf',`,
    `       MOVE '${db}_log' TO 'C:\\...\\DATA\\${db}_log.ldf';`,
    '',
    'WARNING: WITH REPLACE overwrites any existing database of that name on that PC.',
    'If one already exists and matters, restore under a different name instead by',
    'changing [' + db + '] in step 2 and pointing the MOVE paths at new filenames.',
    '',
    'Wentox then needs to be told to use it, in %ProgramData%\\Wentox\\app-config.json.',
  ].join('\r\n'); // CRLF — this is opened in Notepad on Windows more often than anywhere else
  try {
    fs.writeFileSync(path.join(folder, RESTORE_INSTRUCTIONS_FILENAME), text);
  } catch (err) {
    console.error('Could not write restore instructions to the backup drive:', err);
  }
}

async function runExternalBackupNow() {
  const folder = getExternalBackupFolder();
  if (!folder) {
    throw ApiError.conflict('Choose an external backup folder first.', 'EXTERNAL_NOT_CONFIGURED');
  }
  // Checked BEFORE starting: an unplugged drive should fail instantly with a clear reason, not
  // after however long SQL Server takes to discover it can't write there.
  if (!fs.existsSync(folder)) {
    throw ApiError.conflict(
      `External drive not found at ${folder} — plug it in and try again.`,
      'EXTERNAL_DRIVE_MISSING',
    );
  }

  const bakPath = path.join(folder, EXTERNAL_BACKUP_FILENAME);
  const pool = await getPool();
  try {
    // No WITH COMPRESSION — backup compression isn't available in SQL Server Express and would fail
    // the statement outright. INIT + FORMAT start a fresh media set every run, so the file is truly
    // replaced rather than quietly growing a second backup set inside itself. CHECKSUM makes later
    // corruption detectable rather than silent.
    await pool.request()
      .input('bakPath', sql.NVarChar, bakPath)
      .query(`BACKUP DATABASE [${escapeIdentifier(config.db.database)}] TO DISK = @bakPath WITH INIT, FORMAT, CHECKSUM`);

    // What makes this trustworthy: proves the file actually sitting on the drive is complete and
    // readable, instead of reporting success merely because the write returned no error.
    await pool.request()
      .input('bakPath', sql.NVarChar, bakPath)
      .query('RESTORE VERIFYONLY FROM DISK = @bakPath');
  } catch (err) {
    throw externalBackupError(err, folder);
  }

  let sizeBytes = null;
  try {
    sizeBytes = fs.statSync(bakPath).size;
  } catch (err) {
    console.error('Backup succeeded but its size could not be read:', err);
  }
  writeRestoreInstructions(folder, bakPath);
  return { path: bakPath, sizeBytes };
}

// Same single-flight guard as sync(): a double-click must not start a second BACKUP against the
// file the first one is still writing.
async function backupToExternal() {
  if (externalInFlight) return externalInFlight;
  externalInFlight = runExternalBackupNow()
    .then((result) => {
      lastExternalAt = new Date();
      lastExternalError = null;
      lastExternalSizeBytes = result.sizeBytes;
      return result;
    })
    .catch((err) => { lastExternalError = err.message || String(err); throw err; })
    .finally(() => { externalInFlight = null; });
  return externalInFlight;
}

function status() {
  const externalFolder = getExternalBackupFolder();
  return {
    lastSyncAt,
    lastSyncError,
    configured: Boolean(getBackupDbFolder()),
    externalFolder,
    // Lets Settings show "drive not connected" before the user presses anything, rather than only
    // as the result of a failed attempt.
    externalDriveConnected: Boolean(externalFolder && fs.existsSync(externalFolder)),
    lastExternalAt,
    lastExternalError,
    lastExternalSizeBytes,
  };
}

module.exports = { sync, syncIfDirty, ensureInitialBackup, backupToExternal, status };
