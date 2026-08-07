import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, X, Building2, MapPin } from 'lucide-react';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import { cities as citiesApi, listRegions, type CityRow, type RegionRow } from '@/lib/api';

export default function CitySetupPage() {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [citySearch, setCitySearch] = useState('');

  // Modal State
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
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
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
    handleCloseModal();
  };

  const handleDeleteCity = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this city?')) return;
    const res = await citiesApi.remove(id);
    if (!res.ok) {
      alert(res.error.message);
      return;
    }
    setSuccessMsg('City deleted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
    await loadData();
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

        {/* Cities Cards Grid (§1 Standard) */}
        {filteredCities.length === 0 ? (
          <div className="card-white p-12 text-center text-slate-400">
            <Building2 size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600">No registered cities found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCities.map(city => {
              const regionName = city.region_name || 'No Region';

              return (
                <div
                  key={city.city_id}
                  onClick={() => handleOpenEditModal(city)}
                  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                >
                  <div>
                    {/* Header: Title + Region Badge */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                        {city.name}
                      </h4>
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                        <MapPin size={10} className="text-slate-400" />
                        {regionName}
                      </span>
                    </div>

                    {/* Subtitle: Code in mono */}
                    <div className="font-mono text-xs text-slate-400 mb-3">
                      City Code: <span className="font-semibold text-slate-600">#{city.city_id}</span>
                    </div>
                  </div>

                  {/* Footer Bar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditModal(city)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                        title="Edit City"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteCity(city.city_id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete City"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                      Edit City &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
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
