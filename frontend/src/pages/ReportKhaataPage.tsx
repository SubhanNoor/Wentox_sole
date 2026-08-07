import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { BusinessLedgerSummaryRow, LedgerRow } from '@/lib/api';

export function ReportKhaataContent() {
  const [customerBaId, setCustomerBaId] = useState<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');

  const handleCloseDetail = () => {
    setIsClosing(true);
    setTimeout(() => {
      setCustomerBaId(null);
      setIsClosing(false);
    }, 200);
  };
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  const [directory, setDirectory] = useState<BusinessLedgerSummaryRow[]>([]);
  const [ledger, setLedger] = useState<{ opening_balance: number; rows: LedgerRow[]; total_debit: number; total_credit: number; closing_balance: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.reports.businessLedger({ view: 'summary' }).then(res => {
      if (res.ok && Array.isArray(res.data)) {
        setDirectory(res.data.filter(a => a.category === 'CUSTOMER'));
      }
    });
  }, []);

  const selectedCustomer = useMemo(() => directory.find(c => c.ba_id === customerBaId), [customerBaId, directory]);

  const loadLedger = useCallback(async () => {
    if (!customerBaId) return;
    setLoading(true);
    const res = await api.reports.accountLedger({ ba_id: customerBaId, date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok) setLedger(res.data); else setLedger(null);
    setLoading(false);
  }, [customerBaId, fromDate, toDate]);

  useEffect(() => { if (customerBaId) loadLedger(); }, [customerBaId, loadLedger]);

  const filteredCustomers = useMemo(() => {
    if (!accountSearch.trim()) return directory;
    const q = accountSearch.toLowerCase();
    return directory.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.main_account.toLowerCase().includes(q) ||
      (c.city_name || '').toLowerCase().includes(q)
    );
  }, [directory, accountSearch]);

  // Opening Balance synthetic row + running balance — the backend already computes both.
  const runningKhaata = useMemo(() => {
    if (!ledger) return [];
    return [
      { date: fromDate ? `Before ${fromDate}` : '---', type: 'Opening Balance', invNo: '-', billNo: '-', narration: fromDate ? `Opening balance before ${fromDate}` : 'Opening Balance brought forward', chequeNo: undefined as string | null | undefined, chequeDate: undefined as string | null | undefined, chequeReceivedDate: undefined as string | null | undefined, pairs: 0, debit: 0, credit: 0, balance: ledger.opening_balance },
      ...ledger.rows.map(r => ({
        date: r.date, type: r.type, invNo: r.inv_no != null ? String(r.inv_no) : String(r.entry_id), billNo: r.bill_no || '-', narration: r.narration || '',
        chequeNo: r.cheque_no, chequeDate: r.cheque_date, chequeReceivedDate: r.cheque_received_date,
        pairs: r.pairs || 0, debit: r.debit, credit: r.credit, balance: r.balance,
      })),
    ];
  }, [ledger, fromDate]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Type', 'Inv #', 'Bill #', 'Narration', 'Pairs', 'Debit', 'Credit', 'Balance'];
    const rows = runningKhaata.map(row => [
      row.date, row.type, row.invNo, row.billNo,
      row.chequeNo ? `Cheque ${row.chequeNo} / ${row.chequeDate} / Recv ${row.chequeReceivedDate}` : row.narration,
      row.pairs, row.debit, row.credit, row.balance
    ]);
    exportRowsToExcel(`account-ledger-${selectedCustomer?.name || 'export'}`, headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1000 }}>

        {/* 1. Accounts Directory View (When no customer is selected) */}
        {!customerBaId ? (
          <>
            {/* Selection Bar / Search & Date filters - data-no-print */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="relative flex-1 min-w-[280px]">
                <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Account:</span>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by Code, Description, Main Account or City..."
                    value={accountSearch}
                    onChange={e => setAccountSearch(e.target.value)}
                    className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                  />
                  <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                </div>
              </div>

              {/* Date Filters */}
              <div className="flex items-center gap-3">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">From Date:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="soleria-input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">To Date:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="soleria-input py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* List directory grid of cards */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">Accounts Directory</h3>
                  <p className="text-xs text-slate-500 font-medium">Select an account card below to view its detailed statement ledger.</p>
                </div>
                <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                  Total: {filteredCustomers.length} Accounts
                </div>
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="card-white p-12 text-center text-slate-400 border bg-white">
                  No accounts found matching your search.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCustomers.map(c => {
                    const initialLetter = c.name.charAt(0).toUpperCase();

                    return (
                      <div
                        key={c.ba_id}
                        onClick={() => setCustomerBaId(c.ba_id)}
                        className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                      >
                        <div>
                          {/* Card Top: Code & City badge */}
                          <div className="flex items-center justify-between mb-3.5">
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                              Code: {c.code}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/50 uppercase tracking-wider">
                              {c.city_name || 'General'}
                            </span>
                          </div>

                          {/* Card Middle: Avatar circle + Name */}
                          <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                              {initialLetter}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                                {c.name}
                              </h4>
                              <p className="text-[11px] text-slate-400 font-medium mt-0.5 uppercase tracking-wider truncate">
                                {c.main_account}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Card Bottom: Action indicator */}
                        <div className="border-t pt-3 mt-1 flex items-center justify-between text-xs font-semibold text-slate-400 group-hover:text-[#B08D57] transition-colors">
                          <span>View Statement</span>
                          <span className="text-sm font-bold group-hover:translate-x-1 transition-transform">&rarr;</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* 2. Specific Account Statement Ledger View */
          <div className={`transition-all duration-200 ${isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
            {/* Navigation & Action Card - data-no-print */}
            <div className="card-white p-5 bg-white border border-slate-200/80 rounded-2xl mb-6 shadow-2xs" data-no-print>
              {/* ROW 1: Back Button & Customer Name (Left), Opening Balance (Right) */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 mb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleCloseDetail}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                  >
                    &larr; Back to Accounts Directory
                  </button>
                  <div className="text-sm font-semibold text-slate-700">
                    Viewing Ledger: <span className="font-lora font-bold text-slate-900 text-base ml-1">{selectedCustomer?.name}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Opening Balance:</span>
                  <span className="font-bold font-mono text-sm text-[var(--brand-gold)]">
                    {formatCurrency(Math.abs(runningKhaata[0]?.balance || 0))}
                  </span>
                </div>
              </div>

              {/* ROW 2: Date Filters (Left), Print & Export Buttons (Right) */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={e => setFromDate(e.target.value)}
                      className="soleria-input py-1.5 px-3 text-xs font-semibold"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={e => setToDate(e.target.value)}
                      className="soleria-input py-1.5 px-3 text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.print()}
                    className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
                  >
                    <Printer size={14} /> Print Statement
                  </button>
                  <button
                    onClick={exportToPDF}
                    className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
                  >
                    <FileDown size={14} /> Export PDF
                  </button>
                  <button
                    onClick={handleExportExcel}
                    className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
                  >
                    <FileSpreadsheet size={14} /> Export Excel
                  </button>
                </div>
              </div>
            </div>

            {/* Printable Statement Sheet */}
            <div className="card-white p-6 md:p-8 bg-white border">

              {/* Header details */}
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Business Accounts Ledger</p>
                </div>
                <div className="text-right">
                  <h2 className="font-lora font-semibold text-lg uppercase">Account Statement (Khaata)</h2>
                  <div className="text-sm font-semibold text-slate-700 mt-1">{selectedCustomer?.name}</div>
                  <div className="text-xs text-slate-500 font-medium">
                    Account ID: {selectedCustomer?.code} | City: {selectedCustomer?.city_name || 'General'}
                  </div>
                  {(fromDate || toDate) && (
                    <div className="text-xs text-amber-700 font-semibold mt-0.5">
                      Period: {fromDate || 'Start'} to {toDate || 'End'}
                    </div>
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-center">Inv #</th>
                      <th className="p-3 text-center">Bill #</th>
                      <th className="p-3" style={{ minWidth: '220px' }}>Narration</th>
                      <th className="p-3 text-center">Pairs</th>
                      <th className="p-3 text-right">Debit (Dr)</th>
                      <th className="p-3 text-right">Credit (Cr)</th>
                      <th className="p-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={9} className="text-center p-8 text-slate-400">Loading…</td></tr>
                    ) : runningKhaata.length === 1 && runningKhaata[0].balance === 0 && runningKhaata[0].debit === 0 && runningKhaata[0].credit === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center p-8 text-slate-400">
                          No ledger entries found matching selection or date range.
                        </td>
                      </tr>
                    ) : (
                      runningKhaata.map((row, idx) => {
                        const displayBal = Math.abs(row.balance);
                        const isRed = row.credit > 0;

                        return (
                          <tr
                            key={idx}
                            className={`border-b ${row.type === 'Opening Balance' ? 'bg-slate-50 font-medium text-slate-700' : isRed ? 'text-rose-700 hover:bg-rose-50/30' : 'text-slate-700 hover:bg-slate-50/30'}`}
                            style={{ borderColor: 'var(--border-table)' }}
                          >
                            <td className="p-3 pl-4 font-semibold">{row.date}</td>
                            <td className="p-3">
                              <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold ${row.type === 'Sale Bill' ? 'bg-rose-50 text-rose-700' : row.type === 'Receipt (Jamma)' ? 'bg-emerald-50 text-emerald-700' : row.type === 'Sale Return' ? 'bg-blue-50 text-blue-700' : row.type === 'Commission' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                                {row.type}
                              </span>
                            </td>
                            <td className="p-3 text-center font-mono text-xs">{row.invNo}</td>
                            <td className="p-3 text-center font-medium">{row.billNo}</td>
                            <td className="p-3 text-xs font-medium">
                              {row.chequeNo ? (
                                <div className="flex flex-col gap-0.5">
                                  <span><span className="text-slate-400">Cheque No:</span> {row.chequeNo}</span>
                                  <span><span className="text-slate-400">Date on Cheque:</span> {row.chequeDate}</span>
                                  <span><span className="text-slate-400">Received:</span> {row.chequeReceivedDate}</span>
                                </div>
                              ) : (
                                row.narration
                              )}
                            </td>
                            <td className="p-3 text-center text-slate-600 font-medium">{row.pairs > 0 ? row.pairs : '-'}</td>
                            <td className="p-3 text-right text-rose-700 font-bold">
                              {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                            </td>
                            <td className="p-3 text-right text-emerald-700 font-bold">
                              {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                            </td>
                            <td className="p-3 text-right font-bold text-slate-800">
                              {formatCurrency(displayBal)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={6} className="p-4 text-left font-lora">TOTAL</td>
                      <td className="p-4 text-right text-rose-800">{formatCurrency(ledger?.total_debit || 0)}</td>
                      <td className="p-4 text-right text-emerald-800">{formatCurrency(ledger?.total_credit || 0)}</td>
                      <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>
                        {formatCurrency(Math.abs(runningKhaata[runningKhaata.length - 1]?.balance || 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

export default function ReportKhaataPage() {
  return (
    <AppLayout pageTitle="Accounts Ledger / Khaata">
      <ReportKhaataContent />
    </AppLayout>
  );
}
