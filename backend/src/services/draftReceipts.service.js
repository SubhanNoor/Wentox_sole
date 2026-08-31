// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftReceipts.repository');
const receiptsService = require('./receipts.service');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

// Every UNPOSTED receipt lives here now, so all three payment modes are accepted — the old
// CASH/ONLINE-only restriction is gone, because migration 024 gave draft_receipts its own
// cheque_no/cheque_date/cheque_received_date columns. A CHEQUE draft holds those details directly;
// the real dbo.cheques row is created at confirm() time by receipts.service#insertReceipt(), the
// same code path that always created it (cheques.receipt_id is NOT NULL, so the cheques row simply
// cannot exist before the receipt does — which is what forced the old restriction).
//
// These are the same rules as receipts.service.js#validateHeader — deliberately identical, since
// this is now the path every new receipt takes.
function validateHeader(payload) {
  if (!payload.ba_id) throw ApiError.badRequest('ba_id is required');
  if (!payload.receipt_date) throw ApiError.badRequest('receipt_date is required');
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  if (payload.commission !== undefined && payload.commission < 0) {
    throw ApiError.badRequest('commission must be >= 0');
  }
  if (!['CASH', 'ONLINE', 'CHEQUE'].includes(payload.payment_mode)) {
    throw ApiError.badRequest("payment_mode must be 'CASH', 'ONLINE', or 'CHEQUE'");
  }
  // ONLINE names EITHER a bank OR any business account (online_ba_id, migration 028) — same rule
  // as receipts.service.js, kept in step so a draft can never hold something confirm() rejects.
  if (payload.payment_mode === 'ONLINE' && !payload.bank_id && !payload.online_ba_id) {
    throw ApiError.badRequest('An ONLINE receipt needs an account — pass bank_id or online_ba_id');
  }
  if (payload.bank_id && payload.online_ba_id) {
    throw ApiError.badRequest('Pass either bank_id or online_ba_id for an ONLINE receipt, not both');
  }
  if (payload.payment_mode === 'CHEQUE') {
    if (!payload.cheque_no) throw ApiError.badRequest('cheque_no is required for a CHEQUE receipt');
    if (!payload.cheque_date) throw ApiError.badRequest('cheque_date is required for a CHEQUE receipt');
  }
}

function buildFields(payload) {
  return {
    receipt_date: payload.receipt_date,
    ba_id: payload.ba_id,
    amount: payload.amount,
    commission: payload.commission || 0,
    payment_mode: payload.payment_mode,
    details: payload.details,
    bank_id: payload.payment_mode === 'ONLINE' ? (payload.bank_id ?? null) : null,
    online_ba_id: payload.payment_mode === 'ONLINE' ? (payload.online_ba_id ?? null) : null,
    remarks: payload.remarks,
    cheque_no: payload.payment_mode === 'CHEQUE' ? payload.cheque_no : null,
    cheque_date: payload.payment_mode === 'CHEQUE' ? payload.cheque_date : null,
    cheque_received_date: payload.payment_mode === 'CHEQUE' ? payload.cheque_received_date : null,
  };
}

// UC-03 point 4 — receiving money INTO a restricted account is the same exposure as paying out of
// one. The guard lives here now as well as on receipts:create, because this is the channel a new
// receipt actually comes in through.
async function create(payload, userId, session) {
  validateHeader(payload);
  await businessAccountsService.assertAccessible(payload.ba_id, session);

  const draftId = await withTransaction((transaction) => repository.insert(transaction, {
    ...buildFields(payload),
    // RJ-03: the voucher this line belongs to, if it was entered on one.
    voucher_id: payload.voucher_id,
    created_by: userId,
  }));
  return getById(draftId);
}

// Editing an unposted receipt — the normal edit path now. Mirrors receipts.service.js#update()'s
// rules, minus the POSTED_LOCK check: a draft is unposted by definition, so there is nothing to
// lock. No cheques row exists yet either, so the whole create/update/delete-the-cheque-row dance
// update() had to do collapses into writing three plain columns.
async function update(draftId, payload, userId, session) {
  await getById(draftId);
  validateHeader(payload);
  await businessAccountsService.assertAccessible(payload.ba_id, session);

  await withTransaction((transaction) => repository.updateHeader(transaction, draftId, buildFields(payload)));
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
// post() (e.g. a missing chart account) after create() had
// already committed left an orphaned DRAFT receipt AND the draft itself still present, so retrying
// confirm() on the same draft would call create() a second time and produce a duplicate real
// receipt. One shared transaction removes that gap entirely — either everything commits, or
// nothing does, and the draft is never left half-confirmed.
//
// insertReceipt() creates the dbo.cheques row for a CHEQUE receipt exactly as it always has — the
// draft's cheque_no/cheque_date/cheque_received_date are simply handed to it as the payload, so
// the cheque is born PENDING at post time and every downstream deposit/endorse/bounce path sees
// precisely what it saw before.
async function confirm(draftId, userId, session) {
  const draft = await getById(draftId);
  if (session) await businessAccountsService.assertAccessible(draft.ba_id, session);

  // A draft is not protected by dbo.receipts' CHECK constraints while it sits in draft_receipts,
  // so re-validate the shape BEFORE trying to post it. Without this the INSERT is what fails, and
  // a raw "The INSERT statement conflicted with the CHECK constraint CK_receipts_bank" is not an
  // ApiError — wrap.js sanitizes it to "Unexpected error while posting this entry", which tells
  // the user nothing about what to fix (reported 2026-08-31 on a receipt whose ONLINE account had
  // been dropped by the unpost round-trip, since fixed in receipts.service.js#unconfirm).
  if (draft.payment_mode === 'ONLINE' && !draft.bank_id && !draft.online_ba_id) {
    throw ApiError.badRequest(
      'This ONLINE entry names no account to receive the money. Open it, pick the account under "Received Into", save, then post.',
    );
  }

  const payload = {
    receipt_date: draft.receipt_date,
    ba_id: draft.ba_id,
    amount: draft.amount,
    commission: draft.commission,
    payment_mode: draft.payment_mode,
    details: draft.details,
    bank_id: draft.bank_id,
    online_ba_id: draft.online_ba_id,
    remarks: draft.remarks,
    cheque_no: draft.cheque_no,
    cheque_date: draft.cheque_date,
    cheque_received_date: draft.cheque_received_date,
    // RJ-03: the posted line stays on the voucher it was entered on, and keeps its place in that
    // voucher's entry order.
    voucher_id: draft.voucher_id,
    created_at: draft.created_at,
  };

  const receiptId = await withTransaction(async (transaction) => {
    const id = await receiptsService.insertReceipt(transaction, payload, userId);
    await receiptsService.postWithinTransaction(transaction, id, payload);
    await repository.deleteDraft(transaction, draftId);
    return id;
  });

  return receiptsService.getById(receiptId);
}

module.exports = { create, getById, list, update, remove, confirm };
