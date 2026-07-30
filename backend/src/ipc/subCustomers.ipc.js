// IPC layer: registers ipcMain.handle channels for subCustomers — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/subCustomers.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('subCustomers:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('subCustomers:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('subCustomers:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('subCustomers:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('subCustomers:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
