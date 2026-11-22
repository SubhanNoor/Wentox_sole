import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Eye } from 'lucide-react';
import * as api from '@/lib/api';
import type { CustomerRow, CustomerSalesResult } from '@/lib/api';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import {
  TABLE_STYLE, SaleDetailHead, SaleDetailLine, SaleDetailTotalRow, SaleDetailDocHeader,
  SaleDetailSignoff, SaleDetailPicker, TYPE_LABEL,
} from '@/components/reports/saleDetail';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';
import StickyFilter from '@/components/StickyFilter';

const EMPTY: CustomerSalesResult = { rows: [], totals: { cartons: 0, pairs: 0, value: 0 } };

// Customer Search — a sub page of Sale Report (client request, 2026-11-23): pick a customer and a
// date range (the last three months by default, like the other reports) and see everything that
// customer bought in it — one row per sale line with its OWN rate, so the same article at different
// prices is never merged — with sale returns as negative rows and a bill's invoice discount as its
// own row, ending in one overall total (= that customer's Total Sales less Sale Returns on the
// Sale Report). The screen shows the same document the print preview prints.
export function CustomerSalesContent() {
  const dataVersion = useDataVersion();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerId, setCustomerId] = useState(() => getWindowParam('customerId') || '');
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [result, setResult] = useState<CustomerSalesResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => pickerRef.current?.focus()); }, []);

  useEffect(() => {
    api.listCustomers().then(r => { if (r.ok) setCustomers(r.data); });
  }, []);

  const options = useMemo(
    () => customers.map(c => ({ value: String(c.customer_id), label: c.name, sublabel: c.city_name || undefined })),
    [customers],
  );
  const customerName = customers.find(c => String(c.customer_id) === customerId)?.name ?? '';
  const rangeInvalid = !!fromDate && !!toDate && fromDate > toDate;

  const load = useCallback(async () => {
    if (!customerId || rangeInvalid) { setResult(EMPTY); setHasLoadedOnce(false); return; }
    setLoading(true);
    const res = await api.reports.customerSales({
      customer_id: Number(customerId), date_from: fromDate || undefined, date_to: toDate || undefined,
    });
    if (res.ok) { setResult(res.data); setErrorMsg(''); }
    else { setResult(EMPTY); setErrorMsg(res.error.message); }
    setLoading(false);
    setHasLoadedOnce(true);
  }, [customerId, fromDate, toDate, rangeInvalid]);

  useEffect(() => { load(); }, [load, dataVersion]);

  // "Show Print Preview" opens a new window on this same report, straight into the preview.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'sale-report', { subPage: 'customer', customerId, fromDate, toDate, autoPreview: '1' });
  };
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Type', 'Bill No.', 'Article', 'Color', 'Cartons', 'Pairs', 'Rate', 'Disc %', 'Value'];
    const rows: (string | number)[][] = result.rows.map(r => (r.kind === 'BILL_DISCOUNT'
      ? [formatDate(r.date), TYPE_LABEL[r.kind], r.bill_no, 'Bill discount', '', '', '', '', '', r.value]
      : [formatDate(r.date), TYPE_LABEL[r.kind], r.bill_no, `${r.article_code} — ${r.article_name}`, r.color, r.cartons, r.pairs, r.rate, r.discount_percent, r.value]));
    rows.push(['TOTAL', '', '', '', '', result.totals.cartons, result.totals.pairs, '', '', result.totals.value]);
    exportRowsToExcel(`customer-sales-${customerName || 'report'}`, headers, rows);
  };

  const renderDocument = () => (
    <div className="excel-print-container">
      <SaleDetailDocHeader
        title="CUSTOMER SALES REPORT"
        lines={[
          `Customer: ${customerName}`,
          `Period: ${fromDate ? formatDate(fromDate) : 'Start'} to ${toDate ? formatDate(toDate) : 'End'}`,
        ]}
      />
      <table className="excel-print-table" style={TABLE_STYLE}>
        <SaleDetailHead nameHeader="Article" />
        <tbody>
          {result.rows.map((row, i) => (
            <SaleDetailLine
              key={`${row.kind}-${row.doc_id}-${i}`}
              row={row}
              name={`${row.article_code} — ${row.article_name}`}
            />
          ))}
        </tbody>
        <tfoot>
          <SaleDetailTotalRow label="CUSTOMER TOTAL" totals={result.totals} />
        </tfoot>
      </table>
      <SaleDetailSignoff />
    </div>
  );

  const emptyMessage = !customerId
    ? 'Select a customer to see what they bought.'
    : rangeInvalid
      ? 'The From date is after the To date.'
      : errorMsg || 'No sales found for this customer in these dates.';

  return (
    <div>
      <StickyFilter>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <SaleDetailPicker
              label="Customer"
              options={options}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Type a customer name, then press Enter..."
              modalTitle="Select Customer"
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
            disabled={!customerId || rangeInvalid}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
          >
            <Eye size={14} /> Show Print Preview
          </button>
        </div>
      </StickyFilter>

      <LiveReportDocument
        loading={loading && !hasLoadedOnce}
        empty={!customerId || rangeInvalid || result.rows.length === 0}
        emptyMessage={emptyMessage}
      >
        {renderDocument()}
      </LiveReportDocument>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => { setIsPreviewOpen(false); closePreviewWindow(); }}
        title="Customer Sales Report - Print Preview"
        orientation="landscape"
        onExportExcel={handleExportExcel}
      >
        {renderDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}

export default CustomerSalesContent;
