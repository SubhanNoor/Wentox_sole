import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import WeeklyTab from '@/components/WeeklyTab';
import MonthlyTab from '@/components/MonthlyTab';
import OverallTab from '@/components/OverallTab';
import FindTab from '@/components/FindTab';
import { Save, Plus, Trash2, Printer, FileDown, FileSpreadsheet, Edit, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { formatDate, getTodayDate } from '@/lib/utils';
import { focusFirstField } from '@/lib/fieldNav';
import { useHeldKey } from '@/hooks/useHeldKey';
import SearchableSelect from '@/components/SearchableSelect';
import wentoxLogo from '@/assets/wentox_logo.png';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import * as api from '@/lib/api';
import type {
  CustomerRow, SubCustomerRow, ProductRow, ProductVariantRow, StoreRow, AddaRow,
  RegionRow, CityRow, SaleBillRow, SaleBillCreateInput, SaleBillItemInput, StockRow,
  UnpostedBillRow, PostAllResult
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

export default function SaleBillPage({ initialTab = 'billing' }: { initialTab?: 'billing' | 'weekly' | 'monthly' | 'overall' | 'find' }) {
  const { state } = useApp();

  const [activeTab, setActiveTab] = useState<'billing' | 'weekly' | 'monthly' | 'overall' | 'find'>(() => {
    return (state.currentTab as any) || initialTab;
  });

  useEffect(() => {
    if (state.currentTab && ['billing', 'weekly', 'monthly', 'overall', 'find'].includes(state.currentTab)) {
      setActiveTab(state.currentTab as any);
    }
  }, [state.currentTab]);

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
  const [lookupError, setLookupError] = useState('');

  useEffect(() => {
    (async () => {
      const [c, sc, p, st, ad, rg, ct, stRes] = await Promise.all([
        api.listCustomers(), api.listSubCustomers(), api.listProducts(),
        api.listStores(), api.listAddas(), api.listRegions(), api.listCities(),
        api.reports.stock()
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
  const [passwordActionType, setPasswordActionType] = useState<'save_bill' | 'save_and_post' | 'post_bill' | 'delete_unposted_bill' | null>(null);

  // Form State
  const [billId, setBillId] = useState<number | null>(null);
  const [currentBillIsPosted, setCurrentBillIsPosted] = useState(false);
  const [date, setDate] = useState(getTodayDate());
  const [storeId, setStoreId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [subCustomerId, setSubCustomerId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [gpNo, setGpNo] = useState('');
  const [biltyNo, setBiltyNo] = useState('');
  const [addaId, setAddaId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);

  // Line items state
  const [items, setItems] = useState<UiItem[]>([]);

  const [deliveryType, setDeliveryType] = useState<'1' | 'custom'>('1');
  const [customAddress, setCustomAddress] = useState('');
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

  // Drafts
  const [drafts, setDrafts] = useState<SaleBillRow[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);

  const refreshDrafts = useCallback(async () => {
    const res = await api.draftSaleBills.list();
    if (res.ok) setDrafts(res.data);
  }, []);

  // SB-06: bills that are saved but not yet in the ledger, so a run can be entered first and
  // posted in one action at the end. Distinct from `drafts` above: a draft is an incomplete bill
  // that isn't a sale_bills row yet, whereas these are real, complete bills simply awaiting posting.
  const [unpostedBills, setUnpostedBills] = useState<UnpostedBillRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<PostAllResult<'bill_id'> | null>(null);
  // Pending Posting sidebar: which single bill is mid-post (disables just that row's Post button
  // rather than the whole panel).
  const [postingBillId, setPostingBillId] = useState<number | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.saleBills.listUnposted();
    if (res.ok) setUnpostedBills(res.data);
  }, []);

  // One mount effect for both lists rather than one each — they load together and nothing reads
  // either before the other.
  useEffect(() => { refreshDrafts(); refreshUnposted(); }, [refreshDrafts, refreshUnposted]);

  // SB-06: post the whole run. Each bill posts in its own transaction on the backend, so one that
  // can't post leaves the rest posted — which is why this reads `failed` instead of treating a
  // resolved call as "all done". Failures stay unposted and can be fixed and posted again.
  const handlePostAll = async () => {
    setPostAllBusy(true);
    setPostAllResult(null);
    const res = await api.saleBills.postAll();
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
    // Stock moved and the pending list shrank — both have to catch up, and a bill currently open
    // on screen may have just been posted by this run.
    await Promise.all([refreshUnposted(), refreshStock(), refreshDrafts()]);
    if (billId != null && res.data.posted.some(p => p.bill_id === billId)) setCurrentBillIsPosted(true);
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

  // G-01: auto-focus the first field (Date) whenever the billing tab becomes the active view and
  // is editable — this page's entry area isn't wrapped in a <form>, so AppLayout's global
  // auto-focus mechanism (which only looks inside <form> elements) has nothing to find here.
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (activeTab === 'billing' && mode !== 'view') {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [activeTab, mode]);

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
    setItems(loadedItems.length ? loadedItems : [newUiItem()]);

    // Pre-warm the variant cache for each loaded item's article so the picker works immediately if edited
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });
    setErrorMsg('');
  };

  // No password prompt here — Save (handleSave, mode==='edit') already asks for one before the
  // update actually goes through, so gating entry into edit mode too meant asking twice for one
  // edit (reported directly by the user: edit then update each prompted separately).
  const handleEditSpecificBill = async (bill: SaleBillRow) => {
    await loadBillRow(bill);
    setActiveTab('billing');
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

  // Pending Posting sidebar: a bill row only carries the summary fields (UnpostedBillRow), so
  // opening it for edit fetches the full row first, then reuses the same edit path as every other
  // "edit an existing bill" entry point (Weekly/Monthly/Overall/Find tabs).
  const handleOpenUnpostedBill = async (billId: number) => {
    const res = await api.saleBills.get(billId);
    if (!res.ok) {
      setErrorMsg('Failed to load bill: ' + res.error.message);
      return;
    }
    setActiveTab('billing');
    await handleEditSpecificBill(res.data);
  };

  // Posts a single bill straight from the sidebar without loading it into the form — for the
  // common case of "this one's ready, the rest of the run isn't yet". stopPropagation keeps the
  // click from also triggering the row's own open-for-edit handler.
  const handlePostOneUnposted = async (targetBillId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPostingBillId(targetBillId);
    const res = await api.saleBills.post(targetBillId);
    setPostingBillId(null);
    if (!res.ok) {
      setErrorMsg('Failed to post bill: ' + res.error.message);
      return;
    }
    setSuccessMsg(`Bill ${res.data.bill_no} posted.`);
    setTimeout(() => setSuccessMsg(''), 3000);
    await Promise.all([refreshUnposted(), refreshStock(), refreshDrafts()]);
    if (targetBillId === billId) setCurrentBillIsPosted(true);
  };

  // Initialize new bill if mode is new and not set
  useEffect(() => {
    if (activeTab === 'billing' && mode === 'new' && billId === null && stores.length > 0) {
      handleNew();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mode, billId, stores]);

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
    setMode('new');
    // SB-05: a blank form has nothing saved in it yet, so nothing to clear on post.
    createdInThisRun.current = false;
    setSelectedDraftId(null);
    setBillId(null);
    setCurrentBillIsPosted(false);
    setDate(getTodayDate());
    setStoreId(stores[0] ? String(stores[0].store_id) : '');
    setCustomerId('');
    setSubCustomerId('');
    setDeliveryType('1');
    setCustomAddress('');
    setIsAddSubCustomerOpen(false);
    setNewSubCustomerName('');
    setBillNo((Math.floor(Math.random() * 90000) + 10000).toString());
    setGpNo('');
    setBiltyNo('');
    setAddaId('');
    setRemarks('');
    setDueDate('');
    setInvoiceDiscount(0);
    setItems([newUiItem()]);
    setErrorMsg('');
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

  const executeSave = async (password?: string): Promise<SaleBillRow | null> => {
    const payload = buildPayload();
    if (!payload) return null;

    const result = mode === 'edit' && billId != null
      ? await api.saleBills.update(billId, password ? { ...payload, password } : payload)
      : await api.saleBills.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save bill: ' + result.error.message);
      return null;
    }

    setBillId(result.data.bill_id);
    setCurrentBillIsPosted(result.data.is_posted);
    // SB-05: only a freshly created bill counts as "part of this run" — an edit of an existing
    // bill must not clear the form out from under the user when it posts.
    if (mode !== 'edit') createdInThisRun.current = true;
    setSuccessMsg(mode === 'edit' ? 'Sale bill updated successfully.' : 'New sale bill saved successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    setErrorMsg('');
    refreshDrafts();
    refreshStock();
    refreshUnposted(); // SB-06: a newly saved bill joins the pending-posting list immediately.
    return result.data;
  };

  const handleSave = async () => {
    if (mode === 'edit') {
      setPasswordActionType('save_bill');
      setIsPasswordModalOpen(true);
    } else {
      // SB-05: a plain Save is also "done with this bill" — the client's own workflow for a run of
      // bills is save each one as a draft, then Post All at the end (SB-06), so this has to reset
      // too, not only Save & Post. Reported directly by the user after testing the keyboard flow:
      // Enter reached Save correctly, but the form then just sat on the saved bill instead of
      // being ready for the next one.
      const saved = await executeSave();
      if (saved) readyForNextBill();
    }
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

  const saveAndPost = async () => {
    const saved = await executeSave();
    if (saved) {
      const postRes = await api.saleBills.post(saved.bill_id);
      if (!postRes.ok) {
        // Saved but not posted: the bill exists and must stay on screen, so no reset here — the
        // user needs to see which bill failed and press Post again once it's fixed.
        setErrorMsg('Bill was saved, but posting failed: ' + postRes.error.message);
      } else {
        setCurrentBillIsPosted(true);
        // SB-05: name the bill in the message, because the form is about to empty — otherwise the
        // screen clearing is the only feedback that anything was saved at all.
        setSuccessMsg(`Bill ${saved.bill_no} saved & posted. Ready for the next one.`);
        setTimeout(() => setSuccessMsg(''), 3000);
        refreshUnposted(); // SB-06: it just left the pending list.
        if (createdInThisRun.current) readyForNextBill();
      }
    }
  };

  const handlePostCurrentBill = async () => {
    if (billId != null) {
      const postedBillNo = billNo;
      const res = await api.saleBills.post(billId);
      if (!res.ok) {
        setErrorMsg('Failed to post bill: ' + res.error.message);
      } else {
        setCurrentBillIsPosted(true);
        refreshUnposted(); // SB-06: it just left the pending list.
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
    }
  };

  const handleUnpostCurrentBill = async () => {
    if (billId == null) return;
    const res = await api.saleBills.unpost(billId);
    if (!res.ok) {
      setErrorMsg('Failed to unpost bill: ' + res.error.message);
      return;
    }
    setCurrentBillIsPosted(false);
    setSuccessMsg('Bill unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
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
        const res = await api.saleBills.remove(targetId, password);
        if (!res.ok) {
          setErrorMsg('Failed to delete bill: ' + res.error.message);
        } else {
          setSuccessMsg('Bill deleted successfully.');
          setTimeout(() => setSuccessMsg(''), 3000);
          // The bill on screen (if any) may have just been the one deleted — drop back to a
          // fresh form rather than leave it pointing at a bill that no longer exists.
          if (billId === targetId) handleNew();
          await Promise.all([refreshUnposted(), refreshStock()]);
        }
      }
    }
    setPasswordActionType(null);
  };

  // Pending Posting sidebar's Delete button — password-gated (verified server-side), same as
  // editing an already-posted bill: this is destructive and unlike unposting/posting has no
  // reverse-never-erase trail, so it needs the same guard.
  const handleDeleteUnposted = (targetBillId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    pendingDeleteBillId.current = targetBillId;
    setPasswordActionType('delete_unposted_bill');
    setIsPasswordModalOpen(true);
  };

  // handleSaveDraft removed along with the "Save Draft" button. Loading, confirming and deleting
  // existing drafts all still work — only creating a new one from this form is gone. The backend
  // draftSaleBills.create channel is untouched, so restoring the button is just re-adding this.

  const handleConfirmDraft = async () => {
    if (selectedDraftId == null) {
      setErrorMsg('Please select a draft first.');
      setTimeout(() => setErrorMsg(''), 2000);
      return;
    }
    const res = await api.draftSaleBills.confirm(selectedDraftId);
    if (!res.ok) {
      setErrorMsg('Failed to confirm draft: ' + res.error.message);
      return;
    }
    setSelectedDraftId(null);
    await loadBillRow(res.data);
    setMode('view');
    setSuccessMsg('Draft confirmed & posted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshDrafts();
  };

  // Line Items Helper Actions — new rows go to the TOP, not the bottom: the newest article is
  // what the user is looking at and typing into, so it should be the one visible without
  // scrolling down through everything already entered (item table only shows ~2 rows before it
  // scrolls internally — see its wrapper below).
  const handleAddItemRow = () => setItems([newUiItem(), ...items]);

  // Keyboard entry of a whole bill without touching the mouse: G-01's generic Enter-walk already
  // carries a row's own fields forward and hops into the NEXT row correctly (it's a plain DOM-order
  // walk, and the next row's fields are already there to walk into). The one thing it cannot do is
  // create a row that doesn't exist yet — so this only steps in at the boundary, when Enter is
  // pressed on the LAST field of the LAST row: it inserts a blank row at the top and focuses into
  // it, same as WageRunPage's WR-02. Every other Enter press on this grid is left alone.
  //
  // stopPropagation matters here: AppLayout's own window-level Enter handler runs on the same
  // keydown right after this one, reading the SAME e.target — and setItems() hasn't re-rendered
  // yet, so as far as that handler can tell this input is still the form's last field. Without
  // stopPropagation it would also see idx-is-last and, in the same tick, click the Save & Post
  // button — posting a bill in the middle of appending a row to it.
  const articleCellRefs = useRef<(HTMLTableCellElement | null)[]>([]);

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
    // the last field of ANY row (not only the last one) — always inserts at the top, same as the
    // "+ Add Item Row" button, and focuses into the new row. Shift+Enter is distinct from its
    // other meaning inside a Remarks textarea (insert a literal newline) — different field, no
    // collision.
    if (e.key !== 'Enter' || !(e.shiftKey || e.ctrlKey || periodHeld.current)) return;
    e.preventDefault();
    e.stopPropagation(); // stop AppLayout's own Enter handler from also walking this keystroke
    handleAddItemRow();
    requestAnimationFrame(() => focusFirstField(articleCellRefs.current[0])); // new row is always index 0 now
  }

  // A bill always needs at least one row to type into, so deleting the last remaining one clears
  // its fields back to blank instead of removing the row itself (keeping its uid, so the row
  // doesn't remount and lose focus).
  const handleRemoveItemRow = (idx: number) => {
    if (items.length <= 1) {
      setItems(prev => prev.map((it, i) => i === idx ? { ...newUiItem(), uid: it.uid } : it));
      return;
    }
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleArticleChange = async (idx: number, articleIdStr: string) => {
    const articleId = articleIdStr ? Number(articleIdStr) : null;
    const product = articleId != null ? products.find(p => p.article_id === articleId) : undefined;
    setItems(prev => prev.map((it, i) => i === idx ? recalcItem({
      ...it,
      articleId,
      variantId: null,
      label: product?.name || '',
      packing: product?.packing || 0,
      rate: product?.sale_price ?? it.rate
    }) : it));
    if (articleId != null) await fetchVariants(articleId);
  };

  const handleVariantChange = (idx: number, variantIdStr: string) => {
    const item = items[idx];
    if (item.articleId == null) return;
    const variantId = variantIdStr ? Number(variantIdStr) : null;
    const variant = variantsByArticle[item.articleId]?.find(v => v.variant_id === variantId);
    const product = products.find(p => p.article_id === item.articleId);
    setItems(prev => prev.map((it, i) => i === idx ? recalcItem({
      ...it,
      variantId,
      label: variant ? `${product?.name || ''} — ${variant.color}` : (product?.name || ''),
      packing: variant?.packing ?? product?.packing ?? it.packing,
      rate: product?.sale_price ?? it.rate
    }) : it));
  };

  const updateNumericField = (idx: number, field: 'cartons' | 'rate' | 'discountPercent' | 'discountValue', val: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      let next = { ...item, [field]: val };
      const gross = next.cartons * next.packing * next.rate;
      if (field === 'discountValue') {
        next.discountPercent = gross > 0 ? parseFloat(((val / gross) * 100).toFixed(1)) : 0;
      }
      return recalcItem(next);
    }));
  };

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
  // headerAction slot), not as a separate row inside the content area, so the content below the
  // Quick Menu bar starts immediately at the Pending Posting / Save-Post row instead of losing a
  // whole row's height to a tab bar first.
  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('billing'); handleNew(); }}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'billing' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Sale Bill
      </button>
      <button
        onClick={() => setActiveTab('weekly')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'weekly' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Weekly Records
      </button>
      <button
        onClick={() => setActiveTab('monthly')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'monthly' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Monthly Records
      </button>
      <button
        onClick={() => setActiveTab('overall')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'overall' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Overall Records
      </button>
      <button
        onClick={() => setActiveTab('find')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
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

        {/* SB-06: Pending Posting — a flat vertical list of every unposted bill (no customer
            grouping), pinned outside the card's own left edge rather than inside its layout, so
            it can never change the card's width/position: it's `absolute`, anchored via
            `right: calc(100% + gap)` to the LEFT edge of this very `relative` wrapper (the card's
            own boundary), not to the viewport or a guessed margin — wherever the card's edge
            actually lands, this sits just outside it, and being `absolute` it's out of flow, so
            it has zero effect on the card. Only shown from `2xl` up, since below that there
            usually isn't 280px of real margin free for it to land in without spilling past the
            window edge. Clicking a bill opens it in the form for editing (same password-gated
            path as every other edit entry point); the small Post button on a row posts just that
            bill without leaving the list. "Post All" is unchanged. */}
        {(unpostedBills.length > 0 || postAllResult) && (
          <aside
            className="hidden 2xl:block absolute top-0 w-64 space-y-3"
            style={{ right: 'calc(100% + 24px)' }}
            data-no-print
          >
            <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-slate-700">Pending Posting</span>
                <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                  {unpostedBills.length}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-3">
                {unpostedBills.length > 0 && `Total ${formatCurrency(unpostedBills.reduce((s, b) => s + Number(b.net_value), 0))}`}
              </div>
              {unpostedBills.length > 0 && (
                <button
                  type="button"
                  onClick={handlePostAll}
                  disabled={postAllBusy}
                  className="w-full px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {postAllBusy ? 'Posting…' : `Post All (${unpostedBills.length})`}
                </button>
              )}

              {/* The result stays on screen until dismissed — a run can post 18 of 20 bills, and
                  the two that failed are the whole point of the message. */}
              {postAllResult && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  <p className="text-xs font-semibold text-slate-700">
                    {postAllResult.posted.length} of {postAllResult.attempted} posted
                    {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                  </p>
                  {postAllResult.failed.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {postAllResult.failed.map(f => (
                        <li key={f.bill_id} className="text-xs text-rose-700">
                          <span className="font-mono font-semibold">{f.bill_no || `#${f.bill_id}`}</span>
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

            {/* Flat list — every unposted bill, oldest first (same order the backend returns). */}
            {unpostedBills.length > 0 && (
              <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                {unpostedBills.map(b => (
                  <li
                    key={b.bill_id}
                    onClick={() => handleOpenUnpostedBill(b.bill_id)}
                    className="px-3 py-2.5 text-xs flex items-center justify-between gap-2 cursor-pointer hover:bg-amber-50/60 transition-colors border-b border-slate-100 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-slate-700">{b.bill_no || `#${b.bill_id}`}</div>
                      <div className="text-slate-400 truncate">{b.customer_name || 'Unnamed Customer'}</div>
                      <div className="text-slate-400">{formatDate(b.bill_date)} · {formatCurrency(Number(b.net_value))}</div>
                    </div>
                    <div className="flex-shrink-0 flex flex-row items-center gap-1">
                      <button
                        type="button"
                        title="Post this bill"
                        onClick={(e) => handlePostOneUnposted(b.bill_id, e)}
                        disabled={postingBillId === b.bill_id}
                        className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                      <button
                        type="button"
                        title="Delete this bill (password required)"
                        onClick={(e) => handleDeleteUnposted(b.bill_id, e)}
                        disabled={postingBillId === b.bill_id}
                        className="p-1.5 rounded-md bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        {/* Tab contents (records & find) */}
        <div>
          {activeTab === 'weekly' && <WeeklyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'monthly' && <MonthlyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'overall' && <OverallTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'find' && <FindTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
        </div>

        <form onSubmit={e => e.preventDefault()} className={activeTab === 'billing' ? 'block' : 'hidden'}>

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

        {/* Drafts Loader Panel */}
        {mode !== 'view' && drafts.length > 0 && (
          <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-sm" data-no-print>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Saved Drafts:</span>
              <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold">
                {drafts.length} incomplete bill(s)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={selectedDraftId ?? ''}
                onChange={e => {
                  const draftId = e.target.value ? Number(e.target.value) : null;
                  setSelectedDraftId(draftId);
                  const selected = drafts.find(d => d.bill_id === draftId);
                  if (selected) {
                    loadBillRow(selected);
                    setMode('new');
                  }
                }}
                className="soleria-input py-1 px-2.5 text-xs bg-white border cursor-pointer font-medium"
                style={{ width: '220px' }}
              >
                <option value="">Select a draft to load...</option>
                {drafts.map(d => {
                  const custName = customers.find(c => c.customer_id === d.customer_id)?.name || 'Unnamed Customer';
                  return (
                    <option key={d.bill_id} value={d.bill_id}>
                      {d.bill_no || 'No Number'} - {custName} ({formatDate(d.bill_date)})
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={handleConfirmDraft}
                className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold transition-colors"
              >
                Confirm Draft (Post)
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (selectedDraftId != null) {
                    await api.draftSaleBills.remove(selectedDraftId);
                    setSelectedDraftId(null);
                    handleNew();
                    refreshDrafts();
                    setSuccessMsg('Draft deleted successfully.');
                    setTimeout(() => setSuccessMsg(''), 2000);
                  } else {
                    setErrorMsg('Please select a draft first.');
                    setTimeout(() => setErrorMsg(''), 2000);
                  }
                }}
                className="text-xs text-rose-600 hover:text-rose-800 font-semibold transition-colors"
              >
                Delete Selected Draft
              </button>
            </div>
          </div>
        )}


        {/* Toolbar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          {/* Every action always renders (ref-pic style) — only `disabled` changes per state,
              instead of whole button groups mounting/unmounting per `mode`. */}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleNew} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none">
              New Bill
            </button>
            <button
              type="submit"
              onClick={handleSave}
              disabled={mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm font-inter disabled:pointer-events-none ${
                mode !== 'view' && isNecessaryFieldsFilled && !hasStockExceeded
                  ? 'bg-[#111c2a] text-[#B08D57] border border-[#B08D57] cursor-pointer hover:bg-[#1a293d]'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
              }`}
            >
              <Save size={16} /> {mode === 'edit' ? 'Update Bill' : 'Save Bill'}
            </button>
            <button
              type="button"
              onClick={handleSaveAndPost}
              disabled={mode === 'view' || !isNecessaryFieldsFilled || hasStockExceeded || currentBillIsPosted}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Save &amp; Post
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              disabled={mode !== 'edit'}
              className="btn-outline px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Cancel Edit
            </button>
            <button
              type="button"
              onClick={handleEditCurrentBill}
              disabled={mode !== 'view' || billId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <Edit size={16} /> Edit Bill
            </button>
            <button
              type="button"
              onClick={handlePostCurrentBill}
              disabled={mode !== 'view' || billId == null || currentBillIsPosted}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Post Bill
            </button>
            <button
              type="button"
              onClick={handleUnpostCurrentBill}
              disabled={mode !== 'view' || billId == null || !currentBillIsPosted}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Unpost Bill
            </button>
            <button
              type="button"
              onClick={() => {
                setIsPrintingSingle(true);
                setTimeout(() => { window.print(); setIsPrintingSingle(false); }, 100);
              }}
              disabled={mode !== 'view' || billId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <Printer size={16} /> Print Invoice
            </button>
            <button
              type="button"
              onClick={() => exportToPDF()}
              disabled={mode !== 'view' || billId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <FileDown size={16} /> Export PDF
            </button>
            <button
              type="button"
              onClick={() => {
                const headers = ['Article', 'Packing', 'Cartons', 'Pairs', 'Rate', 'D%', 'D. Value', 'Total Value'];
                const rows = items.map(it => [it.label, it.packing, it.cartons, it.pairs, it.rate, it.discountPercent, it.discountValue, it.value]);
                exportRowsToExcel(`sale-bill-${billNo || billId}`, headers, rows);
              }}
              disabled={mode !== 'view' || billId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <FileSpreadsheet size={16} /> Export Excel
            </button>
          </div>

          {mode === 'edit' && (
            <div className="text-sm font-semibold text-slate-500 font-inter">
              Editing System Invoice: <span className="font-mono text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">{billId ?? 'New'}</span>
            </div>
          )}

          {mode === 'view' && (
            <div className="text-sm font-semibold text-emerald-600 font-inter flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping text-[10px]"></span>
              Bill {currentBillIsPosted ? 'Posted' : 'Saved'} Successfully!
            </div>
          )}
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

          {/* Header fields — one dense grid, label-left per field (matches the legacy app's
              layout), instead of stacked label-above-input fields split across bordered cards. */}
          <div className="shrink-0 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 mb-2 pb-2 border-b" style={{ borderColor: 'var(--border-table)' }}>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                System No.
              </label>
              <input type="text" value={billId ?? 'Unsaved'} disabled className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200" />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="date" ref={firstFieldRef}
            value={date} disabled={isViewMode} onChange={e => setDate(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                From Store <span className="text-red-500 font-bold">*</span>
              </label>
              {/* Was a native <select>. SearchableSelect so this field behaves like every other
                  lookup on the screen: focus it and type, Enter selects and moves on. */}
              <SearchableSelect
                options={storeOptions}
                value={storeId}
                onChange={setStoreId}
                placeholder="Select store..."
                searchPlaceholder="Search stores..."
                disabled={isViewMode}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Manual Bill No. <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="text" value={billNo} disabled={isViewMode} onChange={e => setBillNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>

            <div className="flex items-center gap-2 md:col-span-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="flex-1">
                <SearchableSelect
                  options={customerOptions}
                  value={customerId}
                  onChange={(val) => {
                    setCustomerId(val);
                    setDeliveryType('1');
                    setSubCustomerId('');
                    setCustomAddress('');
                  }}
                  placeholder="Select customer..."
                  searchPlaceholder="Search customer by name..."
                  disabled={isViewMode}
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
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer Code
              </label>
              <input type="text" value={customerId} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Delivery
              </label>
              <select
                value={isCustomDelivery ? 'custom' : '1'}
                disabled={isViewMode}
                onChange={e => {
                  const val = e.target.value as '1' | 'custom';
                  setDeliveryType(val);
                  if (val === '1') {
                    setSubCustomerId('');
                    setCustomAddress('');
                  } else {
                    setSubCustomerId(subCustomers[0] ? String(subCustomers[0].sub_customer_id) : '');
                  }
                }}
                className="soleria-input soleria-input-compact cursor-pointer"
              >
                <option value="1">SAME (Direct)</option>
                <option value="custom">Custom Agent / Sub-Customer</option>
              </select>
            </div>
            {isCustomDelivery && (
              <div className="flex items-center gap-2">
                <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Sub-Customer <span className="text-red-500 font-bold">*</span>
                </label>
                <div className="flex-1">
                  <SearchableSelect
                    options={subCustomers.map(sc => ({ value: String(sc.sub_customer_id), label: sc.name }))}
                    value={subCustomerId}
                    onChange={setSubCustomerId}
                    placeholder="Select sub-customer..."
                    searchPlaceholder="Search sub-customers..."
                    disabled={isViewMode}
                  />
                </div>
                {!isViewMode && (
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
            )}
            {isCustomDelivery && (
              <div className="flex items-center gap-2 md:col-span-2">
                <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Custom Address
                </label>
                <input type="text" value={customAddress} disabled={isViewMode} onChange={e => setCustomAddress(e.target.value)} placeholder="Enter custom delivery address..." className="soleria-input soleria-input-compact" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Transport Adda
              </label>
              <SearchableSelect
                options={addaOptions}
                value={addaId}
                onChange={setAddaId}
                placeholder="Select Adda..."
                searchPlaceholder="Search Adda..."
                disabled={isViewMode}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Gate Pass No.
              </label>
              <input type="text" value={gpNo} disabled={isViewMode} onChange={e => setGpNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Bilty No.
              </label>
              <input type="text" value={biltyNo} disabled={isViewMode} onChange={e => setBiltyNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
          </div>

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

          {/* Product Items Table — flex-1 so it grows to fill whatever space invoiceCardHeight
              (above) leaves after every other section takes its natural size; this is what pins
              the footer to the bottom of the screen instead of trailing off after just 2-3 rows.
              `min-height: 0` overrides flexbox's default min-height:auto, which would otherwise
              let this box's own content (as it grows past the flex space) stretch the whole card
              instead of scrolling internally. The header row is `sticky` within this scroll box
              so it stays visible past the first screenful of rows. SearchableSelect's own dropdown
              is rendered via a `fixed`-position React portal (see its source), so it isn't clipped
              by this box's `overflow-y: auto` even when a select near the bottom edge is opened. */}
          <div className="flex-1 min-h-0 mb-2 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ minWidth: '190px' }}>Article <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ width: '130px', minWidth: '110px' }}>Color <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ minWidth: '110px' }}>Stock in Hand</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px', minWidth: '76px' }}>Cartons <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px', minWidth: '64px' }}>Pairs</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '110px', minWidth: '96px' }}>Rate <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '100px', minWidth: '72px' }}>D%</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '110px' }}>D. Value</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '130px' }}>Value</th>
                  {!isViewMode && <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '50px' }}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const variantOptions = (item.articleId != null ? variantsByArticle[item.articleId] || [] : [])
                    .map(v => ({ value: String(v.variant_id), label: v.color }));
                  return (
                    <tr key={item.uid} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      {/* Article select */}
                      <td className="p-1 pl-3" ref={el => { articleCellRefs.current[idx] = el; }}>
                        {isViewMode ? (
                          <span className="font-semibold text-slate-800 text-[13px] pl-2">{item.label || 'N/A'}</span>
                        ) : (
                          <SearchableSelect
                            options={products.map(p => ({ value: String(p.article_id), label: `${p.name} (${p.code})` }))}
                            value={item.articleId != null ? String(item.articleId) : ''}
                            onChange={val => handleArticleChange(idx, val)}
                            placeholder="Select article..."
                            searchPlaceholder="Search articles..."
                          />
                        )}
                      </td>

                      {/* Color / Variant select */}
                      <td className="p-1 pl-3">
                        {isViewMode ? (
                          <span className="text-slate-600 text-[13px]">{variantOptions.find(v => v.value === String(item.variantId))?.label || '-'}</span>
                        ) : (
                          <SearchableSelect
                            options={variantOptions}
                            value={item.variantId != null ? String(item.variantId) : ''}
                            onChange={val => handleVariantChange(idx, val)}
                            placeholder="Color..."
                            searchPlaceholder="Search colors..."
                            disabled={item.articleId == null}
                          />
                        )}
                      </td>

                      {/* Packing */}
                      <td className="p-1 text-center font-mono text-sm text-slate-600">
                        {item.packing || '-'}
                      </td>

                      {/* Stock in Hand — Cartons & Pairs, one line */}
                      <td className="p-1 text-center font-mono">
                        {(() => {
                          const stockInfo = getStockInfo(item.articleId, item.variantId);
                          if (!stockInfo) return <span className="text-slate-400 text-xs">—</span>;
                          const hasStock = stockInfo.cartons > 0 || stockInfo.pairs > 0;
                          return (
                            <span className={`text-xs whitespace-nowrap ${hasStock ? 'text-slate-700' : 'text-rose-500'}`} title="Current Stock in Hand">
                              <span className="font-bold">{stockInfo.cartons}</span> Ctn / <span className="font-bold">{stockInfo.pairs}</span> Prs
                            </span>
                          );
                        })()}
                      </td>

                      {/* Cartons */}
                      <td className="p-1">
                        <input
                          type="number"
                          value={item.cartons || ''}
                          disabled={isViewMode}
                          min={1}
                          onChange={e => updateNumericField(idx, 'cartons', parseInt(e.target.value) || 0)}
                          className={`soleria-input soleria-input-compact text-center font-mono ${
                            stockExceededRows[item.uid] ? 'border-2 border-red-500 bg-rose-50 text-red-700 font-bold focus:ring-2 focus:ring-red-300' : ''
                          }`}
                          style={{ border: isViewMode ? (stockExceededRows[item.uid] ? '2 border-red-500' : 'none') : undefined, background: isViewMode ? (stockExceededRows[item.uid] ? '#fef2f2' : 'transparent') : undefined }}
                        />
                        {stockExceededRows[item.uid] && (
                          <div className="text-[10px] font-bold text-red-600 mt-0.5 flex items-center justify-center gap-1 animate-in fade-in" title="Requested cartons exceed available stock in hand">
                            <AlertTriangle size={11} className="shrink-0 text-red-500" />
                            <span>Exceeds Stock! (Max: {stockExceededRows[item.uid].available} Ctn)</span>
                          </div>
                        )}
                      </td>

                      {/* Pairs */}
                      <td className="p-1 text-center font-mono text-sm font-semibold text-slate-700">
                        {item.pairs || '-'}
                      </td>

                      {/* Rate */}
                      <td className="p-1">
                        <input
                          type="number"
                          value={item.rate || ''}
                          disabled={isViewMode}
                          min={0}
                          onChange={e => updateNumericField(idx, 'rate', parseInt(e.target.value) || 0)}
                          className="soleria-input soleria-input-compact text-right font-mono"
                          style={{ border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Discount % */}
                      <td className="p-1">
                        <input
                          type="number"
                          value={item.discountPercent || ''}
                          disabled={isViewMode}
                          min={0}
                          max={100}
                          onChange={e => updateNumericField(idx, 'discountPercent', parseFloat(e.target.value) || 0)}
                          onKeyDown={handleLastFieldKeyDown}
                          className="soleria-input soleria-input-compact text-center font-mono"
                          style={{ border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Discount Value — Calculated from Discount % */}
                      <td className="p-1 text-right font-mono text-xs font-semibold text-slate-700">
                        {item.discountValue > 0 ? item.discountValue.toLocaleString() : '-'}
                      </td>

                      {/* Row Total Value */}
                      <td className="p-1 text-right font-mono font-semibold text-sm" style={{ color: 'var(--brand-gold)' }}>
                        {formatCurrency(item.value)}
                      </td>

                      {/* Delete Action */}
                      {!isViewMode && (
                        <td className="p-1 text-center">
                          <button type="button" onClick={() => handleRemoveItemRow(idx)} className="text-red-500 hover:text-red-700 p-1" title="Remove row (clears fields if it's the last one)">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add Row Button */}
          {!isViewMode && (
            <button type="button" onClick={handleAddItemRow} className="shrink-0 btn-dashed flex items-center gap-1 mb-2 px-3 py-1">
              <Plus size={14} /> Add Item Row
            </button>
          )}

          {/* Bottom Section: Remarks & Calculations — pinned to the bottom of the screen by the
              item table's flex-1 above (see invoiceCardHeight). Kept compact (small textarea,
              tight gaps) in its own right too — the due-date helper text was the one line worth
              dropping entirely rather than shrinking further, since the field label + optional
              tag already say enough. */}
          <div className="shrink-0 grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            {/* Remarks / Notes, with Payment Due Date stacked directly beneath it */}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-1">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Remarks / Notes
                </label>
                <textarea
                  value={remarks}
                  disabled={isViewMode}
                  onChange={e => setRemarks(e.target.value)}
                  placeholder="Enter any sales remarks..."
                  className="soleria-input w-full font-inter"
                  rows={2}
                  style={{ fontSize: '13px', resize: 'none', minHeight: '52px' }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Payment Due Date <span className="text-slate-400 font-normal normal-case">— optional</span>
                </label>
                <input type="date"
              value={dueDate} disabled={isViewMode} onChange={e => setDueDate(e.target.value)} className="soleria-input" style={{ fontSize: '13px' }} />
                <p className="text-[10px] text-slate-400 leading-tight">
                  Blank = no fixed terms, no overdue alert.
                </p>
              </div>
            </div>

            {/* Calculations Box */}
            <div className="flex flex-col justify-between p-2 rounded-lg border transition-all bg-[#111c2a] text-white border-slate-800 shadow-md">
              <div className="text-xs font-semibold uppercase tracking-wider border-b pb-1 mb-1.5 text-slate-400 border-slate-800">
                Calculations
              </div>
              <div className="flex flex-col gap-1 font-inter text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Cartons:</span>
                  <span className="font-semibold font-mono">{totalCartons}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Pairs:</span>
                  <span className="font-semibold font-mono">{totalPairs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gross Total:</span>
                  <span className="font-semibold font-mono">{formatCurrency(itemsTotalValue)}</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-slate-400">Inv. Discount:</span>
                  {isViewMode ? (
                    <span className="font-semibold font-mono">{formatCurrency(invoiceDiscount)}</span>
                  ) : (
                    <input
                      type="number"
                      value={invoiceDiscount || ''}
                      onChange={e => setInvoiceDiscount(Math.max(0, parseInt(e.target.value) || 0))}
                      className="soleria-input text-right font-mono py-0.5 px-2 border focus:ring-amber-500"
                      style={{ width: '85px', fontSize: '12px', background: '#111c2a', color: '#ffffff', borderColor: '#334155' }}
                    />
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center border-t pt-1.5 mt-1.5 border-[#1e293b]">
                <span className="font-bold text-[11px] uppercase tracking-wider text-slate-400">Net Amount:</span>
                <span className="text-xl font-bold font-mono text-[#B08D57] font-extrabold">
                  {formatCurrency(finalTotalValue)}
                </span>
              </div>
            </div>
          </div>

        </div>
        </form>

      </div>

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
