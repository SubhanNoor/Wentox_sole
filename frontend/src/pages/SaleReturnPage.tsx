import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import WeeklyReturnTab from '@/components/WeeklyReturnTab';
import MonthlyReturnTab from '@/components/MonthlyReturnTab';
import OverallReturnTab from '@/components/OverallReturnTab';
import FindReturnTab from '@/components/FindReturnTab';
import {
  Save, Plus, Trash2, Printer, FileDown, FileSpreadsheet, Edit, CheckCircle2,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, LogOut, Search, X, Undo2,
  PackageCheck, ChevronDown
} from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { formatDate, getTodayDate } from '@/lib/utils';
import { focusFirstField, focusNextField } from '@/lib/fieldNav';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal from '@/components/SearchModal';
import wentoxLogo from '@/assets/wentox_logo.png';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import * as api from '@/lib/api';
import type {
  CustomerRow, SubCustomerRow, ProductRow, ProductVariantRow, StoreRow, AddaRow,
  SaleReturnRow, SaleReturnCreateInput, SaleReturnItemInput,
  DraftSaleReturnRow, ConfirmAllResult, SaleBillRow, SaleBillItemRow
} from '@/lib/api';

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
  const pairs = item.cartons * item.packing;
  const gross = pairs * item.rate;
  const discountValue = Math.round(gross * (item.discountPercent / 100));
  const value = Math.max(0, gross - discountValue);
  return { ...item, pairs, discountValue, value };
}

export default function SaleReturnPage({ initialTab = 'return' }: { initialTab?: 'return' | 'weekly' | 'monthly' | 'overall' | 'find' }) {
  const { state, dispatch } = useApp();

  const [activeTab, setActiveTab] = useState<'return' | 'weekly' | 'monthly' | 'overall' | 'find'>(initialTab);

  // ── Real lookup data ──
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [variantsByArticle, setVariantsByArticle] = useState<Record<number, ProductVariantRow[]>>({});
  const [lookupError, setLookupError] = useState('');

  useEffect(() => {
    (async () => {
      const [c, sc, p, st, ad] = await Promise.all([
        api.listCustomers(), api.listSubCustomers(), api.listProducts(), api.listStores(), api.listAddas()
      ]);
      const failures: string[] = [];
      if (c.ok) setCustomers(c.data); else failures.push(c.error.message);
      if (sc.ok) setSubCustomers(sc.data); else failures.push(sc.error.message);
      if (p.ok) setProducts(p.data); else failures.push(p.error.message);
      if (st.ok) setStores(st.data); else failures.push(st.error.message);
      if (ad.ok) setAddas(ad.data); else failures.push(ad.error.message);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
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

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');

  // Password Modal Protection State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordActionType, setPasswordActionType] = useState<'edit_return' | 'save_return' | 'save_and_post' | 'post_return' | 'delete_unposted_return' | null>(null);

  // Form State
  const [returnId, setReturnId] = useState<number | null>(null);
  const [currentReturnIsPosted, setCurrentReturnIsPosted] = useState(false);
  const [date, setDate] = useState(getTodayDate());
  const [storeId, setStoreId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [subCustomerId, setSubCustomerId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [gpNo, setGpNo] = useState('');
  const [biltyNo, setBiltyNo] = useState('');
  const [addaId, setAddaId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);

  // Line items state
  const [items, setItems] = useState<UiItem[]>([]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isPrintingSingle, setIsPrintingSingle] = useState(false);

  const selectedCustomer = useMemo(() => customers.find(c => c.customer_id === Number(customerId)), [customers, customerId]);

  const sortedCustomers = useMemo(() => [...customers].sort((a, b) => a.name.localeCompare(b.name)), [customers]);

  // Option lists for the fields converted off native <select>. citiesInRegion keeps the dependent
  // filtering the select had: pick a region and the city list narrows to it, no region means all.
  const storeOptions = useMemo(
    () => stores.map(st => ({ value: String(st.store_id), label: st.name })),
    [stores]
  );
  const customerOptions = useMemo(
    () => sortedCustomers.map(c => ({ value: String(c.customer_id), label: c.name })),
    [sortedCustomers]
  );

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
    if (isViewMode || isCopiedFromBill) return;
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
      if (isViewMode || isCopiedFromBill) return;
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
    if (isViewMode || isCopiedFromBill) return;
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
      if (isViewMode || isCopiedFromBill) return;
      setSubCustModalSeed(subCustSearchText);
      setIsSubCustModalOpen(true);
    }
  }

  // Transport Adda — same typable pattern, replacing SearchableSelect's rounded dropdown.
  const addaTriggerRef = useRef<HTMLInputElement>(null);
  const [isAddaModalOpen, setIsAddaModalOpen] = useState(false);
  const [addaSearchText, setAddaSearchText] = useState('');
  const [addaModalSeed, setAddaModalSeed] = useState('');
  const addaOptions = useMemo(
    () => addas.map(ad => ({ value: String(ad.adda_id), label: ad.name })),
    [addas]
  );
  useEffect(() => {
    const opt = addaOptions.find(o => o.value === addaId);
    setAddaSearchText(opt?.label ?? '');
  }, [addaId, addaOptions]);
  const openAddaModal = () => {
    if (isViewMode || isCopiedFromBill) return;
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
      if (isViewMode || isCopiedFromBill) return;
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
  }, []);

  useEffect(() => { refreshDrafts(); }, [refreshDrafts]);

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

    setReturnId(row.return_id);
    setCurrentReturnIsPosted(row.is_posted);
    setDate(row.return_date.slice(0, 10));
    setStoreId(row.store_id != null ? String(row.store_id) : '');
    setCustomerId(String(row.customer_id));
    setSubCustomerId(row.sub_customer_id != null ? String(row.sub_customer_id) : '');
    setBillNo(row.bill_no);
    setGpNo(row.gp_no || '');
    setBiltyNo(row.bilty_no || '');
    setAddaId(String(row.adda_id));
    setRemarks(row.remarks || '');
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
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });
    // Same reasoning as loadDraftIntoForm below — a saved return carries no record of which
    // original bill it might have been linked to, so reopening it is always unlocked/manual.
    setCopyFromBillId('');
    setSourceBillItems([]);
    setErrorMsg('');
  };

  // ── Record navigation: First/Pre./Next/Last + Posted/Unposted dropdown — same mechanism as
  // SaleBillPage. The dropdown is a REAL data filter: 'posted' pages through confirmed returns
  // (dbo.sale_returns), 'unposted' through saved-but-not-yet-posted drafts (dbo.draft_sale_returns).
  // See SaleBillPage's own comment for why this departs from pages_design.md §3.
  const [browseFilter, setBrowseFilter] = useState<'posted' | 'unposted'>('posted');
  const [postedReturns, setPostedReturns] = useState<SaleReturnRow[]>([]);

  const refreshPostedReturns = useCallback(async () => {
    const res = await api.saleReturns.list();
    if (res.ok) setPostedReturns(res.data);
  }, []);

  useEffect(() => { refreshPostedReturns(); }, [refreshPostedReturns]);

  // Both list() calls return newest-first — reversed for oldest-first, so First = earliest.
  const navPostedList = useMemo(() => [...postedReturns].reverse(), [postedReturns]);
  const navUnpostedList = useMemo(() => [...drafts].reverse(), [drafts]);

  // Whichever list the dropdown selects — this is what the nav buttons page through.
  const navList = browseFilter === 'posted' ? navPostedList : navUnpostedList;

  // -1 when the return on screen isn't in the ACTIVE list (unsaved, or a draft while the dropdown
  // is on Posted and vice versa); the handlers treat that as "start from the beginning".
  const navIndex = useMemo(() => {
    if (returnId == null) return -1;
    return browseFilter === 'posted'
      ? (currentReturnIsPosted ? navPostedList.findIndex(r => r.return_id === returnId) : -1)
      : (!currentReturnIsPosted ? navUnpostedList.findIndex(r => r.draft_id === returnId) : -1);
  }, [returnId, currentReturnIsPosted, browseFilter, navPostedList, navUnpostedList]);

  const canBrowse = navList.length > 0;
  const canNavPrevious = canBrowse && navIndex !== 0;
  const canNavNext = canBrowse && navIndex !== navList.length - 1;

  // Posted rows come from sale_returns, unposted ones from draft_sale_returns — each needs its
  // own loader. Both open read-only; Edit stays a separate deliberate click.
  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    if (browseFilter === 'posted') {
      await loadReturnRow(navList[idx] as SaleReturnRow);
      setMode('view');
    } else {
      loadDraftIntoForm(navList[idx] as DraftSaleReturnRow, { mode: 'view' });
    }
  };

  const handleFirst = () => goToNavIndex(0);
  const handlePrev = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);
  const handleLast = () => goToNavIndex(navList.length - 1);

  // Toolbar's Find button — a quick jump to any return (posted or unposted) by bill number or
  // customer name, searched client-side over the already-loaded browse lists.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
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
      loadDraftIntoForm(row as DraftSaleReturnRow);
      setMode('view');
    }
  };

  // ── Original Sale Bill linkage (2026-08-26, per the user — same architecture as
  // PurchaseReturnPage's isCopiedFromPurchase/sourcePurchaseItems, adapted stronger per this
  // page's own spec): "Manual entry" (default) vs picking an actual bill to return against.
  //
  // - Manual entry + typing a Manual Invoice No. that matches a posted Sale Bill's own bill_no
  //   (on blur): ALL master fields auto-fill FROM that bill and lock (non-editable) — Store,
  //   Customer, Delivery Agent, Adda, GP No., Bilty No., Remarks — so they can't quietly drift
  //   from the document being returned. Articles are still added one at a time by hand below;
  //   each is checked against the matched bill's own items (by variant) as it's picked, and takes
  //   that line's exact rate — non-editable — while cartons stays free to type (a return can be
  //   partial).
  // - Picking an actual bill via "Find Bill to Return" instead: same field-lock, but ALSO copies
  //   every one of that bill's items in at once (still individually re-editable/removable, still
  //   validated+priced against the source if touched).
  //
  // Both paths funnel through this one function — `copyItems` is the only difference between them.
  const [copyFromBillId, setCopyFromBillId] = useState('');
  const [sourceBillItems, setSourceBillItems] = useState<SaleBillItemRow[]>([]);
  const isCopiedFromBill = !!copyFromBillId;

  const [priorBills, setPriorBills] = useState<SaleBillRow[]>([]);
  useEffect(() => {
    (async () => {
      const res = await api.saleBills.list();
      if (res.ok) setPriorBills(res.data);
    })();
  }, []);
  const priorBillOptions = useMemo(() => priorBills.map(b => ({
    value: String(b.bill_id),
    label: `#${b.bill_id} · ${b.bill_no || 'No Bill No.'} · ${formatDate(b.bill_date)} — ${formatCurrency(b.net_value)}`
  })), [priorBills]);

  const handleCopyFromBill = async (billIdStr: string, copyItems: boolean) => {
    setCopyFromBillId(billIdStr);
    if (!billIdStr) {
      setSourceBillItems([]);
      return;
    }
    const res = await api.saleBills.get(Number(billIdStr));
    if (!res.ok) {
      setErrorMsg('Failed to load original bill: ' + res.error.message);
      return;
    }
    const bill = res.data;
    // Manual Invoice No. itself has to reflect whichever bill is now linked too — picking one via
    // "Find Bill to Return" (copyItems=true) previously left this field untouched/blank, so typing
    // over it afterward had nothing correct to compare against (per the user, 2026-08-26: "when I
    // select specific it did not fill the invoice number"). The manual-match path (copyItems=false)
    // already got here BECAUSE this field held the matching text, so this is a no-op there.
    setBillNo(bill.bill_no);
    setStoreId(bill.store_id != null ? String(bill.store_id) : '');
    setCustomerId(String(bill.customer_id));
    setSubCustomerId(bill.sub_customer_id != null ? String(bill.sub_customer_id) : '');
    setGpNo(bill.gp_no || '');
    setBiltyNo(bill.bilty_no || '');
    setAddaId(String(bill.adda_id));
    setRemarks(`Return from Sale Bill No. ${bill.bill_no}`);
    setInvoiceDiscount(bill.invoice_discount || 0);
    setSourceBillItems(bill.items);

    if (copyItems) {
      // Explicit "Find Bill to Return" pick — every item copies in at once, same as the master
      // fields (per the user: "if user select non manual and any bill then all the articles
      // appear along with every field").
      const mappedItems: UiItem[] = bill.items.map(it => {
        const article = products.find(p => p.code === it.article_code);
        return recalcItem({
          uid: 'row_' + Date.now() + '_' + it.item_id,
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
        });
      });
      setItems(mappedItems);
      mappedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });
    } else {
      // Manual entry, auto-matched by typed Manual Invoice No. — master fields only; articles
      // are still added one at a time through the entry strip below, each checked against
      // sourceBillItems (see articleAgainstBillError).
      setItems([]);
    }
    setEntry(newUiItem());
    setEditingIndex(null);
    setSuccessMsg(`Linked to Sale Bill No. ${bill.bill_no}${copyItems ? ' — items copied' : ' — master fields filled, add articles below'}`);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // Manual-entry auto-lookup by typed Manual Invoice No. — fires on Tab/Enter/blur (not every
  // keystroke) so it doesn't fight the user mid-type. An exact, case-insensitive match against a
  // posted Sale Bill's own bill_no reuses handleCopyFromBill with copyItems=false. The field stays
  // editable even once locked (2026-08-26, per the user: "we can change the bill number for
  // another bill") — typing a DIFFERENT bill no. here and committing re-runs this same lookup and
  // re-locks to whichever bill now matches; committing one that matches nothing instead falls back
  // to Clear Link, unlocking everything (there's nothing left to stay locked to).
  //
  // `fallbackFocusEl` (2026-08-26, per the user — Customer's dropdown was popping open uninvited):
  // the field's own onKeyDown below intercepts Tab/Enter and preventDefault()s the browser's
  // native focus-advance, specifically so it CAN'T land on Customer while this async lookup is
  // still in flight — Customer's SearchableSelect auto-opens its panel on focus, and the browser's
  // default Tab lands there well before setCustomerId's disabled-state update actually commits.
  // With the native advance suppressed, focus now moves only once WE decide where — straight to
  // the first article field on a match, or normally onward via fallbackFocusEl when there's none.
  const prefillFromSaleBill = (typedBillNo: string, fallbackFocusEl?: HTMLInputElement | null) => {
    const typed = typedBillNo.trim().toLowerCase();
    if (!typed) {
      if (isCopiedFromBill) handleClearBillLink();
      if (fallbackFocusEl) requestAnimationFrame(() => focusNextField(fallbackFocusEl));
      return;
    }
    const match = priorBills.find(b => (b.bill_no || '').trim().toLowerCase() === typed);
    if (match) {
      setErrorMsg('');
      void handleCopyFromBill(String(match.bill_id), false).then(() => {
        // Master fields are done (just auto-filled and locked) — jump straight to the first
        // article field so the user can start typing articles right away, per the user
        // (2026-08-26): "the mouse goes to the first article field" (mirrors
        // PurchaseReturnPage's identical handleBillNoBlur behavior).
        requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
      });
    } else {
      // No match — every Manual Invoice No. has to reference a real Sale Bill (per the user,
      // 2026-08-26: "if user enter some kind of invoice number that not exist show error and do
      // not move on further"). If this was previously locked to a bill, unlock everything first —
      // there's nothing left to stay locked to — then block here: show the error and put focus
      // straight back on the field instead of letting Tab/blur carry it onward, so the user has to
      // either fix the number or clear it before doing anything else.
      if (isCopiedFromBill) handleClearBillLink();
      setErrorMsg(`No Sale Bill found with Manual Invoice No. "${typedBillNo.trim()}".`);
      if (fallbackFocusEl) requestAnimationFrame(() => fallbackFocusEl.focus());
    }
  };
  // Tab/Enter already triggered the lookup above (and preventDefault()ed the native focus-advance)
  // — the field's onBlur below must not also re-run it when that programmatic focus change fires
  // its own blur a moment later. Cleared right after use; a genuine mouse-click-elsewhere blur
  // (this ref still false) still runs prefillFromSaleBill exactly as before.
  const billNoHandledRef = useRef(false);

  // Validates one row's article+color+rate against `sourceBillItems` — only while isCopiedFromBill
  // (plain Manual entry with no bill linked is unrestricted). Keyed on variant_id+rate together,
  // same reasoning as PurchaseReturnPage: the same variant can appear on the source bill twice at
  // two different rates (rare, but possible across edited lines), and each is its own pool of
  // cartons to return against. `excludeUid` leaves the row being edited out of the "already used"
  // running total, so re-editing a row's own cartons doesn't count itself twice.
  function articleAgainstBillError(variantId: number | null, cartons: number, rate: number, excludeUid?: string | null): string | null {
    if (!isCopiedFromBill || variantId == null) return null;
    const sourceItem = sourceBillItems.find(it => it.variant_id === variantId && it.rate === rate);
    if (!sourceItem) {
      const sameVariantDifferentRate = sourceBillItems.some(it => it.variant_id === variantId);
      if (sameVariantDifferentRate) {
        return 'This article/color was sold at a different rate on the original bill — match that rate to return it.';
      }
      return 'This article/color was not on the original bill — it can\'t be returned against it.';
    }
    const alreadyUsed = items
      .filter(it => it.uid !== excludeUid && it.variantId === variantId && it.rate === rate)
      .reduce((s, it) => s + it.cartons, 0);
    const remaining = sourceItem.cartons - alreadyUsed;
    if (cartons > remaining) {
      return `Only ${remaining} carton(s) left to return (sold ${sourceItem.cartons}, already used ${alreadyUsed}).`;
    }
    return null;
  }

  // "Find Bill to Return" — the same big centered SearchModal popup as Customer, typable (type a
  // bill no./customer substring then Enter opens it seeded; Arrow Up/Down or the chevron button
  // open it blank). Defaults to reading "Manual entry" when nothing's picked, same as
  // PurchaseReturnPage's own "Find Purchase to Return".
  const findBillTriggerRef = useRef<HTMLInputElement>(null);
  const [isFindBillModalOpen, setIsFindBillModalOpen] = useState(false);
  const [findBillSearchText, setFindBillSearchText] = useState('');
  const [findBillModalSeed, setFindBillModalSeed] = useState('');
  useEffect(() => {
    const opt = priorBillOptions.find(o => o.value === copyFromBillId);
    setFindBillSearchText(opt?.label ?? '');
  }, [copyFromBillId, priorBillOptions]);
  const openFindBillModal = () => {
    if (isViewMode) return;
    setFindBillModalSeed('');
    setIsFindBillModalOpen(true);
  };
  function handleFindBillTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openFindBillModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setFindBillModalSeed(findBillSearchText);
      setIsFindBillModalOpen(true);
    }
  }
  async function handleFindBillSelect(billIdStr: string) {
    setIsFindBillModalOpen(false);
    // The modal's own "Manual entry (default)" row comes through as value '' — same as picking
    // it clears the link rather than trying to "copy from" a non-existent bill.
    if (!billIdStr) {
      handleClearBillLink();
      requestAnimationFrame(() => focusNextField(findBillTriggerRef.current));
      return;
    }
    await handleCopyFromBill(billIdStr, true);
    // Master fields are done (all just auto-filled and locked) — jump straight to the article
    // entry strip, same as the manual-match path (per the user, 2026-08-26), instead of just
    // walking to whatever field happens to sit next in DOM order.
    requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
  }
  // Switches back to full Manual entry from a locked state — clears the link and unlocks every
  // master field, but leaves whatever items/fields are already typed as-is (nothing is erased).
  const handleClearBillLink = () => {
    setCopyFromBillId('');
    setSourceBillItems([]);
  };

  const isNecessaryFieldsFilled = useMemo(() => {
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (!billNo) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.variantId || it.cartons <= 0 || it.rate <= 0)) return false;
    // Linked to an original bill — every row also has to actually be returnable against it.
    if (isCopiedFromBill && items.some(it => articleAgainstBillError(it.variantId, it.cartons, it.rate, it.uid))) return false;
    return true;
  }, [customerId, date, storeId, billNo, items, isCopiedFromBill, sourceBillItems]);

  // Preview of the Return No. a brand-new return will get — same idea as SaleBillPage's own
  // nextSystemBillNo: what Save actually assigns is the next draft_sale_return.draft_id, a
  // separate IDENTITY sequence from the real return_id assigned later on Post.
  const nextSystemReturnNo = useMemo(
    () => Math.max(0, ...drafts.map(d => d.draft_id)) + 1,
    [drafts]
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

  // No password prompt here — Save (handleSave, mode==='edit') already asks for one before the
  // update actually goes through, so gating entry into edit mode too meant asking twice for one
  // edit (reported directly by the user: edit then update each prompted separately).
  const handleEditSpecificReturn = async (ret: SaleReturnRow) => {
    await loadReturnRow(ret);
    setActiveTab('return');
    setMode('edit');
  };

  const handlePrintSpecificReturn = async (ret: SaleReturnRow) => {
    await loadReturnRow(ret);
    setIsPrintingSingle(true);
    setTimeout(() => {
      window.print();
      setIsPrintingSingle(false);
    }, 150);
  };

  // Initialize new return if mode is new and not set
  useEffect(() => {
    if (activeTab === 'return' && mode === 'new' && returnId === null && stores.length > 0 && addas.length > 0) {
      handleNew();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mode, returnId, stores, addas]);

  // Calculations
  const totalCartons = useMemo(() => items.reduce((sum, item) => sum + (item.cartons || 0), 0), [items]);
  const totalPairs = useMemo(() => items.reduce((sum, item) => sum + (item.pairs || 0), 0), [items]);
  const itemsTotalValue = useMemo(() => items.reduce((sum, item) => sum + (item.value || 0), 0), [items]);
  const finalTotalValue = useMemo(() => Math.max(0, itemsTotalValue - invoiceDiscount), [itemsTotalValue, invoiceDiscount]);

  // Toolbar Actions
  const handleNew = () => {
    setMode('new');
    setReturnId(null);
    setCurrentReturnIsPosted(false);
    setDate(getTodayDate());
    setStoreId(stores[0] ? String(stores[0].store_id) : '');
    setCustomerId('');
    setSubCustomerId('');
    // Blank by default (per the user, 2026-08-26) — was auto-generated as "RET-1234", but this
    // field doubles as the manual lookup key against an original Sale Bill's own bill_no
    // (prefillFromSaleBill), so a random pre-filled value only got in the way of typing a real one.
    setBillNo('');
    setGpNo('');
    setBiltyNo('');
    setAddaId(addas[0] ? String(addas[0].adda_id) : '');
    setRemarks('');
    setInvoiceDiscount(0);
    setItems([]);
    setEntry(newUiItem());
    setEditingIndex(null);
    setCopyFromBillId('');
    setSourceBillItems([]);
    setErrorMsg('');
    // Explicit focus, not just the G-01 mode-change effect below: clicking New while already on
    // a blank/new return (mode is already 'new') doesn't change `mode`, so that effect's
    // dependency never fires and focus would otherwise stay wherever it was (mirrors the same fix
    // on SaleBillPage's own handleNew).
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  const buildPayload = (): SaleReturnCreateInput | null => {
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (!storeId) { setErrorMsg('Store is required.'); return null; }
    if (!customerId) { setErrorMsg('Customer is required.'); return null; }
    if (!billNo) { setErrorMsg('Return Bill No. is required.'); return null; }
    if (items.length === 0) { setErrorMsg('At least one product item is required.'); return null; }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.variantId) { setErrorMsg(`Article/color is required at row ${i + 1}.`); return null; }
      if (it.cartons <= 0) { setErrorMsg(`Cartons must be greater than 0 at row ${i + 1}.`); return null; }
      if (it.rate <= 0) { setErrorMsg(`Rate must be greater than 0 at row ${i + 1}.`); return null; }
      // Linked to an original bill (manual-matched or explicitly picked) — every row must
      // actually be returnable against it: same article/color, same rate, within what's left.
      if (isCopiedFromBill) {
        const err = articleAgainstBillError(it.variantId, it.cartons, it.rate, it.uid);
        if (err) { setErrorMsg(`Row ${i + 1}: ${err}`); return null; }
      }
    }

    const itemsPayload: SaleReturnItemInput[] = items.map(it => ({
      variant_id: it.variantId!,
      cartons: it.cartons,
      rate: it.rate,
      discount_percent: it.discountPercent
    }));

    return {
      customer_id: Number(customerId),
      sub_customer_id: subCustomerId ? Number(subCustomerId) : null,
      store_id: Number(storeId),
      return_date: date,
      bill_no: billNo,
      gp_no: gpNo,
      bilty_no: biltyNo,
      adda_id: Number(addaId),
      remarks: remarks || undefined,
      invoice_discount: invoiceDiscount,
      items: itemsPayload
    };
  };

  // Whichever return is on screen, `returnId`/`currentReturnIsPosted` route to one of two
  // entirely different tables now: a POSTED document is a real sale_returns row (returnId =
  // return_id); anything else is a draft_sale_return row (returnId = draft_id) — the real table
  // strictly never holds an unposted document.
  const isEditingPostedReturn = mode === 'edit' && currentReturnIsPosted;

  // `finalize` decides what the form does AFTER a successful save, and nothing else:
  //   true  ("Done")  -> lock to view mode; the return stays fully on screen and Post lights up.
  //   false ("Save")  -> stay editable so more articles can be added to the SAME return.
  // Mirrors SaleBillPage's own executeSave — see its comment for why the non-finalize path flips
  // mode to 'edit' rather than leaving it 'new' (otherwise the next Save creates a duplicate).
  const executeSave = async (password?: string, finalize: boolean = true): Promise<SaleReturnRow | DraftSaleReturnRow | null> => {
    const payload = buildPayload();
    if (!payload) return null;

    if (isEditingPostedReturn && returnId != null) {
      const result = await api.saleReturns.update(returnId, password ? { ...payload, password } : payload);
      if (!result.ok) {
        setErrorMsg('Failed to save return: ' + result.error.message);
        return null;
      }
      setReturnId(result.data.return_id);
      setCurrentReturnIsPosted(true);
      setSuccessMsg('Sale return updated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setMode(finalize ? 'view' : 'edit');
      setErrorMsg('');
      return result.data;
    }

    // Every other save — a brand-new return, or editing one that's still a draft — goes through
    // the draft table now (draftSaleReturns.service.js), not sale_returns directly.
    const result = mode === 'edit' && returnId != null
      ? await api.draftSaleReturns.update(returnId, payload)
      : await api.draftSaleReturns.create(payload);

    if (!result.ok) {
      setErrorMsg('Failed to save return: ' + result.error.message);
      return null;
    }

    setReturnId(result.data.draft_id);
    setCurrentReturnIsPosted(false);
    setSuccessMsg(mode === 'edit' ? 'Sale return updated successfully.' : 'New sale return saved successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode(finalize ? 'view' : 'edit');
    setErrorMsg('');
    refreshDrafts();
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
    // Only editing an ALREADY-POSTED return needs a password — editing a draft (complete or not)
    // never did.
    if (isEditingPostedReturn) {
      setPasswordActionType('save_return');
      setIsPasswordModalOpen(true);
    } else {
      executeSave(undefined, finalize);
    }
  };

  // (handleSaveAndPost removed 2026-08-27: the Done button was its only caller, and Done now saves
  // WITHOUT posting so the finished return can be reviewed first — posting is handlePostCurrentReturn
  // below, a separate deliberate click, same as Sale Bill.)

  const handlePostCurrentReturn = async () => {
    if (returnId == null) return;
    const res = await api.draftSaleReturns.confirm(returnId);
    if (!res.ok) {
      setErrorMsg('Failed to post return: ' + res.error.message);
    } else {
      setReturnId(res.data.return_id);
      setCurrentReturnIsPosted(true);
      setSuccessMsg('Return posted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      refreshDrafts();
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
    setCurrentReturnIsPosted(false);
    setSuccessMsg('Return unposted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshDrafts();
  };

  // Entering edit mode never needs its own password prompt anymore — Save (handleSave,
  // mode==='edit') already asks for one before the update actually goes through, so gating entry
  // into edit mode too meant asking twice for one edit (reported by the user for both this
  // button and handleEditSpecificReturn above).
  const handleEditCurrentReturn = () => {
    setMode('edit');
  };

  const pendingDeleteReturnId = useRef<number | null>(null);

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
    if (passwordActionType === 'save_return') {
      await executeSave(password);
    } else if (passwordActionType === 'delete_unposted_return') {
      const targetId = pendingDeleteReturnId.current;
      pendingDeleteReturnId.current = null;
      if (targetId != null) {
        const res = await api.draftSaleReturns.remove(targetId, password);
        if (!res.ok) {
          setErrorMsg('Failed to delete return: ' + res.error.message);
        } else {
          setSuccessMsg('Return deleted successfully.');
          setTimeout(() => setSuccessMsg(''), 3000);
          if (returnId === targetId && !currentReturnIsPosted) handleNew();
          refreshDrafts();
        }
      }
    } else if (passwordActionType === 'edit_return') {
      // Row-level edit gate — clicking a line item on an already-POSTED return (handleRowClick) —
      // same convention as SaleBillPage's own 'edit_item_row'.
      const idx = pendingRowEditIndex.current;
      pendingRowEditIndex.current = null;
      if (idx != null) {
        setMode('edit');
        loadRowIntoEntry(idx);
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
  const [draftActionBusyId, setDraftActionBusyId] = useState<number | null>(null);
  const [postAllDraftsBusy, setPostAllDraftsBusy] = useState(false);
  const [postAllDraftsResult, setPostAllDraftsResult] = useState<ConfirmAllResult | null>(null);

  // `opts.mode` lets the nav buttons open a draft READ-ONLY while browsing (look-then-decide),
  // while every other caller keeps the original edit-on-open behaviour. Mirrors SaleBillPage's
  // own loadDraftIntoForm signature.
  const loadDraftIntoForm = (draft: DraftSaleReturnRow, opts: { mode?: 'edit' | 'view' } = {}) => {
    setReturnId(draft.draft_id);
    setCurrentReturnIsPosted(false);
    setDate(draft.return_date.slice(0, 10));
    setStoreId(draft.store_id != null ? String(draft.store_id) : '');
    setCustomerId(String(draft.customer_id));
    setSubCustomerId(draft.sub_customer_id != null ? String(draft.sub_customer_id) : '');
    setBillNo(draft.bill_no || '');
    setGpNo(draft.gp_no || '');
    setBiltyNo(draft.bilty_no || '');
    setAddaId(draft.adda_id != null ? String(draft.adda_id) : '');
    setRemarks(draft.remarks || '');
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
    // A draft carries no record of which original bill it might have been linked to when saved
    // (not a stored column) — always reopens fully unlocked/manual, same as loadReturnRow below.
    setCopyFromBillId('');
    setSourceBillItems([]);

    setMode(opts.mode ?? 'edit');
    setErrorMsg('');
  };

  const handleOpenDraftRow = (d: DraftSaleReturnRow) => {
    loadDraftIntoForm(d);
  };

  const handleConfirmDraftRow = async (draftId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftActionBusyId(draftId);
    const res = await api.draftSaleReturns.confirm(draftId);
    setDraftActionBusyId(null);
    if (!res.ok) {
      setErrorMsg('Failed to confirm draft: ' + res.error.message);
      return;
    }
    await loadReturnRow(res.data);
    setMode('view');
    setSuccessMsg('Draft confirmed & posted successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshDrafts();
  };

  // Password-gated (verified server-side) — deleting a saved-unposted return is destructive with
  // no reverse-never-erase trail, same guard level as editing an already-posted return.
  const handleDeleteDraftRow = (draftId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    pendingDeleteReturnId.current = draftId;
    setPasswordActionType('delete_unposted_return');
    setIsPasswordModalOpen(true);
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
    if (returnId != null && !currentReturnIsPosted && res.data.posted.some(p => p.draft_id === returnId)) {
      handleNew();
    }
    refreshDrafts();
  };

  // Entry strip (ref-pic bound-record pattern, matching SaleBillPage exactly — per the user,
  // 2026-08-26: "set the article box like this in sale return page"): ONE editable article/color/
  // cartons/rate/discount row above the table, NOT one editable row per grid entry. Typing an
  // article, color, cartons, rate, D%/DV and pressing Enter on the last field (or the Add/Update
  // Row button) commits it into `items` — appending, or replacing `editingIndex` when a table row
  // was clicked to re-open it — then always clears the strip and refocuses Product for the next
  // article. Clicking a committed row loads it back into the strip for editing.
  const [entry, setEntry] = useState<UiItem>(newUiItem());
  // null while the strip is adding a brand-new row; the table index being replaced once a
  // committed row has been clicked back open for editing (see handleRowClick below).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const entryProductCellRef = useRef<HTMLDivElement>(null);
  const pendingRowEditIndex = useRef<number | null>(null);
  // Product field's SearchModal — same pattern as Customer's: type the article code, Enter opens
  // a big centered popup to pick from.
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
      rate: isCopiedFromBill ? prev.rate : (product?.sale_price ?? prev.rate)
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

  // SR-01: prefer the rate this customer actually paid last time for this variant over the
  // article's current predefined sale_price — unless linked to an original bill, where the rate
  // MUST be that bill's own line rate instead (non-editable — see the Rate cell's own lock below).
  const handleEntryVariantChange = async (variantIdStr: string) => {
    if (entry.articleId == null) return;
    const variantId = variantIdStr ? Number(variantIdStr) : null;
    const variant = variantsByArticle[entry.articleId]?.find(v => v.variant_id === variantId);
    const product = products.find(p => p.article_id === entry.articleId);

    let rate = product?.sale_price ?? entry.rate;
    if (isCopiedFromBill) {
      const sourceItem = variantId != null ? sourceBillItems.find(it => it.variant_id === variantId) : undefined;
      if (sourceItem) rate = sourceItem.rate;
    } else if (variantId != null && customerId) {
      const res = await api.saleBills.lastSoldRate(Number(customerId), variantId);
      if (res.ok && res.data != null) rate = res.data;
    }

    setEntry(prev => recalcItem({
      ...prev,
      variantId,
      label: variant ? `${product?.name || ''} — ${variant.color}` : (product?.name || ''),
      packing: variant?.packing ?? product?.packing ?? prev.packing,
      rate
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

  // Live validation of the strip's own current article/color/rate against the linked original
  // bill (see articleAgainstBillError above) — same rule Save re-checks, surfaced here so a
  // mismatch is obvious before the row is even added.
  const entryBillError = useMemo(
    () => articleAgainstBillError(entry.variantId, entry.cartons, entry.rate, editingIndex != null ? entry.uid : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry, isCopiedFromBill, sourceBillItems, items, editingIndex]
  );

  // Commits the strip's current entry into the table — appends a new row, or overwrites
  // `editingIndex` when the strip is re-editing a row clicked open from the table. Linked-bill
  // mismatches refuse to commit at all, same as SaleBillPage's stock-limit rule.
  const handleCommitEntryRow = () => {
    if (entry.articleId == null || entry.variantId == null) {
      setErrorMsg('Select an article and color before adding the row.');
      return;
    }
    if (entry.cartons <= 0) { setErrorMsg('Cartons must be greater than 0.'); return; }
    if (entry.rate <= 0) { setErrorMsg('Rate must be greater than 0.'); return; }
    if (entryBillError) {
      setErrorMsg(`Cannot add row: ${entryBillError}`);
      return;
    }
    setErrorMsg('');
    if (editingIndex != null) {
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
  // returns are password-gated first (see handleRowClick); drafts and brand-new returns load
  // straight in, matching the convention that only a POSTED return's edits ever need a password.
  const loadRowIntoEntry = (idx: number) => {
    const row = items[idx];
    setEntry(row);
    setEditingIndex(idx);
    if (row.articleId != null) fetchVariants(row.articleId);
    requestAnimationFrame(() => focusFirstField(entryProductCellRef.current));
  };

  const handleRowClick = (idx: number) => {
    if (isViewMode && currentReturnIsPosted) {
      pendingRowEditIndex.current = idx;
      setIsPasswordModalOpen(true);
      setPasswordActionType('edit_return');
      return;
    }
    if (isViewMode) setMode('edit');
    loadRowIntoEntry(idx);
  };

  // A return always needs at least one row to type into once anything's committed, but the entry
  // strip itself can sit empty (unlike the old always-editable table) — so this only has to handle
  // actually removing a committed row, no more "clear the last one instead" special case.
  const handleRemoveItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setEntry(newUiItem());
    } else if (editingIndex != null && idx < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
  };

  // Delete is dual-purpose, same as SaleBillPage's own toolbar Delete: with a row loaded into the
  // strip for editing (editingIndex set), it removes THAT row; otherwise it's the whole-return
  // delete (currently-open unposted return).
  const handleDeleteAction = () => {
    if (editingIndex != null) {
      handleRemoveItemRow(editingIndex);
      return;
    }
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


  // Products this customer previously bought — derived from any posted Sale Bill lookup by
  // customer. Kept simple: only fires when the user explicitly searches by bill_no via prefill;
  // no bulk customer-history fetch endpoint exists yet.

  const isViewMode = mode === 'view';

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

  // Regions/cities are only needed here for the inline "+ Add Sub-Customer" modal.
  const [regions, setRegions] = useState<{ region_id: number; name: string }[]>([]);
  const [cities, setCities] = useState<{ city_id: number; name: string; region_id: number | null }[]>([]);

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
  useEffect(() => {
    (async () => {
      const [rg, ct] = await Promise.all([api.listRegions(), api.listCities()]);
      if (rg.ok) setRegions(rg.data);
      if (ct.ok) setCities(ct.data);
    })();
  }, []);

  const [isAddSubCustomerOpen, setIsAddSubCustomerOpen] = useState(false);
  const [newSubCustomerName, setNewSubCustomerName] = useState('');
  const [newSubCustomerRegionId, setNewSubCustomerRegionId] = useState('');
  const [newSubCustomerCityId, setNewSubCustomerCityId] = useState('');

  if (isPrintingSingle) {
    const customerObj = customers.find(c => c.customer_id === Number(customerId));
    const customerName = customerObj ? customerObj.name : (customerId || 'N/A');
    const storeObj = stores.find(s => s.store_id === Number(storeId));
    const storeName = storeObj ? storeObj.name : (storeId || 'N/A');
    const statusLabel = currentReturnIsPosted ? 'Posted' : 'Unposted';

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
            <span>{returnId ?? 'Unsaved'}</span>
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
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Gross Total Credit:</td>
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
              <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Net Credited Amount (PKR):</td>
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
  // headerAction slot), same as Sale Bill, so the content below the Quick Menu bar starts
  // immediately instead of losing a row's height to a tab bar first.
  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('return'); handleNew(); }}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'return' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Sale Return
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
        Find &amp; Update Return
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Sale Return" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }}>

        {/* Saved Drafts — moved off the main flow, same treatment as SaleBillPage's Pending
            Posting: a flat vertical list, positioned `absolute` and anchored via
            `right: calc(100% + gap)` to this wrapper's own left edge (not the viewport or a
            guessed margin), so it can never affect the card's width/position. Shown only from
            `2xl` up, since below that there generally isn't enough real margin for it to land in
            without spilling past the window edge. Clicking a row loads that draft into the form;
            the small Post/Delete buttons act on that row directly. */}
        {(drafts.length > 0 || postAllDraftsResult) && (
          <aside
            className="hidden 2xl:block absolute top-0 w-64 space-y-3"
            style={{ right: 'calc(100% + 24px)' }}
            data-no-print
          >
            <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-slate-700">Pending Posting</span>
                <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                  {drafts.length}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-3">
                Every saved-unposted return — click to load, finish, then post.
              </div>
              {drafts.length > 0 && (
                <button
                  type="button"
                  onClick={handlePostAllDrafts}
                  disabled={postAllDraftsBusy}
                  className="w-full px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {postAllDraftsBusy ? 'Posting…' : `Post All (${drafts.length})`}
                </button>
              )}

              {/* Stays on screen until dismissed — a run can post most drafts, and the ones that
                  failed are the whole point of the message. */}
              {postAllDraftsResult && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  <p className="text-xs font-semibold text-slate-700">
                    {postAllDraftsResult.posted.length} of {postAllDraftsResult.attempted} posted
                    {postAllDraftsResult.failed.length > 0 && ` · ${postAllDraftsResult.failed.length} failed`}
                  </p>
                  {postAllDraftsResult.failed.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {postAllDraftsResult.failed.map(f => (
                        <li key={f.draft_id} className="text-xs text-rose-700">
                          <span className="font-mono font-semibold">{f.bill_no || `#${f.draft_id}`}</span>
                          {' — '}{f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => setPostAllDraftsResult(null)}
                    className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-semibold"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>

            {drafts.length > 0 && (
            <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
              {drafts.map(d => {
                const custName = customers.find(c => c.customer_id === d.customer_id)?.name || 'Unnamed Customer';
                const busy = draftActionBusyId === d.draft_id;
                return (
                  <li
                    key={d.draft_id}
                    onClick={() => handleOpenDraftRow(d)}
                    className="px-3 py-2.5 text-xs flex items-center justify-between gap-2 cursor-pointer hover:bg-amber-50/60 transition-colors border-b border-slate-100 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-slate-700">{d.bill_no || 'No Number'}</div>
                      <div className="text-slate-400 truncate">{custName}</div>
                      <div className="text-slate-400">{formatDate(d.return_date)}</div>
                    </div>
                    <div className="flex flex-row items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        title="Post this draft"
                        onClick={(e) => handleConfirmDraftRow(d.draft_id, e)}
                        disabled={busy}
                        className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                      <button
                        type="button"
                        title="Delete this draft (password required)"
                        onClick={(e) => handleDeleteDraftRow(d.draft_id, e)}
                        disabled={busy}
                        className="p-1.5 rounded-md bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
          </aside>
        )}

        {/* Tab contents (records & find) */}
        <div>
          {activeTab === 'weekly' && <WeeklyReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'monthly' && <MonthlyReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'overall' && <OverallReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'find' && <FindReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
        </div>

        <form onSubmit={e => e.preventDefault()} className={activeTab === 'return' ? 'block' : 'hidden'}>

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

        {/* Toolbar - data-no-print — icon-over-label buttons (`.toolbar-btn`), same style as
            SaleBillPage's own toolbar (per the user, 2026-08-26: "copy sale bill... from button to
            everything"). Every action always renders — only `disabled` changes per state. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-0.5">
            <button type="button" onClick={handleNew} title="New" className="toolbar-btn">
              <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={handleDeleteAction}
              disabled={editingIndex != null ? isViewMode : (mode !== 'view' || returnId == null || currentReturnIsPosted)}
              title={editingIndex != null ? 'Delete selected article' : 'Delete'}
              className="toolbar-btn"
            >
              <Trash2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              onClick={handleEditCurrentReturn}
              disabled={mode !== 'view' || returnId == null}
              title="Edit"
              className="toolbar-btn"
            >
              <Edit size={20} strokeWidth={2.5} className="text-sky-600" />
              <span>Edit</span>
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={mode === 'view' || !isNecessaryFieldsFilled}
              title="Save — keep editing this return"
              className="toolbar-btn"
            >
              <Save size={20} strokeWidth={2.5} className="text-blue-600" />
              <span>Save</span>
            </button>
            <button
              type="submit"
              onClick={() => handleSave(true)}
              disabled={mode === 'view' || !isNecessaryFieldsFilled}
              title="Done — finish this return, then Post it"
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

            <button type="button" onClick={handleFirst} disabled={!canBrowse} title="First" className="toolbar-btn">
              <ChevronsLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>First</span>
            </button>
            <button type="button" onClick={handlePrev} disabled={!canNavPrevious} title="Pre." className="toolbar-btn">
              <ChevronLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Pre.</span>
            </button>
            <button type="button" onClick={handleNext} disabled={!canNavNext} title="Next" className="toolbar-btn">
              <ChevronRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Next</span>
            </button>
            <button type="button" onClick={handleLast} disabled={!canBrowse} title="Last" className="toolbar-btn">
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
              disabled={mode !== 'view' || returnId == null}
              title="Print"
              className="toolbar-btn"
            >
              <Printer size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Print</span>
            </button>
            <button type="button" onClick={() => setIsFindOpen(true)} title="Find" className="toolbar-btn">
              <Search size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Find</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={handleUnpostCurrentReturn}
              // No longer gated on the dropdown — see SaleBillPage's Un Post button for why.
              disabled={mode !== 'view' || returnId == null || !currentReturnIsPosted}
              title="Un Post — switch the dropdown to Unposted first"
              className="toolbar-btn"
            >
              <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Un Post</span>
            </button>
            <button
              type="button"
              onClick={handlePostCurrentReturn}
              disabled={mode !== 'view' || returnId == null || currentReturnIsPosted}
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

            {drafts.length > 0 && (
              <button
                type="button"
                onClick={handlePostAllDrafts}
                disabled={postAllDraftsBusy}
                title={`Post All (${drafts.length})`}
                className="toolbar-btn"
              >
                <PackageCheck size={20} strokeWidth={2.5} className="text-emerald-600" />
                <span>Post All</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => exportToPDF()}
              disabled={mode !== 'view' || returnId == null}
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
                exportRowsToExcel(`sale-return-${billNo || returnId}`, headers, rows);
              }}
              disabled={mode !== 'view' || returnId == null}
              title="Export Excel"
              className="toolbar-btn"
            >
              <FileSpreadsheet size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Excel</span>
            </button>
          </div>

          {mode === 'edit' && (
            <div className="text-sm font-semibold text-slate-500 font-inter">
              Editing System Return: <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">{returnId ?? 'New'}</span>
            </div>
          )}

          {mode === 'view' && (
            <div className="text-sm font-semibold text-emerald-600 font-inter flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping text-[10px]"></span>
              Return {currentReturnIsPosted ? 'Posted' : 'Saved'} Successfully!
            </div>
          )}
        </div>

        {/* Title bar — Posted/Unposted browse dropdown (drives First/Pre/Next/Last), same as
            SaleBillPage. */}
        <div className="flex items-center justify-between gap-3 mb-2 px-1" data-no-print>
          <span className="font-lora font-semibold text-sm text-slate-600">SALE RETURN</span>
          <select
            value={browseFilter}
            onChange={e => setBrowseFilter(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Which returns First/Pre./Next/Last page through: posted returns, or saved-but-unposted drafts."
          >
            <option value="posted">Posted ({postedReturns.length})</option>
            <option value="unposted">Unposted ({drafts.length})</option>
          </select>
        </div>

        {/* Invoice Layout — height pinned to the remaining viewport space (see invoiceCardHeight
            above) and laid out as a flex column, so the item table below can flex-grow into
            whatever room that leaves and the footer lands at the bottom of the screen. Every
            other child here keeps its natural size (shrink-0) — only the table wrapper is flex-1. */}
        <div
          ref={invoiceCardRef}
          className="card-white shadow-sm p-3 md:p-4 flex flex-col"
          style={{ border: '1px solid var(--border-color)', background: '#ffffff', height: invoiceCardHeight ?? undefined }}
        >

          {/* Print Title (Visible only when printing) */}
          <div className="hidden print:flex items-center justify-between mb-6 pb-4 border-b">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
              <p className="text-xs font-inter uppercase tracking-widest text-slate-500">Footwear Wholesale Distribution</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-xl">SALE RETURN</h2>
              <p className="text-sm font-inter text-slate-500">Status: {currentReturnIsPosted ? 'Posted' : 'Unposted'}</p>
            </div>
          </div>

          {/* Header fields — one dense grid, label-left per field (matches SaleBillPage's
              compact redesign), instead of stacked label-above-input fields split across
              bordered cards. */}
          <div className="shrink-0 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 mb-2 pb-2 border-b" style={{ borderColor: 'var(--border-table)' }}>
            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Return No.
              </label>
              <input type="text" value={returnId != null ? `#${returnId}` : `#${nextSystemReturnNo} (pending)`} disabled className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="date" ref={firstFieldRef}
            value={date} disabled={isViewMode} onChange={e => setDate(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>

            {/* Entry Mode — right after Date (per the user, 2026-08-26), same position as
                PurchaseReturnPage's own "Find Purchase to Return". "Manual entry" (default, shown
                as a real selectable option inside the popup — same as Purchase Return's "Manual
                entry (default)" row) vs an explicit pick. Typing a bill no./customer substring
                then Enter opens the popup seeded with it; picking an actual bill copies EVERY
                field and article in at once (isCopiedFromBill locks the master fields below).
                Manual Invoice No. further down still does its own thing — typing an exact bill_no
                there and tabbing out auto-fills just the master fields, leaving articles to be
                added by hand, each checked against the matched bill as it's picked. */}
            <div className="flex items-center gap-1.5 md:col-span-2">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Find Bill to Return
              </label>
              <div className="flex-1 relative">
                <input
                  ref={findBillTriggerRef}
                  type="text"
                  disabled={isViewMode}
                  value={findBillSearchText}
                  onChange={e => setFindBillSearchText(e.target.value)}
                  onKeyDown={handleFindBillTriggerKeyDown}
                  placeholder="Manual entry — or type a bill no./customer to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode}
                  onClick={openFindBillModal}
                  title="Browse all posted Sale Bills"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={16} />
                </button>
                <SearchModal
                  isOpen={isFindBillModalOpen}
                  title="Select Bill to Return"
                  options={[{ value: '', label: 'Manual entry (default)' }, ...priorBillOptions]}
                  value={copyFromBillId}
                  onSelect={handleFindBillSelect}
                  onClose={() => setIsFindBillModalOpen(false)}
                  searchPlaceholder="Search by bill no. or customer..."
                  initialSearch={findBillModalSeed}
                />
              </div>
              {isCopiedFromBill && !isViewMode && (
                <button
                  type="button"
                  onClick={handleClearBillLink}
                  title="Unlock the master fields and switch back to fully manual entry"
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-all cursor-pointer shrink-0"
                >
                  <X size={11} />
                  <span>Clear Link</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                TO Store <span className="text-red-500 font-bold">*</span>
              </label>
              {/* Typable — same centered SearchModal popup as every other lookup on this form
                  (was SearchableSelect's small anchored dropdown; per the user, 2026-08-26). */}
              <div className="flex-1 relative">
                <input
                  ref={storeTriggerRef}
                  type="text"
                  disabled={isViewMode || isCopiedFromBill}
                  title={isCopiedFromBill ? 'Set by the bill you picked above — Clear Link to change it' : undefined}
                  value={storeSearchText}
                  onChange={e => setStoreSearchText(e.target.value)}
                  onKeyDown={handleStoreTriggerKeyDown}
                  placeholder="Type a store name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || isCopiedFromBill}
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
            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Manual Invoice No. <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="text"
                value={billNo}
                disabled={isViewMode}
                title={isCopiedFromBill ? 'Linked to this bill — type a different one to switch, or clear it to go fully manual' : undefined}
                onChange={e => setBillNo(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Tab' && e.key !== 'Enter') return;
                  if (mode !== 'new') return;
                  const val = e.currentTarget.value.trim();
                  if (!val && !isCopiedFromBill) return;
                  // Own the focus move ourselves — see prefillFromSaleBill's own comment above for
                  // why the native Tab-advance can't be allowed to land on Customer here.
                  e.preventDefault();
                  billNoHandledRef.current = true;
                  prefillFromSaleBill(val, e.currentTarget);
                }}
                onBlur={e => {
                  if (billNoHandledRef.current) { billNoHandledRef.current = false; return; }
                  const val = e.target.value.trim();
                  if (mode === 'new' && (val !== '' || isCopiedFromBill)) {
                    prefillFromSaleBill(val, e.target);
                  }
                }}
                className="soleria-input soleria-input-compact"
              />
            </div>

            <div className="flex items-center gap-1.5 md:col-span-2">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="flex-1">
                <SearchableSelect
                  options={customerOptions}
                  value={customerId}
                  onChange={val => { setCustomerId(val); setSubCustomerId(''); }}
                  placeholder="Select customer..."
                  searchPlaceholder="Search customers..."
                  disabled={isViewMode || isCopiedFromBill}
                />
                {selectedCustomer && selectedCustomer.ba_id == null && (
                  <p className="text-[10px] text-amber-600 mt-0.5 font-semibold">
                    This customer has no linked business account — the return cannot be posted until Setup adds one.
                  </p>
                )}
              </div>
            </div>
            {/* Paired with Customer on the same row (both span 2 of 4 columns) so this row packs
                fully at 4-up, same as SaleBillPage's own row-2 packing — keeping Delivery Agent's
                natural place after Customer here (rather than after Customer Code) is what makes
                the header take exactly as many rows as Sale Bill's, instead of leaving Customer
                Code's row half-empty and pushing Bilty No. onto an orphan 4th row. */}
            <div className="flex items-center gap-2 md:col-span-2">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Delivery Agent <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <div className="flex-1 relative">
                <input
                  ref={subCustTriggerRef}
                  type="text"
                  disabled={isViewMode || isCopiedFromBill}
                  value={subCustSearchText}
                  onChange={e => setSubCustSearchText(e.target.value)}
                  onKeyDown={handleSubCustTriggerKeyDown}
                  placeholder="SAME (Direct) — type a name, or press Enter to search..."
                  className="soleria-input pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || isCopiedFromBill}
                  onClick={openSubCustModal}
                  title="Browse all sub-customers"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
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
              {!isViewMode && !isCopiedFromBill && (
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
            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer Code
              </label>
              <input type="text" value={customerId} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Transport Adda <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <div className="flex-1 relative">
                <input
                  ref={addaTriggerRef}
                  type="text"
                  disabled={isViewMode || isCopiedFromBill}
                  value={addaSearchText}
                  onChange={e => setAddaSearchText(e.target.value)}
                  onKeyDown={handleAddaTriggerKeyDown}
                  placeholder="Type an Adda name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-9"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={isViewMode || isCopiedFromBill}
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
            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                GP No. <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="text" value={gpNo} disabled={isViewMode || isCopiedFromBill} onChange={e => setGpNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Bilty No. <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="text" value={biltyNo} disabled={isViewMode || isCopiedFromBill} onChange={e => setBiltyNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
          </div>

          {/* Entry strip (ref-pic bound-record pattern, matching SaleBillPage exactly — per the
              user, 2026-08-26). Row 1: Product/Product Name/Color/Packing. Row 2: Cartons/Pairs/
              Rate/D%/DV/Value. This is the ONE "current record" being typed; Enter on DV commits
              it into the table below (handleCommitEntryRow) and resets the strip. Clicking a
              table row loads it back in here for editing. */}
          {!isViewMode && (
          <div className="shrink-0 mb-2 p-2 rounded-lg border bg-slate-50/60" style={{ borderColor: 'var(--border-color)' }}>
            <div className="grid gap-x-3 gap-y-1.5 mb-1.5" style={{ gridTemplateColumns: '1fr 1fr 1fr 130px' }}>
              <div ref={entryProductCellRef} className="flex items-center gap-1.5">
                <label className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Article <span className="text-red-500 font-bold">*</span></label>
                <div className="flex-1">
                  {/* A real text input, not a button — type a full code/name or any substring,
                      then Enter opens the modal already filtered to matches. Arrow Up/Down still
                      open it too (unfiltered, or filtered by whatever's already typed). */}
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
                    options={products.map(p => ({ value: String(p.article_id), label: `${p.code} — ${p.name}` }))}
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
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Packing</label>
                <input type="text" value={entry.packing || '-'} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500 text-center" />
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
                  className={`soleria-input soleria-input-compact text-center font-mono ${entryBillError ? 'border-2 border-red-500 bg-rose-50 text-red-700 font-bold' : ''}`}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pairs</label>
                <input type="text" value={entry.pairs || '-'} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500 text-center" />
              </div>
              <div className="flex flex-col gap-0.5">
                {/* Rate — locked once linked to an original bill: the return must credit exactly
                    what was charged on that bill, not whatever gets typed here.
                    handleEntryVariantChange already fills it from sourceBillItems the moment a
                    matching color is picked. */}
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Rate <span className="text-red-500 font-bold">*</span></label>
                <input
                  type="number"
                  value={entry.rate || ''}
                  disabled={isCopiedFromBill}
                  title={isCopiedFromBill ? 'Locked to the original bill\'s own rate for this article/color' : undefined}
                  min={0}
                  onChange={e => updateEntryNumericField('rate', parseInt(e.target.value) || 0)}
                  className="soleria-input soleria-input-compact text-right font-mono"
                  style={{ background: isCopiedFromBill ? '#f8fafc' : undefined }}
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
            {entryBillError && (
              <div className="mt-1.5 text-[11px] font-bold text-red-600 flex items-center gap-1">
                <span>{entryBillError} — row will not be added.</span>
              </div>
            )}
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
              <button type="button" onClick={handleCommitEntryRow} className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d]">
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
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ minWidth: '190px' }}>Returned Article</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Cartons</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '100px' }}>Rate</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '130px' }}>Total Credit</th>
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

          {/* Bottom Section: Remarks + ref-pic's flat totals row (Total Cartons | Total Pairs |
              Invoice Discount | Total Value | Rs.) — replaces the old dark "Calculations" box,
              which isn't in the ref pic; matches SaleBillPage's own bottom section exactly (per
              the user, 2026-08-26 — spotted the dark box as a clear diff from Sale Bill). */}
          <div className="shrink-0 flex flex-wrap items-end justify-between gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Return Reason / Remarks
              </label>
              <input
                type="text"
                value={remarks}
                disabled={isViewMode}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Enter return reasons or remarks..."
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
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
                  <span className="font-mono font-semibold text-slate-700">{row.bill_no || `#${'return_id' in row ? row.return_id : row.draft_id}`}</span>
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
              <button type="button" onClick={handleCreateSubCustomer} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm">
                Add Sub-Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Password Protection Modal */}
      <PasswordPromptModal
        isOpen={isPasswordModalOpen}
        onClose={() => {
          setIsPasswordModalOpen(false);
          setPasswordActionType(null);
        }}
        onSuccess={handlePasswordSuccess}
        title={
          passwordActionType === 'post_return'
            ? 'Authorization Required to Post Return'
            : 'Authorization Required to Save Return Changes'
        }
        subtitle={`Please enter password for user '${state.currentUsername || 'user'}' to confirm changes to Return #${billNo || returnId}.`}
      />
    </AppLayout>
  );
}
