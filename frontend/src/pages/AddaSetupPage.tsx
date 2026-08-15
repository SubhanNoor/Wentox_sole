import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, X, Truck, MapPin } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import { addas as addasApi, listCities, type AddaRow, type CityRow } from '@/lib/api';

export default function AddaSetupPage() {
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [addaSearch, setAddaSearch] = useState('');

  // Modal State
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAddaId, setSelectedAddaId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [addaName, setAddaName] = useState('');
  // AD-01: Route — every city (from Cities setup) this adda serves, checklist-style.
  const [routeCityIds, setRouteCityIds] = useState<number[]>([]);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const [aRes, cRes] = await Promise.all([
      addasApi.list({ includeInactive: true }),
      listCities(),
    ]);
    if (aRes.ok) setAddas(aRes.data);
    if (cRes.ok) setCities(cRes.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleRouteCity = (cityId: number) => {
    setRouteCityIds(prev => prev.includes(cityId) ? prev.filter(id => id !== cityId) : [...prev, cityId]);
  };

  const handleOpenAddModal = () => {
    setSelectedAddaId(null);
    setAddaName('');
    setRouteCityIds([]);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (adda: AddaRow) => {
    setSelectedAddaId(adda.adda_id);
    setAddaName(adda.name);
    setRouteCityIds(adda.route_city_ids);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedAddaId(null);
    setAddaName('');
    setRouteCityIds([]);
    setErrorMsg('');
  };

  const handleSaveAdda = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = addaName.trim();
    if (!typed) {
      return setErrorMsg('Adda name is required.');
    }
    if (routeCityIds.length === 0) {
      return setErrorMsg('Select at least one city for this adda\'s route.');
    }

    const payload = {
      name: typed,
      city_ids: routeCityIds,
    };

    if (selectedAddaId) {
      const res = await addasApi.update(selectedAddaId, payload);
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Adda details updated successfully.');
      await loadData();
      handleCloseModal();
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
      resetForNextAdda();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next adda —
  // instead of closing.
  const resetForNextAdda = () => {
    setSelectedAddaId(null);
    setAddaName('');
    setRouteCityIds([]);
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
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
    resetForNextAdda();
  };

  // AD-02: searching an adda's own name works as before; searching a city/route name now also
  // matches — "search a route, see every adda serving it" — since route_city_names already
  // carries every city this adda serves as one comma-joined string.
  const filteredAddas = useMemo(() => {
    const activeAddas = addas.filter(a => a.is_active);
    if (!addaSearch.trim()) return activeAddas;
    const q = addaSearch.toLowerCase();
    return activeAddas.filter(a =>
      a.name.toLowerCase().includes(q) ||
      String(a.adda_id).includes(q) ||
      a.route_city_names.toLowerCase().includes(q)
    );
  }, [addas, addaSearch]);

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
                placeholder="Search adda by name, code, or route city..."
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
                key: 'route',
                header: 'Route',
                render: adda => (
                  <span className="text-slate-600 font-medium flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400 shrink-0" />
                    {adda.route_city_names || <span className="text-slate-400 italic">No route set</span>}
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
                    ref={nameInputRef}
                    type="text"
                    value={addaName}
                    onChange={e => setAddaName(e.target.value)}
                    placeholder="e.g. Faisal Goods Transport, Badami Bagh Adda"
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
                </div>

                {/* AD-01: Route — check every city (from Cities setup) this adda serves. */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Route (Cities Served) <span className="text-rose-500">*</span>
                  </label>
                  {activeCities.length === 0 ? (
                    <div className="soleria-input text-slate-400 text-sm flex items-center">
                      No cities set up yet — add one under City Creation first.
                    </div>
                  ) : (
                    <div className="border rounded-xl max-h-48 overflow-y-auto p-2 grid grid-cols-2 sm:grid-cols-3 gap-1" style={{ borderColor: 'var(--border-color)' }}>
                      {activeCities.map(c => (
                        <label
                          key={c.city_id}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs font-medium text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={routeCityIds.includes(c.city_id)}
                            onChange={() => toggleRouteCity(c.city_id)}
                            className="rounded border-slate-300"
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  )}
                  {routeCityIds.length > 0 && (
                    <p className="text-[10px] text-slate-400 mt-1">{routeCityIds.length} {routeCityIds.length === 1 ? 'city' : 'cities'} selected</p>
                  )}
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
