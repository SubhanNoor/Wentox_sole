// The Payments screen saves a whole voucher at once (per the user, 2026-11-11): Enter only adds a
// line on screen, Save/Done writes the header and every line together. Covers, concretely:
//   - a new voucher saved with two lines in one call;
//   - a second save that edits one line, keeps one unchanged, drops one and adds another;
//   - a bad line saving NOTHING — no voucher, no number used up;
//   - a posted voucher refusing the save.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const expenseVouchersService = require('../src/services/expenseVouchers.service');
const { makeVendor } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const ADMIN = { userId: null, role: 'ADMIN' };

async function voucherCount() {
  return (await query('SELECT COUNT(*) AS n FROM dbo.expense_vouchers')).recordset[0].n;
}

test('Payment voucher: saveWithLines writes, edits and refuses the whole voucher at once', async (t) => {
  const created = {};
  let voucherId = null;
  t.after(async () => {
    if (voucherId != null) {
      try { await expenseVouchersService.unpost(voucherId, ADMIN); } catch { /* not posted */ }
      try { await expenseVouchersService.remove(voucherId, null); } catch { /* already deleted */ }
    }
    await cleanupFixtures(created);
  });

  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  // Nothing saved when one line is bad — and no voucher left behind.
  const before = await voucherCount();
  await assert.rejects(
    expenseVouchersService.saveWithLines({
      voucher_date: '2026-01-15',
      lines: [
        { ba_id: vendor.ba_id, amount: 500, payment_mode: 'CASH' },
        { ba_id: vendor.ba_id, amount: 0, payment_mode: 'CASH' },
      ],
    }, null, undefined),
    /Entry 2: amount must be > 0/,
  );
  assert.equal(await voucherCount(), before, 'a refused save must not create a voucher');

  let v = await expenseVouchersService.saveWithLines({
    voucher_date: '2026-01-15',
    remarks: 'day payments',
    lines: [
      { ba_id: vendor.ba_id, amount: 1000, payment_mode: 'CASH' },
      { ba_id: vendor.ba_id, amount: 300, payment_mode: 'CASH', details: 'second' },
      { ba_id: vendor.ba_id, amount: 20, payment_mode: 'CASH', details: 'third' },
    ],
  }, null, undefined);
  voucherId = v.voucher_id;
  assert.equal(v.lines.length, 3);
  assert.equal(v.status, 'UNPOSTED');
  assert.equal(Number(v.total_amount), 1320);

  const [first, second, third] = v.lines;

  v = await expenseVouchersService.saveWithLines({
    voucher_id: voucherId,
    voucher_date: '2026-01-16',
    lines: [
      { draft_id: first.draft_id, ba_id: vendor.ba_id, amount: 1100, payment_mode: 'CASH' },
      { draft_id: third.draft_id, unchanged: true, ba_id: vendor.ba_id, amount: 20, payment_mode: 'CASH' },
      { ba_id: vendor.ba_id, amount: 50, payment_mode: 'CASH' },
    ],
  }, null, undefined);
  assert.equal(v.lines.length, 3);
  assert.ok(!v.lines.some((l) => l.draft_id === second.draft_id), 'the dropped line must be deleted');
  assert.equal(Number(v.lines.find((l) => l.draft_id === first.draft_id).amount), 1100);
  assert.equal(Number(v.total_amount), 1170);
  const dates = (await query('SELECT DISTINCT expense_date AS d FROM dbo.draft_expenses WHERE voucher_id = @id', { id: voucherId }))
    .recordset.map((r) => r.d.toISOString().slice(0, 10));
  assert.deepEqual(dates, ['2026-01-16'], 'every line takes the voucher\'s date');

  const posted = await expenseVouchersService.post(voucherId, ADMIN);
  assert.equal(posted.failed.length, 0);
  await assert.rejects(
    expenseVouchersService.saveWithLines({
      voucher_id: voucherId, voucher_date: '2026-01-16',
      lines: [{ ba_id: vendor.ba_id, amount: 1, payment_mode: 'CASH' }],
    }, null, undefined),
    (err) => err.code === 'POSTED_LOCK',
  );
});

test.after(() => closePool());
