import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import WeeklyTab from '@/components/WeeklyTab';
import MonthlyTab from '@/components/MonthlyTab';
import OverallTab from '@/components/OverallTab';
import FindTab from '@/components/FindTab';
import { Save, Plus, Trash2, Printer, FileDown, FileSpreadsheet, Edit } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import SearchableSelect from '@/components/SearchableSelect';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import * as api from '@/lib/api';
import type {
  CustomerRow, SubCustomerRow, ProductRow, ProductVariantRow, StoreRow, AddaRow,
  RegionRow, CityRow, SaleBillRow, SaleBillCreateInput, SaleBillItemInput
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
  const [lookupError, setLookupError] = useState('');

  useEffect(() => {
    (async () => {
      const [c, sc, p, st, ad, rg, ct] = await Promise.all([
        api.listCustomers(), api.listSubCustomers(), api.listProducts(),
        api.listStores(), api.listAddas(), api.listRegions(), api.listCities()
      ]);
      const failures: string[] = [];
      if (c.ok) setCustomers(c.data); else failures.push(c.error.message);
      if (sc.ok) setSubCustomers(sc.data); else failures.push(sc.error.message);
      if (p.ok) setProducts(p.data); else failures.push(p.error.message);
      if (st.ok) setStores(st.data); else failures.push(st.error.message);
      if (ad.ok) setAddas(ad.data); else failures.push(ad.error.message);
      if (rg.ok) setRegions(rg.data); else failures.push(rg.error.message);
      if (ct.ok) setCities(ct.data); else failures.push(ct.error.message);
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
  const [passwordActionType, setPasswordActionType] = useState<'edit_bill' | 'save_bill' | 'save_and_post' | 'post_bill' | null>(null);

  // Form State
  const [billId, setBillId] = useState<number | null>(null);
  const [currentBillIsPosted, setCurrentBillIsPosted] = useState(false);
  const [date, setDate] = useState('');
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

  useEffect(() => { refreshDrafts(); }, [refreshDrafts]);

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

  const addaOptions = useMemo(() => addas.map(ad => ({ value: String(ad.adda_id), label: ad.name })), [addas]);

  const selectedCustomer = useMemo(() => customers.find(c => c.customer_id === Number(customerId)), [customers, customerId]);

  const isCustomDelivery = useMemo(() => deliveryType === 'custom', [deliveryType]);

  const isNecessaryFieldsFilled = useMemo(() => {
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (!billNo) return false;
    if (!addaId) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.variantId || it.cartons <= 0 || it.rate <= 0)) return false;
    if (isCustomDelivery && !subCustomerId) return false;
    return true;
  }, [customerId, date, storeId, billNo, addaId, items, isCustomDelivery, subCustomerId]);

  const pendingEditRow = useRef<SaleBillRow | null>(null);

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
    setAddaId(String(row.adda_id));
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

  const handleEditSpecificBill = async (bill: SaleBillRow) => {
    if (bill.is_posted) {
      setPasswordActionType('edit_bill');
      setIsPasswordModalOpen(true);
      // stash for the password success handler
      pendingEditRow.current = bill;
    } else {
      await loadBillRow(bill);
      setMode('edit');
      setActiveTab('billing');
    }
  };

  const handlePrintSpecificBill = async (bill: SaleBillRow) => {
    await loadBillRow(bill);
    setIsPrintingSingle(true);
    setTimeout(() => {
      window.print();
      setIsPrintingSingle(false);
    }, 150);
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
  const handleNew = () => {
    setMode('new');
    setSelectedDraftId(null);
    setBillId(null);
    setCurrentBillIsPosted(false);
    setDate(new Date().toISOString().split('T')[0]);
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
    setAddaId(addas[0] ? String(addas[0].adda_id) : '');
    setRemarks('');
    setDueDate('');
    setInvoiceDiscount(0);
    setItems([newUiItem()]);
    setErrorMsg('');
  };

  const buildPayload = (): SaleBillCreateInput | null => {
    if (!date) { setErrorMsg('Date is required.'); return null; }
    if (!storeId) { setErrorMsg('Store is required.'); return null; }
    if (!customerId) { setErrorMsg('Customer is required.'); return null; }
    if (!billNo) { setErrorMsg('Bill No. is required.'); return null; }
    if (!addaId) { setErrorMsg('Transport Adda is required.'); return null; }
    if (items.length === 0) { setErrorMsg('At least one product item is required.'); return null; }

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
      adda_id: Number(addaId),
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
    setSuccessMsg(mode === 'edit' ? 'Sale bill updated successfully.' : 'New sale bill saved successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    setErrorMsg('');
    refreshDrafts();
    return result.data;
  };

  const handleSave = () => {
    if (mode === 'edit' && currentBillIsPosted) {
      setPasswordActionType('save_bill');
      setIsPasswordModalOpen(true);
    } else {
      executeSave();
    }
  };

  const handleSaveAndPost = () => {
    setPasswordActionType('save_and_post');
    setIsPasswordModalOpen(true);
  };

  const handlePostCurrentBill = () => {
    setPasswordActionType('post_bill');
    setIsPasswordModalOpen(true);
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

  const handleEditCurrentBill = () => {
    if (currentBillIsPosted) {
      setPasswordActionType('edit_bill');
      setIsPasswordModalOpen(true);
    } else {
      setMode('edit');
    }
  };

  const handlePasswordSuccess = async (password: string) => {
    setIsPasswordModalOpen(false);
    if (passwordActionType === 'edit_bill') {
      if (pendingEditRow.current) {
        await loadBillRow(pendingEditRow.current);
        pendingEditRow.current = null;
        setActiveTab('billing');
      }
      setMode('edit');
      setSuccessMsg(`Password verified. Bill editing unlocked.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } else if (passwordActionType === 'save_bill') {
      await executeSave(password);
    } else if (passwordActionType === 'save_and_post') {
      const saved = await executeSave();
      if (saved) {
        const postRes = await api.saleBills.post(saved.bill_id, password);
        if (!postRes.ok) {
          setErrorMsg('Bill was saved, but posting failed: ' + postRes.error.message);
        } else {
          setCurrentBillIsPosted(true);
          setSuccessMsg('Bill saved & posted successfully.');
          setTimeout(() => setSuccessMsg(''), 3000);
        }
      }
    } else if (passwordActionType === 'post_bill') {
      if (billId != null) {
        const res = await api.saleBills.post(billId, password);
        if (!res.ok) {
          setErrorMsg('Failed to post bill: ' + res.error.message);
        } else {
          setCurrentBillIsPosted(true);
          setSuccessMsg('Bill posted successfully.');
          setTimeout(() => setSuccessMsg(''), 3000);
        }
      }
    }
    setPasswordActionType(null);
  };

  const handleSaveDraft = async () => {
    const payload: Partial<SaleBillCreateInput> = {
      customer_id: customerId ? Number(customerId) : undefined,
      sub_customer_id: isCustomDelivery && subCustomerId ? Number(subCustomerId) : null,
      store_id: storeId ? Number(storeId) : undefined,
      bill_date: date || undefined,
      delivery_type: isCustomDelivery ? 'CUSTOM' : 'SAME',
      delivery_address: isCustomDelivery ? customAddress : undefined,
      bill_no: billNo,
      gp_no: gpNo,
      bilty_no: biltyNo,
      adda_id: addaId ? Number(addaId) : undefined,
      remarks: remarks || undefined,
      invoice_discount: invoiceDiscount,
      due_date: dueDate || undefined,
      items: items.filter(it => it.variantId).map(it => ({
        variant_id: it.variantId!,
        cartons: it.cartons,
        rate: it.rate,
        discount_percent: it.discountPercent
      }))
    };

    if (selectedDraftId != null) {
      await api.draftSaleBills.remove(selectedDraftId);
    }
    const res = await api.draftSaleBills.create(payload);
    if (!res.ok) {
      setErrorMsg('Failed to save draft: ' + res.error.message);
      return;
    }
    setSelectedDraftId(res.data.bill_id);
    setSuccessMsg('Bill saved to drafts.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshDrafts();
  };

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

  // Line Items Helper Actions
  const handleAddItemRow = () => setItems([...items, newUiItem()]);

  const handleRemoveItemRow = (idx: number) => {
    if (items.length <= 1) return;
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
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>WENTO ERP</h1>
            <p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#555555' }}>
              Footwear Wholesale Distribution
            </p>
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
            <span>{date}</span>
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

        {/* Signatures */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '60px', fontSize: '11px' }}>
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
      </div>
    );
  }

  return (
    <AppLayout pageTitle="Sale Bill">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {/* Top Tab Bar */}
        <div className="flex gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <button
            onClick={() => { setActiveTab('billing'); handleNew(); }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'billing' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            New Sale Bill
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'weekly' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Weekly Records
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'monthly' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Monthly Records
          </button>
          <button
            onClick={() => setActiveTab('overall')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'overall' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Overall Records
          </button>
          <button
            onClick={() => setActiveTab('find')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'find' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Find &amp; Update Bill
          </button>
        </div>

        {/* Tab contents (records & find) */}
        <div>
          {activeTab === 'weekly' && <WeeklyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'monthly' && <MonthlyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'overall' && <OverallTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'find' && <FindTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
        </div>

        <div className={activeTab === 'billing' ? 'block' : 'hidden'}>

        {/* Banner Messages */}
        {lookupError && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{lookupError}</div>
        )}
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4 flex items-center justify-between">
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4 flex items-center justify-between">
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Drafts Loader Panel */}
        {mode !== 'view' && drafts.length > 0 && (
          <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-4 text-sm" data-no-print>
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
                      {d.bill_no || 'No Number'} - {custName} ({d.bill_date.slice(0, 10)})
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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-4 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap gap-2">
            {mode === 'view' ? (
              <>
                <button
                  onClick={() => {
                    setIsPrintingSingle(true);
                    setTimeout(() => { window.print(); setIsPrintingSingle(false); }, 100);
                  }}
                  className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <Printer size={16} /> Print Invoice
                </button>
                <button onClick={exportToPDF} className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5">
                  <FileDown size={16} /> Export PDF
                </button>
                <button
                  onClick={() => {
                    const headers = ['Article', 'Packing', 'Cartons', 'Pairs', 'Rate', 'D%', 'D. Value', 'Total Value'];
                    const rows = items.map(it => [it.label, it.packing, it.cartons, it.pairs, it.rate, it.discountPercent, it.discountValue, it.value]);
                    exportRowsToExcel(`sale-bill-${billNo || billId}`, headers, rows);
                  }}
                  className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5"
                >
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
                <button
                  onClick={handleEditCurrentBill}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5"
                >
                  <Edit size={16} /> Edit Bill
                </button>
                {billId != null && !currentBillIsPosted && (
                  <button
                    onClick={handlePostCurrentBill}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                  >
                    Post Bill
                  </button>
                )}
                {billId != null && currentBillIsPosted && (
                  <button
                    onClick={handleUnpostCurrentBill}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
                  >
                    Unpost Bill
                  </button>
                )}
                <button onClick={handleNew} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all">
                  Create New Bill
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm font-inter hover:opacity-90"
                  style={{
                    backgroundColor: isNecessaryFieldsFilled ? '#111c2a' : '#e2e8f0',
                    color: isNecessaryFieldsFilled ? '#B08D57' : '#64748b',
                    border: isNecessaryFieldsFilled ? '1px solid #B08D57' : '1px solid #cbd5e1',
                    cursor: 'pointer'
                  }}
                >
                  <Save size={16} /> {mode === 'edit' ? 'Update Bill' : 'Save Bill'}
                </button>
                {!currentBillIsPosted && (
                  <button
                    onClick={handleSaveAndPost}
                    disabled={!isNecessaryFieldsFilled}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-50"
                  >
                    Save &amp; Post
                  </button>
                )}
                <button onClick={handleSaveDraft} className="btn-outline px-4 py-2 text-sm font-semibold rounded-lg flex items-center gap-1.5">
                  Save Draft
                </button>
                {mode === 'edit' ? (
                  <button onClick={() => setMode('view')} className="btn-outline px-4 py-2 text-sm font-semibold rounded-lg">
                    Cancel Edit
                  </button>
                ) : (
                  <button onClick={handleNew} className="btn-outline px-4 py-2 text-sm font-semibold rounded-lg">
                    Clear Form
                  </button>
                )}
              </>
            )}
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

        {/* Invoice Layout */}
        <div className="card-white shadow-sm p-6 md:p-8" style={{ border: '1px solid var(--border-color)', background: '#ffffff', overflow: 'visible' }}>

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

          {/* Master Info Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 pb-6 border-b" style={{ borderColor: 'var(--border-table)' }}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                System No.
              </label>
              <input type="text" value={billId ?? 'Unsaved'} disabled className="soleria-input bg-gray-50 text-gray-500 border-gray-200" style={{ fontSize: '13px' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="date" value={date} disabled={isViewMode} onChange={e => setDate(e.target.value)} className="soleria-input" style={{ fontSize: '13px' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                From Store <span className="text-red-500 font-bold">*</span>
              </label>
              <select value={storeId} disabled={isViewMode} onChange={e => setStoreId(e.target.value)} className="soleria-input cursor-pointer" style={{ fontSize: '13px' }}>
                <option value="">Select store...</option>
                {stores.map(st => (
                  <option key={st.store_id} value={st.store_id}>{st.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                Manual Bill No. <span className="text-red-500 font-bold">*</span>
              </label>
              <input type="text" value={billNo} disabled={isViewMode} onChange={e => setBillNo(e.target.value)} className="soleria-input" style={{ fontSize: '13px' }} />
            </div>
          </div>

          {/* Customer & Dispatch Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 pb-6 border-b" style={{ borderColor: 'var(--border-table)' }}>

            {/* Customer Details Box */}
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-slate-50 border col-span-1" style={{ borderColor: 'var(--border-color)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b pb-1.5">
                Customer Information
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-medium text-slate-600">
                      Select Customer Name <span className="text-red-500 font-bold">*</span>
                    </label>
                    {!isViewMode && (
                      <button
                        type="button"
                        onClick={() => setIsAddCustomerOpen(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102"
                      >
                        <Plus size={12} className="text-blue-600" />
                        <span>Add New Customer</span>
                      </button>
                    )}
                  </div>
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
                    <p className="text-[10px] text-amber-600 mt-1 font-semibold">
                      This customer has no linked business account — the bill cannot be posted until Setup adds one.
                    </p>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Customer Code
                  </label>
                  <input type="text" value={customerId} disabled className="soleria-input bg-gray-100 text-gray-500" style={{ fontSize: '12px' }} />
                </div>
              </div>
            </div>

            {/* Delivery & Logistics Box */}
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-slate-50 border col-span-1" style={{ borderColor: 'var(--border-color)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b pb-1.5">
                Delivery &amp; Logistics
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
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
                    className="soleria-input cursor-pointer"
                    style={{ fontSize: '13px' }}
                  >
                    <option value="1">SAME (Direct)</option>
                    <option value="custom">Custom Agent / Sub-Customer</option>
                  </select>
                </div>
                {isCustomDelivery && (
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-medium text-slate-600">
                        Sub-Customer <span className="text-red-500 font-bold">*</span>
                      </label>
                      {!isViewMode && (
                        <button
                          type="button"
                          onClick={() => setIsAddSubCustomerOpen(true)}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:scale-102"
                        >
                          <Plus size={12} className="text-blue-600" />
                          <span>Add New</span>
                        </button>
                      )}
                    </div>
                    <SearchableSelect
                      options={subCustomers.map(sc => ({ value: String(sc.sub_customer_id), label: sc.name }))}
                      value={subCustomerId}
                      onChange={setSubCustomerId}
                      placeholder="Select sub-customer..."
                      searchPlaceholder="Search sub-customers..."
                      disabled={isViewMode}
                    />
                  </div>
                )}
                {isCustomDelivery && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Custom Delivery Address
                    </label>
                    <input type="text" value={customAddress} disabled={isViewMode} onChange={e => setCustomAddress(e.target.value)} placeholder="Enter custom delivery address..." className="soleria-input" style={{ fontSize: '13px' }} />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Transport Adda <span className="text-red-500 font-bold">*</span>
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
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Gate Pass (GP) No.
                  </label>
                  <input type="text" value={gpNo} disabled={isViewMode} onChange={e => setGpNo(e.target.value)} className="soleria-input" style={{ fontSize: '13px' }} />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Bilty No.
                  </label>
                  <input type="text" value={biltyNo} disabled={isViewMode} onChange={e => setBiltyNo(e.target.value)} className="soleria-input" style={{ fontSize: '13px' }} />
                </div>
              </div>
            </div>

          </div>

          {/* Product Items Table */}
          <div className="mb-6 rounded-lg border bg-white overflow-visible" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ minWidth: '190px' }}>Article <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 pl-4" style={{ minWidth: '150px' }}>Color <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Stock</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Cartons <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="p-3 text-right" style={{ width: '110px' }}>Rate <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '100px' }}>D%</th>
                  <th className="p-3 text-right" style={{ width: '110px' }}>D. Value</th>
                  <th className="p-3 text-right" style={{ width: '130px' }}>Value</th>
                  {!isViewMode && <th className="p-3 text-center" style={{ width: '50px' }}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const variantOptions = (item.articleId != null ? variantsByArticle[item.articleId] || [] : [])
                    .map(v => ({ value: String(v.variant_id), label: v.color }));
                  return (
                    <tr key={item.uid} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      {/* Article select */}
                      <td className="p-3 pl-4">
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
                      <td className="p-3 pl-4">
                        {isViewMode ? (
                          <span className="text-slate-600 text-[13px]">{variantOptions.find(v => v.value === String(item.variantId))?.label || '-'}</span>
                        ) : (
                          <SearchableSelect
                            options={variantOptions}
                            value={item.variantId != null ? String(item.variantId) : ''}
                            onChange={val => handleVariantChange(idx, val)}
                            placeholder={item.articleId != null ? 'Select color...' : 'Select article first'}
                            searchPlaceholder="Search colors..."
                            disabled={item.articleId == null}
                          />
                        )}
                      </td>

                      {/* Packing */}
                      <td className="p-3 text-center font-mono text-sm text-slate-600">
                        {item.packing || '-'}
                      </td>

                      {/* Stock — no real-time stock IPC channel exposed yet, see comment above */}
                      <td className="p-3 text-center font-mono text-xs">—</td>

                      {/* Cartons */}
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.cartons || ''}
                          disabled={isViewMode}
                          min={1}
                          onChange={e => updateNumericField(idx, 'cartons', parseInt(e.target.value) || 0)}
                          className="soleria-input text-center font-mono"
                          style={{ fontSize: '13px', border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Pairs */}
                      <td className="p-3 text-center font-mono text-sm font-semibold text-slate-700">
                        {item.pairs || '-'}
                      </td>

                      {/* Rate */}
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.rate || ''}
                          disabled={isViewMode}
                          min={0}
                          onChange={e => updateNumericField(idx, 'rate', parseInt(e.target.value) || 0)}
                          className="soleria-input text-right font-mono"
                          style={{ fontSize: '13px', border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Discount % */}
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.discountPercent || ''}
                          disabled={isViewMode}
                          min={0}
                          max={100}
                          onChange={e => updateNumericField(idx, 'discountPercent', parseFloat(e.target.value) || 0)}
                          className="soleria-input text-center font-mono"
                          style={{ fontSize: '13px', border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Discount Value */}
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.discountValue || ''}
                          disabled={isViewMode}
                          min={0}
                          onChange={e => updateNumericField(idx, 'discountValue', parseInt(e.target.value) || 0)}
                          className="soleria-input text-right font-mono"
                          style={{ fontSize: '13px', border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Row Total Value */}
                      <td className="p-3 text-right font-mono font-semibold text-sm" style={{ color: 'var(--brand-gold)' }}>
                        {formatCurrency(item.value)}
                      </td>

                      {/* Delete Action */}
                      {!isViewMode && (
                        <td className="p-3 text-center">
                          <button onClick={() => handleRemoveItemRow(idx)} className="text-red-500 hover:text-red-700 p-1" disabled={items.length <= 1}>
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
            <button onClick={handleAddItemRow} className="btn-dashed flex items-center gap-1 mb-6 px-3 py-1.5">
              <Plus size={14} /> Add Item Row
            </button>
          )}

          {/* Bottom Section: Remarks & Calculations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 pt-4 border-t" style={{ borderColor: 'var(--border-table)' }}>
            {/* Remarks / Notes */}
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Remarks / Notes
              </label>
              <textarea
                value={remarks}
                disabled={isViewMode}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Enter any sales remarks..."
                className="soleria-input w-full flex-grow font-inter"
                rows={4}
                style={{ fontSize: '13px', resize: 'none', minHeight: '120px' }}
              />

              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mt-1">
                Payment Due Date <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input type="date" value={dueDate} disabled={isViewMode} onChange={e => setDueDate(e.target.value)} className="soleria-input" style={{ fontSize: '13px' }} />
              <p className="text-[10px] text-slate-400 -mt-1">
                Leave blank if this customer has no fixed payment terms — no overdue alert will be generated.
              </p>
            </div>

            {/* Calculations Box */}
            <div className="flex flex-col justify-between p-4 rounded-lg border transition-all bg-[#111c2a] text-white border-slate-800 shadow-md" style={{ minHeight: '160px' }}>
              <div className="text-xs font-semibold uppercase tracking-wider border-b pb-1.5 mb-2 text-slate-400 border-slate-800">
                Calculations
              </div>
              <div className="flex flex-col gap-2 font-inter text-xs">
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
                      className="soleria-input text-right font-mono py-0.5 px-2 border bg-slate-800 text-white border-slate-700 focus:ring-amber-500"
                      style={{ width: '85px', fontSize: '12px' }}
                    />
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center border-t pt-2 mt-2 border-[#1e293b]">
                <span className="font-bold text-[11px] uppercase tracking-wider text-slate-400">Net Amount:</span>
                <span className="text-xl font-bold font-mono text-[#B08D57] font-extrabold">
                  {formatCurrency(finalTotalValue)}
                </span>
              </div>
            </div>
          </div>

        </div>
        </div>

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
                <select
                  value={newSubCustomerRegionId}
                  onChange={e => { setNewSubCustomerRegionId(e.target.value); setNewSubCustomerCityId(''); }}
                  className="soleria-input font-semibold cursor-pointer"
                  required
                >
                  <option value="">Select Region...</option>
                  {regions.map(r => (
                    <option key={r.region_id} value={r.region_id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  City
                </label>
                <select value={newSubCustomerCityId} onChange={e => setNewSubCustomerCityId(e.target.value)} className="soleria-input font-semibold cursor-pointer">
                  <option value="">Select City...</option>
                  {cities
                    .filter(c => !newSubCustomerRegionId || c.region_id === Number(newSubCustomerRegionId))
                    .map(c => (
                      <option key={c.city_id} value={c.city_id}>{c.name}</option>
                    ))}
                </select>
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
                <select
                  value={newCustomerRegionId}
                  onChange={e => { setNewCustomerRegionId(e.target.value); setNewCustomerCityId(''); }}
                  className="soleria-input cursor-pointer font-semibold"
                  required
                >
                  <option value="">Select Region...</option>
                  {regions.map(rg => (
                    <option key={rg.region_id} value={rg.region_id}>{rg.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Select City
                </label>
                <select value={newCustomerCityId} onChange={e => setNewCustomerCityId(e.target.value)} className="soleria-input cursor-pointer font-semibold">
                  <option value="">Select City...</option>
                  {cities
                    .filter(ct => !newCustomerRegionId || ct.region_id === Number(newCustomerRegionId))
                    .map(ct => (
                      <option key={ct.city_id} value={ct.city_id}>{ct.name}</option>
                    ))}
                </select>
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
          pendingEditRow.current = null;
        }}
        onSuccess={handlePasswordSuccess}
        title={
          passwordActionType === 'edit_bill'
            ? 'Authorization Required to Edit Posted Bill'
            : passwordActionType === 'post_bill'
              ? 'Authorization Required to Post Bill'
              : 'Authorization Required to Save Bill Changes'
        }
        subtitle={
          passwordActionType === 'edit_bill'
            ? `Please enter password for user '${state.currentUsername || 'user'}' to unlock & edit Bill #${billNo || billId}.`
            : `Please enter password for user '${state.currentUsername || 'user'}' to confirm changes to Bill #${billNo || billId}.`
        }
      />
    </AppLayout>
  );
}
