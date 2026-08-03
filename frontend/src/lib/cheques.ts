// Cheque endorsement (§13) and alert (§12) derivations.
//
// These live outside AppContext deliberately: AppContext exports React
// components, so adding non-component exports there breaks Fast Refresh for
// the whole store. They are also pure functions of their inputs — the same
// derivations a future `GET /api/notifications` will run server-side.

import type {
  Receipt, SaleBill, SaleReturn, Customer, Expense,
  ChequeAllocation, ChequeStatus, AlertDismissal, AppAlert
} from '@/types';

// §12 — a cheque turns amber this many days before the date written on it,
// and red once that date has passed.
export const CHEQUE_DUE_WARNING_DAYS = 7;

/* ──────────────────── Cheques ──────────────────── */

/** Active (non-reversed) allocations against one cheque. */
export function getActiveAllocations(receiptId: string, allocations: ChequeAllocation[]) {
  return allocations.filter(a => a.receiptId === receiptId && a.status === 'ACTIVE');
}

/**
 * A cheque can be spent two ways: the Cheques tab's "Dispose of Cheque"
 * workflow (a `ChequeAllocation`), or picking "Cheque — Endorse" directly on
 * the Expenses page (an `Expense` with `chequeId`). Both draw down the SAME
 * cheque, so a balance/status check that only reads `ChequeAllocation`s would
 * let the two paths double-spend it. `expenses` defaults to `[]` so existing
 * call sites that haven't been updated yet still compile — but every caller
 * that can reach `state.expenses` should pass it.
 */
function getEndorsedViaExpense(receiptId: string, expenses: Expense[]): number {
  return expenses
    .filter(e => e.paymentMode === 'ChequeEndorsed' && e.chequeId === receiptId)
    .reduce((s, e) => s + e.amount, 0);
}

/** How much of a cheque is still unassigned. Never allowed to go negative. */
export function getUnallocatedBalance(receipt: Receipt, allocations: ChequeAllocation[], expenses: Expense[] = []): number {
  const allocated = getActiveAllocations(receipt.id, allocations).reduce((s, a) => s + a.amount, 0)
    + getEndorsedViaExpense(receipt.id, expenses);
  return Math.max(0, receipt.amount - allocated);
}

/**
 * Status implied by a cheque's allocations. BOUNCED, RETURNED and CLEARED are
 * terminal states set explicitly by the user, so they are never re-derived away.
 */
export function deriveChequeStatus(receipt: Receipt, allocations: ChequeAllocation[], expenses: Expense[] = []): ChequeStatus {
  if (receipt.chequeStatus === 'BOUNCED' || receipt.chequeStatus === 'RETURNED' || receipt.chequeStatus === 'CLEARED') {
    return receipt.chequeStatus;
  }
  const active = getActiveAllocations(receipt.id, allocations);
  const allocated = active.reduce((s, a) => s + a.amount, 0) + getEndorsedViaExpense(receipt.id, expenses);

  if (allocated <= 0) return 'PENDING';
  if (allocated < receipt.amount) return 'PARTIALLY_ENDORSED';
  // Fully allocated: purely banked is DEPOSITED, anything handed on is ENDORSED.
  // A cheque fully spent via the Expenses "Endorse" path (no ChequeAllocation
  // rows at all) is handed-on money, same as an allocation-based endorsement.
  return active.length > 0 && active.every(a => a.dispositionType === 'DEPOSIT') ? 'DEPOSITED' : 'ENDORSED';
}

/** A bounced or returned-to-sender receipt contributes nothing to a customer's balance — the credit is cancelled. */
export function isReceiptLive(receipt: Receipt): boolean {
  return receipt.chequeStatus !== 'BOUNCED' && receipt.chequeStatus !== 'RETURNED';
}

/**
 * Outstanding balance for one customer: posted sales, less returns, less
 * live receipts and their commission.
 */
export function getCustomerBalance(
  customerId: string,
  saleBills: SaleBill[],
  saleReturns: SaleReturn[],
  receipts: Receipt[]
): number {
  const debit = saleBills
    .filter(b => b.customerId === customerId && b.status === 'Posted')
    .reduce((s, b) => s + b.totalValue, 0);
  const returns = saleReturns
    .filter(r => r.customerId === customerId && r.status === 'Posted')
    .reduce((s, r) => s + r.items.reduce((v, it) => v + it.value, 0), 0);
  const paid = receipts
    .filter(r => r.customerId === customerId && isReceiptLive(r))
    .reduce((s, r) => s + r.amount + (r.commission || 0), 0);
  return debit - returns - paid;
}

/* ──────────────────── Alerts (§12) ──────────────────── */

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function daysBetween(fromISO: string, toISO: string): number {
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime();
  return Math.round(ms / 86400000);
}

/** Only the slices of app state the alert derivation actually reads. */
export interface AlertSources {
  receipts: Receipt[];
  saleBills: SaleBill[];
  saleReturns: SaleReturn[];
  customers: Customer[];
  chequeAllocations: ChequeAllocation[];
  expenses: Expense[];
  alertDismissals: AlertDismissal[];
}

/**
 * Alerts are computed on demand, never stored. Only dismissals persist.
 */
export function computeAlerts(src: AlertSources, today: string = todayISO()): AppAlert[] {
  const alerts: AppAlert[] = [];

  // 1. Cheque due / overdue — unconditional, every undisposed cheque qualifies.
  src.receipts.forEach(rec => {
    if (rec.paymentMode !== 'Cheque' || !rec.chequeDate) return;
    const status = rec.chequeStatus || 'PENDING';
    if (status !== 'PENDING' && status !== 'PARTIALLY_ENDORSED') return;

    const daysLeft = daysBetween(today, rec.chequeDate);
    if (daysLeft > CHEQUE_DUE_WARNING_DAYS) return;

    const customer = src.customers.find(c => c.id === rec.customerId);
    const unallocated = getUnallocatedBalance(rec, src.chequeAllocations, src.expenses);

    alerts.push({
      key: `CHEQUE_DUE:${rec.id}`,
      kind: 'CHEQUE_DUE',
      severity: daysLeft < 0 ? 'overdue' : 'due-soon',
      title: `Cheque ${rec.chequeNo || rec.id} — ${customer?.name || 'Unknown customer'}`,
      detail: daysLeft < 0
        ? `Cheque date passed ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
        : daysLeft === 0
          ? 'Cheque is dated today'
          : `Cheque due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      date: rec.chequeDate,
      amount: unallocated > 0 ? unallocated : rec.amount,
      targetPage: 'receipts-jamma',
      targetTab: 'cheques'
    });
  });

  // 2. Payment overdue — ONLY for bills given an explicit due date. A bill with
  //    no due date never alerts; there is deliberately no fallback credit period.
  src.saleBills.forEach(bill => {
    if (!bill.dueDate || bill.status !== 'Posted') return;
    if (daysBetween(today, bill.dueDate) >= 0) return;   // not yet past due

    const balance = getCustomerBalance(bill.customerId, src.saleBills, src.saleReturns, src.receipts);
    if (balance <= 0) return;                            // nothing outstanding

    const customer = src.customers.find(c => c.id === bill.customerId);
    alerts.push({
      key: `PAYMENT_OVERDUE:${bill.id}`,
      kind: 'PAYMENT_OVERDUE',
      severity: 'overdue',
      title: `Payment overdue — ${customer?.name || 'Unknown customer'}`,
      detail: `Bill ${bill.billNo || bill.id} was due ${Math.abs(daysBetween(today, bill.dueDate))} day(s) ago`,
      date: bill.dueDate,
      amount: bill.totalValue,
      targetPage: 'find-bill'
    });
  });

  const dismissed = new Set(src.alertDismissals.map(d => d.alertKey));

  // Nearest date first — the most urgent item is always at the top (§15).
  return alerts
    .filter(a => !dismissed.has(a.key))
    .sort((a, b) => a.date.localeCompare(b.date));
}
