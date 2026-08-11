// IPC layer: registers ipcMain.handle channels for reports — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/reports.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('reports:stock', wrap((payload) => {
    requireSession();
    return service.stock(payload);
  }));

  ipcMain.handle('reports:production', wrap((payload) => {
    requireSession();
    return service.production(payload);
  }));

  ipcMain.handle('reports:product-ledger', wrap((payload) => {
    requireSession();
    return service.productLedger(payload);
  }));

  ipcMain.handle('reports:vendor-stock', wrap(() => {
    requireSession();
    return service.vendorStock();
  }));

  ipcMain.handle('reports:sale-analysis', wrap((payload) => {
    requireSession();
    return service.saleAnalysis(payload);
  }));

  ipcMain.handle('reports:sale-report', wrap((payload) => {
    requireSession();
    return service.saleReport(payload);
  }));

  ipcMain.handle('reports:vendor-report', wrap((payload) => {
    requireSession();
    return service.vendorReport(payload);
  }));

  ipcMain.handle('reports:vendor-ledger', wrap((payload) => {
    requireSession();
    return service.vendorLedger(payload.vendor_id, payload);
  }));

  ipcMain.handle('reports:payment-trail', wrap((payload) => {
    const session = requireSession();
    return service.paymentTrail(payload, session);
  }));

  ipcMain.handle('reports:account-ledger', wrap((payload) => {
    const session = requireSession();
    return service.accountLedger({ ba_id: payload.ba_id, ac_id: payload.ac_id }, payload, session);
  }));

  ipcMain.handle('reports:business-ledger', wrap((payload) => {
    const session = requireSession();
    return service.businessLedger(payload, session);
  }));

  ipcMain.handle('reports:account-balance', wrap((payload) => {
    const session = requireSession();
    return service.accountBalance(payload, session);
  }));

  ipcMain.handle('reports:cash-book', wrap((payload) => {
    requireSession();
    return service.cashBook(payload);
  }));

  ipcMain.handle('reports:overall-trail', wrap((payload) => {
    const session = requireSession();
    return service.overallTrail(payload, session);
  }));

  ipcMain.handle('reports:overall-search', wrap((payload) => {
    requireSession();
    return service.overallSearch(payload?.search, payload?.entity_type);
  }));

  ipcMain.handle('reports:overall-search-ledger', wrap((payload) => {
    const session = requireSession();
    return service.overallSearchLedger(payload.entity_type, payload.ba_id, payload, session);
  }));
};
