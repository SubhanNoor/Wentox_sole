import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import SearchableSelect from '@/components/SearchableSelect';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, RotateCcw, Trash2, X, ListCollapse, XOctagon } from 'lucide-react';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import DataListTable from '@/components/DataListTable';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import {
  groupAccounts as groupAccountsApi,
  chartAccounts as chartAccountsApi,
  listAccountClasses,
  type GroupAccountRow,
  type AccountClassRow,
  type ChartOfAccountRow,
} from '@/lib/api';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

export default function GroupAcSetupPage() {
  const [groups, setGroups] = useState<GroupAccountRow[]>([]);
  const [classes, setClasses] = useState<AccountClassRow[]>([]);
  const [viewingChildCharts, setViewingChildCharts] = useState<ChartOfAccountRow[]>([]);

  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');
  // Per the user, 2026-09-17: a deleted (closed) account must not show up anywhere by default —
  // off by default, matching BankSetupPage's own convention — Reactivate is still reachable by
  // switching it on.
  const [showInactive, setShowInactive] = useState(false);

  // Modal State
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State — persisted only while adding a NEW group account (not editing an existing one,
  // which is re-openable by id at any time and would risk a stale cached copy).
  const clearDraft = useClearPageDraft('group-account-setup');
  const [name, setName] = usePersistentField('group-account-setup', 'name', '');
  const [classId, setClassId] = usePersistentField<number | null>('group-account-setup', 'classId', null);

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
    // setClassId's identity is stable (usePersistentField wraps a plain useState setter), same as
    // every other setState setter already omitted from deps arrays throughout this codebase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    clearDraft();
  };

  // G-07 (changes-14-09-26.md): Escape closes the topmost dialog.
  useEscapeToClose(isModalOpen, handleCloseModal);

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
      handleCloseModal();
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
      // G-06: stays open, cleared, ready for another — class_id deliberately kept, same as it
      // already survives handleCloseModal today.
      setSelectedId(null);
      setName('');
      setErrorMsg('');
      clearDraft();
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }

    setTimeout(() => setSuccessMsg(''), 3000);
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
    setSelectedId(null);
    setName('');
    setErrorMsg('');
    clearDraft();
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const handleReactivateGroup = async (grp: GroupAccountRow) => {
    const res = await groupAccountsApi.reactivate(grp.group_id);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setSuccessMsg('Group Account reactivated successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    await loadData();
  };

  // ACC-02 (changes-14-09-26.md): Delete — soft, via the existing Close mechanism
  // (groupAccounts.service.js#remove already enforces the has-children guard; this is just the
  // confirmation UI in front of it). Groups don't carry ledger transactions of their own — only
  // the chart accounts filed under them do — so the "carries transactions" case never applies
  // here directly; the has-children check covers the meaningful case for this level.
  const [deletingGroup, setDeletingGroup] = useState<GroupAccountRow | null>(null);
  // Password-gated per the user (2026-09-17), same as every other account type's delete —
  // PasswordPromptModal IS the confirmation step now, replacing the old plain ConfirmModal.
  const confirmDeleteGroup = async (password: string) => {
    if (!deletingGroup) return;
    // One-step delete (per the user, 2026-09-18) — straight to the permanent delete, no close first.
    const res = await groupAccountsApi.permanentDelete(deletingGroup.group_id, password);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      setTimeout(() => setErrorMsg(''), 5000);
      setDeletingGroup(null);
      return;
    }
    setSuccessMsg('Group Account deleted.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setDeletingGroup(null);
    await loadData();
  };

  // Permanent delete — added on top of the close/reactivate cycle above, per the user
  // (2026-09-17). Only reachable for an already-closed group; the backend's hasAnyReference()
  // check is the real guard.
  const [permDeletingGroup, setPermDeletingGroup] = useState<GroupAccountRow | null>(null);
  const confirmPermanentDeleteGroup = async (password: string) => {
    if (!permDeletingGroup) return;
    const res = await groupAccountsApi.permanentDelete(permDeletingGroup.group_id, password);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      setTimeout(() => setErrorMsg(''), 5000);
      setPermDeletingGroup(null);
      return;
    }
    setSuccessMsg('Group Account permanently deleted.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setPermDeletingGroup(null);
    await loadData();
  };


  // ACC-02 (changes-14-09-26.md) originally showed every status, badged, unconditionally. Per the
  // user (2026-09-17): a deleted (closed) account must not show up anywhere by default — hidden
  // now unless "Show closed" is switched on, same convention as BusinessAcSetupPage/
  // ChartAcSetupPage/BankSetupPage. Reactivate is still reachable by switching it on.
  const filteredAndSortedGroups = useMemo(() => {
    let list = groups;
    if (!showInactive) {
      list = list.filter(g => g.is_active);
    }
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
  }, [groups, searchQuery, sortBy, showInactive]);

  const viewingGroup = useMemo(() => groups.find(g => g.group_id === viewingGroupId), [viewingGroupId, groups]);

  const classOptions = useMemo(
    () => classes.map(c => ({ value: String(c.class_id), label: c.name })),
    [classes]
  );

  useEffect(() => {
    if (viewingGroupId == null) {
      setViewingChildCharts([]);
      return;
    }
    // Per the user, 2026-09-17: respects the same page-level "Show closed" toggle as the main
    // list — a closed chart account under this group stays hidden here too by default.
    chartAccountsApi.list({ group_id: viewingGroupId, includeInactive: showInactive }).then(res => {
      if (res.ok) setViewingChildCharts(res.data);
    });
  }, [viewingGroupId, showInactive]);

  return (
    <AppLayout pageTitle="Group Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 1750 }}>

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
            <div className="flex items-center gap-3">
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
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
                <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                Show closed
              </label>
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
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                align: 'center',
                render: grp => (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                    grp.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {grp.is_active ? 'Active' : 'Closed'}
                  </span>
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
                {!grp.is_active ? (
                  <>
                    <button
                      onClick={() => handleReactivateGroup(grp)}
                      className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
                      title="Reactivate Group Account"
                    >
                      <RotateCcw size={15} />
                    </button>
                    <button
                      onClick={() => setPermDeletingGroup(grp)}
                      className="p-1.5 rounded-lg hover:bg-rose-100 text-slate-400 hover:text-rose-700 transition-colors cursor-pointer"
                      title="Permanently Delete — cannot be undone"
                    >
                      <XOctagon size={15} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setDeletingGroup(grp)}
                    className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                    title="Delete Group Account"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          />
        </div>

        {/* Drill-down Modal showing child chart accounts */}
        {viewingGroupId && viewingGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => setViewingGroupId(null)}
            onKeyDown={e => { if (e.key === 'Escape') { (() => setViewingGroupId(null))(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}
           
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-md max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
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
                    ref={nameInputRef}
                    type="text"
                    required
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
                  {/* Was a native <select>. onChange hands back a string, so it is parsed here -
                      classId is a number, and Number('') would silently become 0. */}
                  <SearchableSelect
                    options={classOptions}
                    value={classId != null ? String(classId) : ''}
                    onChange={val => setClassId(val ? Number(val) : null)}
                    placeholder="Select account class..."
                    searchPlaceholder="Search classes..."
                    disabled={!!selectedId}
                    required
                  />
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

        <PasswordPromptModal
          isOpen={!!deletingGroup}
          onClose={() => setDeletingGroup(null)}
          onSuccess={confirmDeleteGroup}
          title="Delete Group Account"
          subtitle={deletingGroup ? `Confirm your password to delete "${deletingGroup.name}". This PERMANENTLY removes it (and any closed chart/business accounts under it) — it cannot be undone. Refused if any account under it is active, or has transactions or a customer/vendor/employee/bank link.` : undefined}
        />

        <PasswordPromptModal
          isOpen={!!permDeletingGroup}
          onClose={() => setPermDeletingGroup(null)}
          onSuccess={confirmPermanentDeleteGroup}
          title="Permanently Delete Group Account"
          subtitle={permDeletingGroup ? `Confirm your password to PERMANENTLY delete "${permDeletingGroup.name}". This cannot be undone — the record itself is removed, not just closed. Its CLOSED chart accounts (and their closed business accounts) are permanently deleted with it. It will be refused if any account beneath it is still active, or has transactions or a customer/vendor/employee/bank link.` : undefined}
        />

      </div>
    </AppLayout>
  );
}
