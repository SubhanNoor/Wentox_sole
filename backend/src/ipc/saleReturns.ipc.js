// IPC layer: registers ipcMain.handle channels for sale-returns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/saleReturns.service');
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

  // Posted returns can't be edited (service.update rejects them) — Un Post first.
  ipcMain.handle(
    'sale-returns:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  // Posting needs NO password (per explicit client instruction).
  ipcMain.handle(
    'sale-returns:post',
    wrap(async (payload) => {
      requireSession();
      return service.post(payload.id);
    }),
  );

  // Standalone unpost (removes the ledger/stock rows but leaves the row in sale_returns).
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
