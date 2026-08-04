// IPC layer: registers ipcMain.handle channels for bankAccounts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/bankAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('bank-accounts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('bank-accounts:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('bank-accounts:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('bank-accounts:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('bank-accounts:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('bank-accounts:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
