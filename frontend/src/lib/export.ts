import * as XLSX from 'xlsx';

// Shared export helpers (TASK-04): wherever a page has Print, it should
// also offer Export as PDF and Export as Excel.
// - "Export PDF" goes through the `reports:export-pdf` IPC channel, which asks the user for a
//   save location and writes a real PDF via Electron's webContents.printToPDF (same @media print
//   CSS as the Print button, so pagination stays in sync). Outside Electron (plain browser dev
//   preview) there's no such IPC bridge, so it falls back to window.print()'s "Save as PDF"
//   destination — the only option available there.
// - "Export Excel" builds a real .xlsx workbook client-side (via the `xlsx` package) and downloads
//   it, so it opens as an actual spreadsheet rather than a CSV Excel merely happens to import.

export async function exportToPDF(filename?: string, options?: { landscape?: boolean }): Promise<void> {
  const exportPdf = window.api?.reports?.['export-pdf'];
  if (!exportPdf) {
    window.print();
    return;
  }
  const result = await exportPdf({ filename, landscape: options?.landscape });
  if (!result.ok) {
    window.print(); // IPC path failed — fall back rather than leave the user with nothing
  }
}

export function exportRowsToExcel(filename: string, headers: string[], rows: (string | number)[][]) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Column widths sized from content so numbers/names aren't truncated on open — xlsx has no
  // auto-fit, this is the standard approximation (character count + a little padding).
  sheet['!cols'] = headers.map((header, colIndex) => {
    const maxLen = rows.reduce(
      (max, row) => Math.max(max, String(row[colIndex] ?? '').length),
      header.length,
    );
    return { wch: maxLen + 2 };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');

  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
