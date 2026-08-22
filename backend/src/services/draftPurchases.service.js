// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftPurchases.repository');
const materialsRepository = require('../repositories/materials.repository');
const purchasesService = require('./purchases.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const { buildLine, buildTotals, validateItems } = require('./purchaseMath');

function validateHeader(payload) {
  if (!payload.vendor_id) throw ApiError.badRequest('vendor_id is required');
  if (!payload.purchase_date) throw ApiError.badRequest('purchase_date is required');
}

// Saving a draft purchase has zero effect on Vendor Stock (per client instruction — unlike draft
// sale bills, nothing physically arrives before a purchase is recorded) — it's a pure scratch
// record, only real once confirmed.
async function create(payload, userId) {
  const draftId = await withTransaction(async (transaction) => {
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

    const draft = {
      purchase_date: payload.purchase_date,
      vendor_id: payload.vendor_id,
      bill_no: payload.bill_no,
      remarks: payload.remarks,
      total_value: totals.totalValue,
      created_by: userId,
    };

    const id = await repository.insertDraft(transaction, draft);
    await repository.insertDraftItems(transaction, id, lines);
    return id;
  });

  return repository.findById(draftId);
}

async function getById(draftId) {
  const draft = await repository.findById(draftId);
  if (!draft) throw ApiError.notFound('Draft purchase not found');
  return draft;
}

function list(filters) {
  return repository.list(filters);
}

// Editing a draft (now the normal "edit a saved-unposted purchase" path, not just for genuinely
// incomplete entries). No stock to reconcile — draft purchases never touch Vendor Stock (same
// reasoning as create() above) — just replace header/items.
async function update(draftId, payload) {
  await getById(draftId);

  return withTransaction(async (transaction) => {
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

    const draft = {
      purchase_date: payload.purchase_date,
      vendor_id: payload.vendor_id,
      bill_no: payload.bill_no,
      remarks: payload.remarks,
      total_value: totals.totalValue,
    };

    await repository.updateDraftHeader(transaction, draftId, draft);
    await repository.deleteDraftItems(transaction, draftId);
    await repository.insertDraftItems(transaction, draftId, lines);

    return repository.findById(draftId);
  });
}

// No stock to reverse (draft-create never touched vendor_stock_movements) — just delete the row,
// as if the purchase never happened.
async function remove(draftId) {
  await getById(draftId);
  await withTransaction((transaction) => repository.deleteDraft(transaction, draftId));
  return { ok: true };
}

// Confirm = create + post in one step, same rationale as draftSaleBills.confirm. The draft's
// items already carry resolved material_id values, so no re-resolution is needed here.
async function confirm(draftId, userId) {
  const draft = await getById(draftId);

  const lines = draft.items.map((item) => ({
    material_id: item.material_id,
    material_name: item.material_name,
    unit: item.unit,
    quantity: item.quantity,
    weight: item.weight,
    price_per_unit: item.price_per_unit,
    total_price: item.total_price,
  }));

  const purchase = {
    purchase_date: draft.purchase_date,
    vendor_id: draft.vendor_id,
    bill_no: draft.bill_no,
    remarks: draft.remarks,
    total_value: draft.total_value,
    created_by: userId,
  };

  const purchaseId = await withTransaction(async (transaction) => {
    const id = await purchasesService.insertConfirmed(transaction, purchase, lines);

    await purchasesService.postLedgerAndStock(transaction, {
      purchaseId: id,
      vendorId: draft.vendor_id,
      totalValue: draft.total_value,
      purchaseDate: draft.purchase_date,
      items: lines,
    });

    await repository.deleteDraft(transaction, draftId);
    return id;
  });

  return purchasesService.getById(purchaseId);
}

// Post All — same contract as saleBills.service.js#postAll()/draftSaleBills.service.js#
// confirmAll(): sequential, resolves { posted, failed, attempted }.
async function confirmAll(ids, userId) {
  const targets = Array.isArray(ids) && ids.length
    ? ids.map((id) => ({ draft_id: id }))
    : await list();

  const posted = [];
  const failed = [];

  for (const target of targets) {
    const draftId = target.draft_id;
    try {
      const purchase = await confirm(draftId, userId);
      posted.push({ draft_id: draftId, bill_no: purchase.bill_no, total_value: purchase.total_value });
    } catch (err) {
      if (!err.status) console.error(`confirmAll: unexpected failure on draft ${draftId}:`, err);
      failed.push({
        draft_id: draftId,
        bill_no: target.bill_no ?? null,
        message: err.status ? err.message : 'Unexpected error while posting this draft.',
        code: err.code || 'INTERNAL',
      });
    }
  }

  return { posted, failed, attempted: targets.length };
}

module.exports = { create, getById, list, update, remove, confirm, confirmAll };
