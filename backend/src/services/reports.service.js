// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/reports.repository');
const stockService = require('./stock.service');
const vendorsService = require('./vendors.service');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const CODES = require('../constants/reservedAccounts');
const { findByCode } = require('../repositories/chartAccounts.repository');

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins) — same
// convention as saleBills.service.js/purchases.service.js#resolveDateRange.
function resolveDateRange(filters) {
  if (filters.date_from || filters.date_to) {
    return { date_from: filters.date_from, date_to: filters.date_to };
  }
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (filters.range === 'weekly') {
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    return { date_from: iso(from), date_to: iso(today) };
  }
  if (filters.range === 'monthly') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { date_from: iso(from), date_to: iso(today) };
  }
  return {}; // 'overall' or unspecified — no date filter
}

// Current Stock tab — thin pass-through to stock.service.js#currentStock (already does the
// cartons/extra-pairs conversion); kept as its own reports:stock channel per the milestone's
// naming, rather than folding the two modules together.
function stock(filters = {}) {
  return stockService.currentStock({ article_id: filters.article_id, category_id: filters.category_id });
}

function production(filters = {}) {
  return repository.productionLog({
    article_id: filters.article_id,
    category_id: filters.category_id,
    search: filters.search,
    ...resolveDateRange(filters),
  });
}

// UC-29/UC-38 Product Ledger — every stock_movements row (PRODUCTION, SALE, SALE_RETURN, OPENING,
// ADJUSTMENT), split into Debit(IN)/Credit(OUT) by the sign SQL Server already enforces
// (CK_stock_movements_sign): positive = IN, negative = OUT.
async function productLedger(filters = {}) {
  const rows = await repository.productLedger({
    article_id: filters.article_id,
    category_id: filters.category_id,
    vendor_id: filters.vendor_id,
    search: filters.search,
    ...resolveDateRange(filters),
  });
  let totalIn = 0;
  let totalOut = 0;
  const mapped = rows.map((r) => {
    const debit = r.qty_pairs > 0 ? r.qty_pairs : 0;
    const credit = r.qty_pairs < 0 ? -r.qty_pairs : 0;
    totalIn += debit;
    totalOut += credit;
    return { ...r, debit, credit };
  });
  return { rows: mapped, total_in: totalIn, total_out: totalOut, net: totalIn - totalOut };
}

// UC-30 Vendor Stock — read side; the write side (reduce quantity) lives on stock.service.js
// (stock:reduce-vendor-stock), since Reports itself is read-only (UC-30's own note is the one
// exception, and it belongs with the rest of the stock-writing surface, not here).
function vendorStock() {
  return repository.vendorStock();
}

// ── Shared ledger + balance helpers ─────────────────────────────────────────────────────────
// UC-35 Khaata row shape — reused by account-ledger, business-ledger's detail view, and the two
// new reports (overall-trail drill-down, overall-search drill-down).
function formatLedgerRow(r) {
  let type = r.source_type;
  let inv_no = null;
  let bill_no = null;
  let narration = r.narration;
  let cheque_no = null;
  let cheque_date = null;
  let cheque_received_date = null;

  switch (r.source_type) {
    case 'SALE_BILL':
      type = 'Sale Bill'; inv_no = r.sb_inv_no; bill_no = r.sb_bill_no; narration = narration || 'SAME';
      break;
    case 'SALE_RETURN':
      type = 'Sale Return'; inv_no = r.sr_inv_no; bill_no = r.sr_bill_no; narration = narration || 'SAME';
      break;
    case 'RECEIPT': {
      type = 'Receipt (Jamma)';
      // A bounce/return reversal reuses source_type='RECEIPT' on purpose (reverse-never-erase,
      // §6.1) with its OWN narration ("BOUNCED reversal of receipt #X") — that must win over the
      // receipt's own remarks, or the reversal row would misleadingly look like a normal receipt.
      const isReversal = r.narration && /reversal/i.test(r.narration);
      narration = isReversal ? r.narration : (r.rc_remarks || r.rc_details || r.narration || 'Receipt');
      if (r.cheque_no) { cheque_no = r.cheque_no; cheque_date = r.cheque_date; cheque_received_date = r.cheque_received_date; }
      break;
    }
    case 'COMMISSION':
      type = 'Commission'; narration = narration || 'Invoice Discount / Commission';
      break;
    case 'EXPENSE':
      type = 'Expense'; narration = r.ex_remarks || r.ex_ba_name || narration;
      break;
    case 'WAGE_RUN':
      type = 'Wage Run'; narration = `Wage run #${r.wr_id}${r.wr_stage_key ? ` (${r.wr_stage_key})` : ''}`;
      break;
    case 'SALARY_RUN':
      type = 'Salary Run'; narration = `Salary run for ${r.sar_period_month}`;
      break;
    case 'TRANSFER':
      type = 'Transfer'; narration = r.tr_remarks || `${r.tr_from_name || ''} → ${r.tr_to_name || ''}`;
      break;
    case 'PURCHASE':
      type = 'Purchase';
      break;
    case 'PURCHASE_RETURN':
      type = 'Purchase Return';
      break;
    case 'CHEQUE_ALLOCATION':
      type = 'Cheque Allocation';
      break;
    case 'OPENING':
      type = 'Opening Balance';
      break;
    default:
      break;
  }

  return {
    entry_id: r.entry_id,
    date: r.entry_date,
    type,
    inv_no,
    bill_no,
    narration,
    cheque_no,
    cheque_date,
    cheque_received_date,
    pairs: r.pairs,
    debit: Number(r.debit),
    credit: Number(r.credit),
    is_payment_row: r.source_type === 'RECEIPT' || r.source_type === 'COMMISSION',
  };
}

// UC-35 Account Ledger (Khaata) — opening balance (before date_from, or 0 for an overall/no-filter
// view — nothing is excluded, so there is no "before" period to summarize), running balance per
// row, closing balance = last running total.
async function accountLedger({ ba_id, ac_id }, filters = {}) {
  if (!ba_id && !ac_id) throw ApiError.badRequest('ba_id or ac_id is required');
  const range = resolveDateRange(filters);
  const opening = range.date_from
    ? await repository.netBalance({ ba_id, ac_id, up_to_date: range.date_from, exclusive: true })
    : 0;
  const rows = await repository.ledgerRows({ ba_id, ac_id, ...range });

  let running = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const mapped = rows.map((r) => {
    const row = formatLedgerRow(r);
    running += row.debit - row.credit;
    totalDebit += row.debit;
    totalCredit += row.credit;
    return { ...row, balance: running };
  });

  return {
    opening_balance: opening,
    rows: mapped,
    total_debit: totalDebit,
    total_credit: totalCredit,
    closing_balance: running,
  };
}

// UC-33's "standard ledger view ... per vendor" — resolves the vendor's own ba_id and reuses
// accountLedger() rather than duplicating it.
async function vendorLedger(vendorId, filters = {}) {
  const vendor = await vendorsService.getById(vendorId);
  if (!vendor.ba_id) throw ApiError.conflict('Vendor has no linked account yet', 'NO_VENDOR_ACCOUNT');
  return accountLedger({ ba_id: vendor.ba_id }, filters);
}

function groupByRegion(rows) {
  const byRegion = new Map();
  for (const row of rows) {
    if (!byRegion.has(row.region_id)) {
      byRegion.set(row.region_id, { region_id: row.region_id, region_name: row.region_name, customers: [] });
    }
    byRegion.get(row.region_id).customers.push(row);
  }
  return Array.from(byRegion.values());
}

// UC-31 Sale Analysis — Total Sales / Sale Returns / Payment Received, Customer Wise (flat) or
// Region Wise (region -> its customers).
async function saleAnalysis(filters = {}) {
  const rows = await repository.saleAggregateByCustomer(resolveDateRange(filters));
  const mapped = rows.map((r) => ({
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    region_id: r.region_id,
    region_name: r.region_name,
    total_sales: Number(r.total_sales),
    total_returns: Number(r.total_returns),
    total_payment: Number(r.total_payment),
    total_commission: Number(r.total_commission),
  }));
  return filters.group_by === 'region' ? groupByRegion(mapped) : mapped;
}

// UC-32 Sale Report — Total Sales / Cartons / Commission / Sale Return / Net Sales / Payment.
// Net Sales = Total Sales - Commission - Sale Return (commission is payment-time only, from
// receipts.commission — sale-time D% and invoice discounts are already inside net_value and are
// NOT subtracted again, per UC-32's own warning).
async function saleReport(filters = {}) {
  const rows = await repository.saleAggregateByCustomer(resolveDateRange(filters));
  const mapped = rows.map((r) => {
    const totalSales = Number(r.total_sales);
    const commission = Number(r.total_commission);
    const saleReturn = Number(r.total_returns);
    return {
      customer_id: r.customer_id,
      customer_name: r.customer_name,
      region_id: r.region_id,
      region_name: r.region_name,
      total_sales: totalSales,
      total_cartons: Number(r.total_cartons),
      commission,
      sale_return: saleReturn,
      net_sales: totalSales - commission - saleReturn,
      payment: Number(r.total_payment),
    };
  });
  return filters.group_by === 'region' ? groupByRegion(mapped) : mapped;
}

// UC-33 Vendor Report — Total Purchase / Purchase Return / Net Purchase / Payment Paid.
async function vendorReport(filters = {}) {
  const rows = await repository.vendorReportRows({ vendor_id: filters.vendor_id, ...resolveDateRange(filters) });
  return rows.map((r) => {
    const totalPurchase = Number(r.total_purchase);
    const totalReturn = Number(r.total_return);
    return {
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name,
      total_purchase: totalPurchase,
      total_return: totalReturn,
      net_purchase: totalPurchase - totalReturn,
      payment_paid: Number(r.total_payment),
    };
  });
}

// UC-34 Payment Trail — 5 fixed buckets. Each bucket is defined by the chart account(s) real
// money for that category actually posts through (see reports.repository.js#paymentTrailRows'
// own comment on why "Vendors - Suppliers"/"Employees" don't match their most literally-named
// reserved codes). The two restricted buckets (Cash at Banks, Directors Drawings — is_restricted
// in chart_of_accounts, TASK-14/§8) are hidden entirely for non-ADMIN sessions, and the grand
// total for a non-ADMIN session excludes them too.
const PAYMENT_TRAIL_BUCKETS = [
  { key: 'business_running_expenses', label: 'Business Running Expenses', codes: [CODES.BUSINESS_RUNNING_EXPENSES], restricted: false },
  { key: 'cash_at_banks', label: 'Cash at Banks', codes: [CODES.BANK_ACCOUNTS], restricted: true },
  { key: 'directors_drawings', label: 'Directors Expenses - Drawings', codes: [CODES.DIRECTORS_DRAWINGS], restricted: true },
  { key: 'employees', label: 'Employees', codes: [CODES.WORKER_WAGES, CODES.SALARIES_PAYABLE], restricted: false },
  { key: 'vendors_suppliers', label: 'Vendors - Suppliers', codes: [CODES.VENDORS_ACCOUNTS], restricted: false },
];

async function paymentTrail(filters = {}, session) {
  const rows = await repository.paymentTrailRows(resolveDateRange(filters));
  const byCode = new Map(rows.map((r) => [r.code, Number(r.total)]));
  const isAdmin = session?.role === 'ADMIN';

  const buckets = PAYMENT_TRAIL_BUCKETS
    .filter((b) => isAdmin || !b.restricted)
    .map((b) => ({
      key: b.key,
      label: b.label,
      total: b.codes.reduce((sum, code) => sum + (byCode.get(code) || 0), 0),
    }));

  return { buckets, grand_total: buckets.reduce((sum, b) => sum + b.total, 0) };
}

// UC-36 Business Accounts Ledger — Code/Description/Main Account/City, Summary (closing balance
// only, every account in one pass via businessAccountBalancesAsOf) or Detail (one account's full
// ledger, via accountLedger()).
async function businessLedger(filters = {}) {
  const accounts = await repository.businessAccountsWithCategory();
  const filtered = filters.ba_id ? accounts.filter((a) => a.ba_id === filters.ba_id) : accounts;

  if (filters.view === 'detail') {
    if (!filters.ba_id) throw ApiError.badRequest('ba_id is required for detail view');
    const ledger = await accountLedger({ ba_id: filters.ba_id }, filters);
    const account = filtered[0];
    if (!account) throw ApiError.notFound('Business account not found');
    return { account, ...ledger };
  }

  const range = resolveDateRange(filters);
  const balances = await repository.businessAccountBalancesAsOf(range.date_to || todayISO());
  return filtered.map((a) => ({
    ba_id: a.ba_id,
    code: a.code,
    name: a.name,
    main_account: a.ac_name,
    city_name: a.city_name,
    category: a.category,
    closing_balance: balances.get(a.ba_id) || 0,
  }));
}

// UC-37 Cash Book of the Day — CASH IN HAND's own ledger for a date or month. Strictly cash money
// (not cheque_allocations, which post against CHEQUES IN HAND, a separate account — folding those
// in here would double an amount that already appears on that account's own ledger). Reads BOTH
// dimensions cash posts across: the CASH_IN_HAND chart account's ac_id (every CASH receipt/expense,
// unchanged since day one) AND the Cash business account's ba_id (a cash<->bank Transfer, which —
// like every transfer — posts against its parties' ba_id, never a chart account directly). Without
// both, a transfer to/from cash would silently vanish from this report (cash_and_bank.md §10's own
// balance(cash) formula explicitly includes "+ Σ transfers TO cash − Σ transfers FROM cash").
// Opening Cash / Jamma / Naam / Cash In Hand map directly onto accountLedger()'s opening/
// total_debit/total_credit/closing_balance.
async function cashBook(filters = {}) {
  const cash = await findByCode(CODES.CASH_IN_HAND);
  if (!cash) throw new Error(`Reserved chart account CASH IN HAND (code ${CODES.CASH_IN_HAND}) not found — run npm run seed`);
  const cashBa = await businessAccountsService.getCashAccount();

  let range;
  if (filters.month) {
    const [y, m] = filters.month.split('-').map(Number);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0);
    range = { date_from: from.toISOString().slice(0, 10), date_to: to.toISOString().slice(0, 10) };
  } else if (filters.date) {
    range = { date_from: filters.date, date_to: filters.date };
  } else {
    range = { date_from: todayISO(), date_to: todayISO() };
  }

  const ledger = await accountLedger({ ac_id: cash.ac_id, ba_id: cashBa.ba_id }, range);
  return {
    opening_cash: ledger.opening_balance,
    cash_received: ledger.total_debit,
    total_cash: ledger.opening_balance + ledger.total_debit,
    cash_paid: ledger.total_credit,
    cash_in_hand: ledger.closing_balance,
    rows: ledger.rows,
  };
}

// ── New reports (user-requested, not in the original 9) ────────────────────────────────────

// "Overall Trail" — trial balance across every business account (resolved back to its owning
// party — Customer/Vendor/Employee/Bank/generic — via businessAccountsWithCategory()) plus every
// chart account posted to directly, as on a given date, grouped by category with subtotals.
// Sub-customers carry no ba_id (delivery-address-only, never financially responsible for a bill —
// see dbo.sub_customers' own schema.sql comment) so they never appear here; overall-search still
// finds them by name, just without a balance.
async function overallTrail(filters = {}) {
  const asOf = filters.as_of_date || todayISO();
  const [accounts, chartAccounts, baBalances, acBalances] = await Promise.all([
    repository.businessAccountsWithCategory(),
    repository.chartAccountsWithActivity(),
    repository.businessAccountBalancesAsOf(asOf),
    repository.chartAccountBalancesAsOf(asOf),
  ]);

  const rows = [];
  for (const a of accounts) {
    const net = baBalances.get(a.ba_id) || 0;
    if (net === 0) continue; // no activity and no opening balance — nothing to show
    rows.push({
      code: a.code,
      description: a.name,
      type: a.category.toLowerCase(),
      type_label: a.category === 'EMPLOYEE'
        ? (a.employee_type === 'WORKER' ? 'Worker' : 'Salaried Employee')
        : a.category.charAt(0) + a.category.slice(1).toLowerCase().replace('_', ' '),
      ba_id: a.ba_id,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
      net_balance: net,
    });
  }
  for (const ca of chartAccounts) {
    const net = acBalances.get(ca.ac_id) || 0;
    if (net === 0) continue;
    rows.push({
      code: ca.code,
      description: ca.name,
      type: 'chart_account',
      type_label: 'Chart of Account',
      ac_id: ca.ac_id,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
      net_balance: net,
    });
  }

  const totals = rows.reduce(
    (acc, r) => ({ total_debit: acc.total_debit + r.debit, total_credit: acc.total_credit + r.credit }),
    { total_debit: 0, total_credit: 0 },
  );
  return { as_of_date: asOf, rows, ...totals };
}

// "Overall Searching" — type a name, get back every matching customer/vendor/employee/
// sub-customer/business account, via the migration 008 view so it stays current automatically.
function overallSearch(searchQuery, entityType) {
  return repository.overallDirectory(searchQuery, entityType);
}

// Drill-down from an Overall Search / Overall Trail result into its ledger. Sub-customers have no
// ba_id, so they get an explicit "no financial account" result instead of a fabricated balance.
async function overallSearchLedger(entityType, baId, filters = {}) {
  if (entityType === 'SUB_CUSTOMER' || !baId) {
    return { has_account: false, message: 'This is a delivery-address-only party with no financial account.' };
  }
  const ledger = await accountLedger({ ba_id: baId }, filters);
  return { has_account: true, ...ledger };
}

module.exports = {
  stock,
  production,
  productLedger,
  vendorStock,
  accountLedger,
  vendorLedger,
  saleAnalysis,
  saleReport,
  vendorReport,
  paymentTrail,
  businessLedger,
  cashBook,
  overallTrail,
  overallSearch,
  overallSearchLedger,
};
