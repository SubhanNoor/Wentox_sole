import { useState } from 'react';
import { SaleReportContent } from '@/pages/SaleReportPage';
import { CustomerSalesContent } from '@/pages/CustomerSalesReportPage';
import { ArticleSalesContent } from '@/pages/ArticleSalesReportPage';
import { getWindowParam } from '@/lib/windowParams';

type SubPage = 'summary' | 'customer' | 'article';

const SUB_PAGES: { key: SubPage; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'customer', label: 'Customer Search' },
  { key: 'article', label: 'Article Wise' },
];

// The Sale Report tab with two sub pages added (client request, 2026-11-23): Customer Search and
// Article Wise. "Sale Report" is the existing report, rendered exactly as before — this wrapper only
// adds the switch above it and the two new pages beside it. A print-preview window opened from a
// sub page lands on that same sub page (see each page's handleShowPrintPreview).
export function SaleReportWithSubPages() {
  const [subPage, setSubPage] = useState<SubPage>(() => {
    const fromWindow = getWindowParam('subPage');
    return fromWindow === 'customer' || fromWindow === 'article' ? fromWindow : 'summary';
  });

  return (
    <div className="mx-auto" style={{ maxWidth: 1150 }}>
      {/* Secondary tabs styled exactly like the Reports Hub tabs above them (per the user,
          2026-11-26: the big pill row looked uneven). The first is "Summary" — "Sale Report" is
          already the hub tab it sits under. */}
      <div className="flex flex-wrap gap-1.5 mb-4" data-no-print>
        {SUB_PAGES.map(page => (
          <button
            key={page.key}
            onClick={() => setSubPage(page.key)}
            aria-pressed={subPage === page.key}
            className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer whitespace-nowrap ${subPage === page.key ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {page.label}
          </button>
        ))}
      </div>
      {subPage === 'summary' && <SaleReportContent />}
      {subPage === 'customer' && <CustomerSalesContent />}
      {subPage === 'article' && <ArticleSalesContent />}
    </div>
  );
}

export default SaleReportWithSubPages;
