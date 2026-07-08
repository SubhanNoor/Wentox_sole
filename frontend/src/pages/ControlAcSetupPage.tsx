import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';

export default function ControlAcSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [sorting, setSorting] = useState(1);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setGroupId('');
    setSorting(1);
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectControl = (c: any) => {
    setSelectedId(c.id);
    setId(c.id);
    setName(c.name);
    setGroupId(c.groupId);
    setSorting(c.sorting || 1);
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Control Account code is required.');
    if (!name.trim()) return setErrorMsg('Control Account name is required.');
    if (!groupId) return setErrorMsg('Please select a parent Group.');

    // Duplicate check if adding new
    if (!selectedId && state.controlAccounts.some(c => c.id.toLowerCase() === id.trim().toLowerCase())) {
      return setErrorMsg('A Control Account with this code already exists.');
    }

    const controlData = {
      id: id.trim(),
      name: name.trim(),
      groupId,
      sorting
    };

    if (selectedId) {
      dispatch({ type: 'UPDATE_CONTROL_ACCOUNT', account: controlData });
      setSuccessMsg('Control Account updated successfully.');
    } else {
      dispatch({ type: 'ADD_CONTROL_ACCOUNT', account: controlData });
      setSuccessMsg('Control Account registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setActiveTab('list');
    setSelectedId(null);
  };

  const handleDeleteControl = (ctrlId: string) => {
    // Safety check: is it linked to chart accounts?
    const inUse = state.chartAccounts.some(ch => ch.controlId === ctrlId);
    if (inUse) {
      setErrorMsg('Cannot delete: This control account is linked to active chart accounts.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Control Account?')) {
      dispatch({ type: 'DELETE_CONTROL_ACCOUNT', id: ctrlId });
      setSuccessMsg('Control Account deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  const filteredControls = useMemo(() => {
    if (!searchQuery.trim()) return state.controlAccounts;
    const q = searchQuery.toLowerCase();
    return state.controlAccounts.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.id.toLowerCase().includes(q)
    );
  }, [state.controlAccounts, searchQuery]);

  return (
    <AppLayout pageTitle="Control Accounts Setup">
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
              Control Accounts Directory
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Control Account
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Control Account
            </button>
          )}
        </div>

        {/* View 1: Control Accounts Cards Directory */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Control Accounts Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage control accounts mapping specific financial ledgers to reporting groups.</p>
              </div>
              
              <div className="relative min-w-[270px]">
                <input
                  type="text"
                  placeholder="Search by code, control name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
              </div>
            </div>

            {filteredControls.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl bg-white">
                No registered control accounts found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredControls.map(c => {
                  const initialLetter = c.name.charAt(0).toUpperCase();
                  const groupName = state.groupAccounts.find(g => g.id === c.groupId)?.name || 'UNKNOWN GROUP';

                  return (
                    <div
                      key={c.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectControl(c)}
                    >
                      <div>
                        {/* Card Top: Code & Group name */}
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider flex-shrink-0">
                            CODE: {c.id}
                          </span>
                          <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider truncate max-w-[135px]" title={groupName}>
                            {groupName}
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
                              Control Account (Sort: {c.sorting})
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectControl(c)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Control Account"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteControl(c.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Control Account"
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
                  {selectedId ? 'Edit Control Account' : 'Register New Control Account'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Configure control code, parent financial group, and listing priority.</p>
              </div>
            </div>

            <form onSubmit={handleSave} className="max-w-xl flex flex-col gap-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={15} className="text-[#B08D57]" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Control Account Configuration</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Control Code</label>
                  <input
                    type="text"
                    value={id}
                    onChange={e => setId(e.target.value)}
                    placeholder="e.g. 1100"
                    disabled={!!selectedId}
                    className="soleria-input font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Control Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. CASH &amp; BANK ACCs"
                    className="soleria-input font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Group A/C</label>
                  <select
                    value={groupId}
                    onChange={e => setGroupId(e.target.value)}
                    className="soleria-input cursor-pointer font-medium"
                  >
                    <option value="">Select Group...</option>
                    {state.groupAccounts.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.id})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Sorting Priority</label>
                  <input
                    type="number"
                    value={sorting}
                    onChange={e => setSorting(parseInt(e.target.value) || 1)}
                    className="soleria-input font-mono font-medium"
                  />
                </div>
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
