import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Printer, MapPin, Edit2, Trash2, FileDown, ArrowLeft, Settings, Save, X, ArrowRight, UserCheck, Download } from 'lucide-react';
import { exportToPDF } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { CustomerRow, RegionRow, CityRow, AccountLedgerResult } from '@/lib/api';

export default function CustomerSetupPage() {
  // Directory view state
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerRegionId, setNewCustomerRegionId] = useState('');
  const [newCustomerCityId, setNewCustomerCityId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };

  // Duplicate Check Modal state — non-blocking branch: checkName() is advisory before create()
  const [dupMatches, setDupMatches] = useState<CustomerRow[]>([]);
  const [dupStatus, setDupStatus] = useState<'active' | 'inactive'>('active');
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<{ name: string; region_id: number; city_id?: number } | null>(null);

  const [deletingCustomer, setDeletingCustomer] = useState<CustomerRow | null>(null);

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
    setErrorMsg('');
  };

  const executeAddCustomer = async (data: { name: string; region_id: number; city_id?: number }) => {
    const res = await api.customers.create(data);
    if (!res.ok) return setErrorMsg(res.error.message);
    flash('New customer added successfully.');
    handleCloseModal();
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
    handleCloseModal();
    loadAll();
  };

  const handleCreateNewAnyway = () => {
    if (pendingCustomer) executeAddCustomer(pendingCustomer);
    setIsDupModalOpen(false);
    setPendingCustomer(null);
  };

  const confirmDelete = async () => {
    if (!deletingCustomer) return;
    const res = await api.customers.remove(deletingCustomer.customer_id);
    setDeletingCustomer(null);
    if (!res.ok) return setErrorMsg('Failed to delete: ' + res.error.message);
    flash('Customer deleted successfully.');
    handleCloseModal();
    loadAll();
  };

  const filteredLedgerRows = useMemo(() => ledger?.rows || [], [ledger]);

  const handleExportCSV = () => {
    const header = ['Date', 'Type', 'Ref No', 'Narration', 'Debit', 'Credit', 'Balance'];
    const lines = filteredLedgerRows.map(r => [r.date, r.type, r.inv_no ?? r.bill_no ?? `#${r.entry_id}`, r.narration || '', r.debit, r.credit, r.balance]);
    const csv = [header, ...lines].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedCustomer?.name || 'customer'}_ledger.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const cityName = (id: number | null) => cities.find(c => c.city_id === id)?.name || 'No City';
  const regionName = (id: number) => regions.find(r => r.region_id === id)?.name || 'No Region';

  return (
    <AppLayout pageTitle="Customers Setup">
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

            {/* Customer Cards Grid */}
            {loading ? (
              <div className="card-white p-12 text-center text-slate-400">Loading…</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="card-white p-12 text-center text-slate-400">
                <UserCheck size={36} className="mx-auto mb-3 text-slate-300" />
                <p className="font-semibold text-slate-600">No registered customers found matching your search.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredCustomers.map(c => (
                  <div
                    key={c.customer_id}
                    onClick={() => setSelectedCustomerId(c.customer_id)}
                    className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                  >
                    <div>
                      {/* Header: Title + City Badge */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                          {c.name}
                        </h4>
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                          <MapPin size={10} className="text-slate-400" />
                          {c.city_name || cityName(c.city_id)}
                        </span>
                      </div>

                      {/* Subtitle: Code in mono */}
                      <div className="font-mono text-xs text-slate-400 mb-3">
                        Customer ID: <span className="font-semibold text-slate-600">#{c.customer_id}</span>
                      </div>

                      <div className="text-xs text-slate-500 font-medium border-t border-slate-100 pt-2.5">
                        Region: <span className="font-semibold text-slate-700">{c.region_name || regionName(c.region_id)}</span>
                      </div>
                    </div>

                    {/* Footer Bar */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleOpenEdit(c)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                          title="Edit Customer"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => setDeletingCustomer(c)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                          title="Delete Customer"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                        Product Ledger <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer">
                  <Printer size={14} /> Print Ledger
                </button>
                <button onClick={() => exportToPDF()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer">
                  <FileDown size={14} /> Export PDF
                </button>
                <button onClick={handleExportCSV} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer">
                  <Download size={14} /> Export CSV
                </button>
              </div>
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
                          <td className="p-3 font-medium text-slate-600">{row.date}</td>
                          <td className="p-3 text-slate-700">{row.type}</td>
                          <td className="p-3 text-slate-500 font-mono">{row.inv_no ?? row.bill_no ?? `#${row.entry_id}`}</td>
                          <td className="p-3 text-slate-600">{row.narration || '-'}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                          <td className="p-3 text-right font-bold text-amber-800">{formatCurrency(row.balance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-900 text-white font-bold text-xs">
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-[#B08D57]">Totals</td>
                      <td className="p-3 text-right">{formatCurrency(ledger?.total_debit || 0)}</td>
                      <td className="p-3 text-right">{formatCurrency(ledger?.total_credit || 0)}</td>
                      <td className="p-3 text-right text-[#B08D57]">{formatCurrency(ledger?.closing_balance || 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
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
                    type="text"
                    value={newCustomerName}
                    onChange={e => setNewCustomerName(e.target.value)}
                    placeholder="Enter customer name..."
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Region Location <span className="text-rose-500">*</span>
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
                      City Location
                    </label>
                    <SearchableSelect
                      options={[
                        { value: '', label: 'Select City...' },
                        ...cities.map(c => ({ value: String(c.city_id), label: c.name }))
                      ]}
                      value={newCustomerCityId}
                      onChange={setNewCustomerCityId}
                      placeholder="Select City..."
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold px-5 py-2 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Save size={14} /> Save Customer
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="customer"
          status={dupStatus}
          matches={dupMatches.map(c => ({
            id: String(c.customer_id),
            name: c.name,
            cityName: c.city_name,
          }))}
          allowCreateOnActive={true}
          onActivate={handleActivateDuplicate}
          onCreateNew={handleCreateNewAnyway}
          onCancel={() => {
            setIsDupModalOpen(false);
            setPendingCustomer(null);
          }}
        />

        {/* Delete confirmation */}
        {deletingCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setDeletingCustomer(null)}>
            <div className="bg-white rounded-2xl border-2 border-rose-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2">Delete Customer</h3>
              <p className="text-xs text-slate-600 mb-4">
                Delete <strong>{deletingCustomer.name}</strong>? This deactivates the record — past
                sale/receipt history is kept intact.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeletingCustomer(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmDelete} className="px-4 py-2 text-xs font-semibold cursor-pointer rounded-lg bg-rose-600 text-white hover:bg-rose-700">Delete</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
