// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
//
// Stock Voucher — a manual "add stock" document (legacy Journal Entry-style bound-record screen,
// per the user 2026-08-26): N lines, each a finished-goods variant + cartons/pairs, under one
// Date/Store/Remarks header. Replaces the old inline "+ Add Stock" flow on the Current Stock
// report, which recorded every manual addition AS production (stock:log-production) — this is its
// own document type instead, same architecture as Journal Voucher: DRAFT by default, status flips
// to CONFIRMED only on post(), which is the only thing that writes stock_movements.
const repository = require('../repositories/stockVouchers.repository');
const productColorsService = require('./productColors.service');
const storesService = require('./stores.service');
const businessAccountsService = require('./businessAccounts.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

function validateHeader(payload) {
  if (!payload.voucher_date) throw ApiError.badRequest('voucher_date is required');
  if (payload.delivery_type && payload.delivery_type !== 'SAME' && payload.delivery_type !== 'CUSTOM') {
    throw ApiError.badRequest("delivery_type must be 'SAME' or 'CUSTOM'");
  }
  if (payload.delivery_type === 'CUSTOM' && (!payload.delivery_address || !payload.delivery_address.trim())) {
    throw ApiError.badRequest('delivery_address is required for Custom delivery');
  }
}

// Bill No./Bilty No./IGP No. — optional whole numbers, per the user (2026-08-30): fillable at or
// after save time, same convention as Sale Bill's own gp_no/bilty_no.
function normalizeRefNo(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw ApiError.badRequest(`${label} must be a whole number`);
  return n;
}

// Stock Voucher's fixed ledger head (reservedAccounts.js#STOCK_TRANSFER) — resolved by code, same
// pattern as journalVouchers.service.js#getCounterAccount / deposits.service.js's own MISC_ADJUSTMENTS
// lookup. Always has exactly one business account beneath it (db/seeds/run.js).
async function getStockTransferAccount() {
  const chartAccount = await chartAccountsRepository.findByCode(CODES.STOCK_TRANSFER);
  if (!chartAccount) throw new Error(`Reserved chart account STOCK TRANSFER (code ${CODES.STOCK_TRANSFER}) not found — run npm run seed`);
  const account = await businessAccountsService.getByAcId(chartAccount.ac_id);
  if (!account) throw new Error('STOCK TRANSFER business account not found — run npm run seed');
  return account;
}

// On Account — user-picked, editable; defaults to the STOCK TRANSFER account itself when omitted
// (matching the reference screen's own On Account/Main A/C both showing the same code). Main A/C
// is never typed — it's a snapshot of the picked account's own parent chart account, same pattern
// as dbo.sale_bills.main_ac_id snapshotting the customer's.
async function resolveOnAccount(payload) {
  if (payload.on_account_ba_id) {
    const account = await businessAccountsService.getById(payload.on_account_ba_id); // 404s if it doesn't exist
    return { on_account_ba_id: account.ba_id, main_ac_id: account.ac_id };
  }
  const stockTransfer = await getStockTransferAccount();
  return { on_account_ba_id: stockTransfer.ba_id, main_ac_id: stockTransfer.ac_id };
}

function validateLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length < 1) {
    throw ApiError.badRequest('A Stock Voucher needs at least 1 line');
  }
  for (const line of rawLines) {
    if (!line.variant_id) throw ApiError.badRequest('Each line must have an article/color');
    const cartons = Number(line.cartons) || 0;
    const pairs = Number(line.pairs) || 0;
    if (cartons < 0) throw ApiError.badRequest('Cartons cannot be negative');
    if (pairs <= 0) throw ApiError.badRequest('Each line must have pairs > 0');
    const rate = Number(line.rate) || 0;
    const discountPct = Number(line.discount_pct) || 0;
    if (rate <= 0) throw ApiError.badRequest('Rate must be entered');
    if (discountPct < 0 || discountPct > 100) throw ApiError.badRequest('D% must be between 0 and 100');
  }
}

// Money math, never trusted from the client — recomputed here from rate/pairs/discount_pct alone,
// same convention as every other priced line in this app (e.g. SaleBillPage's own line totals).
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function computeValuation(rate, pairs, discountPct) {
  const gross = round2(rate * pairs);
  const discountValue = round2(gross * discountPct / 100);
  const value = round2(gross - discountValue);
  return { discount_value: discountValue, value };
}

async function resolveLines(payload) {
  validateLines(payload.lines);

  if (payload.store_id) await storesService.getById(payload.store_id); // 404s if it doesn't exist

  const lines = [];
  for (const line of payload.lines) {
    await productColorsService.getById(line.variant_id); // 404s if it doesn't exist
    const cartons = Math.max(0, Math.trunc(Number(line.cartons) || 0));
    const pairs = Math.trunc(Number(line.pairs));
    const rate = round2(Number(line.rate) || 0);
    const discountPct = round2(Number(line.discount_pct) || 0);
    const { discount_value, value } = computeValuation(rate, pairs, discountPct);
    lines.push({
      variant_id: line.variant_id,
      cartons,
      pairs,
      rate,
      discount_pct: discountPct,
      discount_value,
      value,
    });
  }
  return lines;
}

async function buildHeaderFields(payload) {
  validateHeader(payload);
  const { on_account_ba_id, main_ac_id } = await resolveOnAccount(payload);
  return {
    voucher_date: payload.voucher_date,
    store_id: payload.store_id ?? null,
    remarks: payload.remarks ? payload.remarks.trim() : null,
    bill_no: normalizeRefNo(payload.bill_no, 'Bill No.'),
    bilty_no: normalizeRefNo(payload.bilty_no, 'Bilty No.'),
    igp_no: normalizeRefNo(payload.igp_no, 'IGP No.'),
    delivery_type: payload.delivery_type === 'CUSTOM' ? 'CUSTOM' : 'SAME',
    delivery_address: payload.delivery_type === 'CUSTOM' ? payload.delivery_address.trim() : null,
    on_account_ba_id,
    main_ac_id,
  };
}

function list(filters = {}) {
  return repository.list(filters);
}

async function getById(stockVoucherId) {
  const sv = await repository.findById(stockVoucherId);
  if (!sv) throw ApiError.notFound('Stock Voucher not found');
  return sv;
}

// Always created DRAFT — post() is the only thing that writes stock_movements/ledger_entries.
async function create(payload, userId) {
  const lines = await resolveLines(payload);
  const header = await buildHeaderFields(payload);
  const id = await withTransaction(async (transaction) => {
    const stockVoucherId = await repository.insert(transaction, { ...header, created_by: userId });
    await repository.insertLines(transaction, stockVoucherId, lines);
    return stockVoucherId;
  });
  return getById(id);
}

// Financial/stock edits only while DRAFT — unpost first, same rule as every other posted document.
async function update(stockVoucherId, payload) {
  const existing = await getById(stockVoucherId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the Stock Voucher before editing', 'POSTED_LOCK');
  }
  const lines = await resolveLines(payload);
  const header = await buildHeaderFields(payload);
  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, stockVoucherId, header);
    await repository.deleteLines(transaction, stockVoucherId);
    await repository.insertLines(transaction, stockVoucherId, lines);
  });
  return getById(stockVoucherId);
}

// DRAFT-only hard delete — stock_vouchers is a transaction table, never soft-deleted.
async function remove(stockVoucherId) {
  const existing = await getById(stockVoucherId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the Stock Voucher before deleting', 'POSTED_LOCK');
  }
  await repository.remove(stockVoucherId);
  return { ok: true };
}

// Dr STOCK TRANSFER (fixed) / Cr on_account_ba_id, for the voucher's total line value — see
// getStockTransferAccount()/resolveOnAccount() above. Skipped when total_value is 0 (an all-zero-
// rate voucher, e.g. a pure quantity adjustment, has nothing to post financially).
async function post(stockVoucherId, userId) {
  const sv = await getById(stockVoucherId);
  if (sv.status === 'CONFIRMED') {
    throw ApiError.conflict('Stock Voucher is already posted', 'ALREADY_POSTED');
  }
  // Defensive re-check: the lines were valid when saved, but re-validate before stock moves.
  validateLines(sv.lines);

  const totalValue = round2(Number(sv.total_value) || 0);

  await withTransaction(async (transaction) => {
    await repository.insertStockMovements(transaction, {
      stockVoucherId, voucherDate: sv.voucher_date, lines: sv.lines, createdBy: userId,
    });
    if (totalValue > 0) {
      const stockTransfer = await getStockTransferAccount();
      const onAccountBaId = sv.on_account_ba_id || stockTransfer.ba_id;
      const narration = `Stock Voucher #${stockVoucherId}`;
      await repository.insertLedgerEntries(transaction, [
        { entry_date: sv.voucher_date, ba_id: stockTransfer.ba_id, debit: totalValue, credit: 0, source_type: 'STOCK_VOUCHER', source_id: stockVoucherId, narration },
        { entry_date: sv.voucher_date, ba_id: onAccountBaId, debit: 0, credit: totalValue, source_type: 'STOCK_VOUCHER', source_id: stockVoucherId, narration },
      ]);
    }
    await repository.setStatus(transaction, stockVoucherId, 'CONFIRMED', userId);
  });

  return getById(stockVoucherId);
}

async function unpost(stockVoucherId, userId) {
  const sv = await getById(stockVoucherId);
  if (sv.status !== 'CONFIRMED') {
    throw ApiError.conflict('Stock Voucher is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteStockMovements(transaction, stockVoucherId);
    await repository.deleteLedgerEntries(transaction, stockVoucherId);
    await repository.setStatus(transaction, stockVoucherId, 'DRAFT', userId);
  });

  return getById(stockVoucherId);
}

// Every stock voucher still awaiting posting, for the Post All confirmation list.
function listUnposted() {
  return repository.listUnposted();
}

// Post a run of stock vouchers in one action. Each posts in its own transaction (via post()
// above), so one failure never rolls back the ones that already posted — mirrors
// journalVouchers.service#postAll exactly. Sequential, not parallel: posting reads live state,
// so concurrent posts on the same run could race each other.
async function postAll(ids, userId) {
  const targets = Array.isArray(ids) && ids.length
    ? ids.map((id) => ({ stock_voucher_id: id }))
    : await repository.listUnposted();

  const posted = [];
  const failed = [];

  for (const target of targets) {
    const stockVoucherId = target.stock_voucher_id;
    try {
      const sv = await post(stockVoucherId, userId);
      posted.push({ stock_voucher_id: stockVoucherId, bill_no: sv.bill_no ?? null, total_pairs: sv.total_pairs });
    } catch (err) {
      // Already posted by someone else meets the user's intent — not reported as a failure.
      if (err.code === 'ALREADY_POSTED') continue;
      if (!err.status) console.error(`postAll: unexpected failure on stock voucher ${stockVoucherId}:`, err);
      failed.push({
        stock_voucher_id: stockVoucherId,
        bill_no: null,
        message: err.status ? err.message : 'Unexpected error while posting this stock voucher.',
        code: err.code || 'INTERNAL',
      });
    }
  }

  return { posted, failed, attempted: targets.length };
}

module.exports = { list, getById, create, update, remove, post, unpost, listUnposted, postAll };
