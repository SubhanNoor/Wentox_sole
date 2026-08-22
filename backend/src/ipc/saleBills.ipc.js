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

  // Editing a not-yet-posted bill needs no password. Editing an already-posted bill
  // reverses+reapplies its live ledger/stock in the same update() call (see saleBills.service.js),
  // so the password is required only in that branch — checked here, before the write, once we
  // know whether the bill is currently posted (`is_posted`, derived from ledger_entries — there's
  // no stored status column).
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

  // Posting needs NO password (per explicit client instruction). Editing an ALREADY-POSTED
  // bill still does — see update() above — because that silently reverses and reapplies a live
  // ledger and stock effect, which is the destructive case the guard was there for. Posting a
  // bill you have just reviewed on screen is not.
  ipcMain.handle(
    'sale-bills:post',
    wrap(async (payload) => {
      requireSession();
      return service.post(payload.id);
    }),
  );

  // Standalone unpost (not part of the edit flow — editing an already-posted bill now
  // reverses+reapplies internally within update()). Kept for backward compatibility but no
  // longer used by the frontend's normal flow — see unconfirm below, which is what "Unpost" now
  // actually does (moves the bill back to draft_sale_bills instead of just clearing its ledger).
  ipcMain.handle(
    'sale-bills:unpost',
    wrap((payload) => {
      requireSession();
      return service.unpost(payload.id);
    }),
  );

  // "Unpost" now means the bill goes back to being a draft — the real table strictly never holds
  // an unposted document. Resolves the new draft row (not a SaleBillRow), so the frontend must
  // treat the result as a draft going forward, not the same bill still sitting in sale_bills.
  ipcMain.handle(
    'sale-bills:unconfirm',
    wrap((payload) => {
      requireSession();
      return service.unconfirm(payload.id);
    }),
  );

  // Pending Posting sidebar's Delete (unposted bills only — service.remove() throws on a posted
  // one). Password required unconditionally, same guard as editing an already-posted bill — this
  // is destructive with no undo trail, unlike unposting/posting.
  ipcMain.handle(
    'sale-bills:remove',
    wrap(async (payload) => {
      const session = requireSession();
      await authService.verifyPassword(session.userId, payload.password);
      return service.remove(payload.id);
    }),
  );

  // UC-20: Search & Bilty/Adda Updation. Action names stay camelCase (not kebab-case) — the
  // preload Proxy passes the JS property access straight through as the action segment with no
  // case conversion, so this must match window.api.saleBills.biltySearch(...)/.updateBilty(...)
  // exactly (same convention documented in auth.ipc.js).
  ipcMain.handle(
    'sale-bills:biltySearch',
    wrap((payload) => {
      requireSession();
      return service.biltySearch(payload);
    }),
  );

  // bilty_no + adda_id only, non-financial — no password guard, works regardless of posted status.
  ipcMain.handle(
    'sale-bills:updateBilty',
    wrap((payload) => {
      requireSession();
      return service.updateBiltyInfo(payload.id, payload);
    }),
  );

  // SB-06: the bills still awaiting posting, for the Post All confirmation list.
  ipcMain.handle(
    'sale-bills:listUnposted',
    wrap(() => {
      requireSession();
      return service.listUnposted();
    }),
  );

  // SB-06: post a run of bills in one action. Resolves { posted, failed, attempted } — a partial
  // failure is a SUCCESSFUL result carrying a failure list, not a rejection, so the caller must
  // read `failed` rather than treating ok:true as "everything posted".
  ipcMain.handle(
    'sale-bills:postAll',
    wrap((payload) => {
      requireSession();
      return service.postAll(payload?.ids);
    }),
  );

  // SR-01: Sale Return prefills a line's rate from this instead of the article's current
  // predefined sale_price.
  ipcMain.handle(
    'sale-bills:lastSoldRate',
    wrap((payload) => {
      requireSession();
      return service.lastSoldRate(payload.customer_id, payload.variant_id);
    }),
  );
};
