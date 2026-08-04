import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2, Warehouse } from 'lucide-react';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import type { Store } from '@/types';

export default function StoreSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');

  // Editing state
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<Store | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [storeName, setStoreName] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedStoreId(null);
    setStoreName('');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectStore = (store: { id: string; name: string }) => {
    setSelectedStoreId(store.id);
    setStoreName(store.name);
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = storeName.trim();
    if (!typed) return setErrorMsg('Please enter a Store name.');

    if (selectedStoreId) {
      // Edit mode
      dispatch({
        type: 'UPDATE_STORE',
        store: {
          id: selectedStoreId,
          name: typed
        }
      });
      setSuccessMsg('Store details updated successfully.');
    } else {
      // Add mode - Flow A duplicate check
      const match = state.stores.find(s => s.name.toLowerCase() === typed.toLowerCase());
      if (match) {
        if (match.isActive !== false) {
          return setErrorMsg('A store with this name already exists.');
        } else {
          setDupMatch(match);
          setIsDupModalOpen(true);
          return;
        }
      }

      // Add mode - auto generate Store ID
      const newId = 'st_' + Date.now();
      dispatch({
        type: 'ADD_STORE',
        store: {
          id: newId,
          name: typed
        }
      });
      setSuccessMsg('New Store registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setStoreName('');
    setSelectedStoreId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleActivateDuplicate = (id: string) => {
    const match = state.stores.find(s => s.id === id);
    if (match) {
      dispatch({
        type: 'UPDATE_STORE',
        store: { ...match, isActive: true }
      });
      setSuccessMsg('Store reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    setStoreName('');
    setSelectedStoreId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleDeleteStore = (id: string) => {
    // Check if store is used in sale bills
    const billCount = state.saleBills.filter(b => b.storeId === id).length;
    if (billCount > 0) {
      alert(`Cannot delete this Store. It is currently linked to ${billCount} sale bills.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Store?')) {
      dispatch({ type: 'DELETE_STORE', id });
      setSuccessMsg('Store deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedStoreId(null);
      setActiveTab('list');
    }
  };

  const filteredStores = useMemo(() => {
    const activeStores = state.stores.filter(s => s.isActive !== false);
    if (!searchQuery.trim()) return activeStores;
    const q = searchQuery.toLowerCase();
    return activeStores.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  }, [state.stores, searchQuery]);

  return (
    <AppLayout pageTitle="Store Setup">
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
                setSelectedStoreId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Active Stores
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedStoreId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Store
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Store
            </button>
          )}
        </div>

        {/* View 1: Directory List */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Stores Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Manage warehouse inventory stores and branches.</p>
              </div>
              
              <div className="relative min-w-[240px]">
                <input
                  type="text"
                  placeholder="Search by store name or ID..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
              </div>
            </div>

            {filteredStores.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                No registered stores found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStores.map(store => {
                  const billCount = state.saleBills.filter(b => b.storeId === store.id).length;

                  return (
                    <div
                      key={store.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectStore(store)}
                    >
                      <div>
                        {/* Card Top */}
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider flex-shrink-0">
                            AUTO CODE: {store.id}
                          </span>
                          <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider">
                            ACTIVE
                          </span>
                        </div>

                        {/* Card Middle */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-amber-50 text-amber-900 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            <Warehouse size={18} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {store.name}
                            </h4>
                            <p className="text-[11px] text-slate-400 font-medium mt-1.5 uppercase tracking-wider">
                              {billCount} {billCount === 1 ? 'BILL LINKED' : 'BILLS LINKED'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectStore(store)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Store"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteStore(store.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Store"
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
          /* View 2: Add New / Edit Store Form */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-2 border-b pb-3 mb-6">
              <button
                onClick={() => {
                  setActiveTab('list');
                  setSelectedStoreId(null);
                }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-[#111c2a]">
                  {selectedStoreId ? `Edit Store: ${storeName}` : 'Register New Store'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Store code is auto-generated by the system.</p>
              </div>
            </div>

            <form onSubmit={handleSaveStore} className="flex flex-col gap-6">
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Store Configuration
                </div>
                <div className="flex flex-col gap-4">
                  {selectedStoreId && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Auto-Generated Store Code</label>
                      <input
                        type="text"
                        value={selectedStoreId}
                        disabled
                        className="soleria-input font-semibold bg-slate-200 text-slate-500 cursor-not-allowed"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Store Name</label>
                    <input
                      type="text"
                      value={storeName}
                      onChange={e => setStoreName(e.target.value)}
                      placeholder="e.g. MAIN STORE LHR, GODOWN B"
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
                    setSelectedStoreId(null);
                  }}
                  className="btn-outline px-5 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold px-6 py-2 flex items-center gap-1.5"
                >
                  <Save size={16} /> Save Store Details
                </button>
              </div>
            </form>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="store"
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
