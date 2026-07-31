import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';

export default function ChartAcSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [linkCode, setLinkCode] = useState('A');
  const [status, setStatus] = useState<'Active' | 'Closed'>('Active');

  // Search and Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  // Drill-down: clicking a card expands it to show every Business Account
  // registered under that chart account, instead of jumping straight to edit.
  const [expandedChartId, setExpandedChartId] = useState<string | null>(null);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setGroupId('');
    setLinkCode('A');
    setStatus('Active');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectChart = (c: any) => {
    setSelectedId(c.id);
    setId(c.id);
    setName(c.name);
    setGroupId(c.groupId);
    setLinkCode(c.linkCode || 'A');
    setStatus(c.status || 'Active');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Account code is required.');
    if (!name.trim()) return setErrorMsg('Account name is required.');
    if (!groupId) return setErrorMsg('Please select a parent Group A/C.');

    // Duplicate check if adding new
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
    setActiveTab('list');
    setSelectedId(null);
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

  const filteredAndSortedCharts = useMemo(() => {
    let list = state.chartAccounts;
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
  }, [state.chartAccounts, searchQuery, sortBy, selectedGroupFilter]);

  return (
    <AppLayout pageTitle="Chart of Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Tab Selection Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => {
                setActiveTab('list');
                setSelectedId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Accounts Directory
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Account
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Account
            </button>
          )}
        </div>

        {/* View 1: Chart Accounts Cards Directory */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-col gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Accounts Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage accounts defining reporting codes and sub-ledgers.</p>
              </div>

              {/* Group Filter select - full width, big and readable */}
              <div className="w-full">
                <SearchableSelect
                  options={groupFilterOptions}
                  value={selectedGroupFilter}
                  onChange={setSelectedGroupFilter}
                  placeholder="All Group Accounts"
                  searchPlaceholder="Search group accounts..."
                />
              </div>

              {/* Bottom row: Sort and Search */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                {/* Sorting options */}
                <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold border border-slate-200 self-start">
                  <button
                    type="button"
                    onClick={() => setSortBy('code')}
                    className={`px-3.5 py-2 rounded-md transition-all ${sortBy === 'code' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold scale-[1.02]' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Sort by Code
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy('name')}
                    className={`px-3.5 py-2 rounded-md transition-all ${sortBy === 'name' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold scale-[1.02]' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Sort by Name
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative flex-1 min-w-[270px] sm:max-w-sm">
                  <input
                    type="text"
                    placeholder="Search by code, account name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input w-full py-2 px-3.5 text-sm pr-10 font-semibold bg-white shadow-sm hover:border-[#B08D57] transition-all"
                  />
                  <Search className="absolute right-3.5 top-2.5 text-slate-400" size={16} />
                </div>
              </div>
            </div>

            {filteredAndSortedCharts.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl bg-white">
                No registered accounts found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAndSortedCharts.map(c => {
                  const initialLetter = c.name.charAt(0).toUpperCase();
                  const groupName = state.groupAccounts.find(g => g.id === c.groupId)?.name || 'UNKNOWN GROUP';
                  const isExpanded = expandedChartId === c.id;
                  const childAccounts = state.businessAccounts.filter(b => b.controlId === c.id);

                  return (
                    <div
                      key={c.id}
                      className={`bg-white border rounded-xl p-5 hover:border-[#B08D57] hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer ${isExpanded ? 'sm:col-span-2 lg:col-span-3' : ''}`}
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => setExpandedChartId(isExpanded ? null : c.id)}
                    >
                      <div>
                        {/* Card Top: Code & Parent group */}
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider flex-shrink-0">
                            CODE: {c.id}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider truncate max-w-[135px]" title={groupName}>
                              {groupName}
                            </span>
                            {isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                          </div>
                        </div>

                        {/* Card Middle: Avatar circle + Name */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {c.name}
                            </h4>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5 uppercase tracking-wider truncate">
                              {childAccounts.length} business account{childAccounts.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>

                        {/* Drill-down: every Business Account registered under this chart account */}
                        {isExpanded && (
                          <div className="mb-4 border-t pt-3" style={{ borderColor: 'var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
                            {childAccounts.length === 0 ? (
                              <p className="text-xs text-slate-400 text-center py-4">No Business Accounts registered under this account yet.</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="text-slate-400 uppercase tracking-wider">
                                      <th className="p-2">Code</th>
                                      <th className="p-2">Account Name</th>
                                      <th className="p-2">City / Region</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {childAccounts.map(b => (
                                      <tr key={b.id} className="border-t hover:bg-slate-50" style={{ borderColor: 'var(--border-table)' }}>
                                        <td className="p-2 font-mono text-slate-600">{b.id}</td>
                                        <td className="p-2 font-semibold text-slate-700">{b.name}</td>
                                        <td className="p-2 text-slate-500">{b.region || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider border ${
                          c.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {c.status === 'Active' ? 'Active' : 'Inactive'}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleSelectChart(c)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                            title="Edit Account"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteChart(c.id)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                            title="Delete Account"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* View 2: Form View */
          <div className="max-w-2xl mx-auto">
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" style={{ overflow: 'visible' }}>
              <div className="flex items-center gap-3 border-b pb-4 mb-6">
                <button 
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedId(null);
                  }}
                  className="p-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft size={16} className="text-slate-600" />
                </button>
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">
                    {selectedId ? 'Edit Account' : 'Register New Account'}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Configure account details, parent group structures, and status parameters.</p>
                </div>
              </div>

              <form onSubmit={handleSave} className="flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-2">
                  <Settings size={15} className="text-[#B08D57]" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Account Configuration</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Account Code</label>
                    <input
                      type="text"
                      value={id}
                      onChange={e => setId(e.target.value)}
                      placeholder="e.g. 110001"
                      disabled={!!selectedId}
                      className="soleria-input font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Account Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. CUSTOMERS BALANCES"
                      className="soleria-input font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Group A/C</label>
                    <SearchableSelect
                      options={state.groupAccounts.map(g => ({
                        value: g.id,
                        label: `${g.name} (${g.id})`
                      }))}
                      value={groupId}
                      onChange={setGroupId}
                      placeholder="Select Group..."
                      searchPlaceholder="Search group accounts..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Link Code</label>
                    <input
                      type="text"
                      value={linkCode}
                      onChange={e => setLinkCode(e.target.value)}
                      className="soleria-input font-mono font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as any)}
                    className="soleria-input cursor-pointer font-medium"
                  >
                    <option value="Active">Active</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 mt-6 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('list');
                      setSelectedId(null);
                    }}
                    className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold flex items-center gap-1.5 px-6 py-2.5 text-xs font-bold text-slate-900 uppercase tracking-wider"
                  >
                    <Save size={14} /> Save Details
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
