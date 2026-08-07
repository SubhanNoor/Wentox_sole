// IPC layer for the backup-DB sync — no repository, no SQL here (backup.service.js talks to SQL
// Server directly since this is server-admin DDL/BACKUP/RESTORE, not app-table CRUD). Admin-only:
// syncing/knowing sync status isn't something a non-admin needs.
const { ipcMain } = require('electron');
const service = require('../services/backup.service');
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
};
