// An endorsed entry is a line of the receipt voucher it was entered on (migration 041, per the user
// 2026-10-05). It used to save as a standalone settlement: it never showed among the voucher's
// lines, and posting from the screen posted only the endorsement. Covers, concretely:
//   - the endorsed line listed alongside an ordinary line, marked with who it was endorsed to;
//   - it counting in the voucher total but in none of Cash/Cheque/Online;
//   - voucher Post/Un Post/Delete acting on BOTH kinds of line together.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const draftReceiptsService = require('../src/services/draftReceipts.service');
const settlementsService = require('../src/services/settlements.service');
const { makeCustomer, makeVendor } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

async function settlementLedgerRows(settlementId) {
  const result = await query(
    "SELECT ba_id, debit, credit FROM dbo.ledger_entries WHERE source_type = 'SETTLEMENT' AND source_id = @id",
    { id: settlementId },
  );
  return result.recordset;
}

test('Receipt voucher: an endorsed line lists, totals, posts, unposts and deletes with the voucher', async (t) => {
  const created = {};
  let voucherId = null;
  t.after(async () => {
    // Undo whatever the test got to before failing, then the parties themselves.
    if (voucherId != null) {
      try { await receiptVouchersService.unpost(voucherId, undefined); } catch { /* not posted */ }
      try { await receiptVouchersService.remove(voucherId, null); } catch { /* already deleted */ }
    }
    await cleanupFixtures(created);
  });

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;
  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  const voucher = await receiptVouchersService.create({ voucher_date: '2026-01-15' }, null);
  voucherId = voucher.voucher_id;

  await draftReceiptsService.create({
    ba_id: customer.ba_id, receipt_date: '2026-01-15', amount: 1000, payment_mode: 'CASH',
    voucher_id: voucherId,
  }, null, undefined);
  const endorsement = await settlementsService.create({
    // A date different from the voucher's — the voucher's own date must win.
    settlement_date: '2026-01-20', from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id, amount: 400,
    payment_mode: 'CHEQUE', cheque_no: 'E-123', voucher_id: voucherId,
  }, null, undefined);

  let v = await receiptVouchersService.getById(voucherId);
  assert.equal(v.lines.length, 2, 'the endorsed entry must be one of the voucher\'s lines');
  const endorsedLine = v.lines.find((l) => l.settlement_id === endorsement.settlement_id);
  assert.ok(endorsedLine, 'the endorsed line must carry its settlement_id');
  assert.equal(endorsedLine.endorse_to_ba_id, vendor.ba_id);
  assert.equal(endorsedLine.endorse_to_name, vendor.name);
  assert.equal(endorsement.settlement_date instanceof Date
    ? endorsement.settlement_date.toISOString().slice(0, 10)
    : String(endorsement.settlement_date).slice(0, 10), '2026-01-15', 'an endorsed line takes the voucher\'s date');
  assert.equal(Number(v.total_amount), 1400, 'endorsed amount counts in the voucher total');
  assert.equal(Number(v.total_cash), 1000);
  assert.equal(Number(v.total_cheque), 0, 'endorsed money never reached our cheque drawer');
  assert.equal(Number(v.total_endorsed), 400);

  const listed = (await receiptVouchersService.list({})).find((r) => r.voucher_id === voucherId);
  assert.equal(Number(listed.line_count), 2);
  assert.equal(Number(listed.total_amount), 1400);
  assert.equal(Number(listed.total_cheque), 0);

  const posted = await receiptVouchersService.post(voucherId, null, undefined);
  assert.deepEqual(posted.failed, []);
  v = posted.voucher;
  assert.equal(v.status, 'POSTED', 'both lines must post together');
  assert.equal(v.lines.length, 2, 'posting must keep every line on the voucher');
  const rows = await settlementLedgerRows(endorsement.settlement_id);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.ba_id === vendor.ba_id && Number(r.debit) === 400));
  assert.ok(rows.some((r) => r.ba_id === customer.ba_id && Number(r.credit) === 400));

  const unposted = await receiptVouchersService.unpost(voucherId, undefined);
  assert.deepEqual(unposted.failed, []);
  assert.equal(unposted.voucher.status, 'UNPOSTED');
  assert.equal((await settlementLedgerRows(endorsement.settlement_id)).length, 0);

  await receiptVouchersService.remove(voucherId, null);
  const left = await query('SELECT COUNT(*) AS n FROM dbo.settlements WHERE settlement_id = @id', { id: endorsement.settlement_id });
  assert.equal(left.recordset[0].n, 0, 'deleting the voucher deletes its endorsed line');
  voucherId = null;
});

test('Standalone list leaves out endorsements that belong to a voucher', async (t) => {
  const created = {};
  let voucherId = null;
  t.after(async () => {
    if (voucherId != null) {
      try { await receiptVouchersService.remove(voucherId, null); } catch { /* already deleted */ }
    }
    await cleanupFixtures(created);
  });

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;
  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  const voucher = await receiptVouchersService.create({ voucher_date: '2026-01-16' }, null);
  voucherId = voucher.voucher_id;
  const onVoucher = await settlementsService.create({
    settlement_date: '2026-01-16', from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id, amount: 50, voucher_id: voucherId,
  }, null, undefined);

  const standalone = await settlementsService.list({ standalone: true, ba_id: customer.ba_id });
  assert.ok(!standalone.some((s) => s.settlement_id === onVoucher.settlement_id));
  const all = await settlementsService.list({ ba_id: customer.ba_id });
  assert.ok(all.some((s) => s.settlement_id === onVoucher.settlement_id));
});

test('Settlements list honours the same weekly/monthly range as receipts', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));
  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;
  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  // Well outside both the last-7-days and the month-to-date windows.
  const old = await settlementsService.create({
    settlement_date: '2020-01-15', from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id, amount: 75,
  }, null, undefined);
  created.settlementId = old.settlement_id;

  for (const range of ['weekly', 'monthly']) {
    const rows = await settlementsService.list({ range, ba_id: customer.ba_id });
    assert.ok(!rows.some((r) => r.settlement_id === old.settlement_id), `${range} must exclude a 2020 settlement`);
  }
  const all = await settlementsService.list({ range: 'overall', ba_id: customer.ba_id });
  assert.ok(all.some((r) => r.settlement_id === old.settlement_id), 'overall has no date window');
});

test.after(async () => {
  await closePool();
});
