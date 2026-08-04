import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import type { City } from '@/types';

export default function CitySetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [citySearch, setCitySearch] = useState('');

  // Editing state
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<City | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [cityName, setCityName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedCityId(null);
    setCityName('');
    setRegionId(state.regions[0]?.id || '');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectCity = (city: { id: string; name: string; regionId?: string }) => {
    setSelectedCityId(city.id);
    setCityName(city.name);
    setRegionId(city.regionId || '');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSaveCity = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = cityName.trim();
    if (!typed) {
      return setErrorMsg('City name is required.');
    }

    if (selectedCityId) {
      // Edit mode
      dispatch({
        type: 'UPDATE_CITY',
        city: { id: selectedCityId, name: typed, regionId: regionId || undefined }
      });
      setSuccessMsg('City details updated successfully.');
    } else {
      // Add mode - duplicate check
      const match = state.cities.find(c => c.name.toLowerCase() === typed.toLowerCase());
      if (match) {
        if (match.isActive !== false) {
          return setErrorMsg('A city with this name already exists.');
        } else {
          setDupMatch(match);
          setIsDupModalOpen(true);
          return;
        }
      }

      const newId = 'ct_' + Date.now();
      dispatch({
        type: 'ADD_CITY',
        city: { id: newId, name: typed, regionId: regionId || undefined }
      });
      setSuccessMsg('New city registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setCityName('');
    setRegionId('');
    setSelectedCityId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleActivateDuplicate = (id: string) => {
    const match = state.cities.find(c => c.id === id);
    if (match) {
      dispatch({
        type: 'UPDATE_CITY',
        city: { ...match, isActive: true, regionId: regionId || match.regionId }
      });
      setSuccessMsg('City reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    setCityName('');
    setRegionId('');
    setSelectedCityId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleDeleteCity = (id: string) => {
    // Check if city is used by any active customers
    const customerCount = state.customers.filter(c => c.cityId === id && c.isActive !== false).length;
    if (customerCount > 0) {
      alert(`Cannot delete this city. It is currently assigned to ${customerCount} registered customers.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this city?')) {
      dispatch({ type: 'DELETE_CITY', id });
      setSuccessMsg('City deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedCityId(null);
      setActiveTab('list');
    }
  };

  const filteredCities = useMemo(() => {
    const activeCities = state.cities.filter(c => c.isActive !== false);
    if (!citySearch.trim()) return activeCities;
    const q = citySearch.toLowerCase();
    return activeCities.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.id.toLowerCase().includes(q)
    );
  }, [state.cities, citySearch]);

  const activeRegions = useMemo(() => {
    return state.regions.filter(r => r.isActive !== false);
  }, [state.regions]);

  return (
    <AppLayout pageTitle="City Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Tab Selection Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => {
                setActiveTab('list');
                setSelectedCityId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Active Cities
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedCityId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New City
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Create City
            </button>
          )}
        </div>

        {/* View 1: Cities Directory List */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Cities Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage cities for customer regions and logistics assignments.</p>
              </div>
              
              <div className="relative min-w-[240px]">
                <input
                  type="text"
                  placeholder="Search by code, city name..."
                  value={citySearch}
                  onChange={e => setCitySearch(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
              </div>
            </div>

            {filteredCities.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                No registered cities found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCities.map(city => {
                  const customerCount = state.customers.filter(c => c.cityId === city.id && c.isActive !== false).length;
                  const initialLetter = city.name.charAt(0).toUpperCase();

                  return (
                    <div
                      key={city.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectCity(city)}
                    >
                      <div>
                        {/* Card Top: Code & Status badge */}
                        <div className="flex items-center justify-between mb-3.5">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                            CODE: {city.id}
                          </span>
                          <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider">
                            ACTIVE
                          </span>
                        </div>

                        {/* Card Middle: Avatar circle + Name */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {city.name}
                            </h4>
                            {city.regionId && (
                              <span className="inline-block text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 mt-1">
                                {state.regions.find(r => r.id === city.regionId)?.name || city.regionId}
                              </span>
                            )}
                            <p className="text-[11px] text-slate-400 font-medium mt-1 uppercase tracking-wider">
                              {customerCount} {customerCount === 1 ? 'CUSTOMER' : 'CUSTOMERS'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectCity(city)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit City"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteCity(city.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete City"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* View 2: Add New / Edit City Form */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-2 border-b pb-3 mb-6">
              <button
                onClick={() => {
                  setActiveTab('list');
                  setSelectedCityId(null);
                }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-[#111c2a]">
                  {selectedCityId ? `Edit City: ${cityName}` : 'Register New City'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Specify the name and parent region of the active city below.</p>
              </div>
            </div>

            <form onSubmit={handleSaveCity} className="flex flex-col gap-6">
              {/* City Details */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> City Configuration
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">City Name</label>
                    <input
                      type="text"
                      value={cityName}
                      onChange={e => setCityName(e.target.value)}
                      placeholder="e.g. Faisalabad, Rawalpindi"
                      className="soleria-input font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Region</label>
                    <select
                      value={regionId}
                      onChange={e => setRegionId(e.target.value)}
                      className="soleria-input font-semibold"
                    >
                      <option value="">Select Region (Optional)</option>
                      {activeRegions.map(r => (
                        <option key={r.id} value={r.id}>{r.name} ({r.id})</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex gap-3 justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedCityId(null);
                  }}
                  className="btn-outline px-5 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold px-6 py-2 flex items-center gap-1.5"
                >
                  <Save size={16} /> Save City Details
                </button>
              </div>
            </form>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="city"
          status="inactive"
          matches={dupMatch ? [{
            id: dupMatch.id,
            name: dupMatch.name,
            regionName: dupMatch.regionId ? state.regions.find(r => r.id === dupMatch.regionId)?.name : undefined
          }] : []}
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
