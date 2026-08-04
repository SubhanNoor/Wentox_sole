// IPC layer: registers ipcMain.handle channels for addas — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/addas.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('addas:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('addas:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('addas:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('addas:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  // Blocked (409) if referenced by any sale bill/return or their drafts — deactivate instead
  // (UC-14).
  ipcMain.handle('addas:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('addas:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
