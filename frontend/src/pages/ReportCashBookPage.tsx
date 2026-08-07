import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import * as api from '@/lib/api';
import type { CashBookResult } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

export function ReportCashBookContent() {
  const [filterBy, setFilterBy] = useState<'date' | 'month'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [specificDate, setSpecificDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  const [result, setResult] = useState<CashBookResult>({ opening_cash: 0, cash_received: 0, total_cash: 0, cash_paid: 0, cash_in_hand: 0, rows: [] });
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const periodLabel = filterBy === 'date' ? specificDate : `${months[filterMonth]} ${filterYear}`;

  const load = useCallback(async () => {
    setLoading(true);
    const payload = filterBy === 'date'
      ? { date: specificDate }
      : { month: `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}` };
    const res = await api.reports.cashBook(payload);
    if (res.ok) setResult(res.data);
    setLoading(false);
  }, [filterBy, specificDate, filterMonth, filterYear]);

  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return result.rows;
    const q = searchQuery.toLowerCase();
    return result.rows.filter(r =>
      (r.narration || '').toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    );
  }, [result.rows, searchQuery]);

  const handleExportExcel = () => {
    const headers = ['No.', 'Date', 'Type', 'Narration', 'Cash Received', 'Cash Paid', 'Balance'];
    const rows = filteredRows.map((row, idx) => [idx + 1, row.date, row.type, row.narration || '', row.debit, row.credit, row.balance]);
    exportRowsToExcel(`cash-book-${periodLabel}`, headers, rows);
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>DAILY CASH BOOK REPORT</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {periodLabel}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', border: '1px solid #000000', marginBottom: '15px', fontSize: '11px' }}>
          <div style={{ borderRight: '1px solid #000000', padding: '5px' }}>
            <span style={{ fontSize: '9px', fontWeight: 'bold', display: 'block', textTransform: 'uppercase' }}>Opening Cash</span>
            <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(result.opening_cash)}</span>
          </div>
          <div style={{ borderRight: '1px solid #000000', padding: '5px' }}>
            <span style={{ fontSize: '9px', fontWeight: 'bold', display: 'block', textTransform: 'uppercase' }}>Total Received</span>
            <span style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#047857' }}>{formatCurrency(result.cash_received)}</span>
          </div>
          <div style={{ borderRight: '1px solid #000000', padding: '5px' }}>
            <span style={{ fontSize: '9px', fontWeight: 'bold', display: 'block', textTransform: 'uppercase' }}>Cumulative Cash</span>
            <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(result.total_cash)}</span>
          </div>
          <div style={{ borderRight: '1px solid #000000', padding: '5px' }}>
            <span style={{ fontSize: '9px', fontWeight: 'bold', display: 'block', textTransform: 'uppercase' }}>Total Paid</span>
            <span style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{formatCurrency(result.cash_paid)}</span>
          </div>
          <div style={{ padding: '5px' }}>
            <span style={{ fontSize: '9px', fontWeight: 'bold', display: 'block', textTransform: 'uppercase' }}>Cash in Hand</span>
            <span style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#B08D57' }}>{formatCurrency(result.cash_in_hand)}</span>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Date</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '15%' }}>Type</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '32%' }}>Narration / Particulars</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Received (IN)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Paid (OUT)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', fontFamily: 'monospace' }}>{idx + 1}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>{row.date}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{row.type}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{row.narration || '—'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#047857' }}>{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px', padding: '0 10px' }}>
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
      </div>
    );
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1100 }}>

        {/* Filter Mode Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-xs mb-6 border border-slate-200" data-no-print>
          <button
            onClick={() => setFilterBy('date')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${filterBy === 'date' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            By Date
          </button>
          <button
            onClick={() => setFilterBy('month')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${filterBy === 'month' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            By Month
          </button>
        </div>

        {/* Selection Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[290px]">
            <div className="relative flex-1 min-w-[240px]">
              <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Particulars:</span>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by type, narration..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
              </div>
            </div>

            {filterBy === 'date' ? (
              <div>
                <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Date:</span>
                <input
                  type="date"
                  value={specificDate}
                  onChange={e => setSpecificDate(e.target.value)}
                  className="soleria-input py-1 text-xs"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Month:</span>
                  <div className="w-36">
                    <SearchableSelect
                      options={months.map((m, idx) => ({ value: String(idx), label: m }))}
                      value={String(filterMonth)}
                      onChange={(val: string) => setFilterMonth(parseInt(val, 10))}
                      placeholder="Select month..."
                    />
                  </div>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Year:</span>
                  <div className="w-28">
                    <SearchableSelect
                      options={[
                        { value: '2026', label: '2026' },
                        { value: '2025', label: '2025' }
                      ]}
                      value={String(filterYear)}
                      onChange={(val: string) => setFilterYear(parseInt(val, 10))}
                      placeholder="Year"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPreviewOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs self-end h-9"
            >
              <Eye size={14} /> Show Print Preview
            </button>
          </div>
        </div>

        {/* Cash Book Grid */}
        <div className="card-white p-6 md:p-8 bg-white border">

          <div className="flex items-center justify-between border-b pb-4 mb-6">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution </p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-lg uppercase">Cash Book of the Day</h2>
              <p className="text-sm text-slate-700 mt-1 font-semibold uppercase">{periodLabel}</p>
            </div>
          </div>

          {/* Summary Box */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6" data-no-print>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Opening Cash</span>
              <span className="text-sm font-bold font-mono text-slate-800">{formatCurrency(result.opening_cash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Cash Received</span>
              <span className="text-sm font-bold font-mono text-emerald-600">{formatCurrency(result.cash_received)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Cumulative Total</span>
              <span className="text-sm font-bold font-mono text-slate-800">{formatCurrency(result.total_cash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Cash Paid</span>
              <span className="text-sm font-bold font-mono text-rose-600">{formatCurrency(result.cash_paid)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-[#111c2a] text-white">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1">Cash in Hand</span>
              <span className="text-sm font-bold font-mono" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(result.cash_in_hand)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4 text-center w-12">S#</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Narration / Particulars</th>
                  <th className="p-3 text-right">Cash Received (IN)</th>
                  <th className="p-3 text-right">Cash Paid (OUT)</th>
                  <th className="p-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={7} className="text-center p-8 text-slate-400">No cash entries found for this period.</td></tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <tr key={idx} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 text-center text-xs font-mono text-slate-400">{idx + 1}</td>
                      <td className="p-3 text-xs font-mono text-slate-600">{row.date}</td>
                      <td className="p-3">
                        <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${row.debit > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {row.type}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-slate-500">{row.narration || '-'}</td>
                      <td className="p-3 text-right font-bold text-emerald-700">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                      <td className="p-3 text-right font-bold text-rose-700">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>

              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={4} className="p-4 text-left font-lora">TOTAL</td>
                  <td className="p-4 text-right text-emerald-800">{formatCurrency(result.cash_received)}</td>
                  <td className="p-4 text-right text-rose-800">{formatCurrency(result.cash_paid)}</td>
                  <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(result.cash_in_hand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

        </div>

        <ReportPrintPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          title="Daily Cash Book Report - Print Preview"
          orientation="portrait"
          onExportExcel={handleExportExcel}
        >
          {renderPrintableDocument()}
        </ReportPrintPreviewModal>
      </div>
  );
}

export default function ReportCashBookPage() {
  return (
    <AppLayout pageTitle="Cash Book of the Day">
      <ReportCashBookContent />
    </AppLayout>
  );
}
