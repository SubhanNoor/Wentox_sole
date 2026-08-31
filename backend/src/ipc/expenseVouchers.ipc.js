// IPC layer: registers ipcMain.handle channels for payment (Naam) vouchers (PN-01) — no business logic,
// no SQL. Entry LINES are created/edited/deleted through the existing 'expenses:*' channels with a
// voucher_id on the payload; this feature owns the header and the whole-voucher operations.
const { ipcMain } = require('electron');
const service = require('../services/expenseVouchers.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('expense-vouchers:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('expense-vouchers:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  // Opens an empty voucher and allocates its C.Book No. Lines are added afterwards.
  ipcMain.handle('expense-vouchers:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId);
  }));

  // Header only (date/remarks). Blocked once anything on the voucher is posted.
  ipcMain.handle('expense-vouchers:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId);
  }));

  // Posts every line. RESOLVES with { voucher, posted, failed, attempted } — each line posts in its
  // own transaction, so a partial failure is a SUCCESSFUL result carrying a failure list. Callers
  // must read `failed`; ok:true does not mean the whole voucher posted.
  ipcMain.handle('expense-vouchers:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session);
  }));

  // Reverses every posted line, with the same per-line reporting as post().
  ipcMain.handle('expense-vouchers:unpost', wrap((payload) => {
    const session = requireSession();
    // reverse_endorsement: the caller has confirmed with the operator that undoing this voucher
    // also undoes a cheque endorsement it made. Absent/false keeps the old refusal.
    return service.unpost(payload.id, session, { reverseEndorsement: payload.reverse_endorsement === true });
  }));

  // Password required, matching 'expenses:remove' (RJ-06/PN-01) — this deletes the header AND every line
  // under it, so it is strictly more destructive than deleting a single entry.
  ipcMain.handle('expense-vouchers:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));
};
