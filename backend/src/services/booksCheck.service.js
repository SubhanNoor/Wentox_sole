// Service layer: the Books Check (per the user, 2026-10-25: "I don't want anything else to appear
// like this now and in future"). Honest mistakes in the Cash Book, and one paper cheque entered
// twice, left the client's balances wrong without anything on screen saying so. This runs a fixed
// set of read-only checks the books must always pass and names the exact records when one fails, so
// a mismatch is seen the day it happens instead of being found by the client.
//
// Read-only by design: it never corrects anything. A failed check is fixed deliberately, with a
// reversing entry, by someone who knows what really happened.
//
// Clearances (per the user, 2026-11-28): when the client has already settled a flagged item by hand,
// an admin can mark that one item as cleared and it stops counting as a problem. Only the per-record
// checks can be cleared — the two totals checks (debits = credits, Cheques in Hand) can't, since a
// mismatch there is never "settled elsewhere". Each item's key names its exact records, so if the
// item changes it no longer matches its clearance and turns red again.
const repository = require('../repositories/booksCheck.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');

const money = (n) => Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 });

const CLEARABLE = new Set(['duplicate_cheques', 'over_allocated', 'double_postings']);

// Splits one check's items into those still open and those an admin has cleared.
function applyClearances(checkKey, items, clearances) {
  const cleared = new Map(
    clearances.filter((c) => c.check_key === checkKey).map((c) => [c.item_key, c]),
  );
  const open = [];
  const done = [];
  for (const item of items) {
    const c = cleared.get(item.key);
    if (c) done.push({ ...item, cleared_at: c.cleared_at, cleared_by: c.cleared_by_name || null });
    else open.push(item);
  }
  return { open, done };
}

async function run() {
  const chequesBa = await businessAccountsService.getChequesInHandAccount();
  const [tb, cih, duplicates, overAllocated, doubles, clearances] = await Promise.all([
    repository.trialBalance(),
    repository.chequesInHand(chequesBa.ba_id),
    repository.duplicateCheques(),
    repository.overAllocatedCheques(),
    repository.doublePostings(),
    repository.listClearances(),
  ]);

  const dup = applyClearances('duplicate_cheques', duplicates.map((d) => ({
    key: `${d.cheque_no}|${d.ba_id}|${d.receipt_ids}`,
    text: `Cheque ${d.cheque_no} — ${d.party}: ${d.detail}`,
  })), clearances);
  const over = applyClearances('over_allocated', overAllocated.map((c) => ({
    key: `${c.receipt_id}|${Number(c.allocated)}|${Number(c.amount)}`,
    text: `Cheque ${c.cheque_no} — ${c.party} (receipt #${c.receipt_id}): ${money(c.allocated)} used of ${money(c.amount)}`,
  })), clearances);
  const dbl = applyClearances('double_postings', doubles.map((d) => ({
    key: `${d.problem}|${d.doc_id}`,
    text: `${d.problem}: #${d.doc_id}`,
  })), clearances);

  const checks = [
    {
      key: 'trial_balance',
      title: 'Debits equal credits',
      ok: tb.debit === tb.credit,
      summary: tb.debit === tb.credit
        ? `Both ${money(tb.debit)}`
        : `Debits ${money(tb.debit)}, credits ${money(tb.credit)} — out by ${money(tb.debit - tb.credit)}`,
      clearable: false,
      items: [],
      cleared: [],
    },
    {
      key: 'cheques_in_hand',
      title: 'Cheques in Hand matches the cheques actually held',
      ok: cih.ledger === cih.held,
      summary: cih.ledger === cih.held
        ? `Both ${money(cih.ledger)}`
        : `Ledger ${money(cih.ledger)}, cheques held ${money(cih.held)} — out by ${money(cih.ledger - cih.held)}`,
      clearable: false,
      items: [],
      cleared: [],
    },
    {
      key: 'duplicate_cheques',
      title: 'No cheque entered twice for the same party',
      ok: dup.open.length === 0,
      summary: dup.open.length === 0 ? 'None' : `${dup.open.length} cheque number(s) on more than one live receipt`,
      clearable: true,
      items: dup.open,
      cleared: dup.done,
    },
    {
      key: 'over_allocated',
      title: 'No cheque used for more than its amount',
      ok: over.open.length === 0,
      summary: over.open.length === 0 ? 'None' : `${over.open.length} cheque(s) used beyond their amount`,
      clearable: true,
      items: over.open,
      cleared: over.done,
    },
    {
      key: 'double_postings',
      title: 'No document posted or reversed twice',
      ok: dbl.open.length === 0,
      summary: dbl.open.length === 0 ? 'None' : `${dbl.open.length} document(s) with a second posting`,
      clearable: true,
      items: dbl.open,
      cleared: dbl.done,
    },
  ];

  return { ran_at: new Date().toISOString(), ok: checks.every((c) => c.ok), checks };
}

function validateItem(payload) {
  const checkKey = payload && typeof payload.check_key === 'string' ? payload.check_key : '';
  const itemKey = payload && typeof payload.item_key === 'string' ? payload.item_key.trim() : '';
  if (!CLEARABLE.has(checkKey)) throw ApiError.badRequest('This check cannot be cleared');
  if (!itemKey || itemKey.length > 400) throw ApiError.badRequest('item_key is required');
  return { check_key: checkKey, item_key: itemKey };
}

// Marks one flagged item as settled. Returns the re-run check so the screen updates in one step.
async function clearItem(payload, userId) {
  const item = validateItem(payload);
  const text = payload.item_text ? String(payload.item_text).slice(0, 1000) : null;
  await repository.addClearance({ ...item, item_text: text, cleared_by: userId });
  return run();
}

// Undoes a clearance: the item counts as a problem again if it is still in the books.
async function restoreItem(payload) {
  await repository.removeClearance(validateItem(payload));
  return run();
}

module.exports = { run, clearItem, restoreItem };
