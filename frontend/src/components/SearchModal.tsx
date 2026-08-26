import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Search } from 'lucide-react';

export interface SearchModalOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchModalProps {
  isOpen: boolean;
  title: string;
  options: SearchModalOption[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
  /** Pre-fills the search box with whatever the user already typed into the trigger field before
   *  Enter opened this modal, so it opens straight onto the matching subset instead of the whole
   *  list — e.g. typing an article code/name substring then pressing Enter. */
  initialSearch?: string;
}

/**
 * A big, centered "find" popup showing the whole option list at once — for a field that should
 * feel like searching a real list (customer, vendor, account...) rather than SearchableSelect's
 * small panel anchored under the field. See System_architecture/pages_design.md §5.
 */
export default function SearchModal({
  isOpen, title, options, value, onSelect, onClose, searchPlaceholder = 'Search...', initialSearch
}: SearchModalProps) {
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.sublabel || '').toLowerCase().includes(q)
    );
  }, [search, options]);

  useEffect(() => {
    if (!isOpen) return;
    const seed = initialSearch ?? '';
    setSearch(seed);
    // With a seed, land on the first (best) match rather than trying to match the current value —
    // typing "ahmad footwear" and pressing Enter should highlight the top result, not scroll to
    // wherever the previously-selected option happens to sit in the unfiltered list.
    const selectedIdx = seed ? 0 : Math.max(0, options.findIndex(o => o.value === value));
    setHighlightedIndex(selectedIdx);
    requestAnimationFrame(() => {
      const el = searchInputRef.current;
      el?.focus();
      el?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => { setHighlightedIndex(0); }, [search]);

  useEffect(() => {
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  if (!isOpen) return null;

  // Every branch here calls stopPropagation — this modal isn't portaled, so its search input is a
  // real DOM descendant of the page's <form>. Without it, AppLayout's window-level Arrow-Up/Down
  // field-walk handler also sees this input as just another form field and moves real focus to a
  // field behind the modal on every arrow press, on top of the modal's own highlight move.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const opt = filtered[highlightedIndex];
      if (opt) onSelect(opt.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn"
      onClick={onClose}
      data-no-print
    >
      <div
        className="bg-white rounded-xl shadow-xl border w-full max-w-2xl mx-4 flex flex-col animate-scaleUp"
        style={{ height: '80vh', maxHeight: '640px', borderColor: 'var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
          <h3 className="font-lora font-bold text-lg text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 pb-2 shrink-0">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="soleria-input w-full"
              style={{ paddingLeft: '2.25rem' }}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">No matches.</p>
          )}
          {filtered.map((opt, idx) => (
            <button
              key={opt.value}
              ref={el => { optionRefs.current[idx] = el; }}
              type="button"
              onClick={() => onSelect(opt.value)}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex flex-col transition-colors ${
                idx === highlightedIndex ? 'bg-amber-50' : 'hover:bg-slate-50'
              }`}
            >
              <span className={`text-sm ${opt.value === value ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                {opt.label}
              </span>
              {opt.sublabel && <span className="text-xs text-slate-400">{opt.sublabel}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
