// IPC layer: registers ipcMain.handle channels for draft-purchase-returns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftPurchaseReturns.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'draft-purchase-returns:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'draft-purchase-returns:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'draft-purchase-returns:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  // Password required unconditionally — same guard as draft-purchases:remove.
  ipcMain.handle(
    'draft-purchase-returns:remove',
    wrap(async (payload) => {
      const session = requireSession();
      await authService.verifyPassword(session.userId, payload.password);
      return service.remove(payload.id);
    }),
  );

  // Editing a draft — the normal "edit a saved-unposted return" path now.
  ipcMain.handle(
    'draft-purchase-returns:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  ipcMain.handle(
    'draft-purchase-returns:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );

  // Post All — every draft awaiting posting, in one action.
  ipcMain.handle(
    'draft-purchase-returns:confirmAll',
    wrap((payload) => {
      const session = requireSession();
      return service.confirmAll(payload?.ids, session.userId);
    }),
  );
};
