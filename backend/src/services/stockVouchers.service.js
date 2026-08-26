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
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

function validateHeader(payload) {
  if (!payload.voucher_date) throw ApiError.badRequest('voucher_date is required');
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
  }
}

async function resolveLines(payload) {
  validateHeader(payload);
  validateLines(payload.lines);

  if (payload.store_id) await storesService.getById(payload.store_id); // 404s if it doesn't exist

  const lines = [];
  for (const line of payload.lines) {
    await productColorsService.getById(line.variant_id); // 404s if it doesn't exist
    lines.push({
      variant_id: line.variant_id,
      cartons: Math.max(0, Math.trunc(Number(line.cartons) || 0)),
      pairs: Math.trunc(Number(line.pairs)),
    });
  }
  return lines;
}

function buildHeaderFields(payload) {
  return {
    voucher_date: payload.voucher_date,
    store_id: payload.store_id ?? null,
    remarks: payload.remarks ? payload.remarks.trim() : null,
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

// Always created DRAFT — post() is the only thing that writes stock_movements.
async function create(payload, userId) {
  const lines = await resolveLines(payload);
  const id = await withTransaction(async (transaction) => {
    const stockVoucherId = await repository.insert(transaction, { ...buildHeaderFields(payload), created_by: userId });
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
  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, stockVoucherId, buildHeaderFields(payload));
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

async function post(stockVoucherId, userId) {
  const sv = await getById(stockVoucherId);
  if (sv.status === 'CONFIRMED') {
    throw ApiError.conflict('Stock Voucher is already posted', 'ALREADY_POSTED');
  }
  // Defensive re-check: the lines were valid when saved, but re-validate before stock moves.
  validateLines(sv.lines);

  await withTransaction(async (transaction) => {
    await repository.insertStockMovements(transaction, {
      stockVoucherId, voucherDate: sv.voucher_date, lines: sv.lines, createdBy: userId,
    });
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
      // bill_no: null — PostAllResult's shared shape (frontend's api.ts) names it that way
      // regardless of document type, same as journalVouchers.service#postAll; stock vouchers have
      // no equivalent manual number, so the UI's own `f.bill_no || '#'+id` fallback just shows id.
      posted.push({ stock_voucher_id: stockVoucherId, bill_no: null, total_pairs: sv.total_pairs });
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
