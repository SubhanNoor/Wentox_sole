import { useState, useMemo, useEffect } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { SaleBill, SaleBillItem } from '@/types';
import WeeklyTab from '@/components/WeeklyTab';
import MonthlyTab from '@/components/MonthlyTab';
import OverallTab from '@/components/OverallTab';
import FindTab from '@/components/FindTab';
import { Save, Plus, Trash2, Printer } from 'lucide-react';

export default function SaleBillPage({ initialTab = 'billing' }: { initialTab?: 'billing' | 'weekly' | 'monthly' | 'overall' | 'find' }) {
  const { state, dispatch } = useApp();

  const [activeTab, setActiveTab] = useState<'billing' | 'weekly' | 'monthly' | 'overall' | 'find'>(initialTab);

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');
  


  // Form State
  const [billId, setBillId] = useState('');
  const [date, setDate] = useState('');
  const [storeId, setStoreId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [subCustomerId, setSubCustomerId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [gpNo, setGpNo] = useState('');
  const [biltyNo, setBiltyNo] = useState('');
  const [addaId, setAddaId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [status, setStatus] = useState<'Posted' | 'Unposted'>('Unposted');
  
  // Account Group state
  const [mainAcId, setMainAcId] = useState('');
  const [customMainAcName, setCustomMainAcName] = useState('');
  
  // Line items state
  const [items, setItems] = useState<SaleBillItem[]>([]);

  const [deliveryType, setDeliveryType] = useState<'1' | 'custom'>('1');
  const [customAddress, setCustomAddress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Add new sub-customer modal state
  const [isAddSubCustomerOpen, setIsAddSubCustomerOpen] = useState(false);
  const [newSubCustomerName, setNewSubCustomerName] = useState('');

  const filteredSubCustomers = useMemo(() => {
    return state.subCustomers.filter(sc => sc.customerId === customerId);
  }, [customerId, state.subCustomers]);

  const hasSubCustomers = useMemo(() => {
    return filteredSubCustomers.some(sc => sc.id !== 'sub-same');
  }, [filteredSubCustomers]);

  const isCustomDelivery = useMemo(() => {
    return deliveryType === 'custom' || hasSubCustomers;
  }, [deliveryType, hasSubCustomers]);

  // Drafts state loaded from local cache
  const [drafts, setDrafts] = useState<SaleBill[]>(() => {
    const saved = localStorage.getItem('wento_sale_bill_drafts');
    return saved ? JSON.parse(saved) : [];
  });

  // Check if all fields are filled to make the Confirm button blue
  const isAllFieldsFilled = useMemo(() => {
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (!billNo) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.productId || it.cartons <= 0 || it.rate <= 0)) return false;
    if (isCustomDelivery) {
      if (!subCustomerId || subCustomerId === 'sub-same') return false;
      if (!customAddress.trim()) return false;
    }
    return true;
  }, [customerId, date, storeId, billNo, items, isCustomDelivery, subCustomerId, customAddress]);

  // Load a bill into form fields
  const loadBill = (bill: SaleBill) => {
    setBillId(bill.id);
    setDate(bill.date);
    setStoreId(bill.storeId);
    setCustomerId(bill.customerId);
    setSubCustomerId(bill.subCustomerId || 'sub-same');
    setDeliveryType(!bill.subCustomerId || bill.subCustomerId === 'sub-same' ? '1' : 'custom');
    setCustomAddress(bill.customAddress || '');
    
    // Load Account Group
    if (bill.mainAcId) {
      if (state.chartAccounts.some(ac => ac.id === bill.mainAcId)) {
        setMainAcId(bill.mainAcId);
        setCustomMainAcName('');
      } else {
        setMainAcId('custom');
        setCustomMainAcName(bill.mainAcId);
      }
    } else {
      const cust = state.customers.find(c => c.id === bill.customerId);
      setMainAcId(cust?.acId || '');
      setCustomMainAcName('');
    }

    setBillNo(bill.billNo);
    setGpNo(bill.gpNo);
    setBiltyNo(bill.biltyNo);
    setAddaId(bill.addaId);
    setRemarks(bill.remarks);
    setInvoiceDiscount(bill.invoiceDiscount);
    setStatus(bill.status);
    setItems(bill.items);
    setErrorMsg('');
  };

  const handleEditSpecificBill = (bill: SaleBill) => {
    loadBill(bill);
    setMode('edit');
    setActiveTab('billing');
  };

  const handlePrintSpecificBill = (bill: SaleBill) => {
    loadBill(bill);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // Initialize new bill if mode is new and not set
  useEffect(() => {
    if (activeTab === 'billing' && mode === 'new' && !billId) {
      handleNew();
    }
  }, [activeTab, mode, billId]);



  // Auto-selection of account group and delivery type is handled directly in the customer dropdown onChange handler.



  // Calculations
  const totalCartons = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.cartons || 0), 0);
  }, [items]);

  const totalPairs = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.pairs || 0), 0);
  }, [items]);

  const itemsTotalValue = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.value || 0), 0);
  }, [items]);

  const finalTotalValue = useMemo(() => {
    return Math.max(0, itemsTotalValue - invoiceDiscount);
  }, [itemsTotalValue, invoiceDiscount]);

  // Toolbar Actions
  const handleNew = () => {
    setMode('new');
    setBillId('sb_' + Date.now());
    setDate(new Date().toISOString().split('T')[0]);
    setStoreId(state.stores[0]?.id || '');
    setCustomerId('');
    setSubCustomerId('sub-same');
    setDeliveryType('1');
    setCustomAddress('');
    setIsAddSubCustomerOpen(false);
    setNewSubCustomerName('');
    setMainAcId('');
    setCustomMainAcName('');
    setBillNo((Math.floor(Math.random() * 90000) + 10000).toString());
    setGpNo('');
    setBiltyNo('');
    setAddaId(state.addas[0]?.id || '');
    setRemarks('');
    setInvoiceDiscount(0);
    setStatus('Unposted');
    setItems([{
      id: 'sbi_' + Date.now() + '_0',
      productId: '',
      productName: '',
      packing: 0,
      cartons: 0,
      pairs: 0,
      rate: 0,
      discountPercent: 0,
      discountValue: 0,
      value: 0
    }]);
    setErrorMsg('');
  };



  const handleSave = () => {
    // Validations
    if (!date) return setErrorMsg('Date is required.');
    if (!storeId) return setErrorMsg('Store is required.');
    if (!customerId) return setErrorMsg('Customer is required.');
    if (!billNo) return setErrorMsg('Bill No. is required.');
    if (items.length === 0) return setErrorMsg('At least one product item is required.');

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productId) return setErrorMsg(`Product is required at row ${i + 1}.`);
      if (it.cartons <= 0) return setErrorMsg(`Cartons must be greater than 0 at row ${i + 1}.`);
      if (it.rate <= 0) return setErrorMsg(`Rate must be greater than 0 at row ${i + 1}.`);
    }

    if (isCustomDelivery && (!subCustomerId || subCustomerId === 'sub-same')) {
      return setErrorMsg('Please select a Sub-Customer for Custom Delivery.');
    }

    const savedBill: SaleBill = {
      id: billId,
      date,
      storeId,
      customerId,
      subCustomerId: !isCustomDelivery ? null : subCustomerId,
      customAddress: isCustomDelivery ? customAddress : undefined,
      mainAcId: mainAcId === 'custom' ? customMainAcName : mainAcId,
      billNo,
      gpNo,
      biltyNo,
      addaId,
      remarks,
      invoiceDiscount,
      totalValue: finalTotalValue,
      status,
      items
    };

    if (mode === 'new') {
      dispatch({ type: 'ADD_SALE_BILL', bill: savedBill });
      setSuccessMsg('New sale bill saved successfully.');
    } else {
      dispatch({ type: 'UPDATE_SALE_BILL', billId, bill: savedBill });
      setSuccessMsg('Sale bill updated successfully.');
    }

    // Clean up draft from cache if saved/confirmed
    setDrafts(prev => {
      const updated = prev.filter(d => d.id !== billId);
      localStorage.setItem('wento_sale_bill_drafts', JSON.stringify(updated));
      return updated;
    });

    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    setErrorMsg('');
  };

  const handleSaveDraft = () => {
    const draftBill: SaleBill = {
      id: billId || 'sb_draft_' + Date.now(),
      date,
      storeId,
      customerId,
      subCustomerId: !isCustomDelivery ? null : subCustomerId,
      customAddress: isCustomDelivery ? customAddress : undefined,
      mainAcId: mainAcId === 'custom' ? customMainAcName : mainAcId,
      billNo,
      gpNo,
      biltyNo,
      addaId,
      remarks,
      invoiceDiscount,
      totalValue: finalTotalValue,
      status: 'Unposted',
      items
    };

    setDrafts(prev => {
      const existingIdx = prev.findIndex(d => d.id === draftBill.id);
      let updated;
      if (existingIdx !== -1) {
        updated = [...prev];
        updated[existingIdx] = draftBill;
      } else {
        updated = [draftBill, ...prev];
      }
      localStorage.setItem('wento_sale_bill_drafts', JSON.stringify(updated));
      return updated;
    });

    setSuccessMsg('Bill saved to drafts cache.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };



  // Line Items Helper Actions
  const handleAddItemRow = () => {
    setItems([
      ...items,
      {
        id: 'sbi_' + Date.now() + '_' + items.length,
        productId: '',
        productName: '',
        packing: 0,
        cartons: 0,
        pairs: 0,
        rate: 0,
        discountPercent: 0,
        discountValue: 0,
        value: 0
      }
    ]);
  };

  const handleRemoveItemRow = (idx: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItemField = (idx: number, field: keyof SaleBillItem, val: any) => {
    const updated = items.map((item, i) => {
      if (i !== idx) return item;

      const newItem = { ...item, [field]: val };

      // If product changes, load properties
      if (field === 'productId') {
        const product = state.products.find(p => p.id === val);
        if (product) {
          newItem.productName = product.name;
          newItem.packing = product.packing;
          newItem.rate = product.costPrice + 50; // Set a default markup rate
          newItem.pairs = newItem.cartons * product.packing;
        } else {
          newItem.productName = '';
          newItem.packing = 0;
          newItem.pairs = 0;
        }
      }

      // Re-calculate pairs
      if (field === 'cartons' || field === 'productId') {
        newItem.pairs = newItem.cartons * newItem.packing;
      }

      // Re-calculate values
      const grossValue = newItem.pairs * newItem.rate;

      if (field === 'discountPercent') {
        newItem.discountValue = Math.round(grossValue * (newItem.discountPercent / 100));
      } else if (field === 'discountValue') {
        newItem.discountPercent = grossValue > 0 ? parseFloat(((newItem.discountValue / grossValue) * 100).toFixed(1)) : 0;
      } else {
        // Recalculate discount value from percent
        newItem.discountValue = Math.round(grossValue * (newItem.discountPercent / 100));
      }

      newItem.value = Math.max(0, grossValue - newItem.discountValue);

      return newItem;
    });
    setItems(updated);
  };



  const isViewMode = mode === 'view';

  return (
    <AppLayout pageTitle="Sale Bill">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {/* Top Tab Bar */}
        <div className="flex gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <button
            onClick={() => {
              setActiveTab('billing');
              handleNew();
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'billing'
                ? 'bg-[#111c2a] text-white shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            New Sale Bill
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'weekly'
                ? 'bg-[#111c2a] text-white shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Weekly Records
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'monthly'
                ? 'bg-[#111c2a] text-white shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Monthly Records
          </button>
          <button
            onClick={() => setActiveTab('overall')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'overall'
                ? 'bg-[#111c2a] text-white shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Overall Records
          </button>
          <button
            onClick={() => setActiveTab('find')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'find'
                ? 'bg-[#111c2a] text-white shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Find &amp; Update Bill
          </button>
        </div>

        {/* Tab contents (records & find) */}
        <div data-no-print>
          {activeTab === 'weekly' && <WeeklyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'monthly' && <MonthlyTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'overall' && <OverallTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
          {activeTab === 'find' && <FindTab onEditBill={handleEditSpecificBill} onPrintBill={handlePrintSpecificBill} />}
        </div>

        <div className={activeTab === 'billing' ? 'block' : 'hidden'}>
        
        {/* Banner Messages */}
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
                {drafts.length} incomplete bill(s) cached
              </span>
            </div>
            <div className="flex items-center gap-3">
              <select
                onChange={e => {
                  const selected = drafts.find(d => d.id === e.target.value);
                  if (selected) {
                    loadBill(selected);
                    setMode('new');
                  }
                }}
                className="soleria-input py-1 px-2.5 text-xs bg-white border cursor-pointer font-medium"
                style={{ width: '220px' }}
                value=""
              >
                <option value="">Select a draft to load...</option>
                {drafts.map(d => {
                  const custName = state.customers.find(c => c.id === d.customerId)?.name || 'Unnamed Customer';
                  return (
                    <option key={d.id} value={d.id}>
                      {d.billNo || 'No Number'} - {custName} ({d.date})
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => {
                  const selectEl = document.querySelector('select') as HTMLSelectElement;
                  const draftId = selectEl?.value;
                  if (draftId) {
                    setDrafts(prev => {
                      const updated = prev.filter(d => d.id !== draftId);
                      localStorage.setItem('wento_sale_bill_drafts', JSON.stringify(updated));
                      return updated;
                    });
                    handleNew();
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
                  onClick={() => window.print()}
                  className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <Printer size={16} /> Print Invoice
                </button>
                <button
                  onClick={handleNew}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                >
                  Create New Bill
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm border-none font-inter"
                  style={{
                    backgroundColor: isAllFieldsFilled ? '#2563eb' : '#f1f5f9',
                    color: isAllFieldsFilled ? '#ffffff' : '#94a3b8',
                    cursor: isAllFieldsFilled ? 'pointer' : 'not-allowed'
                  }}
                >
                  <Save size={16} /> Confirm
                </button>
                <button
                  onClick={handleSaveDraft}
                  className="btn-outline px-4 py-2 text-sm font-semibold rounded-lg flex items-center gap-1.5"
                >
                  Save Draft
                </button>
                {mode === 'edit' ? (
                  <button onClick={() => { setMode('view'); }} className="btn-outline px-4 py-2 text-sm font-semibold rounded-lg">
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
              Editing System Invoice: <span className="font-mono text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">{billId}</span>
            </div>
          )}
          
          {mode === 'view' && (
            <div className="text-sm font-semibold text-emerald-600 font-inter flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping text-[10px]"></span>
              Bill Confirmed &amp; Saved Successfully!
            </div>
          )}
        </div>

        {/* Invoice Layout */}
        <div className="card-white shadow-sm p-6 md:p-8" style={{ border: '1px solid var(--border-color)', background: '#ffffff' }}>
          
          {/* Print Title (Visible only when printing) */}
          <div className="hidden print:flex items-center justify-between mb-6 pb-4 border-b">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
              <p className="text-xs font-inter uppercase tracking-widest text-slate-500">Footwear Wholesale Distribution</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-xl">SALE BILL</h2>
              <p className="text-sm font-inter text-slate-500">Status: {status}</p>
            </div>
          </div>

          {/* Master Info Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 pb-6 border-b" style={{ borderColor: 'var(--border-table)' }}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                System No.
              </label>
              <input
                type="text"
                value={billId}
                disabled
                className="soleria-input bg-gray-50 text-gray-500 border-gray-200"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                Date
              </label>
              <input
                type="date"
                value={date}
                disabled={isViewMode}
                onChange={e => setDate(e.target.value)}
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                From Store
              </label>
              <select
                value={storeId}
                disabled={isViewMode}
                onChange={e => setStoreId(e.target.value)}
                className="soleria-input cursor-pointer"
                style={{ fontSize: '13px' }}
              >
                {state.stores.map(st => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                Manual Bill No.
              </label>
              <input
                type="text"
                value={billNo}
                disabled={isViewMode}
                onChange={e => setBillNo(e.target.value)}
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
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
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Select Customer Name
                  </label>
                  <select
                    value={customerId}
                    disabled={isViewMode}
                    onChange={e => {
                      const newCustId = e.target.value;
                      setCustomerId(newCustId);
                      
                      // Auto account group selection
                      const newCust = state.customers.find(c => c.id === newCustId);
                      if (newCust) {
                        setMainAcId(newCust.acId || '');
                        setCustomMainAcName('');
                        
                        // Auto delivery type and sub-customer selection if sub-customers exist
                        const subs = state.subCustomers.filter(sc => sc.customerId === newCustId && sc.id !== 'sub-same');
                        if (subs.length > 0) {
                          setDeliveryType('custom');
                          setSubCustomerId(subs[0].id);
                        } else {
                          setDeliveryType('1');
                          setSubCustomerId('sub-same');
                          setCustomAddress('');
                        }
                      } else {
                        setMainAcId('');
                        setCustomMainAcName('');
                        setDeliveryType('1');
                        setSubCustomerId('sub-same');
                        setCustomAddress('');
                      }
                    }}
                    className="soleria-input cursor-pointer"
                    style={{ fontSize: '13px' }}
                  >
                    <option value="">Select customer...</option>
                    {state.customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Customer Code
                  </label>
                  <input
                    type="text"
                    value={customerId}
                    disabled
                    className="soleria-input bg-gray-100 text-gray-500"
                    style={{ fontSize: '12px' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Main Account Group
                  </label>
                  <select
                    value={mainAcId}
                    disabled={isViewMode}
                    onChange={e => {
                      setMainAcId(e.target.value);
                      if (e.target.value !== 'custom') {
                        setCustomMainAcName('');
                      }
                    }}
                    className="soleria-input cursor-pointer"
                    style={{ fontSize: '13px' }}
                  >
                    <option value="">Select Account Group...</option>
                    {state.chartAccounts.map(ac => (
                      <option key={ac.id} value={ac.id}>{ac.name}</option>
                    ))}
                    <option value="custom">Other / Custom Group...</option>
                  </select>
                  {mainAcId === 'custom' && (
                    <input
                      type="text"
                      value={customMainAcName}
                      disabled={isViewMode}
                      onChange={e => setCustomMainAcName(e.target.value)}
                      placeholder="Enter account group name..."
                      className="soleria-input mt-2"
                      style={{ fontSize: '12px' }}
                    />
                  )}
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
                    disabled={isViewMode || hasSubCustomers}
                    onChange={e => {
                      const val = e.target.value as '1' | 'custom';
                      setDeliveryType(val);
                      if (val === '1') {
                        setSubCustomerId('sub-same');
                        setCustomAddress('');
                      } else {
                        const realSubs = filteredSubCustomers.filter(sc => sc.id !== 'sub-same');
                        setSubCustomerId(realSubs[0]?.id || '');
                      }
                    }}
                    className="soleria-input cursor-pointer"
                    style={{ fontSize: '13px' }}
                  >
                    <option value="1">1 = SAME (Direct)</option>
                    <option value="custom">Custom Agent / Sub-Customer</option>
                  </select>
                </div>
                {isCustomDelivery && (
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-medium text-slate-600">
                        Sub-Customer
                      </label>
                      {!isViewMode && (
                        <button
                          type="button"
                          disabled={!customerId}
                          onClick={() => {
                            if (!customerId) {
                              setErrorMsg('Please select a main customer first.');
                              setTimeout(() => setErrorMsg(''), 3000);
                              return;
                            }
                            setIsAddSubCustomerOpen(true);
                          }}
                          className={`text-[10px] font-bold underline transition-colors ${
                            customerId ? 'text-blue-600 hover:text-blue-800' : 'text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          + Add New
                        </button>
                      )}
                    </div>
                    <select
                      value={subCustomerId}
                      disabled={isViewMode}
                      onChange={e => setSubCustomerId(e.target.value)}
                      className="soleria-input cursor-pointer"
                      style={{ fontSize: '13px' }}
                    >
                      <option value="">Select sub-customer...</option>
                      {filteredSubCustomers.map(sc => (
                        <option key={sc.id} value={sc.id}>{sc.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {isCustomDelivery && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Custom Delivery Address
                    </label>
                    <input
                      type="text"
                      value={customAddress}
                      disabled={isViewMode}
                      onChange={e => setCustomAddress(e.target.value)}
                      placeholder="Enter custom delivery address..."
                      className="soleria-input"
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Transport Adda
                  </label>
                  <select
                    value={addaId}
                    disabled={isViewMode}
                    onChange={e => setAddaId(e.target.value)}
                    className="soleria-input cursor-pointer"
                    style={{ fontSize: '13px' }}
                  >
                    {state.addas.map(ad => (
                      <option key={ad.id} value={ad.id}>{ad.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Gate Pass (GP) No.
                  </label>
                  <input
                    type="text"
                    value={gpNo}
                    disabled={isViewMode}
                    onChange={e => setGpNo(e.target.value)}
                    className="soleria-input"
                    style={{ fontSize: '13px' }}
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Bilty No.
                  </label>
                  <input
                    type="text"
                    value={biltyNo}
                    disabled={isViewMode}
                    onChange={e => setBiltyNo(e.target.value)}
                    className="soleria-input"
                    style={{ fontSize: '13px' }}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Product Items Table */}
          <div className="mb-6 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ minWidth: '220px' }}>Article / Product</th>
                  <th className="p-3 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Stock</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Cartons</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="p-3 text-right" style={{ width: '110px' }}>Rate</th>
                  <th className="p-3 text-center" style={{ width: '100px' }}>D%</th>
                  <th className="p-3 text-right" style={{ width: '110px' }}>D. Value</th>
                  <th className="p-3 text-right" style={{ width: '130px' }}>Value</th>
                  {!isViewMode && <th className="p-3 text-center" style={{ width: '50px' }}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const product = state.products.find(p => p.id === item.productId);
                  const inStock = product ? product.stock : 0;
                  return (
                    <tr key={item.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      {/* Product select */}
                      <td className="p-3 pl-4">
                        <select
                          value={item.productId}
                          disabled={isViewMode}
                          onChange={e => updateItemField(idx, 'productId', e.target.value)}
                          className="soleria-input cursor-pointer"
                          style={{ fontSize: '13px', border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        >
                          <option value="">Select article...</option>
                          {state.products.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                          ))}
                        </select>
                      </td>

                      {/* Packing */}
                      <td className="p-3 text-center font-mono text-sm text-slate-600">
                        {item.packing || '-'}
                      </td>

                      {/* Stock */}
                      <td className="p-3 text-center font-mono text-xs">
                        {item.productId ? (
                          <span className={`px-2 py-0.5 rounded-full ${inStock && inStock < item.pairs ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                            {inStock}
                          </span>
                        ) : '-'}
                      </td>

                      {/* Cartons */}
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.cartons || ''}
                          disabled={isViewMode}
                          min={1}
                          onChange={e => updateItemField(idx, 'cartons', parseInt(e.target.value) || 0)}
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
                          onChange={e => updateItemField(idx, 'rate', parseInt(e.target.value) || 0)}
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
                          onChange={e => updateItemField(idx, 'discountPercent', parseFloat(e.target.value) || 0)}
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
                          onChange={e => updateItemField(idx, 'discountValue', parseInt(e.target.value) || 0)}
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
                          <button
                            onClick={() => handleRemoveItemRow(idx)}
                            className="text-red-500 hover:text-red-700 p-1"
                            disabled={items.length <= 1}
                          >
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
            <button
              onClick={handleAddItemRow}
              className="btn-dashed flex items-center gap-1 mb-6 px-3 py-1.5"
            >
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
            </div>

            {/* Calculations Box */}
            <div
              className="flex flex-col justify-between p-4 rounded-lg border transition-all bg-[#111c2a] text-white border-slate-800 shadow-md"
              style={{ minHeight: '160px' }}
            >
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
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">
              Add New Sub-Customer
            </h3>
            
            {/* Main Customer Link Display */}
            <div className="mb-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Main Customer
              </label>
              <input
                type="text"
                disabled
                value={state.customers.find(c => c.id === customerId)?.name || 'Please select a main customer first'}
                className="soleria-input bg-slate-50 text-slate-500 font-medium"
              />
            </div>

            {/* Sub-Customer Name Input */}
            <div className="mb-6">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Sub-Customer Name
              </label>
              <input
                type="text"
                value={newSubCustomerName}
                onChange={e => setNewSubCustomerName(e.target.value)}
                placeholder="Enter sub-customer name..."
                className="soleria-input"
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 text-sm font-semibold">
              <button
                type="button"
                onClick={() => {
                  setIsAddSubCustomerOpen(false);
                  setNewSubCustomerName('');
                }}
                className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!customerId) {
                    setErrorMsg('Please select a main customer first.');
                    setTimeout(() => setErrorMsg(''), 3000);
                    return;
                  }
                  if (!newSubCustomerName.trim()) {
                    alert('Sub-customer name cannot be empty.');
                    return;
                  }
                  const newId = 'sc_' + Date.now();
                  dispatch({
                    type: 'ADD_SUB_CUSTOMER',
                    subCust: {
                      id: newId,
                      name: newSubCustomerName.trim(),
                      customerId
                    }
                  });
                  setSubCustomerId(newId);
                  setIsAddSubCustomerOpen(false);
                  setNewSubCustomerName('');
                  setSuccessMsg('Sub-customer added successfully.');
                  setTimeout(() => setSuccessMsg(''), 3000);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm"
              >
                Add Sub-Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
