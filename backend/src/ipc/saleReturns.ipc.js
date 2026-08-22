// IPC layer: registers ipcMain.handle channels for sale-returns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/saleReturns.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'sale-returns:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'sale-returns:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'sale-returns:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  // Editing a DRAFT return needs no password (nothing posted yet). Editing a CONFIRMED return
  // reverses+reapplies its live ledger/stock in the same update() call (see saleReturns.service.js),
  // so the password is required only in that branch — checked here, before the write, once we
  // know the return's current status.
  ipcMain.handle(
    'sale-returns:update',
    wrap(async (payload) => {
      const session = requireSession();
      const existing = await service.getById(payload.id);
      if (existing.is_posted) {
        await authService.verifyPassword(session.userId, payload.password);
      }
      return service.update(payload.id, payload);
    }),
  );

  // Posting needs NO password (per explicit client instruction). Editing an ALREADY-POSTED
  // return still does — see update() above — because that silently reverses and reapplies a live
  // ledger and stock effect, which is the destructive case the guard was there for. Posting a
  // return you have just reviewed on screen is not.
  ipcMain.handle(
    'sale-returns:post',
    wrap(async (payload) => {
      requireSession();
      return service.post(payload.id);
    }),
  );

  // Standalone unpost (not part of the edit flow — editing a CONFIRMED return now
  // reverses+reapplies internally within update()).
  ipcMain.handle(
    'sale-returns:unpost',
    wrap((payload) => {
      requireSession();
      return service.unpost(payload.id);
    }),
  );

  // "Unpost" now moves the return back to draft_sale_returns — the real table strictly never
  // holds an unposted document. Resolves the new draft row, not a SaleReturnRow.
  ipcMain.handle(
    'sale-returns:unconfirm',
    wrap((payload) => {
      requireSession();
      return service.unconfirm(payload.id);
    }),
  );
};
