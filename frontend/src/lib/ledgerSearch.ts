import type { LedgerRow } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// The search bar on every account's detailed ledger (per the user, 2026-11-26): one box that
// matches ANY column of a ledger row — date, type, Inv #, Bill #, narration, cheque no / date,
// pairs, debit, credit, balance, and a purchase's item lines. Shared by Business Ledger / Customer
// Report, the Overall Trail / Vendor / Customer Balances drill-down and the Vendor Report ledger, so
// the same text finds the same rows everywhere.
//
// Amounts match as typed with or without thousands separators ("100000" and "100,000" both find
// 100,000). Dates match as shown (dd/mm/yyyy) or as stored (yyyy-mm-dd).

function amountTexts(n: number | null | undefined): string[] {
  if (n == null || n === 0) return [];
  const abs = Math.abs(n);
  return [String(abs), abs.toLocaleString('en-US')];
}

function dateTexts(d: string | null | undefined): string[] {
  if (!d) return [];
  return [d.slice(0, 10), formatDate(d)];
}

export function ledgerRowMatches(row: LedgerRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const texts: string[] = [
    ...dateTexts(row.date),
    row.type,
    row.inv_no != null ? String(row.inv_no) : '',
    row.bill_no ?? '',
    row.narration ?? '',
    row.cheque_no ?? '',
    ...dateTexts(row.cheque_date),
    row.pairs ? String(row.pairs) : '',
    ...amountTexts(row.debit),
    ...amountTexts(row.credit),
    ...amountTexts(row.balance),
    ...(row.purchase_items ?? []).map(i => `${i.material_name} ${i.quantity} ${i.unit} ${i.price_per_unit} ${i.total_price}`),
  ];
  return texts.some(t => t.toLowerCase().includes(q));
}
