// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftSaleReturns.repository');
const saleReturnsService = require('./saleReturns.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const {
  buildLine, buildTotals, validateItems, checkKnownVariants,
} = require('./saleReturnMath');

// Saving a draft return RESTORES stock immediately (schema §5.6.2 — anticipating the return, the
// reverse of draft sale bills) — a positive ADJUSTMENT movement per item, no ledger entry.
// bill_no/gp_no/bilty_no/adda_id are optional here (nullable on the draft table; required later,
// at confirm time, before it becomes a real sale return).
async function create(payload, userId) {
  validateItems(payload.items);
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.return_date) throw ApiError.badRequest('return_date is required');

  const variantIds = [...new Set(payload.items.map((item) => item.variant_id))];
  const packings = await repository.getVariantPackings(variantIds);
  checkKnownVariants(variantIds, packings);

  const lines = payload.items.map((item) => buildLine(item, packings.get(item.variant_id)));
  const totals = buildTotals(lines, payload.invoice_discount);

  const draft = {
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
    created_by: userId,
  };

  const draftId = await withTransaction(async (transaction) => {
    const id = await repository.insertDraft(transaction, draft);
    await repository.insertDraftItems(transaction, id, lines);
    await repository.insertStockMovements(
      transaction,
      lines.map((line) => ({
        variant_id: line.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: line.pairs,
        movement_date: draft.return_date,
        source_type: 'DRAFT_SALE_RETURN',
        source_id: id,
      })),
    );
    return id;
  });

  return repository.findById(draftId);
}

async function getById(draftId) {
  const draft = await repository.findById(draftId);
  if (!draft) throw ApiError.notFound('Draft sale return not found');
  return draft;
}

function list(filters) {
  return repository.list(filters);
}

// Editing a draft (SB-06-follow-up, mirrored for returns: ALL saved-unposted returns are drafts
// now, not just genuinely incomplete ones). Stock is reconciled unconditionally: release the old
// lines' restoration (a negative reversing ADJUSTMENT — never delete the original row, same
// reverse-never-erase pattern remove() below uses), then restore the new lines. No oversell check
// needed here — restoring stock can never take it negative, unlike draftSaleBills' deduction.
async function update(draftId, payload) {
  const existing = await getById(draftId);
  validateItems(payload.items);
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.return_date) throw ApiError.badRequest('return_date is required');

  const variantIds = [...new Set(payload.items.map((item) => item.variant_id))];
  const packings = await repository.getVariantPackings(variantIds);
  checkKnownVariants(variantIds, packings);

  const lines = payload.items.map((item) => buildLine(item, packings.get(item.variant_id)));
  const totals = buildTotals(lines, payload.invoice_discount);

  const draft = {
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

  await withTransaction(async (transaction) => {
    // Release the old lines' restoration first (negative reversing ADJUSTMENT).
    await repository.insertStockMovements(
      transaction,
      existing.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: -item.pairs,
        movement_date: existing.return_date,
        source_type: 'DRAFT_SALE_RETURN',
        source_id: draftId,
      })),
    );

    await repository.updateDraftHeader(transaction, draftId, draft);
    await repository.deleteDraftItems(transaction, draftId);
    await repository.insertDraftItems(transaction, draftId, lines);

    // Restore the new lines.
    await repository.insertStockMovements(
      transaction,
      lines.map((line) => ({
        variant_id: line.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: line.pairs,
        movement_date: draft.return_date,
        source_type: 'DRAFT_SALE_RETURN',
        source_id: draftId,
      })),
    );
  });

  return getById(draftId);
}

// Deleting a draft deducts the stock it restored back out (a negative reversing ADJUSTMENT — the
// original restore row is never deleted, matching the schema's reverse-never-erase pattern
// elsewhere), as if the return never happened.
async function remove(draftId) {
  const draft = await getById(draftId);

  await withTransaction(async (transaction) => {
    await repository.insertStockMovements(
      transaction,
      draft.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: -item.pairs,
        movement_date: draft.return_date,
        source_type: 'DRAFT_SALE_RETURN',
        source_id: draftId,
      })),
    );
    await repository.deleteDraft(transaction, draftId);
  });

  return { ok: true };
}

// Confirm = create + post in one step, same rationale as draftSaleBills.confirm. Since the draft
// already restored stock at save time, confirm first reverses that restoration, then runs through
// the exact same insert+post path a normal (non-draft) return would, so there is no special-cased
// "already posted" state anywhere else.
async function confirm(draftId, userId) {
  const draft = await getById(draftId);

  if (!draft.bill_no) throw ApiError.badRequest('bill_no is required before confirming');
  if (!draft.gp_no) throw ApiError.badRequest('gp_no is required before confirming');
  if (!draft.bilty_no) throw ApiError.badRequest('bilty_no is required before confirming');
  if (!draft.adda_id) throw ApiError.badRequest('adda_id is required before confirming');

  const lines = draft.items.map((item) => ({
    variant_id: item.variant_id,
    cartons: item.cartons,
    pairs: item.pairs,
    rate: item.rate,
    discount_percent: item.discount_percent,
    discount_value: item.discount_value,
    value: item.value,
  }));

  const ret = {
    return_date: draft.return_date,
    store_id: draft.store_id,
    customer_id: draft.customer_id,
    sub_customer_id: draft.sub_customer_id,
    bill_no: draft.bill_no,
    gp_no: draft.gp_no,
    bilty_no: draft.bilty_no,
    adda_id: draft.adda_id,
    remarks: draft.remarks,
    invoice_discount: draft.invoice_discount,
    total_cartons: draft.total_cartons,
    total_pairs: draft.total_pairs,
    gross_value: draft.gross_value,
    net_value: draft.net_value,
    created_by: userId,
  };

  const returnId = await withTransaction(async (transaction) => {
    // Reverse the draft's original restoration first, so the posting step below is the only place
    // stock actually moves for this return — same as a return that was never a draft.
    await repository.insertStockMovements(
      transaction,
      draft.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: -item.pairs,
        movement_date: draft.return_date,
        source_type: 'DRAFT_SALE_RETURN',
        source_id: draftId,
      })),
    );

    const id = await saleReturnsService.insertConfirmed(transaction, ret, lines);

    await saleReturnsService.postLedgerAndStock(transaction, {
      returnId: id,
      customerId: draft.customer_id,
      netValue: draft.net_value,
      returnDate: draft.return_date,
      items: lines,
    });

    await repository.deleteDraft(transaction, draftId);
    return id;
  });

  return saleReturnsService.getById(returnId);
}

// Post All for returns — same contract as saleReturns.service.js#postAll would be / mirrors
// draftSaleBills.service.js#confirmAll(): sequential, resolves {posted, failed, attempted}.
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
      posted.push({ draft_id: draftId, bill_no: ret.bill_no, net_value: ret.net_value });
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
