import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency, balanceColor } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import OpeningBalanceFields from '@/components/OpeningBalanceFields';
import { Plus, Search, MapPin, Edit2, ArrowLeft, Settings, X, UserCheck, Eye } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { CustomerRow, RegionRow, CityRow, AccountLedgerResult } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

export default function CustomerSetupPage() {
  // Directory view state
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const [customerList, setCustomerList] = useState<CustomerRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [custRes, rgRes, ctRes] = await Promise.all([
      api.customers.list({ includeInactive: false }),
      api.listRegions(),
      api.listCities(),
    ]);
    if (custRes.ok) setCustomerList(custRes.data);
    if (rgRes.ok) setRegions(rgRes.data);
    if (ctRes.ok) setCities(ctRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Modal state
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerRegionId, setNewCustomerRegionId] = useState('');
  const [newCustomerCityId, setNewCustomerCityId] = useState('');
  // The opening balance lives on the auto-created business account, not on this row — the service
  // forwards it there (same route bankAccounts.service.js has always used).
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(getTodayDate());
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };

  // Duplicate Check Modal state — non-blocking branch: checkName() is advisory before create()
  const [dupMatches, setDupMatches] = useState<CustomerRow[]>([]);
  const [dupStatus, setDupStatus] = useState<'active' | 'inactive'>('active');
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<{ name: string; region_id: number; city_id?: number } | null>(null);

  // Ledger detail filters
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [ledger, setLedger] = useState<AccountLedgerResult | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const selectedCustomer = useMemo(() => {
    return customerList.find(c => c.customer_id === selectedCustomerId);
  }, [selectedCustomerId, customerList]);

  const loadLedger = useCallback(async () => {
    if (!selectedCustomer?.ba_id) { setLedger(null); return; }
    setLedgerLoading(true);
    const res = await api.reports.accountLedger({ ba_id: selectedCustomer.ba_id, date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok) setLedger(res.data); else setLedger(null);
    setLedgerLoading(false);
  }, [selectedCustomer, fromDate, toDate]);

  useEffect(() => { if (selectedCustomerId) loadLedger(); }, [selectedCustomerId, loadLedger]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customerList;
    const q = searchQuery.toLowerCase();
    return customerList.filter(c =>
      c.name.toLowerCase().includes(q) ||
      String(c.customer_id).includes(q)
    );
  }, [customerList, searchQuery]);

  const handleOpenAdd = () => {
    setEditingCustomerId(null);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: CustomerRow) => {
    setEditingCustomerId(c.customer_id);
    setNewCustomerName(c.name);
    setNewCustomerRegionId(String(c.region_id));
    setNewCustomerCityId(c.city_id ? String(c.city_id) : '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCustomerId(null);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');
    setOpeningBalance('');
    setOpeningDate(getTodayDate());
    setErrorMsg('');
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next
  // customer — instead of closing. G-04: the opening date is deliberately NOT reset here; it
  // stays selected for the rest of this window's session and only clears on handleCloseModal.
  const resetForNextCustomer = () => {
    setEditingCustomerId(null);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');
    setOpeningBalance('');
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const executeAddCustomer = async (data: api.CustomerCreateInput) => {
    const res = await api.customers.create(data);
    if (!res.ok) return setErrorMsg(res.error.message);
    flash('New customer added successfully.');
    resetForNextCustomer();
    loadAll();
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = newCustomerName.trim();
    if (!typed) return setErrorMsg('Customer name is required.');
    if (!newCustomerRegionId) return setErrorMsg('Region is required.');

    const payload = {
      name: typed,
      region_id: Number(newCustomerRegionId),
      city_id: newCustomerCityId ? Number(newCustomerCityId) : undefined,
      opening_balance: openingBalance.trim() ? Number(openingBalance) : undefined,
      opening_date: openingDate.trim() || undefined,
    };

    if (editingCustomerId) {
      const res = await api.customers.update(editingCustomerId, payload);
      if (!res.ok) return setErrorMsg(res.error.message);
      flash('Customer details updated successfully.');
      handleCloseModal();
      loadAll();
    } else {
      const res = await api.customers.checkName(typed);
      if (!res.ok) return setErrorMsg(res.error.message);
      if (res.data.status === 'none') {
        executeAddCustomer(payload);
      } else {
        setDupMatches(res.data.matches);
        setDupStatus(res.data.status);
        setPendingCustomer(payload);
        setIsDupModalOpen(true);
      }
    }
  };

  const handleActivateDuplicate = async (idStr: string) => {
    const res = await api.customers.reactivate(Number(idStr));
    setIsDupModalOpen(false);
    setPendingCustomer(null);
    if (!res.ok) return setErrorMsg('Failed to reactivate: ' + res.error.message);
    flash('Customer reactivated successfully.');
    resetForNextCustomer();
    loadAll();
  };

  const handleCreateNewAnyway = () => {
    if (pendingCustomer) executeAddCustomer(pendingCustomer);
    setIsDupModalOpen(false);
    setPendingCustomer(null);
  };



  const filteredLedgerRows = useMemo(() => ledger?.rows || [], [ledger]);

  const handleExportExcel = () => {
    if (!selectedCustomer) return;
    const headers = ['Date', 'Type', 'Ref No', 'Narration', 'Debit (PKR)', 'Credit (PKR)', 'Balance (PKR)'];
    const rows = [
      [fromDate ? `Before ${formatDate(fromDate)}` : '---', 'Opening Balance', '-', 'Opening Balance brought forward', '0', '0', ledger?.opening_balance || 0],
      ...filteredLedgerRows.map(r => [r.date, r.type, r.inv_no ?? r.bill_no ?? `#${r.entry_id}`, r.narration || '', r.debit, r.credit, r.balance]),
      ['Total', '', '', '', ledger?.total_debit || 0, ledger?.total_credit || 0, ledger?.closing_balance || 0]
    ];
    exportRowsToExcel(`customer-ledger-${selectedCustomer.name.toLowerCase().replace(/\s+/g, '-')}`, headers, rows);
  };

  const cityName = (id: number | null) => cities.find(c => c.city_id === id)?.name || 'No City';
  const regionName = (id: number) => regions.find(r => r.region_id === id)?.name || 'No Region';

  /* ─── Printable Document Render ─── */
  const renderPrintableDocument = () => {
    if (!selectedCustomer) return null;

    return (
      <div className="excel-print-container">
        {/* Header */}
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              CUSTOMER FINANCIAL LEDGER STATEMENT
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' }}>
              Customer: {selectedCustomer.name} (Code: {selectedCustomer.customer_id})
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
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Ref No</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Narration</th>
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
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{formatCurrency(ledger?.opening_balance || 0)}</td>
            </tr>

            {/* Transaction Rows */}
            {filteredLedgerRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ border: '1px solid #000000', padding: '12px', textAlign: 'center', fontStyle: 'italic', color: '#888' }}>
                  No transactions recorded in this date range.
                </td>
              </tr>
            ) : (
              filteredLedgerRows.map((row) => (
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
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(ledger?.total_debit || 0)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(ledger?.total_credit || 0)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(ledger?.closing_balance || 0)}</td>
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
          <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout pageTitle="Customers Setup">

      {/* Interactive Print Preview Modal */}
      {selectedCustomer && (
        <ReportPrintPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          title={`${selectedCustomer.name} — Customer Financial Ledger`}
          orientation="portrait"
          onExportExcel={handleExportExcel}
        >
          {renderPrintableDocument()}
        </ReportPrintPreviewModal>
      )}

      <div className="mx-auto" style={{ maxWidth: 1400 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
        )}

        {!selectedCustomerId ? (
          /* Directory View */
          <div>
            {/* Header Card */}
            <div className="card-white p-6 md:p-8 bg-white border mb-6">
              <div className="border-b pb-4 mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                    <UserCheck size={20} className="text-[#B08D57]" /> Customers Directory
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Browse registered customer accounts. Select a card to view its product ledger.</p>
                </div>

                <button
                  onClick={handleOpenAdd}
                  className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
                >
                  <Plus size={16} /> Register Customer
                </button>
              </div>

              {/* Search Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <input
                    type="text"
                    placeholder="Search by customer name, code..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input w-full py-2 text-xs pr-10 font-semibold"
                  />
                  <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
                </div>

                <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
                  Total: {filteredCustomers.length} Customers
                </div>
              </div>
            </div>

            {/* Customer Row List (shared DataListTable template) */}
            <div className="card-white overflow-hidden">
              <DataListTable<CustomerRow>
                rows={filteredCustomers}
                rowKey={c => c.customer_id}
                onRowClick={c => setSelectedCustomerId(c.customer_id)}
                loading={loading}
                emptyIcon={<UserCheck size={36} />}
                emptyMessage="No registered customers found matching your search."
                columns={[
                  {
                    key: 'code',
                    header: 'Customer ID',
                    width: '140px',
                    render: c => (
                      <span className="font-mono font-semibold text-slate-600 text-xs">#{c.customer_id}</span>
                    ),
                  },
                  {
                    key: 'name',
                    header: 'Customer Name',
                    render: c => <span className="font-semibold text-slate-900">{c.name}</span>,
                  },
                  {
                    key: 'region',
                    header: 'Region',
                    render: c => (
                      <span className="text-slate-600 font-medium">
                        {c.region_name || regionName(c.region_id)}
                      </span>
                    ),
                  },
                  {
                    key: 'city',
                    header: 'City',
                    render: c => (
                      <span className="text-slate-600 font-medium flex items-center gap-1">
                        <MapPin size={12} className="text-slate-400" />
                        {c.city_name || cityName(c.city_id)}
                      </span>
                    ),
                  },
                  {
                    key: 'address',
                    header: 'Address',
                    render: c => <span className="text-slate-500 text-xs">{c.address || '—'}</span>,
                  },
                ]}
                actions={c => (
                  <>
                    <button
                      onClick={() => handleOpenEdit(c)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                      title="Edit Customer"
                    >
                      <Edit2 size={15} />
                    </button>
                  </>
                )}
              />
            </div>
          </div>
        ) : (
          /* Detailed Ledger View */
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6" data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedCustomerId(null)}
                  className="bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
                >
                  <ArrowLeft size={16} /> Back to Directory
                </button>
                <div>
                  <h2 className="font-lora font-bold text-xl text-slate-900">
                    Ledger: {selectedCustomer?.name}
                  </h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">Code: {selectedCustomer?.customer_id}</p>
                </div>
              </div>

              {/* Single Gold Action Button: Show Print Preview */}
              <button
                onClick={() => setIsPreviewOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
              >
                <Eye size={15} /> Show Print Preview
              </button>
            </div>

            {/* Date Filters */}
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
              <div className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg flex items-center gap-2 text-xs font-semibold">
                <span className="text-slate-400">Opening Balance:</span>
                <span className="text-[#B08D57] font-bold">{formatCurrency(ledger?.opening_balance || 0)}</span>
              </div>
            </div>

            {/* Printable Table */}
            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b text-slate-700 font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Ref No</th>
                      <th className="p-3">Narration</th>
                      <th className="p-3 text-right">Debit (PKR)</th>
                      <th className="p-3 text-right">Credit (PKR)</th>
                      <th className="p-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerLoading ? (
                      <tr><td colSpan={7} className="text-center p-6 text-slate-400 italic">Loading…</td></tr>
                    ) : filteredLedgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center p-6 text-slate-400 italic">
                          No ledger transactions recorded for this customer in the selected period.
                        </td>
                      </tr>
                    ) : (
                      filteredLedgerRows.map((row) => (
                        <tr key={row.entry_id} className="border-b hover:bg-slate-50/60 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 font-medium text-slate-600">{formatDate(row.date)}</td>
                          <td className="p-3 text-slate-700">{row.type}</td>
                          <td className="p-3 text-slate-500 font-mono">{row.inv_no ?? row.bill_no ?? `#${row.entry_id}`}</td>
                          <td className="p-3 text-slate-600">{row.narration || '-'}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                          <td className="p-3 text-right font-semibold text-rose-700">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                          <td className="p-3 text-right font-bold" style={{ color: balanceColor(row.balance) }}>{formatCurrency(row.balance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-900 text-white font-bold text-xs">
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-[#B08D57]">Totals</td>
                      <td className="p-3 text-right">{formatCurrency(ledger?.total_debit || 0)}</td>
                      <td className="p-3 text-right text-rose-700">{formatCurrency(ledger?.total_credit || 0)}</td>
                      <td className="p-3 text-right" style={{ color: balanceColor(ledger?.closing_balance || 0) }}>{formatCurrency(ledger?.closing_balance || 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}
            onKeyDown={e => { if (e.key === 'Escape') { (handleCloseModal)(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {editingCustomerId ? 'Edit Customer Details' : 'Register New Customer'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveCustomer} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Customer Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    required
                    value={newCustomerName}
                    onChange={e => setNewCustomerName(e.target.value)}
                    placeholder="e.g. Metro Distributors"
                    className="soleria-input w-full text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Region <span className="text-rose-500">*</span>
                  </label>
                  <SearchableSelect
                    options={regions.map(r => ({ value: String(r.region_id), label: r.name }))}
                    value={newCustomerRegionId}
                    onChange={setNewCustomerRegionId}
                    placeholder="Select Region..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    City <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <SearchableSelect
                    options={cities.map(c => ({ value: String(c.city_id), label: c.name }))}
                    value={newCustomerCityId}
                    onChange={setNewCustomerCityId}
                    placeholder="Select City..."
                  />
                </div>

                <OpeningBalanceFields
                  balance={openingBalance}
                  date={openingDate}
                  onBalanceChange={setOpeningBalance}
                  onDateChange={setOpeningDate}
                  isExisting={editingCustomerId != null}
                />

                <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold px-5 py-2 text-xs font-semibold cursor-pointer"
                  >
                    {editingCustomerId ? 'Update Details' : 'Save Customer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Duplicate Customer Warning Prompt Modal */}
        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="Customer"
          status={dupStatus}
          matches={dupMatches.map(c => ({ id: String(c.customer_id), name: c.name, regionName: c.region_name, cityName: c.city_name }))}
          allowCreateOnActive={true}
          onActivate={handleActivateDuplicate}
          onCreateNew={handleCreateNewAnyway}
          onCancel={() => { setIsDupModalOpen(false); setPendingCustomer(null); }}
        />
      </div>
    </AppLayout>
  );
}
