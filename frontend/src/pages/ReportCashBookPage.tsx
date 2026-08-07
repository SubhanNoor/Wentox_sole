import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Printer, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import * as api from '@/lib/api';
import type { CashBookResult } from '@/lib/api';

export function ReportCashBookContent() {
  const [filterBy, setFilterBy] = useState<'date' | 'month'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [specificDate, setSpecificDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  const [result, setResult] = useState<CashBookResult>({ opening_cash: 0, cash_received: 0, total_cash: 0, cash_paid: 0, cash_in_hand: 0, rows: [] });
  const [loading, setLoading] = useState(false);

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
            <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9">
              <Printer size={16} /> Print Cash Book
            </button>
            <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9">
              <FileDown size={16} /> Export PDF
            </button>
            <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9">
              <FileSpreadsheet size={16} /> Export Excel
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
              <span className="text-base font-bold text-slate-800">{formatCurrency(result.opening_cash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Cash Received (Jamma)</span>
              <span className="text-base font-bold text-emerald-700">{formatCurrency(result.cash_received)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Cash</span>
              <span className="text-base font-bold text-slate-800">{formatCurrency(result.total_cash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Cash Paid (Naam)</span>
              <span className="text-base font-bold text-rose-700">{formatCurrency(result.cash_paid)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-[#111c2a]" style={{ borderColor: '#B08D57' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-300 mb-1">Cash In Hand</span>
              <span className="text-lg font-bold text-[#B08D57]">{formatCurrency(result.cash_in_hand)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">No.</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Narration</th>
                  <th className="p-3 text-right">Cash Received</th>
                  <th className="p-3 text-right">Cash Paid</th>
                  <th className="p-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-slate-400">
                      No cash book entries found for this selection.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <tr key={row.entry_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono text-slate-500">{idx + 1}</td>
                      <td className="p-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border uppercase">
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
                  <td colSpan={3} className="p-4 text-left font-lora">TOTAL</td>
                  <td className="p-4 text-right text-emerald-800">{formatCurrency(result.cash_received)}</td>
                  <td className="p-4 text-right text-rose-800">{formatCurrency(result.cash_paid)}</td>
                  <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(result.cash_in_hand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

        </div>

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
