const express = require('express');
const auth = require('../middleware/auth');

const router = express.Router();

router.use('/auth', require('./auth.routes')); // login is public; other auth routes guard internally

router.use(auth); // everything below requires a valid JWT

// Milestone 2 — Sale Bill & Sale Return
router.use('/sale-bills', require('./saleBills.routes'));
router.use('/draft-sale-bills', require('./draftSaleBills.routes'));
router.use('/sale-returns', require('./saleReturns.routes'));
router.use('/draft-sale-returns', require('./draftSaleReturns.routes'));

// Milestone 3 — Purchase & Purchase Return
router.use('/purchases', require('./purchases.routes'));
router.use('/purchase-returns', require('./purchaseReturns.routes'));

// Milestone 4 — Receipts (Jamma) & Expenses (Kharch)
router.use('/receipts', require('./receipts.routes'));
router.use('/draft-receipts', require('./draftReceipts.routes'));
router.use('/bank-accounts', require('./bankAccounts.routes'));
router.use('/cheques', require('./cheques.routes'));
router.use('/expenses', require('./expenses.routes'));
router.use('/draft-expenses', require('./draftExpenses.routes'));

// Milestone 5 — Current Stock, Reports & Search/Bilty-Adda
router.use('/stock', require('./stock.routes'));
router.use('/reports', require('./reports.routes'));
// Bilty/adda search+update endpoints are wired inside saleBills.routes (GET /bilty-search, PATCH /:id/bilty)

// Milestone 6 — System Setup: Products, Categories, Vendors
router.use('/products', require('./products.routes'));
// Article colors are wired inside products.routes as a nested resource (/products/:id/colors)
router.use('/categories', require('./categories.routes'));
router.use('/vendors', require('./vendors.routes'));

// Milestone 7 — System Setup: Workers, Customers, Sub-Customers
// Workers routes are blocked on definition — see milestones/milestone7.md Module 7.1
router.use('/customers', require('./customers.routes'));
router.use('/sub-customers', require('./subCustomers.routes'));

// Milestone 8 — System Setup: Cities & Accounts Hierarchy
router.use('/cities', require('./cities.routes'));
router.use('/regions', require('./regions.routes'));
router.use('/stores', require('./stores.routes'));
router.use('/addas', require('./addas.routes'));
router.use('/accounts/classes', require('./accountClasses.routes'));
router.use('/accounts/groups', require('./groupAccounts.routes'));
router.use('/accounts/chart', require('./chartAccounts.routes'));
router.use('/accounts/business', require('./businessAccounts.routes'));

// Milestone 9 — Alerts
router.use('/alerts', require('./alerts.routes'));

module.exports = router;
