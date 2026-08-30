import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchModal from '@/components/SearchModal';
import * as api from '@/lib/api';
import type {
  VendorRow, CityRow, PurchaseRow, PurchaseItemRow, PurchaseReturnRow, PurchaseReturnCreateInput,
  PurchaseReturnItemInput, DraftPurchaseReturnRow, ConfirmAllResult
} from '@/lib/api';
import { formatDate, getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import { focusNextField } from '@/lib/fieldNav';
import {
  Plus, Trash2, Save, Undo2, Edit, CheckCircle2, XCircle, ChevronDown,
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

// The live article-entry row (not yet committed to `items`) — matches PurchasePage's pattern
// (see frontend/pages_design.md §4): one editable article field set above the grid, not one
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
  return 'pri_' + Date.now() + Math.random().toString(36).slice(2, 7);
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

  // Every saved-unposted Purchase Return now lives in draft_purchase_returns — the real
  // purchase_returns table strictly never holds an unposted document (same architecture change as
  // Sale Bill/Sale Return/Purchase). Mirrors P-03 on PurchasePage.
  const [unpostedReturns, setUnpostedReturns] = useState<DraftPurchaseReturnRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<ConfirmAllResult | null>(null);
  const [postingDraftId, setPostingDraftId] = useState<number | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.draftPurchaseReturns.list();
    if (res.ok) setUnpostedReturns(res.data);
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
    refreshUnposted();
  }, [refreshReturns, refreshUnposted]);

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');

  const [returnId, setReturnId] = useState<number | null>(null);
  const [currentIsPosted, setCurrentIsPosted] = useState(false);
  // A New Return's own in-progress fields persist across switching pages AND an app restart
  // (usePersistentField — see src/hooks/usePersistentField.ts), so typing one up and getting
  // pulled away mid-entry never loses it. Deliberately NOT applied to mode/returnId/
  // currentIsPosted — an already-saved (or drafted) return loaded for view/edit is safely
  // re-openable by id at any time, so caching it risks showing a stale copy instead; only unsaved
  // "new" work is ever at real risk of being lost for good.
  const clearPurchaseReturnDraft = useClearPageDraft('purchase-return');
  const [date, setDate] = usePersistentField('purchase-return', 'date', getTodayDate());
  const [vendorId, setVendorId] = usePersistentField('purchase-return', 'vendorId', '');
  const [billNo, setBillNo] = usePersistentField('purchase-return', 'billNo', '');
  const [remarks, setRemarks] = usePersistentField('purchase-return', 'remarks', '');
  // `items` holds only COMMITTED rows — the grid below the entry fields. The row currently being
  // typed lives separately in `currentRow` until Enter (or the Add button) commits it.
  const [items, setItems] = usePersistentField<UiItem[]>('purchase-return', 'items', []);
  const [currentRow, setCurrentRow] = usePersistentField<CurrentRow>('purchase-return', 'currentRow', emptyCurrentRow());
  // Set while re-editing an existing grid row (clicked from the list below) — commit updates that
  // row in place instead of appending a new one. null means the entry fields are building a new row.
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [isCustomUnit, setIsCustomUnit] = useState(false);
  // Which prior purchase this in-progress return is being built against — real not-yet-saved
  // entry state (drives which articles/prices are valid to type), so persisted alongside the
  // other entry fields above.
  const [copyFromPurchaseId, setCopyFromPurchaseId] = usePersistentField('purchase-return', 'copyFromPurchaseId', '');

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

  // Preview of the System Bill No. a brand-new return will get — see PurchasePage's identical
  // nextSystemBillNo for why this is the next draft_purchase_returns.draft_id, not the next real
  // return_id (a separate IDENTITY sequence only assigned later, on Post), and why it's a preview
  // rather than a guarantee.
  const nextSystemBillNo = useMemo(
    () => Math.max(0, ...unpostedReturns.map(d => d.draft_id)) + 1,
    [unpostedReturns]
  );

  // Vendor field is a typable <input> (2026-08-27, matching PurchasePage.tsx: "do this purchase
  // return page like before pressing enter we can type it and it shows us the result of that in
  // modal pop up and we can also search for it") — type a vendor name/city and press Enter to
  // open "Select Vendor" seeded with what's typed, with full search still available inside; Arrow
  // Up/Down open it blank for the full list. The chevron button alongside it still opens the full
  // list blank on a plain click. Committing a vendor closes the modal, updates the displayed text
  // (see the sync effect below), and advances focus via the app's G-01 rule.
  const vendorTriggerRef = useRef<HTMLInputElement>(null);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [vendorSearchText, setVendorSearchText] = useState('');
  // Seeds the modal's search box when opened via Enter on the typed input (blank when opened via
  // the chevron button or Arrow Up/Down instead).
  const [vendorModalSeed, setVendorModalSeed] = useState('');

  // Keeps the input's displayed text in sync with whatever vendorId actually is — covers every
  // place vendorId gets set (picking one, copying from a prior purchase, New Return clearing it,
  // loading a posted/draft record) without duplicating each of those call sites. Typing itself
  // never touches vendorId, so this never fights the user mid-type.
  useEffect(() => {
    const opt = vendorOptions.find(o => o.value === vendorId);
    setVendorSearchText(opt?.label ?? '');
  }, [vendorId, vendorOptions]);

  const openVendorModal = () => {
    if (isViewMode || isCopiedFromPurchase) return;
    setVendorModalSeed('');
    setIsVendorModalOpen(true);
  };

  function handleVendorTriggerKeyDown(e: React.KeyboardEvent) {
    // stopPropagation on every branch — otherwise this keydown keeps bubbling past the trigger up
    // to window-level listeners (AppLayout's own G-01 field-walk), acting on it at the same time
    // the modal opens. Same reasoning as SearchModal's own internal keydown handling.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openVendorModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode || isCopiedFromPurchase) return;
      setVendorModalSeed(vendorSearchText);
      setIsVendorModalOpen(true);
    }
  }

  function handleVendorSelect(newVendorId: string) {
    setVendorId(newVendorId);
    setCopyFromPurchaseId('');
    setSourcePurchaseItems([]);
    // PR-01: forget which name was already priced — the same material has a different last-paid
    // price under a different vendor, so the entry row re-looks-up on its next blur.
    lastResolvedNameRef.current = '';
    setIsVendorModalOpen(false);
    requestAnimationFrame(() => focusNextField(vendorTriggerRef.current));
  }

  // Prior purchases from this vendor, to optionally prefill a return. The label carries BOTH the
  // system bill no. (#purchase_id, auto-assigned, never typed) and the vendor's own bill_no, so
  // typing either into the search box finds the right purchase — SearchableSelect matches typed
  // text against this label (and against `value`, which is also the system number, redundantly).
  const priorPurchaseOptions = useMemo(() => {
    return priorPurchases
      .filter(p => !vendorId || p.vendor_id === Number(vendorId))
      .map(p => ({
        value: String(p.purchase_id),
        label: `#${p.purchase_id} · ${p.bill_no || 'No Vendor Bill No.'} · ${formatDate(p.purchase_date)} — ${formatCurrency(p.total_value)}`
      }));
  }, [priorPurchases, vendorId]);

  // isCopiedFromPurchase: true once an actual purchase (not "Manual entry") is picked — Vendor,
  // Vendor Bill No. and Remarks then all come FROM that purchase and lock (disabled, alongside
  // isViewMode) so they can't quietly drift from the document being returned. Picking "Manual
  // entry" again unlocks them for hand typing, per the user's explicit "non editable or I can
  // choose manually" (2026-08-26).
  const isCopiedFromPurchase = !!copyFromPurchaseId;

  // The picked purchase's own items — copied straight into `items` (see handleCopyFromPurchase
  // below), same as vendor/bill no./remarks, but ALSO kept here on the side as a validation
  // reference: any further edit through the entry row (bumping a copied row's quantity, or typing
  // in an extra article afterward) is checked against this list — must exist on the purchase, and
  // its quantity can't exceed what was actually purchased — see articleAgainstPurchaseError below.
  const [sourcePurchaseItems, setSourcePurchaseItems] = usePersistentField<PurchaseItemRow[]>('purchase-return', 'sourcePurchaseItems', []);

  // `copyItems` distinguishes the two ways a purchase gets attached here (2026-08-27, per the
  // user's correction): picking one explicitly via "Find Purchase to Return" copies EVERYTHING,
  // articles included (copyItems=true, the default) — that's a deliberate "return this whole
  // bill" action. But typing a Vendor Bill No. that happens to match one, in Manual entry
  // (handleBillNoBlur below), only auto-fills the MASTER fields — Vendor and Remarks. Articles in
  // that case are still added one at a time by hand (copyItems=false): each is checked against
  // `sourcePurchaseItems` as it's typed (articleAgainstPurchaseError) and, once matched by name,
  // takes that source line's price — non-editable — while quantity stays free to type.
  const handleCopyFromPurchase = async (purchaseIdStr: string, copyItems = true) => {
    setCopyFromPurchaseId(purchaseIdStr);
    if (!purchaseIdStr) {
      setSourcePurchaseItems([]);
      return;
    }
    // list() rows never carry items — fetch the full record before reading its line items.
    const res = await api.purchases.get(Number(purchaseIdStr));
    if (!res.ok) {
      setErrorMsg('Failed to load prior purchase: ' + res.error.message);
      return;
    }
    const purchase = res.data;
    setVendorId(String(purchase.vendor_id));
    // Show the SOURCE purchase's own Vendor Bill No. and Remarks in those fields too — previously
    // only the vendor and items were copied, so a picked purchase's own bill no./remarks were
    // visible nowhere but the picker's own trigger label. Reported directly by the user.
    setBillNo(purchase.bill_no || '');
    setRemarks(purchase.remarks || '');
    // sourcePurchaseItems is kept regardless of copyItems — it's what every typed article gets
    // validated (and, for the auto-lookup path, priced) against, whether or not the items array
    // itself was auto-populated from it.
    setSourcePurchaseItems(purchase.items);
    if (copyItems) {
      // Explicit "Find Purchase to Return" pick — articles DO auto-copy, same as vendor/bill
      // no./remarks (2026-08-26 correction): the "not auto-copied" behavior only ever applies to
      // Manual entry, which has nothing to copy from in the first place.
      setItems(purchase.items.map(it => ({
        uid: newItemUid(),
        materialName: it.material_name || '',
        unit: it.unit,
        quantity: it.quantity,
        pricePerUnit: it.price_per_unit,
        totalPrice: it.total_price
      })));
    } else {
      // Manual entry, auto-matched by typed bill no. — master fields only; articles are still
      // added one at a time through the entry row below, each checked against sourcePurchaseItems.
      setItems([]);
    }
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
  };

  // Manual-entry auto-lookup by typed Vendor Bill No. (2026-08-26, per the user: "when we enter
  // the number the vendor name and remarks auto selected and no editable ... I am talking about
  // in manual entries" — refined 2026-08-27: "manual entry" means only the MASTER fields
  // auto-fill; articles are still added by hand, just checked against the matched bill and
  // priced from it). Fires on blur (not every keystroke) so it doesn't fight the user mid-type.
  // Only runs in Manual entry — once a purchase is already picked (isCopiedFromPurchase), the
  // field is disabled anyway. An exact, case-insensitive match against a prior purchase's own
  // bill_no reuses handleCopyFromPurchase with copyItems=false, so Vendor/Remarks lock exactly
  // like the "Find Purchase to Return" picker does, but items stay empty for manual entry. No
  // match, or an empty field, just leaves it as a free-typed Vendor Bill No. with nothing to lock.
  const handleBillNoBlur = () => {
    if (isCopiedFromPurchase) return;
    const typed = billNo.trim().toLowerCase();
    if (!typed) return;
    const match = priorPurchases.find(p => (p.bill_no || '').trim().toLowerCase() === typed);
    if (match) {
      void handleCopyFromPurchase(String(match.purchase_id), false).then(() => {
        // Master fields are done (Vendor/Remarks just auto-filled) — jump straight to the first
        // article field so the user can start typing articles right away, per the user
        // (2026-08-27): "the mouse auto move to the first entry of the article."
        materialNameRef.current?.focus();
      });
    }
  };

  // Validates one article's name + PRICE + quantity against `sourcePurchaseItems` — only while
  // isCopiedFromPurchase (Manual entry has no purchase to validate against, so it's always
  // unrestricted). Matching by name alone isn't enough: the same purchase can list the same
  // article twice at two different prices (e.g. two batches bought at different rates), and each
  // price is its own pool of quantity to return against. So the match — and the "already used"
  // running total — is keyed on name+price together; only quantity is free to differ from the
  // source line, per the user (2026-08-26): "same article with the same price the quantity might
  // differ." `excludeUid` leaves the row currently being edited out of the "already used" running
  // total, so re-editing a row's own quantity doesn't count itself twice.
  function articleAgainstPurchaseError(materialName: string, quantity: number, pricePerUnit: number, excludeUid?: string | null): string | null {
    if (!isCopiedFromPurchase) return null;
    const name = materialName.trim().toLowerCase();
    if (!name) return null;

    const sourceItem = sourcePurchaseItems.find(it =>
      (it.material_name || '').trim().toLowerCase() === name && it.price_per_unit === pricePerUnit
    );
    if (!sourceItem) {
      const sameNameDifferentPrice = sourcePurchaseItems.some(it => (it.material_name || '').trim().toLowerCase() === name);
      if (sameNameDifferentPrice) {
        return `"${materialName.trim()}" was purchased at a different price — match the price it was bought at to return it.`;
      }
      return `"${materialName.trim()}" was not on the purchased bill — it can't be returned against it.`;
    }
    const alreadyUsed = items
      .filter(it => it.uid !== excludeUid && it.materialName.trim().toLowerCase() === name && it.pricePerUnit === pricePerUnit)
      .reduce((s, it) => s + it.quantity, 0);
    const remaining = sourceItem.quantity - alreadyUsed;
    if (quantity > remaining) {
      return `Only ${remaining} ${sourceItem.unit} of "${materialName.trim()}" left to return (purchased ${sourceItem.quantity}, already used ${alreadyUsed}).`;
    }
    return null;
  }

  // "Find Purchase to Return" opens the same big centered SearchModal as Vendor (§5 of
  // frontend/pages_design.md) rather than SearchableSelect's small anchored panel — typing either
  // the vendor's own bill no. or the system bill no. finds it (priorPurchaseOptions' label above
  // carries both). Placed as the very first field after Date: picking a purchase here fills the
  // vendor and items for you, so it doesn't need Vendor picked first the way it used to.
  //
  // Also a typable <input> (2026-08-27, same pattern as Vendor: "also apply it on manual entry
  // field" — this is the field whose default/unset state literally reads "Manual entry"). Type
  // and press Enter to open it seeded with what's typed, full search still available inside;
  // Arrow Up/Down (or the chevron button) open it blank for the full list.
  const findPurchaseTriggerRef = useRef<HTMLInputElement>(null);
  const [isFindPurchaseModalOpen, setIsFindPurchaseModalOpen] = useState(false);
  const [findPurchaseSearchText, setFindPurchaseSearchText] = useState('');
  const [findPurchaseModalSeed, setFindPurchaseModalSeed] = useState('');

  // Syncs the displayed text to whatever purchase is actually picked (or "Manual entry" once
  // cleared) — mirrors the Vendor field's own sync effect above.
  useEffect(() => {
    const opt = priorPurchaseOptions.find(o => o.value === copyFromPurchaseId);
    setFindPurchaseSearchText(opt?.label ?? '');
  }, [copyFromPurchaseId, priorPurchaseOptions]);

  const openFindPurchaseModal = () => {
    if (isViewMode) return;
    setFindPurchaseModalSeed('');
    setIsFindPurchaseModalOpen(true);
  };

  function handleFindPurchaseTriggerKeyDown(e: React.KeyboardEvent) {
    // stopPropagation on every branch — otherwise this keydown keeps bubbling past the trigger up
    // to window-level listeners (AppLayout's own G-01 field-walk), acting on it at the same time
    // the modal opens. Same reasoning as SearchModal's own internal keydown handling.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openFindPurchaseModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setFindPurchaseModalSeed(findPurchaseSearchText);
      setIsFindPurchaseModalOpen(true);
    }
  }

  // Vendor Bill No. no longer opens this modal on Enter (2026-08-27, per the user: "remove modal
  // pop up from vendor bill number only add this manual entry field like we can type befoir
  // pressing enter") — it's back to a plain typable field. The auto-match still happens, just on
  // blur (handleBillNoBlur below), with no popup involved: an exact match against a prior
  // purchase's own bill_no auto-fills Vendor/Remarks (master fields only, items stay manual),
  // same as before this modal experiment.
  async function handleFindPurchaseSelect(purchaseIdStr: string) {
    setIsFindPurchaseModalOpen(false);
    await handleCopyFromPurchase(purchaseIdStr);
    requestAnimationFrame(() => focusNextField(findPurchaseTriggerRef.current));
  }

  const updateCurrentField = (field: keyof CurrentRow, value: string | number) => {
    setCurrentRow(prev => ({ ...prev, [field]: value }));
  };

  const currentRowTotal = useMemo(
    () => Number(currentRow.quantity) * Number(currentRow.pricePerUnit),
    [currentRow]
  );

  // PR-01: a return must credit the vendor at the price actually paid, not at whatever the user
  // happens to type. When the entry row's material name is finished (blur), look up what this
  // vendor was last paid for it on a POSTED purchase and fill in that price and its unit.
  //
  // Keyed off blur rather than every keystroke: the name is free text, so mid-typing it names
  // nothing. `lastResolvedNameRef` remembers the name the entry row was last filled from, so
  // re-blurring an unchanged field never overwrites a price the user has since edited by hand —
  // while genuinely changing the material does refill. Cleared when the vendor changes (above),
  // since the same material has a different price per vendor, and primed to the row's own name
  // when reopening an existing row for edit (handleEditRow) so that doesn't immediately re-fetch
  // and clobber a hand-edited or copied-from-purchase rate either.
  const lastResolvedNameRef = useRef('');

  const fillRateFromLastPurchase = async (rawName: string) => {
    const name = rawName.trim();
    if (!name || !vendorId) return;
    if (lastResolvedNameRef.current === name) return;
    lastResolvedNameRef.current = name;

    // While copied from a specific purchase, use THAT bill's own rate for this article — it's the
    // exact price actually paid on the document being returned, which beats "whatever was last
    // posted for this vendor+material" (fillRateFromLastPurchase's usual API lookup, still used in
    // Manual entry mode below) when the two happen to differ.
    if (isCopiedFromPurchase) {
      const sourceItem = sourcePurchaseItems.find(it => (it.material_name || '').trim().toLowerCase() === name.toLowerCase());
      if (sourceItem) {
        setCurrentRow(prev => ({ ...prev, pricePerUnit: sourceItem.price_per_unit, unit: sourceItem.unit }));
        setIsCustomUnit(!UNIT_PRESETS.includes(sourceItem.unit));
      }
      // No match here is fine to leave silent — articleAgainstPurchaseError (shown live below the
      // field) is what actually reports "not on this bill" and blocks committing the row.
      return;
    }

    const res = await api.purchases.lastPurchasedRate(Number(vendorId), name);
    // No prior posted purchase (data === null) leaves the line exactly as typed — a first-time
    // material legitimately has no history, and guessing a price would be worse than leaving it.
    if (!res.ok || !res.data) return;
    const { price_per_unit, unit } = res.data;

    setCurrentRow(prev => ({ ...prev, pricePerUnit: price_per_unit, unit }));
    // Keep the unit control in sync: a fetched unit outside the presets needs the free-text box
    // showing, or the select would silently snap the row back to a preset.
    setIsCustomUnit(!UNIT_PRESETS.includes(unit));
  };

  // Article entry, matching PurchasePage's pattern (frontend/pages_design.md §4): ONE editable
  // article field set above the grid, not one editable row per grid entry. Committing (Enter on
  // Price, or the Add button) either appends a new grid row or — while `editingUid` is set —
  // updates that row in place, then always clears the entry fields and refocuses Material for the
  // next article. Save/Post is reached only by clicking the toolbar button, never by walking off
  // the entry row with Enter.
  const materialNameRef = useRef<HTMLInputElement>(null);

  // Live, as the entry row's own fields change — recomputed on every keystroke of Material/
  // Quantity rather than only on commit, so the message (rendered below the entry row) appears
  // before the user even tries to commit, not as a surprise rejection afterward.
  const currentRowError = useMemo(
    () => articleAgainstPurchaseError(currentRow.materialName, currentRow.quantity, currentRow.pricePerUnit, editingUid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRow.materialName, currentRow.quantity, currentRow.pricePerUnit, editingUid, isCopiedFromPurchase, sourcePurchaseItems, items]
  );

  const commitCurrentRow = () => {
    const materialName = currentRow.materialName.trim();
    const unit = currentRow.unit.trim();
    if (!materialName || !unit || !(currentRow.quantity > 0) || !(currentRow.pricePerUnit > 0)) {
      return; // incomplete row — nothing to commit yet, leave focus where it is
    }
    if (currentRowError) {
      setErrorMsg(currentRowError);
      return; // blocked — must match an article/quantity actually on the picked purchase
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
  // PR-01: priming lastResolvedNameRef to this row's own name means reopening it for edit doesn't
  // immediately re-fetch and clobber a hand-edited or copied-from-purchase rate on the first blur.
  const handleEditRow = (item: UiItem) => {
    if (isViewMode) return;
    setCurrentRow({ materialName: item.materialName, unit: item.unit, quantity: item.quantity, pricePerUnit: item.pricePerUnit });
    setEditingUid(item.uid);
    setIsCustomUnit(!UNIT_PRESETS.includes(item.unit));
    lastResolvedNameRef.current = item.materialName.trim();
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

  // Toolbar "Delete" targets the selected ARTICLE (the row clicked into the entry fields below),
  // not the whole return — return deletion stays where it was, password-gated in the Pending
  // Posting panel. Disabled until a row is selected (editingUid set).
  const deleteSelectedArticle = () => {
    if (editingUid) removeItemRow(editingUid);
  };

  // Invoice card (the <form> itself — see its opening tag below) fills whatever vertical space is
  // left in the viewport below it (mirrors SaleBillPage/SaleReturnPage/PurchasePage) — the item
  // table (flex-1 inside it) grows into that space, and the outer app window never scrolls (only
  // the table does). Measured via getBoundingClientRect rather than a CSS calc() of fixed chrome
  // heights, since the banners above this form change height dynamically.
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
  }, [mode, lookupError, successMsg, errorMsg]);

  const grandTotal = useMemo(() => items.reduce((s, it) => s + it.totalPrice, 0), [items]);

  const isValid = useMemo(() => {
    if (!vendorId || !date) return false;
    return items.length > 0;
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
    setItems([]);
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
    setCopyFromPurchaseId('');
    setSourcePurchaseItems([]);
    lastResolvedNameRef.current = '';
    setErrorMsg('');
    clearPurchaseReturnDraft();
  };

  // "New Return" (toolbar button and the entry-tab switch) focuses Date, matching PurchasePage's
  // startNewPurchase (frontend/pages_design.md §2).
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const startNewReturn = () => {
    handleNew();
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  const buildPayload = (): PurchaseReturnCreateInput | null => {
    if (!vendorId) { setErrorMsg('Vendor is required.'); return null; }
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (!isValid) { setErrorMsg('At least one article is required.'); return null; }

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

  // Editing a POSTED return in place was never allowed here (purchaseReturns.service.js#update()
  // always throws POSTED_LOCK on an is_posted row) — must unpost first, same as Purchase. So under
  // the draft-table model, mode==='edit' unconditionally means editing a draft: there's no
  // "isEditingPosted" branch to worry about the way Sale Bill/Return have one.
  // `finalize` decides what the form does AFTER a successful save, and nothing else:
  //   true  ("Done")  -> lock to view mode; the return stays fully on screen and Post lights up.
  //   false ("Save")  -> stay editable so more articles can be added to the SAME return.
  // Mirrors PurchasePage's own doSave — see its comment for why the non-finalize path flips mode
  // to 'edit' rather than leaving it 'new' (otherwise the next Save creates a duplicate draft).
  const doSave = async (finalize: boolean) => {
    const payload = buildPayload();
    if (!payload) return;

    const result = mode === 'edit' && returnId != null
      ? await api.draftPurchaseReturns.update(returnId, payload)
      : await api.draftPurchaseReturns.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save purchase return: ' + result.error.message);
      return;
    }

    setReturnId(result.data.draft_id);
    setCurrentIsPosted(false);
    // Only a freshly created return (not an edit of an existing draft) is "done" work whose
    // draft should stop being cached — mirrors PurchasePage's isNewPurchase distinction.
    if (mode !== 'edit') clearPurchaseReturnDraft();
    setErrorMsg('');
    setSuccessMsg(mode === 'edit' ? 'Purchase return updated successfully.' : 'Purchase return recorded successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode(finalize ? 'view' : 'edit');
    refreshUnposted(); // P-03: a newly saved return joins the pending-posting list immediately.
  };

  // The <form>'s own onSubmit — reached by the Done button (type="submit") and by the Enter-key
  // walk finishing on the last field, both of which mean "I'm finished with this return".
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await doSave(true);
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
    setSourcePurchaseItems([]);
    setItems(row.items.map(it => ({
      uid: 'pri_' + it.item_id,
      materialName: it.material_name || '',
      unit: it.unit,
      quantity: it.quantity,
      pricePerUnit: it.price_per_unit,
      totalPrice: it.total_price
    })));
    setCurrentRow(emptyCurrentRow());
    setEditingUid(null);
    setIsCustomUnit(false);
    // PR-01: an existing return's saved rates are the record — never re-priced on open/edit.
    lastResolvedNameRef.current = '';
    setErrorMsg('');
    setMode('view');
  };

  // Post = confirm the draft: moves it from draft_purchase_returns into the real purchase_returns
  // table, writing ledger + vendor stock, deleting the draft. Only reachable while
  // !currentIsPosted, so returnId is always a draft_id here.
  const handlePost = async () => {
    if (returnId == null) return;
    const res = await api.draftPurchaseReturns.confirm(returnId);
    if (!res.ok) {
      setErrorMsg('Failed to post purchase return: ' + res.error.message);
      return;
    }
    setReturnId(res.data.return_id);
    setCurrentIsPosted(true);
    setSuccessMsg('Purchase return posted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshReturns();
    refreshUnposted(); // P-03: it just left the pending list.
  };

  // "Unpost" now moves the return back to being a draft — the real purchase_returns table strictly
  // never holds an unposted document. The form now points at a different id (the new draft's).
  const handleUnpost = async () => {
    if (returnId == null) return;
    const res = await api.purchaseReturns.unconfirm(returnId);
    if (!res.ok) {
      setErrorMsg('Failed to unpost purchase return: ' + res.error.message);
      return;
    }
    setReturnId(res.data.draft_id);
    setCurrentIsPosted(false);
    setMode('edit'); // land on the editable screen straight away, not the read-only view
    setSuccessMsg('Purchase return unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshReturns();
    refreshUnposted();
  };

  // P-03: post the whole run via the real backend batch endpoint (draftPurchaseReturns.confirmAll).
  const handlePostAll = async () => {
    setPostAllBusy(true);
    setPostAllResult(null);
    const res = await api.draftPurchaseReturns.confirmAll();
    setPostAllBusy(false);

    if (!res.ok) {
      setErrorMsg('Failed to post purchase returns: ' + res.error.message);
      return;
    }
    setPostAllResult(res.data);
    if (res.data.failed.length === 0) {
      setSuccessMsg(`${res.data.posted.length} purchase return(s) posted.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    await Promise.all([refreshUnposted(), refreshReturns()]);
    // The draft open on screen (if any) may have just been posted — its id is gone either way
    // (ConfirmAllResult doesn't carry the new return_id back), so reset rather than leave the
    // form pointed at nothing.
    if (returnId != null && !currentIsPosted && res.data.posted.some(p => p.draft_id === returnId)) {
      handleNew();
    }
  };

  // Pending Posting panel: opening a row loads that draft straight into the form — no password
  // (drafts never needed one on this page; only a password-gated delete is new, below).
  // `opts.mode` lets the nav buttons open a draft READ-ONLY while browsing (look-then-decide),
  // while every other caller keeps the original edit-on-open behaviour.
  const loadDraftIntoForm = (draft: DraftPurchaseReturnRow, opts: { mode?: 'edit' | 'view' } = {}) => {
    setReturnId(draft.draft_id);
    setCurrentIsPosted(false);
    setDate(draft.return_date.slice(0, 10));
    setVendorId(String(draft.vendor_id));
    setBillNo(draft.bill_no || '');
    setRemarks(draft.remarks || '');
    setCopyFromPurchaseId('');
    setSourcePurchaseItems([]);
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
    lastResolvedNameRef.current = '';
    setErrorMsg('');
    setMode(opts.mode ?? 'edit');
  };

  const handleOpenUnposted = async (draftId: number) => {
    const res = await api.draftPurchaseReturns.get(draftId);
    if (!res.ok) {
      setErrorMsg('Failed to load purchase return: ' + res.error.message);
      return;
    }
    loadDraftIntoForm(res.data);
    setActiveTab('entry');
  };

  const handlePostOneUnposted = async (draftId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPostingDraftId(draftId);
    const res = await api.draftPurchaseReturns.confirm(draftId);
    setPostingDraftId(null);
    if (!res.ok) {
      setErrorMsg('Failed to post purchase return: ' + res.error.message);
      return;
    }
    setSuccessMsg(`Purchase return ${res.data.bill_no || `#${res.data.return_id}`} posted.`);
    setTimeout(() => setSuccessMsg(''), 3000);
    await Promise.all([refreshUnposted(), refreshReturns()]);
    if (draftId === returnId && !currentIsPosted) {
      setReturnId(res.data.return_id);
      setCurrentIsPosted(true);
    }
  };

  // Password-gated (verified server-side) — deleting a saved-unposted return is destructive with
  // no reverse-never-erase trail, same guard level used on Sale Bill/Sale Return/Purchase.
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
    const res = await api.draftPurchaseReturns.remove(targetId, password);
    if (!res.ok) {
      setErrorMsg('Failed to delete purchase return: ' + res.error.message);
      return;
    }
    setSuccessMsg('Purchase return deleted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    if (returnId === targetId && !currentIsPosted) handleNew();
    refreshUnposted();
  };

  // Recorded Purchase Returns (the tab below) shows only POSTED returns — same reasoning and
  // same fix as PurchasePage's Recorded Purchases: an unposted return hasn't actually happened yet.
  const sortedReturns = useMemo(() => {
    return [...returns].filter(r => r.is_posted).sort((a, b) => b.return_date.localeCompare(a.return_date));
  }, [returns]);

  // First/Previous/Next/Last record navigation + Posted/Unposted dropdown, mirroring PurchasePage.
  // `navFilter` is a REAL data filter: 'posted' pages through confirmed returns, 'unposted'
  // through saved-but-not-yet-posted drafts. Departs from pages_design.md §3 (where both values
  // browsed the posted list and 'unposted' merely armed the Unpost button, making the labels lie)
  // on the user's explicit instruction, 2026-08-27 — same change as Sale Bill/Return/Purchase.
  const [navFilter, setNavFilter] = useState<'posted' | 'unposted'>('posted');

  const navPostedList = useMemo(() => [...sortedReturns].reverse(), [sortedReturns]);
  const navUnpostedList = useMemo(() => [...unpostedReturns].reverse(), [unpostedReturns]);

  // Whichever list the dropdown selects — this is what the nav buttons page through.
  const navList = navFilter === 'posted' ? navPostedList : navUnpostedList;

  // -1 when the return on screen isn't in the ACTIVE list (unsaved, or a draft while the dropdown
  // is on Posted and vice versa); the handlers treat that as "start from the beginning".
  const navIndex = useMemo(() => {
    if (returnId == null) return -1;
    return navFilter === 'posted'
      ? (currentIsPosted ? navPostedList.findIndex(r => r.return_id === returnId) : -1)
      : (!currentIsPosted ? navUnpostedList.findIndex(r => r.draft_id === returnId) : -1);
  }, [currentIsPosted, returnId, navFilter, navPostedList, navUnpostedList]);

  const canNavPrevious = navList.length > 0 && navIndex !== 0;
  const canNavNext = navList.length > 0 && navIndex !== navList.length - 1;

  // Posted rows come from purchase_returns, unposted ones from draft_purchase_returns — each needs
  // its own loader. Both open read-only; Edit stays a separate deliberate click.
  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    if (navFilter === 'posted') {
      await loadReturnRow(navList[idx] as PurchaseReturnRow);
    } else {
      loadDraftIntoForm(navList[idx] as DraftPurchaseReturnRow, { mode: 'view' });
    }
  };

  const handleNavFirst = () => goToNavIndex(0);
  const handleNavLast = () => goToNavIndex(navList.length - 1);
  const handleNavPrevious = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNavNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);

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
        onClick={() => { setActiveTab('entry'); startNewReturn(); }}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Return
      </button>
      <button
        onClick={() => setActiveTab('records')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'records' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Recorded Purchase Returns
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Purchase Return" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }}>

        {/* P-03: Pending Posting — pinned outside the card's own left edge rather than inside the
            page's flow, matching PurchasePage's own sidebar exactly (`absolute`, anchored via
            `right: calc(100% + gap)` to this wrapper's left edge, so it can never affect the
            card's width/position). Was previously a full-width banner at the top of the entry
            tab, which pushed the whole form down; this way it's always visible (any tab) without
            taking layout space at all. Only shown from `2xl` up, same as Purchase/Sale Bill —
            below that there usually isn't 280px of free margin for it to land in. Corrected per
            the user (2026-08-26) to match PurchasePage's layout exactly. */}
        {(unpostedReturns.length > 0 || postAllResult) && (
          <aside
            className="hidden 2xl:block absolute top-0 w-64 space-y-3"
            style={{ right: 'calc(100% + 24px)' }}
            data-no-print
          >
            <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-slate-700">Pending Posting</span>
                <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                  {unpostedReturns.length}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-3">
                {unpostedReturns.length > 0 && `Total ${formatCurrency(unpostedReturns.reduce((s, r) => s + Number(r.total_value), 0))}`}
              </div>
              {unpostedReturns.length > 0 && (
                <button
                  type="button"
                  onClick={handlePostAll}
                  disabled={postAllBusy}
                  className="w-full px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {postAllBusy ? 'Posting…' : `Post All (${unpostedReturns.length})`}
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

            {/* Flat list — every unposted return, oldest first (same order the backend returns).
                Each row opens straight into the form for editing, with inline Post/Delete actions
                so a single ready one doesn't need to be opened first just to post it. */}
            {unpostedReturns.length > 0 && (
              <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                {unpostedReturns.map(r => (
                  <li
                    key={r.draft_id}
                    onClick={() => handleOpenUnposted(r.draft_id)}
                    className="px-3 py-2.5 text-xs border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-amber-50/60 transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold text-slate-700">{r.bill_no || `#${r.draft_id}`}</div>
                        <div className="text-slate-400 truncate">{vendors.find(v => v.vendor_id === r.vendor_id)?.name || 'Unnamed Vendor'}</div>
                        <div className="text-slate-400">{formatDate(r.return_date)} · {formatCurrency(Number(r.total_value))}</div>
                      </div>
                      <button
                        type="button"
                        title="Post this return"
                        onClick={(e) => handlePostOneUnposted(r.draft_id, e)}
                        disabled={postingDraftId === r.draft_id}
                        className="flex-shrink-0 p-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <CheckCircle2 size={12} />
                      </button>
                      <button
                        type="button"
                        title="Delete this return (password required)"
                        onClick={(e) => handleDeleteUnposted(r.draft_id, e)}
                        disabled={postingDraftId === r.draft_id}
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
        {/* Toolbar — standalone row above the card, matching SaleBillPage/SaleReturnPage/
            PurchasePage so every transaction page's action buttons live in the same place instead
            of being mixed into the card's own header. `form="purchase-return-form"` on the submit
            button is what lets it still submit the <form> below even though it now renders
            outside it — see fieldNav.ts's `findSubmitButton` comment for why the HTML `form`
            attribute is the established way other pages (Receipts, Transfer, etc.) already do
            this. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-0.5">
            {/* ref-pics/batch2/sale bill.png toolbar style: small square buttons, icon on top,
                label underneath, tightly packed — see frontend/pages_design.md §1. */}
            <button type="button" onClick={startNewReturn} title="New Return" className="toolbar-btn">
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
              title="Save — keep editing this return"
              className="toolbar-btn"
            >
              <Save size={20} strokeWidth={2.5} className="text-blue-600" />
              <span>Save</span>
            </button>
            <button
              type="submit"
              form="purchase-return-form"
              disabled={isViewMode || !isValid}
              title="Done — finish this return, then Post it"
              className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Done</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                if (returnId == null) return;
                const res = await api.draftPurchaseReturns.get(returnId);
                if (res.ok) loadDraftIntoForm(res.data);
              }}
              disabled={mode !== 'edit'}
              title="Cancel Edit"
              className="toolbar-btn"
            >
              <XCircle size={20} strokeWidth={2.5} className="text-slate-500" />
              <span>Cancel</span>
            </button>

            <div className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            {/* Record navigation — always browses posted returns; only active while the
                Posted/Unposted dropdown (right) says Unposted. See §3. */}
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
              // No longer gated on the dropdown — see PurchasePage's Unpost button for why.
              disabled={!isViewMode || returnId == null || !currentIsPosted}
              title="Unpost — move this posted return back to drafts"
              className="toolbar-btn"
            >
              <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Unpost</span>
            </button>
            <button
              type="button"
              onClick={handlePost}
              disabled={!isViewMode || returnId == null || currentIsPosted}
              title="Post"
              className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Post</span>
            </button>
          </div>

          {/* Posted/Unposted — picks which list Previous/Next/First/Last page through. */}
          <select
            value={navFilter}
            onChange={e => setNavFilter(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Which returns First/Prev./Next/Last page through: posted ones, or saved-but-unposted drafts."
          >
            <option value="posted">Posted ({sortedReturns.length})</option>
            <option value="unposted">Unposted ({unpostedReturns.length})</option>
          </select>
        </div>

        {/* This <form> IS the invoice card — height pinned to the remaining viewport space (see
            invoiceCardHeight above) and laid out as a flex column, so the item table below can
            flex-grow into whatever room that leaves. Every other child here keeps its natural size
            (shrink-0) — only the table wrapper is flex-1. */}
        <form
          id="purchase-return-form"
          ref={invoiceCardRef}
          onSubmit={handleSave}
          className="card-white p-6 bg-white border flex flex-col"
          style={{ height: invoiceCardHeight ?? undefined }}
          data-no-print
        >
          <div className="shrink-0 flex items-center gap-2 border-b pb-3 mb-5">
            <Undo2 size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-bold text-lg text-slate-900">Raw Material Purchase Return</h3>
          </div>

          {/* Header fields */}
          <div className="shrink-0 grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
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
            {!isViewMode && (
              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">
                  Find Purchase to Return
                </label>
                {/* Big centered SearchModal, not SearchableSelect's small anchored panel — typing
                    either the vendor's own bill no. or the system bill no. finds it (both are in
                    each option's label; see priorPurchaseOptions above). First field after Date:
                    picking a purchase here fills Vendor and the items for you. */}
                <div className="relative">
                  <input
                    ref={findPurchaseTriggerRef}
                    type="text"
                    data-field-nav="true"
                    disabled={isViewMode}
                    value={findPurchaseSearchText}
                    onChange={e => setFindPurchaseSearchText(e.target.value)}
                    onKeyDown={handleFindPurchaseTriggerKeyDown}
                    placeholder="Manual entry — or type a vendor/bill no. to search..."
                    className="soleria-input pr-9"
                    style={{ fontSize: '13px' }}
                  />
                  <button
                    type="button"
                    disabled={isViewMode}
                    onClick={openFindPurchaseModal}
                    title="Browse all prior purchases"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
                <SearchModal
                  isOpen={isFindPurchaseModalOpen}
                  title="Find Purchase to Return"
                  options={[{ value: '', label: 'Manual entry (default)' }, ...priorPurchaseOptions]}
                  value={copyFromPurchaseId}
                  onSelect={handleFindPurchaseSelect}
                  onClose={() => setIsFindPurchaseModalOpen(false)}
                  searchPlaceholder="Search by vendor or system bill no..."
                  initialSearch={findPurchaseModalSeed}
                />
              </div>
            )}
            <div>
              {/* System Bill No. — this RETURN's own return_id (draft_id while unposted),
                  assigned by the database, never typed. Read-only always. Distinct from the
                  "Find Purchase to Return" search below, which looks up a PRIOR PURCHASE by its
                  own system/vendor bill no. — and from "Vendor Bill No." further along, which is
                  the vendor's own free-text invoice number for this return. */}
              <label className="block text-xs font-bold text-slate-900 mb-1">System Bill No.</label>
              <input
                type="text"
                value={returnId != null ? `#${returnId}` : `#${nextSystemBillNo} (pending)`}
                disabled
                readOnly
                className="soleria-input bg-slate-100 text-slate-500 font-mono"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              {/* Vendor Bill No. before Vendor, mirroring PurchasePage.tsx (2026-08-26): you
                  usually read this off the vendor's physical paper first. Plain typable field
                  (2026-08-27, per the user: no modal popup here — "add this manual entry field
                  like we can type befoir pressing enter"). In Manual entry, typing a number that
                  matches a real purchase and then leaving the field auto-fills Vendor/Remarks
                  from it (master fields only — items stay manual) — see handleBillNoBlur below. */}
              <label className="block text-xs font-bold text-slate-900 mb-1">Vendor Bill No.</label>
              <input
                type="text"
                value={billNo}
                disabled={isViewMode || isCopiedFromPurchase}
                title={isCopiedFromPurchase ? 'Copied from the purchase you picked above — switch to Manual entry to change it' : undefined}
                onChange={e => setBillNo(e.target.value)}
                onBlur={handleBillNoBlur}
                placeholder="Vendor's own invoice #..."
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Vendor <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="relative">
                <input
                  ref={vendorTriggerRef}
                  type="text"
                  data-field-nav="true"
                  disabled={isViewMode || isCopiedFromPurchase}
                  title={isCopiedFromPurchase ? 'Set by the purchase you picked above — switch to Manual entry to change it' : undefined}
                  value={vendorSearchText}
                  onChange={e => setVendorSearchText(e.target.value)}
                  onKeyDown={handleVendorTriggerKeyDown}
                  placeholder="Type a vendor name, or press Enter to search..."
                  className="soleria-input pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || isCopiedFromPurchase}
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
              {/* Remarks is never hand-typed here — it's always the SOURCE purchase's own remarks,
                  fetched the instant a bill is picked in "Find Purchase to Return" (see
                  handleCopyFromPurchase). Always read-only, in Manual entry too: there's no source
                  purchase to pull it from there, so it just stays blank until one is picked.
                  Corrected per the user (2026-08-26) — Remarks used to be free-typable while in
                  Manual entry, unlike Vendor/Vendor Bill No., which still are. */}
              <label className="block text-xs font-bold text-slate-900 mb-1">Remarks</label>
              <input
                type="text"
                value={remarks}
                disabled
                readOnly
                title="Fetched from the purchase you pick above in Find Purchase to Return — never typed by hand"
                placeholder="Pick a purchase above to fetch its remarks..."
                className="soleria-input bg-slate-100 text-slate-500"
                style={{ fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Article entry — ONE editable field set (frontend/pages_design.md §4), not one
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
                    // PR-01: fill the price/unit from this vendor's last posted purchase of this
                    // material once the name is finished.
                    onBlur={e => fillRateFromLastPurchase(e.target.value)}
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
                  {/* Non-editable once matched against the original bill (2026-08-27, per the
                      user: "take the price of the article only which non editable") — the price
                      is always the source purchase's own rate for this article, filled in by
                      fillRateFromLastPurchase on blur of Material name. `readOnly`, not
                      `disabled`, so Enter still commits the row from here (handleRateKeyDown) —
                      a disabled field can't be tabbed/Entered through. */}
                  <input
                    type="number"
                    min={0}
                    value={currentRow.pricePerUnit || ''}
                    readOnly={isCopiedFromPurchase}
                    title={isCopiedFromPurchase ? "Taken from the matched purchase's own rate for this article — not editable" : undefined}
                    onChange={e => { if (!isCopiedFromPurchase) updateCurrentField('pricePerUnit', Number(e.target.value)); }}
                    onKeyDown={handleRateKeyDown}
                    className={`soleria-input text-center font-semibold${isCopiedFromPurchase ? ' bg-slate-100 text-slate-500' : ''}`}
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
              {/* Live article-vs-purchase check (only while isCopiedFromPurchase — see
                  articleAgainstPurchaseError above) — shown as soon as it's wrong, not only after
                  a rejected commit attempt. */}
              {currentRowError && (
                <p className="mt-2 text-xs text-rose-600 font-semibold">{currentRowError}</p>
              )}
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
              fields above for editing. flex-1 so it grows to fill whatever space invoiceCardHeight
              (above) leaves after every other section takes its natural size. `min-height: 0`
              overrides flexbox's default min-height:auto, which would otherwise let this box's own
              content stretch the whole form instead of scrolling internally. The header row is
              `sticky` within the scroll box so column labels stay visible past the first
              screenful of rows. */}
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

        {/* Recorded Purchase Returns — own tab now, with a from/to date filter (defaults to the
            last three months), rather than always rendering every return inline below the live
            entry form. */}
        {activeTab === 'records' && (
        <div className="card-white p-6 bg-white border">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h3 className="font-lora font-bold text-lg text-slate-900">Recorded Purchase Returns</h3>
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

        <PasswordPromptModal
          isOpen={isPasswordModalOpen}
          onClose={() => { setIsPasswordModalOpen(false); pendingDeleteDraftId.current = null; }}
          onSuccess={handleDeletePasswordSuccess}
          title="Delete Unposted Purchase Return"
          subtitle="Enter your password to permanently delete this unposted purchase return."
        />

      </div>
    </AppLayout>
  );
}
