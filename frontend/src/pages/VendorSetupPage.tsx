import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import OpeningBalanceFields from '@/components/OpeningBalanceFields';
import { Plus, Search, Settings, Save, Edit2, Phone, MapPin, X, Truck, RotateCcw } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { VendorRow, RegionRow, CityRow, ProductRow, PurchaseRow } from '@/lib/api';
import { formatDate, getTodayDate } from '@/lib/utils';

export default function VendorSetupPage() {
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedCityFilter, setSelectedCityFilter] = useState('all');

  // Modal State
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);

  const [reactivatePrompt, setReactivatePrompt] = useState<{ vendor_id: number; name: string; phone: string | null } | null>(null);

  // Drill-down: clicking a vendor card opens a details window showing that vendor's purchase history
  const [viewingVendorId, setViewingVendorId] = useState<number | null>(null);
  const [viewingPurchases, setViewingPurchases] = useState<PurchaseRow[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);

  // Form State
  const [vendorName, setVendorName] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  // The opening balance lives on the auto-created business account, not on this row — the service
  // forwards it there (same route bankAccounts.service.js has always used).
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(getTodayDate());
  const [vendorRegionId, setVendorRegionId] = useState('');
  const [vendorCityId, setVendorCityId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };

  const [vendorList, setVendorList] = useState<VendorRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [productList, setProductList] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [venRes, rgRes, ctRes, prodRes] = await Promise.all([
      api.vendors.list({ includeInactive: false }),
      api.listRegions(),
      api.listCities(),
      api.products.list(),
    ]);
    if (venRes.ok) setVendorList(venRes.data);
    if (rgRes.ok) setRegions(rgRes.data);
    if (ctRes.ok) setCities(ctRes.data);
    if (prodRes.ok) setProductList(prodRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const citiesInRegion = useMemo(
    () => vendorRegionId ? cities.filter(c => c.region_id === Number(vendorRegionId)) : cities,
    [cities, vendorRegionId]
  );

  const handleOpenAddModal = () => {
    setSelectedVendorId(null);
    setVendorName('');
    setVendorPhone('');
    setVendorRegionId('');
    setVendorCityId('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (vendor: VendorRow) => {
    setSelectedVendorId(vendor.vendor_id);
    setVendorName(vendor.name);
    setVendorPhone(vendor.phone || '');
    setVendorRegionId(vendor.region_id ? String(vendor.region_id) : '');
    setVendorCityId(vendor.city_id ? String(vendor.city_id) : '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedVendorId(null);
    setVendorName('');
    setVendorPhone('');
    setVendorRegionId('');
    setVendorCityId('');
    setOpeningDate(getTodayDate());
    setErrorMsg('');
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next
  // vendor — instead of closing. G-04: the opening date is deliberately NOT reset here; it stays
  // selected for the rest of this window's session and only clears on handleCloseModal.
  const resetForNextVendor = () => {
    setSelectedVendorId(null);
    setVendorName('');
    setVendorPhone('');
    setVendorRegionId('');
    setVendorCityId('');
    setOpeningBalance('');
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    const typedName = vendorName.trim();
    const typedPhone = vendorPhone.trim();
    if (!typedName) return setErrorMsg('Vendor name is required.');

    const payload = {
      name: typedName,
      phone: typedPhone || undefined,
      region_id: vendorRegionId ? Number(vendorRegionId) : undefined,
      city_id: vendorCityId ? Number(vendorCityId) : undefined,
      opening_balance: openingBalance.trim() ? Number(openingBalance) : undefined,
      opening_date: openingDate.trim() || undefined,
    };

    if (selectedVendorId) {
      const res = await api.vendors.update(selectedVendorId, payload);
      if (!res.ok) return setErrorMsg(res.error.message);
      flash('Vendor details updated successfully.');
      handleCloseModal();
    } else {
      const res = await api.vendors.create(payload);
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE' && res.error.details) {
          setReactivatePrompt(res.error.details as { vendor_id: number; name: string; phone: string | null });
          return;
        }
        return setErrorMsg(res.error.message);
      }
      flash('New vendor registered successfully.');
      resetForNextVendor();
    }

    loadAll();
  };

  const confirmReactivateFromPrompt = async () => {
    if (!reactivatePrompt) return;
    const res = await api.vendors.reactivate(reactivatePrompt.vendor_id);
    setReactivatePrompt(null);
    if (!res.ok) return setErrorMsg('Failed to reactivate: ' + res.error.message);
    flash('Existing vendor reactivated.');
    resetForNextVendor();
    loadAll();
  };



  const openPurchaseHistory = (vendorId: number) => {
    setViewingVendorId(vendorId);
    setPurchasesLoading(true);
    api.purchases.list({ vendor_id: vendorId }).then(res => {
      if (res.ok) setViewingPurchases(res.data);
      setPurchasesLoading(false);
    });
  };

  const uniqueCitiesList = useMemo(() => {
    const used = new Set(vendorList.map(v => v.city_id).filter((id): id is number => id != null));
    return cities.filter(c => used.has(c.city_id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [vendorList, cities]);

  const filteredVendors = useMemo(() => {
    return vendorList.filter(v => {
      if (vendorSearch.trim()) {
        const q = vendorSearch.toLowerCase();
        const cityName = cities.find(c => c.city_id === v.city_id)?.name || '';
        const matchesQuery =
          v.name.toLowerCase().includes(q) ||
          String(v.vendor_id).includes(q) ||
          (v.phone && v.phone.toLowerCase().includes(q)) ||
          cityName.toLowerCase().includes(q);
        if (!matchesQuery) return false;
      }
      if (selectedCityFilter !== 'all' && String(v.city_id) !== selectedCityFilter) return false;
      return true;
    });
  }, [vendorList, vendorSearch, selectedCityFilter, cities]);

  const cityName = (id: number | null) => cities.find(c => c.city_id === id)?.name || 'Local / Other';

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
                    ...uniqueCitiesList.map(c => ({ value: String(c.city_id), label: c.name }))
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

        {/* Vendors Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<VendorRow>
            rows={filteredVendors}
            rowKey={vendor => vendor.vendor_id}
            onRowClick={vendor => openPurchaseHistory(vendor.vendor_id)}
            loading={loading}
            emptyIcon={<Truck size={36} />}
            emptyMessage="No registered vendors found matching your filters."
            columns={[
              {
                key: 'code',
                header: 'Vendor ID',
                width: '130px',
                render: vendor => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">#{vendor.vendor_id}</span>
                ),
              },
              {
                key: 'name',
                header: 'Vendor Name',
                render: vendor => <span className="font-semibold text-slate-900">{vendor.name}</span>,
              },
              {
                key: 'phone',
                header: 'Phone',
                render: vendor => (
                  <span className="text-slate-600 font-medium flex items-center gap-1.5">
                    <Phone size={12} className="text-slate-400" />
                    {vendor.phone || 'No Phone Number'}
                  </span>
                ),
              },
              {
                key: 'region',
                header: 'Region',
                render: vendor => (
                  <span className="text-slate-600 font-medium">{vendor.region_name || 'N/A'}</span>
                ),
              },
              {
                key: 'city',
                header: 'City',
                render: vendor => (
                  <span className="text-slate-600 font-medium flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    {cityName(vendor.city_id)}
                  </span>
                ),
              },
              {
                key: 'articles',
                header: 'Articles',
                width: '100px',
                align: 'center',
                render: vendor => {
                  const productCount = productList.filter(p => p.vendor_id === vendor.vendor_id).length;
                  return (
                    <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                      {productCount} {productCount === 1 ? 'Article' : 'Articles'}
                    </span>
                  );
                },
              },
            ]}
            actions={vendor => (
              <>
                <button
                  onClick={() => handleOpenEditModal(vendor)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit Vendor"
                >
                  <Edit2 size={15} />
                </button>
              </>
            )}
          />
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}
            onKeyDown={e => { if (e.key === 'Escape') { (handleCloseModal)(); } }}
            tabIndex={-1}>
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
                      ref={nameInputRef}
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
                        Region
                      </label>
                      <SearchableSelect
                        options={[
                          { value: '', label: 'Select region...' },
                          ...regions.map(r => ({ value: String(r.region_id), label: r.name }))
                        ]}
                        value={vendorRegionId}
                        onChange={val => { setVendorRegionId(val); setVendorCityId(''); }}
                        placeholder="Select region..."
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        City Location
                      </label>
                      <SearchableSelect
                        options={[
                          { value: '', label: 'Select city...' },
                          ...citiesInRegion.map(c => ({ value: String(c.city_id), label: c.name }))
                        ]}
                        value={vendorCityId}
                        onChange={setVendorCityId}
                        placeholder="Select city..."
                      />
                    </div>
                  </div>
                </div>

                <OpeningBalanceFields
                  balance={openingBalance}
                  date={openingDate}
                  onBalanceChange={setOpeningBalance}
                  onDateChange={setOpeningDate}
                  isExisting={selectedVendorId != null}
                />

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
        const vendor = vendorList.find(v => v.vendor_id === viewingVendorId);
        if (!vendor) return null;

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
                    Code: {vendor.vendor_id} · {cityName(vendor.city_id)} · {viewingPurchases.length} purchase{viewingPurchases.length !== 1 ? 's' : ''}
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

              {purchasesLoading ? (
                <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
              ) : viewingPurchases.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No purchases recorded from this vendor yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                        <th className="p-2 pl-3">Date</th>
                        <th className="p-2">Bill No.</th>
                        <th className="p-2">Remarks</th>
                        <th className="p-2 text-center">Status</th>
                        <th className="p-2 text-right">Total Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingPurchases.map(pu => (
                        <tr key={pu.purchase_id} className="border-t align-top hover:bg-slate-50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-2 pl-3 font-mono text-slate-600 whitespace-nowrap">{formatDate(pu.purchase_date)}</td>
                          <td className="p-2 text-slate-700">{pu.bill_no || '-'}</td>
                          <td className="p-2 text-slate-500">{pu.remarks || '-'}</td>
                          <td className="p-2 text-center">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${pu.is_posted ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {pu.is_posted ? 'Posted' : 'Draft'}
                            </span>
                          </td>
                          <td className="p-2 text-right font-bold text-slate-800 whitespace-nowrap">{formatCurrency(pu.total_value)}</td>
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

      {/* Reactivate-inactive-duplicate prompt */}
      {reactivatePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setReactivatePrompt(null)}
            onKeyDown={e => { if (e.key === 'Escape') { (() => setReactivatePrompt(null))(); } }}
            tabIndex={-1}>
          <div className="bg-white rounded-2xl border-2 border-amber-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-lora font-bold text-base text-slate-900 mb-2 flex items-center gap-2">
              <RotateCcw size={18} className="text-amber-500" /> Inactive Vendor Found
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              An inactive vendor named <strong>{reactivatePrompt.name}</strong>
              {reactivatePrompt.phone ? <> (phone {reactivatePrompt.phone})</> : null} already
              exists. Reactivate it instead of creating a new record?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setReactivatePrompt(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
              <button onClick={confirmReactivateFromPrompt} className="btn-gold px-4 py-2 text-xs font-semibold cursor-pointer">Reactivate</button>
            </div>
          </div>
        </div>
      )}


    </AppLayout>
  );
}
