import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, RotateCcw, X, Landmark } from 'lucide-react';
import DataListTable from '@/components/DataListTable';

interface BatchRow {
  name: string;
  regionId: string;
  cityId: string;
  openingBalance: string;
  openingDate: string;
}

const emptyBatchRow = (): BatchRow => ({ name: '', regionId: '', cityId: '', openingBalance: '', openingDate: getTodayDate() });
import SearchableSelect from '@/components/SearchableSelect';
import OpeningBalanceFields from '@/components/OpeningBalanceFields';
import { getTodayDate } from '@/lib/utils';
import {
  businessAccounts as businessAccountsApi,
  chartAccounts as chartAccountsApi,
  listRegions,
  listCities,
  type BusinessAccountRow,
  type ChartOfAccountRow,
  type RegionRow,
  type CityRow,
} from '@/lib/api';

export default function BusinessAcSetupPage() {
  const [accounts, setAccounts] = useState<BusinessAccountRow[]>([]);
  const [charts, setCharts] = useState<ChartOfAccountRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);

  // Modal State
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Multi-account entry: one parent chart account chosen once, several accounts saved together.
  // Same shape as ProductSetupPage's batch mode, and the same per-row error contract — the backend
  // returns BATCH_VALIDATION_FAILED with details.errors = [{ index, message }].
  const [batchMode, setBatchMode] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([emptyBatchRow()]);
  const [batchErrors, setBatchErrors] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [controlId, setControlId] = useState(''); // parent chart account id
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(getTodayDate());

  // Search and Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChartFilter, setSelectedChartFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const [bRes, cRes, rRes, ciRes] = await Promise.all([
      businessAccountsApi.list({ includeInactive: true }),
      chartAccountsApi.list({ includeInactive: true }),
      listRegions(),
      listCities(),
    ]);
    if (bRes.ok) setAccounts(bRes.data);
    if (cRes.ok) setCharts(cRes.data);
    if (rRes.ok) setRegions(rRes.data);
    if (ciRes.ok) setCities(ciRes.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetBatch = () => {
    setBatchMode(false);
    setBatchRows([emptyBatchRow()]);
    setBatchErrors({});
  };

  const updateBatchRow = (index: number, patch: Partial<BatchRow>) => {
    setBatchRows(rows => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleSaveBatch = async () => {
    setBatchErrors({});
    if (!controlId) return setErrorMsg('Please select a parent Chart A/C.');
    const res = await businessAccountsApi.createBatch({
      ac_id: Number(controlId),
      accounts: batchRows.map(r => ({
        name: r.name.trim(),
        region_id: r.regionId ? Number(r.regionId) : undefined,
        city_id: r.cityId ? Number(r.cityId) : undefined,
        opening_balance: r.openingBalance.trim() ? Number(r.openingBalance) : undefined,
        opening_date: r.openingDate.trim() || undefined,
      })),
    });
    if (!res.ok) {
      // Nothing was written — the backend validates every row before inserting any — so the form
      // keeps its contents and just marks the rows that failed.
      const rowErrors = (res.error.details as { errors?: { index: number; message: string }[] } | undefined)?.errors;
      if (rowErrors?.length) {
        setBatchErrors(Object.fromEntries(rowErrors.map(e => [e.index, e.message])));
        return setErrorMsg('Some rows need fixing — nothing was saved.');
      }
      return setErrorMsg(res.error.message);
    }
    setSuccessMsg(`${res.data.length} business accounts registered successfully.`);
    // G-06: stays open, ready for another batch — controlId (the shared parent chart account) and
    // batchMode itself are deliberately kept, only the row data resets.
    setBatchRows([emptyBatchRow()]);
    setBatchErrors({});
    await loadData();
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setName('');
    setControlId('');
    setRegionId('');
    setCityId('');
    setOpeningBalance('');
    setOpeningDate(getTodayDate());
    setErrorMsg('');
    resetBatch();
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (biz: BusinessAccountRow) => {
    setSelectedId(biz.ba_id);
    setName(biz.name);
    setControlId(String(biz.ac_id));
    setRegionId(biz.region_id ? String(biz.region_id) : '');
    setCityId(biz.city_id ? String(biz.city_id) : '');
    // Load what is actually stored — these were blanked and the fields hidden while editing, which
    // is why an opening balance could only ever be set at creation.
    setOpeningBalance(biz.opening_balance != null ? String(biz.opening_balance) : '');
    setOpeningDate(biz.opening_date ? biz.opening_date.slice(0, 10) : '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    resetBatch();
    setIsModalOpen(false);
    setSelectedId(null);
    setName('');
    setControlId('');
    setRegionId('');
    setCityId('');
    setOpeningBalance('');
    setOpeningDate(getTodayDate());
    setErrorMsg('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (batchMode && !selectedId) return handleSaveBatch();
    const typed = name.trim();
    if (!typed) return setErrorMsg('Business Account title / name is required.');
    if (!selectedId && !controlId) return setErrorMsg('Please select a parent Chart A/C.');
    if ((openingBalance.trim() !== '') !== (openingDate.trim() !== '')) {
      return setErrorMsg('Opening balance and opening date must be provided together.');
    }

    if (selectedId) {
      const res = await businessAccountsApi.update(selectedId, {
        name: typed,
        region_id: regionId ? Number(regionId) : undefined,
        city_id: cityId ? Number(cityId) : undefined,
        opening_balance: openingBalance.trim() ? Number(openingBalance) : undefined,
        opening_date: openingDate.trim() || undefined,
      });
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Business Account updated successfully.');
      await loadData();
    } else {
      const res = await businessAccountsApi.create({
        name: typed,
        ac_id: Number(controlId),
        region_id: regionId ? Number(regionId) : undefined,
        city_id: cityId ? Number(cityId) : undefined,
        opening_balance: openingBalance.trim() ? Number(openingBalance) : undefined,
        opening_date: openingDate.trim() || undefined,
      });
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Business Account registered successfully.');
      // G-06: stays open, cleared, ready for another — G-04: openingDate deliberately kept.
      setName('');
      setRegionId('');
      setCityId('');
      setOpeningBalance('');
      requestAnimationFrame(() => nameInputRef.current?.focus());
      await loadData();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleReactivateBusinessAc = async (biz: BusinessAccountRow) => {
    const res = await businessAccountsApi.reactivate(biz.ba_id);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setSuccessMsg('Business Account reactivated successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    await loadData();
  };

  const openChartAccounts = useMemo(() => charts.filter(c => c.status === 'ACTIVE'), [charts]);

  const chartOptions = useMemo(() => {
    return openChartAccounts.map(c => ({
      value: String(c.ac_id),
      label: `${c.name} (${c.code})`
    }));
  }, [openChartAccounts]);

  const chartFilterOptions = useMemo(() => {
    return [
      { value: '', label: 'All Accounts' },
      ...charts.map(c => ({
        value: String(c.ac_id),
        label: `${c.name} (${c.code})`
      }))
    ];
  }, [charts]);

  const regionOptions = useMemo(() => regions.filter(r => r.is_active).map(r => ({ value: String(r.region_id), label: r.name })), [regions]);
  const cityOptions = useMemo(() => cities.filter(c => c.is_active).map(c => ({ value: String(c.city_id), label: c.name })), [cities]);

  const filteredAndSortedAccounts = useMemo(() => {
    let list = accounts;
    if (selectedChartFilter) {
      list = list.filter(b => String(b.ac_id) === selectedChartFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b =>
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        (b.region_name && b.region_name.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'code') {
        return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        return a.name.localeCompare(b.name);
      }
    });
  }, [accounts, searchQuery, sortBy, selectedChartFilter]);

  return (
    <AppLayout pageTitle="Business Accounts Setup">
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

        {/* Business Accounts Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<BusinessAccountRow>
            rows={filteredAndSortedAccounts}
            rowKey={biz => biz.ba_id}
            onRowClick={biz => handleOpenEditModal(biz)}
            emptyIcon={<Landmark size={36} />}
            emptyMessage="No registered business accounts found matching your search."
            columns={[
              {
                key: 'code',
                header: 'A/C Code',
                width: '150px',
                render: biz => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">#{biz.code}</span>
                ),
              },
              {
                key: 'name',
                header: 'Account Name',
                render: biz => <span className="font-semibold text-slate-900">{biz.name}</span>,
              },
              {
                key: 'control',
                header: 'Control A/C',
                render: biz => (
                  <span className="font-semibold text-[#B08D57]">{biz.ac_name || 'UNKNOWN A/C'}</span>
                ),
              },
              {
                key: 'region',
                header: 'Region',
                render: biz => (
                  <span className="text-slate-600 font-medium">{biz.region_name || 'N/A'}</span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                align: 'center',
                render: biz => (
                  <div className="flex items-center justify-center gap-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                      biz.status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      {biz.status === 'ACTIVE' ? 'Active' : 'Closed'}
                    </span>
                    {/* Cash in Hand / Journal Voucher — the posting engine resolves these, and the
                        backend refuses to close them. Marked so nobody tries to reorganise them. */}
                    {biz.is_reserved && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-300"
                        title="System account — the posting engine depends on it and it cannot be closed"
                      >
                        System
                      </span>
                    )}
                  </div>
                ),
              },
            ]}
            actions={biz => (
              <>
                <button
                  onClick={() => handleOpenEditModal(biz)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit Business Account"
                >
                  <Edit2 size={15} />
                </button>
                {biz.status === 'CLOSED' ? (
                  <button
                    onClick={() => handleReactivateBusinessAc(biz)}
                    className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
                    title="Reactivate Business Account"
                  >
                    <RotateCcw size={15} />
                  </button>
                ) : null}
              </>
            )}
          />
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}
            onKeyDown={e => { if (e.key === 'Escape') { (handleCloseModal)(); } }}
            tabIndex={-1}>
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

                {!selectedId && (
                  <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setBatchMode(false)}
                      className={`flex-1 py-1.5 rounded-md transition-all ${!batchMode ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600'}`}
                    >
                      One Account
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchMode(true)}
                      className={`flex-1 py-1.5 rounded-md transition-all ${batchMode ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600'}`}
                    >
                      Several at Once
                    </button>
                  </div>
                )}

                {selectedId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Business Account Code
                    </label>
                    <input
                      type="text"
                      value={accounts.find(b => b.ba_id === selectedId)?.code || ''}
                      disabled
                      className="soleria-input w-full font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                )}

{(!batchMode || selectedId) && (<>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Account Title / Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Shalimar Footwear Agency"
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
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
                    disabled={!!selectedId}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Region
                    </label>
                    <SearchableSelect
                      options={[{ value: '', label: 'Select Region (Optional)' }, ...regionOptions]}
                      value={regionId}
                      onChange={setRegionId}
                      placeholder="Select Region..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      City
                    </label>
                    <SearchableSelect
                      options={[{ value: '', label: 'Select City (Optional)' }, ...cityOptions]}
                      value={cityId}
                      onChange={setCityId}
                      placeholder="Select City..."
                    />
                  </div>
                </div>

                <OpeningBalanceFields
                  balance={openingBalance}
                  date={openingDate}
                  onBalanceChange={setOpeningBalance}
                  onDateChange={setOpeningDate}
                  isExisting={selectedId != null}
                />
                </>)}

                {batchMode && !selectedId && (
                  <div className="flex flex-col gap-3">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      All of these are created under the one Chart A/C selected above. If any row is
                      invalid the whole batch is rejected and nothing is saved, so you can fix it and
                      try again without creating half of them.
                    </p>

                    {batchRows.map((row, idx) => (
                      <div
                        key={idx}
                        className={`rounded-xl border p-3 flex flex-col gap-3 ${batchErrors[idx] ? 'border-rose-300 bg-rose-50/40' : ''}`}
                        style={batchErrors[idx] ? undefined : { borderColor: 'var(--border-color)' }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Account {idx + 1}
                          </span>
                          {batchRows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setBatchRows(rows => rows.filter((_, i) => i !== idx))}
                              className="text-[10px] font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <input
                          type="text"
                          value={row.name}
                          onChange={e => updateBatchRow(idx, { name: e.target.value })}
                          placeholder="Account title / name"
                          className="soleria-input w-full font-semibold"
                        />

                        <div className="grid grid-cols-2 gap-2">
                          <SearchableSelect
                            options={[{ value: '', label: 'Region (optional)' },
                              ...regions.map(r => ({ value: String(r.region_id), label: r.name }))]}
                            value={row.regionId}
                            onChange={v => updateBatchRow(idx, { regionId: v, cityId: '' })}
                            placeholder="Region..."
                          />
                          <SearchableSelect
                            options={[{ value: '', label: 'City (optional)' },
                              ...cities.filter(c => !row.regionId || String(c.region_id) === row.regionId)
                                .map(c => ({ value: String(c.city_id), label: c.name }))]}
                            value={row.cityId}
                            onChange={v => updateBatchRow(idx, { cityId: v })}
                            placeholder="City..."
                          />
                        </div>

                        <OpeningBalanceFields
                          balance={row.openingBalance}
                          date={row.openingDate}
                          onBalanceChange={v => updateBatchRow(idx, { openingBalance: v })}
                          onDateChange={v => updateBatchRow(idx, { openingDate: v })}
                        />

                        {batchErrors[idx] && (
                          <p className="text-[11px] font-semibold text-rose-700">{batchErrors[idx]}</p>
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => setBatchRows(rows => [...rows, emptyBatchRow()])}
                      className="self-start px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer"
                    >
                      + Add another account
                    </button>
                  </div>
                )}


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
