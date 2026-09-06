// Shown when First/Prev/Next/Last lands on a System No. that was deleted (per the user,
// 2026-09-07: numbers are never reused, but the gap should be an actual stop while browsing, not
// a silent skip from #24 straight to #26). Absolutely positioned over the existing form card —
// the parent needs `position: relative` — rather than restructuring that form's JSX, so this is
// purely additive and can't disturb the fields underneath.
export default function DeletedDocumentOverlay({ systemNo, label }: { systemNo: number; label: string }) {
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.97)' }}
    >
      <span className="text-4xl" aria-hidden>🗑️</span>
      <div className="text-2xl font-bold text-slate-700">#{systemNo}</div>
      <div className="text-sm font-semibold uppercase tracking-wide text-rose-500">Deleted</div>
      <div className="text-sm text-slate-500">This {label} was deleted — its number is retired, not reused.</div>
    </div>
  );
}
