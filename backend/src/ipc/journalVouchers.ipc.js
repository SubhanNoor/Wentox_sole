// IPC layer: registers ipcMain.handle channels for journal vouchers — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/journalVouchers.service');
const authService = require('../services/auth.service');
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

  // Pending Posting sidebar's Delete (unposted JVs only — service.remove() throws on a posted
  // one). Password required unconditionally, same guard as Sale Bill/Purchase's unposted delete —
  // this is destructive with no undo trail, unlike unposting/posting.
  ipcMain.handle('journal-vouchers:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
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

  // The entry form's smart-default counter-account (see reservedAccounts.js).
  ipcMain.handle('journal-vouchers:counterAccount', wrap(() => {
    requireSession();
    return service.getCounterAccount();
  }));
};
