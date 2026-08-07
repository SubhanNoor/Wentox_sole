import React from 'react';

export interface ColumnDef<T> {
  key: string;
  header: string;
  accessor?: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  headerClassName?: string;
  cellClassName?: string;
}

interface ReportTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  summaryRow?: React.ReactNode;
  rowKeyExtractor: (row: T, index: number) => string | number;
  className?: string;
}

export function ReportTable<T>({
  columns,
  data,
  summaryRow,
  rowKeyExtractor,
  className = '',
}: ReportTableProps<T>) {
  return (
    <div className={`report-table-wrapper overflow-x-auto my-3 ${className}`}>
      <table className="w-full border-collapse text-xs text-left">
        <thead>
          <tr className="bg-slate-100/90 text-slate-800 border-y-2 border-slate-900 print:bg-slate-100">
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={`py-2 px-2.5 font-bold uppercase tracking-wider text-[10.5px] border-r border-slate-300 last:border-r-0 ${
                  col.align === 'center'
                    ? 'text-center'
                    : col.align === 'right'
                    ? 'text-right'
                    : 'text-left'
                } ${col.headerClassName || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="py-6 text-center text-slate-400 italic text-xs"
              >
                No records found for this period.
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr
                key={rowKeyExtractor(row, index)}
                className={index % 2 === 1 ? 'bg-slate-50/50 print:bg-slate-50/30' : 'bg-white'}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-2 px-2.5 border-r border-slate-200/70 last:border-r-0 text-slate-800 ${
                      col.align === 'center'
                        ? 'text-center'
                        : col.align === 'right'
                        ? 'text-right font-mono'
                        : 'text-left'
                    } ${col.cellClassName || ''}`}
                  >
                    {col.accessor ? col.accessor(row) : (row as any)[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {summaryRow && (
          <tfoot>
            {summaryRow}
          </tfoot>
        )}
      </table>
    </div>
  );
}
