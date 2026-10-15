import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { formatDate, formatDateTime, getTodayDate, getMonthStartDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { CashBookResult } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import { REPORT_COLORS } from '@/components/reports/reportColors';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';

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
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  // By Date / By Month / Between Two Dates (the third mode per the user, 2026-10-15).
  const [filterBy, setFilterBy] = useState<'date' | 'month' | 'range'>(() => (getWindowParam('filterBy') as 'date' | 'month' | 'range') || 'date');
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getMonthStartDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [searchQuery, setSearchQuery] = useState(() => getWindowParam('searchQuery') || '');
  const [specificDate, setSpecificDate] = useState(() => getWindowParam('specificDate') || new Date().toISOString().split('T')[0]);
  const [filterMonth, setFilterMonth] = useState<number>(() => { const p = getWindowParam('filterMonth'); return p != null ? Number(p) : new Date().getMonth(); });
  const [filterYear, setFilterYear] = useState<number>(() => { const p = getWindowParam('filterYear'); return p != null ? Number(p) : new Date().getFullYear(); });

  const [result, setResult] = useState<CashBookResult>({
    opening_cash: 0, cash_received: 0, total_cash: 0, cash_paid: 0, cash_in_hand: 0,
    totals: { receipt_bank: 0, payment_bank: 0, receipt_cash: 0, payment_cash: 0 },
    rows: [], bank_transfers: [], cheque_deposits: [],
  });
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // G-03 (changes-14-09-26.md): mounts fresh whenever this Reports Hub tab becomes active, so a
  // mount-only effect covers both "page opens here" and "user switches to this tab".
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => searchRef.current?.focus()); }, []);

  // formatDate, not the raw value: specificDate is the ISO string the <input type="date"> holds,
  // so the printed header read "Period: 2026-08-31" while every other date on the page is
  // dd/mm/yyyy.
  const periodLabel = filterBy === 'date' ? formatDate(specificDate)
    : filterBy === 'range' ? `${formatDate(fromDate)} to ${formatDate(toDate)}`
    : `${MONTHS[filterMonth]} ${filterYear}`;

  // Computed from the server's own totals, not the filtered view: a search box narrowing the rows
  // must not make a balanced book look broken.
  // Outgoing amounts print as red parentheses via formatCurrency's negative branch. Negating a
  // ZERO total would yield -0, which is NOT < 0, so it slips past that branch and prints the
  // nonsense "Rs -0" (seen by the user on an empty Payments column, 2026-08-31).
  const outgoing = (v: number) => (v === 0 ? 0 : -v);

  // Both legs of every posting are listed and counted, so each pair must tie Receipts against
  // Payments. Shown rather than assumed: if it ever doesn't, a document posted only one side.
  const hasUnposted = result.rows.some(r => !r.is_posted);

  // Two invariants from the client's own cash book, checked rather than assumed:
  //   - the cheque/online pair ALWAYS balances (a cheque leaves one account and lands in another)
  //   - Cash Received / Cash Paid ARE the cash columns, unposted included
  // The two cash columns are NOT expected to equal each other; the gap is the day's net movement.
  const bankTies = result.totals.receipt_bank === result.totals.payment_bank;
  const summaryTies = result.cash_received === result.totals.receipt_cash
    && result.cash_paid === result.totals.payment_cash;


  const load = useCallback(async () => {
    setLoading(true);
    const payload = filterBy === 'date'
      ? { date: specificDate }
      : filterBy === 'range'
        ? { date_from: fromDate, date_to: toDate }
        : { month: `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}` };
    // A half-typed or reversed range: keep showing the last book rather than asking for nonsense.
    if (filterBy === 'range' && (!fromDate || !toDate || fromDate > toDate)) { setLoading(false); return; }
    const res = await api.reports.cashBook(payload);
    if (res.ok) setResult(res.data);
    setLoading(false);
    setHasLoadedOnce(true);
  }, [filterBy, specificDate, filterMonth, filterYear, fromDate, toDate]);

  useEffect(() => { load(); }, [load, dataVersion]);

  // "Show Print Preview" opens a new window landing on this same filtered report (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    const params: Record<string, string> = { filterBy, searchQuery, autoPreview: '1' };
    if (filterBy === 'date') params.specificDate = specificDate;
    else if (filterBy === 'range') { params.fromDate = fromDate; params.toDate = toDate; }
    else { params.filterMonth = String(filterMonth); params.filterYear = String(filterYear); }
    api.openWindow('reports', 'cash-book', params);
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once the
  // first load has actually finished (see `load()`'s own `setHasLoadedOnce(true)` above; `loading`
  // starts false before `load()` has run even once, so watching it alone would fire immediately).
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

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

  // A month or a range spans many days, so it gets a Date column the single-date layout has no use for.
  const showDate = filterBy === 'month' || (filterBy === 'range' && fromDate !== toDate);

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
    // Tight single-line rows, matching the client's own printed book — 26 entries to a page there.
    // The height was coming from wrapping, not padding: a long remark ("Endorsement reversal of
    // allocation #1005 — Unposted expense #14") ran to three lines and dragged its whole row with
    // it. So every cell is nowrap + ellipsis, and the padding comes down to match.
    const th = (align: 'left' | 'center' | 'right', width: string) => ({
      border: '1px solid #000000', padding: '3px 5px', fontSize: '9.5px', backgroundColor: '#f2f2f2',
      fontWeight: 'bold' as const, textAlign: align, width,
    });
    const td = (align: 'left' | 'center' | 'right') => ({
      border: '1px solid #000000', padding: '1px 5px', fontSize: '9.5px', textAlign: align,
      lineHeight: 1.35,
      // Clip rather than wrap. maxWidth:0 is what makes ellipsis work inside a table cell whose
      // width comes from the column percentages — without it the cell just grows to fit.
      whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0,
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
              {/* Widths total exactly 100% in both modes. They used to come to 108%, which the
                  browser silently renormalised — meaning the printed column widths were never the
                  ones written here, and widening Type could not be reasoned about. */}
              <th style={th('left', showDate ? '16%' : '18%')}>Account Name</th>
              <th style={th('left', showDate ? '12%' : '14%')}>Remarks</th>
              {showDate && <th style={th('left', '9%')}>Date</th>}
              <th style={th('left', '10%')}>Type</th>
              <th style={th('left', '10%')}>Cheque No</th>
              <th style={th('right', showDate ? '9.75%' : '11%')}>Receipts<br />Cheq./Online</th>
              <th style={th('right', showDate ? '9.75%' : '11%')}>Payments<br />Cheq./Online</th>
              <th style={th('right', showDate ? '9.75%' : '11%')}>Receipts<br />Cash</th>
              <th style={th('right', showDate ? '9.75%' : '11%')}>Payments<br />Cash</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ ...td('center'), fontFamily: 'monospace' }}>{row.is_first_of_txn ? row.txn_seq : ''}</td>
                <td style={{ ...td('left'), fontWeight: 'bold', paddingLeft: row.side === 'TO' ? '18px' : '6px', fontStyle: row.is_posted ? 'normal' : 'italic', color: row.is_posted ? REPORT_COLORS.text : REPORT_COLORS.muted }}>
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
                <td style={{ ...td('left'), color: REPORT_COLORS.muted }}>{row.remarks || '—'}</td>
                {showDate && <td style={{ ...td('left'), fontFamily: 'monospace' }}>{formatDate(row.date)}</td>}
                {/* Clipped, not spilling: a long value used to run out of this cell and print on
                    top of Cheque No (reported 2026-09-01). Belt and braces alongside the shorter
                    labels — a future payment mode should not be able to break the layout. */}
                <td style={{ ...td('left'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0, fontWeight: 'bold', color: row.affects_cash ? '#334155' : '#0369a1' }}>{row.mode}</td>
                <td style={{ ...td('left'), fontFamily: 'monospace', color: REPORT_COLORS.muted }}>{row.cheque_no || '—'}</td>
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
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace', color: '#047857' }}>{formatCurrency(result.totals.receipt_bank)}</td>
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{formatCurrency(outgoing(result.totals.payment_bank))}</td>
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace', color: '#047857' }}>{formatCurrency(result.totals.receipt_cash)}</td>
              <td style={{ ...td('right'), backgroundColor: '#f2f2f2', fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{formatCurrency(outgoing(result.totals.payment_cash))}</td>
            </tr>
          </tfoot>
        </table>

        {/* Two invariants from the client's own book, shown rather than assumed (moved here from the
            old on-screen table): the cheque/online pair always balances, and the cash columns ARE
            the summary figures. If either breaks, a posting went in on the wrong side. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '18px', fontSize: '9.5px', fontWeight: 'bold', marginTop: '-10px', marginBottom: '4px' }}>
          <span style={{ color: bankTies ? '#059669' : '#e11d48' }}>
            {bankTies ? '\u2713 Cheq./Online ties' : `\u26a0 Cheq./Online out by ${formatCurrency(result.totals.receipt_bank - result.totals.payment_bank)}`}
          </span>
          <span style={{ color: summaryTies ? '#059669' : '#e11d48' }}>
            {summaryTies ? '\u2713 Cash matches the summary' : '\u26a0 Cash differs from the summary'}
          </span>
        </div>
        <p style={{ fontSize: '9px', color: REPORT_COLORS.muted, textAlign: 'right', margin: '0 0 15px 0' }}>
          Cash In and Cash Out need not match — the difference is the day’s net movement.
          {hasUnposted ? ' Unposted entries are included, as on the client’s own book.' : ''}
        </p>

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
              <span style={{ fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace', color: emphasise ? '#1B2A41' : '#334155' }}>{formatCurrency(value)}</span>
            </div>
          ))}
        </div>

        {/* CB-01 / CB-03, informational only (no cash moved, so they change nothing above). They
            used to exist on screen only; added to the document per the user, 2026-10-14. */}
        {result.bank_transfers.length > 0 && (
          <>
            <h3 style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', margin: '0 0 5px 0' }}>Bank Transfers</h3>
            <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  {showDate && <th style={th('left', '12%')}>Date</th>}
                  <th style={th('left', showDate ? '24%' : '28%')}>From</th>
                  <th style={th('left', showDate ? '24%' : '28%')}>To</th>
                  <th style={th('left', '26%')}>Remarks</th>
                  <th style={th('right', showDate ? '14%' : '18%')}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.bank_transfers.map((t, idx) => (
                  <tr key={idx}>
                    {showDate && <td style={{ ...td('left'), fontFamily: 'monospace' }}>{formatDate(t.date)}</td>}
                    <td style={{ ...td('left'), fontWeight: 'bold' }}>{t.from_name}</td>
                    <td style={{ ...td('left'), fontWeight: 'bold' }}>{t.to_name}</td>
                    <td style={{ ...td('left'), color: REPORT_COLORS.muted }}>{t.remarks || '—'}</td>
                    <td style={{ ...td('right'), fontFamily: 'monospace', fontWeight: 'bold', color: '#334155' }}>{formatCurrency(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {result.cheque_deposits.length > 0 && (
          <>
            <h3 style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', margin: '0 0 5px 0' }}>Cheques Deposited</h3>
            <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  {showDate && <th style={th('left', '12%')}>Date</th>}
                  <th style={th('left', '18%')}>Cheque No</th>
                  <th style={th('left', showDate ? '28%' : '32%')}>From</th>
                  <th style={th('left', showDate ? '28%' : '32%')}>Deposited To</th>
                  <th style={th('right', showDate ? '14%' : '18%')}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.cheque_deposits.map((d, idx) => (
                  <tr key={idx}>
                    {showDate && <td style={{ ...td('left'), fontFamily: 'monospace' }}>{formatDate(d.date)}</td>}
                    <td style={{ ...td('left'), fontFamily: 'monospace', color: REPORT_COLORS.muted }}>{d.cheque_no || '—'}</td>
                    <td style={{ ...td('left'), fontWeight: 'bold' }}>{d.payer_name}</td>
                    <td style={td('left')}>{d.bank_name || '—'}</td>
                    <td style={{ ...td('right'), fontFamily: 'monospace', fontWeight: 'bold', color: '#334155' }}>{formatCurrency(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

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
      <div className="mx-auto" style={{ maxWidth: 1250 }}>

        {/* Filter Mode Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-md mb-6 border border-slate-200" data-no-print>
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
          <button
            onClick={() => setFilterBy('range')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 whitespace-nowrap px-2 ${filterBy === 'range' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Between Two Dates
          </button>
        </div>

        {/* Selection Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[290px]">
            <div className="relative flex-1 min-w-[240px]">
              <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Particulars:</span>
              <div className="relative">
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search by account, remarks, cheque no..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
              </div>
            </div>

            {filterBy === 'range' ? (
              <div className="flex items-center gap-2">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">From:</span>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1 text-xs" />
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">To:</span>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1 text-xs" />
                </div>
                {fromDate && toDate && fromDate > toDate && (
                  <span className="text-xs font-semibold text-rose-600 self-end pb-1.5">From is after To</span>
                )}
              </div>
            ) : filterBy === 'date' ? (
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
              onClick={handleShowPrintPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs self-end h-9"
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
