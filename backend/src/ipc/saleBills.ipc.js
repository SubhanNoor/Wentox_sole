// IPC layer: registers ipcMain.handle channels for saleBills — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/saleBills.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('saleBills:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('saleBills:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('saleBills:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('saleBills:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('saleBills:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
