// IPC layer: registers ipcMain.handle channels for categories — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/categories.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('categories:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('categories:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('categories:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('categories:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('categories:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
