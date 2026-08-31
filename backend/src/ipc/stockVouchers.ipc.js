// IPC layer: registers ipcMain.handle channels for stock vouchers — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/stockVouchers.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('stock-vouchers:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('stock-vouchers:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('stock-vouchers:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId);
  }));

  // Blocked once posted (must unpost first) — same as journal-vouchers:update.
  ipcMain.handle('stock-vouchers:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  // Pending Posting sidebar's Delete (unposted stock vouchers only — service.remove() throws on a
  // posted one). Password required unconditionally, same guard as Sale Bill/Purchase/JV's unposted
  // delete — this is destructive with no undo trail, unlike unposting/posting.
  ipcMain.handle('stock-vouchers:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('stock-vouchers:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId);
  }));

  ipcMain.handle('stock-vouchers:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId);
  }));

  // Every stock voucher still awaiting posting, for the Post All confirmation list.
  ipcMain.handle('stock-vouchers:listUnposted', wrap(() => {
    requireSession();
    return service.listUnposted();
  }));

  // Post a run of stock vouchers in one action. Resolves { posted, failed, attempted } — a partial
  // failure is a SUCCESSFUL result carrying a failure list, so the caller must read `failed`.
  ipcMain.handle('stock-vouchers:postAll', wrap((payload) => {
    const session = requireSession();
    return service.postAll(payload?.ids, session.userId);
  }));

  // Per-variant cartons/pairs already sitting in OTHER draft vouchers — the entry strip's Stock
  // in Hand readout subtracts these from real stock, per the user (2026-08-31).
  ipcMain.handle('stock-vouchers:unpostedReservations', wrap((payload) => {
    requireSession();
    return service.unpostedReservations(payload?.excludeStockVoucherId);
  }));
};
