import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';

export default function RegionSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [regionSearch, setRegionSearch] = useState('');

  // Editing state
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  // Form State
  const [regionName, setRegionName] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedRegionId(null);
    setRegionName('');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectRegion = (region: { id: string; name: string }) => {
    setSelectedRegionId(region.id);
    setRegionName(region.name);
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSaveRegion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regionName.trim()) {
      return setErrorMsg('Region name is required.');
    }

    if (selectedRegionId) {
      // Edit mode
      dispatch({
        type: 'UPDATE_REGION',
        region: { id: selectedRegionId, name: regionName.trim() }
      });
      setSuccessMsg('Region details updated successfully.');
    } else {
      // Add mode
      const newId = 'rg_' + Date.now();
      dispatch({
        type: 'ADD_REGION',
        region: { id: newId, name: regionName.trim() }
      });
      setSuccessMsg('New region registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setRegionName('');
    setSelectedRegionId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleDeleteRegion = (id: string) => {
    const customerCount = state.customers.filter(c => c.regionId === id).length;
    if (customerCount > 0) {
      alert(`Cannot delete this region. It is currently assigned to ${customerCount} registered customers.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this region?')) {
      dispatch({ type: 'DELETE_REGION', id });
      setSuccessMsg('Region deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedRegionId(null);
      setActiveTab('list');
    }
  };

  const filteredRegions = useMemo(() => {
    if (!regionSearch.trim()) return state.regions;
    const q = regionSearch.toLowerCase();
    return state.regions.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q)
    );
  }, [state.regions, regionSearch]);

  return (
    <AppLayout pageTitle="Region Setup">
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
                setSelectedRegionId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Active Regions
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedRegionId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Region
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Create Region
            </button>
          )}
        </div>

        {/* View 1: Regions Directory List */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Regions Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage regions used for primary customer identification (checked before City).</p>
              </div>

              <div className="relative min-w-[240px]">
                <input
                  type="text"
                  placeholder="Search by code, region name..."
                  value={regionSearch}
                  onChange={e => setRegionSearch(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
              </div>
            </div>

            {filteredRegions.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                No registered regions found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRegions.map(region => {
                  const initialLetter = region.name.charAt(0).toUpperCase();

                  return (
                    <div
                      key={region.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectRegion(region)}
                    >
                      <div>
                        {/* Card Top: Code & Status badge */}
                        <div className="flex items-center justify-between mb-3.5">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                            CODE: {region.id}
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
                              {region.name}
                            </h4>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectRegion(region)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Region"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteRegion(region.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Region"
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
          /* View 2: Add New / Edit Region Form */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-2 border-b pb-3 mb-6">
              <button
                onClick={() => {
                  setActiveTab('list');
                  setSelectedRegionId(null);
                }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-[#111c2a]">
                  {selectedRegionId ? `Edit Region: ${regionName}` : 'Register New Region'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Specify the name of the active region below.</p>
              </div>
            </div>

            <form onSubmit={handleSaveRegion} className="flex flex-col gap-6">
              {/* Region Details */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Region Configuration
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Region Name</label>
                    <input
                      type="text"
                      value={regionName}
                      onChange={e => setRegionName(e.target.value)}
                      placeholder="e.g. NORTH, SOUTH, LOCAL"
                      className="soleria-input font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex gap-3 justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedRegionId(null);
                  }}
                  className="btn-outline px-5 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold px-6 py-2 flex items-center gap-1.5"
                >
                  <Save size={16} /> Save Region Details
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
