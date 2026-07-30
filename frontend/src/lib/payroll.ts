import type { State } from '@/context/AppContext';

/**
 * Payroll balances — the whole balance block on both run screens and the
 * Employees list, derived here rather than stored anywhere.
 *
 * That is what makes unpost safe. An earlier design snapshotted the opening
 * balance onto each run, which meant unposting run #3 quietly invalidated the
 * snapshot on every LATER run, with nothing to flag it. Deriving live, there is
 * no snapshot to go stale.
 *
 * Only POSTED runs count. An unposted run contributes nothing, which is what
 * makes unpost meaningful rather than cosmetic.
 *
 * Lives in lib/ rather than AppContext for the same reason deriveChequeStatus
 * does: it is domain arithmetic over state, not state management.
 */

/** Everything an employee has EARNED on or before `upto` (inclusive). */
export function accruedUpto(state: State, employeeId: string, upto?: string): number {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return 0;

  if (emp.employeeType === 'WORKER') {
    return state.wageRuns
      .filter(r => r.employeeId === employeeId && r.status === 'Posted')
      .filter(r => !upto || r.date <= upto)
      .reduce((s, r) => s + r.totalAmount, 0);
  }

  // A salaried employee's accrual is their LINE on each posted month, not the
  // run's total — the run covers everyone.
  return state.salaryRuns
    .filter(r => r.status === 'Posted')
    .filter(r => !upto || r.date <= upto)
    .reduce((s, r) => s + r.items
      .filter(i => i.employeeId === employeeId)
      .reduce((t, i) => t + i.amount, 0), 0);
}

/** Everything PAID to an employee on or before `upto` (inclusive). */
export function paidUpto(state: State, employeeId: string, upto?: string): number {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return 0;
  return state.expenses
    .filter(ex => ex.businessAccountId === emp.baId)
    .filter(ex => !upto || ex.date <= upto)
    .reduce((s, ex) => s + ex.amount, 0);
}

/** What an employee is owed right now: everything earned minus everything paid. */
export function getEmployeeBalance(state: State, employeeId: string): number {
  return accruedUpto(state, employeeId) - paidUpto(state, employeeId);
}

function dayBefore(date: string): string {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * The four figures on a run's footer, for a settlement dated `date`.
 *
 * BAQAYA and BANAM split on the SAME cut date, and that is load-bearing:
 * baqaya is the NET balance strictly before `date`, so it has already absorbed
 * every earlier payment. Counting those again in banam would subtract them
 * twice and understate what is owed. Banam therefore starts exactly where
 * baqaya stops — the cash handed over at this settlement and after.
 *
 * `excludeRunId`: when re-opening an existing run, its own total must not be
 * counted into its own baqaya.
 */
export function getRunBalanceBlock(
  state: State,
  employeeId: string,
  date: string,
  grandTotal: number,
  excludeRunId?: string
): { baqaya: number; banam: number; net: number } {
  const cut = dayBefore(date);
  const emp = state.employees.find(e => e.id === employeeId);

  let earnedBefore = accruedUpto(state, employeeId, cut);
  if (excludeRunId && emp?.employeeType === 'WORKER') {
    const self = state.wageRuns.find(r => r.id === excludeRunId);
    if (self && self.status === 'Posted' && self.date <= cut) {
      earnedBefore -= self.totalAmount;
    }
  }

  const paidBefore = paidUpto(state, employeeId, cut);
  const baqaya = earnedBefore - paidBefore;
  const banam = paidUpto(state, employeeId) - paidBefore;

  return { baqaya, banam, net: baqaya + grandTotal - banam };
}
