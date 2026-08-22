// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/saleBills.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const customersService = require('./customers.service');
const stockService = require('./stock.service');
const productColorsService = require('./productColors.service');
const productsService = require('./products.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const {
  buildLine, buildTotals, validateItems, checkKnownVariants, validateDeliveryCustomer,
} = require('./saleBillMath');
const CODES = require('../constants/reservedAccounts');
const { toISODate } = require('../utils/dates');
// Repository, not service: draftSaleBills.service.js already requires this service (its own
// confirm() calls insertConfirmed()/postLedgerAndStock() below), so requiring draftSaleBills's
// SERVICE back here would be circular. Going one layer down to its repository for the plain
// insert/stock-movement helpers unconfirm() needs avoids that without any business logic crossing
// the boundary the wrong way.
const draftSaleBillsRepository = require('../repositories/draftSaleBills.repository');

// bilty_no/gp_no/adda_id are all optional at save time — dispatch details are often not known yet
// when the bill is written up, and get filled in later via updateBiltyInfo() below (which still
// requires both bilty_no and adda_id — that flow's whole purpose is setting them) once the goods
// actually ship. bill_no stays required (unaffected by this).
function validateHeader(payload) {
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.bill_no) throw ApiError.badRequest('bill_no is required');
  validateDeliveryCustomer(payload);
}

// Shared line/total resolution for create() and update() — validates items, looks up packing,
// builds lines + rolled-up totals. Header fields are assembled separately since create() needs
// status/created_by and update() doesn't touch either.
async function resolveLinesAndTotals(payload) {
  validateItems(payload.items);
  validateHeader(payload);

  const variantIds = [...new Set(payload.items.map((item) => item.variant_id))];
  const packings = await repository.getVariantPackings(variantIds);
  checkKnownVariants(variantIds, packings);

  const lines = payload.items.map((item) => buildLine(item, packings.get(item.variant_id)));
  const totals = buildTotals(lines, payload.invoice_discount);
  return { lines, totals };
}

function buildBillFields(payload, totals) {
  return {
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
    due_date: payload.due_date || null,
  };
}

// Never deduct stock below zero. Mirrors draftSaleBills.service's assertStockAvailable — a saved
// (unposted) bill now reserves stock the same way a draft does, so both go through the same check.
// Requested pairs are summed per variant first since the same article/color can appear on more
// than one line (SB-02).
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

function saleStockMovements(billId, billDate, lines, sign) {
  return lines.map((line) => ({
    variant_id: line.variant_id,
    movement_type: 'ADJUSTMENT',
    qty_pairs: sign * line.pairs,
    movement_date: billDate,
    source_type: 'SALE_BILL',
    source_id: billId,
  }));
}

// Saving a bill deducts stock immediately (same reserve-on-save model as draft_sale_bills) — a
// negative ADJUSTMENT movement per item, no ledger entry yet. Posting later only writes the
// ledger; unposting only removes it. Stock stays reserved for as long as the bill exists,
// regardless of posted status.
async function create(payload, userId) {
  const { lines, totals } = await resolveLinesAndTotals(payload);
  const bill = { ...buildBillFields(payload, totals), created_by: userId };
  await assertStockAvailable(lines);

  const billId = await withTransaction(async (transaction) => {
    const id = await repository.insert(transaction, bill);
    await repository.insertItems(transaction, id, lines);
    await repository.insertStockMovements(transaction, saleStockMovements(id, bill.bill_date, lines, -1));
    return id;
  });

  return repository.findById(billId);
}

// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins).
function resolveDateRange(filters) {
  if (filters.date_from || filters.date_to) {
    return { date_from: filters.date_from, date_to: filters.date_to };
  }
  const today = new Date();
  if (filters.range === 'weekly') {
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    return { date_from: toISODate(from), date_to: toISODate(today) };
  }
  if (filters.range === 'monthly') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { date_from: toISODate(from), date_to: toISODate(today) };
  }
  return {}; // 'overall' or unspecified — no date filter
}

function list(filters = {}) {
  return repository.list({
    customer_id: filters.customer_id,
    sub_customer_id: filters.sub_customer_id,
    bill_no: filters.bill_no,
    ...resolveDateRange(filters),
  });
}

// Stock is reserved from SAVE, not from posting (see create()), so an edit's new lines are
// checked against what's on hand PLUS whatever this same bill already has reserved — otherwise
// editing a bill's own quantities without changing the total would wrongly look like an
// oversell. Must run before the transaction: pairsOnHand() reads through the pool's own
// connection, not the transaction's, so it can't see this bill's stock rows once they're deleted
// inside one (they'd still be locked/uncommitted) — same reason draftSaleBills.service checks
// before opening its transaction.
async function assertStockAvailableForEdit(existingItems, newLines) {
  const alreadyReserved = new Map();
  for (const item of existingItems) {
    alreadyReserved.set(item.variant_id, (alreadyReserved.get(item.variant_id) || 0) + item.pairs);
  }
  const requestedByVariant = new Map();
  for (const line of newLines) {
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
}

// Editing a bill always reconciles stock (reserved at save, independent of posted status): the
// old lines' reservation is released and the new lines' reservation is written in the same
// transaction. Ledger only exists once posted, so that half stays conditional on
// existing.is_posted — the unpost-edit-repost cycle collapsed into one atomic step so "posted"
// (derived from ledger_entries — see repository.isPosted) never visibly flips off from the
// user's perspective (see saleBills.ipc.js for the password guard, which only applies to this
// already-posted-edit branch).
async function update(id, payload) {
  const existing = await getById(id);
  const { lines, totals } = await resolveLinesAndTotals(payload);
  const bill = buildBillFields(payload, totals);

  await assertStockAvailableForEdit(existing.items, lines);

  await withTransaction(async (transaction) => {
    if (existing.is_posted) {
      await repository.deleteLedgerEntries(transaction, id);
    }
    await repository.deleteStockMovements(transaction, id);

    await repository.updateHeader(transaction, id, bill);
    await repository.deleteItems(transaction, id);
    await repository.insertItems(transaction, id, lines);
    await repository.insertStockMovements(transaction, saleStockMovements(id, bill.bill_date, lines, -1));

    if (existing.is_posted) {
      await writeLedger(transaction, {
        billId: id,
        customerId: bill.customer_id,
        netValue: totals.netValue,
        billDate: bill.bill_date,
      });
    }
  });

  return getById(id);
}

// Posting no longer moves stock — create() already reserved it at save time — so this only
// writes the ledger entries.
async function post(id) {
  const bill = await getById(id);
  if (bill.is_posted) {
    throw ApiError.conflict('Bill is already posted', 'ALREADY_POSTED');
  }

  await withTransaction(async (transaction) => {
    await writeLedger(transaction, {
      billId: id,
      customerId: bill.customer_id,
      netValue: bill.net_value,
      billDate: bill.bill_date,
    });
  });

  return getById(id);
}

// SB-06: every bill still awaiting posting, oldest first.
function listUnposted() {
  return repository.listUnposted();
}

// SB-06: post a whole run of bills in one action instead of one at a time.
//
// Each bill keeps its OWN transaction (post() already wraps one) rather than the batch sharing a
// single one — a decision made explicitly with the user: one bill that can't post must not roll
// back the bills that already did. So this resolves normally with a per-bill breakdown instead of
// throwing on the first failure, unlike products/businessAccounts createBatch which reject the
// whole batch. Callers must read `failed`, not just assume success.
//
// Sequential rather than Promise.all mainly so a batch's per-bill breakdown stays honest under
// concurrent posting — stock itself no longer needs the ordering, since it was already reserved
// per-bill at save time (create()/update()), not here.
async function postAll(ids) {
  // No explicit list = every unposted bill, in entry order.
  const targets = Array.isArray(ids) && ids.length
    ? ids.map((id) => ({ bill_id: id }))
    : await repository.listUnposted();

  const posted = [];
  const failed = [];

  for (const target of targets) {
    const billId = target.bill_id;
    try {
      const bill = await post(billId);
      posted.push({ bill_id: billId, bill_no: bill.bill_no, net_value: bill.net_value });
    } catch (err) {
      // A bill that someone else posted in the meantime is not a failure worth reporting as one —
      // the user's intent ("get these posted") is satisfied either way.
      if (err.code === 'ALREADY_POSTED') continue;
      // Non-ApiError failures keep their message here (the batch summary is the only place the
      // user will ever see which bill broke), but are still logged so the stack isn't lost.
      if (!err.status) console.error(`postAll: unexpected failure on bill ${billId}:`, err);
      failed.push({
        bill_id: billId,
        bill_no: target.bill_no ?? null,
        message: err.status ? err.message : 'Unexpected error while posting this bill.',
        code: err.code || 'INTERNAL',
      });
    }
  }

  return { posted, failed, attempted: targets.length };
}

// Unposting only removes the ledger entries now — stock stays reserved (it isn't tied to posted
// status; only deleting the bill itself would release it, and there's no delete on a real
// sale_bills row, matching the schema's reverse-never-erase pattern).
async function unpost(id) {
  const bill = await getById(id);
  if (!bill.is_posted) {
    throw ApiError.conflict('Bill is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, id);
  });

  return getById(id);
}

// Reverse of draftSaleBills.service.js#confirm(): the real sale_bills table now strictly never
// holds an unposted document (the whole point of this change), so "Unpost" has to fully undo the
// move confirm() made, not just remove the ledger entries the old unpost() above did. Stock stays
// reserved throughout — released here as a SALE_BILL row, then immediately re-reserved as a
// DRAFT_SALE_BILL row for the new draft, net zero effect on actual on-hand stock, same as
// confirm()'s own reservation handoff in the other direction.
async function unconfirm(id) {
  const bill = await getById(id);
  if (!bill.is_posted) {
    throw ApiError.conflict('Bill is not posted', 'NOT_POSTED');
  }

  const draftId = await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, id);
    await repository.insertStockMovements(
      transaction,
      bill.items.map((item) => ({
        variant_id: item.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: item.pairs,
        movement_date: bill.bill_date,
        source_type: 'SALE_BILL',
        source_id: id,
      })),
    );

    const draft = {
      bill_date: bill.bill_date,
      store_id: bill.store_id,
      customer_id: bill.customer_id,
      sub_customer_id: bill.sub_customer_id,
      main_ac_id: bill.main_ac_id,
      delivery_type: bill.delivery_type,
      delivery_address: bill.delivery_address,
      bill_no: bill.bill_no,
      gp_no: bill.gp_no,
      bilty_no: bill.bilty_no,
      adda_id: bill.adda_id,
      remarks: bill.remarks,
      invoice_discount: bill.invoice_discount,
      total_cartons: bill.total_cartons,
      total_pairs: bill.total_pairs,
      gross_value: bill.gross_value,
      net_value: bill.net_value,
      created_by: bill.created_by,
    };
    const lines = bill.items.map((item) => ({
      variant_id: item.variant_id,
      cartons: item.cartons,
      pairs: item.pairs,
      rate: item.rate,
      discount_percent: item.discount_percent,
      discount_value: item.discount_value,
      value: item.value,
    }));

    const newDraftId = await draftSaleBillsRepository.insertDraft(transaction, draft);
    await draftSaleBillsRepository.insertDraftItems(transaction, newDraftId, lines);
    await draftSaleBillsRepository.insertStockMovements(
      transaction,
      lines.map((line) => ({
        variant_id: line.variant_id,
        movement_type: 'ADJUSTMENT',
        qty_pairs: -line.pairs,
        movement_date: draft.bill_date,
        source_type: 'DRAFT_SALE_BILL',
        source_id: newDraftId,
      })),
    );

    await repository.deleteItems(transaction, id);
    await repository.deleteBill(transaction, id);

    return newDraftId;
  });

  return draftSaleBillsRepository.findById(draftId);
}

// Pending Posting sidebar's Delete: only ever an UNPOSTED bill (nothing in ledger_entries yet —
// a posted bill must be unposted first, same restriction as everywhere else financial gets
// undone). Releases the stock create() reserved at save time, then removes the items and the
// bill itself. Password verification happens in the ipc layer, before this is ever called —
// deleting a bill is destructive with no reverse-never-erase trail the way unposting has one, so
// unlike posting (no password) this is treated like editing an already-posted bill.
async function remove(id) {
  const bill = await getById(id);
  if (bill.is_posted) {
    throw ApiError.conflict('Bill is posted — unpost it before deleting', 'ALREADY_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteStockMovements(transaction, id);
    await repository.deleteItems(transaction, id);
    await repository.deleteBill(transaction, id);
  });

  return { ok: true };
}

// Ledger-only half of the old postLedgerAndStock, used by post()/update() now that stock is
// reserved at save time instead of at post time. postLedgerAndStock (below) stays intact for
// draftSaleBills.confirm, which still writes both in one step (confirm = create + post collapsed
// into one action on a bill that was never separately saved-unposted).
async function writeLedger(transaction, { billId, customerId, netValue, billDate }) {
  const customer = await customersService.getById(customerId);
  if (!customer.ba_id) {
    throw ApiError.conflict(
      'Customer has no linked account yet — add one before posting',
      'NO_CUSTOMER_ACCOUNT',
    );
  }

  const salesAccount = await chartAccountsRepository.findByCode(CODES.SALES);
  if (!salesAccount) {
    throw new Error(`Reserved chart account SALES (code ${CODES.SALES}) not found — run npm run seed`);
  }

  await repository.insertLedgerEntries(transaction, [
    {
      entry_date: billDate,
      ba_id: customer.ba_id,
      debit: netValue,
      credit: 0,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
    {
      entry_date: billDate,
      ac_id: salesAccount.ac_id,
      debit: 0,
      credit: netValue,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
  ]);
}

// Shared posting logic (schema §6 posting matrix): debit CUSTOMER BA / credit SALES chart account,
// negative SALE stock movement per item. Used by sale-bills:post and by draftSaleBills.confirm
// (which posts immediately instead of leaving the bill unposted).
async function postLedgerAndStock(transaction, { billId, customerId, netValue, billDate, items }) {
  const customer = await customersService.getById(customerId);
  if (!customer.ba_id) {
    throw ApiError.conflict(
      'Customer has no linked account yet — add one before posting',
      'NO_CUSTOMER_ACCOUNT',
    );
  }

  const salesAccount = await chartAccountsRepository.findByCode(CODES.SALES);
  if (!salesAccount) {
    throw new Error(`Reserved chart account SALES (code ${CODES.SALES}) not found — run npm run seed`);
  }

  // SB-03: never post a sale that would take a variant's stock negative. Requested pairs are
  // summed per variant first — the same article/color can legitimately appear on more than one
  // line (SB-02) — then checked against what's on hand before any of this bill's own movements
  // are written.
  //
  // pairsOnHandTx, not pairsOnHand: this runs inside `transaction`, and draftSaleBills.service.js#
  // confirm() has already written a same-transaction stock_movements row for these variants
  // (reversing the draft's own reservation) before calling here. Reading through the pool's own
  // connection instead of the transaction's would try to read that uncommitted row from a
  // separate connection and, under READ COMMITTED, block waiting on a commit this very call is
  // blocking — a real deadlock, not just a slow query.
  const requestedByVariant = new Map();
  for (const item of items) {
    requestedByVariant.set(item.variant_id, (requestedByVariant.get(item.variant_id) || 0) + item.pairs);
  }
  for (const [variantId, requestedPairs] of requestedByVariant) {
    const onHand = await stockService.pairsOnHandTx(transaction, variantId);
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

  await repository.insertLedgerEntries(transaction, [
    {
      entry_date: billDate,
      ba_id: customer.ba_id,
      debit: netValue,
      credit: 0,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
    {
      entry_date: billDate,
      ac_id: salesAccount.ac_id,
      debit: 0,
      credit: netValue,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
  ]);

  await repository.insertStockMovements(
    transaction,
    items.map((item) => ({
      variant_id: item.variant_id,
      movement_type: 'SALE',
      qty_pairs: -item.pairs,
      movement_date: billDate,
      source_type: 'SALE_BILL',
      source_id: billId,
    })),
  );
}

// Inserts an already-built bill+lines (used by draftSaleBills.confirm, which builds a bill
// directly from a draft's already-computed data instead of recomputing totals — the caller posts
// it right after via postLedgerAndStock, which is what makes it "posted"). Caller owns the
// transaction.
async function insertConfirmed(transaction, bill, lines) {
  const id = await repository.insert(transaction, bill);
  await repository.insertItems(transaction, id, lines);
  return id;
}

// SR-01: rate this customer last paid for this variant, for Sale Return to prefill from instead
// of the article's current predefined sale_price.
function lastSoldRate(customerId, variantId) {
  return repository.lastSoldRate(customerId, variantId);
}

async function getById(billId) {
  const bill = await repository.findById(billId);
  if (!bill) throw ApiError.notFound('Sale bill not found');
  return bill;
}

// UC-20 — same filter shape as list() but with display fields for the search screen.
function biltySearch(filters = {}) {
  return repository.biltySearch({
    customer_id: filters.customer_id,
    sub_customer_id: filters.sub_customer_id,
    bill_no: filters.bill_no,
    ...resolveDateRange(filters),
  });
}

// bilty_no + adda_id ONLY, non-financial — allowed on a POSTED bill, unlike the full update()
// above which is blocked from touching items/totals once posted, this never even checks
// is_posted, since it never writes to ledger_entries/stock_movements.
async function updateBiltyInfo(billId, payload) {
  await getById(billId); // 404s if the bill doesn't exist
  // Both optional since migrations 012/013 made the columns nullable — this screen exists precisely
  // to fill them in later, so demanding them here blocked clearing a value that was entered wrongly.

  await repository.updateBiltyInfo(billId, { bilty_no: payload.bilty_no, adda_id: payload.adda_id });
  return getById(billId);
}

module.exports = {
  create, list, getById, update, post, unpost, unconfirm, remove, postLedgerAndStock, insertConfirmed,
  biltySearch, updateBiltyInfo, lastSoldRate, listUnposted, postAll,
};
