// One labelled segmented control for report filter cards — "GROUP BY [Overall|Customer|…]",
// "PERIOD [Overall|By Month|Between Two Dates]" (per the user, 2026-11-26: the stacked tab rows
// above the Sale Report were each a different size and looked uneven). Every report filter uses
// this same height, text size and active style, and never wraps a label onto two lines.
interface SegmentedControlProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export default function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{label}</span>
      <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
            className={`px-3 py-1.5 rounded-md whitespace-nowrap transition-all cursor-pointer ${value === opt.value ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
