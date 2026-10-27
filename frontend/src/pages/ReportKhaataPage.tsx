import { useState, useMemo, useEffect } from 'react';
import SkipZeroToggle, { isZeroBalance } from '@/components/SkipZeroToggle';
import { formatCurrency, balanceColor } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, Eye } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import * as api from '@/lib/api';
import type { BusinessLedgerSummaryRow, LedgerRow } from '@/lib/api';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { IS_PREVIEW_WINDOW, closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import { REPORT_COLORS } from '@/components/reports/reportColors';
import { getWindowParam } from '@/lib/windowParams';
import wentoxLogo from '@/assets/wentox_logo.png';
import { useDataVersion } from '@/hooks/useDataVersion';

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
  // LED-01 (changes-14-09-26.md, corrected 2026-09-15): a Purchase voucher with more than one
  // item expands into exactly N+1 rows — one per item (the first also carrying the voucher's own
  // date/type/inv#/bill#), plus a trailing total row — display only, the underlying ledger
  // entry/balance is still exactly one row's worth of money movement. `showBalance: false` hides
  // the Balance cell on the item rows (only the total row's balance is real — repeating it on
  // every row would look like N separate balance changes for what is one). `isSubRow` marks the
  // compact item/total rows for tighter row height.
  showBalance?: boolean;
  isSubRow?: boolean;
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

// Type colours from the old on-screen statement's badges (per the user, 2026-10-14: the documents keep
// the screen colours), as hex since the document is drawn with inline styles.
const TYPE_COLOR: Record<string, string> = {
  'Sale Bill': '#be123c',
  'Receipt (Jamma)': '#047857',
  'Sale Return': '#1d4ed8',
  Commission: '#b45309',
  'Cheque Bounced': '#b91c1c',
  'Cheque Returned': '#b91c1c',
  'Bounce Undone': '#7c3aed',
};

// Rows whose narration explains WHAT happened to a cheque (bounced, returned, bounce undone) —
// shown above the cheque number instead of being replaced by it, or they read as plain receipts.
const EXPLAINED_CHEQUE_TYPES = new Set(['Cheque Bounced', 'Cheque Returned', 'Bounce Undone']);

const TH: React.CSSProperties = { border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' };
const TD: React.CSSProperties = { border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' };


type LedgerResult = { opening_balance: number; rows: LedgerRow[]; total_debit: number; total_credit: number; closing_balance: number };

export function ReportKhaataContent({ scope = 'customer' }: ReportKhaataContentProps) {
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  const isAllScope = scope === 'all';

  // Product Ledger layout (per the user, 2026-10-14): filter bar on top, the printed document under
  // it. No account picked = the Accounts List report (balances on the To date); an account picked =
  // its ledger statement. Clicking a row of the list on screen opens that account's statement.
  const [accountBaId, setAccountBaId] = useState<number | null>(() => { const p = getWindowParam('accountBaId'); return p ? Number(p) : null; });
  const [accountSearch, setAccountSearch] = useState(() => getWindowParam('accountSearch') || '');
  const [skipZero, setSkipZero] = useState(() => getWindowParam('skipZero') === '1');
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // The Accounts List: every account's balance on the To date.
  const [directory, setDirectory] = useState<BusinessLedgerSummaryRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.reports.businessLedger({ view: 'summary', date_to: toDate || undefined }).then(res => {
      if (cancelled || !res.ok || !Array.isArray(res.data)) return;
      setDirectory(isAllScope ? res.data : res.data.filter(a => a.category === 'CUSTOMER'));
      if (IS_PREVIEW_WINDOW && accountBaId == null) setIsPreviewOpen(true);
    });
    return () => { cancelled = true; };
    // accountBaId only steers the preview window's first open; it doesn't change what loads here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllScope, toDate, dataVersion]);

  const selectedAccount = useMemo(() => directory?.find(c => c.ba_id === accountBaId), [accountBaId, directory]);

  // Account picker. Parent chart account appended inline with an em-dash, same as every other
  // business-account picker (2026-08-30, per the user).
  const accountOptions = useMemo(
    () => [
      { value: '', label: isAllScope ? 'All accounts (list)' : 'All customers (list)' },
      ...(directory ?? []).map(a => ({
        value: String(a.ba_id),
        label: `${a.code ? `${a.name} (${a.code})` : a.name}${a.main_account ? ` — ${a.main_account}` : ''}`,
      })),
    ],
    [directory, isAllScope],
  );

  // The statement for the picked account. Keyed so the previous statement stays up while the next
  // loads, and so a reply for an older choice can never land on a newer one.
  const ledgerKey = `${accountBaId}|${fromDate}|${toDate}`;
  const [loadedLedger, setLoadedLedger] = useState<{ key: string; ledger: LedgerResult | null } | null>(null);
  useEffect(() => {
    if (accountBaId == null) return;
    let cancelled = false;
    api.reports.accountLedger({ ba_id: accountBaId, date_from: fromDate || undefined, date_to: toDate || undefined }).then(res => {
      if (cancelled) return;
      setLoadedLedger({ key: ledgerKey, ledger: res.ok ? res.data : null });
      if (IS_PREVIEW_WINDOW && res.ok) setIsPreviewOpen(true);
    });
    return () => { cancelled = true; };
  }, [ledgerKey, accountBaId, fromDate, toDate, dataVersion]);
  const ledger = accountBaId != null ? loadedLedger?.ledger ?? null : null;

  const filteredAccounts = useMemo(() => {
    const list = directory ?? [];
    const visible = skipZero ? list.filter(c => !isZeroBalance(c.closing_balance)) : list;
    if (!accountSearch.trim()) return visible;
    const q = accountSearch.toLowerCase();
    return visible.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.main_account.toLowerCase().includes(q) ||
      (c.city_name || '').toLowerCase().includes(q) ||
      (isAllScope && (CATEGORY_LABELS[c.category] || c.category).toLowerCase().includes(q))
    );
  }, [directory, accountSearch, isAllScope, skipZero]);
  const listTotal = useMemo(() => filteredAccounts.reduce((s, c) => s + c.closing_balance, 0), [filteredAccounts]);

  // Opening Balance synthetic row + running balance — the backend already computes both.
  // LED-01 (changes-14-09-26.md, corrected 2026-09-15 per the client): a Purchase row with MORE
  // THAN ONE item expands into exactly N+1 rows — one per item, plus a trailing total row — no
  // separate header row. A single-item (or item-less) purchase renders exactly as it always did,
  // one plain row. Same treatment for Purchase Return, per the user (2026-09-17) — the backend's
  // `purchase_items` field is now populated for both `type`s identically.
  const runningKhaata = useMemo<KhaataRow[]>(() => {
    if (!ledger) return [];
    const rows: KhaataRow[] = [
      { date: fromDate ? `Before ${formatDate(fromDate)}` : '---', type: 'Opening Balance', invNo: '-', billNo: '-', narration: fromDate ? `Opening balance before ${formatDate(fromDate)}` : 'Opening Balance brought forward', chequeNo: undefined, chequeDate: undefined, pairs: 0, debit: 0, credit: 0, balance: ledger.opening_balance },
    ];
    for (const r of ledger.rows) {
      const invNo = r.inv_no != null ? String(r.inv_no) : String(r.entry_id);
      if ((r.type === 'Purchase' || r.type === 'Purchase Return') && r.purchase_items && r.purchase_items.length > 1) {
        r.purchase_items.forEach((item, i) => {
          rows.push({
            // Date/Type/Inv#/Bill# only on the first item row — that IS the voucher's own row,
            // just narrating one item at a time instead of all of them crammed into one cell.
            date: i === 0 ? formatDate(r.date) : '', type: i === 0 ? r.type : '',
            invNo: i === 0 ? invNo : '', billNo: i === 0 ? (r.bill_no || '-') : '',
            narration: `${item.material_name} — ${item.quantity} ${item.unit} @ ${formatCurrency(item.price_per_unit)} = ${formatCurrency(item.total_price)}`,
            chequeNo: undefined, chequeDate: undefined,
            pairs: 0, debit: 0, credit: 0, balance: r.balance, showBalance: false, isSubRow: true,
          });
        });
        rows.push({
          date: '', type: '', invNo: '', billNo: '',
          narration: 'Voucher Total',
          pairs: r.pairs || 0, debit: r.debit, credit: r.credit, balance: r.balance, isSubRow: true,
        });
        continue;
      }
      rows.push({
        date: formatDate(r.date), type: r.type, invNo, billNo: r.bill_no || '-', narration: r.narration || '',
        chequeNo: r.cheque_no, chequeDate: r.cheque_date ? formatDate(r.cheque_date) : undefined,
        pairs: r.pairs || 0, debit: r.debit, credit: r.credit, balance: r.balance,
      });
    }
    return rows;
  }, [ledger, fromDate]);

  const handleExportExcel = () => {
    if (accountBaId == null) {
      const headers = ['Code', 'Account Name', 'Main Account', ...(isAllScope ? ['Category'] : []), 'City', 'Balance'];
      const rows = filteredAccounts.map(c => [
        c.code, c.name, c.main_account, ...(isAllScope ? [CATEGORY_LABELS[c.category] || c.category] : []), c.city_name || 'General', c.closing_balance,
      ]);
      exportRowsToExcel(`${isAllScope ? 'business' : 'customer'}-accounts-list`, headers, rows);
      return;
    }
    if (!selectedAccount) return;
    const headers = ['Date', 'Type', 'Inv #', 'Bill #', 'Narration', 'Pairs', 'Debit', 'Credit', 'Balance'];
    const rows = runningKhaata.map(r => [
      r.date, r.type, r.invNo, r.billNo, r.narration, r.pairs, r.debit, r.credit, r.balance
    ]);
    exportRowsToExcel(`${isAllScope ? 'business' : 'khaata'}-ledger-${selectedAccount.name}`, headers, rows);
  };

  const handleShowPrintPreview = () => {
    const params: Record<string, string> = { fromDate, toDate, autoPreview: '1' };
    if (accountBaId != null) params.accountBaId = String(accountBaId);
    else { params.accountSearch = accountSearch; params.skipZero = skipZero ? '1' : '0'; }
    api.openWindow('reports', isAllScope ? 'business-ledger' : 'account-ledger', params);
  };

  const closePreview = () => {
    setIsPreviewOpen(false);
    closePreviewWindow();
  };

  const renderHeader = (title: string, lines: React.ReactNode[]) => (
    <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
      <div>
        <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
      </div>
      <div style={{ textAlign: 'right' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>{title}</h2>
        {lines.map((line, i) => (
          <p key={i} style={i === 0 ? { margin: '4px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' } : { margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>{line}</p>
        ))}
      </div>
    </div>
  );

  const renderSignoff = () => (
    <>
      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
        {['Prepared By', 'Audited By', 'Authorized Sign'].map(label => (
          <div key={label} style={{ textAlign: 'center', width: '150px' }}>
            <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>{label}</span>
          </div>
        ))}
      </div>
      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
        <div>WENTOX FOOTWEAR DISTRIBUTION</div>
        <div>Printed: {formatDateTime(new Date())}</div>
      </div>
    </>
  );

  // The Accounts List (per the user, 2026-10-14 — it had no printed version before). `interactive`
  // is the on-screen copy only: its rows open that account's statement; the preview's copy is plain.
  const renderAccountsList = (interactive: boolean) => (
    <div className="excel-print-container">
      {renderHeader(isAllScope ? 'BUSINESS ACCOUNTS LIST' : 'CUSTOMER ACCOUNTS LIST', [
        `Balances as on ${toDate ? formatDate(toDate) : formatDate(new Date())}`,
        `${filteredAccounts.length} accounts${accountSearch.trim() ? ` matching "${accountSearch.trim()}"` : ''}${skipZero ? ' · zero balances skipped' : ''}`,
        `Date of Print: ${formatDate(new Date())}`,
      ])}
      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
        <thead>
          <tr>
            <th style={TH}>Code</th>
            <th style={TH}>Account Name</th>
            <th style={TH}>Main Account</th>
            {isAllScope && <th style={TH}>Category</th>}
            <th style={TH}>City</th>
            <th style={{ ...TH, textAlign: 'right' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {filteredAccounts.length === 0 && (
            <tr><td colSpan={isAllScope ? 6 : 5} style={{ ...TD, textAlign: 'center', color: '#888888', padding: '12px' }}>No accounts found matching your search.</td></tr>
          )}
          {filteredAccounts.map(c => (
            <tr
              key={c.ba_id}
              {...(interactive ? {
                className: 'report-row-link',
                tabIndex: 0,
                title: 'Open this account’s statement',
                onClick: () => setAccountBaId(c.ba_id),
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') setAccountBaId(c.ba_id); },
              } : {})}
            >
              <td style={{ ...TD, fontFamily: 'monospace', color: '#475569' }}>{c.code}</td>
              <td style={{ ...TD, fontWeight: 'bold', color: REPORT_COLORS.text }}>{c.name}</td>
              <td style={{ ...TD, fontSize: '10px', textTransform: 'uppercase', color: REPORT_COLORS.muted }}>{c.main_account}</td>
              {isAllScope && <td style={{ ...TD, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#334155' }}>{CATEGORY_LABELS[c.category] || c.category}</td>}
              <td style={{ ...TD, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#92400e' }}>{c.city_name || 'General'}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: balanceColor(c.closing_balance) }}>{formatCurrency(c.closing_balance)}</td>
            </tr>
          ))}
          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
            <td colSpan={isAllScope ? 5 : 4} style={{ ...TD, fontSize: '11px', fontWeight: 'bold' }}>TOTAL ({filteredAccounts.length} accounts)</td>
            <td style={{ ...TD, fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: balanceColor(listTotal) }}>{formatCurrency(listTotal)}</td>
          </tr>
        </tbody>
      </table>
      {renderSignoff()}
    </div>
  );

  const renderStatement = () => (
    <div className="excel-print-container">
      {renderHeader(isAllScope ? 'BUSINESS LEDGER STATEMENT' : 'CUSTOMER KHAATA LEDGER STATEMENT', [
        selectedAccount?.name || '',
        <>
          Code: {selectedAccount?.code}
          {isAllScope && selectedAccount ? ` | Category: ${CATEGORY_LABELS[selectedAccount.category] || selectedAccount.category}` : ''}
          {' '}| City: {selectedAccount?.city_name || 'General'}
        </>,
        `Period: ${fromDate ? formatDate(fromDate) : 'Start'} to ${toDate ? formatDate(toDate) : 'End'}`,
        `Date of Print: ${formatDate(new Date())}`,
      ])}

      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
        <thead>
          <tr>
            <th style={TH}>Date</th>
            <th style={TH}>Type</th>
            <th style={{ ...TH, textAlign: 'center' }}>Inv #</th>
            <th style={{ ...TH, textAlign: 'center' }}>Bill #</th>
            <th style={TH}>Narration</th>
            <th style={{ ...TH, textAlign: 'right' }}>Pairs</th>
            <th style={{ ...TH, textAlign: 'right' }}>Debit (Dr)</th>
            <th style={{ ...TH, textAlign: 'right' }}>Credit (Cr)</th>
            <th style={{ ...TH, textAlign: 'right', width: '130px', minWidth: '130px', whiteSpace: 'nowrap' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {runningKhaata.map((row, idx) => {
            const cellPad = row.isSubRow ? '2px 6px' : '5px 6px';
            return (
            <tr key={idx} style={{ fontWeight: row.type === 'Opening Balance' ? 'bold' : 'normal', backgroundColor: row.type === 'Opening Balance' ? '#f9f9f9' : row.isSubRow ? '#fafafa' : '#ffffff' }}>
              <td style={{ ...TD, padding: cellPad, color: '#334155', fontWeight: 'bold' }}>{row.date ? formatDate(row.date) : ''}</td>
              <td style={{ ...TD, padding: cellPad, fontWeight: 'bold', color: TYPE_COLOR[row.type] ?? '#334155' }}>{row.type}</td>
              <td style={{ ...TD, padding: cellPad, textAlign: 'center', fontFamily: 'monospace' }}>{row.invNo}</td>
              <td style={{ ...TD, padding: cellPad, textAlign: 'center' }}>{row.billNo}</td>
              <td style={{ ...TD, padding: cellPad, color: '#0f172a' }}>
                {row.chequeNo ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', lineHeight: '1.5' }}>
                    {EXPLAINED_CHEQUE_TYPES.has(row.type) && row.narration && <span>{row.narration}</span>}
                    <span><span style={{ color: '#888888', fontWeight: 'bold' }}>Cheque No:</span> {row.chequeNo}</span>
                    <span><span style={{ color: '#888888', fontWeight: 'bold' }}>Date:</span> {formatDate(row.chequeDate)}</span>
                  </div>
                ) : row.narration}
              </td>
              <td style={{ ...TD, padding: cellPad, textAlign: 'right', color: '#475569' }}>{row.pairs > 0 ? row.pairs : '-'}</td>
              <td style={{ ...TD, padding: cellPad, textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#047857' }}>{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
              <td style={{ ...TD, padding: cellPad, textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#e11d48' }}>{row.credit > 0 ? `(${formatCurrency(row.credit)})` : '-'}</td>
              <td style={{ ...TD, padding: cellPad, textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: balanceColor(row.balance) }}>{row.showBalance === false ? '' : formatCurrency(row.balance)}</td>
            </tr>
            );
          })}
          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
            <td colSpan={6} style={{ ...TD, fontSize: '11px', fontWeight: 'bold' }}>GRAND TOTAL</td>
            <td style={{ ...TD, fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#047857' }}>{formatCurrency(ledger?.total_debit || 0)}</td>
            <td style={{ ...TD, fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#e11d48' }}>({formatCurrency(ledger?.total_credit || 0)})</td>
            <td style={{ ...TD, fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: balanceColor(runningKhaata[runningKhaata.length - 1]?.balance || 0) }}>{formatCurrency(runningKhaata[runningKhaata.length - 1]?.balance || 0)}</td>
          </tr>
        </tbody>
      </table>
      {renderSignoff()}
    </div>
  );

  const showingStatement = accountBaId != null;

  return (
    <>
      <div className="mx-auto" style={{ maxWidth: 1100 }}>
        {/* Filter Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-3">
            {showingStatement && (
              <button
                type="button"
                onClick={() => setAccountBaId(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl text-xs font-semibold transition-all cursor-pointer"
              >
                &larr; Back to list
              </button>
            )}
            <div className="w-72">
              <SearchableSelect
                options={accountOptions}
                value={accountBaId != null ? String(accountBaId) : ''}
                onChange={val => setAccountBaId(val ? Number(val) : null)}
                placeholder={isAllScope ? 'All accounts (list)' : 'All customers (list)'}
                searchPlaceholder="Type a name..."
              />
            </div>
            {!showingStatement && (
              <div className="relative min-w-[220px]">
                <input
                  type="text"
                  placeholder={`Search code, name, main account${isAllScope ? ', category' : ''} or city...`}
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-9 font-semibold"
                />
                <Search className="absolute right-3 top-2 text-slate-400" size={14} />
              </div>
            )}
            {showingStatement && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 px-3 text-xs font-semibold" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">{showingStatement ? 'To:' : 'As on:'}</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 px-3 text-xs font-semibold" />
            </div>
            {!showingStatement && <SkipZeroToggle value={skipZero} onChange={setSkipZero} />}
          </div>
          <button
            onClick={handleShowPrintPreview}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
          >
            <Eye size={14} /> Show Print Preview
          </button>
        </div>

        {showingStatement ? (
          <LiveReportDocument loading={!loadedLedger || !directory}>
            {renderStatement()}
          </LiveReportDocument>
        ) : (
          <>
            {!IS_PREVIEW_WINDOW && directory && filteredAccounts.length > 0 && (
              <p className="text-xs text-slate-500 mb-2" data-no-print>Click an account to open its statement.</p>
            )}
            <LiveReportDocument loading={!directory}>
              {renderAccountsList(true)}
            </LiveReportDocument>
          </>
        )}
      </div>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={closePreview}
        title={showingStatement
          ? `${isAllScope ? 'Business Ledger' : 'Customer Khaata Ledger'} - ${selectedAccount?.name || ''}`
          : `${isAllScope ? 'Business' : 'Customer'} Accounts List - Print Preview`}
        orientation={showingStatement ? 'landscape' : 'portrait'}
        onExportExcel={handleExportExcel}
      >
        {showingStatement ? renderStatement() : renderAccountsList(false)}
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
