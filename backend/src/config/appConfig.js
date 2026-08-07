// Local, machine-specific settings that aren't known until install time — the backup DB folder
// AND (for a packaged install, which never ships a `.env`) the main SQL Server connection details
// — both asked by the NSIS installer's custom pages, see build/installer.nsh. Lives in Electron's
// per-user `userData` dir so it survives app updates and isn't bundled into the installer itself.
const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'app-config.json';

// `app` is only available inside the Electron main process; falls back to cwd for scripts/tests
// run standalone (e.g. `npm run migrate`) where this file is irrelevant anyway.
function getConfigPath() {
  let userDataDir;
  try {
    userDataDir = require('electron').app.getPath('userData');
  } catch {
    userDataDir = process.cwd();
  }
  return path.join(userDataDir, CONFIG_FILENAME);
}

function readAppConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('Failed to read app config, ignoring:', err);
    return {};
  }
}

function writeAppConfig(partial) {
  const configPath = getConfigPath();
  const merged = { ...readAppConfig(), ...partial };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
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
  getDbConnection, setDbConnection,
};
