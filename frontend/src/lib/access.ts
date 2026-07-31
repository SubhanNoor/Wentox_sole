import type { ChartOfAccount, BusinessAccount, UserRole } from '@/types';

// UC-03: role-based access control. ADMIN always sees everything; USER cannot see any chart
// account flagged isRestricted (e.g. BANK ACCOUNTS, DIRECTORS EXPENSES - DRAWINGS) — in
// dropdowns, ledgers, reports, or setup screens. This does NOT block credit/debit entry via
// Receipts/Expenses; those screens intentionally have no restriction logic (see AppContext.tsx).
export function isChartAccountRestrictedForRole(account: ChartOfAccount, role: UserRole | null): boolean {
  return role === 'User' && Boolean(account.isRestricted);
}

// Business accounts don't carry isRestricted themselves — they inherit it from their parent
// chart account (controlId), same as the backend's business_accounts -> chart_of_accounts.ac_id.
export function isBusinessAccountRestrictedForRole(
  business: BusinessAccount,
  chartAccounts: ChartOfAccount[],
  role: UserRole | null,
): boolean {
  if (role !== 'User') return false;
  const parent = chartAccounts.find((c) => c.id === business.controlId);
  return Boolean(parent?.isRestricted);
}

export function filterChartAccountsForRole(
  accounts: ChartOfAccount[],
  role: UserRole | null,
): ChartOfAccount[] {
  return accounts.filter((a) => !isChartAccountRestrictedForRole(a, role));
}

export function filterBusinessAccountsForRole(
  businessAccounts: BusinessAccount[],
  chartAccounts: ChartOfAccount[],
  role: UserRole | null,
): BusinessAccount[] {
  return businessAccounts.filter(
    (b) => !isBusinessAccountRestrictedForRole(b, chartAccounts, role),
  );
}
