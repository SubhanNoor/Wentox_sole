import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, X, Truck, MapPin } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import { addas as addasApi, listRegions, listCities, type AddaRow, type RegionRow, type CityRow } from '@/lib/api';

export default function AddaSetupPage() {
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [addaSearch, setAddaSearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAddaId, setSelectedAddaId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [addaName, setAddaName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const [aRes, rRes, cRes] = await Promise.all([
      addasApi.list({ includeInactive: true }),
      listRegions(),
      listCities(),
    ]);
    if (aRes.ok) setAddas(aRes.data);
    if (rRes.ok) setRegions(rRes.data);
    if (cRes.ok) setCities(cRes.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenAddModal = () => {
    setSelectedAddaId(null);
    setAddaName('');
    setRegionId('');
    setCityId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (adda: AddaRow) => {
    setSelectedAddaId(adda.adda_id);
    setAddaName(adda.name);
    setRegionId(String(adda.region_id));
    setCityId(adda.city_id ? String(adda.city_id) : '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedAddaId(null);
    setAddaName('');
    setRegionId('');
    setCityId('');
    setErrorMsg('');
  };

  const handleSaveAdda = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = addaName.trim();
    if (!typed) {
      return setErrorMsg('Adda name is required.');
    }
    if (!regionId) {
      return setErrorMsg('Region selection is required.');
    }

    const payload = {
      name: typed,
      region_id: Number(regionId),
      city_id: cityId ? Number(cityId) : undefined,
    };

    if (selectedAddaId) {
      const res = await addasApi.update(selectedAddaId, payload);
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Adda details updated successfully.');
      await loadData();
    } else {
      const res = await addasApi.create(payload);
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE') {
          const details = res.error.details as { adda_id: number; name: string } | undefined;
          setDupMatch(details ? { id: String(details.adda_id), name: details.name } : null);
          setIsDupModalOpen(true);
          return;
        }
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('New Transport Adda registered successfully.');
      await loadData();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleActivateDuplicate = async (id: string) => {
    const res = await addasApi.reactivate(Number(id));
    if (res.ok) {
      setSuccessMsg('Transport Adda reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadData();
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
  };

  const filteredAddas = useMemo(() => {
    const activeAddas = addas.filter(a => a.is_active);
    if (!addaSearch.trim()) return activeAddas;
    const q = addaSearch.toLowerCase();
    return activeAddas.filter(a =>
      a.name.toLowerCase().includes(q) ||
      String(a.adda_id).includes(q)
    );
  }, [addas, addaSearch]);

  const activeRegions = useMemo(() => regions.filter(r => r.is_active), [regions]);
  const activeCities = useMemo(() => cities.filter(c => c.is_active), [cities]);

  return (
    <AppLayout pageTitle="Transport Adda Setup">
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
                <Truck size={20} className="text-[#B08D57]" /> Transport Addas Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Search and manage delivery points / adda services for wholesale shipment routing.</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Adda
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search adda by name, code..."
                value={addaSearch}
                onChange={e => setAddaSearch(e.target.value)}
                className="soleria-input w-full py-2 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
              Total: {filteredAddas.length} Addas
            </div>
          </div>
        </div>

        {/* Addas Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<AddaRow>
            rows={filteredAddas}
            rowKey={adda => adda.adda_id}
            onRowClick={adda => handleOpenEditModal(adda)}
            emptyIcon={<Truck size={36} />}
            emptyMessage="No registered transport addas found matching your search."
            columns={[
              {
                key: 'code',
                header: 'Adda Code',
                width: '140px',
                render: adda => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">#{adda.adda_id}</span>
                ),
              },
              {
                key: 'name',
                header: 'Adda Name',
                render: adda => <span className="font-semibold text-slate-900">{adda.name}</span>,
              },
              {
                key: 'region',
                header: 'Region',
                render: adda => (
                  <span className="text-slate-600 font-medium">{adda.region_name || 'N/A'}</span>
                ),
              },
              {
                key: 'city',
                header: 'City',
                render: adda => (
                  <span className="text-slate-600 font-medium flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    {adda.city_name || 'N/A'}
                  </span>
                ),
              },
              {
                key: 'details',
                header: 'Details',
                render: adda => (
                  <span className="text-slate-500 text-xs">{adda.details || '—'}</span>
                ),
              },
            ]}
            actions={adda => (
              <>
                <button
                  onClick={() => handleOpenEditModal(adda)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit Adda"
                >
                  <Edit2 size={15} />
                </button>
              </>
            )}
          />
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedAddaId ? 'Edit Transport Adda' : 'Register New Transport Adda'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveAdda} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Transport Adda Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={addaName}
                    onChange={e => setAddaName(e.target.value)}
                    placeholder="e.g. Faisal Goods Transport, Badami Bagh Adda"
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
                      options={activeRegions.map(r => ({ value: String(r.region_id), label: r.name }))}
                      value={regionId}
                      onChange={setRegionId}
                      placeholder="Select Region..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      City Location
                    </label>
                    <SearchableSelect
                      options={[
                        { value: '', label: 'Select City (Optional)' },
                        ...activeCities.map(c => ({ value: String(c.city_id), label: c.name }))
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
                    <Save size={14} /> Save Adda
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="transport adda"
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
