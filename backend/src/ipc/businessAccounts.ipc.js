// IPC layer: registers ipcMain.handle channels for businessAccounts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/businessAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('businessAccounts:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('businessAccounts:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('businessAccounts:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('businessAccounts:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('businessAccounts:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
