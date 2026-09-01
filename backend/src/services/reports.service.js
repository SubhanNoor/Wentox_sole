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

// TYPE for a both-sides grid row: the document's OWN payment mode where one exists, so the column
// reads CASH / CHEQUE / ONLINE rather than the name of the column pair.
//
// Two reasons it is not just touches_cash. "CHEQ./ONLINE" describes which PAIR of columns the
// amount lands in, not how the money moved — printing it in a column headed "Type" said nothing a
// reader couldn't already see, and it could not distinguish a cheque from an online transfer. It
// was also long enough to overflow the Type column and run into Cheque No on the printed report
// (reported by the user, 2026-09-01).
//
// CHEQUE_ISSUED/CHEQUE_ENDORSED both print as CHEQUE: the distinction matters to the posting
// engine, not to someone reading a day book — the same rule the original report used. Anything
// with no document behind it (an opening entry, a journal voucher) falls back to the pair.
function cashBookSideMode(r) {
  const raw = r.doc_payment_mode;
  if (raw) return raw.startsWith('CHEQUE') ? 'CHEQUE' : raw;
  // No payment mode to show — a commission is a trade discount and a deposit is a manual
  // adjustment, neither of which travelled by cash, cheque or transfer. Naming the document kind
  // says more here than repeating the column pair, and is shorter.
  return String(r.source_type || '').replace(/_/g, ' ');
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
// The cheque/online side comes from repository.cashBookTransactionSides() — the ledger, not the
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

  // The other two money heads, needed to scope the both-sides query below to money movements.
  const bankAc = await findByCode(CODES.BANK_ACCOUNTS);
  const chequesAc = await findByCode(CODES.CHEQUES_IN_HAND);

  const [opening, ledgerRaw, sidesRaw, unpostedRaw, bankTransfersRaw, chequeDepositsRaw] = await Promise.all([
    repository.netBalance({
      ba_id: cashBa.ba_id, ac_id: cash.ac_id, up_to_date: range.date_from, exclusive: true,
    }),
    repository.ledgerRows({ ba_id: cashBa.ba_id, ac_id: cash.ac_id, ...range }),
    repository.cashBookTransactionSides(range, {
      cashAcId: cash.ac_id,
      bankAcId: bankAc ? bankAc.ac_id : -1,
      chequesAcId: chequesAc ? chequesAc.ac_id : -1,
    }),
    repository.cashBookUnpostedSides(range, {
      cashAcId: cash.ac_id,
      chequesAcId: chequesAc ? chequesAc.ac_id : -1,
    }),
    repository.cashBookBankTransfers(cashBa.ba_id, range),
    repository.cashBookChequeDeposits(range),
  ]);

  // ── The grid: BOTH endpoints of every money transaction, as two adjacent rows ──────────────
  // Rebuilt 2026-08-31 on the user's description: "if I receive a payment from customer then first
  // row is shown from which the payment is received and then next row shows in which account the
  // payment is received into". Previously each transaction printed ONE row naming only the far
  // side, so a receipt never showed where the money landed and a payment never showed what it came
  // out of.
  //
  // FROM is the credit line (money leaving that account), TO is the debit (money arriving) — true
  // for both directions: a receipt is FROM customer TO cash; an expense is FROM cash TO vendor.
  // The repository already returns credit-before-debit within each transaction, so DOM order is
  // simply the order rows come back in.
  //
  // Because every transaction now contributes exactly its own debit AND its own credit, the two
  // Receipts/Payments totals within a column pair tie by construction — which is what the user
  // asked for. That only holds while BOTH lines of a transaction sit in the SAME pair, hence
  // touches_cash being decided per transaction (in SQL) rather than per row.
  // ── Split the raw lines into POSTING EVENTS, not documents ────────────────────────────────
  // source_id alone is the wrong grouping key: one document can hold several postings. A cheque
  // receipt that later BOUNCED writes its original Dr/Cr pair AND the reversal's pair under the
  // SAME source_id, so keying on it printed a single 4-row entry mixing a receipt with its own
  // undo (reported by the user, 2026-08-31: "why is entry 9 split into 4 rows").
  //
  // Every posting is balanced by construction, so walking the lines in entry_id order and closing
  // a batch the moment running debits equal running credits recovers the real events — here,
  // "Receipt #2" and "BOUNCED reversal of receipt #2" as two separate numbered entries. This needs
  // no narration parsing and holds for postings of any size (a receipt with commission is 3+
  // lines), which is why it is done by arithmetic rather than by matching text.
  const batches = [];
  let current = [];
  let runDr = 0;
  let runCr = 0;
  let lastDocKey = null;
  for (const r of sidesRaw) {
    const docKey = `${r.source_type}#${r.source_id}`;
    // A new document always starts a new batch, even if the previous one never balanced (it
    // cannot, but a half-posted document must not swallow the next one's lines).
    if (docKey !== lastDocKey && current.length) {
      batches.push(current); current = []; runDr = 0; runCr = 0;
    }
    lastDocKey = docKey;
    current.push(r);
    runDr += Number(r.debit);
    runCr += Number(r.credit);
    if (runDr === runCr && runDr > 0) {
      batches.push(current); current = []; runDr = 0; runCr = 0;
    }
  }
  if (current.length) batches.push(current);

  // Within a posting, FROM (the credits — money leaving) is listed before TO (the debits).
  //
  // Each posting also gets a DIRECTION and a single amount-carrying row. Both legs used to carry
  // the amount, which made the column totals exactly double the drawer (the user, 2026-08-31:
  // "receipt cash is 24000 and cash receive is 12000, numbers don't match") and — worse — printed
  // an expense's own cash leg under RECEIPTS, claiming cash had received money it actually paid
  // out. Direction is a property of the posting, not of a row, so it is decided once here:
  //
  //   RECEIPT / COMMISSION            money IN  -> the amount belongs in a Receipts column
  //   EXPENSE / CHEQUE_ALLOCATION     money OUT -> a Payments column
  //   TRANSFER / DEPOSIT / anything   read our own money leg: debited = IN, credited = OUT
  //
  // The amount then sits on the COUNTERPARTY row — who paid us, or who we paid — because that is
  // the line a reader scans for. Money IN puts it on FROM (the payer); money OUT puts it on TO
  // (the payee). Our own account's row still prints, naming where the money landed or came from,
  // just without repeating the figure. One amount per posting is what lets the column totals
  // reconcile against Cash Received / Cash Paid in the summary box.
  const IN_TYPES = new Set(['RECEIPT', 'COMMISSION']);
  const OUT_TYPES = new Set(['EXPENSE', 'CHEQUE_ALLOCATION']);
  let txnSeq = 0;
  const ordered = [];
  for (const batch of batches) {
    txnSeq += 1;
    const credits = batch.filter((r) => !(Number(r.debit) > 0));
    const debits = batch.filter((r) => Number(r.debit) > 0);

    const type = batch[0].source_type;
    const cashLegs = batch.filter((r) => r.is_cash_side === 1);
    const isCashBatch = cashLegs.length > 0;
    // Both legs on the cash account — a receipt whose PAYING account is Cash itself, for instance
    // (Receipt #1029 in this data). It nets to nothing, but the drawer counts it on both sides, so
    // the grid must too or the two disagree. Each leg then carries its own direction.
    const selfContained = isCashBatch && cashLegs.length === batch.length;

    let isIn;
    if (isCashBatch) {
      // Direction comes from what CASH itself did, never from the document type: Cash Received and
      // Cash Paid in the summary box are literally the debits and credits on this account, so
      // reading the same leg is what makes the column totals agree with them by construction.
      isIn = Number(cashLegs[0].debit) > 0;
    } else if (IN_TYPES.has(type)) isIn = true;
    else if (OUT_TYPES.has(type)) isIn = false;
    else {
      const ourLeg = batch.find((r) => r.is_money_side === 1);
      isIn = ourLeg ? Number(ourLeg.debit) > 0 : true;
    }
    // CASH prints ONE line, naming the counterparty; the cash leg itself is never shown. That is
    // the client's own format (photographed cash books, 31-Jul and 31-Aug 2026) and the reason
    // their two cash columns are allowed to differ: the difference IS the day's net drawer
    // movement, not an imbalance. In the user's words, "we make the cash adjacent payment
    // ourself, so there is no issue about cash credit/debit total".
    //
    // CHEQUE/ONLINE keeps both legs, because there the pair is the whole point — a cheque leaves
    // one account and lands in another, and those two columns always balance on the client's sheet.
    //
    // A self-contained cash posting (both legs on cash — a receipt whose paying account IS cash)
    // has no counterparty to name, so it keeps both legs; dropping one would lose the row entirely.
    const dropCashLeg = isCashBatch && !selfContained;
    const emit = dropCashLeg
      ? [...credits, ...debits].filter((r) => r.is_cash_side !== 1)
      : [...credits, ...debits];

    emit.forEach((r, i) => {
      const side = Number(r.debit) > 0 ? 'TO' : 'FROM';
      ordered.push({
        ...r,
        __txnSeq: txnSeq,
        __isFirst: i === 0,
        // With the cash leg gone, the surviving counterparty row carries the posting's own
        // direction — money in prints under Receipts Cash, money out under Payments Cash,
        // regardless of which side of the ledger that counterparty happens to sit on.
        __isIn: selfContained ? side === 'TO' : isIn,
        __forceSide: dropCashLeg ? (isIn ? 'FROM' : 'TO') : null,
      });
    });
  }

  let rows = ordered.map((r) => {
    const isFirstOfTxn = r.__isFirst;
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    const isDebit = debit > 0;
    // FROM is the credit line — the account the money left. TO is the debit, where it arrived.
    const isFrom = !isDebit;
    const amount = isDebit ? debit : credit;
    const isCashPair = r.touches_cash === 1;
    return {
      date: toISODate(r.entry_date),
      // Kept as `account_name` so the existing column, search filter and Excel export keep working;
      // it now names THIS side of the entry rather than always the far one.
      account_name: r.side_name || '—',
      account_code: r.side_code || null,
      // FROM/TO is what makes a cheque/online pair readable at a glance. A lone cash line is
      // forced to the side matching its direction, so a cash payment reads TO (money out) even
      // though the payee sits on the debit side of the ledger.
      side: r.__forceSide || (isDebit ? 'TO' : 'FROM'),
      remarks: r.narration || '',
      mode: cashBookSideMode(r),
      // Was hardcoded null when this mapping was rewritten, which silently dropped every cheque
      // number from the report — the column was there and always empty (reported 2026-09-01).
      cheque_no: r.doc_cheque_no || null,
      // CHEQUE/ONLINE: FROM prints under Receipts (where it came from), TO under Payments (where
      // it went) — the balancing pair from the client's sheet, which always ties.
      // CASH: the single surviving line prints under Receipts if money came in, Payments if it
      // went out. No contra, so these two columns are not expected to be equal.
      receipt_bank: !isCashPair && isFrom ? amount : 0,
      payment_bank: !isCashPair && !isFrom ? amount : 0,
      receipt_cash: isCashPair && (r.__forceSide ? r.__isIn : isFrom) ? amount : 0,
      payment_cash: isCashPair && !(r.__forceSide ? r.__isIn : isFrom) ? amount : 0,
      // Our own money account vs the counterparty — drives the cash summary, never the columns.
      affects_cash: r.is_cash_side === 1,
      is_money_side: r.is_money_side === 1,
      source_type: r.source_type,
      source_id: r.source_id,
      txn_seq: r.__txnSeq,
      is_first_of_txn: isFirstOfTxn,
      is_posted: true,
      // Internal only — the single key the whole report is ordered by, see the sort below.
      __enteredAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    };
  });

  // ── Unposted documents, in the same two-row shape ──────────────────────────────────────────
  // Listed alongside the posted ones (per the user, 2026-08-31) and flagged is_posted: false. They
  // have no ledger entries, so both ends are derived from the document itself — see
  // repository.cashBookUnpostedSides for how the far side resolves.
  //
  // Direction comes from the document type rather than from a cash leg, because there is no ledger
  // to read: a receipt brings money in, an expense sends it out. FROM/TO then follow the same rule
  // as the posted rows — FROM is where the money leaves, TO where it lands.
  let unpostedSeq = txnSeq;
  for (const u of unpostedRaw) {
    unpostedSeq += 1;
    const amount = Number(u.amount);
    const isIn = u.kind === 'RECEIPT';
    const isCashPair = u.touches_cash === 1;
    // A draft table carries no CHECK constraints, so a malformed draft (ONLINE naming no account,
    // say) can reach here with no far side. It still prints, named as such — that is exactly the
    // row someone reading this report needs to notice.
    const money = { name: u.money_name || '(no account set)', code: u.money_code || null };
    const party = { name: u.party_name || '(no account set)', code: u.party_code || null };
    const from = isIn ? party : money;
    const to = isIn ? money : party;
    const base = {
      date: toISODate(u.entry_date),
      remarks: u.remarks || `${isIn ? 'Receipt' : 'Expense'} — not yet posted`,
      // The draft's own mode, same as the posted side — CHEQUE_ISSUED/CHEQUE_ENDORSED both read
      // CHEQUE, since that distinction matters to the posting engine and not to a day book.
      mode: u.payment_mode ? (u.payment_mode.startsWith('CHEQUE') ? 'CHEQUE' : u.payment_mode) : (isCashPair ? 'CASH' : 'CHEQ./ONLINE'),
      cheque_no: u.cheque_no || null,
      // Whether this posting touches the cash drawer. The client counts unposted cash in Cash
      // Received / Cash Paid ("in summary below unposted cash receipt/payments are also shown"),
      // so a draft is NOT excluded from those figures — only from `opening_cash`, which is a
      // posted-ledger balance from before the period.
      affects_cash: isCashPair,
      is_money_side: false,
      source_type: u.kind,
      source_id: u.source_id,
      txn_seq: unpostedSeq,
      is_posted: false,
      __enteredAt: u.created_at ? new Date(u.created_at).getTime() : 0,
    };
    if (isCashPair) {
      // ONE line for cash, naming the counterparty — the cash leg is never printed, matching the
      // client's own book. `party` is that counterparty whichever way the money went, so no leg
      // has to be identified after the fact (the posted path reads is_cash_side for this; on a
      // draft that flag would be useless, since both legs are synthesised here).
      rows.push({
        ...base,
        account_name: party.name,
        account_code: party.code,
        side: isIn ? 'FROM' : 'TO',
        is_first_of_txn: true,
        receipt_bank: 0,
        payment_bank: 0,
        receipt_cash: isIn ? amount : 0,
        payment_cash: isIn ? 0 : amount,
      });
    } else {
      // CHEQUE/ONLINE keeps the pair: out of one account, into another, and the two columns tie.
      rows.push({
        ...base,
        account_name: from.name,
        account_code: from.code,
        side: 'FROM',
        is_first_of_txn: true,
        receipt_bank: amount,
        payment_bank: 0,
        receipt_cash: 0,
        payment_cash: 0,
      });
      rows.push({
        ...base,
        account_name: to.name,
        account_code: to.code,
        side: 'TO',
        is_first_of_txn: false,
        receipt_bank: 0,
        payment_bank: amount,
        receipt_cash: 0,
        payment_cash: 0,
      });
    }
  }

  // NEWEST ENTERED FIRST, on ONE timeline — posted and unposted ranked together, whichever was
  // recorded last sitting at the top (per the user, 2026-09-01: "no matter if its posted or
  // unposted the sorting order should be last in first shown").
  //
  // Ordered by created_at — when the row was actually WRITTEN — not by the document's own date.
  // Those differ whenever anything is backdated, and it is the moment of entry the user is
  // tracking. Ordering by date instead ranked a receipt entered seconds ago below a week-old one
  // that happened to carry a later date; grouping posted before unposted (the previous shape) also
  // pushed a brand-new receipt down the page, which is what put one at S#9.
  //
  // Reversed by ENTRY, not by row: sorting the flat list would put every TO line above its own
  // FROM line and break the pair the layout is built around. Rows are gathered back into their
  // entries, the entries are ranked, and each pair is re-emitted FROM-then-TO.
  const byEntry = new Map();
  for (const r of rows) {
    if (!byEntry.has(r.txn_seq)) byEntry.set(r.txn_seq, []);
    byEntry.get(r.txn_seq).push(r);
  }
  const entries = [...byEntry.values()].sort((a, b) => {
    const diff = (b[0].__enteredAt || 0) - (a[0].__enteredAt || 0);
    if (diff !== 0) return diff;
    // Same instant (a bulk post writes its rows in one go), or no timestamp at all on some older
    // row — fall back to the document date, then to the build order, so ties stay deterministic
    // rather than shuffling between reloads.
    return new Date(b[0].date).getTime() - new Date(a[0].date).getTime();
  });

  // Renumbered 1..N down the page. S# is a reading position on this report, not an identity — it
  // would otherwise count down from N and look like the list had been truncated.
  rows = entries.flatMap((entry, i) => entry.map((r, j) => {
    const { __enteredAt, ...rest } = r; // internal ordering key, not part of the API shape
    void __enteredAt;
    return { ...rest, txn_seq: i + 1, is_first_of_txn: j === 0 };
  }));

  // Plain column sums. Nothing is a non-counting contra any more: cash prints one line per
  // posting, and a cheque/online pair is two REAL sides of one movement, both of which belong in
  // their column. The gating that used to live here existed only to compensate for a cash contra
  // row the client's own book never had.
  const sum = (key) => rows.reduce((acc, r) => acc + r[key], 0);

  // Cash Received / Cash Paid ARE the cash columns — the client's sheet has them equal to the
  // penny (136,039 and 142,835 on 31-Aug-2026), and that includes unposted entries, per the user:
  // "in summary below unposted cash receipt/payments are also shown". Reading the posted ledger
  // here instead is what made the summary disagree with the grid above it.
  //
  // The two are NOT expected to match each other — 136,039 in against 142,835 out on that sheet.
  // The difference is the day's net drawer movement, which is exactly what Cash In Hand reports.
  const cashReceived = sum('receipt_cash');
  const cashPaid = sum('payment_cash');

  // CB-01/CB-03: bank-to-bank transfers and cheque deposits, listed for visibility only — neither
  // is a cash movement, so neither feeds any total above (same "informational, not counted"
  // treatment the grid's own cheque/online rows already get).
  const bankTransfers = bankTransfersRaw.map((r) => ({
    date: toISODate(r.entry_date),
    from_name: r.from_name,
    to_name: r.to_name,
    amount: Number(r.amount),
    remarks: r.remarks || '',
  }));
  // Newest first as well, to match the grid above — a report that reads one way in its main table
  // and the other way in the panels beneath it is just confusing.
  bankTransfers.reverse();
  const chequeDeposits = chequeDepositsRaw.map((r) => ({
    date: toISODate(r.entry_date),
    cheque_no: r.cheque_no || null,
    payer_name: r.payer_name,
    bank_name: r.bank_name || null,
    amount: Number(r.amount),
  }));

  chequeDeposits.reverse();

  return {
    opening_cash: opening,
    cash_received: cashReceived,
    total_cash: opening + cashReceived,
    cash_paid: cashPaid,
    cash_in_hand: opening + cashReceived - cashPaid,
    totals: {
      receipt_bank: sum('receipt_bank'),
      payment_bank: sum('payment_bank'),
      // The GRID's own column totals — both sides of every transaction, so each pair ties.
      // Deliberately not cashReceived/cashPaid: those describe the drawer and appear in the
      // summary box above, where they are meant to differ (the gap is the day's net movement).
      receipt_cash: sum('receipt_cash'),
      payment_cash: sum('payment_cash'),
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
