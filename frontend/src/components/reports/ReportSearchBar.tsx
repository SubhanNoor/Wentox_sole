import { forwardRef } from 'react';
import { Search } from 'lucide-react';

// The one search bar every report and account ledger uses (per the user, 2026-11-26: placement and
// look were different in every report). It always sits on its OWN full-width row at the top of the
// report's filter card, with the dates/filters/Print Preview on the row below.
//
// `basis-full` makes it take the whole first line when the card is a flex-wrap row (every filter
// card is), so the remaining controls wrap underneath; `mb-1` keeps the same spacing when it is
// placed in a plain block instead.
//
// The page still owns focus (its ref, focused on open / on switching view) — this only renders.
// `data-report-search` is what AppLayout refocuses when an already-open report window is reopened.
interface ReportSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

const ReportSearchBar = forwardRef<HTMLInputElement, ReportSearchBarProps>(function ReportSearchBar(
  { value, onChange, placeholder },
  ref,
) {
  return (
    <div className="relative basis-full w-full mb-1" data-no-print>
      {/* Left padding inline: .soleria-input's own `padding` (index.css) outranks Tailwind's pl-*,
          which left the text sitting on top of the icon. The icon comes after the input so it is
          drawn above the input's background. */}
      <input
        ref={ref}
        data-report-search
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="soleria-input w-full py-2 text-sm font-semibold"
        style={{ paddingLeft: '2.25rem' }}
      />
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
    </div>
  );
});

export default ReportSearchBar;
