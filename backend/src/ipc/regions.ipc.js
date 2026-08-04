// IPC layer: registers ipcMain.handle channels for regions — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/regions.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('regions:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('regions:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('regions:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('regions:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('regions:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('regions:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
