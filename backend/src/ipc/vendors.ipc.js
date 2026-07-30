// IPC layer: registers ipcMain.handle channels for vendors — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/vendors.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('vendors:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('vendors:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('vendors:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('vendors:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('vendors:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
