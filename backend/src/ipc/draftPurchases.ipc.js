// IPC layer: registers ipcMain.handle channels for draft-purchases — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftPurchases.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'draft-purchases:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'draft-purchases:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'draft-purchases:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  // Password required unconditionally — same guard as draft-sale-bills:remove.
  ipcMain.handle(
    'draft-purchases:remove',
    wrap(async (payload) => {
      const session = requireSession();
      await authService.verifyPassword(session.userId, payload.password);
      return service.remove(payload.id);
    }),
  );

  // Editing a draft — the normal "edit a saved-unposted purchase" path now.
  ipcMain.handle(
    'draft-purchases:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  ipcMain.handle(
    'draft-purchases:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );

  // Post All — every draft awaiting posting, in one action.
  ipcMain.handle(
    'draft-purchases:confirmAll',
    wrap((payload) => {
      const session = requireSession();
      return service.confirmAll(payload?.ids, session.userId);
    }),
  );
};
