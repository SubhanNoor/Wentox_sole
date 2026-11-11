// The Receipts screen saves a whole voucher at once (per the user, 2026-11-11): Enter only adds a
// line on screen, Save/Done writes the header and every line together. Covers, concretely:
//   - a new voucher saved with an ordinary and an endorsed line in one call;
//   - a second save that edits one line, keeps one unchanged and adds another, and drops one;
//   - a bad line (or the same cheque twice) saving NOTHING — no voucher, no number used up;
//   - a posted voucher refusing the save.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const { makeCustomer, makeVendor } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

async function voucherCount() {
  return (await query('SELECT COUNT(*) AS n FROM dbo.receipt_vouchers')).recordset[0].n;
}

test('Receipt voucher: saveWithLines writes, edits and refuses the whole voucher at once', async (t) => {
  const created = {};
  let voucherId = null;
  t.after(async () => {
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

  // Nothing saved when one line is bad — and no voucher left behind.
  const before = await voucherCount();
  await assert.rejects(
    receiptVouchersService.saveWithLines({
      voucher_date: '2026-01-15',
      lines: [
        { kind: 'RECEIPT', ba_id: customer.ba_id, amount: 500, payment_mode: 'CASH' },
        { kind: 'RECEIPT', ba_id: customer.ba_id, amount: 0, payment_mode: 'CASH' },
      ],
    }, null, undefined),
    /Entry 2: amount must be > 0/,
  );
  // The same paper cheque twice on one voucher is caught before anything is written.
  await assert.rejects(
    receiptVouchersService.saveWithLines({
      voucher_date: '2026-01-15',
      lines: [
        { kind: 'RECEIPT', ba_id: customer.ba_id, amount: 100, payment_mode: 'CHEQUE', cheque_no: 'SWL-1', cheque_date: '2026-01-15' },
        { kind: 'RECEIPT', ba_id: customer.ba_id, amount: 200, payment_mode: 'CHEQUE', cheque_no: 'swl-1 ', cheque_date: '2026-01-15' },
      ],
    }, null, undefined),
    (err) => err.code === 'DUPLICATE_CHEQUE',
  );
  assert.equal(await voucherCount(), before, 'a refused save must not create a voucher');

  // New voucher, both kinds of line, one call.
  let v = await receiptVouchersService.saveWithLines({
    voucher_date: '2026-01-15',
    remarks: 'day takings',
    lines: [
      { kind: 'RECEIPT', ba_id: customer.ba_id, amount: 1000, payment_mode: 'CASH' },
      { kind: 'RECEIPT', ba_id: customer.ba_id, amount: 300, payment_mode: 'CASH', details: 'second' },
      { kind: 'SETTLEMENT', from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id, amount: 400, payment_mode: 'CASH' },
    ],
  }, null, undefined);
  voucherId = v.voucher_id;
  assert.equal(v.lines.length, 3);
  assert.equal(v.status, 'UNPOSTED');
  assert.equal(Number(v.total_amount), 1700);

  const [first, second] = v.lines.filter((l) => l.draft_id != null);
  const endorsed = v.lines.find((l) => l.settlement_id != null);

  // Second save: first line edited, endorsed line kept unchanged, second line dropped, one added,
  // and a new date carried to every line.
  v = await receiptVouchersService.saveWithLines({
    voucher_id: voucherId,
    voucher_date: '2026-01-16',
    lines: [
      { kind: 'RECEIPT', draft_id: first.draft_id, ba_id: customer.ba_id, amount: 1100, payment_mode: 'CASH' },
      { kind: 'SETTLEMENT', settlement_id: endorsed.settlement_id, unchanged: true,
        from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id, amount: 400, payment_mode: 'CASH' },
      { kind: 'RECEIPT', ba_id: customer.ba_id, amount: 50, payment_mode: 'CASH' },
    ],
  }, null, undefined);
  assert.equal(v.lines.length, 3);
  assert.ok(!v.lines.some((l) => l.draft_id === second.draft_id), 'the dropped line must be deleted');
  assert.equal(Number(v.lines.find((l) => l.draft_id === first.draft_id).amount), 1100);
  assert.equal(Number(v.total_amount), 1550);
  const dates = (await query(
    `SELECT receipt_date AS d FROM dbo.draft_receipts WHERE voucher_id = @id
     UNION ALL SELECT settlement_date FROM dbo.settlements WHERE voucher_id = @id`,
    { id: voucherId },
  )).recordset.map((r) => r.d.toISOString().slice(0, 10));
  assert.deepEqual([...new Set(dates)], ['2026-01-16'], 'every line takes the voucher\'s date');

  // A posted voucher can't be saved over.
  const posted = await receiptVouchersService.post(voucherId, null, undefined);
  assert.equal(posted.failed.length, 0);
  await assert.rejects(
    receiptVouchersService.saveWithLines({
      voucher_id: voucherId, voucher_date: '2026-01-16',
      lines: [{ kind: 'RECEIPT', ba_id: customer.ba_id, amount: 1, payment_mode: 'CASH' }],
    }, null, undefined),
    (err) => err.code === 'POSTED_LOCK',
  );
});

test.after(() => closePool());
