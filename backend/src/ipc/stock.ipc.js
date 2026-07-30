// IPC layer: registers ipcMain.handle channels for stock — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/stock.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('stock:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('stock:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('stock:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('stock:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('stock:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
