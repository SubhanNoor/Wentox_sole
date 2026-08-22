// IPC layer: registers ipcMain.handle channels for draft-sale-bills — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftSaleBills.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'draft-sale-bills:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'draft-sale-bills:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'draft-sale-bills:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  // Password required unconditionally — deleting is destructive with no reverse-never-erase
  // trail, same guard level SaleBillPage uses for editing an already-posted bill (SB-06-follow-up:
  // this is now the ONLY way to delete a saved-unposted bill, not just a genuinely incomplete one).
  ipcMain.handle(
    'draft-sale-bills:remove',
    wrap(async (payload) => {
      const session = requireSession();
      await authService.verifyPassword(session.userId, payload.password);
      return service.remove(payload.id);
    }),
  );

  // Editing a draft — now the normal "edit a saved-unposted bill" path, not just for genuinely
  // incomplete entries, since every saved-unposted bill lives here.
  ipcMain.handle(
    'draft-sale-bills:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  ipcMain.handle(
    'draft-sale-bills:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );

  // Post All — every draft awaiting posting, in one action. Resolves { posted, failed, attempted }
  // — a partial failure is a SUCCESSFUL result carrying a failure list, not a rejection.
  ipcMain.handle(
    'draft-sale-bills:confirmAll',
    wrap((payload) => {
      const session = requireSession();
      return service.confirmAll(payload?.ids, session.userId);
    }),
  );
};
