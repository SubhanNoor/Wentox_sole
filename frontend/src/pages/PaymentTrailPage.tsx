import { useState, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import * as api from '@/lib/api';
import type { PaymentTrailResult } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import { REPORT_COLORS } from '@/components/reports/reportColors';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';

export function PaymentTrailContent() {
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [result, setResult] = useState<PaymentTrailResult>({ buckets: [], grand_total: 0 });
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // G-03 (changes-14-09-26.md): the cursor lands in the first field (From date) on open.
  const fromDateRef = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => fromDateRef.current?.focus()); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.paymentTrail({ date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok) setResult(res.data);
    setLoading(false);
    setHasLoadedOnce(true);
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load, dataVersion]);

  // "Show Print Preview" opens a new window landing on this same filtered report (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'payment-trail', { fromDate, toDate, autoPreview: '1' });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && result) setIsPreviewOpen(true);
  }, [result]);

  const handleExportExcel = () => {
    const headers = ['Account Title', 'Amount'];
    const rows: (string | number)[][] = result.buckets.map(b => [b.label, b.total]);
    exportRowsToExcel('payment-trail', headers, rows);
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>PAYMENT TRAIL REPORT</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Account Title</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Amount Paid</th>
            </tr>
          </thead>
          <tbody>
            {result.buckets.map(bucket => (
              <tr key={bucket.key}>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{bucket.label}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: REPORT_COLORS.out }}>{bucket.total > 0 ? formatCurrency(bucket.total) : '-'}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL (AMOUNTS PAID)</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: REPORT_COLORS.gold }}>{formatCurrency(result.grand_total)}</td>
            </tr>
          </tbody>
        </table>

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
          <div style={{ textAlign: 'center', width: '150px' }}>
            <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Prepared By</span>
          </div>
          <div style={{ textAlign: 'center', width: '150px' }}>
            <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Audited By</span>
          </div>
          <div style={{ textAlign: 'center', width: '150px' }}>
            <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Authorized Sign</span>
          </div>
        </div>

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
          <div>WENTOX FOOTWEAR DISTRIBUTION</div>
          <div>Printed: {formatDateTime(new Date())}</div>
        </div>
      </div>
    );
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 900 }}>

        {/* Filter Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
              <input ref={fromDateRef} type="date"
            value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
              <input type="date"
            value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShowPrintPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
            >
              <Eye size={14} /> Show Print Preview
            </button>
          </div>
        </div>

        {/* The report: the same document the print preview prints (Product Ledger layout, per the user 2026-10-14). */}
        <LiveReportDocument loading={loading && !hasLoadedOnce}>
          {renderPrintableDocument()}
        </LiveReportDocument>

        <ReportPrintPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => { setIsPreviewOpen(false); closePreviewWindow(); }}
          title="Payment Trail Report - Print Preview"
          orientation="portrait"
          onExportExcel={handleExportExcel}
        >
          {renderPrintableDocument()}
        </ReportPrintPreviewModal>
      </div>
  );
}

export default function PaymentTrailPage() {
  return (
    <AppLayout pageTitle="Payment Trail">
      <PaymentTrailContent />
    </AppLayout>
  );
}
