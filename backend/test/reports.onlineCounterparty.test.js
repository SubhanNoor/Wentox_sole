// Regression test for a live client-reported bug (2026-09-21): a customer's receipt paid ONLINE
// straight into a vendor's account (payload.online_ba_id, migration 028 — an alternative to a
// generic bank) showed a bare "Bank Transfer" narration on BOTH sides, telling neither the
// customer's ledger where the money went nor the vendor's ledger where it came from. The
// 2026-09-18 "never show the account name" rule only makes sense when the counter side is always
// the same generic bank — once it can be any specific party, that name IS the useful information.
// Covers the EXPENSE-side twin of the same gap (migration 029) too, found while fixing this.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const expensesService = require('../src/services/expenses.service');
const reportsService = require('../src/services/reports.service');
const { makeCustomer, makeVendor, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

async function narrationFor(baId, sourceType) {
  const ledger = await reportsService.accountLedger({ ba_id: baId }, {});
  const row = ledger.rows.find((r) => r.type === sourceType || (sourceType === 'Receipt (Jamma)' && r.type === sourceType));
  return row ? row.narration : null;
}

test('Receipt paid ONLINE directly to a vendor: each ledger names the OTHER party, not a bare "Bank Transfer"', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;

  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  const receipt = await receiptsService.create({
    ba_id: customer.ba_id,
    receipt_date: '2026-09-02',
    amount: 50000,
    payment_mode: 'ONLINE',
    online_ba_id: vendor.ba_id,
  }, null, undefined);
  created.receiptId = receipt.receipt_id;
  await receiptsService.post(receipt.receipt_id, undefined);

  const customerNarration = await narrationFor(customer.ba_id, 'Receipt (Jamma)');
  const vendorNarration = await narrationFor(vendor.ba_id, 'Receipt (Jamma)');

  assert.ok(customerNarration, 'expected a Receipt row on the customer ledger');
  assert.ok(vendorNarration, 'expected a Receipt row on the vendor ledger');
  assert.notEqual(customerNarration, 'Bank Transfer', 'customer ledger must not show a bare "Bank Transfer" once the money is named to a specific account');
  assert.notEqual(vendorNarration, 'Bank Transfer', 'vendor ledger must not show a bare "Bank Transfer" either');

  assert.equal(customerNarration, `Bank Transfer — to ${vendor.name}`, 'customer ledger should say where the payment was SENT TO');
  assert.equal(vendorNarration, `Bank Transfer — from ${customer.name}`, 'vendor ledger should say where the payment CAME FROM');
});

test('Plain ONLINE receipt into our own bank is unaffected — still a bare "Bank Transfer"', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;

  const bankAccountsService = require('../src/services/bankAccounts.service');
  const bank = await bankAccountsService.create({ name: uniqueName('BANK') });
  created.bankId = bank.bank_id;

  const receipt = await receiptsService.create({
    ba_id: customer.ba_id,
    receipt_date: '2026-09-02',
    amount: 10000,
    payment_mode: 'ONLINE',
    bank_id: bank.bank_id,
  }, null, undefined);
  created.receiptId = receipt.receipt_id;
  await receiptsService.post(receipt.receipt_id, undefined);

  const narration = await narrationFor(customer.ba_id, 'Receipt (Jamma)');
  assert.equal(narration, 'Bank Transfer', 'a plain bank ONLINE receipt must keep its existing bare narration — no regression for the common case');
});

test('Expense paid ONLINE directly from a customer account: each ledger names the OTHER party', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;

  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  const expense = await expensesService.create({
    ba_id: vendor.ba_id,
    expense_date: '2026-09-02',
    amount: 15000,
    payment_mode: 'ONLINE',
    online_ba_id: customer.ba_id,
  }, null, undefined);
  created.expenseId = expense.expense_id;
  await expensesService.post(expense.expense_id, null, undefined);

  const vendorNarration = await narrationFor(vendor.ba_id, 'Expense');
  const customerNarration = await narrationFor(customer.ba_id, 'Expense');

  assert.equal(vendorNarration, `Bank Transfer — from ${customer.name}`, 'vendor (who got paid) ledger should say where the money CAME FROM');
  assert.equal(customerNarration, `Bank Transfer — to ${vendor.name}`, 'customer (funding source) ledger should say where the money WENT TO');
});

test.after(async () => {
  await closePool();
});
