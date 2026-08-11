// IPC layer: registers ipcMain.handle channels for cheques — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/cheques.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

// No role guard on any channel here, deliberately. UC-03 restricts a USER from exactly two account
// heads — Cash at Banks and Directors Expenses – Drawings — and nothing else; that restriction is
// enforced on the ACCOUNT (businessAccounts.service.js#assertAccessible), which is the only place
// it can't be side-stepped through a different channel.
//
// These six disposal channels briefly carried requireRole('ADMIN') (2026-08-10). That was wrong:
// the rule came from a frontend decision on the old Receipts "Cheques Disposal" tab, not from
// UC-03 or from the client, and hardening it server-side cemented a restriction nobody had asked
// for. It produced a dead end — a USER could take a cheque in through Receipts and then do nothing
// with it — and an incoherent split, since reverse-allocation stayed open, allowing a USER to undo
// an endorsement they were not allowed to make. Confirmed with the client 2026-08-11: a USER is
// restricted to those two account heads and everything under them, and everything else is open.

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
    return service.deposit(payload.id, payload, session.userId, session);
  }));

  ipcMain.handle('cheques:endorse-to-vendor', wrap((payload) => {
    const session = requireSession();
    return service.endorseToVendor(payload.id, payload, session.userId, session);
  }));

  ipcMain.handle('cheques:endorse-to-expense', wrap((payload) => {
    const session = requireSession();
    return service.endorseToExpense(payload.id, payload, session.userId, session);
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

  // Full allocation history for one cheque's receipt (Cheques tab's per-cheque history view).
  ipcMain.handle('cheques:allocations-for-receipt', wrap((payload) => {
    requireSession();
    return service.listAllocationsForReceipt(payload.receipt_id);
  }));
};
