import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type {
  VendorRow, RegionRow, CityRow, PurchaseRow, PurchaseCreateInput, PurchaseItemInput,
  DraftPurchaseRow, ConfirmAllResult
} from '@/lib/api';
import { formatDate, getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import { focusFirstField } from '@/lib/fieldNav';
import { useHeldKey } from '@/hooks/useHeldKey';
import { Plus, Trash2, Save, ShoppingBag, Edit, CheckCircle2 } from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';

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

  // Option lists for the vendor quick-add, converted off native <select>. citiesInRegion keeps the
  // dependent filtering: pick a region and the city list narrows to it, no region means all.
  const regionOptions = useMemo(
    () => regions.map(rg => ({ value: String(rg.region_id), label: rg.name })),
    [regions]
  );
  const citiesInRegion = useCallback(
    (regionId: string) =>
      cities
        .filter(ct => !regionId || ct.region_id === Number(regionId))
        .map(ct => ({ value: String(ct.city_id), label: ct.name })),
    [cities]
  );
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  const refreshPurchases = useCallback(async () => {
    const res = await api.purchases.list({});
    if (res.ok) setPurchases(res.data);
    else setLookupError('Failed to load purchases: ' + res.error.message);
  }, []);

  // Every saved-unposted purchase now lives in draft_purchases — the real purchases table
  // strictly never holds an unposted document (same architecture change as Sale Bill/Sale
  // Return). Mirrors SB-06 on SaleBillPage.
  const [unpostedPurchases, setUnpostedPurchases] = useState<DraftPurchaseRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<ConfirmAllResult | null>(null);
  const [postingDraftId, setPostingDraftId] = useState<number | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.draftPurchases.list();
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
  // Explicit ref + focus, not AppLayout's own G-01 auto-focus effect: that effect only re-scans
  // when a <form> is newly INSERTED into the DOM (page mount, or a MutationObserver catching one
  // appearing later) — it does not re-run just because this page's own state resets while the form
  // stays mounted the whole time. Mirrors the identical fix on SaleBillPage's readyForNextBill,
  // after the same symptom was reported there: the form cleared correctly, but focus never
  // returned to the first field.
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const readyForNextPurchase = () => {
    const workingDate = date;
    handleNew();
    setDate(workingDate);
    requestAnimationFrame(() => firstFieldRef.current?.focus());
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

  // Editing a POSTED purchase in place was never allowed here (purchases.service.js#update()
  // always throws POSTED_LOCK on an is_posted row) — must unpost first, same as before. So under
  // the draft-table model, mode==='edit' unconditionally means editing a draft: there's no
  // "isEditingPosted" branch to worry about the way Sale Bill/Return have one.
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    const result = mode === 'edit' && purchaseId != null
      ? await api.draftPurchases.update(purchaseId, payload)
      : await api.draftPurchases.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save purchase: ' + result.error.message);
      return;
    }

    setPurchaseId(result.data.draft_id);
    setCurrentIsPosted(false);
    // P-02: only a freshly created purchase counts as "part of this run" — an edit of an existing
    // one must not clear the form out from under the user when it posts.
    const isNewPurchase = mode !== 'edit';
    if (isNewPurchase) createdInThisRun.current = true;
    setErrorMsg('');
    setSuccessMsg(mode === 'edit' ? 'Purchase updated successfully.' : 'Purchase recorded successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    refreshUnposted(); // P-03: a newly saved purchase joins the pending-posting list immediately.

    // P-02: a plain Save is also "done with this purchase" — matches the same fix on
    // SaleBillPage. The workflow is save each purchase as a draft, then Post All at the end
    // (P-03), so resetting only after Post (not after a plain Save) left the form sitting on
    // the saved purchase instead of being ready for the next one.
    if (isNewPurchase) readyForNextPurchase();
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

  // Post = confirm the draft: moves it from draft_purchases into the real purchases table,
  // writing ledger + vendor stock, deleting the draft. Only reachable while !currentIsPosted, so
  // purchaseId is always a draft_id here.
  const handlePost = async () => {
    if (purchaseId == null) return;
    const postedBillNo = billNo.trim();
    const res = await api.draftPurchases.confirm(purchaseId);
    if (!res.ok) {
      setErrorMsg('Failed to post purchase: ' + res.error.message);
      return;
    }
    setPurchaseId(res.data.purchase_id);
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

  // P-03: post the whole run via the real backend batch endpoint (draftPurchases.confirmAll).
  const handlePostAll = async () => {
    setPostAllBusy(true);
    setPostAllResult(null);
    const res = await api.draftPurchases.confirmAll();
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
    // The draft open on screen (if any) may have just been posted — its id is gone either way
    // (ConfirmAllResult doesn't carry the new purchase_id back), so reset rather than leave the
    // form pointed at nothing.
    if (purchaseId != null && !currentIsPosted && res.data.posted.some(p => p.draft_id === purchaseId)) {
      handleNew();
    }
  };

  // "Unpost" now moves the purchase back to being a draft — the real purchases table strictly
  // never holds an unposted document. The form now points at a different id (the new draft's).
  const handleUnpost = async () => {
    if (purchaseId == null) return;
    const res = await api.purchases.unconfirm(purchaseId);
    if (!res.ok) {
      setErrorMsg('Failed to unpost purchase: ' + res.error.message);
      return;
    }
    setPurchaseId(res.data.draft_id);
    setCurrentIsPosted(false);
    setSuccessMsg('Purchase unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshPurchases();
    refreshUnposted();
  };

  // Pending Posting panel: opening a row loads that draft straight into the form — no password
  // (drafts never needed one on this page; only a password-gated delete is new, below).
  const loadDraftIntoForm = (draft: DraftPurchaseRow) => {
    createdInThisRun.current = false;
    setPurchaseId(draft.draft_id);
    setCurrentIsPosted(false);
    setDate(draft.purchase_date.slice(0, 10));
    setVendorId(String(draft.vendor_id));
    setBillNo(draft.bill_no || '');
    setRemarks(draft.remarks || '');
    setItems((draft.items || []).length
      ? (draft.items || []).map(it => ({
          uid: 'draftrow_' + it.line_no,
          materialName: it.material_name || '',
          unit: it.unit,
          quantity: it.quantity,
          pricePerUnit: it.price_per_unit,
          totalPrice: it.total_price
        }))
      : [emptyItem()]);
    setErrorMsg('');
    setMode('edit');
  };

  const handleOpenUnposted = async (draftId: number) => {
    const res = await api.draftPurchases.get(draftId);
    if (!res.ok) {
      setErrorMsg('Failed to load purchase: ' + res.error.message);
      return;
    }
    loadDraftIntoForm(res.data);
    setActiveTab('entry');
  };

  const handlePostOneUnposted = async (draftId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPostingDraftId(draftId);
    const res = await api.draftPurchases.confirm(draftId);
    setPostingDraftId(null);
    if (!res.ok) {
      setErrorMsg('Failed to post purchase: ' + res.error.message);
      return;
    }
    setSuccessMsg(`Purchase ${res.data.bill_no || `#${res.data.purchase_id}`} posted.`);
    setTimeout(() => setSuccessMsg(''), 3000);
    await Promise.all([refreshUnposted(), refreshPurchases()]);
    if (draftId === purchaseId && !currentIsPosted) {
      setPurchaseId(res.data.purchase_id);
      setCurrentIsPosted(true);
    }
  };

  // Password-gated (verified server-side) — deleting a saved-unposted purchase is destructive
  // with no reverse-never-erase trail, same guard level used on Sale Bill/Sale Return.
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const pendingDeleteDraftId = useRef<number | null>(null);

  const handleDeleteUnposted = (draftId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    pendingDeleteDraftId.current = draftId;
    setIsPasswordModalOpen(true);
  };

  const handleDeletePasswordSuccess = async (password: string) => {
    setIsPasswordModalOpen(false);
    const targetId = pendingDeleteDraftId.current;
    pendingDeleteDraftId.current = null;
    if (targetId == null) return;
    const res = await api.draftPurchases.remove(targetId, password);
    if (!res.ok) {
      setErrorMsg('Failed to delete purchase: ' + res.error.message);
      return;
    }
    setSuccessMsg('Purchase deleted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    if (purchaseId === targetId && !currentIsPosted) handleNew();
    refreshUnposted();
  };

  // Recorded Purchases (the tab below) shows only POSTED purchases — an unposted one hasn't
  // actually happened yet (no ledger effect, stock only reserved), so it doesn't belong in the
  // vendor's purchase record; it stays reachable via the Pending Posting panel above instead,
  // same split as Sale Bill/Sale Return. Reported directly by the user after the identical fix
  // on VendorSetupPage's purchase-history modal.
  const sortedPurchases = useMemo(() => {
    return [...purchases].filter(p => p.is_posted).sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));
  }, [purchases]);

  // Recorded Purchases moved to its own tab (was inline under the entry form on the same page —
  // every purchase ever recorded rendering directly below a live entry form doesn't scale and
  // pushed the whole page well past one screen). Date-range filter, defaulting to the last three
  // months (today down to three months ago) rather than "everything" — both fields stay editable
  // and clearable, so either one blank means "no lower/upper bound" once touched.
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');
  const [recordsDateFrom, setRecordsDateFrom] = useState(getThreeMonthsAgoDate());
  const [recordsDateTo, setRecordsDateTo] = useState(getTodayDate());

  const filteredPurchases = useMemo(() => {
    return sortedPurchases.filter(p => {
      const d = p.purchase_date.slice(0, 10);
      if (recordsDateFrom && d < recordsDateFrom) return false;
      if (recordsDateTo && d > recordsDateTo) return false;
      return true;
    });
  }, [sortedPurchases, recordsDateFrom, recordsDateTo]);

  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('entry'); handleNew(); }}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Purchase
      </button>
      <button
        onClick={() => setActiveTab('records')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'records' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Recorded Purchases
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Purchase Entry" headerAction={tabBar}>
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
        <>
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
              <ul className="mt-3 space-y-0.5 max-h-40 overflow-y-auto">
                {unpostedPurchases.map(p => (
                  <li
                    key={p.draft_id}
                    onClick={() => handleOpenUnposted(p.draft_id)}
                    className="text-xs text-slate-600 flex items-center gap-2 cursor-pointer hover:bg-amber-100/50 rounded px-1 py-0.5 -mx-1"
                  >
                    <span className="font-mono font-semibold">{p.bill_no || `#${p.draft_id}`}</span>
                    <span className="text-slate-400">{formatDate(p.purchase_date)}</span>
                    <span className="truncate">{vendors.find(v => v.vendor_id === p.vendor_id)?.name || 'Unnamed Vendor'}</span>
                    <span className="ml-auto font-mono">{formatCurrency(Number(p.total_value))}</span>
                    <button
                      type="button"
                      title="Post this purchase"
                      onClick={(e) => handlePostOneUnposted(p.draft_id, e)}
                      disabled={postingDraftId === p.draft_id}
                      className="flex-shrink-0 p-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      <CheckCircle2 size={12} />
                    </button>
                    <button
                      type="button"
                      title="Delete this purchase (password required)"
                      onClick={(e) => handleDeleteUnposted(p.draft_id, e)}
                      disabled={postingDraftId === p.draft_id}
                      className="flex-shrink-0 p-1 rounded bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
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
                      <li key={f.draft_id} className="text-xs text-rose-700">
                        <span className="font-mono font-semibold">{f.bill_no || `#${f.draft_id}`}</span>
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
            {/* Save/Update — moved up here from below the item table, matching SaleBillPage/
                SaleReturnPage: the primary action shouldn't require scrolling past the whole
                item table to reach. */}
            {!isViewMode && (
              <div className="flex items-center gap-2">
                {mode === 'edit' && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (purchaseId == null) return;
                      const res = await api.purchases.get(purchaseId);
                      if (res.ok) await loadPurchaseRow(res.data);
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
                  <Save size={14} /> {mode === 'edit' ? 'Update Purchase' : 'Save Purchase'}
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
                ref={firstFieldRef}
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

          {/* Line items — capped to roughly 8 rows tall, then scrolls internally rather than
              growing the card past the screen as more rows are added (same treatment as
              SaleBillPage/SaleReturnPage's item tables, just a taller cap — a purchase bill
              routinely lists more distinct materials than a sale bill lists articles). The header
              row is `sticky` within the scroll box so column labels stay visible past row 8. */}
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
        </>
        )}

        {/* Recorded Purchases — own tab now, with a from/to date filter, rather than always
            rendering every purchase ever recorded inline below the live entry form. */}
        {activeTab === 'records' && (
        <div className="card-white p-6 bg-white border">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h3 className="font-lora font-semibold text-lg text-slate-800">Recorded Purchases</h3>
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
          {filteredPurchases.length === 0 ? (
            <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
              {sortedPurchases.length === 0 ? 'No purchases recorded yet.' : 'No purchases in this date range.'}
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
                  {filteredPurchases.map(p => {
                    const vendorName = vendors.find(v => v.vendor_id === p.vendor_id)?.name || 'Unknown Vendor';
                    return (
                      <tr
                        key={p.purchase_id}
                        onClick={() => { loadPurchaseRow(p); setActiveTab('entry'); }}
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
        )}

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
                <SearchableSelect
                  options={regionOptions}
                  value={newVendorRegionId}
                  onChange={val => { setNewVendorRegionId(val); setNewVendorCityId(''); }}
                  placeholder="Select Region..."
                  searchPlaceholder="Search regions..."
                />
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  City
                </label>
                <SearchableSelect
                  options={citiesInRegion(newVendorRegionId)}
                  value={newVendorCityId}
                  onChange={setNewVendorCityId}
                  placeholder="Select City..."
                  searchPlaceholder="Search cities..."
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

        <PasswordPromptModal
          isOpen={isPasswordModalOpen}
          onClose={() => { setIsPasswordModalOpen(false); pendingDeleteDraftId.current = null; }}
          onSuccess={handleDeletePasswordSuccess}
          title="Delete Unposted Purchase"
          subtitle="Enter your password to permanently delete this unposted purchase."
        />

      </div>
    </AppLayout>
  );
}
