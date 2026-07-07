import { useState, useMemo, useEffect } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { SaleReturn, SaleReturnItem } from '@/types';
import {
  Plus, Edit2, Save, Trash2, Printer, Search,
  ChevronFirst, ChevronLeft, ChevronRight, ChevronLast,
  Lock, X
} from 'lucide-react';

export default function SaleReturnPage() {
  const { state, dispatch } = useApp();

  // Mode: 'view' | 'edit' | 'new'
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('view');
  
  // Navigation Index
  const [currentIndex, setCurrentIndex] = useState(0);

  // Form State
  const [returnId, setReturnId] = useState('');
  const [date, setDate] = useState('');
  const [storeId, setStoreId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [subCustomerId, setSubCustomerId] = useState('');
  const [billNo, setBillNo] = useState(''); // printed return bill number
  const [gpNo, setGpNo] = useState('');
  const [biltyNo, setBiltyNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [status, setStatus] = useState<'Posted' | 'Unposted'>('Unposted');
  
  // Line items state
  const [items, setItems] = useState<SaleReturnItem[]>([]);

  // Search dialog
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Notifications
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

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
    setItems(ret.items);
    setErrorMsg('');
  };

  // Load the current active return
  useEffect(() => {
    if (state.saleReturns.length > 0 && mode === 'view') {
      loadReturn(state.saleReturns[currentIndex]);
    }
  }, [currentIndex, state.saleReturns, mode]);

  // Handle Navigation
  const handleFirst = () => {
    if (state.saleReturns.length > 0) setCurrentIndex(0);
  };
  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };
  const handleNext = () => {
    if (currentIndex < state.saleReturns.length - 1) setCurrentIndex(currentIndex + 1);
  };
  const handleLast = () => {
    if (state.saleReturns.length > 0) setCurrentIndex(state.saleReturns.length - 1);
  };

  // Get selected customer details
  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === customerId);
  }, [customerId, state.customers]);

  const customerMainAcName = useMemo(() => {
    if (!selectedCustomer) return '';
    return state.chartAccounts.find(a => a.id === selectedCustomer.acId)?.name || 'CUSTOMERS ACCOUNTS';
  }, [selectedCustomer, state.chartAccounts]);

  const filteredSubCustomers = useMemo(() => {
    return state.subCustomers.filter(sc => sc.customerId === customerId);
  }, [customerId, state.subCustomers]);

  // Calculations
  const totalCartons = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.cartons || 0), 0);
  }, [items]);

  const totalPairs = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.pairs || 0), 0);
  }, [items]);

  const finalTotalValue = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.value || 0), 0);
  }, [items]);

  // Toolbar Actions
  const handleNew = () => {
    setMode('new');
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

  const handleEdit = () => {
    if (status === 'Posted') {
      setErrorMsg('Cannot edit a posted return. Unpost is not supported for returns in this screen; recreate the entry.');
      return;
    }
    setMode('edit');
    setErrorMsg('');
  };

  const handleDelete = () => {
    if (status === 'Posted') {
      setErrorMsg('Cannot delete a posted return.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this sale return?')) {
      dispatch({ type: 'DELETE_SALE_RETURN', returnId });
      setSuccessMsg('Sale return deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      if (currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      } else {
        setCurrentIndex(0);
      }
      setMode('view');
    }
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
      items
    };

    if (mode === 'new') {
      dispatch({ type: 'ADD_SALE_RETURN', returnObj: savedReturn });
      setSuccessMsg('New sale return saved successfully.');
      setCurrentIndex(0);
    } else {
      dispatch({ type: 'UPDATE_SALE_RETURN', returnId, returnObj: savedReturn });
      setSuccessMsg('Sale return updated successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setMode('view');
    setErrorMsg('');
  };

  const handleDone = () => {
    setMode('view');
    setErrorMsg('');
  };

  const handlePostToggle = () => {
    if (status === 'Unposted') {
      dispatch({ type: 'POST_SALE_RETURN', returnId });
      setStatus('Posted');
      setSuccessMsg('Return Posted to accounts and stock updated.');
    }
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handlePrint = () => {
    window.print();
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
          newItem.rate = product.costPrice + 50;
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
        newItem.discountValue = Math.round(grossValue * (newItem.discountPercent / 100));
      }

      newItem.value = Math.max(0, grossValue - newItem.discountValue);

      return newItem;
    });
    setItems(updated);
  };

  // Find selection
  const handleSelectFromFind = (ret: SaleReturn) => {
    const idx = state.saleReturns.findIndex(r => r.id === ret.id);
    if (idx !== -1) {
      setCurrentIndex(idx);
      loadReturn(ret);
    }
    setShowSearchModal(false);
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return state.saleReturns;
    const q = searchQuery.toLowerCase();
    return state.saleReturns.filter(r => {
      const custName = state.customers.find(c => c.id === r.customerId)?.name.toLowerCase() || '';
      return r.billNo.toLowerCase().includes(q) || custName.includes(q);
    });
  }, [searchQuery, state.saleReturns, state.customers]);

  const isViewMode = mode === 'view';

  return (
    <AppLayout pageTitle="Sale Return">
      <div className="mx-auto" style={{ maxWidth: 1100 }}>
        
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

        {/* Toolbar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-4 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          {/* Main Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {isViewMode ? (
              <>
                <button onClick={handleNew} className="btn-gold flex items-center gap-1.5 px-4 py-2">
                  <Plus size={16} /> New
                </button>
                <button onClick={handleEdit} className="btn-outline flex items-center gap-1.5 px-4 py-2">
                  <Edit2 size={16} /> Edit
                </button>
                <button onClick={handleDelete} className="btn-danger flex items-center gap-1.5 px-4 py-2">
                  <Trash2 size={16} /> Delete
                </button>
              </>
            ) : (
              <>
                <button onClick={handleSave} className="btn-gold flex items-center gap-1.5 px-4 py-2" style={{ background: 'var(--success)', color: '#ffffff' }}>
                  <Save size={16} /> Save
                </button>
                <button onClick={handleDone} className="btn-outline flex items-center gap-1.5 px-4 py-2">
                  <X size={16} /> Cancel
                </button>
              </>
            )}
            <button onClick={() => setShowSearchModal(true)} className="btn-outline flex items-center gap-1.5 px-4 py-2">
              <Search size={16} /> Find
            </button>
            <button onClick={handlePrint} className="btn-outline flex items-center gap-1.5 px-4 py-2">
              <Printer size={16} /> Print
            </button>
            {status === 'Unposted' && isViewMode && (
              <button onClick={handlePostToggle} className="flex items-center gap-1.5 px-4 py-2 rounded-md font-semibold text-sm transition-colors border bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                <Lock size={16} /> Post Return
              </button>
            )}
          </div>

          {/* Navigation Controls */}
          {isViewMode && (
            <div className="flex items-center gap-1">
              <button onClick={handleFirst} disabled={currentIndex === 0} className="btn-outline p-2 rounded-md disabled:opacity-50">
                <ChevronFirst size={16} />
              </button>
              <button onClick={handlePrev} disabled={currentIndex === 0} className="btn-outline p-2 rounded-md disabled:opacity-50">
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-semibold px-2 font-inter" style={{ color: 'var(--secondary-text)' }}>
                {state.saleReturns.length > 0 ? `${currentIndex + 1} of ${state.saleReturns.length}` : '0 of 0'}
              </span>
              <button onClick={handleNext} disabled={currentIndex === state.saleReturns.length - 1} className="btn-outline p-2 rounded-md disabled:opacity-50">
                <ChevronRight size={16} />
              </button>
              <button onClick={handleLast} disabled={currentIndex === state.saleReturns.length - 1} className="btn-outline p-2 rounded-md disabled:opacity-50">
                <ChevronLast size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Invoice Layout */}
        <div className="card-white shadow-sm p-6 md:p-8" style={{ border: '1px solid var(--border-color)', background: '#ffffff' }}>
          
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
                TO Store (Return Destination)
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
                Return Bill No.
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
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-slate-50 border" style={{ borderColor: 'var(--border-color)' }}>
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
                      setCustomerId(e.target.value);
                      setSubCustomerId('sub-same');
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
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-slate-50 border" style={{ borderColor: 'var(--border-color)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b pb-1.5">
                Dispatch logistics
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Delivery Agent (if any)
                  </label>
                  <select
                    value={subCustomerId}
                    disabled={isViewMode}
                    onChange={e => setSubCustomerId(e.target.value)}
                    className="soleria-input cursor-pointer"
                    style={{ fontSize: '13px' }}
                  >
                    <option value="sub-same">SAME (Direct)</option>
                    {filteredSubCustomers.map(sc => (
                      <option key={sc.id} value={sc.id}>{sc.name}</option>
                    ))}
                  </select>
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
          <div className="mb-6 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ minWidth: '220px' }}>Returned Article</th>
                  <th className="p-3 text-center" style={{ width: '80px' }}>Packing</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Stock</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Cartons</th>
                  <th className="p-3 text-center" style={{ width: '90px' }}>Pairs</th>
                  <th className="p-3 text-right" style={{ width: '110px' }}>Rate</th>
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
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Posting Status:</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${status === 'Posted' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                  {status}
                </span>
              </div>
            </div>

            {/* Calculations Box */}
            <div className="flex flex-col gap-2.5 p-4 rounded-xl border bg-slate-50 font-inter" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex justify-between text-xs text-slate-500 border-b pb-1.5 mb-1">
                <span>Description</span>
                <span className="text-right">Value</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Total Cartons:</span>
                <span className="font-semibold font-mono">{totalCartons}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Total Pairs:</span>
                <span className="font-semibold font-mono">{totalPairs}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2 mt-2" style={{ borderColor: 'var(--border-color)' }}>
                <span className="font-bold text-slate-700">Total Credit Amount:</span>
                <span className="text-xl font-bold font-mono" style={{ color: 'var(--brand-gold)' }}>
                  {formatCurrency(finalTotalValue)}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Find/Search Modal dialog */}
        {showSearchModal && (
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" data-no-print>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="font-lora font-semibold text-lg text-slate-800">Find Sale Returns</h3>
                <button onClick={() => setShowSearchModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 bg-slate-50 border-b">
                <input
                  type="text"
                  placeholder="Search by customer name or return reference number..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full"
                />
              </div>
              <div className="overflow-y-auto flex-1 p-2">
                {searchResults.length === 0 ? (
                  <div className="text-center p-8 text-slate-400 text-sm">No return records match your query.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {searchResults.map(ret => {
                      const cust = state.customers.find(c => c.id === ret.customerId);
                      return (
                        <button
                          key={ret.id}
                          onClick={() => handleSelectFromFind(ret)}
                          className="w-full text-left p-3 rounded-lg hover:bg-slate-100 flex items-center justify-between text-sm transition-colors border border-transparent hover:border-slate-200"
                        >
                          <div>
                            <div className="font-semibold text-slate-700">Return No. {ret.billNo} ({ret.date})</div>
                            <div className="text-xs text-slate-500">{cust?.name || 'Walk-in Client'}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-semibold" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(ret.items.reduce((s, it) => s + it.value, 0))}</div>
                            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${ret.status === 'Posted' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                              {ret.status}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
