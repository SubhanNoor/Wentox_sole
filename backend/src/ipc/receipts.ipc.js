// IPC layer: registers ipcMain.handle channels for receipts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/receipts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('receipts:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('receipts:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('receipts:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('receipts:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('receipts:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
