import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type {
  VendorRow, RegionRow, CityRow, PurchaseRow, PurchaseCreateInput, PurchaseItemInput,
  UnpostedPurchaseRow, PostAllResult
} from '@/lib/api';
import { formatDate, getTodayDate } from '@/lib/utils';
import { Plus, Trash2, Save, ShoppingBag, Edit } from 'lucide-react';

const UNIT_PRESETS = ['Meters', 'Buckles', 'KG', 'Pieces', 'Rolls'];

interface UiItem {
  uid: string;
  materialName: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
  totalPrice: number;
}

function emptyItem(): UiItem {
  return {
    uid: 'pui_' + Date.now() + Math.random().toString(36).slice(2, 7),
    materialName: '',
    unit: 'Meters',
    quantity: 0,
    pricePerUnit: 0,
    totalPrice: 0
  };
}

export default function PurchasePage() {
  // ── Real lookup / list data ──
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  const refreshPurchases = useCallback(async () => {
    const res = await api.purchases.list({});
    if (res.ok) setPurchases(res.data);
    else setLookupError('Failed to load purchases: ' + res.error.message);
  }, []);

  // P-03: purchases saved but not yet in the ledger, so a run can be entered first and posted in
  // one action at the end. Mirrors SB-06 on SaleBillPage.
  const [unpostedPurchases, setUnpostedPurchases] = useState<UnpostedPurchaseRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<PostAllResult<'purchase_id'> | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.purchases.listUnposted();
    if (res.ok) setUnpostedPurchases(res.data);
  }, []);

  useEffect(() => {
    (async () => {
      const [v, rg, ct] = await Promise.all([api.listVendors(), api.listRegions(), api.listCities()]);
      const failures: string[] = [];
      if (v.ok) setVendors(v.data); else failures.push(v.error.message);
      if (rg.ok) setRegions(rg.data); else failures.push(rg.error.message);
      if (ct.ok) setCities(ct.data); else failures.push(ct.error.message);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
    refreshPurchases();
    refreshUnposted();
  }, [refreshPurchases, refreshUnposted]);

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');

  const [purchaseId, setPurchaseId] = useState<number | null>(null);
  const [currentIsPosted, setCurrentIsPosted] = useState(false);
  const [date, setDate] = useState(getTodayDate());
  const [vendorId, setVendorId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<UiItem[]>([emptyItem()]);
  const [customUnitRows, setCustomUnitRows] = useState<Record<string, boolean>>({});

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Add New Vendor modal state
  const [isAddVendorOpen, setIsAddVendorOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorRegionId, setNewVendorRegionId] = useState('');
  const [newVendorCityId, setNewVendorCityId] = useState('');
  const [vendorErrorMsg, setVendorErrorMsg] = useState('');

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName.trim()) {
      setVendorErrorMsg('Vendor name is required.');
      return;
    }
    if (!newVendorRegionId) {
      setVendorErrorMsg('Region is required.');
      return;
    }

    const res = await api.createVendor({
      name: newVendorName.trim(),
      phone: newVendorPhone.trim() || undefined,
      region_id: Number(newVendorRegionId),
      city_id: newVendorCityId ? Number(newVendorCityId) : undefined
    });
    if (!res.ok) {
      setVendorErrorMsg('Failed to create vendor: ' + res.error.message);
      return;
    }

    setVendors(prev => [...prev, res.data]);
    setVendorId(String(res.data.vendor_id));
    setIsAddVendorOpen(false);
    setNewVendorName('');
    setNewVendorPhone('');
    setNewVendorRegionId('');
    setNewVendorCityId('');
    setVendorErrorMsg('');
    setSuccessMsg('New vendor added successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const vendorOptions = useMemo(() => {
    return vendors.map(v => {
      const cityName = cities.find(c => c.city_id === v.city_id)?.name;
      return { value: String(v.vendor_id), label: `${v.name}${cityName ? ' — ' + cityName : ''}` };
    });
  }, [vendors, cities]);

  const selectedVendor = useMemo(() => {
    return vendors.find(v => v.vendor_id === Number(vendorId));
  }, [vendorId, vendors]);

  const updateItem = (uid: string, field: keyof UiItem, value: string | number) => {
    setItems(prev => prev.map(it => {
      if (it.uid !== uid) return it;
      const updated = { ...it, [field]: value };
      if (field === 'quantity' || field === 'pricePerUnit') {
        updated.totalPrice = Number(updated.quantity) * Number(updated.pricePerUnit);
      }
      return updated;
    }));
  };

  const addItemRow = () => setItems(prev => [...prev, emptyItem()]);

  const removeItemRow = (uid: string) => {
    setItems(prev => prev.length > 1 ? prev.filter(it => it.uid !== uid) : prev);
    setCustomUnitRows(prev => {
      const next = { ...prev };
      delete next[uid];
      return next;
    });
  };

  const grandTotal = useMemo(() => items.reduce((s, it) => s + it.totalPrice, 0), [items]);

  const isValid = useMemo(() => {
    if (!vendorId || !date) return false;
    return items.every(it => it.materialName.trim() && it.unit.trim() && it.quantity > 0 && it.pricePerUnit > 0);
  }, [vendorId, date, items]);

  const isViewMode = mode === 'view';

  // P-02: "was the purchase now on screen created in this run?" — the difference between finishing
  // one you were entering (clear and move to the next) and posting one you deliberately opened
  // from the list (stay on it). Set when create() succeeds, cleared by handleNew() and by loading
  // any existing purchase. Same rule as SaleBillPage's SB-05.
  const createdInThisRun = useRef(false);

  const handleNew = () => {
    setMode('new');
    // P-02: a blank form has nothing saved in it yet, so nothing to clear on post.
    createdInThisRun.current = false;
    setPurchaseId(null);
    setCurrentIsPosted(false);
    setDate(getTodayDate());
    setVendorId('');
    setBillNo('');
    setRemarks('');
    setItems([emptyItem()]);
    setCustomUnitRows({});
    setErrorMsg('');
  };

  // P-02: a finished purchase clears straight back to a blank one so the next can be typed
  // immediately. Reuses handleNew() so "a blank purchase" stays defined once, then restores the
  // working date — handleNew() snaps to today, and a run of purchases entered for an earlier date
  // would otherwise reset on every one. Cursor returns to the first field via the G-01 rule.
  const readyForNextPurchase = () => {
    const workingDate = date;
    handleNew();
    setDate(workingDate);
  };

  const buildPayload = (): PurchaseCreateInput | null => {
    if (!vendorId) { setErrorMsg('Vendor is required.'); return null; }
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (!isValid) { setErrorMsg('Every line item needs a material name, unit, quantity, and price per unit.'); return null; }

    const itemsPayload: PurchaseItemInput[] = items.map(it => ({
      material_name: it.materialName.trim(),
      unit: it.unit,
      quantity: it.quantity,
      price_per_unit: it.pricePerUnit
    }));

    return {
      vendor_id: Number(vendorId),
      purchase_date: date,
      bill_no: billNo.trim() || undefined,
      remarks: remarks.trim() || undefined,
      items: itemsPayload
    };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    const result = mode === 'edit' && purchaseId != null
      ? await api.purchases.update(purchaseId, payload)
      : await api.purchases.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save purchase: ' + result.error.message);
      return;
    }

    setPurchaseId(result.data.purchase_id);
    setCurrentIsPosted(result.data.is_posted);
    // P-02: only a freshly created purchase counts as "part of this run" — an edit of an existing
    // one must not clear the form out from under the user when it posts.
    if (mode !== 'edit') createdInThisRun.current = true;
    setErrorMsg('');
    setSuccessMsg(mode === 'edit' ? 'Purchase updated successfully.' : 'Purchase recorded successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    refreshPurchases();
    refreshUnposted(); // P-03: a newly saved purchase joins the pending-posting list immediately.
  };

  const loadPurchaseRow = async (rowIn: PurchaseRow) => {
    // list() rows never carry items/an accurate is_posted (plain SELECT * — only get()/create()/
    // update()/post()/unpost() compute those) — re-fetch the full record whenever items are missing.
    // P-02: this purchase came from the list, not from this run — posting it must not clear the form.
    createdInThisRun.current = false;

    let row = rowIn;
    if (!row.items) {
      const res = await api.purchases.get(row.purchase_id);
      if (!res.ok) {
        setErrorMsg('Failed to load purchase: ' + res.error.message);
        return;
      }
      row = res.data;
    }

    setPurchaseId(row.purchase_id);
    setCurrentIsPosted(row.is_posted);
    setDate(row.purchase_date.slice(0, 10));
    setVendorId(String(row.vendor_id));
    setBillNo(row.bill_no || '');
    setRemarks(row.remarks || '');
    setItems(row.items.length
      ? row.items.map(it => ({
          uid: 'pui_' + it.item_id,
          materialName: it.material_name || '',
          unit: it.unit,
          quantity: it.quantity,
          pricePerUnit: it.price_per_unit,
          totalPrice: it.total_price
        }))
      : [emptyItem()]);
    setErrorMsg('');
    setMode('view');
  };

  const handlePost = async () => {
    if (purchaseId == null) return;
    const postedBillNo = billNo.trim();
    const res = await api.purchases.post(purchaseId);
    if (!res.ok) {
      setErrorMsg('Failed to post purchase: ' + res.error.message);
      return;
    }
    setCurrentIsPosted(true);
    // P-02: clear for the next purchase only if this one was entered in this run — one opened
    // from the list and posted there stays on screen. The message names the document, because
    // once the form empties the clearing is otherwise the only sign anything was saved.
    if (createdInThisRun.current) {
      setSuccessMsg(`Purchase ${postedBillNo || `#${purchaseId}`} posted. Ready for the next one.`);
      readyForNextPurchase();
    } else {
      setSuccessMsg('Purchase posted successfully.');
    }
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshPurchases();
    refreshUnposted(); // P-03: it just left the pending list.
  };

  // P-03: post the whole run. Each purchase posts in its own transaction on the backend, so one
  // that can't post leaves the rest posted — hence reading `failed` rather than treating a
  // resolved call as "all done".
  const handlePostAll = async () => {
    setPostAllBusy(true);
    setPostAllResult(null);
    const res = await api.purchases.postAll();
    setPostAllBusy(false);

    if (!res.ok) {
      setErrorMsg('Failed to post purchases: ' + res.error.message);
      return;
    }
    setPostAllResult(res.data);
    if (res.data.failed.length === 0) {
      setSuccessMsg(`${res.data.posted.length} purchase(s) posted.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    await Promise.all([refreshUnposted(), refreshPurchases()]);
    if (purchaseId != null && res.data.posted.some(p => p.purchase_id === purchaseId)) setCurrentIsPosted(true);
  };

  const handleUnpost = async () => {
    if (purchaseId == null) return;
    const res = await api.purchases.unpost(purchaseId);
    if (!res.ok) {
      setErrorMsg('Failed to unpost purchase: ' + res.error.message);
      return;
    }
    setCurrentIsPosted(false);
    setSuccessMsg('Purchase unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshPurchases();
  };

  const sortedPurchases = useMemo(() => {
    return [...purchases].sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));
  }, [purchases]);

  return (
    <AppLayout pageTitle="Purchase Entry">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {lookupError && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{lookupError}</div>
        )}
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
        )}

        {/* P-03: Pending Posting panel — enter a run of purchases, then post them all at the end
            instead of one at a time. Mirrors SB-06 on the Sale Bill screen. */}
        {(unpostedPurchases.length > 0 || postAllResult) && (
          <div className="mb-6 p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm" data-no-print>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">Pending Posting:</span>
                <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                  {unpostedPurchases.length} purchase(s)
                </span>
                <span className="text-xs text-slate-500">
                  {unpostedPurchases.length > 0 && `Total ${formatCurrency(unpostedPurchases.reduce((s, p) => s + Number(p.total_value), 0))}`}
                </span>
              </div>
              {unpostedPurchases.length > 0 && (
                <button
                  type="button"
                  onClick={handlePostAll}
                  disabled={postAllBusy}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {postAllBusy ? 'Posting…' : `Post All (${unpostedPurchases.length})`}
                </button>
              )}
            </div>

            {unpostedPurchases.length > 0 && (
              <ul className="mt-3 space-y-0.5 max-h-32 overflow-y-auto">
                {unpostedPurchases.map(p => (
                  <li key={p.purchase_id} className="text-xs text-slate-600 flex gap-2">
                    <span className="font-mono font-semibold">{p.bill_no || `#${p.purchase_id}`}</span>
                    <span className="text-slate-400">{formatDate(p.purchase_date)}</span>
                    <span className="truncate">{p.vendor_name || 'Unnamed Vendor'}</span>
                    <span className="ml-auto font-mono">{formatCurrency(Number(p.total_value))}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Stays until dismissed — a run can post 18 of 20, and the two that failed are the
                whole point of the message. Never auto-hidden on a timer. */}
            {postAllResult && (
              <div className="mt-3 pt-3 border-t border-amber-200">
                <p className="text-xs font-semibold text-slate-700">
                  {postAllResult.posted.length} of {postAllResult.attempted} posted
                  {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                </p>
                {postAllResult.failed.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {postAllResult.failed.map(f => (
                      <li key={f.purchase_id} className="text-xs text-rose-700">
                        <span className="font-mono font-semibold">{f.bill_no || `#${f.purchase_id}`}</span>
                        {' — '}{f.message}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setPostAllResult(null)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-semibold"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSave} className="card-white p-6 bg-white border mb-8" data-no-print>
          <div className="flex items-center justify-between border-b pb-3 mb-5">
            <div className="flex items-center gap-2">
              <ShoppingBag size={18} className="text-[#B08D57]" />
              <h3 className="font-lora font-semibold text-lg text-slate-800">Raw Material Purchase</h3>
            </div>
            {mode === 'view' && (
              <div className="flex items-center gap-2">
                {!currentIsPosted && (
                  <button
                    type="button"
                    onClick={() => setMode('edit')}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5"
                  >
                    <Edit size={13} /> Edit
                  </button>
                )}
                {!currentIsPosted ? (
                  <button
                    type="button"
                    onClick={handlePost}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                  >
                    Post
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleUnpost}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
                  >
                    Unpost
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleNew}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                >
                  New Purchase
                </button>
              </div>
            )}
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="date"
                value={date}
                disabled={isViewMode}
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
                {!isViewMode && (
                  <button
                    type="button"
                    onClick={() => setIsAddVendorOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102"
                  >
                    <Plus size={12} className="text-blue-600" />
                    <span>Add New Vendor</span>
                  </button>
                )}
              </div>
              <SearchableSelect
                options={vendorOptions}
                value={vendorId}
                onChange={setVendorId}
                placeholder="Select vendor..."
                searchPlaceholder="Search vendors..."
                disabled={isViewMode}
              />
              {selectedVendor && (
                <p className="text-[11px] text-slate-400 mt-1">
                  {selectedVendor.phone || 'No Phone'} {selectedVendor.city_id != null ? `· ${cities.find(c => c.city_id === selectedVendor.city_id)?.name || ''}` : ''}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor Bill No.</label>
              <input
                type="text"
                value={billNo}
                disabled={isViewMode}
                onChange={e => setBillNo(e.target.value)}
                placeholder="Vendor's own invoice #..."
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
              <input
                type="text"
                value={remarks}
                disabled={isViewMode}
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
                  <tr key={item.uid} className="border-b hover:bg-slate-50/55 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4">
                      <input
                        type="text"
                        value={item.materialName}
                        disabled={isViewMode}
                        onChange={e => updateItem(item.uid, 'materialName', e.target.value)}
                        placeholder="e.g. PU Sheet Roll"
                        className="soleria-input font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3">
                      {customUnitRows[item.uid] ? (
                        <input
                          type="text"
                          value={item.unit}
                          disabled={isViewMode}
                          onChange={e => updateItem(item.uid, 'unit', e.target.value)}
                          placeholder="Type unit..."
                          autoFocus
                          onBlur={() => {
                            if (!item.unit.trim()) {
                              setCustomUnitRows(prev => ({ ...prev, [item.uid]: false }));
                              updateItem(item.uid, 'unit', UNIT_PRESETS[0]);
                            }
                          }}
                          className="soleria-input"
                          style={{ fontSize: '13px' }}
                        />
                      ) : (
                        <select
                          value={UNIT_PRESETS.includes(item.unit) ? item.unit : '__other__'}
                          disabled={isViewMode}
                          onChange={e => {
                            if (e.target.value === '__other__') {
                              setCustomUnitRows(prev => ({ ...prev, [item.uid]: true }));
                              updateItem(item.uid, 'unit', '');
                            } else {
                              updateItem(item.uid, 'unit', e.target.value);
                            }
                          }}
                          className="soleria-input cursor-pointer"
                          style={{ fontSize: '13px' }}
                        >
                          {UNIT_PRESETS.map(u => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                          <option value="__other__">
                            {UNIT_PRESETS.includes(item.unit) ? 'Other (type manually)...' : item.unit || 'Other (type manually)...'}
                          </option>
                        </select>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <input
                        type="number"
                        min={0}
                        value={item.quantity || ''}
                        disabled={isViewMode}
                        onChange={e => updateItem(item.uid, 'quantity', Number(e.target.value))}
                        className="soleria-input text-center font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3 text-center">
                      <input
                        type="number"
                        min={0}
                        value={item.pricePerUnit || ''}
                        disabled={isViewMode}
                        onChange={e => updateItem(item.uid, 'pricePerUnit', Number(e.target.value))}
                        className="soleria-input text-center font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3 text-right font-bold text-slate-800">
                      {formatCurrency(item.totalPrice)}
                    </td>
                    <td className="p-3 text-center">
                      {!isViewMode && (
                        <button
                          type="button"
                          onClick={() => removeItemRow(item.uid)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Remove Row"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
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

          {!isViewMode && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addItemRow}
                className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm"
              >
                <Plus size={16} /> Add Line Item
              </button>
              <div className="flex items-center gap-2">
                {mode === 'edit' && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (purchaseId == null) return;
                      const res = await api.purchases.get(purchaseId);
                      if (res.ok) await loadPurchaseRow(res.data);
                    }}
                    className="btn-outline px-4 py-2 text-sm font-semibold"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  type="submit"
                  className="btn-gold flex items-center gap-1.5 px-6 py-2.5 text-sm font-bold"
                >
                  <Save size={16} /> {mode === 'edit' ? 'Update Purchase' : 'Save Purchase'}
                </button>
              </div>
            </div>
          )}
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
                    <th className="p-3">Bill No.</th>
                    <th className="p-3">Remarks</th>
                    <th className="p-3 text-right">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPurchases.map(p => {
                    const vendorName = vendors.find(v => v.vendor_id === p.vendor_id)?.name || 'Unknown Vendor';
                    return (
                      <tr
                        key={p.purchase_id}
                        onClick={() => loadPurchaseRow(p)}
                        className="border-b hover:bg-slate-50/40 cursor-pointer"
                        style={{ borderColor: 'var(--border-table)' }}
                      >
                        <td className="p-3 pl-4 font-mono">{formatDate(p.purchase_date)}</td>
                        <td className="p-3 font-semibold text-slate-700">{vendorName}</td>
                        <td className="p-3 text-xs text-slate-500">{p.bill_no || '-'}</td>
                        <td className="p-3 text-xs text-slate-500">{p.remarks || '-'}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(p.total_value)}</td>
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
                  onChange={e => { setNewVendorRegionId(e.target.value); setNewVendorCityId(''); }}
                  className="soleria-input cursor-pointer font-semibold"
                  required
                >
                  <option value="">Select Region...</option>
                  {regions.map(rg => (
                    <option key={rg.region_id} value={rg.region_id}>{rg.name}</option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  City
                </label>
                <select
                  value={newVendorCityId}
                  onChange={e => setNewVendorCityId(e.target.value)}
                  className="soleria-input cursor-pointer font-semibold"
                >
                  <option value="">Select City...</option>
                  {cities
                    .filter(ct => !newVendorRegionId || ct.region_id === Number(newVendorRegionId))
                    .map(ct => (
                      <option key={ct.city_id} value={ct.city_id}>{ct.name}</option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddVendorOpen(false);
                    setNewVendorName('');
                    setNewVendorPhone('');
                    setNewVendorRegionId('');
                    setNewVendorCityId('');
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
