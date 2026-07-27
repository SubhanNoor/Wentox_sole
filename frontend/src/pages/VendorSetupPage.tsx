import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2, Phone, MapPin } from 'lucide-react';
import type { Vendor } from '@/types';

export default function VendorSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedCityFilter, setSelectedCityFilter] = useState('all');

  // Editing state
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);

  // Form State
  const [vendorName, setVendorName] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorCity, setVendorCity] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedVendorId(null);
    setVendorName('');
    setVendorPhone('');
    setVendorCity('');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectVendor = (vendor: Vendor) => {
    setSelectedVendorId(vendor.id);
    setVendorName(vendor.name);
    setVendorPhone(vendor.phone || '');
    setVendorCity(vendor.city || '');
    setErrorMsg('');
    setActiveTab('form');
  };

  // Generate the next Business Account code under the "Vendors" chart account (210001)
  const getNextVendorAccountCode = () => {
    const vendorAccounts = state.businessAccounts.filter(acc => acc.controlId === '210001');
    if (vendorAccounts.length === 0) return '21000101';

    const suffixes = vendorAccounts.map(acc => {
      const suffixStr = acc.id.substring(6); // '210001' is 6 characters
      const num = parseInt(suffixStr, 10);
      return isNaN(num) ? 0 : num;
    });

    const maxSuffix = Math.max(...suffixes, 0);
    const nextSuffix = maxSuffix + 1;
    const formattedSuffix = nextSuffix < 10 ? `0${nextSuffix}` : `${nextSuffix}`;
    return `210001${formattedSuffix}`;
  };

  const handleSaveVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorName.trim()) {
      return setErrorMsg('Vendor name is required.');
    }

    if (selectedVendorId) {
      // Edit mode — the linked Business Account's name is kept in sync by the reducer
      const existingVendor = state.vendors.find(v => v.id === selectedVendorId);
      const savedVendor: Vendor = {
        id: selectedVendorId,
        name: vendorName.trim(),
        phone: vendorPhone.trim() || undefined,
        city: vendorCity.trim() || undefined,
        baId: existingVendor?.baId || ''
      };
      dispatch({
        type: 'UPDATE_VENDOR',
        vendor: savedVendor
      });
      setSuccessMsg('Vendor details updated successfully.');
    } else {
      // Add mode — auto-create the linked Business Account under "Vendors"
      const newId = 'v_' + Date.now();
      const baId = getNextVendorAccountCode();

      dispatch({
        type: 'ADD_BUSINESS_ACCOUNT',
        account: {
          id: baId,
          name: `${vendorName.trim()} A/C`,
          controlId: '210001',
          linkCode: 'A',
          region: 'LOCAL',
          status: 'Active'
        }
      });

      const savedVendor: Vendor = {
        id: newId,
        name: vendorName.trim(),
        phone: vendorPhone.trim() || undefined,
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
    setVendorName('');
    setVendorPhone('');
    setVendorCity('');
    setSelectedVendorId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleDeleteVendor = (id: string) => {
    // Check if vendor is used by any products
    const productCount = state.products.filter(p => p.vendorId === id).length;
    if (productCount > 0) {
      alert(`Cannot delete this vendor. It is currently linked to ${productCount} registered product articles.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this vendor?')) {
      dispatch({ type: 'DELETE_VENDOR', id });
      setSuccessMsg('Vendor deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedVendorId(null);
      setActiveTab('list');
    }
  };

  // Compile list of unique city names entered on existing vendors
  const uniqueCitiesList = useMemo(() => {
    const cities = new Set<string>();
    state.vendors.forEach(v => {
      if (v.city && v.city.trim()) {
        cities.add(v.city.trim());
      }
    });
    return Array.from(cities).sort((a, b) => a.localeCompare(b));
  }, [state.vendors]);

  const filteredVendors = useMemo(() => {
    return state.vendors.filter(v => {
      // 1. Filter by search query
      if (vendorSearch.trim()) {
        const q = vendorSearch.toLowerCase();
        const matchesQuery = 
          v.name.toLowerCase().includes(q) || 
          v.id.toLowerCase().includes(q) ||
          (v.phone && v.phone.toLowerCase().includes(q)) ||
          (v.city && v.city.toLowerCase().includes(q));
        if (!matchesQuery) return false;
      }

      // 2. Filter by city dropdown
      if (selectedCityFilter !== 'all') {
        if (!v.city || v.city.toLowerCase() !== selectedCityFilter.toLowerCase()) return false;
      }

      return true;
    });
  }, [state.vendors, vendorSearch, selectedCityFilter]);

  return (
    <AppLayout pageTitle="Vendor Setup">
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
                setSelectedVendorId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Vendor Partners
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedVendorId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Register New Vendor
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Add Vendor
            </button>
          )}
        </div>

        {/* View 1: Vendors Directory List */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Vendors Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage manufacturing vendors and raw material partners.</p>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="relative min-w-[200px]">
                  <input
                    type="text"
                    placeholder="Search name, phone..."
                    value={vendorSearch}
                    onChange={e => setVendorSearch(e.target.value)}
                    className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                  />
                  <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
                </div>

                <select
                  value={selectedCityFilter}
                  onChange={e => setSelectedCityFilter(e.target.value)}
                  className="soleria-input py-1.5 text-xs cursor-pointer font-semibold bg-white"
                  style={{ minWidth: '150px' }}
                >
                  <option value="all">All Cities</option>
                  {uniqueCitiesList.map(cityName => (
                    <option key={cityName} value={cityName}>{cityName}</option>
                  ))}
                </select>
              </div>
            </div>

            {filteredVendors.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                No registered vendors found matching your filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredVendors.map(vendor => {
                  const productCount = state.products.filter(p => p.vendorId === vendor.id).length;
                  const initialLetter = vendor.name.charAt(0).toUpperCase();
                  const cityName = vendor.city || 'Local / Other';

                  return (
                    <div
                      key={vendor.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectVendor(vendor)}
                    >
                      <div>
                        {/* Card Top: Code & Status/City badge */}
                        <div className="flex items-center justify-between mb-3.5">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                            CODE: {vendor.id}
                          </span>
                          <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider flex items-center gap-1">
                            <MapPin size={10} />
                            {cityName}
                          </span>
                        </div>

                        {/* Card Middle: Avatar circle + Name */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {vendor.name}
                            </h4>
                            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium mt-1">
                              <Phone size={10} />
                              <span>{vendor.phone || 'No Phone Number'}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-semibold mt-2 uppercase tracking-wider">
                              {productCount} {productCount === 1 ? 'PRODUCT ARTICLE' : 'PRODUCT ARTICLES'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectVendor(vendor)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Vendor"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteVendor(vendor.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Vendor"
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
          /* View 2: Add New / Edit Vendor Form */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-2 border-b pb-3 mb-6">
              <button
                onClick={() => {
                  setActiveTab('list');
                  setSelectedVendorId(null);
                }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-[#111c2a]">
                  {selectedVendorId ? `Edit Vendor: ${vendorName}` : 'Register New Vendor'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Specify the business name, city location, and contact information of the manufacturing vendor.</p>
              </div>
            </div>

            <form onSubmit={handleSaveVendor} className="flex flex-col gap-6">
              {/* Vendor Details */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Vendor Configuration
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Vendor Name</label>
                    <input
                      type="text"
                      value={vendorName}
                      onChange={e => setVendorName(e.target.value)}
                      placeholder="e.g. Decent Polyurethane"
                      className="soleria-input font-semibold bg-white w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={vendorPhone}
                      onChange={e => setVendorPhone(e.target.value)}
                      placeholder="e.g. 0300-1234567, 042-3588991"
                      className="soleria-input font-semibold bg-white w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">City Location</label>
                    <input
                      type="text"
                      value={vendorCity}
                      onChange={e => setVendorCity(e.target.value)}
                      placeholder="e.g. Lahore, Karachi"
                      className="soleria-input font-semibold bg-white w-full"
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
                    setSelectedVendorId(null);
                  }}
                  className="btn-outline px-5 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold px-6 py-2 flex items-center gap-1.5"
                >
                  <Save size={16} /> Save Vendor Details
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
