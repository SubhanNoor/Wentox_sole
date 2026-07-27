import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import type { PurchaseReturnItem } from '@/types';
import { Plus, Trash2, Save, Undo2 } from 'lucide-react';

const UNIT_PRESETS = ['Meters', 'Buckles', 'KG', 'Pieces', 'Rolls'];

function emptyItem(): PurchaseReturnItem {
  return {
    id: 'pri_' + Date.now() + Math.random().toString(36).slice(2, 7),
    materialName: '',
    unit: 'Meters',
    quantity: 0,
    pricePerUnit: 0,
    totalPrice: 0
  };
}

export default function PurchaseReturnPage() {
  const { state, dispatch } = useApp();

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [vendorId, setVendorId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<PurchaseReturnItem[]>([emptyItem()]);
  const [customUnitRows, setCustomUnitRows] = useState<Record<string, boolean>>({});
  const [copyFromPurchaseId, setCopyFromPurchaseId] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const vendorOptions = useMemo(() => {
    return state.vendors.map(v => ({
      value: v.id,
      label: `${v.name}${v.city ? ' — ' + v.city : ''}`
    }));
  }, [state.vendors]);

  const selectedVendor = useMemo(() => {
    return state.vendors.find(v => v.id === vendorId);
  }, [vendorId, state.vendors]);

  // Prior purchases from this vendor, to optionally prefill a return
  const priorPurchaseOptions = useMemo(() => {
    return state.purchases
      .filter(p => !vendorId || p.vendorId === vendorId)
      .map(p => ({
        value: p.id,
        label: `${p.date} — ${formatCurrency(p.totalValue)} (${p.items.length} items)`
      }));
  }, [state.purchases, vendorId]);

  const handleCopyFromPurchase = (purchaseId: string) => {
    setCopyFromPurchaseId(purchaseId);
    if (!purchaseId) return;
    const purchase = state.purchases.find(p => p.id === purchaseId);
    if (!purchase) return;
    setVendorId(purchase.vendorId);
    setItems(purchase.items.map(it => ({
      id: 'pri_' + Date.now() + Math.random().toString(36).slice(2, 7),
      materialName: it.materialName,
      unit: it.unit,
      quantity: it.quantity,
      pricePerUnit: it.pricePerUnit,
      totalPrice: it.totalPrice
    })));
  };

  const updateItem = (id: string, field: keyof PurchaseReturnItem, value: string | number) => {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it;
      const updated = { ...it, [field]: value };
      if (field === 'quantity' || field === 'pricePerUnit') {
        updated.totalPrice = Number(updated.quantity) * Number(updated.pricePerUnit);
      }
      return updated;
    }));
  };

  const addItemRow = () => setItems(prev => [...prev, emptyItem()]);

  const removeItemRow = (id: string) => {
    setItems(prev => prev.length > 1 ? prev.filter(it => it.id !== id) : prev);
    setCustomUnitRows(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const grandTotal = useMemo(() => items.reduce((s, it) => s + it.totalPrice, 0), [items]);

  const isValid = useMemo(() => {
    if (!vendorId || !date) return false;
    return items.every(it => it.materialName.trim() && it.unit.trim() && it.quantity > 0 && it.pricePerUnit > 0);
  }, [vendorId, date, items]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorId) return setErrorMsg('Vendor is required.');
    if (!date) return setErrorMsg('Date is required.');
    if (!isValid) return setErrorMsg('Every line item needs a material name, unit, quantity, and price per unit.');

    dispatch({
      type: 'ADD_PURCHASE_RETURN',
      purchaseReturn: {
        id: 'pr_' + Date.now(),
        date,
        vendorId,
        remarks: remarks.trim(),
        items,
        totalValue: grandTotal
      }
    });

    setDate(new Date().toISOString().split('T')[0]);
    setVendorId('');
    setRemarks('');
    setItems([emptyItem()]);
    setCustomUnitRows({});
    setCopyFromPurchaseId('');
    setErrorMsg('');
    setSuccessMsg('Purchase return recorded successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleDeleteReturn = (id: string) => {
    if (window.confirm('Are you sure you want to delete this purchase return record?')) {
      dispatch({ type: 'DELETE_PURCHASE_RETURN', id });
    }
  };

  const sortedReturns = useMemo(() => {
    return [...state.purchaseReturns].sort((a, b) => b.date.localeCompare(a.date));
  }, [state.purchaseReturns]);

  return (
    <AppLayout pageTitle="Purchase Return">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
        )}

        <form onSubmit={handleSave} className="card-white p-6 bg-white border mb-8" data-no-print>
          <div className="flex items-center gap-2 border-b pb-3 mb-5">
            <Undo2 size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-semibold text-lg text-slate-800">Raw Material Purchase Return</h3>
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Vendor <span className="text-red-500 font-bold">*</span>
              </label>
              <SearchableSelect
                options={vendorOptions}
                value={vendorId}
                onChange={val => { setVendorId(val); setCopyFromPurchaseId(''); }}
                placeholder="Select vendor..."
                searchPlaceholder="Search vendors..."
              />
              {selectedVendor && (
                <p className="text-[11px] text-slate-400 mt-1">
                  {selectedVendor.phone || 'No Phone'} {selectedVendor.city ? `· ${selectedVendor.city}` : ''}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Copy From Prior Purchase (optional)
              </label>
              <select
                value={copyFromPurchaseId}
                onChange={e => handleCopyFromPurchase(e.target.value)}
                className="soleria-input cursor-pointer"
                style={{ fontSize: '13px' }}
              >
                <option value="">Manual entry (default)</option>
                {priorPurchaseOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
              <input
                type="text"
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Reason for return..."
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="mb-4 rounded-lg border bg-white overflow-visible" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ minWidth: '200px' }}>Material / Product Name <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3" style={{ width: '160px' }}>Unit <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '110px' }}>Quantity <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-center" style={{ width: '130px' }}>Price / Unit <span className="text-red-500 font-bold">*</span></th>
                  <th className="p-3 text-right" style={{ width: '130px' }}>Total Price</th>
                  <th className="p-3 text-center" style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b hover:bg-slate-50/55 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4">
                      <input
                        type="text"
                        value={item.materialName}
                        onChange={e => updateItem(item.id, 'materialName', e.target.value)}
                        placeholder="e.g. PU Sheet Roll"
                        className="soleria-input font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3">
                      {customUnitRows[item.id] ? (
                        <input
                          type="text"
                          value={item.unit}
                          onChange={e => updateItem(item.id, 'unit', e.target.value)}
                          placeholder="Type unit..."
                          autoFocus
                          onBlur={() => {
                            if (!item.unit.trim()) {
                              setCustomUnitRows(prev => ({ ...prev, [item.id]: false }));
                              updateItem(item.id, 'unit', UNIT_PRESETS[0]);
                            }
                          }}
                          className="soleria-input"
                          style={{ fontSize: '13px' }}
                        />
                      ) : (
                        <select
                          value={UNIT_PRESETS.includes(item.unit) ? item.unit : '__other__'}
                          onChange={e => {
                            if (e.target.value === '__other__') {
                              setCustomUnitRows(prev => ({ ...prev, [item.id]: true }));
                              updateItem(item.id, 'unit', '');
                            } else {
                              updateItem(item.id, 'unit', e.target.value);
                            }
                          }}
                          className="soleria-input cursor-pointer"
                          style={{ fontSize: '13px' }}
                        >
                          {UNIT_PRESETS.map(u => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                          <option value="__other__">
                            {UNIT_PRESETS.includes(item.unit) ? 'Other (type manually)...' : item.unit || 'Other (type manually)...'}
                          </option>
                        </select>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <input
                        type="number"
                        min={0}
                        value={item.quantity || ''}
                        onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                        className="soleria-input text-center font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3 text-center">
                      <input
                        type="number"
                        min={0}
                        value={item.pricePerUnit || ''}
                        onChange={e => updateItem(item.id, 'pricePerUnit', Number(e.target.value))}
                        className="soleria-input text-center font-semibold"
                        style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td className="p-3 text-right font-bold text-slate-800">
                      {formatCurrency(item.totalPrice)}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeItemRow(item.id)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                        title="Remove Row"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 font-bold text-slate-800" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="p-3 pl-4" colSpan={4}>Grand Total</td>
                  <td className="p-3 text-right">{formatCurrency(grandTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addItemRow}
              className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Add Line Item
            </button>
            <button
              type="submit"
              className="btn-gold flex items-center gap-1.5 px-6 py-2.5 text-sm font-bold"
            >
              <Save size={16} /> Save Purchase Return
            </button>
          </div>
        </form>

        {/* Recorded Purchase Returns */}
        <div className="card-white p-6 bg-white border">
          <h3 className="font-lora font-semibold text-lg text-slate-800 mb-4">Recorded Purchase Returns</h3>
          {sortedReturns.length === 0 ? (
            <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
              No purchase returns recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Vendor</th>
                    <th className="p-3">Remarks</th>
                    <th className="p-3 text-center">Line Items</th>
                    <th className="p-3 text-right">Total Value</th>
                    <th className="p-3 text-center" style={{ width: '60px' }} data-no-print></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedReturns.map(r => {
                    const vendorName = state.vendors.find(v => v.id === r.vendorId)?.name || 'Unknown Vendor';
                    return (
                      <tr key={r.id} className="border-b hover:bg-slate-50/40" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono">{r.date}</td>
                        <td className="p-3 font-semibold text-slate-700">{vendorName}</td>
                        <td className="p-3 text-xs text-slate-500">{r.remarks || '-'}</td>
                        <td className="p-3 text-center text-slate-600">{r.items.length}</td>
                        <td className="p-3 text-right font-bold text-rose-700">- {formatCurrency(r.totalValue)}</td>
                        <td className="p-3 text-center" data-no-print>
                          <button
                            onClick={() => handleDeleteReturn(r.id)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                            title="Delete Purchase Return"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
