// Live update across windows (per the user, 2026-10-15): a save in one window shows in every other
// open window without closing and reopening it. The save goes through the app's own IPC bridge
// (window.api, the same path every screen uses), which tells the other windows to re-run their loads.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const { uniqueName, makeRegion } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

test('a vendor saved in one window appears live in another window\'s report and vendor picker', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  // Window A: Vendor Report, already open and loaded.
  const [report] = await Promise.all([
    app.waitForEvent('window'),
    (await h.menuItem(win, '3.ACCOUNT REPORTS', 'VENDOR REPORT')).click(),
  ]);
  await report.waitForLoadState('domcontentloaded');
  await report.locator('[data-live-report] table').waitFor({ timeout: 20000 });

  // Window B (the main window): save a new vendor.
  const name = uniqueName('LIVE-VENDOR');
  const res = await win.evaluate((vendorName) => window.api.vendors.create({ name: vendorName }), name);
  assert.ok(res.ok, `vendor saved: ${JSON.stringify(res.error)}`);
  created.vendorId = res.data.vendor_id;

  // Window A updates by itself: the report lists the vendor...
  await report.locator('[data-live-report] td', { hasText: name }).first().waitFor({ timeout: 10000 });
  // ...and its vendor picker offers it, without reopening the window.
  await report.getByRole('button', { name: 'All vendors (summary)' }).click();
  await report.getByPlaceholder('Type a vendor name...').fill(name);
  await report.getByRole('option', { name }).or(report.getByText(name, { exact: true })).first().waitFor({ timeout: 10000 });
});

// Journal Voucher (approved by the user, 2026-10-15): a customer added in another window can be
// picked on a JV line without reopening the JV window.
test('a customer saved in one window can be picked on an open Journal Voucher', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));
  const region = await makeRegion();
  created.regionId = region.region_id;

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);
  const jv = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'JOURNAL VOUCHER')).click());
  await jv.waitForTimeout(1500); // its account list has loaded, without the new customer

  const name = uniqueName('LIVE-CUSTOMER');
  const res = await win.evaluate((p) => window.api.customers.create(p), { name, region_id: region.region_id });
  assert.ok(res.ok, `customer saved: ${JSON.stringify(res.error)}`);
  Object.assign(created, { customerId: res.data.customer_id, ba_id: res.data.ba_id });
  await jv.waitForTimeout(1500);

  await h.click(jv, 'New');
  const accountField = jv.getByPlaceholder('Type an account name, or press Enter to search...');
  await accountField.fill(name);
  await accountField.press('Enter');
  const description = jv.locator('label', { hasText: 'Account Description' }).locator('xpath=following-sibling::input');
  if ((await description.inputValue()) !== name) {
    await jv.getByText(name, { exact: false }).last().click();
  }
  assert.equal(await h.eventually(() => description.inputValue(), name), name, 'the new customer is pickable');
});

// Salary Run: a salaried employee added in another window joins the open run's grid, and an amount
// already typed over for someone else is kept.
test('a salaried employee saved in one window joins an open Salary Run, typed amounts kept', async (t) => {
  const ids = [];
  t.after(async () => {
    for (const id of ids) {
      const row = (await query('SELECT ba_id FROM dbo.employees WHERE employee_id = @id', { id })).recordset[0];
      await query('DELETE FROM dbo.employees WHERE employee_id = @id', { id });
      if (row?.ba_id != null) {
        await query('DELETE FROM dbo.ledger_entries WHERE ba_id = @baId', { baId: row.ba_id });
        await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.ba_id });
      }
    }
  });
  const employeesService = require('../src/services/employees.service');
  const first = await employeesService.create({ name: uniqueName('LIVE-SAL-A'), employee_type: 'SALARIED', monthly_salary: 30000 });
  ids.push(first.employee_id);

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);
  const [run] = await Promise.all([
    app.waitForEvent('window'),
    (await h.menuItem(win, '2.DATA ENTRY', 'SALARY RUN (MONTHLY)')).click(),
  ]);
  await run.waitForLoadState('domcontentloaded');
  const rowOf = (n) => run.locator('tr', { has: run.locator('td', { hasText: n }) });
  const typed = rowOf(first.name).locator('input[type="number"]');
  await typed.waitFor({ timeout: 20000 });
  await typed.fill('12345');

  const name = uniqueName('LIVE-SAL-B');
  const res = await win.evaluate((p) => window.api.employees.create(p), { name, employee_type: 'SALARIED', monthly_salary: 20000 });
  assert.ok(res.ok, `employee saved: ${JSON.stringify(res.error)}`);
  ids.push(res.data.employee_id);

  await rowOf(name).waitFor({ timeout: 10000 });
  assert.equal(await typed.inputValue(), '12345', 'the amount typed before the refresh is kept');
});

test.after(() => closePool());
