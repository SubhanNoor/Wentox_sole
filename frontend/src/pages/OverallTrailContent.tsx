import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import { formatCurrency } from '@/context/AppContext';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, Printer, FileDown, FileSpreadsheet, ArrowLeft, ChevronRight, Filter } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { OverallTrailRow, LedgerRow } from '@/lib/api';

type AccountGroupType = 'all' | 'customer' | 'vendor' | 'employee' | 'bank' | 'chart_account' | 'business_account';

export default function OverallTrailContent() {
  const [asOfDate, setAsOfDate] = useState(getTodayDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<AccountGroupType>('all');

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

  // Drill-down: every row already carries either ba_id or ac_id — reuse the same
  // reports.accountLedger() channel every other ledger view uses.
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
                    onChange={e => setAsOfDate(e.target.value)}
                    className="soleria-input py-1.5 px-3 text-xs font-semibold"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <Printer size={14} /> Print Report
                </button>
                <button onClick={() => exportToPDF()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <FileDown size={14} /> Export PDF
                </button>
                <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <FileSpreadsheet size={14} /> Export Excel
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
                  onClick={() => setSelectedGroup(grp)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    selectedGroup === grp
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
          <div className="card-white p-5 md:p-6 bg-white border">
            {/* Header metadata */}
            <div className="border-b pb-3 mb-4 flex justify-between items-start">
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-900">Business Accounts Balances Details</h3>
                <p className="text-xs text-slate-500 font-medium">As On Date: <span className="font-bold text-slate-700">{asOfDate || 'Today'}</span></p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-bold text-slate-800 uppercase tracking-wider">WENTOX FOOTWEAR DISTRIBUTION</p>
                <p className="text-[#B08D57] font-semibold">Overall Trail Balances Statement</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#111c2a] text-[#B08D57] font-bold uppercase tracking-wider text-[11px] border-b border-[#1a293d]">
                    <th className="p-3 border-r border-[#1a293d]" style={{ width: '160px' }}>Account Code</th>
                    <th className="p-3 border-r border-[#1a293d]">Account Description</th>
                    <th className="p-3 border-r border-[#1a293d]" style={{ width: '130px' }}>Category</th>
                    <th className="p-3 text-center border-r border-[#1a293d]" colSpan={2}>
                      Trail Balances
                    </th>
                    <th className="p-3 text-center" style={{ width: '100px' }}>Action</th>
                  </tr>
                  <tr className="bg-[#1a293d] text-[#B08D57]/90 font-bold uppercase tracking-wider text-[10px] border-b border-slate-700">
                    <th className="p-2 border-r border-[#1a293d]" colSpan={3}></th>
                    <th className="p-2 text-right border-r border-[#1a293d]" style={{ width: '150px' }}>Debit (Naam)</th>
                    <th className="p-2 text-right border-r border-[#1a293d]" style={{ width: '150px' }}>Credit (Jamma)</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={6} className="text-center p-8 text-slate-400 italic">Loading…</td></tr>
                  ) : filteredBalances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400 italic">
                        No account balances found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    groupedBalances.map(([groupName, groupRows]) => {
                      const sectionDebit = groupRows.reduce((s, r) => s + r.debit, 0);
                      const sectionCredit = groupRows.reduce((s, r) => s + r.credit, 0);

                      return (
                        <Fragment key={groupName}>
                          <tr className="bg-[#111c2a] text-[#B08D57] font-bold text-xs border-y border-[#B08D57]/30">
                            <td colSpan={6} className="py-2.5 px-4 font-lora font-bold text-xs text-[#B08D57] uppercase tracking-wider">
                              CATEGORY SECTION: {groupName.toUpperCase()} ({groupRows.length} ACCOUNTS)
                            </td>
                          </tr>

                          {groupRows.map((row, idx) => (
                            <tr
                              key={`${row.type}-${row.code}-${idx}`}
                              onClick={() => setSelectedAccount(row)}
                              className="hover:bg-slate-50/80 transition-colors cursor-pointer group even:bg-slate-50/30"
                            >
                              <td className="p-2.5 pl-3 border-r border-slate-100">
                                <span className="inline-block px-3 py-1 text-xs font-mono font-bold rounded-full bg-[#111c2a] text-[#B08D57] border border-[#B08D57]/30 shadow-xs">
                                  {row.code}
                                </span>
                              </td>
                              <td className="p-2.5 font-bold text-slate-900 group-hover:text-[#B08D57] transition-colors border-r border-slate-100">
                                <div className="flex items-center justify-between">
                                  <span>{row.description}</span>
                                  <ChevronRight size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </td>
                              <td className="p-2.5 border-r border-slate-100">
                                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border uppercase tracking-wider">
                                  {row.type_label}
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-bold text-slate-900 border-r border-slate-100 font-mono">
                                {row.debit > 0 ? (
                                  <span className="text-emerald-700 font-semibold">{formatCurrency(row.debit)}</span>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                              <td className="p-2.5 text-right font-bold text-slate-900 border-r border-slate-100 font-mono">
                                {row.credit > 0 ? (
                                  <span className="text-rose-700 font-semibold">({formatCurrency(row.credit)})</span>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                              <td className="p-2.5 text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedAccount(row);
                                  }}
                                  className="px-3.5 py-1 text-[11px] font-semibold text-[#111c2a] bg-[#B08D57] hover:bg-[#111c2a] hover:text-[#B08D57] border border-[#B08D57] rounded-full transition-all shadow-xs"
                                >
                                  View Ledger
                                </button>
                              </td>
                            </tr>
                          ))}

                          <tr className="bg-[#111c2a] text-[#B08D57] font-bold text-xs border-y-2 border-[#B08D57]">
                            <td colSpan={3} className="p-3 text-left pl-4 font-bold text-[#B08D57] uppercase tracking-wider border-r border-[#1a293d] font-lora">
                              SUBTOTAL SUMMARY FOR {groupName.toUpperCase()} ({groupRows.length} ACCOUNTS):
                            </td>
                            <td className="p-3 text-right font-bold text-emerald-400 border-r border-[#1a293d] font-mono">
                              {sectionDebit > 0 ? formatCurrency(sectionDebit) : '-'}
                            </td>
                            <td className="p-3 text-right font-bold text-rose-300 border-r border-[#1a293d] font-mono">
                              {sectionCredit > 0 ? `(${formatCurrency(sectionCredit)})` : '-'}
                            </td>
                            <td className="p-3"></td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-[#111c2a] text-white font-bold text-xs">
                    <td colSpan={3} className="p-3 text-right uppercase tracking-wider text-[#B08D57] border-r border-slate-800 font-bold">
                      Grand Total Trail Balances
                    </td>
                    <td className="p-3 text-right border-r border-slate-800 text-emerald-400 font-bold font-mono">{formatCurrency(filteredTotals.totalDebit)}</td>
                    <td className="p-3 text-right border-r border-slate-800 text-rose-300 font-bold font-mono">({formatCurrency(filteredTotals.totalCredit)})</td>
                    <td className="p-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
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

            {/* Print & Export Controls */}
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                <Printer size={14} /> Print Ledger
              </button>
              <button onClick={() => exportToPDF()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                <FileDown size={14} /> Export PDF
              </button>
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
    </div>
  );
}
