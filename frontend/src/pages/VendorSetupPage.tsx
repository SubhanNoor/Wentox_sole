import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, Phone, MapPin, X, ArrowRight, Truck } from 'lucide-react';
import type { Vendor } from '@/types';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import SearchableSelect from '@/components/SearchableSelect';

export default function VendorSetupPage() {
  const { state, dispatch } = useApp();

  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedCityFilter, setSelectedCityFilter] = useState('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<Vendor | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Drill-down: clicking a vendor card opens a details window showing that vendor's purchase history
  const [viewingVendorId, setViewingVendorId] = useState<string | null>(null);

  // Form State
  const [vendorName, setVendorName] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorCity, setVendorCity] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleOpenAddModal = () => {
    setSelectedVendorId(null);
    setVendorName('');
    setVendorPhone('');
    setVendorCity('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (vendor: Vendor) => {
    setSelectedVendorId(vendor.id);
    setVendorName(vendor.name);
    setVendorPhone(vendor.phone || '');
    setVendorCity(vendor.city || '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedVendorId(null);
    setVendorName('');
    setVendorPhone('');
    setVendorCity('');
    setErrorMsg('');
  };

  const getNextVendorAccountCode = () => {
    const vendorAccounts = state.businessAccounts.filter(acc => acc.controlId === '210001');
    const maxSuffix = vendorAccounts.reduce((max, acc) => {
      const num = parseInt(acc.id.substring(6), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return `210001${String(maxSuffix + 1).padStart(4, '0')}`;
  };

  const handleSaveVendor = (e: React.FormEvent) => {
    e.preventDefault();
    const typedName = vendorName.trim();
    const typedPhone = vendorPhone.trim();

    if (!typedName) {
      return setErrorMsg('Vendor name is required.');
    }

    if (selectedVendorId) {
      const existingVendor = state.vendors.find(v => v.id === selectedVendorId);
      const savedVendor: Vendor = {
        id: selectedVendorId,
        name: typedName,
        phone: typedPhone || undefined,
        city: vendorCity.trim() || undefined,
        baId: existingVendor?.baId || ''
      };
      dispatch({
        type: 'UPDATE_VENDOR',
        vendor: savedVendor
      });
      setSuccessMsg('Vendor details updated successfully.');
    } else {
      const match = state.vendors.find(v =>
        v.name.toLowerCase() === typedName.toLowerCase() &&
        (v.phone || '').trim() === typedPhone
      );

      if (match) {
        if (match.isActive !== false) {
          return setErrorMsg('A vendor with this name already exists.');
        } else {
          setDupMatch(match);
          setIsDupModalOpen(true);
          return;
        }
      }

      const newId = 'v_' + Date.now();
      const baId = getNextVendorAccountCode();

      dispatch({
        type: 'ADD_BUSINESS_ACCOUNT',
        account: {
          id: baId,
          name: `${typedName} A/C`,
          controlId: '210001',
          linkCode: 'A',
          region: 'LOCAL',
          status: 'Active'
        }
      });

      const savedVendor: Vendor = {
        id: newId,
        name: typedName,
        phone: typedPhone || undefined,
        city: vendorCity.trim() || undefined,
        baId
      };
      dispatch({
        type: 'ADD_VENDOR',
        vendor: savedVendor
      });
      setSuccessMsg('New vendor registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleActivateDuplicate = (id: string) => {
    const match = state.vendors.find(v => v.id === id);
    if (match) {
      if (!state.businessAccounts.some(b => b.id === match.baId)) {
        dispatch({
          type: 'ADD_BUSINESS_ACCOUNT',
          account: {
            id: match.baId,
            name: `${match.name} A/C`,
            controlId: '210001',
            linkCode: 'A',
            region: 'LOCAL',
            status: 'Active'
          }
        });
      }
      dispatch({
        type: 'UPDATE_VENDOR',
        vendor: { ...match, isActive: true }
      });
      setSuccessMsg('Vendor reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    handleCloseModal();
  };

  const handleDeleteVendor = (id: string) => {
    const productCount = state.products.filter(p => p.vendorId === id && p.isActive !== false).length;
    if (productCount > 0) {
      alert(`Cannot delete this vendor. It is currently linked to ${productCount} registered product articles.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this vendor?')) {
      dispatch({ type: 'DELETE_VENDOR', id });
      setSuccessMsg('Vendor deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      handleCloseModal();
    }
  };

  const activeVendors = useMemo(() => {
    return state.vendors.filter(v => v.isActive !== false);
  }, [state.vendors]);

  const uniqueCitiesList = useMemo(() => {
    const cities = new Set<string>();
    activeVendors.forEach(v => {
      if (v.city && v.city.trim()) {
        cities.add(v.city.trim());
      }
    });
    return Array.from(cities).sort((a, b) => a.localeCompare(b));
  }, [activeVendors]);

  const filteredVendors = useMemo(() => {
    return activeVendors.filter(v => {
      if (vendorSearch.trim()) {
        const q = vendorSearch.toLowerCase();
        const matchesQuery = 
          v.name.toLowerCase().includes(q) || 
          v.id.toLowerCase().includes(q) ||
          (v.phone && v.phone.toLowerCase().includes(q)) ||
          (v.city && v.city.toLowerCase().includes(q));
        if (!matchesQuery) return false;
      }

      if (selectedCityFilter !== 'all') {
        if (!v.city || v.city.toLowerCase() !== selectedCityFilter.toLowerCase()) return false;
      }

      return true;
    });
  }, [activeVendors, vendorSearch, selectedCityFilter]);

  return (
    <AppLayout pageTitle="Vendor Setup">
      <div className="mx-auto" style={{ maxWidth: 1400 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Vendors Directory Header & Action Card */}
        <div className="card-white p-6 md:p-8 bg-white border mb-6">
          <div className="border-b pb-4 mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                <Truck size={20} className="text-[#B08D57]" /> Vendors Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Search and manage manufacturing vendors and raw material partners.</p>
            </div>
            
            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Vendor Partner
            </button>
          </div>

          {/* Search & City Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search vendor name, code, phone, city..."
                value={vendorSearch}
                onChange={e => setVendorSearch(e.target.value)}
                className="soleria-input w-full py-2 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
            </div>

            <div className="flex items-center gap-3">
              <div className="min-w-[180px]">
                <SearchableSelect
                  options={[
                    { value: 'all', label: 'All Cities' },
                    ...uniqueCitiesList.map(c => ({ value: c, label: c }))
                  ]}
                  value={selectedCityFilter}
                  onChange={setSelectedCityFilter}
                  placeholder="Filter City..."
                />
              </div>

              <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
                Total: {filteredVendors.length} Vendors
              </div>
            </div>
          </div>
        </div>

        {/* Vendors Cards Grid (§1 Standard) */}
        {filteredVendors.length === 0 ? (
          <div className="card-white p-12 text-center text-slate-400">
            <Truck size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600">No registered vendors found matching your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredVendors.map(vendor => {
              const productCount = state.products.filter(p => p.vendorId === vendor.id && p.isActive !== false).length;
              const cityName = vendor.city || 'Local / Other';
              const purchaseCount = state.purchases.filter(p => p.vendorId === vendor.id).length;

              return (
                <div
                  key={vendor.id}
                  onClick={() => setViewingVendorId(vendor.id)}
                  className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
                >
                  <div>
                    {/* Header: Name + City Badge */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                        {vendor.name}
                      </h4>
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                        <MapPin size={10} className="text-slate-400" />
                        {cityName}
                      </span>
                    </div>

                    {/* Subtitle: Code in mono */}
                    <div className="font-mono text-xs text-slate-400 mb-3">
                      Vendor ID: <span className="font-semibold text-slate-600">#{vendor.id}</span>
                    </div>

                    {/* Contact & Articles Meta */}
                    <div className="flex flex-col gap-1.5 text-xs text-slate-500 font-medium border-t border-slate-100 pt-2.5">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Phone size={12} className="text-slate-400" />
                        <span>{vendor.phone || 'No Phone Number'}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
                        {productCount} {productCount === 1 ? 'Article' : 'Articles'} · {purchaseCount} Purchase{purchaseCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>

                  {/* Footer Bar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditModal(vendor)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                        title="Edit Vendor"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteVendor(vendor.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Vendor"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                      Purchase History <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
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
                  {selectedVendorId ? 'Edit Vendor Partner' : 'Register New Vendor Partner'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveVendor} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Vendor Partner Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={vendorName}
                      onChange={e => setVendorName(e.target.value)}
                      placeholder="e.g. Decent Polyurethane"
                      className="soleria-input w-full font-semibold"
                      autoFocus
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={vendorPhone}
                        onChange={e => setVendorPhone(e.target.value)}
                        placeholder="e.g. 0300-1234567"
                        className="soleria-input w-full font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        City Location
                      </label>
                      <input
                        type="text"
                        value={vendorCity}
                        onChange={e => setVendorCity(e.target.value)}
                        placeholder="e.g. Lahore, Karachi"
                        className="soleria-input w-full font-semibold"
                      />
                    </div>
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
                    <Save size={14} /> Save Vendor
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>

      {/* Details window: vendor purchase history modal */}
      {viewingVendorId && (() => {
        const vendor = state.vendors.find(v => v.id === viewingVendorId);
        if (!vendor) return null;
        const purchaseHistory = state.purchases
          .filter(p => p.vendorId === vendor.id)
          .sort((a, b) => b.date.localeCompare(a.date));

        return (
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 animate-in fade-in duration-200"
            data-no-print
            onClick={() => setViewingVendorId(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-3xl mx-4 animate-in zoom-in-95 duration-200 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b pb-3 mb-4">
                <div>
                  <h3 className="font-lora font-bold text-lg text-slate-800">{vendor.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Code: {vendor.id} · {vendor.city || 'Local / Other'} · {purchaseHistory.length} purchase{purchaseHistory.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => setViewingVendorId(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {purchaseHistory.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No purchases recorded from this vendor yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                        <th className="p-2 pl-3">Date</th>
                        <th className="p-2">Materials</th>
                        <th className="p-2">Remarks</th>
                        <th className="p-2 text-right">Total Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseHistory.map(pu => (
                        <tr key={pu.id} className="border-t align-top hover:bg-slate-50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-2 pl-3 font-mono text-slate-600 whitespace-nowrap">{pu.date}</td>
                          <td className="p-2 text-slate-700">
                            {pu.items.map(it => `${it.materialName} (${it.quantity} ${it.unit})`).join(', ')}
                          </td>
                          <td className="p-2 text-slate-500">{pu.remarks || '-'}</td>
                          <td className="p-2 text-right font-bold text-slate-800 whitespace-nowrap">{formatCurrency(pu.totalValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <DuplicateNamePromptModal
        isOpen={isDupModalOpen}
        entityLabel="vendor"
        status="inactive"
        matches={dupMatch ? [{ id: dupMatch.id, name: dupMatch.name, phone: dupMatch.phone, cityName: dupMatch.city }] : []}
        allowCreateOnActive={false}
        onActivate={handleActivateDuplicate}
        onCreateNew={() => {}}
        onCancel={() => {
          setIsDupModalOpen(false);
          setDupMatch(null);
        }}
      />
    </AppLayout>
  );
}
