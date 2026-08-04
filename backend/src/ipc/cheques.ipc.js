// IPC layer: registers ipcMain.handle channels for cheques — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/cheques.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('cheques:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('cheques:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('cheques:deposit', wrap((payload) => {
    const session = requireSession();
    return service.deposit(payload.id, payload, session.userId);
  }));

  ipcMain.handle('cheques:endorse-to-vendor', wrap((payload) => {
    const session = requireSession();
    return service.endorseToVendor(payload.id, payload, session.userId);
  }));

  ipcMain.handle('cheques:endorse-to-expense', wrap((payload) => {
    const session = requireSession();
    return service.endorseToExpense(payload.id, payload, session.userId);
  }));

  ipcMain.handle('cheques:mark-cleared', wrap((payload) => {
    requireSession();
    return service.markCleared(payload.id);
  }));

  ipcMain.handle('cheques:bounce', wrap((payload) => {
    const session = requireSession();
    return service.bounce(payload.id, payload, session.userId);
  }));

  // "Returned to sender" — distinct from a bank bounce (see cheques.service.js#returnToSender).
  ipcMain.handle('cheques:return-to-sender', wrap((payload) => {
    const session = requireSession();
    return service.returnToSender(payload.id, payload, session.userId);
  }));

  // "Cheque Return" page — list of endorsed (VENDOR_PAYMENT/EXPENSE_PAYMENT) allocations that
  // could still be undone one at a time, and the action to undo one.
  ipcMain.handle('cheques:endorsed-allocations', wrap((payload) => {
    requireSession();
    return service.listEndorsedAllocations(payload);
  }));

  ipcMain.handle('cheques:reverse-allocation', wrap((payload) => {
    const session = requireSession();
    return service.reverseAllocation(payload.id, payload, session.userId);
  }));
};
