import { useEffect, useRef, useState } from 'react';
import type { NavPage } from '@/types';
import { MENU_GROUPS, type MenuItem, type MenuGroup } from '@/lib/menu';

// The five hover menus themselves. Their contents — and the reasoning behind the numbering — live
// in lib/menu.ts.

interface Props {
  currentPage: string;
  subTabId?: string;
  /** 'User' hides adminOnly items — same rule the sidebar applied. */
  isAdmin: boolean;
  onNavigate: (page: NavPage, tab?: string) => void;
  /** Pinning: a dropdown item is the drag source now that the sidebar is gone. */
  onDragStart: (payload: { page: NavPage; tab?: string; label: string }) => void;
  onDragEnd: () => void;
}

export default function MenuBar({ currentPage, subTabId, isAdmin, onNavigate, onDragStart, onDragEnd }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Closing is delayed so the diagonal mouse path from a menu button down into its own dropdown
  // doesn't pass over dead space and shut the menu — the single most annoying way a hover menu can
  // fail. Opening is immediate.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenIndex(null), 180);
  };

  useEffect(() => cancelClose, []);

  // Click anywhere outside, or Escape, closes — a hover menu still needs both, because a menu left
  // open after the pointer leaves the window has no other way back.
  useEffect(() => {
    if (openIndex === null) return;
    function onDocClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenIndex(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenIndex(null);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openIndex]);

  const visibleItems = (group: MenuGroup) => {
    const items = isAdmin ? group.items : group.items.filter(i => !i?.adminOnly);
    // Drop separators that ended up leading, trailing, or doubled after that filter — otherwise
    // hiding an admin-only item can leave a stray rule floating at the bottom of the menu.
    const out: (MenuItem | null)[] = [];
    for (const item of items) {
      if (item === null) {
        if (out.length === 0 || out[out.length - 1] === null) continue;
        out.push(null);
      } else {
        out.push(item);
      }
    }
    while (out.length && out[out.length - 1] === null) out.pop();
    return out;
  };

  return (
    <div
      ref={barRef}
      data-no-print
      // NO overflow here, deliberately. `overflow-x: auto` makes overflow-y compute to `auto` as
      // well (CSS spec: `visible` on one axis becomes `auto` when the other isn't `visible`), which
      // turns this bar into a clipping box exactly the height of the buttons — so every dropdown was
      // opening correctly and then being sliced off at the bar's bottom edge, invisible. The five
      // labels are short and fit comfortably; if a future window is narrow enough to overflow, fix it
      // by shrinking the labels, not by re-adding overflow.
      className="relative flex items-stretch flex-nowrap"
      style={{
        background: 'var(--brand-navy)',
        borderBottom: '1px solid rgba(176,141,87,0.35)',
      }}
    >
      {MENU_GROUPS.map((group, idx) => {
        const items = visibleItems(group);
        if (items.length === 0) return null;
        const isOpen = openIndex === idx;
        // The group whose page you are on stays marked, the way the sidebar highlighted its section.
        const holdsCurrent = items.some(
          i => i && i.page === currentPage && (!i.tab || i.tab === subTabId),
        );

        return (
          <div
            key={group.title}
            className="relative flex-shrink-0"
            onMouseEnter={() => { cancelClose(); setOpenIndex(idx); }}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              // Click toggles as well as hover: hover alone is unusable from a touch screen, and a
              // click is how someone verifies the menu is theirs to control.
              onClick={() => setOpenIndex(isOpen ? null : idx)}
              className="h-full px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-wide whitespace-nowrap transition-colors cursor-pointer"
              style={{
                color: isOpen || holdsCurrent ? 'var(--brand-navy)' : 'rgba(250,248,243,0.86)',
                background: isOpen
                  ? 'var(--brand-gold)'
                  : holdsCurrent
                    ? 'rgba(176,141,87,0.85)'
                    : 'transparent',
              }}
            >
              {group.title}
            </button>

            {isOpen && (
              <div
                className="absolute left-0 top-full z-50 py-1.5 rounded-b-md"
                style={{
                  minWidth: 300,
                  background: '#fdfbf4',
                  border: '1px solid rgba(176,141,87,0.55)',
                  borderTop: 'none',
                  boxShadow: '0 16px 38px rgba(0,0,0,0.28)',
                  // 1.SETUP is ~500px tall. The app root is `overflow-hidden` on a full-height flex
                  // column, so on a short laptop screen the foot of that menu would be clipped with
                  // no way to reach it. Cap it and let the menu itself scroll instead.
                  maxHeight: '70vh',
                  overflowY: 'auto',
                }}
              >
                {items.map((item, i) =>
                  item === null ? (
                    <div
                      key={`sep-${i}`}
                      className="my-1.5"
                      style={{ borderTop: '1px solid rgba(17,28,42,0.14)' }}
                    />
                  ) : (
                    <button
                      key={`${item.page}-${item.tab ?? ''}-${item.no}`}
                      type="button"
                      // Pinning moved here from the sidebar: a dropdown item is the drag source now.
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData(
                          'text/plain',
                          JSON.stringify({ page: item.page, tab: item.tab, label: item.label }),
                        );
                        onDragStart({ page: item.page, tab: item.tab, label: item.label });
                      }}
                      onDragEnd={onDragEnd}
                      onClick={() => { setOpenIndex(null); onNavigate(item.page, item.tab); }}
                      title="Click to open · drag onto the Quick Menu to pin"
                      className="flex w-full items-baseline gap-2.5 px-3.5 py-1.5 text-left text-[12.5px] transition-colors cursor-grab active:cursor-grabbing hover:bg-[#f0e6cf]"
                      style={{
                        color: 'var(--dark-heading)',
                        fontWeight:
                          item.page === currentPage && (!item.tab || item.tab === subTabId) ? 700 : 500,
                      }}
                    >
                      {/* Fixed-width number column so the labels line up as they did in the original. */}
                      <span
                        className="font-mono shrink-0 text-right"
                        style={{ width: 34, fontSize: '11px', color: 'rgba(17,28,42,0.55)' }}
                      >
                        {item.no}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  ),
                )}
                <div
                  className="px-3.5 pt-1.5 mt-1 text-[10px] italic"
                  style={{ borderTop: '1px solid rgba(17,28,42,0.14)', color: 'rgba(17,28,42,0.4)' }}
                >
                  *** End of Menu ***
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
