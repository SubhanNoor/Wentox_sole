import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, Printer, FileDown, FileSpreadsheet, ArrowLeft, Users, User, Truck, HardHat, Landmark, BookOpen } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { OverallDirectoryRow, OverallEntityType, LedgerRow } from '@/lib/api';

type EntityType = 'customer' | 'vendor' | 'employee' | 'subcustomer' | 'account' | 'bank';

// Backend's entity_type enum -> this page's own lowercase union, mapped once at the API edge.
const ENTITY_TYPE_MAP: Record<OverallEntityType, { type: EntityType; label: string }> = {
  CUSTOMER: { type: 'customer', label: 'Customer' },
  VENDOR: { type: 'vendor', label: 'Vendor Partner' },
  EMPLOYEE: { type: 'employee', label: 'Employee' },
  SUB_CUSTOMER: { type: 'subcustomer', label: 'Sub-Customer' },
  BUSINESS_ACCOUNT: { type: 'account', label: 'Business Account' },
  BANK: { type: 'bank', label: 'Bank Account' },
};

interface PersonEntity {
  id: number;
  name: string;
  type: EntityType;
  typeLabel: string;
  subtitle: string;
  entityType: OverallEntityType;
  baId: number | null;
}

export default function OverallSearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState<'all' | EntityType>('all');
  const [selectedPerson, setSelectedPerson] = useState<PersonEntity | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleCloseDetail = () => {
    setIsClosing(true);
    setTimeout(() => {
      setSelectedPerson(null);
      setIsClosing(false);
    }, 200);
  };

  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  const [directory, setDirectory] = useState<OverallDirectoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.overallSearch({ search: searchQuery.trim() || undefined });
    if (res.ok) setDirectory(res.data);
    setLoading(false);
  }, [searchQuery]);

  useEffect(() => { loadDirectory(); }, [loadDirectory]);

  const allPeople = useMemo<PersonEntity[]>(() => {
    return directory.map(d => {
      const mapped = ENTITY_TYPE_MAP[d.entity_type];
      return {
        id: d.entity_id,
        name: d.name,
        type: mapped.type,
        typeLabel: mapped.label,
        subtitle: `Code: ${d.entity_id}${d.city_name ? ` • ${d.city_name}` : ''}`,
        entityType: d.entity_type,
        baId: d.ba_id,
      };
    });
  }, [directory]);

  // Search itself is server-side (reports.overallSearch already filters by name/id) — only the
  // entity-type quick filter is applied client-side here.
  const filteredPeople = useMemo(() => {
    if (entityFilter === 'all') return allPeople;
    return allPeople.filter(p => p.type === entityFilter);
  }, [allPeople, entityFilter]);

  // ── Ledger drill-down ──
  const [ledger, setLedger] = useState<{ has_account: boolean; message?: string; opening_balance?: number; rows?: LedgerRow[]; total_debit?: number; total_credit?: number; closing_balance?: number } | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const loadLedger = useCallback(async () => {
    if (!selectedPerson) return;
    setLedgerLoading(true);
    const res = await api.reports.overallSearchLedger({
      entity_type: selectedPerson.entityType,
      ba_id: selectedPerson.baId,
      date_from: fromDate || undefined,
      date_to: toDate || undefined,
    });
    if (res.ok) setLedger(res.data); else setLedger(null);
    setLedgerLoading(false);
  }, [selectedPerson, fromDate, toDate]);

  useEffect(() => { if (selectedPerson) loadLedger(); }, [selectedPerson, loadLedger]);

  const openingBalance = ledger?.opening_balance || 0;
  const totalDebit = ledger?.total_debit || 0;
  const totalCredit = ledger?.total_credit || 0;
  const endingBalance = ledger?.closing_balance || 0;
  const filteredRows = ledger?.rows || [];

  const handleExportExcel = () => {
    if (!selectedPerson) return;
    const headers = ['Date', 'Type', 'Reference', 'Narration', 'Debit (PKR)', 'Credit (PKR)', 'Balance (PKR)'];
    const rows = [
      [fromDate ? `Before ${fromDate}` : '---', 'Opening Balance', '-', 'Opening Balance brought forward', '0', '0', openingBalance],
      ...filteredRows.map(r => [r.date, r.type, r.inv_no ?? r.bill_no ?? `#${r.entry_id}`, r.narration || '', r.debit, r.credit, r.balance]),
      ['Total', '', '', '', totalDebit, totalCredit, endingBalance]
    ];
    exportRowsToExcel(`ledger-${selectedPerson.name.toLowerCase().replace(/\s+/g, '-')}`, headers, rows);
  };

  const getTypeBadgeStyle = (type: EntityType) => {
    switch (type) {
      case 'customer':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'vendor':
        return 'bg-slate-900 text-[#B08D57] border-slate-700';
      case 'employee':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'subcustomer':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'account':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'bank':
        return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getTypeIcon = (type: EntityType) => {
    switch (type) {
      case 'customer': return <User size={16} />;
      case 'vendor': return <Truck size={16} />;
      case 'employee': return <HardHat size={16} />;
      case 'subcustomer': return <Users size={16} />;
      case 'account': return <Landmark size={16} />;
      case 'bank': return <Landmark size={16} />;
      default: return <BookOpen size={16} />;
    }
  };

  return (
    <AppLayout pageTitle="Overall Searching & Person Ledger">
      <div className="mx-auto" style={{ maxWidth: 1400 }}>

        {/* VIEW 1: Directory & Person Search */}
        {!selectedPerson ? (
          <div>
            {/* Header Description */}
            <div className="mb-6">
              <h2 className="font-lora font-bold text-xl text-slate-800">Overall Person & Account Search</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Search any customer, vendor, employee worker, sub-customer, or business account by name or code to view their ledger.
              </p>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 rounded-xl border mb-6 bg-white shadow-2xs flex flex-wrap items-center justify-between gap-4" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                <div className="relative min-w-[260px] max-w-md flex-1">
                  <Search className="absolute left-3.5 top-2.5 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search by name, code, city, or phone..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input pl-10 py-2 w-full text-sm font-semibold"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(['all', 'customer', 'vendor', 'employee', 'subcustomer', 'account', 'bank'] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEntityFilter(tab)}
                      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold cursor-pointer transition-all select-none ${
                        entityFilter === tab
                          ? 'bg-[#111c2a] text-white border-[#111c2a] shadow-sm font-bold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-slate-300" />
                      {tab === 'all' ? 'All Entities' : tab === 'customer' ? 'Customers' : tab === 'vendor' ? 'Vendors' : tab === 'employee' ? 'Employees' : tab === 'subcustomer' ? 'Sub-Customers' : tab === 'account' ? 'Accounts' : 'Banks'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Entity Directory Cards Grid */}
            {loading ? (
              <div className="card-white p-12 text-center text-slate-400">Loading…</div>
            ) : filteredPeople.length === 0 ? (
              <div className="card-white p-12 text-center text-slate-400">
                <Users size={36} className="mx-auto mb-3 text-slate-300" />
                <p className="font-semibold text-slate-600">No person or account matches your search query.</p>
                <p className="text-xs text-slate-400 mt-1">Try typing a different name or clearing your filter criteria.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredPeople.map(person => {
                  const initialLetter = person.name.trim().charAt(0).toUpperCase();

                  return (
                    <div
                      key={`${person.type}-${person.id}`}
                      onClick={() => setSelectedPerson(person)}
                      className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                    >
                      <div>
                        {/* Top: Code badge & Type badge */}
                        <div className="flex items-center justify-between mb-3.5">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                            ID: {person.id}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider flex items-center gap-1 ${getTypeBadgeStyle(person.type)}`}>
                            {getTypeIcon(person.type)}
                            {person.typeLabel}
                          </span>
                        </div>

                        {/* Middle: Avatar + Name */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors leading-tight truncate">
                              {person.name}
                            </h4>
                            <p className="font-mono text-xs text-slate-400 mt-0.5 truncate">
                              {person.subtitle}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Action */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-between text-xs font-semibold text-slate-400 group-hover:text-[var(--brand-navy)] transition-colors">
                        <span>Financial Ledger</span>
                        <span className="text-sm font-bold group-hover:translate-x-1 transition-transform">&rarr;</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* VIEW 2: Selected Person Detailed Financial Ledger */
          <div className={`transition-all duration-200 ${isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
            {/* Top Navigation Back Arrow & Title Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6" data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCloseDetail}
                  className="bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl px-4 py-2 text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
                >
                  <ArrowLeft size={16} /> Back to Search
                </button>
                <div>
                  <h2 className="font-lora font-bold text-xl text-slate-900 flex items-center gap-2">
                    {selectedPerson.name}
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded border uppercase tracking-wider ${getTypeBadgeStyle(selectedPerson.type)}`}>
                      {selectedPerson.typeLabel}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">{selectedPerson.subtitle}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer">
                  <Printer size={14} /> Print Ledger
                </button>
                <button onClick={() => exportToPDF()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer">
                  <FileDown size={14} /> Export PDF
                </button>
                <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer">
                  <FileSpreadsheet size={14} /> Export Excel
                </button>
              </div>
            </div>

            {/* Date Filters Card */}
            <div className="p-4 rounded-xl border mb-6 bg-white shadow-2xs flex flex-wrap items-center justify-between gap-4" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase">From Date:</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase">To Date:</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                  />
                </div>
              </div>

              {/* Net Balance Status Pill */}
              <div className="px-3.5 py-1.5 bg-slate-900 text-white rounded-xl flex items-center gap-2 text-xs font-semibold">
                <span className="text-slate-400">Net Ending Balance:</span>
                <span className="text-[var(--brand-gold)] font-bold font-mono text-sm">{formatCurrency(endingBalance)}</span>
              </div>
            </div>

            {/* Printable Ledger Container */}
            <div className="card-white p-6 md:p-8 bg-white border">
              {/* Printable Header */}
              <div className="border-b pb-4 mb-6 flex justify-between items-start">
                <div>
                  <h3 className="font-lora font-bold text-xl text-slate-900">{selectedPerson.name} — Financial Ledger Statement</h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Period: {fromDate || 'Beginning'} to {toDate || 'Present'} • Account Type: {selectedPerson.typeLabel}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p className="font-bold text-slate-800">WENTOX FOOTWEAR DISTRIBUTION</p>
                  <p>Generated: {new Date().toLocaleDateString()}</p>
                </div>
              </div>

              {ledgerLoading ? (
                <div className="text-center p-8 text-slate-400">Loading…</div>
              ) : ledger && !ledger.has_account ? (
                <div className="text-center p-8 text-slate-400 italic">
                  {ledger.message || 'This party has no financial account.'}
                </div>
              ) : (
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
                    {/* Opening Balance Row */}
                    <tr className="border-b bg-amber-50/40 font-semibold text-slate-700" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 text-slate-500">{fromDate ? `Before ${fromDate}` : '---'}</td>
                      <td className="p-3 font-bold text-amber-800">Opening Balance</td>
                      <td className="p-3">-</td>
                      <td className="p-3 italic text-slate-500">Opening Balance brought forward</td>
                      <td className="p-3 text-right">0</td>
                      <td className="p-3 text-right">0</td>
                      <td className="p-3 text-right font-bold text-amber-900">{formatCurrency(openingBalance)}</td>
                    </tr>

                    {/* Transaction Rows */}
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center p-6 text-slate-400 italic">
                          No transactions recorded for {selectedPerson.name} in this date range.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => (
                        <tr
                          key={row.entry_id}
                          className="border-b hover:bg-slate-50/60 transition-colors"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 font-medium text-slate-600">{row.date}</td>
                          <td className="p-3 font-semibold text-slate-800">{row.type}</td>
                          <td className="p-3 text-slate-500 font-mono">{row.inv_no ?? row.bill_no ?? `#${row.entry_id}`}</td>
                          <td className="p-3 text-slate-700">{row.narration}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">
                            {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                          </td>
                          <td className="p-3 text-right font-semibold text-slate-900">
                            {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                          </td>
                          <td className="p-3 text-right font-bold text-amber-900">
                            {formatCurrency(row.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {/* Footer Totals */}
                  <tfoot>
                    <tr className="bg-slate-900 text-white font-bold text-xs">
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-[#B08D57]">
                        Totals for Selected Period
                      </td>
                      <td className="p-3 text-right">{formatCurrency(totalDebit)}</td>
                      <td className="p-3 text-right">{formatCurrency(totalCredit)}</td>
                      <td className="p-3 text-right text-[#B08D57]">{formatCurrency(endingBalance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              )}
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
