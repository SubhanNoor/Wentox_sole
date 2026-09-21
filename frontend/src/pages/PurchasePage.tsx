import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency, useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import DocumentToolbar from '@/components/DocumentToolbar';
import RowActions from '@/components/RowActions';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal from '@/components/SearchModal';
import * as api from '@/lib/api';
import type {
  VendorRow, RegionRow, CityRow, PurchaseRow, PurchaseCreateInput, PurchaseItemInput,
  DraftPurchaseRow, ConfirmAllResult, DeletedNumberRow
} from '@/lib/api';
import { formatDate, getTodayDate, getThreeMonthsAgoDate, toDateInputValue, nextSystemNoPreview, mergeWithDeleted } from '@/lib/utils';
import DeletedDocumentOverlay from '@/components/DeletedDocumentOverlay';
import { focusNextField } from '@/lib/fieldNav';
import { Plus, ShoppingBag, CheckCircle2, ChevronDown } from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import PageToasts from '@/components/PageToasts';
import { usePersistentField, useClearPageDraft, useNewDocGate } from '@/hooks/usePersistentField';
import EditScopeRadios from '@/components/EditScopeRadios';
import { useAutoEditScope } from '@/hooks/useAutoEditScope';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { exportRowsToExcel } from '@/lib/export';
import wentoxLogo from '@/assets/wentox_logo.png';

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
  const { dispatch } = useApp();
  // New button + "cursor waits on New" (per the user, 2026-09-18): after a Post / Post All, and
  // whenever the form drops to the locked blank (useNewDocGate's awaitingNew), focus goes to New so
  // Enter starts the next document. Two frames, so a reset's own focus-first-field attempt (queued
  // first, and a no-op on the locked form) never wins. Declared first — Post handlers use it.
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const focusNewButton = () => requestAnimationFrame(() => requestAnimationFrame(() => newButtonRef.current?.focus()));
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
    return res.ok ? res.data : null;
  }, []);

  // Every saved-unposted purchase now lives in draft_purchases — the real purchases table
  // strictly never holds an unposted document (same architecture change as Sale Bill/Sale
  // Return). Mirrors SB-06 on SaleBillPage.
  const [unpostedPurchases, setUnpostedPurchases] = useState<DraftPurchaseRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<ConfirmAllResult | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.draftPurchases.list();
    if (res.ok) setUnpostedPurchases(res.data);
    return res.ok ? res.data : null;
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
    // G-06 (changes-14-09-26.md, 2026-09-15): zero unposted purchases on open must land on a fresh
    // blank entry, not wherever the session that closed the window left the screen pointed.
    // Originally gated on `mode === 'view'`, which misses a real case reported by the user
    // (2026-09-16, found on SaleBillPage's own equivalent bug): an edit-on-a-posted-record flow can
    // leave `mode: 'edit'` while the loaded record is still posted, so `mode === 'view'` alone
    // under-triggers. `currentIsPosted` (persisted) is the direct, unambiguous signal — true iff an
    // actual posted record is loaded, in EITHER 'view' or 'edit' mode; only `handleNew()` ever sets
    // it false, so it can never be true while there's genuine unsaved new-document work to protect.
    refreshUnposted().then(data => {
      if (data && data.length === 0 && currentIsPosted) handleNew();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshPurchases, refreshUnposted]);

  // Mode: 'view' | 'edit' | 'new'. Persisted with the rest of the draft (2026-08-31) — a page
  // restored into 'view' has Save disabled, so the state it was left in has to survive too.
  const [mode, setMode] = usePersistentField<'view' | 'edit' | 'new'>('purchase', 'mode', 'new');
  // The posted/unposted/System No. rule (per the user, 2026-09-18) — see useNewDocGate for all of
  // it. hasPageDraftAtMount gates the auto-open further down (only genuine unsaved typing skips
  // it); hasClickedNew gates the No. preview and the awaitingNew lock; only New calls markNewClicked.
  const { hasRealDraftAtMount: hasPageDraftAtMount, hasClickedNew, setHasClickedNew, markNewClicked } =
    useNewDocGate('purchase', ['vendorId', 'billNo', 'items', 'remarks']);
  // Master/Detail edit-scope radio (left-side widget, below) — which half of the form Edit
  // actually unlocks. Per the user, 2026-08-31: Edit used to unlock the whole document at once;
  // now Master unlocks only the header fields, Detail only the entry strip + grid. Reset to
  // 'master' on New/loading a record so a stale scope never carries over from the last edit.
  // Persisted, not plain useState: mode/svId/status already are, for the exact reason —
  // losing track of state across a page switch. editScope was the one piece left out, so
  // returning to an in-progress 'edit' draft always reset it to 'master', locking the
  // Detail half (entry strip + grid) shut even when that's what had been unlocked and typed
  // into — reported by the user (2026-09-04) as "all the buttons are disable except New".
  const [editScope, setEditScope] = usePersistentField<'master' | 'detail'>('purchase', 'editScope', 'master');
  // Keeps the radios pointing at whichever half is being worked in — see the hook.
  const autoEditScope = useAutoEditScope(setEditScope);

  // purchaseId/currentIsPosted are persisted alongside the field values, NOT plain useState — see
  // SaleBillPage's own comment for the full reasoning. Short version: leaving them out lost track
  // of WHICH record was on screen after a page switch, and the earlier "persist the id and
  // re-fetch on mount" attempt was worse still — it overwrote the user's unsaved edits with the
  // last-saved copy and reopened in 'view' mode, which disables Save.
  const [purchaseId, setPurchaseId] = usePersistentField<number | null>('purchase', 'purchaseId', null);
  // The loaded record's own System No. — display-only, kept in step with purchaseId but never
  // used for API calls; those stay on purchaseId/draftId as before.
  const [currentSystemNo, setCurrentSystemNo] = usePersistentField<number | null>('purchase', 'currentSystemNo', null);
  const [currentIsPosted, setCurrentIsPosted] = usePersistentField('purchase', 'currentIsPosted', false);

  // Every Purchase System No. permanently retired by a delete (migration 032) — merged into the
  // browse lists below so First/Prev/Next/Last can show "#N — Deleted" as an actual stop.
  const [deletedNumbers, setDeletedNumbers] = useState<DeletedNumberRow[]>([]);
  const refreshDeletedNumbers = useCallback(async () => {
    const res = await api.draftPurchases.listDeletedNumbers();
    if (res.ok) setDeletedNumbers(res.data);
  }, []);
  useEffect(() => { refreshDeletedNumbers(); }, [refreshDeletedNumbers]);

  // Set when First/Prev/Next/Last lands on a deleted number — DeletedDocumentOverlay renders while
  // this is non-null. Cleared as soon as a real document loads (see the purchaseId effect below).
  const [deletedPlaceholder, setDeletedPlaceholder] = useState<number | null>(null);
  // navIndex normally tracks the loaded purchase's own position via purchaseId — a deleted marker
  // has no purchaseId to match, so this overrides it while a placeholder is on screen.
  const [navIndexOverride, setNavIndexOverride] = useState<number | null>(null);
  useEffect(() => {
    setDeletedPlaceholder(null);
    setNavIndexOverride(null);
  }, [purchaseId]);
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
  // G-08 (changes-14-09-26.md, 2026-09-15): a click on a detail row must produce no visible change
  // at all — no edit load, no highlight. It only records which row Delete/Edit Row will act on
  // internally; `editingUid` (the actually-loaded-for-editing row, and the only thing that drives
  // the blue highlight) is set exclusively by the Edit Row button now, never by a row click
  // directly. Cleared whenever `editingUid` takes over so the two never point at different rows.
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  // G-05 (changes-14-09-26.md, 2026-09-15): the row most recently ADDED or UPDATED via the entry
  // fields — a pure position indicator (the ▶ gutter marker below), never a selection. Deliberately
  // separate from `selectedUid`/`editingUid` above: G-05's own text is explicit that the pointer
  // "must not look like, or behave as, the highlight described in G-08" — a click never moves it,
  // only committing a row does. Keyed by uid (not array index) since this grid's own rows already
  // key by uid, which survives a mid-list merge/edit without drifting the way an index would.
  const [lastEnteredUid, setLastEnteredUid] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  useEffect(() => {
    if (lastEnteredUid != null) rowRefs.current[lastEnteredUid]?.scrollIntoView({ block: 'nearest' });
  }, [lastEnteredUid]);
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
  const closeAddVendor = () => {
    setIsAddVendorOpen(false);
    setNewVendorName('');
    setNewVendorPhone('');
    setNewVendorRegionId('');
    setNewVendorCityId('');
    setVendorErrorMsg('');
  };
  // G-07 (changes-14-09-26.md): Escape closes the topmost dialog — this page builds its own inline
  // modals rather than going through a shared component, so each needs its own hook call.
  useEscapeToClose(isAddVendorOpen, closeAddVendor);

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

  // Preview of the System No. a brand-new purchase will get. This number is now assigned once at
  // draft-save time and carried through posting unchanged (per the user, 2026-09-05) — a real SQL
  // Server SEQUENCE (dbo.seq_purchase_no) is the actual source of truth server-side, so this is a
  // client-side estimate only (MAX across whatever's already loaded, +1). Always shown, from the
  // moment the page opens — an earlier round gated it behind pressing New, which the user reversed
  // (2026-08-31): the number should just be there.
const nextSystemBillNo = useMemo(
    () => nextSystemNoPreview(...unpostedPurchases.map(d => d.system_no), ...purchases.map(p => p.system_no), ...deletedNumbers.map(d => d.system_no)),
    [unpostedPurchases, purchases, deletedNumbers]
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
    // Same material/unit already on the grid — merge quantity into it instead of adding a
    // duplicate row (per the user, 2026-08-30). Excludes the row being edited itself, so
    // re-committing an unchanged row doesn't fold it into a copy of itself.
    const dup = items.find(it =>
      it.uid !== editingUid &&
      it.materialName.trim().toLowerCase() === materialName.toLowerCase() &&
      it.unit.trim().toLowerCase() === unit.toLowerCase()
    );
    // G-05: the new row's own uid is generated here (not inline in the append branch below) so it
    // can double as the pointer target — a functional `setItems` updater can't hand a value back
    // out to set as the pointer afterward.
    const newUid = newItemUid();
    if (dup) {
      setItems(prev => {
        const withoutEditing = editingUid ? prev.filter(it => it.uid !== editingUid) : prev;
        return withoutEditing.map(it => it.uid === dup.uid
          ? { ...it, quantity: it.quantity + currentRow.quantity, totalPrice: (it.quantity + currentRow.quantity) * it.pricePerUnit }
          : it);
      });
    } else if (editingUid) {
      setItems(prev => prev.map(it => it.uid === editingUid
        ? { ...it, materialName, unit, quantity: currentRow.quantity, pricePerUnit: currentRow.pricePerUnit, totalPrice }
        : it));
    } else {
      setItems(prev => [...prev, {
        uid: newUid, materialName, unit,
        quantity: currentRow.quantity, pricePerUnit: currentRow.pricePerUnit, totalPrice
      }]);
    }
    setLastEnteredUid(dup ? dup.uid : editingUid ? editingUid : newUid);
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setSelectedUid(null);
    setIsCustomUnit(false);
    requestAnimationFrame(() => materialNameRef.current?.focus());
  };

  function handleRateKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation(); // stop AppLayout's own Enter handler from walking this keystroke to Save
    commitCurrentRow();
  }

  // G-08: now the Edit Row toolbar button's handler, not the row's own onClick — a row click just
  // records `selectedUid` (see the grid below), and this only runs once the user presses Edit Row.
  // Loads the row back into the entry fields for editing — the row stays in the grid (not pulled
  // out) until the edit is committed, so it never looks "missing".
  const handleEditRow = (item: UiItem) => {
    if (isViewMode) return;
    // Detail scope only — clicking a row to re-edit it is a detail-section interaction, so it
    // must stay inert while Master is the selected edit scope (per the user, 2026-08-31).
    if (detailFieldsLocked) return;
    setCurrentRow({ materialName: item.materialName, unit: item.unit, quantity: item.quantity, pricePerUnit: item.pricePerUnit });
    setEditingUid(item.uid);
    setSelectedUid(null);
    setIsCustomUnit(!UNIT_PRESETS.includes(item.unit));
    requestAnimationFrame(() => materialNameRef.current?.focus());
  };

  const handleEditSelectedRow = () => {
    const item = items.find(it => it.uid === selectedUid);
    if (item) handleEditRow(item);
  };

  const cancelEditRow = () => {
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setSelectedUid(null);
    setIsCustomUnit(false);
  };

  const removeItemRow = (uid: string) => {
    setItems(prev => prev.filter(it => it.uid !== uid));
    if (editingUid === uid) cancelEditRow(); // was mid-edit on the row just deleted
    setSelectedUid(null);
    if (lastEnteredUid === uid) setLastEnteredUid(null);
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
      return { kind: 'posted' as const, id: matchPosted.system_no, date: matchPosted.purchase_date };
    }
    const matchDraft = unpostedPurchases.find(d =>
      d.vendor_id === vId && d.draft_id !== selfDraftId && (d.bill_no || '').trim().toLowerCase() === lower
    );
    if (matchDraft) {
      return { kind: 'draft' as const, id: matchDraft.system_no, date: matchDraft.purchase_date };
    }
    return null;
  }, [debouncedBillNo, vendorId, purchases, unpostedPurchases, purchaseId, currentIsPosted]);

  // A blank purchase reached any way other than New (first open with nothing unposted, after Post,
  // Post All, a delete…) stays locked — no System No. may be allocated without New (2026-09-18).
  const awaitingNew = mode === 'new' && currentSystemNo == null && !hasClickedNew;
  useEffect(() => { if (awaitingNew) focusNewButton(); }, [awaitingNew]);
  const isValid = useMemo(() => {
    if (awaitingNew) return false;
    if (!vendorId || !date) return false;
    if (billNoDuplicate) return false;
    return items.length > 0;
  }, [awaitingNew, vendorId, date, items, billNoDuplicate]);

  const isViewMode = mode === 'view';
  // Edit-scope split (per the user, 2026-08-31): while actually editing, Master unlocks only the
  // header fields and Detail only the entry strip + grid — each stays locked whenever the OTHER
  // scope is selected. Both are false outside edit mode (view/new behave exactly as before).
  const masterFieldsLocked = awaitingNew || (mode === 'edit' && editScope !== 'master');
  const detailFieldsLocked = awaitingNew || (mode === 'edit' && editScope !== 'detail');

  // P-02: "was the purchase now on screen created in this run?" — the difference between finishing
  // one you were entering (clear and move to the next) and posting one you deliberately opened
  // from the list (stay on it). Set when create() succeeds, cleared by handleNew() and by loading
  // any existing purchase. Same rule as SaleBillPage's SB-05.
  const createdInThisRun = useRef(false);

  const handleNew = () => {
    setMode('new');
    setHasClickedNew(false);
    // P-02: a blank form has nothing saved in it yet, so nothing to clear on post.
    createdInThisRun.current = false;
    setPurchaseId(null);
    setCurrentSystemNo(null);
    setCurrentIsPosted(false);
    setDate(getTodayDate());
    setVendorId('');
    setBillNo('');
    setRemarks('');
    setItems([]);
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setSelectedUid(null);
    setLastEnteredUid(null);
    setIsCustomUnit(false);
    setErrorMsg('');
    setEditScope('master'); // a blank form starts scoped to Master, same as any freshly loaded record
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
    // Backstop for the awaitingNew lock.
    if (awaitingNew) { setErrorMsg('Click New to start a purchase first.'); return; }
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
    setCurrentSystemNo(result.data.system_no);
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
    setCurrentSystemNo(row.system_no);
    setCurrentIsPosted(row.is_posted);
    setDate(toDateInputValue(row.purchase_date));
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
    setSelectedUid(null);
    setLastEnteredUid(null);
    setIsCustomUnit(false);
    setErrorMsg('');
    setEditScope('master'); // opening a different record must not carry over a stale edit scope
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
    setCurrentSystemNo(res.data.system_no);
    setCurrentIsPosted(true);
    // P-02: clear for the next purchase only if this one was entered in this run — one opened
    // from the list and posted there stays on screen. The message names the document, because
    // once the form empties the clearing is otherwise the only sign anything was saved.
    if (createdInThisRun.current) {
      setSuccessMsg(`Purchase ${postedBillNo || `#${res.data.system_no}`} posted. Ready for the next one.`);
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
    // Everything posted — nothing is left unposted to come back to, so reset to a fresh record
    // ready for the next one (keeping the date being worked on), matching Stock Voucher/Journal
    // Voucher's own Post All. Per the user (2026-09-04): Post All should "refresh the screen".
    // A partial run deliberately does NOT wipe the form — the failures still need looking at, so
    // there it only clears when the record on screen was itself one of the ones that posted.
    if (res.data.failed.length === 0) {
      const workingDate = date;
      handleNew();
      setDate(workingDate);
    } else if (purchaseId != null && !currentIsPosted && res.data.posted.some(p => p.draft_id === purchaseId)) {
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
    setCurrentSystemNo(res.data.system_no);
    setCurrentIsPosted(false);
    setMode('edit'); // land on the editable screen straight away, not the read-only view
    setSuccessMsg('Purchase unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshPurchases();
    refreshUnposted();
    // It's a draft again now, so the window follows it back to the Unposted view (per the user,
    // 2026-08-30) rather than staying on Posted looking at a purchase that no longer belongs there.
    setNavFilter('unposted');
  };

  // Pending Posting panel: opening a row loads that draft straight into the form — no password
  // (drafts never needed one on this page; only a password-gated delete is new, below).
  // `opts.mode` lets the nav buttons open a draft READ-ONLY while browsing (look-then-decide),
  // while every other caller keeps the original edit-on-open behaviour.
  const loadDraftIntoForm = async (draftIn: DraftPurchaseRow, opts: { mode?: 'edit' | 'view' } = {}) => {
    // list()/find-search rows never carry `.items` (only get()/create()/update() do — see
    // DraftPurchaseRow's own comment) — browsing/switching to one of those rows was loading the
    // form with an empty material grid (reported by the user, 2026-08-30). Re-fetch the full
    // draft whenever it's missing rather than trusting whatever was passed in.
    let draft = draftIn;
    if (!draft.items) {
      const res = await api.draftPurchases.get(draft.draft_id);
      // A failed re-fetch used to fall through and render `draftIn` anyway — stale list data
      // for a draft that no longer exists, since posting one DELETES it and turns it into a
      // posted purchase. Reported on Sale Bill by the user (2026-09-04) as Unposted "still showing
      // me the posted bill"; same shape here. Say so and leave the form alone instead.
      if (!res.ok) {
        setErrorMsg('That draft no longer exists — it may have been posted or deleted.');
        return false;
      }
      draft = res.data;
    }
    createdInThisRun.current = false;
    setPurchaseId(draft.draft_id);
    setCurrentSystemNo(draft.system_no);
    setCurrentIsPosted(false);
    setDate(toDateInputValue(draft.purchase_date));
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
    setSelectedUid(null);
    setLastEnteredUid(null);
    setIsCustomUnit(false);
    setErrorMsg('');
    setEditScope('master'); // opening a different draft must not carry over a stale edit scope
    setMode(opts.mode ?? 'edit');
    return true;
  };



  // Password-gated (verified server-side) — deleting a saved-unposted purchase is destructive
  // with no reverse-never-erase trail, same guard level used on Sale Bill/Sale Return.
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const pendingDeleteDraftId = useRef<number | null>(null);


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
    refreshDeletedNumbers();
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
  //
  // Unposted is the default (per the user, 2026-08-30): that's the working mode you add and post
  // new purchases from. Posted is purely a browse mode over already-posted purchases (First/Prev./
  // Next/Last + Un Post).
  const [navFilter, setNavFilter] = useState<'posted' | 'unposted'>('unposted');

  // Sorted by system_no (creation order), NOT sortedPurchases' own date-based order (right for the
  // "Recorded Purchases" listing below, wrong here) — a backdated purchase_date used to put that
  // purchase next to whatever else shares its date when browsing, so First..Last could jump between
  // unrelated system_no's (reported by the user on Sale Bill, 2026-09-07; same architecture here).
  const navPostedList = useMemo(
    () => mergeWithDeleted(purchases.filter(p => p.is_posted).sort((a, b) => a.system_no - b.system_no), deletedNumbers),
    [purchases, deletedNumbers],
  );
  const navUnpostedList = useMemo(
    () => mergeWithDeleted([...unpostedPurchases].sort((a, b) => a.system_no - b.system_no), deletedNumbers),
    [unpostedPurchases, deletedNumbers],
  );

  // Whichever list the dropdown selects — this is what the nav buttons page through.
  const navList = navFilter === 'posted' ? navPostedList : navUnpostedList;

  // -1 when the purchase on screen isn't in the ACTIVE list (unsaved, or a draft while the
  // dropdown is on Posted and vice versa); the handlers treat that as "start from the beginning".
  // navIndexOverride wins while a deleted-number placeholder is on screen — see SaleBillPage.tsx's
  // navIndex for why.
  const derivedNavIndex = useMemo(() => {
    if (purchaseId == null) return -1;
    return navFilter === 'posted'
      ? (currentIsPosted ? navPostedList.findIndex(e => e.kind === 'doc' && e.row.purchase_id === purchaseId) : -1)
      : (!currentIsPosted ? navUnpostedList.findIndex(e => e.kind === 'doc' && e.row.draft_id === purchaseId) : -1);
  }, [currentIsPosted, purchaseId, navFilter, navPostedList, navUnpostedList]);
  const navIndex = navIndexOverride ?? derivedNavIndex;

  const canNavPrevious = navList.length > 0 && navIndex !== 0;
  const canNavNext = navList.length > 0 && navIndex !== navList.length - 1;
  // First/Last only need SOMETHING to browse — matching SaleBillPage/SaleReturnPage, which use this
  // same distinction rather than tying First/Last to the boundary check Prev/Next use (per the
  // user, 2026-09-07: flagged as an unexplained divergence between sibling pages).
  const canBrowse = navList.length > 0;

  // Posted rows come from purchases, unposted ones from draft_purchases — each needs its own
  // loader. Both open read-only; Edit stays a separate deliberate click. A 'deleted' entry shows
  // DeletedDocumentOverlay instead of loading anything.
  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    const entry = navList[idx];
    if (entry.kind === 'deleted') {
      setNavIndexOverride(idx);
      setDeletedPlaceholder(entry.system_no);
      return;
    }
    if (navFilter === 'posted') {
      await loadPurchaseRow(entry.row as PurchaseRow);
    } else {
      await loadDraftIntoForm(entry.row as DraftPurchaseRow, { mode: 'view' });
    }
  };

  // Toolbar's Find button — a quick jump to any purchase (posted or unposted) by System No.,
  // manual bill no., or vendor name, searched client-side over the already-loaded browse lists,
  // same pattern as SaleBillPage's own Find (per the user, 2026-09-07 — Purchase had none of this).
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const closeFindPurchase = () => { setIsFindOpen(false); setFindQuery(''); };
  useEscapeToClose(isFindOpen, closeFindPurchase);
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = (p: { bill_no: string | null; vendor_id: number; system_no: number }) =>
      String(p.system_no).includes(q) ||
      (p.bill_no || '').toLowerCase().includes(q) ||
      (vendors.find(v => v.vendor_id === p.vendor_id)?.name || '').toLowerCase().includes(q);
    const posted = purchases.filter(matches).map(row => ({ filter: 'posted' as const, row }));
    const unposted = unpostedPurchases.filter(matches).map(row => ({ filter: 'unposted' as const, row }));
    return [...posted, ...unposted].slice(0, 30);
  }, [findQuery, purchases, unpostedPurchases, vendors]);

  const handleFindSelect = async (filter: 'posted' | 'unposted', row: PurchaseRow | DraftPurchaseRow) => {
    setIsFindOpen(false);
    setFindQuery('');
    if (filter === 'posted') {
      await loadPurchaseRow(row as PurchaseRow);
    } else {
      await loadDraftIntoForm(row as DraftPurchaseRow, { mode: 'view' });
    }
  };

  // Print/PDF share one preview modal, per SaleBillPage's own pattern — opens a real preview
  // instead of jumping straight to the OS print dialog or an unconfirmed export.
  const [isPrintingSingle, setIsPrintingSingle] = useState(false);

  // The purchase's printable document — mirrors SaleBillPage's renderBillPrintable() shape
  // (logo header, an info grid, an items table, a totals row, signature footer) using Purchase's
  // own fields: a vendor instead of a customer, raw-material lines (unit/quantity/price) instead
  // of article/carton/pairs.
  const renderPurchasePrintable = () => {
    const vendorObj = vendors.find(v => v.vendor_id === Number(vendorId));
    const vendorName = vendorObj ? vendorObj.name : (vendorId || 'N/A');
    const statusLabel = currentIsPosted ? 'Posted' : 'Unposted';

    return (
      <div className="excel-print-container" style={{
        display: 'block', margin: '0 auto', width: '210mm', padding: '10mm',
        backgroundColor: '#ffffff', color: '#000000', fontFamily: 'Calibri, Arial, sans-serif',
        boxSizing: 'border-box',
      }}>
        <div className="excel-print-header" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '10px',
        }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>PURCHASE INVOICE</h2>
            <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>Status: {statusLabel}</p>
          </div>
        </div>

        <div className="excel-grid-info" style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: '1px solid #000000', marginBottom: '15px',
        }}>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>System No.</label>
            <span>{currentSystemNo ?? 'Unsaved'}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Date</label>
            <span>{formatDate(date)}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Vendor</label>
            <span>{vendorName}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Manual Bill No.</label>
            <span>{billNo || 'N/A'}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px', gridColumn: 'span 4' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Remarks</label>
            <span>{remarks || 'N/A'}</span>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '40%' }}>Material</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '15%' }}>Unit</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '15%' }}>Quantity</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Rate</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '13%' }}>Total Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.uid}>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{item.materialName || 'N/A'}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.unit}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.quantity}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.pricePerUnit.toLocaleString()}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.totalPrice.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2', fontSize: '12px' }}>
              <td colSpan={5} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Net Payable Amount (PKR):</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{grandTotal.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '45px', fontSize: '11px' }}>
          <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>Prepared By</div>
          <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>Checked By</div>
          <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>Authorized Signature</div>
        </div>

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
          <div>WENTOX FOOTWEAR DISTRIBUTION</div>
          <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>
    );
  };

  // Switching the Posted/Unposted dropdown (per the user, 2026-08-30):
  // - To Unposted: load the most recently saved draft (or a blank New purchase if there isn't
  //   one), then focus New — Enter on it clicks New and lands on Date, ready for the next one.
  // - To Posted: re-fetch and jump straight to the most recently posted purchase for browsing.
  const handleNavFilterChange = async (next: 'posted' | 'unposted') => {
    setNavFilter(next);
    if (next === 'unposted') {
      // Re-fetch first, exactly like the Posted branch below — reading the list straight out
      // of state meant a draft posted or deleted since it was last loaded was still in it, so
      // switching to Unposted opened a "draft" that no longer exists (2026-09-04).
      const fresh = await refreshUnposted();
      const list = [...(fresh ?? unpostedPurchases)].sort((a, b) => a.system_no - b.system_no);
      const latest = list[list.length - 1];
      const opened = latest ? await loadDraftIntoForm(latest, { mode: 'view' }) : false;
      if (!opened) startNewPurchase();
      requestAnimationFrame(() => newButtonRef.current?.focus());
    } else {
      const fresh = await refreshPurchases();
      const list = [...(fresh ?? purchases).filter(p => p.is_posted)].sort((a, b) => a.system_no - b.system_no);
      const latest = list[list.length - 1];
      if (latest) await loadPurchaseRow(latest);
    }
  };

  // Landing on the page with nothing in progress: the Posted/Unposted dropdown already reads
  // Unposted, so open the newest unposted purchase and park focus on New, exactly as picking
  // Unposted from the dropdown does (per the user, 2026-09-04). Skipped when a draft was
  // restored — that is real in-progress work and must not be overwritten. Runs once; the ref
  // keeps a later state change from re-opening a record over whatever is being typed by then.
  // Per the user, 2026-09-16 (corrected same day — the first version also revealed the preview
  // after G-06's own automatic reset-to-blank, which the user does not consider a "New" press):
  // the System No. preview must not appear until an actual New button/tab is DELIBERATELY clicked
  // — a restored in-progress draft still counts, but every other path that resets to blank
  // (`handleNavFilterChange`'s own fallback when Unposted has nothing to show, G-06's auto-open,
  // Post's "ready for the next one", etc.) must leave it blank. So `handleNew()` itself always
  // resets this to false; only the toolbar's New button and the "New Purchase" tab button set it
  // true, right after calling `startNewPurchase()`/`handleNew()`.
  // (hasClickedNew/hasPageDraftAtMount come from useNewDocGate, declared right after `mode`.)
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (hasPageDraftAtMount || didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    handleNavFilterChange('unposted');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNavFirst = () => goToNavIndex(0);
  const handleNavLast = () => goToNavIndex(navList.length - 1);
  // No current position yet (navIndex -1) — Previous/Next behave like First rather than no-ops.
  const handleNavPrevious = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNavNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);

  // Whole-purchase delete (password-gated) — the infrastructure for this (isPasswordModalOpen/
  // pendingDeleteDraftId/handleDeletePasswordSuccess above) already existed but had no caller left:
  // it used to be triggered from the Pending Posting panel, removed 2026-09-03, which silently
  // orphaned this capability entirely (flagged by the user, 2026-09-07 — Purchase had no way left
  // to delete a whole unposted purchase, unlike Sale Bill/Sale Return's dual-purpose Delete).
  const handleDeleteCurrentPurchase = () => {
    if (purchaseId == null || currentIsPosted) return;
    pendingDeleteDraftId.current = purchaseId;
    setIsPasswordModalOpen(true);
  };

  // Toolbar "Delete" is dual-purpose, matching Sale Bill/Sale Return's own Delete: a row loaded
  // for editing (editingUid) takes priority; otherwise a merely-clicked row (selectedUid, G-08) is
  // the target; with neither, it falls back to deleting the whole unposted purchase.
  // Toolbar Delete ALWAYS deletes the whole document now (per the user, 2026-09-20: a new user
  // could not know a row had to be deselected first). Deleting a single row is the row's own
  // Delete button in the grid — one meaning per button.
  const deleteSelectedArticle = () => {
    handleDeleteCurrentPurchase();
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
      const d = toDateInputValue(p.purchase_date);
      if (recordsDateFrom && d < recordsDateFrom) return false;
      if (recordsDateTo && d > recordsDateTo) return false;
      return true;
    });
  }, [sortedPurchases, recordsDateFrom, recordsDateTo]);

  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('entry'); startNewPurchase(); markNewClicked(); }}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Purchase
      </button>
      <button
        onClick={() => setActiveTab('records')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'records' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Recorded Purchases
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Purchase Entry" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }} {...autoEditScope}>

        {/* Floated into the right-hand gutter, not rendered inline: a message used to push the
            toolbar and card down under the cursor mid-click (per the user, 2026-08-31). */}
        <PageToasts
          error={lookupError || errorMsg}
          success={successMsg}
          onDismissError={() => { setLookupError(''); setErrorMsg(''); }}
          onDismissSuccess={() => setSuccessMsg('')}
        />

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
        <div className="flex items-center flex-nowrap overflow-x-auto justify-between gap-2 mb-1 p-1.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <DocumentToolbar
            newAction={{ onClick: () => { startNewPurchase(); markNewClicked(); }, disabled: navFilter === 'posted', ref: newButtonRef, title: 'New' }}
            remove={{
              onClick: deleteSelectedArticle,
              disabled: deletedPlaceholder != null || purchaseId == null || currentIsPosted,
              title: 'Delete this whole purchase — every article on it goes too (asks for your password)',
            }}
            editRow={{ onClick: handleEditSelectedRow, disabled: selectedUid == null || editingUid != null || isViewMode || detailFieldsLocked, title: 'Edit selected article' }}
            edit={{
              onClick: () => {
                setMode('edit');
                requestAnimationFrame(() => {
                  if (editScope === 'detail') materialNameRef.current?.focus();
                  else firstFieldRef.current?.focus();
                });
              },
              disabled: deletedPlaceholder != null || !isViewMode || currentIsPosted,
            }}
            save={{ onClick: () => doSave(false), disabled: deletedPlaceholder != null || isViewMode || !isValid, title: 'Save — keep editing this purchase' }}
            done={{ submit: true, form: 'purchase-entry-form', disabled: deletedPlaceholder != null || isViewMode || !isValid, title: 'Done — finish this purchase, then Post it' }}
            cancel={{
              onClick: async () => {
                if (purchaseId == null) return;
                const res = await api.purchases.get(purchaseId);
                if (res.ok) await loadPurchaseRow(res.data);
              },
              disabled: mode !== 'edit',
              title: 'Cancel Edit',
            }}
            first={{ onClick: handleNavFirst, disabled: !canBrowse }}
            prev={{ onClick: handleNavPrevious, disabled: !canNavPrevious, title: 'Previous' }}
            next={{ onClick: handleNavNext, disabled: !canNavNext }}
            last={{ onClick: handleNavLast, disabled: !canBrowse }}
            print={{ onClick: () => setIsPrintingSingle(true), disabled: deletedPlaceholder != null || !isViewMode || purchaseId == null }}
            find={{ onClick: () => setIsFindOpen(true) }}
            unpost={{ onClick: handleUnpost, disabled: deletedPlaceholder != null || !isViewMode || purchaseId == null || !currentIsPosted, title: 'Unpost — move this posted purchase back to drafts' }}
            post={{ onClick: async () => { await handlePost(); focusNewButton(); }, disabled: deletedPlaceholder != null || !isViewMode || purchaseId == null || currentIsPosted }}
            exit={{ onClick: () => dispatch({ type: 'NAVIGATE', page: 'home' }) }}
            postAll={{ onClick: async () => { await handlePostAll(); focusNewButton(); }, disabled: postAllBusy || navFilter === 'posted' || unpostedPurchases.length === 0, title: postAllBusy ? 'Posting…' : `Post All (${unpostedPurchases.length})` }}
            pdf={{ onClick: () => setIsPrintingSingle(true), disabled: deletedPlaceholder != null || !isViewMode || purchaseId == null, title: 'Export PDF' }}
            excel={{
              onClick: () => {
                const headers = ['Material', 'Unit', 'Quantity', 'Rate', 'Total Price'];
                const rows = items.map(it => [it.materialName, it.unit, it.quantity, it.pricePerUnit, it.totalPrice]);
                exportRowsToExcel(`purchase-${billNo || purchaseId}`, headers, rows);
              },
              disabled: deletedPlaceholder != null || !isViewMode || purchaseId == null,
              title: 'Export Excel',
            }}
          />

          {/* Posted/Unposted — picks which list Previous/Next/First/Last page through. Unposted
              (default) = add/post new purchases; Posted = browse already-posted ones (per the
              user, 2026-08-30). Uses soleria-input-compact rather than a forced inline height on
              the full-size soleria-input — that combination fought the class's own padding/
              line-height and clipped the text, which is what "doesn't appear properly" was. */}
          <select
            value={navFilter}
            onChange={e => handleNavFilterChange(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Which purchases First/Prev./Next/Last page through: posted ones, or saved-but-unposted drafts."
          >
            <option value="unposted">Unposted ({unpostedPurchases.length})</option>
            <option value="posted">Posted ({sortedPurchases.length})</option>
          </select>

          {/* Post All's outcome. Was shown inside the left-hand Pending Posting panel; that panel
              is gone (per the user, 2026-09-03), so it lands here under the toolbar instead. A run
              can post 8 of 10, and the two that failed are the whole point — it stays until
              dismissed. */}
          {postAllResult && (
            <div className="w-full mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}>
              <p className="font-semibold text-slate-700">
                {postAllResult.posted.length} of {postAllResult.attempted} posted
                {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                <button type="button" onClick={() => setPostAllResult(null)} className="ml-2 text-slate-500 hover:text-slate-700 font-semibold">Dismiss</button>
              </p>
              {postAllResult.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {postAllResult.failed.map((fail, i) => (
                    <li key={i} className="text-rose-700">{fail.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Centred directly under the toolbar rather than
            out in the page margin where it used to sit, so it reads as part of the same
            control strip as the Edit button it modifies (per the user, 2026-09-04). */}
        <EditScopeRadios name="purchase-edit-scope" value={editScope} onChange={setEditScope} />

        {/* This <form> IS the invoice card — height pinned to the remaining viewport space (see
            invoiceCardHeight above) and laid out as a flex column, so the item table below can
            flex-grow into whatever room that leaves. Every other child here keeps its natural
            size (shrink-0) — only the table wrapper is flex-1. */}
        <form
          id="purchase-entry-form"
          noValidate
          ref={invoiceCardRef}
          onSubmit={handleSave}
          className="card-white p-6 bg-white border flex flex-col"
          data-edit-scope="detail"
          style={{ height: invoiceCardHeight ?? undefined, position: 'relative' }}
          data-no-print
        >
          {deletedPlaceholder != null && <DeletedDocumentOverlay systemNo={deletedPlaceholder} label="purchase" />}
          <div className="shrink-0 flex items-center gap-2 border-b pb-3 mb-5">
            <ShoppingBag size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-bold text-lg text-slate-900">Raw Material Purchase</h3>
          </div>

          {/* Header fields */}
          <div className="shrink-0 grid grid-cols-1 md:grid-cols-5 gap-4 mb-6" data-edit-scope="master">
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                ref={firstFieldRef}
                type="date"
                required
                value={date}
                disabled={isViewMode || masterFieldsLocked}
                onChange={e => setDate(e.target.value)}
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              {/* System Bill No. — a stable number assigned once at draft creation and carried
                  through posting unchanged (see 031_document_system_numbers.sql), never typed.
                  Read-only always, matching the legacy Wentox screenshot's auto "Bill No." box.
                  Distinct from "Vendor Bill No." below, which is the vendor's own free-text
                  invoice number. Before a save, shows nextSystemBillNo — a PREVIEW of what Save
                  will assign, not the assigned number itself yet. */}
              <label className="block text-xs font-bold text-slate-900 mb-1">System Bill No.</label>
              <input
                type="text"
                value={currentSystemNo != null ? `#${currentSystemNo}` : hasClickedNew ? `#${nextSystemBillNo}` : ''}
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
                disabled={isViewMode || masterFieldsLocked}
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
                  required
                  disabled={isViewMode || masterFieldsLocked}
                  value={vendorSearchText}
                  onChange={e => setVendorSearchText(e.target.value)}
                  onKeyDown={handleVendorTriggerKeyDown}
                  placeholder="Type a vendor name, or press Enter to search..."
                  className="soleria-input pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || masterFieldsLocked}
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
                disabled={isViewMode || masterFieldsLocked}
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
                    required
                    disabled={detailFieldsLocked}
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
                      required
                      disabled={detailFieldsLocked}
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
                      required
                      disabled={detailFieldsLocked}
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
                    required
                    disabled={detailFieldsLocked}
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
                    required
                    disabled={detailFieldsLocked}
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
                    disabled={detailFieldsLocked}
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
                  {/* G-05 (changes-14-09-26.md, 2026-09-15): narrow gutter for the ▶ row pointer —
                      unlabeled, matching the ref pic (ref-pics/batch2/jv2.0.jpeg). */}
                  <th className="sticky top-0 z-10 bg-slate-50 p-1" style={{ width: '18px' }} />
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 pl-4" style={{ minWidth: '200px' }}>Material / Product Name</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3" style={{ width: '160px' }}>Unit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-center" style={{ width: '110px' }}>Quantity</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-center" style={{ width: '130px' }}>Price / Unit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-right" style={{ width: '130px' }}>Total Price</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '84px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400 text-sm">
                      No articles added yet — fill the fields above and press Enter.
                    </td>
                  </tr>
                ) : items.map(item => (
                  <tr
                    key={item.uid}
                    ref={el => { rowRefs.current[item.uid] = el; }}
                    onClick={() => {
                      // G-08: a click must produce no visible change — it only records which row
                      // the Delete/Edit Row toolbar buttons act on next. Inert entirely while
                      // another row is actually loaded for editing.
                      if (editingUid != null) return;
                      if (isViewMode || detailFieldsLocked) return;
                      setSelectedUid(prev => prev === item.uid ? null : item.uid);
                    }}
                    title={!isViewMode && !detailFieldsLocked ? 'Click to select this article — Delete (toolbar) removes it' : undefined}
                    className={`border-b transition-colors ${
                      item.uid === editingUid ? 'bg-blue-50' : 'hover:bg-slate-50/55'
                    } ${!isViewMode && !detailFieldsLocked ? 'cursor-pointer' : ''}`}
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    {/* G-05: a pure position indicator — never a background/highlight, so it can
                        never be confused with G-08's edit highlight above. */}
                    <td className="p-1 text-center text-emerald-600" aria-hidden="true">
                      {item.uid === lastEnteredUid && '▶'}
                    </td>
                    <td className="p-3 pl-4 font-semibold text-slate-800">{item.materialName}</td>
                    <td className="p-3 text-slate-600">{item.unit}</td>
                    <td className="p-3 text-center font-semibold text-slate-700">{item.quantity}</td>
                    <td className="p-3 text-center font-semibold text-slate-700">{formatCurrency(item.pricePerUnit)}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(item.totalPrice)}</td>
                    <td className="p-3 text-center whitespace-nowrap">
                      <RowActions
                        onEdit={() => handleEditRow(item)}
                        onDelete={() => removeItemRow(item.uid)}
                        disabled={deletedPlaceholder != null || isViewMode || detailFieldsLocked || editingUid != null}
                        editTitle="Edit this article"
                        deleteTitle="Delete this article"
                        disabledTitle="Unpost and edit the document (Detail scope) to change its articles"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 font-bold text-slate-800" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="p-3 pl-4" colSpan={5}>Grand Total</td>
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
                  required
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
                  onClick={closeAddVendor}
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
          subtitle="This deletes the WHOLE purchase and every article on it — not a single row. It cannot be undone. Enter your password to confirm."
        />

        {/* Find Purchase Modal — jump to any posted or unposted purchase by System No., manual
            bill no., or vendor name. */}
        {isFindOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">Find Purchase</h3>
              <input
                type="text"
                value={findQuery}
                onChange={e => setFindQuery(e.target.value)}
                placeholder="System No., bill no., or vendor name..."
                className="soleria-input w-full font-semibold mb-3"
                autoFocus
              />
              <ul className="max-h-72 overflow-y-auto border rounded-lg divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {findResults.map(({ filter, row }) => (
                  <li
                    key={`${filter}-${'purchase_id' in row ? row.purchase_id : row.draft_id}`}
                    onClick={() => handleFindSelect(filter, row)}
                    className="px-3 py-2 text-xs cursor-pointer hover:bg-amber-50/60 flex items-center justify-between gap-2"
                  >
                    <span className="font-mono font-semibold text-slate-700">{row.bill_no || `#${row.system_no}`}</span>
                    <span className="text-slate-400 truncate">{vendors.find(v => v.vendor_id === row.vendor_id)?.name || 'Unnamed Vendor'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${filter === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{filter}</span>
                  </li>
                ))}
                {findQuery.trim() && findResults.length === 0 && (
                  <li className="px-3 py-3 text-xs text-slate-400 text-center">No matching purchases.</li>
                )}
              </ul>
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={closeFindPurchase}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      <ReportPrintPreviewModal
        isOpen={isPrintingSingle}
        onClose={() => setIsPrintingSingle(false)}
        title={`Purchase Invoice ${billNo ? `#${billNo}` : currentSystemNo != null ? `#${currentSystemNo}` : ''}`}
        orientation="portrait"
      >
        {renderPurchasePrintable()}
      </ReportPrintPreviewModal>
    </AppLayout>
  );
}
