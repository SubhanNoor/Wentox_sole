import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, X, Users, MapPin } from 'lucide-react';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';
import type { SubCustomer } from '@/types';

export default function SubCustomerSetupPage() {
  const { state, dispatch } = useApp();

  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  const handleOpenAddModal = () => {
    setSelectedSubId(null);
    setSubName('');
    setRegionId(state.regions.find(r => r.isActive !== false)?.id || '');
    setCityId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (sub: { id: string; name: string; regionId: string; cityId: string }) => {
    setSelectedSubId(sub.id);
    setSubName(sub.name);
    setRegionId(sub.regionId);
    setCityId(sub.cityId);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSubId(null);
    setSubName('');
    setRegionId('');
    setCityId('');
    setErrorMsg('');
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
    handleCloseModal();
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
      handleCloseModal();
    } else {
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
    handleCloseModal();
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
      handleCloseModal();
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
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Directory Card */}
        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="border-b pb-4 mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                <Users size={20} className="text-[#B08D57]" /> Sub Customers Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Manage sub-customers associated with primary accounts for specialized bill dispatch.</p>
            </div>
            
            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Sub Customer
            </button>
          </div>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                placeholder="Search sub customer name or ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3 top-2 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
              Total: {filteredSubCustomers.length} Sub Customers
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">ID Code</th>
                  <th className="p-3">Sub Customer Name</th>
                  <th className="p-3">Region</th>
                  <th className="p-3">City</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center p-8 text-slate-400">
                      No registered sub customers found.
                    </td>
                  </tr>
                ) : (
                  filteredSubCustomers.map(sc => {
                    const regName = activeRegions.find(r => r.id === sc.regionId)?.name || 'N/A';
                    const cityName = activeCities.find(c => c.id === sc.cityId)?.name || 'N/A';
                    return (
                      <tr key={sc.id} className="border-b hover:bg-slate-50/50 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono font-semibold text-slate-500 text-xs">{sc.id}</td>
                        <td className="p-3 font-semibold text-slate-900">{sc.name}</td>
                        <td className="p-3 text-slate-600 font-medium">{regName}</td>
                        <td className="p-3 text-slate-600 font-medium flex items-center gap-1">
                          <MapPin size={12} className="text-slate-400" />
                          {cityName}
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEditModal(sc)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                              title="Edit Sub Customer"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => handleDeleteSubCustomer(sc.id)}
                              className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Delete Sub Customer"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedSubId ? 'Edit Sub Customer' : 'Register New Sub Customer'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveSubCustomer} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Sub Customer Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={subName}
                    onChange={e => setSubName(e.target.value)}
                    placeholder="Enter sub customer name..."
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
                      options={activeRegions.map(r => ({ value: r.id, label: r.name }))}
                      value={regionId}
                      onChange={setRegionId}
                      placeholder="Select Region..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      City <span className="text-rose-500">*</span>
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
                    <Save size={14} /> Save Sub Customer
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="sub customer"
          status={dupStatus}
          matches={dupMatches.map(sc => ({
            id: sc.id,
            name: sc.name,
            cityName: activeCities.find(ct => ct.id === sc.cityId)?.name
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
