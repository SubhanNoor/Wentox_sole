import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, ArrowLeft, Users, User, Truck, HardHat, Landmark, BookOpen, Eye } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { OverallDirectoryRow, OverallEntityType, LedgerRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

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
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

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
      [fromDate ? `Before ${formatDate(fromDate)}` : '---', 'Opening Balance', '-', 'Opening Balance brought forward', '0', '0', openingBalance],
      ...filteredRows.map(r => [formatDate(r.date), r.type, r.inv_no ?? r.bill_no ?? `#${r.entry_id}`, r.narration || '', r.debit, r.credit, r.balance]),
      ['Total', '', '', '', totalDebit, totalCredit, endingBalance]
    ];
    exportRowsToExcel(`ledger-${selectedPerson.name.toLowerCase().replace(/\s+/g, '-')}`, headers, rows);
  };

  // One consistent badge style for every entity type — the icon still varies (getTypeIcon) so
  // the type is still distinguishable, but the box itself no longer changes color/size per type.
  const TYPE_BADGE_STYLE = 'bg-slate-100 text-slate-700 border-slate-300';

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

  /* ─── Printable Document Render ─── */
  const renderPrintableDocument = () => {
    if (!selectedPerson) return null;

    return (
      <div className="excel-print-container">
        {/* Header */}
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              FINANCIAL LEDGER STATEMENT
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' }}>
              Account: {selectedPerson.name} ({selectedPerson.typeLabel})
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Period: {fromDate ? formatDate(fromDate) : 'Beginning'} to {toDate ? formatDate(toDate) : 'Present'}
            </p>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        {/* Table */}
        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Type</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Ref / Bill #</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Description / Narration</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Debit (PKR)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Credit (PKR)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Balance (PKR)</th>
            </tr>
          </thead>
          <tbody>
            {/* Opening Balance Row */}
            <tr style={{ backgroundColor: '#fafafa', fontWeight: 'bold' }}>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{fromDate ? `Before ${formatDate(fromDate)}` : '---'}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>Opening Balance</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>-</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontStyle: 'italic' }}>Opening Balance brought forward</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>0</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>0</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{formatCurrency(openingBalance)}</td>
            </tr>

            {/* Transaction Rows */}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ border: '1px solid #000000', padding: '12px', textAlign: 'center', fontStyle: 'italic', color: '#888' }}>
                  No transactions recorded in this date range.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.entry_id}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>{formatDate(row.date)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{row.type}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>{row.inv_no ?? row.bill_no ?? `#${row.entry_id}`}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{row.narration || '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                  </td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                  </td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>
                    {formatCurrency(row.balance)}
                  </td>
                </tr>
              ))
            )}

            {/* Totals Row */}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td colSpan={4} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'left', textTransform: 'uppercase' }}>
                Totals for Selected Period
              </td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totalDebit)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totalCredit)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(endingBalance)}</td>
            </tr>
          </tbody>
        </table>

        {/* Signature & Print Info footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
          <div>WENTOX FOOTWEAR DISTRIBUTION</div>
          <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout pageTitle="Overall Searching & Person Ledger">

      {/* Interactive Print Preview Modal */}
      {selectedPerson && (
        <ReportPrintPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          title={`${selectedPerson.name} — Financial Ledger Statement`}
          orientation="portrait"
          onExportExcel={handleExportExcel}
        >
          {renderPrintableDocument()}
        </ReportPrintPreviewModal>
      )}

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

            {/* Entity Directory Row List (shared DataListTable template) */}
            <div className="card-white overflow-hidden">
              <DataListTable<PersonEntity>
                rows={filteredPeople}
                rowKey={person => `${person.entityType}-${person.id}`}
                onRowClick={person => setSelectedPerson(person)}
                loading={loading}
                loadingMessage="Loading directory…"
                emptyMessage="No matching accounts found."
                columns={[
                  {
                    key: 'type',
                    header: 'Type',
                    width: '180px',
                    render: person => (
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded border uppercase tracking-wider inline-flex items-center gap-1.5 whitespace-nowrap ${TYPE_BADGE_STYLE}`}>
                        {getTypeIcon(person.type)} {person.typeLabel}
                      </span>
                    ),
                  },
                  {
                    key: 'name',
                    header: 'Account Name',
                    render: person => <span className="font-semibold text-slate-900">{person.name}</span>,
                  },
                  {
                    key: 'subtitle',
                    header: 'Code / City',
                    render: person => (
                      <span className="font-mono text-xs text-slate-500">{person.subtitle}</span>
                    ),
                  },
                  {
                    key: 'ledger',
                    header: '',
                    width: '160px',
                    align: 'right',
                    render: () => (
                      <span className="text-xs font-semibold text-[var(--brand-gold)]">
                        View Detailed Ledger &rarr;
                      </span>
                    ),
                  },
                ]}
              />
            </div>
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
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded border uppercase tracking-wider whitespace-nowrap ${TYPE_BADGE_STYLE}`}>
                      {selectedPerson.typeLabel}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">{selectedPerson.subtitle}</p>
                </div>
              </div>

              {/* Action Button: Single Gold Show Print Preview */}
              <button
                onClick={() => setIsPreviewOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
              >
                <Eye size={15} /> Show Print Preview
              </button>
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
                    Period: {fromDate ? formatDate(fromDate) : 'Beginning'} to {toDate ? formatDate(toDate) : 'Present'} • Account Type: {selectedPerson.typeLabel}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p className="font-bold text-slate-800">WENTOX FOOTWEAR DISTRIBUTION</p>
                  <p>Generated: {formatDate(new Date())}</p>
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
                        <td className="p-3 text-slate-500">{fromDate ? `Before ${formatDate(fromDate)}` : '---'}</td>
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
                            <td className="p-3 font-medium text-slate-600">{formatDate(row.date)}</td>
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
