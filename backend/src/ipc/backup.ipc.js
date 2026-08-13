// IPC layer for the backup-DB sync — no repository, no SQL here (backup.service.js talks to SQL
// Server directly since this is server-admin DDL/BACKUP/RESTORE, not app-table CRUD). Admin-only:
// syncing/knowing sync status isn't something a non-admin needs.
const { ipcMain, dialog, BrowserWindow } = require('electron');
const service = require('../services/backup.service');
const { setExternalBackupFolder, getExternalBackupFolder } = require('../config/appConfig');
const { wrap } = require('./wrap');
const { requireRole } = require('./session');

module.exports = function register() {
  ipcMain.handle('backup:runNow', wrap(() => {
    requireRole('ADMIN');
    return service.sync();
  }));

  ipcMain.handle('backup:status', wrap(() => {
    requireRole('ADMIN');
    return service.status();
  }));

  ipcMain.handle('backup:runExternal', wrap(() => {
    requireRole('ADMIN');
    return service.backupToExternal();
  }));

  // Folder picker rather than a typed path: the drive letter changes between machines and between
  // plug-ins, and a typo here only surfaces minutes later as a failed backup. Pure main-process
  // orchestration, so there's nothing for a service layer to add — same reasoning as
  // reports.ipc.js's export-pdf handler, and the same access to `event` (wrap.js calls handlers as
  // (payload, event)).
  ipcMain.handle('backup:chooseExternalFolder', wrap(async (_payload, event) => {
    requireRole('ADMIN');
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose the folder on your external drive',
      defaultPath: getExternalBackupFolder() || undefined,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Use this folder',
    });
    if (canceled || !filePaths?.length) return { canceled: true };

    setExternalBackupFolder(filePaths[0]);
    return { canceled: false, folder: filePaths[0] };
  }));
};
