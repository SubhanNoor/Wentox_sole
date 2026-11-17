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
// Laid-out height including vertical margins. getBoundingClientRect() excludes margins, and these
// reports use them heavily (15px under every table, 5px under headings), so ignoring them made the
// estimate drift short and let rows spill past the bottom of a sheet.
function outerHeight(el: HTMLElement): number {
  const cs = window.getComputedStyle(el);
  return el.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
}

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

  for (let ci = 0; ci < children.length; ci++) {
    const child = children[ci];
    if (child.tagName === 'TABLE') {
      const thead = child.querySelector('thead');
      const tfoot = child.querySelector('tfoot');
      const tbody = child.querySelector('tbody');
      const rows = tbody ? (Array.from(tbody.children) as HTMLElement[]) : [];
      const theadHeight = thead ? thead.getBoundingClientRect().height : 0;
      const tableMargin = outerHeight(child) - child.getBoundingClientRect().height;

      let table = document.createElement('table');
      table.className = child.className;
      table.setAttribute('style', child.getAttribute('style') || '');
      let tbodyClone = document.createElement('tbody');
      if (thead) table.appendChild(thead.cloneNode(true));
      table.appendChild(tbodyClone);
      let heightOnPage = theadHeight;

      const tfootHeight = tfoot ? tfoot.getBoundingClientRect().height : 0;

      // Totals (<tfoot>) belong only at the very end of the table, never on intermediate pages.
      const flushTable = (isLast: boolean) => {
        if (tbodyClone.children.length > 0) {
          if (tfoot && isLast) table.appendChild(tfoot.cloneNode(true));
          currentPage.appendChild(table);
        }
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowHeight = row.getBoundingClientRect().height || 24;
        // On the final row, also reserve room for the totals so they don't get orphaned/overflow.
        const reserve = i === rows.length - 1 ? tfootHeight : 0;
        const wouldOverflow = currentHeight + heightOnPage + rowHeight + reserve > pageHeightPx;
        // Also fires when not even one row fits under the header: move the whole table (header
        // included) to the next page instead of leaving a header and a clipped row at the bottom.
        if (wouldOverflow && (tbodyClone.children.length > 0 || currentHeight > 0)) {
          flushTable(false);
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
      flushTable(true);
      currentHeight += heightOnPage + tfootHeight + tableMargin;
    } else {
      const height = outerHeight(child);
      // A heading-style block directly above a table must stay with the table's first rows:
      // require its header plus first row to fit too, otherwise the heading moves to the next page.
      const next = children[ci + 1];
      let keepWith = 0;
      if (next && next.tagName === 'TABLE') {
        const nh = next.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        const fr = next.querySelector('tbody')?.firstElementChild as HTMLElement | null;
        keepWith = nh + (fr ? fr.getBoundingClientRect().height : 0);
      }
      if (currentHeight > 0 && currentHeight + height + keepWith > pageHeightPx) {
        startNewPage();
      }
      currentPage.appendChild(child.cloneNode(true));
      currentHeight += height;
    }
  }

  return pages;
}
