// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftSaleBills.repository');
const saleBillsService = require('./saleBills.service');
const stockService = require('./stock.service');
const productColorsService = require('./productColors.service');
const productsService = require('./products.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const {
  buildLine, buildTotals, validateItems, checkKnownVariants, validateDeliveryCustomer,
} = require('./saleBillMath');

// SB-03: never deduct stock below zero — a draft deducts stock immediately on save (see create()
// below), so this is the first place a sale can oversell, not just at confirm/post. Requested
// pairs are summed per variant first since the same article/color can appear on more than one
// line (SB-02).
async function assertStockAvailable(lines) {
  const requestedByVariant = new Map();
  for (const line of lines) {
    requestedByVariant.set(line.variant_id, (requestedByVariant.get(line.variant_id) || 0) + line.pairs);
  }
  for (const [variantId, requestedPairs] of requestedByVariant) {
    const onHand = await stockService.pairsOnHand(variantId);
    if (requestedPairs > onHand) {
      const variant = await productColorsService.getById(variantId);
      const article = await productsService.getById(variant.article_id);
      throw ApiError.conflict(
        `Not enough stock for ${article.name} (${variant.color}): ${requestedPairs} pairs requested, only ${onHand} on hand.`,
        'INSUFFICIENT_STOCK',
        { variant_id: variantId, requested_pairs: requestedPairs, on_hand_pairs: onHand },
      );
    }
  }
}

// Saving a draft deducts stock immediately (schema §5.6.1) — a negative ADJUSTMENT movement per
// item, no ledger entry. bill_no/gp_no/bilty_no/adda_id are optional here (nullable on the draft
// table; required later, at confirm time, before it becomes a real sale bill).
async function create(payload, userId) {
  validateItems(payload.items);
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.bill_date) throw ApiError.badRequest('bill_date is required');

  const variantIds = [...new Set(payload.items.map((item) => item.variant_id))];
  const packings = await repository.getVariantPackings(variantIds);
  checkKnownVariants(variantIds, packings);

  const lines = payload.items.map((item) => buildLine(item, packings.get(item.variant_id)));
  const totals = buildTotals(lines, payload.invoice_discount);
  await assertStockAvailable(lines);

  const draft = {
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
        qty_pairs: -line.pairs,
        movement_date: draft.bill_date,
        source_type: 'DRAFT_SALE_BILL',
        source_id: id,
      })),
    );
    return id;
  });

  return repository.findById(draftId);
}

async function getById(draftId) {
  const draft = await repository.findById(draftId);
  if (!draft) throw ApiError.notFound('Draft sale bill not found');
  return draft;
}

function list(filters) {
  return repository.list(filters);
}

// Editing a draft (SB-06-follow-up: ALL saved-unposted bills are now drafts, not just genuinely
// incomplete ones, so this is the normal "edit before posting" path). Stock is reconciled
// unconditionally, same shape as saleBills.service.js#update()'s own reconciliation: release the
// old lines (a positive reversing ADJUSTMENT — never delete the original row, same
// reverse-never-erase pattern remove() below uses), check the new lines against what that
// releases, then reserve the new lines.
async function update(draftId, payload) {
  const existing = await getById(draftId);
  validateItems(payload.items);
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.bill_date) throw ApiError.badRequest('bill_date is required');

  const variantIds = [...new Set(payload.items.map((item) => item.variant_id))];
  const packings = await repository.getVariantPackings(variantIds);
  checkKnownVariants(variantIds, packings);

  const lines = payload.items.map((item) => buildLine(item, packings.get(item.variant_id)));
  const totals = buildTotals(lines, payload.invoice_discount);

  // Netting out this draft's own existing reservation before checking, same reasoning as
  // saleBills.service.js#assertStockAvailableForEdit — otherwise editing a draft's own quantities
  // without changing the total would look like a false oversell.
  const alreadyReserved = new Map();
  for (const item of existing.items) {
    alreadyReserved.set(item.variant_id, (alreadyReserved.get(item.variant_id) || 0) + item.pairs);
  }
  const requestedByVariant = new Map();
  for (const line of lines) {
    requestedByVariant.set(line.variant_id, (requestedByVariant.get(line.variant_id) || 0) + line.pairs);
  }
  for (const [variantId, requestedPairs] of requestedByVariant) {
    const onHand = await stockService.pairsOnHand(variantId);
    const effectiveOnHand = onHand + (alreadyReserved.get(variantId) || 0);
    if (requestedPairs > effectiveOnHand) {
      const variant = await productColorsService.getById(variantId);
      const article = await productsService.getById(variant.article_id);
      throw ApiError.conflict(
        `Not enough stock for ${article.name} (${variant.color}): ${requestedPairs} pairs requested, only ${effectiveOnHand} on hand.`,
        'INSUFFICIENT_STOCK',
        { variant_id: variantId, requested_pairs: requestedPairs, on_hand_pairs: effectiveOnHand },
      );
    }
  }

  const draft = {
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
  };

  await withTransaction(async (transaction) => {
    // Release the old lines' reservation first (positive reversing ADJUSTMENT).
    await repository.insertStockMovements(
      transaction,
      existing.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: item.pairs,
        movement_date: existing.bill_date,
        source_type: 'DRAFT_SALE_BILL',
        source_id: draftId,
      })),
    );

    await repository.updateDraftHeader(transaction, draftId, draft);
    await repository.deleteDraftItems(transaction, draftId);
    await repository.insertDraftItems(transaction, draftId, lines);

    // Reserve the new lines.
    await repository.insertStockMovements(
      transaction,
      lines.map((line) => ({
        variant_id: line.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: -line.pairs,
        movement_date: draft.bill_date,
        source_type: 'DRAFT_SALE_BILL',
        source_id: draftId,
      })),
    );
  });

  return getById(draftId);
}

// Deleting a draft restores the stock it deducted (a positive reversing ADJUSTMENT — the original
// deduct row is never deleted, matching the schema's reverse-never-erase pattern elsewhere).
async function remove(draftId) {
  const draft = await getById(draftId);

  await withTransaction(async (transaction) => {
    await repository.insertStockMovements(
      transaction,
      draft.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: item.pairs,
        movement_date: draft.bill_date,
        source_type: 'DRAFT_SALE_BILL',
        source_id: draftId,
      })),
    );
    await repository.deleteDraft(transaction, draftId);
  });

  return { ok: true };
}

// Confirm = create + post in one step (per the real workflow: an admin drafts a bill, comes back
// later, fills in the dispatch details, and presses Confirm — that's the same moment it's finished
// and posted, not a separate later action). Since the draft already deducted stock at save time,
// confirm first reverses that deduction, then runs through the exact same insert+post path a
// normal (non-draft) bill would, so there is no special-cased "already posted" state anywhere else.
async function confirm(draftId, userId) {
  const draft = await getById(draftId);

  // gp_no/bilty_no/adda_id are optional on sale_bills itself now (dispatch details filled in
  // later via the bilty/adda update flow), so confirming a draft shouldn't require them either —
  // only bill_no, which sale_bills.service.js#validateHeader also still requires.
  if (!draft.bill_no) throw ApiError.badRequest('bill_no is required before confirming');
  // sale_bills enforces CK_sale_bills_custdlv but draft_sale_bills doesn't — a draft may have been
  // saved as CUSTOM delivery with no sub-customer yet; catch it here with a clear message instead
  // of letting the INSERT below fail on the real table's constraint.
  validateDeliveryCustomer(draft);

  const lines = draft.items.map((item) => ({
    variant_id: item.variant_id,
    cartons: item.cartons,
    pairs: item.pairs,
    rate: item.rate,
    discount_percent: item.discount_percent,
    discount_value: item.discount_value,
    value: item.value,
  }));

  const bill = {
    bill_date: draft.bill_date,
    store_id: draft.store_id,
    customer_id: draft.customer_id,
    sub_customer_id: draft.sub_customer_id,
    main_ac_id: draft.main_ac_id,
    delivery_type: draft.delivery_type,
    delivery_address: draft.delivery_address,
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

  const billId = await withTransaction(async (transaction) => {
    // Reverse the draft's original deduction first, so the posting step below is the only place
    // stock actually moves for this bill — same as a bill that was never a draft.
    await repository.insertStockMovements(
      transaction,
      draft.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: item.pairs,
        movement_date: draft.bill_date,
        source_type: 'DRAFT_SALE_BILL',
        source_id: draftId,
      })),
    );

    const id = await saleBillsService.insertConfirmed(transaction, bill, lines);

    await saleBillsService.postLedgerAndStock(transaction, {
      billId: id,
      customerId: draft.customer_id,
      netValue: draft.net_value,
      billDate: draft.bill_date,
      items: lines,
    });

    await repository.deleteDraft(transaction, draftId);
    return id;
  });

  return saleBillsService.getById(billId);
}

// Post All, for a draft table doing double duty as "everything awaiting posting" now that every
// saved-unposted bill lives here (not just genuinely incomplete ones). Same contract as
// saleBills.service.js#postAll(): sequential (confirm() reads live stock per draft, so posting
// them one after another is what makes a second one that no longer fits correctly fail — running
// concurrently would let two drafts oversell against the same pre-sale stock), resolves
// { posted, failed, attempted } rather than throwing on the first failure.
async function confirmAll(ids, userId) {
  const targets = Array.isArray(ids) && ids.length
    ? ids.map((id) => ({ draft_id: id }))
    : await list();

  const posted = [];
  const failed = [];

  for (const target of targets) {
    const draftId = target.draft_id;
    try {
      const bill = await confirm(draftId, userId);
      posted.push({ draft_id: draftId, bill_no: bill.bill_no, net_value: bill.net_value });
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
