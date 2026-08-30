import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import WeeklyTab from '@/components/WeeklyTab';
import MonthlyTab from '@/components/MonthlyTab';
import OverallTab from '@/components/OverallTab';
import FindTab from '@/components/FindTab';
import {
  Save, Plus, Trash2, Printer, FileDown, FileSpreadsheet, Edit, AlertTriangle, CheckCircle2,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, LogOut, Search, X, Undo2, FilePlus2,
  PackageCheck, ChevronDown
} from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { formatDate, getTodayDate } from '@/lib/utils';
import { focusFirstField, focusNextField } from '@/lib/fieldNav';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal from '@/components/SearchModal';
import wentoxLogo from '@/assets/wentox_logo.png';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import { usePersistentField, useClearPageDraft, useHasPageDraft } from '@/hooks/usePersistentField';
import * as api from '@/lib/api';
import type {
  CustomerRow, SubCustomerRow, ProductRow, ProductVariantRow, StoreRow, AddaRow,
  RegionRow, CityRow, SaleBillRow, SaleBillCreateInput, SaleBillItemInput, StockRow,
  DraftSaleBillRow, ConfirmAllResult, BusinessAccountRow
} from '@/lib/api';

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
  const pairs = item.cartons * item.packing;
  const gross = pairs * item.rate;
  const discountValue = Math.round(gross * (item.discountPercent / 100));
  const value = Math.max(0, gross - discountValue);
  return { ...item, pairs, discountValue, value };
}

export default function SaleBillPage() {
  const { state, dispatch } = useApp();

  // Weekly/Monthly/Overall/Find sub-tabs — same sub-tab bar as Sale Return's own (2026-08-26, per
  // the user: brought back here alongside it, not dropped).
  const [activeTab, setActiveTab] = useState<'bill' | 'weekly' | 'monthly' | 'overall' | 'find'>('bill');

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
      if (stRes.ok) setStockRows(stRes.data);
      if (baRes.ok) setBusinessAccounts(baRes.data);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
  }, []);

  const refreshStock = useCallback(async () => {
    const res = await api.reports.stock();
    if (res.ok) setStockRows(res.data);
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

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');

  // Password Modal Protection State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordActionType, setPasswordActionType] = useState<'save_bill' | 'save_and_post' | 'post_bill' | 'delete_unposted_bill' | 'edit_item_row' | null>(null);

  // Draft persistence — see src/hooks/usePersistentField.ts. Only real in-progress entry data is
  // persisted; which EXISTING record is loaded (billId/currentBillIsPosted/mode) is deliberately
  // left as plain useState, same as StockVoucherPage.
  const clearSaleBillDraft = useClearPageDraft('sale-bill');
  // Captured at mount — gates the auto-initialize effect below. See its comment.
  const hasSaleBillDraft = useHasPageDraft('sale-bill');

  // Form State
  const [billId, setBillId] = useState<number | null>(null);
  const [currentBillIsPosted, setCurrentBillIsPosted] = useState(false);
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
    } else if (!subCustomerId) {
      setSubCustomerId(subCustomers[0] ? String(subCustomers[0].sub_customer_id) : '');
    }
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

  // Add new customer modal state
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerRegionId, setNewCustomerRegionId] = useState('');
  const [newCustomerCityId, setNewCustomerCityId] = useState('');

  // SB-06 (revised): every saved-unposted bill now lives in draft_sale_bills — the real
  // sale_bills table strictly never holds an unposted document. This one list replaces what used
  // to be two separate concepts ("Saved Drafts" for incomplete entries vs "Pending Posting" for
  // complete-but-unposted ones) — there's no longer a meaningful distinction at the data level.
  const [unpostedBills, setUnpostedBills] = useState<DraftSaleBillRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<ConfirmAllResult | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.draftSaleBills.list();
    if (res.ok) setUnpostedBills(res.data);
  }, []);

  useEffect(() => { refreshUnposted(); }, [refreshUnposted]);

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
    if (billId != null && !currentBillIsPosted && res.data.posted.some(p => p.draft_id === billId)) {
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

  // Preview of the System No. a brand-new bill will get — same idea as Purchase's own
  // nextSystemBillNo: what Save actually assigns is the next draft_sale_bill.draft_id, a
  // separate IDENTITY sequence from the real bill_id assigned later on Post. Client-side preview
  // only, correct as long as nothing else inserts a draft between now and Save.
  const nextSystemBillNo = useMemo(
    () => Math.max(0, ...unpostedBills.map(d => d.draft_id)) + 1,
    [unpostedBills]
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
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setCustomerModalSeed(customerSearchText); setIsCustomerModalOpen(true); }
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

  const stockExceededRows = useMemo(() => {
    const requestedByVariant: Record<number, number> = {};
    items.forEach(it => {
      if (it.variantId != null && it.cartons > 0) {
        requestedByVariant[it.variantId] = (requestedByVariant[it.variantId] || 0) + it.cartons;
      }
    });

    const exceededMap: Record<string, { available: number; requested: number; itemCartons: number }> = {};
    items.forEach((it) => {
      if (it.variantId != null && it.cartons > 0) {
        const stockInfo = getStockInfo(it.articleId, it.variantId);
        const available = stockInfo ? stockInfo.cartons : 0;
        const totalReq = requestedByVariant[it.variantId] || it.cartons;
        if (totalReq > available) {
          exceededMap[it.uid] = { available, requested: totalReq, itemCartons: it.cartons };
        }
      }
    });
    return exceededMap;
  }, [items, getStockInfo]);

  const hasStockExceeded = useMemo(() => Object.keys(stockExceededRows).length > 0, [stockExceededRows]);

  const isNecessaryFieldsFilled = useMemo(() => {
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (!billNo) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.variantId || it.cartons <= 0 || it.rate <= 0)) return false;
    if (isCustomDelivery && !subCustomerId) return false;
    if (hasStockExceeded) return false;
    return true;
  }, [customerId, date, storeId, billNo, items, isCustomDelivery, subCustomerId, hasStockExceeded]);

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

    setBillId(row.bill_id);
    setCurrentBillIsPosted(row.is_posted);
    setDate(row.bill_date.slice(0, 10));
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
    setDueDate(row.due_date ? row.due_date.slice(0, 10) : '');
    setInvoiceDiscount(row.invoice_discount || 0);

    const loadedItems: UiItem[] = row.items.map(it => {
      const article = products.find(p => p.code === it.article_code);
      return {
        uid: 'row_' + it.item_id,
        articleId: article?.article_id ?? null,
        variantId: it.variant_id,
        label: `${it.article_name || it.article_code || 'Article'} — ${it.color || ''}`,
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
      if (res.ok) draft = res.data;
    }
    createdInThisRun.current = false;
    setBillId(draft.draft_id);
    setCurrentBillIsPosted(false);
    setDate(draft.bill_date.slice(0, 10));
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
      const article = products.find(p => p.code === it.article_code);
      return {
        uid: 'draftrow_' + it.line_no,
        articleId: article?.article_id ?? null,
        variantId: it.variant_id,
        label: `${it.article_name || it.article_code || 'Article'} — ${it.color || ''}`,
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
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });

    setMode(opts.mode ?? 'edit');
    setErrorMsg('');
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
  const [postedBills, setPostedBills] = useState<SaleBillRow[]>([]);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  const refreshPosted = useCallback(async () => {
    const res = await api.saleBills.list();
    if (res.ok) setPostedBills(res.data);
    return res.ok ? res.data : null;
  }, []);

  useEffect(() => { refreshPosted(); }, [refreshPosted]);

  // Both list() calls return newest-first (ORDER BY date DESC, id DESC) — reversed here for
  // oldest-first, so First = earliest and Last = most recent.
  const navPostedList = useMemo(() => [...postedBills].reverse(), [postedBills]);
  const navUnpostedList = useMemo(() => [...unpostedBills].reverse(), [unpostedBills]);

  // Whichever list the dropdown currently selects — this is what the nav buttons page through.
  const navList = browseFilter === 'posted' ? navPostedList : navUnpostedList;

  // Where the bill on screen sits in the ACTIVE list — -1 when it isn't in it at all (a brand-new
  // unsaved bill, or a draft while the dropdown is on Posted and vice versa), which the handlers
  // below treat as "start from the beginning".
  const navIndex = useMemo(() => {
    if (billId == null) return -1;
    return browseFilter === 'posted'
      ? (currentBillIsPosted ? navPostedList.findIndex(b => b.bill_id === billId) : -1)
      : (!currentBillIsPosted ? navUnpostedList.findIndex(b => b.draft_id === billId) : -1);
  }, [billId, currentBillIsPosted, browseFilter, navPostedList, navUnpostedList]);

  const canBrowse = navList.length > 0;
  const canNavPrevious = canBrowse && navIndex !== 0;
  const canNavNext = canBrowse && navIndex !== navList.length - 1;

  // Loads whichever row sits at `idx` of the ACTIVE list into the form, read-only — browsing is
  // look-then-decide, same as opening any other existing bill; Edit still needs its own explicit
  // click (and, for a posted bill, its own password gate on Save). Posted rows come from
  // sale_bills, unposted ones from draft_sale_bills, so each needs its own loader.
  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    if (browseFilter === 'posted') {
      await loadBillRow(navList[idx] as SaleBillRow);
      setMode('view');
    } else {
      await loadDraftIntoForm(navList[idx] as DraftSaleBillRow, { mode: 'view' });
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
      const latest = navUnpostedList[navUnpostedList.length - 1];
      if (latest) await loadDraftIntoForm(latest, { mode: 'view' });
      else handleNew();
      requestAnimationFrame(() => newButtonRef.current?.focus());
    } else {
      const fresh = await refreshPosted();
      const list = [...(fresh ?? postedBills)].reverse();
      const latest = list[list.length - 1];
      if (latest) { await loadBillRow(latest); setMode('view'); }
    }
  };

  // Toolbar's Find button — a quick jump to any bill (posted or unposted) by bill number or
  // customer name, searched client-side over the already-loaded browse lists rather than a
  // round-trip, since both lists are small enough to already be in memory for First/Pre/Next/Last.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
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
  // deleting a line item is a toolbar action, enabled only while a row is selected (editingIndex
  // set)". With a row selected, Delete removes THAT line item; with none selected, it falls back
  // to this page's own whole-bill delete (a capability the reference build didn't need to cover).
  const handleDeleteAction = () => {
    if (editingIndex != null) {
      handleRemoveItemRow(editingIndex);
      return;
    }
    handleDeleteCurrentBill();
  };

  // Initialize new bill if mode is new and not set.
  //
  // Skipped entirely when this page mounted with a restored draft (usePersistentField): this
  // effect fires a beat AFTER mount, once `stores` resolves, and handleNew() blanks every field
  // AND clears the stored draft — so without the guard, coming back to a half-typed bill wiped it
  // a fraction of a second after it was restored (reported by the user, 2026-08-30).
  useEffect(() => {
    if (hasSaleBillDraft) return;
    if (mode === 'new' && billId === null && stores.length > 0) {
      handleNew();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, billId, stores]);

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
    // SB-05: a blank form has nothing saved in it yet, so nothing to clear on post.
    createdInThisRun.current = false;
    setBillId(null);
    setCurrentBillIsPosted(false);
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
    setErrorMsg('');
    // Explicit focus, not just the G-01 mode-change effect above: clicking New while already on
    // a blank/new bill (mode is already 'new') doesn't change `mode`, so that effect's dependency
    // never fires and focus would otherwise stay wherever it was.
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

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
    const payload = buildPayload();
    if (!payload) return null;

    if (isEditingPostedBill && billId != null) {
      const result = await api.saleBills.update(billId, password ? { ...payload, password } : payload);
      if (!result.ok) {
        setErrorMsg('Failed to save bill: ' + result.error.message);
        return null;
      }
      setBillId(result.data.bill_id);
      setCurrentBillIsPosted(true);
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
    setCurrentBillIsPosted(false);
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

  const handlePrintSpecificBill = async (bill: SaleBillRow) => {
    await loadBillRow(bill);
    setIsPrintingSingle(true);
    setTimeout(() => {
      window.print();
      setIsPrintingSingle(false);
    }, 150);
  };

  // Entering edit mode never needs its own password prompt anymore — Save (handleSave,
  // mode==='edit') already asks for one before the update actually goes through, so gating entry
  // into edit mode too meant asking twice for one edit (reported by the user for both this
  // button and handleEditSpecificBill above).
  const handleEditCurrentBill = () => {
    setMode('edit');
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
          await Promise.all([refreshUnposted(), refreshStock()]);
        }
      }
    } else if (passwordActionType === 'edit_item_row') {
      const idx = pendingRowEditIndex.current;
      pendingRowEditIndex.current = null;
      if (idx != null) {
        setMode('edit');
        loadRowIntoEntry(idx);
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
  const entryProductCellRef = useRef<HTMLDivElement>(null);
  const pendingRowEditIndex = useRef<number | null>(null);
  // Product field's SearchModal — same pattern as Customer's (pages_design.md §5): type the
  // article code, Enter opens a big centered popup to pick from, matching stock shown per row.
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const productTriggerRef = useRef<HTMLInputElement>(null);
  // What's currently typed into the Product field itself — separate from `entry.articleId`/
  // `entry.label` (the committed selection) so the field can keep showing free-typed text right
  // up until Enter opens the modal with it as the initial filter.
  const [productSearchText, setProductSearchText] = useState('');

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
      const gross = next.cartons * next.packing * next.rate;
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
  const entryStockInHand = useMemo(() => {
    if (entry.variantId == null) return null;
    const stockInfo = getStockInfo(entry.articleId, entry.variantId);
    if (!stockInfo) return null;
    const otherReserved = items.reduce((acc, it, i) => {
      if (i !== editingIndex && it.variantId === entry.variantId) {
        acc.cartons += it.cartons;
        acc.pairs += it.pairs;
      }
      return acc;
    }, { cartons: 0, pairs: 0 });
    return {
      cartons: Math.max(0, stockInfo.cartons - otherReserved.cartons),
      pairs: Math.max(0, stockInfo.pairs - otherReserved.pairs),
    };
  }, [entry.articleId, entry.variantId, items, editingIndex, getStockInfo]);

  const entryStockCheck = useMemo(() => {
    if (entry.variantId == null || entry.cartons <= 0 || !entryStockInHand) return null;
    const available = entryStockInHand.cartons;
    return entry.cartons > available ? { available, totalReq: entry.cartons } : null;
  }, [entry.variantId, entry.cartons, entryStockInHand]);

  // Commits the strip's current entry into the table — appends a new row, or overwrites
  // `editingIndex` when the strip is re-editing a row clicked open from the table. Stock-blocked
  // entries refuse to commit at all (per spec: "do not allow adding the row"), not just warn.
  const handleCommitEntryRow = () => {
    if (entry.articleId == null || entry.variantId == null) {
      setErrorMsg('Select an article and color before adding the row.');
      return;
    }
    if (entry.cartons <= 0) { setErrorMsg('Cartons must be greater than 0.'); return; }
    if (entry.rate <= 0) { setErrorMsg('Rate must be greater than 0.'); return; }
    if (entryStockCheck) {
      setErrorMsg(`Cannot add row: ${entryStockCheck.totalReq} cartons requested exceeds ${entryStockCheck.available} in stock.`);
      return;
    }
    setErrorMsg('');
    // Same article/color already on the bill — merge cartons into it instead of adding a
    // duplicate row (per the user, 2026-08-30). Excludes the row being edited itself, so
    // re-committing an unchanged row doesn't fold it into a copy of itself.
    const dupIdx = items.findIndex((it, i) => it.variantId === entry.variantId && i !== editingIndex);
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
    setEditingIndex(null);
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
    if (row.articleId != null) fetchVariants(row.articleId);
    requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
  };

  const handleRowClick = (idx: number) => {
    if (isViewMode && currentBillIsPosted) {
      pendingRowEditIndex.current = idx;
      setPasswordActionType('edit_item_row');
      setIsPasswordModalOpen(true);
      return;
    }
    if (isViewMode) setMode('edit');
    loadRowIntoEntry(idx);
  };

  const handleRemoveItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setEntry(newUiItem());
    } else if (editingIndex != null && idx < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
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

  if (isPrintingSingle) {
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
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>SALE INVOICE</h2>
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
            <span>{billId ?? 'Unsaved'}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Date</label>
            <span>{formatDate(date)}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>From Store</label>
            <span>{storeName}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Manual Bill No.</label>
            <span>{billNo}</span>
          </div>

          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Customer Name</label>
            <span>{customerName}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Delivery Destination</label>
            <span>{subCustomerName}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Custom Address</label>
            <span>{isCustomDelivery ? (customAddress || 'N/A') : 'N/A'}</span>
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
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px', gridColumn: 'span 2' }}>
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
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '40%' }}>Article / Product Description</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '8%' }}>Packing</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Cartons</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Pairs</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Rate</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Discount</th>
              <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '15%' }}>Net Value</th>
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
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.cartons}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.pairs}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.rate.toLocaleString()}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{discountText}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.value.toLocaleString()}</td>
                </tr>
              );
            })}

            {/* Total Row */}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#fafafa' }}>
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Total Sum:</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>-</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{totalCartons}</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{totalPairs}</td>
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Gross Value:</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{itemsTotalValue.toLocaleString()}</td>
            </tr>

            {invoiceDiscount > 0 && (
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Invoice Discount:</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', color: 'red' }}>-{invoiceDiscount.toLocaleString()}</td>
              </tr>
            )}

            <tr className="excel-print-total-row excel-print-double-bottom" style={{
              fontWeight: 'bold',
              backgroundColor: '#f2f2f2',
              fontSize: '12px'
            }}>
              <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Net Payable Amount (PKR):</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{finalTotalValue.toLocaleString()}</td>
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
  }

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same as Sale Return, so the content below the Quick Menu bar starts
  // immediately instead of losing a row's height to a tab bar first.
  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('bill'); handleNew(); }}
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
      <div className="mx-auto relative" style={{ maxWidth: 1200 }}>

        {/* Tab contents (records & find) */}
        <div>
          {activeTab === 'weekly' && <WeeklyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'monthly' && <MonthlyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'overall' && <OverallTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'find' && <FindTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
        </div>

        <form onSubmit={e => e.preventDefault()} className={activeTab === 'bill' ? 'block' : 'hidden'}>

        {/* Banner Messages */}
        {lookupError && (
          <div className="banner-error rounded-lg px-4 py-2.5 text-sm mb-3">{lookupError}</div>
        )}
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-2.5 text-sm mb-3 flex items-center justify-between">
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-2.5 text-sm mb-3 flex items-center justify-between">
            <span>{errorMsg}</span>
          </div>
        )}


        {/* Toolbar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          {/* Icon-over-label toolbar buttons, per System_architecture/pages_design.md §1 — small
              square buttons (`.toolbar-btn`), colored icon on top, tiny bold label underneath,
              packed tightly in one strip, dividers between logical groups. Every action always
              renders — only `disabled` changes per state, never whole groups mounting/unmounting.
              Icon color signals the action's nature (not the button background): emerald =
              create/confirm, rose = delete/destructive, sky = edit, blue = save, slate = cancel/
              neutral, amber = navigation. */}
          <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-0.5">
            <button ref={newButtonRef} type="button" onClick={handleNew} title="New" className="toolbar-btn">
              <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={handleDeleteAction}
              disabled={editingIndex != null ? isViewMode : (mode !== 'view' || billId == null || currentBillIsPosted)}
              title={editingIndex != null ? 'Delete selected article' : 'Delete'}
              className="toolbar-btn"
            >
              <Trash2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              onClick={handleEditCurrentBill}
              disabled={mode !== 'view' || billId == null}
              title="Edit"
              className="toolbar-btn"
            >
              <Edit size={20} strokeWidth={2.5} className="text-sky-600" />
              <span>Edit</span>
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded}
              title="Save — keep editing this bill"
              className="toolbar-btn"
            >
              <Save size={20} strokeWidth={2.5} className="text-blue-600" />
              <span>Save</span>
            </button>
            <button
              type="submit"
              onClick={() => handleSave(true)}
              disabled={mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded}
              title="Done — finish this bill, then Post it"
              className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Done</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              disabled={mode !== 'edit'}
              title="Cancel Edit"
              className="toolbar-btn"
            >
              <X size={20} strokeWidth={2.5} className="text-slate-500" />
              <span>Cancel</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={handleFirst}
              disabled={!canBrowse}
              title="First"
              className="toolbar-btn"
            >
              <ChevronsLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>First</span>
            </button>
            <button
              type="button"
              onClick={handlePrev}
              disabled={!canNavPrevious}
              title="Pre."
              className="toolbar-btn"
            >
              <ChevronLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Pre.</span>
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canNavNext}
              title="Next"
              className="toolbar-btn"
            >
              <ChevronRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Next</span>
            </button>
            <button
              type="button"
              onClick={handleLast}
              disabled={!canBrowse}
              title="Last"
              className="toolbar-btn"
            >
              <ChevronsRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Last</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={() => {
                setIsPrintingSingle(true);
                setTimeout(() => { window.print(); setIsPrintingSingle(false); }, 100);
              }}
              disabled={mode !== 'view' || billId == null}
              title="Print"
              className="toolbar-btn"
            >
              <Printer size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={() => setIsFindOpen(true)}
              title="Find"
              className="toolbar-btn"
            >
              <Search size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Find</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={handleUnpostCurrentBill}
              // No longer gated on the dropdown: it used to require browseFilter === 'unposted'
              // back when that value MEANT "I'm here to unpost". Now that the dropdown genuinely
              // filters, requiring it would be backwards — "Unposted" lists drafts, none of which
              // can be unposted. Being on a posted bill is the only real precondition.
              disabled={mode !== 'view' || billId == null || !currentBillIsPosted}
              title="Un Post — move this posted bill back to drafts"
              className="toolbar-btn"
            >
              <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Un Post</span>
            </button>
            <button
              type="button"
              onClick={handlePostCurrentBill}
              disabled={mode !== 'view' || billId == null || currentBillIsPosted}
              title="Post"
              className="toolbar-btn"
            >
              <PackageCheck size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Post</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={() => dispatch({ type: 'NAVIGATE', page: 'home' })}
              title="Exit"
              className="toolbar-btn"
            >
              <LogOut size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Exit</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            {/* Extra convenience actions, not in the ref-pic's own set — kept, just styled the
                same way, since nothing asked for them to go away. */}
            <button
              type="button"
              onClick={handleSaveAndPost}
              disabled={mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded || currentBillIsPosted}
              title="Save & Post"
              className="toolbar-btn"
            >
              <FilePlus2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Save+Post</span>
            </button>
            {unpostedBills.length > 0 && (
              <button
                type="button"
                onClick={handlePostAll}
                disabled={postAllBusy}
                title={`Post All (${unpostedBills.length})`}
                className="toolbar-btn"
              >
                <PackageCheck size={20} strokeWidth={2.5} className="text-emerald-600" />
                <span>Post All</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => exportToPDF()}
              disabled={mode !== 'view' || billId == null}
              title="Export PDF"
              className="toolbar-btn"
            >
              <FileDown size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const headers = ['Article', 'Packing', 'Cartons', 'Pairs', 'Rate', 'D%', 'D. Value', 'Total Value'];
                const rows = items.map(it => [it.label, it.packing, it.cartons, it.pairs, it.rate, it.discountPercent, it.discountValue, it.value]);
                exportRowsToExcel(`sale-bill-${billNo || billId}`, headers, rows);
              }}
              disabled={mode !== 'view' || billId == null}
              title="Export Excel"
              className="toolbar-btn"
            >
              <FileSpreadsheet size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Excel</span>
            </button>
          </div>

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
              Editing System Invoice: <span className="font-mono text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">{billId ?? 'New'}</span>
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

        {/* Invoice Layout — height pinned to the remaining viewport space (see invoiceCardHeight
            above) and laid out as a flex column, so the item table below can flex-grow into
            whatever room that leaves and the footer lands at the bottom of the screen instead of
            wherever the old fixed-height table happened to end. Every other child here keeps its
            natural size (flex-shrink-0) — only the table wrapper is flex-1. */}
        <div
          ref={invoiceCardRef}
          className="card-white shadow-sm p-3 md:p-4 flex flex-col"
          style={{ border: '1px solid var(--border-color)', background: '#ffffff', overflow: 'visible', height: invoiceCardHeight ?? undefined }}
        >

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
              <input type="date" ref={firstFieldRef}
            value={date} disabled={isViewMode} onChange={e => setDate(e.target.value)} className="soleria-input soleria-input-compact" />
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
                  disabled={isViewMode}
                  value={storeSearchText}
                  onChange={e => setStoreSearchText(e.target.value)}
                  onKeyDown={handleStoreTriggerKeyDown}
                  placeholder="Type a store name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode}
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
                  disabled={isViewMode}
                  value={customerSearchText}
                  onChange={e => setCustomerSearchText(e.target.value)}
                  onKeyDown={handleCustomerTriggerKeyDown}
                  placeholder="Type a customer name, or press Enter to search..."
                  className="soleria-input pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode}
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
                  onSelect={(val) => {
                    setCustomerId(val);
                    setDeliveryType('1');
                    setDeliveryCode('1');
                    setSubCustomerId('');
                    setCustomAddress('');
                    setIsCustomerModalOpen(false);
                    requestAnimationFrame(() => focusNextField(customerTriggerRef.current));
                  }}
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
              <input type="text" value={remarks} disabled={isViewMode} onChange={e => setRemarks(e.target.value)} placeholder="Enter any sales remarks..." className="soleria-input soleria-input-compact" />
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
                disabled={isViewMode}
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
                  disabled={isViewMode || deliveryType === '1'}
                  value={subCustSearchText}
                  onChange={e => setSubCustSearchText(e.target.value)}
                  onKeyDown={handleSubCustTriggerKeyDown}
                  placeholder="Type a sub-customer name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || deliveryType === '1'}
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
              <input type="text" value={billNo} disabled={isViewMode} onChange={e => setBillNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'gpno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                GP No.
              </label>
              <input type="text" value={gpNo} disabled={isViewMode} onChange={e => setGpNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5" style={{ gridArea: 'biltyno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Bilty No.
              </label>
              <input type="text" value={biltyNo} disabled={isViewMode} onChange={e => setBiltyNo(e.target.value)} className="soleria-input soleria-input-compact" />
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
                  disabled={isViewMode}
                  value={addaSearchText}
                  onChange={e => setAddaSearchText(e.target.value)}
                  onKeyDown={handleAddaTriggerKeyDown}
                  placeholder="Type an Adda name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode}
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
                Purchase's own System Bill No.) instead of just saying "Unsaved". */}
            <div className="flex items-center gap-1.5" style={{ gridArea: 'sysno' }}>
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                No. &gt;&gt;&gt;&gt;
              </label>
              <input type="text" value={billId != null ? `#${billId}` : `#${nextSystemBillNo} (pending)`} disabled className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200" />
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
                    value={productSearchText}
                    onChange={e => setProductSearchText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsProductModalOpen(true);
                      }
                    }}
                    placeholder="Type article code or name..."
                    className="soleria-input soleria-input-compact"
                  />
                  <SearchModal
                    isOpen={isProductModalOpen}
                    title="Select Article"
                    options={products.map(p => {
                      const agg = getStockInfo(p.article_id, null);
                      return {
                        value: String(p.article_id),
                        label: `${p.code} — ${p.name}`,
                        sublabel: agg ? `Stock: ${agg.cartons} ctn / ${agg.pairs} prs` : undefined
                      };
                    })}
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
                    disabled={entry.articleId == null}
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
                  <input type="text" value={entryStockInHand ? `${entryStockInHand.cartons} Ctn / ${entryStockInHand.pairs} Prs` : '-'} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500 text-center" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 items-end">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cartons <span className="text-red-500 font-bold">*</span></label>
                <input
                  type="number"
                  value={entry.cartons || ''}
                  min={1}
                  onChange={e => updateEntryNumericField('cartons', parseInt(e.target.value) || 0)}
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
                  value={entry.rate || ''}
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
                <span>Exceeds Stock! {entryStockCheck.totalReq} cartons requested, only {entryStockCheck.available} in hand — row will not be added.</span>
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
              <button type="button" onClick={handleCommitEntryRow} className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d]">
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
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ minWidth: '190px' }}>Product Name</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Cartons</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '100px' }}>Rate</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '130px' }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr
                    key={item.uid}
                    onClick={() => handleRowClick(idx)}
                    className={`border-b cursor-pointer hover:bg-slate-50/50 ${idx === editingIndex ? 'bg-blue-50' : ''}`}
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    <td className="p-1 pl-3 font-semibold text-slate-800 text-[13px]">{item.label || 'N/A'}</td>
                    <td className="p-1 text-center font-mono text-sm text-slate-600">{item.packing || '-'}</td>
                    <td className="p-1 text-center font-mono text-sm text-slate-700">{item.cartons}</td>
                    <td className="p-1 text-center font-mono text-sm font-semibold text-slate-700">{item.pairs || '-'}</td>
                    <td className="p-1 text-right font-mono text-sm text-slate-700">{item.rate.toLocaleString()}</td>
                    <td className="p-1 text-right font-mono font-semibold text-sm" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(item.value)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-center text-xs text-slate-400">
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
            value={dueDate} disabled={isViewMode} onChange={e => setDueDate(e.target.value)} className="soleria-input" style={{ fontSize: '13px', maxWidth: '220px' }} />
              <p className="text-[10px] text-slate-400 leading-tight">
                Blank = no fixed terms, no overdue alert.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Cartons</label>
                <input type="text" value={totalCartons} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-center font-mono font-semibold" style={{ width: '90px' }} />
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
                  disabled={isViewMode}
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
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Rs.</label>
                <input
                  type="text"
                  value={formatCurrency(finalTotalValue)}
                  disabled
                  className="soleria-input soleria-input-compact text-right font-mono font-bold"
                  style={{ width: '140px', color: 'var(--brand-gold)', background: '#111c2a', borderColor: '#334155' }}
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
                  <span className="font-mono font-semibold text-slate-700">{row.bill_no || `#${'bill_id' in row ? row.bill_id : row.draft_id}`}</span>
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
                onClick={() => { setIsFindOpen(false); setFindQuery(''); }}
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
              <input type="text" value={newSubCustomerName} onChange={e => setNewSubCustomerName(e.target.value)} placeholder="Enter sub-customer name..." className="soleria-input font-semibold" autoFocus />
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
                onClick={() => {
                  setIsAddSubCustomerOpen(false);
                  setNewSubCustomerName('');
                  setNewSubCustomerRegionId('');
                  setNewSubCustomerCityId('');
                }}
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
                onClick={() => {
                  setIsAddCustomerOpen(false);
                  setNewCustomerName('');
                  setNewCustomerRegionId('');
                  setNewCustomerCityId('');
                }}
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
            ? `Please enter password for user '${state.currentUsername || 'user'}' to permanently delete this unposted bill.`
            : `Please enter password for user '${state.currentUsername || 'user'}' to save changes to Bill #${billNo || billId || ''}.`
        }
      />
    </AppLayout>
  );
}
