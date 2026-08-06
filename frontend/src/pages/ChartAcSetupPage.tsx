import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, X, BookOpen, ArrowRight } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import { filterChartAccountsForRole } from '@/lib/access';

export default function ChartAcSetupPage() {
  const { state, dispatch } = useApp();

  // Search and Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [linkCode, setLinkCode] = useState('A');
  const [status, setStatus] = useState<'Active' | 'Closed'>('Active');

  // Drill-down Modal State
  const [viewingChartId, setViewingChartId] = useState<string | null>(null);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setGroupId('');
    setLinkCode('A');
    setStatus('Active');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (c: any) => {
    setSelectedId(c.id);
    setId(c.id);
    setName(c.name);
    setGroupId(c.groupId);
    setLinkCode(c.linkCode || 'A');
    setStatus(c.status || 'Active');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setId('');
    setName('');
    setGroupId('');
    setLinkCode('A');
    setStatus('Active');
    setErrorMsg('');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Account code is required.');
    if (!name.trim()) return setErrorMsg('Account name is required.');
    if (!groupId) return setErrorMsg('Please select a parent Group A/C.');

    if (!selectedId && state.chartAccounts.some(c => c.id.toLowerCase() === id.trim().toLowerCase())) {
      return setErrorMsg('An Account with this code already exists.');
    }

    const chartData = {
      id: id.trim(),
      name: name.trim(),
      groupId,
      linkCode: linkCode.trim(),
      status
    };

    if (selectedId) {
      dispatch({ type: 'UPDATE_CHART_ACCOUNT', account: chartData });
      setSuccessMsg('Account updated successfully.');
    } else {
      dispatch({ type: 'ADD_CHART_ACCOUNT', account: chartData });
      setSuccessMsg('Account registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleDeleteChart = (chartId: string) => {
    const inUse = state.businessAccounts.some(b => b.controlId === chartId);
    if (inUse) {
      setErrorMsg('Cannot delete: This account is linked to active business accounts.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Account?')) {
      dispatch({ type: 'DELETE_CHART_ACCOUNT', id: chartId });
      setSuccessMsg('Account deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      handleCloseModal();
    }
  };

  const groupFilterOptions = useMemo(() => {
    return [
      { value: '', label: 'All Group Accounts' },
      ...state.groupAccounts.map(g => ({
        value: g.id,
        label: `${g.name} (${g.id})`
      }))
    ];
  }, [state.groupAccounts]);

  const groupSelectOptions = useMemo(() => {
    return state.groupAccounts.map(g => ({
      value: g.id,
      label: `${g.name} (${g.id})`
    }));
  }, [state.groupAccounts]);

  const filteredAndSortedCharts = useMemo(() => {
    let list = filterChartAccountsForRole(state.chartAccounts, state.currentUserRole);
    if (selectedGroupFilter) {
      list = list.filter(c => c.groupId === selectedGroupFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => 
        c.name.toLowerCase().includes(q) || 
        c.id.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'code') {
        return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        return a.name.localeCompare(b.name);
      }
    });
  }, [state.chartAccounts, state.currentUserRole, searchQuery, sortBy, selectedGroupFilter]);

  const viewingChart = useMemo(() => {
    return state.chartAccounts.find(c => c.id === viewingChartId);
  }, [viewingChartId, state.chartAccounts]);

  const viewingChildBizAccounts = useMemo(() => {
    if (!viewingChartId) return [];
    return state.businessAccounts.filter(b => b.controlId === viewingChartId);
  }, [viewingChartId, state.businessAccounts]);

  return (
    <AppLayout pageTitle="Chart of Accounts Setup">
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
                <BookOpen size={20} className="text-[#B08D57]" /> Chart of Accounts Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Search and manage accounts defining reporting codes and sub-ledgers.</p>
            </div>
            
            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Chart Account
            </button>
          </div>

          {/* Filters Toolbar */}
          <div className="flex flex-col gap-4">
            <div className="w-full">
              <SearchableSelect
                options={groupFilterOptions}
                value={selectedGroupFilter}
                onChange={setSelectedGroupFilter}
                placeholder="All Group Accounts"
                searchPlaceholder="Search group accounts..."
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
                  placeholder="Search by code, account name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-2 px-3.5 text-xs pr-10 font-semibold"
                />
                <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
              </div>
            </div>
          </div>
        </div>

        {/* Chart Accounts Cards Grid (§1 Standard) */}
        {filteredAndSortedCharts.length === 0 ? (
          <div className="card-white p-12 text-center text-slate-400">
            <BookOpen size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600">No registered chart accounts found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedCharts.map(c => {
              const groupName = state.groupAccounts.find(g => g.id === c.groupId)?.name || 'UNKNOWN GROUP';
              const childAccounts = state.businessAccounts.filter(b => b.controlId === c.id);

              return (
                <div
                  key={c.id}
                  onClick={() => setViewingChartId(c.id)}
                  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                >
                  <div>
                    {/* Header: Title + Status Badge */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                        {c.name}
                      </h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border flex-shrink-0 ${
                        c.status === 'Active' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                        {c.status === 'Active' ? 'Active' : 'Closed'}
                      </span>
                    </div>

                    {/* Subtitle: Code in mono */}
                    <div className="font-mono text-xs text-slate-400 mb-3">
                      Chart Code: <span className="font-semibold text-slate-600">#{c.id}</span>
                    </div>

                    <div className="text-xs text-slate-500 font-medium border-t border-slate-100 pt-2.5 flex flex-col gap-1">
                      <div className="font-semibold text-[#B08D57] truncate" title={groupName}>
                        Group: {groupName}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Sub-Ledgers Linked: <span className="font-semibold text-slate-700">{childAccounts.length}</span>
                      </div>
                    </div>
                  </div>

                  {/* Footer Bar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditModal(c)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                        title="Edit Chart Account"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteChart(c.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Chart Account"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                      View Sub-Ledgers <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Drill-down Modal showing child business accounts */}
        {viewingChartId && viewingChart && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => setViewingChartId(null)}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <div>
                  <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                    <BookOpen size={18} className="text-[#B08D57]" /> {viewingChart.name}
                  </h3>
                  <p className="text-xs text-slate-500">Chart Code #{viewingChart.id}</p>
                </div>
                <button
                  onClick={() => setViewingChartId(null)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 max-h-96 overflow-y-auto">
                <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
                  Linked Sub-Ledgers / Business Accounts ({viewingChildBizAccounts.length})
                </div>

                {viewingChildBizAccounts.length === 0 ? (
                  <div className="text-center p-6 text-slate-400 italic text-xs">
                    No business accounts registered under this chart head.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {viewingChildBizAccounts.map(b => (
                      <div key={b.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-xs text-slate-900">{b.name}</div>
                          <div className="font-mono text-[11px] text-slate-400">Code: #{b.id}</div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${b.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                          {b.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-100 flex justify-end">
                <button onClick={() => setViewingChartId(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">
                  Close
                </button>
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
                  {selectedId ? 'Edit Chart Account' : 'Register New Chart Account'}
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
                      Chart Account Code <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={id}
                      onChange={e => setId(e.target.value)}
                      placeholder="e.g. 110001"
                      disabled={!!selectedId}
                      className="soleria-input w-full font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                      autoFocus={!selectedId}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Account Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. CUSTOMERS ACCOUNTS"
                      className="soleria-input w-full font-semibold"
                      autoFocus={!!selectedId}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Parent Group Account <span className="text-rose-500">*</span>
                  </label>
                  <SearchableSelect
                    options={groupSelectOptions}
                    value={groupId}
                    onChange={setGroupId}
                    placeholder="Select Group Account..."
                    searchPlaceholder="Search group accounts..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    <Save size={14} /> Save Chart Account
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
