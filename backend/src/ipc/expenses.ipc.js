// IPC layer: registers ipcMain.handle channels for expenses — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/expenses.service');
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
    return service.create(payload, session.userId);
  }));

  // Blocked once posted (must unpost first) — same as purchases:update, no password guard.
  ipcMain.handle('expenses:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId);
  }));

  ipcMain.handle('expenses:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('expenses:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId);
  }));

  // CHEQUE_ENDORSED is rejected here (USE_CHEQUE_REVERSAL) — see expenses.service.js#unpost().
  ipcMain.handle('expenses:unpost', wrap((payload) => {
    requireSession();
    return service.unpost(payload.id);
  }));
};
