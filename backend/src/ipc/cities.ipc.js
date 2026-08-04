// IPC layer: registers ipcMain.handle channels for cities — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/cities.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('cities:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('cities:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('cities:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('cities:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('cities:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('cities:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
