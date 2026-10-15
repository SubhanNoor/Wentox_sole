// Figure colours for the report documents (per the user, 2026-10-14: the documents that replaced the
// on-screen tables should keep those tables' colours instead of plain black and white). Hex values of
// the Tailwind shades the old screens used, as inline styles so the print preview and the printout
// carry them too.
export const REPORT_COLORS = {
  text: '#1e293b', // slate-800: the plain figures (total sales on Sale Report, balances)
  muted: '#64748b', // slate-500: secondary text (category, colour)
  faint: '#cbd5e1', // slate-300: empty cells (a colour an article has no stock in)
  sales: '#be123c', // rose-700: Total Sales on Sale Analysis
  returns: '#1d4ed8', // blue-700: Sale Returns
  payment: '#047857', // emerald-700: Payment Received
  commission: '#b45309', // amber-700: Commission
  gold: '#B08D57', // --brand-gold: Net Sales, report totals
  in: '#047857', // emerald-700: stock in
  out: '#be123c', // rose-700: stock out
  negative: '#dc2626', // red-600: a negative balance / stock
} as const;

// A balance or quantity: red when negative, the plain figure colour otherwise.
export const signedColor = (n: number) => (n < 0 ? REPORT_COLORS.negative : REPORT_COLORS.text);
