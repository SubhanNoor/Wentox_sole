// IPC layer: registers ipcMain.handle channels for stores — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/stores.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('stores:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('stores:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('stores:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('stores:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('stores:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
