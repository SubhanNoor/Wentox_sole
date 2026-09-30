// Sale Return — the shared Posted/Unposted workflow (see harness.browseFilterScenario).
'use strict';

const test = require('node:test');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const draftSaleReturnsService = require('../src/services/draftSaleReturns.service');
const { setupSaleFixtures, uniqueName } = require('../testlib/fixtures');

async function removeReturnDocuments({ customer, variant }) {
  const params = { customerId: customer.customer_id, variantId: variant.variant_id };
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_RETURN'
    AND source_id IN (SELECT return_id FROM dbo.sale_returns WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
  await query('DELETE FROM dbo.sale_returns WHERE customer_id = @customerId', params); // cascades items
  await query(`DELETE FROM dbo.draft_sale_return_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_sale_returns WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.draft_sale_returns WHERE customer_id = @customerId', params);
}

test('Sale Return: dropdown follows the return on screen through Posted, New, Post and Unpost', (t) =>
  h.browseFilterScenario(t, {
    menuLabel: 'SALE RETURN',
    async setup() {
      // Fixture cleanup must run after the documents are gone (they reference its customer).
      const fixtureCleanup = [];
      const fx = await setupSaleFixtures({ after: (fn) => fixtureCleanup.push(fn) });
      t.after(async () => {
        await removeReturnDocuments(fx);
        for (const fn of fixtureCleanup) await fn();
      });
      const draft = () => draftSaleReturnsService.create({
        return_date: '2026-09-30',
        store_id: fx.store.store_id,
        customer_id: fx.customer.customer_id,
        bill_no: uniqueName('E2E'),
        items: [{ variant_id: fx.variant.variant_id, cartons: 1, rate: 100, discount_percent: 0 }],
      }, null);
      await draftSaleReturnsService.confirm((await draft()).draft_id, null);
      await draft();
    },
  }));

test.after(() => closePool());
