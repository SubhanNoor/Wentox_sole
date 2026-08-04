// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftReceipts.repository');
const receiptsService = require('./receipts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

// CASH/ONLINE only — dbo.draft_receipts carries a cheque_id FK for shape-symmetry with dbo.receipts
// but has no cheque_no/cheque_date columns of its own, so a genuinely useful "draft cheque receipt"
// isn't representable. A CHEQUE receipt is recorded directly via receipts:create instead.
function validateHeader(payload) {
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.receipt_date) throw ApiError.badRequest('receipt_date is required');
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  if (payload.payment_mode !== 'CASH' && payload.payment_mode !== 'ONLINE') {
    throw ApiError.badRequest("draft receipts only support payment_mode 'CASH' or 'ONLINE' — record a CHEQUE receipt directly via receipts:create");
  }
  if (payload.payment_mode === 'ONLINE' && !payload.bank_id) {
    throw ApiError.badRequest('bank_id is required for an ONLINE receipt');
  }
}

async function create(payload, userId) {
  validateHeader(payload);
  const draftId = await withTransaction((transaction) => repository.insert(transaction, {
    receipt_date: payload.receipt_date,
    customer_id: payload.customer_id,
    amount: payload.amount,
    commission: payload.commission || 0,
    payment_mode: payload.payment_mode,
    details: payload.details,
    bank_id: payload.payment_mode === 'ONLINE' ? payload.bank_id : null,
    remarks: payload.remarks,
    created_by: userId,
  }));
  return getById(draftId);
}

async function getById(draftId) {
  const draft = await repository.findById(draftId);
  if (!draft) throw ApiError.notFound('Draft receipt not found');
  return draft;
}

function list(filters) {
  return repository.list(filters);
}

async function remove(draftId) {
  await getById(draftId);
  await withTransaction((transaction) => repository.deleteDraft(transaction, draftId));
  return { ok: true };
}

// Confirm = create the real receipt + post it + delete the draft, all in ONE transaction, using
// receipts.service.js's insertReceipt()/postWithinTransaction() building blocks. Originally this
// ran create() and post() as two separate transactions — debugger review caught that a failure in
// post() (e.g. a missing chart account, a customer with no linked ba_id) after create() had
// already committed left an orphaned DRAFT receipt AND the draft itself still present, so retrying
// confirm() on the same draft would call create() a second time and produce a duplicate real
// receipt. One shared transaction removes that gap entirely — either everything commits, or
// nothing does, and the draft is never left half-confirmed.
async function confirm(draftId, userId) {
  const draft = await getById(draftId);
  const payload = {
    receipt_date: draft.receipt_date,
    customer_id: draft.customer_id,
    amount: draft.amount,
    commission: draft.commission,
    payment_mode: draft.payment_mode,
    details: draft.details,
    bank_id: draft.bank_id,
    remarks: draft.remarks,
  };

  const receiptId = await withTransaction(async (transaction) => {
    const id = await receiptsService.insertReceipt(transaction, payload, userId);
    await receiptsService.postWithinTransaction(transaction, id, payload);
    await repository.deleteDraft(transaction, draftId);
    return id;
  });

  return receiptsService.getById(receiptId);
}

module.exports = { create, getById, list, remove, confirm };
