// Local, machine-specific settings that aren't known until install time (e.g. the backup DB
// folder the NSIS installer's custom page asks for) — separate from `.env`, which ships with the
// repo and holds the main DB connection. Lives in Electron's per-user `userData` dir so it
// survives app updates and isn't bundled into the installer itself.
const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'backup-config.json';

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

module.exports = { getConfigPath, readAppConfig, writeAppConfig, getBackupDbFolder, setBackupDbFolder };
