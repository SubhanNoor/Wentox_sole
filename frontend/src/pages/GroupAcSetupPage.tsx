import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';

export default function GroupAcSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [acClass, setAcClass] = useState<'ASSETS' | 'LIABILITY' | 'INCOME' | 'EXPENSES'>('ASSETS');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setAcClass('ASSETS');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectGroup = (grp: any) => {
    setSelectedId(grp.id);
    setId(grp.id);
    setName(grp.name);
    setAcClass(grp.class);
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Group Account code is required.');
    if (!name.trim()) return setErrorMsg('Group Account name is required.');

    // Duplicate check if adding new
    if (!selectedId && state.groupAccounts.some(g => g.id.toLowerCase() === id.trim().toLowerCase())) {
      return setErrorMsg('A Group Account with this code already exists.');
    }

    const groupData = {
      id: id.trim(),
      name: name.trim(),
      class: acClass
    };

    if (selectedId) {
      dispatch({ type: 'UPDATE_GROUP_ACCOUNT', account: groupData });
      setSuccessMsg('Group Account updated successfully.');
    } else {
      dispatch({ type: 'ADD_GROUP_ACCOUNT', account: groupData });
      setSuccessMsg('Group Account registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setActiveTab('list');
    setSelectedId(null);
  };

  const handleDeleteGroup = (grpId: string) => {
    // Safety check: is it linked to any chart accounts?
    const inUse = state.chartAccounts.some(c => c.groupId === grpId);
    if (inUse) {
      setErrorMsg('Cannot delete: This group account is linked to active chart accounts.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Group Account?')) {
      dispatch({ type: 'DELETE_GROUP_ACCOUNT', id: grpId });
      setSuccessMsg('Group Account deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  const filteredAndSortedGroups = useMemo(() => {
    let list = state.groupAccounts;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(g => 
        g.name.toLowerCase().includes(q) || 
        g.id.toLowerCase().includes(q) ||
        g.class.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'code') {
        return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        return a.name.localeCompare(b.name);
      }
    });
  }, [state.groupAccounts, searchQuery, sortBy]);

  return (
    <AppLayout pageTitle="Group Accounts Setup">
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
              Group Accounts Directory
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Group Account
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Group Account
            </button>
          )}
        </div>

        {/* View 1: Group Accounts Cards Directory */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-col gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Group Accounts Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage high-level Group accounts specifying financial classification category rules.</p>
              </div>
              
              {/* Row: Sort and Search */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                {/* Sort Filters */}
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
                <div className="relative flex-1 min-w-[240px] sm:max-w-sm">
                  <input
                    type="text"
                    placeholder="Search by code, name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input w-full py-2 px-3.5 text-sm pr-10 font-semibold bg-white shadow-sm hover:border-[#B08D57] transition-all"
                  />
                  <Search className="absolute right-3.5 top-2.5 text-slate-400" size={16} />
                </div>
              </div>
            </div>

            {filteredAndSortedGroups.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl bg-white">
                No registered group accounts found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAndSortedGroups.map(grp => {
                  const initialLetter = grp.name.charAt(0).toUpperCase();

                  return (
                    <div
                      key={grp.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectGroup(grp)}
                    >
                      <div>
                        {/* Card Top: Code badge */}
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider flex-shrink-0">
                            CODE: {grp.id}
                          </span>
                        </div>

                        {/* Card Middle: Avatar circle + Name & Subheading (Class) */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {grp.name}
                            </h4>
                            <p className="text-[11px] text-[#B08D57] font-semibold mt-0.5 uppercase tracking-wider truncate">
                              {grp.class}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectGroup(grp)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Group Account"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteGroup(grp.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Group Account"
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
          <div className="max-w-2xl mx-auto">
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm">
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
                    {selectedId ? 'Edit Group Account' : 'Register New Group Account'}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Configure high-level reporting class and tracking parameters.</p>
                </div>
              </div>

              <form onSubmit={handleSave} className="flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-2">
                  <Settings size={15} className="text-[#B08D57]" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Group Account Configuration</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Group Code</label>
                    <input
                      type="text"
                      value={id}
                      onChange={e => setId(e.target.value)}
                      placeholder="e.g. 5000"
                      disabled={!!selectedId}
                      className="soleria-input font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Group Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. MANUFACTURING OVERHEADS"
                      className="soleria-input font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Account Class</label>
                  <select
                    value={acClass}
                    onChange={e => setAcClass(e.target.value as any)}
                    className="soleria-input cursor-pointer font-medium"
                  >
                    <option value="ASSETS">ASSETS</option>
                    <option value="LIABILITY">LIABILITY</option>
                    <option value="INCOME">INCOME</option>
                    <option value="EXPENSES">EXPENSES</option>
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
