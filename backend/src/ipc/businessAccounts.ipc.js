// IPC layer: registers ipcMain.handle channels for businessAccounts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/businessAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // Read-only listing for "any business account" pickers (Expenses' non-vendor payment target,
  // Cheques' EXPENSE_PAYMENT disposition). create/update/remove stay unregistered — no UI needs
  // direct business-account CRUD yet (accounts are still only created via a party's own setup page,
  // e.g. vendors/customers/bankAccounts).
  ipcMain.handle('business-accounts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  // TODO(milestone): register remaining channels when a direct business-account setup screen exists:
  // ipcMain.handle('business-accounts:get', wrap((payload) => { requireSession(); return service.getById(payload.id); }));
  // ipcMain.handle('business-accounts:create', wrap((payload) => { requireSession(); return service.create(payload); }));
  // ipcMain.handle('business-accounts:update', wrap((payload) => { requireSession(); return service.update(payload.id, payload); }));
  // ipcMain.handle('business-accounts:remove', wrap((payload) => { requireSession(); return service.remove(payload.id); }));
};
