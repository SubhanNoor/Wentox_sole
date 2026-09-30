// Sale Return as an independent voucher (2026-09-28): no link to any Sale Bill, a free-text
// Manual Invoice No., and every dispatch field (Adda / GP / Bilty / Delivery Agent) optional.
// Covers, concretely:
//   - a return with no Adda saving at all (the page used to send adda_id = Number('') = 0, which
//     violates FK_draft_sale_returns_adda);
//   - draft -> post -> un-post -> delete moving stock and ledger exactly as documented;
//   - posted returns refusing edits (Un Post first), per the user.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const draftSaleReturnsService = require('../src/services/draftSaleReturns.service');
const saleReturnsService = require('../src/services/saleReturns.service');
const { setupSaleFixtures, uniqueName } = require('../testlib/fixtures');

async function netStockFor(variantId) {
  const result = await query(
    `SELECT COALESCE(SUM(qty_pairs), 0) AS n FROM dbo.stock_movements
     WHERE variant_id = @id AND source_type IN ('SALE_RETURN', 'DRAFT_SALE_RETURN')`,
    { id: variantId },
  );
  return Number(result.recordset[0].n);
}

async function ledgerRowsFor(returnId) {
  const result = await query(
    "SELECT debit, credit, ba_id, ac_id FROM dbo.ledger_entries WHERE source_type = 'SALE_RETURN' AND source_id = @id",
    { id: returnId },
  );
  return result.recordset;
}

function returnPayload(fixtures, overrides = {}) {
  return {
    return_date: '2026-01-06',
    store_id: fixtures.store.store_id,
    customer_id: fixtures.customer.customer_id,
    // Free text — deliberately NOT the number of any Sale Bill.
    bill_no: uniqueName('RET'),
    // No adda_id / gp_no / bilty_no / sub_customer_id at all, exactly as the page sends a return
    // with those left blank.
    items: [{ variant_id: fixtures.variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
    ...overrides,
  };
}

test('Sale Return: saves with no Adda and no Sale Bill, posts, refuses edits, un-posts and deletes', async (t) => {
  const fixtures = await setupSaleFixtures(t);
  const { variant, created } = fixtures;
  const systemNos = [];
  t.after(async () => {
    for (const no of systemNos) {
      await query("DELETE FROM dbo.deleted_document_numbers WHERE doc_type = 'SALE_RETURN' AND system_no = @no", { no });
    }
  });

  const draft = await draftSaleReturnsService.create(returnPayload(fixtures), null);
  systemNos.push(draft.system_no);
  assert.equal(draft.adda_id, null, 'a blank Adda must be stored as NULL');
  assert.equal(draft.total_pairs, 24, '2 cartons at packing 12 should be 24 pairs');
  assert.equal(await netStockFor(variant.variant_id), 24, 'saving a draft restores stock immediately');

  const posted = await draftSaleReturnsService.confirm(draft.draft_id, null);
  created.returnId = posted.return_id;
  assert.equal(posted.is_posted, true);
  assert.equal(posted.system_no, draft.system_no, 'posting keeps the draft\'s System No.');
  assert.equal(await netStockFor(variant.variant_id), 24, 'posting must not double-count the restored stock');

  const ledger = await ledgerRowsFor(posted.return_id);
  assert.equal(ledger.length, 2);
  const customerLeg = ledger.find((r) => r.ba_id === fixtures.customer.ba_id);
  assert.ok(customerLeg, 'the customer\'s account must be one leg');
  assert.equal(Number(customerLeg.credit), 2400, 'the customer is credited the net value');

  await assert.rejects(
    saleReturnsService.update(posted.return_id, returnPayload(fixtures)),
    (err) => err.code === 'POSTED_NOT_EDITABLE',
    'a posted return must refuse edits',
  );

  const backToDraft = await saleReturnsService.unconfirm(posted.return_id);
  created.returnId = undefined; // unconfirm deleted the sale_returns row
  assert.equal(backToDraft.system_no, draft.system_no, 'un-posting keeps the same System No.');
  assert.equal((await ledgerRowsFor(posted.return_id)).length, 0, 'un-posting removes the ledger rows');
  assert.equal(await netStockFor(variant.variant_id), 24, 'stock stays restored while it is a draft again');

  await draftSaleReturnsService.remove(backToDraft.draft_id, null);
  assert.equal(await netStockFor(variant.variant_id), 0, 'deleting the draft takes the restored stock back out');
});

test.after(() => closePool());
