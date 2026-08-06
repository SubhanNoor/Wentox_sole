import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, X, ListCollapse, ArrowRight } from 'lucide-react';
import { filterChartAccountsForRole } from '@/lib/access';

export default function GroupAcSetupPage() {
  const { state, dispatch } = useApp();

  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [acClass, setAcClass] = useState<'ASSETS' | 'LIABILITY' | 'INCOME' | 'EXPENSES'>('ASSETS');

  // Drill-down Modal State
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setAcClass('ASSETS');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (grp: any) => {
    setSelectedId(grp.id);
    setId(grp.id);
    setName(grp.name);
    setAcClass(grp.class);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setId('');
    setName('');
    setAcClass('ASSETS');
    setErrorMsg('');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Group Account code is required.');
    if (!name.trim()) return setErrorMsg('Group Account name is required.');

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
    handleCloseModal();
  };

  const handleDeleteGroup = (grpId: string) => {
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
      handleCloseModal();
    }
  };

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

  const viewingGroup = useMemo(() => {
    return state.groupAccounts.find(g => g.id === viewingGroupId);
  }, [viewingGroupId, state.groupAccounts]);

  const viewingChildCharts = useMemo(() => {
    if (!viewingGroupId) return [];
    return filterChartAccountsForRole(
      state.chartAccounts.filter(c => c.groupId === viewingGroupId),
      state.currentUserRole
    );
  }, [viewingGroupId, state.chartAccounts, state.currentUserRole]);

  return (
    <AppLayout pageTitle="Group Accounts Setup">
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
                <ListCollapse size={20} className="text-[#B08D57]" /> Group Accounts Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Manage high-level Group accounts specifying financial classification category rules.</p>
            </div>
            
            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Group Account
            </button>
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
                placeholder="Search by code, name, class..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="soleria-input w-full py-2 px-3.5 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
            </div>
          </div>
        </div>

        {/* Group Accounts Cards Grid (§1 Standard) */}
        {filteredAndSortedGroups.length === 0 ? (
          <div className="card-white p-12 text-center text-slate-400">
            <ListCollapse size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600">No registered group accounts found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedGroups.map(grp => {
              const childCharts = filterChartAccountsForRole(
                state.chartAccounts.filter(c => c.groupId === grp.id),
                state.currentUserRole
              );

              return (
                <div
                  key={grp.id}
                  onClick={() => setViewingGroupId(grp.id)}
                  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                >
                  <div>
                    {/* Header: Title + Class Badge */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                        {grp.name}
                      </h4>
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0">
                        {grp.class}
                      </span>
                    </div>

                    {/* Subtitle: Code in mono */}
                    <div className="font-mono text-xs text-slate-400 mb-3">
                      Group Code: <span className="font-semibold text-slate-600">#{grp.id}</span>
                    </div>

                    <div className="text-xs text-slate-500 font-medium border-t border-slate-100 pt-2.5">
                      Child Accounts: <span className="font-semibold text-slate-700">{childCharts.length}</span>
                    </div>
                  </div>

                  {/* Footer Bar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditModal(grp)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                        title="Edit Group Account"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(grp.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Group Account"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                      View Accounts <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Drill-down Modal showing child chart accounts */}
        {viewingGroupId && viewingGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => setViewingGroupId(null)}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <div>
                  <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                    <ListCollapse size={18} className="text-[#B08D57]" /> {viewingGroup.name}
                  </h3>
                  <p className="text-xs text-slate-500">Group Code #{viewingGroup.id} · {viewingGroup.class} Category</p>
                </div>
                <button
                  onClick={() => setViewingGroupId(null)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 max-h-96 overflow-y-auto">
                <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
                  Registered Chart Accounts ({viewingChildCharts.length})
                </div>

                {viewingChildCharts.length === 0 ? (
                  <div className="text-center p-6 text-slate-400 italic text-xs">
                    No chart of accounts registered under this group head.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {viewingChildCharts.map(c => (
                      <div key={c.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-xs text-slate-900">{c.name}</div>
                          <div className="font-mono text-[11px] text-slate-400">Code: #{c.id}</div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${c.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                          {c.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-100 flex justify-end">
                <button onClick={() => setViewingGroupId(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedId ? 'Edit Group Account' : 'Register New Group Account'}
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
                      Group Code <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={id}
                      onChange={e => setId(e.target.value)}
                      placeholder="e.g. 1100"
                      disabled={!!selectedId}
                      className="soleria-input w-full font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                      autoFocus={!selectedId}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Account Title <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Current Assets"
                      className="soleria-input w-full font-semibold"
                      autoFocus={!!selectedId}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Account Class Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={acClass}
                    onChange={e => setAcClass(e.target.value as any)}
                    className="soleria-input w-full cursor-pointer font-semibold"
                  >
                    <option value="ASSETS">ASSETS</option>
                    <option value="LIABILITY">LIABILITY</option>
                    <option value="INCOME">INCOME</option>
                    <option value="EXPENSES">EXPENSES</option>
                  </select>
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
                    <Save size={14} /> Save Group Account
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
