// Stock Voucher — the shared Posted/Unposted workflow (see harness.browseFilterScenario). Its Post
// always clears to a blank voucher, so step 5 checks the blank-after-Post branch.
'use strict';

const test = require('node:test');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const stockVouchersService = require('../src/services/stockVouchers.service');
const { setupSaleFixtures } = require('../testlib/fixtures');

// Every voucher with a line on this test's own variant, then all of that variant's stock.
async function removeStockVouchers({ variant }) {
  const params = { variantId: variant.variant_id };
  await query(`DELETE FROM dbo.stock_vouchers WHERE stock_voucher_id IN
    (SELECT stock_voucher_id FROM dbo.stock_voucher_lines WHERE variant_id = @variantId)`, params); // cascades lines
  await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
}

test('Stock Voucher: dropdown follows the voucher on screen through Posted, New, Post and Unpost', (t) =>
  h.browseFilterScenario(t, {
    menuLabel: 'STOCK VOUCHER',
    async setup() {
      const fixtureCleanup = [];
      const fx = await setupSaleFixtures({ after: (fn) => fixtureCleanup.push(fn) });
      t.after(async () => {
        await removeStockVouchers(fx);
        for (const fn of fixtureCleanup) await fn();
      });
      const draft = () => stockVouchersService.create({
        voucher_date: '2026-09-30',
        store_id: fx.store.store_id,
        lines: [{ variant_id: fx.variant.variant_id, cartons: 1, pairs: 12 }],
      }, null);
      await stockVouchersService.post((await draft()).stock_voucher_id, null);
      await draft();
    },
  }));

test.after(() => closePool());
