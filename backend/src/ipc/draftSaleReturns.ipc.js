// IPC layer: registers ipcMain.handle channels for draft-sale-returns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftSaleReturns.service');
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

  ipcMain.handle(
    'draft-sale-returns:remove',
    wrap((payload) => {
      requireSession();
      return service.remove(payload.id);
    }),
  );

  ipcMain.handle(
    'draft-sale-returns:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );
};
