// IPC layer: registers ipcMain.handle channels for expenses — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/expenses.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('expenses:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('expenses:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('expenses:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Blocked once posted (must unpost first) — same as purchases:update, no password guard.
  ipcMain.handle('expenses:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId, session);
  }));

  // PN-01/RJ-06: password required — a deletion is irreversible and must be deliberate.
  ipcMain.handle('expenses:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('expenses:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId, session);
  }));

  // CHEQUE_ENDORSED is rejected here (USE_CHEQUE_REVERSAL) — see expenses.service.js#unpost().
  // "Unpost" now moves the expense back to draft_expenses — the real table strictly never holds an
  // unposted document. Every guard expenses:unpost applies still applies: CHEQUE_ENDORSED is still
  // refused (USE_CHEQUE_REVERSAL — bounce/return the cheque itself), and a CHEQUE_ISSUED cheque
  // that has already bounced/been returned is still refused (ISSUED_CHEQUE_TERMINAL).
  ipcMain.handle('expenses:unconfirm', wrap((payload) => {
    const session = requireSession();
    return service.unconfirm(payload.id, session);
  }));

  ipcMain.handle('expenses:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session);
  }));

  // "Cheque Return" page — a cheque WE wrote (CHEQUE_ISSUED) bouncing or being handed back unpaid.
  // Action names stay camelCase to match window.api.expenses.bounceIssuedCheque(...) /
  // .returnIssuedCheque(...) / .returnableIssuedCheques(...) exactly (only the feature prefix gets
  // camelToKebab'd — see preload.js).
  ipcMain.handle('expenses:bounceIssuedCheque', wrap((payload) => {
    const session = requireSession();
    return service.bounceIssuedCheque(payload.id, payload, session.userId);
  }));

  ipcMain.handle('expenses:returnIssuedCheque', wrap((payload) => {
    const session = requireSession();
    return service.returnIssuedCheque(payload.id, payload, session.userId);
  }));

  ipcMain.handle('expenses:returnableIssuedCheques', wrap((payload) => {
    requireSession();
    return service.listReturnableIssuedCheques(payload);
  }));

  // "Cheque" page's Ledger tab — every issued cheque regardless of status.
  ipcMain.handle('expenses:issuedCheques', wrap((payload) => {
    requireSession();
    return service.listIssuedCheques(payload);
  }));
};
