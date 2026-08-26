const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');
const registerIpcHandlers = require('../src/ipc');
const alertsService = require('../src/services/alerts.service');
const backupService = require('../src/services/backup.service');
const migrate = require('../src/db/migrate');
const seed = require('../src/db/seeds/run');

// package.json's "name" (wentox-backend) is an npm package name, not a user-facing product name —
// without this, app.getPath('userData') (where appConfig.js reads the installer-chosen backup
// path from) would resolve to %APPDATA%\wentox-backend instead of the %APPDATA%\Wentox the NSIS
// installer script writes to. Must run before app.whenReady()/any getPath() call.
app.setName('Wentox');

// Forces Chromium's UI locale for this whole renderer to en-GB, so every native <input
// type="date"> picker displays dd/mm/yyyy — the OS/Chromium default locale here is en-US
// (mm/dd/yyyy), and a per-element `lang` attribute does NOT override a native date input's
// displayed format in Electron/Chromium, only this process-wide switch does. Must be set before
// app.whenReady()/any window is created.
app.commandLine.appendSwitch('lang', 'en-GB');

// Electron's DEFAULT menu carries zoomIn/zoomOut/resetZoom roles on Ctrl +/-/0, which conflicted
// with the app's own zoom (ZoomControl.tsx -> the zoom:set channel) — a single keypress fired both
// paths, so the window jumped two steps and the percentage shown on screen stopped matching the
// window it described. This app.whenReady() below now clears the application menu entirely
// (Menu.setApplicationMenu(null), 2026-08-26 — see that comment), which removes that conflict too.
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

app.whenReady().then(async () => {
  // A fresh install's SQL Server has no schema/admin user at all yet — both are idempotent
  // (migrate tracks dbo.schema_migrations, seed does existence checks per row), so running them
  // on every startup is safe and is what makes a first-ever launch self-sufficient: create schema
  // → seed the default admin (admin/admin123) and reserved chart accounts → THEN open the window,
  // so login always has something to authenticate against. If the SQL Server the installer was
  // pointed at isn't reachable yet (e.g. set up after install, before its first real launch),
  // this fails loudly to the console but still opens the window rather than block the app
  // entirely — login will just fail with a real connection error instead of a confusing hang.
  try {
    await migrate();
    await seed();
  } catch (err) {
    console.error('Startup migrate/seed failed — is SQL Server reachable?', err);
  }

  registerIpcHandlers(); // every ipcMain.handle channel must exist before the renderer can call one

  // No application menu at all (2026-08-26, explicit request) — the Edit/View/Window bar `buildMenu()`
  // used to build is gone from the window entirely. Ctrl+C/V/X/A and Ctrl+Z/Y still work inside text
  // inputs regardless (Chromium handles those natively at the input-field level, not through the app
  // menu's Edit roles); the only things actually lost are Reload/Toggle DevTools/Fullscreen from a
  // menu bar — DevTools is still reachable via F12/Ctrl+Shift+I, which Electron registers independent
  // of any application menu.
  Menu.setApplicationMenu(null);

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

  // Creates the backup database on first ever launch so the folder the user picked at install
  // isn't just empty (it only ever appeared on the first dirty timer tick before, i.e. often
  // never). No-ops once it exists. Not awaited — the window shouldn't wait on a full
  // BACKUP/RESTORE, and it swallows its own errors.
  backupService.ensureInitialBackup();

  // Best-effort: syncIfDirty() itself swallows sync errors so a backup-DB problem never affects
  // the main app.
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
