import React from 'react';

/**
 * The report body every report screen shows under its filter bar (per the user, 2026-10-14: the
 * reports follow the Product Ledger layout). It holds the SAME document the print preview prints,
 * so there is one layout per report to maintain, and the screen always matches the paper.
 * "Show Print Preview" in the filter bar still opens that document in its own preview window.
 */
export default function LiveReportDocument({
  loading = false,
  empty = false,
  emptyMessage = 'No data found matching your filters.',
  children,
}: {
  // Only true for the first load: a reload keeps showing the previous document instead of flashing.
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-white p-6 md:p-8 bg-white border" data-live-report>
      {loading ? (
        <div className="text-center p-8 text-slate-400">Loading…</div>
      ) : empty ? (
        <div className="text-center p-8 text-slate-400">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}
