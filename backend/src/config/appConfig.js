// Local, machine-specific settings that aren't known until install time — the backup DB folder AND
// (for a packaged install, which never ships a `.env`) the main SQL Server connection details,
// written by the installer's setup-sqlserver.ps1.
//
// These live MACHINE-WIDE in %ProgramData%\Wentox, not in Electron's per-user `userData`. Wentox
// installs perMachine and talks to one local SQL Server, so the connection belongs to the machine,
// not to whoever happens to be logged in — and critically, the installer runs elevated, so a
// per-user path would be written into the *elevating admin's* profile and be invisible to the
// person actually running the app. That mismatch presented as "Login failed for user 'sa'": the
// app found no config at all and silently fell back to empty `.env` defaults.
const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'app-config.json';

function getConfigPath() {
  // ProgramData is machine-wide and identical for every user and for the elevated installer.
  const programData = process.env.ProgramData || process.env.ALLUSERSPROFILE;
  if (programData) return path.join(programData, 'Wentox', CONFIG_FILENAME);

  // Not Windows (dev on Linux/macOS) — `app` is only available inside the Electron main process,
  // and falls back to cwd for standalone scripts (e.g. `npm run migrate`) where this is irrelevant.
  try {
    return path.join(require('electron').app.getPath('userData'), CONFIG_FILENAME);
  } catch {
    return path.join(process.cwd(), CONFIG_FILENAME);
  }
}

// Older builds wrote to the per-user userData dir; keep reading that if the machine-wide file
// isn't there yet, so an existing install doesn't lose its settings on upgrade.
function getLegacyConfigPath() {
  try {
    return path.join(require('electron').app.getPath('userData'), CONFIG_FILENAME);
  } catch {
    return null;
  }
}

function readAppConfig() {
  for (const configPath of [getConfigPath(), getLegacyConfigPath()]) {
    if (!configPath || !fs.existsSync(configPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error(`Failed to read app config at ${configPath}, ignoring:`, err);
    }
  }
  return {};
}

// Windows refusing the write is the expected failure here, not a bug: the installer creates
// %ProgramData%\Wentox\app-config.json ELEVATED, and a normal user can read that file but not change
// it. Surfaced as a plain-language ApiError instead of escaping as a bare "Internal error" (which is
// exactly what production showed on the external-backup folder picker, 2026-09-18).
function writeJson(configPath, data) {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      // Required lazily: this module is also loaded by standalone scripts before anything else.
      const ApiError = require('../errors/ApiError');
      throw ApiError.conflict(
        `Windows did not allow Wentox to save this setting (${configPath}). Run Wentox as administrator once and try again, or ask whoever installed it to give users write access to that folder.`,
        'CONFIG_NOT_WRITABLE',
      );
    }
    throw err;
  }
}

function writeAppConfig(partial) {
  const configPath = getConfigPath();
  const merged = { ...readAppConfig(), ...partial };
  writeJson(configPath, merged);
  return merged;
}

// Per-user settings — for choices that belong to whoever is using the app and must ALWAYS be
// savable without admin rights (Electron's userData is the user's own profile folder). Machine-wide
// app-config.json above stays admin-only on purpose: it holds the SQL Server password.
const USER_SETTINGS_FILENAME = 'user-settings.json';
function getUserSettingsPath() {
  try {
    return path.join(require('electron').app.getPath('userData'), USER_SETTINGS_FILENAME);
  } catch {
    return path.join(process.cwd(), USER_SETTINGS_FILENAME);
  }
}
function readUserSettings() {
  const p = getUserSettingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`Failed to read user settings at ${p}, ignoring:`, err);
    return {};
  }
}
function writeUserSettings(partial) {
  const merged = { ...readUserSettings(), ...partial };
  writeJson(getUserSettingsPath(), merged);
  return merged;
}

// Set by the NSIS installer's custom page (see build/installer.nsh) before first launch, and
// readable/writable from Settings afterwards if the user needs to relocate it.
function getBackupDbFolder() {
  return readAppConfig().backupDbFolder || null;
}

function setBackupDbFolder(folderPath) {
  return writeAppConfig({ backupDbFolder: folderPath });
}

// Where the "Back Up to External Drive" button writes its .bak. Distinct from backupDbFolder above:
// that one holds a LIVE mirror database SQL Server keeps attached, so it must always be present —
// this one is a plain file on a drive that is expected to come and go, and is chosen from Settings
// rather than by the installer (the drive usually isn't plugged in at install time).
//
// Saved PER USER now (2026-09-18): choosing it wrote to the admin-only app-config.json, which a
// normal user cannot change — the folder picker failed with "Internal error" in production. A value
// saved there by an older version is still honoured until a new folder is picked.
function getExternalBackupFolder() {
  return readUserSettings().externalBackupFolder || readAppConfig().externalBackupFolder || null;
}

function setExternalBackupFolder(folderPath) {
  return writeUserSettings({ externalBackupFolder: folderPath });
}

// Main DB connection — only present when the NSIS installer's DB-connection page wrote it (a
// packaged install with no `.env`). Returns null on a dev checkout, where config/index.js falls
// back to `.env` instead.
function getDbConnection() {
  const { dbServer, dbPort, dbName, dbUser, dbPassword } = readAppConfig();
  if (!dbServer) return null;
  return { server: dbServer, port: dbPort, database: dbName, user: dbUser, password: dbPassword };
}

function setDbConnection({ server, port, database, user, password }) {
  return writeAppConfig({ dbServer: server, dbPort: port, dbName: database, dbUser: user, dbPassword: password });
}

module.exports = {
  getConfigPath, readAppConfig, writeAppConfig,
  getBackupDbFolder, setBackupDbFolder,
  getExternalBackupFolder, setExternalBackupFolder,
  getDbConnection, setDbConnection,
};
