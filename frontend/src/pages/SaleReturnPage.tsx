import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import WeeklyReturnTab from '@/components/WeeklyReturnTab';
import MonthlyReturnTab from '@/components/MonthlyReturnTab';
import OverallReturnTab from '@/components/OverallReturnTab';
import FindReturnTab from '@/components/FindReturnTab';
import { Plus, ChevronDown } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { formatDate, getTodayDate, toDateInputValue, formatCartons, cartonsProblem, pairsFor, nextSystemNoPreview, asNavEntries } from '@/lib/utils';
import { focusFirstField, focusNextField } from '@/lib/fieldNav';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal, { findDirectMatch } from '@/components/SearchModal';
import DocumentToolbar from '@/components/DocumentToolbar';
import RowActions from '@/components/RowActions';
import wentoxLogo from '@/assets/wentox_logo.png';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import PageToasts from '@/components/PageToasts';
import { usePersistentField, useClearPageDraft, useNewDocGate } from '@/hooks/usePersistentField';
import { useBrowseFilterFollowsDocument } from '@/hooks/useBrowseFilterFollowsDocument';
import { useLatestOnly } from '@/hooks/useLatestOnly';
import * as api from '@/lib/api';
import type {
  CustomerRow, SubCustomerRow, ProductRow, ProductVariantRow, StoreRow, AddaRow,
  SaleReturnRow, SaleReturnCreateInput, SaleReturnItemInput,
  DraftSaleReturnRow, ConfirmAllResult, DeletedNumberRow,
  RegionRow, CityRow, BusinessAccountRow, StockRow
} from '@/lib/api';
import EditScopeRadios from '@/components/EditScopeRadios';
import { useAutoEditScope } from '@/hooks/useAutoEditScope';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import CartonsInput from '@/components/CartonsInput';
import { getWindowParam } from '@/lib/windowParams';

interface UiItem {
  uid: string;
  articleId: number | null;
  variantId: number | null;
  label: string;
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
  // Rounded to paisa exactly as the backend does (saleReturnMath.js round2) — rounding to whole
  // rupees here made the screen's Value differ from what gets saved.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const gross = round2(pairs * item.rate);
  const discountValue = round2(gross * (item.discountPercent / 100));
  const value = Math.max(0, round2(gross - discountValue));
  return { ...item, pairs, discountValue, value };
}

export default function SaleReturnPage({ initialTab = 'return' }: { initialTab?: 'return' | 'weekly' | 'monthly' | 'overall' | 'find' }) {
  // New button + "cursor waits on New" (per the user, 2026-09-18): after a Post / Post All, and
  // whenever the form drops to the locked blank (useNewDocGate's awaitingNew), focus goes to New so
  // Enter starts the next document. Two frames, so a reset's own focus-first-field attempt (queued
  // first, and a no-op on the locked form) never wins. Declared first — Post handlers use it.
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const focusNewButton = () => requestAnimationFrame(() => requestAnimationFrame(() => newButtonRef.current?.focus()));
  const { state, dispatch } = useApp();

  // Seeded from the URL's own `tab` (openWindow's second argument) so a window opened straight at
  // the Find tab — e.g. from FindReturnTab's own "Show Print Preview", per the user, 2026-09-03 —
  // lands there instead of the default Return entry tab.
  const [activeTab, setActiveTab] = useState<'return' | 'weekly' | 'monthly' | 'overall' | 'find'>(() => (getWindowParam('tab') as 'return' | 'weekly' | 'monthly' | 'overall' | 'find') || initialTab);

  // ── Real lookup data ──
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  // "Main A/C" — the customer's linked business account's PARENT chart account, same readout as
  // Sale Bill's (per the user, 2026-09-28: Sale Return mirrors Sale Bill's layout exactly).
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [variantsByArticle, setVariantsByArticle] = useState<Record<number, ProductVariantRow[]>>({});
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
      if (stRes.ok) setStockRows(stRes.data);
      if (baRes.ok) setBusinessAccounts(baRes.data);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
  }, []);

  const refreshStock = useCallback(async () => {
    const res = await api.reports.stock();
    if (res.ok) setStockRows(res.data);
  }, []);

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

  // Mode: 'view' | 'edit' | 'new'. Persisted with the rest of the draft (2026-08-31) — a page
  // restored into 'view' has Save disabled, so the state it was left in has to survive too.
  const [mode, setMode] = usePersistentField<'view' | 'edit' | 'new'>('sale-return', 'mode', 'new');
  // Master/Detail edit-scope radio (left-side widget, per the user 2026-08-31): which half of the
  // form Edit actually unlocks. Only meaningful once Edit has already been clicked while unposted
  // — it narrows what THAT click reaches, it doesn't reopen the existing isPosted gate on Edit
  // itself. Always resettable/pickable even in view mode, so it can be pre-chosen before Edit.
  // Persisted, not plain useState: mode/svId/status already are, for the exact reason —
  // losing track of state across a page switch. editScope was the one piece left out, so
  // returning to an in-progress 'edit' draft always reset it to 'master', locking the
  // Detail half (entry strip + grid) shut even when that's what had been unlocked and typed
  // into — reported by the user (2026-09-04) as "all the buttons are disable except New".
  const [editScope, setEditScope] = usePersistentField<'master' | 'detail'>('sale-return', 'editScope', 'master');
  // Which half Edit (or New, for a line) has actually UNLOCKED — separate from the radio, which
  // only picks what New/Edit act on and can never unlock anything by itself (standard §6, ported
  // from the Journal Voucher 2026-10-06). null = nothing unlocked.
  const [editTarget, setEditTarget] = usePersistentField<'master' | 'detail' | null>('sale-return', 'editTarget', null);
  // Keeps the radios pointing at whichever half is being worked in — see the hook.
  const autoEditScope = useAutoEditScope(setEditScope);

  // Password Modal Protection State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordActionType, setPasswordActionType] = useState<'save_and_post' | 'post_return' | 'delete_unposted_return' | null>(null);

  // Draft persistence — see src/hooks/usePersistentField.ts. Only real in-progress entry data is
  // persisted; which EXISTING record is loaded (returnId/currentReturnIsPosted/mode) is
  // deliberately left as plain useState, same as StockVoucherPage/SaleBillPage.
  const clearSaleReturnDraft = useClearPageDraft('sale-return');
  // The posted/unposted/System No. rule — see useNewDocGate for the whole of it. hasSaleReturnDraft gates the
  // auto-open below (only genuine unsaved typing skips it); hasClickedNew gates the No. preview and
  // the awaitingNew lock, and only the New button/tab sets it (pressNew).
  const { hasRealDraftAtMount: hasSaleReturnDraft, hasClickedNew, setHasClickedNew, markNewClicked } =
    useNewDocGate('sale-return', ['customerId', 'billNo', 'items'], { emptiedEditCountsAsWork: true });

  // Form State
  //
  // returnId/currentReturnIsPosted are persisted alongside the field values, NOT plain useState —
  // see SaleBillPage's own comment for the full reasoning. Short version: leaving them out lost
  // track of WHICH record was on screen after a page switch, and the earlier "persist the id and
  // re-fetch on mount" attempt was worse still — it overwrote the user's unsaved edits with the
  // last-saved copy and reopened in 'view' mode, which disables Save.
  const [returnId, setReturnId] = usePersistentField<number | null>('sale-return', 'returnId', null);
  // The loaded record's own System No. — display-only, kept in step with returnId but never used
  // for API calls; those stay on returnId/draftId as before.
  const [currentSystemNo, setCurrentSystemNo] = usePersistentField<number | null>('sale-return', 'currentSystemNo', null);
  // Per the user, 2026-09-18: no System No. may be generated unless New was DELIBERATELY clicked.
  // Hiding the preview (hasClickedNew above) wasn't enough — a blank page reached any other way
  // (first open, after Post, Post All, a deleted return) could still be typed into and saved, and
  // the backend assigned it a number anyway. So such a page stays fully locked until New.
  const awaitingNew = mode === 'new' && currentSystemNo == null && !hasClickedNew;
  useEffect(() => { if (awaitingNew) focusNewButton(); }, [awaitingNew]);
  const [currentReturnIsPosted, setCurrentReturnIsPosted] = usePersistentField('sale-return', 'currentReturnIsPosted', false);
  const [date, setDate] = usePersistentField('sale-return', 'date', getTodayDate());
  const [storeId, setStoreId] = usePersistentField('sale-return', 'storeId', '');
  const [customerId, setCustomerId] = usePersistentField('sale-return', 'customerId', '');
  const [subCustomerId, setSubCustomerId] = usePersistentField('sale-return', 'subCustomerId', '');
  const [billNo, setBillNo] = usePersistentField('sale-return', 'billNo', '');
  const [gpNo, setGpNo] = usePersistentField('sale-return', 'gpNo', '');
  const [biltyNo, setBiltyNo] = usePersistentField('sale-return', 'biltyNo', '');
  const [addaId, setAddaId] = usePersistentField('sale-return', 'addaId', '');
  const [remarks, setRemarks] = usePersistentField('sale-return', 'remarks', '');
  const [invoiceDiscount, setInvoiceDiscount] = usePersistentField('sale-return', 'invoiceDiscount', 0);

  // Line items state
  const [items, setItems] = usePersistentField<UiItem[]>('sale-return', 'items', []);

  // Sale Bill's "Delivery" field: a typed code where "1" means SAME/direct and anything else
  // unlocks Sub Cust. (Delivery Agent). sale_returns has no delivery_type column — a return with no
  // sub_customer_id IS a SAME delivery — so this is derived on load and never saved on its own.
  const [deliveryType, setDeliveryType] = usePersistentField<'1' | 'custom'>('sale-return', 'deliveryType', '1');
  const [deliveryCode, setDeliveryCode] = usePersistentField('sale-return', 'deliveryCode', '1');
  const handleDeliveryCodeChange = (code: string) => {
    setDeliveryCode(code);
    const same = code.trim() === '1';
    setDeliveryType(same ? '1' : 'custom');
    if (same) setSubCustomerId('');
  };
  const applyDeliveryFromSubCustomer = (subCustId: number | null) => {
    setDeliveryType(subCustId != null ? 'custom' : '1');
    setDeliveryCode(subCustId != null ? '2' : '1');
  };
  // True only for a return created (first saved) during this sitting — posting one of those drops
  // straight to a fresh return for the next one, same as Sale Bill's createdInThisRun. Opening an
  // existing draft/return resets it, so posting an older one leaves it on screen.
  const createdInThisRun = useRef(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isPrintingSingle, setIsPrintingSingle] = useState(false);

  const selectedCustomer = useMemo(() => customers.find(c => c.customer_id === Number(customerId)), [customers, customerId]);

  const storeOptions = useMemo(
    () => stores.map(st => ({ value: String(st.store_id), label: st.name })),
    [stores]
  );
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

  const selectedMainAc = useMemo(() => {
    if (selectedCustomer?.ba_id == null) return null;
    return businessAccounts.find(b => b.ba_id === selectedCustomer.ba_id) ?? null;
  }, [businessAccounts, selectedCustomer]);

  // Customer — Sale Bill's typable SearchModal lookup (was a SearchableSelect dropdown here).
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const customerTriggerRef = useRef<HTMLInputElement>(null);
  const [customerSearchText, setCustomerSearchText] = useState('');
  const [customerModalSeed, setCustomerModalSeed] = useState('');
  useEffect(() => {
    const opt = customerOptions.find(o => o.value === customerId);
    setCustomerSearchText(opt?.label ?? selectedCustomer?.name ?? '');
  }, [customerId, customerOptions, selectedCustomer]);
  const openCustomerModal = () => { if (isViewMode) return; setCustomerModalSeed(''); setIsCustomerModalOpen(true); };
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
    setIsCustomerModalOpen(false);
    requestAnimationFrame(() => focusNextField(customerTriggerRef.current));
  }

  // Add new customer modal — same as Sale Bill's.
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

  // TO Store — typable <input> opening the same centered SearchModal popup as every other lookup
  // on this form (same pattern as Purchase's Vendor field / Sale Bill's Store field, 2026-08-26).
  const storeTriggerRef = useRef<HTMLInputElement>(null);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [storeSearchText, setStoreSearchText] = useState('');
  const [storeModalSeed, setStoreModalSeed] = useState('');
  useEffect(() => {
    const opt = storeOptions.find(o => o.value === storeId);
    setStoreSearchText(opt?.label ?? '');
  }, [storeId, storeOptions]);
  const openStoreModal = () => {
    if (isViewMode) return;
    setStoreModalSeed('');
    setIsStoreModalOpen(true);
  };
  // stopPropagation on every branch, not just preventDefault — otherwise this keydown keeps
  // bubbling past the trigger up to window-level listeners (AppLayout's own G-01 field-walk),
  // acting on it at the same time the modal opens. Same reasoning as SearchModal's own internal
  // keydown handling; applies to every one of this page's own typable trigger fields below too.
  function handleStoreTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openStoreModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setStoreModalSeed(storeSearchText);
      setIsStoreModalOpen(true);
    }
  }


  // Delivery Agent (Sub Customer) — same typable pattern, replacing SearchableSelect's rounded
  // dropdown (per the user, 2026-08-26: matched against SaleBillPage's own Sub Cust. field).
  const subCustTriggerRef = useRef<HTMLInputElement>(null);
  const [isSubCustModalOpen, setIsSubCustModalOpen] = useState(false);
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
  const openSubCustModal = () => {
    if (isViewMode || deliveryType === '1') return;
    setSubCustModalSeed('');
    setIsSubCustModalOpen(true);
  };
  function handleSubCustTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openSubCustModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setSubCustModalSeed(subCustSearchText);
      setIsSubCustModalOpen(true);
    }
  }

  // Transport Adda — same typable pattern, replacing SearchableSelect's rounded dropdown.
  const addaTriggerRef = useRef<HTMLInputElement>(null);
  const [isAddaModalOpen, setIsAddaModalOpen] = useState(false);
  const [addaSearchText, setAddaSearchText] = useState('');
  const [addaModalSeed, setAddaModalSeed] = useState('');
  const addaOptions = useMemo(() => [
    { value: '', label: 'Not set yet (fill in later)' },
    ...addas.map(ad => ({ value: String(ad.adda_id), label: ad.name })),
  ], [addas]);
  useEffect(() => {
    const opt = addaOptions.find(o => o.value === addaId);
    setAddaSearchText(opt?.label ?? '');
  }, [addaId, addaOptions]);
  const openAddaModal = () => {
    if (isViewMode) return;
    setAddaModalSeed('');
    setIsAddaModalOpen(true);
  };
  function handleAddaTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openAddaModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setAddaModalSeed(addaSearchText);
      setIsAddaModalOpen(true);
    }
  }

  // Every saved-unposted return now lives in draft_sale_returns — the real sale_returns table
  // strictly never holds an unposted document (same architecture change as Sale Bill). One list
  // replaces what used to be "Saved Drafts" — there's no meaningful distinction anymore between
  // an incomplete entry and a complete-but-unposted one.
  const [drafts, setDrafts] = useState<DraftSaleReturnRow[]>([]);

  const refreshDrafts = useCallback(async () => {
    const res = await api.draftSaleReturns.list();
    if (res.ok) setDrafts(res.data);
    return res.ok ? res.data : null;
  }, []);

  // G-06 (changes-14-09-26.md, 2026-09-15): zero unposted returns on open must land on a fresh
  // blank entry, not wherever the session that closed the window left the screen pointed.
  // Originally gated on `mode === 'view'`, which misses a real case reported by the user
  // (2026-09-16, found on SaleBillPage's own equivalent bug): an edit-on-a-posted-record flow can
  // leave `mode: 'edit'` while the loaded record is still posted, so `mode === 'view'` alone
  // under-triggers. `currentReturnIsPosted` (persisted) is the direct, unambiguous signal — true
  // iff an actual posted record is loaded, in EITHER 'view' or 'edit' mode; only `resetToNewReturn()` ever
  // sets it false, so it can never be true while there's genuine unsaved new-document work to
  // protect.
  useEffect(() => {
    refreshDrafts().then(data => {
      if (data && data.length === 0 && currentReturnIsPosted) resetToNewReturn();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshDrafts]);

  // Every Sale Return System No. permanently retired by a delete (migration 032) — merged into the
  // browse lists below so First/Prev/Next/Last can show "#N — Deleted" as an actual stop.
  const [deletedNumbers, setDeletedNumbers] = useState<DeletedNumberRow[]>([]);
  const refreshDeletedNumbers = useCallback(async () => {
    const res = await api.draftSaleReturns.listDeletedNumbers();
    if (res.ok) setDeletedNumbers(res.data);
  }, []);
  useEffect(() => { refreshDeletedNumbers(); }, [refreshDeletedNumbers]);


  const loadReturnRow = async (rowIn: SaleReturnRow) => {
    // list() rows never carry items (only get() does) — the tabs pass those straight through,
    // so re-fetch the full record whenever items are missing.
    let row = rowIn;
    if (!row.items) {
      const res = await api.saleReturns.get(row.return_id);
      if (!res.ok) {
        setErrorMsg('Failed to load return: ' + res.error.message);
        return;
      }
      row = res.data;
    }

    createdInThisRun.current = false;
    setEditScope('master');
    setEditTarget(null);
    setReturnId(row.return_id);
    setCurrentSystemNo(row.system_no);
    setCurrentReturnIsPosted(row.is_posted);
    setDate(toDateInputValue(row.return_date));
    setStoreId(row.store_id != null ? String(row.store_id) : '');
    setCustomerId(String(row.customer_id));
    setSubCustomerId(row.sub_customer_id != null ? String(row.sub_customer_id) : '');
    applyDeliveryFromSubCustomer(row.sub_customer_id ?? null);
    setBillNo(row.bill_no);
    setGpNo(row.gp_no || '');
    setBiltyNo(row.bilty_no || '');
    setAddaId(row.adda_id != null ? String(row.adda_id) : '');
    setRemarks(row.remarks || '');
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
    setEntry(newUiItem());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });
    setErrorMsg('');
  };

  // ── Record navigation: First/Pre./Next/Last + Posted/Unposted dropdown — same mechanism as
  // SaleBillPage. The dropdown is a REAL data filter: 'posted' pages through confirmed returns
  // (dbo.sale_returns), 'unposted' through saved-but-not-yet-posted drafts (dbo.draft_sale_returns).
  // See SaleBillPage's own comment for why this departs from pages_design.md §3.
  // Unposted is the default (per the user, 2026-08-30): that's the working mode you add and post
  // new returns from. Posted is purely a browse mode over already-posted returns (First/Prev./
  // Next/Last + Un Post).
  const [browseFilter, setBrowseFilter] = useState<'posted' | 'unposted'>('unposted');
  // Dropdown follows whatever document is on screen — see the hook for why.
  useBrowseFilterFollowsDocument(returnId, currentReturnIsPosted, setBrowseFilter);
  const [postedReturns, setPostedReturns] = useState<SaleReturnRow[]>([]);

  const refreshPostedReturns = useCallback(async () => {
    const res = await api.saleReturns.list();
    if (res.ok) setPostedReturns(res.data);
    return res.ok ? res.data : null;
  }, []);

  useEffect(() => { refreshPostedReturns(); }, [refreshPostedReturns]);

  // Sorted by system_no (creation order), not the shared list()'s own date-based ORDER BY — see
  // SaleBillPage.tsx's navPostedList for why (a backdated document's date can otherwise put it
  // next to an unrelated one when browsing, reported by the user, 2026-09-07).
  const navPostedList = useMemo(
    () => asNavEntries([...postedReturns].sort((a, b) => a.system_no - b.system_no)),
    [postedReturns],
  );
  const navUnpostedList = useMemo(
    () => asNavEntries([...drafts].sort((a, b) => a.system_no - b.system_no)),
    [drafts],
  );

  // Whichever list the dropdown selects — this is what the nav buttons page through.
  const navList = browseFilter === 'posted' ? navPostedList : navUnpostedList;

  // -1 when the return on screen isn't in the ACTIVE list (unsaved, or a draft while the dropdown
  // is on Posted and vice versa); the handlers treat that as "start from the beginning".
  const derivedNavIndex = useMemo(() => {
    if (returnId == null) return -1;
    return browseFilter === 'posted'
      ? (currentReturnIsPosted ? navPostedList.findIndex(e => e.kind === 'doc' && e.row.return_id === returnId) : -1)
      : (!currentReturnIsPosted ? navUnpostedList.findIndex(e => e.kind === 'doc' && e.row.draft_id === returnId) : -1);
  }, [returnId, currentReturnIsPosted, browseFilter, navPostedList, navUnpostedList]);
  const navIndex = derivedNavIndex;

  const canBrowse = navList.length > 0;
  const canNavPrevious = canBrowse && navIndex !== 0;
  const canNavNext = canBrowse && navIndex !== navList.length - 1;

  // Posted rows come from sale_returns, unposted ones from draft_sale_returns — each needs its
  // own loader. Both open read-only; Edit stays a separate deliberate click.
  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    const entry = navList[idx];
    if (browseFilter === 'posted') {
      await loadReturnRow(entry.row as SaleReturnRow);
      setMode('view');
    } else {
      await loadDraftIntoForm(entry.row as DraftSaleReturnRow, { mode: 'view' });
    }
  };

  const handleFirst = () => goToNavIndex(0);
  const handlePrev = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);
  const handleLast = () => goToNavIndex(navList.length - 1);

  // Switching the Posted/Unposted dropdown (per the user, 2026-08-30):
  // - To Unposted: load the most recently saved draft (or a blank New return if there isn't one),
  //   then focus New — Enter on it clicks New and lands on Date, ready to type the next return.
  // - To Posted: re-fetch and jump straight to the most recently posted return for browsing.
  // Queued via useLatestOnly: the page's own auto-open runs this same handler, and a choice made
  // while that is still loading must not be overwritten when it finishes (2026-09-30).
  const filterChanges = useLatestOnly();
  const handleBrowseFilterChange = (next: 'posted' | 'unposted', opts: { auto?: boolean } = {}) => {
    // The page's own auto-open never overrides a choice the user already made.
    if (opts.auto && filterChanges.hasRun()) return Promise.resolve(undefined);
    setBrowseFilter(next);
    return filterChanges.run(async () => {
      if (next === 'unposted') {
        // Re-fetch first, exactly like the Posted branch below — reading the list straight out
        // of state meant a draft posted or deleted since it was last loaded was still in it, so
        // switching to Unposted opened a "draft" that no longer exists (2026-09-04).
        const fresh = await refreshDrafts();
        const list = [...(fresh ?? drafts)].sort((a, b) => a.system_no - b.system_no);
        const latest = list[list.length - 1];
        const opened = latest ? await loadDraftIntoForm(latest, { mode: 'view' }) : false;
        if (!opened) resetToNewReturn();
        requestAnimationFrame(() => newButtonRef.current?.focus());
      } else {
        const fresh = await refreshPostedReturns();
        const list = [...(fresh ?? postedReturns)].sort((a, b) => a.system_no - b.system_no);
        const latest = list[list.length - 1];
        if (latest) { await loadReturnRow(latest); setMode('view'); }
      }
    });
  };

  // Toolbar's Find button — a quick jump to any return (posted or unposted) by bill number or
  // customer name, searched client-side over the already-loaded browse lists.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const closeFindReturn = () => { setIsFindOpen(false); setFindQuery(''); };
  // G-07 (changes-14-09-26.md): Escape closes the topmost dialog.
  useEscapeToClose(isFindOpen, closeFindReturn);
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = (r: { bill_no: string | null; customer_id: number }) =>
      (r.bill_no || '').toLowerCase().includes(q) ||
      (customers.find(c => c.customer_id === r.customer_id)?.name || '').toLowerCase().includes(q);
    const posted = postedReturns.filter(matches).map(row => ({ filter: 'posted' as const, row }));
    const unposted = drafts.filter(matches).map(row => ({ filter: 'unposted' as const, row }));
    return [...posted, ...unposted].slice(0, 30);
  }, [findQuery, postedReturns, drafts, customers]);

  const handleFindResultSelect = async (filter: 'posted' | 'unposted', row: SaleReturnRow | DraftSaleReturnRow) => {
    setIsFindOpen(false);
    setFindQuery('');
    if (filter === 'posted') {
      await loadReturnRow(row as SaleReturnRow);
      setMode('view');
    } else {
      await loadDraftIntoForm(row as DraftSaleReturnRow);
      setMode('view');
    }
  };

  const isNecessaryFieldsFilled = useMemo(() => {
    if (awaitingNew) return false;
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.variantId || it.cartons <= 0 || it.rate <= 0)) return false;
    return true;
  }, [awaitingNew, customerId, date, storeId, items]);

  // Preview of the Return No. a brand-new return will get. This number is now assigned once at
  // draft-save time and carried through posting unchanged (per the user, 2026-09-05) — a real SQL
  // Server SEQUENCE (dbo.seq_sale_return_no) is the actual source of truth server-side, so this is
  // a client-side estimate only (MAX across whatever's already loaded, +1). Always shown, from the
  // moment the page opens — an earlier round gated it behind pressing New, which the user reversed
  // (2026-08-31).
const nextSystemReturnNo = useMemo(
    () => nextSystemNoPreview(...drafts.map(d => d.system_no), ...postedReturns.map(r => r.system_no), ...deletedNumbers.map(d => d.system_no)),
    [drafts, postedReturns, deletedNumbers]
  );

  // G-01: auto-focus the first field (Date) whenever the return tab becomes the active view and
  // is editable — this page's entry area isn't wrapped in a <form>, so AppLayout's global
  // auto-focus mechanism (which only looks inside <form> elements) has nothing to find here.
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (activeTab === 'return' && mode !== 'view') {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [activeTab, mode]);

  // Report tabs' Open — posted returns can't be edited anywhere (per the user, 2026-09-28): the
  // return opens read-only on the Posted list, and Un Post is the way back to an editable draft.
  const handleOpenSpecificReturn = async (ret: SaleReturnRow) => {
    await loadReturnRow(ret);
    setBrowseFilter('posted');
    setActiveTab('return');
    setMode('view');
  };

  // Loads the target return, then opens the preview modal on it — see renderReturnPrintable above.
  const handlePrintSpecificReturn = async (ret: SaleReturnRow) => {
    await loadReturnRow(ret);
    setIsPrintingSingle(true);
  };

  // Initialize new return if mode is new and not set.
  //
  // Skipped entirely when this page mounted with a restored draft (usePersistentField): this
  // effect fires a beat AFTER mount, once `stores`/`addas` resolve, and handleNew() blanks every
  // field AND clears the stored draft — so without the guard, coming back to a half-typed return
  // wiped it a fraction of a second after it was restored (reported by the user, 2026-08-30).
  // Calculations
  const totalCartons = useMemo(() => items.reduce((sum, item) => sum + (item.cartons || 0), 0), [items]);
  const totalPairs = useMemo(() => items.reduce((sum, item) => sum + (item.pairs || 0), 0), [items]);
  const itemsTotalValue = useMemo(() => items.reduce((sum, item) => sum + (item.value || 0), 0), [items]);
  const finalTotalValue = useMemo(() => Math.max(0, itemsTotalValue - invoiceDiscount), [itemsTotalValue, invoiceDiscount]);

  // Toolbar Actions
  // With Detail scope selected on an already-open, unposted return, New means "add another line to
  // THIS return", not "abandon it and start over" — only Master scope (or no return open yet) gets
  // the full reset below. Same reset shape used after committing a line, since the outcome is
  // identical: an empty, focused entry row, return untouched.
  const handleNew = () => {
    // Detail + an unposted return on screen (saved, or new with articles typed) adds an article —
    // no Edit needed, header stays locked. Never wipes articles already typed (standard §6).
    const returnOnScreen = !awaitingNew && !currentReturnIsPosted && (returnId != null || items.length > 0);
    if (editScope === 'detail' && returnOnScreen) {
      // Only a SAVED return needs unlocking; a new one already has both halves open.
      if (returnId != null) {
        setMode('edit');
        setEditTarget('detail');
      }
      setEntry(newUiItem());
      setEditingIndex(null);
      setSelectedIndex(null);
      setErrorMsg('');
      requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
      return;
    }
    resetToNewReturn();
  };

  // A whole new, blank return. Everything that is not the New button itself (Post, Delete, the New
  // tab, an empty Unposted list…) resets through this, never through handleNew(), which with
  // Detail selected would add an article to the return still on screen instead.
  const resetToNewReturn = () => {
    // A blank document is an unposted one — back to the Unposted view (see useBrowseFilterFollowsDocument).
    setBrowseFilter('unposted');
    setMode('new');
    setHasClickedNew(false);
    createdInThisRun.current = false;
    setEditScope('master');
    setEditTarget(null);
    setReturnId(null);
    setCurrentSystemNo(null);
    setCurrentReturnIsPosted(false);
    setDate(getTodayDate());
    setStoreId(stores[0] ? String(stores[0].store_id) : '');
    setCustomerId('');
    setSubCustomerId('');
    setDeliveryType('1');
    setDeliveryCode('1');
    // Blank by default (per the user, 2026-08-26) — was auto-generated as "RET-1234", but this
    // field doubles as the manual lookup key against an original Sale Bill's own bill_no
    // so a random pre-filled value only got in the way of typing a real one.
    setBillNo('');
    setGpNo('');
    setBiltyNo('');
    // Blank, not the first adda (per the user, 2026-09-18): adda is optional, and a pre-filled one
    // reads as if it had been chosen. Same as Sale Bill's own handleNew.
    setAddaId('');
    setRemarks('');
    setInvoiceDiscount(0);
    setItems([]);
    setEntry(newUiItem());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);
    setErrorMsg('');
    clearSaleReturnDraft();
    // Explicit focus, not just the G-01 mode-change effect below: clicking New while already on
    // a blank/new return (mode is already 'new') doesn't change `mode`, so that effect's
    // dependency never fires and focus would otherwise stay wherever it was (mirrors the same fix
    // on SaleBillPage's own handleNew).
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };
  // New button / New tab — the only path that marks New as deliberately clicked (useNewDocGate).
  const pressNew = () => { handleNew(); markNewClicked(); };
  // The "New Return" tab always starts a whole new return, whatever the radio says (standard §9).
  const pressNewTab = () => { resetToNewReturn(); markNewClicked(); };
  // After posting a return created in this sitting: a fresh return, same working date (Sale Bill's
  // readyForNextBill).
  const readyForNextReturn = () => {
    const workingDate = date;
    resetToNewReturn();
    setDate(workingDate);
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  const buildPayload = (): SaleReturnCreateInput | null => {
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (!storeId) { setErrorMsg('Store is required.'); return null; }
    if (!customerId) { setErrorMsg('Customer is required.'); return null; }
    if (items.length === 0) { setErrorMsg('At least one product item is required.'); return null; }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.variantId) { setErrorMsg(`Article/color is required at row ${i + 1}.`); return null; }
      if (it.cartons <= 0) { setErrorMsg(`Cartons must be greater than 0 at row ${i + 1}.`); return null; }
      const rowCartonsIssue = cartonsProblem(it.cartons, it.packing);
      if (rowCartonsIssue) { setErrorMsg(`Row ${i + 1}: ${rowCartonsIssue}`); return null; }
      if (it.rate <= 0) { setErrorMsg(`Rate must be greater than 0 at row ${i + 1}.`); return null; }
    }

    const itemsPayload: SaleReturnItemInput[] = items.map(it => ({
      variant_id: it.variantId!,
      cartons: it.cartons,
      rate: it.rate,
      discount_percent: it.discountPercent
    }));

    return {
      customer_id: Number(customerId),
      sub_customer_id: deliveryType === 'custom' && subCustomerId ? Number(subCustomerId) : null,
      store_id: Number(storeId),
      return_date: date,
      bill_no: billNo,
      gp_no: gpNo,
      bilty_no: biltyNo,
      // Blank Adda must go as no value, not Number('') = 0 — 0 violates FK_draft_sale_returns_adda.
      adda_id: addaId ? Number(addaId) : undefined,
      remarks: remarks || undefined,
      invoice_discount: invoiceDiscount,
      items: itemsPayload
    };
  };

  // Whichever return is on screen, `returnId`/`currentReturnIsPosted` route to one of two
  // entirely different tables now: a POSTED document is a real sale_returns row (returnId =
  // return_id); anything else is a draft_sale_return row (returnId = draft_id) — the real table
  // strictly never holds an unposted document. Only drafts are ever saved from this form.

  // `finalize` decides what the form does AFTER a successful save, and nothing else:
  //   true  ("Done")  -> lock to view mode; the return stays fully on screen and Post lights up.
  //   false ("Save")  -> stay editable so more articles can be added to the SAME return.
  // Mirrors SaleBillPage's own executeSave — see its comment for why the non-finalize path flips
  // mode to 'edit' rather than leaving it 'new' (otherwise the next Save creates a duplicate).
  const executeSave = async (finalize: boolean = true): Promise<SaleReturnRow | DraftSaleReturnRow | null> => {
    // Backstop for the awaitingNew lock — every save path funnels through here.
    if (awaitingNew) { setErrorMsg('Click New to start a return first.'); return null; }
    const payload = buildPayload();
    if (!payload) return null;

    // Posted returns can't be edited (per the user, 2026-09-28) — Un Post first. The toolbar's
    // Edit is already disabled for them; this is the backstop.
    if (currentReturnIsPosted) { setErrorMsg('A posted return can\'t be edited — Un Post it first.'); return null; }

    // Every other save — a brand-new return, or editing one that's still a draft — goes through
    // the draft table now (draftSaleReturns.service.js), not sale_returns directly.
    // Keyed on returnId, not `mode === 'edit'` — Save on a NEW return now stays in 'new' mode
    // (both halves open), and the next Save must update that same draft, never create a second.
    const wasNew = returnId == null;
    const result = !wasNew
      ? await api.draftSaleReturns.update(returnId, payload)
      : await api.draftSaleReturns.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save return: ' + result.error.message);
      return null;
    }

    setReturnId(result.data.draft_id);
    setCurrentSystemNo(result.data.system_no);
    setCurrentReturnIsPosted(false);
    setSuccessMsg(wasNew ? 'New sale return saved successfully.' : 'Sale return updated successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    // Done finishes (read-only, nothing unlocked); Save keeps whatever is open as it is.
    if (finalize) { setMode('view'); setEditTarget(null); }
    setErrorMsg('');
    if (wasNew) { createdInThisRun.current = true; clearSaleReturnDraft(); }
    refreshDrafts();
    refreshStock();
    return result.data;
  };

  // `finalize=false` is "Save" — persist and stay editable, so more articles can go onto the same
  // return. `finalize=true` is "Done" — persist and lock to view mode, where the return stays
  // fully on screen (every article still listed) and Post becomes available.
  //
  // Done used to be wired to handleSaveAndPost, i.e. it saved AND posted in a single click, so
  // there was never a chance to review the finished return before it was committed. Posting is
  // its own deliberate step now, matching Sale Bill (per the user, 2026-08-27).
  const handleSave = (finalize: boolean = true) => {
    // Drafts only — posted returns aren't editable, so no password is ever needed to save.
    executeSave(finalize);
  };

  // (handleSaveAndPost removed 2026-08-27: the Done button was its only caller, and Done now saves
  // WITHOUT posting so the finished return can be reviewed first — posting is handlePostCurrentReturn
  // below, a separate deliberate click, same as Sale Bill.)

  const handlePostCurrentReturn = async () => {
    if (returnId == null) return;
    const postedBillNo = billNo;
    const res = await api.draftSaleReturns.confirm(returnId);
    if (!res.ok) {
      setErrorMsg('Failed to post return: ' + res.error.message);
    } else {
      setReturnId(res.data.return_id);
      setCurrentSystemNo(res.data.system_no);
      setCurrentReturnIsPosted(true);
      refreshDrafts();
      refreshPostedReturns();
      // Post always clears for the next return, keeping the date (standard §8, 2026-10-06).
      setSuccessMsg(`Return ${postedBillNo || `#${res.data.system_no}`} posted. Ready for the next one.`);
      readyForNextReturn();
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  // Save & Post in one click — same as Sale Bill's.
  const saveAndPost = async () => {
    const saved = await executeSave();
    if (saved && 'draft_id' in saved) {
      const postRes = await api.draftSaleReturns.confirm(saved.draft_id);
      if (!postRes.ok) {
        setErrorMsg('Return was saved, but posting failed: ' + postRes.error.message);
      } else {
        setReturnId(postRes.data.return_id);
        setCurrentSystemNo(postRes.data.system_no);
        setCurrentReturnIsPosted(true);
        setSuccessMsg(`Return ${postRes.data.bill_no} saved & posted. Ready for the next one.`);
        setTimeout(() => setSuccessMsg(''), 3000);
        refreshDrafts();
        refreshPostedReturns();
        readyForNextReturn(); // Post always clears (standard §8, 2026-10-06)
      }
    }
  };
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

  // "Unpost" now moves the return back to being a draft — the real sale_returns table strictly
  // never holds an unposted document. The form now points at a different id (the new draft's).
  const handleUnpostCurrentReturn = async () => {
    if (returnId == null) return;
    const res = await api.saleReturns.unconfirm(returnId);
    if (!res.ok) {
      setErrorMsg('Failed to unpost return: ' + res.error.message);
      return;
    }
    setReturnId(res.data.draft_id);
    setCurrentSystemNo(res.data.system_no);
    setCurrentReturnIsPosted(false);
    // Lands read-only (standard §6): New adds an article from view mode by itself, so Un Post no
    // longer has to pre-unlock anything.
    setMode('view');
    setEditTarget(null);
    setSuccessMsg('Return unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshDrafts();
    refreshPostedReturns();
    // It's a draft again now, so the window follows it back to the Unposted view (per the user,
    // 2026-08-30) rather than staying on Posted looking at a return that no longer belongs there.
    setBrowseFilter('unposted');
  };

  // Entering edit mode never needs its own password prompt anymore — Save (handleSave,
  // mode==='edit') already asks for one before the update actually goes through, so gating entry
  // into edit mode too meant asking twice for one edit (reported by the user for both this
  // button and the report tabs).
  // Edit — lands focus on the first field of whichever scope is picked (per the user, 2026-08-31).
  // The toolbar's Edit: Master unlocks the header only; Detail edits the selected article (same
  // job as Edit Row and the row's ✏). Live while already editing — it is the only way to move the
  // unlock to the other half (standard §6).
  const handleEditCurrentReturn = () => {
    if (returnId == null || currentReturnIsPosted) return;
    if (editScope === 'detail') {
      if (selectedIndex == null) { setErrorMsg('Click the article you want to edit first, then press Edit.'); return; }
      handleRowClick(selectedIndex);
      return;
    }
    setMode('edit');
    setEditTarget('master');
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  // Cancel — drops unsaved edits and reloads the saved draft, read-only (standard §6).
  const handleCancelEdit = async () => {
    if (returnId == null) { resetToNewReturn(); return; }
    const res = await api.draftSaleReturns.get(returnId);
    if (!res.ok) { setErrorMsg('Failed to reload return: ' + res.error.message); return; }
    await loadDraftIntoForm(res.data, { mode: 'view' });
    setEditTarget(null);
  };

  // Repairs the fields a restored draft can come back missing — same bug as SaleBillPage's own
  // storeId repair (see its comment for the full reasoning): handleNew() picks these defaults
  // alongside clearSaleReturnDraft(), so usePersistentField's suppression window swallows the
  // write and nothing touches them again to trigger a later one. Store is required, so losing it
  // greys out Save/Done on a return that otherwise looks complete. Adda is NOT repaired any more:
  // it defaults to blank now (2026-09-18), so blank is its correct restored value.
  //
  // Gated on there actually having been a draft at mount, so a genuinely fresh page still goes
  // through handleNew() without writing a draft it doesn't need.
  useEffect(() => {
    if (!hasSaleReturnDraft) return;
    if (!storeId && stores.length > 0) setStoreId(String(stores[0].store_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSaleReturnDraft, storeId, stores, addaId, addas]);

  const pendingDeleteReturnId = useRef<number | null>(null);
  // True when the whole-return delete was reached by deleting the LAST article — only changes the
  // prompt's wording.
  const [emptyingViaLastRow, setEmptyingViaLastRow] = useState(false);

  // Toolbar's Delete — the currently-open UNPOSTED return only (mirrors SaleBillPage's own
  // Delete); a posted return can't be deleted from here at all (disabled — see the button).
  const handleDeleteCurrentReturn = () => {
    if (returnId == null || currentReturnIsPosted) return;
    pendingDeleteReturnId.current = returnId;
    setPasswordActionType('delete_unposted_return');
    setIsPasswordModalOpen(true);
  };

  const handlePasswordSuccess = async (password: string) => {
    setIsPasswordModalOpen(false);
    setEmptyingViaLastRow(false);
    if (passwordActionType === 'delete_unposted_return') {
      const targetId = pendingDeleteReturnId.current;
      pendingDeleteReturnId.current = null;
      if (targetId != null) {
        const res = await api.draftSaleReturns.remove(targetId, password);
        if (!res.ok) {
          setErrorMsg('Failed to delete return: ' + res.error.message);
        } else {
          setSuccessMsg('Return deleted successfully.');
          setTimeout(() => setSuccessMsg(''), 3000);
          if (returnId === targetId && !currentReturnIsPosted) resetToNewReturn();
          refreshDrafts();
          refreshDeletedNumbers();
        }
      }
    }
    setPasswordActionType(null);
  };

  // handleSaveDraft removed along with Save Draft button
  /*
  const handleSaveDraft = async () => {
    ...
  };
  */

  // Pending Posting sidebar (every draft — no password to open/edit, same convention drafts
  // always had; only editing an already-POSTED return is password-gated).
  const [postAllDraftsBusy, setPostAllDraftsBusy] = useState(false);
  const [postAllDraftsResult, setPostAllDraftsResult] = useState<ConfirmAllResult | null>(null);

  // `opts.mode` lets the nav buttons open a draft READ-ONLY while browsing (look-then-decide),
  // while every other caller keeps the original edit-on-open behaviour. Mirrors SaleBillPage's
  // own loadDraftIntoForm signature.
  const loadDraftIntoForm = async (draftIn: DraftSaleReturnRow, opts: { mode?: 'edit' | 'view' } = {}) => {
    // list()/find-search rows never carry `.items` (only get()/create()/update() do — see
    // DraftSaleReturnRow's own comment) — browsing/switching to one of those rows was loading the
    // form with an empty article grid (reported by the user, 2026-08-30). Re-fetch the full draft
    // whenever it's missing rather than trusting whatever was passed in.
    let draft = draftIn;
    if (!draft.items) {
      const res = await api.draftSaleReturns.get(draft.draft_id);
      // A failed re-fetch used to fall through and render `draftIn` anyway — stale list data
      // for a draft that no longer exists, since posting one DELETES it and turns it into a
      // posted return. Reported on Sale Bill by the user (2026-09-04) as Unposted "still showing
      // me the posted bill"; same shape here. Say so and leave the form alone instead.
      if (!res.ok) {
        setErrorMsg('That draft no longer exists — it may have been posted or deleted.');
        return false;
      }
      draft = res.data;
    }
    // Opening a different record must not carry over a stale scope from the last edit.
    createdInThisRun.current = false;
    setEditScope('master');
    setReturnId(draft.draft_id);
    setCurrentSystemNo(draft.system_no);
    setCurrentReturnIsPosted(false);
    setDate(toDateInputValue(draft.return_date));
    setStoreId(draft.store_id != null ? String(draft.store_id) : '');
    setCustomerId(String(draft.customer_id));
    setSubCustomerId(draft.sub_customer_id != null ? String(draft.sub_customer_id) : '');
    applyDeliveryFromSubCustomer(draft.sub_customer_id ?? null);
    setBillNo(draft.bill_no || '');
    setGpNo(draft.gp_no || '');
    setBiltyNo(draft.bilty_no || '');
    setAddaId(draft.adda_id != null ? String(draft.adda_id) : '');
    setRemarks(draft.remarks || '');
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
    setEntry(newUiItem());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });

    setEditTarget(null);
    setMode(opts.mode ?? 'edit');
    setErrorMsg('');
    return true;
  };




  // Post All — every draft awaiting posting, in one action, via the real backend batch endpoint
  // (draftSaleReturns.confirmAll — mirrors draftSaleBills.confirmAll).
  const handlePostAllDrafts = async () => {
    setPostAllDraftsBusy(true);
    setPostAllDraftsResult(null);
    const res = await api.draftSaleReturns.confirmAll();
    setPostAllDraftsBusy(false);

    if (!res.ok) {
      setErrorMsg('Failed to post drafts: ' + res.error.message);
      return;
    }
    setPostAllDraftsResult(res.data);
    if (res.data.failed.length === 0) {
      setSuccessMsg(`${res.data.posted.length} draft(s) posted.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    }
    // If the draft open on screen was one of the ones that posted, its draft row is gone —
    // drop back to a fresh form rather than leave the screen pointing at nothing.
    // Everything posted — nothing is left unposted to come back to, so reset to a fresh record
    // ready for the next one (keeping the date being worked on), matching Stock Voucher/Journal
    // Voucher's own Post All. Per the user (2026-09-04): Post All should "refresh the screen".
    // A partial run deliberately does NOT wipe the form — the failures still need looking at, so
    // there it only clears when the record on screen was itself one of the ones that posted.
    if (res.data.failed.length === 0) {
      const workingDate = date;
      resetToNewReturn();
      setDate(workingDate);
    } else if (returnId != null && !currentReturnIsPosted && res.data.posted.some(p => p.draft_id === returnId)) {
      resetToNewReturn();
    }
    // Both lists move: the drafts shrank AND the posted list grew. Only the drafts were being
    // refreshed here, leaving Posted stale until something else happened to reload it.
    refreshDrafts();
    refreshPostedReturns();
  };

  // Entry strip (ref-pic bound-record pattern, matching SaleBillPage exactly — per the user,
  // 2026-08-26: "set the article box like this in sale return page"): ONE editable article/color/
  // cartons/rate/discount row above the table, NOT one editable row per grid entry. Typing an
  // article, color, cartons, rate, D%/DV and pressing Enter on the last field (or the Add/Update
  // Row button) commits it into `items` — appending, or replacing `editingIndex` when a table row
  // was clicked to re-open it — then always clears the strip and refocuses Product for the next
  // article. Clicking a committed row loads it back into the strip for editing.
  const [entry, setEntry] = usePersistentField<UiItem>('sale-return', 'entry', newUiItem());
  // null while the strip is adding a brand-new row; the table index being replaced once a
  // committed row has been clicked back open for editing (see handleRowClick below).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // G-08 (changes-14-09-26.md, 2026-09-15): a click on a detail row must produce no visible change
  // at all — no edit load, no highlight. It only records which row Delete/Edit Row will act on
  // internally; `editingIndex` (the actually-loaded-for-editing row, and the only thing that
  // drives the blue highlight) is set exclusively by the Edit Row button now, never by a row click
  // directly. Cleared whenever `editingIndex` takes over so the two never point at different rows.
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
  // Unposted, so open the newest unposted return and park focus on New, exactly as picking
  // Unposted from the dropdown does (per the user, 2026-09-04). Falls back to a blank return when
  // there are none, which is what this effect used to do unconditionally. Runs once — the ref
  // keeps a later state change from re-opening a record over whatever is being typed by then.
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (hasSaleReturnDraft || didAutoOpenRef.current) return;
    // No mode/returnId check: a restored view of an older record must be replaced too (2026-09-18).
    // Waits for stores only. It also used to wait for a NON-EMPTY adda list — left over from when a
    // blank return defaulted to the first adda — so a shop with no addas never auto-opened at all
    // (found 2026-10-06). Adda is optional and blank by default now (2026-09-18).
    if (activeTab === 'return' && stores.length > 0) {
      didAutoOpenRef.current = true;
      handleBrowseFilterChange('unposted', { auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mode, returnId, stores]);

  // Product field's SearchModal — same pattern as Customer's: type the article code, Enter opens
  // a big centered popup to pick from.
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const productTriggerRef = useRef<HTMLInputElement>(null);
  // What's currently typed into the Product field itself — separate from `entry.articleId`/
  // `entry.label` (the committed selection) so the field can keep showing free-typed text right
  // up until Enter opens the modal with it as the initial filter.
  const [productSearchText, setProductSearchText] = useState('');
  // Code in both label and search text — the field shows the picked article's code, so typing a
  // code must find it (same fix as SaleBillPage, 2026-09-18).
  const productOptions = useMemo(
    () => products.map(p => ({ value: String(p.article_id), label: p.code ? `${p.code} — ${p.name}` : p.name, searchText: `${p.code ?? ''} ${p.name}` })),
    [products]
  );

  const handleEntryArticleChange = async (articleIdStr: string) => {
    const articleId = articleIdStr ? Number(articleIdStr) : null;
    const product = articleId != null ? products.find(p => p.article_id === articleId) : undefined;
    setEntry(prev => recalcItem({
      ...prev,
      articleId,
      variantId: null,
      label: product?.name || '',
      packing: product?.packing || 0,
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

  // Rate is never auto-filled — it's typed by hand on every line (per the user, 2026-09-28:
  // Sale Return is an independent voucher now, not priced from a Sale Bill or last-sold rate).
  const handleEntryVariantChange = (variantIdStr: string) => {
    if (entry.articleId == null) return;
    const variantId = variantIdStr ? Number(variantIdStr) : null;
    const variant = variantsByArticle[entry.articleId]?.find(v => v.variant_id === variantId);
    const product = products.find(p => p.article_id === entry.articleId);

    setEntry(prev => recalcItem({
      ...prev,
      variantId,
      label: variant ? `${product?.name || ''} — ${variant.color}` : (product?.name || ''),
      packing: variant?.packing ?? product?.packing ?? prev.packing
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

  // Commits the strip's current entry into the table — appends a new row, or overwrites
  // `editingIndex` when the strip is re-editing a row clicked open from the table. Linked-bill
  // mismatches refuse to commit at all, same as SaleBillPage's stock-limit rule.
  // Stock In Hand — current on-hand stock for the picked color, as Sale Bill shows it. Display only:
  // a return ADDS stock, so unlike Sale Bill there is no limit to check against it.
  const entryStockInHand = useMemo(() => {
    if (entry.variantId == null) return null;
    const row = stockRows.find(r => r.variant_id === entry.variantId);
    return row ? { cartons: row.cartons, pairs: row.total_pairs } : { cartons: 0, pairs: 0 };
  }, [entry.variantId, stockRows]);

  const handleCommitEntryRow = () => {
    if (entry.articleId == null || entry.variantId == null) {
      setErrorMsg('Select an article and color before adding the row.');
      return;
    }
    if (entry.cartons <= 0) { setErrorMsg('Cartons must be greater than 0.'); return; }
    // Mirrors the server's rule (backend/src/utils/cartons.js): cartons is DECIMAL(12,1), so a
    // finer figure would be rounded on save, and pairs stay whole because a pair is indivisible.
    const cartonsIssue = cartonsProblem(entry.cartons, entry.packing);
    if (cartonsIssue) { setErrorMsg(cartonsIssue); return; }
    if (entry.rate <= 0) { setErrorMsg('Rate must be greater than 0.'); return; }
    setErrorMsg('');
    // Same article/color already on the return — merge cartons into it instead of adding a
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
      setSuccessMsg(`${entry.label} was already on the return — cartons merged into that row.`);
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
  // returns are password-gated first (see handleRowClick); drafts and brand-new returns load
  // straight in, matching the convention that only a POSTED return's edits ever need a password.
  const loadRowIntoEntry = (idx: number) => {
    const row = items[idx];
    setEntry(row);
    setEditingIndex(idx);
    setSelectedIndex(null);
    if (row.articleId != null) fetchVariants(row.articleId);
    requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
  };

  // G-08: now the Edit Row toolbar button's handler, not the row's own onClick — a row click just
  // records `selectedIndex` (see the grid below), and this only runs once the user presses Edit Row.
  // Unlocks the Detail half of a SAVED return (a new one has both halves open already).
  const beginDetailEdit = () => {
    if (mode === 'new' && returnId == null) return;
    setMode('edit');
    setEditTarget('detail');
  };

  // THE one "edit this existing article" path — Edit (Detail), Edit Row and the row's ✏ all land
  // here, and it unlocks the Detail half itself (standard §6, superseding the 2026-08-31 rule that
  // the grid was inert while Master was picked).
  const handleRowClick = (idx: number) => {
    // A posted return is read-only — this used to offer a password prompt and then let the line
    // be edited in place, which is a second way in that the disabled Edit button already
    // refuses. Un Post is the only route (per the user, 2026-09-04).
    if (currentReturnIsPosted) return;
    beginDetailEdit();
    loadRowIntoEntry(idx);
  };

  const handleEditSelectedRow = () => {
    if (selectedIndex != null) handleRowClick(selectedIndex);
  };

  // A return always needs at least one row to type into once anything's committed, but the entry
  // strip itself can sit empty (unlike the old always-editable table) — so this only has to handle
  // actually removing a committed row, no more "clear the last one instead" special case.
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
    // ▶ moves to the row that takes the deleted one's place (or the new last row).
    const newLength = items.length - 1;
    if (lastEnteredIndex === idx) setLastEnteredIndex(newLength === 0 ? null : Math.min(idx, newLength - 1));
    else if (lastEnteredIndex != null && idx < lastEnteredIndex) setLastEnteredIndex(lastEnteredIndex - 1);
  };

  // A grid row's own Delete. Deleting the LAST article of a SAVED return deletes the whole return
  // (a return can't be empty) through the password prompt; otherwise the article goes on screen and
  // the return enters Detail edit, so the next Save/Done removes it for good (standard §13).
  const handleRowDelete = (idx: number) => {
    if (items.length === 1 && returnId != null && !currentReturnIsPosted) {
      setEmptyingViaLastRow(true);
      handleDeleteCurrentReturn();
      return;
    }
    beginDetailEdit();
    handleRemoveItemRow(idx);
  };

  // Delete is dual-purpose, same as SaleBillPage's own toolbar Delete: a row loaded for editing
  // (editingIndex) takes priority; otherwise a merely-clicked row (selectedIndex, G-08) is the
  // target; with neither, it's the whole-return delete (currently-open unposted return).
  // Toolbar Delete ALWAYS deletes the whole document now (per the user, 2026-09-20) — a single
  // row is the row's own Delete button in the grid.
  const handleDeleteAction = () => {
    handleDeleteCurrentReturn();
  };

  // Invoice card fills whatever vertical space is left in the viewport below it (mirrors
  // SaleBillPage) — the item table (flex-1 inside it) grows into that space and the Remarks/
  // Calculations footer lands at the screen's bottom edge, and the outer app window never scrolls
  // (only the table does). Measured via getBoundingClientRect rather than a CSS calc() of fixed
  // chrome heights, since the banners/toolbar above this card change height dynamically.
  const invoiceCardRef = useRef<HTMLDivElement>(null);
  const [invoiceCardHeight, setInvoiceCardHeight] = useState<number | null>(null);

  useEffect(() => {
    function recompute() {
      const el = invoiceCardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // AppLayout's <main> (the only scroll container in the app) adds 32px of its own
      // padding-bottom below whatever height we claim here — leaving that out would make the
      // card's bottom edge land 32px past the viewport and force <main> to scroll by that much.
      setInvoiceCardHeight(Math.max(360, window.innerHeight - top - 32));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [mode, lookupError, successMsg, errorMsg]);

  const isViewMode = mode === 'view';
  // Master/Detail edit-scope split (per the user, 2026-08-31): once Edit is already reachable
  // (isViewMode false, mode 'edit'), the radio narrows WHICH half actually unlocks — this does not
  // weaken the existing isPosted gate on the Edit button itself, it only adds a further split on
  // top of it. A brand-new return (mode 'new') is unaffected — everything stays editable there.
  const masterFieldsLocked = awaitingNew || (mode === 'edit' && editTarget !== 'master');
  const detailFieldsLocked = awaitingNew || (mode === 'edit' && editTarget !== 'detail');

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
    closeAddCustomer();
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

  const [isAddSubCustomerOpen, setIsAddSubCustomerOpen] = useState(false);
  const [newSubCustomerName, setNewSubCustomerName] = useState('');
  const [newSubCustomerRegionId, setNewSubCustomerRegionId] = useState('');
  const [newSubCustomerCityId, setNewSubCustomerCityId] = useState('');
  const closeAddSubCustomer = () => {
    setIsAddSubCustomerOpen(false);
    setNewSubCustomerName('');
    setNewSubCustomerRegionId('');
    setNewSubCustomerCityId('');
  };
  useEscapeToClose(isAddSubCustomerOpen, closeAddSubCustomer);

  // Same reasoning as SaleBillPage's own renderBillPrintable: this used to be the WHOLE page's
  // early-return content, swapped in then printed with a raw window.print() — no on-screen preview
  // at all, and specifically broken from Find & Update Return / Weekly / Monthly / Overall
  // (printing a different return than whatever was last open, with nothing shown first to confirm
  // it loaded the right one). Reported by the user, 2026-09-04, on Sale Bill's own Find tab; fixed
  // there and mirrored here since the two pages share the exact same print architecture.
  const renderReturnPrintable = () => {
    const customerObj = customers.find(c => c.customer_id === Number(customerId));
    const customerName = customerObj ? customerObj.name : (customerId || 'N/A');
    const storeObj = stores.find(s => s.store_id === Number(storeId));
    const storeName = storeObj ? storeObj.name : (storeId || 'N/A');
    const statusLabel = currentReturnIsPosted ? 'Posted' : 'Unposted';
    // Same dispatch readouts as Sale Bill's printed invoice.
    const addaObj = addas.find(a => a.adda_id === Number(addaId));
    const addaName = addaObj ? addaObj.name : 'N/A';
    const subCustomerObj = subCustomers.find(sc => sc.sub_customer_id === Number(subCustomerId));
    const deliveryDestination = deliveryType === 'custom'
      ? (subCustomerObj ? subCustomerObj.name : 'Custom Agent')
      : 'SAME (Direct)';

    return (
      <div className="excel-print-container" style={{
        display: 'block',
        margin: '0 auto',
        width: '210mm',
        padding: '10mm',
        backgroundColor: '#ffffff',
        color: '#000000',
        fontFamily: 'Calibri, Arial, sans-serif',
        boxSizing: 'border-box'
      }}>
        {/* Header Section */}
        <div className="excel-print-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '2px solid #000000',
          marginBottom: '15px',
          paddingBottom: '10px'
        }}>
          <div>
            <img
              src={wentoxLogo}
              alt="Wentox Logo"
              style={{ height: '90px', width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>SALE RETURN INVOICE</h2>
            <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>Status: {statusLabel}</p>
          </div>
        </div>

        {/* Excel Grid Info */}
        <div className="excel-grid-info" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          border: '1px solid #000000',
          marginBottom: '15px'
        }}>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>System ID</label>
            <span>{currentSystemNo ?? 'Unsaved'}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Date</label>
            <span>{formatDate(date)}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>TO Store</label>
            <span>{storeName}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Manual Invoice No.</label>
            <span>{billNo}</span>
          </div>

          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Customer Name</label>
            <span>{customerName}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Delivery Destination</label>
            <span>{deliveryDestination}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Transport Adda</label>
            <span>{addaName}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Gate Pass (GP) No.</label>
            <span>{gpNo || 'N/A'}</span>
          </div>

          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Bilty No.</label>
            <span>{biltyNo || 'N/A'}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px', gridColumn: 'span 3' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Remarks</label>
            <span>{remarks || 'N/A'}</span>
          </div>
        </div>

        {/* Excel Items Table */}
        <table className="excel-print-table" style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginBottom: '15px'
        }}>
          <thead>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '40%' }}>Returned Article Description</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '8%' }}>Packing</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Cartons</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Pairs</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Rate</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Discount</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '15%' }}>Total Credit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const discountText = item.discountPercent > 0
                ? `${item.discountPercent}%`
                : item.discountValue > 0
                  ? `${item.discountValue.toLocaleString()}`
                  : '-';

              return (
                <tr key={item.uid}>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{item.label || 'N/A'}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.packing}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{formatCartons(item.cartons)}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.pairs}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.rate.toLocaleString()}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{discountText}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{`(${item.value.toLocaleString()})`}</td>
                </tr>
              );
            })}

            {/* Total Row */}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#fafafa' }}>
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Total Sum:</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>-</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{formatCartons(totalCartons)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{totalPairs}</td>
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Gross Total Credit:</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{`(${itemsTotalValue.toLocaleString()})`}</td>
            </tr>

            {invoiceDiscount > 0 && (
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan={8} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Invoice Discount:</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', color: 'red' }}>-{invoiceDiscount.toLocaleString()}</td>
              </tr>
            )}

            <tr className="excel-print-total-row excel-print-double-bottom" style={{
              fontWeight: 'bold',
              backgroundColor: '#f2f2f2',
              fontSize: '12px'
            }}>
              <td colSpan={8} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Net Credited Amount (PKR):</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{`(${finalTotalValue.toLocaleString()})`}</td>
            </tr>
          </tbody>
        </table>

        {/* Signatures & Print Info footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '45px', fontSize: '11px' }}>
          <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
            Prepared By
          </div>
          <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
            Checked By
          </div>
          <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
            Authorized Signature
          </div>
        </div>

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
          <div>WENTOX FOOTWEAR DISTRIBUTION</div>
          <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>
    );
  };

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same as Sale Bill, so the content below the Quick Menu bar starts
  // immediately instead of losing a row's height to a tab bar first.
  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('return'); pressNewTab(); }}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'return' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Sale Return
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
        Find &amp; Update Return
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Sale Return" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }} {...autoEditScope}>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Two bare radios parked in the margin just left
            of the toolbar's New button, outside the card: absolute, so the centre card never
            moves, and behind no width gate, so no zoom level can hide them (per the user,
            2026-09-03). */}
        {/* Tab contents (records & find) */}
        <div>
          {activeTab === 'weekly' && <WeeklyReturnTab onOpenReturn={handleOpenSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'monthly' && <MonthlyReturnTab onOpenReturn={handleOpenSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'overall' && <OverallReturnTab onOpenReturn={handleOpenSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'find' && <FindReturnTab onOpenReturn={handleOpenSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
        </div>

        <form onSubmit={e => e.preventDefault()} className={activeTab === 'return' ? 'block' : 'hidden'}>

        {/* Banner Messages */}
        {/* Floated into the right-hand gutter, not rendered inline: a message used to push the
            toolbar and card down under the cursor mid-click (per the user, 2026-08-31). */}
        <PageToasts
          error={lookupError || errorMsg}
          success={successMsg}
          onDismissError={() => { setLookupError(''); setErrorMsg(''); }}
          onDismissSuccess={() => setSuccessMsg('')}
        />

        {/* Toolbar - data-no-print — icon-over-label buttons (`.toolbar-btn`), same style as
            SaleBillPage's own toolbar (per the user, 2026-08-26: "copy sale bill... from button to
            everything"). Every action always renders — only `disabled` changes per state. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex items-center flex-nowrap overflow-x-auto gap-2">
          <DocumentToolbar
            /* New works from either view (it used to be disabled on Posted, which greyed it out right
               after posting a document that stays on screen — 2026-09-30). A blank document returns the
               dropdown to Unposted inside handleNew, same as Receipts/Expenses. */
            newAction={{ onClick: pressNew, ref: newButtonRef }}
            remove={{
              onClick: handleDeleteAction,
              disabled: returnId == null || currentReturnIsPosted,
              title: 'Delete this whole return — every article on it goes too (asks for your password)',
            }}
            editRow={{
              onClick: handleEditSelectedRow,
              disabled: selectedIndex == null || currentReturnIsPosted,
              title: 'Edit selected article',
            }}
            edit={{
              onClick: handleEditCurrentReturn,
              disabled: returnId == null || currentReturnIsPosted,
              title: editScope === 'detail' ? 'Edit the selected article' : 'Edit the header fields',
            }}
            save={{ onClick: () => handleSave(false), disabled: mode === 'view' || !isNecessaryFieldsFilled, title: 'Save — keep editing this return' }}
            done={{ onClick: () => handleSave(true), submit: true, disabled: mode === 'view' || !isNecessaryFieldsFilled, title: 'Done — finish this return, then Post it' }}
            cancel={{ onClick: handleCancelEdit, disabled: mode !== 'edit', title: 'Cancel Edit' }}
            first={{ onClick: handleFirst, disabled: !canBrowse }}
            prev={{ onClick: handlePrev, disabled: !canNavPrevious }}
            next={{ onClick: handleNext, disabled: !canNavNext }}
            last={{ onClick: handleLast, disabled: !canBrowse }}
            print={{ onClick: () => setIsPrintingSingle(true), disabled: mode !== 'view' || returnId == null }}
            find={{ onClick: () => setIsFindOpen(true) }}
            unpost={{ onClick: handleUnpostCurrentReturn, disabled: mode !== 'view' || returnId == null || !currentReturnIsPosted, title: 'Un Post — move this posted return back to drafts' }}
            post={{ onClick: async () => { await handlePostCurrentReturn(); focusNewButton(); }, disabled: mode !== 'view' || returnId == null || currentReturnIsPosted }}
            exit={{ onClick: async () => { if (!(await api.closeThisWindow())) dispatch({ type: 'NAVIGATE', page: 'home' }); } }}
            saveAndPost={{ onClick: async () => { await handleSaveAndPost(); focusNewButton(); }, disabled: mode === 'view' || !isNecessaryFieldsFilled || currentReturnIsPosted, title: 'Save & Post' }}
            postAll={{ onClick: async () => { await handlePostAllDrafts(); focusNewButton(); }, disabled: postAllDraftsBusy || browseFilter === 'posted' || drafts.length === 0, title: `Post All (${drafts.length})` }}
            pdf={{ onClick: () => setIsPrintingSingle(true), disabled: mode !== 'view' || returnId == null, title: 'Export PDF' }}
            excel={{
              onClick: () => {
                const headers = ['Article', 'Packing', 'Cartons', 'Pairs', 'Rate', 'D%', 'D. Value', 'Total Value'];
                const rows = items.map(it => [it.label, it.packing, formatCartons(it.cartons), it.pairs, it.rate, it.discountPercent, it.discountValue, it.value]);
                exportRowsToExcel(`sale-return-${billNo || returnId}`, headers, rows);
              },
              disabled: mode !== 'view' || returnId == null,
              title: 'Export Excel',
            }}
          />

          {/* Post All's outcome. Was shown inside the left-hand Saved Drafts panel; that panel is
              gone (per the user, 2026-09-03), so it lands here under the toolbar. A run can post 8
              of 10, and the two that failed are the whole point — it stays until dismissed. */}
          {postAllDraftsResult && (
            <div className="w-full mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}>
              <p className="font-semibold text-slate-700">
                {postAllDraftsResult.posted.length} of {postAllDraftsResult.attempted} posted
                {postAllDraftsResult.failed.length > 0 && ` · ${postAllDraftsResult.failed.length} failed`}
                <button type="button" onClick={() => setPostAllDraftsResult(null)} className="ml-2 text-slate-500 hover:text-slate-700 font-semibold">Dismiss</button>
              </p>
              {postAllDraftsResult.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {postAllDraftsResult.failed.map((fail, i) => (
                    <li key={i} className="text-rose-700">{fail.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mode === 'edit' && (
            <div className="text-sm font-semibold text-slate-500 font-inter">
              Editing System Return: <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">{currentSystemNo ?? 'New'}</span>
            </div>
          )}

          </div>

          {/* Posted/Unposted — picks which list First/Prev./Next/Last page through. Unposted
              (default) = add/post new returns; Posted = browse already-posted ones (per the user,
              2026-08-30). */}
          <select
            value={browseFilter}
            onChange={e => handleBrowseFilterChange(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Which returns First/Pre./Next/Last page through: posted returns, or saved-but-unposted drafts."
          >
            <option value="unposted">Unposted ({drafts.length})</option>
            <option value="posted">Posted ({postedReturns.length})</option>
          </select>
        </div>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Centred directly under the toolbar rather than
            out in the page margin where it used to sit, so it reads as part of the same
            control strip as the Edit button it modifies (per the user, 2026-09-04). */}
        <EditScopeRadios name="sale-return-edit-scope" value={editScope} onChange={setEditScope} />

        {/* Invoice Layout — height pinned to the remaining viewport space (see invoiceCardHeight
            above) and laid out as a flex column, so the item table below can flex-grow into
            whatever room that leaves and the footer lands at the bottom of the screen. Every
            other child here keeps its natural size (shrink-0) — only the table wrapper is flex-1. */}
        <div
          ref={invoiceCardRef}
          className="card-white shadow-sm p-3 md:p-4 flex flex-col"
          data-edit-scope="detail"
          style={{ border: '1px solid var(--border-color)', background: '#ffffff', height: invoiceCardHeight ?? undefined, position: 'relative' }}
        >

          {/* Print Title (Visible only when printing) */}
          <div className="hidden print:flex items-center justify-between mb-6 pb-4 border-b">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX WEARHOUSE</h1>
              <p className="text-xs font-inter uppercase tracking-widest text-slate-500">Footwear Wholesale Distribution</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-xl">SALE RETURN</h2>
              <p className="text-sm font-inter text-slate-500">Status: {currentReturnIsPosted ? 'Posted' : 'Unposted'}</p>
            </div>
          </div>

          {/* Master section — Sale Bill's own grid (per the user, 2026-09-28: Sale Return mirrors Sale
              Bill's placing and interaction exactly; only its labels are its own). Explicit
              `gridArea` per field, so the visual cell is independent of DOM order; the JSX is in
              TAB order — Date → Store → Customer → Remarks → Delivery → Delivery Agent → Manual
              Invoice No. → GP No. → Bilty No. → Adda — same walk as Sale Bill's. */}
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
                "remarks   remarks    remarks    addacode"
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
                TO Store <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="flex-1 relative">
                <input
                  ref={storeTriggerRef}
                  type="text"
                  data-field-nav="true"
                  required
                  disabled={isViewMode || masterFieldsLocked}
                  value={storeSearchText}
                  onChange={e => setStoreSearchText(e.target.value)}
                  onKeyDown={handleStoreTriggerKeyDown}
                  placeholder="Type a store name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button type="button" disabled={isViewMode || masterFieldsLocked} onClick={openStoreModal} title="Browse all stores" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
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
                <button type="button" disabled={isViewMode || masterFieldsLocked} onClick={openCustomerModal} title="Browse all customers" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
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
                    This customer has no linked business account — the return cannot be posted until Setup adds one.
                  </p>
                )}
              </div>
              {!isViewMode && (
                <button type="button" onClick={() => setIsAddCustomerOpen(true)} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102 shrink-0">
                  <Plus size={11} className="text-blue-600" />
                  <span>New</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'custcode' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer Code
              </label>
              <input type="text" value={selectedCustomer?.account_code ?? ''} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>

            <div className="flex items-center gap-1.5" style={{ gridArea: 'remarks' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Remarks
              </label>
              <input type="text" value={remarks} disabled={isViewMode || masterFieldsLocked} onChange={e => setRemarks(e.target.value)} placeholder="Enter return reasons or remarks..." className="soleria-input soleria-input-compact" />
            </div>

            {/* Delivery: a typed code, "1" = SAME (direct) — anything else unlocks Delivery Agent.
                The box beside it shows the resolved name, read-only (Sale Bill's pattern). */}
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
                Delivery Agent <span className="text-slate-400 font-normal normal-case">— optional</span>
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
                <button type="button" disabled={isViewMode || deliveryType === '1' || masterFieldsLocked} onClick={openSubCustModal} title="Browse all sub-customers" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  <ChevronDown size={16} />
                </button>
                <SearchModal
                  isOpen={isSubCustModalOpen}
                  title="Select Delivery Agent"
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
                <button type="button" onClick={() => setIsAddSubCustomerOpen(true)} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102 shrink-0">
                  <Plus size={11} className="text-blue-600" />
                  <span>New</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5" style={{ gridArea: 'billno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Manual Invoice No. <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="text" value={billNo} disabled={isViewMode || masterFieldsLocked} onChange={e => setBillNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'gpno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                GP No. <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="text" value={gpNo} disabled={isViewMode || masterFieldsLocked} onChange={e => setGpNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'biltyno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Bilty No. <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="text" value={biltyNo} disabled={isViewMode || masterFieldsLocked} onChange={e => setBiltyNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'addacode' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Transport Adda <span className="text-slate-400 font-normal normal-case">— optional</span>
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
                <button type="button" disabled={isViewMode || masterFieldsLocked} onClick={openAddaModal} title="Browse all Addas" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
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

            {/* Main A/C and Return No. — read-only, placed after Adda in DOM so they never interrupt
                the Enter walk (both are disabled), same as Sale Bill. */}
            <div className="flex items-center gap-1.5" style={{ gridArea: 'maincode' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Main A/C
              </label>
              <input type="text" value={selectedMainAc?.ac_code ?? ''} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'mainname' }}>
              <input type="text" value={selectedMainAc?.ac_name ?? ''} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'sysno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Return No.
              </label>
              <input type="text" value={currentSystemNo != null ? `#${currentSystemNo}` : hasClickedNew ? `#${nextSystemReturnNo}` : ''} disabled className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200" />
            </div>
          </div>

          {/* Entry strip (ref-pic bound-record pattern, matching SaleBillPage exactly — per the
              user, 2026-08-26). Row 1: Product/Product Name/Color/Packing. Row 2: Cartons/Pairs/
              Rate/D%/DV/Value. This is the ONE "current record" being typed; Enter on DV commits
              it into the table below (handleCommitEntryRow) and resets the strip. Clicking a
              table row loads it back in here for editing. */}
          {!isViewMode && (
          <div className="shrink-0 mb-2 p-2 rounded-lg border bg-slate-50/60" style={{ borderColor: 'var(--border-color)' }}>
            <div className="grid gap-x-3 gap-y-1.5 mb-1.5" style={{ gridTemplateColumns: '1fr 1fr 1fr 190px' }}>
              <div ref={entryProductCellRef} className="flex items-center gap-1.5">
                <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Article <span className="text-red-500 font-bold">*</span></label>
                <div className="flex-1">
                  {/* A real text input, not a button — type a full code/name or any substring,
                      then Enter opens the modal already filtered to matches. Arrow Up/Down still
                      open it too (unfiltered, or filtered by whatever's already typed). */}
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
                        // One Enter picks it when the typed code/name means exactly one article.
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
                {/* One decimal place — part cartons come back on a return exactly as they go out
                    (per the user, 2026-09-02). parseFloat, not parseInt: parseInt('0.5') is 0. */}
                <CartonsInput
                  value={entry.cartons}
                  min={0.1}
                  required
                  disabled={detailFieldsLocked}
                  onChange={v => updateEntryNumericField('cartons', v)}
                  className="soleria-input soleria-input-compact text-center font-mono"
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
                  disabled={detailFieldsLocked}
                  min={0}
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
            {/* Editing banner, per pages_design.md §4 — the row stays visible (highlighted) in
                the grid below the whole time it's being edited, not pulled out; Cancel here
                discards the in-progress edit, same as the toolbar's Cancel Edit for the return as
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
              the return is already posted — see handleRowClick). No per-row delete button, per
              pages_design.md §4 — deleting a line item is the toolbar's own Delete button, enabled
              only while a row is selected here. */}
          <div className="flex-1 min-h-0 mb-2 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  {/* G-05 (changes-14-09-26.md, 2026-09-15): narrow gutter for the ▶ row pointer —
                      unlabeled, matching the ref pic (ref-pics/batch2/jv2.0.jpeg). */}
                  <th className="sticky top-0 z-10 bg-slate-50 p-1" style={{ width: '18px' }} />
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ minWidth: '190px' }}>Returned Article</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Cartons</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '100px' }}>Rate</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '130px' }}>Total Credit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '84px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr
                    key={item.uid}
                    ref={el => { rowRefs.current[idx] = el; }}
                    onClick={() => {
                      // A click only SELECTS the row (what Edit/Edit Row act on next), in every
                      // state — even while another row is in the strip (standard §5, superseding
                      // G-08's "no visible change").
                      setSelectedIndex(prev => prev === idx ? null : idx);
                    }}
                    aria-selected={idx === selectedIndex}
                    // Three distinct states (standard §5): editing = blue, selected = gold, each
                    // with a 4px left bar; the ▶ marker is never a background.
                    className={`border-b cursor-pointer transition-colors border-l-4 ${
                      idx === editingIndex ? 'bg-blue-100 border-l-blue-600'
                        : idx === selectedIndex ? 'bg-[#B08D57]/15 border-l-[#B08D57]'
                        : 'border-l-transparent hover:bg-slate-50/50'
                    }`}
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
                    <td className="p-1 text-right font-mono font-semibold text-sm" style={{ color: 'var(--brand-gold)' }}>{`(${formatCurrency(item.value)})`}</td>
                    <td className="p-1 text-center whitespace-nowrap">
                      <RowActions
                        onEdit={() => handleRowClick(idx)}
                        onDelete={() => handleRowDelete(idx)}
                        disabled={currentReturnIsPosted}
                        editTitle="Edit this article"
                        deleteTitle="Delete this article"
                        disabledTitle="Unpost the return to change its articles"
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

          {/* Bottom Section: ref-pic's flat totals row (Total Cartons | Total Pairs | Invoice
              Discount | Total Value | Net Total) — matches SaleBillPage's own bottom section. */}
          <div className="shrink-0 flex flex-wrap items-end justify-between gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            {/* Left empty — Sale Bill's Payment Due Date slot; returns have no due date. */}
            <div />

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
                  // Expenses (per the user, 2026-09-03).
                  style={{ width: '140px', color: 'var(--brand-gold)', background: '#ffffff', borderColor: 'var(--border-color)' }}
                />
              </div>
            </div>
          </div>

        </div>

      </form>
      </div>

      {/* Find Return Modal — jump to any posted or unposted return by bill number or customer
          name (mirrors SaleBillPage's own Find Bill Modal). */}
      {isFindOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">Find Return</h3>
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
                  key={`${filter}-${'return_id' in row ? row.return_id : row.draft_id}`}
                  onClick={() => handleFindResultSelect(filter, row)}
                  className="px-3 py-2 text-xs cursor-pointer hover:bg-amber-50/60 flex items-center justify-between gap-2"
                >
                  <span className="font-mono font-semibold text-slate-700">{row.bill_no || `#${row.system_no}`}</span>
                  <span className="text-slate-400 truncate">{customers.find(c => c.customer_id === row.customer_id)?.name || 'Unnamed Customer'}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${filter === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{filter}</span>
                </li>
              ))}
              {findQuery.trim() && findResults.length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-400 text-center">No matching returns.</li>
              )}
            </ul>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={closeFindReturn}
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
              <button type="button" onClick={handleCreateSubCustomer} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm">
                Add Sub-Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Password Protection Modal */}
      {/* Add New Customer Modal — same as Sale Bill's */}
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

      <PasswordPromptModal
        isOpen={isPasswordModalOpen}
        onClose={() => {
          setIsPasswordModalOpen(false);
          setPasswordActionType(null);
          pendingDeleteReturnId.current = null;
          setEmptyingViaLastRow(false);
        }}
        onSuccess={handlePasswordSuccess}
        title={
          passwordActionType === 'post_return'
            ? 'Authorization Required to Post Return'
            : passwordActionType === 'delete_unposted_return'
              ? 'Authorization Required to Delete Return'
              : 'Authorization Required to Save Return Changes'
        }
        subtitle={passwordActionType === 'delete_unposted_return'
          ? emptyingViaLastRow
            ? `That was the return's last article — a return can't be empty, so deleting it removes the WHOLE return. It cannot be undone. Enter the password for user '${state.currentUsername || 'user'}' to confirm.`
            : `This deletes the WHOLE return and every article on it — not a single row. It cannot be undone. Enter the password for user '${state.currentUsername || 'user'}' to confirm.`
          : `Please enter password for user '${state.currentUsername || 'user'}' to confirm changes to Return #${billNo || currentSystemNo}.`}
      />

      {/* Print/PDF preview — see renderReturnPrintable above. */}
      <ReportPrintPreviewModal
        isOpen={isPrintingSingle}
        onClose={() => setIsPrintingSingle(false)}
        title={`Sale Return ${billNo ? `#${billNo}` : currentSystemNo != null ? `#${currentSystemNo}` : ''}`}
        orientation="portrait"
      >
        {renderReturnPrintable()}
      </ReportPrintPreviewModal>
    </AppLayout>
  );
}
