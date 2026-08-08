import type { ReactNode, KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Shared row template for the setup/directory screens.
 *
 * Replaces the per-page card grids with one compact, scannable table so every
 * directory looks and behaves the same. The markup and classes mirror the table
 * already used by SubCustomerSetupPage/CategorySetupPage — this is the house
 * style, not a new one — plus two things those tables don't do: the whole row is
 * clickable, and the loading/empty states render inside the table so the header
 * stays put.
 *
 * The component knows nothing about the domain: each page supplies its own
 * columns and its own action buttons.
 */

export interface DataListColumn<T> {
  /** Unique key for this column (React key only — not read from the row). */
  key: string;
  /** Column heading text. */
  header: string;
  /** Renders this column's cell for a given row. */
  render: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Fixed column width, e.g. '140px'. Omit to size automatically. */
  width?: string;
  /** Extra classes for this column's <td> (not the <th>). */
  cellClassName?: string;
}

export interface DataListTableProps<T> {
  columns: DataListColumn<T>[];
  rows: T[];
  /** Stable React key for a row. */
  rowKey: (row: T) => string | number;
  /** When supplied, the whole row becomes clickable/keyboard-activatable. */
  onRowClick?: (row: T) => void;
  /** Trailing actions cell. Clicks inside it never trigger onRowClick. */
  actions?: (row: T) => ReactNode;
  actionsWidth?: string;
  actionsHeader?: string;
  loading?: boolean;
  loadingMessage?: string;
  emptyIcon?: ReactNode;
  emptyMessage?: string;

  /**
   * Optional expandable rows. Supplying this adds a leading chevron column and
   * renders the returned content in a full-width row underneath the expanded one.
   * The page owns which row is open (`isExpanded`) and the toggle (`onToggleExpand`),
   * so expansion state stays where the rest of that page's state lives.
   */
  renderExpanded?: (row: T) => ReactNode;
  isExpanded?: (row: T) => boolean;
  onToggleExpand?: (row: T) => void;

  /**
   * Optional <tfoot> content, e.g. a totals row. The page supplies the full
   * <tr>…</tr> so it controls the colSpans its own layout needs.
   */
  footer?: ReactNode;
}

const alignClass = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

export default function DataListTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  actions,
  actionsWidth = '110px',
  actionsHeader = 'Actions',
  loading = false,
  loadingMessage = 'Loading…',
  emptyIcon,
  emptyMessage = 'No records found.',
  renderExpanded,
  isExpanded,
  onToggleExpand,
  footer,
}: DataListTableProps<T>) {
  const expandable = Boolean(renderExpanded);
  const colSpan = columns.length + (actions ? 1 : 0) + (expandable ? 1 : 0);

  // A row reacts to clicks if it opens a detail OR toggles an expansion.
  const rowAction = onRowClick ?? (expandable ? onToggleExpand : undefined);
  const clickable = Boolean(rowAction);

  const handleKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (!rowAction) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      rowAction(row);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr
            className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500"
            style={{ borderColor: 'var(--border-color)' }}
          >
            {expandable && <th className="p-3 pl-4" style={{ width: '30px' }} />}
            {columns.map((col, i) => (
              <th
                key={col.key}
                className={`${i === 0 && !expandable ? 'p-3 pl-4' : 'p-3'} ${alignClass[col.align ?? 'left']}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
            {actions && (
              <th className="p-3 text-center" style={{ width: actionsWidth }}>
                {actionsHeader}
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="text-center p-8 text-slate-400">
                {loadingMessage}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="text-center p-10 text-slate-400">
                {emptyIcon && <div className="mb-3 flex justify-center text-slate-300">{emptyIcon}</div>}
                <p className="font-semibold text-slate-600">{emptyMessage}</p>
              </td>
            </tr>
          ) : (
            // flatMap (rather than a wrapping <Fragment>) so an expanded row is a plain
            // sibling <tr>. The dev-only `kimi-plugin-inspect-react` stamps a `code-path`
            // attribute on every JSX element, which React 19 rejects on a Fragment.
            rows.flatMap(row => {
              const open = expandable && isExpanded ? isExpanded(row) : false;
              const key = rowKey(row);

              const mainRow = (
                  <tr
                    key={key}
                    onClick={clickable ? () => rowAction!(row) : undefined}
                    onKeyDown={clickable ? e => handleKeyDown(e, row) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    className={`border-b transition-colors hover:bg-slate-50/50 ${
                      clickable
                        ? 'cursor-pointer focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--brand-gold)]'
                        : ''
                    }`}
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    {expandable && (
                      <td className="p-3 pl-4 text-slate-400">
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                    )}

                    {columns.map((col, i) => (
                      <td
                        key={col.key}
                        className={`${i === 0 && !expandable ? 'p-3 pl-4' : 'p-3'} ${alignClass[col.align ?? 'left']} ${col.cellClassName ?? ''}`}
                      >
                        {col.render(row)}
                      </td>
                    ))}

                    {actions && (
                      <td className="p-3 text-center">
                        {/* Keeps action clicks from also firing the row click. */}
                        <div
                          className="flex items-center justify-center gap-1.5"
                          onClick={e => e.stopPropagation()}
                        >
                          {actions(row)}
                        </div>
                      </td>
                    )}
                  </tr>
              );

              if (!open) return [mainRow];

              return [
                mainRow,
                (
                  <tr
                    key={`${key}-expanded`}
                    className="bg-slate-50/70 border-b"
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    <td />
                    <td colSpan={colSpan - 1} className="p-4">
                      {renderExpanded!(row)}
                    </td>
                  </tr>
                ),
              ];
            })
          )}
        </tbody>

        {footer && !loading && rows.length > 0 && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
