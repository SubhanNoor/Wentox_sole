// Splits a rendered report's DOM into page-sized chunks for the on-screen print preview, so a
// report that overflows one sheet visually shows as multiple stacked pages instead of one long
// scrollable block. This operates on plain DOM nodes (not React elements) because it reads real,
// already-laid-out heights from a hidden "master" copy of the report — the only reliable way to
// know where a page would actually break.
//
// Every report page shares the same two building blocks (see index.css's @media print rules):
// non-table blocks (e.g. .excel-print-header, .excel-grid-info) that must stay whole, and
// <table class="excel-print-table"> blocks that may split row-by-row, repeating <thead> on each
// page fragment. This walks generically over those, so it works for all report pages without
// per-page pagination code.
export function paginateReportContent(masterRoot: HTMLElement, pageHeightPx: number): HTMLElement[] {
  const contentRoot =
    (masterRoot.querySelector('.excel-print-container') as HTMLElement | null) ??
    (masterRoot.firstElementChild as HTMLElement | null) ??
    masterRoot;

  const pages: HTMLElement[] = [];
  let currentPage = document.createElement('div');
  currentPage.className = contentRoot.className;
  let currentHeight = 0;
  pages.push(currentPage);

  const startNewPage = () => {
    currentPage = document.createElement('div');
    currentPage.className = contentRoot.className;
    currentHeight = 0;
    pages.push(currentPage);
  };

  const children = Array.from(contentRoot.children) as HTMLElement[];

  for (const child of children) {
    if (child.tagName === 'TABLE') {
      const thead = child.querySelector('thead');
      const tfoot = child.querySelector('tfoot');
      const tbody = child.querySelector('tbody');
      const rows = tbody ? (Array.from(tbody.children) as HTMLElement[]) : [];
      const theadHeight = thead ? thead.getBoundingClientRect().height : 0;

      let table = document.createElement('table');
      table.className = child.className;
      table.setAttribute('style', child.getAttribute('style') || '');
      let tbodyClone = document.createElement('tbody');
      if (thead) table.appendChild(thead.cloneNode(true));
      table.appendChild(tbodyClone);
      let heightOnPage = theadHeight;

      const flushTable = () => {
        if (tbodyClone.children.length > 0) {
          if (tfoot) table.appendChild(tfoot.cloneNode(true));
          currentPage.appendChild(table);
        }
      };

      for (const row of rows) {
        const rowHeight = row.getBoundingClientRect().height || 24;
        const wouldOverflow = currentHeight + heightOnPage + rowHeight > pageHeightPx;
        if (wouldOverflow && tbodyClone.children.length > 0) {
          flushTable();
          startNewPage();
          table = document.createElement('table');
          table.className = child.className;
          table.setAttribute('style', child.getAttribute('style') || '');
          tbodyClone = document.createElement('tbody');
          if (thead) table.appendChild(thead.cloneNode(true));
          table.appendChild(tbodyClone);
          heightOnPage = theadHeight;
        }
        tbodyClone.appendChild(row.cloneNode(true));
        heightOnPage += rowHeight;
      }
      flushTable();
      currentHeight += heightOnPage;
    } else {
      const height = child.getBoundingClientRect().height || 0;
      if (currentHeight > 0 && currentHeight + height > pageHeightPx) {
        startNewPage();
      }
      currentPage.appendChild(child.cloneNode(true));
      currentHeight += height;
    }
  }

  return pages;
}
