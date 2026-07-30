// IPC layer: registers ipcMain.handle channels for expenses — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/expenses.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(milestone): register channels, e.g.:
  // ipcMain.handle('expenses:list', wrap((payload) => { requireSession(); return service.list(payload); }));
  // ipcMain.handle('expenses:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('expenses:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('expenses:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('expenses:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
