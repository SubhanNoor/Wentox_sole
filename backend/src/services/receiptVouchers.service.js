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
const deletedNumbersRepository = require('../repositories/deletedDocumentNumbers.repository');
// Endorsed lines (migration 041) are dbo.settlements rows carrying this voucher's id — a line with
// `settlement_id` set. They post/unpost through the settlements service, which owns their ledger
// pair (Dr the endorsed account / Cr the payer, no cash/bank/cheque leg).
const settlementsService = require('./settlements.service');
const settlementsRepository = require('../repositories/settlements.repository');
const businessAccountsService = require('./businessAccounts.service');
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
//
// Endorsed lines count in total_amount (per the user, 2026-10-05) but in none of Cash/Cheque/Online:
// their payment_mode only says how the payer paid our creditor — that money never reached us.
function summariseLines(lines) {
  const received = lines.filter((l) => l.settlement_id == null);
  const sum = (mode) => received
    .filter((l) => l.payment_mode === mode)
    .reduce((acc, l) => acc + Number(l.amount), 0);
  return {
    total_cash: sum('CASH'),
    total_cheque: sum('CHEQUE'),
    total_online: sum('ONLINE'),
    total_endorsed: lines
      .filter((l) => l.settlement_id != null)
      .reduce((acc, l) => acc + Number(l.amount), 0),
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
    await settlementsRepository.syncVoucherDates(transaction, voucherId, payload.voucher_date);
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
    // Already a real, posted row — meets the caller's intent, same as the old ALREADY_POSTED skip.
    if (line.status === 'CONFIRMED') continue;
    if (line.settlement_id != null) {
      try {
        await settlementsService.post(line.settlement_id, userId, session);
        posted.push({ receipt_id: null, settlement_id: line.settlement_id, amount: Number(line.amount) });
      } catch (err) {
        if (err.code === 'ALREADY_POSTED') continue;
        if (!err.status) console.error(`receiptVouchers.post: unexpected failure on endorsement ${line.settlement_id}:`, err);
        failed.push({
          receipt_id: null,
          settlement_id: line.settlement_id,
          account_name: line.account_name,
          amount: Number(line.amount),
          message: err.status ? err.message : 'Unexpected error while posting this endorsement.',
          code: err.code || 'INTERNAL',
        });
      }
      continue;
    }
    // A DRAFT-status line with no draft_id to confirm() should never happen — every unposted line
    // is supposed to live in dbo.draft_receipts — but it did (found 2026-09-16, same bug as
    // expenseVouchers.service.js#post(): old data inserted straight into dbo.receipts with
    // status='DRAFT' by an unused legacy path, never migrated). The old check here (`if
    // (line.draft_id == null) continue`) treated that exact case as "already posted" and silently
    // skipped it — Post/Post All reported success while the line sat stuck unposted forever, with
    // no error and no trace. Report it as a real failure instead, so it is at least visible.
    if (line.draft_id == null) {
      failed.push({
        receipt_id: line.receipt_id,
        draft_id: null,
        account_name: line.account_name,
        amount: Number(line.amount),
        message: 'This entry has no draft row to post from — its data needs to be repaired before it can post.',
        code: 'ORPHANED_LINE',
      });
      continue;
    }
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
    if (line.settlement_id != null) {
      try {
        await settlementsService.unpost(line.settlement_id, session && session.userId, session);
        unposted.push({ receipt_id: null, settlement_id: line.settlement_id, amount: Number(line.amount) });
      } catch (err) {
        if (!err.status) console.error(`receiptVouchers.unpost: unexpected failure on endorsement ${line.settlement_id}:`, err);
        failed.push({
          receipt_id: null,
          settlement_id: line.settlement_id,
          account_name: line.account_name,
          amount: Number(line.amount),
          message: err.status ? err.message : 'Unexpected error while unposting this endorsement.',
          code: err.code || 'INTERNAL',
        });
      }
      continue;
    }
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
// Records the deleted voucher_no (migration 032's table) — retired for good: voucher_no comes from
// dbo.seq_receipt_voucher_no (migration 042), so it is never reused (2026-10-06). Only
// whole-voucher deletion touches voucher_no — deleting one line out of a multi-line voucher
// (draftReceipts.service.js#remove()/receipts.service.js#remove()) never reaches here.
async function remove(voucherId, userId) {
  const voucher = await getById(voucherId);
  if (voucher.status !== 'UNPOSTED') {
    throw ApiError.conflict('Unpost this voucher before deleting it', 'POSTED_LOCK');
  }

  await withTransaction(async (transaction) => {
    // Endorsed lines are DRAFT settlements here (the voucher is UNPOSTED), so no ledger rows.
    await settlementsRepository.removeByVoucher(transaction, voucherId);
    for (const line of voucher.lines) {
      if (line.settlement_id != null) continue;
      // An UNPOSTED voucher's lines are all drafts by the invariant; the real-row branch is kept
      // so this stays correct for any row that predates the draft/real split.
      if (line.draft_id != null) {
        await draftReceiptsRepository.deleteDraft(transaction, line.draft_id);
      } else {
        await receiptsRepository.remove(transaction, line.receipt_id);
      }
    }
    await repository.remove(transaction, voucherId);
    await deletedNumbersRepository.record(transaction, 'RECEIPT_VOUCHER', voucher.voucher_no, userId);
  });
}

// Saves a whole voucher — header and every line — in ONE transaction (per the user, 2026-11-11:
// the Receipts screen now works like the Journal Voucher one; Enter only adds a line on screen and
// Save/Done writes them all together, so a voucher is never left half-saved).
//
// payload: { voucher_id?, voucher_date, remarks, allow_duplicate_cheque?, lines: [...] }
// Each line is `kind: 'RECEIPT'` (draft_id when it already exists) or `kind: 'SETTLEMENT'` — an
// endorsed line (settlement_id when it already exists). `unchanged: true` on an existing line means
// "keep it as it is". An existing line left out of `lines` is deleted.
//
// Only while the voucher is entirely UNPOSTED, the same rule as update()/remove().
async function saveWithLines(payload, userId, session) {
  validateHeader(payload);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length === 0) throw ApiError.badRequest('Add at least one entry before saving', 'EMPTY_VOUCHER');

  let existing = null;
  if (payload.voucher_id) {
    existing = await getById(payload.voucher_id);
    if (existing.status !== 'UNPOSTED') {
      throw ApiError.conflict('Unpost this voucher before changing it', 'POSTED_LOCK');
    }
  }
  const existingDrafts = new Set((existing?.lines ?? []).filter((l) => l.draft_id != null).map((l) => l.draft_id));
  const existingSettlements = new Set((existing?.lines ?? []).filter((l) => l.settlement_id != null).map((l) => l.settlement_id));

  // Validate every line before writing anything, with the same rules a single line always had.
  const date = payload.voucher_date;
  const keptDrafts = new Set();
  const keptSettlements = new Set();
  const chequesInVoucher = new Set();
  const prepared = [];
  for (const [index, line] of lines.entries()) {
    const where = `Entry ${index + 1}: `;
    try {
      if (line.kind === 'SETTLEMENT') {
        const id = line.settlement_id ?? null;
        if (id != null && !existingSettlements.has(id)) throw ApiError.badRequest('this endorsed entry is not on this voucher');
        if (id != null) keptSettlements.add(id);
        if (id != null && line.unchanged) continue;
        const body = { ...line, settlement_date: date };
        await settlementsService.validate(body, session);
        prepared.push({ kind: 'SETTLEMENT', id, fields: settlementsService.buildFields(body) });
      } else {
        const id = line.draft_id ?? null;
        if (id != null && !existingDrafts.has(id)) throw ApiError.badRequest('this entry is not on this voucher');
        if (id != null) keptDrafts.add(id);
        const body = { ...line, receipt_date: date, allow_duplicate_cheque: payload.allow_duplicate_cheque };
        // The same paper cheque twice on this one voucher is caught here, since none of it is saved
        // yet for the database check below to find.
        if (body.payment_mode === 'CHEQUE' && body.cheque_no && !payload.allow_duplicate_cheque) {
          const key = `${body.ba_id}|${String(body.cheque_no).trim().toUpperCase()}`;
          if (chequesInVoucher.has(key)) {
            throw ApiError.conflict(
              `Cheque ${String(body.cheque_no).trim()} from this party is entered twice on this voucher. Save again only if these are different cheques.`,
              'DUPLICATE_CHEQUE',
            );
          }
          chequesInVoucher.add(key);
        }
        if (id != null && line.unchanged) continue;
        draftReceiptsService.validateHeader(body);
        await receiptsService.assertNotDuplicateCheque(body, { excludeDraftId: id });
        await businessAccountsService.assertAccessible(body.ba_id, session);
        prepared.push({ kind: 'RECEIPT', id, fields: draftReceiptsService.buildFields(body) });
      }
    } catch (err) {
      if (err instanceof ApiError) err.message = where + err.message;
      throw err;
    }
  }

  const voucherId = await withTransaction(async (transaction) => {
    let id = existing?.voucher_id;
    if (id == null) {
      const voucherNo = await repository.nextVoucherNo(transaction);
      id = await repository.insert(transaction, {
        voucher_no: voucherNo, voucher_date: date, remarks: payload.remarks, created_by: userId,
      });
    } else {
      await repository.updateHeader(transaction, id, { voucher_date: date, remarks: payload.remarks, updated_by: userId });
      await draftReceiptsRepository.syncVoucherLineDates(transaction, id, date);
      await settlementsRepository.syncVoucherDates(transaction, id, date);
    }
    // Lines taken off the voucher on screen.
    for (const draftId of existingDrafts) {
      if (!keptDrafts.has(draftId)) await draftReceiptsRepository.deleteDraft(transaction, draftId);
    }
    for (const settlementId of existingSettlements) {
      if (!keptSettlements.has(settlementId)) await settlementsRepository.remove(settlementId, transaction);
    }
    // Changed and new lines, in screen order — a new line's place in the voucher is its insert order.
    for (const line of prepared) {
      if (line.kind === 'SETTLEMENT') {
        if (line.id != null) await settlementsRepository.update(line.id, line.fields, transaction);
        else await settlementsRepository.insert(transaction, { ...line.fields, created_by: userId, voucher_id: id });
      } else if (line.id != null) {
        await draftReceiptsRepository.updateHeader(transaction, line.id, line.fields);
      } else {
        await draftReceiptsRepository.insert(transaction, { ...line.fields, voucher_id: id, created_by: userId });
      }
    }
    return id;
  });

  return getById(voucherId);
}

// Every retired voucher_no — the screen's number preview skips past them.
function listDeletedNumbers() {
  return deletedNumbersRepository.listByType('RECEIPT_VOUCHER');
}

module.exports = {
  list, getById, create, update, saveWithLines, post, unpost, remove, deriveStatus, listDeletedNumbers,
};
