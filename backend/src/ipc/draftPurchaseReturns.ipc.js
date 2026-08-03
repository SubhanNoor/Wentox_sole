// IPC layer: registers ipcMain.handle channels for draft-purchase-returns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftPurchaseReturns.service');
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

  ipcMain.handle(
    'draft-purchase-returns:remove',
    wrap((payload) => {
      requireSession();
      return service.remove(payload.id);
    }),
  );

  ipcMain.handle(
    'draft-purchase-returns:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );
};
