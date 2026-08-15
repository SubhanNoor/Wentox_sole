// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/reports.repository');
const stockService = require('./stock.service');
const vendorsService = require('./vendors.service');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const CODES = require('../constants/reservedAccounts');
const { findByCode, findById: findChartAccountById } = require('../repositories/chartAccounts.repository');
const { toISODate, todayISO } = require('../utils/dates');

// UC-03 on the READ side. The write side has enforced this since 2026-08-10
// (businessAccounts.service.js#assertAccessible), but every report channel except payment-trail
// passed no session at all, so a USER could pull the balance and the full ledger of any bank or
// Directors-Drawings account through the Reports Hub — precisely the accounts the rule exists to
// hide. Adding the Balance column to the Business Ledger directory put those figures on a list
// rather than behind a click, which is what made it worth closing now.
//
// Takes ac_id as well as ba_id because reports:account-ledger accepts either, and BANK ACCOUNTS /
// Directors Expenses – Drawings are themselves chart accounts a USER could name directly.
//
// Same contract as assertAccessible: NO session means an internal caller (vendorLedger, the Cash
// Book), which is trusted and unfiltered. Only a request that arrived with a session is judged.
async function assertReadable({ ba_id, ac_id }, session) {
  if (!session || session.role === 'ADMIN') return;
  if (ba_id) await businessAccountsService.assertAccessible(ba_id, session);
  if (ac_id) {
    const chartAccount = await findChartAccountById(ac_id);
    if (chartAccount?.is_restricted) {
      throw ApiError.unauthorized('This account is restricted to administrators');
    }
  }
}

// Drops restricted accounts from a list rather than throwing — a USER asking for "every account"
// is a legitimate request, they simply get the accounts they are allowed to see.
function visibleTo(session, rows) {
  if (!session || session.role === 'ADMIN') return rows;
  return rows.filter((r) => !r.is_restricted);
}


// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins) — same
// convention as saleBills.service.js/purchases.service.js#resolveDateRange.
function resolveDateRange(filters) {
  if (filters.date_from || filters.date_to) {
    return { date_from: filters.date_from, date_to: filters.date_to };
  }
  const today = new Date();
  if (filters.range === 'weekly') {
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    return { date_from: toISODate(from), date_to: toISODate(today) };
  }
  if (filters.range === 'monthly') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { date_from: toISODate(from), date_to: toISODate(today) };
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
      type = 'Wage Run'; narration = 'HISAB';
      break;
    case 'SALARY_RUN': {
      type = 'Salary Run';
      const pm = new Date(r.sar_period_month);
      const month = pm.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
      narration = `Salary for ${month} ${pm.getUTCFullYear()}`;
      break;
    }
    case 'TRANSFER':
      type = 'Transfer'; narration = r.tr_remarks || `${r.tr_from_name || ''} → ${r.tr_to_name || ''}`;
      break;
    // The stored narration already names the other side ("Settled directly to/by X") — that is the
    // whole point of the document, so it wins over the user's free-text remarks rather than the
    // usual remarks-first order. Remarks are appended when present.
    case 'SETTLEMENT':
      type = 'Direct Settlement';
      break;
    // The stored narration already carries the reason and the other side, so it stands as-is —
    // showing a bare "Journal Voucher" would hide exactly the thing a JV row needs to explain.
    case 'JOURNAL_VOUCHER':
      type = 'Journal Voucher';
      break;
    case 'PURCHASE':
      type = 'Purchase';
      break;
    case 'PURCHASE_RETURN':
      type = 'Purchase Return';
      break;
    case 'CHEQUE_ALLOCATION': {
      // Both the original endorsement (cheques.service.js#endorseToVendor/endorseToExpense,
      // narration "Cheque #X to vendor/expense") and its later reversal (reverseOneAllocation/
      // reverseCheque, narration "... reversal of allocation #X") share source_type
      // CHEQUE_ALLOCATION — same reverse-never-erase pattern as the RECEIPT case above, so the
      // same "reversal" narration sniff distinguishes them instead of showing one generic label
      // for both directions of money movement.
      const isReversal = r.narration && /reversal/i.test(r.narration);
      type = isReversal ? 'Cheque Return' : 'Cheque Endorsement';
      break;
    }
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
async function accountLedger({ ba_id, ac_id }, filters = {}, session) {
  if (!ba_id && !ac_id) throw ApiError.badRequest('ba_id or ac_id is required');
  await assertReadable({ ba_id, ac_id }, session);
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
    city_id: r.city_id,
    city_name: r.city_name,
    total_sales: Number(r.total_sales),
    total_returns: Number(r.total_returns),
    total_payment: Number(r.total_payment),
    total_commission: Number(r.total_commission),
    // Reported as its own ROW under the party in the UI, not as another column — a JV reduces what
    // is owed but is not money collected, so it must never be folded into total_payment.
    total_jv: Number(r.total_jv),
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
      city_id: r.city_id,
      city_name: r.city_name,
      total_sales: totalSales,
      total_cartons: Number(r.total_cartons),
      commission,
      sale_return: saleReturn,
      net_sales: totalSales - commission - saleReturn,
      payment: Number(r.total_payment),
      // Own row in the UI, deliberately not a column and deliberately NOT inside net_sales:
      // net_sales is what the sale was worth, a JV is goodwill given afterwards.
      total_jv: Number(r.total_jv),
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
      total_jv: Number(r.total_jv),
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
async function businessLedger(filters = {}, session) {
  // Restricted accounts drop out of the directory itself, so a USER's list never names them — and
  // the detail view goes through accountLedger, which rejects one asked for by id regardless.
  const accounts = visibleTo(session, await repository.businessAccountsWithCategory());
  const filtered = filters.ba_id ? accounts.filter((a) => a.ba_id === filters.ba_id) : accounts;

  if (filters.view === 'detail') {
    if (!filters.ba_id) throw ApiError.badRequest('ba_id is required for detail view');
    const ledger = await accountLedger({ ba_id: filters.ba_id }, filters, session);
    const account = filtered[0];
    if (!account) throw ApiError.notFound('Business account not found');
    return { account, ...ledger };
  }

  // Same reasoning as accountBalance: with no date filter this column is the account's whole book
  // balance, so the directory and the statement you open from it always agree.
  const range = resolveDateRange(filters);
  const balances = await repository.businessAccountBalancesAsOf(range.date_to || null);
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

// One account's current balance, for the Receipts/Expenses screens' "balance before → after" panel
// (UC-25 step 4: "the screen shows BOTH figures explicitly — the original amount owed and the
// amount owed after commission"). Deliberately NOT accountLedger(): that fetches every ledger row
// to derive a closing balance, which is a lot of work to show one number next to a dropdown.
// netBalance() sums in SQL and includes business_accounts.opening_balance, which a pure
// ledger_entries sum would miss for an account whose history predates WentoX.
//
// Sign follows the ledger's own convention: positive = debit = the account owes us (receivable),
// negative = credit = we owe the account (payable).
// as_of is optional and NO LONGER defaults to today. It used to, while accountLedger applied no
// cutoff at all, so an entry dated ahead of today appeared on the ledger and not in the balance
// panel sitting next to it — two numbers for the same account, both labelled "balance". Omitting
// the cutoff makes this the account's actual book balance; callers that genuinely want a dated
// figure still pass as_of.
async function accountBalance({ ba_id, as_of }, session) {
  if (!ba_id) throw ApiError.badRequest('ba_id is required');
  await assertReadable({ ba_id }, session);
  const balance = await repository.netBalance({ ba_id, up_to_date: as_of || null });
  return { ba_id, as_of: as_of || null, balance };
}

// UC-37 Cash Book — the "Account Name" column. A cash-book line names the OTHER side of the
// movement, never "Cash" itself: money came from a customer or a bank, and went to an expense head,
// a worker, a director or a bank. Which table holds that name depends on what produced the entry,
// so this resolves per source_type and falls back to the type label when nothing better exists.
// A transfer names whichever party isn't cash — a debit to cash came FROM the other account.
function cashBookAccountName(r, formatted) {
  switch (r.source_type) {
    case 'EXPENSE': return r.ex_ba_name || formatted.type;
    case 'RECEIPT':
    case 'COMMISSION': return r.rc_account_name || formatted.type;
    case 'TRANSFER': return (Number(r.debit) > 0 ? r.tr_from_name : r.tr_to_name) || formatted.type;
    case 'WAGE_RUN': return r.wr_employee_name || formatted.type;
    case 'SALARY_RUN': return formatted.type;
    default: return formatted.type;
  }
}

// TYPE column. Cash-ledger rows are cash by definition EXCEPT an expense paid by cheque against a
// bank — which never reaches this ledger anyway — so the mode comes from the paying document where
// one exists. expenses.payment_mode's CHEQUE_ISSUED/CHEQUE_ENDORSED both print as CHEQUE; the
// distinction matters to the posting engine, not to someone reading a day book.
function cashBookMode(r) {
  const raw = r.ex_payment_mode || r.rc_payment_mode;
  if (!raw) return 'CASH';
  return raw.startsWith('CHEQUE') ? 'CHEQUE' : raw;
}

// Remarks column. Deliberately NOT formatLedgerRow()'s narration, which falls back to the paying
// account's own name — useful on an Account Ledger, but here it would print the Account Name column
// twice on every expense that carries no remarks of its own. Only the document's typed-in remarks
// count; with none, the reference prints the payment type ("CASH"), so that is the fallback.
// A bounce/return reversal still wins, same reasoning as formatLedgerRow(): its narration is the
// only thing distinguishing the reversal row from the receipt it undoes.
function cashBookRemarks(r, mode) {
  if (r.narration && /reversal/i.test(r.narration)) return r.narration;
  let remarks;
  switch (r.source_type) {
    case 'EXPENSE': remarks = r.ex_remarks; break;
    case 'RECEIPT':
    case 'COMMISSION': remarks = r.rc_remarks || r.rc_details; break;
    case 'TRANSFER': remarks = r.tr_remarks; break;
    default: remarks = r.narration; break;
  }
  return remarks || mode;
}

// UC-37 Cash Book of the Day — CASH IN HAND's own ledger for a date or month, plus the same
// period's cheque/online movements alongside it for VISIBILITY ONLY.
//
// The cash side reads BOTH dimensions cash posts across: the CASH_IN_HAND chart account's ac_id
// (every CASH receipt/expense, unchanged since day one) AND the Cash business account's ba_id (a
// cash<->bank Transfer, which — like every transfer — posts against its parties' ba_id, never a
// chart account directly). Without both, a transfer to/from cash would silently vanish from this
// report (cash_and_bank.md §10's own balance(cash) formula explicitly includes "+ Σ transfers TO
// cash − Σ transfers FROM cash"). cheque_allocations stay out: they post against CHEQUES IN HAND
// and already appear on that account's own ledger.
//
// The cheque/online side comes from repository.cashBookNonCashRows() — source documents, not the
// ledger, since by definition they never post to cash. They fill their own two columns and the
// Totals strip, and are excluded from opening/received/paid/in-hand entirely: the summary box
// answers "what did the cash drawer do today", which a cheque cannot change.
async function cashBook(filters = {}) {
  const cash = await findByCode(CODES.CASH_IN_HAND);
  if (!cash) throw new Error(`Reserved chart account CASH IN HAND (code ${CODES.CASH_IN_HAND}) not found — run npm run seed`);
  const cashBa = await businessAccountsService.getCashAccount();

  let range;
  if (filters.month) {
    const [y, m] = filters.month.split('-').map(Number);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0);
    // toISODate, not toISOString: new Date(y, m-1, 1) is LOCAL midnight, so converting to UTC
    // shifted BOTH ends back a day in PKT — "August" was really 31-Jul to 30-Aug, silently
    // including the previous month's last day and dropping the selected month's.
    range = { date_from: toISODate(from), date_to: toISODate(to) };
  } else if (filters.date) {
    range = { date_from: filters.date, date_to: filters.date };
  } else {
    range = { date_from: todayISO(), date_to: todayISO() };
  }

  const [opening, ledgerRaw, nonCashRaw, bankTransfersRaw, chequeDepositsRaw] = await Promise.all([
    repository.netBalance({
      ba_id: cashBa.ba_id, ac_id: cash.ac_id, up_to_date: range.date_from, exclusive: true,
    }),
    repository.ledgerRows({ ba_id: cashBa.ba_id, ac_id: cash.ac_id, ...range }),
    repository.cashBookNonCashRows(range),
    repository.cashBookBankTransfers(cashBa.ba_id, range),
    repository.cashBookChequeDeposits(range),
  ]);

  const cashRows = ledgerRaw.map((r) => {
    const formatted = formatLedgerRow(r);
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    const mode = cashBookMode(r);
    return {
      date: formatted.date,
      account_name: cashBookAccountName(r, formatted),
      remarks: cashBookRemarks(r, mode),
      mode,
      cheque_no: formatted.cheque_no || r.ex_issued_cheque_no || null,
      receipt_bank: 0,
      payment_bank: 0,
      receipt_cash: debit,
      payment_cash: credit,
      affects_cash: true,
    };
  });

  const nonCashRows = nonCashRaw.map((r) => {
    const amount = Number(r.amount);
    // Only 'RECEIPT' is money in. 'EXPENSE' and 'ALLOCATION' (a cheque endorsed to a vendor) are
    // both outflows and land in Payments Cheq./Online.
    const isReceipt = r.kind === 'RECEIPT';
    return {
      date: r.entry_date,
      account_name: r.account_name,
      remarks: r.remarks || '',
      mode: r.payment_mode.startsWith('CHEQUE') ? 'CHEQUE' : r.payment_mode,
      cheque_no: r.cheque_no || null,
      receipt_bank: isReceipt ? amount : 0,
      payment_bank: isReceipt ? 0 : amount,
      receipt_cash: 0,
      payment_cash: 0,
      affects_cash: false,
    };
  });

  // Cash first within a day, then that day's cheque/online lines. Grouping the view-only rows after
  // the ones that actually moved money keeps the four amount columns readable on a month view;
  // on a single date (the reference layout) it simply puts the cheques at the bottom of the page.
  // Array.prototype.sort is stable (ES2019), so equal dates keep the concat order above.
  const rows = [...cashRows, ...nonCashRows]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const sum = (key) => rows.reduce((acc, r) => acc + r[key], 0);
  const cashReceived = sum('receipt_cash');
  const cashPaid = sum('payment_cash');

  // CB-01/CB-03: bank-to-bank transfers and cheque deposits, listed for visibility only — neither
  // is a cash movement, so neither feeds any total above (same "informational, not counted"
  // treatment cashBookNonCashRows already gives cheque/online receipts and payments).
  const bankTransfers = bankTransfersRaw.map((r) => ({
    date: toISODate(r.entry_date),
    from_name: r.from_name,
    to_name: r.to_name,
    amount: Number(r.amount),
    remarks: r.remarks || '',
  }));
  const chequeDeposits = chequeDepositsRaw.map((r) => ({
    date: toISODate(r.entry_date),
    cheque_no: r.cheque_no || null,
    payer_name: r.payer_name,
    bank_name: r.bank_name || null,
    amount: Number(r.amount),
  }));

  return {
    opening_cash: opening,
    cash_received: cashReceived,
    total_cash: opening + cashReceived,
    cash_paid: cashPaid,
    cash_in_hand: opening + cashReceived - cashPaid,
    totals: {
      receipt_bank: sum('receipt_bank'),
      payment_bank: sum('payment_bank'),
      receipt_cash: cashReceived,
      payment_cash: cashPaid,
    },
    rows,
    bank_transfers: bankTransfers,
    cheque_deposits: chequeDeposits,
  };
}

// ── New reports (user-requested, not in the original 9) ────────────────────────────────────

// "Overall Trail" — trial balance across every business account (resolved back to its owning
// party — Customer/Vendor/Employee/Bank/generic — via businessAccountsWithCategory()) plus every
// chart account posted to directly, as on a given date, grouped by category with subtotals.
// Sub-customers carry no ba_id (delivery-address-only, never financially responsible for a bill —
// see dbo.sub_customers' own schema.sql comment) so they never appear here; overall-search still
// finds them by name, just without a balance.
async function overallTrail(filters = {}, session) {
  const asOf = filters.as_of_date || todayISO();
  // A trial balance for a USER simply omits the restricted accounts. The totals it prints are then
  // the totals of what they can see — which is the point of the restriction, not a defect in it.
  const [accountsRaw, chartAccountsRaw, baBalances, acBalances] = await Promise.all([
    repository.businessAccountsWithCategory(),
    repository.chartAccountsWithActivity(),
    repository.businessAccountBalancesAsOf(asOf),
    repository.chartAccountBalancesAsOf(asOf),
  ]);
  const accounts = visibleTo(session, accountsRaw);
  const chartAccounts = visibleTo(session, chartAccountsRaw);

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

  // A trial balance is a whole-books document: drop two accounts out of it and it stops balancing,
  // and the gap it leaves IS their combined total — so filtering alone would have hidden nothing
  // while breaking the report. Instead the restricted accounts collapse into ONE line for a USER.
  // Their names, codes and individual balances stay hidden, the report still proves the books
  // balance, and the line is honest about there being something it isn't showing.
  if (session && session.role !== 'ADMIN') {
    const hiddenNet = accountsRaw
      .filter((a) => a.is_restricted)
      .reduce((sum, a) => sum + (baBalances.get(a.ba_id) || 0), 0)
      + chartAccountsRaw
        .filter((ca) => ca.is_restricted)
        .reduce((sum, ca) => sum + (acBalances.get(ca.ac_id) || 0), 0);

    if (hiddenNet !== 0) {
      rows.push({
        code: '—',
        description: 'Restricted accounts (administrator only)',
        type: 'restricted',
        type_label: 'Restricted',
        // No ba_id/ac_id: there is no single account to drill into, and the frontend keys its
        // drill-down off this flag rather than off the absence of an id.
        is_aggregate: true,
        debit: hiddenNet > 0 ? hiddenNet : 0,
        credit: hiddenNet < 0 ? -hiddenNet : 0,
        net_balance: hiddenNet,
      });
    }
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
async function overallSearchLedger(entityType, baId, filters = {}, session) {
  if (entityType === 'SUB_CUSTOMER' || !baId) {
    return { has_account: false, message: 'This is a delivery-address-only party with no financial account.' };
  }
  const ledger = await accountLedger({ ba_id: baId }, filters, session);
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
  accountBalance,
  cashBook,
  overallTrail,
  overallSearch,
  overallSearchLedger,
};
