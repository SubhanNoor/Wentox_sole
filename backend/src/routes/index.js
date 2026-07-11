const express = require('express');
const auth = require('../middleware/auth');

const router = express.Router();

router.use('/auth', require('./auth.routes')); // login is public; other auth routes guard internally

router.use(auth); // everything below requires a valid JWT

router.use('/cities', require('./cities.routes'));
router.use('/stores', require('./stores.routes'));
router.use('/addas', require('./addas.routes'));
router.use('/vendors', require('./vendors.routes'));
router.use('/categories', require('./categories.routes'));
router.use('/products', require('./products.routes'));
router.use('/customers', require('./customers.routes'));
router.use('/sub-customers', require('./subCustomers.routes'));
router.use('/accounts/groups', require('./groupAccounts.routes'));
router.use('/accounts/controls', require('./controlAccounts.routes'));
router.use('/accounts/chart', require('./chartAccounts.routes'));
router.use('/accounts/business', require('./businessAccounts.routes'));
router.use('/sale-bills', require('./saleBills.routes'));
router.use('/sale-returns', require('./saleReturns.routes'));
router.use('/receipts', require('./receipts.routes'));
router.use('/expenses', require('./expenses.routes'));
router.use('/stock', require('./stock.routes'));
router.use('/reports', require('./reports.routes'));

module.exports = router;
