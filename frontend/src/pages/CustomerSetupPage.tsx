import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Printer, MapPin, Edit2, Trash2, FileDown, ArrowLeft, Settings, Save, X, ArrowRight, UserCheck, Download } from 'lucide-react';
import { exportToPDF } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import type { Customer } from '@/types';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';

interface ProductLedgerRow {
  date: string;
  refId: string;
  article: string;
  debit: number;       // sale value for that article
  credit: number;       // sale return value for that article
  returnQty: number;    // pairs returned for that article
}

export default function CustomerSetupPage() {
  const { state, dispatch } = useApp();

  // Directory view state
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerRegionId, setNewCustomerRegionId] = useState('');
  const [newCustomerCityId, setNewCustomerCityId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Duplicate Check Modal state (Flow B)
  const [dupMatches, setDupMatches] = useState<Customer[]>([]);
  const [dupStatus, setDupStatus] = useState<'active' | 'inactive'>('active');
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<{ name: string; regionId: string; cityId: string } | null>(null);

  // Ledger detail filters
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [articleFilter, setArticleFilter] = useState('');

  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === selectedCustomerId);
  }, [selectedCustomerId, state.customers]);

  const activeCustomers = useMemo(() => {
    return state.customers.filter(c => c.isActive !== false);
  }, [state.customers]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return activeCustomers;
    const q = searchQuery.toLowerCase();
    return activeCustomers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  }, [activeCustomers, searchQuery]);

  const activeRegions = useMemo(() => {
    return state.regions.filter(r => r.isActive !== false);
  }, [state.regions]);

  const activeCities = useMemo(() => {
    return state.cities.filter(c => c.isActive !== false);
  }, [state.cities]);

  const getNextCustomerCode = () => {
    const customerAccounts = state.businessAccounts.filter(acc => acc.controlId === '110001');
    const maxSuffix = customerAccounts.reduce((max, acc) => {
      const num = parseInt(acc.id.substring(6), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return `110001${String(maxSuffix + 1).padStart(4, '0')}`;
  };

  const handleOpenAdd = () => {
    setEditingCustomerId(null);
    setNewCustomerName('');
    setNewCustomerRegionId(state.regions.find(r => r.isActive !== false)?.id || '');
    setNewCustomerCityId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomerId(c.id);
    setNewCustomerName(c.name);
    setNewCustomerRegionId(c.regionId);
    setNewCustomerCityId(c.cityId);
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

  const executeAddCustomer = (data: { name: string; regionId: string; cityId: string }) => {
    const regionName = state.regions.find(r => r.id === data.regionId)?.name || 'LOCAL';
    const newId = getNextCustomerCode();

    dispatch({
      type: 'ADD_BUSINESS_ACCOUNT',
      account: {
        id: newId,
        name: data.name,
        controlId: '110001',
        linkCode: 'A',
        region: regionName,
        status: 'Active'
      }
    });

    dispatch({
      type: 'ADD_CUSTOMER',
      customer: {
        id: newId,
        name: data.name,
        acId: '110001',
        regionId: data.regionId,
        cityId: data.cityId
      }
    });

    setSuccessMsg('New customer added successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleSaveCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = newCustomerName.trim();
    if (!typed) return setErrorMsg('Customer name is required.');
    if (!newCustomerRegionId) return setErrorMsg('Region is required.');
    if (!newCustomerCityId) return setErrorMsg('City is required.');

    if (editingCustomerId) {
      dispatch({
        type: 'UPDATE_CUSTOMER',
        customer: {
          id: editingCustomerId,
          name: typed,
          acId: '110001',
          regionId: newCustomerRegionId,
          cityId: newCustomerCityId
        }
      });
      setSuccessMsg('Customer details updated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      handleCloseModal();
    } else {
      const matches = state.customers.filter(c => c.name.toLowerCase() === typed.toLowerCase());
      if (matches.length === 0) {
        executeAddCustomer({ name: typed, regionId: newCustomerRegionId, cityId: newCustomerCityId });
      } else {
        const hasInactive = matches.some(c => c.isActive === false);
        const modalMatches = hasInactive ? matches.filter(c => c.isActive === false) : matches;
        setDupMatches(modalMatches);
        setDupStatus(hasInactive ? 'inactive' : 'active');
        setPendingCustomer({ name: typed, regionId: newCustomerRegionId, cityId: newCustomerCityId });
        setIsDupModalOpen(true);
      }
    }
  };

  const handleActivateDuplicate = (id: string) => {
    const match = state.customers.find(c => c.id === id);
    if (match) {
      if (!state.businessAccounts.some(b => b.id === match.id)) {
        const regionName = state.regions.find(r => r.id === match.regionId)?.name || 'LOCAL';
        dispatch({
          type: 'ADD_BUSINESS_ACCOUNT',
          account: {
            id: match.id,
            name: match.name,
            controlId: '110001',
            linkCode: 'A',
            region: regionName,
            status: 'Active'
          }
        });
      }
      dispatch({
        type: 'UPDATE_CUSTOMER',
        customer: { ...match, isActive: true }
      });
      setSuccessMsg('Customer reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    setIsDupModalOpen(false);
    setPendingCustomer(null);
    handleCloseModal();
  };

  const handleCreateNewAnyway = () => {
    if (pendingCustomer) {
      executeAddCustomer(pendingCustomer);
    }
    setIsDupModalOpen(false);
    setPendingCustomer(null);
  };

  const handleDeleteCustomer = (id: string) => {
    const hasBills = state.saleBills.some(b => b.customerId === id);
    const hasReturns = state.saleReturns.some(r => r.customerId === id);
    const hasReceipts = state.receipts.some(rc => rc.customerId === id);

    if (hasBills || hasReturns || hasReceipts) {
      setErrorMsg('Cannot delete: Customer has active sale bills, returns, or receipts.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this customer?')) {
      dispatch({ type: 'DELETE_CUSTOMER', id });
      setSuccessMsg('Customer deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      handleCloseModal();
    }
  };

  // Compile Product Ledger Rows
  const customerProductLedgerRows = useMemo<ProductLedgerRow[]>(() => {
    if (!selectedCustomer) return [];

    const rows: ProductLedgerRow[] = [];
    const custId = selectedCustomer.id;

    state.saleBills.filter(b => b.customerId === custId).forEach(b => {
      b.items.forEach(item => {
        const prod = state.products.find(p => p.id === item.productId);
        const articleName = prod?.name || item.productId;
        rows.push({
          date: b.date,
          refId: b.billNo || b.id,
          article: articleName,
          debit: item.value,
          credit: 0,
          returnQty: 0
        });
      });
    });

    state.saleReturns.filter(r => r.customerId === custId).forEach(r => {
      r.items.forEach(item => {
        const prod = state.products.find(p => p.id === item.productId);
        const articleName = prod?.name || item.productId;
        const totalPairs = (item.cartons || 0) * (prod?.packing || 12) + (item.pairs || 0);
        rows.push({
          date: r.date,
          refId: r.billNo || r.id,
          article: articleName,
          debit: 0,
          credit: item.value,
          returnQty: totalPairs
        });
      });
    });

    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }, [selectedCustomer, state]);

  const filteredLedgerRows = useMemo(() => {
    let list = customerProductLedgerRows;

    if (fromDate) {
      list = list.filter(r => r.date >= fromDate);
    }
    if (toDate) {
      list = list.filter(r => r.date <= toDate);
    }
    if (articleFilter.trim()) {
      const q = articleFilter.toLowerCase();
      list = list.filter(r => r.article.toLowerCase().includes(q));
    }

    return list;
  }, [customerProductLedgerRows, fromDate, toDate, articleFilter]);

  const { totalDebit, totalCredit, totalReturnQty } = useMemo(() => {
    let deb = 0;
    let cred = 0;
    let qty = 0;
    filteredLedgerRows.forEach(r => {
      deb += r.debit;
      cred += r.credit;
      qty += r.returnQty;
    });
    return { totalDebit: deb, totalCredit: cred, totalReturnQty: qty };
  }, [filteredLedgerRows]);

  const handleExportCSV = () => {
    const header = ['Date', 'Ref No', 'Article', 'Debit', 'Credit', 'Sale Return (Pairs)'];
    const lines = filteredLedgerRows.map(r => [r.date, r.refId, r.article, r.debit, r.credit, r.returnQty]);
    const csv = [header, ...lines].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedCustomer?.name || 'customer'}_product_ledger.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

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

            {/* Customer Cards Grid (§1 Standard) */}
            {filteredCustomers.length === 0 ? (
              <div className="card-white p-12 text-center text-slate-400">
                <UserCheck size={36} className="mx-auto mb-3 text-slate-300" />
                <p className="font-semibold text-slate-600">No registered customers found matching your search.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredCustomers.map(c => {
                  const regionName = state.regions.find(r => r.id === c.regionId)?.name || 'No Region';
                  const cityName = state.cities.find(ct => ct.id === c.cityId)?.name || 'No City';

                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCustomerId(c.id)}
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
                            {cityName}
                          </span>
                        </div>

                        {/* Subtitle: Code in mono */}
                        <div className="font-mono text-xs text-slate-400 mb-3">
                          Customer ID: <span className="font-semibold text-slate-600">#{c.id}</span>
                        </div>

                        <div className="text-xs text-slate-500 font-medium border-t border-slate-100 pt-2.5">
                          Region: <span className="font-semibold text-slate-700">{regionName}</span>
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
                            onClick={() => handleDeleteCustomer(c.id)}
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
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Detailed Product Ledger View */
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6" data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedCustomerId('')}
                  className="bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
                >
                  <ArrowLeft size={16} /> Back to Directory
                </button>
                <div>
                  <h2 className="font-lora font-bold text-xl text-slate-900">
                    Product Ledger: {selectedCustomer?.name}
                  </h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">Code: {selectedCustomer?.id}</p>
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

            {/* Date & Article Filters */}
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
                <div className="flex items-center gap-2 min-w-[200px]">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Article:</label>
                  <input
                    type="text"
                    placeholder="Filter article..."
                    value={articleFilter}
                    onChange={e => setArticleFilter(e.target.value)}
                    className="soleria-input py-1.5 px-2.5 text-xs font-semibold w-full"
                  />
                </div>
              </div>
            </div>

            {/* Printable Table */}
            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b text-slate-700 font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3">Date</th>
                      <th className="p-3">Ref No</th>
                      <th className="p-3">Article</th>
                      <th className="p-3 text-right">Debit (PKR)</th>
                      <th className="p-3 text-right">Credit (PKR)</th>
                      <th className="p-3 text-right">Sale Return (Pairs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center p-6 text-slate-400 italic">
                          No product ledger transactions recorded for this customer in selected period.
                        </td>
                      </tr>
                    ) : (
                      filteredLedgerRows.map((row, idx) => (
                        <tr key={idx} className="border-b hover:bg-slate-50/60 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 font-medium text-slate-600">{row.date}</td>
                          <td className="p-3 text-slate-500 font-mono">{row.refId}</td>
                          <td className="p-3 font-semibold text-slate-800">{row.article}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                          <td className="p-3 text-right font-bold text-amber-800">{row.returnQty > 0 ? row.returnQty.toLocaleString() : '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-900 text-white font-bold text-xs">
                      <td colSpan={3} className="p-3 text-right uppercase tracking-wider text-[#B08D57]">Totals</td>
                      <td className="p-3 text-right">{formatCurrency(totalDebit)}</td>
                      <td className="p-3 text-right">{formatCurrency(totalCredit)}</td>
                      <td className="p-3 text-right text-[#B08D57]">{totalReturnQty.toLocaleString()} Pairs</td>
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
                      options={activeRegions.map(r => ({ value: r.id, label: r.name }))}
                      value={newCustomerRegionId}
                      onChange={setNewCustomerRegionId}
                      placeholder="Select Region..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      City Location <span className="text-rose-500">*</span>
                    </label>
                    <SearchableSelect
                      options={activeCities.map(c => ({ value: c.id, label: c.name }))}
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
            id: c.id,
            name: c.name,
            cityName: activeCities.find(ct => ct.id === c.cityId)?.name
          }))}
          allowCreateOnActive={true}
          onActivate={handleActivateDuplicate}
          onCreateNew={handleCreateNewAnyway}
          onCancel={() => {
            setIsDupModalOpen(false);
            setPendingCustomer(null);
          }}
        />

      </div>
    </AppLayout>
  );
}
