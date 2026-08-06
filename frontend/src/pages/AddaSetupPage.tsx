import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, X, Truck, MapPin } from 'lucide-react';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import type { Adda } from '@/types';

export default function AddaSetupPage() {
  const { state, dispatch } = useApp();

  const [addaSearch, setAddaSearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAddaId, setSelectedAddaId] = useState<string | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<Adda | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [addaName, setAddaName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleOpenAddModal = () => {
    setSelectedAddaId(null);
    setAddaName('');
    setRegionId(state.regions[0]?.id || '');
    setCityId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (adda: { id: string; name: string; regionId?: string; cityId: string }) => {
    setSelectedAddaId(adda.id);
    setAddaName(adda.name);
    setRegionId(adda.regionId || '');
    setCityId(adda.cityId || '');
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

  const handleSaveAdda = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = addaName.trim();
    if (!typed) {
      return setErrorMsg('Adda name is required.');
    }
    if (!cityId) {
      return setErrorMsg('City selection is required.');
    }

    if (selectedAddaId) {
      dispatch({
        type: 'UPDATE_ADDA',
        adda: {
          id: selectedAddaId,
          name: typed,
          regionId: regionId || undefined,
          cityId: cityId
        }
      });
      setSuccessMsg('Adda details updated successfully.');
    } else {
      const match = state.addas.find(a => a.name.toLowerCase() === typed.toLowerCase());
      if (match) {
        if (match.isActive !== false) {
          return setErrorMsg('An adda with this name already exists.');
        } else {
          setDupMatch(match);
          setIsDupModalOpen(true);
          return;
        }
      }

      const newId = 'ad_' + Date.now();
      dispatch({
        type: 'ADD_ADDA',
        adda: {
          id: newId,
          name: typed,
          regionId: regionId || undefined,
          cityId: cityId
        }
      });
      setSuccessMsg('New Transport Adda registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleActivateDuplicate = (id: string) => {
    const match = state.addas.find(a => a.id === id);
    if (match) {
      dispatch({
        type: 'UPDATE_ADDA',
        adda: {
          ...match,
          isActive: true,
          regionId: regionId || match.regionId,
          cityId: cityId || match.cityId
        }
      });
      setSuccessMsg('Transport Adda reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    handleCloseModal();
  };

  const handleDeleteAdda = (id: string) => {
    const billCount = state.saleBills.filter(b => b.addaId === id).length;
    if (billCount > 0) {
      alert(`Cannot delete this Adda. It is currently assigned to ${billCount} registered sale bills.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Transport Adda?')) {
      dispatch({ type: 'DELETE_ADDA', id });
      setSuccessMsg('Transport Adda deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      handleCloseModal();
    }
  };

  const filteredAddas = useMemo(() => {
    const activeAddas = state.addas.filter(a => a.isActive !== false);
    if (!addaSearch.trim()) return activeAddas;
    const q = addaSearch.toLowerCase();
    return activeAddas.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  }, [state.addas, addaSearch]);

  const activeRegions = useMemo(() => {
    return state.regions.filter(r => r.isActive !== false);
  }, [state.regions]);

  const activeCities = useMemo(() => {
    return state.cities.filter(c => c.isActive !== false);
  }, [state.cities]);

  return (
    <AppLayout pageTitle="Transport Adda Setup">
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

        {/* Addas Cards Grid (§1 Standard) */}
        {filteredAddas.length === 0 ? (
          <div className="card-white p-12 text-center text-slate-400">
            <Truck size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600">No registered transport addas found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAddas.map(adda => {
              const cityName = activeCities.find(c => c.id === adda.cityId)?.name || 'N/A';
              const regionName = activeRegions.find(r => r.id === adda.regionId)?.name || 'N/A';

              return (
                <div
                  key={adda.id}
                  onClick={() => handleOpenEditModal(adda)}
                  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                >
                  <div>
                    {/* Header: Title + City Badge */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                        {adda.name}
                      </h4>
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                        <MapPin size={10} className="text-slate-400" />
                        {cityName}
                      </span>
                    </div>

                    {/* Subtitle: Code in mono */}
                    <div className="font-mono text-xs text-slate-400 mb-3">
                      Adda Code: <span className="font-semibold text-slate-600">#{adda.id}</span>
                    </div>

                    <div className="text-xs text-slate-500 font-medium border-t border-slate-100 pt-2.5">
                      Region: <span className="font-semibold text-slate-700">{regionName}</span>
                    </div>
                  </div>

                  {/* Footer Bar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditModal(adda)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                        title="Edit Adda"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteAdda(adda.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Adda"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                      Edit Adda &rarr;
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
                      Region
                    </label>
                    <SearchableSelect
                      options={[
                        { value: '', label: 'Select Region (Optional)' },
                        ...activeRegions.map(r => ({ value: r.id, label: r.name }))
                      ]}
                      value={regionId}
                      onChange={setRegionId}
                      placeholder="Select Region..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      City Location <span className="text-rose-500">*</span>
                    </label>
                    <SearchableSelect
                      options={activeCities.map(c => ({ value: c.id, label: c.name }))}
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
          matches={dupMatch ? [{ id: dupMatch.id, name: dupMatch.name }] : []}
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
