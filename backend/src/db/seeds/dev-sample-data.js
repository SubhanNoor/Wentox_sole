// DEV/TEST DATA ONLY — never run this against a client's real database.
//
// npm run seed:dev — separate from npm run seed (which only seeds the admin user + reference
// chart-of-accounts data, safe for a fresh production install). This script populates a full
// demo business: master data (regions, cities, addas, vendors, categories, products with colour
// variants and production stock, customers, sub-customers, banks, employees, expense heads) AND
// ~3 months of posted transactions (sale bills, returns, purchases, purchase returns, receipts
// with commission, cheque dispositions, expenses, transfers, wage runs, a salary run), plus a
// handful of deliberate EDGE STATES so the paths most likely to be wrong can actually be checked.
//
// Everything goes through the REAL service layer — never raw SQL — so every auto-created linked
// business account, generated code, and validation rule fires exactly as it would through the UI.
// A seed that inserted rows directly would prove nothing about whether the app works.
//
// Intended target is a throwaway database, NOT the working one:
//   DB_NAME=wentox_demo npm run migrate
//   DB_NAME=wentox_demo npm run seed
//   DB_NAME=wentox_demo npm run seed:dev
//   DB_NAME=wentox_demo npm run electron:dev
// src/config/index.js already reads process.env.DB_NAME and src/db/migrate.js already creates the
// database if it's missing, so no .env edit is needed — drop the prefix to go back to normal.
//
// IDEMPOTENCY: master data uses ensure() and is safe to re-run (services resolve an existing
// ACTIVE row instead of erroring). Transactions are NOT idempotent — re-running would double the
// books — so that phase is skipped entirely if any sale_bills row already exists.

const regionsService = require('../../services/regions.service');
const citiesService = require('../../services/cities.service');
const addasService = require('../../services/addas.service');
const storesService = require('../../services/stores.service');
const vendorsService = require('../../services/vendors.service');
const categoriesService = require('../../services/categories.service');
const productsService = require('../../services/products.service');
const stockService = require('../../services/stock.service');
const customersService = require('../../services/customers.service');
const subCustomersService = require('../../services/subCustomers.service');
const bankAccountsService = require('../../services/bankAccounts.service');
const employeesService = require('../../services/employees.service');
const businessAccountsService = require('../../services/businessAccounts.service');
const saleBillsService = require('../../services/saleBills.service');
const saleReturnsService = require('../../services/saleReturns.service');
const draftSaleBillsService = require('../../services/draftSaleBills.service');
const purchasesService = require('../../services/purchases.service');
const purchaseReturnsService = require('../../services/purchaseReturns.service');
const draftPurchasesService = require('../../services/draftPurchases.service');
const receiptsService = require('../../services/receipts.service');
const chequesService = require('../../services/cheques.service');
const expensesService = require('../../services/expenses.service');
const transfersService = require('../../services/transfers.service');
const depositsService = require('../../services/deposits.service');
const wageRunsService = require('../../services/wageRuns.service');
const salaryRunsService = require('../../services/salaryRuns.service');
const CODES = require('../../constants/reservedAccounts');

const repository = {
  regions: require('../../repositories/regions.repository'),
  cities: require('../../repositories/cities.repository'),
  addas: require('../../repositories/addas.repository'),
  stores: require('../../repositories/stores.repository'),
  vendors: require('../../repositories/vendors.repository'),
  categories: require('../../repositories/categories.repository'),
  products: require('../../repositories/products.repository'),
  customers: require('../../repositories/customers.repository'),
  subCustomers: require('../../repositories/subCustomers.repository'),
  bankAccounts: require('../../repositories/bankAccounts.repository'),
  employees: require('../../repositories/employees.repository'),
  chartAccounts: require('../../repositories/chartAccounts.repository'),
  businessAccounts: require('../../repositories/businessAccounts.repository'),
  saleBills: require('../../repositories/saleBills.repository'),
};

const ADMIN_USER_ID = 1; // seeded by npm run seed — used as created_by throughout
const ADMIN_SESSION = { userId: ADMIN_USER_ID, username: 'admin', role: 'ADMIN' };

// ── helpers ────────────────────────────────────────────────────────────────────

async function ensure(findFn, createFn, label) {
  const existing = await findFn();
  if (existing) {
    console.log(`  exists: ${label}`);
    return existing;
  }
  const created = await createFn();
  console.log(`  created: ${label}`);
  return created;
}

// Every date is a fixed offset from today, so two runs produce the same shape and the totals stay
// predictable enough to check by hand. Deliberately no randomness anywhere in this script.
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthAgo(monthsBack) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}

// ── phase 1: master data ───────────────────────────────────────────────────────

async function seedMaster() {
  console.log('\n=== MASTER DATA ===');

  console.log('Regions & cities:');
  const regionSpecs = [
    { region: 'Punjab', city: 'Lahore' },
    { region: 'Sindh', city: 'Karachi' },
    { region: 'KPK', city: 'Peshawar' },
  ];
  const geo = {};
  for (const spec of regionSpecs) {
    const region = await ensure(
      () => repository.regions.findByName(spec.region),
      () => regionsService.create({ name: spec.region }),
      `region ${spec.region}`
    );
    const city = await ensure(
      () => repository.cities.findByName(spec.city),
      () => citiesService.create({ name: spec.city, region_id: region.region_id }),
      `city ${spec.city}`
    );
    geo[spec.region] = { region, city };
  }

  console.log('Stores:');
  const mainStore = await ensure(
    () => repository.stores.findByName('Main Store'),
    () => storesService.create({ name: 'Main Store' }),
    'store Main Store'
  );

  console.log('Addas:');
  const addaLhr = await ensure(
    () => repository.addas.findByName('Badami Bagh Adda'),
    () => addasService.create({
      name: 'Badami Bagh Adda',
      region_id: geo.Punjab.region.region_id,
      city_id: geo.Punjab.city.city_id,
    }),
    'adda Badami Bagh Adda'
  );
  await ensure(
    () => repository.addas.findByName('Karachi Goods Adda'),
    () => addasService.create({
      name: 'Karachi Goods Adda',
      region_id: geo.Sindh.region.region_id,
      city_id: geo.Sindh.city.city_id,
    }),
    'adda Karachi Goods Adda'
  );

  console.log('Vendors:');
  const vendorSpecs = [
    { name: 'Decent Polyurethane', phone: '0300-1234567', geo: 'Punjab' },
    { name: 'Ittehad Chemicals', phone: '0321-9876543', geo: 'Sindh' },
    { name: 'Al-Madina Rubber', phone: '0333-5551234', geo: 'Punjab' },
  ];
  const vendors = [];
  for (const spec of vendorSpecs) {
    vendors.push(await ensure(
      () => repository.vendors.findByNameAndPhone(spec.name, spec.phone),
      () => vendorsService.create({
        name: spec.name,
        phone: spec.phone,
        region_id: geo[spec.geo].region.region_id,
        city_id: geo[spec.geo].city.city_id,
      }),
      `vendor ${spec.name}`
    ));
  }

  console.log('Categories:');
  const categories = {};
  for (const name of ['Jogger Sole (PU)', 'Slipper Sole (EVA)', 'Sports Sole (TPR)']) {
    categories[name] = await ensure(
      () => repository.categories.findByName(name),
      () => categoriesService.create({ name }),
      `category ${name}`
    );
  }

  console.log('Products + colour variants + production stock:');
  // Cost columns matter: Wage Run snapshots its rate from the stage's own column
  // (src/constants/stages.js maps stage_key -> cost column), so a product with 0 costs would
  // produce a wage run worth nothing.
  const productSpecs = [
    { name: 'Jogger Sole 101', cat: 'Jogger Sole (PU)', vendor: 0, packing: 12, price: 470, colors: ['Black', 'White'], costs: { cutting: 20, edging: 15, bending: 12, finish: 10 } },
    { name: 'Jogger Sole 102', cat: 'Jogger Sole (PU)', vendor: 0, packing: 12, price: 480, colors: ['Black'], costs: { cutting: 22, edging: 16, bending: 13, finish: 11 } },
    { name: 'Casual Slipper 551', cat: 'Slipper Sole (EVA)', vendor: 2, packing: 12, price: 260, colors: ['Brown', 'Black'], costs: { cutting: 14, edging: 9, bending: 8, finish: 7 } },
    { name: 'Sports Sole 700', cat: 'Sports Sole (TPR)', vendor: 1, packing: 24, price: 610, colors: ['Blue'], costs: { cutting: 25, edging: 18, bending: 15, finish: 12 } },
    { name: 'Sports Sole 705', cat: 'Sports Sole (TPR)', vendor: 1, packing: 24, price: 650, colors: ['Black'], costs: { cutting: 26, edging: 19, bending: 16, finish: 13 } },
  ];

  const variants = [];
  const products = [];
  for (const spec of productSpecs) {
    const vendor = vendors[spec.vendor];
    const product = await ensure(
      () => repository.products.findByNameAndVendor(spec.name, vendor.vendor_id),
      () => productsService.create({
        name: spec.name,
        category_id: categories[spec.cat].category_id,
        vendor_id: vendor.vendor_id,
        packing: spec.packing,
        sale_price: spec.price,
        ...spec.costs,
      }),
      `product ${spec.name}`
    );
    products.push(product);

    for (const color of spec.colors) {
      // Production is the only non-idempotent bit of master data — it always adds a movement.
      // Guarded by the same sale_bills sentinel as the transaction phase (see seed()).
      const result = await stockService.logProduction(
        {
          article_id: product.article_id,
          color,
          packing: spec.packing,
          movement_date: daysAgo(100),
          input_qty: 60,
          input_unit: 'CARTONS',
        },
        ADMIN_USER_ID
      );
      console.log(`  stocked: ${spec.name} / ${color} — +${result.qty_pairs} pairs`);
      variants.push({ ...result, article_id: product.article_id, color, name: spec.name, packing: spec.packing, price: spec.price });
    }
  }

  console.log('Customers:');
  const customerSpecs = [
    { name: 'Ahmed Footwear', geo: 'Punjab' },
    { name: 'Karachi Boot House', geo: 'Sindh' },
    { name: 'Malik Traders', geo: 'Punjab' },
    { name: 'Peshawar Shoe Mart', geo: 'KPK' },
    { name: 'Bilal Shoes', geo: 'Sindh' },
    { name: 'Zeeshan Traders', geo: 'Punjab' }, // deactivated at the end — reactivate-flow fixture
  ];
  const customers = [];
  for (const spec of customerSpecs) {
    customers.push(await ensure(
      () => repository.customers.findByName(spec.name),
      () => customersService.create({
        name: spec.name,
        region_id: geo[spec.geo].region.region_id,
        city_id: geo[spec.geo].city.city_id,
        address: `${spec.name} Shop, ${geo[spec.geo].city.name} Market`,
      }),
      `customer ${spec.name}`
    ));
  }

  console.log('Sub-customers (delivery agents):');
  for (const spec of [{ name: 'Rehman Delivery', geo: 'Punjab' }, { name: 'Sindh Cargo Service', geo: 'Sindh' }]) {
    await ensure(
      () => repository.subCustomers.findByName(spec.name),
      () => subCustomersService.create({
        name: spec.name,
        region_id: geo[spec.geo].region.region_id,
        city_id: geo[spec.geo].city.city_id,
      }),
      `sub-customer ${spec.name}`
    );
  }

  console.log('Bank accounts:');
  const bankSpecs = [
    { name: 'Meezan Bank', account_no: '0123-4567-8901', branch: 'Shalimar Link Road' },
    { name: 'Habib Bank Ltd', account_no: '9988-7766-5544', branch: 'Karachi Saddar' },
  ];
  // Deliberately NO opening_balance here. `business_accounts.opening_balance` is a stored input
  // with no contra ledger row, so a non-zero one makes Overall Trail's trial balance not balance
  // by exactly that amount (there is no Opening Balance Equity account in this schema). The banks
  // are funded below by a real Deposit instead — Dr bank / Cr MISC ADJUSTMENTS — which is a
  // balanced posting and is what the deposits feature exists for.
  const banks = [];
  for (const spec of bankSpecs) {
    banks.push(await ensure(
      () => repository.bankAccounts.findByNameAndAccountNo(spec.name, spec.account_no),
      () => bankAccountsService.create(spec),
      `bank ${spec.name}`
    ));
  }

  console.log('Employees:');
  const employeeSpecs = [
    { name: 'Aslam Cutter', employee_type: 'WORKER', phone: '0301-1111111', stages: ['cutting', 'edging'] },
    { name: 'Rafiq Finisher', employee_type: 'WORKER', phone: '0302-2222222', stages: ['bending', 'finish'] },
    { name: 'Nadeem Accountant', employee_type: 'SALARIED', phone: '0303-3333333', monthly_salary: 45000 },
    { name: 'Shahid Manager', employee_type: 'SALARIED', phone: '0304-4444444', monthly_salary: 60000 },
  ];
  const employees = [];
  for (const spec of employeeSpecs) {
    employees.push(await ensure(
      () => repository.employees.findByNameAndPhone(spec.name, spec.phone),
      () => employeesService.create({ ...spec, city_id: geo.Punjab.city.city_id }),
      `employee ${spec.name} (${spec.employee_type})`
    ));
  }

  // Expense heads. Without these, Payment Trail's "Business Running Expenses" and
  // "Directors Expenses – Drawings" buckets read 0 — which looks like a report bug but is
  // really just an empty chart head with no business accounts under it.
  console.log('Expense heads (business accounts):');
  const runningExpenses = await repository.chartAccounts.findByCode(CODES.BUSINESS_RUNNING_EXPENSES);
  const directorsDrawings = await repository.chartAccounts.findByCode(CODES.DIRECTORS_DRAWINGS);
  const headSpecs = [
    { name: 'Shop Rent', ac_id: runningExpenses.ac_id },
    { name: 'Utilities — Electricity', ac_id: runningExpenses.ac_id },
    { name: 'Old Warehouse Rent', ac_id: runningExpenses.ac_id }, // closed at the end
    { name: 'Director Drawings — Bilal', ac_id: directorsDrawings.ac_id },
  ];
  const heads = {};
  for (const spec of headSpecs) {
    const existing = (await repository.businessAccounts.list({ ac_id: spec.ac_id }))
      .find((b) => b.name === spec.name);
    heads[spec.name] = existing
      ? (console.log(`  exists: head ${spec.name}`), existing)
      : (console.log(`  created: head ${spec.name}`), await businessAccountsService.create(spec));
  }

  return { geo, mainStore, addaLhr, vendors, products, variants, customers, banks, employees, heads };
}

// ── phase 2 + 3: transactions and edge states ──────────────────────────────────

async function seedTransactions(m) {
  console.log('\n=== TRANSACTIONS ===');

  // Opening capital into both banks as real, balanced Deposits (Dr bank / Cr MISC ADJUSTMENTS)
  // rather than business_accounts.opening_balance, which has no contra entry — see the note in
  // seedMaster(). Everything downstream (ONLINE receipts, bank expenses, transfers) needs the
  // banks funded first.
  console.log('Opening capital (deposits):');
  for (const [i, bank] of m.banks.entries()) {
    const dep = await depositsService.create({
      deposit_date: daysAgo(110),
      to_ba_id: bank.ba_id,
      direction: 'CREDIT',
      amount: 500000,
      source: 'Owner capital',
      remarks: 'Opening capital injected',
    }, ADMIN_USER_ID);
    await depositsService.post(dep.deposit_id, ADMIN_USER_ID);
    console.log(`  ${bank.name} funded with 500,000 (deposit ${i + 1})`);
  }

  const v = m.variants;
  const cust = m.customers;
  const billBase = {
    store_id: m.mainStore.store_id,
    adda_id: m.addaLhr.adda_id,
    delivery_type: 'SAME',
  };

  // --- Sale bills, spread across ~3 months so weekly / monthly / between-dates all differ ---
  console.log('Sale bills:');
  const billSpecs = [
    { d: 88, c: 0, items: [[0, 8], [1, 4]], gp: 'GP-1001', due: null },
    { d: 80, c: 1, items: [[3, 5]], gp: 'GP-1002', due: null, invoiceDiscount: 500 },
    { d: 74, c: 2, items: [[2, 10]], gp: 'GP-1003', due: null },
    { d: 66, c: 0, items: [[4, 3], [0, 2]], gp: 'GP-1004', due: null },
    { d: 60, c: 3, items: [[1, 6]], gp: 'GP-1005', due: null, discountPercent: 5 },
    { d: 52, c: 4, items: [[2, 7]], gp: 'GP-1006', due: null },
    { d: 45, c: 1, items: [[3, 4], [4, 2]], gp: 'GP-1007', due: null },
    { d: 38, c: 2, items: [[0, 6]], gp: 'GP-1008', due: daysAgo(8) }, // OVERDUE -> alert
    { d: 30, c: 0, items: [[5, 5]], gp: 'GP-1009', due: null },
    { d: 24, c: 3, items: [[1, 8]], gp: 'GP-1010', due: null, invoiceDiscount: 1200 },
    { d: 17, c: 4, items: [[2, 6], [3, 3]], gp: 'GP-1011', due: null },
    { d: 11, c: 1, items: [[4, 4]], gp: 'GP-1012', due: null },
    { d: 5, c: 0, items: [[0, 7]], gp: 'GP-1013', due: null, discountPercent: 3 },
    { d: 2, c: 2, items: [[5, 4]], gp: 'GP-1014', due: null },
  ];

  const bills = [];
  for (const [i, spec] of billSpecs.entries()) {
    const bill = await saleBillsService.create({
      ...billBase,
      bill_date: daysAgo(spec.d),
      customer_id: cust[spec.c].customer_id,
      main_ac_id: cust[spec.c].ba_id,
      bill_no: `SB-${2001 + i}`,
      gp_no: spec.gp,
      bilty_no: `BLT-${5001 + i}`,
      due_date: spec.due,
      invoice_discount: spec.invoiceDiscount || 0,
      remarks: 'Demo sale bill',
      items: spec.items.map(([vi, cartons]) => ({
        variant_id: v[vi].variant_id,
        cartons,
        rate: v[vi].price,
        discount_percent: spec.discountPercent || 0,
      })),
    }, ADMIN_USER_ID);
    await saleBillsService.post(bill.bill_id);
    bills.push(bill);
  }
  console.log(`  posted ${bills.length} sale bills`);

  // --- Sale returns ---
  console.log('Sale returns:');
  const returnSpecs = [
    { d: 70, c: 0, items: [[0, 1]] },
    { d: 40, c: 2, items: [[2, 2]] },
    { d: 12, c: 1, items: [[3, 1]] },
  ];
  for (const [i, spec] of returnSpecs.entries()) {
    const ret = await saleReturnsService.create({
      ...billBase,
      return_date: daysAgo(spec.d),
      customer_id: cust[spec.c].customer_id,
      bill_no: `SR-${3001 + i}`,
      gp_no: `GPR-${3001 + i}`,
      bilty_no: `BLTR-${3001 + i}`,
      remarks: 'Damaged pieces returned',
      items: spec.items.map(([vi, cartons]) => ({
        variant_id: v[vi].variant_id,
        cartons,
        rate: v[vi].price,
      })),
    }, ADMIN_USER_ID);
    await saleReturnsService.post(ret.return_id);
  }
  console.log(`  posted ${returnSpecs.length} sale returns`);

  // --- Purchases (materials auto-register on first use) ---
  console.log('Purchases:');
  const purchaseSpecs = [
    { d: 85, vendor: 0, items: [['PU Sheet Roll', 'Meters', 400, 320], ['Hardener', 'KG', 50, 900]] },
    { d: 72, vendor: 1, items: [['EVA Compound', 'KG', 200, 640]] },
    { d: 58, vendor: 2, items: [['Rubber Sheet', 'Meters', 300, 410], ['Adhesive', 'KG', 40, 1150]] },
    { d: 41, vendor: 0, items: [['PU sheet roll', 'Meters', 250, 335]] }, // same material, different case
    { d: 26, vendor: 1, items: [['EVA Compound', 'KG', 180, 655], ['Colour Pigment', 'KG', 15, 2200]] },
    { d: 9, vendor: 2, items: [['Rubber Sheet', 'Meters', 220, 425]] },
  ];
  const purchases = [];
  for (const [i, spec] of purchaseSpecs.entries()) {
    const purchase = await purchasesService.create({
      purchase_date: daysAgo(spec.d),
      vendor_id: m.vendors[spec.vendor].vendor_id,
      bill_no: `VB-${7001 + i}`,
      remarks: 'Demo purchase',
      items: spec.items.map(([material_name, unit, quantity, price_per_unit]) => ({
        material_name, unit, quantity, price_per_unit,
      })),
    }, ADMIN_USER_ID);
    await purchasesService.post(purchase.purchase_id);
    purchases.push(purchase);
  }
  console.log(`  posted ${purchases.length} purchases`);

  console.log('Purchase returns:');
  const prSpecs = [
    { d: 64, vendor: 0, items: [['PU Sheet Roll', 'Meters', 30, 320]] },
    { d: 20, vendor: 1, items: [['EVA Compound', 'KG', 15, 655]] },
  ];
  for (const [i, spec] of prSpecs.entries()) {
    const pr = await purchaseReturnsService.create({
      return_date: daysAgo(spec.d),
      vendor_id: m.vendors[spec.vendor].vendor_id,
      bill_no: `VR-${8001 + i}`,
      remarks: 'Off-spec material returned',
      items: spec.items.map(([material_name, unit, quantity, price_per_unit]) => ({
        material_name, unit, quantity, price_per_unit,
      })),
    }, ADMIN_USER_ID);
    await purchaseReturnsService.post(pr.return_id);
  }
  console.log(`  posted ${prSpecs.length} purchase returns`);

  // --- Receipts. Commission is deliberately present on several: it's the one column Sale Report
  //     is easiest to get wrong (it must come from receipts.commission, never sale-time discount).
  console.log('Receipts (Jamma):');
  const receiptSpecs = [
    { d: 78, c: 0, amount: 40000, commission: 0, mode: 'CASH' },
    { d: 68, c: 1, amount: 25000, commission: 1500, mode: 'CASH' },
    { d: 55, c: 2, amount: 30000, commission: 0, mode: 'ONLINE', bank: 0 },
    { d: 47, c: 0, amount: 18000, commission: 800, mode: 'CASH' },
    { d: 33, c: 3, amount: 22000, commission: 0, mode: 'ONLINE', bank: 1 },
    { d: 21, c: 4, amount: 15000, commission: 1200, mode: 'CASH' },
    { d: 14, c: 2, amount: 27000, commission: 0, mode: 'CASH' },
    { d: 6, c: 1, amount: 12000, commission: 600, mode: 'ONLINE', bank: 0 },
    // Dated TODAY on purpose: Cash Book opens on today's date, so without a same-day cash
    // movement it renders empty on first open and looks broken.
    { d: 0, c: 0, amount: 16500, commission: 0, mode: 'CASH' },
  ];
  for (const spec of receiptSpecs) {
    const receipt = await receiptsService.create({
      receipt_date: daysAgo(spec.d),
      // Receipts name a business account, not a customer (migration 014) — a customer's own ba_id
      // is one, so the demo's customer receipts read exactly the same as before.
      ba_id: cust[spec.c].ba_id,
      amount: spec.amount,
      commission: spec.commission,
      payment_mode: spec.mode,
      bank_id: spec.mode === 'ONLINE' ? m.banks[spec.bank].bank_id : undefined,
      details: spec.mode === 'ONLINE' ? 'IBFT transfer' : undefined,
      remarks: spec.mode === 'CASH' ? 'CASH' : 'ONLINE TRANSFER',
    }, ADMIN_USER_ID);
    await receiptsService.post(receipt.receipt_id);
  }
  console.log(`  posted ${receiptSpecs.length} cash/online receipts`);

  // --- Cheque receipts + their dispositions (the reversal-prone paths) ---
  console.log('Cheque receipts & dispositions:');
  const makeCheque = async (dayOffset, customerIdx, amount, chequeNo, chequeDateOffset) => {
    const receipt = await receiptsService.create({
      receipt_date: daysAgo(dayOffset),
      ba_id: cust[customerIdx].ba_id,
      amount,
      commission: 0,
      payment_mode: 'CHEQUE',
      cheque_no: chequeNo,
      cheque_date: daysAgo(chequeDateOffset),
      cheque_received_date: daysAgo(dayOffset),
      remarks: `CHEQUE ${chequeNo}`,
    }, ADMIN_USER_ID);
    await receiptsService.post(receipt.receipt_id);
    return receiptsService.getById(receipt.receipt_id);
  };

  // 1. Deposited then cleared — the clean path.
  const chq1 = await makeCheque(50, 0, 60000, '28423916', 48);
  await chequesService.deposit(chq1.cheque_id, { bank_id: m.banks[0].bank_id, allocation_date: daysAgo(46) }, ADMIN_USER_ID);
  await chequesService.markCleared(chq1.cheque_id);
  console.log('  cheque 28423916 — deposited and CLEARED');

  // 2. Partially endorsed to a vendor, then BOUNCED. This is the cascade: the receipt reverses
  //    AND the vendor allocation flips to REVERSED. Correcting only one side is a known bug class.
  const chq2 = await makeCheque(35, 1, 50000, '55120744', 33);
  await chequesService.endorseToVendor(chq2.cheque_id, {
    vendor_id: m.vendors[0].vendor_id,
    allocation_date: daysAgo(31),
    amount: 30000,
  }, ADMIN_USER_ID);
  await chequesService.bounce(chq2.cheque_id, { bounced_date: daysAgo(18) }, ADMIN_USER_ID);
  console.log('  cheque 55120744 — endorsed 30k to vendor, then BOUNCED (cascade)');

  // 3. Still PENDING, cheque date inside the 7-day alert window.
  const chq3 = await makeCheque(4, 2, 35000, '77341290', -3);
  console.log(`  cheque 77341290 — PENDING, due ${daysAgo(-3)} (fires the cheque-due alert)`);

  // 4. Partially endorsed and left PARTIALLY_ENDORSED, so the disposal screen has live work.
  const chq4 = await makeCheque(10, 4, 45000, '91002233', 8);
  await chequesService.endorseToVendor(chq4.cheque_id, {
    vendor_id: m.vendors[2].vendor_id,
    allocation_date: daysAgo(7),
    amount: 20000,
  }, ADMIN_USER_ID);
  console.log('  cheque 91002233 — PARTIALLY_ENDORSED, 25k still unallocated');

  // --- Expenses across every Payment Trail bucket ---
  console.log('Expenses (Kharch):');
  const expenseSpecs = [
    { d: 82, vendor: 0, amount: 90000, mode: 'CASH' },
    { d: 63, vendor: 1, amount: 65000, mode: 'ONLINE', bank: 0 },
    { d: 57, head: 'Shop Rent', amount: 35000, mode: 'CASH' },
    { d: 44, head: 'Utilities — Electricity', amount: 18500, mode: 'CASH' },
    { d: 36, vendor: 2, amount: 72000, mode: 'CHEQUE_ISSUED', bank: 1, chequeNo: 'ISS-4471' },
    { d: 28, head: 'Director Drawings — Bilal', amount: 50000, mode: 'CASH' },
    { d: 15, head: 'Shop Rent', amount: 35000, mode: 'ONLINE', bank: 1 },
    { d: 3, head: 'Utilities — Electricity', amount: 21000, mode: 'CASH' },
    // Paying staff — an expense against the employee's own linked business account. Without these
    // Payment Trail's "Employees" bucket reads 0 even with payroll posted, because a wage/salary
    // RUN only accrues the liability; paying it out is a separate Expense.
    { d: 30, employee: 0, amount: 9000, mode: 'CASH' },
    { d: 12, employee: 2, amount: 45000, mode: 'ONLINE', bank: 0 },
    { d: 0, head: 'Utilities — Electricity', amount: 4800, mode: 'CASH' }, // today — see Cash Book note
  ];
  for (const spec of expenseSpecs) {
    const expense = await expensesService.create({
      expense_date: daysAgo(spec.d),
      vendor_id: spec.vendor !== undefined ? m.vendors[spec.vendor].vendor_id : undefined,
      ba_id: spec.head ? m.heads[spec.head].ba_id
        : spec.employee !== undefined ? m.employees[spec.employee].ba_id
        : undefined,
      amount: spec.amount,
      payment_mode: spec.mode,
      bank_id: spec.bank !== undefined ? m.banks[spec.bank].bank_id : undefined,
      issued_cheque_no: spec.chequeNo,
      issued_cheque_date: spec.chequeNo ? daysAgo(spec.d) : undefined,
      remarks: spec.head || (spec.employee !== undefined ? 'Staff payment' : 'Vendor payment'),
    }, ADMIN_USER_ID);
    await expensesService.post(expense.expense_id, ADMIN_USER_ID);
  }
  console.log(`  posted ${expenseSpecs.length} expenses`);

  // --- Transfers (one posted, one left DRAFT) ---
  console.log('Transfers:');
  const cashAccount = await businessAccountsService.getCashAccount();
  const t1 = await transfersService.create({
    transfer_date: daysAgo(40),
    from_ba_id: m.banks[0].ba_id,
    to_ba_id: cashAccount.ba_id,
    amount: 120000,
    remarks: 'Cash withdrawn for weekly wages',
  }, ADMIN_USER_ID);
  await transfersService.post(t1.transfer_id, ADMIN_USER_ID);

  const t2 = await transfersService.create({
    transfer_date: daysAgo(13),
    from_ba_id: m.banks[0].ba_id,
    to_ba_id: m.banks[1].ba_id,
    amount: 80000,
    remarks: 'Bank to bank — posted',
  }, ADMIN_USER_ID);
  await transfersService.post(t2.transfer_id, ADMIN_USER_ID);

  await transfersService.create({
    transfer_date: daysAgo(1),
    from_ba_id: m.banks[1].ba_id,
    to_ba_id: cashAccount.ba_id,
    amount: 25000,
    remarks: 'DRAFT — not posted, edge-state fixture',
  }, ADMIN_USER_ID);
  console.log('  2 posted transfers + 1 left DRAFT');

  // --- Payroll ---
  console.log('Payroll:');
  const workers = m.employees.filter((e) => e.employee_type === 'WORKER');
  const w1 = await wageRunsService.create({
    employee_id: workers[0].employee_id,
    stage_key: 'cutting',
    run_date: daysAgo(37),
    remarks: 'Weekly cutting settlement',
    items: [
      { article_id: m.products[0].article_id, cartons: 20 },
      { article_id: m.products[1].article_id, cartons: 12 },
    ],
  }, ADMIN_USER_ID);
  await wageRunsService.post(w1.wage_run_id, ADMIN_USER_ID);

  const w2 = await wageRunsService.create({
    employee_id: workers[1].employee_id,
    stage_key: 'finish',
    run_date: daysAgo(16),
    remarks: 'Finishing settlement',
    items: [{ article_id: m.products[2].article_id, cartons: 25 }],
  }, ADMIN_USER_ID);
  await wageRunsService.post(w2.wage_run_id, ADMIN_USER_ID);

  await wageRunsService.create({
    employee_id: workers[0].employee_id,
    stage_key: 'edging',
    run_date: daysAgo(2),
    remarks: 'DRAFT — not posted, edge-state fixture',
    items: [{ article_id: m.products[0].article_id, cartons: 8 }],
  }, ADMIN_USER_ID);
  console.log('  2 posted wage runs + 1 left DRAFT');

  const salaryRun = await salaryRunsService.create({
    period_month: firstOfMonthAgo(1),
    run_date: daysAgo(20),
    overrides: [],
  }, ADMIN_USER_ID);
  await salaryRunsService.post(salaryRun.salary_run_id, ADMIN_USER_ID);
  console.log('  1 posted salary run (last month, all active salaried staff)');

  // --- Drafts, so the Drafts tabs aren't empty ---
  console.log('Drafts:');
  await draftSaleBillsService.create({
    ...billBase,
    bill_date: daysAgo(1),
    customer_id: cust[3].customer_id,
    main_ac_id: cust[3].ba_id,
    bill_no: 'SB-DRAFT-1',
    gp_no: 'GP-DRAFT-1',
    bilty_no: 'BLT-DRAFT-1',
    remarks: 'Unfinished bill — draft fixture',
    items: [{ variant_id: v[0].variant_id, cartons: 3, rate: v[0].price }],
  }, ADMIN_USER_ID);

  await draftPurchasesService.create({
    purchase_date: daysAgo(1),
    vendor_id: m.vendors[0].vendor_id,
    bill_no: 'VB-DRAFT-1',
    remarks: 'Unfinished purchase — draft fixture',
    items: [{ material_name: 'PU Sheet Roll', unit: 'Meters', quantity: 100, price_per_unit: 340 }],
  }, ADMIN_USER_ID);
  console.log('  1 draft sale bill + 1 draft purchase');

  // --- Remaining edge states ---
  console.log('Edge states:');
  await businessAccountsService.remove(m.heads['Old Warehouse Rent'].ba_id, ADMIN_SESSION);
  console.log('  business account "Old Warehouse Rent" -> CLOSED');

  await customersService.remove(m.customers[5].customer_id);
  console.log('  customer "Zeeshan Traders" -> soft-deleted (reactivate-flow fixture)');
}

// ── entry point ────────────────────────────────────────────────────────────────

async function seed() {
  const config = require('../../config');
  console.log(`Seeding demo data into database: ${config.db.database}`);
  if (config.db.database === 'wentox') {
    console.log('\n  NOTE: this is the default working database. The demo dataset is normally');
    console.log('  seeded into a throwaway one: DB_NAME=wentox_demo npm run seed:dev\n');
  }

  const existingBills = await repository.saleBills.list({});
  if (existingBills.length) {
    console.log(`\nThis database already has ${existingBills.length} sale bills — transactions are NOT`);
    console.log('idempotent, so re-running would double the books. Master data will be verified only.');
    await seedMasterOnlyCheck();
    return;
  }

  const master = await seedMaster();
  await seedTransactions(master);

  console.log('\n=== DONE ===');
  console.log('Login: admin / admin123');
  console.log('Reports to check: Sale Analysis, Sale Report (Commission column), Vendor Report,');
  console.log('Payment Trail (all 5 buckets), Khaata, Business Ledger, Cash Book, Product Ledger,');
  console.log('Overall Trail (its grand total debit must equal total credit), Overall Search.');
}

// Re-run path: confirm the master data is present without touching the books.
async function seedMasterOnlyCheck() {
  const counts = {
    regions: (await repository.regions.list({})).length,
    customers: (await repository.customers.list({})).length,
    vendors: (await repository.vendors.list({})).length,
    products: (await repository.products.list({})).length,
  };
  console.log('  master data present:', JSON.stringify(counts));
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nseed:dev failed:', err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    process.exitCode = 1;
  });
