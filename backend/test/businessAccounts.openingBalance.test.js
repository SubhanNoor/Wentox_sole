// Regression test for the 2026-08-10 bug: business_accounts.opening_balance was a stored number
// added into balances with NO counter-entry anywhere — a single 100,000 opening balance threw the
// trial balance out by exactly 100,000 while ledger_entries itself still netted to zero. Fixed via
// the OPENING_BALANCE_EQUITY reserved account + syncOpeningEntries() writing a real two-sided
// ledger pair. This test is the standing invariant from
// System_architecture/testing_priority_plan.md's root-cause pattern #2: "after any posting
// operation, sum(debit) = sum(credit)" — it should keep passing regardless of which feature
// touches ledger_entries next.
//
// Runs against the DB_NAME database (see scripts/setup-test-db.js — `npm test` points this at a
// throwaway "wentox_test" database, never the real one). Requires that database to already be
// migrated + seeded (npm run test:setup does this).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const regionsService = require('../src/services/regions.service');
const customersService = require('../src/services/customers.service');
const { cleanupFixtures } = require('../testlib/cleanup');

async function trialBalanceIsZero() {
  const result = await query(
    'SELECT ISNULL(SUM(debit), 0) AS total_debit, ISNULL(SUM(credit), 0) AS total_credit FROM dbo.ledger_entries',
  );
  const { total_debit: debit, total_credit: credit } = result.recordset[0];
  return { debit: Number(debit), credit: Number(credit) };
}

test('customer opening balance keeps the trial balance at zero', async (t) => {
  const before = await trialBalanceIsZero();
  assert.equal(before.debit, before.credit, 'trial balance must already be balanced before this test adds anything');

  // Registered BEFORE any fixture is created, and mutated as each one succeeds — so a throw
  // partway through setup (e.g. customersService.create() failing after the region already
  // committed) still cleans up whatever did get created, instead of orphaning it silently. Found
  // the hard way: an earlier cross-file race condition left exactly this kind of orphaned region
  // behind, because cleanup was registered only after both fixtures had already succeeded.
  const created = {};
  t.after(() => cleanupFixtures(created));

  const region = await regionsService.create({ name: `TEST-REGION-${Date.now()}` });
  created.regionId = region.region_id;

  const customer = await customersService.create({
    name: `TEST-CUSTOMER-${Date.now()}`,
    region_id: region.region_id,
    opening_balance: 54321.5,
    opening_date: '2026-01-01',
  });
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;

  assert.ok(customer.ba_id, 'customer create() should auto-link a business account');

  const after = await trialBalanceIsZero();
  assert.equal(
    after.debit,
    after.credit,
    `an opening balance of 54321.5 broke the trial balance (debit=${after.debit}, credit=${after.credit}) — ` +
      'syncOpeningEntries() is not writing a balanced counter-entry',
  );
  // Not just "still balanced overall" (that would also pass if nothing were written at all) —
  // confirm the OPENING pair for THIS account was actually written, on the correct side: a
  // positive opening_balance means the customer owes us, i.e. their account is debited.
  const legs = await query(
    "SELECT debit, credit FROM dbo.ledger_entries WHERE ba_id = @baId AND source_type = 'OPENING'",
    { baId: customer.ba_id },
  );
  assert.equal(legs.recordset.length, 1, 'expected exactly one OPENING ledger row for the new account');
  assert.equal(Number(legs.recordset[0].debit), 54321.5);
  assert.equal(Number(legs.recordset[0].credit), 0);
});

test.after(async () => {
  await closePool();
});
