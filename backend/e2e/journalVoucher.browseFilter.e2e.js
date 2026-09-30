// Journal Voucher — the shared Posted/Unposted workflow (see harness.browseFilterScenario). Its
// Post always clears to a blank voucher, so step 5 checks the blank-after-Post branch.
'use strict';

const test = require('node:test');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const journalVouchersService = require('../src/services/journalVouchers.service');
const { makeCustomer } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// Every JV touching either test account, then the accounts themselves.
async function removeJournalVouchers(customers) {
  for (const { customer } of customers) {
    const params = { baId: customer.ba_id };
    const jvs = '(SELECT jv_id FROM dbo.journal_voucher_lines WHERE ba_id = @baId)';
    await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'JOURNAL_VOUCHER' AND source_id IN ${jvs}`, params);
    await query(`DELETE FROM dbo.journal_vouchers WHERE jv_id IN ${jvs}`, params); // cascades lines
  }
  for (const { customer, region } of customers) {
    await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
  }
}

test('Journal Voucher: dropdown follows the voucher on screen through Posted, New, Post and Unpost', (t) =>
  h.browseFilterScenario(t, {
    menuLabel: 'JOURNAL VOUCHER',
    async setup() {
      const customers = [await makeCustomer(), await makeCustomer()];
      t.after(() => removeJournalVouchers(customers));
      const [a, b] = customers.map((c) => c.customer.ba_id);
      const draft = () => journalVouchersService.create({
        jv_date: '2026-09-30',
        lines: [{ ba_id: a, debit: 100, credit: 0 }, { ba_id: b, debit: 0, credit: 100 }],
      }, null, undefined);
      await journalVouchersService.post((await draft()).jv_id, null, undefined);
      await draft();
    },
  }));

test.after(() => closePool());
