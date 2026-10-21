// Regression: the Cash Book for a day must show only postings dated in that period. One document
// can post on several dates — a cheque endorsement (10 Jan) and its return (15 Jan) share
// source_id = the allocation — and cashBookTransactionSides() used to load ALL of a qualifying
// document's lines, so the 15 Jan book also printed the 10 Jan endorsement.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const chequesService = require('../src/services/cheques.service');
const reportsService = require('../src/services/reports.service');
const { setupChequeFixtures, uniqueName } = require('../testlib/fixtures');

const narrationsOf = (book) => book.rows.map((r) => String(r.remarks ?? r.narration ?? ''));

test('cash book: a cheque endorsed on one date and returned on another only shows each posting on its own day', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const chequeNo = uniqueName('CHQ');
  const receipt = await receiptsService.create({
    ba_id: customer.ba_id, receipt_date: '2026-01-05', amount: 12000, payment_mode: 'CHEQUE',
    cheque_no: chequeNo, cheque_date: '2026-01-04',
  }, null, undefined);
  await receiptsService.post(receipt.receipt_id, undefined);
  created.receiptId = receipt.receipt_id;
  const posted = await receiptsService.getById(receipt.receipt_id);

  await chequesService.endorseToVendor(posted.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-01-10' }, null, undefined);
  const { allocation_id: allocationId } = (await query(
    'SELECT allocation_id FROM dbo.cheque_allocations WHERE receipt_id = @id', { id: receipt.receipt_id },
  )).recordset[0];
  await chequesService.reverseAllocation(allocationId, { date: '2026-01-15' }, null);

  const day10 = narrationsOf(await reportsService.cashBook({ date_from: '2026-01-10', date_to: '2026-01-10' }));
  const day15 = narrationsOf(await reportsService.cashBook({ date_from: '2026-01-15', date_to: '2026-01-15' }));
  const range = narrationsOf(await reportsService.cashBook({ date_from: '2026-01-10', date_to: '2026-01-15' }));

  const endorsement = (n) => n.includes(`Cheque #${chequeNo} to vendor`) || /to vendor/.test(n);
  assert.ok(day10.some(endorsement), '10 Jan shows the endorsement');
  assert.ok(!day10.some((n) => /Endorsement reversal/.test(n)), '10 Jan must not show the 15 Jan return');
  assert.ok(day15.some((n) => /Endorsement reversal/.test(n)), '15 Jan shows the return');
  assert.ok(!day15.some(endorsement), '15 Jan must NOT show the 10 Jan endorsement');
  assert.ok(range.some(endorsement) && range.some((n) => /Endorsement reversal/.test(n)), 'a range shows both, each on its own date');
});

test.after(async () => {
  await closePool();
});
