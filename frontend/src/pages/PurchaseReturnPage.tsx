import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { VendorRow, CityRow, PurchaseRow, PurchaseReturnRow, PurchaseReturnCreateInput, PurchaseReturnItemInput } from '@/lib/api';
import { formatDate, getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import { focusFirstField } from '@/lib/fieldNav';
import { useHeldKey } from '@/hooks/useHeldKey';
import { Plus, Trash2, Save, Undo2, Edit } from 'lucide-react';

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
    uid: 'pri_' + Date.now() + Math.random().toString(36).slice(2, 7),
    materialName: '',
    unit: 'Meters',
    quantity: 0,
    pricePerUnit: 0,
    totalPrice: 0
  };
}

export default function PurchaseReturnPage() {
  // ── Real lookup / list data ──
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [priorPurchases, setPriorPurchases] = useState<PurchaseRow[]>([]);
  const [returns, setReturns] = useState<PurchaseReturnRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  const refreshReturns = useCallback(async () => {
    const res = await api.purchaseReturns.list({});
    if (res.ok) setReturns(res.data);
    else setLookupError('Failed to load purchase returns: ' + res.error.message);
  }, []);

  useEffect(() => {
    (async () => {
      const [v, ct, pu] = await Promise.all([api.listVendors(), api.listCities(), api.purchases.list({})]);
      const failures: string[] = [];
      if (v.ok) setVendors(v.data); else failures.push(v.error.message);
      if (ct.ok) setCities(ct.data); else failures.push(ct.error.message);
      if (pu.ok) setPriorPurchases(pu.data); else failures.push(pu.error.message);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
    refreshReturns();
  }, [refreshReturns]);

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');

  const [returnId, setReturnId] = useState<number | null>(null);
  const [currentIsPosted, setCurrentIsPosted] = useState(false);
  const [date, setDate] = useState(getTodayDate());
  const [vendorId, setVendorId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<UiItem[]>([emptyItem()]);
  const [customUnitRows, setCustomUnitRows] = useState<Record<string, boolean>>({});
  const [copyFromPurchaseId, setCopyFromPurchaseId] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const vendorOptions = useMemo(() => {
    return vendors.map(v => {
      const cityName = cities.find(c => c.city_id === v.city_id)?.name;
      return { value: String(v.vendor_id), label: `${v.name}${cityName ? ' — ' + cityName : ''}` };
    });
  }, [vendors, cities]);

  const selectedVendor = useMemo(() => {
    return vendors.find(v => v.vendor_id === Number(vendorId));
  }, [vendorId, vendors]);

  // Prior purchases from this vendor, to optionally prefill a return
  const priorPurchaseOptions = useMemo(() => {
    return priorPurchases
      .filter(p => !vendorId || p.vendor_id === Number(vendorId))
      .map(p => ({
        value: String(p.purchase_id),
        label: `${formatDate(p.purchase_date)} — ${formatCurrency(p.total_value)}`
      }));
  }, [priorPurchases, vendorId]);

  const handleCopyFromPurchase = async (purchaseIdStr: string) => {
    setCopyFromPurchaseId(purchaseIdStr);
    if (!purchaseIdStr) return;
    // list() rows never carry items — fetch the full record before cloning its line items.
    const res = await api.purchases.get(Number(purchaseIdStr));
    if (!res.ok) {
      setErrorMsg('Failed to load prior purchase: ' + res.error.message);
      return;
    }
    const purchase = res.data;
    setVendorId(String(purchase.vendor_id));
    const copied = purchase.items.map(it => ({
      uid: 'pri_' + Date.now() + Math.random().toString(36).slice(2, 7),
      materialName: it.material_name || '',
      unit: it.unit,
      quantity: it.quantity,
      pricePerUnit: it.price_per_unit,
      totalPrice: it.total_price
    }));
    setItems(copied);
    // PR-01: these lines are copied straight off the source purchase, so they already carry that
    // purchase's own rates — which beats "the last posted purchase of this material" when the two
    // differ. Mark them resolved so tabbing through the name fields doesn't re-look-up and
    // replace a rate taken from the very document being returned.
    resolvedNames.current = Object.fromEntries(copied.map(it => [it.uid, it.materialName.trim()]));
  };

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

  // PR-01: a return must credit the vendor at the price actually paid, not at whatever the user
  // happens to type. When a line's material name is finished (blur), look up what this vendor was
  // last paid for it on a POSTED purchase and fill in that price and its unit.
  //
  // Keyed off blur rather than every keystroke: the name is free text, so mid-typing it names
  // nothing. `resolvedNames` remembers the name each row was last filled from, so re-blurring an
  // unchanged field never overwrites a price the user has since edited by hand — while genuinely
  // changing the material does refill. Cleared when the vendor changes, since the same material
  // has a different price per vendor.
  const resolvedNames = useRef<Record<string, string>>({});

  const fillRateFromLastPurchase = async (uid: string, rawName: string) => {
    const name = rawName.trim();
    if (!name || !vendorId) return;
    if (resolvedNames.current[uid] === name) return;
    resolvedNames.current[uid] = name;

    const res = await api.purchases.lastPurchasedRate(Number(vendorId), name);
    // No prior posted purchase (data === null) leaves the line exactly as typed — a first-time
    // material legitimately has no history, and guessing a price would be worse than leaving it.
    if (!res.ok || !res.data) return;
    const { price_per_unit, unit } = res.data;

    setItems(prev => prev.map(it => it.uid === uid
      ? { ...it, pricePerUnit: price_per_unit, unit, totalPrice: Number(it.quantity) * price_per_unit }
      : it));
    // Keep the unit control in sync: a fetched unit outside the presets needs the free-text box
    // showing, or the select would silently snap the line back to a preset.
    setCustomUnitRows(prev => ({ ...prev, [uid]: !UNIT_PRESETS.includes(unit) }));
  };

  const addItemRow = () => setItems(prev => [...prev, emptyItem()]);

  // Keyboard entry without the mouse — same pattern as SaleBillPage/SaleReturnPage. G-01's generic
  // Enter-walk already carries fields forward within a row and into an EXISTING next row; this only
  // steps in at the boundary (Enter on the last field of the last row), where it appends a blank row
  // and focuses into it. stopPropagation stops AppLayout's own window-level Enter handler from also
  // firing on the same keydown and clicking Save before the new row exists.
  const materialNameRefs = useRef<(HTMLInputElement | null)[]>([]);
  // '.' held while Enter is pressed is a genuine three-way chord alongside Shift+Enter/Ctrl+Enter
  // below — tracked via useHeldKey since '.' isn't a real modifier key with its own event flag.
  // Typing '.' alone (a decimal point) never triggers this: by the time Enter is a separate,
  // later keypress, '.' has already been released. Any single stray "." that types into the field
  // during the chord itself is harmless — the input is fully controlled by the numeric state, so
  // the very next render overwrites it back to the real number regardless.
  const periodHeld = useHeldKey('.');

  function handleLastFieldKeyDown(e: React.KeyboardEvent) {
    // Plain Enter is deliberately left alone here: it now does exactly what every other field
    // does — walk to whatever's next via AppLayout's own G-01 handler, and eventually reach
    // Save/Post. An earlier version hijacked it to always append a new line, which meant a plain
    // Enter on the last field could never actually finish and save a bill — reported directly by
    // the user after trying it.
    //
    // Adding a line is its own explicit action instead: Shift+Enter, Ctrl+Enter, or '.'+Enter, from
    // the last field of ANY row (not only the last one) — always appends at the end, same as the
    // "+ Add Item Row" button, and focuses into the new row. Shift+Enter is distinct from its
    // other meaning inside a Remarks textarea (insert a literal newline) — different field, no
    // collision.
    if (e.key !== 'Enter' || !(e.shiftKey || e.ctrlKey || periodHeld.current)) return;
    e.preventDefault();
    e.stopPropagation(); // stop AppLayout's own Enter handler from also walking this keystroke
    const newRowIndex = items.length; // always the end, regardless of which row triggered this
    addItemRow();
    requestAnimationFrame(() => focusFirstField(materialNameRefs.current[newRowIndex]));
  }

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

  const handleNew = () => {
    setMode('new');
    setReturnId(null);
    setCurrentIsPosted(false);
    setDate(getTodayDate());
    setVendorId('');
    setBillNo('');
    setRemarks('');
    setItems([emptyItem()]);
    setCustomUnitRows({});
    setCopyFromPurchaseId('');
    setErrorMsg('');
  };

  const buildPayload = (): PurchaseReturnCreateInput | null => {
    if (!vendorId) { setErrorMsg('Vendor is required.'); return null; }
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (!isValid) { setErrorMsg('Every line item needs a material name, unit, quantity, and price per unit.'); return null; }

    const itemsPayload: PurchaseReturnItemInput[] = items.map(it => ({
      material_name: it.materialName.trim(),
      unit: it.unit,
      quantity: it.quantity,
      price_per_unit: it.pricePerUnit
    }));

    return {
      vendor_id: Number(vendorId),
      return_date: date,
      bill_no: billNo.trim() || undefined,
      remarks: remarks.trim() || undefined,
      items: itemsPayload
    };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    const result = mode === 'edit' && returnId != null
      ? await api.purchaseReturns.update(returnId, payload)
      : await api.purchaseReturns.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save purchase return: ' + result.error.message);
      return;
    }

    setReturnId(result.data.return_id);
    setCurrentIsPosted(result.data.is_posted);
    setErrorMsg('');
    setSuccessMsg(mode === 'edit' ? 'Purchase return updated successfully.' : 'Purchase return recorded successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    refreshReturns();
  };

  const loadReturnRow = async (rowIn: PurchaseReturnRow) => {
    // list() rows never carry items/an accurate is_posted (plain SELECT * — only get()/create()/
    // update()/post()/unpost() compute those) — re-fetch the full record whenever items are missing.
    let row = rowIn;
    if (!row.items) {
      const res = await api.purchaseReturns.get(row.return_id);
      if (!res.ok) {
        setErrorMsg('Failed to load purchase return: ' + res.error.message);
        return;
      }
      row = res.data;
    }

    setReturnId(row.return_id);
    setCurrentIsPosted(row.is_posted);
    setDate(row.return_date.slice(0, 10));
    setVendorId(String(row.vendor_id));
    setBillNo(row.bill_no || '');
    setRemarks(row.remarks || '');
    setCopyFromPurchaseId('');
    const loaded = row.items.length
      ? row.items.map(it => ({
          uid: 'pri_' + it.item_id,
          materialName: it.material_name || '',
          unit: it.unit,
          quantity: it.quantity,
          pricePerUnit: it.price_per_unit,
          totalPrice: it.total_price
        }))
      : [emptyItem()];
    setItems(loaded);
    // PR-01: an existing return's saved rates are the record — never re-priced on open/edit.
    resolvedNames.current = Object.fromEntries(loaded.map(it => [it.uid, it.materialName.trim()]));
    setErrorMsg('');
    setMode('view');
  };

  const handlePost = async () => {
    if (returnId == null) return;
    const res = await api.purchaseReturns.post(returnId);
    if (!res.ok) {
      setErrorMsg('Failed to post purchase return: ' + res.error.message);
      return;
    }
    setCurrentIsPosted(true);
    setSuccessMsg('Purchase return posted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshReturns();
  };

  const handleUnpost = async () => {
    if (returnId == null) return;
    const res = await api.purchaseReturns.unpost(returnId);
    if (!res.ok) {
      setErrorMsg('Failed to unpost purchase return: ' + res.error.message);
      return;
    }
    setCurrentIsPosted(false);
    setSuccessMsg('Purchase return unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshReturns();
  };

  const sortedReturns = useMemo(() => {
    return [...returns].sort((a, b) => b.return_date.localeCompare(a.return_date));
  }, [returns]);

  // Recorded Purchase Returns moved to its own tab (was inline under the entry form on the same
  // page, matching the identical PurchasePage fix). Date-range filter defaults to the last three
  // months rather than "everything"; both ends stay editable/clearable.
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');
  const [recordsDateFrom, setRecordsDateFrom] = useState(getThreeMonthsAgoDate());
  const [recordsDateTo, setRecordsDateTo] = useState(getTodayDate());

  const filteredReturns = useMemo(() => {
    return sortedReturns.filter(r => {
      const d = r.return_date.slice(0, 10);
      if (recordsDateFrom && d < recordsDateFrom) return false;
      if (recordsDateTo && d > recordsDateTo) return false;
      return true;
    });
  }, [sortedReturns, recordsDateFrom, recordsDateTo]);

  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('entry'); handleNew(); }}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Return
      </button>
      <button
        onClick={() => setActiveTab('records')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'records' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Recorded Purchase Returns
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Purchase Return" headerAction={tabBar}>
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

        {activeTab === 'entry' && (
        <form onSubmit={handleSave} className="card-white p-6 bg-white border mb-8" data-no-print>
          <div className="flex items-center justify-between border-b pb-3 mb-5">
            <div className="flex items-center gap-2">
              <Undo2 size={18} className="text-[#B08D57]" />
              <h3 className="font-lora font-semibold text-lg text-slate-800">Raw Material Purchase Return</h3>
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
                  New Return
                </button>
              </div>
            )}
            {/* Save/Update — moved up here from below the item table, matching
                SaleBillPage/SaleReturnPage/PurchasePage: the primary action shouldn't require
                scrolling past the whole item table to reach. */}
            {!isViewMode && (
              <div className="flex items-center gap-2">
                {mode === 'edit' && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (returnId == null) return;
                      const res = await api.purchaseReturns.get(returnId);
                      if (res.ok) await loadReturnRow(res.data);
                    }}
                    className="btn-outline px-3 py-1.5 text-xs font-semibold"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  type="submit"
                  className="btn-gold flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold"
                >
                  <Save size={14} /> {mode === 'edit' ? 'Update Return' : 'Save Purchase Return'}
                </button>
              </div>
            )}
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
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
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Vendor <span className="text-red-500 font-bold">*</span>
              </label>
              <SearchableSelect
                options={vendorOptions}
                value={vendorId}
                // PR-01: forget which names were already priced — the same material has a
                // different last-paid price under a different vendor, so every line re-looks-up.
                onChange={val => { setVendorId(val); setCopyFromPurchaseId(''); resolvedNames.current = {}; }}
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
            {!isViewMode && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Copy From Prior Purchase (optional)
                </label>
                {/* Was a native <select>. A vendor's purchase history can be long, so this is
                    exactly where typing to search beats scrolling. "Manual entry" is carried as a
                    real option rather than the placeholder, so it can be chosen again to go back. */}
                <SearchableSelect
                  options={[{ value: '', label: 'Manual entry (default)' }, ...priorPurchaseOptions]}
                  value={copyFromPurchaseId}
                  onChange={handleCopyFromPurchase}
                  placeholder="Manual entry (default)"
                  searchPlaceholder="Search prior purchases..."
                />
              </div>
            )}
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
                placeholder="Reason for return..."
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Line items — capped to roughly 8 rows tall, then scrolls internally rather than
              growing the card past the screen as more rows are added (mirrors PurchasePage's
              item table). The header row is `sticky` within the scroll box so column labels stay
              visible past row 8. */}
          <div className="mb-4 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)', maxHeight: '500px' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 pl-4" style={{ minWidth: '200px' }}>Material / Product Name <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3" style={{ width: '160px' }}>Unit <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-center" style={{ width: '110px' }}>Quantity <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-center" style={{ width: '130px' }}>Price / Unit <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-right" style={{ width: '130px' }}>Total Price</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-center" style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.uid} className="border-b hover:bg-slate-50/55 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4">
                      <input
                        type="text"
                        ref={el => { materialNameRefs.current[idx] = el; }}
                        value={item.materialName}
                        disabled={isViewMode}
                        onChange={e => updateItem(item.uid, 'materialName', e.target.value)}
                        // PR-01: fill the price/unit from this vendor's last posted purchase of
                        // this material once the name is finished.
                        onBlur={e => fillRateFromLastPurchase(item.uid, e.target.value)}
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
                        onKeyDown={handleLastFieldKeyDown}
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
            <button
              type="button"
              onClick={addItemRow}
              className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Add Line Item
            </button>
          )}
        </form>
        )}

        {/* Recorded Purchase Returns — own tab now, with a from/to date filter (defaults to the
            last three months), rather than always rendering every return inline below the live
            entry form. */}
        {activeTab === 'records' && (
        <div className="card-white p-6 bg-white border">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h3 className="font-lora font-semibold text-lg text-slate-800">Recorded Purchase Returns</h3>
            <div className="flex flex-wrap items-end gap-3" data-no-print>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
                <input
                  type="date"
                  value={recordsDateFrom}
                  onChange={e => setRecordsDateFrom(e.target.value)}
                  className="soleria-input"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
                <input
                  type="date"
                  value={recordsDateTo}
                  onChange={e => setRecordsDateTo(e.target.value)}
                  className="soleria-input"
                  style={{ fontSize: '13px' }}
                />
              </div>
              {(recordsDateFrom || recordsDateTo) && (
                <button
                  type="button"
                  onClick={() => { setRecordsDateFrom(''); setRecordsDateTo(''); }}
                  className="text-xs text-slate-500 hover:text-slate-700 font-semibold px-2 py-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {filteredReturns.length === 0 ? (
            <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
              {sortedReturns.length === 0 ? 'No purchase returns recorded yet.' : 'No purchase returns in this date range.'}
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
                  {filteredReturns.map(r => {
                    const vendorName = vendors.find(v => v.vendor_id === r.vendor_id)?.name || 'Unknown Vendor';
                    return (
                      <tr
                        key={r.return_id}
                        onClick={() => { loadReturnRow(r); setActiveTab('entry'); }}
                        className="border-b hover:bg-slate-50/40 cursor-pointer"
                        style={{ borderColor: 'var(--border-table)' }}
                      >
                        <td className="p-3 pl-4 font-mono">{formatDate(r.return_date)}</td>
                        <td className="p-3 font-semibold text-slate-700">{vendorName}</td>
                        <td className="p-3 text-xs text-slate-500">{r.bill_no || '-'}</td>
                        <td className="p-3 text-xs text-slate-500">{r.remarks || '-'}</td>
                        <td className="p-3 text-right font-bold text-rose-700">- {formatCurrency(r.total_value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

      </div>
    </AppLayout>
  );
}
