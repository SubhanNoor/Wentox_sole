import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, Eye } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { BusinessLedgerSummaryRow, LedgerRow } from '@/lib/api';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import wentoxLogo from '@/assets/wentox_logo.png';

interface KhaataRow {
  date: string;
  type: string;
  invNo: string;
  billNo: string;
  narration: string;
  chequeNo?: string | null;
  chequeDate?: string | null;
  pairs: number;
  debit: number;
  credit: number;
  balance: number;
}

// Category badge — one constant style regardless of which category it is (matches the
// no-per-item-color rule applied elsewhere, e.g. Overall Search's Type column).
const CATEGORY_LABELS: Record<string, string> = {
  CUSTOMER: 'Customer',
  VENDOR: 'Vendor',
  EMPLOYEE: 'Employee',
  BANK: 'Bank',
  BUSINESS_ACCOUNT: 'Business Account',
};

interface ReportKhaataContentProps {
  /** 'customer' (default) scopes the directory to CUSTOMER accounts only — unchanged behaviour
   * for the existing Account Ledger tab. 'all' shows every business account regardless of
   * category (Business Ledger tab). */
  scope?: 'customer' | 'all';
}

export function ReportKhaataContent({ scope = 'customer' }: ReportKhaataContentProps) {
  const isAllScope = scope === 'all';

  const [accountBaId, setAccountBaId] = useState<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleCloseDetail = () => {
    setIsClosing(true);
    setTimeout(() => {
      setAccountBaId(null);
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
        setDirectory(isAllScope ? res.data : res.data.filter(a => a.category === 'CUSTOMER'));
      }
    });
  }, [isAllScope]);

  const selectedAccount = useMemo(() => directory.find(c => c.ba_id === accountBaId), [accountBaId, directory]);

  const loadLedger = useCallback(async () => {
    if (!accountBaId) return;
    setLoading(true);
    const res = await api.reports.accountLedger({ ba_id: accountBaId, date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok) setLedger(res.data); else setLedger(null);
    setLoading(false);
  }, [accountBaId, fromDate, toDate]);

  useEffect(() => { if (accountBaId) loadLedger(); }, [accountBaId, loadLedger]);

  const filteredAccounts = useMemo(() => {
    if (!accountSearch.trim()) return directory;
    const q = accountSearch.toLowerCase();
    return directory.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.main_account.toLowerCase().includes(q) ||
      (c.city_name || '').toLowerCase().includes(q) ||
      (isAllScope && (CATEGORY_LABELS[c.category] || c.category).toLowerCase().includes(q))
    );
  }, [directory, accountSearch, isAllScope]);

  // Opening Balance synthetic row + running balance — the backend already computes both.
  const runningKhaata = useMemo<KhaataRow[]>(() => {
    if (!ledger) return [];
    return [
      { date: fromDate ? `Before ${formatDate(fromDate)}` : '---', type: 'Opening Balance', invNo: '-', billNo: '-', narration: fromDate ? `Opening balance before ${formatDate(fromDate)}` : 'Opening Balance brought forward', chequeNo: undefined, chequeDate: undefined, pairs: 0, debit: 0, credit: 0, balance: ledger.opening_balance },
      ...ledger.rows.map(r => ({
        date: formatDate(r.date), type: r.type, invNo: r.inv_no != null ? String(r.inv_no) : String(r.entry_id), billNo: r.bill_no || '-', narration: r.narration || '',
        chequeNo: r.cheque_no, chequeDate: r.cheque_date ? formatDate(r.cheque_date) : undefined,
        pairs: r.pairs || 0, debit: r.debit, credit: r.credit, balance: r.balance,
      })),
    ];
  }, [ledger, fromDate]);

  const handleExportExcel = () => {
    if (!selectedAccount) return;
    const headers = ['Date', 'Type', 'Inv #', 'Bill #', 'Narration', 'Pairs', 'Debit (Rs.)', 'Credit (Rs.)', 'Balance (Rs.)'];
    const rows = runningKhaata.map(r => [
      r.date, r.type, r.invNo, r.billNo, r.narration, r.pairs, r.debit, r.credit, r.balance
    ]);
    exportRowsToExcel(`${isAllScope ? 'business' : 'khaata'}-ledger-${selectedAccount.name}`, headers, rows);
  };

  const printTitle = isAllScope ? 'BUSINESS LEDGER STATEMENT' : 'CUSTOMER KHAATA LEDGER STATEMENT';

  const renderPrintableReport = () => (
    <div className="excel-print-container">
      <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
        <div>
          <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>{printTitle}</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' }}>{selectedAccount?.name || (isAllScope ? 'All Accounts' : 'All Customers')}</p>
          <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
            Code: {selectedAccount?.code}
            {isAllScope && selectedAccount ? ` | Category: ${CATEGORY_LABELS[selectedAccount.category] || selectedAccount.category}` : ''}
            {' '}| City: {selectedAccount?.city_name || 'General'}
          </p>
          <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}</p>
          <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Date of Print: {formatDate(new Date())}</p>
        </div>
      </div>

      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Type</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Inv #</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Bill #</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Narration</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Pairs</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Debit (Dr)</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Credit (Cr)</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Balance (Rs.)</th>
          </tr>
        </thead>
        <tbody>
          {runningKhaata.map((row, idx) => (
            <tr key={idx} style={{ fontWeight: row.type === 'Opening Balance' ? 'bold' : 'normal', backgroundColor: row.type === 'Opening Balance' ? '#f9f9f9' : '#ffffff' }}>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{formatDate(row.date)}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{row.type}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', fontFamily: 'monospace' }}>{row.invNo}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center' }}>{row.billNo}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>
                {row.chequeNo ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', lineHeight: '1.5' }}>
                    <span><span style={{ color: '#888888', fontWeight: 'bold' }}>Cheque No:</span> {row.chequeNo}</span>
                    <span><span style={{ color: '#888888', fontWeight: 'bold' }}>Date:</span> {formatDate(row.chequeDate)}</span>
                  </div>
                ) : row.narration}
              </td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right' }}>{row.pairs > 0 ? row.pairs : '-'}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{formatCurrency(Math.abs(row.balance))}</td>
            </tr>
          ))}
          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
            <td colSpan={6} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(ledger?.total_debit || 0)}</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(ledger?.total_credit || 0)}</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(Math.abs(runningKhaata[runningKhaata.length - 1]?.balance || 0))}</td>
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
        <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
    </div>
  );

  return (
    <>
      <div className="mx-auto" style={{ maxWidth: 1000 }}>

        {/* 1. Accounts Directory View (When no account is selected) */}
        {!accountBaId ? (
          <>
            {/* Selection Bar / Search & Date filters */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <div className="relative flex-1 min-w-[280px]">
                <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Account:</span>
                <div className="relative">
                  <input
                    type="text"
                    placeholder={`Search by Code, Description, Main Account${isAllScope ? ', Category' : ''} or City...`}
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
                  <p className="text-xs text-slate-500 font-medium">Select an account row below to view its detailed statement ledger.</p>
                </div>
                <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                  Total: {filteredAccounts.length} Accounts
                </div>
              </div>

              <div className="card-white overflow-hidden border bg-white">
                <DataListTable<typeof filteredAccounts[number]>
                  rows={filteredAccounts}
                  rowKey={c => c.ba_id}
                  onRowClick={c => setAccountBaId(c.ba_id)}
                  emptyMessage="No accounts found matching your search."
                  columns={[
                    {
                      key: 'code',
                      header: 'Code',
                      width: '130px',
                      render: c => (
                        <span className="font-mono font-semibold text-slate-600 text-xs">{c.code}</span>
                      ),
                    },
                    {
                      key: 'name',
                      header: 'Account Name',
                      render: c => <span className="font-semibold text-slate-900">{c.name}</span>,
                    },
                    {
                      key: 'main_account',
                      header: 'Main Account',
                      render: c => (
                        <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">
                          {c.main_account}
                        </span>
                      ),
                    },
                    ...(isAllScope ? [{
                      key: 'category',
                      header: 'Category',
                      width: '140px',
                      render: (c: typeof filteredAccounts[number]) => (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-slate-100 text-slate-700 border-slate-300">
                          {CATEGORY_LABELS[c.category] || c.category}
                        </span>
                      ),
                    }] : []),
                    {
                      key: 'city',
                      header: 'City',
                      width: '150px',
                      render: c => (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/50 uppercase tracking-wider">
                          {c.city_name || 'General'}
                        </span>
                      ),
                    },
                    {
                      // businessLedger({view:'summary'}) has always returned closing_balance on every
                      // row; the directory just never showed it, so reading a bank or cash balance
                      // meant opening the statement one account at a time. Dr/Cr rather than
                      // Receivable/Payable because this list mixes customers, vendors, employees,
                      // banks and expense heads — the statement's own columns already say Dr/Cr.
                      key: 'balance',
                      header: 'Balance',
                      width: '160px',
                      align: 'right',
                      render: c => (
                        c.closing_balance === 0 ? (
                          <span className="text-xs font-mono text-slate-400">—</span>
                        ) : (
                          <span
                            className="text-xs font-mono font-bold"
                            style={{ color: c.closing_balance > 0 ? '#047857' : '#e11d48' }}
                          >
                            {formatCurrency(Math.abs(c.closing_balance))}
                          </span>
                        )
                      ),
                    },
                    {
                      key: 'statement',
                      header: '',
                      width: '140px',
                      align: 'right',
                      render: () => (
                        <span className="text-xs font-semibold text-[var(--brand-gold)]">
                          View Statement &rarr;
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </>
        ) : (
          /* 2. Specific Account Statement Ledger View */
          <div className={`transition-all duration-200 ${isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
            {/* Navigation & Action Card */}
            <div className="card-white p-5 bg-white border border-slate-200/80 rounded-2xl mb-6 shadow-2xs">
              {/* ROW 1: Back Button & Account Name (Left), Opening Balance (Right) */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 mb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleCloseDetail}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                  >
                    &larr; Back to Accounts Directory
                  </button>
                  <div className="text-sm font-semibold text-slate-700">
                    Viewing Ledger: <span className="font-lora font-bold text-slate-900 text-base ml-1">{selectedAccount?.name}</span>
                    {isAllScope && selectedAccount && (
                      <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-slate-100 text-slate-700 border-slate-300 align-middle">
                        {CATEGORY_LABELS[selectedAccount.category] || selectedAccount.category}
                      </span>
                    )}
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
                    onClick={() => setIsPreviewOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
                  >
                    <Eye size={15} /> Show Print Preview
                  </button>
                </div>
              </div>
            </div>

            {/* On-screen Statement Sheet */}
            <div className="card-white p-6 md:p-8 bg-white border">

              {/* Header details */}
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Business Accounts Ledger</p>
                </div>
                <div className="text-right">
                  <h2 className="font-lora font-semibold text-lg uppercase">Account Statement (Khaata)</h2>
                  <div className="text-sm font-semibold text-slate-700 mt-1">{selectedAccount?.name}</div>
                  <div className="text-xs text-slate-500 font-medium">
                    Account ID: {selectedAccount?.code} | City: {selectedAccount?.city_name || 'General'}
                  </div>
                  {(fromDate || toDate) && (
                    <div className="text-xs text-amber-700 font-semibold mt-0.5">
                      Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}
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
                            <td className="p-3 pl-4 font-semibold">{formatDate(row.date)}</td>
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
                                  <span><span className="text-slate-400">Date on Cheque:</span> {row.chequeDate ? formatDate(row.chequeDate) : '-'}</span>
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

      {/* Print Preview Modal — uses the real backend-computed ledger, not a client-side recompute */}
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={`${isAllScope ? 'Business Ledger' : 'Customer Khaata Ledger'} - ${selectedAccount?.name || ''}`}
        orientation="landscape"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableReport()}
      </ReportPrintPreviewModal>
    </>
  );
}

export default function ReportKhaataPage() {
  return (
    <AppLayout pageTitle="Customer Khaata Ledger">
      <ReportKhaataContent />
    </AppLayout>
  );
}
