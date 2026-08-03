// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/purchaseReturns.repository');
const materialsRepository = require('../repositories/materials.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const vendorsService = require('./vendors.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const { buildLine, buildTotals, validateItems } = require('./purchaseMath');
const CODES = require('../constants/reservedAccounts');

function validateHeader(payload) {
  if (!payload.vendor_id) throw ApiError.badRequest('vendor_id is required');
  if (!payload.return_date) throw ApiError.badRequest('return_date is required');
}

async function resolveLinesAndTotals(transaction, payload) {
  validateItems(payload.items);
  validateHeader(payload);

  const items = [];
  for (const item of payload.items) {
    const materialId = item.material_id
      ?? await materialsRepository.resolveOrCreate(transaction, item.material_name, item.unit);
    items.push({ ...item, material_id: materialId });
  }

  const lines = items.map((item) => buildLine(item));
  const totals = buildTotals(lines);
  return { lines, totals };
}

function buildReturnFields(payload, totals) {
  return {
    return_date: payload.return_date,
    vendor_id: payload.vendor_id,
    bill_no: payload.bill_no,
    remarks: payload.remarks,
    total_value: totals.totalValue,
  };
}

async function create(payload, userId) {
  const returnId = await withTransaction(async (transaction) => {
    const { lines, totals } = await resolveLinesAndTotals(transaction, payload);
    const ret = { ...buildReturnFields(payload, totals), created_by: userId };
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

function list(filters = {}) {
  return repository.list({
    vendor_id: filters.vendor_id,
    ...resolveDateRange(filters),
  });
}

// Financial edits only while not yet posted — no edit-a-posted-return flow, same as purchases.service.js.
async function update(id, payload) {
  const existing = await getById(id);
  if (existing.is_posted) {
    throw ApiError.conflict('Unpost the return before editing', 'POSTED_LOCK');
  }

  await withTransaction(async (transaction) => {
    const { lines, totals } = await resolveLinesAndTotals(transaction, payload);
    const ret = buildReturnFields(payload, totals);
    await repository.updateHeader(transaction, id, ret);
    await repository.deleteItems(transaction, id);
    await repository.insertItems(transaction, id, lines);
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
      vendorId: ret.vendor_id,
      totalValue: ret.total_value,
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

// Shared posting logic (schema §7 posting matrix, reverse of purchase): debit VENDOR BA / credit
// PURCHASES chart account, negative PURCHASE_RETURN vendor-stock movement per item. Used by
// purchase-returns:post and by draftPurchaseReturns.confirm.
async function postLedgerAndStock(transaction, {
  returnId, vendorId, totalValue, returnDate, items,
}) {
  const vendor = await vendorsService.getById(vendorId);
  if (!vendor.ba_id) {
    throw ApiError.conflict(
      'Vendor has no linked account yet — add one before posting',
      'NO_VENDOR_ACCOUNT',
    );
  }

  const purchasesAccount = await chartAccountsRepository.findByCode(CODES.PURCHASES);
  if (!purchasesAccount) {
    throw new Error(`Reserved chart account PURCHASES (code ${CODES.PURCHASES}) not found — run npm run seed`);
  }

  await repository.insertLedgerEntries(transaction, [
    {
      entry_date: returnDate,
      ba_id: vendor.ba_id,
      debit: totalValue,
      credit: 0,
      source_type: 'PURCHASE_RETURN',
      source_id: returnId,
      narration: `Purchase return #${returnId}`,
    },
    {
      entry_date: returnDate,
      ac_id: purchasesAccount.ac_id,
      debit: 0,
      credit: totalValue,
      source_type: 'PURCHASE_RETURN',
      source_id: returnId,
      narration: `Purchase return #${returnId}`,
    },
  ]);

  await repository.insertVendorStockMovements(
    transaction,
    items.map((item) => ({
      vendor_id: vendorId,
      material_id: item.material_id,
      unit: item.unit,
      qty: -item.quantity,
      movement_type: 'PURCHASE_RETURN',
      movement_date: returnDate,
      source_type: 'PURCHASE_RETURN',
      source_id: returnId,
    })),
  );
}

// Inserts an already-built return+lines (used by draftPurchaseReturns.confirm). Caller owns the transaction.
async function insertConfirmed(transaction, ret, lines) {
  const id = await repository.insert(transaction, ret);
  await repository.insertItems(transaction, id, lines);
  return id;
}

async function getById(returnId) {
  const ret = await repository.findById(returnId);
  if (!ret) throw ApiError.notFound('Purchase return not found');
  return ret;
}

module.exports = {
  create, list, getById, update, post, unpost, postLedgerAndStock, insertConfirmed,
};
