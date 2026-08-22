import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown } from 'lucide-react';
import { focusNextField } from '@/lib/fieldNav';
import { isTypeAheadKey, isBlankOpenKey } from '@/lib/keyboard';

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  /** RJ-02: fires with the currently arrow-key-highlighted option's value while the panel is
   * open (null once closed), so a caller can live-preview something about it — e.g. an account's
   * balance — before the user commits to a selection. */
  onHighlightChange?: (value: string | null) => void;
}

/** Roughly the tallest the panel gets: search row + max-h-60 list. */
const PANEL_MAX_HEIGHT = 290;

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search...',
  disabled = false,
  onHighlightChange
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Distinguishes a focus event caused by the user clicking the trigger (onMouseDown fires first,
  // then focus, then click) from every other way focus can land here (Tab, the app's G-01
  // Enter-walk between fields, a page auto-focusing its first field on mount) — a mouse click
  // already opens the panel itself via its own onClick/toggle, so auto-opening on that same
  // focus event too would immediately toggle it shut again right after.
  const focusFromMouseRef = useRef(false);
  // Set just before a deliberate "return focus to the trigger without reopening" call (after
  // committing a selection, or on Escape) — the panel closes and focus moves back onto this same
  // button, which would otherwise look identical to a keyboard-driven focus and reopen it.
  const suppressAutoOpenRef = useRef(false);
  function focusTriggerWithoutOpening() {
    suppressAutoOpenRef.current = true;
    triggerRef.current?.focus();
  }

  /**
   * The panel is rendered through a PORTAL onto document.body rather than as an
   * absolutely-positioned child.
   *
   * It has to be. `.card-white` sets `overflow: hidden` (index.css) and every
   * line-item grid sits inside an `overflow-x-auto` wrapper — and a horizontal
   * scroll container clips vertically too, since a browser resolves
   * `overflow-y: visible` to `auto` the moment the other axis scrolls. Either
   * one silently swallows a dropdown that opens past its edge, which is exactly
   * what happened on the wage run screen: the search box showed, the options
   * did not. Escaping to the body is the only fix that works in both.
   */
  const place = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip above only when below genuinely cannot hold it AND above is roomier —
    // otherwise a select near the fold jumps around for no benefit.
    const flip = spaceBelow < PANEL_MAX_HEIGHT && r.top > spaceBelow;
    setPos({
      top: flip ? r.top - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      flip
    });
  }, []);

  // Reposition while open. Capture phase, so scrolling ANY ancestor (a table's
  // own scroller included) keeps the panel attached to its trigger.
  useEffect(() => {
    if (!isOpen) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [isOpen, place]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      // The panel is no longer a DOM descendant of the container, so both have
      // to be checked or the first click inside it would close the dropdown.
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  const filteredOptions = options.filter(opt =>
    opt.label.toLowerCase().includes(search.toLowerCase()) ||
    opt.value.toLowerCase().includes(search.toLowerCase())
  );

  // Keyboard highlight resets to the current value (if it's in the filtered list) whenever the
  // list changes — typing a search or reopening shouldn't leave the highlight pointing at
  // whatever index happened to be highlighted before.
  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = filteredOptions.findIndex(opt => opt.value === value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, search]);

  useEffect(() => {
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  useEffect(() => {
    if (!onHighlightChange) return;
    onHighlightChange(isOpen ? filteredOptions[highlightedIndex]?.value ?? null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, highlightedIndex, filteredOptions.length]);

  // `seed` is the character that triggered the open, when the user simply started typing on a
  // focused field instead of clicking. Without it the first keystroke would be swallowed: the panel
  // would appear with an empty box and the user would be one letter short of what they typed.
  const open = (seed = '') => {
    if (disabled || isOpen) return;
    place();
    setIsOpen(true);
    setSearch(seed);
  };

  const toggle = () => {
    if (disabled) return;
    if (!isOpen) place();   // measured on open, not in an effect
    setIsOpen(!isOpen);
    setSearch('');
  };

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (isOpen) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
      return;
    }

    // Type-to-search: with the field merely FOCUSED, any printable character opens the panel and
    // becomes the first character of the search. This is the point of the change — entry is a
    // continuous run of typing, never a click to open and then a type.
    //
    // isTypeAheadKey keeps named keys (Tab, Enter, Escape, F1...) and modifier combos out — see
    // lib/keyboard.ts for why each guard is there.
    if (isTypeAheadKey(e)) {
      e.preventDefault();
      open(isBlankOpenKey(e) ? '' : e.key);
    }
  }

  /**
   * Take the highlighted option and move on.
   *
   * `advance` is true for Enter — the whole point being that a selection ends with the cursor in the
   * NEXT field, so a form is filled in one unbroken run of typing. It is false for a mouse click,
   * where jumping the cursor somewhere else would be surprising.
   *
   * Focus has to be restored to the trigger first, and for two reasons: it is the right place for
   * the cursor if there is no next field, and focusNextField locates the next field RELATIVE to the
   * trigger. It cannot work from the search box, which lives in a portal on document.body and so has
   * no enclosing form at all — the same reason AppLayout's own Enter handler never fires in here.
   */
  function commitHighlighted(advance = false) {
    const opt = filteredOptions[highlightedIndex];
    if (!opt) return;
    onChange(opt.value);
    setIsOpen(false);

    const trigger = triggerRef.current;
    focusTriggerWithoutOpening();
    // `onChange` above can flip another field's `disabled` (e.g. Colour disables until an
    // Article is chosen) — that state update hasn't committed to the DOM yet at this point in
    // the same synchronous handler, so scanning for fields now would still see the old
    // `disabled` and skip straight past it. Deferring past the next paint lets the re-render
    // land first.
    if (advance) requestAnimationFrame(() => focusNextField(trigger));
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filteredOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitHighlighted(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      focusTriggerWithoutOpening();
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        data-field-nav="true"
        disabled={disabled}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
        onMouseDown={() => { focusFromMouseRef.current = true; }}
        onFocus={() => {
          if (focusFromMouseRef.current) { focusFromMouseRef.current = false; return; }
          if (suppressAutoOpenRef.current) { suppressAutoOpenRef.current = false; return; }
          open();
        }}
        className="w-full flex items-center justify-between pl-3.5 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed min-h-[38px] text-left"
      >
        <span className={selectedOption ? 'text-slate-800 font-semibold' : 'text-slate-400'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} />
      </button>

      {isOpen && pos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            transform: pos.flip ? 'translateY(-100%)' : undefined,
            zIndex: 9999
          }}
          className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent border-none outline-none text-xs font-semibold text-slate-800 placeholder-slate-400 p-1"
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 text-center font-medium">
                No matching options
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <button
                    key={opt.value}
                    ref={el => { optionRefs.current[idx] = el; }}
                    type="button"
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => {
                      // Deliberately does NOT advance: a mouse user did not ask to be moved on.
                      onChange(opt.value);
                      setIsOpen(false);
                      focusTriggerWithoutOpening();
                    }}
                    className={`w-full text-left px-3.5 py-2 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--brand-gold)] text-white font-semibold'
                        : isHighlighted
                        ? 'bg-[#fbf7f0] text-[var(--brand-navy)]'
                        : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {opt.value}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
