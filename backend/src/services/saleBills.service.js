// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/saleBills.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const customersService = require('./customers.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const {
  buildLine, buildTotals, validateItems, checkKnownVariants, validateDeliveryCustomer,
} = require('./saleBillMath');
const CODES = require('../constants/reservedAccounts');
const { toISODate } = require('../utils/dates');

// bilty_no/gp_no/adda_id are all optional at save time — dispatch details are often not known yet
// when the bill is written up, and get filled in later via updateBiltyInfo() below (which still
// requires both bilty_no and adda_id — that flow's whole purpose is setting them) once the goods
// actually ship. bill_no stays required (unaffected by this).
function validateHeader(payload) {
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.bill_no) throw ApiError.badRequest('bill_no is required');
  validateDeliveryCustomer(payload);
}

// Shared line/total resolution for create() and update() — validates items, looks up packing,
// builds lines + rolled-up totals. Header fields are assembled separately since create() needs
// status/created_by and update() doesn't touch either.
async function resolveLinesAndTotals(payload) {
  validateItems(payload.items);
  validateHeader(payload);

  const variantIds = [...new Set(payload.items.map((item) => item.variant_id))];
  const packings = await repository.getVariantPackings(variantIds);
  checkKnownVariants(variantIds, packings);

  const lines = payload.items.map((item) => buildLine(item, packings.get(item.variant_id)));
  const totals = buildTotals(lines, payload.invoice_discount);
  return { lines, totals };
}

function buildBillFields(payload, totals) {
  return {
    bill_date: payload.bill_date,
    store_id: payload.store_id,
    customer_id: payload.customer_id,
    sub_customer_id: payload.sub_customer_id,
    main_ac_id: payload.main_ac_id,
    delivery_type: payload.delivery_type || 'SAME',
    delivery_address: payload.delivery_address,
    bill_no: payload.bill_no,
    gp_no: payload.gp_no,
    bilty_no: payload.bilty_no,
    adda_id: payload.adda_id,
    remarks: payload.remarks,
    invoice_discount: payload.invoice_discount || 0,
    total_cartons: totals.totalCartons,
    total_pairs: totals.totalPairs,
    gross_value: totals.grossValue,
    net_value: totals.netValue,
    due_date: payload.due_date || null,
  };
}

async function create(payload, userId) {
  const { lines, totals } = await resolveLinesAndTotals(payload);
  const bill = { ...buildBillFields(payload, totals), created_by: userId };

  const billId = await withTransaction(async (transaction) => {
    const id = await repository.insert(transaction, bill);
    await repository.insertItems(transaction, id, lines);
    return id;
  });

  return repository.findById(billId);
}

// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins).
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

function list(filters = {}) {
  return repository.list({
    customer_id: filters.customer_id,
    sub_customer_id: filters.sub_customer_id,
    bill_no: filters.bill_no,
    ...resolveDateRange(filters),
  });
}

// Editing a not-yet-posted bill just replaces header/items (nothing posted yet, nothing to
// reverse). Editing an already-posted bill reverses its live ledger/stock rows and reapplies them
// against the new totals in the same transaction — the unpost-edit-repost cycle collapsed into
// one atomic step so "posted" (derived from ledger_entries — see repository.isPosted) never
// visibly flips off from the user's perspective (see saleBills.ipc.js for the password guard,
// which only applies to this already-posted-edit branch).
async function update(id, payload) {
  const existing = await getById(id);
  const { lines, totals } = await resolveLinesAndTotals(payload);
  const bill = buildBillFields(payload, totals);

  await withTransaction(async (transaction) => {
    if (existing.is_posted) {
      await repository.deleteLedgerAndStock(transaction, id);
    }

    await repository.updateHeader(transaction, id, bill);
    await repository.deleteItems(transaction, id);
    await repository.insertItems(transaction, id, lines);

    if (existing.is_posted) {
      await postLedgerAndStock(transaction, {
        billId: id,
        customerId: bill.customer_id,
        netValue: totals.netValue,
        billDate: bill.bill_date,
        items: lines,
      });
    }
  });

  return getById(id);
}

async function post(id) {
  const bill = await getById(id);
  if (bill.is_posted) {
    throw ApiError.conflict('Bill is already posted', 'ALREADY_POSTED');
  }

  await withTransaction(async (transaction) => {
    await postLedgerAndStock(transaction, {
      billId: id,
      customerId: bill.customer_id,
      netValue: bill.net_value,
      billDate: bill.bill_date,
      items: bill.items,
    });
  });

  return getById(id);
}

async function unpost(id) {
  const bill = await getById(id);
  if (!bill.is_posted) {
    throw ApiError.conflict('Bill is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerAndStock(transaction, id);
  });

  return getById(id);
}

// Shared posting logic (schema §6 posting matrix): debit CUSTOMER BA / credit SALES chart account,
// negative SALE stock movement per item. Used by sale-bills:post and by draftSaleBills.confirm
// (which posts immediately instead of leaving the bill unposted).
async function postLedgerAndStock(transaction, { billId, customerId, netValue, billDate, items }) {
  const customer = await customersService.getById(customerId);
  if (!customer.ba_id) {
    throw ApiError.conflict(
      'Customer has no linked account yet — add one before posting',
      'NO_CUSTOMER_ACCOUNT',
    );
  }

  const salesAccount = await chartAccountsRepository.findByCode(CODES.SALES);
  if (!salesAccount) {
    throw new Error(`Reserved chart account SALES (code ${CODES.SALES}) not found — run npm run seed`);
  }

  await repository.insertLedgerEntries(transaction, [
    {
      entry_date: billDate,
      ba_id: customer.ba_id,
      debit: netValue,
      credit: 0,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
    {
      entry_date: billDate,
      ac_id: salesAccount.ac_id,
      debit: 0,
      credit: netValue,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
  ]);

  await repository.insertStockMovements(
    transaction,
    items.map((item) => ({
      variant_id: item.variant_id,
      movement_type: 'SALE',
      qty_pairs: -item.pairs,
      movement_date: billDate,
      source_type: 'SALE_BILL',
      source_id: billId,
    })),
  );
}

// Inserts an already-built bill+lines (used by draftSaleBills.confirm, which builds a bill
// directly from a draft's already-computed data instead of recomputing totals — the caller posts
// it right after via postLedgerAndStock, which is what makes it "posted"). Caller owns the
// transaction.
async function insertConfirmed(transaction, bill, lines) {
  const id = await repository.insert(transaction, bill);
  await repository.insertItems(transaction, id, lines);
  return id;
}

async function getById(billId) {
  const bill = await repository.findById(billId);
  if (!bill) throw ApiError.notFound('Sale bill not found');
  return bill;
}

// UC-20 — same filter shape as list() but with display fields for the search screen.
function biltySearch(filters = {}) {
  return repository.biltySearch({
    customer_id: filters.customer_id,
    sub_customer_id: filters.sub_customer_id,
    bill_no: filters.bill_no,
    ...resolveDateRange(filters),
  });
}

// bilty_no + adda_id ONLY, non-financial — allowed on a POSTED bill, unlike the full update()
// above which is blocked from touching items/totals once posted, this never even checks
// is_posted, since it never writes to ledger_entries/stock_movements.
async function updateBiltyInfo(billId, payload) {
  await getById(billId); // 404s if the bill doesn't exist
  // Both optional since migrations 012/013 made the columns nullable — this screen exists precisely
  // to fill them in later, so demanding them here blocked clearing a value that was entered wrongly.

  await repository.updateBiltyInfo(billId, { bilty_no: payload.bilty_no, adda_id: payload.adda_id });
  return getById(billId);
}

module.exports = {
  create, list, getById, update, post, unpost, postLedgerAndStock, insertConfirmed,
  biltySearch, updateBiltyInfo,
};
