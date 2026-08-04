// IPC layer: registers ipcMain.handle channels for wageRuns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/wageRuns.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('wage-runs:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  // "That worker's last three runs for the selected stage" (payroll.md §7) — the frontend calls
  // this as soon as employee_id + stage_key are picked, before any lines are entered.
  ipcMain.handle('wage-runs:recent', wrap((payload) => {
    requireSession();
    return service.recent(payload.employee_id, payload.stage_key);
  }));

  ipcMain.handle('wage-runs:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('wage-runs:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId);
  }));

  // Blocked once posted (must unpost first) — same as purchases:update.
  ipcMain.handle('wage-runs:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId);
  }));

  ipcMain.handle('wage-runs:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('wage-runs:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId);
  }));

  ipcMain.handle('wage-runs:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId);
  }));
};
