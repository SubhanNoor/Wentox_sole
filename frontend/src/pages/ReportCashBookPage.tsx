import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { CashBookResult } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The five figures the client's cash book closes with, in their order. Cash only, by design:
// cheque/online rows are listed for visibility and never reach these (see
// backend reports.service.js#cashBook).
function summaryLines(result: CashBookResult): [string, number, boolean][] {
  return [
    ['Opening Cash', result.opening_cash, true],
    ['Cash Received (Jamma)', result.cash_received, false],
    ['Total Cash', result.total_cash, false],
    ['Cash Paid (Naam)', result.cash_paid, false],
    ['Cash In Hand', result.cash_in_hand, true],
  ];
}

export function ReportCashBookContent() {
  const [filterBy, setFilterBy] = useState<'date' | 'month'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [specificDate, setSpecificDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  const [result, setResult] = useState<CashBookResult>({
    opening_cash: 0, cash_received: 0, total_cash: 0, cash_paid: 0, cash_in_hand: 0,
    totals: { receipt_bank: 0, payment_bank: 0, receipt_cash: 0, payment_cash: 0 },
    unposted_totals: { receipt_bank: 0, payment_bank: 0, receipt_cash: 0, payment_cash: 0 },
    rows: [], bank_transfers: [], cheque_deposits: [],
  });
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const periodLabel = filterBy === 'date' ? specificDate : `${MONTHS[filterMonth]} ${filterYear}`;

  // Computed from the server's own totals, not the filtered view: a search box narrowing the rows
  // must not make a balanced book look broken.
  // Outgoing amounts print as red parentheses via formatCurrency's negative branch. Negating a
  // ZERO total would yield -0, which is NOT < 0, so it slips past that branch and prints the
  // nonsense "Rs -0" (seen by the user on an empty Payments column, 2026-08-31).
  const outgoing = (v: number) => (v === 0 ? 0 : -v);

  // Both legs of every posting are listed and counted, so each pair must tie Receipts against
  // Payments. Shown rather than assumed: if it ever doesn't, a document posted only one side.
  // Defaulted, never read through directly: an older main process (Electron does not hot-reload
  // it) returns a payload without this field, and reading through it blanked the whole page behind
  // the error boundary — "Cannot read properties of undefined (reading 'receipt_bank')".
  const unpostedTotals = result.unposted_totals ?? { receipt_bank: 0, payment_bank: 0, receipt_cash: 0, payment_cash: 0 };
  const hasUnposted = result.rows.some(r => !r.is_posted);
  const cashTies = result.totals.receipt_cash === result.totals.payment_cash;
  const bankTies = result.totals.receipt_bank === result.totals.payment_bank;


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
      r.account_name.toLowerCase().includes(q) ||
      (r.remarks || '').toLowerCase().includes(q) ||
      (r.cheque_no || '').toLowerCase().includes(q) ||
      r.mode.toLowerCase().includes(q)
    );
  }, [result.rows, searchQuery]);

  // A month view spans many days, so it gets a Date column the single-date layout has no use for.
  const showDate = filterBy === 'month';

  const handleExportExcel = () => {
    const headers = [
      'No.', 'Status', 'From / To', 'Account Name', 'Remarks',
      ...(showDate ? ['Date'] : []),
      'Type', 'Cheque No',
      'Receipts Cheq./Online', 'Payments Cheq./Online', 'Receipts Cash', 'Payments Cash',
    ];
    // Amounts stay RAW NUMBERS here, unlike the screen and print views: Excel has to be able to
    // sum the columns, and "(Rs 3,500)" is text. The sign carries the direction instead.
    const rows = filteredRows.map((row) => [
      row.is_first_of_txn ? row.txn_seq : '', row.is_posted ? 'Posted' : 'Unposted', row.side, row.account_name, row.remarks,
      ...(showDate ? [formatDate(row.date)] : []),
      row.mode, row.cheque_no || '',
      row.receipt_bank, row.payment_bank ? -row.payment_bank : 0,
      row.receipt_cash, row.payment_cash ? -row.payment_cash : 0,
    ]);
    exportRowsToExcel(`cash-book-${periodLabel}`, headers, rows);
  };

  const renderPrintableDocument = () => {
    const th = (align: 'left' | 'center' | 'right', width: string) => ({
      border: '1px solid #000000', padding: '6px', fontSize: '10px', backgroundColor: '#f2f2f2',
      fontWeight: 'bold' as const, textAlign: align, width,
    });
    const td = (align: 'left' | 'center' | 'right') => ({
      border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: align,
    });

    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>DAILY CASH BOOK REPORT</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {periodLabel}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={th('center', '4%')}>S#</th>
              <th style={th('left', showDate ? '18%' : '20%')}>Account Name</th>
              <th style={th('left', showDate ? '14%' : '16%')}>Remarks</th>
              {showDate && <th style={th('left', '9%')}>Date</th>}
              <th style={th('left', '7%')}>Type</th>
              <th style={th('left', '9%')}>Cheque No</th>
              <th style={th('right', '11.75%')}>Receipts<br />Cheq./Online</th>
              <th style={th('right', '11.75%')}>Payments<br />Cheq./Online</th>
              <th style={th('right', '11.75%')}>Receipts<br />Cash</th>
              <th style={th('right', '11.75%')}>Payments<br />Cash</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ ...td('center'), fontFamily: 'monospace' }}>{row.is_first_of_txn ? row.txn_seq : ''}</td>
                <td style={{ ...td('left'), fontWeight: 'bold', paddingLeft: row.side === 'TO' ? '18px' : '6px', fontStyle: row.is_posted ? 'normal' : 'italic' }}>
                  <span style={{ fontSize: '8px', fontWeight: 'bold', color: row.side === 'FROM' ? '#e11d48' : '#047857', marginRight: '5px' }}>
                    {row.side === 'FROM' ? 'FROM' : '\u21b3 TO'}
                  </span>
                  {row.account_name}
                  {/* Printed too — a paper cash book that silently mixes posted and unposted money
                      is worse than one that doesn't list drafts at all. */}
                  {!row.is_posted && row.is_first_of_txn && (
                    <span style={{ fontSize: '8px', fontWeight: 'bold', marginLeft: '5px', color: '#92400e' }}>(UNPOSTED)</span>
                  )}
                </td>
                <td style={td('left')}>{row.remarks || '—'}</td>
                {showDate && <td style={{ ...td('left'), fontFamily: 'monospace' }}>{formatDate(row.date)}</td>}
                <td style={td('left')}>{row.mode}</td>
                <td style={{ ...td('left'), fontFamily: 'monospace' }}>{row.cheque_no || '—'}</td>
                <td style={{ ...td('right'), fontFamily: 'monospace', color: '#047857' }}>{row.receipt_bank > 0 ? formatCurrency(row.receipt_bank) : '-'}</td>
                <td style={{ ...td('right'), fontFamily: 'monospace', color: '#e11d48' }}>{row.payment_bank > 0 ? formatCurrency(-row.payment_bank) : '-'}</td>
                <td style={{ ...td('right'), fontFamily: 'monospace', fontWeight: 'bold', color: '#047857' }}>{row.receipt_cash > 0 ? formatCurrency(row.receipt_cash) : '-'}</td>
                <td style={{ ...td('right'), fontFamily: 'monospace', fontWeight: 'bold', color: '#e11d48' }}>{row.payment_cash > 0 ? formatCurrency(-row.payment_cash) : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={showDate ? 6 : 5} style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold' }}>Totals :</td>
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(result.totals.receipt_bank)}</td>
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{formatCurrency(outgoing(result.totals.payment_bank))}</td>
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(result.totals.receipt_cash)}</td>
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{formatCurrency(outgoing(result.totals.payment_cash))}</td>
            </tr>
          </tfoot>
        </table>

        {/* Cash summary — at the end of the report, as on the client's own cash book. */}
        <div style={{ maxWidth: '340px', border: '1px solid #000000', marginBottom: '15px' }}>
          {summaryLines(result).map(([label, value, emphasise], idx) => (
            <div
              key={label}
              style={{
                display: 'flex', justifyContent: 'space-between', padding: '5px 10px',
                borderTop: idx === 0 ? 'none' : '1px solid #d4d4d4',
                backgroundColor: emphasise ? '#f2f2f2' : 'transparent',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: emphasise ? 'bold' : 'normal' }}>{label} :</span>
              <span style={{ fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(value)}</span>
            </div>
          ))}
        </div>

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
  };

  const colCount = showDate ? 10 : 9;

  return (
      <div className="mx-auto" style={{ maxWidth: 1250 }}>

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
                  placeholder="Search by account, remarks, cheque no..."
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
                      options={MONTHS.map((m, idx) => ({ value: String(idx), label: m }))}
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

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm" style={{ minWidth: 1000 }}>
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4 text-center w-12">S#</th>
                  <th className="p-3">Account Name</th>
                  <th className="p-3">Remarks</th>
                  {showDate && <th className="p-3">Date</th>}
                  <th className="p-3">Type</th>
                  <th className="p-3">Cheque No</th>
                  <th className="p-3 text-right">Receipts<br />Cheq./Online</th>
                  <th className="p-3 text-right">Payments<br />Cheq./Online</th>
                  <th className="p-3 text-right">Receipts<br />Cash</th>
                  <th className="p-3 text-right">Payments<br />Cash</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={colCount} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={colCount} className="text-center p-8 text-slate-400">No cash entries found for this period.</td></tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    // A transaction is a FROM row immediately followed by its TO row. The pair is
                    // kept visually together by hanging the S# and the top border on the FROM row
                    // only, so the eye reads "this money left here -> and landed here" as one unit
                    // instead of two unrelated lines.
                    <tr
                      key={idx}
                      className={`hover:bg-slate-50/50 ${row.is_first_of_txn ? 'border-t' : ''}`}
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      <td className="p-3 pl-4 text-center text-xs font-mono text-slate-400">
                        {row.is_first_of_txn ? row.txn_seq : ''}
                      </td>
                      <td className={`p-3 ${row.side === 'TO' ? 'pl-7' : ''}`}>
                        <span className={`inline-block w-11 shrink-0 text-[9px] font-bold uppercase tracking-wider ${row.side === 'FROM' ? 'text-rose-500' : 'text-emerald-600'}`}>
                          {row.side === 'FROM' ? 'From' : '\u21b3 To'}
                        </span>
                        <span className={row.is_posted ? 'font-semibold text-slate-800' : 'font-semibold text-slate-500 italic'}>{row.account_name}</span>
                        {/* Only on the first line of an unposted entry, so the pair reads as one
                            thing rather than repeating the badge. Money that has not moved has to
                            be distinguishable at a glance from money that has. */}
                        {!row.is_posted && row.is_first_of_txn && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 text-amber-800 align-middle">
                            Unposted
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-slate-500">{row.remarks || '-'}</td>
                      {showDate && <td className="p-3 text-xs font-mono text-slate-600">{formatDate(row.date)}</td>}
                      <td className="p-3">
                        <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${row.affects_cash ? 'bg-slate-100 text-slate-700' : 'bg-sky-50 text-sky-700'}`}>
                          {row.mode}
                        </span>
                      </td>
                      <td className="p-3 text-xs font-mono text-slate-500">{row.cheque_no || '-'}</td>
                      <td className="p-3 text-right text-emerald-700">{row.receipt_bank > 0 ? formatCurrency(row.receipt_bank) : '-'}</td>
                      <td className="p-3 text-right text-rose-700">{row.payment_bank > 0 ? formatCurrency(-row.payment_bank) : '-'}</td>
                      <td className="p-3 text-right font-bold text-emerald-700">{row.receipt_cash > 0 ? formatCurrency(row.receipt_cash) : '-'}</td>
                      <td className="p-3 text-right font-bold text-rose-700">{row.payment_cash > 0 ? formatCurrency(-row.payment_cash) : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>

              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={showDate ? 6 : 5} className="p-4 text-right font-lora">TOTALS</td>
                  <td className="p-4 text-right text-emerald-800">{formatCurrency(result.totals.receipt_bank)}</td>
                  <td className="p-4 text-right text-rose-800">{formatCurrency(outgoing(result.totals.payment_bank))}</td>
                  <td className="p-4 text-right text-emerald-800">{formatCurrency(result.totals.receipt_cash)}</td>
                  <td className="p-4 text-right text-rose-800">{formatCurrency(outgoing(result.totals.payment_cash))}</td>
                </tr>
                {/* Each pair must tie, since both legs are listed. If one ever doesn't, a document
                    posted a single side and this says so rather than printing a wrong total. */}
                <tr className="text-[11px] font-semibold" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={showDate ? 6 : 5} className="px-4 pb-1 text-right text-slate-400 uppercase tracking-wider">Balanced</td>
                  <td colSpan={2} className={`px-4 pb-1 text-center ${bankTies ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {bankTies ? '\u2713 Cheq./Online ties' : `\u26a0 out by ${formatCurrency(result.totals.receipt_bank - result.totals.payment_bank)}`}
                  </td>
                  <td colSpan={2} className={`px-4 pb-1 text-center ${cashTies ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {cashTies ? '\u2713 Cash ties' : `\u26a0 out by ${formatCurrency(result.totals.receipt_cash - result.totals.payment_cash)}`}
                  </td>
                </tr>
                {/* Splits out the part of each column that hasn't been posted, so the posted-only
                    figure stays readable — otherwise listing drafts would silently inflate a total
                    the drawer summary below is read against. Hidden when everything is posted. */}
                {hasUnposted && (
                  <tr className="text-[11px] font-semibold text-amber-700">
                    <td colSpan={showDate ? 6 : 5} className="px-4 pb-1 text-right uppercase tracking-wider">of which unposted</td>
                    <td className="px-4 pb-1 text-right">{unpostedTotals.receipt_bank ? formatCurrency(unpostedTotals.receipt_bank) : '-'}</td>
                    <td className="px-4 pb-1 text-right">{unpostedTotals.payment_bank ? formatCurrency(outgoing(unpostedTotals.payment_bank)) : '-'}</td>
                    <td className="px-4 pb-1 text-right">{unpostedTotals.receipt_cash ? formatCurrency(unpostedTotals.receipt_cash) : '-'}</td>
                    <td className="px-4 pb-1 text-right">{unpostedTotals.payment_cash ? formatCurrency(outgoing(unpostedTotals.payment_cash)) : '-'}</td>
                  </tr>
                )}

                {/* Why these totals differ from the summary box inches below them. Deliberately
                    states no ratio: the columns sum both legs of every entry, the drawer sums
                    debits and credits on the cash account alone, and those two measures have no
                    fixed relationship (a "twice the drawer" rule held on one day here purely
                    because that day had one entry each way). */}
                <tr className="text-[10px]">
                  <td colSpan={showDate ? 10 : 9} className="px-4 pb-3 text-right text-slate-400">
                    Columns count both sides of every entry{hasUnposted ? ', posted and unposted alike' : ''}.
                    {' '}Cash Received / Cash Paid below count only what actually entered or left the
                    {' '}cash drawer{hasUnposted ? ' — so nothing unposted reaches them' : ''}, so the two differ by design.
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Cash summary — closes the report, as on the client's own cash book. Cash only: the
              cheque/online rows above are listed for visibility and change none of these figures. */}
          <div className="mt-8 max-w-sm rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
            {summaryLines(result).map(([label, value, emphasise], idx) => (
              <div
                key={label}
                className={`flex items-center justify-between px-4 py-2.5 ${idx > 0 ? 'border-t' : ''} ${emphasise ? 'bg-slate-50' : 'bg-white'}`}
                style={{ borderColor: 'var(--border-table)' }}
              >
                <span className={`text-xs uppercase tracking-wider ${emphasise ? 'font-bold text-slate-700' : 'font-semibold text-slate-500'}`}>
                  {label}
                </span>
                <span
                  className="text-sm font-bold font-mono"
                  style={{ color: emphasise ? 'var(--brand-navy)' : '#334155' }}
                >
                  {formatCurrency(value)}
                </span>
              </div>
            ))}
          </div>

          {/* CB-01: bank-to-bank transfers, informational only — no cash moved, so they change
              nothing above. */}
          {result.bank_transfers.length > 0 && (
            <div className="mt-8">
              <h3 className="font-lora font-semibold text-sm text-slate-700 mb-2 uppercase tracking-wide">Bank Transfers</h3>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      {showDate && <th className="p-3 pl-4">Date</th>}
                      <th className="p-3">From</th>
                      <th className="p-3">To</th>
                      <th className="p-3">Remarks</th>
                      <th className="p-3 text-right pr-4">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.bank_transfers.map((t, idx) => (
                      <tr key={idx} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                        {showDate && <td className="p-3 pl-4 text-xs font-mono text-slate-600">{formatDate(t.date)}</td>}
                        <td className="p-3 font-semibold text-slate-800">{t.from_name}</td>
                        <td className="p-3 font-semibold text-slate-800">{t.to_name}</td>
                        <td className="p-3 text-xs text-slate-500">{t.remarks || '-'}</td>
                        <td className="p-3 text-right pr-4 font-mono font-semibold text-slate-700">{formatCurrency(t.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CB-03: cheques deposited/banked that day — informational only, alongside the
              Issued/Endorsed/Received cheque events already in the main grid above. */}
          {result.cheque_deposits.length > 0 && (
            <div className="mt-8">
              <h3 className="font-lora font-semibold text-sm text-slate-700 mb-2 uppercase tracking-wide">Cheques Deposited</h3>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      {showDate && <th className="p-3 pl-4">Date</th>}
                      <th className="p-3">Cheque No</th>
                      <th className="p-3">From</th>
                      <th className="p-3">Deposited To</th>
                      <th className="p-3 text-right pr-4">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.cheque_deposits.map((d, idx) => (
                      <tr key={idx} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                        {showDate && <td className="p-3 pl-4 text-xs font-mono text-slate-600">{formatDate(d.date)}</td>}
                        <td className="p-3 text-xs font-mono text-slate-500">{d.cheque_no || '-'}</td>
                        <td className="p-3 font-semibold text-slate-800">{d.payer_name}</td>
                        <td className="p-3 text-slate-700">{d.bank_name || '-'}</td>
                        <td className="p-3 text-right pr-4 font-mono font-semibold text-slate-700">{formatCurrency(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        <ReportPrintPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          title="Daily Cash Book Report - Print Preview"
          orientation="landscape"
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
