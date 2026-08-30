import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal from '@/components/SearchModal';
import * as api from '@/lib/api';
import type {
  VendorRow, RegionRow, CityRow, PurchaseRow, PurchaseCreateInput, PurchaseItemInput,
  DraftPurchaseRow, ConfirmAllResult
} from '@/lib/api';
import { formatDate, getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import { focusNextField } from '@/lib/fieldNav';
import {
  Plus, Trash2, Save, ShoppingBag, Edit, CheckCircle2, XCircle, Undo2, ChevronDown,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight
} from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';

const UNIT_PRESETS = ['Meters', 'Buckles', 'KG', 'Pieces', 'Rolls'];

interface UiItem {
  uid: string;
  materialName: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
  totalPrice: number;
}

// The live article-entry row (not yet committed to `items`) — matches the legacy Wentox desktop
// app (ref-pics/batch2/sale bill.png): one editable article field set above the grid, not one
// editable row per grid entry.
interface CurrentRow {
  materialName: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
}

function emptyCurrentRow(): CurrentRow {
  return { materialName: '', unit: 'Meters', quantity: 0, pricePerUnit: 0 };
}

function newItemUid(): string {
  return 'pui_' + Date.now() + Math.random().toString(36).slice(2, 7);
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
  // A New Purchase's own in-progress fields persist across switching pages AND an app restart
  // (usePersistentField — see src/hooks/usePersistentField.ts), so typing one up and getting
  // pulled away mid-entry never loses it. Deliberately NOT applied to mode/purchaseId/
  // currentIsPosted — an already-saved (or drafted) purchase loaded for view/edit is safely
  // re-openable by id at any time, so caching it risks showing a stale copy instead; only unsaved
  // "new" work is ever at real risk of being lost for good.
  const clearPurchaseDraft = useClearPageDraft('purchase');
  const [date, setDate] = usePersistentField('purchase', 'date', getTodayDate());
  const [vendorId, setVendorId] = usePersistentField('purchase', 'vendorId', '');
  const [billNo, setBillNo] = usePersistentField('purchase', 'billNo', '');
  const [remarks, setRemarks] = usePersistentField('purchase', 'remarks', '');
  // `items` holds only COMMITTED rows — the grid below the entry fields. The row currently being
  // typed lives separately in `currentRow` until Enter (or the Add button) commits it.
  const [items, setItems] = usePersistentField<UiItem[]>('purchase', 'items', []);
  const [currentRow, setCurrentRow] = usePersistentField<CurrentRow>('purchase', 'currentRow', emptyCurrentRow());
  // Set while re-editing an existing grid row (clicked from the list below) — commit updates that
  // row in place instead of appending a new one. null means the entry fields are building a new row.
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [isCustomUnit, setIsCustomUnit] = useState(false);

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

  // Preview of the System Bill No. a brand-new purchase will get. What Save actually assigns is
  // the next draft_purchases.draft_id (a NEW draft is what gets created — see handleSave) — not
  // the next real purchase_id, which is a separate IDENTITY sequence only assigned later, on Post.
  // Computed client-side from the currently-loaded unposted list, so it's a preview, not a
  // guarantee: correct as long as nothing else inserts a draft between now and Save (true for this
  // app's single-admin-session model — see backend/CLAUDE.md).
  const nextSystemBillNo = useMemo(
    () => Math.max(0, ...unpostedPurchases.map(d => d.draft_id)) + 1,
    [unpostedPurchases]
  );

  // Vendor field opens a centered "find" modal (SearchModal) instead of SearchableSelect's small
  // anchored panel — the user wanted the full vendor list visible at once, not a dropdown. It's a
  // real, typable <input> (2026-08-27, per the user: "I can write anything in the field and when
  // I press enter modal pop up appears with matching results and I can also search in modal
  // popup" — same pattern as Purchase Return's Vendor Bill No.): type a vendor name/city and press
  // Enter (or Arrow Up/Down for the full list) to open the modal seeded with what's typed, and
  // keep searching inside it. The small chevron button alongside it still opens the full list
  // blank, for a plain click with nothing typed. Committing a vendor closes the modal, updates the
  // displayed text to the picked vendor's label (see the sync effect below), and advances focus
  // via the app's G-01 rule (focusNextField needs the trigger element, still true for an input).
  const vendorTriggerRef = useRef<HTMLInputElement>(null);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [vendorSearchText, setVendorSearchText] = useState('');
  // Seeds the modal's search box when opened via Enter on the typed input (blank when opened via
  // the chevron button or Arrow Up/Down instead).
  const [vendorModalSeed, setVendorModalSeed] = useState('');

  // Keeps the input's displayed text in sync with whatever vendorId actually is — covers every
  // place vendorId gets set (picking one, New Purchase clearing it, loading a posted/draft
  // record) without duplicating each of those call sites. Typing itself never touches vendorId,
  // so this never fights the user mid-type — it only ever runs when the SELECTION changes.
  useEffect(() => {
    const opt = vendorOptions.find(o => o.value === vendorId);
    setVendorSearchText(opt?.label ?? '');
  }, [vendorId, vendorOptions]);

  const openVendorModal = () => {
    if (isViewMode) return;
    setVendorModalSeed('');
    setIsVendorModalOpen(true);
  };

  function handleVendorTriggerKeyDown(e: React.KeyboardEvent) {
    // stopPropagation on every branch, not just preventDefault — otherwise this keydown keeps
    // bubbling past the trigger up to window-level listeners (AppLayout's own G-01 field-walk and
    // Quick Menu Bar Arrow Up/Down handler), which would act on it AT THE SAME TIME the modal
    // opens, e.g. also walking focus in the background field. Same reasoning as SearchModal's own
    // internal keydown handling.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openVendorModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      setVendorModalSeed(vendorSearchText);
      setIsVendorModalOpen(true);
    }
  }

  function handleVendorSelect(newVendorId: string) {
    setVendorId(newVendorId);
    setIsVendorModalOpen(false);
    requestAnimationFrame(() => focusNextField(vendorTriggerRef.current));
  }

  const updateCurrentField = (field: keyof CurrentRow, value: string | number) => {
    setCurrentRow(prev => ({ ...prev, [field]: value }));
  };

  const currentRowTotal = useMemo(
    () => Number(currentRow.quantity) * Number(currentRow.pricePerUnit),
    [currentRow]
  );

  // Article entry, matching the legacy Wentox desktop app (ref-pics/batch2/sale bill.png): ONE
  // editable article field set above the grid, not one editable row per grid entry. Committing
  // (Enter on Price, or the Add button) either appends a new grid row or — while `editingUid` is
  // set, from clicking an existing row below — updates that row in place, then always clears the
  // entry fields and refocuses Material for the next article. Save/Post is reached only by
  // clicking the toolbar button, never by walking off the entry row with Enter (confirmed with the
  // user 2026-08-25).
  const materialNameRef = useRef<HTMLInputElement>(null);

  const commitCurrentRow = () => {
    const materialName = currentRow.materialName.trim();
    const unit = currentRow.unit.trim();
    if (!materialName || !unit || !(currentRow.quantity > 0) || !(currentRow.pricePerUnit > 0)) {
      return; // incomplete row — nothing to commit yet, leave focus where it is
    }
    const totalPrice = currentRow.quantity * currentRow.pricePerUnit;
    if (editingUid) {
      setItems(prev => prev.map(it => it.uid === editingUid
        ? { ...it, materialName, unit, quantity: currentRow.quantity, pricePerUnit: currentRow.pricePerUnit, totalPrice }
        : it));
    } else {
      setItems(prev => [...prev, {
        uid: newItemUid(), materialName, unit,
        quantity: currentRow.quantity, pricePerUnit: currentRow.pricePerUnit, totalPrice
      }]);
    }
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
    requestAnimationFrame(() => materialNameRef.current?.focus());
  };

  function handleRateKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation(); // stop AppLayout's own Enter handler from walking this keystroke to Save
    commitCurrentRow();
  }

  // Clicking a committed row (below) loads it back into the entry fields for editing — the row
  // stays in the grid (not pulled out) until the edit is committed, so it never looks "missing".
  const handleEditRow = (item: UiItem) => {
    if (isViewMode) return;
    setCurrentRow({ materialName: item.materialName, unit: item.unit, quantity: item.quantity, pricePerUnit: item.pricePerUnit });
    setEditingUid(item.uid);
    setIsCustomUnit(!UNIT_PRESETS.includes(item.unit));
    requestAnimationFrame(() => materialNameRef.current?.focus());
  };

  const cancelEditRow = () => {
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
  };

  const removeItemRow = (uid: string) => {
    setItems(prev => prev.filter(it => it.uid !== uid));
    if (editingUid === uid) cancelEditRow(); // was mid-edit on the row just deleted
  };

  const grandTotal = useMemo(() => items.reduce((s, it) => s + it.totalPrice, 0), [items]);

  // Debounced 300ms behind the live `billNo` — the duplicate check below re-scans two whole
  // arrays on every run, so tying it straight to onChange would re-run it on every keystroke.
  // Confirmed with the user (2026-08-26) as 300ms, not the literally-unnoticeable 3ms first asked
  // for. The input itself stays bound to the live `billNo`, so typing is never delayed — only the
  // duplicate check (and its message) lags behind by this much.
  const [debouncedBillNo, setDebouncedBillNo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBillNo(billNo), 300);
    return () => clearTimeout(t);
  }, [billNo]);

  // Frontend-only duplicate check (no backend endpoint for this — see the user's explicit "in
  // frontend", 2026-08-26): the same vendor shouldn't have two purchases entered under the same
  // Vendor Bill No., posted or still a pending draft. `purchaseId` means different things
  // depending on `currentIsPosted` (a real purchase_id once posted, a draft_id before that — see
  // the System Bill No. field's own comment above), so self-exclusion is split accordingly:
  // editing a posted purchase's own bill no. must not flag itself against `purchases`, and editing
  // a draft's own bill no. must not flag itself against `unpostedPurchases`.
  const billNoDuplicate = useMemo(() => {
    const trimmed = debouncedBillNo.trim();
    if (!trimmed || !vendorId) return null;
    const vId = Number(vendorId);
    const lower = trimmed.toLowerCase();
    const selfPostedId = currentIsPosted ? purchaseId : null;
    const selfDraftId = currentIsPosted ? null : purchaseId;

    const matchPosted = purchases.find(p =>
      p.vendor_id === vId && p.purchase_id !== selfPostedId && (p.bill_no || '').trim().toLowerCase() === lower
    );
    if (matchPosted) {
      return { kind: 'posted' as const, id: matchPosted.purchase_id, date: matchPosted.purchase_date };
    }
    const matchDraft = unpostedPurchases.find(d =>
      d.vendor_id === vId && d.draft_id !== selfDraftId && (d.bill_no || '').trim().toLowerCase() === lower
    );
    if (matchDraft) {
      return { kind: 'draft' as const, id: matchDraft.draft_id, date: matchDraft.purchase_date };
    }
    return null;
  }, [debouncedBillNo, vendorId, purchases, unpostedPurchases, purchaseId, currentIsPosted]);

  const isValid = useMemo(() => {
    if (!vendorId || !date) return false;
    if (billNoDuplicate) return false;
    return items.length > 0;
  }, [vendorId, date, items, billNoDuplicate]);

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
    setItems([]);
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
    setErrorMsg('');
    clearPurchaseDraft();
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

  // Invoice card (the <form> itself here — see its opening tag below) fills whatever vertical
  // space is left in the viewport below it (mirrors SaleBillPage/SaleReturnPage) — the item
  // table (flex-1 inside it) grows into that space, and the outer app window never scrolls (only
  // the table does). Measured via getBoundingClientRect rather than a CSS calc() of fixed chrome
  // heights, since the banners/Pending Posting panel above this form change height dynamically.
  const invoiceCardRef = useRef<HTMLFormElement>(null);
  const [invoiceCardHeight, setInvoiceCardHeight] = useState<number | null>(null);

  useEffect(() => {
    function recompute() {
      const el = invoiceCardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // AppLayout's <main> (the only scroll container in the app) adds 32px of its own
      // padding-bottom below whatever height we claim here — leaving that out would make the
      // form's bottom edge land 32px past the viewport and force <main> to scroll by that much.
      setInvoiceCardHeight(Math.max(360, window.innerHeight - top - 32));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [mode, lookupError, successMsg, errorMsg, unpostedPurchases.length, postAllResult]);

  const readyForNextPurchase = () => {
    const workingDate = date;
    handleNew();
    setDate(workingDate);
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  // "New Purchase" (toolbar button and the entry-tab switch) — unlike readyForNextPurchase, this
  // is a deliberate reset of the whole form (including the date), so focus goes to Date itself
  // rather than restoring a working date and jumping past it.
  const startNewPurchase = () => {
    handleNew();
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  const buildPayload = (): PurchaseCreateInput | null => {
    if (!vendorId) { setErrorMsg('Vendor is required.'); return null; }
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (billNoDuplicate) {
      setErrorMsg(`Bill No. "${billNo.trim()}" is already used for this vendor (${billNoDuplicate.kind === 'posted' ? 'Purchase' : 'Draft'} #${billNoDuplicate.id}, ${formatDate(billNoDuplicate.date)}).`);
      return null;
    }
    if (!isValid) { setErrorMsg('At least one article is required.'); return null; }

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
  // `finalize` decides what the form does AFTER a successful save, and nothing else:
  //   true  ("Done")  -> lock to view mode; the purchase stays fully on screen and Post lights up.
  //   false ("Save")  -> stay editable so more articles can be added to the SAME purchase.
  //
  // Neither clears the form. Save used to call readyForNextPurchase() here, which blanked
  // everything the instant it was pressed — so a finished purchase's articles vanished before it
  // could be reviewed or posted (reported directly by the user, 2026-08-27, for the identical
  // behaviour on Sale Bill). Starting the next purchase is the New button's job alone.
  //
  // Note the mode flip to 'edit' on the non-finalize path: the create-vs-update choice above reads
  // `mode === 'edit' && purchaseId != null`, so leaving a just-created purchase in 'new' mode would
  // make the NEXT Save create a second, duplicate draft instead of updating this one.
  const doSave = async (finalize: boolean) => {
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
    if (mode !== 'edit') {
      createdInThisRun.current = true;
      clearPurchaseDraft();
    }
    setErrorMsg('');
    setSuccessMsg(mode === 'edit' ? 'Purchase updated successfully.' : 'Purchase recorded successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode(finalize ? 'view' : 'edit');
    refreshUnposted(); // P-03: a newly saved purchase joins the pending-posting list immediately.
  };

  // The <form>'s own onSubmit — reached by the Done button (type="submit") and by the Enter-key
  // walk finishing on the last field, both of which mean "I'm finished with this purchase".
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await doSave(true);
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
    setItems(row.items.map(it => ({
      uid: 'pui_' + it.item_id,
      materialName: it.material_name || '',
      unit: it.unit,
      quantity: it.quantity,
      pricePerUnit: it.price_per_unit,
      totalPrice: it.total_price
    })));
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
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
    setMode('edit'); // land on the editable screen straight away, not the read-only view
    setSuccessMsg('Purchase unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshPurchases();
    refreshUnposted();
  };

  // Pending Posting panel: opening a row loads that draft straight into the form — no password
  // (drafts never needed one on this page; only a password-gated delete is new, below).
  // `opts.mode` lets the nav buttons open a draft READ-ONLY while browsing (look-then-decide),
  // while every other caller keeps the original edit-on-open behaviour.
  const loadDraftIntoForm = (draft: DraftPurchaseRow, opts: { mode?: 'edit' | 'view' } = {}) => {
    createdInThisRun.current = false;
    setPurchaseId(draft.draft_id);
    setCurrentIsPosted(false);
    setDate(draft.purchase_date.slice(0, 10));
    setVendorId(String(draft.vendor_id));
    setBillNo(draft.bill_no || '');
    setRemarks(draft.remarks || '');
    setItems((draft.items || []).map(it => ({
      uid: 'draftrow_' + it.line_no,
      materialName: it.material_name || '',
      unit: it.unit,
      quantity: it.quantity,
      pricePerUnit: it.price_per_unit,
      totalPrice: it.total_price
    })));
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
    setErrorMsg('');
    setMode(opts.mode ?? 'edit');
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

  // First/Previous/Next/Last record navigation. `navFilter` (the Posted/Unposted dropdown) is a
  // REAL data filter: 'posted' pages through confirmed purchases, 'unposted' through saved-but-not
  // -yet-posted drafts.
  //
  // This departs from the earlier design (and pages_design.md §3), where BOTH values browsed the
  // posted list and 'unposted' merely armed the Unpost button. That made the labels lie — picking
  // "Unposted" showed posted bills, and a purchase just saved with Save couldn't be reached from
  // the toolbar at all. Changed on the user's explicit instruction (2026-08-27), same as Sale Bill
  // and Sale Return.
  const [navFilter, setNavFilter] = useState<'posted' | 'unposted'>('posted');

  const navPostedList = useMemo(() => [...sortedPurchases].reverse(), [sortedPurchases]);
  const navUnpostedList = useMemo(() => [...unpostedPurchases].reverse(), [unpostedPurchases]);

  // Whichever list the dropdown selects — this is what the nav buttons page through.
  const navList = navFilter === 'posted' ? navPostedList : navUnpostedList;

  // -1 when the purchase on screen isn't in the ACTIVE list (unsaved, or a draft while the
  // dropdown is on Posted and vice versa); the handlers treat that as "start from the beginning".
  const navIndex = useMemo(() => {
    if (purchaseId == null) return -1;
    return navFilter === 'posted'
      ? (currentIsPosted ? navPostedList.findIndex(p => p.purchase_id === purchaseId) : -1)
      : (!currentIsPosted ? navUnpostedList.findIndex(p => p.draft_id === purchaseId) : -1);
  }, [currentIsPosted, purchaseId, navFilter, navPostedList, navUnpostedList]);

  const canNavPrevious = navList.length > 0 && navIndex !== 0;
  const canNavNext = navList.length > 0 && navIndex !== navList.length - 1;

  // Posted rows come from purchases, unposted ones from draft_purchases — each needs its own
  // loader. Both open read-only; Edit stays a separate deliberate click.
  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    if (navFilter === 'posted') {
      await loadPurchaseRow(navList[idx] as PurchaseRow);
    } else {
      loadDraftIntoForm(navList[idx] as DraftPurchaseRow, { mode: 'view' });
    }
  };

  const handleNavFirst = () => goToNavIndex(0);
  const handleNavLast = () => goToNavIndex(navList.length - 1);
  // No current position yet (navIndex -1) — Previous/Next behave like First rather than no-ops.
  const handleNavPrevious = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNavNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);

  // Toolbar "Delete" now targets the selected ARTICLE (the row clicked into the entry fields
  // below), not the whole bill — bill deletion stays where it was, password-gated in the Pending
  // Posting panel. Disabled until a row is selected (editingUid set).
  const deleteSelectedArticle = () => {
    if (editingUid) removeItemRow(editingUid);
  };

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
        onClick={() => { setActiveTab('entry'); startNewPurchase(); }}
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
      <div className="mx-auto relative" style={{ maxWidth: 1200 }}>

        {/* P-03: Pending Posting — pinned outside the card's own left edge rather than inside the
            page's flow, matching SaleBillPage's SB-06 sidebar exactly (`absolute`, anchored via
            `right: calc(100% + gap)` to this wrapper's left edge, so it can never affect the
            card's width/position). Was previously a full-width banner at the top of the entry
            tab, which pushed the whole form down; this way it's always visible (any tab) without
            taking layout space at all. Only shown from `2xl` up, same as Sale Bill — below that
            there usually isn't 280px of free margin for it to land in. */}
        {(unpostedPurchases.length > 0 || postAllResult) && (
          <aside
            className="hidden 2xl:block absolute top-0 w-64 space-y-3"
            style={{ right: 'calc(100% + 24px)' }}
            data-no-print
          >
            <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-slate-700">Pending Posting</span>
                <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                  {unpostedPurchases.length}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-3">
                {unpostedPurchases.length > 0 && `Total ${formatCurrency(unpostedPurchases.reduce((s, p) => s + Number(p.total_value), 0))}`}
              </div>
              {unpostedPurchases.length > 0 && (
                <button
                  type="button"
                  onClick={handlePostAll}
                  disabled={postAllBusy}
                  className="w-full px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {postAllBusy ? 'Posting…' : `Post All (${unpostedPurchases.length})`}
                </button>
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

            {/* Flat list — every unposted purchase, oldest first (same order the backend returns).
                Each row opens straight into the form for editing, with inline Post/Delete actions
                so a single ready one doesn't need to be opened first just to post it. */}
            {unpostedPurchases.length > 0 && (
              <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                {unpostedPurchases.map(p => (
                  <li
                    key={p.draft_id}
                    onClick={() => handleOpenUnposted(p.draft_id)}
                    className="px-3 py-2.5 text-xs border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-amber-50/60 transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold text-slate-700">{p.bill_no || `#${p.draft_id}`}</div>
                        <div className="text-slate-400 truncate">{vendors.find(v => v.vendor_id === p.vendor_id)?.name || 'Unnamed Vendor'}</div>
                        <div className="text-slate-400">{formatDate(p.purchase_date)} · {formatCurrency(Number(p.total_value))}</div>
                      </div>
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

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

        {/* Toolbar — standalone row above the card, matching SaleBillPage/SaleReturnPage's
            toolbar so every transaction page's action buttons live in the same place instead of
            being mixed into the card's own header. `flex-wrap` (rather than the old single-row
            header) lets it wrap on a narrow window instead of squeezing/overflowing.
            `form="purchase-entry-form"` on the submit button is what lets it still submit the
            <form> below even though it now renders outside it — see fieldNav.ts's
            `findSubmitButton` comment for why the HTML `form` attribute is the established way
            other pages (Receipts, Transfer, etc.) already do this. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-0.5">
            {/* ref-pics/batch2/sale bill.png toolbar style: small square buttons, icon on top,
                label underneath, tightly packed in one strip — not pill-shaped colored buttons. */}
            <button type="button" onClick={startNewPurchase} title="New Purchase" className="toolbar-btn">
              <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={deleteSelectedArticle}
              disabled={isViewMode || !editingUid}
              title="Delete selected article"
              className="toolbar-btn"
            >
              <Trash2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('edit')}
              disabled={!isViewMode || currentIsPosted}
              title="Edit"
              className="toolbar-btn"
            >
              <Edit size={20} strokeWidth={2.5} className="text-sky-600" />
              <span>Edit</span>
            </button>
            <button
              type="button"
              onClick={() => doSave(false)}
              disabled={isViewMode || !isValid}
              title="Save — keep editing this purchase"
              className="toolbar-btn"
            >
              <Save size={20} strokeWidth={2.5} className="text-blue-600" />
              <span>Save</span>
            </button>
            <button
              type="submit"
              form="purchase-entry-form"
              disabled={isViewMode || !isValid}
              title="Done — finish this purchase, then Post it"
              className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Done</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                if (purchaseId == null) return;
                const res = await api.purchases.get(purchaseId);
                if (res.ok) await loadPurchaseRow(res.data);
              }}
              disabled={mode !== 'edit'}
              title="Cancel Edit"
              className="toolbar-btn"
            >
              <XCircle size={20} strokeWidth={2.5} className="text-slate-500" />
              <span>Cancel</span>
            </button>

            <div className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            {/* Record navigation — First/Previous/Next/Last, browsing whichever list `navFilter`
                (the Posted/Unposted dropdown, far right) currently points at. */}
            <button type="button" onClick={handleNavFirst} disabled={!canNavPrevious} title="First" className="toolbar-btn">
              <ChevronsLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>First</span>
            </button>
            <button type="button" onClick={handleNavPrevious} disabled={!canNavPrevious} title="Previous" className="toolbar-btn">
              <ChevronLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Prev.</span>
            </button>
            <button type="button" onClick={handleNavNext} disabled={!canNavNext} title="Next" className="toolbar-btn">
              <ChevronRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Next</span>
            </button>
            <button type="button" onClick={handleNavLast} disabled={!canNavNext} title="Last" className="toolbar-btn">
              <ChevronsRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Last</span>
            </button>

            <div className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={handleUnpost}
              // No longer gated on the dropdown: that made sense only while 'unposted' MEANT
              // "I'm here to unpost". Now the dropdown genuinely filters, and its Unposted list
              // holds drafts — none of which can be unposted. Being on a posted purchase is the
              // only real precondition.
              disabled={!isViewMode || purchaseId == null || !currentIsPosted}
              title="Unpost — move this posted purchase back to drafts"
              className="toolbar-btn"
            >
              <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Unpost</span>
            </button>
            <button
              type="button"
              onClick={handlePost}
              disabled={!isViewMode || purchaseId == null || currentIsPosted}
              title="Post"
              className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Post</span>
            </button>
          </div>

          {/* Posted/Unposted — picks which list Previous/Next/First/Last page through. Uses
              soleria-input-compact rather than a forced inline height on the full-size
              soleria-input — that combination fought the class's own padding/line-height and
              clipped the text, which is what "doesn't appear properly" was. */}
          <select
            value={navFilter}
            onChange={e => setNavFilter(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Which purchases First/Prev./Next/Last page through: posted ones, or saved-but-unposted drafts."
          >
            <option value="posted">Posted ({sortedPurchases.length})</option>
            <option value="unposted">Unposted ({unpostedPurchases.length})</option>
          </select>
        </div>

        {/* This <form> IS the invoice card — height pinned to the remaining viewport space (see
            invoiceCardHeight above) and laid out as a flex column, so the item table below can
            flex-grow into whatever room that leaves. Every other child here keeps its natural
            size (shrink-0) — only the table wrapper is flex-1. */}
        <form
          id="purchase-entry-form"
          ref={invoiceCardRef}
          onSubmit={handleSave}
          className="card-white p-6 bg-white border flex flex-col"
          style={{ height: invoiceCardHeight ?? undefined }}
          data-no-print
        >
          <div className="shrink-0 flex items-center gap-2 border-b pb-3 mb-5">
            <ShoppingBag size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-bold text-lg text-slate-900">Raw Material Purchase</h3>
          </div>

          {/* Header fields */}
          <div className="shrink-0 grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1">
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
              {/* System Bill No. — the real purchase_id (draft_id while unposted), assigned by the
                  database, never typed. Read-only always, matching the legacy Wentox screenshot's
                  auto "Bill No." box. Distinct from "Vendor Bill No." below, which is the vendor's
                  own free-text invoice number. Before a save, shows nextSystemBillNo — a PREVIEW
                  of what Save will assign, not the assigned number itself yet. */}
              <label className="block text-xs font-bold text-slate-900 mb-1">System Bill No.</label>
              <input
                type="text"
                value={purchaseId != null ? `#${purchaseId}` : `#${nextSystemBillNo} (pending)`}
                disabled
                readOnly
                className="soleria-input bg-slate-100 text-slate-500 font-mono"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              {/* Vendor Bill No. before Vendor, per the user (2026-08-26): you're usually reading
                  the vendor's own invoice number off a physical paper first, so it's the natural
                  starting point — not the vendor picker. */}
              <label className="block text-xs font-bold text-slate-900 mb-1">Vendor Bill No.</label>
              <input
                type="text"
                value={billNo}
                disabled={isViewMode}
                onChange={e => setBillNo(e.target.value)}
                placeholder="Vendor's own invoice #..."
                className={`soleria-input ${billNoDuplicate ? 'border-rose-400 focus:border-rose-500' : ''}`}
                style={{ fontSize: '13px' }}
              />
              {/* Live duplicate check as you type — same vendor, same bill no., either already
                  posted or still sitting as a pending draft. Frontend-only (no backend endpoint
                  for this): checked against the purchases/unpostedPurchases already loaded on this
                  page, 300ms debounced (see debouncedBillNo above). Save stays blocked
                  (isValid/buildPayload above) while this shows a duplicate. */}
              {billNo.trim() && vendorId && billNo.trim() !== debouncedBillNo.trim() ? (
                <p className="text-[11px] text-slate-400 font-semibold mt-1">Checking…</p>
              ) : billNoDuplicate ? (
                <p className="text-[11px] text-rose-600 font-semibold mt-1">
                  Already used — {billNoDuplicate.kind === 'posted' ? 'Purchase' : 'Draft'} #{billNoDuplicate.id} ({formatDate(billNoDuplicate.date)})
                </p>
              ) : billNo.trim() && vendorId ? (
                <p className="text-[11px] text-emerald-600 font-semibold mt-1">Bill No. available</p>
              ) : null}
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-bold text-slate-900">
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
              <div className="relative">
                <input
                  ref={vendorTriggerRef}
                  type="text"
                  data-field-nav="true"
                  disabled={isViewMode}
                  value={vendorSearchText}
                  onChange={e => setVendorSearchText(e.target.value)}
                  onKeyDown={handleVendorTriggerKeyDown}
                  placeholder="Type a vendor name, or press Enter to search..."
                  className="soleria-input pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode}
                  onClick={openVendorModal}
                  title="Browse all vendors"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              <SearchModal
                isOpen={isVendorModalOpen}
                title="Select Vendor"
                options={vendorOptions}
                value={vendorId}
                onSelect={handleVendorSelect}
                onClose={() => setIsVendorModalOpen(false)}
                searchPlaceholder="Search vendors..."
                initialSearch={vendorModalSeed}
              />
              {selectedVendor && (
                <p className="text-[11px] text-slate-400 mt-1">
                  {selectedVendor.phone || 'No Phone'} {selectedVendor.city_id != null ? `· ${cities.find(c => c.city_id === selectedVendor.city_id)?.name || ''}` : ''}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1">Remarks</label>
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

          {/* Article entry — ONE editable field set (ref-pics/batch2/sale bill.png), not one
              editable row per grid entry. Enter on Price/Unit (or the Add/Update button) commits
              it into the grid below and clears back to blank, ready for the next article. */}
          {!isViewMode && (
            <div className="shrink-0 mb-3 p-3 rounded-lg border bg-blue-50/40" style={{ borderColor: 'var(--border-color)' }}>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-4">
                  <label className="block text-xs font-bold text-slate-900 mb-1">
                    Material / Product Name <span className="text-red-500 font-bold">*</span>
                  </label>
                  <input
                    type="text"
                    ref={materialNameRef}
                    value={currentRow.materialName}
                    onChange={e => updateCurrentField('materialName', e.target.value)}
                    placeholder="e.g. PU Sheet Roll"
                    className="soleria-input font-semibold"
                    style={{ fontSize: '13px' }}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-900 mb-1">
                    Unit <span className="text-red-500 font-bold">*</span>
                  </label>
                  {isCustomUnit ? (
                    <input
                      type="text"
                      value={currentRow.unit}
                      onChange={e => updateCurrentField('unit', e.target.value)}
                      placeholder="Type unit..."
                      autoFocus
                      onBlur={() => {
                        if (!currentRow.unit.trim()) {
                          setIsCustomUnit(false);
                          updateCurrentField('unit', UNIT_PRESETS[0]);
                        }
                      }}
                      className="soleria-input"
                      style={{ fontSize: '13px' }}
                    />
                  ) : (
                    <select
                      value={UNIT_PRESETS.includes(currentRow.unit) ? currentRow.unit : '__other__'}
                      onChange={e => {
                        if (e.target.value === '__other__') {
                          setIsCustomUnit(true);
                          updateCurrentField('unit', '');
                        } else {
                          updateCurrentField('unit', e.target.value);
                        }
                      }}
                      className="soleria-input cursor-pointer"
                      style={{ fontSize: '13px' }}
                    >
                      {UNIT_PRESETS.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                      <option value="__other__">
                        {UNIT_PRESETS.includes(currentRow.unit) ? 'Other (type manually)...' : currentRow.unit || 'Other (type manually)...'}
                      </option>
                    </select>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-900 mb-1">
                    Quantity <span className="text-red-500 font-bold">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={currentRow.quantity || ''}
                    onChange={e => updateCurrentField('quantity', Number(e.target.value))}
                    className="soleria-input text-center font-semibold"
                    style={{ fontSize: '13px' }}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-900 mb-1">
                    Price / Unit <span className="text-red-500 font-bold">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={currentRow.pricePerUnit || ''}
                    onChange={e => updateCurrentField('pricePerUnit', Number(e.target.value))}
                    onKeyDown={handleRateKeyDown}
                    className="soleria-input text-center font-semibold"
                    style={{ fontSize: '13px' }}
                  />
                </div>
                <div className="md:col-span-2 flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-900 mb-1">Value</label>
                    <div className="soleria-input flex items-center font-bold text-slate-800 bg-slate-100" style={{ fontSize: '13px' }}>
                      {formatCurrency(currentRowTotal)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={commitCurrentRow}
                    title={editingUid ? 'Update this article' : 'Add this article'}
                    className="btn-outline p-2 shrink-0"
                  >
                    {editingUid ? <CheckCircle2 size={16} /> : <Plus size={16} />}
                  </button>
                </div>
              </div>
              {editingUid && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-amber-700 font-semibold">Editing an existing article — Update to save, or</span>
                  <button type="button" onClick={cancelEditRow} className="text-slate-500 hover:text-slate-700 font-semibold underline">
                    cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Committed articles — read-only list; click any row to load it back into the entry
              fields above for editing (ref-pics/batch2/sale bill.png). flex-1 so it grows to fill
              whatever space invoiceCardHeight (above) leaves after every other section takes its
              natural size. `min-height: 0` overrides flexbox's default min-height:auto, which
              would otherwise let this box's own content stretch the whole form instead of
              scrolling internally. The header row is `sticky` within the scroll box so column
              labels stay visible past the first screenful of rows. */}
          <div className="flex-1 min-h-0 mb-4 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 pl-4" style={{ minWidth: '200px' }}>Material / Product Name</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3" style={{ width: '160px' }}>Unit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-center" style={{ width: '110px' }}>Quantity</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-center" style={{ width: '130px' }}>Price / Unit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-right" style={{ width: '130px' }}>Total Price</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400 text-sm">
                      No articles added yet — fill the fields above and press Enter.
                    </td>
                  </tr>
                ) : items.map(item => (
                  <tr
                    key={item.uid}
                    onClick={() => handleEditRow(item)}
                    title={!isViewMode ? 'Click to select this article — Delete (toolbar) removes it' : undefined}
                    className={`border-b transition-colors ${
                      item.uid === editingUid ? 'bg-blue-50' : 'hover:bg-slate-50/55'
                    } ${!isViewMode ? 'cursor-pointer' : ''}`}
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    <td className="p-3 pl-4 font-semibold text-slate-800">{item.materialName}</td>
                    <td className="p-3 text-slate-600">{item.unit}</td>
                    <td className="p-3 text-center font-semibold text-slate-700">{item.quantity}</td>
                    <td className="p-3 text-center font-semibold text-slate-700">{formatCurrency(item.pricePerUnit)}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(item.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 font-bold text-slate-800" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="p-3 pl-4" colSpan={4}>Grand Total</td>
                  <td className="p-3 text-right">{formatCurrency(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </form>
        </>
        )}

        {/* Recorded Purchases — own tab now, with a from/to date filter, rather than always
            rendering every purchase ever recorded inline below the live entry form. */}
        {activeTab === 'records' && (
        <div className="card-white p-6 bg-white border">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h3 className="font-lora font-bold text-lg text-slate-900">Recorded Purchases</h3>
            <div className="flex flex-wrap items-end gap-3" data-no-print>
              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">From</label>
                <input
                  type="date"
                  value={recordsDateFrom}
                  onChange={e => setRecordsDateFrom(e.target.value)}
                  className="soleria-input"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">To</label>
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
