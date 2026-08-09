// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/purchases.repository');
const materialsRepository = require('../repositories/materials.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const vendorsService = require('./vendors.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const { buildLine, buildTotals, validateItems } = require('./purchaseMath');
const CODES = require('../constants/reservedAccounts');
const { toISODate } = require('../utils/dates');

function validateHeader(payload) {
  if (!payload.vendor_id) throw ApiError.badRequest('vendor_id is required');
  if (!payload.purchase_date) throw ApiError.badRequest('purchase_date is required');
}

// Resolves each line's material_id (existing id, or auto-registers payload.material_name — UC-23
// "material entry is open-ended, but only once per material") inside the given transaction, then
// builds lines + rolled-up totals.
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

function buildPurchaseFields(payload, totals) {
  return {
    purchase_date: payload.purchase_date,
    vendor_id: payload.vendor_id,
    bill_no: payload.bill_no,
    remarks: payload.remarks,
    total_value: totals.totalValue,
  };
}

async function create(payload, userId) {
  const purchaseId = await withTransaction(async (transaction) => {
    const { lines, totals } = await resolveLinesAndTotals(transaction, payload);
    const purchase = { ...buildPurchaseFields(payload, totals), created_by: userId };
    const id = await repository.insert(transaction, purchase);
    await repository.insertItems(transaction, id, lines);
    return id;
  });

  return repository.findById(purchaseId);
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
    vendor_id: filters.vendor_id,
    ...resolveDateRange(filters),
  });
}

// Financial edits only while not yet posted — no edit-a-posted-purchase flow exists (unlike Sale
// Bill/Return), so unlike those services this simply blocks instead of reversing+reapplying.
async function update(id, payload) {
  const existing = await getById(id);
  if (existing.is_posted) {
    throw ApiError.conflict('Unpost the purchase before editing', 'POSTED_LOCK');
  }

  await withTransaction(async (transaction) => {
    const { lines, totals } = await resolveLinesAndTotals(transaction, payload);
    const purchase = buildPurchaseFields(payload, totals);
    await repository.updateHeader(transaction, id, purchase);
    await repository.deleteItems(transaction, id);
    await repository.insertItems(transaction, id, lines);
  });

  return getById(id);
}

async function post(id) {
  const purchase = await getById(id);
  if (purchase.is_posted) {
    throw ApiError.conflict('Purchase is already posted', 'ALREADY_POSTED');
  }

  await withTransaction(async (transaction) => {
    await postLedgerAndStock(transaction, {
      purchaseId: id,
      vendorId: purchase.vendor_id,
      totalValue: purchase.total_value,
      purchaseDate: purchase.purchase_date,
      items: purchase.items,
    });
  });

  return getById(id);
}

async function unpost(id) {
  const purchase = await getById(id);
  if (!purchase.is_posted) {
    throw ApiError.conflict('Purchase is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerAndStock(transaction, id);
  });

  return getById(id);
}

// Shared posting logic (schema §7 posting matrix): debit PURCHASES chart account / credit VENDOR
// BA, positive PURCHASE vendor-stock movement per item. Used by purchases:post and by
// draftPurchases.confirm (which posts immediately instead of leaving the purchase unposted).
// Purchases never touch finished-goods (pairs) stock — only vendor_stock_movements.
async function postLedgerAndStock(transaction, {
  purchaseId, vendorId, totalValue, purchaseDate, items,
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
      entry_date: purchaseDate,
      ac_id: purchasesAccount.ac_id,
      debit: totalValue,
      credit: 0,
      source_type: 'PURCHASE',
      source_id: purchaseId,
      narration: `Purchase #${purchaseId}`,
    },
    {
      entry_date: purchaseDate,
      ba_id: vendor.ba_id,
      debit: 0,
      credit: totalValue,
      source_type: 'PURCHASE',
      source_id: purchaseId,
      narration: `Purchase #${purchaseId}`,
    },
  ]);

  await repository.insertVendorStockMovements(
    transaction,
    items.map((item) => ({
      vendor_id: vendorId,
      material_id: item.material_id,
      unit: item.unit,
      qty: item.quantity,
      movement_type: 'PURCHASE',
      movement_date: purchaseDate,
      source_type: 'PURCHASE',
      source_id: purchaseId,
    })),
  );
}

// Inserts an already-built purchase+lines (used by draftPurchases.confirm, which builds a
// purchase directly from a draft's already-computed data instead of recomputing totals — the
// caller posts it right after via postLedgerAndStock, which is what makes it "posted"). Caller
// owns the transaction.
async function insertConfirmed(transaction, purchase, lines) {
  const id = await repository.insert(transaction, purchase);
  await repository.insertItems(transaction, id, lines);
  return id;
}

async function getById(purchaseId) {
  const purchase = await repository.findById(purchaseId);
  if (!purchase) throw ApiError.notFound('Purchase not found');
  return purchase;
}

module.exports = {
  create, list, getById, update, post, unpost, postLedgerAndStock, insertConfirmed,
};
