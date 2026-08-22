// Business logic for receipt vouchers (RJ-03).
//
// A voucher is a header (date, C.Book No, remarks) over many entry lines, each line naming its own
// account — a day's takings entered at the end of the day, from whoever paid. The lines themselves
// are ordinary dbo.receipts rows and are created/edited/posted by receipts.service; this file owns
// only the header and the operations that act on the whole voucher.
const repository = require('../repositories/receiptVouchers.repository');
const receiptsRepository = require('../repositories/receipts.repository');
const receiptsService = require('./receipts.service');
// A voucher's lines are split across two tables now: unposted ones in dbo.draft_receipts, posted
// ones in dbo.receipts. Posting a line is draftReceipts.confirm() (draft -> real), unposting it is
// receipts.unconfirm() (real -> draft); the per-line isolation and reporting below are unchanged.
const draftReceiptsService = require('./draftReceipts.service');
const draftReceiptsRepository = require('../repositories/draftReceipts.repository');
const { withTransaction } = require('../db/pool');
const ApiError = require('../errors/ApiError');
const { today } = require('../utils/dates');

// RJ-03: the header has no stored status — posting is per line and a voucher can legitimately sit
// half-posted, so a stored column would be a second source of truth that goes wrong the moment
// that happens (see migration 022). This is the single definition, derived from the lines.
//
// An empty voucher reads UNPOSTED rather than POSTED: "every line is confirmed" is vacuously true
// of no lines, which would otherwise label a brand-new empty voucher as posted.
function deriveStatus({ line_count, confirmed_lines }) {
  const lines = Number(line_count) || 0;
  const confirmed = Number(confirmed_lines) || 0;
  if (lines === 0 || confirmed === 0) return 'UNPOSTED';
  if (confirmed === lines) return 'POSTED';
  return 'PARTIAL';
}

// Totals per payment mode, for the Total Cash / Cheque / Online footer on the client's screen.
// Computed from the lines rather than read from the header — nothing is denormalised onto the
// voucher, so there is no figure that can drift out of step with its lines.
function summariseLines(lines) {
  const sum = (mode) => lines
    .filter((l) => l.payment_mode === mode)
    .reduce((acc, l) => acc + Number(l.amount), 0);
  return {
    total_cash: sum('CASH'),
    total_cheque: sum('CHEQUE'),
    total_online: sum('ONLINE'),
    total_amount: lines.reduce((acc, l) => acc + Number(l.amount), 0),
  };
}

function validateHeader(payload) {
  if (!payload.voucher_date) throw ApiError.badRequest('Voucher date is required');
}

async function getById(voucherId) {
  const voucher = await repository.findById(voucherId);
  if (!voucher) throw ApiError.notFound('Receipt voucher not found');
  const lines = await repository.listLines(voucherId);
  return {
    ...voucher,
    lines,
    ...summariseLines(lines),
    status: deriveStatus({
      line_count: lines.length,
      confirmed_lines: lines.filter((l) => l.status === 'CONFIRMED').length,
    }),
  };
}

async function list(filters = {}) {
  const rows = await repository.list(filters);
  return rows.map((row) => ({ ...row, status: deriveStatus(row) }));
}

// A voucher opens empty and lines are added to it one at a time (the client's "Done" button), so
// create() takes only the header. voucher_no is allocated inside the same transaction as the
// insert that consumes it.
async function create(payload, userId) {
  validateHeader(payload);
  const voucherId = await withTransaction(async (transaction) => {
    const voucherNo = await repository.nextVoucherNo(transaction);
    return repository.insert(transaction, {
      voucher_no: voucherNo,
      voucher_date: payload.voucher_date || today(),
      remarks: payload.remarks,
      created_by: userId,
    });
  });
  return getById(voucherId);
}

// Header edits only. The date is pushed down onto every line in the same transaction — see
// repository.syncLineDates for why the per-line date still exists.
//
// Blocked once anything is posted: a posted line has ledger_entries stamped with its date, and
// moving the header's date would leave the ledger disagreeing with the document. Unpost first.
async function update(voucherId, payload, userId) {
  const existing = await getById(voucherId);
  if (existing.status !== 'UNPOSTED') {
    throw ApiError.conflict(
      'Unpost this voucher before changing its date or remarks',
      'POSTED_LOCK',
    );
  }
  validateHeader(payload);

  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, voucherId, {
      voucher_date: payload.voucher_date,
      remarks: payload.remarks,
      updated_by: userId,
    });
    await repository.syncLineDates(transaction, voucherId, payload.voucher_date);
    // The unposted half of the voucher's lines lives in dbo.draft_receipts and has to move with
    // the header too — update() is only reachable while the voucher is entirely UNPOSTED, so in
    // practice this is the call that does the work and syncLineDates above is the no-op.
    await draftReceiptsRepository.syncVoucherLineDates(transaction, voucherId, payload.voucher_date);
  });

  return getById(voucherId);
}

// RJ-03: post the whole voucher.
//
// **Each line keeps its own transaction** (receiptsService.post wraps one) rather than the voucher
// sharing a single one — decided explicitly with the client: one line that cannot post must not
// roll back the lines that already did. So this RESOLVES with a per-line breakdown instead of
// throwing on the first failure. Callers must read `failed`; a resolved call does NOT mean the
// whole voucher posted. This is why the header has no stored status: the honest answer afterwards
// may be PARTIAL.
//
// Sequential, not Promise.all: posting reads and writes live ledger/cheque state, and two lines
// against the same account posting concurrently would interleave those reads.
async function post(voucherId, userId, session) {
  const voucher = await getById(voucherId);
  if (voucher.lines.length === 0) {
    throw ApiError.badRequest('This voucher has no entries to post', 'EMPTY_VOUCHER');
  }

  const posted = [];
  const failed = [];

  for (const line of voucher.lines) {
    // Already a real (posted) row — meets the caller's intent, same as the old ALREADY_POSTED skip.
    if (line.draft_id == null) continue;
    try {
      const receipt = await draftReceiptsService.confirm(line.draft_id, userId, session);
      posted.push({ receipt_id: receipt.receipt_id, draft_id: line.draft_id, amount: Number(line.amount) });
    } catch (err) {
      if (err.code === 'ALREADY_POSTED') continue;
      if (!err.status) console.error(`receiptVouchers.post: unexpected failure on line ${line.draft_id}:`, err);
      failed.push({
        receipt_id: null,
        draft_id: line.draft_id,
        account_name: line.account_name,
        amount: Number(line.amount),
        message: err.status ? err.message : 'Unexpected error while posting this entry.',
        code: err.code || 'INTERNAL',
      });
    }
  }

  return { voucher: await getById(voucherId), posted, failed, attempted: voucher.lines.length };
}

// Reverses the whole voucher, line by line, with the same per-line isolation and reporting as
// post(). A line that refuses to unpost (a cheque already deposited or endorsed, say) is reported
// and leaves the rest reversed — the voucher then reads PARTIAL, which is the truth.
async function unpost(voucherId, session) {
  const voucher = await getById(voucherId);

  const unposted = [];
  const failed = [];

  for (const line of voucher.lines) {
    if (line.status !== 'CONFIRMED') continue;
    try {
      await receiptsService.unconfirm(line.receipt_id, session);
      unposted.push({ receipt_id: line.receipt_id, amount: Number(line.amount) });
    } catch (err) {
      if (!err.status) console.error(`receiptVouchers.unpost: unexpected failure on line ${line.receipt_id}:`, err);
      failed.push({
        receipt_id: line.receipt_id,
        account_name: line.account_name,
        amount: Number(line.amount),
        message: err.status ? err.message : 'Unexpected error while unposting this entry.',
        code: err.code || 'INTERNAL',
      });
    }
  }

  return { voucher: await getById(voucherId), unposted, failed };
}

// Only an entirely unposted voucher can be deleted, and its lines go with it — a posted line has
// ledger entries, so deleting it here would strand them. The lines are removed through
// receipts.repository so there is one definition of how a receipt row is deleted; the FK on
// receipts.voucher_id is deliberately NOT ON DELETE CASCADE, because a cascade would silently
// delete posted lines too.
async function remove(voucherId) {
  const voucher = await getById(voucherId);
  if (voucher.status !== 'UNPOSTED') {
    throw ApiError.conflict('Unpost this voucher before deleting it', 'POSTED_LOCK');
  }

  await withTransaction(async (transaction) => {
    for (const line of voucher.lines) {
      // An UNPOSTED voucher's lines are all drafts by the invariant; the real-row branch is kept
      // so this stays correct for any row that predates the draft/real split.
      if (line.draft_id != null) {
        await draftReceiptsRepository.deleteDraft(transaction, line.draft_id);
      } else {
        await receiptsRepository.remove(transaction, line.receipt_id);
      }
    }
    await repository.remove(transaction, voucherId);
  });
}

module.exports = {
  list, getById, create, update, post, unpost, remove, deriveStatus,
};
