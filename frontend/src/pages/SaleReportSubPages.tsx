import { useState } from 'react';
import { SaleReportContent } from '@/pages/SaleReportPage';
import { CustomerSalesContent } from '@/pages/CustomerSalesReportPage';
import { ArticleSalesContent } from '@/pages/ArticleSalesReportPage';
import { getWindowParam } from '@/lib/windowParams';

type SubPage = 'summary' | 'customer' | 'article';

const SUB_PAGES: { key: SubPage; label: string }[] = [
  { key: 'summary', label: 'Sale Report' },
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
      <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-md mb-6 border border-slate-200" data-no-print>
        {SUB_PAGES.map(page => (
          <button
            key={page.key}
            onClick={() => setSubPage(page.key)}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 cursor-pointer whitespace-nowrap ${subPage === page.key ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
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
