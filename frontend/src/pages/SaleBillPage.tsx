import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import WeeklyTab from '@/components/WeeklyTab';
import MonthlyTab from '@/components/MonthlyTab';
import OverallTab from '@/components/OverallTab';
import FindTab from '@/components/FindTab';
import { Plus, AlertTriangle, ChevronDown } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { SaleBillPrintable, type SaleBillPrintModel } from '@/components/reports/SaleBillPrintable';
import { getTodayDate, toDateInputValue, formatCartons, cartonsProblem, pairsFor, cartonsAndPairs, nextSystemNoPreview, mergeWithDeleted } from '@/lib/utils';
import { focusFirstField, focusNextField } from '@/lib/fieldNav';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal, { findDirectMatch } from '@/components/SearchModal';
import DocumentToolbar from '@/components/DocumentToolbar';
import RowActions from '@/components/RowActions';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import PageToasts from '@/components/PageToasts';
import { usePersistentField, useClearPageDraft, useNewDocGate } from '@/hooks/usePersistentField';
import * as api from '@/lib/api';
import type {
  CustomerRow, SubCustomerRow, ProductRow, ProductVariantRow, StoreRow, AddaRow,
  RegionRow, CityRow, SaleBillRow, SaleBillCreateInput, SaleBillItemInput, StockRow,
  DraftSaleBillRow, ConfirmAllResult, BusinessAccountRow, DeletedNumberRow
} from '@/lib/api';
import EditScopeRadios from '@/components/EditScopeRadios';
import { useAutoEditScope } from '@/hooks/useAutoEditScope';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import CartonsInput from '@/components/CartonsInput';
import DeletedDocumentOverlay from '@/components/DeletedDocumentOverlay';
import { getWindowParam } from '@/lib/windowParams';

interface UiItem {
  uid: string;
  articleId: number | null;
  variantId: number | null;
  label: string; // "Article Name — Color", filled on selection or on load from server
  packing: number;
  cartons: number;
  pairs: number;
  rate: number;
  discountPercent: number;
  discountValue: number;
  value: number;
}

function newUiItem(): UiItem {
  return {
    uid: 'row_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    articleId: null,
    variantId: null,
    label: '',
    packing: 0,
    cartons: 0,
    pairs: 0,
    rate: 0,
    discountPercent: 0,
    discountValue: 0,
    value: 0
  };
}

function recalcItem(item: UiItem): UiItem {
  const pairs = pairsFor(item.cartons, item.packing);
  const gross = pairs * item.rate;
  const discountValue = Math.round(gross * (item.discountPercent / 100));
  const value = Math.max(0, gross - discountValue);
  return { ...item, pairs, discountValue, value };
}

export default function SaleBillPage() {
  // New button + "cursor waits on New" (per the user, 2026-09-18): after a Post / Post All, and
  // whenever the form drops to the locked blank (useNewDocGate's awaitingNew), focus goes to New so
  // Enter starts the next document. Two frames, so a reset's own focus-first-field attempt (queued
  // first, and a no-op on the locked form) never wins. Declared first — Post handlers use it.
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const focusNewButton = () => requestAnimationFrame(() => requestAnimationFrame(() => newButtonRef.current?.focus()));
  const { state, dispatch } = useApp();

  // Weekly/Monthly/Overall/Find sub-tabs — same sub-tab bar as Sale Return's own (2026-08-26, per
  // the user: brought back here alongside it, not dropped).
  // Seeded from the URL's own `tab` (openWindow's second argument) so a window opened straight at
  // the Find tab — e.g. from FindTab's own "Show Print Preview", per the user, 2026-09-03 — lands
  // there instead of the default Bill entry tab.
  const [activeTab, setActiveTab] = useState<'bill' | 'weekly' | 'monthly' | 'overall' | 'find'>(() => (getWindowParam('tab') as 'bill' | 'weekly' | 'monthly' | 'overall' | 'find') || 'bill');

  // ── Real lookup data ──
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [variantsByArticle, setVariantsByArticle] = useState<Record<number, ProductVariantRow[]>>({});
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  // Whether the stock rollup has actually come back yet. `stockRows` starts as `[]`, which is
  // indistinguishable from "every article genuinely has zero stock" — see stockExceededRows below
  // for why that distinction decides whether Save is clickable.
  const [stockLoaded, setStockLoaded] = useState(false);
  // "Main A/C" (ref-pic) — the customer's linked business account's PARENT chart account
  // (ac_code/ac_name), e.g. "552000010 / CUSTOMERS ACCOUNTS" — distinct from the customer's own
  // account code shown in the Customer field.
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  useEffect(() => {
    (async () => {
      const [c, sc, p, st, ad, rg, ct, stRes, baRes] = await Promise.all([
        api.listCustomers(), api.listSubCustomers(), api.listProducts(),
        api.listStores(), api.listAddas(), api.listRegions(), api.listCities(),
        api.reports.stock(), api.listBusinessAccounts()
      ]);
      const failures: string[] = [];
      if (c.ok) setCustomers(c.data); else failures.push(c.error.message);
      if (sc.ok) setSubCustomers(sc.data); else failures.push(sc.error.message);
      if (p.ok) setProducts(p.data); else failures.push(p.error.message);
      if (st.ok) setStores(st.data); else failures.push(st.error.message);
      if (ad.ok) setAddas(ad.data); else failures.push(ad.error.message);
      if (rg.ok) setRegions(rg.data); else failures.push(rg.error.message);
      if (ct.ok) setCities(ct.data); else failures.push(ct.error.message);
      if (stRes.ok) { setStockRows(stRes.data); setStockLoaded(true); }
      if (baRes.ok) setBusinessAccounts(baRes.data);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
  }, []);

  const refreshStock = useCallback(async () => {
    const res = await api.reports.stock();
    if (res.ok) { setStockRows(res.data); setStockLoaded(true); }
  }, []);

  const getStockInfo = useCallback((articleId: number | null, variantId: number | null) => {
    if (!articleId) return null;
    if (variantId != null) {
      const s = stockRows.find(r => r.variant_id === variantId);
      if (s) {
        return { cartons: s.cartons, pairs: s.total_pairs };
      }
      return { cartons: 0, pairs: 0 };
    }
    const matching = stockRows.filter(r => r.article_id === articleId);
    if (matching.length > 0) {
      const cartons = matching.reduce((sum, r) => sum + r.cartons, 0);
      const pairs = matching.reduce((sum, r) => sum + r.total_pairs, 0);
      return { cartons, pairs };
    }
    return { cartons: 0, pairs: 0 };
  }, [stockRows]);

  const fetchVariants = useCallback(async (articleId: number) => {
    if (variantsByArticle[articleId]) return variantsByArticle[articleId];
    const res = await api.listProductVariants(articleId);
    if (res.ok) {
      setVariantsByArticle(prev => ({ ...prev, [articleId]: res.data }));
      return res.data;
    }
    setErrorMsg('Failed to load color variants: ' + res.error.message);
    return [];
  }, [variantsByArticle]);

  // Mode: 'view' | 'edit' | 'new'. Persisted with the rest of the draft (2026-08-31) — leaving it
  // as plain useState meant coming back to a half-typed bill landed in whatever the default was
  // rather than the state it was left in, and a page restored into 'view' has Save disabled.
  const [mode, setMode] = usePersistentField<'view' | 'edit' | 'new'>('sale-bill', 'mode', 'new');
  // Master/Detail edit-scope radio (left-side widget, per the user 2026-08-31): which half of the
  // form Edit actually unlocks. Only meaningful once Edit has already been clicked while unposted
  // — it narrows what THAT click reaches, it doesn't reopen the existing isPosted gate on Edit
  // itself. Always resettable/pickable even in view mode, so it can be pre-chosen before Edit.
  // Persisted, not plain useState: mode/svId/status already are, for the exact reason —
  // losing track of state across a page switch. editScope was the one piece left out, so
  // returning to an in-progress 'edit' draft always reset it to 'master', locking the
  // Detail half (entry strip + grid) shut even when that's what had been unlocked and typed
  // into — reported by the user (2026-09-04) as "all the buttons are disable except New".
  const [editScope, setEditScope] = usePersistentField<'master' | 'detail'>('sale-bill', 'editScope', 'master');
  // Keeps the radios pointing at whichever half is being worked in — see the hook.
  const autoEditScope = useAutoEditScope(setEditScope);

  // Password Modal Protection State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordActionType, setPasswordActionType] = useState<'save_bill' | 'save_and_post' | 'post_bill' | 'delete_unposted_bill' | null>(null);

  // Draft persistence — see src/hooks/usePersistentField.ts. Only real in-progress entry data is
  // persisted; which EXISTING record is loaded (billId/currentBillIsPosted/mode) is deliberately
  // left as plain useState, same as StockVoucherPage.
  const clearSaleBillDraft = useClearPageDraft('sale-bill');
  // The posted/unposted/System No. rule — see useNewDocGate for the whole of it. hasSaleBillDraft gates the
  // auto-open below (only genuine unsaved typing skips it); hasClickedNew gates the No. preview and
  // the awaitingNew lock, and only the New button/tab sets it (pressNew).
  const { hasRealDraftAtMount: hasSaleBillDraft, hasClickedNew, setHasClickedNew, markNewClicked } =
    useNewDocGate('sale-bill', ['customerId', 'billNo', 'items']);

  // Form State
  //
  // billId/currentBillIsPosted are persisted alongside the field values, NOT plain useState:
  // leaving them out meant switching pages and back lost track of WHICH record was on screen
  // (they reset to their new-bill defaults) while customerId/items/etc. were still restored from
  // the draft store — a bill's data displayed as if it were a brand-new, unsaved one, with no
  // System No. (reported by the user, 2026-08-31).
  //
  // An earlier attempt persisted only the id and RE-FETCHED the record on mount. That was worse:
  // the re-fetch overwrote whatever the user had typed since (their in-progress edits) with the
  // last-saved server copy, and reopened the page in 'view' mode, which disables Save — "it did
  // not allow me to save" (the user, same day). There is nothing to re-fetch: the persisted field
  // values ARE the user's own unsaved work, which is exactly what has to survive. Restoring the
  // ids as-is is both simpler and the only correct behaviour.
  const [billId, setBillId] = usePersistentField<number | null>('sale-bill', 'billId', null);
  // The loaded record's own System No. — display-only, kept in step with billId (see that field's
  // own comment) but never used for API calls; those stay on billId/draftId as before.
  const [currentSystemNo, setCurrentSystemNo] = usePersistentField<number | null>('sale-bill', 'currentSystemNo', null);
  // Per the user, 2026-09-18: no System No. may be generated unless New was DELIBERATELY clicked.
  // Hiding the preview (hasClickedNew above) wasn't enough — a blank page reached any other way
  // (first open, after Post, Post All, a deleted bill) could still be typed into and saved, and
  // the backend assigned it a number anyway. So such a page stays fully locked until New.
  const awaitingNew = mode === 'new' && currentSystemNo == null && !hasClickedNew;
  useEffect(() => { if (awaitingNew) focusNewButton(); }, [awaitingNew]);
  const [currentBillIsPosted, setCurrentBillIsPosted] = usePersistentField('sale-bill', 'currentBillIsPosted', false);
  // Pairs per variant this bill ALREADY holds in the database (as last saved — draft or posted).
  // Saving a bill deducts its stock at once (draftSaleBills.service.js), so the stock rollup this
  // page reads has already lost them; stockExceededRows adds them back, exactly like the backend's
  // own edit check (effectiveOnHand). Without it, reopening a saved bill that uses most of an
  // article's stock showed "Stock Limit Exceeded" and disabled Save (reported from production,
  // 2026-09-18, bill #93). {} for a bill that's never been saved.
  const [savedPairsByVariant, setSavedPairsByVariant] = usePersistentField<Record<number, number>>('sale-bill', 'savedPairsByVariant', {});
  const [date, setDate] = usePersistentField('sale-bill', 'date', getTodayDate());
  const [storeId, setStoreId] = usePersistentField('sale-bill', 'storeId', '');
  const [customerId, setCustomerId] = usePersistentField('sale-bill', 'customerId', '');
  const [subCustomerId, setSubCustomerId] = usePersistentField('sale-bill', 'subCustomerId', '');
  const [billNo, setBillNo] = usePersistentField('sale-bill', 'billNo', '');
  const [gpNo, setGpNo] = usePersistentField('sale-bill', 'gpNo', '');
  const [biltyNo, setBiltyNo] = usePersistentField('sale-bill', 'biltyNo', '');
  const [addaId, setAddaId] = usePersistentField('sale-bill', 'addaId', '');
  const [remarks, setRemarks] = usePersistentField('sale-bill', 'remarks', '');
  const [dueDate, setDueDate] = usePersistentField('sale-bill', 'dueDate', '');
  const [invoiceDiscount, setInvoiceDiscount] = usePersistentField('sale-bill', 'invoiceDiscount', 0);

  // Line items state
  const [items, setItems] = usePersistentField<UiItem[]>('sale-bill', 'items', []);

  const [deliveryType, setDeliveryType] = usePersistentField<'1' | 'custom'>('sale-bill', 'deliveryType', '1');
  // Ref-pic's literal "Delivery" field: a typed code, where "1" means SAME/direct delivery and
  // anything else means a custom destination (Sub-Customer picked separately still resolves to a
  // real sub_customer_id — the backend has no other way to identify a delivery destination).
  const [deliveryCode, setDeliveryCode] = usePersistentField('sale-bill', 'deliveryCode', '1');
  const handleDeliveryCodeChange = (code: string) => {
    setDeliveryCode(code);
    const same = code.trim() === '1';
    setDeliveryType(same ? '1' : 'custom');
    if (same) {
      setSubCustomerId('');
      setCustomAddress('');
    }
    // Switching TO custom used to silently fill Sub Cust. with subCustomers[0] whenever it was
    // still empty — arbitrary (whatever the lookup happened to return first, not anything tied to
    // this bill), and it left the field looking already-chosen even though nothing had been
    // picked, which read as "I can't change the sub-customer" (reported by the user, 2026-09-04).
    // Custom delivery now always starts blank — the field enables and the user picks explicitly,
    // same as every other picker in this form.
  };
  const [customAddress, setCustomAddress] = usePersistentField('sale-bill', 'customAddress', '');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Add new sub-customer modal state
  const [isAddSubCustomerOpen, setIsAddSubCustomerOpen] = useState(false);
  const [newSubCustomerName, setNewSubCustomerName] = useState('');
  const [newSubCustomerRegionId, setNewSubCustomerRegionId] = useState('');
  const [newSubCustomerCityId, setNewSubCustomerCityId] = useState('');
  const [isPrintingSingle, setIsPrintingSingle] = useState(false);
  const closeAddSubCustomer = () => {
    setIsAddSubCustomerOpen(false);
    setNewSubCustomerName('');
    setNewSubCustomerRegionId('');
    setNewSubCustomerCityId('');
  };
  // G-07 (changes-14-09-26.md): Escape closes the topmost dialog — this page builds its own inline
  // modals rather than going through a shared component, so each needs its own hook call.
  useEscapeToClose(isAddSubCustomerOpen, closeAddSubCustomer);

  // Add new customer modal state
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerRegionId, setNewCustomerRegionId] = useState('');
  const [newCustomerCityId, setNewCustomerCityId] = useState('');
  const closeAddCustomer = () => {
    setIsAddCustomerOpen(false);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');
  };
  useEscapeToClose(isAddCustomerOpen, closeAddCustomer);

  // SB-06 (revised): every saved-unposted bill now lives in draft_sale_bills — the real
  // sale_bills table strictly never holds an unposted document. This one list replaces what used
  // to be two separate concepts ("Saved Drafts" for incomplete entries vs "Pending Posting" for
  // complete-but-unposted ones) — there's no longer a meaningful distinction at the data level.
  const [unpostedBills, setUnpostedBills] = useState<DraftSaleBillRow[]>([]);
  // Declared here (rather than down with browseFilter/refreshPosted below) so nextSystemBillNo's
  // preview, right below, can read both lists' system_no — it needs to see this state before it's
  // otherwise used.
  const [postedBills, setPostedBills] = useState<SaleBillRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<ConfirmAllResult | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.draftSaleBills.list();
    if (res.ok) setUnpostedBills(res.data);
    return res.ok ? res.data : null;
  }, []);

  // G-06 (changes-14-09-26.md, 2026-09-15): a window opening with zero unposted bills must land on
  // a fresh blank entry, not wherever the session that closed it left the screen pointed.
  // Originally gated on `mode === 'view'`, which turned out to miss a real case reported by the
  // user (2026-09-16): the bilty/adda-on-a-posted-bill edit flow leaves `mode: 'edit'` (Master/
  // Detail scope) while `currentBillIsPosted` is still true — closing the window there and
  // reopening kept showing that posted bill (dropdown defaulting to "Unposted" above it, per
  // `browseFilter`'s own always-fresh `useState`, made the mismatch obvious). `currentBillIsPosted`
  // is itself persisted and is the direct, unambiguous signal: it is true if and only if an actual
  // posted record is loaded, in EITHER 'view' or 'edit' mode — `handleNew()` is the only thing that
  // ever sets it false, so it can never be true while there's genuine unsaved new-document work to
  // protect.
  useEffect(() => {
    refreshUnposted().then(data => {
      if (data && data.length === 0 && currentBillIsPosted) handleNew();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUnposted]);

  // Every Sale Bill System No. permanently retired by a delete (migration 032) — merged into the
  // browse lists below so First/Prev/Next/Last can show "#N — Deleted" as an actual stop.
  const [deletedNumbers, setDeletedNumbers] = useState<DeletedNumberRow[]>([]);
  const refreshDeletedNumbers = useCallback(async () => {
    const res = await api.draftSaleBills.listDeletedNumbers();
    if (res.ok) setDeletedNumbers(res.data);
  }, []);
  useEffect(() => { refreshDeletedNumbers(); }, [refreshDeletedNumbers]);

  // Set when First/Prev/Next/Last lands on a deleted number — DeletedDocumentOverlay renders while
  // this is non-null. Cleared as soon as a real document loads (see the billId effect below).
  const [deletedPlaceholder, setDeletedPlaceholder] = useState<number | null>(null);
  // navIndex normally tracks the loaded bill's own position via billId (see navIndex below), but a
  // deleted marker has no billId to match — this overrides it while a placeholder is on screen, so
  // Prev/Next can still step from wherever the placeholder sits instead of restarting at 0.
  const [navIndexOverride, setNavIndexOverride] = useState<number | null>(null);
  useEffect(() => {
    setDeletedPlaceholder(null);
    setNavIndexOverride(null);
  }, [billId]);

  // SB-06: post the whole run. Each draft confirms in its own transaction on the backend, so one
  // that can't confirm leaves the rest posted — which is why this reads `failed` instead of
  // treating a resolved call as "all done". Failures stay as drafts and can be fixed and posted
  // again.
  const handlePostAll = async () => {
    setPostAllBusy(true);
    setPostAllResult(null);
    const res = await api.draftSaleBills.confirmAll();
    setPostAllBusy(false);

    if (!res.ok) {
      setErrorMsg('Failed to post bills: ' + res.error.message);
      return;
    }
    setPostAllResult(res.data);
    if (res.data.failed.length === 0) {
      setSuccessMsg(`${res.data.posted.length} bill(s) posted.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    // Stock moved and the pending list shrank — both have to catch up. If the draft currently open
    // on screen was one of the ones just posted, its id no longer exists (it's a different bill_id
    // now) — ConfirmAllResult doesn't carry the new id back, so rather than leave the form pointed
    // at a draft that's gone, reset to a fresh one.
    await Promise.all([refreshUnposted(), refreshPosted(), refreshStock()]);
    // Everything posted — nothing is left unposted to come back to, so reset to a fresh record
    // ready for the next one (keeping the date being worked on), matching Stock Voucher/Journal
    // Voucher's own Post All. Per the user (2026-09-04): Post All should "refresh the screen".
    // A partial run deliberately does NOT wipe the form — the failures still need looking at, so
    // there it only clears when the record on screen was itself one of the ones that posted.
    if (res.data.failed.length === 0) {
      const workingDate = date;
      handleNew();
      setDate(workingDate);
    } else if (billId != null && !currentBillIsPosted && res.data.posted.some(p => p.draft_id === billId)) {
      handleNew();
    }
  };

  // Region/city lists for the quick-add modals. citiesInRegion keeps the dependent filtering the
  // native <select>s had: pick a region and the city list narrows to it, with no region meaning all.
  const regionOptions = useMemo(
    () => regions.map(r => ({ value: String(r.region_id), label: r.name })),
    [regions]
  );

  const citiesInRegion = useCallback(
    (regionId: string) =>
      cities
        .filter(c => !regionId || c.region_id === Number(regionId))
        .map(c => ({ value: String(c.city_id), label: c.name })),
    [cities]
  );

  const storeOptions = useMemo(
    () => stores.map(st => ({ value: String(st.store_id), label: st.name })),
    [stores]
  );

  // Customer search: Primary = Region, Secondary = City
  const customerOptions = useMemo(() => {
    const regionName = (id: number) => regions.find(r => r.region_id === id)?.name || '';
    const cityName = (id: number | null) => cities.find(ct => ct.city_id === id)?.name || '';
    return [...customers]
      .sort((a, b) => {
        const regionCmp = regionName(a.region_id).localeCompare(regionName(b.region_id));
        if (regionCmp !== 0) return regionCmp;
        return cityName(a.city_id).localeCompare(cityName(b.city_id));
      })
      .map(c => ({
        value: String(c.customer_id),
        label: `${c.name} — ${regionName(c.region_id) || 'No Region'} / ${cityName(c.city_id) || 'No City'}`
      }));
  }, [customers, regions, cities]);

  const addaOptions = useMemo(() => [
    { value: '', label: 'Not set yet (fill in later)' },
    ...addas.map(ad => ({ value: String(ad.adda_id), label: ad.name })),
  ], [addas]);

  const selectedCustomer = useMemo(() => customers.find(c => c.customer_id === Number(customerId)), [customers, customerId]);

  // Preview of the System No. a brand-new bill will get. This number is now assigned once at
  // draft-save time and carried through posting unchanged (per the user, 2026-09-05) — a real
  // SQL Server SEQUENCE (dbo.seq_sale_bill_no) is the actual source of truth server-side, so this
  // is a client-side estimate only (MAX across whatever's already loaded, +1), correct as long as
  // nothing else inserts a bill between now and Save. Always shown, from the moment the page
  // opens — an earlier round gated it behind pressing New, which the user reversed (2026-08-31):
  // the number should just be there.
const nextSystemBillNo = useMemo(
    () => nextSystemNoPreview(...unpostedBills.map(d => d.system_no), ...postedBills.map(b => b.system_no), ...deletedNumbers.map(d => d.system_no)),
    [unpostedBills, postedBills, deletedNumbers]
  );

  // Customer, Store, Sub Cust., Adda Code — every lookup on this form is a real, typable <input>
  // that opens the same centered SearchModal popup (same pattern as Purchase's Vendor field /
  // Receipts' Account field, per the user 2026-08-26: "we can write anything and modal pop up
  // shows us that result, it is constant for everyone"). Typing filters nothing inline — it just
  // seeds the modal's own search box once Enter opens it, so results appear immediately and stay
  // searchable inside. Arrow Up/Down opens the modal blank (full list); the chevron button does
  // the same on a plain click. Each field follows the identical four-piece shape: an `isXModalOpen`
  // flag, a `xSearchText` mirroring the picked option's label (never fought mid-type — the sync
  // effect only runs when the SELECTION changes), an `xModalSeed` that seeds the modal only when
  // opened via Enter, and a trigger ref for G-01 focus-advance after picking.
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const customerTriggerRef = useRef<HTMLInputElement>(null);
  const [customerSearchText, setCustomerSearchText] = useState('');
  const [customerModalSeed, setCustomerModalSeed] = useState('');
  useEffect(() => {
    const opt = customerOptions.find(o => o.value === customerId);
    setCustomerSearchText(opt?.label ?? selectedCustomer?.name ?? '');
  }, [customerId, customerOptions, selectedCustomer]);
  const openCustomerModal = () => { if (isViewMode) return; setCustomerModalSeed(''); setIsCustomerModalOpen(true); };
  // stopPropagation on every branch — otherwise this keydown keeps bubbling past the trigger up
  // to window-level listeners (AppLayout's own G-01 field-walk), acting on it at the same time
  // the modal opens. Same reasoning as SearchModal's own internal keydown handling; applies to
  // every one of this page's own typable trigger fields below too.
  function handleCustomerTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); openCustomerModal(); }
    else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      // One Enter is enough when the typed text already names exactly one customer.
      const direct = findDirectMatch(customerOptions, customerSearchText);
      if (direct) { selectCustomer(direct); return; }
      setCustomerModalSeed(customerSearchText); setIsCustomerModalOpen(true);
    }
  }
  // Shared by the modal's own pick and the direct-match Enter above.
  function selectCustomer(val: string) {
    setCustomerId(val);
    setDeliveryType('1');
    setDeliveryCode('1');
    setSubCustomerId('');
    setCustomAddress('');
    setIsCustomerModalOpen(false);
    requestAnimationFrame(() => focusNextField(customerTriggerRef.current));
  }

  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const storeTriggerRef = useRef<HTMLInputElement>(null);
  const [storeSearchText, setStoreSearchText] = useState('');
  const [storeModalSeed, setStoreModalSeed] = useState('');
  useEffect(() => {
    const opt = storeOptions.find(o => o.value === storeId);
    setStoreSearchText(opt?.label ?? '');
  }, [storeId, storeOptions]);
  const openStoreModal = () => { if (isViewMode) return; setStoreModalSeed(''); setIsStoreModalOpen(true); };
  function handleStoreTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); openStoreModal(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setStoreModalSeed(storeSearchText); setIsStoreModalOpen(true); }
  }

  const [isSubCustModalOpen, setIsSubCustModalOpen] = useState(false);
  const subCustTriggerRef = useRef<HTMLInputElement>(null);
  const [subCustSearchText, setSubCustSearchText] = useState('');
  const [subCustModalSeed, setSubCustModalSeed] = useState('');
  const subCustomerOptions = useMemo(
    () => subCustomers.map(sc => ({ value: String(sc.sub_customer_id), label: sc.name })),
    [subCustomers]
  );
  useEffect(() => {
    const opt = subCustomerOptions.find(o => o.value === subCustomerId);
    setSubCustSearchText(opt?.label ?? '');
  }, [subCustomerId, subCustomerOptions]);
  const openSubCustModal = () => { if (isViewMode || deliveryType === '1') return; setSubCustModalSeed(''); setIsSubCustModalOpen(true); };
  function handleSubCustTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); openSubCustModal(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setSubCustModalSeed(subCustSearchText); setIsSubCustModalOpen(true); }
  }

  const [isAddaModalOpen, setIsAddaModalOpen] = useState(false);
  const addaTriggerRef = useRef<HTMLInputElement>(null);
  const [addaSearchText, setAddaSearchText] = useState('');
  const [addaModalSeed, setAddaModalSeed] = useState('');
  useEffect(() => {
    const opt = addaOptions.find(o => o.value === addaId);
    setAddaSearchText(opt?.label ?? '');
  }, [addaId, addaOptions]);
  const openAddaModal = () => { if (isViewMode) return; setAddaModalSeed(''); setIsAddaModalOpen(true); };
  function handleAddaTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); openAddaModal(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setAddaModalSeed(addaSearchText); setIsAddaModalOpen(true); }
  }

  // "Main A/C" — the customer's linked business account's parent chart account (ac_code/ac_name).
  const selectedMainAc = useMemo(() => {
    if (selectedCustomer?.ba_id == null) return null;
    return businessAccounts.find(b => b.ba_id === selectedCustomer.ba_id) ?? null;
  }, [businessAccounts, selectedCustomer]);

  const isCustomDelivery = useMemo(() => deliveryType === 'custom', [deliveryType]);

  const pairsByVariant = (lines: { variant_id: number | null; pairs: number }[] | { variantId: number | null; pairs: number }[]) => {
    const out: Record<number, number> = {};
    for (const l of lines as { variant_id?: number | null; variantId?: number | null; pairs: number }[]) {
      const v = l.variant_id ?? l.variantId;
      if (v != null && l.pairs > 0) out[v] = (out[v] || 0) + Number(l.pairs);
    }
    return out;
  };

  const stockExceededRows = useMemo(() => {
    // Nothing can be judged "over stock" before the stock rollup has loaded — getStockInfo reports
    // 0 available for every variant while `stockRows` is still `[]`, so EVERY line looks exceeded,
    // which flips hasStockExceeded true and disables Save. Harmless on a blank form (no lines to
    // judge), but on returning to a page whose lines were restored from the draft store, those
    // lines exist immediately while the stock fetch is still in flight — so Save came back
    // disabled, reported by the user (2026-08-31): "when I switch the page the save button set
    // blank". Also covers the fetch failing outright, which would otherwise disable Save forever.
    if (!stockLoaded) return {};
    // Compared in PAIRS, not cartons. getStockInfo's `cartons` is the WHOLE-carton count only
    // (stock.service.js#currentStock truncates, putting the remainder in extra_pairs), so with 6
    // pairs of a 12-pair article on hand it reports 0 cartons — and asking for 0.5 cartons, which
    // is exactly those 6 pairs, was rejected as exceeding stock. Reported by the user (2026-09-04):
    // "if the data has 0 cartons and 6 pairs and user enter 0.5 means he want 6 pairs so it will be
    // okay". Pairs are the real unit here (and what the server checks — saleBills.service.js works
    // in pairsOnHand), so a part carton is measured against the part carton actually in stock.
    const requestedPairsByVariant: Record<number, number> = {};
    items.forEach(it => {
      if (it.variantId != null && it.pairs > 0) {
        requestedPairsByVariant[it.variantId] = (requestedPairsByVariant[it.variantId] || 0) + it.pairs;
      }
    });

    const exceededMap: Record<string, { availablePairs: number; requestedPairs: number; itemCartons: number }> = {};
    items.forEach((it) => {
      if (it.variantId != null && it.pairs > 0) {
        const stockInfo = getStockInfo(it.articleId, it.variantId);
        // Plus what this same bill already took when it was saved (see savedPairsByVariant).
        const availablePairs = (stockInfo ? stockInfo.pairs : 0) + (savedPairsByVariant[it.variantId] || 0);
        const requestedPairs = requestedPairsByVariant[it.variantId] || it.pairs;
        if (requestedPairs > availablePairs) {
          exceededMap[it.uid] = { availablePairs, requestedPairs, itemCartons: it.cartons };
        }
      }
    });
    return exceededMap;
  }, [items, getStockInfo, stockLoaded, savedPairsByVariant]);

  const hasStockExceeded = useMemo(() => Object.keys(stockExceededRows).length > 0, [stockExceededRows]);

  const isNecessaryFieldsFilled = useMemo(() => {
    if (awaitingNew) return false;
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (!billNo) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.variantId || it.cartons <= 0 || it.rate <= 0)) return false;
    if (isCustomDelivery && !subCustomerId) return false;
    if (hasStockExceeded) return false;
    return true;
  }, [awaitingNew, customerId, date, storeId, billNo, items, isCustomDelivery, subCustomerId, hasStockExceeded]);

  // Repairs the one field a restored draft can come back missing.
  //
  // handleNew() picks the default store, but it does so inside clearSaleBillDraft()'s suppression
  // window — usePersistentField deliberately skips the write-through while that flag is set, so
  // this one value never reaches the draft store, and nothing touches storeId again afterwards to
  // trigger a later write. Everything the user then types DOES persist. So on return the bill
  // comes back looking complete — customer, bill no., lines, totals all there — with Store alone
  // silently blank, and since Store is required that single gap makes isNecessaryFieldsFilled
  // false, grEying out Save and Done on a bill that plainly should be saveable. Reported by the
  // user, 2026-09-04 ("it show me the save data but not allow me to done").
  //
  // Gated on there actually having been a draft at mount: on a genuinely fresh page handleNew()
  // still sets the store the old way, and staying silent here keeps that blank bill from writing
  // a draft it doesn't need — which would otherwise make the next visit think work was in
  // progress and skip opening the newest unposted bill.
  useEffect(() => {
    if (!hasSaleBillDraft) return;
    if (!storeId && stores.length > 0) setStoreId(String(stores[0].store_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSaleBillDraft, storeId, stores]);

  const pendingDeleteBillId = useRef<number | null>(null);

  // G-01: auto-focus the first field (Date) whenever the page becomes editable — this page's
  // entry area isn't wrapped in a <form>, so AppLayout's global auto-focus mechanism (which only
  // looks inside <form> elements) has nothing to find here.
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode !== 'view') {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [mode]);

  const loadBillRow = async (rowIn: SaleBillRow) => {
    // list()/biltySearch() rows never carry items (only get() does) — the tabs pass those
    // straight through, so re-fetch the full record whenever items are missing.
    let row = rowIn;
    if (!row.items) {
      const res = await api.saleBills.get(row.bill_id);
      if (!res.ok) {
        setErrorMsg('Failed to load bill: ' + res.error.message);
        return;
      }
      row = res.data;
    }

    // SB-05: this bill came from the list, not from this run — posting it must not clear the form.
    createdInThisRun.current = false;
    // Opening a different record must not carry over a stale scope from the last edit.
    setEditScope('master');

    setBillId(row.bill_id);
    setCurrentSystemNo(row.system_no);
    setCurrentBillIsPosted(row.is_posted);
    setDate(toDateInputValue(row.bill_date));
    setStoreId(row.store_id != null ? String(row.store_id) : '');
    setCustomerId(String(row.customer_id));
    setSubCustomerId(row.sub_customer_id != null ? String(row.sub_customer_id) : '');
    setDeliveryType(row.delivery_type === 'CUSTOM' ? 'custom' : '1');
    setDeliveryCode(row.delivery_type === 'CUSTOM' ? '2' : '1');
    setCustomAddress(row.delivery_address || '');
    setBillNo(row.bill_no);
    setGpNo(row.gp_no || '');
    setBiltyNo(row.bilty_no || '');
    setAddaId(row.adda_id != null ? String(row.adda_id) : '');
    setRemarks(row.remarks || '');
    setDueDate(toDateInputValue(row.due_date));
    setInvoiceDiscount(row.invoice_discount || 0);

    const loadedItems: UiItem[] = row.items.map(it => {
      const article = products.find(p => p.article_id === it.article_id);
      return {
        uid: 'row_' + it.item_id,
        articleId: article?.article_id ?? null,
        variantId: it.variant_id,
        label: `${it.article_name || 'Article'} — ${it.color || ''}`,
        packing: it.pairs && it.cartons ? it.pairs / it.cartons : 0,
        cartons: it.cartons,
        pairs: it.pairs,
        rate: it.rate,
        discountPercent: it.discount_percent,
        discountValue: it.discount_value,
        value: it.value
      };
    });
    setItems(loadedItems);
    setSavedPairsByVariant(pairsByVariant(loadedItems));
    setEntry(newUiItem());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);

    // Pre-warm the variant cache for each loaded item's article so the picker works immediately if edited
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });
    setErrorMsg('');
  };


  // Loads a draft (the Pending Posting sidebar's rows are all drafts now) directly into the form
  // for editing — no password, same convention drafts always had (only editing an already-POSTED
  // bill is password-gated). mode='edit' with billId set to the draft's own id so Save routes to
  // draftSaleBills.update() rather than create()-ing a second one.
  const loadDraftIntoForm = async (draftIn: DraftSaleBillRow, opts: { mode?: 'edit' | 'view' } = {}) => {
    // list()/find-search rows never carry `.items` (only get()/create()/update() do — see
    // DraftSaleBillRow's own comment) — browsing/switching to one of those rows was loading the
    // form with an empty article grid (reported by the user, 2026-08-30). Re-fetch the full draft
    // whenever it's missing rather than trusting whatever was passed in.
    let draft = draftIn;
    if (!draft.items) {
      const res = await api.draftSaleBills.get(draft.draft_id);
      // A failed re-fetch used to fall through and render `draftIn` anyway. That row can be stale
      // list data for a draft that no longer exists — posting one DELETES it from draft_sale_bills
      // and turns it into a posted bill — so the form silently filled with a bill that is not a
      // draft at all. Reported by the user (2026-09-04): picking Unposted "still shows me the
      // posted bill". Say so and leave the form alone instead; callers fall back to a blank one.
      if (!res.ok) {
        setErrorMsg('That draft no longer exists — it may have been posted or deleted.');
        return false;
      }
      draft = res.data;
    }
    createdInThisRun.current = false;
    // Opening a different record must not carry over a stale scope from the last edit.
    setEditScope('master');
    setBillId(draft.draft_id);
    setCurrentSystemNo(draft.system_no);
    setCurrentBillIsPosted(false);
    setDate(toDateInputValue(draft.bill_date));
    setStoreId(draft.store_id != null ? String(draft.store_id) : '');
    setCustomerId(String(draft.customer_id));
    setSubCustomerId(draft.sub_customer_id != null ? String(draft.sub_customer_id) : '');
    setDeliveryType(draft.delivery_type === 'CUSTOM' ? 'custom' : '1');
    setDeliveryCode(draft.delivery_type === 'CUSTOM' ? '2' : '1');
    setCustomAddress(draft.delivery_address || '');
    setBillNo(draft.bill_no || '');
    setGpNo(draft.gp_no || '');
    setBiltyNo(draft.bilty_no || '');
    setAddaId(draft.adda_id != null ? String(draft.adda_id) : '');
    setRemarks(draft.remarks || '');
    setDueDate(''); // due_date doesn't exist on a draft — only applies once it's a real bill
    setInvoiceDiscount(draft.invoice_discount || 0);

    const loadedItems: UiItem[] = (draft.items || []).map(it => {
      const article = products.find(p => p.article_id === it.article_id);
      return {
        uid: 'draftrow_' + it.line_no,
        articleId: article?.article_id ?? null,
        variantId: it.variant_id,
        label: `${it.article_name || 'Article'} — ${it.color || ''}`,
        packing: it.pairs && it.cartons ? it.pairs / it.cartons : 0,
        cartons: it.cartons,
        pairs: it.pairs,
        rate: it.rate,
        discountPercent: it.discount_percent,
        discountValue: it.discount_value,
        value: it.value
      };
    });
    setItems(loadedItems);
    setSavedPairsByVariant(pairsByVariant(loadedItems));
    setEntry(newUiItem());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });

    setMode(opts.mode ?? 'edit');
    setErrorMsg('');
    return true;
  };

  // ── Record navigation: First/Pre./Next/Last + Posted/Unposted dropdown ──
  // The dropdown is a REAL data filter, i.e. it picks which set of bills the nav buttons page
  // through — 'posted' walks confirmed bills (dbo.sale_bills), 'unposted' walks saved-but-not-yet
  // -posted drafts (dbo.draft_sale_bills).
  //
  // This deliberately departs from pages_design.md §3, which specified the dropdown as an "arming"
  // control where BOTH values browsed the posted list and 'unposted' merely meant "I'm here to
  // press Unpost". That made the labels lie: picking "Unposted" showed posted bills, and a bill
  // you had just saved with Done could not be reached from the toolbar at all — only via Find or
  // the Pending Posting sidebar. Changed on the user's explicit instruction (2026-08-27) so each
  // option lists what its label says.
  // Unposted is the default (per the user, 2026-08-30): that's the working mode you add and post
  // new bills from. Posted is purely a browse mode over already-posted bills (First/Prev./Next/
  // Last + Un Post).
  const [browseFilter, setBrowseFilter] = useState<'posted' | 'unposted'>('unposted');

  const refreshPosted = useCallback(async () => {
    const res = await api.saleBills.list();
    if (res.ok) setPostedBills(res.data);
    return res.ok ? res.data : null;
  }, []);

  useEffect(() => { refreshPosted(); }, [refreshPosted]);

  // Sorted by system_no (creation order), NOT the shared list()'s own ORDER BY (bill_date DESC,
  // bill_id DESC — right for the date-driven report views that also call it, but wrong here): a
  // backdated bill_date used to put that bill next to whatever else shares its date when browsing,
  // so First..Last could jump straight from system_no 11 to system_no 24 (reported by the user,
  // 2026-09-07). system_no order is what "First = earliest, Last = most recent" actually promises.
  const navPostedList = useMemo(
    () => mergeWithDeleted([...postedBills].sort((a, b) => a.system_no - b.system_no), deletedNumbers),
    [postedBills, deletedNumbers],
  );
  const navUnpostedList = useMemo(
    () => mergeWithDeleted([...unpostedBills].sort((a, b) => a.system_no - b.system_no), deletedNumbers),
    [unpostedBills, deletedNumbers],
  );

  // Whichever list the dropdown currently selects — this is what the nav buttons page through.
  const navList = browseFilter === 'posted' ? navPostedList : navUnpostedList;

  // Where the bill on screen sits in the ACTIVE list — -1 when it isn't in it at all (a brand-new
  // unsaved bill, or a draft while the dropdown is on Posted and vice versa), which the handlers
  // below treat as "start from the beginning". navIndexOverride wins while a deleted-number
  // placeholder is on screen — it has no billId to find, so the derived lookup would otherwise
  // report -1 and Prev/Next would wrongly restart from the beginning instead of stepping on from it.
  const derivedNavIndex = useMemo(() => {
    if (billId == null) return -1;
    return browseFilter === 'posted'
      ? (currentBillIsPosted ? navPostedList.findIndex(e => e.kind === 'doc' && e.row.bill_id === billId) : -1)
      : (!currentBillIsPosted ? navUnpostedList.findIndex(e => e.kind === 'doc' && e.row.draft_id === billId) : -1);
  }, [billId, currentBillIsPosted, browseFilter, navPostedList, navUnpostedList]);
  const navIndex = navIndexOverride ?? derivedNavIndex;

  const canBrowse = navList.length > 0;
  const canNavPrevious = canBrowse && navIndex !== 0;
  const canNavNext = canBrowse && navIndex !== navList.length - 1;

  // Loads whichever entry sits at `idx` of the ACTIVE list into the form, read-only — browsing is
  // look-then-decide, same as opening any other existing bill; Edit still needs its own explicit
  // click (and, for a posted bill, its own password gate on Save). Posted rows come from
  // sale_bills, unposted ones from draft_sale_bills, so each needs its own loader. A 'deleted'
  // entry shows DeletedDocumentOverlay instead of loading anything (see navIndexOverride above).
  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    const entry = navList[idx];
    if (entry.kind === 'deleted') {
      setNavIndexOverride(idx);
      setDeletedPlaceholder(entry.system_no);
      return;
    }
    if (browseFilter === 'posted') {
      await loadBillRow(entry.row as SaleBillRow);
      setMode('view');
    } else {
      await loadDraftIntoForm(entry.row as DraftSaleBillRow, { mode: 'view' });
    }
  };

  // navIndex === -1 (nothing from this list loaded yet) behaves like First, not a no-op.
  const handleFirst = () => goToNavIndex(0);
  const handlePrev = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);
  const handleLast = () => goToNavIndex(navList.length - 1);

  // Switching the Posted/Unposted dropdown (per the user, 2026-08-30):
  // - To Unposted: load the most recently saved draft (or a blank New bill if there isn't one),
  //   then focus New — Enter on it clicks New and lands on Date, ready to type the next bill.
  // - To Posted: re-fetch and jump straight to the most recently posted bill for browsing.
  const handleBrowseFilterChange = async (next: 'posted' | 'unposted') => {
    setBrowseFilter(next);
    if (next === 'unposted') {
      // Re-fetch first, exactly like the Posted branch below. Reading the list straight out of
      // state meant a draft posted or deleted since it was last loaded was still in it, so
      // switching to Unposted opened a "draft" that no longer exists — the user (2026-09-04) saw
      // that as Unposted "still showing me the posted bill", since posting is precisely what turns
      // a draft into one. With a fresh list the entry is gone, so there is nothing to open and the
      // blank New bill below is what shows.
      const fresh = await refreshUnposted();
      const list = [...(fresh ?? unpostedBills)].sort((a, b) => a.system_no - b.system_no);
      const latest = list[list.length - 1];
      const opened = latest ? await loadDraftIntoForm(latest, { mode: 'view' }) : false;
      if (!opened) handleNew();
      requestAnimationFrame(() => newButtonRef.current?.focus());
    } else {
      const fresh = await refreshPosted();
      const list = [...(fresh ?? postedBills)].sort((a, b) => a.system_no - b.system_no);
      const latest = list[list.length - 1];
      if (latest) { await loadBillRow(latest); setMode('view'); }
    }
  };

  // Toolbar's Find button — a quick jump to any bill (posted or unposted) by bill number or
  // customer name, searched client-side over the already-loaded browse lists rather than a
  // round-trip, since both lists are small enough to already be in memory for First/Pre/Next/Last.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const closeFindBill = () => { setIsFindOpen(false); setFindQuery(''); };
  // G-07 (changes-14-09-26.md): Escape closes the topmost dialog.
  useEscapeToClose(isFindOpen, closeFindBill);
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = (b: { bill_no: string | null; customer_id: number }) =>
      (b.bill_no || '').toLowerCase().includes(q) ||
      (customers.find(c => c.customer_id === b.customer_id)?.name || '').toLowerCase().includes(q);
    const posted = postedBills.filter(matches).map(row => ({ filter: 'posted' as const, row }));
    const unposted = unpostedBills.filter(matches).map(row => ({ filter: 'unposted' as const, row }));
    return [...posted, ...unposted].slice(0, 30);
  }, [findQuery, postedBills, unpostedBills, customers]);

  const handleFindSelect = async (filter: 'posted' | 'unposted', row: SaleBillRow | DraftSaleBillRow) => {
    setIsFindOpen(false);
    setFindQuery('');
    if (filter === 'posted') {
      await loadBillRow(row as SaleBillRow);
      setMode('view');
    } else {
      await loadDraftIntoForm(row as DraftSaleBillRow, { mode: 'view' });
    }
  };

  // Toolbar's Delete button — the current on-screen bill, password-gated the same way the old
  // Pending Posting sidebar's per-row Delete was. Only ever a draft: a posted bill has to be
  // Un Posted first (mirrors the fact that sale_bills never holds an unposted document).
  const handleDeleteCurrentBill = () => {
    if (billId == null || currentBillIsPosted) return;
    pendingDeleteBillId.current = billId;
    setPasswordActionType('delete_unposted_bill');
    setIsPasswordModalOpen(true);
  };

  // Delete is dual-purpose per pages_design.md §4: "no per-row delete button [in the grid] —
  // deleting a line item is a toolbar action, enabled only while a row is selected". A row loaded
  // for editing (editingIndex) takes priority; otherwise a merely-clicked row (selectedIndex, G-08)
  // is the target; with neither, it falls back to this page's own whole-bill delete.
  // Toolbar Delete ALWAYS deletes the whole document now (per the user, 2026-09-20: a new user
  // could not know a row had to be deselected first). Deleting a single row is the row's own
  // Delete button in the grid — one meaning per button.
  const handleDeleteAction = () => {
    handleDeleteCurrentBill();
  };

  // Initialize new bill if mode is new and not set.
  //
  // Skipped entirely when this page mounted with a restored draft (usePersistentField): this
  // effect fires a beat AFTER mount, once `stores` resolves, and handleNew() blanks every field
  // AND clears the stored draft — so without the guard, coming back to a half-typed bill wiped it
  // a fraction of a second after it was restored (reported by the user, 2026-08-30).
  // One-time cleanup: a restored draft from before Bill No. stopped being auto-generated
  // (2026-08-30) can still be carrying the old random 5-digit value. Clears only that one field
  // — never the rest of a legitimately half-typed draft — and only while it's still untouched
  // (no articles added yet), so a real bill no coincidentally matching the same shape is left alone.
  useEffect(() => {
    if (hasSaleBillDraft && mode === 'new' && billId === null && items.length === 0 && /^\d{5}$/.test(billNo)) {
      setBillNo('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculations
  const totalCartons = useMemo(() => items.reduce((sum, item) => sum + (item.cartons || 0), 0), [items]);
  const totalPairs = useMemo(() => items.reduce((sum, item) => sum + (item.pairs || 0), 0), [items]);
  const itemsTotalValue = useMemo(() => items.reduce((sum, item) => sum + (item.value || 0), 0), [items]);
  const finalTotalValue = useMemo(() => Math.max(0, itemsTotalValue - invoiceDiscount), [itemsTotalValue, invoiceDiscount]);

  // Toolbar Actions
  // SB-05: "was the bill now on screen created in this run?" — the difference between finishing a
  // bill you were entering (clear and move to the next) and posting one you deliberately opened
  // from the list (stay on it; you navigated here to look at it). Set when create() succeeds,
  // cleared by handleNew() and by loading any existing bill.
  const createdInThisRun = useRef(false);

  const handleNew = () => {
    clearSaleBillDraft();
    setMode('new');
    setHasClickedNew(false);
    // SB-05: a blank form has nothing saved in it yet, so nothing to clear on post.
    createdInThisRun.current = false;
    setEditScope('master');
    setBillId(null);
    setCurrentSystemNo(null);
    setCurrentBillIsPosted(false);
    setSavedPairsByVariant({});
    setDate(getTodayDate());
    setStoreId(stores[0] ? String(stores[0].store_id) : '');
    setCustomerId('');
    setSubCustomerId('');
    setDeliveryType('1');
    setDeliveryCode('1');
    setCustomAddress('');
    setIsAddSubCustomerOpen(false);
    setNewSubCustomerName('');
    // Bill No. is hand-typed by the user, per the user (2026-08-30) — never a generated value.
    setBillNo('');
    setGpNo('');
    setBiltyNo('');
    setAddaId('');
    setRemarks('');
    setDueDate('');
    setInvoiceDiscount(0);
    setItems([]);
    setEntry(newUiItem());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);
    setErrorMsg('');
    // Explicit focus, not just the G-01 mode-change effect above: clicking New while already on
    // a blank/new bill (mode is already 'new') doesn't change `mode`, so that effect's dependency
    // never fires and focus would otherwise stay wherever it was.
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };
  // New button / New tab — the only path that marks New as deliberately clicked (useNewDocGate).
  const pressNew = () => { handleNew(); markNewClicked(); };

  // SB-05: a finished bill clears straight back to a blank one so the next can be typed
  // immediately. Reuses handleNew() rather than repeating its field list, so "a blank bill" stays
  // defined in exactly one place — then puts the working date back, since handleNew() snaps to
  // today and a run of bills entered for an earlier date would otherwise reset on every one.
  // The cursor returns to the first field on its own via the app-wide G-01 auto-focus rule.
  const readyForNextBill = () => {
    const workingDate = date;
    handleNew();
    setDate(workingDate);
    // The G-01 auto-focus effect in AppLayout only re-scans when a <form> is newly INSERTED into
    // the DOM (on page mount, or a MutationObserver catching one appearing later) — it does not
    // re-run just because this page's own state resets while already mounted, since nothing here
    // remounts AppLayout or removes/reinserts the form. Left to that effect alone, mode's real
    // path during a save is 'new' -> 'view' -> 'new' — same value it started at from the effect's
    // perspective, so its own dependency array never sees a change and it never re-fires. Reported
    // directly by the user: the form cleared correctly, but focus never returned to the first
    // field. Focusing explicitly here, rather than depending on that effect, is what actually
    // fixes it.
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  const buildPayload = (): SaleBillCreateInput | null => {
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (!storeId) { setErrorMsg('Store is required.'); return null; }
    if (!customerId) { setErrorMsg('Customer is required.'); return null; }
    if (!billNo) { setErrorMsg('Bill No. is required.'); return null; }
    if (items.length === 0) { setErrorMsg('At least one product item is required.'); return null; }

    if (hasStockExceeded) {
      setErrorMsg('Cannot save bill: Requested cartons exceed current stock in hand.');
      return null;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.variantId) { setErrorMsg(`Article/color is required at row ${i + 1}.`); return null; }
      if (it.cartons <= 0) { setErrorMsg(`Cartons must be greater than 0 at row ${i + 1}.`); return null; }
      const rowCartonsIssue = cartonsProblem(it.cartons, it.packing);
      if (rowCartonsIssue) { setErrorMsg(`Row ${i + 1}: ${rowCartonsIssue}`); return null; }
      if (it.rate <= 0) { setErrorMsg(`Rate must be greater than 0 at row ${i + 1}.`); return null; }
    }

    if (isCustomDelivery && !subCustomerId) {
      setErrorMsg('Please select a Sub-Customer for Custom Delivery.');
      return null;
    }

    const itemsPayload: SaleBillItemInput[] = items.map(it => ({
      variant_id: it.variantId!,
      cartons: it.cartons,
      rate: it.rate,
      discount_percent: it.discountPercent
    }));

    return {
      customer_id: Number(customerId),
      sub_customer_id: isCustomDelivery ? Number(subCustomerId) : null,
      store_id: Number(storeId),
      bill_date: date,
      delivery_type: isCustomDelivery ? 'CUSTOM' : 'SAME',
      delivery_address: isCustomDelivery ? customAddress : undefined,
      bill_no: billNo,
      gp_no: gpNo,
      bilty_no: biltyNo,
      adda_id: addaId ? Number(addaId) : undefined,
      remarks: remarks || undefined,
      invoice_discount: invoiceDiscount,
      due_date: dueDate || undefined,
      items: itemsPayload
    };
  };

  // Whichever bill is on screen, `billId`/`is_posted` route to one of two entirely different
  // tables now: a POSTED document is a real sale_bills row (billId = bill_id); anything else is a
  // draft_sale_bill row (billId = draft_id) — the real table strictly never holds an unposted
  // document. This flag is what every save/post/unpost path below branches on.
  const isEditingPostedBill = mode === 'edit' && currentBillIsPosted;

  // `finalize` decides what the form does AFTER a successful save, and nothing else:
  //   true  ("Done")  -> lock to view mode; the bill stays fully on screen and Post lights up.
  //   false ("Save")  -> stay editable so more articles can be added to the SAME bill.
  // Either way the entered lines are kept — Done used to wipe the whole form, which is what made
  // a finished bill's articles vanish before it could be posted (reported directly by the user).
  //
  // Note the mode flip to 'edit' on the non-finalize path: executeSave() below picks create() vs
  // update() off `mode === 'edit' && billId != null`, so leaving a just-created bill in 'new' mode
  // would make the NEXT Save create a second, duplicate bill instead of updating this one.
  const executeSave = async (password?: string, finalize: boolean = true): Promise<SaleBillRow | DraftSaleBillRow | null> => {
    // Backstop for the awaitingNew lock — every save path funnels through here.
    if (awaitingNew) { setErrorMsg('Click New to start a bill first.'); return null; }
    const payload = buildPayload();
    if (!payload) return null;

    if (isEditingPostedBill && billId != null) {
      const result = await api.saleBills.update(billId, password ? { ...payload, password } : payload);
      if (!result.ok) {
        setErrorMsg('Failed to save bill: ' + result.error.message);
        return null;
      }
      setBillId(result.data.bill_id);
      setCurrentSystemNo(result.data.system_no);
      setCurrentBillIsPosted(true);
      setSavedPairsByVariant(pairsByVariant(items));
      setSuccessMsg('Sale bill updated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setMode(finalize ? 'view' : 'edit');
      setErrorMsg('');
      refreshStock();
      return result.data;
    }

    // Every other save — a brand-new bill, or editing one that's still a draft — goes through the
    // draft table now (draftSaleBills.service.js), not sale_bills directly.
    const result = mode === 'edit' && billId != null
      ? await api.draftSaleBills.update(billId, payload)
      : await api.draftSaleBills.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save bill: ' + result.error.message);
      return null;
    }

    setBillId(result.data.draft_id);
    setCurrentSystemNo(result.data.system_no);
    setCurrentBillIsPosted(false);
    setSavedPairsByVariant(pairsByVariant(items));
    // SB-05: only a freshly created bill counts as "part of this run" — an edit of an existing
    // bill must not clear the form out from under the user when it posts.
    if (mode !== 'edit') {
      createdInThisRun.current = true;
      clearSaleBillDraft();
    }
    setSuccessMsg(mode === 'edit' ? 'Sale bill updated successfully.' : 'New sale bill saved successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode(finalize ? 'view' : 'edit');
    setErrorMsg('');
    refreshStock();
    refreshUnposted(); // SB-06: a newly saved bill joins the pending-posting list immediately.
    return result.data;
  };

  // `finalize=false` is "Save" — persist and stay editable, so more articles can go onto the same
  // bill. `finalize=true` is "Done" — persist and lock to view mode, where the bill stays fully on
  // screen (every article still listed) and Post becomes available.
  //
  // Neither clears the form any more. Done previously called readyForNextBill(), which blanked
  // everything the moment it was pressed, so a just-finished bill's articles disappeared before
  // there was any chance to post it — reported directly by the user. Starting the next bill is
  // now the New button's job alone, which is the only place it can't surprise anyone.
  const handleSave = async (finalize: boolean = true) => {
    // Only editing an ALREADY-POSTED bill needs a password — editing a draft (complete or not)
    // never did, same convention "Saved Drafts" always had.
    if (isEditingPostedBill) {
      setPasswordActionType('save_bill');
      setIsPasswordModalOpen(true);
      return;
    }
    await executeSave(undefined, finalize);
  };

  // SB-01: the whole save-and-post path is wrapped, because this is the button that "did nothing" on
  // one laptop. Every failure the API *reports* was already handled below; what wasn't was a failure
  // that THROWS — a rejected promise, or a TypeError from an undefined `window.api.<feature>` — which
  // unwound this handler silently and left the button looking dead. Now it names itself in the banner.
  // (main.tsx also catches this class globally; this is the local, specific message.)
  const handleSaveAndPost = async () => {
    try {
      await saveAndPost();
    } catch (err) {
      console.error('[Wentox] Save & Post threw:', err);
      setErrorMsg(
        'Save & Post failed unexpectedly: ' +
        (err instanceof Error ? `${err.name}: ${err.message}` : String(err)) +
        ' — please screenshot this.'
      );
    }
  };

  // Only reachable while !currentBillIsPosted (the button itself is hidden otherwise), so `saved`
  // is always a fresh/edited DRAFT here — there's no separate "post an already-real-unposted bill"
  // step left; saving IS drafting, so Save & Post is draft-then-confirm in one click.
  const saveAndPost = async () => {
    const saved = await executeSave();
    if (saved && 'draft_id' in saved) {
      const postRes = await api.draftSaleBills.confirm(saved.draft_id);
      if (!postRes.ok) {
        // Saved but not posted: the draft exists and must stay on screen, so no reset here — the
        // user needs to see which bill failed and press Post again once it's fixed.
        setErrorMsg('Bill was saved, but posting failed: ' + postRes.error.message);
      } else {
        setBillId(postRes.data.bill_id);
        setCurrentSystemNo(postRes.data.system_no);
        setCurrentBillIsPosted(true);
        // SB-05: name the bill in the message, because the form is about to empty — otherwise the
        // screen clearing is the only feedback that anything was saved at all.
        setSuccessMsg(`Bill ${postRes.data.bill_no} saved & posted. Ready for the next one.`);
        setTimeout(() => setSuccessMsg(''), 3000);
        refreshUnposted(); // SB-06: it just left the pending list.
        refreshPosted();
        if (createdInThisRun.current) readyForNextBill();
      }
    }
  };

  const handlePostCurrentBill = async () => {
    if (billId == null) return;
    const postedBillNo = billNo;
    const res = await api.draftSaleBills.confirm(billId);
    if (!res.ok) {
      setErrorMsg('Failed to post bill: ' + res.error.message);
    } else {
      setBillId(res.data.bill_id);
      setCurrentSystemNo(res.data.system_no);
      setCurrentBillIsPosted(true);
      refreshUnposted(); // SB-06: it just left the pending list.
      refreshPosted();
      // SB-05: clear for the next bill only if this one was entered in this run. A bill opened
      // from the Find tab and posted there stays on screen — the user went to it deliberately.
      if (createdInThisRun.current) {
        setSuccessMsg(`Bill ${postedBillNo} posted. Ready for the next one.`);
        readyForNextBill();
      } else {
        setSuccessMsg('Bill posted successfully.');
      }
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  // "Unpost" now moves the bill back to being a draft — the real sale_bills table strictly never
  // holds an unposted document (mirrors confirm()'s move in the other direction). The form now
  // points at a different id (the new draft's), so it's updated here rather than just flipping a
  // flag the way the old ledger-only unpost did.
  const handleUnpostCurrentBill = async () => {
    if (billId == null) return;
    const res = await api.saleBills.unconfirm(billId);
    if (!res.ok) {
      setErrorMsg('Failed to unpost bill: ' + res.error.message);
      return;
    }
    setBillId(res.data.draft_id);
    setCurrentSystemNo(res.data.system_no);
    setCurrentBillIsPosted(false);
    // pages_design.md §3: land on the editable screen immediately after unposting, not a
    // read-only one — the whole point of unposting is to go fix something.
    setMode('edit');
    setSuccessMsg('Bill unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshUnposted();
    refreshPosted();
    // It's a draft again now, so the window follows it back to the Unposted view (per the user,
    // 2026-08-30) rather than staying on Posted looking at a bill that no longer belongs there.
    setBrowseFilter('unposted');
  };

  // Weekly/Monthly/Overall/Find sub-tabs — re-added (2026-08-26, per the user) alongside Sale
  // Return's own equivalents, which never lost theirs. Loads the picked row straight into the
  // main entry form and switches back to the Bill tab (view mode) — same convention as Sale
  // Return's handleEditSpecificReturn/handlePrintSpecificReturn.
  const handleEditSpecificBill = async (bill: SaleBillRow) => {
    await loadBillRow(bill);
    setActiveTab('bill');
    setMode('edit');
  };

  // Loads the target bill, then opens the preview modal on it — same trigger the toolbar's own
  // Print/PDF buttons use (isPrintingSingle just names "which bill is on the print-preview modal
  // right now", not "print immediately" — see renderBillPrintable above for why that changed).
  const handlePrintSpecificBill = async (bill: SaleBillRow) => {
    await loadBillRow(bill);
    setIsPrintingSingle(true);
  };

  // Entering edit mode never needs its own password prompt anymore — Save (handleSave,
  // mode==='edit') already asks for one before the update actually goes through, so gating entry
  // into edit mode too meant asking twice for one edit (reported by the user for both this
  // button and handleEditSpecificBill above).
  // Edit — lands focus on the first field of whichever scope is picked (per the user, 2026-08-31).
  const handleEditCurrentBill = () => {
    setMode('edit');
    requestAnimationFrame(() => {
      if (editScope === 'detail') focusFirstField(entryProductCellRef.current);
      else firstFieldRef.current?.focus();
    });
  };

  const handlePasswordSuccess = async (password: string) => {
    setIsPasswordModalOpen(false);
    if (passwordActionType === 'save_bill') {
      await executeSave(password);
    } else if (passwordActionType === 'delete_unposted_bill') {
      const targetId = pendingDeleteBillId.current;
      pendingDeleteBillId.current = null;
      if (targetId != null) {
        const res = await api.draftSaleBills.remove(targetId, password);
        if (!res.ok) {
          setErrorMsg('Failed to delete bill: ' + res.error.message);
        } else {
          setSuccessMsg('Bill deleted successfully.');
          setTimeout(() => setSuccessMsg(''), 3000);
          // The bill on screen (if any) may have just been the one deleted — drop back to a
          // fresh form rather than leave it pointing at a bill that no longer exists.
          if (billId === targetId && !currentBillIsPosted) handleNew();
          await Promise.all([refreshUnposted(), refreshStock(), refreshDeletedNumbers()]);
        }
      }
    }
    setPasswordActionType(null);
  };

  // ── Detail entry strip (ref-pic bound-record pattern) ──
  // A single "current record" (`entry`) sits in its own strip above the committed-items table —
  // NOT one of the table's own rows. Typing an article, cartons, rate, D%/DV and pressing Enter
  // on the last field commits it into `items` (appending, or replacing `editingIndex` when a
  // table row was clicked to re-open it) and resets the strip, ready for the next article,
  // without ever touching the master fields above. This mirrors legacy grid-bound-entry software
  // (the ref-pic's own UI) more directly than editing cells inline inside the table itself.
  const [entry, setEntry] = usePersistentField<UiItem>('sale-bill', 'entry', newUiItem());
  // null while the strip is adding a brand-new row; the table index being replaced once a
  // committed row has been clicked back open for editing (see handleRowClick below).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // G-08 (changes-14-09-26.md, 2026-09-15): a click on a detail row must produce no visible change
  // at all — no edit load, no highlight. It only records which row Delete/Edit will act on
  // internally; `editingIndex` (the actually-loaded-for-editing row, and the only thing that
  // drives the blue highlight) is set exclusively by the Edit button now, never by a row click
  // directly. Cleared whenever `editingIndex` takes over (Edit pressed) so the two never point at
  // different rows at once.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // G-05 (changes-14-09-26.md, 2026-09-15): the row most recently ADDED or UPDATED via the entry
  // strip — a pure position indicator (the ▶ gutter marker below), never a selection. Deliberately
  // separate from `selectedIndex`/`editingIndex` above: G-05's own text is explicit that the
  // pointer "must not look like, or behave as, the highlight described in G-08" — a click never
  // moves it, only committing a row does.
  const [lastEnteredIndex, setLastEnteredIndex] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  useEffect(() => {
    if (lastEnteredIndex != null) rowRefs.current[lastEnteredIndex]?.scrollIntoView({ block: 'nearest' });
  }, [lastEnteredIndex]);
  const entryProductCellRef = useRef<HTMLDivElement>(null);

  // Declared down here, after every piece of state the loaders below touch: placing it
  // earlier makes the React Compiler bail out ("accessed before it is declared") even
  // though the effect only ever runs after mount.
  // Landing on the page with nothing in progress: the Posted/Unposted dropdown already reads
  // Unposted, so open the newest unposted bill and park focus on New, exactly as picking Unposted
  // from the dropdown does (per the user, 2026-09-04). Falls back to a blank bill when there are
  // none, which is what this effect used to do unconditionally. Runs once — the ref keeps a
  // later state change from re-opening a record over whatever is being typed by then.
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (hasSaleBillDraft || didAutoOpenRef.current) return;
    // No mode/billId check: a restored view of an older record must be replaced too (2026-09-18).
    if (stores.length > 0) {
      didAutoOpenRef.current = true;
      handleBrowseFilterChange('unposted');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, billId, stores]);

  // Product field's SearchModal — same pattern as Customer's (pages_design.md §5): type the
  // article code, Enter opens a big centered popup to pick from, matching stock shown per row.
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const productTriggerRef = useRef<HTMLInputElement>(null);
  // What's currently typed into the Product field itself — separate from `entry.articleId`/
  // `entry.label` (the committed selection) so the field can keep showing free-typed text right
  // up until Enter opens the modal with it as the initial filter.
  const [productSearchText, setProductSearchText] = useState('');
  // Code is part of the label AND the search text: the field shows the picked article's code, so
  // typing a code and pressing Enter must find it (it only matched names before — typing "P-111"
  // opened an empty "No matches found" popup, reported by the user 2026-09-18).
  const productOptions = useMemo(() => products.map(p => {
    const agg = getStockInfo(p.article_id, null);
    return {
      value: String(p.article_id),
      label: p.code ? `${p.code} — ${p.name}` : p.name,
      sublabel: agg ? `Stock: ${formatCartons(agg.cartons)} ctn / ${agg.pairs} prs` : undefined,
      searchText: `${p.code ?? ''} ${p.name}`,
    };
  }), [products, getStockInfo]);

  const handleEntryArticleChange = async (articleIdStr: string) => {
    const articleId = articleIdStr ? Number(articleIdStr) : null;
    const product = articleId != null ? products.find(p => p.article_id === articleId) : undefined;
    setEntry(prev => recalcItem({
      ...prev,
      articleId,
      variantId: null,
      label: product?.name || '',
      packing: product?.packing || 0,
      rate: product?.sale_price ?? prev.rate
    }));
    if (articleId != null) await fetchVariants(articleId);
  };

  // Keeps the Product field's displayed text in sync with `entry.articleId` from every reset
  // point at once (new row, row loaded for editing, commit, Cancel) instead of setting
  // `productSearchText` by hand at each one.
  useEffect(() => {
    const product = entry.articleId != null ? products.find(p => p.article_id === entry.articleId) : undefined;
    setProductSearchText(product?.code ?? '');
  }, [entry.articleId, products]);

  const handleEntryVariantChange = (variantIdStr: string) => {
    if (entry.articleId == null) return;
    const variantId = variantIdStr ? Number(variantIdStr) : null;
    const variant = variantsByArticle[entry.articleId]?.find(v => v.variant_id === variantId);
    const product = products.find(p => p.article_id === entry.articleId);
    setEntry(prev => recalcItem({
      ...prev,
      variantId,
      label: variant ? `${product?.name || ''} — ${variant.color}` : (product?.name || ''),
      packing: variant?.packing ?? product?.packing ?? prev.packing,
      rate: product?.sale_price ?? prev.rate
    }));
  };

  const updateEntryNumericField = (field: 'cartons' | 'rate' | 'discountPercent' | 'discountValue', val: number) => {
    setEntry(prev => {
      const next = { ...prev, [field]: val };
      // Same rounded pair count recalcItem uses for `value` — deriving gross from the raw
      // cartons x packing instead would let the D% <-> DV conversion disagree with the
      // line's own total by a fraction on quantities where that product drifts.
      const gross = pairsFor(next.cartons, next.packing) * next.rate;
      if (field === 'discountValue') {
        next.discountPercent = gross > 0 ? parseFloat(((val / gross) * 100).toFixed(1)) : 0;
      }
      return recalcItem(next);
    });
  };

  // Same stock-limit rule as the whole-bill check below, scoped to just the strip's own variant:
  // other committed rows already reserve some of that stock, so what's left is (available minus
  // whatever they've already claimed) — the row being re-edited (editingIndex) doesn't double-count
  // against itself.
  // Stock In Hand readout — available stock minus whatever this same article/color already has
  // reserved on OTHER committed rows of this bill (per the user, 2026-08-30: re-picking a variant
  // already on the bill was showing the raw stock figure, not what's actually still available to
  // add). The row being re-edited (editingIndex) doesn't double-count against itself.
  // Tracked in PAIRS — the indivisible unit, and the only one that can express a part carton (see
  // stockExceededRows above). `cartons`/`pairs` here are that same remaining figure split back out
  // for the readout, so "1 Ctn / 6 Prs" always describes exactly what remainingPairs is worth
  // rather than mixing a truncated carton count with a separately-derived remainder.
  const entryStockInHand = useMemo(() => {
    if (entry.variantId == null) return null;
    const stockInfo = getStockInfo(entry.articleId, entry.variantId);
    if (!stockInfo) return null;
    const reservedPairs = items.reduce(
      (sum, it, i) => (i !== editingIndex && it.variantId === entry.variantId ? sum + it.pairs : sum),
      0,
    );
    // + what this bill already took when it was saved — same add-back as stockExceededRows.
    const onHandPairs = stockInfo.pairs + (savedPairsByVariant[entry.variantId] || 0);
    const remainingPairs = Math.max(0, onHandPairs - reservedPairs);
    return { remainingPairs, ...cartonsAndPairs(remainingPairs, entry.packing) };
  }, [entry.articleId, entry.variantId, entry.packing, items, editingIndex, getStockInfo, savedPairsByVariant]);

  const entryStockCheck = useMemo(() => {
    if (entry.variantId == null || entry.pairs <= 0 || !entryStockInHand) return null;
    const availablePairs = entryStockInHand.remainingPairs;
    return entry.pairs > availablePairs ? { availablePairs, requestedPairs: entry.pairs } : null;
  }, [entry.variantId, entry.pairs, entryStockInHand]);

  // Commits the strip's current entry into the table — appends a new row, or overwrites
  // `editingIndex` when the strip is re-editing a row clicked open from the table. Stock-blocked
  // entries refuse to commit at all (per spec: "do not allow adding the row"), not just warn.
  const handleCommitEntryRow = () => {
    if (entry.articleId == null || entry.variantId == null) {
      setErrorMsg('Select an article and color before adding the row.');
      return;
    }
    if (entry.cartons <= 0) { setErrorMsg('Cartons must be greater than 0.'); return; }
    // Mirrors the server's rule (backend/src/utils/cartons.js): cartons is DECIMAL(12,1), so a
    // finer figure would be rounded on save, and pairs stay whole because a pair is indivisible.
    // Said here so the operator finds out while the strip is still open, not on save.
    const cartonsIssue = cartonsProblem(entry.cartons, entry.packing);
    if (cartonsIssue) { setErrorMsg(cartonsIssue); return; }
    if (entry.rate <= 0) { setErrorMsg('Rate must be greater than 0.'); return; }
    if (entryStockCheck) {
      setErrorMsg(`Cannot add row: ${entryStockCheck.requestedPairs} pairs requested exceeds ${entryStockCheck.availablePairs} in stock.`);
      return;
    }
    setErrorMsg('');
    // Same article/color already on the bill — merge cartons into it instead of adding a
    // duplicate row (per the user, 2026-08-30). Excludes the row being edited itself, so
    // re-committing an unchanged row doesn't fold it into a copy of itself.
    const dupIdx = items.findIndex((it, i) => it.variantId === entry.variantId && i !== editingIndex);
    // G-05: computed BEFORE `setItems` below (whose functional updater can't hand a value back
    // out here) from the exact same index arithmetic each branch already performs.
    let pointerIdx: number;
    if (dupIdx !== -1) {
      const withoutEditing = editingIndex != null ? items.filter((_, i) => i !== editingIndex) : items;
      pointerIdx = withoutEditing.findIndex(it => it.variantId === entry.variantId);
    } else if (editingIndex != null) {
      pointerIdx = editingIndex;
    } else {
      pointerIdx = items.length;
    }
    if (dupIdx !== -1) {
      setItems(prev => {
        const withoutEditing = editingIndex != null ? prev.filter((_, i) => i !== editingIndex) : prev;
        const mergeIdx = withoutEditing.findIndex(it => it.variantId === entry.variantId);
        return withoutEditing.map((it, i) => i === mergeIdx
          ? recalcItem({ ...it, cartons: it.cartons + entry.cartons })
          : it);
      });
      setErrorMsg('');
      setSuccessMsg(`${entry.label} was already on the bill — cartons merged into that row.`);
      setTimeout(() => setSuccessMsg(''), 3500);
    } else if (editingIndex != null) {
      setItems(prev => prev.map((it, i) => i === editingIndex ? entry : it));
    } else {
      setItems(prev => [...prev, entry]);
    }
    setLastEnteredIndex(pointerIdx);
    setEditingIndex(null);
    setSelectedIndex(null);
    setEntry(newUiItem());
    requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
  };

  // Enter on the strip's LAST field (DV) commits the row and resets the strip — every other Enter
  // press within the strip is left to G-01's normal field-walk. stopPropagation keeps AppLayout's
  // own window-level Enter handler from also acting on the same keydown once setEntry/setItems
  // have fired (it reads the same e.target, which hasn't re-rendered away yet).
  function handleEntryLastFieldKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    handleCommitEntryRow();
  }

  // Loads an already-committed row back into the strip for editing (table row click). Posted
  // bills are password-gated first (see handleRowClick); drafts and brand-new bills load straight
  // in, matching the convention that only a POSTED bill's edits ever need a password.
  const loadRowIntoEntry = (idx: number) => {
    const row = items[idx];
    setEntry(row);
    setEditingIndex(idx);
    setSelectedIndex(null);
    if (row.articleId != null) fetchVariants(row.articleId);
    requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
  };

  // G-08: now the Edit toolbar button's handler, not the row's own onClick — a row click just
  // records `selectedIndex` (see the grid below), and this only runs once the user presses Edit.
  const handleRowClick = (idx: number) => {
    // Master/Detail edit-scope split (per the user, 2026-08-31): a row click is how the detail
    // grid re-opens a committed line for editing — a no-op while scope is Master, so master-only
    // edits can't sneak article changes in through the grid. Doesn't affect 'new'/view browsing.
    if (mode === 'edit' && editScope !== 'detail') return;
    // A posted bill is read-only — this used to offer a password prompt and then let the line
    // be edited in place, which is a second way in that the disabled Edit button already
    // refuses. Un Post is the only route (per the user, 2026-09-04).
    if (currentBillIsPosted) return;
    if (isViewMode) setMode('edit');
    loadRowIntoEntry(idx);
  };

  const handleEditSelectedRow = () => {
    if (selectedIndex != null) handleRowClick(selectedIndex);
  };

  const handleRemoveItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setSelectedIndex(null);
      setEntry(newUiItem());
    } else if (editingIndex != null && idx < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
    setSelectedIndex(null);
    if (lastEnteredIndex === idx) setLastEnteredIndex(null);
    else if (lastEnteredIndex != null && idx < lastEnteredIndex) setLastEnteredIndex(lastEnteredIndex - 1);
  };

  // Invoice card fills whatever vertical space is left in the viewport below it, so the item
  // table (flex-1 inside it) gets to grow and the Remarks/Calculations footer lands at the
  // screen's bottom edge instead of trailing off wherever the table's old fixed height happened
  // to end. Measured via getBoundingClientRect rather than a CSS calc() of fixed chrome heights,
  // because the chrome above this card (toolbar wrapping on a narrow window, the "Saved
  // Successfully" banner appearing) changes height dynamically — a hardcoded calc() would drift
  // out of sync with any of those, but the measured top position can't.
  const invoiceCardRef = useRef<HTMLDivElement>(null);
  const [invoiceCardHeight, setInvoiceCardHeight] = useState<number | null>(null);

  useEffect(() => {
    function recompute() {
      const el = invoiceCardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // AppLayout's <main> (the only scroll container in the app) adds 32px of its own
      // padding-bottom below whatever height we claim here — leaving that out made the card's
      // bottom edge land 32px past the viewport, so `<main>` still scrolled by that much even
      // though the intent is for it to never scroll at all, only the item table below.
      setInvoiceCardHeight(Math.max(360, window.innerHeight - top - 32));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [mode, hasStockExceeded]);

  const isViewMode = mode === 'view';
  // Master/Detail edit-scope split (per the user, 2026-08-31): once Edit is already reachable
  // (isViewMode false, mode 'edit'), the radio narrows WHICH half actually unlocks — this does not
  // weaken the existing isPosted gate on the Edit button itself, it only adds a further split on
  // top of it. A brand-new bill (mode 'new') is unaffected — everything stays editable there.
  const masterFieldsLocked = awaitingNew || (mode === 'edit' && editScope !== 'master');
  const detailFieldsLocked = awaitingNew || (mode === 'edit' && editScope !== 'detail');

  // Backend has no real-time stock IPC channel wired up yet (stock.service.js#currentStock
  // exists server-side but isn't exposed over ipc) — Stock column just shows a placeholder.

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) { setErrorMsg('Customer name is required.'); return; }
    if (!newCustomerRegionId) { setErrorMsg('Region is required.'); return; }

    const res = await api.createCustomer({
      name: newCustomerName.trim(),
      region_id: Number(newCustomerRegionId),
      city_id: newCustomerCityId ? Number(newCustomerCityId) : undefined
    });
    if (!res.ok) {
      setErrorMsg('Failed to create customer: ' + res.error.message);
      return;
    }
    setCustomers(prev => [...prev, res.data]);
    setCustomerId(String(res.data.customer_id));
    setDeliveryType('1');
    setDeliveryCode('1');
    setSubCustomerId('');
    setCustomAddress('');
    setIsAddCustomerOpen(false);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');
    setSuccessMsg('New customer added successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleCreateSubCustomer = async () => {
    if (!newSubCustomerName.trim()) { setErrorMsg('Sub-customer name is required.'); return; }
    if (!newSubCustomerRegionId) { setErrorMsg('Region is required.'); return; }

    const res = await api.createSubCustomer({
      name: newSubCustomerName.trim(),
      region_id: Number(newSubCustomerRegionId),
      city_id: newSubCustomerCityId ? Number(newSubCustomerCityId) : undefined
    });
    if (!res.ok) {
      setErrorMsg('Failed to create sub-customer: ' + res.error.message);
      return;
    }
    setSubCustomers(prev => [...prev, res.data]);
    setSubCustomerId(String(res.data.sub_customer_id));
    setIsAddSubCustomerOpen(false);
    setNewSubCustomerName('');
    setNewSubCustomerRegionId('');
    setNewSubCustomerCityId('');
    setSuccessMsg('Sub-customer added successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // The bill's printable document — built once here and handed to ReportPrintPreviewModal as its
  // `children`, instead of the old approach of swapping the WHOLE page over to this markup and
  // calling window.print() directly. That old path jumped straight to the OS print dialog with no
  // on-screen preview at all — fine from the toolbar's own Print button (the user is already
  // looking at this exact bill), but from Find & Update Bill (and Weekly/Monthly/Overall) printing
  // a DIFFERENT bill than whatever was last open on screen, with nothing shown first to confirm it
  // loaded the right one. Reported by the user, 2026-09-04: "print previw" not shown there. Routing
  // through the same modal every report page already uses gives every entry point a real preview.
  // Builds the shared print model (BA-01, changes-14-09-26.md, 2026-09-15) from this page's own
  // live form state — may be an unsaved bill, so names are resolved from the loaded lookups rather
  // than trusting any *_name columns. The actual invoice markup lives in the one shared
  // <SaleBillPrintable> component; BiltyUpdatePage builds the same model shape from a fetched
  // SaleBillRow to print a bill without opening this page at all.
  const renderBillPrintable = () => {
    const customerObj = customers.find(c => c.customer_id === Number(customerId));
    const customerName = customerObj ? customerObj.name : (customerId || 'N/A');
    const storeObj = stores.find(s => s.store_id === Number(storeId));
    const storeName = storeObj ? storeObj.name : (storeId || 'N/A');
    const addaObj = addas.find(a => a.adda_id === Number(addaId));
    const addaName = addaObj ? addaObj.name : (addaId || 'N/A');
    const subCustomerObj = subCustomers.find(sc => sc.sub_customer_id === Number(subCustomerId));
    const subCustomerName = isCustomDelivery
      ? (subCustomerObj ? subCustomerObj.name : 'Custom Agent')
      : 'SAME (Direct)';
    const statusLabel = currentBillIsPosted ? 'Posted' : 'Unposted';

    const model: SaleBillPrintModel = {
      statusLabel,
      systemNo: currentSystemNo ?? 'Unsaved',
      date,
      storeName,
      billNo,
      customerName,
      subCustomerName,
      isCustomDelivery,
      customAddress,
      addaName,
      gpNo,
      biltyNo,
      remarks,
      items: items.map(item => ({
        uid: item.uid,
        label: item.label,
        packing: item.packing,
        cartons: item.cartons,
        pairs: item.pairs,
        rate: item.rate,
        discountPercent: item.discountPercent,
        discountValue: item.discountValue,
        value: item.value,
      })),
      totalCartons,
      totalPairs,
      itemsTotalValue,
      invoiceDiscount,
      finalTotalValue,
    };

    return <SaleBillPrintable model={model} />;
  };

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same as Sale Return, so the content below the Quick Menu bar starts
  // immediately instead of losing a row's height to a tab bar first.
  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('bill'); pressNew(); }}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'bill' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Sale Bill
      </button>
      <button
        onClick={() => setActiveTab('weekly')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'weekly' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Weekly Records
      </button>
      <button
        onClick={() => setActiveTab('monthly')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'monthly' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Monthly Records
      </button>
      <button
        onClick={() => setActiveTab('overall')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'overall' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Overall Records
      </button>
      <button
        onClick={() => setActiveTab('find')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'find' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Find &amp; Update Bill
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Sale Bill" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }} {...autoEditScope}>

        {/* Tab contents (records & find) */}
        <div>
          {activeTab === 'weekly' && <WeeklyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'monthly' && <MonthlyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'overall' && <OverallTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'find' && <FindTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
        </div>

        <form onSubmit={e => e.preventDefault()} className={activeTab === 'bill' ? 'block' : 'hidden'}>

        {/* Master/Detail edit-scope — which half of the bill the toolbar's Edit button actually
            unlocks (see editScope/masterFieldsLocked/detailFieldsLocked above); the toolbar's own
            Edit button is unchanged, this just narrows what that click reaches. Two bare radios
            parked in the margin just left of the toolbar's New button, outside the card:
            absolute, so the 1200px card never moves or shrinks, and behind no width gate — the
            old gutter panel was gated on `2xl` and vanished entirely at 90% zoom (per the user,
            2026-09-03). Always enabled so a
            scope can be picked before Edit is even clicked (per the user, 2026-08-31). */}
        {/* Banner Messages */}
        {/* Floated into the right-hand gutter, not rendered inline: a message used to push the
            toolbar and card down under the cursor mid-click (per the user, 2026-08-31). */}
        <PageToasts
          error={lookupError || errorMsg}
          success={successMsg}
          onDismissError={() => { setLookupError(''); setErrorMsg(''); }}
          onDismissSuccess={() => setSuccessMsg('')}
        />


        {/* Toolbar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          {/* Icon-over-label toolbar buttons, per System_architecture/pages_design.md §1 — small
              square buttons (`.toolbar-btn`), colored icon on top, tiny bold label underneath,
              packed tightly in one strip, dividers between logical groups. Every action always
              renders — only `disabled` changes per state, never whole groups mounting/unmounting.
              Icon color signals the action's nature (not the button background): emerald =
              create/confirm, rose = delete/destructive, sky = edit, blue = save, slate = cancel/
              neutral, amber = navigation. */}
          <div className="flex items-center flex-nowrap overflow-x-auto gap-2">
          <DocumentToolbar
            newAction={{ onClick: pressNew, disabled: browseFilter === 'posted', ref: newButtonRef }}
            remove={{
              onClick: handleDeleteAction,
              disabled: deletedPlaceholder != null || billId == null || currentBillIsPosted,
              title: 'Delete this whole bill — every article on it goes too (asks for your password)',
            }}
            editRow={{
              onClick: handleEditSelectedRow,
              disabled: selectedIndex == null || editingIndex != null || isViewMode || currentBillIsPosted || (mode === 'edit' && editScope !== 'detail'),
              title: 'Edit selected article',
            }}
            edit={{ onClick: handleEditCurrentBill, disabled: deletedPlaceholder != null || mode !== 'view' || billId == null || currentBillIsPosted }}
            save={{ onClick: () => handleSave(false), disabled: deletedPlaceholder != null || mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded, title: 'Save — keep editing this bill' }}
            done={{ onClick: () => handleSave(true), submit: true, disabled: deletedPlaceholder != null || mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded, title: 'Done — finish this bill, then Post it' }}
            cancel={{ onClick: () => setMode('view'), disabled: mode !== 'edit', title: 'Cancel Edit' }}
            first={{ onClick: handleFirst, disabled: !canBrowse }}
            prev={{ onClick: handlePrev, disabled: !canNavPrevious }}
            next={{ onClick: handleNext, disabled: !canNavNext }}
            last={{ onClick: handleLast, disabled: !canBrowse }}
            print={{ onClick: () => setIsPrintingSingle(true), disabled: deletedPlaceholder != null || mode !== 'view' || billId == null }}
            find={{ onClick: () => setIsFindOpen(true) }}
            unpost={{ onClick: handleUnpostCurrentBill, disabled: deletedPlaceholder != null || mode !== 'view' || billId == null || !currentBillIsPosted, title: 'Un Post — move this posted bill back to drafts' }}
            post={{ onClick: async () => { await handlePostCurrentBill(); focusNewButton(); }, disabled: deletedPlaceholder != null || mode !== 'view' || billId == null || currentBillIsPosted }}
            exit={{ onClick: () => dispatch({ type: 'NAVIGATE', page: 'home' }) }}
            saveAndPost={{ onClick: async () => { await handleSaveAndPost(); focusNewButton(); }, disabled: deletedPlaceholder != null || mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded || currentBillIsPosted, title: 'Save & Post' }}
            postAll={{ onClick: async () => { await handlePostAll(); focusNewButton(); }, disabled: postAllBusy || browseFilter === 'posted' || unpostedBills.length === 0, title: `Post All (${unpostedBills.length})` }}
            pdf={{ onClick: () => setIsPrintingSingle(true), disabled: deletedPlaceholder != null || mode !== 'view' || billId == null, title: 'Export PDF' }}
            excel={{
              onClick: () => {
                const headers = ['Article', 'Packing', 'Cartons', 'Pairs', 'Rate', 'D%', 'D. Value', 'Total Value'];
                const rows = items.map(it => [it.label, it.packing, formatCartons(it.cartons), it.pairs, it.rate, it.discountPercent, it.discountValue, it.value]);
                exportRowsToExcel(`sale-bill-${billNo || billId}`, headers, rows);
              },
              disabled: deletedPlaceholder != null || mode !== 'view' || billId == null,
              title: 'Export Excel',
            }}
          />

          {/* Post All result — a run can post 18 of 20 bills, and the two that failed are the
              whole point of the message, so it stays on screen until dismissed. */}
          {postAllResult && (
            <div className="w-full mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}>
              <p className="font-semibold text-slate-700">
                {postAllResult.posted.length} of {postAllResult.attempted} posted
                {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                <button type="button" onClick={() => setPostAllResult(null)} className="ml-2 text-slate-500 hover:text-slate-700 font-semibold">Dismiss</button>
              </p>
              {postAllResult.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {postAllResult.failed.map(f => (
                    <li key={f.draft_id} className="text-rose-700">
                      <span className="font-mono font-semibold">{f.bill_no || `#${f.draft_id}`}</span>
                      {' — '}{f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mode === 'edit' && (
            <div className="text-sm font-semibold text-slate-500 font-inter">
              Editing System Invoice: <span className="font-mono text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">{currentSystemNo ?? 'New'}</span>
            </div>
          )}

          </div>

          {/* Posted/Unposted — picks which list First/Prev./Next/Last page through. Unposted
              (default) = add/post new bills; Posted = browse already-posted ones (per the user,
              2026-08-30). */}
          <select
            value={browseFilter}
            onChange={e => handleBrowseFilterChange(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Which bills First/Pre./Next/Last page through: posted bills, or saved-but-unposted drafts."
          >
            <option value="unposted">Unposted ({unpostedBills.length})</option>
            <option value="posted">Posted ({postedBills.length})</option>
          </select>
        </div>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Centred directly under the toolbar rather than
            out in the page margin where it used to sit, so it reads as part of the same
            control strip as the Edit button it modifies (per the user, 2026-09-04). */}
        <EditScopeRadios name="sale-bill-edit-scope" value={editScope} onChange={setEditScope} />

        {/* Invoice Layout — height pinned to the remaining viewport space (see invoiceCardHeight
            above) and laid out as a flex column, so the item table below can flex-grow into
            whatever room that leaves and the footer lands at the bottom of the screen instead of
            wherever the old fixed-height table happened to end. Every other child here keeps its
            natural size (flex-shrink-0) — only the table wrapper is flex-1. */}
        <div
          ref={invoiceCardRef}
          className="card-white shadow-sm p-3 md:p-4 flex flex-col"
          data-edit-scope="detail"
          style={{ border: '1px solid var(--border-color)', background: '#ffffff', overflow: 'visible', height: invoiceCardHeight ?? undefined, position: 'relative' }}
        >
          {deletedPlaceholder != null && <DeletedDocumentOverlay systemNo={deletedPlaceholder} label="bill" />}

          {/* Print Title (Visible only when printing) */}
          <div className="hidden print:flex items-center justify-between mb-6 pb-4 border-b">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX WEARHOUSE</h1>
              <p className="text-xs font-inter uppercase tracking-widest text-slate-500">Footwear Wholesale Distribution</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-xl">SALE BILL</h2>
              <p className="text-sm font-inter text-slate-500">Status: {currentBillIsPosted ? 'Posted' : 'Unposted'}</p>
            </div>
          </div>

          {/* Master section — a CSS grid with explicit `gridArea` placement per field, so the
              VISUAL row/column a field sits in (matching the ref pic exactly) is independent of
              its position in the JSX/DOM. The ref pic is really TWO columns: a wide left region
              (3 equal columns — No./Date/Store, Customer code+name, Main A/C code+name, Remarks,
              Delivery code+name, Sub Cust.) and a narrow right column (Bill No./GP No./Bilty
              No./Adda Code, stacked). Every row uses the SAME 4-column template below, so labels
              and boxes line up in straight columns top to bottom exactly like the ref pic — that
              alignment is the whole reason this uses one grid instead of per-row flex rows.
              Keyboard flow (G-01's Enter-walk, a plain DOM-order walk) must go Date → Store →
              Customer → Remarks → Delivery → Sub Cust → Bill No. → GP No. → Bilty No. → Adda
              Code — an order that does NOT match these visual rows, so the JSX below is written
              in TAB order and each field is pinned to its ref-pic visual cell with `gridArea`.
              Always visible. */}
          <div
            className="shrink-0 grid gap-x-3 gap-y-1.5 mb-2 pb-2 border-b"
            data-edit-scope="master"
            style={{
              borderColor: 'var(--border-table)',
              gridTemplateColumns: '1fr 1fr 1fr 190px',
              gridTemplateAreas: `
                "sysno     date       store      billno"
                "custcode  custname   custname   gpno"
                "maincode  mainname   mainname   biltyno"
                "remarks   remarks    remarks     addacode"
                "delivcode delivname  delivname  ."
                "subcust   subcust    subcust    ."
              `
            }}
          >
            <div className="flex items-center gap-1.5" style={{ gridArea: 'date' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="date" ref={firstFieldRef} required
            value={date} disabled={isViewMode || masterFieldsLocked} onChange={e => setDate(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'store' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                From&gt;
              </label>
              {/* Typable — type a store name, or press Enter to search (same pattern as every
                  other lookup on this form; per the user, 2026-08-26). */}
              <div className="flex-1 relative">
                <input
                  ref={storeTriggerRef}
                  type="text"
                  data-field-nav="true"
                  disabled={isViewMode || masterFieldsLocked}
                  value={storeSearchText}
                  onChange={e => setStoreSearchText(e.target.value)}
                  onKeyDown={handleStoreTriggerKeyDown}
                  placeholder="Type a store name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || masterFieldsLocked}
                  onClick={openStoreModal}
                  title="Browse all stores"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={16} />
                </button>
                <SearchModal
                  isOpen={isStoreModalOpen}
                  title="Select Store"
                  options={storeOptions}
                  value={storeId}
                  onSelect={(val) => {
                    setStoreId(val);
                    setIsStoreModalOpen(false);
                    requestAnimationFrame(() => focusNextField(storeTriggerRef.current));
                  }}
                  onClose={() => setIsStoreModalOpen(false)}
                  searchPlaceholder="Search stores..."
                  initialSearch={storeModalSeed}
                />
              </div>
            </div>

            {/* Customer — the page's main "party" field, per pages_design.md §5: a SearchModal
                popup (big centered popup, whole list at once) instead of SearchableSelect's small
                anchored panel. Typable — type any substring of the name (e.g. "ahmad footwear")
                then Enter opens the modal seeded with it; Arrow Up/Down opens it blank. Customer
                Code auto-fills from the selection. */}
            <div className="flex items-center gap-1.5" style={{ gridArea: 'custname' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="flex-1 relative">
                <input
                  ref={customerTriggerRef}
                  type="text"
                  data-field-nav="true"
                  required
                  disabled={isViewMode || masterFieldsLocked}
                  value={customerSearchText}
                  onChange={e => setCustomerSearchText(e.target.value)}
                  onKeyDown={handleCustomerTriggerKeyDown}
                  placeholder="Type a customer name, or press Enter to search..."
                  className="soleria-input pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || masterFieldsLocked}
                  onClick={openCustomerModal}
                  title="Browse all customers"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={16} />
                </button>
                <SearchModal
                  isOpen={isCustomerModalOpen}
                  title="Select Customer"
                  options={customerOptions}
                  value={customerId}
                  onSelect={selectCustomer}
                  onClose={() => setIsCustomerModalOpen(false)}
                  searchPlaceholder="Search customer by name..."
                  initialSearch={customerModalSeed}
                />
                {selectedCustomer && selectedCustomer.ba_id == null && (
                  <p className="text-[10px] text-amber-600 mt-0.5 font-semibold">
                    This customer has no linked business account — the bill cannot be posted until Setup adds one.
                  </p>
                )}
              </div>
              {!isViewMode && (
                <button
                  type="button"
                  onClick={() => setIsAddCustomerOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102 shrink-0"
                >
                  <Plus size={11} className="text-blue-600" />
                  <span>New</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'custcode' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer
              </label>
              <input type="text" value={selectedCustomer?.account_code ?? ''} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>

            <div className="flex items-center gap-1.5" style={{ gridArea: 'remarks' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Remarks
              </label>
              <input type="text" value={remarks} disabled={isViewMode || masterFieldsLocked} onChange={e => setRemarks(e.target.value)} placeholder="Enter any sales remarks..." className="soleria-input soleria-input-compact" />
            </div>

            {/* Delivery: a typed code, "1" = SAME (direct) — anything else opens the Sub Cust.
                field for a custom destination. The middle box mirrors the ref-pic's auto-filled
                delivery NAME, read-only. */}
            <div className="flex items-center gap-1.5" style={{ gridArea: 'delivcode' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Delivery
              </label>
              <input
                type="text"
                value={deliveryCode}
                disabled={isViewMode || masterFieldsLocked}
                onChange={e => handleDeliveryCodeChange(e.target.value)}
                className="soleria-input soleria-input-compact"
              />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'delivname' }}>
              <input
                type="text"
                value={deliveryType === '1' ? 'SAME' : (subCustomers.find(sc => String(sc.sub_customer_id) === subCustomerId)?.name || '')}
                disabled
                className="soleria-input soleria-input-compact bg-emerald-50 text-emerald-700 font-semibold border-emerald-200"
              />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'subcust' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Sub Cust.
              </label>
              <div className="flex-1 relative">
                <input
                  ref={subCustTriggerRef}
                  type="text"
                  data-field-nav="true"
                  disabled={isViewMode || deliveryType === '1' || masterFieldsLocked}
                  value={subCustSearchText}
                  onChange={e => setSubCustSearchText(e.target.value)}
                  onKeyDown={handleSubCustTriggerKeyDown}
                  placeholder="Type a sub-customer name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || deliveryType === '1' || masterFieldsLocked}
                  onClick={openSubCustModal}
                  title="Browse all sub-customers"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={16} />
                </button>
                <SearchModal
                  isOpen={isSubCustModalOpen}
                  title="Select Sub-Customer"
                  options={subCustomerOptions}
                  value={subCustomerId}
                  onSelect={(val) => {
                    setSubCustomerId(val);
                    setIsSubCustModalOpen(false);
                    requestAnimationFrame(() => focusNextField(subCustTriggerRef.current));
                  }}
                  onClose={() => setIsSubCustModalOpen(false)}
                  searchPlaceholder="Search sub-customers..."
                  initialSearch={subCustModalSeed}
                />
              </div>
              {!isViewMode && deliveryType !== '1' && (
                <button
                  type="button"
                  onClick={() => setIsAddSubCustomerOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102 shrink-0"
                >
                  <Plus size={11} className="text-blue-600" />
                  <span>New</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5" style={{ gridArea: 'billno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Bill No. <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="text" required value={billNo} disabled={isViewMode || masterFieldsLocked} onChange={e => setBillNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'gpno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                GP No.
              </label>
              <input type="text" value={gpNo} disabled={isViewMode || masterFieldsLocked} onChange={e => setGpNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'biltyno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Bilty No.
              </label>
              <input type="text" value={biltyNo} disabled={isViewMode || masterFieldsLocked} onChange={e => setBiltyNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'addacode' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Adda Code
              </label>
              <div className="flex-1 relative">
                <input
                  ref={addaTriggerRef}
                  type="text"
                  data-field-nav="true"
                  disabled={isViewMode || masterFieldsLocked}
                  value={addaSearchText}
                  onChange={e => setAddaSearchText(e.target.value)}
                  onKeyDown={handleAddaTriggerKeyDown}
                  placeholder="Type an Adda name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || masterFieldsLocked}
                  onClick={openAddaModal}
                  title="Browse all Addas"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={16} />
                </button>
                <SearchModal
                  isOpen={isAddaModalOpen}
                  title="Select Adda"
                  options={addaOptions}
                  value={addaId}
                  onSelect={(val) => {
                    setAddaId(val);
                    setIsAddaModalOpen(false);
                    requestAnimationFrame(() => focusNextField(addaTriggerRef.current));
                  }}
                  onClose={() => setIsAddaModalOpen(false)}
                  searchPlaceholder="Search Adda..."
                  initialSearch={addaModalSeed}
                />
              </div>
            </div>

            {/* Main A/C: the customer's linked business account's PARENT chart account — purely
                informational, derived, never edited directly. Placed after Adda Code in DOM (it's
                excluded from the tab walk since both its inputs are disabled) so it doesn't
                interrupt the Enter sequence above, even though visually it's ref-pic's row 3. */}
            <div className="flex items-center gap-1.5" style={{ gridArea: 'maincode' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Main A/C
              </label>
              <input type="text" value={selectedMainAc?.ac_code ?? ''} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'mainname' }}>
              <input type="text" value={selectedMainAc?.ac_name ?? ''} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>

            {/* System No. — the auto-generated internal bill number. Before Save there's no real
                id yet, so this previews the number Save will actually assign (same pattern as
                Purchase's own System Bill No.) instead of just saying "Unsaved" — but only once
                New has actually been pressed (or effectively already has — `hasClickedNew`, per
                the user 2026-09-16): blank on a genuinely untouched page, not a live-updating
                preview nobody asked for yet. */}
            <div className="flex items-center gap-1.5" style={{ gridArea: 'sysno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                No. &gt;&gt;&gt;&gt;
              </label>
              <input type="text" value={currentSystemNo != null ? `#${currentSystemNo}` : hasClickedNew ? `#${nextSystemBillNo}` : ''} disabled className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200" />
            </div>
          </div>

          <>{/* Detail section — always rendered. */}
          {/* Stock Limit Warning Banner */}
          {hasStockExceeded && !isViewMode && (
            <div className="shrink-0 flex items-center justify-between p-2.5 bg-rose-50 border border-rose-300 text-rose-900 rounded-xl text-xs font-semibold mb-3 shadow-sm animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2.5">
                <AlertTriangle size={18} className="text-rose-600 shrink-0" />
                <div>
                  <span className="font-bold block text-sm text-rose-900">Stock Limit Exceeded!</span>
                  <span className="text-rose-700">Requested cartons exceed current stock in hand. Please adjust carton quantities to save or post this bill.</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-rose-200 text-rose-900 font-bold text-[11px] uppercase tracking-wider shrink-0">
                Save Disabled
              </span>
            </div>
          )}

          {/* Entry strip (ref-pic bound-record pattern) — Row 1: Product/Product Name/Packing/
              Stock In Hand. Row 2: Cartons/Pairs/Rate/D%/DV/Value. This is the ONE "current
              record" being typed; Enter on DV commits it into the table below (handleCommitEntryRow)
              and resets the strip. Clicking a table row loads it back in here for editing. */}
          {!isViewMode && (
          <div className="shrink-0 mb-2 p-2 rounded-lg border bg-slate-50/60" style={{ borderColor: 'var(--border-color)' }}>
            {/* Same 4-column template as the master grid above (wide left region + narrow right
                column) so Product's row lines up with Customer/Main A/C's columns, and
                Packing/Stock In Hand land in the same right-column position as Bill No./GP
                No./Bilty No./Adda Code. */}
            <div className="grid gap-x-3 gap-y-1.5 mb-1.5" style={{ gridTemplateColumns: '1fr 1fr 1fr 190px' }}>
              <div ref={entryProductCellRef} className="flex items-center gap-1.5">
                <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Product <span className="text-red-500 font-bold">*</span></label>
                <div className="flex-1">
                  {/* A real text input, not a button — type a full code/name or any substring,
                      then Enter opens the modal already filtered to matches (instead of opening
                      empty and typing inside it). Arrow Up/Down still open it too (unfiltered, or
                      filtered by whatever's already typed). */}
                  <input
                    ref={productTriggerRef}
                    type="text"
                    required
                    disabled={detailFieldsLocked}
                    value={productSearchText}
                    onChange={e => setProductSearchText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        e.stopPropagation();
                        const direct = e.key === 'Enter' ? findDirectMatch(productOptions, productSearchText) : null;
                        if (direct) {
                          handleEntryArticleChange(direct);
                          requestAnimationFrame(() => focusNextField(productTriggerRef.current));
                          return;
                        }
                        setIsProductModalOpen(true);
                      }
                    }}
                    placeholder="Type article code or name..."
                    className="soleria-input soleria-input-compact"
                  />
                  <SearchModal
                    isOpen={isProductModalOpen}
                    title="Select Article"
                    options={productOptions}
                    value={entry.articleId != null ? String(entry.articleId) : ''}
                    initialSearch={productSearchText}
                    onSelect={(val) => {
                      handleEntryArticleChange(val);
                      setIsProductModalOpen(false);
                      requestAnimationFrame(() => focusNextField(productTriggerRef.current));
                    }}
                    onClose={() => setIsProductModalOpen(false)}
                    searchPlaceholder="Search articles by code or name..."
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <input type="text" value={entry.label} disabled placeholder="Product name" className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Color <span className="text-red-500 font-bold">*</span></label>
                <div className="flex-1">
                  <SearchableSelect
                    options={(entry.articleId != null ? variantsByArticle[entry.articleId] || [] : []).map(v => ({ value: String(v.variant_id), label: v.color }))}
                    value={entry.variantId != null ? String(entry.variantId) : ''}
                    onChange={handleEntryVariantChange}
                    placeholder="Color..."
                    searchPlaceholder="Search colors..."
                    disabled={entry.articleId == null || detailFieldsLocked}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Packing</label>
                  <input type="text" value={entry.packing || '-'} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500 text-center" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stock In Hand</label>
                  <input type="text" value={entryStockInHand ? `${formatCartons(entryStockInHand.cartons)} Ctn / ${entryStockInHand.pairs} Prs` : '-'} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500 text-center" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 items-end">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cartons <span className="text-red-500 font-bold">*</span></label>
                {/* Part cartons are real stock (per the user, 2026-09-02): one decimal place, so
                    0.5 / 1.5 / 10.5 are all enterable. parseFloat, not parseInt — parseInt('0.5')
                    is 0, which silently ate the decimal the operator typed. */}
                <CartonsInput
                  value={entry.cartons}
                  min={0.1}
                  required
                  disabled={detailFieldsLocked}
                  onChange={v => updateEntryNumericField('cartons', v)}
                  className={`soleria-input soleria-input-compact text-center font-mono ${entryStockCheck ? 'border-2 border-red-500 bg-rose-50 text-red-700 font-bold' : ''}`}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pairs</label>
                <input type="text" value={entry.pairs || '-'} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500 text-center" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Rate <span className="text-red-500 font-bold">*</span></label>
                <input
                  type="number"
                  required
                  value={entry.rate || ''}
                  min={0}
                  disabled={detailFieldsLocked}
                  onChange={e => updateEntryNumericField('rate', parseInt(e.target.value) || 0)}
                  className="soleria-input soleria-input-compact text-right font-mono"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">D%</label>
                <input
                  type="number"
                  value={entry.discountPercent || ''}
                  min={0}
                  max={100}
                  disabled={detailFieldsLocked}
                  onChange={e => updateEntryNumericField('discountPercent', parseFloat(e.target.value) || 0)}
                  className="soleria-input soleria-input-compact text-center font-mono"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">DV</label>
                <input
                  type="number"
                  value={entry.discountValue || ''}
                  min={0}
                  disabled={detailFieldsLocked}
                  onChange={e => updateEntryNumericField('discountValue', parseFloat(e.target.value) || 0)}
                  onKeyDown={handleEntryLastFieldKeyDown}
                  className="soleria-input soleria-input-compact text-right font-mono"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Value</label>
                <input type="text" value={formatCurrency(entry.value)} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-600 text-right font-semibold" />
              </div>
            </div>
            {entryStockCheck && (
              <div className="mt-1.5 text-[11px] font-bold text-red-600 flex items-center gap-1">
                <AlertTriangle size={12} className="shrink-0" />
                <span>Exceeds Stock! {entryStockCheck.requestedPairs} pairs requested, only {entryStockCheck.availablePairs} in hand — row will not be added.</span>
              </div>
            )}
            {/* Editing banner, per pages_design.md §4 — the row stays visible (highlighted) in
                the grid below the whole time it's being edited, not pulled out; Cancel here
                discards the in-progress edit, same as the toolbar's Cancel Edit for the bill as
                a whole. Deleting this row is the toolbar's own Delete button, not a control here. */}
            {editingIndex != null && (
              <div className="mt-1.5 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                <span className="text-blue-700 font-semibold">Editing an existing article — Update to save, or cancel.</span>
                <button type="button" onClick={() => { setEditingIndex(null); setEntry(newUiItem()); }} className="text-blue-600 hover:text-blue-800 font-semibold underline">
                  Cancel
                </button>
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <button type="button" onClick={handleCommitEntryRow} disabled={detailFieldsLocked} className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] disabled:opacity-40 disabled:cursor-not-allowed">
                {editingIndex != null ? 'Update Row' : 'Add Row'}
              </button>
            </div>
          </div>
          )}

          {/* Committed line items — read-only list, matching ref-pic's columns exactly. Click a
              row to load it back into the entry strip above for editing (password-gated first if
              the bill is already posted — see handleRowClick). No per-row delete button, per
              pages_design.md §4 — deleting a line item is the toolbar's own Delete button,
              enabled only while a row is selected here. */}
          <div className="flex-1 min-h-0 mb-2 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  {/* G-05 (changes-14-09-26.md, 2026-09-15): narrow gutter for the ▶ row pointer —
                      unlabeled, matching the ref pic (ref-pics/batch2/jv2.0.jpeg). */}
                  <th className="sticky top-0 z-10 bg-slate-50 p-1" style={{ width: '18px' }} />
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ minWidth: '190px' }}>Product Name</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Cartons</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '100px' }}>Rate</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '130px' }}>Value</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '84px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr
                    key={item.uid}
                    ref={el => { rowRefs.current[idx] = el; }}
                    onClick={() => {
                      // G-08: a click must produce no visible change — it only records which row
                      // the Delete/Edit Row toolbar buttons act on next. Inert entirely while
                      // another row is actually loaded for editing (see the file-level comment on
                      // `selectedIndex`).
                      if (editingIndex != null) return;
                      setSelectedIndex(prev => prev === idx ? null : idx);
                    }}
                    className={`border-b cursor-pointer hover:bg-slate-50/50 ${idx === editingIndex ? 'bg-blue-50' : ''}`}
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    {/* G-05: a pure position indicator — never a background/highlight, so it can
                        never be confused with G-08's edit highlight above. */}
                    <td className="p-1 text-center text-emerald-600" aria-hidden="true">
                      {idx === lastEnteredIndex && '▶'}
                    </td>
                    <td className="p-1 pl-3 font-semibold text-slate-800 text-[13px]">{item.label || 'N/A'}</td>
                    <td className="p-1 text-center font-mono text-sm text-slate-600">{item.packing || '-'}</td>
                    <td className="p-1 text-center font-mono text-sm text-slate-700">{formatCartons(item.cartons)}</td>
                    <td className="p-1 text-center font-mono text-sm font-semibold text-slate-700">{item.pairs || '-'}</td>
                    <td className="p-1 text-right font-mono text-sm text-slate-700">{item.rate.toLocaleString()}</td>
                    <td className="p-1 text-right font-mono font-semibold text-sm" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(item.value)}</td>
                    <td className="p-1 text-center whitespace-nowrap">
                      <RowActions
                        onEdit={() => handleRowClick(idx)}
                        onDelete={() => handleRemoveItemRow(idx)}
                        disabled={deletedPlaceholder != null || currentBillIsPosted || editingIndex != null || (mode === 'edit' && editScope !== 'detail')}
                        editTitle="Edit this article"
                        deleteTitle="Delete this article"
                        disabledTitle="Unpost and edit the document (Detail scope) to change its articles"
                      />
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-3 text-center text-xs text-slate-400">
                      No articles added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>

          {/* Bottom Section: Payment Due Date + ref-pic's flat totals row (Total Cartons | Total
              Pairs | Invoice Discount | Total Value | Rs.) — replaces the old dark "Calculations"
              box, which isn't in the ref pic; these are plain compact fields matching the rest of
              the page's field style. Pinned to the bottom of the screen by the item table's flex-1
              above (see invoiceCardHeight). */}
          <div className="shrink-0 flex flex-wrap items-end justify-between gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            <div className="flex flex-col gap-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Payment Due Date <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="date"
            value={dueDate} disabled={isViewMode || masterFieldsLocked} onChange={e => setDueDate(e.target.value)} className="soleria-input" style={{ fontSize: '13px', maxWidth: '220px' }} />
              <p className="text-[10px] text-slate-400 leading-tight">
                Blank = no fixed terms, no overdue alert.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Cartons</label>
                <input type="text" value={formatCartons(totalCartons)} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-center font-mono font-semibold" style={{ width: '90px' }} />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Pairs</label>
                <input type="text" value={totalPairs} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-center font-mono font-semibold" style={{ width: '90px' }} />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Invoice Discount</label>
                <input
                  type="number"
                  value={invoiceDiscount || ''}
                  disabled={isViewMode || masterFieldsLocked}
                  onChange={e => setInvoiceDiscount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="soleria-input soleria-input-compact text-right font-mono"
                  style={{ width: '110px' }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Value</label>
                <input type="text" value={formatCurrency(itemsTotalValue)} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-right font-mono font-semibold" style={{ width: '130px' }} />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Net Total</label>
                <input
                  type="text"
                  value={formatCurrency(finalTotalValue)}
                  disabled
                  className="soleria-input soleria-input-compact text-right font-mono font-bold"
                  // Light bar, not the dark navy fill — same fix as Reports Hub/Wage Run/Receipts/
                  // Expenses/Sale Return (per the user, 2026-09-03).
                  style={{ width: '140px', color: 'var(--brand-gold)', background: '#ffffff', borderColor: 'var(--border-color)' }}
                />
              </div>
            </div>
          </div>

        </div>
        </form>

      </div>

      {/* Find Bill Modal — jump to any posted or unposted bill by bill number or customer name */}
      {isFindOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">Find Bill</h3>
            <input
              type="text"
              value={findQuery}
              onChange={e => setFindQuery(e.target.value)}
              placeholder="Bill No. or customer name..."
              className="soleria-input w-full font-semibold mb-3"
              autoFocus
            />
            <ul className="max-h-72 overflow-y-auto border rounded-lg divide-y" style={{ borderColor: 'var(--border-color)' }}>
              {findResults.map(({ filter, row }) => (
                <li
                  key={`${filter}-${'bill_id' in row ? row.bill_id : row.draft_id}`}
                  onClick={() => handleFindSelect(filter, row)}
                  className="px-3 py-2 text-xs cursor-pointer hover:bg-amber-50/60 flex items-center justify-between gap-2"
                >
                  <span className="font-mono font-semibold text-slate-700">{row.bill_no || `#${row.system_no}`}</span>
                  <span className="text-slate-400 truncate">{customers.find(c => c.customer_id === row.customer_id)?.name || 'Unnamed Customer'}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${filter === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{filter}</span>
                </li>
              ))}
              {findQuery.trim() && findResults.length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-400 text-center">No matching bills.</li>
              )}
            </ul>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={closeFindBill}
                className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Sub-Customer Modal */}
      {isAddSubCustomerOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">
              Add New Sub-Customer
            </h3>

            <div className="mb-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Sub-Customer Name <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="text" required value={newSubCustomerName} onChange={e => setNewSubCustomerName(e.target.value)} placeholder="Enter sub-customer name..." className="soleria-input font-semibold" autoFocus />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Region <span className="text-red-500 font-bold">*</span>
                </label>
                <SearchableSelect
                  options={regionOptions}
                  value={newSubCustomerRegionId}
                  onChange={val => { setNewSubCustomerRegionId(val); setNewSubCustomerCityId(''); }}
                  placeholder="Select Region..."
                  searchPlaceholder="Search regions..."
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  City
                </label>
                <SearchableSelect
                  options={citiesInRegion(newSubCustomerRegionId)}
                  value={newSubCustomerCityId}
                  onChange={setNewSubCustomerCityId}
                  placeholder="Select City..."
                  searchPlaceholder="Search cities..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-sm font-semibold">
              <button
                type="button"
                onClick={closeAddSubCustomer}
                className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSubCustomer}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm"
              >
                Add Sub-Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Customer Modal */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <form onSubmit={handleCreateCustomer} className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">
              Add New Customer
            </h3>

            <div className="mb-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Customer Name <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="text" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} placeholder="Enter customer name..." className="soleria-input font-semibold" autoFocus required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Select Region <span className="text-red-500 font-bold">*</span>
                </label>
                <SearchableSelect
                  options={regionOptions}
                  value={newCustomerRegionId}
                  onChange={val => { setNewCustomerRegionId(val); setNewCustomerCityId(''); }}
                  placeholder="Select Region..."
                  searchPlaceholder="Search regions..."
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Select City
                </label>
                <SearchableSelect
                  options={citiesInRegion(newCustomerRegionId)}
                  value={newCustomerCityId}
                  onChange={setNewCustomerCityId}
                  placeholder="Select City..."
                  searchPlaceholder="Search cities..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-sm font-semibold">
              <button
                type="button"
                onClick={closeAddCustomer}
                className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-[#111c2a] text-[#B08D57] rounded-lg hover:opacity-90 transition-opacity">
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Security Password Protection Modal */}
      <PasswordPromptModal
        isOpen={isPasswordModalOpen}
        onClose={() => {
          setIsPasswordModalOpen(false);
          setPasswordActionType(null);
          pendingDeleteBillId.current = null;
        }}
        onSuccess={handlePasswordSuccess}
        title={
          passwordActionType === 'delete_unposted_bill'
            ? 'Authorization Required to Delete Bill'
            : 'Authorization Required to Update Bill'
        }
        subtitle={
          passwordActionType === 'delete_unposted_bill'
            ? `This deletes the WHOLE bill and every article on it — not a single row. It cannot be undone. Enter the password for user '${state.currentUsername || 'user'}' to confirm.`
            : `Please enter password for user '${state.currentUsername || 'user'}' to save changes to Bill #${billNo || currentSystemNo || ''}.`
        }
      />

      {/* Print/PDF preview — see renderBillPrintable above for why this replaced the old
          swap-the-whole-page-then-window.print() approach. */}
      <ReportPrintPreviewModal
        isOpen={isPrintingSingle}
        onClose={() => setIsPrintingSingle(false)}
        title={`Sale Invoice ${billNo ? `#${billNo}` : currentSystemNo != null ? `#${currentSystemNo}` : ''}`}
        orientation="portrait"
      >
        {renderBillPrintable()}
      </ReportPrintPreviewModal>
    </AppLayout>
  );
}
