// IPC layer: registers ipcMain.handle channels for reports — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/reports.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('reports:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('reports:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('reports:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('reports:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('reports:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
