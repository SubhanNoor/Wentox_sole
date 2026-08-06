// IPC layer: registers ipcMain.handle channels for accountClasses — no business logic, no SQL.
// Channel prefix is kebab-case ('account-classes') to match preload.js's camelToKebab(feature).
const { ipcMain } = require('electron');
const service = require('../services/accountClasses.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('account-classes:list', wrap(() => {
    requireSession();
    return service.list();
  }));

  ipcMain.handle('account-classes:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));
};
