import type { WageRunRow, ExpenseRow } from '@/lib/api';

/**
 * Payroll balances — the whole balance block on both run screens and the
 * Employees list, derived here rather than stored anywhere.
 *
 * That is what makes unpost safe. An earlier design snapshotted the opening
 * balance onto each run, which meant unposting run #3 quietly invalidated the
 * snapshot on every LATER run, with nothing to flag it. Deriving live, there is
 * no snapshot to go stale.
 *
 * Only CONFIRMED (posted) runs count. A DRAFT run contributes nothing, which is
 * what makes unpost meaningful rather than cosmetic.
 *
 * Real backend `list()` calls never carry a salary run's line items (only
 * `item_count`) — a caller that needs per-employee salary accrual must flatten
 * `salaryRuns.get(id).items` for every CONFIRMED run itself and pass the result
 * in as `salaryItems`. Wage runs don't have this problem: `list()` already
 * carries `total_amount` per run, one row per employee, so no flattening step
 * is needed there.
 */

export interface FlatSalaryItem {
  employee_id: number;
  amount: number;
  run_date: string;
  status: 'DRAFT' | 'CONFIRMED';
}

/** Everything an employee has EARNED on or before `upto` (inclusive). */
export function accruedUpto(
  employee: { employee_id: number; employee_type: 'WORKER' | 'SALARIED' },
  wageRuns: WageRunRow[],
  salaryItems: FlatSalaryItem[],
  upto?: string,
): number {
  if (employee.employee_type === 'WORKER') {
    return wageRuns
      .filter(r => r.employee_id === employee.employee_id && r.status === 'CONFIRMED')
      .filter(r => !upto || r.run_date <= upto)
      .reduce((s, r) => s + r.total_amount, 0);
  }

  // A salaried employee's accrual is their LINE on each posted month, not the
  // run's total — the run covers everyone.
  return salaryItems
    .filter(i => i.employee_id === employee.employee_id && i.status === 'CONFIRMED')
    .filter(i => !upto || i.run_date <= upto)
    .reduce((s, i) => s + i.amount, 0);
}

/** Everything PAID to an employee (via their linked business account) on or before `upto` (inclusive). */
export function paidUpto(baId: number, expenses: ExpenseRow[], upto?: string): number {
  return expenses
    .filter(ex => ex.ba_id === baId && ex.status === 'CONFIRMED')
    .filter(ex => !upto || ex.expense_date <= upto)
    .reduce((s, ex) => s + ex.amount, 0);
}

/** What an employee is owed right now: everything earned minus everything paid. */
export function getEmployeeBalance(
  employee: { employee_id: number; employee_type: 'WORKER' | 'SALARIED'; ba_id: number },
  wageRuns: WageRunRow[],
  salaryItems: FlatSalaryItem[],
  expenses: ExpenseRow[],
): number {
  return accruedUpto(employee, wageRuns, salaryItems) - paidUpto(employee.ba_id, expenses);
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
 * counted into its own baqaya. Worker-only (Wage Run screen never shows a
 * salaried employee), so no `salaryItems` param is needed here.
 */
export function getRunBalanceBlock(
  employee: { employee_id: number; ba_id: number },
  date: string,
  grandTotal: number,
  wageRuns: WageRunRow[],
  expenses: ExpenseRow[],
  excludeRunId?: number,
): { baqaya: number; banam: number; net: number } {
  const cut = dayBefore(date);
  const worker = { employee_id: employee.employee_id, employee_type: 'WORKER' as const };

  let earnedBefore = accruedUpto(worker, wageRuns, [], cut);
  if (excludeRunId) {
    const self = wageRuns.find(r => r.wage_run_id === excludeRunId);
    if (self && self.status === 'CONFIRMED' && self.run_date <= cut) {
      earnedBefore -= self.total_amount;
    }
  }

  const paidBefore = paidUpto(employee.ba_id, expenses, cut);
  const baqaya = earnedBefore - paidBefore;
  const banam = paidUpto(employee.ba_id, expenses) - paidBefore;

  return { baqaya, banam, net: baqaya + grandTotal - banam };
}
