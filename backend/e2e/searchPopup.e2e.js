// Enter in a typable search box opens the popup listing EVERY name containing what was typed — it
// never picks one on the user's behalf, even when a name matches exactly or only one name fits (per
// the user, 2026-11-26). Enter on a box still showing the picked name moves on without the popup.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const customersService = require('../src/services/customers.service');
const vendorsService = require('../src/services/vendors.service');
const productsService = require('../src/services/products.service');
const categoriesService = require('../src/services/categories.service');
const { makeRegion } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// Two look-alike names of each kind: the first is wholly contained in the second.
const tag = `TEST-SRCH-${Date.now()}`;
const AHMED = `${tag} AHMED`;
const TRADERS = `${tag} AHMED TRADERS`;

let session;
test.before(async () => {
  session = await h.launchApp();
  await h.login(session.win);
});

test('search popup opens for typed names on every data entry page', async (t) => {
  const region = await makeRegion();
  const customers = [];
  for (const name of [AHMED, TRADERS]) customers.push(await customersService.create({ name, region_id: region.region_id }));
  const vendors = [];
  for (const name of [`${tag} VEND AHMED`, `${tag} VEND AHMED TRADERS`]) vendors.push(await vendorsService.create({ name }));
  const category = await categoriesService.create({ name: `${tag} CAT` });
  const products = [];
  for (const name of [`${AHMED} ART`, `${AHMED} ART TRADERS`]) {
    products.push(await productsService.create({ name, category_id: category.category_id, packing: 12 }));
  }
  t.after(async () => {
    for (const c of customers) await cleanupFixtures({ customerId: c.customer_id, ba_id: c.ba_id });
    await cleanupFixtures({ regionId: region.region_id });
    for (const v of vendors) {
      await query('DELETE FROM dbo.vendors WHERE vendor_id = @id', { id: v.vendor_id });
      if (v.ba_id != null) await query('DELETE FROM dbo.business_accounts WHERE ba_id = @id', { id: v.ba_id });
    }
    for (const p of products) await cleanupFixtures({ productId: p.article_id });
    await cleanupFixtures({ categoryId: category.category_id });
  });

  const { app, win } = session;
  const ACCOUNT = 'Type an account name, or press Enter to search...';
  const CUSTOMER = 'Type a customer name, or press Enter to search...';
  const VENDOR = 'Type a vendor name, or press Enter to search...';
  const ARTICLE = 'Type article code or name...';
  const pages = [
    { menu: 'SALE BILL', boxes: [[CUSTOMER, 'Select Customer', AHMED], [ARTICLE, 'Select Article', `${AHMED} ART`]] },
    { menu: 'SALE RETURN', boxes: [[CUSTOMER, 'Select Customer', AHMED], [ARTICLE, 'Select Article', `${AHMED} ART`]] },
    { menu: 'PURCHASE', boxes: [[VENDOR, 'Select Vendor', `${tag} VEND AHMED`]] },
    { menu: 'PURCHASE RETURN', boxes: [[VENDOR, 'Select Vendor', `${tag} VEND AHMED`]] },
    { menu: 'JOURNAL VOUCHER', boxes: [[ACCOUNT, 'Select Account', AHMED]] },
    { menu: 'STOCK VOUCHER', boxes: [[ARTICLE, 'Select Article', `${AHMED} ART`]] },
    { menu: 'RECEIPTS (JAMMA)', boxes: [[ACCOUNT, 'Select Account', AHMED]] },
    { menu: 'PAYMENTS (NAAM)', boxes: [[ACCOUNT, 'Select Account', AHMED]] },
  ];

  for (const { menu, boxes } of pages) {
    await t.test(menu, async () => {
      const page = menu === 'SALE BILL'
        ? await h.openInNewWindow(app, () => h.quickMenu(win, 'Sale Bill').click())
        : await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', menu)).click());
      await page.waitForTimeout(1000);
      await h.click(page, 'New');
      for (const [placeholder, title, typed] of boxes) {
        const box = page.getByPlaceholder(placeholder).first();
        const heading = page.locator('h3', { hasText: title });
        const listed = page.locator('div.shadow-2xl button', { hasText: tag });
        const openWith = async (text) => {
          await box.fill(text);
          await box.press('Enter');
          await heading.waitFor({ timeout: 5000 });
        };
        // The exact name of one entry, with another containing it: both listed, nothing picked.
        await openWith(typed);
        assert.equal(await listed.count(), 2, `${title}: both "${typed}" names must be listed`);
        await page.keyboard.press('Escape');
        await heading.waitFor({ state: 'hidden' });
        // Text only ONE name contains still opens the popup.
        const only = typed.endsWith(' ART') || typed.includes(' VEND ') ? `${typed} TRADERS` : TRADERS;
        await openWith(only);
        assert.equal(await listed.count(), 1, `${title}: the single match is shown, not auto-picked`);
        // The popup's own search box has the cursor, so Enter there chooses the highlighted name.
        const inPopup = () => page.evaluate(() => !!document.activeElement?.closest('div.shadow-2xl'));
        assert.equal(await h.eventually(inPopup, true, 3000), true,
          `${title}: the cursor must be in the popup, was on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160))}`);
        await page.keyboard.press('Enter'); // choose it
        await heading.waitFor({ state: 'hidden' });
        await page.waitForTimeout(500);
        const shown = await box.inputValue();
        // Enter on the box still showing the pick moves on, without the popup. (Vendor boxes and the
        // Stock Voucher's article box have always reopened it, and still do.)
        if (menu.startsWith('PURCHASE') || menu === 'STOCK VOUCHER') continue;
        await box.focus();
        await box.press('Enter');
        await page.waitForTimeout(500);
        assert.equal(await heading.isVisible(), false, `${title}: Enter on the picked "${shown}" must not reopen the popup`);
      }
      await page.close();
    });
  }
});

test.after(async () => {
  await session?.close();
  await closePool();
});
