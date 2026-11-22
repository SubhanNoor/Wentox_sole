import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Eye } from 'lucide-react';
import * as api from '@/lib/api';
import type { ProductRow, ArticleSalesResult } from '@/lib/api';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import {
  TABLE_STYLE, SaleDetailHead, SaleDetailLine, SaleDetailTotalRow, SaleDetailDocHeader,
  SaleDetailSignoff, SaleDetailPicker, TYPE_LABEL, fmtRate,
} from '@/components/reports/saleDetail';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';
import StickyFilter from '@/components/StickyFilter';

const EMPTY: ArticleSalesResult = { groups: [], totals: { cartons: 0, pairs: 0, value: 0 } };

const dateSpan = (from: string, to: string) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);

// Article Wise — a sub page of Sale Report (client request, 2026-11-23): pick an article and a date
// range and see every posted sale of it (returns negative), GROUPED BY PRICE: one group per distinct
// rate with its own subtotal, so a price rise shows as a new group. A price that comes back later
// stays in its original group, whose heading shows the first and last date it was used. Groups
// run oldest price first, so the page reads as the article's price history. Each group is its own
// table under a heading (the print preview keeps a heading with its table's first rows), all with
// the same column widths so every figure lines up from group to group.
export function ArticleSalesContent() {
  const dataVersion = useDataVersion();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [articleId, setArticleId] = useState(() => getWindowParam('articleId') || '');
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [result, setResult] = useState<ArticleSalesResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => pickerRef.current?.focus()); }, []);

  useEffect(() => {
    api.listProducts().then(r => { if (r.ok) setProducts(r.data); });
  }, []);

  const options = useMemo(
    () => products.map(p => ({ value: String(p.article_id), label: `${p.code} — ${p.name}`, searchText: `${p.code} ${p.name}` })),
    [products],
  );
  const article = products.find(p => String(p.article_id) === articleId);
  const articleLabel = article ? `${article.code} — ${article.name}` : '';
  const rangeInvalid = !!fromDate && !!toDate && fromDate > toDate;

  const load = useCallback(async () => {
    if (!articleId || rangeInvalid) { setResult(EMPTY); setHasLoadedOnce(false); return; }
    setLoading(true);
    const res = await api.reports.articleSales({
      article_id: Number(articleId), date_from: fromDate || undefined, date_to: toDate || undefined,
    });
    if (res.ok) { setResult(res.data); setErrorMsg(''); }
    else { setResult(EMPTY); setErrorMsg(res.error.message); }
    setLoading(false);
    setHasLoadedOnce(true);
  }, [articleId, fromDate, toDate, rangeInvalid]);

  useEffect(() => { load(); }, [load, dataVersion]);

  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'sale-report', { subPage: 'article', articleId, fromDate, toDate, autoPreview: '1' });
  };
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Type', 'Bill No.', 'Customer', 'Color', 'Cartons', 'Pairs', 'Rate', 'Disc %', 'Value'];
    const rows: (string | number)[][] = [];
    const only = result.groups.length === 1;
    for (const g of result.groups) {
      rows.push([`PRICE ${fmtRate(g.rate)}`, dateSpan(g.from_date, g.to_date), '', '', '', '', '', g.rate, '', '']);
      for (const r of g.rows) {
        rows.push([formatDate(r.date), TYPE_LABEL[r.kind], r.bill_no, r.customer_name, r.color, r.cartons, r.pairs, r.rate, r.discount_percent, r.value]);
      }
      rows.push([only ? 'REPORT TOTAL' : `TOTAL @ ${fmtRate(g.rate)}`, '', '', '', '', g.cartons, g.pairs, '', '', g.value]);
    }
    if (!only) rows.push(['REPORT TOTAL', '', '', '', '', result.totals.cartons, result.totals.pairs, '', '', result.totals.value]);
    exportRowsToExcel(`article-sales-${article?.code || 'report'}`, headers, rows);
  };

  const renderDocument = () => {
    const only = result.groups.length === 1;
    return (
      <div className="excel-print-container">
        <SaleDetailDocHeader
          title="ARTICLE SALES REPORT"
          lines={[
            `Article: ${articleLabel}`,
            `Period: ${fromDate ? formatDate(fromDate) : 'Start'} to ${toDate ? formatDate(toDate) : 'End'}`,
            'Grouped by price',
          ]}
        />
        {result.groups.map((g, gi) => (
          <Fragment key={g.rate}>
            {/* breakAfter: a real printout never leaves this heading alone at the foot of a page. */}
            <div style={{ fontSize: '11px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#111111', breakAfter: 'avoid', pageBreakAfter: 'avoid' }}>
              PRICE {fmtRate(g.rate)}
              <span style={{ fontWeight: 'normal', color: '#555555' }}> · {dateSpan(g.from_date, g.to_date)}</span>
            </div>
            <table className="excel-print-table" style={TABLE_STYLE}>
              <SaleDetailHead nameHeader="Customer" />
              <tbody>
                {g.rows.map((row, i) => (
                  <SaleDetailLine key={`${row.kind}-${row.doc_id}-${i}`} row={row} name={row.customer_name} />
                ))}
              </tbody>
              <tfoot>
                <SaleDetailTotalRow label={only ? 'REPORT TOTAL' : `TOTAL @ ${fmtRate(g.rate)}`} totals={g} />
                {!only && gi === result.groups.length - 1 && (
                  <SaleDetailTotalRow label="REPORT TOTAL" totals={result.totals} />
                )}
              </tfoot>
            </table>
          </Fragment>
        ))}
        <p style={{ margin: '0 0 0 0', fontSize: '9.5px', color: '#555555' }}>
          Values are line values after each line&apos;s own discount. A bill-level discount belongs to the whole bill, so it is not part of this report.
        </p>
        <SaleDetailSignoff />
      </div>
    );
  };

  const emptyMessage = !articleId
    ? 'Select an article to see where and at what price it was sold.'
    : rangeInvalid
      ? 'The From date is after the To date.'
      : errorMsg || 'No sales found for this article in these dates.';

  return (
    <div>
      <StickyFilter>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <SaleDetailPicker
              label="Article"
              options={options}
              value={articleId}
              onChange={setArticleId}
              placeholder="Type an article code or name, then press Enter..."
              modalTitle="Select Article"
              inputRef={pickerRef}
            />
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
            </div>
          </div>
          <button
            onClick={handleShowPrintPreview}
            disabled={!articleId || rangeInvalid}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
          >
            <Eye size={14} /> Show Print Preview
          </button>
        </div>
      </StickyFilter>

      <LiveReportDocument
        loading={loading && !hasLoadedOnce}
        empty={!articleId || rangeInvalid || result.groups.length === 0}
        emptyMessage={emptyMessage}
      >
        {renderDocument()}
      </LiveReportDocument>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => { setIsPreviewOpen(false); closePreviewWindow(); }}
        title="Article Sales Report - Print Preview"
        orientation="landscape"
        onExportExcel={handleExportExcel}
      >
        {renderDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}

export default ArticleSalesContent;
