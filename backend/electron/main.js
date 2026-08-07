const path = require('path');
const { app, BrowserWindow } = require('electron');
const registerIpcHandlers = require('../src/ipc');
const alertsService = require('../src/services/alerts.service');
const backupService = require('../src/services/backup.service');

// package.json's "name" (wentox-backend) is an npm package name, not a user-facing product name —
// without this, app.getPath('userData') (where appConfig.js reads the installer-chosen backup
// path from) would resolve to %APPDATA%\wentox-backend instead of the %APPDATA%\Wentox the NSIS
// installer script writes to. Must run before app.whenReady()/any getPath() call.
app.setName('Wentox');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL); // dev: Vite server
  } else if (app.isPackaged) {
    // electron-builder copies frontend/dist into resources/frontend/dist (see package.json's
    // "extraResources") rather than preserving the monorepo's ../../frontend layout, which
    // doesn't exist once packaged.
    win.loadFile(path.join(process.resourcesPath, 'frontend/dist/index.html'));
  } else {
    win.loadFile(path.join(__dirname, '../../frontend/dist/index.html')); // unpackaged prod: `npm start` against a local frontend build
  }
}

const ALERTS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
// Comparatively expensive (a full BACKUP+RESTORE), and syncIfDirty() itself no-ops when nothing
// was written since the last run, so this can run less often than the alerts refresh.
const BACKUP_SYNC_INTERVAL_MS = 10 * 60 * 1000;

app.whenReady().then(() => {
  registerIpcHandlers(); // every ipcMain.handle channel must exist before the renderer can call one

  // Alerts job (Milestone 9.1 follow-up, later widened from "startup only" to a 15-minute repeat
  // per explicit request — a newly-due cheque/bill was going unnoticed for however long a session
  // stayed open): computes cheque-due/sale-bill-due alerts and persists them into
  // dbo.generated_alerts; alerts:list just reads that table from here on. Also exposed as
  // alerts:refresh for an on-demand manual refresh from the renderer. Not awaited — the window
  // shouldn't wait on a DB round-trip to open, and a failure here (e.g. DB briefly unreachable)
  // shouldn't crash startup/the timer, just leave generated_alerts as it was from the last
  // successful run.
  alertsService.refreshAlerts().catch((err) => console.error('Alerts refresh failed on startup:', err));
  setInterval(() => {
    alertsService.refreshAlerts().catch((err) => console.error('Alerts refresh failed:', err));
  }, ALERTS_REFRESH_INTERVAL_MS);

  // Best-effort: syncIfDirty() itself swallows sync errors so a backup-DB problem never affects
  // the main app. Not run on startup like alerts — no writes have happened yet, so nothing would
  // be dirty.
  setInterval(() => {
    backupService.syncIfDirty();
  }, BACKUP_SYNC_INTERVAL_MS);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
