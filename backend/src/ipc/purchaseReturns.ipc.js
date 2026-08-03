// IPC layer: registers ipcMain.handle channels for purchase-returns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/purchaseReturns.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'purchase-returns:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'purchase-returns:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'purchase-returns:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  // Blocked once posted (must unpost first) — no edit-a-posted-return flow, so no password
  // guard here, unlike Sale Bill/Sale Return.
  ipcMain.handle(
    'purchase-returns:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  ipcMain.handle(
    'purchase-returns:post',
    wrap((payload) => {
      requireSession();
      return service.post(payload.id);
    }),
  );

  ipcMain.handle(
    'purchase-returns:unpost',
    wrap((payload) => {
      requireSession();
      return service.unpost(payload.id);
    }),
  );
};
