// IPC layer: registers ipcMain.handle channels for sale-bills — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/saleBills.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'sale-bills:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  ipcMain.handle(
    'sale-bills:list',
    wrap((payload) => {
      requireSession();
      return service.list(payload);
    }),
  );

  ipcMain.handle(
    'sale-bills:get',
    wrap((payload) => {
      requireSession();
      return service.getById(payload.id);
    }),
  );

  ipcMain.handle(
    'sale-bills:update',
    wrap((payload) => {
      requireSession();
      return service.update(payload.id, payload);
    }),
  );

  ipcMain.handle(
    'sale-bills:post',
    wrap((payload) => {
      requireSession();
      return service.post(payload.id);
    }),
  );

  ipcMain.handle(
    'sale-bills:unpost',
    wrap((payload) => {
      requireSession();
      return service.unpost(payload.id);
    }),
  );
};
