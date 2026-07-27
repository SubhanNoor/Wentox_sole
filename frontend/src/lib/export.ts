// Shared export helpers (TASK-04): wherever a page has Print, it should
// also offer Export as PDF and Export as Excel. There's no PDF/Excel
// library in this project, so:
// - "Export PDF" reuses the same window.print() flow as Print — the
//   browser's native print dialog lets the user choose "Save as PDF" as
//   the destination, which is the standard no-dependency way to produce a
//   PDF from an on-screen report.
// - "Export Excel" builds a CSV file client-side and downloads it — CSV
//   opens natively in Excel and needs no extra dependency either.

export function exportToPDF() {
  window.print();
}

export function exportRowsToExcel(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (cell: string | number) => {
    const str = String(cell);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers, ...rows]
    .map(row => row.map(escapeCell).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
