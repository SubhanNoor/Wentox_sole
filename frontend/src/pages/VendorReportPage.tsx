import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { VendorReportRow, VendorRow, LedgerRow } from '@/lib/api';

export function VendorReportContent() {
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorGroupRows, setVendorGroupRows] = useState<VendorReportRow[]>([]);
  const [ledger, setLedger] = useState<{ opening_balance: number; rows: LedgerRow[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.listVendors().then(r => { if (r.ok) setVendors(r.data); }); }, []);

  const loadGrouped = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.vendorReport({ date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok) setVendorGroupRows(res.data);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { if (!selectedVendorId) loadGrouped(); }, [selectedVendorId, loadGrouped]);

  const filteredGroupRows = useMemo(() => {
    if (!vendorSearch.trim()) return vendorGroupRows;
    const q = vendorSearch.toLowerCase();
    return vendorGroupRows.filter(r => r.vendor_name.toLowerCase().includes(q));
  }, [vendorGroupRows, vendorSearch]);

  const grandTotals = useMemo(() => {
    return filteredGroupRows.reduce((acc, r) => ({
      totalPurchase: acc.totalPurchase + r.total_purchase,
      purchaseReturn: acc.purchaseReturn + r.total_return,
      netPurchase: acc.netPurchase + r.net_purchase,
      paymentPaid: acc.paymentPaid + r.payment_paid
    }), { totalPurchase: 0, purchaseReturn: 0, netPurchase: 0, paymentPaid: 0 });
  }, [filteredGroupRows]);

  const selectedVendor = useMemo(() => vendors.find(v => v.vendor_id === selectedVendorId), [selectedVendorId, vendors]);

  const loadLedger = useCallback(async () => {
    if (!selectedVendorId) return;
    setLoading(true);
    const res = await api.reports.vendorLedger({ vendor_id: selectedVendorId, date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok) setLedger(res.data); else setLedger(null);
    setLoading(false);
  }, [selectedVendorId, fromDate, toDate]);

  useEffect(() => { if (selectedVendorId) loadLedger(); }, [selectedVendorId, loadLedger]);

  // Opening Balance synthetic row + running balance, same layout as before — the backend already
  // computes opening_balance and each row's own running balance, no client-side math needed.
  const runningVendorLedger = useMemo(() => {
    if (!ledger) return [];
    return [
      { date: fromDate ? `Before ${fromDate}` : '---', type: 'Opening Balance', ref: '-', debit: 0, credit: 0, balance: ledger.opening_balance },
      ...ledger.rows.map(r => ({ date: r.date, type: r.type, ref: r.inv_no ?? r.bill_no ?? `#${r.entry_id}`, debit: r.debit, credit: r.credit, balance: r.balance })),
    ];
  }, [ledger, fromDate]);

  const handleExportGroupedExcel = () => {
    const headers = ['Vendor / Supplier', 'Total Purchase', 'Purchase Return', 'Net Purchase', 'Payment Paid'];
    const rows = filteredGroupRows.map(r => [r.vendor_name, r.total_purchase, r.total_return, r.net_purchase, r.payment_paid]);
    exportRowsToExcel('vendor-report-grouped', headers, rows);
  };

  const handleExportLedgerExcel = () => {
    const headers = ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance'];
    const rows = runningVendorLedger.map(row => [row.date, row.type, row.ref, row.debit, row.credit, row.balance]);
    exportRowsToExcel(`vendor-ledger-${selectedVendor?.name || 'export'}`, headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1150 }}>

        {!selectedVendorId ? (
          <>
            {/* Filter Bar - data-no-print */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[280px]">
                <div className="relative flex-1 min-w-[220px]">
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Vendor:</span>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by vendor name..."
                      value={vendorSearch}
                      onChange={e => setVendorSearch(e.target.value)}
                      className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                    />
                    <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                  </div>
                </div>
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
                <button onClick={handleExportGroupedExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
              </div>
            </div>

            {/* Grouped Report Sheet */}
            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution</p>
                </div>
                <div className="text-right">
                  <h2 className="font-lora font-semibold text-lg uppercase">Vendor Report — Grouped Summary</h2>
                  {(fromDate || toDate) && (
                    <p className="text-xs text-amber-700 font-semibold mt-0.5">Period: {fromDate || 'Start'} to {toDate || 'End'}</p>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Vendor / Supplier</th>
                      <th className="p-3 text-right">Total Purchase</th>
                      <th className="p-3 text-right">Purchase Return</th>
                      <th className="p-3 text-right">Net Purchase</th>
                      <th className="p-3 text-right">Payment Paid</th>
                      <th className="p-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">Loading…</td></tr>
                    ) : filteredGroupRows.length === 0 ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">No vendors found matching your search.</td></tr>
                    ) : (
                      filteredGroupRows.map(row => (
                        <tr key={row.vendor_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-semibold text-slate-800">{row.vendor_name}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{row.total_purchase > 0 ? formatCurrency(row.total_purchase) : '-'}</td>
                          <td className="p-3 text-right font-bold text-blue-700">{row.total_return > 0 ? formatCurrency(row.total_return) : '-'}</td>
                          <td className="p-3 text-right font-bold" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(row.net_purchase)}</td>
                          <td className="p-3 text-right font-bold text-emerald-700">{row.payment_paid > 0 ? formatCurrency(row.payment_paid) : '-'}</td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => setSelectedVendorId(row.vendor_id)}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
                            >
                              View Ledger
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td className="p-4 pl-4 text-left font-lora">GRAND TOTAL</td>
                      <td className="p-4 text-right text-slate-800">{formatCurrency(grandTotals.totalPurchase)}</td>
                      <td className="p-4 text-right text-blue-800">{formatCurrency(grandTotals.purchaseReturn)}</td>
                      <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(grandTotals.netPurchase)}</td>
                      <td className="p-4 text-right text-emerald-800">{formatCurrency(grandTotals.paymentPaid)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Per-Vendor Ledger */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedVendorId(null)}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-semibold"
                >
                  &larr; Back to Vendor Report
                </button>
                <div className="text-sm font-semibold text-slate-600">
                  Viewing Ledger: <span className="text-amber-800 font-bold">{selectedVendor?.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">From:</span>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1 text-xs" />
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">To:</span>
                    <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1 text-xs" />
                  </div>
                </div>
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4">
                  <Printer size={16} /> Print Statement
                </button>
                <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4">
                  <FileDown size={16} /> Export PDF
                </button>
                <button onClick={handleExportLedgerExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4">
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
              </div>
            </div>

            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Vendor Ledger</p>
                </div>
                <div className="text-right">
                  <h2 className="font-lora font-semibold text-lg uppercase">Vendor Statement</h2>
                  <div className="text-sm font-semibold text-slate-700 mt-1">{selectedVendor?.name}</div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Opening Balance</div>
                  <div className="font-bold font-mono text-sm" style={{ color: 'var(--brand-gold)' }}>
                    {formatCurrency(Math.abs(runningVendorLedger[0]?.balance || 0))}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-center">Ref</th>
                      <th className="p-3 text-right">Debit</th>
                      <th className="p-3 text-right">Credit</th>
                      <th className="p-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">Loading…</td></tr>
                    ) : runningVendorLedger.length === 1 ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">No ledger entries found for this vendor / date range.</td></tr>
                    ) : (
                      runningVendorLedger.map((row, idx) => (
                        <tr
                          key={idx}
                          className={`border-b ${row.type === 'Opening Balance' ? 'bg-slate-50 font-medium text-slate-700' : row.credit > 0 ? 'text-rose-700 hover:bg-rose-50/30' : 'text-slate-700 hover:bg-slate-50/30'}`}
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-semibold">{row.date}</td>
                          <td className="p-3">
                            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold ${row.type === 'Purchase' ? 'bg-rose-50 text-rose-700' : row.type === 'Payment' ? 'bg-emerald-50 text-emerald-700' : row.type === 'Purchase Return' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                              {row.type}
                            </span>
                          </td>
                          <td className="p-3 text-center font-mono text-xs">{row.ref}</td>
                          <td className="p-3 text-right font-bold text-rose-700">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                          <td className="p-3 text-right font-bold text-emerald-700">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(Math.abs(row.balance))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

      </div>
  );
}

export default function VendorReportPage() {
  return (
    <AppLayout pageTitle="Vendor Report">
      <VendorReportContent />
    </AppLayout>
  );
}
