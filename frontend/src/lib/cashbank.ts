import type { State } from '@/context/AppContext';
import type { ExpenseMode } from '@/types';

/**
 * "Cheque" splits into two outgoing modes because they credit different
 * accounts — but on a report they are both still a cheque, and a reader should
 * not have to learn our internal vocabulary to scan a column.
 */
export function isChequeMode(mode: ExpenseMode): boolean {
  return mode === 'ChequeEndorsed' || mode === 'ChequeIssued';
}

/** Human label for a payment mode. Keeps the distinction visible without jargon. */
export function expenseModeLabel(mode: ExpenseMode): string {
  switch (mode) {
    case 'ChequeEndorsed': return 'Cheque (Endorsed)';
    case 'ChequeIssued':   return 'Cheque (Issued)';
    default:               return mode;
  }
}

/**
 * Cash, bank and cheques-in-hand balances.
 *
 * DERIVED, never stored — the same rule the payroll balances follow, for the
 * same reason: a stored running balance goes stale the moment an earlier
 * document is edited or deleted, silently, with nothing to flag it. There is no
 * stored balance anywhere in the schema. `openingBalance` is not an exception —
 * it is a stored INPUT (what the account held before WentoX existed), and the
 * running total starts from it rather than replacing it.
 *
 * One helper backs the Bank Accounts page, the Cash Book and any account
 * ledger, so those three cannot disagree with each other.
 *
 * See System_architecture/cash_and_bank.md §10.
 */

/** Chart accounts that hold WentoX's own money. */
export const CASH_CHART_ID = '120001';   // CASH IN HAND
export const BANK_CHART_ID = '120002';   // BANK ACCOUNTS
export const CHEQUES_CHART_ID = '120003'; // CHEQUES IN HAND

/** The single cash account (there is exactly one — cash never asks which). */
export function getCashAccount(state: State) {
  return state.businessAccounts.find(b => b.controlId === CASH_CHART_ID && b.status === 'Active');
}

/** Every bank account's business-account row, for pickers and balances. */
export function getBankBusinessAccounts(state: State) {
  return state.businessAccounts.filter(b => b.controlId === BANK_CHART_ID);
}

function openingOf(state: State, baId: string, upto?: string): number {
  const ba = state.businessAccounts.find(b => b.id === baId);
  if (!ba || ba.openingBalance == null) return 0;
  if (upto && ba.openingDate && ba.openingDate > upto) return 0;
  return ba.openingBalance;
}

const onOrBefore = (date: string, upto?: string) => !upto || date <= upto;

/**
 * What one of our own accounts (cash or bank) holds, as at `upto` (inclusive).
 *
 * `baId` is a BUSINESS account id, not a bankAccounts row id — cash has no
 * bankAccounts row, and using the business account for both means one code path
 * covers cash and bank alike.
 */
export function getAccountBalance(state: State, baId: string, upto?: string): number {
  const bank = state.bankAccounts.find(b => b.baId === baId);
  const bankId = bank?.id;
  const isCash = getCashAccount(state)?.id === baId;

  let total = openingOf(state, baId, upto);

  // ── in ────────────────────────────────────────────────────────────────────
  for (const r of state.receipts) {
    if (!onOrBefore(r.date, upto)) continue;
    if (r.paymentMode === 'Online' && bankId && r.bankId === bankId) total += r.amount;
    if (r.paymentMode === 'Cash' && isCash) total += r.amount;
  }

  // A deposited cheque lands in the bank named on the cheque itself. Only
  // ACTIVE allocations count — a bounce flips them to REVERSED rather than
  // deleting them, so the money leaves again without erasing the history.
  if (bankId) {
    for (const a of state.chequeAllocations) {
      if (a.dispositionType !== 'DEPOSIT' || a.status !== 'ACTIVE') continue;
      if (!onOrBefore(a.allocationDate, upto)) continue;
      const src = state.receipts.find(r => r.id === a.receiptId);
      if (src?.depositBankId === bankId) total += a.amount;
    }
  }

  for (const t of state.transfers) {
    if (!onOrBefore(t.date, upto)) continue;
    if (t.toBaId === baId) total += t.amount;
    if (t.fromBaId === baId) total -= t.amount;
  }

  // Manual adjustments from outside WentoX's own books — owner capital, a
  // loan, or a bank charge/correction. No counter-account, so credit and
  // debit both apply directly.
  for (const d of state.deposits) {
    if (!onOrBefore(d.date, upto)) continue;
    if (d.toBaId === baId) total += d.direction === 'debit' ? -d.amount : d.amount;
  }

  // ── out ───────────────────────────────────────────────────────────────────
  for (const e of state.expenses) {
    if (!onOrBefore(e.date, upto)) continue;
    if (e.paymentMode === 'Cash' && isCash) total -= e.amount;
    // Both of these leave a bank: an online transfer, and a cheque we wrote.
    // The cheque is deducted the day it was WRITTEN, not when it clears — so
    // this figure answers "what have I committed?", not "what would the bank
    // say right now?". That difference is what a reconciliation resolves.
    if ((e.paymentMode === 'Online' || e.paymentMode === 'ChequeIssued')
        && bankId && e.bankId === bankId) total -= e.amount;
  }

  return total;
}

/**
 * Value of received cheques still sitting in the drawer — collected but neither
 * deposited nor endorsed. A claim, not money in a bank, which is why it has its
 * own account rather than being folded into one.
 */
export function getChequesInHand(state: State, upto?: string): number {
  let total = 0;
  for (const r of state.receipts) {
    if (r.paymentMode !== 'Cheque') continue;
    if (!onOrBefore(r.date, upto)) continue;
    if (r.chequeStatus === 'BOUNCED' || r.chequeStatus === 'RETURNED') continue;   // never was money / handed back
    total += r.amount;
    for (const a of state.chequeAllocations) {
      if (a.receiptId !== r.id || a.status !== 'ACTIVE') continue;
      if (!onOrBefore(a.allocationDate, upto)) continue;
      total -= a.amount;    // deposited or endorsed — it has left the drawer
    }
  }
  return total;
}

/**
 * How much of a received cheque has not yet been deposited or endorsed.
 *
 * A cheque can be spent two ways — a `ChequeAllocation` (the Cheques tab's
 * Dispose workflow) or a `ChequeEndorsed` Expense (picked directly on the
 * Expenses page) — both must be subtracted together, or the two paths can
 * double-spend the same cheque.
 */
export function getUnallocatedCheque(state: State, receiptId: string): number {
  const r = state.receipts.find(x => x.id === receiptId);
  if (!r) return 0;
  const usedViaAllocation = state.chequeAllocations
    .filter(a => a.receiptId === receiptId && a.status === 'ACTIVE')
    .reduce((s, a) => s + a.amount, 0);
  const usedViaExpense = state.expenses
    .filter(e => e.paymentMode === 'ChequeEndorsed' && e.chequeId === receiptId)
    .reduce((s, e) => s + e.amount, 0);
  const used = usedViaAllocation + usedViaExpense;
  return r.amount - used;
}

/** Label for a cash or bank account, for pickers and ledger lines. */
export function accountLabel(state: State, baId: string): string {
  return state.businessAccounts.find(b => b.id === baId)?.name || '—';
}
