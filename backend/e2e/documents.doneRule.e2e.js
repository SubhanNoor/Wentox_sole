// The Done rule (per the user, 2026-11-25), on every data entry page: only Enter adds a line. Done
// throws away whatever is in the entry fields (an edited line keeps its old values) and, with no
// lines at all, says so instead of saving. Purchase's own cleanup is added below.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const draftExpensesService = require('../src/services/draftExpenses.service');
const draftPurchasesService = require('../src/services/draftPurchases.service');
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

async function removePurchaseDocuments(vendorId) {
  const params = { vendorId };
  const purchases = '(SELECT purchase_id FROM dbo.purchases WHERE vendor_id = @vendorId)';
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'PURCHASE' AND source_id IN ${purchases}`, params);
  await query(`DELETE FROM dbo.vendor_stock_movements WHERE source_type = 'PURCHASE' AND source_id IN ${purchases}`, params);
  await query('DELETE FROM dbo.purchases WHERE vendor_id = @vendorId', params); // cascades items
  await query(`DELETE FROM dbo.draft_purchase_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_purchases WHERE vendor_id = @vendorId)`, params);
  await query('DELETE FROM dbo.draft_purchases WHERE vendor_id = @vendorId', params);
  const row = await query('SELECT ba_id FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  await query('DELETE FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  if (row.recordset[0]?.ba_id != null) {
    await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.recordset[0].ba_id });
  }
}


// The enabled entry field currently holding `value` ('' = the last empty number field).
async function field(page, value) {
  const found = await page.evaluate((v) => {
    document.querySelectorAll('[data-e2e]').forEach((el) => el.removeAttribute('data-e2e'));
    const all = [...document.querySelectorAll('input')].filter((i) => !i.disabled && !i.readOnly && i.offsetParent
      && (v === '' ? i.type === 'number' && i.value === '' : i.value.replace(/,/g, '') === v));
    const el = v === '' ? all[all.length - 1] : all[0];
    if (el) el.setAttribute('data-e2e', '1');
    return !!el;
  }, value);
  assert.ok(found, `no enabled entry field holding "${value}"`);
  return page.locator('[data-e2e="1"]');
}
const holds = (page, value) => () => page.evaluate(
  (v) => [...document.querySelectorAll('input')].some((i) => i.value.replace(/,/g, '') === v), value);

// setup() makes one unposted document with line value `old` and returns { menu, read() }, where
// read() resolves to the saved values of every line.
async function doneRule(t, { open, old, read, enterSaves }) {
  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);
  const page = await h.openInNewWindow(app, () => open(h, win));
  const rows = page.locator('tbody tr[aria-selected]');
  const radio = (i) => page.locator('input[type="radio"][name$="edit-scope"]').nth(i);
  const before = await read();
  const editFirstRow = async () => {
    await radio(1).check();
    await rows.first().click();
    await h.click(page, 'Edit');
  };

  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), true, 15000), true, 'the unposted document opens');

  // Edit a line, then Done: the old values stay.
  await editFirstRow();
  await (await field(page, old)).fill('9');
  await h.click(page, 'Done');
  await page.waitForTimeout(1000);
  assert.deepEqual(await read(), before, 'Done must not apply the edit');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), true), true, 'Done finishes the document');

  // Half-typed new line, then Done: thrown away.
  await radio(1).check();
  await h.click(page, 'New');
  await (await field(page, '')).fill('4321');
  await h.click(page, 'Done');
  await page.waitForTimeout(1000);
  assert.deepEqual(await read(), before, 'Done must not add the half-typed line');
  assert.equal(await h.eventually(holds(page, '4321'), false), false, 'the half-typed line is cleared');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), true), true, 'Done finishes the document');

  if (enterSaves) {
    await editFirstRow();
    const amount = await field(page, old);
    await amount.fill('9137');
    await amount.focus();
    for (let i = 0; i < 6 && !(await read()).includes(9137); i++) { // Enter walks to the last field
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    assert.ok((await read()).includes(9137), 'Enter must save the line');
    await h.click(page, 'Done');
  }

  // Done on a new document with no entries: a message, nothing saved.
  await radio(0).check();
  await h.click(page, 'New');
  assert.equal(await h.eventually(h.isEnabled(page, 'Done'), true), true, 'Done is clickable with no entries');
  await h.click(page, 'Done');
  assert.equal(await h.eventually(() => page.getByText(/there are no entries/).first().isVisible(), true), true, 'the message shows');
}

test('Sale Bill: only Enter adds a line, Done throws the typed one away', async (t) => {
  const cleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => cleanup.push(fn) });
  t.after(async () => {
    await removeSaleDocuments(fx);
    for (const fn of cleanup) await fn();
  });
  const doc = await draftSaleBillsService.create({
    bill_date: '2026-09-30', store_id: fx.store.store_id, customer_id: fx.customer.customer_id, bill_no: uniqueName('E2E'),
    items: [{ variant_id: fx.variant.variant_id, cartons: 1, rate: 7351, discount_percent: 0 }],
  }, null);
  await doneRule(t, { open: (h, win) => h.quickMenu(win, 'Sale Bill').click(), old: '7351', read: async () => (await draftSaleBillsService.getById(doc.draft_id)).items.map((l) => Number(l.rate)) });
});

test('Sale Return: only Enter adds a line, Done throws the typed one away', async (t) => {
  const cleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => cleanup.push(fn) });
  t.after(async () => {
    await removeReturnDocumentsSale(fx);
    for (const fn of cleanup) await fn();
  });
  const doc = await draftSaleReturnsService.create({
    return_date: '2026-09-30', store_id: fx.store.store_id, customer_id: fx.customer.customer_id, bill_no: uniqueName('E2E'),
    items: [{ variant_id: fx.variant.variant_id, cartons: 1, rate: 7351, discount_percent: 0 }],
  }, null);
  await doneRule(t, { open: async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'SALE RETURN')).click(), old: '7351', read: async () => (await draftSaleReturnsService.getById(doc.draft_id)).items.map((l) => Number(l.rate)) });
});

test('Purchase: only Enter adds a line, Done throws the typed one away', async (t) => {
  const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
  t.after(() => removePurchaseDocuments(vendor.vendor_id));
  const doc = await draftPurchasesService.create({
    purchase_date: '2026-09-30', vendor_id: vendor.vendor_id, bill_no: uniqueName('E2E'),
    items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 7351 }],
  }, null);
  await doneRule(t, { open: async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE')).click(), old: '7351', read: async () => (await draftPurchasesService.getById(doc.draft_id)).items.map((l) => Number(l.price_per_unit)) });
});

test('Purchase Return: only Enter adds a line, Done throws the typed one away', async (t) => {
  const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
  t.after(() => removeVendorDocuments(vendor.vendor_id));
  const doc = await draftPurchaseReturnsService.create({
    return_date: '2026-09-30', vendor_id: vendor.vendor_id, bill_no: uniqueName('E2E'),
    items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 7351 }],
  }, null);
  await doneRule(t, { open: async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE RETURN')).click(), old: '7351', read: async () => (await draftPurchaseReturnsService.getById(doc.draft_id)).items.map((l) => Number(l.price_per_unit)) });
});

test('Journal Voucher: only Enter adds a line, Done throws the typed one away', async (t) => {
  const customers = [await makeCustomer(), await makeCustomer()];
  t.after(() => removeJournalVouchers(customers));
  const [a, b] = customers.map((c) => c.customer.ba_id);
  const doc = await journalVouchersService.create({
    jv_date: '2026-09-30', lines: [{ ba_id: a, debit: 7351, credit: 0 }, { ba_id: b, debit: 0, credit: 7351 }],
  }, null, undefined);
  await doneRule(t, { open: async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'JOURNAL VOUCHER')).click(), old: '7351', read: async () => (await journalVouchersService.getById(doc.jv_id)).lines.map((l) => Number(l.debit) - Number(l.credit)) });
});

test('Stock Voucher: only Enter adds a line, Done throws the typed one away', async (t) => {
  const cleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => cleanup.push(fn) });
  t.after(async () => {
    await removeStockVouchers(fx);
    for (const fn of cleanup) await fn();
  });
  const doc = await stockVouchersService.create({
    voucher_date: '2026-09-30', store_id: fx.store.store_id, lines: [{ variant_id: fx.variant.variant_id, cartons: 7, pairs: 84 }],
  }, null);
  await doneRule(t, { open: async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'STOCK VOUCHER')).click(), old: '7', read: async () => (await stockVouchersService.getById(doc.stock_voucher_id)).lines.map((l) => Number(l.cartons)) });
});

test('Receipts: only Enter adds a line, Done throws the typed one away', async (t) => {
  const fx = await makeCustomer();
  t.after(() => removeReceipts(fx));
  const doc = await receiptVouchersService.create({ voucher_date: '2026-09-30' }, null);
  await draftReceiptsService.create({
    voucher_id: doc.voucher_id, ba_id: fx.customer.ba_id, receipt_date: '2026-09-30', amount: 7351, payment_mode: 'CASH',
  }, null, undefined);
  await doneRule(t, { open: async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'RECEIPTS (JAMMA)')).click(), old: '7351', read: async () => (await receiptVouchersService.getById(doc.voucher_id)).lines.map((l) => Number(l.amount)), enterSaves: true });
});

test('Payments: only Enter adds a line, Done throws the typed one away', async (t) => {
  const fx = await makeCustomer();
  t.after(() => removeExpenses(fx));
  const doc = await expenseVouchersService.create({ voucher_date: '2026-09-30' }, null);
  await draftExpensesService.create({
    voucher_id: doc.voucher_id, ba_id: fx.customer.ba_id, expense_date: '2026-09-30', amount: 7351, payment_mode: 'CASH',
  }, null, undefined);
  await doneRule(t, { open: async (h, win) => (await h.menuItem(win, '2.DATA ENTRY', 'PAYMENTS (NAAM)')).click(), old: '7351', read: async () => (await expenseVouchersService.getById(doc.voucher_id)).lines.map((l) => Number(l.amount)), enterSaves: true });
});

test.after(() => closePool());
