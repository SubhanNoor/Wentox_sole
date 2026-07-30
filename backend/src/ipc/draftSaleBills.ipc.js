// IPC layer: registers ipcMain.handle channels for draft-sale-bills — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftSaleBills.service');
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

  ipcMain.handle(
    'draft-sale-bills:remove',
    wrap((payload) => {
      requireSession();
      return service.remove(payload.id);
    }),
  );

  ipcMain.handle(
    'draft-sale-bills:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );
};
