// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/receipts.repository');
const chequesRepository = require('../repositories/cheques.repository');
const customersService = require('./customers.service');
const bankAccountsService = require('./bankAccounts.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

function validateHeader(payload) {
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.receipt_date) throw ApiError.badRequest('receipt_date is required');
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  if (payload.commission !== undefined && payload.commission < 0) {
    throw ApiError.badRequest('commission must be >= 0');
  }
  if (!['CASH', 'ONLINE', 'CHEQUE'].includes(payload.payment_mode)) {
    throw ApiError.badRequest("payment_mode must be 'CASH', 'ONLINE', or 'CHEQUE'");
  }
  if (payload.payment_mode === 'ONLINE' && !payload.bank_id) {
    throw ApiError.badRequest('bank_id is required for an ONLINE receipt');
  }
  if (payload.payment_mode === 'CHEQUE') {
    if (!payload.cheque_no) throw ApiError.badRequest('cheque_no is required for a CHEQUE receipt');
    if (!payload.cheque_date) throw ApiError.badRequest('cheque_date is required for a CHEQUE receipt');
  }
}

function buildFields(payload) {
  return {
    receipt_date: payload.receipt_date,
    customer_id: payload.customer_id,
    amount: payload.amount,
    commission: payload.commission || 0,
    payment_mode: payload.payment_mode,
    details: payload.details,
    bank_id: payload.payment_mode === 'ONLINE' ? payload.bank_id : null,
    remarks: payload.remarks,
  };
}

// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins) — same
// convention as saleBills.service.js/purchases.service.js#resolveDateRange. (Corrected: an earlier
// PROGRESS.md entry claimed this already existed here — it didn't; caught while adding the
// equivalent to expenses.service.js and checking for consistency.)
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
    customer_id: filters.customer_id,
    payment_mode: filters.payment_mode,
    status: filters.status,
    ...resolveDateRange(filters),
  });
}

async function getById(receiptId) {
  const receipt = await repository.findById(receiptId);
  if (!receipt) throw ApiError.notFound('Receipt not found');
  return receipt;
}

// Insert the receipt row (+ linked cheques row for CHEQUE mode) inside the CALLER's transaction —
// factored out of create() so draftReceipts.service.js#confirm() can share one transaction with
// postWithinTransaction() below instead of running create()+post() as two separate transactions
// (which left a real orphaned DRAFT receipt, and a duplicate-receipt risk on retry, if post()
// failed after create() had already committed — caught in debugger review).
async function insertReceipt(transaction, payload, userId) {
  const receiptId = await repository.insert(transaction, { ...buildFields(payload), created_by: userId });

  if (payload.payment_mode === 'CHEQUE') {
    const chequeId = await chequesRepository.insert(transaction, {
      receipt_id: receiptId,
      cheque_no: payload.cheque_no,
      cheque_date: payload.cheque_date,
      cheque_received_date: payload.cheque_received_date,
    });
    await repository.linkCheque(transaction, receiptId, chequeId);
  }

  return receiptId;
}

// Always created DRAFT — post() is the only thing that moves money, same shape as
// transfers/wage_runs/salary_runs. A CHEQUE-mode receipt also creates the linked cheques row here
// (PENDING) — the cheque physically exists once the customer hands it over, independent of
// whether this receipt has been posted to the ledger yet.
async function create(payload, userId) {
  validateHeader(payload);
  const id = await withTransaction((transaction) => insertReceipt(transaction, payload, userId));
  return getById(id);
}

// DRAFT-only — a CONFIRMED receipt is never edited in place (unpost first). Editing a CHEQUE
// receipt's cheque_no/cheque_date also updates the linked cheques row.
async function update(receiptId, payload, userId) {
  const existing = await getById(receiptId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the receipt before editing', 'POSTED_LOCK');
  }
  validateHeader(payload);

  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, receiptId, buildFields(payload));
    if (payload.payment_mode === 'CHEQUE' && existing.payment_mode === 'CHEQUE') {
      const cheque = await chequesRepository.findByReceiptId(receiptId);
      await chequesRepository.updateDetails(transaction, cheque.cheque_id, {
        cheque_no: payload.cheque_no,
        cheque_date: payload.cheque_date,
        cheque_received_date: payload.cheque_received_date,
      });
    } else if (payload.payment_mode === 'CHEQUE' && existing.payment_mode !== 'CHEQUE') {
      // Switched INTO cheque mode on edit — create the cheque row now, same as create().
      const chequeId = await chequesRepository.insert(transaction, {
        receipt_id: receiptId,
        cheque_no: payload.cheque_no,
        cheque_date: payload.cheque_date,
        cheque_received_date: payload.cheque_received_date,
      });
      await repository.linkCheque(transaction, receiptId, chequeId);
    } else if (payload.payment_mode !== 'CHEQUE' && existing.payment_mode === 'CHEQUE') {
      // Switched OUT of cheque mode — the old cheque never went anywhere (still DRAFT), safe to
      // drop it entirely: unlink first (breaks the circular FK), then delete the orphaned cheque.
      const cheque = await chequesRepository.findByReceiptId(receiptId);
      await repository.unlinkCheque(transaction, receiptId);
      await chequesRepository.deleteCheque(transaction, cheque.cheque_id);
    }
  });

  return getById(receiptId);
}

// DRAFT-only, hard DELETE — receipts is a transaction table, never soft-deleted. A cheque-mode
// receipt's linked cheques row is dropped too (the circular FK pair means receipts.cheque_id must
// be nulled out before the cheques row, then the cheques row, then this receipts row).
async function remove(receiptId) {
  const existing = await getById(receiptId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the receipt before deleting', 'POSTED_LOCK');
  }

  await withTransaction(async (transaction) => {
    if (existing.payment_mode === 'CHEQUE') {
      const cheque = await chequesRepository.findByReceiptId(receiptId);
      await repository.unlinkCheque(transaction, receiptId);
      await chequesRepository.deleteCheque(transaction, cheque.cheque_id);
    }
    await repository.remove(transaction, receiptId);
  });

  return { ok: true };
}

// Resolves which chart account / business account gets debited for a given payment_mode — the
// same lookup used both when posting a receipt and when reversing it on bounce/return, so a
// reversal always lands back exactly where the original posting came from.
async function resolveDebitSide(paymentMode, bankId) {
  if (paymentMode === 'CASH') {
    const cash = await chartAccountsRepository.findByCode(CODES.CASH_IN_HAND);
    if (!cash) throw new Error(`Reserved chart account CASH IN HAND (code ${CODES.CASH_IN_HAND}) not found — run npm run seed`);
    return { ac_id: cash.ac_id };
  }
  if (paymentMode === 'ONLINE') {
    const bank = await bankAccountsService.getById(bankId);
    if (!bank.ba_id) throw ApiError.conflict('Bank account has no linked ledger account yet', 'NO_BANK_ACCOUNT');
    return { ba_id: bank.ba_id };
  }
  // CHEQUE
  const cheques = await chartAccountsRepository.findByCode(CODES.CHEQUES_IN_HAND);
  if (!cheques) throw new Error(`Reserved chart account CHEQUES IN HAND (code ${CODES.CHEQUES_IN_HAND}) not found — run npm run seed`);
  return { ac_id: cheques.ac_id };
}

// Does the actual ledger-writing + status flip inside the CALLER's transaction — factored out of
// post() for the same reason as insertReceipt() above: draftReceipts.service.js#confirm() needs
// this in the SAME transaction as insertReceipt(), not a second one.
async function postWithinTransaction(transaction, receiptId, receipt) {
  const customer = await customersService.getById(receipt.customer_id);
  if (!customer.ba_id) {
    throw ApiError.conflict('Customer has no linked account yet — add one before posting', 'NO_CUSTOMER_ACCOUNT');
  }
  const debitSide = await resolveDebitSide(receipt.payment_mode, receipt.bank_id);

  const rows = [
    { entry_date: receipt.receipt_date, ...debitSide, debit: receipt.amount, credit: 0, source_type: 'RECEIPT', source_id: receiptId, narration: `Receipt #${receiptId}` },
    { entry_date: receipt.receipt_date, ba_id: customer.ba_id, debit: 0, credit: receipt.amount, source_type: 'RECEIPT', source_id: receiptId, narration: `Receipt #${receiptId}` },
  ];
  if (receipt.commission > 0) {
    const commissionAccount = await chartAccountsRepository.findByCode(CODES.COMMISSION_ALLOWED);
    if (!commissionAccount) throw new Error(`Reserved chart account COMMISSION ALLOWED (code ${CODES.COMMISSION_ALLOWED}) not found — run npm run seed`);
    rows.push(
      { entry_date: receipt.receipt_date, ac_id: commissionAccount.ac_id, debit: receipt.commission, credit: 0, source_type: 'COMMISSION', source_id: receiptId, narration: `Receipt #${receiptId} commission` },
      { entry_date: receipt.receipt_date, ba_id: customer.ba_id, debit: 0, credit: receipt.commission, source_type: 'COMMISSION', source_id: receiptId, narration: `Receipt #${receiptId} commission` },
    );
  }
  await repository.insertLedgerEntries(transaction, rows);
  await repository.setStatus(transaction, receiptId, 'CONFIRMED');
}

// Post: Dr <cash/bank/cheques-in-hand> / Cr customer BA for `amount`, plus a second Dr COMMISSION
// ALLOWED / Cr customer BA pair when commission > 0 — the sale bill itself is never touched
// (database_schema_v4.3.md §6/§7).
async function post(receiptId) {
  const receipt = await getById(receiptId);
  if (receipt.status === 'CONFIRMED') {
    throw ApiError.conflict('Receipt is already posted', 'ALREADY_POSTED');
  }

  await withTransaction((transaction) => postWithinTransaction(transaction, receiptId, receipt));

  return getById(receiptId);
}

// Blocked once the underlying cheque has moved past PENDING (deposited/endorsed/etc. — unposting
// at that point would leave cheque_allocations pointing at ledger rows that no longer exist).
async function unpost(receiptId) {
  const receipt = await getById(receiptId);
  if (receipt.status !== 'CONFIRMED') {
    throw ApiError.conflict('Receipt is not posted', 'NOT_POSTED');
  }
  if (receipt.payment_mode === 'CHEQUE' && receipt.cheque_status && receipt.cheque_status !== 'PENDING') {
    throw ApiError.conflict('This cheque has already been disposed of — reverse that first', 'CHEQUE_IN_USE');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, receiptId);
    await repository.setStatus(transaction, receiptId, 'DRAFT');
  });

  return getById(receiptId);
}

module.exports = {
  list, getById, create, update, remove, post, unpost, resolveDebitSide,
  insertReceipt, postWithinTransaction,
};
