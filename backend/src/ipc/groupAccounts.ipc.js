// IPC layer: registers ipcMain.handle channels for groupAccounts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/groupAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('groupAccounts:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('groupAccounts:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('groupAccounts:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('groupAccounts:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('groupAccounts:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
