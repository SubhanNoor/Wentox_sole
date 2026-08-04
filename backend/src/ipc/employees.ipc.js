// IPC layer: registers ipcMain.handle channels for employees — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/employees.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('employees:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('employees:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('employees:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  // Rejects an employee_type change outright (payroll.md §7) — see employees.service.js:update().
  ipcMain.handle('employees:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('employees:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('employees:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
