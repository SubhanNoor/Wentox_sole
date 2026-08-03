// Central IPC registrar (mirrors the old routes/index.js): each feature module registers its own
// ipcMain.handle channels. Called once from electron/main.js before the BrowserWindow loads, so
// every channel exists before the renderer can invoke one.
const registerAuth = require('./auth.ipc');
const registerAddas = require('./addas.ipc');
const registerBusinessAccounts = require('./businessAccounts.ipc');
const registerCategories = require('./categories.ipc');
const registerChartAccounts = require('./chartAccounts.ipc');
const registerCities = require('./cities.ipc');
const registerCustomers = require('./customers.ipc');
const registerDraftPurchases = require('./draftPurchases.ipc');
const registerDraftPurchaseReturns = require('./draftPurchaseReturns.ipc');
const registerDraftSaleBills = require('./draftSaleBills.ipc');
const registerDraftSaleReturns = require('./draftSaleReturns.ipc');
const registerExpenses = require('./expenses.ipc');
const registerGroupAccounts = require('./groupAccounts.ipc');
const registerProducts = require('./products.ipc');
const registerProductColors = require('./productColors.ipc');
const registerPurchases = require('./purchases.ipc');
const registerPurchaseReturns = require('./purchaseReturns.ipc');
const registerReceipts = require('./receipts.ipc');
const registerRegions = require('./regions.ipc');
const registerReports = require('./reports.ipc');
const registerSaleBills = require('./saleBills.ipc');
const registerSaleReturns = require('./saleReturns.ipc');
const registerStock = require('./stock.ipc');
const registerStores = require('./stores.ipc');
const registerSubCustomers = require('./subCustomers.ipc');
const registerVendors = require('./vendors.ipc');

module.exports = function registerIpcHandlers() {
  registerAuth();
  registerAddas();
  registerBusinessAccounts();
  registerCategories();
  registerChartAccounts();
  registerCities();
  registerCustomers();
  registerDraftPurchases();
  registerDraftPurchaseReturns();
  registerDraftSaleBills();
  registerDraftSaleReturns();
  registerExpenses();
  registerGroupAccounts();
  registerProducts();
  registerProductColors();
  registerPurchases();
  registerPurchaseReturns();
  registerReceipts();
  registerRegions();
  registerReports();
  registerSaleBills();
  registerSaleReturns();
  registerStock();
  registerStores();
  registerSubCustomers();
  registerVendors();
};
