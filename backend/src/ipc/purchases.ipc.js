// IPC layer: registers ipcMain.handle channels for purchases — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/purchases.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'purchases:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'purchases:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'purchases:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  // Blocked once posted (must unpost first) — no edit-a-posted-purchase flow, so no password
  // guard here, unlike Sale Bill/Sale Return.
  ipcMain.handle(
    'purchases:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  ipcMain.handle(
    'purchases:post',
    wrap((payload) => {
      requireSession();
      return service.post(payload.id);
    }),
  );

  ipcMain.handle(
    'purchases:unpost',
    wrap((payload) => {
      requireSession();
      return service.unpost(payload.id);
    }),
  );
};
