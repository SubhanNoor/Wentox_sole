/**
 * "Skip Zero Balances" — leaves rows whose balance nets to zero out of a report. One on/off option
 * drawn as a radio: click again to turn it back off. Shared by every report with a Balance per row
 * (per the user, 2026-10-14), first built on Payment Trail All Accounts (OverallTrailContent.tsx).
 */
export default function SkipZeroToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={value}
      onClick={() => onChange(!value)}
      data-no-print
      className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-slate-600 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap"
    >
      <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${value ? 'border-[#111c2a]' : 'border-slate-300'}`}>
        {value && <span className="w-1.5 h-1.5 rounded-full bg-[#111c2a]" />}
      </span>
      Skip Zero Balances
    </button>
  );
}

// A balance that rounds to zero at 2 decimal places counts as zero (same tolerance Overall Trail uses).
export const isZeroBalance = (n: number) => Math.abs(n) < 0.005;
