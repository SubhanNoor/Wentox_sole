// Post with another document still unposted must bring that one on screen, as Delete does; posting
// the last one leaves a blank form (per the user, 2026-11-25). Purchase has its own file.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const draftExpensesService = require('../src/services/draftExpenses.service');
const draftPurchaseReturnsService = require('../src/services/draftPurchaseReturns.service');
const draftReceiptsService = require('../src/services/draftReceipts.service');
const draftSaleBillsService = require('../src/services/draftSaleBills.service');
const draftSaleReturnsService = require('../src/services/draftSaleReturns.service');
const expenseVouchersService = require('../src/services/expenseVouchers.service');
const journalVouchersService = require('../src/services/journalVouchers.service');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const stockVouchersService = require('../src/services/stockVouchers.service');
const vendorsService = require('../src/services/vendors.service');
const { cleanupFixtures } = require('../testlib/cleanup');
const { makeCustomer, setupSaleFixtures, uniqueName } = require('../testlib/fixtures');

async function removeSaleDocuments({ customer, variant }) {
  const params = { customerId: customer.customer_id, variantId: variant.variant_id };
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL'
    AND source_id IN (SELECT bill_id FROM dbo.sale_bills WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
  await query('DELETE FROM dbo.sale_bills WHERE customer_id = @customerId', params); // cascades items
  await query(`DELETE FROM dbo.draft_sale_bill_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_sale_bills WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.draft_sale_bills WHERE customer_id = @customerId', params);
}

function draftFor({ store, customer, variant }) {
  return draftSaleBillsService.create({
    bill_date: '2026-09-30',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('E2E'),
    items: [{ variant_id: variant.variant_id, cartons: 1, rate: 100, discount_percent: 0 }],
  }, null);
}

async function removeReturnDocumentsSale({ customer, variant }) {
  const params = { customerId: customer.customer_id, variantId: variant.variant_id };
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_RETURN'
    AND source_id IN (SELECT return_id FROM dbo.sale_returns WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
  await query('DELETE FROM dbo.sale_returns WHERE customer_id = @customerId', params); // cascades items
  await query(`DELETE FROM dbo.draft_sale_return_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_sale_returns WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.draft_sale_returns WHERE customer_id = @customerId', params);
}

async function removeVendorDocuments(vendorId) {
  const params = { vendorId };
  const returns = "(SELECT return_id FROM dbo.purchase_returns WHERE vendor_id = @vendorId)";
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'PURCHASE_RETURN' AND source_id IN ${returns}`, params);
  await query(`DELETE FROM dbo.vendor_stock_movements WHERE source_type = 'PURCHASE_RETURN' AND source_id IN ${returns}`, params);
  await query('DELETE FROM dbo.purchase_returns WHERE vendor_id = @vendorId', params); // cascades items
  await query(`DELETE FROM dbo.draft_purchase_return_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_purchase_returns WHERE vendor_id = @vendorId)`, params);
  await query('DELETE FROM dbo.draft_purchase_returns WHERE vendor_id = @vendorId', params);
  const row = await query('SELECT ba_id FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  await query('DELETE FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  if (row.recordset[0]?.ba_id != null) {
    await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.recordset[0].ba_id });
  }
}

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

async function removeStockVouchers({ variant }) {
  const params = { variantId: variant.variant_id };
  await query(`DELETE FROM dbo.stock_vouchers WHERE stock_voucher_id IN
    (SELECT stock_voucher_id FROM dbo.stock_voucher_lines WHERE variant_id = @variantId)`, params); // cascades lines
  await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
}

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

async function removeExpenses({ customer, region }) {
  const params = { baId: customer.ba_id };
  const vouchers = (await query(`SELECT voucher_id FROM dbo.expenses WHERE ba_id = @baId AND voucher_id IS NOT NULL
    UNION SELECT voucher_id FROM dbo.draft_expenses WHERE ba_id = @baId AND voucher_id IS NOT NULL`, params)).recordset;
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'EXPENSE'
    AND source_id IN (SELECT expense_id FROM dbo.expenses WHERE ba_id = @baId)`, params);
  await query('DELETE FROM dbo.expenses WHERE ba_id = @baId', params);
  await query('DELETE FROM dbo.draft_expenses WHERE ba_id = @baId', params);
  for (const { voucher_id: id } of vouchers) {
    await query('DELETE FROM dbo.expense_vouchers WHERE voucher_id = @id', { id });
  }
  await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
}

// True while `text` is in a field or a table row of the document on screen (commas ignored).
const shows = (page, text) => () => page.evaluate((t) => [
  ...[...document.querySelectorAll('input, textarea')].map((i) => i.value),
  ...[...document.querySelectorAll('tbody')].map((b) => b.textContent),
].some((v) => v.replace(/,/g, '').includes(t)), text);

// Post with one more still unposted: it comes on screen. Post that one too: a blank form.
async function postShowsNext(t, open, older, newer) {
  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);
  const page = await h.openInNewWindow(app, () => open(h, win));

  assert.equal(await h.eventually(shows(page, newer), true, 15000), true, 'opens on the latest unposted document');
  await h.click(page, 'Post');
  assert.equal(await h.eventually(shows(page, older), true), true, 'the other unposted document must come on screen');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), true), true, 'and be ready to post');
  assert.equal(await h.filterValue(page)(), 'unposted');

  await h.click(page, 'Post');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), false), false, 'nothing is left unposted');
  assert.equal(await h.eventually(shows(page, older), false), false, 'the form is blank');
  assert.equal(await h.filterValue(page)(), 'unposted');
}

test('Sale Bill: Post opens the remaining unposted one, then a blank form', async (t) => {
  const cleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => cleanup.push(fn) });
  t.after(async () => {
    await removeSaleDocuments(fx);
    for (const fn of cleanup) await fn();
  });
  const older = uniqueName('E2E');
  const newer = uniqueName('E2E');
  for (const bill_no of [older, newer]) {
    await draftSaleBillsService.create({
      bill_date: '2026-09-30', store_id: fx.store.store_id, customer_id: fx.customer.customer_id, bill_no,
      items: [{ variant_id: fx.variant.variant_id, cartons: 1, rate: 100, discount_percent: 0 }],
    }, null);
  }
  await postShowsNext(t, (h, win) => h.quickMenu(win, 'Sale Bill').click(), older, newer);
});

test('Sale Return: Post opens the remaining unposted one, then a blank form', async (t) => {
  const cleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => cleanup.push(fn) });
  t.after(async () => {
    await removeReturnDocumentsSale(fx);
    for (const fn of cleanup) await fn();
  });
  const older = uniqueName('E2E');
  const newer = uniqueName('E2E');
  for (const bill_no of [older, newer]) {
    await draftSaleReturnsService.create({
      return_date: '2026-09-30', store_id: fx.store.store_id, customer_id: fx.customer.customer_id, bill_no,
      items: [{ variant_id: fx.variant.variant_id, cartons: 1, rate: 100, discount_percent: 0 }],
    }, null);
  }
  await postShowsNext(t, async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'SALE RETURN')).click(), older, newer);
});

test('Purchase Return: Post opens the remaining unposted one, then a blank form', async (t) => {
  const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
  t.after(() => removeVendorDocuments(vendor.vendor_id));
  const older = uniqueName('E2E');
  const newer = uniqueName('E2E');
  for (const bill_no of [older, newer]) {
    await draftPurchaseReturnsService.create({
      return_date: '2026-09-30', vendor_id: vendor.vendor_id, bill_no,
      items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 50 }],
    }, null);
  }
  await postShowsNext(t, async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE RETURN')).click(), older, newer);
});

test('Journal Voucher: Post opens the remaining unposted one, then a blank form', async (t) => {
  const customers = [await makeCustomer(), await makeCustomer()];
  t.after(() => removeJournalVouchers(customers));
  const [a, b] = customers.map((c) => c.customer.ba_id);
  for (const amount of [7351, 8462]) {
    await journalVouchersService.create({
      jv_date: '2026-09-30',
      lines: [{ ba_id: a, debit: amount, credit: 0 }, { ba_id: b, debit: 0, credit: amount }],
    }, null, undefined);
  }
  await postShowsNext(t, async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'JOURNAL VOUCHER')).click(), '7351', '8462');
});

test('Stock Voucher: Post opens the remaining unposted one, then a blank form', async (t) => {
  const cleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => cleanup.push(fn) });
  t.after(async () => {
    await removeStockVouchers(fx);
    for (const fn of cleanup) await fn();
  });
  const older = uniqueName('E2E');
  const newer = uniqueName('E2E');
  for (const remarks of [older, newer]) {
    await stockVouchersService.create({
      voucher_date: '2026-09-30', store_id: fx.store.store_id, remarks,
      lines: [{ variant_id: fx.variant.variant_id, cartons: 1, pairs: 12 }],
    }, null);
  }
  await postShowsNext(t, async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'STOCK VOUCHER')).click(), older, newer);
});

test('Receipts: Post opens the remaining unposted one, then a blank form', async (t) => {
  const fx = await makeCustomer();
  t.after(() => removeReceipts(fx));
  for (const amount of [7351, 8462]) {
    const voucher = await receiptVouchersService.create({ voucher_date: '2026-09-30' }, null);
    await draftReceiptsService.create({
      voucher_id: voucher.voucher_id, ba_id: fx.customer.ba_id, receipt_date: '2026-09-30', amount, payment_mode: 'CASH',
    }, null, undefined);
  }
  await postShowsNext(t, async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'RECEIPTS (JAMMA)')).click(), '7351', '8462');
});

test('Payments: Post opens the remaining unposted one, then a blank form', async (t) => {
  const fx = await makeCustomer();
  t.after(() => removeExpenses(fx));
  for (const amount of [7351, 8462]) {
    const voucher = await expenseVouchersService.create({ voucher_date: '2026-09-30' }, null);
    await draftExpensesService.create({
      voucher_id: voucher.voucher_id, ba_id: fx.customer.ba_id, expense_date: '2026-09-30', amount, payment_mode: 'CASH',
    }, null, undefined);
  }
  await postShowsNext(t, async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'PAYMENTS (NAAM)')).click(), '7351', '8462');
});

test.after(() => closePool());
