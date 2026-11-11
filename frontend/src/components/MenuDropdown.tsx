import type { CSSProperties } from 'react';
import type { MenuItem } from '@/lib/menu';

// One MenuBar dropdown's list. Shared by the dropdown's own window (MenuPopupApp.tsx — the normal
// case inside Electron) and the in-page fallback in MenuBar.tsx, so both look and behave the same.

interface Props {
  items: (MenuItem | null)[];
  currentPage: string;
  subTabId?: string;
  onPick: (item: MenuItem) => void;
  onDragStart: (item: MenuItem) => void;
  onDragEnd: () => void;
  className?: string;
  /** Merged over the dropdown's own look (position, size caps). */
  style?: CSSProperties;
}

export default function MenuDropdown({ items, currentPage, subTabId, onPick, onDragStart, onDragEnd, className, style }: Props) {
  return (
    <div
      className={`py-1.5 rounded-b-md ${className ?? ''}`}
      style={{
        minWidth: 300,
        background: '#fdfbf4',
        border: '1px solid rgba(176,141,87,0.55)',
        borderTop: 'none',
        overflowY: 'auto',
        ...style,
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
              onDragStart(item);
            }}
            onDragEnd={onDragEnd}
            onClick={() => onPick(item)}
            title="Opens in a new window · drag onto the Quick Menu to pin"
            // Text color lives in these classes (not the inline `style` below) on purpose —
            // an inline style's color always beats a stylesheet `:hover` rule regardless of
            // specificity, so `hover:text-*` here silently never applied when it was set via
            // `style` instead (2026-08-26: the fix that "did nothing" twice in a row).
            className="group flex w-full items-baseline gap-2.5 px-3.5 py-1.5 text-left text-[12.5px] transition-colors cursor-grab active:cursor-grabbing text-[var(--dark-heading)] hover:bg-[var(--brand-navy-hover)] hover:text-[var(--brand-gold)]"
            style={{
              fontWeight:
                item.page === currentPage && (!item.tab || item.tab === subTabId) ? 700 : 600,
            }}
          >
            {/* Fixed-width number column so the labels line up as they did in the original. */}
            <span
              className="font-mono shrink-0 text-right text-[rgba(17,28,42,0.55)] group-hover:text-[rgba(176,141,87,0.75)]"
              style={{ width: 34, fontSize: '11px' }}
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
  );
}
