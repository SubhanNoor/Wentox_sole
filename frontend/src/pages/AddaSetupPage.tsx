import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';

export default function AddaSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [addaSearch, setAddaSearch] = useState('');

  // Editing state
  const [selectedAddaId, setSelectedAddaId] = useState<string | null>(null);

  // Form State
  const [addaName, setAddaName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedAddaId(null);
    setAddaName('');
    setRegionId(state.regions[0]?.id || '');
    setCityId('');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectAdda = (adda: { id: string; name: string; regionId?: string; cityId: string }) => {
    setSelectedAddaId(adda.id);
    setAddaName(adda.name);
    setRegionId(adda.regionId || '');
    setCityId(adda.cityId || '');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSaveAdda = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addaName.trim()) {
      return setErrorMsg('Adda name is required.');
    }
    if (!cityId) {
      return setErrorMsg('City selection is required.');
    }

    if (selectedAddaId) {
      // Edit mode
      dispatch({
        type: 'UPDATE_ADDA',
        adda: {
          id: selectedAddaId,
          name: addaName.trim(),
          regionId: regionId || undefined,
          cityId: cityId
        }
      });
      setSuccessMsg('Adda details updated successfully.');
    } else {
      // Add mode
      const newId = 'ad_' + Date.now();
      dispatch({
        type: 'ADD_ADDA',
        adda: {
          id: newId,
          name: addaName.trim(),
          regionId: regionId || undefined,
          cityId: cityId
        }
      });
      setSuccessMsg('New Transport Adda registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setAddaName('');
    setRegionId('');
    setCityId('');
    setSelectedAddaId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleDeleteAdda = (id: string) => {
    // Check if adda is used by any sale bills
    const billCount = state.saleBills.filter(b => b.addaId === id).length;
    if (billCount > 0) {
      alert(`Cannot delete this Adda. It is currently assigned to ${billCount} registered sale bills.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Transport Adda?')) {
      dispatch({ type: 'DELETE_ADDA', id });
      setSuccessMsg('Transport Adda deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedAddaId(null);
      setActiveTab('list');
    }
  };

  const filteredAddas = useMemo(() => {
    if (!addaSearch.trim()) return state.addas;
    const q = addaSearch.toLowerCase();
    return state.addas.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  }, [state.addas, addaSearch]);

  return (
    <AppLayout pageTitle="Transport Adda Setup">
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
                setSelectedAddaId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list'
                  ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              Addas Directory
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedAddaId
                  ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              Add New Adda
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Adda
            </button>
          )}
        </div>

        {/* View 1: List view */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Transport Addas</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage delivery points / adda services for wholesale shipment routing.</p>
              </div>

              {/* Search Bar */}
              <div className="relative flex-1 min-w-[270px] sm:max-w-sm">
                <input
                  type="text"
                  placeholder="Search adda by name..."
                  value={addaSearch}
                  onChange={e => setAddaSearch(e.target.value)}
                  className="soleria-input w-full py-2 px-3.5 text-sm pr-10 font-semibold bg-white shadow-sm hover:border-[#B08D57] transition-all"
                />
                <Search className="absolute right-3.5 top-2.5 text-slate-400" size={16} />
              </div>
            </div>

            {filteredAddas.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl bg-white">
                No transport addas found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAddas.map(adda => {
                  const initialLetter = adda.name.charAt(0).toUpperCase();

                  return (
                    <div
                      key={adda.id}
                      className="bg-white border rounded-xl p-5 hover:border-[#B08D57] hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectAdda(adda)}
                    >
                      <div>
                        {/* Card Top: Code */}
                        <div className="flex items-center justify-between mb-3.5">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                            CODE: {adda.id}
                          </span>
                        </div>

                        {/* Card Middle: Avatar circle + Name */}
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {adda.name}
                            </h4>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {adda.regionId && (
                                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                  {state.regions.find(r => r.id === adda.regionId)?.name || adda.regionId}
                                </span>
                              )}
                              {adda.cityId && (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                                  {state.cities.find(c => c.id === adda.cityId)?.name || adda.cityId}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-3 flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectAdda(adda)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Adda"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteAdda(adda.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Adda"
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
          /* View 2: Form view */
          <div className="max-w-2xl mx-auto">
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm">
              <div className="flex items-center gap-3 border-b pb-4 mb-6">
                <button
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedAddaId(null);
                  }}
                  className="p-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft size={16} className="text-slate-600" />
                </button>
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">
                    {selectedAddaId ? 'Edit Transport Adda' : 'Register New Transport Adda'}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium font-inter">Configure delivery points and location parameters for wholesale shipment routing.</p>
                </div>
              </div>

              <form onSubmit={handleSaveAdda} className="flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-2">
                  <Settings size={15} className="text-[#B08D57]" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-inter">Adda Parameters</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 font-inter">Transport Adda Name</label>
                  <input
                    type="text"
                    value={addaName}
                    onChange={e => setAddaName(e.target.value)}
                    placeholder="e.g. Multan Adda Service, Faisalabad Goods"
                    className="soleria-input font-semibold"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 font-inter">Region</label>
                    <select
                      value={regionId}
                      onChange={e => {
                        setRegionId(e.target.value);
                        setCityId('');
                      }}
                      className="soleria-input font-semibold"
                    >
                      <option value="">Select Region (Optional)</option>
                      {state.regions.map(r => (
                        <option key={r.id} value={r.id}>{r.name} ({r.id})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 font-inter">City</label>
                    <select
                      value={cityId}
                      onChange={e => setCityId(e.target.value)}
                      className="soleria-input font-semibold"
                    >
                      <option value="">Select City</option>
                      {state.cities
                        .filter(c => !regionId || c.regionId === regionId)
                        .map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('list');
                      setSelectedAddaId(null);
                    }}
                    className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors uppercase tracking-wider font-inter"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold flex items-center gap-1.5 px-6 py-2.5 text-xs font-bold text-slate-900 uppercase tracking-wider font-inter"
                  >
                    <Save size={14} /> Save Adda
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
