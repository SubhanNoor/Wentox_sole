// IPC layer: registers ipcMain.handle channels for draft-purchases — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftPurchases.service');
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

  ipcMain.handle(
    'draft-purchases:remove',
    wrap((payload) => {
      requireSession();
      return service.remove(payload.id);
    }),
  );

  ipcMain.handle(
    'draft-purchases:confirm',
    wrap((payload) => {
      const session = requireSession();
      return service.confirm(payload.id, session.userId);
    }),
  );
};
