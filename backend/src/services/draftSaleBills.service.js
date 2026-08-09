// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftSaleBills.repository');
const saleBillsService = require('./saleBills.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const {
  buildLine, buildTotals, validateItems, checkKnownVariants, validateDeliveryCustomer,
} = require('./saleBillMath');

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

module.exports = { create, getById, list, remove, confirm };
