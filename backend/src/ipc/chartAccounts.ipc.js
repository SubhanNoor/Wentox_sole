// IPC layer: registers ipcMain.handle channels for chartAccounts — no business logic, no SQL.
// Channel prefix is kebab-case ('chart-accounts') to match preload.js's camelToKebab(feature).
const { ipcMain } = require('electron');
const service = require('../services/chartAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('chart-accounts:list', wrap((payload) => {
    const session = requireSession();
    return service.list(payload, session);
  }));

  ipcMain.handle('chart-accounts:get', wrap((payload) => {
    const session = requireSession();
    return service.getById(payload.id, session);
  }));

  ipcMain.handle('chart-accounts:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('chart-accounts:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  // "Remove" = close (status CLOSED) — see chartAccounts.service.js#remove(); there is no hard
  // delete for this table.
  ipcMain.handle('chart-accounts:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('chart-accounts:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
