// IPC layer: registers ipcMain.handle channels for chartAccounts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/chartAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('chartAccounts:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('chartAccounts:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('chartAccounts:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('chartAccounts:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('chartAccounts:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
