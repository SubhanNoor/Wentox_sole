// IPC layer: registers ipcMain.handle channels for sale-bills — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/saleBills.service');
const authService = require('../services/auth.service');
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

  // Editing a DRAFT bill needs no password (nothing posted yet). Editing a CONFIRMED bill
  // reverses+reapplies its live ledger/stock in the same update() call (see saleBills.service.js),
  // so the password is required only in that branch — checked here, before the write, once we
  // know the bill's current status.
  ipcMain.handle(
    'sale-bills:update',
    wrap(async (payload) => {
      const session = requireSession();
      const existing = await service.getById(payload.id);
      if (existing.is_posted) {
        await authService.verifyPassword(session.userId, payload.password);
      }
      return service.update(payload.id, payload);
    }),
  );

  // Save/confirm — re-verifies the logged-in user's password before posting.
  ipcMain.handle(
    'sale-bills:post',
    wrap(async (payload) => {
      const session = requireSession();
      await authService.verifyPassword(session.userId, payload.password);
      return service.post(payload.id);
    }),
  );

  // Standalone unpost (not part of the edit flow — editing a CONFIRMED bill now
  // reverses+reapplies internally within update()).
  ipcMain.handle(
    'sale-bills:unpost',
    wrap((payload) => {
      requireSession();
      return service.unpost(payload.id);
    }),
  );
};
