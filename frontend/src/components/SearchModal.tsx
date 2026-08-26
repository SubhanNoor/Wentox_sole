import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

export interface SearchModalOption {
  value: string;
  label: string;
  /** Small right-aligned hint (city, phone, code, ...) — also matched by the search box. */
  sublabel?: string;
}

interface SearchModalProps {
  isOpen: boolean;
  title: string;
  options: SearchModalOption[];
  /** Currently selected value, if any — highlighted and pre-scrolled-to when the modal opens. */
  value?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
  /** Mirrors SearchableSelect's own prop: fires with the currently arrow-key/hover-highlighted
   * option's value while the modal is open (null once closed), so a caller can live-preview
   * something about it — e.g. an account's balance — before the user commits to a selection. */
  onHighlightChange?: (value: string | null) => void;
  /** Pre-fills the search box with whatever the user already typed into the trigger field before
   *  Enter opened this modal, so it opens straight onto the matching subset instead of the whole
   *  list — e.g. typing an article code/name substring then pressing Enter. */
  initialSearch?: string;
}

/**
 * A centered, full-list "find" popup — distinct from SearchableSelect's small anchored dropdown.
 * Opened from a field (e.g. pressing Enter on the Vendor field) when the picker needs to show
 * every option in a roomier list rather than a panel pinned under the trigger. Search box
 * autofocuses; Up/Down move the highlight without leaving the search box, Enter commits the
 * highlighted option, Escape (or clicking the backdrop) closes without choosing.
 */
export default function SearchModal({
  isOpen, title, options, value, onSelect, onClose, searchPlaceholder = 'Search...', onHighlightChange, initialSearch
}: SearchModalProps) {
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Reset the search box and land focus in it fresh every time the modal opens — "press Enter,
  // type to search" has to work the same way on the second open as the first. A seed (typed into
  // the trigger field before Enter opened this) starts the box already filtered instead of blank,
  // with the whole text selected so the user can immediately overtype it.
  useEffect(() => {
    if (!isOpen) return;
    const seed = initialSearch ?? '';
    setSearch(seed);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const filtered = options.filter(opt =>
    opt.label.toLowerCase().includes(search.toLowerCase()) ||
    (opt.sublabel ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // Highlight starts on the currently-selected option (if it's in the filtered list) so reopening
  // the modal on an already-picked field lands the highlight somewhere meaningful, same as
  // SearchableSelect's own convention. With a seed, land on the first (best) match instead —
  // typing "ahmad footwear" and pressing Enter should highlight the top result, not scroll to
  // wherever the previously-selected option happens to sit in the filtered list.
  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = filtered.findIndex(opt => opt.value === value);
    setHighlightedIndex(initialSearch ? 0 : (selectedIdx >= 0 ? selectedIdx : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, search]);

  useEffect(() => {
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  useEffect(() => {
    if (!onHighlightChange) return;
    onHighlightChange(isOpen ? filtered[highlightedIndex]?.value ?? null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, highlightedIndex, filtered.length]);

  if (!isOpen) return null;

  // Every branch stops propagation, not just preventDefault — this modal is rendered inline (not
  // through a portal), so without it these keydowns keep bubbling past the search box up to
  // window-level listeners behind the modal: AppLayout's own G-01 field-walk and its Quick Menu Bar
  // Arrow Up/Down handler, both bound on `window` (see AppLayout.tsx). That's what caused Up/Down
  // to move the highlight in the modal AND move focus/selection in the field behind it at the same
  // time — reported directly by the user. stopPropagation here keeps every key fully scoped to the
  // modal while it's open.
  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex(i => Math.max(i - 1, 0));
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
      data-no-print
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border w-full max-w-2xl mx-4 flex flex-col animate-scaleUp"
        style={{ height: '80vh', maxHeight: '640px' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h3 className="font-lora font-bold text-xl text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4 border-b bg-slate-50 flex items-center gap-3 shrink-0">
          <Search size={18} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent border-none outline-none text-base font-medium text-black placeholder-slate-500"
          />
        </div>
        <div className="overflow-y-auto flex-1 py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">No matches found.</div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;
              return (
                <button
                  key={opt.value}
                  ref={el => { optionRefs.current[idx] = el; }}
                  type="button"
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => onSelect(opt.value)}
                  className={`w-full text-left px-5 py-3.5 text-base transition-colors flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[var(--brand-gold)] text-white font-bold'
                      : isHighlighted
                      // Darkened from a barely-visible pale cream — flagged directly by the user
                      // as too washed-out to tell apart from an unhighlighted row at a glance.
                      ? 'bg-[var(--brand-navy)] text-white font-bold'
                      : 'text-black hover:bg-[var(--brand-navy)] hover:text-white'
                  }`}
                >
                  <span className="font-medium truncate">{opt.label}</span>
                  {opt.sublabel && (
                    <span className={`text-sm shrink-0 ${isSelected || isHighlighted ? 'text-white/80' : 'text-slate-500'}`}>
                      {opt.sublabel}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
