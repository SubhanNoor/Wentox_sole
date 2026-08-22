import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import WeeklyReturnTab from '@/components/WeeklyReturnTab';
import MonthlyReturnTab from '@/components/MonthlyReturnTab';
import OverallReturnTab from '@/components/OverallReturnTab';
import FindReturnTab from '@/components/FindReturnTab';
import { Save, Plus, Trash2, Printer, FileDown, FileSpreadsheet, Edit, CheckCircle2 } from 'lucide-react';
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
  SaleReturnRow, SaleReturnCreateInput, SaleReturnItemInput,
  DraftSaleReturnRow, ConfirmAllResult
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
  const { state } = useApp();

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

  const isNecessaryFieldsFilled = useMemo(() => {
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (!billNo) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.variantId || it.cartons <= 0 || it.rate <= 0)) return false;
    return true;
  }, [customerId, date, storeId, billNo, items]);

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
    setItems(loadedItems.length ? loadedItems : [newUiItem()]);
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });
    setErrorMsg('');
  };

  // Pre-fill a return from an existing posted Sale Bill, matched by its manual bill number.
  const prefillFromSaleBill = async (matchedBillNo: string) => {
    const res = await api.saleBills.list({ bill_no: matchedBillNo });
    if (!res.ok || res.data.length === 0) return;
    const bill = res.data[0];
    setStoreId(bill.store_id != null ? String(bill.store_id) : '');
    setCustomerId(String(bill.customer_id));
    setSubCustomerId(bill.sub_customer_id != null ? String(bill.sub_customer_id) : '');
    setGpNo(bill.gp_no || '');
    setBiltyNo(bill.bilty_no || '');
    setAddaId(String(bill.adda_id));
    setRemarks(`Return from Sale Bill No. ${bill.bill_no}`);
    setInvoiceDiscount(bill.invoice_discount || 0);

    const mappedItems: UiItem[] = bill.items.map(it => {
      const article = products.find(p => p.code === it.article_code);
      const uiItem = recalcItem({
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
      return uiItem;
    });
    setItems(mappedItems.length ? mappedItems : [newUiItem()]);
    mappedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });
    setSuccessMsg(`Prefilled return items from Sale Bill No. ${bill.bill_no}`);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

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
    setBillNo('RET-' + (Math.floor(Math.random() * 9000) + 1000).toString());
    setGpNo('');
    setBiltyNo('');
    setAddaId(addas[0] ? String(addas[0].adda_id) : '');
    setRemarks('');
    setInvoiceDiscount(0);
    setItems([newUiItem()]);
    setErrorMsg('');
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

  const executeSave = async (password?: string): Promise<SaleReturnRow | DraftSaleReturnRow | null> => {
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
      setMode('view');
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
    setMode('view');
    setErrorMsg('');
    refreshDrafts();
    return result.data;
  };

  const handleSave = () => {
    // Only editing an ALREADY-POSTED return needs a password — editing a draft (complete or not)
    // never did.
    if (isEditingPostedReturn) {
      setPasswordActionType('save_return');
      setIsPasswordModalOpen(true);
    } else {
      executeSave();
    }
  };

  // Only reachable while !currentReturnIsPosted, so `saved` is always a fresh/edited DRAFT here —
  // saving IS drafting now, so Save & Post is draft-then-confirm in one click.
  const handleSaveAndPost = async () => {
    const saved = await executeSave();
    if (saved && 'draft_id' in saved) {
      const postRes = await api.draftSaleReturns.confirm(saved.draft_id);
      if (!postRes.ok) {
        setErrorMsg('Return was saved, but posting failed: ' + postRes.error.message);
      } else {
        setReturnId(postRes.data.return_id);
        setCurrentReturnIsPosted(true);
        setSuccessMsg('Return saved & posted successfully.');
        setTimeout(() => setSuccessMsg(''), 3000);
        refreshDrafts();
      }
    }
  };

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

  const loadDraftIntoForm = (draft: DraftSaleReturnRow) => {
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
    setItems(loadedItems.length ? loadedItems : [newUiItem()]);
    loadedItems.forEach(it => { if (it.articleId != null) fetchVariants(it.articleId); });

    setMode('edit');
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

  // Line Items Helper Actions — new rows go to the TOP, not the bottom: the newest article is
  // what the user is looking at and typing into, so it should be the one visible without
  // scrolling down through everything already entered (item table only shows ~2 rows before it
  // scrolls internally — see its wrapper below).
  const handleAddItemRow = () => setItems([newUiItem(), ...items]);

  // Keyboard entry without the mouse — mirrors SaleBillPage. G-01's generic Enter-walk already
  // carries fields forward within a row and into an EXISTING next row; this only steps in at the
  // boundary (Enter on the last field of the last row), where it inserts a blank row at the top
  // and focuses into it. stopPropagation stops AppLayout's own window-level Enter handler from
  // also firing on the same keydown and clicking Save & Post before the new row exists.
  const articleCellRefs = useRef<(HTMLTableCellElement | null)[]>([]);

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

  // A return always needs at least one row to type into, so deleting the last remaining one
  // clears its fields back to blank instead of removing the row itself (keeping its uid, so the
  // row doesn't remount and lose focus).
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
      packing: product?.packing || 0
    }) : it));
    if (articleId != null) await fetchVariants(articleId);
  };

  // SR-01: prefer the rate this customer actually paid last time for this variant over the
  // article's current predefined sale_price — only relevant here (not the bill-number prefill
  // path above, which already copies each line's original rate straight off the source bill).
  const handleVariantChange = async (idx: number, variantIdStr: string) => {
    const item = items[idx];
    if (item.articleId == null) return;
    const variantId = variantIdStr ? Number(variantIdStr) : null;
    const variant = variantsByArticle[item.articleId]?.find(v => v.variant_id === variantId);
    const product = products.find(p => p.article_id === item.articleId);

    let rate = product?.sale_price ?? item.rate;
    if (variantId != null && customerId) {
      const res = await api.saleBills.lastSoldRate(Number(customerId), variantId);
      if (res.ok && res.data != null) rate = res.data;
    }

    setItems(prev => prev.map((it, i) => i === idx ? recalcItem({
      ...it,
      variantId,
      label: variant ? `${product?.name || ''} — ${variant.color}` : (product?.name || ''),
      packing: variant?.packing ?? product?.packing ?? it.packing,
      rate
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

        {/* Toolbar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          {/* Every action always renders (ref-pic style) — only `disabled` changes per state,
              instead of whole button groups mounting/unmounting per `mode`. */}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleNew} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none">
              New Return
            </button>
            <button
              type="submit"
              onClick={handleSave}
              disabled={mode === 'view' || !isNecessaryFieldsFilled}
              className="px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm font-inter hover:opacity-90 disabled:pointer-events-none disabled:cursor-not-allowed"
              style={{
                backgroundColor: mode !== 'view' && isNecessaryFieldsFilled ? '#111c2a' : '#e2e8f0',
                color: mode !== 'view' && isNecessaryFieldsFilled ? '#B08D57' : '#64748b',
                border: mode !== 'view' && isNecessaryFieldsFilled ? '1px solid #B08D57' : '1px solid #cbd5e1',
                cursor: mode !== 'view' && isNecessaryFieldsFilled ? 'pointer' : 'not-allowed'
              }}
            >
              <Save size={16} /> {mode === 'edit' ? 'Update Return' : 'Save Return'}
            </button>
            <button
              type="button"
              onClick={handleSaveAndPost}
              disabled={mode === 'view' || !isNecessaryFieldsFilled || currentReturnIsPosted}
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
              onClick={handleEditCurrentReturn}
              disabled={mode !== 'view' || returnId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <Edit size={16} /> Edit Return
            </button>
            <button
              type="button"
              onClick={handlePostCurrentReturn}
              disabled={mode !== 'view' || returnId == null || currentReturnIsPosted}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Post Return
            </button>
            <button
              type="button"
              onClick={handleUnpostCurrentReturn}
              disabled={mode !== 'view' || returnId == null || !currentReturnIsPosted}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Unpost Return
            </button>
            <button
              type="button"
              onClick={() => {
                setIsPrintingSingle(true);
                setTimeout(() => { window.print(); setIsPrintingSingle(false); }, 100);
              }}
              disabled={mode !== 'view' || returnId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <Printer size={16} /> Print Return
            </button>
            <button
              type="button"
              onClick={() => exportToPDF()}
              disabled={mode !== 'view' || returnId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <FileDown size={16} /> Export PDF
            </button>
            <button
              type="button"
              onClick={() => {
                const headers = ['Article', 'Packing', 'Cartons', 'Pairs', 'Rate', 'D%', 'D. Value', 'Total Value'];
                const rows = items.map(it => [it.label, it.packing, it.cartons, it.pairs, it.rate, it.discountPercent, it.discountValue, it.value]);
                exportRowsToExcel(`sale-return-${billNo || returnId}`, headers, rows);
              }}
              disabled={mode !== 'view' || returnId == null}
              className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <FileSpreadsheet size={16} /> Export Excel
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
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text)' }}>
                Return No.
              </label>
              <input type="text" value={returnId ?? 'Unsaved'} disabled className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200" />
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
                TO Store <span className="text-red-500 font-bold">*</span>
              </label>
              {/* Was a native <select> — SearchableSelect so it types-to-search like the rest. */}
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
                Manual Invoice No. <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="text"
                value={billNo}
                disabled={isViewMode}
                onChange={e => setBillNo(e.target.value)}
                onBlur={e => {
                  const val = e.target.value.trim();
                  if (mode === 'new' && val !== '') {
                    prefillFromSaleBill(val);
                  }
                }}
                className="soleria-input soleria-input-compact"
              />
            </div>

            <div className="flex items-center gap-2 md:col-span-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="flex-1">
                <SearchableSelect
                  options={customerOptions}
                  value={customerId}
                  onChange={val => { setCustomerId(val); setSubCustomerId(''); }}
                  placeholder="Select customer..."
                  searchPlaceholder="Search customers..."
                  disabled={isViewMode}
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
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Delivery Agent <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <div className="flex-1">
                <SearchableSelect
                  options={subCustomers.map(sc => ({ value: String(sc.sub_customer_id), label: sc.name }))}
                  value={subCustomerId}
                  onChange={setSubCustomerId}
                  placeholder="SAME (Direct) — none selected"
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
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Customer Code
              </label>
              <input type="text" value={customerId} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Transport Adda <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <SearchableSelect
                options={addas.map(ad => ({ value: String(ad.adda_id), label: ad.name }))}
                value={addaId}
                onChange={setAddaId}
                placeholder="Select Adda..."
                searchPlaceholder="Search Adda..."
                disabled={isViewMode}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                GP No. <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="text" value={gpNo} disabled={isViewMode} onChange={e => setGpNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Bilty No. <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="text" value={biltyNo} disabled={isViewMode} onChange={e => setBiltyNo(e.target.value)} className="soleria-input soleria-input-compact" />
            </div>
          </div>

          {/* Product Items Table — flex-1 so it grows to fill whatever space invoiceCardHeight
              (above) leaves after every other section takes its natural size; this is what pins
              the footer to the bottom of the screen instead of trailing off after just 2-3 rows.
              `min-height: 0` overrides flexbox's default min-height:auto, which would otherwise
              let this box's own content stretch the whole card instead of scrolling internally.
              The header row is `sticky` within this scroll box so it stays visible past the first
              screenful of rows. SearchableSelect's own dropdown is rendered via a `fixed`-position
              React portal (see its source), so it isn't clipped by this box's `overflow-y: auto`
              even when a select near the bottom edge is opened. */}
          <div className="flex-1 min-h-0 mb-2 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ minWidth: '190px' }}>Returned Article <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 pl-3" style={{ width: '130px', minWidth: '110px' }}>Color <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ minWidth: '80px' }}>Stock</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Cartons <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '110px', minWidth: '96px' }}>Rate <span className="text-red-500 font-bold">*</span></th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-center" style={{ width: '100px', minWidth: '72px' }}>D%</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '110px' }}>D. Value</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1 text-right" style={{ width: '130px' }}>Total Credit</th>
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

                      {/* Stock — no real-time stock IPC channel exposed yet, see SaleBillPage comment */}
                      <td className="p-1 text-center text-xs font-medium">—</td>

                      {/* Cartons */}
                      <td className="p-1">
                        <input
                          type="number"
                          value={item.cartons || ''}
                          disabled={isViewMode}
                          min={1}
                          onChange={e => updateNumericField(idx, 'cartons', parseInt(e.target.value) || 0)}
                          className="soleria-input soleria-input-compact text-center font-mono"
                          style={{ border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Pairs */}
                      <td className="p-1 text-center text-sm font-bold text-slate-700">
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
                        Rs {item.value.toLocaleString('en-US')}
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
            <div className="shrink-0 flex flex-wrap items-center gap-3 mb-2">
              <button type="button" onClick={handleAddItemRow} className="btn-dashed flex items-center gap-1 px-3 py-1">
                <Plus size={14} /> Add Item Row
              </button>
              <span className="text-xs text-slate-400">
                Tip: type an existing Sale Bill's Manual Bill No. above and tab out to auto-prefill items from it.
              </span>
            </div>
          )}

          {/* Invoice Summary and Remarks — pinned to the bottom of the screen by the item table's
              flex-1 above (see invoiceCardHeight). Kept compact (small textarea, tight gaps, no
              min-height floor on the calculations box) in its own right too, matching SaleBillPage. */}
          <div className="shrink-0 grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            {/* Remarks */}
            <div className="flex flex-col gap-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 font-inter">
                RETURN REASON / REMARKS
              </label>
              <textarea
                value={remarks}
                disabled={isViewMode}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Enter return reasons or remarks..."
                className="soleria-input w-full rounded-xl border border-slate-200/90 p-2.5 focus:ring-2 focus:ring-[var(--brand-gold)]/20 focus:border-[var(--brand-gold)] transition-all"
                rows={2}
                style={{ fontSize: '13px', resize: 'none', minHeight: '52px' }}
              />
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
                  <span className="font-semibold font-mono">{totalPairs.toLocaleString('en-US')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gross Total:</span>
                  <span className="font-semibold font-mono">Rs {itemsTotalValue.toLocaleString('en-US')}</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-slate-400">Inv. Discount:</span>
                  {isViewMode ? (
                    <span className="font-semibold font-mono">Rs {invoiceDiscount.toLocaleString('en-US')}</span>
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
                <span className="font-bold text-[11px] uppercase tracking-wider text-slate-400">Total Credit Amount:</span>
                <span className="text-xl font-bold font-mono text-[#B08D57] font-extrabold">
                  Rs {finalTotalValue.toLocaleString('en-US')}
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
