// IPC layer: registers ipcMain.handle channels for draftReceipts — no business logic, no SQL.
//
// This is the channel every NEW receipt now comes in through: an unposted receipt lives in
// dbo.draft_receipts and only moves into dbo.receipts when it is posted (confirm). All three
// payment modes are supported here since migration 024.
const { ipcMain } = require('electron');
const service = require('../services/draftReceipts.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('draft-receipts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('draft-receipts:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('draft-receipts:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Editing an unposted receipt — the normal edit path now.
  ipcMain.handle('draft-receipts:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId, session);
  }));

  // RJ-06: password required, matching 'receipts:remove' — a deletion is irreversible and must be
  // deliberate. (The old draft-receipts:remove had no guard, back when a draft only ever meant a
  // genuinely incomplete scratch entry; it is now where every unposted receipt lives.)
  ipcMain.handle('draft-receipts:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('draft-receipts:confirm', wrap((payload) => {
    const session = requireSession();
    return service.confirm(payload.id, session.userId, session);
  }));
};
