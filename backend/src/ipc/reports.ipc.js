// IPC layer: registers ipcMain.handle channels for reports — no business logic, no SQL.
const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs/promises');
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

  ipcMain.handle('reports:stock-voucher-detail', wrap((payload) => {
    requireSession();
    return service.stockVoucherDetail(payload);
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

  // Not routed through services/repositories on purpose: this is pure Electron main-process
  // orchestration (save dialog + webContents.printToPDF), not business logic or SQL, so there's
  // nothing for a reports.service.js layer to add here.
  ipcMain.handle('reports:export-pdf', wrap(async (payload, event) => {
    requireSession();
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Report as PDF',
      defaultPath: (payload && payload.filename) || 'report.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    const pdfBuffer = await win.webContents.printToPDF({
      landscape: !!(payload && payload.landscape),
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 },
    });
    await fs.writeFile(filePath, pdfBuffer);
    return { canceled: false, filePath };
  }));
};
