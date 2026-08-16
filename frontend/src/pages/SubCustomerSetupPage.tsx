import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, X, Users, MapPin } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { SubCustomerRow, RegionRow, CityRow } from '@/lib/api';

export default function SubCustomerSetupPage() {
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);

  // Duplicate Check Modal state — non-blocking branch: checkName() is advisory before create()
  const [dupMatches, setDupMatches] = useState<SubCustomerRow[]>([]);
  const [dupStatus, setDupStatus] = useState<'active' | 'inactive'>('active');
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [pendingSubCustomer, setPendingSubCustomer] = useState<{ name: string; region_id: number; city_id?: number } | null>(null);



  // Form State
  const [subName, setSubName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };

  const [subCustomerList, setSubCustomerList] = useState<SubCustomerRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [subRes, rgRes, ctRes] = await Promise.all([
      api.subCustomers.list({ includeInactive: false }),
      api.listRegions(),
      api.listCities(),
    ]);
    if (subRes.ok) setSubCustomerList(subRes.data);
    if (rgRes.ok) setRegions(rgRes.data);
    if (ctRes.ok) setCities(ctRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleOpenAddModal = () => {
    setSelectedSubId(null);
    setSubName('');
    setRegionId('');
    setCityId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (sub: SubCustomerRow) => {
    setSelectedSubId(sub.sub_customer_id);
    setSubName(sub.name);
    setRegionId(String(sub.region_id));
    setCityId(sub.city_id ? String(sub.city_id) : '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSubId(null);
    setSubName('');
    setRegionId('');
    setCityId('');
    setErrorMsg('');
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next sub
  // customer — instead of closing.
  const resetForNextSubCustomer = () => {
    setSelectedSubId(null);
    setSubName('');
    setRegionId('');
    setCityId('');
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const executeAddSubCustomer = async (data: { name: string; region_id: number; city_id?: number }) => {
    const res = await api.subCustomers.create(data);
    if (!res.ok) return setErrorMsg(res.error.message);
    flash('New Sub Customer registered successfully.');
    resetForNextSubCustomer();
    loadAll();
  };

  const handleSaveSubCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = subName.trim();
    if (!typed) return setErrorMsg('Please enter a Sub Customer name.');
    if (!regionId) return setErrorMsg('Region selection is required.');

    const payload = {
      name: typed,
      region_id: Number(regionId),
      city_id: cityId ? Number(cityId) : undefined,
    };

    if (selectedSubId) {
      const res = await api.subCustomers.update(selectedSubId, payload);
      if (!res.ok) return setErrorMsg(res.error.message);
      flash('Sub Customer details updated successfully.');
      handleCloseModal();
      loadAll();
    } else {
      const res = await api.subCustomers.checkName(typed);
      if (!res.ok) return setErrorMsg(res.error.message);
      if (res.data.status === 'none') {
        executeAddSubCustomer(payload);
      } else {
        setDupMatches(res.data.matches);
        setDupStatus(res.data.status);
        setPendingSubCustomer(payload);
        setIsDupModalOpen(true);
      }
    }
  };

  const handleActivateDuplicate = async (idStr: string) => {
    const res = await api.subCustomers.reactivate(Number(idStr));
    setIsDupModalOpen(false);
    setDupMatches([]);
    setPendingSubCustomer(null);
    if (!res.ok) return setErrorMsg('Failed to reactivate: ' + res.error.message);
    flash('Sub Customer reactivated successfully.');
    resetForNextSubCustomer();
    loadAll();
  };

  const handleCreateNewAnyway = () => {
    if (pendingSubCustomer) executeAddSubCustomer(pendingSubCustomer);
    setIsDupModalOpen(false);
    setDupMatches([]);
    setPendingSubCustomer(null);
  };



  const filteredSubCustomers = useMemo(() => {
    if (!searchQuery.trim()) return subCustomerList;
    const q = searchQuery.toLowerCase();
    return subCustomerList.filter(sc =>
      sc.name.toLowerCase().includes(q) ||
      String(sc.sub_customer_id).includes(q)
    );
  }, [subCustomerList, searchQuery]);

  return (
    <AppLayout pageTitle="Sub Customer Setup">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Directory Card */}
        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="border-b pb-4 mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                <Users size={20} className="text-[#B08D57]" /> Sub Customers Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Manage sub-customers associated with primary accounts for specialized bill dispatch.</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Sub Customer
            </button>
          </div>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                placeholder="Search sub customer name or ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3 top-2 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
              Total: {filteredSubCustomers.length} Sub Customers
            </div>
          </div>

          <DataListTable<SubCustomerRow>
            rows={filteredSubCustomers}
            rowKey={sc => sc.sub_customer_id}
            onRowClick={sc => handleOpenEditModal(sc)}
            loading={loading}
            emptyMessage="No registered sub customers found."
            columns={[
              {
                key: 'code',
                header: 'ID Code',
                width: '130px',
                render: sc => (
                  <span className="font-mono font-semibold text-slate-500 text-xs">{sc.sub_customer_id}</span>
                ),
              },
              {
                key: 'name',
                header: 'Sub Customer Name',
                render: sc => <span className="font-semibold text-slate-900">{sc.name}</span>,
              },
              {
                key: 'region',
                header: 'Region',
                render: sc => (
                  <span className="text-slate-600 font-medium">{sc.region_name || 'N/A'}</span>
                ),
              },
              {
                key: 'city',
                header: 'City',
                render: sc => (
                  <span className="text-slate-600 font-medium flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    {sc.city_name || 'N/A'}
                  </span>
                ),
              },
            ]}
            actionsWidth="90px"
            actions={sc => (
              <>
                <button
                  onClick={() => handleOpenEditModal(sc)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit Sub Customer"
                >
                  <Edit2 size={15} />
                </button>
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
                  {selectedSubId ? 'Edit Sub Customer' : 'Register New Sub Customer'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveSubCustomer} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Sub Customer Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={subName}
                    onChange={e => setSubName(e.target.value)}
                    placeholder="Enter sub customer name..."
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Region <span className="text-rose-500">*</span>
                    </label>
                    <SearchableSelect
                      options={regions.map(r => ({ value: String(r.region_id), label: r.name }))}
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
                      options={[
                        { value: '', label: 'Select City...' },
                        ...cities.map(c => ({ value: String(c.city_id), label: c.name }))
                      ]}
                      value={cityId}
                      onChange={setCityId}
                      placeholder="Select City..."
                    />
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
                    <Save size={14} /> Save Sub Customer
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="sub customer"
          status={dupStatus}
          matches={dupMatches.map(sc => ({
            id: String(sc.sub_customer_id),
            name: sc.name,
            cityName: sc.city_name,
          }))}
          allowCreateOnActive={true}
          onActivate={handleActivateDuplicate}
          onCreateNew={handleCreateNewAnyway}
          onCancel={() => {
            setIsDupModalOpen(false);
            setDupMatches([]);
            setPendingSubCustomer(null);
          }}
        />



      </div>
    </AppLayout>
  );
}
