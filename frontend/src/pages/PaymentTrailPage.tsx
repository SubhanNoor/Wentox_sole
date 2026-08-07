import { useState, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { PaymentTrailResult } from '@/lib/api';

export function PaymentTrailContent() {
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [result, setResult] = useState<PaymentTrailResult>({ buckets: [], grand_total: 0 });
  const [loading, setLoading] = useState(false);

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

  return (
      <div className="mx-auto" style={{ maxWidth: 900 }}>

        {/* Filter Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
              <Printer size={16} /> Print
            </button>
            <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
              <FileDown size={16} /> Export PDF
            </button>
            <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
              <FileSpreadsheet size={16} /> Export Excel
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
                <p className="text-xs text-amber-700 font-semibold mt-0.5">Period: {fromDate || 'Start'} to {toDate || 'End'}</p>
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
