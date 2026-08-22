// IPC layer: registers ipcMain.handle channels for receipts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/receipts.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('receipts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('receipts:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('receipts:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Blocked once posted (must unpost first) — same as purchases:update, no password guard.
  ipcMain.handle('receipts:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId, session);
  }));

  // RJ-06: password required — a deletion is irreversible and must be deliberate.
  ipcMain.handle('receipts:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('receipts:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session);
  }));

  ipcMain.handle('receipts:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session);
  }));

  // "Unpost" now moves the receipt back to draft_receipts — the real table strictly never holds an
  // unposted document. Every guard receipts:unpost applies still applies (a cheque already
  // deposited/endorsed is still refused with CHEQUE_IN_USE).
  ipcMain.handle('receipts:unconfirm', wrap((payload) => {
    const session = requireSession();
    return service.unconfirm(payload.id, session);
  }));
};
