// Customer Sales / Article Sales reports (client request, 2026-11-23): every POSTED sale-bill and
// sale-return line, each with its own rate; returns negative; a bill's invoice discount as its own
// row on the customer page so the total reconciles with the Sale Report; and, on the article page,
// one group per price with its own subtotal.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { closePool } = require('../src/db/pool');
const saleBillsService = require('../src/services/saleBills.service');
const draftSaleReturnsService = require('../src/services/draftSaleReturns.service');
const reportsService = require('../src/services/reports.service');
const { setupSaleFixtures, makeCustomer, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// After-hooks run in the order they were registered, and these documents must go BEFORE the
// customer/store/product the fixtures own — so call this BEFORE setupSaleFixtures(t).
function trackDocs(t) {
  const docs = { bills: [], returns: [] };
  t.after(async () => {
    for (const id of docs.bills) await cleanupFixtures({ billId: id });
    for (const id of docs.returns) await cleanupFixtures({ returnId: id });
  });
  return docs;
}

async function postedBill(fx, docs, { date, cartons, rate, discountPercent = 0, invoiceDiscount = 0, customerId, post = true }) {
  const bill = await saleBillsService.create({
    bill_date: date,
    store_id: fx.store.store_id,
    customer_id: customerId ?? fx.customer.customer_id,
    bill_no: uniqueName('BILL'),
    invoice_discount: invoiceDiscount,
    items: [{ variant_id: fx.variant.variant_id, cartons, rate, discount_percent: discountPercent }],
  }, null);
  docs.bills.push(bill.bill_id);
  if (post) await saleBillsService.post(bill.bill_id);
  return bill;
}

async function postedReturn(fx, docs, { date, cartons, rate, invoiceDiscount = 0 }) {
  const draft = await draftSaleReturnsService.create({
    return_date: date,
    store_id: fx.store.store_id,
    customer_id: fx.customer.customer_id,
    bill_no: uniqueName('RET'),
    invoice_discount: invoiceDiscount,
    items: [{ variant_id: fx.variant.variant_id, cartons, rate, discount_percent: 0 }],
  }, null);
  const posted = await draftSaleReturnsService.confirm(draft.draft_id, null);
  docs.returns.push(posted.return_id);
  return posted;
}

const RANGE = { date_from: '2026-06-01', date_to: '2026-07-31' };

test('Customer Sales: each line keeps its own rate, returns are negative, bill discount reconciles with the Sale Report', async (t) => {
  const docs = trackDocs(t);
  const fx = await setupSaleFixtures(t, { pairsOnHand: 5000 });
  // The same article bought three times at two prices, one bill with a bill-level discount, and a return.
  await postedBill(fx, docs, { date: '2026-06-15', cartons: 4, rate: 300 });
  await postedBill(fx, docs, { date: '2026-06-20', cartons: 2, rate: 300, invoiceDiscount: 500 });
  await postedBill(fx, docs, { date: '2026-07-05', cartons: 3, rate: 600, discountPercent: 10 });
  await postedReturn(fx, docs, { date: '2026-07-10', cartons: 1, rate: 300 });

  const report = await reportsService.customerSales({ customer_id: fx.customer.customer_id, ...RANGE });
  const kinds = report.rows.map((r) => r.kind);
  assert.deepEqual(kinds, ['SALE', 'SALE', 'BILL_DISCOUNT', 'SALE', 'RETURN'], 'in date order, the discount right after its own bill');

  const [first, second, discount, third, ret] = report.rows;
  assert.equal(first.rate, 300);
  assert.equal(first.cartons, 4);
  assert.equal(first.pairs, 48);
  assert.equal(first.value, 14400);
  assert.equal(second.rate, 300);
  assert.equal(second.value, 7200);
  assert.equal(discount.value, -500, 'a sale bill discount lowers the total');
  assert.equal(discount.bill_no, second.bill_no);
  assert.equal(third.rate, 600, 'a different price is its own row, not merged');
  assert.equal(third.discount_percent, 10);
  assert.equal(third.value, 19440, '36 pairs x 600 less 10%');
  assert.equal(ret.cartons, -1, 'a return is negative');
  assert.equal(ret.pairs, -12);
  assert.equal(ret.value, -3600);

  assert.deepEqual(report.totals, { cartons: 8, pairs: 96, value: 14400 + 7200 - 500 + 19440 - 3600 });

  // The Customer Sales total is what the Sale Report calls Total Sales less Sale Return.
  const sale = (await reportsService.saleReport(RANGE)).find((r) => r.customer_id === fx.customer.customer_id);
  assert.equal(report.totals.value, Number((sale.total_sales - sale.sale_return).toFixed(2)));
});

test('Customer Sales: unposted bills, other customers and other dates are left out; empty is fine', async (t) => {
  const docs = trackDocs(t);
  const fx = await setupSaleFixtures(t, { pairsOnHand: 5000 });
  const { customer: other } = await makeCustomer();
  t.after(() => cleanupFixtures({ customerId: other.customer_id, ba_id: other.ba_id }));

  await postedBill(fx, docs, { date: '2026-06-15', cartons: 1, rate: 100 });
  await postedBill(fx, docs, { date: '2026-06-16', cartons: 5, rate: 100, post: false }); // saved, never posted
  await postedBill(fx, docs, { date: '2026-06-17', cartons: 6, rate: 100, customerId: other.customer_id });
  await postedBill(fx, docs, { date: '2026-08-01', cartons: 7, rate: 100 }); // after the range
  await postedBill(fx, docs, { date: '2026-05-31', cartons: 8, rate: 100 }); // before the range

  const inRange = await reportsService.customerSales({ customer_id: fx.customer.customer_id, ...RANGE });
  assert.equal(inRange.rows.length, 1, 'only the one posted bill of this customer inside the dates');
  assert.equal(inRange.totals.cartons, 1);

  // Both end dates are inclusive.
  const edges = await reportsService.customerSales({ customer_id: fx.customer.customer_id, date_from: '2026-05-31', date_to: '2026-08-01' });
  assert.deepEqual(edges.rows.map((r) => r.cartons), [8, 1, 7]);

  const none = await reportsService.customerSales({ customer_id: fx.customer.customer_id, date_from: '2027-01-01', date_to: '2027-01-31' });
  assert.deepEqual(none, { rows: [], totals: { cartons: 0, pairs: 0, value: 0 } });
});

test('Article Sales: one group per price with its own subtotal, returns negative, price history order', async (t) => {
  const docs = trackDocs(t);
  const fx = await setupSaleFixtures(t, { pairsOnHand: 5000 });
  await postedBill(fx, docs, { date: '2026-06-15', cartons: 4, rate: 300 });
  await postedBill(fx, docs, { date: '2026-06-28', cartons: 2, rate: 300 });
  await postedBill(fx, docs, { date: '2026-07-02', cartons: 3, rate: 600 });
  await postedBill(fx, docs, { date: '2026-07-20', cartons: 1, rate: 300 }); // the old price comes back
  await postedReturn(fx, docs, { date: '2026-07-22', cartons: 1, rate: 600 });

  const report = await reportsService.articleSales({ article_id: fx.product.article_id, ...RANGE });
  assert.equal(report.groups.length, 2, 'two distinct prices, so two groups');

  const [g300, g600] = report.groups;
  assert.equal(g300.rate, 300, 'ordered by when each price first appeared');
  assert.equal(g300.from_date, '2026-06-15');
  assert.equal(g300.to_date, '2026-07-20', 'the group spans the first and last date the price was used');
  assert.equal(g300.rows.length, 3, 'the returning price stays in the same group');
  assert.equal(g300.cartons, 7);
  assert.equal(g300.pairs, 84);
  assert.equal(g300.value, 25200);

  assert.equal(g600.rate, 600);
  assert.deepEqual(g600.rows.map((r) => r.kind), ['SALE', 'RETURN']);
  assert.equal(g600.cartons, 2, '3 sold less 1 returned');
  assert.equal(g600.value, 21600 - 7200);

  assert.deepEqual(report.totals, {
    cartons: report.groups.reduce((s, g) => s + g.cartons, 0),
    pairs: report.groups.reduce((s, g) => s + g.pairs, 0),
    value: report.groups.reduce((s, g) => s + g.value, 0),
  });
  assert.ok(report.groups.every((g) => g.rows.every((r) => r.customer_name === fx.customer.name)));
});

test('Customer Sales: a return with its own bill-level discount shows it as a positive row after the return', async (t) => {
  const docs = trackDocs(t);
  const fx = await setupSaleFixtures(t, { pairsOnHand: 5000 });
  await postedBill(fx, docs, { date: '2026-06-15', cartons: 4, rate: 300 });
  await postedReturn(fx, docs, { date: '2026-06-20', cartons: 1, rate: 300, invoiceDiscount: 200 });

  const report = await reportsService.customerSales({ customer_id: fx.customer.customer_id, ...RANGE });
  assert.deepEqual(report.rows.map((r) => r.kind), ['SALE', 'RETURN', 'BILL_DISCOUNT']);
  assert.equal(report.rows[2].value, 200, 'a return discount lowers what comes back, so it adds to the total');
  assert.equal(report.totals.value, 14400 - 3600 + 200);

  const sale = (await reportsService.saleReport(RANGE)).find((r) => r.customer_id === fx.customer.customer_id);
  assert.equal(report.totals.value, Number((sale.total_sales - sale.sale_return).toFixed(2)));
});

test('Sale detail reports refuse a missing customer/article and a backwards date range', async () => {
  await assert.rejects(reportsService.customerSales({ ...RANGE }), (e) => e.status === 400);
  await assert.rejects(reportsService.articleSales({ ...RANGE }), (e) => e.status === 400);
  await assert.rejects(
    reportsService.customerSales({ customer_id: 1, date_from: '2026-07-31', date_to: '2026-06-01' }),
    (e) => e.status === 400,
  );
});

test.after(() => closePool());
