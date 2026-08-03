// IPC layer: registers ipcMain.handle channels for customers — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/customers.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('customers:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('customers:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('customers:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('customers:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('customers:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));
};
