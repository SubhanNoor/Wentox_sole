import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, RotateCcw, X, BookOpen } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import DataListTable from '@/components/DataListTable';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import {
  chartAccounts as chartAccountsApi,
  groupAccounts as groupAccountsApi,
  businessAccounts as businessAccountsApi,
  RESERVED_ACCOUNT_CODES,
  type ChartOfAccountRow,
  type GroupAccountRow,
  type BusinessAccountRow,
} from '@/lib/api';

export default function ChartAcSetupPage() {
  const [charts, setCharts] = useState<ChartOfAccountRow[]>([]);
  const [groups, setGroups] = useState<GroupAccountRow[]>([]);
  const [viewingChildBizAccounts, setViewingChildBizAccounts] = useState<BusinessAccountRow[]>([]);

  // Search and Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [linkCode, setLinkCode] = useState('');

  // Drill-down Modal State
  const [viewingChartId, setViewingChartId] = useState<number | null>(null);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const [cRes, gRes] = await Promise.all([
      chartAccountsApi.list({ includeInactive: true }),
      groupAccountsApi.list({ includeInactive: true }),
    ]);
    if (cRes.ok) setCharts(cRes.data);
    if (gRes.ok) setGroups(gRes.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setName('');
    setGroupId('');
    setLinkCode('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (c: ChartOfAccountRow) => {
    setSelectedId(c.ac_id);
    setName(c.name);
    setGroupId(String(c.group_id));
    setLinkCode(c.link_code || '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setName('');
    setGroupId('');
    setLinkCode('');
    setErrorMsg('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = name.trim();
    if (!typed) return setErrorMsg('Account name is required.');
    if (!selectedId && !groupId) return setErrorMsg('Please select a parent Group A/C.');

    if (selectedId) {
      const res = await chartAccountsApi.update(selectedId, { name: typed, link_code: linkCode.trim() || undefined });
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Account updated successfully.');
      await loadData();
    } else {
      const res = await chartAccountsApi.create({ name: typed, group_id: Number(groupId), link_code: linkCode.trim() || undefined });
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE') {
          const details = res.error.details as { ac_id: number; name: string } | undefined;
          setDupMatch(details ? { id: String(details.ac_id), name: details.name } : null);
          setIsDupModalOpen(true);
          return;
        }
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Account registered successfully.');
      await loadData();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleActivateDuplicate = async (id: string) => {
    const res = await chartAccountsApi.reactivate(Number(id));
    if (res.ok) {
      setSuccessMsg('Account reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadData();
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    handleCloseModal();
  };

  const handleDeleteChart = async (chart: ChartOfAccountRow) => {
    if (RESERVED_ACCOUNT_CODES.includes(chart.code)) return;
    if (!window.confirm('Are you sure you want to close this Account?')) return;
    const res = await chartAccountsApi.remove(chart.ac_id);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setSuccessMsg('Account closed successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
    await loadData();
  };

  const handleReactivateChart = async (chart: ChartOfAccountRow) => {
    const res = await chartAccountsApi.reactivate(chart.ac_id);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setSuccessMsg('Account reactivated successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    await loadData();
  };

  const groupFilterOptions = useMemo(() => {
    return [
      { value: '', label: 'All Group Accounts' },
      ...groups.map(g => ({
        value: String(g.group_id),
        label: `${g.name} (${g.code})`
      }))
    ];
  }, [groups]);

  const groupSelectOptions = useMemo(() => {
    return groups.filter(g => g.is_active).map(g => ({
      value: String(g.group_id),
      label: `${g.name} (${g.code})`
    }));
  }, [groups]);

  const filteredAndSortedCharts = useMemo(() => {
    let list = charts;
    if (selectedGroupFilter) {
      list = list.filter(c => String(c.group_id) === selectedGroupFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'code') {
        return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        return a.name.localeCompare(b.name);
      }
    });
  }, [charts, searchQuery, sortBy, selectedGroupFilter]);

  const viewingChart = useMemo(() => charts.find(c => c.ac_id === viewingChartId), [viewingChartId, charts]);

  useEffect(() => {
    if (viewingChartId == null) {
      setViewingChildBizAccounts([]);
      return;
    }
    businessAccountsApi.list({ ac_id: viewingChartId, includeInactive: true }).then(res => {
      if (res.ok) setViewingChildBizAccounts(res.data);
    });
  }, [viewingChartId]);

  return (
    <AppLayout pageTitle="Chart of Accounts Setup">
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

        {/* Chart Accounts Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<ChartOfAccountRow>
            rows={filteredAndSortedCharts}
            rowKey={c => c.ac_id}
            onRowClick={c => setViewingChartId(c.ac_id)}
            emptyIcon={<BookOpen size={36} />}
            emptyMessage="No registered chart accounts found matching your search."
            columns={[
              {
                key: 'code',
                header: 'Chart Code',
                width: '150px',
                render: c => (
                  <div className="flex flex-col">
                    <span className="font-mono font-semibold text-slate-600 text-xs">#{c.code}</span>
                    {RESERVED_ACCOUNT_CODES.includes(c.code) && (
                      <span className="text-[10px] text-[#B08D57] font-semibold uppercase tracking-wider">
                        Reserved
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'name',
                header: 'Account Name',
                render: c => <span className="font-semibold text-slate-900">{c.name}</span>,
              },
              {
                key: 'group',
                header: 'Group Account',
                render: c => (
                  <span className="font-semibold text-[#B08D57]">{c.group_name || 'UNKNOWN GROUP'}</span>
                ),
              },
              {
                key: 'link_code',
                header: 'Link Code',
                width: '120px',
                render: c => (
                  <span className="font-mono text-xs text-slate-500">{c.link_code || '—'}</span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                align: 'center',
                render: c => (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                    c.status === 'ACTIVE'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {c.status === 'ACTIVE' ? 'Active' : 'Closed'}
                  </span>
                ),
              },
            ]}
            actions={c => {
              const isReserved = RESERVED_ACCOUNT_CODES.includes(c.code);
              return (
                <>
                  <button
                    onClick={() => handleOpenEditModal(c)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                    title="Edit Chart Account"
                  >
                    <Edit2 size={15} />
                  </button>
                  {c.status === 'CLOSED' ? (
                    <button
                      onClick={() => handleReactivateChart(c)}
                      className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
                      title="Reactivate Account"
                    >
                      <RotateCcw size={15} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDeleteChart(c)}
                      disabled={isReserved}
                      className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      title={isReserved ? 'Reserved account — cannot be closed' : 'Close Account'}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              );
            }}
          />
        </div>

        {/* Drill-down Modal showing child business accounts */}
        {viewingChartId && viewingChart && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => setViewingChartId(null)}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <div>
                  <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                    <BookOpen size={18} className="text-[#B08D57]" /> {viewingChart.name}
                  </h3>
                  <p className="text-xs text-slate-500">Chart Code #{viewingChart.code}</p>
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

                <DataListTable<BusinessAccountRow>
                  rows={viewingChildBizAccounts}
                  rowKey={b => b.ba_id}
                  emptyMessage="No business accounts registered under this chart head."
                  columns={[
                    {
                      key: 'code',
                      header: 'Code',
                      width: '130px',
                      render: b => (
                        <span className="font-mono text-[11px] text-slate-500">#{b.code}</span>
                      ),
                    },
                    {
                      key: 'name',
                      header: 'Business Account',
                      render: b => <span className="font-semibold text-xs text-slate-900">{b.name}</span>,
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      width: '100px',
                      align: 'center',
                      render: b => (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${b.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                          {b.status}
                        </span>
                      ),
                    },
                  ]}
                />
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

                {selectedId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Chart Account Code
                    </label>
                    <input
                      type="text"
                      value={charts.find(c => c.ac_id === selectedId)?.code || ''}
                      disabled
                      className="soleria-input w-full font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                )}

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
                    autoFocus
                  />
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
                    disabled={!!selectedId}
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

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="chart account"
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
