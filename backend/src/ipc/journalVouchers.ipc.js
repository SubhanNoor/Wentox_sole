// IPC layer: registers ipcMain.handle channels for journal vouchers — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/journalVouchers.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('journal-vouchers:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('journal-vouchers:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('journal-vouchers:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Blocked once posted (must unpost first) — same as settlements:update.
  ipcMain.handle('journal-vouchers:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session);
  }));

  ipcMain.handle('journal-vouchers:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('journal-vouchers:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId, session);
  }));

  ipcMain.handle('journal-vouchers:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId, session);
  }));

  // The JVs still awaiting posting, for the Post All confirmation list.
  ipcMain.handle('journal-vouchers:listUnposted', wrap(() => {
    requireSession();
    return service.listUnposted();
  }));

  // Post a run of JVs in one action. Resolves { posted, failed, attempted } — a partial failure
  // is a SUCCESSFUL result carrying a failure list, so the caller must read `failed`.
  ipcMain.handle('journal-vouchers:postAll', wrap((payload) => {
    const session = requireSession();
    return service.postAll(payload?.ids, session.userId, session);
  }));
};
