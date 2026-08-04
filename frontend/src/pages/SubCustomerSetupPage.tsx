import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import type { SubCustomer } from '@/types';

export default function SubCustomerSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');

  // Editing state
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  // Duplicate Check Modal state (Flow B)
  const [dupMatches, setDupMatches] = useState<SubCustomer[]>([]);
  const [dupStatus, setDupStatus] = useState<'active' | 'inactive'>('active');
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [pendingSubCustomer, setPendingSubCustomer] = useState<{ name: string; regionId: string; cityId: string } | null>(null);

  // Form State
  const [subName, setSubName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedSubId(null);
    setSubName('');
    setRegionId(state.regions.find(r => r.isActive !== false)?.id || '');
    setCityId('');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectSubCustomer = (sub: { id: string; name: string; regionId: string; cityId: string }) => {
    setSelectedSubId(sub.id);
    setSubName(sub.name);
    setRegionId(sub.regionId);
    setCityId(sub.cityId);
    setErrorMsg('');
    setActiveTab('form');
  };

  const executeAddSubCustomer = (data: { name: string; regionId: string; cityId: string }) => {
    const newId = 'sub_' + Date.now();
    dispatch({
      type: 'ADD_SUB_CUSTOMER',
      subCust: {
        id: newId,
        name: data.name,
        regionId: data.regionId,
        cityId: data.cityId
      }
    });
    setSuccessMsg('New Sub Customer registered successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setSubName('');
    setRegionId('');
    setCityId('');
    setSelectedSubId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleSaveSubCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = subName.trim();
    if (!typed) return setErrorMsg('Please enter a Sub Customer name.');
    if (!regionId) return setErrorMsg('Region selection is required.');
    if (!cityId) return setErrorMsg('City selection is required.');

    if (selectedSubId) {
      dispatch({
        type: 'UPDATE_SUB_CUSTOMER',
        subCust: {
          id: selectedSubId,
          name: typed,
          regionId: regionId,
          cityId: cityId
        }
      });
      setSuccessMsg('Sub Customer details updated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSubName('');
      setRegionId('');
      setCityId('');
      setSelectedSubId(null);
      setErrorMsg('');
      setActiveTab('list');
    } else {
      // Flow B duplicate check
      const matches = state.subCustomers.filter(sc => sc.name.toLowerCase() === typed.toLowerCase());
      if (matches.length === 0) {
        executeAddSubCustomer({ name: typed, regionId, cityId });
      } else {
        const hasInactive = matches.some(sc => sc.isActive === false);
        const modalMatches = hasInactive ? matches.filter(sc => sc.isActive === false) : matches;
        setDupMatches(modalMatches);
        setDupStatus(hasInactive ? 'inactive' : 'active');
        setPendingSubCustomer({ name: typed, regionId, cityId });
        setIsDupModalOpen(true);
      }
    }
  };

  const handleActivateDuplicate = (id: string) => {
    const match = state.subCustomers.find(sc => sc.id === id);
    if (match) {
      dispatch({
        type: 'UPDATE_SUB_CUSTOMER',
        subCust: { ...match, isActive: true }
      });
      setSuccessMsg('Sub Customer reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    setIsDupModalOpen(false);
    setDupMatches([]);
    setPendingSubCustomer(null);
    setSubName('');
    setRegionId('');
    setCityId('');
    setSelectedSubId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleCreateNewAnyway = () => {
    if (pendingSubCustomer) {
      executeAddSubCustomer(pendingSubCustomer);
    }
    setIsDupModalOpen(false);
    setDupMatches([]);
    setPendingSubCustomer(null);
  };

  const handleDeleteSubCustomer = (id: string) => {
    if (window.confirm('Are you sure you want to delete this Sub Customer?')) {
      dispatch({ type: 'DELETE_SUB_CUSTOMER', id });
      setSuccessMsg('Sub Customer deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedSubId(null);
      setActiveTab('list');
    }
  };

  const activeSubCustomers = useMemo(() => {
    return state.subCustomers.filter(sc => sc.isActive !== false);
  }, [state.subCustomers]);

  const filteredSubCustomers = useMemo(() => {
    if (!searchQuery.trim()) return activeSubCustomers;
    const q = searchQuery.toLowerCase();
    return activeSubCustomers.filter(sc =>
      sc.name.toLowerCase().includes(q) ||
      sc.id.toLowerCase().includes(q)
    );
  }, [activeSubCustomers, searchQuery]);

  const activeRegions = useMemo(() => {
    return state.regions.filter(r => r.isActive !== false);
  }, [state.regions]);

  const activeCities = useMemo(() => {
    return state.cities.filter(c => c.isActive !== false);
  }, [state.cities]);

  return (
    <AppLayout pageTitle="Sub Customer Setup">
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
                setSelectedSubId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Sub Customers Directory
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedSubId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Sub Customer
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Sub Customer
            </button>
          )}
        </div>

        {/* View 1: Sub Customers Directory List */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Sub Customers Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage sub customers/delivery agents (independent, no parent account link).</p>
              </div>

              <div className="relative min-w-[265px]">
                <input
                  type="text"
                  placeholder="Search by name or code..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
              </div>
            </div>

            {filteredSubCustomers.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                No registered sub customers found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSubCustomers.map(sub => {
                  const initialLetter = sub.name.charAt(0).toUpperCase();

                  return (
                    <div
                      key={sub.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectSubCustomer(sub)}
                    >
                      <div>
                        {/* Card Top: Code badge */}
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider flex-shrink-0">
                            CODE: {sub.id}
                          </span>
                        </div>

                        {/* Card Middle: Avatar circle + Name */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {sub.name}
                            </h4>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {sub.regionId && (
                                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                  {state.regions.find(r => r.id === sub.regionId)?.name || sub.regionId}
                                </span>
                              )}
                              {sub.cityId && (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                                  {state.cities.find(c => c.id === sub.cityId)?.name || sub.cityId}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectSubCustomer(sub)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Sub Customer"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteSubCustomer(sub.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Sub Customer"
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
          /* View 2: Add New / Edit Sub Customer Form */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-2 border-b pb-3 mb-6">
              <button
                onClick={() => {
                  setActiveTab('list');
                  setSelectedSubId(null);
                }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-[#111c2a]">
                  {selectedSubId ? `Edit Sub Customer: ${subName}` : 'Register New Sub Customer'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Register an independent sub customer agent or sub destination account with regional parameters.</p>
              </div>
            </div>

            <form onSubmit={handleSaveSubCustomer} className="flex flex-col gap-6">
              {/* Setup Configuration */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Sub Customer Details
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Sub Customer Name</label>
                    <input
                      type="text"
                      value={subName}
                      onChange={e => setSubName(e.target.value)}
                      placeholder="e.g. Salim Agent LHR"
                      className="soleria-input font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Region <span className="text-red-500 font-bold">*</span></label>
                      <select
                        value={regionId}
                        onChange={e => {
                          setRegionId(e.target.value);
                          setCityId('');
                        }}
                        className="soleria-input font-semibold"
                        required
                      >
                        <option value="">Select Region...</option>
                        {activeRegions.map(r => (
                          <option key={r.id} value={r.id}>{r.name} ({r.id})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">City <span className="text-red-500 font-bold">*</span></label>
                      <select
                        value={cityId}
                        onChange={e => setCityId(e.target.value)}
                        className="soleria-input font-semibold"
                        required
                      >
                        <option value="">Select City...</option>
                        {activeCities
                          .filter(c => !regionId || c.regionId === regionId)
                          .map(c => (
                            <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                          ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex gap-3 justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedSubId(null);
                  }}
                  className="btn-outline px-5 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold px-6 py-2 flex items-center gap-1.5"
                >
                  <Save size={16} /> Save Sub Customer Details
                </button>
              </div>
            </form>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="sub-customer"
          status={dupStatus}
          matches={dupMatches.map(m => ({
            id: m.id,
            name: m.name,
            regionName: state.regions.find(r => r.id === m.regionId)?.name,
            cityName: state.cities.find(c => c.id === m.cityId)?.name
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
