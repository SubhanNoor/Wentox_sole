import { useState, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import * as api from '@/lib/api';
import type { PaymentTrailResult } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

export function PaymentTrailContent() {
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [result, setResult] = useState<PaymentTrailResult>({ buckets: [], grand_total: 0 });
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.paymentTrail({ date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok) setResult(res.data);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

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
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{bucket.total > 0 ? formatCurrency(bucket.total) : '-'}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL (AMOUNTS PAID)</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(result.grand_total)}</td>
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
              <input type="date"
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
              onClick={() => setIsPreviewOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
            >
              <Eye size={14} /> Show Print Preview
            </button>
          </div>
        </div>

        {/* Report Sheet */}
        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="flex items-center justify-between border-b pb-4 mb-6">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-lg uppercase">Payment Trail</h2>
              {(fromDate || toDate) && (
                <p className="text-xs text-amber-700 font-semibold mt-0.5">Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}</p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">Account Title</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={2} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : result.buckets.map(bucket => (
                  <tr key={bucket.key} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-semibold text-slate-800">{bucket.label}</td>
                    <td className="p-3 text-right font-bold text-rose-700">{bucket.total > 0 ? formatCurrency(bucket.total) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="p-4 pl-4 text-left font-lora">GRAND TOTAL (Amounts Paid)</td>
                  <td className="p-4 text-right text-lg" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(result.grand_total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <ReportPrintPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
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
