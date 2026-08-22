// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftPurchaseReturns.repository');
const materialsRepository = require('../repositories/materials.repository');
const purchaseReturnsService = require('./purchaseReturns.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const { buildLine, buildTotals, validateItems } = require('./purchaseMath');

function validateHeader(payload) {
  if (!payload.vendor_id) throw ApiError.badRequest('vendor_id is required');
  if (!payload.return_date) throw ApiError.badRequest('return_date is required');
}

// Saving a draft purchase return has zero effect on Vendor Stock — pure scratch record, only real
// once confirmed (same rationale as draftPurchases.service.js).
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
      return_date: payload.return_date,
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
  if (!draft) throw ApiError.notFound('Draft purchase return not found');
  return draft;
}

function list(filters) {
  return repository.list(filters);
}

// Editing a draft (now the normal "edit a saved-unposted return" path, not just for genuinely
// incomplete entries). No stock to reconcile — draft purchase returns never touch Vendor Stock
// (same reasoning as create() above) — just replace header/items.
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
      return_date: payload.return_date,
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

// No stock to reverse (draft-create never touched vendor_stock_movements) — just delete the row.
async function remove(draftId) {
  await getById(draftId);
  await withTransaction((transaction) => repository.deleteDraft(transaction, draftId));
  return { ok: true };
}

// Confirm = create + post in one step. Draft items already carry resolved material_id values.
async function confirm(draftId, userId) {
  const draft = await getById(draftId);

  const lines = draft.items.map((item) => ({
    material_id: item.material_id,
    unit: item.unit,
    quantity: item.quantity,
    weight: item.weight,
    price_per_unit: item.price_per_unit,
    total_price: item.total_price,
  }));

  const ret = {
    return_date: draft.return_date,
    vendor_id: draft.vendor_id,
    bill_no: draft.bill_no,
    remarks: draft.remarks,
    total_value: draft.total_value,
    created_by: userId,
  };

  const returnId = await withTransaction(async (transaction) => {
    const id = await purchaseReturnsService.insertConfirmed(transaction, ret, lines);

    await purchaseReturnsService.postLedgerAndStock(transaction, {
      returnId: id,
      vendorId: draft.vendor_id,
      totalValue: draft.total_value,
      returnDate: draft.return_date,
      items: lines,
    });

    await repository.deleteDraft(transaction, draftId);
    return id;
  });

  return purchaseReturnsService.getById(returnId);
}

// Post All — same contract as draftPurchases.service.js#confirmAll(): sequential, resolves
// { posted, failed, attempted }.
async function confirmAll(ids, userId) {
  const targets = Array.isArray(ids) && ids.length
    ? ids.map((id) => ({ draft_id: id }))
    : await list();

  const posted = [];
  const failed = [];

  for (const target of targets) {
    const draftId = target.draft_id;
    try {
      const ret = await confirm(draftId, userId);
      posted.push({ draft_id: draftId, bill_no: ret.bill_no, total_value: ret.total_value });
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
