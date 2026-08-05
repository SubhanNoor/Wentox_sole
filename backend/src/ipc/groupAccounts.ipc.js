// IPC layer: registers ipcMain.handle channels for groupAccounts — no business logic, no SQL.
// Channel prefix is kebab-case ('group-accounts') to match preload.js's camelToKebab(feature).
const { ipcMain } = require('electron');
const service = require('../services/groupAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('group-accounts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('group-accounts:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('group-accounts:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('group-accounts:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('group-accounts:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('group-accounts:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
