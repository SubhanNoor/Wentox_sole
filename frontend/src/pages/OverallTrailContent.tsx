import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import { formatCurrency } from '@/context/AppContext';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, ArrowLeft, ChevronRight, Filter, Eye, RotateCcw } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { OverallTrailRow, LedgerRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

type AccountGroupType = 'all' | 'customer' | 'vendor' | 'employee' | 'bank' | 'chart_account' | 'business_account';

export default function OverallTrailContent() {
  const [asOfDate, setAsOfDate] = useState(getTodayDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<AccountGroupType>('all');
  const [reportVisible, setReportVisible] = useState(true);

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedGroup('all');
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

  const [ledgerFromDate, setLedgerFromDate] = useState(getThreeMonthsAgoDate());
  const [ledgerToDate, setLedgerToDate] = useState(getTodayDate());

  const [trailBalances, setTrailBalances] = useState<OverallTrailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const loadTrail = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.overallTrail({ as_of_date: asOfDate || undefined });
    if (res.ok) setTrailBalances(res.data.rows);
    setLoading(false);
  }, [asOfDate]);

  useEffect(() => { loadTrail(); }, [loadTrail]);

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

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        {/* Header */}
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>OVERALL TRIAL BALANCE REPORT</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>As On: {asOfDate}</p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Date of Print: {new Date().toLocaleDateString()}</p>
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
                      <td style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{r.debit > 0 ? formatCurrency(r.debit) : '-'}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{r.credit > 0 ? `(${formatCurrency(r.credit)})` : '-'}</td>
                    </tr>
                  ))}
                  {/* Section subtotal — single line */}
                  <tr style={{ backgroundColor: '#f5f5f5', fontWeight: 'bold', borderTop: '1.5px solid #888888' }}>
                    <td colSpan={2} style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '10.5px', textAlign: 'left' }}>
                      Subtotal for {groupName} ({groupRows.length} accounts):
                    </td>
                    <td style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{sectionDebit > 0 ? formatCurrency(sectionDebit) : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{sectionCredit > 0 ? `(${formatCurrency(sectionCredit)})` : '-'}</td>
                  </tr>
                </Fragment>
              );
            })}
            {/* Grand Total */}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#e8e8e8' }}>
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Grand Total</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(filteredTotals.totalDebit)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>({formatCurrency(filteredTotals.totalCredit)})</td>
            </tr>
          </tbody>
        </table>

        {/* Signature footer */}
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
                  onClick={() => { setReportVisible(true); setIsPreviewOpen(true); }}
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
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
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
                <p className="text-xs text-slate-500 font-medium">As On Date: <span className="font-bold text-slate-700">{asOfDate || 'Today'}</span></p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-bold text-slate-800 uppercase tracking-wider">WENTOX FOOTWEAR DISTRIBUTION</p>
                <p style={{ color: 'var(--brand-gold)' }} className="font-semibold">Overall Trial Balances Statement</p>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  {/* Merged header: Account Description | Trail Balances (spans Debit+Credit) */}
                  <tr className="bg-slate-50 text-slate-700 font-bold text-[11px] border-b border-slate-200">
                    <th className="p-3" style={{ width: '155px' }}>Account Code</th>
                    <th className="p-3">Account Description</th>
                    <th className="p-3 text-center border-l border-slate-200" colSpan={2} style={{ width: '300px' }}>Trail Balances</th>
                  </tr>
                  <tr className="bg-slate-50 text-slate-500 font-semibold text-[10.5px] border-b-2 border-slate-300">
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
                            <td colSpan={4} className="py-1.5 px-3 text-[10.5px] font-bold text-slate-600 uppercase tracking-widest border-y border-slate-200">
                              {groupName}
                            </td>
                          </tr>

                          {/* Account rows */}
                          {groupRows.map((row, idx) => (
                            <tr
                              key={`${row.type}-${row.code}-${idx}`}
                              onClick={() => setSelectedAccount(row)}
                              className="border-b border-slate-100 hover:bg-amber-50/30 transition-colors cursor-pointer group"
                            >
                              <td className="p-2.5 pl-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">{row.code}</td>
                              <td className="p-2.5 text-slate-800 group-hover:text-[var(--brand-gold)] transition-colors">
                                <div className="flex items-center justify-between">
                                  <span>{row.description}</span>
                                  <ChevronRight size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 ml-2 shrink-0" />
                                </div>
                              </td>
                              <td className="p-2.5 text-right font-mono border-l border-slate-100 text-[11px]">
                                {row.debit > 0 ? <span className="text-slate-800">{formatCurrency(row.debit)}</span> : <span className="text-slate-300">-</span>}
                              </td>
                              <td className="p-2.5 text-right font-mono border-l border-slate-100 text-[11px]">
                                {row.credit > 0 ? <span className="text-slate-800">({formatCurrency(row.credit)})</span> : <span className="text-slate-300">-</span>}
                              </td>
                            </tr>
                          ))}

                          {/* Subtotal — single summary line at end of section */}
                          <tr className="border-t border-slate-400 bg-slate-50">
                            <td colSpan={2} className="py-2 px-3 text-[10.5px] font-bold text-slate-600 uppercase tracking-wider">
                              Subtotal for {groupName} ({groupRows.length} accounts):
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-800 border-l border-slate-200 text-[11px]">
                              {sectionDebit > 0 ? formatCurrency(sectionDebit) : '-'}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-800 border-l border-slate-200 text-[11px]">
                              {sectionCredit > 0 ? `(${formatCurrency(sectionCredit)})` : '-'}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-800 bg-[var(--brand-navy)] text-white font-bold text-xs">
                    <td colSpan={2} className="p-3 uppercase tracking-wider text-right" style={{ color: 'var(--brand-gold)' }}>Grand Total Trail Balances</td>
                    <td className="p-3 text-right font-mono border-l border-slate-600">{formatCurrency(filteredTotals.totalDebit)}</td>
                    <td className="p-3 text-right font-mono border-l border-slate-600">({formatCurrency(filteredTotals.totalCredit)})</td>
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
                <p className="text-xs text-slate-500">Period: {ledgerFromDate || 'Start'} to {ledgerToDate || 'End'}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-bold text-slate-800">WENTOX FOOTWEAR DISTRIBUTION</p>
                <p>Account Ledger Statement</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b text-slate-700 font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
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
                    <td className="p-3 text-slate-500">{ledgerFromDate ? `Before ${ledgerFromDate}` : '---'}</td>
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
                        <td className="p-3 font-medium text-slate-600">{row.date}</td>
                        <td className="p-3 font-semibold text-slate-800">{row.type}</td>
                        <td className="p-3 text-slate-500 font-mono">{row.inv_no ?? row.bill_no ?? `#${row.entry_id}`}</td>
                        <td className="p-3 text-slate-700">{row.narration}</td>
                        <td className="p-3 text-right font-semibold text-slate-900">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                        <td className="p-3 text-right font-semibold text-slate-900">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
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
    </div>
  );
}
