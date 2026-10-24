// Regression: the Cash Book lists entries OLDEST ENTERED FIRST (FIFO, per the user, 2026-10-24),
// and entries saved within the same second (created_at is whole seconds) still come out in the
// order they were written — by ledger entry_id — instead of grouped by document type.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const chequesService = require('../src/services/cheques.service');
const expensesService = require('../src/services/expenses.service');
const reportsService = require('../src/services/reports.service');
const { setupChequeFixtures, uniqueName } = require('../testlib/fixtures');

test('cash book: entries are listed in the order they were entered, oldest first', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const date = '2026-03-03';

  // A receipt, its cheque handed to a vendor, then a cash expense — entered back to back, so
  // they usually share one created_at second. Type order would put the endorsement first.
  const chequeNo = uniqueName('ORD');
  const first = await receiptsService.create({
    ba_id: customer.ba_id, receipt_date: date, amount: 1100, payment_mode: 'CHEQUE',
    cheque_no: chequeNo, cheque_date: date,
  }, null, undefined);
  created.receiptId = first.receipt_id;
  await receiptsService.post(first.receipt_id, undefined);
  const { cheque_id: chequeId } = await receiptsService.getById(first.receipt_id);
  await chequesService.endorseToVendor(chequeId, { vendor_id: vendor.vendor_id, allocation_date: date }, null, undefined);

  const expense = await expensesService.create({
    vendor_id: vendor.vendor_id, expense_date: date, amount: 2200, payment_mode: 'CASH',
  }, null, undefined);
  created.expenseId = expense.expense_id;
  await expensesService.post(expense.expense_id, null, undefined);

  const book = await reportsService.cashBook({ date });
  const mine = book.rows
    .filter((r) => r.is_first_of_txn)
    .filter((r) => (r.source_type === 'RECEIPT' && r.source_id === first.receipt_id)
      || (r.source_type === 'EXPENSE' && r.source_id === expense.expense_id)
      || (r.source_type === 'CHEQUE_ALLOCATION' && r.cheque_no === chequeNo))
    .map((r) => ({ RECEIPT: 'receipt', CHEQUE_ALLOCATION: 'endorse', EXPENSE: 'expense' })[r.source_type]);

  assert.deepEqual(mine, ['receipt', 'endorse', 'expense']);
  const seqs = book.rows.filter((r) => r.is_first_of_txn).map((r) => r.txn_seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'S# runs 1..N down the page');
});

test.after(async () => {
  await closePool();
});
