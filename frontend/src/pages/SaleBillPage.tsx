import { useState, useMemo, useEffect } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { SaleBill, SaleBillItem } from '@/types';
import WeeklyTab from '@/components/WeeklyTab';
import MonthlyTab from '@/components/MonthlyTab';
import OverallTab from '@/components/OverallTab';
import FindTab from '@/components/FindTab';
import { Save, Plus, Trash2, Printer, Lock, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import SearchableSelect from '@/components/SearchableSelect';

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
  const [dueDate, setDueDate] = useState('');
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
  const [isPrintingSingle, setIsPrintingSingle] = useState(false);

  // Add new customer modal state
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerRegionId, setNewCustomerRegionId] = useState('');
  const [newCustomerCityId, setNewCustomerCityId] = useState('');

  // Customer search: Primary = Region, Secondary = City
  const customerOptions = useMemo(() => {
    const regionName = (id: string) => state.regions.find(r => r.id === id)?.name || '';
    const cityName = (id: string) => state.cities.find(ct => ct.id === id)?.name || '';
    return [...state.customers]
      .sort((a, b) => {
        const regionCmp = regionName(a.regionId).localeCompare(regionName(b.regionId));
        if (regionCmp !== 0) return regionCmp;
        return cityName(a.cityId).localeCompare(cityName(b.cityId));
      })
      .map(c => ({
        value: c.id,
        label: `${c.name} — ${regionName(c.regionId) || 'No Region'} / ${cityName(c.cityId) || 'No City'}`
      }));
  }, [state.customers, state.regions, state.cities]);

  const mainAcOptions = useMemo(() => {
    const list = state.chartAccounts.map(ac => ({
      value: ac.id,
      label: `${ac.name} (${ac.id})`
    }));
    list.push({ value: 'custom', label: 'Other / Custom Group...' });
    return list;
  }, [state.chartAccounts]);

  const addaOptions = useMemo(() => {
    return state.addas.map(ad => ({
      value: ad.id,
      label: ad.name
    }));
  }, [state.addas]);

  // FOUR-digit serial — two digits caps a chart account at 99 children, and
  // the client's legacy data already holds 200+ accounts under one head.
  // See database_schema.md §3.2.
  const getNextCustomerCode = () => {
    const customerAccounts = state.businessAccounts.filter(acc => acc.controlId === '110001');
    const maxSuffix = customerAccounts.reduce((max, acc) => {
      const num = parseInt(acc.id.substring(6), 10); // '110001' is 6 characters
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return `110001${String(maxSuffix + 1).padStart(4, '0')}`;
  };

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) {
      alert('Customer name is required.');
      return;
    }
    if (!newCustomerRegionId) {
      alert('Region is required.');
      return;
    }
    const cityId = newCustomerCityId || state.cities[0]?.id || 'ct1';
    const regionName = state.regions.find(r => r.id === newCustomerRegionId)?.name || 'LOCAL';
    const newId = getNextCustomerCode();

    // 1. Dispatch ADD_BUSINESS_ACCOUNT
    dispatch({
      type: 'ADD_BUSINESS_ACCOUNT',
      account: {
        id: newId,
        name: newCustomerName.trim(),
        controlId: '110001',
        linkCode: 'A',
        region: regionName,
        status: 'Active'
      }
    });

    // 2. Dispatch ADD_CUSTOMER
    dispatch({
      type: 'ADD_CUSTOMER',
      customer: {
        id: newId,
        name: newCustomerName.trim(),
        acId: '110001',
        regionId: newCustomerRegionId,
        cityId
      }
    });

    // Select the new customer
    setCustomerId(newId);
    setMainAcId('110001');
    setCustomMainAcName('');
    setDeliveryType('1');
    setSubCustomerId('sub-same');
    setCustomAddress('');

    // Close and reset
    setIsAddCustomerOpen(false);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');

    setSuccessMsg('New customer added successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // Sub Customers are an independent flat list (no parent Customer link)
  const filteredSubCustomers = state.subCustomers;
  const isCustomDelivery = useMemo(() => {
    return deliveryType === 'custom';
  }, [deliveryType]);

  // Drafts state loaded from local cache
  const [drafts, setDrafts] = useState<SaleBill[]>(() => {
    const saved = localStorage.getItem('wento_sale_bill_drafts');
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
    if (isCustomDelivery && (!subCustomerId || subCustomerId === 'sub-same')) return false;
    return true;
  }, [customerId, date, storeId, billNo, items, isCustomDelivery, subCustomerId]);

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
    setDueDate(bill.dueDate || '');
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
    setIsPrintingSingle(true);
    setTimeout(() => {
      window.print();
      setIsPrintingSingle(false);
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
    setSelectedDraftId('');
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
    setDueDate('');
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
      dueDate: dueDate || undefined,
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
      const updated = prev.filter(d => d.id !== billId && d.id !== selectedDraftId);
      localStorage.setItem('wento_sale_bill_drafts', JSON.stringify(updated));
      return updated;
    });
    setSelectedDraftId('');

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
      dueDate: dueDate || undefined,
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

  const handlePostToggle = () => {
    if (status === 'Unposted') {
      dispatch({ type: 'POST_SALE_BILL', billId });
      setStatus('Posted');
      setSuccessMsg('Bill Posted — stock deducted and it now appears in the Account Ledger.');
    }
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
          newItem.rate = product.salePrice;
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
    const addaObj = state.addas.find(a => a.id === addaId);
    const addaName = addaObj ? addaObj.name : (addaId || 'N/A');
    const subCustomerObj = state.subCustomers.find(sc => sc.id === subCustomerId);
    const subCustomerName = isCustomDelivery 
      ? (subCustomerObj ? subCustomerObj.name : 'Custom Agent')
      : 'SAME (Direct)';
    const mainAcName = mainAcId === 'custom' 
      ? customMainAcName 
      : (state.chartAccounts.find(c => c.id === mainAcId)?.name || mainAcId || 'N/A');

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
            <span>{billId}</span>
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
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Account Group</label>
            <span>{mainAcName}</span>
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
          <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
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
            onClick={() => {
              setActiveTab('billing');
              handleNew();
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'billing'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border text-slate-600 hover:bg-slate-50'
            }`}
          >
            New Sale Bill
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
                value={selectedDraftId}
                onChange={e => {
                  const draftId = e.target.value;
                  setSelectedDraftId(draftId);
                  const selected = drafts.find(d => d.id === draftId);
                  if (selected) {
                    loadBill(selected);
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
                      localStorage.setItem('wento_sale_bill_drafts', JSON.stringify(updated));
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
                  <Printer size={16} /> Print Invoice
                </button>
                <button
                  onClick={exportToPDF}
                  className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5"
                >
                  <FileDown size={16} /> Export PDF
                </button>
                <button
                  onClick={() => {
                    const headers = ['Article', 'Packing', 'Cartons', 'Pairs', 'Rate', 'D%', 'D. Value', 'Total Value'];
                    const rows = items.map(it => [it.productName, it.packing, it.cartons, it.pairs, it.rate, it.discountPercent, it.discountValue, it.value]);
                    exportRowsToExcel(`sale-bill-${billNo || billId}`, headers, rows);
                  }}
                  className="px-4 py-2 text-sm font-semibold rounded-lg btn-outline flex items-center gap-1.5"
                >
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
                <button
                  onClick={handleNew}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                >
                  Create New Bill
                </button>
                {status === 'Unposted' && (
                  <button onClick={handlePostToggle} className="flex items-center gap-1.5 px-4 py-2 rounded-md font-semibold text-sm transition-colors border bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                    <Lock size={16} /> Post Bill
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
        <div className="card-white shadow-sm p-6 md:p-8" style={{ border: '1px solid var(--border-color)', background: '#ffffff', overflow: 'visible' }}>
          
          {/* Print Title (Visible only when printing) */}
          <div className="hidden print:flex items-center justify-between mb-6 pb-4 border-b">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX WEARHOUSE</h1>
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
                From Store <span className="text-red-500 font-bold">*</span>
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
                Manual Bill No. <span className="text-red-500 font-bold">*</span>
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
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-medium text-slate-600">
                      Select Customer Name <span className="text-red-500 font-bold">*</span>
                    </label>
                    {!isViewMode && (
                      <button
                        type="button"
                        onClick={() => setIsAddCustomerOpen(true)}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline transition-colors"
                      >
                        + Add New Customer
                      </button>
                    )}
                  </div>
                  <SearchableSelect
                    options={customerOptions}
                    value={customerId}
                    onChange={(val) => {
                      setCustomerId(val);
                      // Auto-fill Main A/C from the customer's account, if one exists
                      const newCust = state.customers.find(c => c.id === val);
                      const hasValidAc = newCust?.acId && state.chartAccounts.some(ac => ac.id === newCust.acId);
                      if (hasValidAc) {
                        setMainAcId(newCust.acId);
                        setCustomMainAcName('');
                        setErrorMsg('');
                      } else {
                        setMainAcId('');
                        setCustomMainAcName('');
                        if (newCust) {
                          setErrorMsg('Please add customer account first.');
                          setTimeout(() => setErrorMsg(''), 4000);
                        }
                      }
                      setDeliveryType('1');
                      setSubCustomerId('sub-same');
                      setCustomAddress('');
                    }}
                    placeholder="Select customer..."
                    searchPlaceholder="Search customer by name or code..."
                    disabled={isViewMode}
                  />
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
                  <SearchableSelect
                    options={mainAcOptions}
                    value={mainAcId}
                    onChange={(val) => {
                      setMainAcId(val);
                      if (val !== 'custom') {
                        setCustomMainAcName('');
                      }
                    }}
                    placeholder="Select Account Group..."
                    searchPlaceholder="Search Account Group..."
                    disabled={isViewMode}
                  />
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
                    disabled={isViewMode}
                    onChange={e => {
                      const val = e.target.value as '1' | 'custom';
                      setDeliveryType(val);
                      if (val === '1') {
                        setSubCustomerId('sub-same');
                        setCustomAddress('');
                      } else {
                        setSubCustomerId(filteredSubCustomers[0]?.id || '');
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
                          className="text-[10px] font-bold underline transition-colors text-blue-600 hover:text-blue-800"
                        >
                          + Add New
                        </button>
                      )}
                    </div>
                    <SearchableSelect
                      options={filteredSubCustomers.map(sc => ({ value: sc.id, label: sc.name }))}
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
          <div className="mb-6 rounded-lg border bg-white overflow-visible" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ minWidth: '220px' }}>Article / Product <span className="text-red-500 font-bold">*</span></th>
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
                  const product = state.products.find(p => p.id === item.productId);
                  const inStock = product ? product.stock : 0;
                  return (
                    <tr key={item.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
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

              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mt-1">
                Payment Due Date <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input
                type="date"
                value={dueDate}
                disabled={isViewMode}
                onChange={e => setDueDate(e.target.value)}
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
              <p className="text-[10px] text-slate-400 -mt-1">
                Leave blank if this customer has no fixed payment terms — no overdue alert will be generated.
              </p>
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
                  if (!newSubCustomerName.trim()) {
                    alert('Sub-customer name cannot be empty.');
                    return;
                  }
                  const newId = 'sc_' + Date.now();
                  dispatch({
                    type: 'ADD_SUB_CUSTOMER',
                    subCust: {
                      id: newId,
                      name: newSubCustomerName.trim()
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

      {/* Add New Customer Modal */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <form onSubmit={handleCreateCustomer} className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">
              Add New Customer
            </h3>
            
            <div className="mb-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Customer Name <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="text"
                value={newCustomerName}
                onChange={e => setNewCustomerName(e.target.value)}
                placeholder="Enter customer name..."
                className="soleria-input font-semibold"
                autoFocus
                required
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Select Region <span className="text-red-500 font-bold">*</span>
              </label>
              <select
                value={newCustomerRegionId}
                onChange={e => setNewCustomerRegionId(e.target.value)}
                className="soleria-input cursor-pointer font-semibold"
                required
              >
                <option value="">Select Region...</option>
                {state.regions.map(rg => (
                  <option key={rg.id} value={rg.id}>{rg.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Select City <span className="text-red-500 font-bold">*</span>
              </label>
              <select
                value={newCustomerCityId}
                onChange={e => setNewCustomerCityId(e.target.value)}
                className="soleria-input cursor-pointer font-semibold"
                required
              >
                <option value="">Select City...</option>
                {state.cities.map(ct => (
                  <option key={ct.id} value={ct.id}>{ct.name}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
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
              <button
                type="submit"
                className="px-4 py-2 bg-[#111c2a] text-[#B08D57] rounded-lg hover:opacity-90 transition-opacity"
              >
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}
    </AppLayout>
  );
}
