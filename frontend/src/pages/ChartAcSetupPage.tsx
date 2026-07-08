import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';

export default function ChartAcSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [controlId, setControlId] = useState('');
  const [linkCode, setLinkCode] = useState('A');
  const [status, setStatus] = useState<'Active' | 'Closed'>('Active');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setControlId('');
    setLinkCode('A');
    setStatus('Active');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectChart = (c: any) => {
    setSelectedId(c.id);
    setId(c.id);
    setName(c.name);
    setControlId(c.controlId);
    setLinkCode(c.linkCode || 'A');
    setStatus(c.status || 'Active');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Chart Account code is required.');
    if (!name.trim()) return setErrorMsg('Chart Account name is required.');
    if (!controlId) return setErrorMsg('Please select a parent Control A/C.');

    // Duplicate check if adding new
    if (!selectedId && state.chartAccounts.some(c => c.id.toLowerCase() === id.trim().toLowerCase())) {
      return setErrorMsg('A Chart Account with this code already exists.');
    }

    const chartData = {
      id: id.trim(),
      name: name.trim(),
      controlId,
      linkCode: linkCode.trim(),
      status
    };

    if (selectedId) {
      dispatch({ type: 'UPDATE_CHART_ACCOUNT', account: chartData });
      setSuccessMsg('Chart Account updated successfully.');
    } else {
      dispatch({ type: 'ADD_CHART_ACCOUNT', account: chartData });
      setSuccessMsg('Chart Account registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setActiveTab('list');
    setSelectedId(null);
  };

  const handleDeleteChart = (chartId: string) => {
    // Safety check: is it linked to business accounts?
    const inUse = state.businessAccounts.some(b => b.controlId === chartId);
    if (inUse) {
      setErrorMsg('Cannot delete: This chart account is linked to active business accounts.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Chart Account?')) {
      dispatch({ type: 'DELETE_CHART_ACCOUNT', id: chartId });
      setSuccessMsg('Chart Account deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  const filteredCharts = useMemo(() => {
    if (!searchQuery.trim()) return state.chartAccounts;
    const q = searchQuery.toLowerCase();
    return state.chartAccounts.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.id.toLowerCase().includes(q)
    );
  }, [state.chartAccounts, searchQuery]);

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
              Chart Accounts Directory
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Chart Account
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Chart Account
            </button>
          )}
        </div>

        {/* View 1: Chart Accounts Cards Directory */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Chart Accounts Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage Chart accounts defining reporting codes and sub-ledgers.</p>
              </div>
              
              <div className="relative min-w-[270px]">
                <input
                  type="text"
                  placeholder="Search by code, chart name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
              </div>
            </div>

            {filteredCharts.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl bg-white">
                No registered chart accounts found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCharts.map(c => {
                  const initialLetter = c.name.charAt(0).toUpperCase();
                  const controlName = state.controlAccounts.find(ctrl => ctrl.id === c.controlId)?.name || 'UNKNOWN CONTROL';

                  return (
                    <div
                      key={c.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectChart(c)}
                    >
                      <div>
                        {/* Card Top: Code & Parent control */}
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider flex-shrink-0">
                            CODE: {c.id}
                          </span>
                          <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider truncate max-w-[135px]" title={controlName}>
                            {controlName}
                          </span>
                        </div>

                        {/* Card Middle: Avatar circle + Name */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-amber-800 transition-colors leading-tight text-[15px] truncate">
                              {c.name}
                            </h4>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5 uppercase tracking-wider truncate">
                              Chart A/C (Status: {c.status})
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectChart(c)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Chart Account"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteChart(c.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Chart Account"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* View 2: Form View */
          <div className="card-white p-6 md:p-8 bg-white border">
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
                  {selectedId ? 'Edit Chart Account' : 'Register New Chart Account'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Configure chart account details, parent control structures, and status parameters.</p>
              </div>
            </div>

            <form onSubmit={handleSave} className="max-w-xl flex flex-col gap-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={15} className="text-[#B08D57]" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chart Account Configuration</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Chart Code</label>
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
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Chart Name</label>
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
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Control A/C</label>
                  <select
                    value={controlId}
                    onChange={e => setControlId(e.target.value)}
                    className="soleria-input cursor-pointer font-medium"
                  >
                    <option value="">Select Control A/C...</option>
                    {state.controlAccounts.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
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
        )}

      </div>
    </AppLayout>
  );
}
