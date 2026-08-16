import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, X, Building2, MapPin } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import { cities as citiesApi, listRegions, type CityRow, type RegionRow } from '@/lib/api';

export default function CitySetupPage() {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [citySearch, setCitySearch] = useState('');

  // Modal State
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [cityName, setCityName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const [cRes, rRes] = await Promise.all([
      citiesApi.list({ includeInactive: true }),
      listRegions(),
    ]);
    if (cRes.ok) setCities(cRes.data);
    if (rRes.ok) setRegions(rRes.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenAddModal = () => {
    setSelectedCityId(null);
    setCityName('');
    setRegionId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (city: CityRow) => {
    setSelectedCityId(city.city_id);
    setCityName(city.name);
    setRegionId(city.region_id ? String(city.region_id) : '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCityId(null);
    setCityName('');
    setRegionId('');
    setErrorMsg('');
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next city —
  // instead of closing.
  const resetForNextCity = () => {
    setSelectedCityId(null);
    setCityName('');
    setRegionId('');
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const handleSaveCity = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = cityName.trim();
    if (!typed) {
      return setErrorMsg('City name is required.');
    }

    const payload = { name: typed, region_id: regionId ? Number(regionId) : undefined };

    if (selectedCityId) {
      const res = await citiesApi.update(selectedCityId, payload);
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('City details updated successfully.');
      await loadData();
      handleCloseModal();
    } else {
      const res = await citiesApi.create(payload);
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE') {
          const details = res.error.details as { city_id: number; name: string } | undefined;
          setDupMatch(details ? { id: String(details.city_id), name: details.name } : null);
          setIsDupModalOpen(true);
          return;
        }
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('New city registered successfully.');
      await loadData();
      resetForNextCity();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleActivateDuplicate = async (id: string) => {
    const res = await citiesApi.reactivate(Number(id));
    if (res.ok) {
      setSuccessMsg('City reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadData();
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    resetForNextCity();
  };



  const filteredCities = useMemo(() => {
    const activeCities = cities.filter(c => c.is_active);
    if (!citySearch.trim()) return activeCities;
    const q = citySearch.toLowerCase();
    return activeCities.filter(c =>
      c.name.toLowerCase().includes(q) ||
      String(c.city_id).includes(q)
    );
  }, [cities, citySearch]);

  const activeRegions = useMemo(() => regions.filter(r => r.is_active), [regions]);

  return (
    <AppLayout pageTitle="City Setup">
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
                <Building2 size={20} className="text-[#B08D57]" /> Cities Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Search and manage cities for customer regions and logistics assignments.</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Create City
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search by code, city name..."
                value={citySearch}
                onChange={e => setCitySearch(e.target.value)}
                className="soleria-input w-full py-2 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
              Total: {filteredCities.length} Cities
            </div>
          </div>
        </div>

        {/* Cities Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<CityRow>
            rows={filteredCities}
            rowKey={city => city.city_id}
            onRowClick={city => handleOpenEditModal(city)}
            emptyIcon={<Building2 size={36} />}
            emptyMessage="No registered cities found matching your search."
            columns={[
              {
                key: 'code',
                header: 'City Code',
                width: '140px',
                render: city => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">#{city.city_id}</span>
                ),
              },
              {
                key: 'name',
                header: 'City Name',
                render: city => <span className="font-semibold text-slate-900">{city.name}</span>,
              },
              {
                key: 'region',
                header: 'Region',
                render: city => (
                  <span className="text-slate-600 font-medium flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    {city.region_name || 'No Region'}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                align: 'center',
                render: () => (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border bg-emerald-50 text-emerald-700 border-emerald-200">
                    Active
                  </span>
                ),
              },
            ]}
            actions={city => (
              <>
                <button
                  onClick={() => handleOpenEditModal(city)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit City"
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
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedCityId ? 'Edit City Details' : 'Register New City'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveCity} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    City Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={cityName}
                    onChange={e => setCityName(e.target.value)}
                    placeholder="e.g. Lahore, Faisalabad, Karachi"
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Assigned Region
                  </label>
                  <SearchableSelect
                    options={[
                      { value: '', label: 'Select Region (Optional)' },
                      ...activeRegions.map(r => ({ value: String(r.region_id), label: r.name }))
                    ]}
                    value={regionId}
                    onChange={setRegionId}
                    placeholder="Select Region..."
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
                    <Save size={14} /> Save City
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="city"
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
