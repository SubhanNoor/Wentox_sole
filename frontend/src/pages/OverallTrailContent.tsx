import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import { formatCurrency } from '@/context/AppContext';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, ArrowLeft, ChevronRight, Filter, Eye, RotateCcw } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import * as api from '@/lib/api';
import type { OverallTrailRow, LedgerRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';

type AccountGroupType = 'all' | 'customer' | 'vendor' | 'employee' | 'bank' | 'chart_account' | 'business_account';

interface OverallTrailContentProps {
  /** Pre-selects the Quick Filter pill this content opens with — used by the Reports Hub's own
   *  "Vendor Balances"/"Customer Balances" tabs (Account Reports menu, 2026-08-26) so each lands
   *  straight on its own scope instead of the unfiltered "All Accounts" view. Still just the same
   *  Quick Filter state underneath, so the pill row stays fully interactive afterward — this only
   *  changes the starting point, not a lock. Defaults to 'all' — Overall Trail's original behavior.
   */
  initialGroup?: AccountGroupType;
}

// Which Reports Hub tab renders this component with which `initialGroup` — needed to open a
// "Show Print Preview" window on the exact same tab (per the user, 2026-09-03), since this
// component isn't itself told its own tab, only `initialGroup`.
const TAB_BY_GROUP: Record<string, string> = { all: 'overall-trail', vendor: 'vendor-balances', customer: 'customer-balances' };

export default function OverallTrailContent({ initialGroup = 'all' }: OverallTrailContentProps) {
  const ownTab = TAB_BY_GROUP[initialGroup] || 'overall-trail';
  const [asOfDate, setAsOfDate] = useState(() => getWindowParam('asOfDate') || getTodayDate());
  const [searchQuery, setSearchQuery] = useState(() => getWindowParam('searchQuery') || '');
  const [selectedGroup, setSelectedGroup] = useState<AccountGroupType>(() => (getWindowParam('selectedGroup') as AccountGroupType) || initialGroup);
  const [reportVisible, setReportVisible] = useState(true);

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedGroup(initialGroup);
    setAsOfDate(getTodayDate());
    setReportVisible(false);
  };

  const [selectedAccount, setSelectedAccount] = useState<OverallTrailRow | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleCloseDetail = () => {
    setIsClosing(true);
    setTimeout(() => {
      setSelectedAccount(null);
      setIsClosing(false);
    }, 200);
  };

  const [ledgerFromDate, setLedgerFromDate] = useState(() => getWindowParam('ledgerFromDate') || getThreeMonthsAgoDate());
  const [ledgerToDate, setLedgerToDate] = useState(() => getWindowParam('ledgerToDate') || getTodayDate());

  const [trailBalances, setTrailBalances] = useState<OverallTrailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isLedgerPreviewOpen, setIsLedgerPreviewOpen] = useState(false);

  const loadTrail = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.overallTrail({ as_of_date: asOfDate || undefined });
    if (res.ok) setTrailBalances(res.data.rows);
    setLoading(false);
  }, [asOfDate]);

  useEffect(() => { loadTrail(); }, [loadTrail]);

  // Opened via the ledger drill-down's own "Show Print Preview" (per the user, 2026-09-03) — once
  // the balances arrive, re-select the same account by ba_id/ac_id and go straight into that
  // ledger's preview, instead of landing on the grouped balances list.
  useEffect(() => {
    if (!isChildWindow() || selectedAccount || trailBalances.length === 0) return;
    const baId = getWindowParam('selectedAccountBaId');
    const acId = getWindowParam('selectedAccountAcId');
    if (baId == null && acId == null) return;
    const match = trailBalances.find(r =>
      (baId != null && r.ba_id === Number(baId)) || (acId != null && r.ac_id === Number(acId))
    );
    if (match) setSelectedAccount(match);
  }, [trailBalances, selectedAccount]);

  // Grouped-view preview — only fires when no account drill-down was requested (handled above).
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && getWindowParam('selectedAccountBaId') == null && getWindowParam('selectedAccountAcId') == null) {
      setIsPreviewOpen(true);
    }
  }, []);

  const dropdownAccounts = useMemo(() => {
    return trailBalances.filter(r => selectedGroup === 'all' || r.type === selectedGroup);
  }, [trailBalances, selectedGroup]);

  const filteredBalances = useMemo(() => {
    return trailBalances.filter(r => {
      if (selectedGroup !== 'all' && r.type !== selectedGroup) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.description.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.type_label.toLowerCase().includes(q)
      );
    });
  }, [trailBalances, selectedGroup, searchQuery]);

  const groupedBalances = useMemo(() => {
    const map = new Map<string, OverallTrailRow[]>();
    filteredBalances.forEach(row => {
      const label = row.type_label;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(row);
    });
    return Array.from(map.entries());
  }, [filteredBalances]);

  const filteredTotals = useMemo(() => {
    return filteredBalances.reduce((acc, r) => ({
      totalDebit: acc.totalDebit + r.debit,
      totalCredit: acc.totalCredit + r.credit,
    }), { totalDebit: 0, totalCredit: 0 });
  }, [filteredBalances]);

  const [ledger, setLedger] = useState<{ opening_balance: number; rows: LedgerRow[]; closing_balance: number } | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const loadLedger = useCallback(async () => {
    if (!selectedAccount) return;
    setLedgerLoading(true);
    const res = await api.reports.accountLedger({
      ba_id: selectedAccount.ba_id,
      ac_id: selectedAccount.ac_id,
      date_from: ledgerFromDate || undefined,
      date_to: ledgerToDate || undefined,
    });
    if (res.ok) setLedger(res.data); else setLedger(null);
    setLedgerLoading(false);
  }, [selectedAccount, ledgerFromDate, ledgerToDate]);

  useEffect(() => { if (selectedAccount) loadLedger(); }, [selectedAccount, loadLedger]);

  // "Show Print Preview" opens a new window on this same tab (per the user, 2026-09-03), instead
  // of an in-page overlay — behaves like the app's other "open in new window" child windows.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', ownTab, { asOfDate, selectedGroup, searchQuery, autoPreview: '1' });
  };

  const handleShowLedgerPrintPreview = () => {
    if (!selectedAccount) return;
    const params: Record<string, string> = { ledgerFromDate, ledgerToDate, autoPreview: '1' };
    if (selectedAccount.ba_id != null) params.selectedAccountBaId = String(selectedAccount.ba_id);
    if (selectedAccount.ac_id != null) params.selectedAccountAcId = String(selectedAccount.ac_id);
    api.openWindow('reports', ownTab, params);
  };

  // Ledger-view preview — fires once the drilled-into account's ledger has actually loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && selectedAccount && ledger) {
      setIsLedgerPreviewOpen(true);
    }
  }, [selectedAccount, ledger]);

  const handleExportExcel = () => {
    const headers = ['Account Code', 'Account Description', 'Category', 'Debit (Naam)', 'Credit (Jamma)', 'Net Balance'];
    const rows = [
      ...filteredBalances.map(r => [
        r.code, r.description, r.type_label,
        r.debit > 0 ? r.debit : '-',
        r.credit > 0 ? `(${r.credit})` : '-',
        r.net_balance
      ]),
      ['Total', '', '', filteredTotals.totalDebit, `(${filteredTotals.totalCredit})`, filteredTotals.totalDebit - filteredTotals.totalCredit]
    ];
    exportRowsToExcel(`overall-trail-balances-${asOfDate}`, headers, rows);
  };

  const handleExportExcelLedger = () => {
    if (!selectedAccount || !ledger) return;
    const headers = ['Date', 'Type', 'Reference', 'Narration', 'Debit (PKR)', 'Credit (PKR)', 'Balance (PKR)'];
    const rows = [
      [ledgerFromDate ? `Before ${formatDate(ledgerFromDate)}` : '---', 'Opening Balance', '-', 'Opening Balance brought forward', 0, 0, ledger.opening_balance],
      ...ledger.rows.map(r => [
        formatDate(r.date), r.type, r.inv_no ?? r.bill_no ?? `#${r.entry_id}`, r.narration ?? '',
        r.debit > 0 ? r.debit : '-', r.credit > 0 ? `(${r.credit})` : '-', r.balance
      ]),
    ];
    exportRowsToExcel(`${selectedAccount.description}-ledger-${ledgerFromDate || 'start'}-to-${ledgerToDate || 'end'}`, headers, rows);
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        {/* Header */}
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>OVERALL TRIAL BALANCE REPORT</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>As On: {formatDate(asOfDate)}</p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Date of Print: {formatDate(new Date())}</p>
          </div>
        </div>

        {/* Table — same structure as on-screen: Code | Description | Debit | Credit */}
        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            {/* Row 1: merged group header */}
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Account Code</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Account Description</th>
              <th colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Trail Balances</th>
            </tr>
            {/* Row 2: sub-headers for balances */}
            <tr>
              <th style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10px', backgroundColor: '#f8f8f8', fontWeight: 'bold', textAlign: 'left' }}></th>
              <th style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10px', backgroundColor: '#f8f8f8', fontWeight: 'bold', textAlign: 'left' }}></th>
              <th style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10px', backgroundColor: '#f8f8f8', fontWeight: 'bold', textAlign: 'right', width: '140px' }}>Debit (Naam)</th>
              <th style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10px', backgroundColor: '#f8f8f8', fontWeight: 'bold', textAlign: 'right', width: '140px' }}>Credit (Jamma)</th>
            </tr>
          </thead>
          <tbody>
            {groupedBalances.map(([groupName, groupRows]) => {
              const sectionDebit = groupRows.reduce((s, r) => s + r.debit, 0);
              const sectionCredit = groupRows.reduce((s, r) => s + r.credit, 0);
              return (
                <Fragment key={groupName}>
                  {/* Section header */}
                  <tr style={{ backgroundColor: '#e8e8e8' }}>
                    <td colSpan={4} style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '10.5px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {groupName}
                    </td>
                  </tr>
                  {/* Account rows */}
                  {groupRows.map(r => (
                    <tr key={`${r.type}-${r.code}`}>
                      <td style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10.5px', fontFamily: 'monospace' }}>{r.code}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10.5px' }}>{r.description}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: '#047857' }}>{r.debit > 0 ? formatCurrency(r.debit) : '-'}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: '#e11d48' }}>{r.credit > 0 ? `(${formatCurrency(r.credit)})` : '-'}</td>
                    </tr>
                  ))}
                  {/* Section subtotal — single line */}
                  <tr style={{ backgroundColor: '#f5f5f5', fontWeight: 'bold', borderTop: '1.5px solid #888888' }}>
                    <td colSpan={2} style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '10.5px', textAlign: 'left' }}>
                      Subtotal for {groupName} ({groupRows.length} accounts):
                    </td>
                    <td style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#047857' }}>{sectionDebit > 0 ? formatCurrency(sectionDebit) : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#e11d48' }}>{sectionCredit > 0 ? `(${formatCurrency(sectionCredit)})` : '-'}</td>
                  </tr>
                </Fragment>
              );
            })}
            {/* Grand Total */}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#e8e8e8' }}>
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Grand Total</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: '#047857' }}>{formatCurrency(filteredTotals.totalDebit)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: '#e11d48' }}>({formatCurrency(filteredTotals.totalCredit)})</td>
            </tr>
          </tbody>
        </table>

        {/* Signature & Print Info footer */}
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

  const renderPrintableLedger = () => {
    if (!selectedAccount || !ledger) return null;
    return (
      <div className="excel-print-container">
        {/* Header */}
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>ACCOUNT LEDGER STATEMENT</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' }}>{selectedAccount.description}</p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Code: {selectedAccount.code} | Category: {selectedAccount.type_label}</p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Period: {ledgerFromDate ? formatDate(ledgerFromDate) : 'Start'} to {ledgerToDate ? formatDate(ledgerToDate) : 'End'}</p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Date of Print: {formatDate(new Date())}</p>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Type</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Reference / Bill #</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Narration</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Debit (PKR)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Credit (PKR)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Balance (PKR)</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ backgroundColor: '#fdf6ec', fontWeight: 'bold' }}>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{ledgerFromDate ? `Before ${formatDate(ledgerFromDate)}` : '---'}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>Opening Balance</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>-</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontStyle: 'italic' }}>Opening Balance brought forward</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right' }}>-</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right' }}>-</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(ledger.opening_balance)}</td>
            </tr>
            {ledger.rows.map(row => (
              <tr key={row.entry_id}>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{formatDate(row.date)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{row.type}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>{row.inv_no ?? row.bill_no ?? `#${row.entry_id}`}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{row.narration}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: '#047857' }}>{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: '#e11d48' }}>{row.credit > 0 ? `(${formatCurrency(row.credit)})` : '-'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(row.balance)}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#e8e8e8' }}>
              <td colSpan={6} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Closing Balance</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(ledger.closing_balance)}</td>
            </tr>
          </tbody>
        </table>

        {/* Signature & Print Info footer */}
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
    <div>
      {/* VIEW 1: Business Accounts Balances Details (Overall Trial Balance) */}
      {!selectedAccount ? (
        <div>
          {/* Top Filter Container with Searchable Select & Action Buttons */}
          <div className="card-white p-5 bg-white border border-slate-200/80 rounded-2xl mb-5 shadow-2xs" data-no-print>

            {/* ROW 1: Search Input, SearchableSelect Dropdown, As On Date, & Actions */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">

                {/* Search Text Input */}
                <div className="relative min-w-[200px] flex-1 max-w-xs">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                  <input
                    type="text"
                    placeholder="Search code or description..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input pl-9 py-2 w-full text-xs font-semibold"
                  />
                </div>

                {/* SearchableSelect Account Jump Dropdown */}
                <div className="min-w-[260px] flex-1 max-w-xs">
                  <SearchableSelect
                    options={dropdownAccounts.map(acc => ({
                      value: `${acc.type}-${acc.code}`,
                      label: `${acc.code} — ${acc.description} (${acc.type_label})`
                    }))}
                    value=""
                    onChange={(val: string) => {
                      const acc = dropdownAccounts.find(a => `${a.type}-${a.code}` === val);
                      if (acc) setSelectedAccount(acc);
                    }}
                    placeholder="Jump to Account..."
                    searchPlaceholder="Type to search sub-accounts..."
                  />
                </div>

                {/* As On Date Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase">As On:</span>
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={e => { setAsOfDate(e.target.value); setReportVisible(true); }}
                    className="soleria-input py-1.5 px-3 text-xs font-semibold"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleClearFilters}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-500 font-semibold rounded-full text-xs transition-all cursor-pointer border border-rose-200 hover:border-rose-300"
                >
                  <RotateCcw size={13} /> Clear All
                </button>
                <button
                  onClick={() => { setReportVisible(true); handleShowPrintPreview(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
                >
                  <Eye size={14} /> Show Print Preview
                </button>
              </div>
            </div>

            {/* ROW 2: Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 mt-3 border-slate-100">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
                <Filter size={13} /> Quick Filter:
              </span>
              {(['all', 'customer', 'vendor', 'employee', 'bank', 'chart_account', 'business_account'] as const).map(grp => (
                <button
                  key={grp}
                  type="button"
                  onClick={() => { setSelectedGroup(grp); setReportVisible(true); }}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                    reportVisible && selectedGroup === grp
                      ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {grp === 'all' ? 'All Accounts' : grp === 'customer' ? 'Customers' : grp === 'vendor' ? 'Vendors' : grp === 'employee' ? 'Employees' : grp === 'bank' ? 'Banks' : grp === 'chart_account' ? 'Chart Accounts' : 'Business Accounts'}
                </button>
              ))}
            </div>
          </div>

          {/* Main Balances Table */}
          {!reportVisible ? (
            <div className="card-white p-12 bg-white border border-slate-200/80 rounded-2xl text-center">
              <div className="text-slate-300 mb-4">
                <Filter size={48} className="mx-auto" />
              </div>
              <p className="text-slate-500 font-semibold text-sm">Filters cleared. Use the quick filters or search above, then your report will appear.</p>
            </div>
          ) : (
          <div className="card-white bg-white border border-slate-200/80 rounded-2xl overflow-hidden">
            {/* Card Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-start">
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-900">Business Accounts Balances Details</h3>
                <p className="text-xs text-slate-500 font-medium">As On Date: <span className="font-bold text-slate-700">{asOfDate ? formatDate(asOfDate) : 'Today'}</span></p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-bold text-slate-800 uppercase tracking-wider">WENTOX FOOTWEAR DISTRIBUTION</p>
                <p style={{ color: 'var(--brand-gold)' }} className="font-semibold">Overall Trial Balances Statement</p>
              </div>
            </div>

            {/* Table — text-sm + bold numbers, matching PaymentTrailPage/ReportKhaataPage's
                convention (per the user, 2026-09-03: this table's text/numbers read as
                noticeably smaller/thinner than those two, once compared side by side). */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  {/* Merged header: Account Description | Trail Balances (spans Debit+Credit) */}
                  <tr className="bg-slate-50 text-slate-700 font-bold text-xs border-b border-slate-200">
                    <th className="p-3" style={{ width: '155px' }}>Account Code</th>
                    <th className="p-3">Account Description</th>
                    <th className="p-3 text-center border-l border-slate-200" colSpan={2} style={{ width: '300px' }}>Trail Balances</th>
                  </tr>
                  <tr className="bg-slate-50 text-slate-500 font-semibold text-xs border-b-2 border-slate-300">
                    <th className="p-2 pl-3"></th>
                    <th className="p-2"></th>
                    <th className="p-2 text-right border-l border-slate-200" style={{ width: '150px' }}>Debit (Naam)</th>
                    <th className="p-2 text-right border-l border-slate-200" style={{ width: '150px' }}>Credit (Jamma)</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4} className="text-center p-8 text-slate-400 italic">Loading…</td></tr>
                  ) : filteredBalances.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center p-8 text-slate-400 italic">
                        No account balances found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    groupedBalances.map(([groupName, groupRows]) => {
                      const sectionDebit = groupRows.reduce((s, r) => s + r.debit, 0);
                      const sectionCredit = groupRows.reduce((s, r) => s + r.credit, 0);

                      return (
                        <Fragment key={groupName}>
                          {/* Section header — plain grey strip */}
                          <tr className="bg-slate-100">
                            <td colSpan={4} className="py-1.5 px-3 text-xs font-bold text-slate-600 uppercase tracking-widest border-y border-slate-200">
                              {groupName}
                            </td>
                          </tr>

                          {/* Account rows */}
                          {groupRows.map((row, idx) => (
                            <tr
                              key={`${row.type}-${row.code}-${idx}`}
                              // The aggregate row stands for several accounts at once — there is no
                              // single ledger to open, and drilling in would ask the backend for a
                              // row with neither ba_id nor ac_id.
                              onClick={row.is_aggregate ? undefined : () => setSelectedAccount(row)}
                              className={`border-b border-slate-100 transition-colors group ${
                                row.is_aggregate
                                  ? 'bg-slate-50/70 cursor-default'
                                  : 'hover:bg-amber-50/30 cursor-pointer'
                              }`}
                            >
                              <td className="p-2.5 pl-3 font-mono text-xs text-slate-600 whitespace-nowrap">{row.code}</td>
                              <td className={`p-2.5 font-semibold transition-colors ${row.is_aggregate ? 'text-slate-500 italic font-normal' : 'text-slate-800 group-hover:text-[var(--brand-gold)]'}`}>
                                <div className="flex items-center justify-between">
                                  <span>{row.description}</span>
                                  {!row.is_aggregate && (
                                    <ChevronRight size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 ml-2 shrink-0" />
                                  )}
                                </div>
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold border-l border-slate-100">
                                {row.debit > 0 ? <span className="text-emerald-700">{formatCurrency(row.debit)}</span> : <span className="text-slate-300 font-normal">-</span>}
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold border-l border-slate-100">
                                {row.credit > 0 ? <span className="text-rose-700">({formatCurrency(row.credit)})</span> : <span className="text-slate-300 font-normal">-</span>}
                              </td>
                            </tr>
                          ))}

                          {/* Subtotal — single summary line at end of section */}
                          <tr className="border-t border-slate-400 bg-slate-50">
                            <td colSpan={2} className="py-2 px-3 text-xs font-bold text-slate-600 uppercase tracking-wider">
                              Subtotal for {groupName} ({groupRows.length} accounts):
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-700 border-l border-slate-200">
                              {sectionDebit > 0 ? formatCurrency(sectionDebit) : '-'}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-rose-700 border-l border-slate-200">
                              {sectionCredit > 0 ? `(${formatCurrency(sectionCredit)})` : '-'}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  {/* White/light bar, not the dark navy fill — it was the bar's own background
                      that made the numbers hard to read, not the number colors (per the user,
                      2026-09-03). Matches the light bg-slate-50 "Grand Total" row style used
                      elsewhere in the app (Sale Analysis, Vendor Report). Debit green / credit red
                      per the app-wide convention (per the user, 2026-09-04). */}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-700 text-sm">
                    <td colSpan={2} className="p-3 uppercase tracking-wider text-right font-lora" style={{ color: 'var(--brand-navy)' }}>Grand Total Trail Balances</td>
                    <td className="p-3 text-right font-mono border-l border-slate-200 text-emerald-700">{formatCurrency(filteredTotals.totalDebit)}</td>
                    <td className="p-3 text-right font-mono border-l border-slate-200 text-rose-700">({formatCurrency(filteredTotals.totalCredit)})</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          )}
        </div>
      ) : (
        /* VIEW 2: Drill-down Specific Account Ledger */
        <div className={`transition-all duration-200 ${isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
          {/* Header & Back Button */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={handleCloseDetail}
                className="bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft size={16} /> Back to Overall Trail Balances
              </button>
              <div>
                <h2 className="font-lora font-bold text-xl text-slate-900">
                  {selectedAccount.description} — Detailed Ledger
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Code: {selectedAccount.code} • Category: {selectedAccount.type_label}
                </p>
              </div>
            </div>
            <button
              onClick={handleShowLedgerPrintPreview}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
            >
              <Eye size={14} /> Show Print Preview
            </button>
          </div>

          {/* Switch directly to another account's ledger without leaving this view (per the
              user, 2026-09-04) — same "Switch Account" pattern as ReportKhaataPage.tsx's own
              ledger detail view. */}
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider shrink-0 flex items-center gap-1">
              <Search size={13} className="text-slate-400" /> Switch Account:
            </span>
            <div className="w-full max-w-sm">
              <SearchableSelect
                options={dropdownAccounts.map(acc => ({
                  value: `${acc.type}-${acc.code}`,
                  label: `${acc.code} — ${acc.description} (${acc.type_label})`
                }))}
                value={selectedAccount ? `${selectedAccount.type}-${selectedAccount.code}` : ''}
                onChange={(val: string) => {
                  const acc = dropdownAccounts.find(a => `${a.type}-${a.code}` === val);
                  if (acc) setSelectedAccount(acc);
                }}
                placeholder="Search accounts..."
                searchPlaceholder="Type to search..."
              />
            </div>
          </div>

          {/* Date Filter Bar */}
          <div className="p-3 rounded-lg border mb-6 bg-white shadow-sm flex flex-wrap items-center justify-between gap-4" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">From Date:</label>
                <input
                  type="date"
                  value={ledgerFromDate}
                  onChange={e => setLedgerFromDate(e.target.value)}
                  className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">To Date:</label>
                <input
                  type="date"
                  value={ledgerToDate}
                  onChange={e => setLedgerToDate(e.target.value)}
                  className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                />
              </div>
            </div>

            <div className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg flex items-center gap-2 text-xs font-semibold">
              <span className="text-slate-400">Net Ending Balance:</span>
              <span className="text-[#B08D57] font-bold">{formatCurrency(ledger?.closing_balance || 0)}</span>
            </div>
          </div>

          {/* Detailed Ledger Table */}
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="border-b pb-4 mb-6 flex justify-between items-start">
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-900">{selectedAccount.description} Account Statement</h3>
                <p className="text-xs text-slate-500">Period: {ledgerFromDate ? formatDate(ledgerFromDate) : 'Start'} to {ledgerToDate ? formatDate(ledgerToDate) : 'End'}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-bold text-slate-800">WENTOX FOOTWEAR DISTRIBUTION</p>
                <p>Account Ledger Statement</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100 border-b text-slate-700 font-bold text-xs uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3">Date</th>
                    <th className="p-3">Transaction Type</th>
                    <th className="p-3">Reference / Bill #</th>
                    <th className="p-3">Description / Narration</th>
                    <th className="p-3 text-right">Debit (PKR)</th>
                    <th className="p-3 text-right">Credit (PKR)</th>
                    <th className="p-3 text-right">Balance (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b bg-amber-50/40 font-semibold text-slate-700" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 text-slate-500">{ledgerFromDate ? `Before ${formatDate(ledgerFromDate)}` : '---'}</td>
                    <td className="p-3 font-bold text-amber-800">Opening Balance</td>
                    <td className="p-3">-</td>
                    <td className="p-3 italic text-slate-500">Opening Balance brought forward</td>
                    <td className="p-3 text-right">0</td>
                    <td className="p-3 text-right">0</td>
                    <td className="p-3 text-right font-bold text-amber-900">{formatCurrency(ledger?.opening_balance || 0)}</td>
                  </tr>

                  {ledgerLoading ? (
                    <tr><td colSpan={7} className="text-center p-6 text-slate-400 italic">Loading…</td></tr>
                  ) : !ledger || ledger.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-6 text-slate-400 italic">
                        No ledger transactions found for this date range.
                      </td>
                    </tr>
                  ) : (
                    ledger.rows.map((row) => (
                      <tr key={row.entry_id} className="border-b hover:bg-slate-50/60 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 font-medium text-slate-600">{formatDate(row.date)}</td>
                        <td className="p-3 font-semibold text-slate-800">{row.type}</td>
                        <td className="p-3 text-slate-500 font-mono">{row.inv_no ?? row.bill_no ?? `#${row.entry_id}`}</td>
                        <td className="p-3 text-slate-700">{row.narration}</td>
                        <td className="p-3 text-right font-semibold text-emerald-700">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                        <td className="p-3 text-right font-semibold text-rose-700">{row.credit > 0 ? `(${formatCurrency(row.credit)})` : '-'}</td>
                        <td className="p-3 text-right font-bold text-amber-900">{formatCurrency(row.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Overall Trial Balance - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>

      <ReportPrintPreviewModal
        isOpen={isLedgerPreviewOpen}
        onClose={() => setIsLedgerPreviewOpen(false)}
        title={selectedAccount ? `${selectedAccount.description} — Account Ledger` : 'Account Ledger'}
        orientation="portrait"
        onExportExcel={handleExportExcelLedger}
      >
        {renderPrintableLedger()}
      </ReportPrintPreviewModal>
    </div>
  );
}
