// Pairs ↔ decimal-carton display, shared by the reports that offer a Pairs/Cartons switch
// (Product Ledger, the Stock & Production Center's production tabs).

export type QtyUnit = 'pairs' | 'cartons';

// Pairs as the reports print them: negatives in brackets, zero as a dash.
export const qty = (n: number) => (n === 0 ? '-' : n < 0 ? `(${Math.abs(n).toLocaleString()})` : n.toLocaleString());

// Cartons as a decimal (per the user 2026-11-09): pairs / packing, to two places because a single
// pair is under a tenth of a carton at the usual packing of 12. Whole cartons print without decimals.
export const toCartons = (n: number, packing: number | null | undefined) => n / (packing && packing > 0 ? packing : 1);
export const roundCartons = (n: number) => Math.round(n * 100) / 100;
export const cartonQty = (n: number) => {
  const r = roundCartons(n);
  if (r === 0) return n === 0 ? '-' : '0';
  const text = Math.abs(r).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return r < 0 ? `(${text})` : text;
};
