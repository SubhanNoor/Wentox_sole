// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/saleReturns.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const customersService = require('./customers.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const {
  buildLine, buildTotals, validateItems, checkKnownVariants,
} = require('./saleReturnMath');
const CODES = require('../constants/reservedAccounts');
const { toISODate } = require('../utils/dates');
// Repository, not service — draftSaleReturns.service.js already requires this service the other
// way (its confirm() calls insertConfirmed()/postLedgerAndStock()), so requiring its SERVICE back
// here would be circular. Same reasoning as saleBills.service.js#unconfirm().
const draftSaleReturnsRepository = require('../repositories/draftSaleReturns.repository');

// bilty_no / gp_no / adda_id are dispatch details that are often unknown when the return is
// recorded — the goods can come back before any bilty exists, or without going through an adda at
// all. Optional since migration 018, matching sale bills (migrations 012/013) and matching the
// draft tables, which have always allowed all three to be blank.
function validateHeader(payload) {
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.bill_no) throw ApiError.badRequest('bill_no is required');
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

function buildReturnFields(payload, totals) {
  return {
    return_date: payload.return_date,
    store_id: payload.store_id,
    customer_id: payload.customer_id,
    sub_customer_id: payload.sub_customer_id,
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
  };
}

async function create(payload, userId) {
  const { lines, totals } = await resolveLinesAndTotals(payload);
  const ret = { ...buildReturnFields(payload, totals), created_by: userId };

  const returnId = await withTransaction(async (transaction) => {
    const id = await repository.insert(transaction, ret);
    await repository.insertItems(transaction, id, lines);
    return id;
  });

  return repository.findById(returnId);
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

// Editing a not-yet-posted return just replaces header/items (nothing posted yet, nothing to
// reverse). Editing an already-posted return reverses its live ledger/stock rows and reapplies
// them against the new totals in the same transaction — the unpost-edit-repost cycle collapsed
// into one atomic step so "posted" (derived from ledger_entries — see repository.isPosted) never
// visibly flips off from the user's perspective (see saleReturns.ipc.js for the password guard,
// which only applies to this already-posted-edit branch).
async function update(id, payload) {
  const existing = await getById(id);
  const { lines, totals } = await resolveLinesAndTotals(payload);
  const ret = buildReturnFields(payload, totals);

  await withTransaction(async (transaction) => {
    if (existing.is_posted) {
      await repository.deleteLedgerAndStock(transaction, id);
    }

    await repository.updateHeader(transaction, id, ret);
    await repository.deleteItems(transaction, id);
    await repository.insertItems(transaction, id, lines);

    if (existing.is_posted) {
      await postLedgerAndStock(transaction, {
        returnId: id,
        customerId: ret.customer_id,
        netValue: totals.netValue,
        returnDate: ret.return_date,
        items: lines,
      });
    }
  });

  return getById(id);
}

async function post(id) {
  const ret = await getById(id);
  if (ret.is_posted) {
    throw ApiError.conflict('Return is already posted', 'ALREADY_POSTED');
  }

  await withTransaction(async (transaction) => {
    await postLedgerAndStock(transaction, {
      returnId: id,
      customerId: ret.customer_id,
      netValue: ret.net_value,
      returnDate: ret.return_date,
      items: ret.items,
    });
  });

  return getById(id);
}

async function unpost(id) {
  const ret = await getById(id);
  if (!ret.is_posted) {
    throw ApiError.conflict('Return is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerAndStock(transaction, id);
  });

  return getById(id);
}

// Reverse of draftSaleReturns.service.js#confirm(): the real sale_returns table now strictly
// never holds an unposted document, mirroring saleBills.service.js#unconfirm(). Stock stays
// restored throughout — released here as a SALE_RETURN row (a negative ADJUSTMENT undoing the
// positive one post() wrote), then immediately re-restored as a DRAFT_SALE_RETURN row for the new
// draft, net zero effect on actual on-hand stock.
async function unconfirm(id) {
  const ret = await getById(id);
  if (!ret.is_posted) {
    throw ApiError.conflict('Return is not posted', 'NOT_POSTED');
  }

  const draftId = await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, id);
    await repository.insertStockMovements(
      transaction,
      ret.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: -item.pairs,
        movement_date: ret.return_date,
        source_type: 'SALE_RETURN',
        source_id: id,
      })),
    );

    const draft = {
      return_date: ret.return_date,
      store_id: ret.store_id,
      customer_id: ret.customer_id,
      sub_customer_id: ret.sub_customer_id,
      bill_no: ret.bill_no,
      gp_no: ret.gp_no,
      bilty_no: ret.bilty_no,
      adda_id: ret.adda_id,
      remarks: ret.remarks,
      invoice_discount: ret.invoice_discount,
      total_cartons: ret.total_cartons,
      total_pairs: ret.total_pairs,
      gross_value: ret.gross_value,
      net_value: ret.net_value,
      created_by: ret.created_by,
    };
    const lines = ret.items.map((item) => ({
      variant_id: item.variant_id,
      cartons: item.cartons,
      pairs: item.pairs,
      rate: item.rate,
      discount_percent: item.discount_percent,
      discount_value: item.discount_value,
      value: item.value,
    }));

    const newDraftId = await draftSaleReturnsRepository.insertDraft(transaction, draft);
    await draftSaleReturnsRepository.insertDraftItems(transaction, newDraftId, lines);
    await draftSaleReturnsRepository.insertStockMovements(
      transaction,
      lines.map((line) => ({
        variant_id: line.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: line.pairs,
        movement_date: draft.return_date,
        source_type: 'DRAFT_SALE_RETURN',
        source_id: newDraftId,
      })),
    );

    await repository.deleteItems(transaction, id);
    await repository.deleteReturn(transaction, id);

    return newDraftId;
  });

  return draftSaleReturnsRepository.findById(draftId);
}

// Shared posting logic (schema §6 posting matrix, reverse of sale bill): debit SALES chart
// account / credit CUSTOMER BA, positive SALE_RETURN stock movement per item. Used by
// sale-returns:post and by draftSaleReturns.confirm (which posts immediately instead of leaving
// the return unposted).
async function postLedgerAndStock(transaction, {
  returnId, customerId, netValue, returnDate, items,
}) {
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
      entry_date: returnDate,
      ac_id: salesAccount.ac_id,
      debit: netValue,
      credit: 0,
      source_type: 'SALE_RETURN',
      source_id: returnId,
      narration: `Sale return #${returnId}`,
    },
    {
      entry_date: returnDate,
      ba_id: customer.ba_id,
      debit: 0,
      credit: netValue,
      source_type: 'SALE_RETURN',
      source_id: returnId,
      narration: `Sale return #${returnId}`,
    },
  ]);

  await repository.insertStockMovements(
    transaction,
    items.map((item) => ({
      variant_id: item.variant_id,
      movement_type: 'SALE_RETURN',
      qty_pairs: item.pairs,
      movement_date: returnDate,
      source_type: 'SALE_RETURN',
      source_id: returnId,
    })),
  );
}

// Inserts an already-built return+lines (used by draftSaleReturns.confirm, which builds a return
// directly from a draft's already-computed data instead of recomputing totals — the caller posts
// it right after via postLedgerAndStock, which is what makes it "posted"). Caller owns the
// transaction.
async function insertConfirmed(transaction, ret, lines) {
  const id = await repository.insert(transaction, ret);
  await repository.insertItems(transaction, id, lines);
  return id;
}

async function getById(returnId) {
  const ret = await repository.findById(returnId);
  if (!ret) throw ApiError.notFound('Sale return not found');
  return ret;
}

module.exports = {
  create, list, getById, update, post, unpost, unconfirm, postLedgerAndStock, insertConfirmed,
};
