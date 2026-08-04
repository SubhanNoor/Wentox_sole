// IPC layer: registers ipcMain.handle channels for stages — no business logic, no SQL.
// Read-only lookup: list only, no create/update/remove (see stages.repository.js).
const { ipcMain } = require('electron');
const service = require('../services/stages.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('stages:list', wrap(() => {
    requireSession();
    return service.list();
  }));
};
