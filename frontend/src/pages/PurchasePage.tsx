import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import type { PurchaseItem, Vendor } from '@/types';
import { Plus, Trash2, Save, ShoppingBag, BookmarkPlus } from 'lucide-react';

const UNIT_PRESETS = ['Meters', 'Buckles', 'KG', 'Pieces', 'Rolls'];

interface PurchaseDraft {
  draftId: string;
  date: string;
  vendorId: string;
  remarks: string;
  items: PurchaseItem[];
  savedAt: string;
}

function emptyItem(): PurchaseItem {
  return {
    id: 'pui_' + Date.now() + Math.random().toString(36).slice(2, 7),
    materialName: '',
    unit: 'Meters',
    quantity: 0,
    pricePerUnit: 0,
    totalPrice: 0
  };
}

export default function PurchasePage() {
  const { state, dispatch } = useApp();

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [vendorId, setVendorId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<PurchaseItem[]>([emptyItem()]);
  const [customUnitRows, setCustomUnitRows] = useState<Record<string, boolean>>({});

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Drafts state persisted in localStorage
  const [drafts, setDrafts] = useState<PurchaseDraft[]>(() => {
    try {
      const saved = localStorage.getItem('wentox_purchase_drafts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedDraftId, setSelectedDraftId] = useState<string>('');

  // Add New Vendor modal state
  const [isAddVendorOpen, setIsAddVendorOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorRegionId, setNewVendorRegionId] = useState('');
  const [newVendorCity, setNewVendorCity] = useState('');
  const [vendorErrorMsg, setVendorErrorMsg] = useState('');

  // FOUR-digit serial — two digits caps a chart account at 99 children, and
  // the client's legacy data already holds 200+ accounts under one head.
  // See database_schema.md §3.2.
  const getNextVendorAccountCode = () => {
    const vendorAccounts = state.businessAccounts.filter(acc => acc.controlId === '210001');
    const maxSuffix = vendorAccounts.reduce((max, acc) => {
      const num = parseInt(acc.id.substring(6), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return `210001${String(maxSuffix + 1).padStart(4, '0')}`;
  };

  const handleCreateVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName.trim()) {
      setVendorErrorMsg('Vendor name is required.');
      return;
    }
    if (!newVendorRegionId) {
      setVendorErrorMsg('Region is required.');
      return;
    }

    const newVendorId = 'v_' + Date.now();
    const baId = getNextVendorAccountCode();
    const regionName = state.regions.find(r => r.id === newVendorRegionId)?.name || 'LOCAL';

    dispatch({
      type: 'ADD_BUSINESS_ACCOUNT',
      account: {
        id: baId,
        name: `${newVendorName.trim()} A/C`,
        controlId: '210001',
        linkCode: 'A',
        region: regionName,
        status: 'Active'
      }
    });

    const newVendor: Vendor = {
      id: newVendorId,
      name: newVendorName.trim(),
      phone: newVendorPhone.trim() || undefined,
      city: newVendorCity.trim() || undefined,
      regionId: newVendorRegionId,
      baId
    };
    dispatch({ type: 'ADD_VENDOR', vendor: newVendor });

    setVendorId(newVendorId);
    setIsAddVendorOpen(false);
    setNewVendorName('');
    setNewVendorPhone('');
    setNewVendorRegionId('');
    setNewVendorCity('');
    setVendorErrorMsg('');
    setSuccessMsg('New vendor added successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const vendorOptions = useMemo(() => {
    return state.vendors.map(v => ({
      value: v.id,
      label: `${v.name}${v.city ? ' — ' + v.city : ''}`
    }));
  }, [state.vendors]);

  const selectedVendor = useMemo(() => {
    return state.vendors.find(v => v.id === vendorId);
  }, [vendorId, state.vendors]);

  const updateItem = (id: string, field: keyof PurchaseItem, value: string | number) => {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it;
      const updated = { ...it, [field]: value };
      if (field === 'quantity' || field === 'pricePerUnit') {
        updated.totalPrice = Number(updated.quantity) * Number(updated.pricePerUnit);
      }
      return updated;
    }));
  };

  const addItemRow = () => setItems(prev => [...prev, emptyItem()]);

  const removeItemRow = (id: string) => {
    setItems(prev => prev.length > 1 ? prev.filter(it => it.id !== id) : prev);
    setCustomUnitRows(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const grandTotal = useMemo(() => items.reduce((s, it) => s + it.totalPrice, 0), [items]);

  const isValid = useMemo(() => {
    if (!vendorId || !date) return false;
    return items.every(it => it.materialName.trim() && it.unit.trim() && it.quantity > 0 && it.pricePerUnit > 0);
  }, [vendorId, date, items]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorId) return setErrorMsg('Vendor is required.');
    if (!date) return setErrorMsg('Date is required.');
    if (!isValid) return setErrorMsg('Every line item needs a material name, unit, quantity, and price per unit.');

    dispatch({
      type: 'ADD_PURCHASE',
      purchase: {
        id: 'pu_' + Date.now(),
        date,
        vendorId,
        remarks: remarks.trim(),
        items,
        totalValue: grandTotal
      }
    });

    if (selectedDraftId) {
      handleDeleteDraft(selectedDraftId);
    }

    setDate(new Date().toISOString().split('T')[0]);
    setVendorId('');
    setRemarks('');
    setItems([emptyItem()]);
    setCustomUnitRows({});
    setSelectedDraftId('');
    setErrorMsg('');
    setSuccessMsg('Purchase recorded successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleSaveDraft = () => {
    const hasContent = vendorId || remarks.trim() || items.some(it => it.materialName.trim());
    if (!hasContent) {
      setErrorMsg('Please fill in some vendor or material information before saving a draft.');
      setTimeout(() => setErrorMsg(''), 3000);
      return;
    }

    const newDraft: PurchaseDraft = {
      draftId: selectedDraftId || 'pud_' + Date.now(),
      date,
      vendorId,
      remarks,
      items,
      savedAt: new Date().toISOString()
    };

    const nextDrafts = selectedDraftId
      ? drafts.map(d => (d.draftId === selectedDraftId ? newDraft : d))
      : [newDraft, ...drafts];

    setDrafts(nextDrafts);
    try {
      localStorage.setItem('wentox_purchase_drafts', JSON.stringify(nextDrafts));
    } catch (e) {
      console.error(e);
    }

    setSuccessMsg('Purchase order saved to drafts.');
    setTimeout(() => setSuccessMsg(''), 3000);

    setDate(new Date().toISOString().split('T')[0]);
    setVendorId('');
    setRemarks('');
    setItems([emptyItem()]);
    setCustomUnitRows({});
    setSelectedDraftId('');
  };

  const handleLoadDraft = (draftId: string) => {
    const draft = drafts.find(d => d.draftId === draftId);
    if (!draft) return;
    setDate(draft.date || new Date().toISOString().split('T')[0]);
    setVendorId(draft.vendorId || '');
    setRemarks(draft.remarks || '');
    setItems(draft.items.length > 0 ? draft.items : [emptyItem()]);
    setSelectedDraftId(draftId);
    setSuccessMsg('Draft loaded into form.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleDeleteDraft = (draftId: string) => {
    const updated = drafts.filter(d => d.draftId !== draftId);
    setDrafts(updated);
    try {
      localStorage.setItem('wentox_purchase_drafts', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
    if (selectedDraftId === draftId) {
      setSelectedDraftId('');
      setDate(new Date().toISOString().split('T')[0]);
      setVendorId('');
      setRemarks('');
      setItems([emptyItem()]);
    }
    setSuccessMsg('Draft removed.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleDeletePurchase = (id: string) => {
    if (window.confirm('Are you sure you want to delete this purchase record?')) {
      dispatch({ type: 'DELETE_PURCHASE', id });
    }
  };

  const sortedPurchases = useMemo(() => {
    return [...state.purchases].sort((a, b) => b.date.localeCompare(a.date));
  }, [state.purchases]);

  return (
    <AppLayout pageTitle="Purchase Entry">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
        )}

        {/* Saved Purchase Drafts Loader Panel */}
        {drafts.length > 0 && (
          <div className="mb-6 p-4 bg-slate-50 border border-slate-200/90 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-sm shadow-2xs" data-no-print>
            <div className="flex items-center gap-2">
              <BookmarkPlus size={18} className="text-[var(--brand-gold)]" />
              <span className="font-bold text-slate-800 font-lora">Saved Purchase Drafts:</span>
              <span className="text-xs bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full font-semibold border border-amber-200/80">
                {drafts.length} incomplete purchase(s)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={selectedDraftId}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedDraftId(val);
                  if (val) handleLoadDraft(val);
                }}
                className="soleria-input py-1.5 px-3 text-xs bg-white border cursor-pointer font-medium rounded-xl shadow-2xs"
                style={{ width: '250px' }}
              >
                <option value="">Select a draft to load...</option>
                {drafts.map(d => {
                  const vName = state.vendors.find(v => v.id === d.vendorId)?.name || 'Unspecified Vendor';
                  return (
                    <option key={d.draftId} value={d.draftId}>
                      {vName} ({d.date})
                    </option>
                  );
                })}
              </select>
              {selectedDraftId && (
                <button
                  type="button"
                  onClick={() => handleDeleteDraft(selectedDraftId)}
                  className="text-xs text-rose-600 hover:text-rose-800 font-semibold transition-colors cursor-pointer"
                >
                  Delete Selected Draft
                </button>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="card-white p-6 bg-white border mb-8" data-no-print>
          <div className="flex items-center gap-2 border-b pb-3 mb-5">
            <ShoppingBag size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-semibold text-lg text-slate-800">Raw Material Purchase</h3>
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-medium text-slate-600">
                  Vendor <span className="text-red-500 font-bold">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsAddVendorOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102"
                >
                  <Plus size={12} className="text-blue-600" />
                  <span>Add New Vendor</span>
                </button>
              </div>
              <SearchableSelect
                options={vendorOptions}
                value={vendorId}
                onChange={setVendorId}
                placeholder="Select vendor..."
                searchPlaceholder="Search vendors..."
              />
              {selectedVendor && (
                <p className="text-[11px] text-slate-400 mt-1">
                  {selectedVendor.phone || 'No Phone'} {selectedVendor.city ? `· ${selectedVendor.city}` : ''}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
              <input
                type="text"
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Optional notes..."
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="mb-4 rounded-lg border bg-white overflow-visible" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ minWidth: '200px' }}>Material / Product Name <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3" style={{ width: '160px' }}>Unit <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '110px' }}>Quantity <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '130px' }}>Price / Unit <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-right" style={{ width: '130px' }}>Total Price</th>
                  <th className="p-3 text-center" style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b hover:bg-slate-50/55 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4">
                      <input
                        type="text"
                        value={item.materialName}
                        onChange={e => updateItem(item.id, 'materialName', e.target.value)}
                        placeholder="e.g. PU Sheet Roll"
                        className="soleria-input font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3">
                      {customUnitRows[item.id] ? (
                        <input
                          type="text"
                          value={item.unit}
                          onChange={e => updateItem(item.id, 'unit', e.target.value)}
                          placeholder="Type unit..."
                          autoFocus
                          onBlur={() => {
                            if (!item.unit.trim()) {
                              setCustomUnitRows(prev => ({ ...prev, [item.id]: false }));
                              updateItem(item.id, 'unit', UNIT_PRESETS[0]);
                            }
                          }}
                          className="soleria-input"
                          style={{ fontSize: '13px' }}
                        />
                      ) : (
                        <select
                          value={item.unit}
                          onChange={e => {
                            if (e.target.value === '__other__') {
                              setCustomUnitRows(prev => ({ ...prev, [item.id]: true }));
                              updateItem(item.id, 'unit', '');
                            } else {
                              updateItem(item.id, 'unit', e.target.value);
                            }
                          }}
                          className="soleria-input cursor-pointer"
                          style={{ fontSize: '13px' }}
                        >
                          {UNIT_PRESETS.map(u => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                          <option value="__other__">Other (type manually)...</option>
                        </select>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <input
                        type="number"
                        min={0}
                        value={item.quantity || ''}
                        onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                        className="soleria-input text-center font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3 text-center">
                      <input
                        type="number"
                        min={0}
                        value={item.pricePerUnit || ''}
                        onChange={e => updateItem(item.id, 'pricePerUnit', Number(e.target.value))}
                        className="soleria-input text-center font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3 text-right font-bold text-slate-800">
                      {formatCurrency(item.totalPrice)}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeItemRow(item.id)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                        title="Remove Row"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 font-bold text-slate-800" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="p-3 pl-4" colSpan={4}>Grand Total</td>
                  <td className="p-3 text-right">{formatCurrency(grandTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={addItemRow}
              className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
            >
              <Plus size={16} /> Add Line Item
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveDraft}
                className="btn-outline flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-xl hover:border-[var(--brand-gold)] hover:text-[var(--brand-gold)] transition-all cursor-pointer shadow-2xs"
              >
                <BookmarkPlus size={16} /> Save Draft
              </button>
              <button
                type="submit"
                className="btn-gold flex items-center gap-1.5 px-6 py-2.5 text-sm font-bold rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer"
              >
                <Save size={16} /> Save Purchase
              </button>
            </div>
          </div>
        </form>

        {/* Recorded Purchases */}
        <div className="card-white p-6 bg-white border">
          <h3 className="font-lora font-semibold text-lg text-slate-800 mb-4">Recorded Purchases</h3>
          {sortedPurchases.length === 0 ? (
            <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
              No purchases recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Vendor</th>
                    <th className="p-3">Remarks</th>
                    <th className="p-3 text-center">Line Items</th>
                    <th className="p-3 text-right">Total Value</th>
                    <th className="p-3 text-center" style={{ width: '60px' }} data-no-print></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPurchases.map(p => {
                    const vendorName = state.vendors.find(v => v.id === p.vendorId)?.name || 'Unknown Vendor';
                    return (
                      <tr key={p.id} className="border-b hover:bg-slate-50/40" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono">{p.date}</td>
                        <td className="p-3 font-semibold text-slate-700">{vendorName}</td>
                        <td className="p-3 text-xs text-slate-500">{p.remarks || '-'}</td>
                        <td className="p-3 text-center text-slate-600">{p.items.length}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(p.totalValue)}</td>
                        <td className="p-3 text-center" data-no-print>
                          <button
                            onClick={() => handleDeletePurchase(p.id)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                            title="Delete Purchase"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add New Vendor Modal */}
        {isAddVendorOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <form onSubmit={handleCreateVendor} className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">
                Add New Vendor
              </h3>

              {vendorErrorMsg && (
                <div className="banner-error rounded-lg px-3 py-2 text-xs mb-4">{vendorErrorMsg}</div>
              )}

              <div className="mb-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Vendor Name <span className="text-red-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  value={newVendorName}
                  onChange={e => setNewVendorName(e.target.value)}
                  placeholder="e.g. Decent Polyurethane"
                  className="soleria-input font-semibold"
                  autoFocus
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={newVendorPhone}
                  onChange={e => setNewVendorPhone(e.target.value)}
                  placeholder="e.g. 0300-1234567"
                  className="soleria-input font-semibold"
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Select Region <span className="text-red-500 font-bold">*</span>
                </label>
                <select
                  value={newVendorRegionId}
                  onChange={e => setNewVendorRegionId(e.target.value)}
                  className="soleria-input cursor-pointer font-semibold"
                  required
                >
                  <option value="">Select Region...</option>
                  {state.regions.map(rg => (
                    <option key={rg.id} value={rg.id}>{rg.name}</option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  City Location
                </label>
                <input
                  type="text"
                  value={newVendorCity}
                  onChange={e => setNewVendorCity(e.target.value)}
                  placeholder="e.g. Lahore, Karachi"
                  className="soleria-input font-semibold"
                />
              </div>

              <div className="flex justify-end gap-2 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddVendorOpen(false);
                    setNewVendorName('');
                    setNewVendorPhone('');
                    setNewVendorRegionId('');
                    setNewVendorCity('');
                    setVendorErrorMsg('');
                  }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#111c2a] text-[#B08D57] rounded-lg hover:opacity-90 transition-opacity"
                >
                  Save Vendor
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
