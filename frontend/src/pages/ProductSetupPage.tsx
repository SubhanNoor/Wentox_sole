import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { Product } from '@/types';
import { Plus, Trash2, Edit2, Folder, Hammer, Settings } from 'lucide-react';

export default function ProductSetupPage() {
  const { state, dispatch } = useApp();

  // Selected product for edit
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [batchNo, setBatchNo] = useState(0);
  const [packing, setPacking] = useState(12); // default 12 pairs per carton
  const [costPrice, setCostPrice] = useState(0);
  
  // Cost breakdown
  const [labour, setLabour] = useState(0);
  const [proiCost, setProiCost] = useState(0);
  const [soleStich, setSoleStich] = useState(0);
  const [pasting, setPasting] = useState(0);
  const [trim, setTrim] = useState(0);
  const [finishing, setFinishing] = useState(0);
  const [socksPasting, setSocksPasting] = useState(0);
  const [dc, setDc] = useState(0);
  const [sockStich, setSockStich] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [stubble, setStubble] = useState(0);
  const [bottom, setBottom] = useState(0);
  const [p1, setP1] = useState(0);
  const [p2, setP2] = useState(0);
  const [na, setNa] = useState(0);

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Start adding a new product
  const handleAddNew = () => {
    setSelectedProductId('');
    setId((Math.floor(Math.random() * 9000) + 1000).toString());
    setName('');
    setCategoryId(state.categories[0]?.id || '');
    setVendorId(state.vendors[0]?.id || '');
    setBatchNo(100);
    setPacking(12);
    setCostPrice(0);
    
    // reset breakdown
    setLabour(0); setProiCost(0); setSoleStich(0); setPasting(0);
    setTrim(0); setFinishing(0); setSocksPasting(0); setDc(0);
    setSockStich(0); setSheet(0); setStubble(0); setBottom(0);
    setP1(0); setP2(0); setNa(0);
    
    setErrorMsg('');
  };

  // Select product for editing
  const handleSelectProduct = (prod: Product) => {
    setSelectedProductId(prod.id);
    setId(prod.id);
    setName(prod.name);
    setCategoryId(prod.categoryId);
    setVendorId(prod.vendorId);
    setBatchNo(prod.batchNo || 0);
    setPacking(prod.packing || 12);
    setCostPrice(prod.costPrice || 0);
    
    setLabour(prod.labour || 0);
    setProiCost(prod.proiCost || 0);
    setSoleStich(prod.soleStich || 0);
    setPasting(prod.pasting || 0);
    setTrim(prod.trim || 0);
    setFinishing(prod.finishing || 0);
    setSocksPasting(prod.socksPasting || 0);
    setDc(prod.dc || 0);
    setSockStich(prod.sockStich || 0);
    setSheet(prod.sheet || 0);
    setStubble(prod.stubble || 0);
    setBottom(prod.bottom || 0);
    setP1(prod.p1 || 0);
    setP2(prod.p2 || 0);
    setNa(prod.na || 0);
    
    setErrorMsg('');
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Product code is required.');
    if (!name.trim()) return setErrorMsg('Product name is required.');
    if (!categoryId) return setErrorMsg('Category is required.');
    if (!vendorId) return setErrorMsg('Vendor is required.');
    if (packing <= 0) return setErrorMsg('Packing must be at least 1 pair.');

    const savedProduct: Product = {
      id,
      name,
      categoryId,
      vendorId,
      batchNo,
      packing,
      costPrice,
      labour,
      proiCost,
      soleStich,
      pasting,
      trim,
      finishing,
      socksPasting,
      dc,
      sockStich,
      sheet,
      stubble,
      bottom,
      p1,
      p2,
      na,
      stock: selectedProductId ? state.products.find(p => p.id === id)?.stock || 0 : 0
    };

    if (selectedProductId) {
      dispatch({ type: 'UPDATE_PRODUCT', product: savedProduct });
      setSuccessMsg('Product details updated successfully.');
    } else {
      // Check duplicate code
      if (state.products.some(p => p.id === id)) {
        return setErrorMsg('A product with this code already exists.');
      }
      dispatch({ type: 'ADD_PRODUCT', product: savedProduct });
      setSuccessMsg('New product article registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setSelectedProductId(null);
    setErrorMsg('');
  };

  const handleDeleteProduct = (pId: string) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      dispatch({ type: 'DELETE_PRODUCT', id: pId });
      setSuccessMsg('Product deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedProductId(null);
    }
  };

  return (
    <AppLayout pageTitle="Product Detail Info Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Products List (Left 5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="card-white p-5 bg-white border">
              <div className="flex items-center justify-between border-b pb-2.5 mb-4">
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  Registered Products ({state.products.length})
                </h3>
                <button
                  onClick={handleAddNew}
                  className="btn-gold flex items-center gap-1 px-3 py-1.5 text-xs"
                >
                  <Plus size={14} /> Add Product
                </button>
              </div>

              <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto pr-1">
                {state.products.map(prod => {
                  const cat = state.categories.find(c => c.id === prod.categoryId)?.name || 'General';
                  const isEditing = selectedProductId === prod.id;
                  return (
                    <div
                      key={prod.id}
                      onClick={() => handleSelectProduct(prod)}
                      className={`p-3 rounded-lg border text-sm cursor-pointer transition-all flex items-center justify-between ${isEditing ? 'border-amber-500 bg-amber-50/50 shadow-sm' : 'border-slate-200 hover:bg-slate-50'}`}
                    >
                      <div>
                        <div className="font-semibold text-slate-800">{prod.name}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">Code: {prod.id} | Packing: {prod.packing} | {cat}</div>
                      </div>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectProduct(prod)}
                          className="text-slate-500 hover:text-amber-600 p-1"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(prod.id)}
                          className="text-slate-400 hover:text-red-600 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Creation/Edit Form (Right 7 cols) */}
          <div className="lg:col-span-7">
            {selectedProductId === null ? (
              <div className="card-white p-8 bg-slate-50/50 border text-center flex flex-col items-center justify-center h-[50vh] text-slate-400">
                <Folder size={48} className="text-slate-300 mb-3" />
                <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Product Selected</p>
                <p className="text-sm max-w-sm mb-4">Select an article from the list to edit, or register a new shoe/sole product below.</p>
                <button onClick={handleAddNew} className="btn-gold px-5 py-2">
                  Register New Product
                </button>
              </div>
            ) : (
              <div className="card-white p-5 bg-white border">
                <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800">
                  {selectedProductId ? `Edit Product: ${name}` : 'Register New Product'}
                </h3>

                <form onSubmit={handleSaveProduct} className="flex flex-col gap-4">
                  {/* General Info Section */}
                  <div className="p-3 bg-slate-50 rounded-lg border flex flex-col gap-3">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Settings size={14} /> Basic Product Details
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Product/Article Code</label>
                        <input
                          type="text"
                          value={id}
                          disabled={Boolean(selectedProductId)}
                          onChange={e => setId(e.target.value)}
                          placeholder="e.g. 1005"
                          className="soleria-input font-semibold font-mono"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Product Article Name</label>
                        <input
                          type="text"
                          value={name}
                          onChange={e => setName(e.target.value)}
                          placeholder="e.g. F-751 Leather Sole Tan"
                          className="soleria-input"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                        <select
                          value={categoryId}
                          onChange={e => setCategoryId(e.target.value)}
                          className="soleria-input cursor-pointer"
                        >
                          <option value="">Select Category...</option>
                          {state.categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Vendor Partner</label>
                        <select
                          value={vendorId}
                          onChange={e => setVendorId(e.target.value)}
                          className="soleria-input cursor-pointer"
                        >
                          <option value="">Select Vendor...</option>
                          {state.vendors.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Batch Number</label>
                        <input
                          type="number"
                          value={batchNo || ''}
                          onChange={e => setBatchNo(parseInt(e.target.value) || 0)}
                          className="soleria-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Packing (Pairs/Carton)</label>
                        <input
                          type="number"
                          value={packing || ''}
                          onChange={e => setPacking(parseInt(e.target.value) || 12)}
                          className="soleria-input font-semibold font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Basic Cost Price (Rs)</label>
                        <input
                          type="number"
                          value={costPrice || ''}
                          onChange={e => setCostPrice(parseInt(e.target.value) || 0)}
                          className="soleria-input font-mono font-semibold text-emerald-800"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Cost Breakdown Section */}
                  <div className="p-3 bg-slate-50 rounded-lg border flex flex-col gap-3">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Hammer size={14} /> Production / Manufacturing Cost Breakdown (PKR)
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Labour Cost</label>
                        <input type="number" value={labour || ''} onChange={e => setLabour(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Proi Cost</label>
                        <input type="number" value={proiCost || ''} onChange={e => setProiCost(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Sole Stitch</label>
                        <input type="number" value={soleStich || ''} onChange={e => setSoleStich(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Pasting</label>
                        <input type="number" value={pasting || ''} onChange={e => setPasting(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Trim Process</label>
                        <input type="number" value={trim || ''} onChange={e => setTrim(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Finishing</label>
                        <input type="number" value={finishing || ''} onChange={e => setFinishing(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Socks Pasting</label>
                        <input type="number" value={socksPasting || ''} onChange={e => setSocksPasting(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">DC Charges</label>
                        <input type="number" value={dc || ''} onChange={e => setDc(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Sock Stitch</label>
                        <input type="number" value={sockStich || ''} onChange={e => setSockStich(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Sheet Material</label>
                        <input type="number" value={sheet || ''} onChange={e => setSheet(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Stubble Cost</label>
                        <input type="number" value={stubble || ''} onChange={e => setStubble(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">Bottom Cost</label>
                        <input type="number" value={bottom || ''} onChange={e => setBottom(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">P1 Cost</label>
                        <input type="number" value={p1 || ''} onChange={e => setP1(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">P2 Cost</label>
                        <input type="number" value={p2 || ''} onChange={e => setP2(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">NA Cost</label>
                        <input type="number" value={na || ''} onChange={e => setNa(parseInt(e.target.value) || 0)} className="soleria-input py-1 px-2 font-mono text-xs" />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedProductId(null)}
                      className="btn-outline px-5 py-2.5"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-gold px-6 py-2.5"
                    >
                      Save Product Details
                    </button>
                  </div>

                </form>
              </div>
            )}
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
