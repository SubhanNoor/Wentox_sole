import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { SaleReturn, SaleReturnItem, SaleBill } from '@/types';
import WeeklyReturnTab from '@/components/WeeklyReturnTab';
import MonthlyReturnTab from '@/components/MonthlyReturnTab';
import OverallReturnTab from '@/components/OverallReturnTab';
import FindReturnTab from '@/components/FindReturnTab';
import { Save, Plus, Trash2, Printer, Lock } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';

export default function SaleReturnPage({ initialTab = 'return' }: { initialTab?: 'return' | 'weekly' | 'monthly' | 'overall' | 'find' }) {
  const { state, dispatch } = useApp();

  const [activeTab, setActiveTab] = useState<'return' | 'weekly' | 'monthly' | 'overall' | 'find'>(initialTab);

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');

  // Form State
  const [returnId, setReturnId] = useState('');
  const [date, setDate] = useState('');
  const [storeId, setStoreId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [subCustomerId, setSubCustomerId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [gpNo, setGpNo] = useState('');
  const [biltyNo, setBiltyNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [status, setStatus] = useState<'Posted' | 'Unposted'>('Unposted');
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  
  // Line items state
  const [items, setItems] = useState<SaleReturnItem[]>([]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isPrintingSingle, setIsPrintingSingle] = useState(false);

  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === customerId);
  }, [customerId, state.customers]);

  const customerMainAcName = useMemo(() => {
    if (!selectedCustomer) return '';
    return state.chartAccounts.find(a => a.id === selectedCustomer.acId)?.name || 'CUSTOMERS ACCOUNTS';
  }, [selectedCustomer, state.chartAccounts]);

  // Sub Customers are an independent flat list (no parent Customer link)
  const filteredSubCustomers = state.subCustomers;

  // Customer search: Primary = Region, Secondary = City
  const sortedCustomers = useMemo(() => {
    const regionName = (id: string) => state.regions.find(r => r.id === id)?.name || '';
    const cityName = (id: string) => state.cities.find(ct => ct.id === id)?.name || '';
    return [...state.customers].sort((a, b) => {
      const regionCmp = regionName(a.regionId).localeCompare(regionName(b.regionId));
      if (regionCmp !== 0) return regionCmp;
      return cityName(a.cityId).localeCompare(cityName(b.cityId));
    });
  }, [state.customers, state.regions, state.cities]);

  // Drafts state loaded from local cache
  const [drafts, setDrafts] = useState<SaleReturn[]>(() => {
    const saved = localStorage.getItem('wento_sale_return_drafts');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedDraftId, setSelectedDraftId] = useState('');

  // Check if all necessary fields are filled to toggle Confirm button shade
  const isNecessaryFieldsFilled = useMemo(() => {
    if (!customerId) return false;
    if (!date) return false;
    if (!storeId) return false;
    if (!billNo) return false;
    if (items.length === 0) return false;
    if (items.some(it => !it.productId || it.cartons <= 0 || it.rate <= 0)) return false;
    return true;
  }, [customerId, date, storeId, billNo, items]);

  // Load a return into form fields
  const loadReturn = (ret: SaleReturn) => {
    setReturnId(ret.id);
    setDate(ret.date);
    setStoreId(ret.storeId);
    setCustomerId(ret.customerId);
    setSubCustomerId(ret.subCustomerId || 'sub-same');
    setBillNo(ret.billNo);
    setGpNo(ret.gpNo || '');
    setBiltyNo(ret.biltyNo || '');
    setRemarks(ret.remarks || '');
    setStatus(ret.status);
    setInvoiceDiscount(ret.invoiceDiscount || 0);
    setItems(ret.items);
    setErrorMsg('');
  };

  // Pre-fill a return from a Sale Bill
  const prefillFromSaleBill = (bill: SaleBill) => {
    setStoreId(bill.storeId);
    setCustomerId(bill.customerId);
    setSubCustomerId(bill.subCustomerId || 'sub-same');
    setGpNo(bill.gpNo || '');
    setBiltyNo(bill.biltyNo || '');
    setRemarks(`Return from Sale Bill No. ${bill.billNo}`);
    setInvoiceDiscount(bill.invoiceDiscount || 0);
    const mappedItems: SaleReturnItem[] = bill.items.map((it, idx) => ({
      id: `ret-item-${Date.now()}-${idx}`,
      productId: it.productId,
      productName: it.productName,
      packing: it.packing,
      cartons: it.cartons,
      pairs: it.pairs,
      rate: it.rate,
      discountPercent: it.discountPercent,
      discountValue: it.discountValue,
      value: it.value
    }));
    setItems(mappedItems);
    setSuccessMsg(`Prefilled return items from Sale Bill No. ${bill.billNo}`);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleEditSpecificReturn = (ret: SaleReturn) => {
    loadReturn(ret);
    setMode('edit');
    setActiveTab('return');
  };

  const handlePrintSpecificReturn = (ret: SaleReturn) => {
    loadReturn(ret);
    setIsPrintingSingle(true);
    setTimeout(() => {
      window.print();
      setIsPrintingSingle(false);
    }, 150);
  };

  // Initialize new return if mode is new and not set
  useEffect(() => {
    if (activeTab === 'return' && mode === 'new' && !returnId) {
      handleNew();
    }
  }, [activeTab, mode, returnId]);

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
    setSelectedDraftId('');
    setReturnId('sr_' + Date.now());
    setDate(new Date().toISOString().split('T')[0]);
    setStoreId(state.stores[0]?.id || '');
    setCustomerId('');
    setSubCustomerId('sub-same');
    setBillNo('RET-' + (Math.floor(Math.random() * 9000) + 1000).toString());
    setGpNo('');
    setBiltyNo('');
    setRemarks('');
    setStatus('Unposted');
    setInvoiceDiscount(0);
    setItems([{
      id: 'sri_' + Date.now() + '_0',
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
    if (!billNo) return setErrorMsg('Return Bill No. is required.');
    if (items.length === 0) return setErrorMsg('At least one product item is required.');

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productId) return setErrorMsg(`Product is required at row ${i + 1}.`);
      if (it.cartons <= 0) return setErrorMsg(`Cartons must be greater than 0 at row ${i + 1}.`);
      if (it.rate <= 0) return setErrorMsg(`Rate must be greater than 0 at row ${i + 1}.`);
    }

    const savedReturn: SaleReturn = {
      id: returnId,
      date,
      storeId,
      customerId,
      subCustomerId: subCustomerId === 'sub-same' ? null : subCustomerId,
      billNo,
      gpNo,
      biltyNo,
      remarks,
      status,
      invoiceDiscount,
      items
    };

    if (mode === 'new') {
      dispatch({ type: 'ADD_SALE_RETURN', returnObj: savedReturn });
      setSuccessMsg('New sale return saved successfully.');
    } else {
      dispatch({ type: 'UPDATE_SALE_RETURN', returnId, returnObj: savedReturn });
      setSuccessMsg('Sale return updated successfully.');
    }

    // Clean up draft from cache if saved/confirmed
    setDrafts(prev => {
      const updated = prev.filter(d => d.id !== returnId && d.id !== selectedDraftId);
      localStorage.setItem('wento_sale_return_drafts', JSON.stringify(updated));
      return updated;
    });
    setSelectedDraftId('');

    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    setErrorMsg('');
  };

  const handleSaveDraft = () => {
    const draftReturn: SaleReturn = {
      id: returnId || 'sr_draft_' + Date.now(),
      date,
      storeId,
      customerId,
      subCustomerId: subCustomerId === 'sub-same' ? null : subCustomerId,
      billNo,
      gpNo,
      biltyNo,
      remarks,
      invoiceDiscount,
      status: 'Unposted',
      items
    };

    setDrafts(prev => {
      const existingIdx = prev.findIndex(d => d.id === draftReturn.id);
      let updated;
      if (existingIdx !== -1) {
        updated = [...prev];
        updated[existingIdx] = draftReturn;
      } else {
        updated = [draftReturn, ...prev];
      }
      localStorage.setItem('wento_sale_return_drafts', JSON.stringify(updated));
      return updated;
    });

    setSuccessMsg('Return saved to drafts cache.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handlePostToggle = () => {
    if (status === 'Unposted') {
      dispatch({ type: 'POST_SALE_RETURN', returnId });
      setStatus('Posted');
      setSuccessMsg('Return Posted to accounts and stock updated.');
    }
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // Line Items Helper Actions
  const handleAddItemRow = () => {
    setItems([
      ...items,
      {
        id: 'sri_' + Date.now() + '_' + items.length,
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

  // TASK-12: products previously purchased by the selected customer (from their posted Sale Bills)
  // — used to auto-fill a line item; does not change how the return is manually entered.
  const customerPurchaseHistory = useMemo(() => {
    if (!customerId) return [];
    const seen = new Map<string, string>(); // productId -> productName
    state.saleBills
      .filter(b => b.customerId === customerId && b.status === 'Posted')
      .forEach(bill => {
        bill.items.forEach(it => {
          if (it.productId && !seen.has(it.productId)) {
            seen.set(it.productId, it.productName);
          }
        });
      });
    return Array.from(seen.entries()).map(([productId, productName]) => ({ productId, productName }));
  }, [customerId, state.saleBills]);

  const handleQuickAddFromHistory = (productId: string) => {
    if (!productId) return;
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const filledItem: SaleReturnItem = {
      id: 'sri_' + Date.now() + '_' + items.length,
      productId: product.id,
      productName: product.name,
      packing: product.packing,
      cartons: 0,
      pairs: 0,
      rate: product.costPrice + 50,
      discountPercent: 0,
      discountValue: 0,
      value: 0
    };

    // Fill the last row if it's still empty, otherwise append a new one
    const lastIdx = items.length - 1;
    if (items.length > 0 && !items[lastIdx].productId) {
      setItems(items.map((it, i) => i === lastIdx ? filledItem : it));
    } else {
      setItems([...items, filledItem]);
    }
  };

  const updateItemField = (idx: number, field: keyof SaleReturnItem, val: any) => {
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

  if (isPrintingSingle) {
    const customerObj = state.customers.find(c => c.id === customerId);
    const customerName = customerObj ? customerObj.name : (customerId || 'N/A');
    const storeObj = state.stores.find(s => s.id === storeId);
    const storeName = storeObj ? storeObj.name : (storeId || 'N/A');
    const returnAcId = customerObj ? customerObj.acId : '';
    const mainAcName = state.chartAccounts.find(c => c.id === returnAcId)?.name || 'CUSTOMERS ACCOUNTS';

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
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>SALE RETURN INVOICE</h2>
            <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>Status: {status}</p>
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
            <span>{returnId}</span>
          </div>
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Date</label>
            <span>{date}</span>
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
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Account Group</label>
            <span>{mainAcName}</span>
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
              const product = state.products.find(p => p.id === item.productId);
              const productName = product ? product.name : (item.productId || 'N/A');
              const discountText = item.discountPercent > 0 
                ? `${item.discountPercent}%` 
                : item.discountValue > 0 
                  ? `${item.discountValue.toLocaleString()}` 
                  : '-';
              
              return (
                <tr key={item.id}>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{productName}</td>
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
    <AppLayout pageTitle="Sale Return">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {/* Top Tab Bar */}
        <div className="flex gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <button
            onClick={() => {
              setActiveTab('return');
              handleNew();
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'return'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            New Sale Return
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'weekly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Weekly Records
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'monthly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Monthly Records
          </button>
          <button
            onClick={() => setActiveTab('overall')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'overall'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Overall Records
          </button>
          <button
            onClick={() => setActiveTab('find')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'find'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            Find &amp; Update Return
          </button>
        </div>

        {/* Tab contents (records & find) */}
        <div>
          {activeTab === 'weekly' && <WeeklyReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'monthly' && <MonthlyReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'overall' && <OverallReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
          {activeTab === 'find' && <FindReturnTab onEditReturn={handleEditSpecificReturn} onPrintReturn={handlePrintSpecificReturn} />}
        </div>

        <div className={activeTab === 'return' ? 'block' : 'hidden'}>
        
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
              <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                {drafts.length} incomplete return(s) cached
              </span>
            </div>
            <div className="flex items-center gap-3">
               <select
                value={selectedDraftId}
                onChange={e => {
                  const draftId = e.target.value;
                  setSelectedDraftId(draftId);
                  const selected = drafts.find(d => d.id === draftId);
                  if (selected) {
                    loadReturn(selected);
                    setMode('new');
                  }
                }}
                className="soleria-input py-1 px-2.5 text-xs bg-white border cursor-pointer font-medium"
                style={{ width: '220px' }}
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
                  if (selectedDraftId) {
                    setDrafts(prev => {
                      const updated = prev.filter(d => d.id !== selectedDraftId);
                      localStorage.setItem('wento_sale_return_drafts', JSON.stringify(updated));
                      return updated;
                    });
                    setSelectedDraftId('');
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
                  onClick={() => {
                    setIsPrintingSingle(true);
                    setTimeout(() => {
                      window.print();
                      setIsPrintingSingle(false);
                    }, 100);
                  }}
                  className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <Printer size={16} /> Print Return
                </button>
                <button
                  onClick={handleNew}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                >
                  Create New Return
                </button>
                {status === 'Unposted' && (
                  <button onClick={handlePostToggle} className="flex items-center gap-1.5 px-4 py-2 rounded-md font-semibold text-sm transition-colors border bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                    <Lock size={16} /> Post Return
                  </button>
                )}
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
              Editing System Return: <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">{returnId}</span>
            </div>
          )}
          
          {mode === 'view' && (
            <div className="text-sm font-semibold text-emerald-600 font-inter flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping text-[10px]"></span>
              Return Confirmed &amp; Saved Successfully!
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
              <h2 className="font-lora font-semibold text-xl">SALE RETURN</h2>
              <p className="text-sm font-inter text-slate-500">Status: {status}</p>
            </div>
          </div>

          {/* Master Info Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 pb-6 border-b" style={{ borderColor: 'var(--border-table)' }}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                Return No.
              </label>
              <input
                type="text"
                value={returnId}
                disabled
                className="soleria-input bg-gray-50 text-gray-500 border-gray-200"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                Date <span className="text-red-500 font-bold">*</span>
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
                TO Store (Return Destination) <span className="text-red-500 font-bold">*</span>
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
                Manual Invoice No. <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="text"
                value={billNo}
                disabled={isViewMode}
                onChange={e => {
                  const val = e.target.value;
                  setBillNo(val);
                  if (mode === 'new' && val.trim() !== '') {
                    // 1. Check if there is an existing return with this billNo (switch to edit mode)
                    const matchedReturn = state.saleReturns.find(r => r.billNo.trim().toLowerCase() === val.trim().toLowerCase());
                    if (matchedReturn) {
                      loadReturn(matchedReturn);
                      setMode('edit');
                      return;
                    }
                    // 2. Check if there is an existing sale bill with this billNo (prefill return items)
                    const matchedBill = state.saleBills.find(b => b.billNo.trim().toLowerCase() === val.trim().toLowerCase());
                    if (matchedBill) {
                      prefillFromSaleBill(matchedBill);
                    }
                  }
                }}
                onBlur={e => {
                  const val = e.target.value;
                  if (mode === 'new' && val.trim() !== '') {
                    // 1. Check if there is an existing return with this billNo (switch to edit mode)
                    const matchedReturn = state.saleReturns.find(r => r.billNo.trim().toLowerCase() === val.trim().toLowerCase());
                    if (matchedReturn) {
                      loadReturn(matchedReturn);
                      setMode('edit');
                      return;
                    }
                    // 2. Check if there is an existing sale bill with this billNo (prefill return items)
                    const matchedBill = state.saleBills.find(b => b.billNo.trim().toLowerCase() === val.trim().toLowerCase());
                    if (matchedBill) {
                      prefillFromSaleBill(matchedBill);
                    }
                  }
                }}
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
                    Select Customer Name <span className="text-red-500 font-bold">*</span>
                  </label>
                  <select
                    value={customerId}
                    disabled={isViewMode}
                    onChange={e => {
                      setCustomerId(e.target.value);
                      setSubCustomerId('sub-same');
                    }}
                    className="soleria-input cursor-pointer"
                    style={{ fontSize: '13px' }}
                  >
                    <option value="">Select customer...</option>
                    {sortedCustomers.map(c => (
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
                  <input
                    type="text"
                    value={customerMainAcName}
                    disabled
                    className="soleria-input bg-gray-100 text-gray-500"
                    style={{ fontSize: '12px' }}
                  />
                </div>
              </div>
            </div>

            {/* Delivery & Dispatch Box */}
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-slate-50 border col-span-1" style={{ borderColor: 'var(--border-color)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b pb-1.5">
                Dispatch Logistics
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Delivery Agent (if any)
                  </label>
                  <SearchableSelect
                    options={[
                      { value: 'sub-same', label: 'SAME (Direct)' },
                      ...filteredSubCustomers.map(sc => ({ value: sc.id, label: sc.name }))
                    ]}
                    value={subCustomerId}
                    onChange={setSubCustomerId}
                    placeholder="Select delivery agent..."
                    searchPlaceholder="Search sub-customers..."
                    disabled={isViewMode}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    GP No.
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
                <div>
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
          <div className="mb-6 rounded-lg border bg-white overflow-visible" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ minWidth: '220px' }}>Returned Article <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Stock</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Cartons <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="p-3 text-right" style={{ width: '110px' }}>Rate <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '100px' }}>D%</th>
                  <th className="p-3 text-right" style={{ width: '110px' }}>D. Value</th>
                  <th className="p-3 text-right" style={{ width: '130px' }}>Total Credit</th>
                  {!isViewMode && <th className="p-3 text-center" style={{ width: '50px' }}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const product = state.products.find(p => p.id === item.productId);
                  const inStock = product ? product.stock : 0;
                  return (
                    <tr key={item.id} className="border-b hover:bg-slate-50/55 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                      {/* Product select */}
                      <td className="p-3 pl-4">
                        {isViewMode ? (
                          <span className="font-semibold text-slate-800 text-[13px] pl-2">
                            {state.products.find(p => p.id === item.productId)?.name || 'Select article...'}
                          </span>
                        ) : (
                          <SearchableSelect
                            options={state.products.map(p => ({
                              value: p.id,
                              label: `${p.name} (${p.id})`
                            }))}
                            value={item.productId}
                            onChange={val => updateItemField(idx, 'productId', val)}
                            placeholder="Select article..."
                            searchPlaceholder="Search articles..."
                          />
                        )}
                      </td>

                      {/* Packing */}
                      <td className="p-3 text-center text-sm text-slate-600 font-medium">
                        {item.packing || '-'}
                      </td>

                      {/* Stock */}
                      <td className="p-3 text-center text-xs font-medium">
                        {item.productId ? (
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
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
                          className="soleria-input text-center font-medium"
                          style={{ fontSize: '13px', border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Pairs */}
                      <td className="p-3 text-center text-sm font-bold text-slate-700">
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
                          className="soleria-input text-right font-medium"
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
                          className="soleria-input text-center font-medium"
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
                          className="soleria-input text-right font-medium"
                          style={{ fontSize: '13px', border: isViewMode ? 'none' : undefined, background: isViewMode ? 'transparent' : undefined }}
                        />
                      </td>

                      {/* Row Total Value */}
                      <td className="p-3 text-right font-semibold text-sm">
                        <span style={{ color: '#B08D57' }}>Rs </span>
                        <span style={{ color: '#B08D57' }}>{item.value.toLocaleString('en-US')}</span>
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

          {/* Add Row Button + Prior Purchase Quick-Add */}
          {!isViewMode && (
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <button
                onClick={handleAddItemRow}
                className="btn-dashed flex items-center gap-1 px-3 py-1.5"
              >
                <Plus size={14} /> Add Item Row
              </button>

              {customerId && (
                <div className="flex items-center gap-2 min-w-[280px]">
                  <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
                    Previously bought by this customer:
                  </span>
                  <div className="flex-1">
                    <SearchableSelect
                      options={customerPurchaseHistory.map(h => ({ value: h.productId, label: h.productName }))}
                      value=""
                      onChange={handleQuickAddFromHistory}
                      placeholder={customerPurchaseHistory.length ? 'Select to auto-fill...' : 'No prior purchases found'}
                      searchPlaceholder="Search prior purchases..."
                      disabled={customerPurchaseHistory.length === 0}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Invoice Summary and Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            {/* Remarks */}
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--secondary-text)' }}>
                Return Reason / Remarks
              </label>
              <textarea
                value={remarks}
                disabled={isViewMode}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Enter return reasons or remarks..."
                className="soleria-input w-full"
                rows={3}
                style={{ fontSize: '13px', resize: 'none' }}
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
                  <span className="font-semibold">{totalCartons}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Pairs:</span>
                  <span className="font-semibold">{totalPairs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gross Total:</span>
                  <span className="font-semibold">Rs {itemsTotalValue.toLocaleString('en-US')}</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-slate-400">Inv. Discount:</span>
                  {isViewMode ? (
                    <span className="font-semibold">Rs {invoiceDiscount.toLocaleString('en-US')}</span>
                  ) : (
                    <input
                      type="number"
                      value={invoiceDiscount || ''}
                      onChange={e => setInvoiceDiscount(Math.max(0, parseInt(e.target.value) || 0))}
                      className="soleria-input text-right font-medium py-0.5 px-2 border bg-slate-800 text-white border-slate-700 focus:ring-amber-500"
                      style={{ width: '85px', fontSize: '12px' }}
                    />
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center border-t pt-2 mt-2 border-[#1e293b]">
                <span className="font-bold text-[11px] uppercase tracking-wider text-slate-400">Total Credit Amount:</span>
                <span className="text-xl font-bold font-extrabold">
                  <span style={{ color: '#B08D57' }}>Rs </span>
                  <span style={{ color: '#B08D57' }}>{finalTotalValue.toLocaleString('en-US')}</span>
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>
      </div>
    </AppLayout>
  );
}

