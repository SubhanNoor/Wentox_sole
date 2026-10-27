// Service layer: the Books Check (per the user, 2026-10-25: "I don't want anything else to appear
// like this now and in future"). Honest mistakes in the Cash Book, and one paper cheque entered
// twice, left the client's balances wrong without anything on screen saying so. This runs a fixed
// set of read-only checks the books must always pass and names the exact records when one fails, so
// a mismatch is seen the day it happens instead of being found by the client.
//
// Read-only by design: it never corrects anything. A failed check is fixed deliberately, with a
// reversing entry, by someone who knows what really happened.
const repository = require('../repositories/booksCheck.repository');
const businessAccountsService = require('./businessAccounts.service');

const money = (n) => Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 });

async function run() {
  const chequesBa = await businessAccountsService.getChequesInHandAccount();
  const [tb, cih, duplicates, overAllocated, doubles] = await Promise.all([
    repository.trialBalance(),
    repository.chequesInHand(chequesBa.ba_id),
    repository.duplicateCheques(),
    repository.overAllocatedCheques(),
    repository.doublePostings(),
  ]);

  const checks = [
    {
      key: 'trial_balance',
      title: 'Debits equal credits',
      ok: tb.debit === tb.credit,
      summary: tb.debit === tb.credit
        ? `Both ${money(tb.debit)}`
        : `Debits ${money(tb.debit)}, credits ${money(tb.credit)} — out by ${money(tb.debit - tb.credit)}`,
      rows: [],
    },
    {
      key: 'cheques_in_hand',
      title: 'Cheques in Hand matches the cheques actually held',
      ok: cih.ledger === cih.held,
      summary: cih.ledger === cih.held
        ? `Both ${money(cih.ledger)}`
        : `Ledger ${money(cih.ledger)}, cheques held ${money(cih.held)} — out by ${money(cih.ledger - cih.held)}`,
      rows: [],
    },
    {
      key: 'duplicate_cheques',
      title: 'No cheque entered twice for the same party',
      ok: duplicates.length === 0,
      summary: duplicates.length === 0 ? 'None' : `${duplicates.length} cheque number(s) on more than one live receipt`,
      rows: duplicates.map((d) => `Cheque ${d.cheque_no} — ${d.party}: ${d.detail}`),
    },
    {
      key: 'over_allocated',
      title: 'No cheque used for more than its amount',
      ok: overAllocated.length === 0,
      summary: overAllocated.length === 0 ? 'None' : `${overAllocated.length} cheque(s) used beyond their amount`,
      rows: overAllocated.map((c) => `Cheque ${c.cheque_no} — ${c.party} (receipt #${c.receipt_id}): ${money(c.allocated)} used of ${money(c.amount)}`),
    },
    {
      key: 'double_postings',
      title: 'No document posted or reversed twice',
      ok: doubles.length === 0,
      summary: doubles.length === 0 ? 'None' : `${doubles.length} document(s) with a second posting`,
      rows: doubles.map((d) => `${d.problem}: #${d.doc_id}`),
    },
  ];

  return { ran_at: new Date().toISOString(), ok: checks.every((c) => c.ok), checks };
}

module.exports = { run };
