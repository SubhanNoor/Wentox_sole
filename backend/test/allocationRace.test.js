// Regression suite for a genuine, easily-reproduced concurrency bug found while investigating Top
// 8 #2 (originally framed as a "system_no allocation race"). The document system_no columns
// (sale bill/return, purchase/return, journal voucher) turned out to already be race-free — they
// moved to real SQL Server SEQUENCE objects (migrations 031/035), which are atomic by design.
//
// The ACTUAL live race was elsewhere: businessAccounts/chartAccounts/groupAccounts/products
// repositories each allocate their own code via a plain "SELECT MAX(existing)+1, then INSERT" with
// no locking. Proved live (2026-09-20): 8 concurrent customersService.create() calls against the
// same reserved chart account produced 6 UNIQUE KEY violations out of 8 — two windows/users
// creating a customer/vendor/product around the same moment would hit this for real. Fixed via
// pool.js#acquireAppLock() (sp_getapplock, scoped per code-prefix, auto-released at commit) in all
// four repositories' nextSerial()/nextCode()/nextBatchNo() functions.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const customersService = require('../src/services/customers.service');
const productsService = require('../src/services/products.service');
const chartAccountsService = require('../src/services/chartAccounts.service');
const groupAccountsService = require('../src/services/groupAccounts.service');
const { makeRegion, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const CONCURRENCY = 8;

function assertAllSucceededWithUniqueCodes(results, codeOf, label) {
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(
    failed.length,
    0,
    `${label}: ${failed.length}/${results.length} concurrent creates failed — ` +
      `${failed.map((f) => f.reason.message).join(' | ')}`,
  );
  const codes = results.map((r) => codeOf(r.value));
  assert.equal(new Set(codes).size, codes.length, `${label}: expected ${codes.length} unique codes, got a collision — ${codes.join(', ')}`);
}

test('allocation race: concurrent customer creates never collide on business_accounts.code', async (t) => {
  const region = await makeRegion();
  const created = [];
  t.after(async () => {
    for (const c of created) {
      await query('DELETE FROM dbo.customers WHERE customer_id = @id', { id: c.customer_id });
      await query('DELETE FROM dbo.business_accounts WHERE ba_id = @id', { id: c.ba_id });
    }
    await cleanupFixtures({ regionId: region.region_id });
  });

  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, i) => customersService.create({
      name: `${uniqueName('CUST')}-${i}`,
      region_id: region.region_id,
    })),
  );
  for (const r of results) if (r.status === 'fulfilled') created.push(r.value);

  assertAllSucceededWithUniqueCodes(results, (customer) => customer.ba_id, 'business account codes');
});

test('allocation race: concurrent product creates never collide on articles.code', async (t) => {
  const categoriesService = require('../src/services/categories.service');
  const category = await categoriesService.create({ name: uniqueName('CATEGORY') });
  const created = [];
  t.after(async () => {
    for (const p of created) {
      await query('DELETE FROM dbo.articles WHERE article_id = @id', { id: p.article_id });
    }
    await query('DELETE FROM dbo.product_categories WHERE category_id = @id', { id: category.category_id });
  });

  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, i) => productsService.create({
      name: `${uniqueName('PRODUCT')}-${i}`,
      category_id: category.category_id,
      packing: 12,
    })),
  );
  for (const r of results) if (r.status === 'fulfilled') created.push(r.value);

  assertAllSucceededWithUniqueCodes(results, (product) => product.code, 'article codes');
});

test('allocation race: concurrent chart-account creates never collide on chart_of_accounts.code', async (t) => {
  // ASSETS (class_id 1) is seeded and permanent — no fixture/cleanup needed for the class itself.
  const group = await groupAccountsService.create({ name: uniqueName('GROUP'), class_id: 1 });
  const created = [];
  t.after(async () => {
    for (const c of created) {
      await query('DELETE FROM dbo.chart_of_accounts WHERE ac_id = @id', { id: c.ac_id });
    }
    await query('DELETE FROM dbo.group_accounts WHERE group_id = @id', { id: group.group_id });
  });

  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, i) => chartAccountsService.create({
      name: `${uniqueName('CHART')}-${i}`,
      group_id: group.group_id,
    })),
  );
  for (const r of results) if (r.status === 'fulfilled') created.push(r.value);

  assertAllSucceededWithUniqueCodes(results, (chart) => chart.code, 'chart account codes');
});

test('allocation race: concurrent group-account creates never collide on group_accounts.code', async (t) => {
  const created = [];
  t.after(async () => {
    for (const g of created) {
      await query('DELETE FROM dbo.group_accounts WHERE group_id = @id', { id: g.group_id });
    }
  });

  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, i) => groupAccountsService.create({
      name: `${uniqueName('GROUP2')}-${i}`,
      class_id: 1, // ASSETS, seeded
    })),
  );
  for (const r of results) if (r.status === 'fulfilled') created.push(r.value);

  assertAllSucceededWithUniqueCodes(results, (group) => group.code, 'group account codes');
});

test.after(async () => {
  await closePool();
});
