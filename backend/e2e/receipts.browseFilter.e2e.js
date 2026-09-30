// Receipts (Jamma) — the shared Posted/Unposted workflow (see harness.browseFilterScenario), over
// whole receipt VOUCHERS: Posted walks fully-posted ones, Unposted walks the rest.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const draftReceiptsService = require('../src/services/draftReceipts.service');
const { makeCustomer } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// Every receipt line of this test's customer (posted or draft), the vouchers holding them, then
// the customer.
async function removeReceipts({ customer, region }) {
  const params = { baId: customer.ba_id };
  const vouchers = (await query(`SELECT voucher_id FROM dbo.receipts WHERE ba_id = @baId AND voucher_id IS NOT NULL
    UNION SELECT voucher_id FROM dbo.draft_receipts WHERE ba_id = @baId AND voucher_id IS NOT NULL`, params)).recordset;
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type IN ('RECEIPT', 'COMMISSION')
    AND source_id IN (SELECT receipt_id FROM dbo.receipts WHERE ba_id = @baId)`, params);
  await query('DELETE FROM dbo.receipts WHERE ba_id = @baId', params);
  await query('DELETE FROM dbo.draft_receipts WHERE ba_id = @baId', params);
  for (const { voucher_id: id } of vouchers) {
    await query('DELETE FROM dbo.receipt_vouchers WHERE voucher_id = @id', { id });
  }
  await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
}

test('Receipts: dropdown follows the voucher on screen through Posted, New, Post and Unpost', (t) =>
  h.browseFilterScenario(t, {
    menuLabel: 'RECEIPTS (JAMMA)',
    async setup() {
      const fx = await makeCustomer();
      t.after(() => removeReceipts(fx));
      const voucherWithLine = async () => {
        const voucher = await receiptVouchersService.create({ voucher_date: '2026-09-30' }, null);
        await draftReceiptsService.create({
          voucher_id: voucher.voucher_id, ba_id: fx.customer.ba_id, receipt_date: '2026-09-30', amount: 500, payment_mode: 'CASH',
        }, null, undefined);
        return voucher;
      };
      const result = await receiptVouchersService.post((await voucherWithLine()).voucher_id, null, undefined);
      assert.equal(result.failed?.length ?? 0, 0, 'fixture voucher should post');
      await voucherWithLine();
    },
  }));

test.after(() => closePool());
