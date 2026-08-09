// IPC layer: registers ipcMain.handle channels for cheques — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/cheques.service');
const { wrap } = require('./wrap');
const { requireSession, requireRole } = require('./session');

// UC-03 point 3: "The API enforces the same rule server-side; hiding a nav item is never the only
// guard." The six disposal actions below were ADMIN-only on screen and nowhere else — the Cheque
// page filters the Disposal tab out for role 'User', but every channel accepted any logged-in
// session. Now the lock is real.
// Deliberately NOT applied to the Returns actions (reverse-allocation, and expenses'
// bounce/return of an issued cheque): role 'User' can do those today, could before the Cheque page
// existed, and locking them would remove working behaviour rather than close a gap.

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
    const session = requireRole('ADMIN');
    return service.deposit(payload.id, payload, session.userId);
  }));

  ipcMain.handle('cheques:endorse-to-vendor', wrap((payload) => {
    const session = requireRole('ADMIN');
    return service.endorseToVendor(payload.id, payload, session.userId);
  }));

  ipcMain.handle('cheques:endorse-to-expense', wrap((payload) => {
    const session = requireRole('ADMIN');
    return service.endorseToExpense(payload.id, payload, session.userId);
  }));

  ipcMain.handle('cheques:mark-cleared', wrap((payload) => {
    requireRole('ADMIN');
    return service.markCleared(payload.id);
  }));

  ipcMain.handle('cheques:bounce', wrap((payload) => {
    const session = requireRole('ADMIN');
    return service.bounce(payload.id, payload, session.userId);
  }));

  // "Returned to sender" — distinct from a bank bounce (see cheques.service.js#returnToSender).
  ipcMain.handle('cheques:return-to-sender', wrap((payload) => {
    const session = requireRole('ADMIN');
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

  // Full allocation history for one cheque's receipt (Cheques tab's per-cheque history view).
  ipcMain.handle('cheques:allocations-for-receipt', wrap((payload) => {
    requireSession();
    return service.listAllocationsForReceipt(payload.receipt_id);
  }));
};
