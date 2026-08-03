// IPC layer: registers ipcMain.handle channels for subCustomers — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/subCustomers.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('sub-customers:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('sub-customers:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  // Also the target of the Sale Bill form's inline "+ Add Sub-Customer" flow — no separate
  // customer-scoped channel needed since sub-customers have no parent (UC-10).
  ipcMain.handle('sub-customers:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('sub-customers:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('sub-customers:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));
};
