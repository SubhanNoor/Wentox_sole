import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown } from 'lucide-react';

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
}

/** Roughly the tallest the panel gets: search row + max-h-60 list. */
const PANEL_MAX_HEIGHT = 290;

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search...',
  disabled = false
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const toggle = () => {
    if (disabled) return;
    if (!isOpen) place();   // measured on open, not in an effect
    setIsOpen(!isOpen);
    setSearch('');
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className="w-full flex items-center justify-between soleria-input bg-white disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer disabled:cursor-not-allowed min-h-[38px] px-3 text-left font-medium"
      >
        <span className={selectedOption ? 'text-slate-800' : 'text-slate-400'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} className={`text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
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
              filteredOptions.map(opt => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#111c2a] text-[#B08D57]'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      isSelected ? 'bg-slate-800 text-[#B08D57]' : 'bg-slate-100 text-slate-500'
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
