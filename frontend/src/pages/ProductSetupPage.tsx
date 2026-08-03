import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { Product, ProductCosts, CostFieldKey } from '@/types';
import { COST_FIELDS } from '@/types';
import { Plus, Trash2, Edit2, Hammer, Settings, Search, ArrowLeft } from 'lucide-react';

/** All twelve stage costs at zero — used to reset the form and to read a product in. */
const emptyCosts = (): ProductCosts =>
  Object.fromEntries(COST_FIELDS.map(f => [f.key, 0])) as ProductCosts;

const costsFromProduct = (prod: Product): ProductCosts =>
  Object.fromEntries(COST_FIELDS.map(f => [f.key, prod[f.key] || 0])) as ProductCosts;

export default function ProductSetupPage() {
  const { state, dispatch } = useApp();

  // Active Tab state: 'list' or 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [productSearch, setProductSearch] = useState('');

  // Selected product for edit
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [batchNo, setBatchNo] = useState(0);
  const [packing, setPacking] = useState(12); // default 12 pairs per carton
  const [salePrice, setSalePrice] = useState(0);

  // The twelve stage costs, held as one object rather than twelve useStates so
  // the field list lives only in COST_FIELDS. They are recorded per stage and
  // deliberately never summed — each is consumed on its own elsewhere.
  const [costs, setCosts] = useState<ProductCosts>(emptyCosts);

  const setCost = (key: CostFieldKey, value: number) =>
    setCosts(prev => ({ ...prev, [key]: value }));

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Start adding a new product
  const handleAddNew = () => {
    setSelectedProductId('');
    // Auto-generate next product code from database (max existing product ID + 1)
    const maxId = state.products.reduce((max, p) => {
      const num = parseInt(p.id, 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 1000);
    const nextCode = (maxId + 1).toString();

    // Auto-generate next batch number from database (max existing batchNo + 1)
    const maxBatch = state.products.reduce((max, p) => {
      return Math.max(max, p.batchNo || 0);
    }, 100);
    const nextBatchNo = maxBatch > 0 ? maxBatch + 1 : 101;

    setId(nextCode);
    setName('');
    setColor('');
    setCategoryId(state.categories[0]?.id || '');
    setVendorId(state.vendors[0]?.id || '');
    setBatchNo(nextBatchNo);
    setPacking(0);
    setSalePrice(0);
    setCosts(emptyCosts());
    setErrorMsg('');
    setActiveTab('form');
  };

  // Select product for editing
  const handleSelectProduct = (prod: Product) => {
    setSelectedProductId(prod.id);
    setId(prod.id);
    setName(prod.name);
    setColor(prod.color || '');
    setCategoryId(prod.categoryId);
    setVendorId(prod.vendorId);
    setBatchNo(prod.batchNo || 0);
    setPacking(prod.packing || 0);
    setSalePrice(prod.salePrice || 0);
    setCosts(costsFromProduct(prod));
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Product / Article Code is required.');
    if (!name.trim()) return setErrorMsg('Product Article Name is required.');
    if (!categoryId) return setErrorMsg('Category is required. Please select a category.');
    if (!vendorId) return setErrorMsg('Vendor Partner is required. Please select a vendor partner.');

    const savedProduct: Product = {
      id: id.trim(),
      name: name.trim(),
      color: color.trim() || undefined,
      categoryId,
      vendorId,
      batchNo: isNaN(batchNo) ? 0 : batchNo,
      packing: isNaN(packing) ? 0 : packing,
      salePrice: isNaN(salePrice) ? 0 : salePrice,
      ...costs,
      stock: selectedProductId ? state.products.find(p => p.id === id)?.stock || 0 : 0
    };

    if (selectedProductId) {
      if (id.trim() !== selectedProductId && state.products.some(p => p.id === id.trim())) {
        return setErrorMsg('A product with this code already exists.');
      }
      dispatch({ type: 'UPDATE_PRODUCT', product: savedProduct });
      setSuccessMsg('Product details updated successfully.');
    } else {
      // Check duplicate code
      if (state.products.some(p => p.id === id.trim())) {
        return setErrorMsg('A product with this code already exists.');
      }
      dispatch({ type: 'ADD_PRODUCT', product: savedProduct });
      setSuccessMsg('New product article registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setSelectedProductId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleDeleteProduct = (pId: string) => {
    // Safety check: is it referenced in any historical transactions?
    const inSaleBills = state.saleBills.some(b => b.items.some(it => it.productId === pId));
    const inSaleReturns = state.saleReturns.some(r => r.items.some(it => it.productId === pId));
    const inProductionLogs = state.productionLogs.some(l => l.productId === pId);
    if (inSaleBills || inSaleReturns || inProductionLogs) {
      setErrorMsg('Cannot delete: this article has sale bill, sale return, or production history linked to it.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this product?')) {
      dispatch({ type: 'DELETE_PRODUCT', id: pId });
      setSuccessMsg('Product deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedProductId(null);
      setActiveTab('list');
    }
  };

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return state.products;
    const q = productSearch.toLowerCase();
    return state.products.filter(prod => {
      const cat = state.categories.find(c => c.id === prod.categoryId)?.name || '';
      const vend = state.vendors.find(v => v.id === prod.vendorId)?.name || '';
      return (
        prod.name.toLowerCase().includes(q) ||
        prod.id.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q) ||
        vend.toLowerCase().includes(q)
      );
    });
  }, [state.products, productSearch, state.categories, state.vendors]);

  return (
    <AppLayout pageTitle="Product Detail Info Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Tab Selection Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => {
                setActiveTab('list');
                setSelectedProductId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Registered Products
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedProductId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Product
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Product
            </button>
          )}
        </div>

        {/* View 1: Registered Products List */}
        {activeTab === 'list' ? (
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="border-b pb-3 mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Articles Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage your business registered products and shoe sole articles.</p>
              </div>
              
              <div className="relative min-w-[280px]">
                <input
                  type="text"
                  placeholder="Search by code, article, category..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold"
                />
                <Search className="absolute right-3 top-2 text-slate-400" size={14} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Code</th>
                    <th className="p-3">Article Name</th>
                    <th className="p-3">Color</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Vendor</th>
                    <th className="p-3 text-center">Packing (Pairs)</th>
                    <th className="p-3 text-right">Sale Price</th>
                    <th className="p-3 text-center" style={{ width: '80px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-slate-400">
                        No registered products found.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map(prod => {
                      const catName = state.categories.find(c => c.id === prod.categoryId)?.name || 'General';
                      const vendorName = state.vendors.find(v => v.id === prod.vendorId)?.name || 'N/A';
                      return (
                        <tr
                          key={prod.id}
                          className="border-b hover:bg-slate-50/50 transition-colors"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-semibold text-slate-700">{prod.id}</td>
                          <td className="p-3 font-semibold text-slate-900">{prod.name}</td>
                          <td className="p-3">
                            {prod.color ? (
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                prod.color.toLowerCase() === 'black' ? 'bg-slate-900 text-white' :
                                prod.color.toLowerCase() === 'white' ? 'bg-slate-100 text-slate-800 border border-slate-200' :
                                prod.color.toLowerCase() === 'brown' ? 'bg-amber-900 text-amber-50' :
                                prod.color.toLowerCase() === 'tan' ? 'bg-orange-100 text-orange-800' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {prod.color}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs italic">N/A</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-500 font-medium">{catName}</td>
                          <td className="p-3 text-slate-600 font-semibold">{vendorName}</td>
                          <td className="p-3 text-center font-semibold text-slate-700">{prod.packing}</td>
                          <td className="p-3 text-right font-bold text-amber-800">{formatCurrency(prod.salePrice)}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleSelectProduct(prod)}
                                className="text-slate-500 hover:text-amber-600 p-1 rounded hover:bg-slate-100"
                                title="Edit Product"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(prod.id)}
                                className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-slate-100"
                                title="Delete Product"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* View 2: Add New / Edit Product Form */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-2 border-b pb-3 mb-6">
              <button
                onClick={() => {
                  setActiveTab('list');
                  setSelectedProductId(null);
                }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  {selectedProductId ? `Edit Product: ${name}` : 'Register New Product'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Fill in the fields below to update or register product specifications and pricing breakdown.</p>
              </div>
            </div>

            <form onSubmit={handleSaveProduct} className="flex flex-col gap-6">
              
              {/* Basic Details */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Basic Product Details
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Product / Article Code</label>
                    <input
                      type="text"
                      value={id}
                      disabled
                      placeholder="e.g. 1005"
                      className="soleria-input font-semibold bg-slate-100 text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Product Article Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. F-751 Leather Sole"
                      className="soleria-input font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Color</label>
                    <input
                      type="text"
                      value={color}
                      onChange={e => setColor(e.target.value)}
                      placeholder="e.g. Black, White, Tan"
                      className="soleria-input font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
                    <select
                      value={categoryId}
                      onChange={e => setCategoryId(e.target.value)}
                      className="soleria-input cursor-pointer font-semibold"
                    >
                      <option value="">Select Category...</option>
                      {state.categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Vendor Partner</label>
                    <select
                      value={vendorId}
                      onChange={e => setVendorId(e.target.value)}
                      className="soleria-input cursor-pointer font-semibold"
                    >
                      <option value="">Select Vendor...</option>
                      {state.vendors.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Batch Number</label>
                    <input
                      type="number"
                      value={batchNo}
                      disabled
                      placeholder="0"
                      className="soleria-input font-semibold bg-slate-100 text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Packing (Pairs/Carton)</label>
                    <input
                      type="number"
                      value={packing === 0 ? '' : packing}
                      placeholder="0"
                      onChange={e => setPacking(e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                      className="soleria-input font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Sale Price (Rs)</label>
                    <input
                      type="number"
                      value={salePrice === 0 ? '' : salePrice}
                      placeholder="0"
                      onChange={e => setSalePrice(e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                      className="soleria-input font-semibold text-slate-800"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Used as the default rate when this article is sold</p>
                  </div>
                </div>
              </div>

              {/* Manufacturing Breakdown */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Hammer size={15} className="text-[#B08D57]" /> Production / Manufacturing Cost Breakdown (PKR)
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {COST_FIELDS.map(field => (
                    <div key={field.key}>
                      <label className="block text-xs text-slate-600 mb-0.5">{field.label}</label>
                      <input
                        type="number"
                        value={costs[field.key] === 0 ? '' : costs[field.key]}
                        placeholder="0"
                        onChange={e => setCost(field.key, e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                        className="soleria-input text-xs font-semibold"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex gap-3 justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedProductId(null);
                  }}
                  className="btn-outline px-5 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold px-6 py-2"
                >
                  Save Product Details
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
