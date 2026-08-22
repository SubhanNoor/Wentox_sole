// IPC layer: registers ipcMain.handle channels for draft-sale-returns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftSaleReturns.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'draft-sale-returns:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'draft-sale-returns:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'draft-sale-returns:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  // Password required unconditionally — same guard as draft-sale-bills:remove: deleting any
  // saved-unposted return is destructive with no reverse-never-erase trail.
  ipcMain.handle(
    'draft-sale-returns:remove',
    wrap(async (payload) => {
      const session = requireSession();
      await authService.verifyPassword(session.userId, payload.password);
      return service.remove(payload.id);
    }),
  );

  // Editing a draft — the normal "edit a saved-unposted return" path now, not just for genuinely
  // incomplete entries.
  ipcMain.handle(
    'draft-sale-returns:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  ipcMain.handle(
    'draft-sale-returns:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );

  // Post All — every draft awaiting posting, in one action. Resolves { posted, failed, attempted }.
  ipcMain.handle(
    'draft-sale-returns:confirmAll',
    wrap((payload) => {
      const session = requireSession();
      return service.confirmAll(payload?.ids, session.userId);
    }),
  );
};
