import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, X, ListCollapse } from 'lucide-react';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import DataListTable from '@/components/DataListTable';
import {
  groupAccounts as groupAccountsApi,
  chartAccounts as chartAccountsApi,
  listAccountClasses,
  type GroupAccountRow,
  type AccountClassRow,
  type ChartOfAccountRow,
} from '@/lib/api';

export default function GroupAcSetupPage() {
  const [groups, setGroups] = useState<GroupAccountRow[]>([]);
  const [classes, setClasses] = useState<AccountClassRow[]>([]);
  const [viewingChildCharts, setViewingChildCharts] = useState<ChartOfAccountRow[]>([]);

  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [classId, setClassId] = useState<number | null>(null);

  // Drill-down Modal State
  const [viewingGroupId, setViewingGroupId] = useState<number | null>(null);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const [gRes, cRes] = await Promise.all([
      groupAccountsApi.list({ includeInactive: true }),
      listAccountClasses(),
    ]);
    if (gRes.ok) setGroups(gRes.data);
    if (cRes.ok) {
      setClasses(cRes.data);
      setClassId(prev => prev ?? cRes.data[0]?.class_id ?? null);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setName('');
    setClassId(classes[0]?.class_id ?? null);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (grp: GroupAccountRow) => {
    setSelectedId(grp.group_id);
    setName(grp.name);
    setClassId(grp.class_id);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setName('');
    setErrorMsg('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = name.trim();
    if (!typed) return setErrorMsg('Group Account name is required.');
    if (!classId) return setErrorMsg('Account class is required.');

    if (selectedId) {
      const res = await groupAccountsApi.update(selectedId, { name: typed });
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Group Account updated successfully.');
      await loadData();
    } else {
      const res = await groupAccountsApi.create({ name: typed, class_id: classId });
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE') {
          const details = res.error.details as { group_id: number; name: string } | undefined;
          setDupMatch(details ? { id: String(details.group_id), name: details.name } : null);
          setIsDupModalOpen(true);
          return;
        }
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Group Account registered successfully.');
      await loadData();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleActivateDuplicate = async (id: string) => {
    const res = await groupAccountsApi.reactivate(Number(id));
    if (res.ok) {
      setSuccessMsg('Group Account reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadData();
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    handleCloseModal();
  };



  const filteredAndSortedGroups = useMemo(() => {
    let list = groups.filter(g => g.is_active);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.code.toLowerCase().includes(q) ||
        (g.class_name || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'code') {
        return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        return a.name.localeCompare(b.name);
      }
    });
  }, [groups, searchQuery, sortBy]);

  const viewingGroup = useMemo(() => groups.find(g => g.group_id === viewingGroupId), [viewingGroupId, groups]);

  useEffect(() => {
    if (viewingGroupId == null) {
      setViewingChildCharts([]);
      return;
    }
    chartAccountsApi.list({ group_id: viewingGroupId, includeInactive: true }).then(res => {
      if (res.ok) setViewingChildCharts(res.data);
    });
  }, [viewingGroupId]);

  return (
    <AppLayout pageTitle="Group Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 1400 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && !isModalOpen && (
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

        {/* Group Accounts Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<GroupAccountRow>
            rows={filteredAndSortedGroups}
            rowKey={grp => grp.group_id}
            onRowClick={grp => setViewingGroupId(grp.group_id)}
            emptyIcon={<ListCollapse size={36} />}
            emptyMessage="No registered group accounts found matching your search."
            columns={[
              {
                key: 'code',
                header: 'Group Code',
                width: '140px',
                render: grp => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">#{grp.code}</span>
                ),
              },
              {
                key: 'name',
                header: 'Group Name',
                render: grp => <span className="font-semibold text-slate-900">{grp.name}</span>,
              },
              {
                key: 'class',
                header: 'Account Class',
                render: grp => (
                  <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider">
                    {grp.class_name || '—'}
                  </span>
                ),
              },
              {
                key: 'sorting',
                header: 'Sorting',
                width: '100px',
                align: 'center',
                render: grp => (
                  <span className="font-mono text-xs text-slate-500">{grp.sorting ?? '—'}</span>
                ),
              },
            ]}
            actions={grp => (
              <>
                <button
                  onClick={() => handleOpenEditModal(grp)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit Group Account"
                >
                  <Edit2 size={15} />
                </button>
              </>
            )}
          />
        </div>

        {/* Drill-down Modal showing child chart accounts */}
        {viewingGroupId && viewingGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => setViewingGroupId(null)}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <div>
                  <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                    <ListCollapse size={18} className="text-[#B08D57]" /> {viewingGroup.name}
                  </h3>
                  <p className="text-xs text-slate-500">Group Code #{viewingGroup.code} · {viewingGroup.class_name} Category</p>
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

                <DataListTable<ChartOfAccountRow>
                  rows={viewingChildCharts}
                  rowKey={c => c.ac_id}
                  emptyMessage="No chart of accounts registered under this group head."
                  columns={[
                    {
                      key: 'code',
                      header: 'Code',
                      width: '110px',
                      render: c => (
                        <span className="font-mono text-[11px] text-slate-500">#{c.code}</span>
                      ),
                    },
                    {
                      key: 'name',
                      header: 'Chart Account',
                      render: c => <span className="font-semibold text-xs text-slate-900">{c.name}</span>,
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      width: '100px',
                      align: 'center',
                      render: c => (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                          {c.status}
                        </span>
                      ),
                    },
                  ]}
                />
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

                {selectedId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Group Code
                    </label>
                    <input
                      type="text"
                      value={groups.find(g => g.group_id === selectedId)?.code || ''}
                      disabled
                      className="soleria-input w-full font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                )}

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
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Account Class Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={classId ?? ''}
                    onChange={e => setClassId(Number(e.target.value))}
                    disabled={!!selectedId}
                    className="soleria-input w-full cursor-pointer font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    {classes.map(c => (
                      <option key={c.class_id} value={c.class_id}>{c.name}</option>
                    ))}
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

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="group account"
          status="inactive"
          matches={dupMatch ? [dupMatch] : []}
          allowCreateOnActive={false}
          onActivate={handleActivateDuplicate}
          onCreateNew={() => {}}
          onCancel={() => {
            setIsDupModalOpen(false);
            setDupMatch(null);
          }}
        />

      </div>
    </AppLayout>
  );
}
