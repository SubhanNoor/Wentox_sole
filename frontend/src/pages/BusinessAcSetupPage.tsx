import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, X, Landmark, ArrowRight } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import { filterChartAccountsForRole, filterBusinessAccountsForRole } from '@/lib/access';

export default function BusinessAcSetupPage() {
  const { state, dispatch } = useApp();

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [controlId, setControlId] = useState(''); // parent chart account ID
  const [linkCode, setLinkCode] = useState('A');
  const [region, setRegion] = useState('LOCAL');
  const [status, setStatus] = useState<'Active' | 'Closed'>('Active');

  // Search and Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChartFilter, setSelectedChartFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setControlId('');
    setLinkCode('A');
    setRegion('LOCAL');
    setStatus('Active');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (biz: any) => {
    setSelectedId(biz.id);
    setId(biz.id);
    setName(biz.name);
    setControlId(biz.controlId);
    setLinkCode(biz.linkCode || 'A');
    setRegion(biz.region || 'LOCAL');
    setStatus(biz.status || 'Active');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setId('');
    setName('');
    setControlId('');
    setLinkCode('A');
    setRegion('LOCAL');
    setStatus('Active');
    setErrorMsg('');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Business Account code is required.');
    if (!name.trim()) return setErrorMsg('Business Account title / name is required.');
    if (!controlId) return setErrorMsg('Please select a parent Chart A/C.');

    if (!selectedId && state.businessAccounts.some(b => b.id.toLowerCase() === id.trim().toLowerCase())) {
      return setErrorMsg('A Business Account with this code already exists.');
    }

    const accountData = {
      id: id.trim(),
      name: name.trim(),
      controlId,
      linkCode: linkCode.trim(),
      region: region.trim(),
      status
    };

    if (selectedId) {
      dispatch({ type: 'UPDATE_BUSINESS_ACCOUNT', account: accountData });
      setSuccessMsg('Business Account updated successfully.');
    } else {
      dispatch({ type: 'ADD_BUSINESS_ACCOUNT', account: accountData });

      if (controlId === '110001') {
        const cityId = state.cities[0]?.id || 'ct1';
        const regionId = state.regions.find(r => r.name.toLowerCase() === region.trim().toLowerCase())?.id
          || state.regions[0]?.id || '';
        dispatch({
          type: 'ADD_CUSTOMER',
          customer: {
            id: id.trim(),
            name: name.trim(),
            acId: controlId,
            regionId,
            cityId
          }
        });
      }
      setSuccessMsg('Business Account registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleDeleteBusinessAc = (bizId: string) => {
    const hasBills = state.saleBills.some(bill => bill.customerId === bizId);
    if (hasBills) {
      setErrorMsg('Cannot delete: This business account is linked to active sale bills.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    const linkedVendor = state.vendors.find(v => v.baId === bizId);
    if (linkedVendor) {
      setErrorMsg(`Cannot delete: This is the ledger account for vendor "${linkedVendor.name}". Delete the vendor instead.`);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    const linkedBank = state.bankAccounts.find(b => b.baId === bizId);
    if (linkedBank) {
      setErrorMsg(`Cannot delete: This is the ledger account for bank "${linkedBank.name}". Delete it from Bank Accounts instead.`);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    const used =
      state.expenses.filter(e => e.businessAccountId === bizId).length +
      state.transfers.filter(t => t.fromBaId === bizId || t.toBaId === bizId).length +
      state.deposits.filter(d => d.toBaId === bizId).length;
    if (used > 0) {
      setErrorMsg(`Cannot delete: ${used} transaction(s) are recorded against this account.`);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Business Account?')) {
      dispatch({ type: 'DELETE_BUSINESS_ACCOUNT', id: bizId });
      setSuccessMsg('Business Account deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      handleCloseModal();
    }
  };

  const visibleChartAccounts = useMemo(() => {
    return filterChartAccountsForRole(state.chartAccounts, state.currentUserRole);
  }, [state.chartAccounts, state.currentUserRole]);

  const chartOptions = useMemo(() => {
    return visibleChartAccounts.map(c => ({
      value: c.id,
      label: `${c.name} (${c.id})`
    }));
  }, [visibleChartAccounts]);

  const chartFilterOptions = useMemo(() => {
    return [
      { value: '', label: 'All Accounts' },
      ...visibleChartAccounts.map(c => ({
        value: c.id,
        label: `${c.name} (${c.id})`
      }))
    ];
  }, [visibleChartAccounts]);

  const visibleAccounts = useMemo(() => {
    return filterBusinessAccountsForRole(state.businessAccounts, state.chartAccounts, state.currentUserRole);
  }, [state.businessAccounts, state.chartAccounts, state.currentUserRole]);

  const filteredAndSortedAccounts = useMemo(() => {
    let list = visibleAccounts;
    if (selectedChartFilter) {
      list = list.filter(b => b.controlId === selectedChartFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b => 
        b.name.toLowerCase().includes(q) || 
        b.id.toLowerCase().includes(q) ||
        (b.region && b.region.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'code') {
        return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        return a.name.localeCompare(b.name);
      }
    });
  }, [visibleAccounts, searchQuery, sortBy, selectedChartFilter]);

  return (
    <AppLayout pageTitle="Business Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 1400 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Directory Header Card */}
        <div className="card-white p-6 md:p-8 bg-white border mb-6">
          <div className="border-b pb-4 mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                <Landmark size={20} className="text-[#B08D57]" /> Business Ledgers Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Search and manage custom business ledgers, customer accounts, and expense files.</p>
            </div>
            
            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Business Account
            </button>
          </div>

          {/* Filters & Search Toolbar */}
          <div className="flex flex-col gap-4">
            <div className="w-full">
              <SearchableSelect
                options={chartFilterOptions}
                value={selectedChartFilter}
                onChange={setSelectedChartFilter}
                placeholder="All Accounts"
                searchPlaceholder="Search accounts..."
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex bg-slate-100 p-0.5 rounded-xl text-xs font-semibold border border-slate-200 self-start">
                <button
                  type="button"
                  onClick={() => setSortBy('code')}
                  className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${sortBy === 'code' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Sort by Code
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy('name')}
                  className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${sortBy === 'name' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Sort by Name
                </button>
              </div>

              <div className="relative flex-1 min-w-[270px] sm:max-w-sm">
                <input
                  type="text"
                  placeholder="Search by code, account title..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-2 px-3.5 text-xs pr-10 font-semibold"
                />
                <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
              </div>
            </div>
          </div>
        </div>

        {/* Business Accounts Cards Grid (§1 Standard) */}
        {filteredAndSortedAccounts.length === 0 ? (
          <div className="card-white p-12 text-center text-slate-400">
            <Landmark size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600">No registered business accounts found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedAccounts.map(biz => {
              const chartName = state.chartAccounts.find(c => c.id === biz.controlId)?.name || 'UNKNOWN A/C';

              return (
                <div
                  key={biz.id}
                  onClick={() => handleOpenEditModal(biz)}
                  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                >
                  <div>
                    {/* Header: Title + Status Badge */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                        {biz.name}
                      </h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border flex-shrink-0 ${
                        biz.status === 'Active' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                        {biz.status === 'Active' ? 'Active' : 'Closed'}
                      </span>
                    </div>

                    {/* Subtitle: Code in mono */}
                    <div className="font-mono text-xs text-slate-400 mb-3">
                      A/C Code: <span className="font-semibold text-slate-600">#{biz.id}</span>
                    </div>

                    <div className="text-xs text-slate-500 font-medium border-t border-slate-100 pt-2.5 flex flex-col gap-1">
                      <div className="font-semibold text-[#B08D57] truncate" title={chartName}>
                        Control A/C: {chartName}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Region: <span className="font-semibold text-slate-600">{biz.region || 'LOCAL'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Footer Bar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditModal(biz)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                        title="Edit Business Account"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteBusinessAc(biz.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Business Account"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                      Edit Account <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedId ? 'Edit Business Account' : 'Register New Business Account'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Business Account Code <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={id}
                      onChange={e => setId(e.target.value)}
                      placeholder="e.g. 11000105"
                      disabled={!!selectedId}
                      className="soleria-input w-full font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                      autoFocus={!selectedId}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Account Title / Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Shalimar Footwear Agency"
                      className="soleria-input w-full font-semibold"
                      autoFocus={!!selectedId}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Parent Chart of Account <span className="text-rose-500">*</span>
                  </label>
                  <SearchableSelect
                    options={chartOptions}
                    value={controlId}
                    onChange={setControlId}
                    placeholder="Select Chart A/C..."
                    searchPlaceholder="Search chart accounts..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Region / Location
                    </label>
                    <input
                      type="text"
                      value={region}
                      onChange={e => setRegion(e.target.value)}
                      placeholder="e.g. LOCAL"
                      className="soleria-input w-full font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Link Code
                    </label>
                    <input
                      type="text"
                      value={linkCode}
                      onChange={e => setLinkCode(e.target.value)}
                      className="soleria-input w-full font-mono font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Status
                    </label>
                    <select
                      value={status}
                      onChange={e => setStatus(e.target.value as any)}
                      className="soleria-input w-full cursor-pointer font-medium"
                    >
                      <option value="Active">Active</option>
                      <option value="Closed">Closed</option>
                    </select>
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
                    <Save size={14} /> Save Account
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
