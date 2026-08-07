import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { ProductCosts, CostFieldKey } from '@/types';
import { COST_FIELDS } from '@/types';
import { Plus, Trash2, Edit2, Hammer, Settings, Search, ArrowLeft, RotateCcw } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { ProductRow, CategoryRow, VendorRow } from '@/lib/api';

/** All twelve stage costs at zero — used to reset the form and to read a product in. */
const emptyCosts = (): ProductCosts =>
  Object.fromEntries(COST_FIELDS.map(f => [f.key, 0])) as ProductCosts;

// The 12 manufacturing-stage cost columns share the same keys on both sides, just cased
// differently — frontend's CostFieldKey is camelCase, the backend's ProductRow/CreateInput is
// snake_case (matches database/schema.sql exactly).
const COST_FIELD_TO_API: Record<CostFieldKey, keyof ProductRow> = {
  cutting: 'cutting', edging: 'edging', upStitch: 'up_stitch', bending: 'bending',
  stubbleDori: 'stubble_dori', shapeForm: 'shape_form', chipkai: 'chipkai', bottom: 'bottom',
  machine: 'machine', trimming: 'trimming', sockStitch: 'sock_stitch', finish: 'finish',
};

function costsFromRow(row: ProductRow): ProductCosts {
  return Object.fromEntries(
    COST_FIELDS.map(f => [f.key, Number(row[COST_FIELD_TO_API[f.key]]) || 0])
  ) as ProductCosts;
}

function costsToApiPayload(costs: ProductCosts) {
  const out: Record<string, number> = {};
  for (const f of COST_FIELDS) out[COST_FIELD_TO_API[f.key]] = costs[f.key];
  return out as {
    cutting: number; edging: number; up_stitch: number; bending: number; stubble_dori: number;
    shape_form: number; chipkai: number; bottom: number; machine: number; trimming: number;
    sock_stitch: number; finish: number;
  };
}

export default function ProductSetupPage() {
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [isClosing, setIsClosing] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const handleSwitchTab = (newTab: 'list' | 'form') => {
    setIsClosing(true);
    setTimeout(() => {
      setActiveTab(newTab);
      setIsClosing(false);
    }, 200);
  };

  const [productList, setProductList] = useState<ProductRow[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryRow[]>([]);
  const [vendorList, setVendorList] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [prodRes, catRes, venRes] = await Promise.all([
      api.products.list(),
      api.listCategories(),
      api.listVendors(),
    ]);
    if (prodRes.ok) setProductList(prodRes.data);
    if (catRes.ok) setCategoryList(catRes.data);
    if (venRes.ok) setVendorList(venRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Selected product for edit — null means "adding new"
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProductCode, setSelectedProductCode] = useState('');

  const [reactivatePrompt, setReactivatePrompt] = useState<{ article_id: number; name: string } | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [packing, setPacking] = useState(0);
  const [salePrice, setSalePrice] = useState(0);
  const [costs, setCosts] = useState<ProductCosts>(emptyCosts);

  const setCost = (key: CostFieldKey, value: number) =>
    setCosts(prev => ({ ...prev, [key]: value }));

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 4000); };

  const handleAddNew = () => {
    setSelectedProductId(null);
    setSelectedProductCode('');
    setName('');
    setColor('');
    setCategoryId('');
    setVendorId('');
    setPacking(0);
    setSalePrice(0);
    setCosts(emptyCosts());
    setErrorMsg('');
    handleSwitchTab('form');
  };

  const handleSelectProduct = (prod: ProductRow) => {
    setSelectedProductId(prod.article_id);
    setSelectedProductCode(prod.code);
    setName(prod.name);
    setColor('');
    setCategoryId(String(prod.category_id));
    setVendorId(String(prod.vendor_id));
    setPacking(prod.packing || 0);
    setSalePrice(prod.sale_price || 0);
    setCosts(costsFromRow(prod));
    setErrorMsg('');
    handleSwitchTab('form');
    // Prefill the color field from the article's own existing variant, if any — reflects today's
    // one-color-per-product UX without needing a full colors list UI.
    api.productColors.listByArticle(prod.article_id).then(r => {
      if (r.ok && r.data.length > 0) setColor(r.data[0].color);
    });
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const typedName = name.trim();
    if (!typedName) return fail('Product Article Name is required.');
    if (!categoryId) return fail('Category is required. Please select a category.');
    if (!vendorId) return fail('Vendor Partner is required. Please select a vendor partner.');
    if (!packing || packing <= 0) return fail('Packing (pairs/carton) must be greater than 0.');

    const costFields = costsToApiPayload(costs);

    let articleId: number;
    if (selectedProductId) {
      const res = await api.products.update(selectedProductId, {
        name: typedName, category_id: Number(categoryId), packing, sale_price: salePrice, ...costFields,
      });
      if (!res.ok) return fail(res.error.message);
      articleId = res.data.article_id;
      flash('Product details updated successfully.');
    } else {
      const res = await api.products.create({
        name: typedName, category_id: Number(categoryId), vendor_id: Number(vendorId), packing, sale_price: salePrice, ...costFields,
      });
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE' && res.error.details) {
          setReactivatePrompt(res.error.details as { article_id: number; name: string });
          return;
        }
        return fail(res.error.message);
      }
      articleId = res.data.article_id;
      flash('New product article registered successfully.');
    }

    if (color.trim()) {
      await api.productColors.resolveOrCreate({ article_id: articleId, color: color.trim(), packing });
    }

    setSelectedProductId(null);
    setErrorMsg('');
    handleSwitchTab('list');
    loadAll();
  };

  const confirmReactivateFromPrompt = async () => {
    if (!reactivatePrompt) return;
    const res = await api.products.reactivate(reactivatePrompt.article_id);
    setReactivatePrompt(null);
    if (!res.ok) return fail('Failed to reactivate: ' + res.error.message);
    flash('Existing product reactivated.');
    setSelectedProductId(null);
    handleSwitchTab('list');
    loadAll();
  };

  const [deletingProduct, setDeletingProduct] = useState<ProductRow | null>(null);
  const confirmDelete = async () => {
    if (!deletingProduct) return;
    const res = await api.products.remove(deletingProduct.article_id);
    setDeletingProduct(null);
    if (!res.ok) return fail('Failed to delete: ' + res.error.message);
    flash('Product deleted successfully.');
    setSelectedProductId(null);
    handleSwitchTab('list');
    loadAll();
  };

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return productList;
    const q = productSearch.toLowerCase();
    return productList.filter(prod =>
      prod.name.toLowerCase().includes(q) ||
      prod.code.toLowerCase().includes(q) ||
      (prod.category_name || '').toLowerCase().includes(q) ||
      (prod.vendor_name || '').toLowerCase().includes(q)
    );
  }, [productList, productSearch]);

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
                setSelectedProductId(null);
                handleSwitchTab('list');
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 cursor-pointer ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Registered Products
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 cursor-pointer ${activeTab === 'form' && selectedProductId === null ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Product
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer"
            >
              <Plus size={16} /> Register Product
            </button>
          )}
        </div>

        <div className={`transition-all duration-200 ${isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
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
                      <th className="p-3">Category</th>
                      <th className="p-3">Vendor</th>
                      <th className="p-3 text-center">Packing (Pairs)</th>
                      <th className="p-3 text-right">Sale Price</th>
                      <th className="p-3 text-center" style={{ width: '80px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="text-center p-8 text-slate-400">Loading…</td></tr>
                    ) : filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center p-8 text-slate-400">
                          No registered products found.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map(prod => (
                        <tr
                          key={prod.article_id}
                          className="border-b hover:bg-slate-50/50 transition-colors"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-semibold text-slate-700">{prod.code}</td>
                          <td className="p-3 font-semibold text-slate-900">{prod.name}</td>
                          <td className="p-3 text-slate-500 font-medium">{prod.category_name || 'General'}</td>
                          <td className="p-3 text-slate-600 font-semibold">{prod.vendor_name || 'N/A'}</td>
                          <td className="p-3 text-center font-semibold text-slate-700">{prod.packing}</td>
                          <td className="p-3 text-right font-bold text-amber-800">{formatCurrency(prod.sale_price)}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleSelectProduct(prod)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                                title="Edit Product"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => setDeletingProduct(prod)}
                                className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                title="Delete Product"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
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
                    setSelectedProductId(null);
                    handleSwitchTab('list');
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
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
                        value={selectedProductCode || '(auto-generated on save)'}
                        disabled
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
                      <SearchableSelect
                        options={[
                          { value: '', label: 'Select Category...' },
                          ...categoryList.map(c => ({ value: String(c.category_id), label: c.name }))
                        ]}
                        value={categoryId}
                        onChange={setCategoryId}
                        placeholder="Select Category..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Vendor Partner</label>
                      {selectedProductId ? (
                        <div className="soleria-input bg-slate-100 text-slate-500 font-semibold flex items-center">
                          {vendorList.find(v => String(v.vendor_id) === vendorId)?.name || '—'}
                          <span className="ml-2 text-[10px] text-slate-400 normal-case font-normal">(fixed after creation)</span>
                        </div>
                      ) : (
                        <SearchableSelect
                          options={[
                            { value: '', label: 'Select Vendor...' },
                            ...vendorList.map(v => ({ value: String(v.vendor_id), label: v.name }))
                          ]}
                          value={vendorId}
                          onChange={setVendorId}
                          placeholder="Select Vendor..."
                        />
                      )}
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
                      setSelectedProductId(null);
                      handleSwitchTab('list');
                    }}
                    className="btn-outline px-5 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold px-6 py-2 cursor-pointer"
                  >
                    Save Product Details
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Reactivate-inactive-duplicate prompt */}
        {reactivatePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setReactivatePrompt(null)}>
            <div className="bg-white rounded-2xl border-2 border-amber-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2 flex items-center gap-2">
                <RotateCcw size={18} className="text-amber-500" /> Inactive Product Found
              </h3>
              <p className="text-xs text-slate-600 mb-4">
                An inactive product named <strong>{reactivatePrompt.name}</strong> for this vendor
                already exists. Reactivate it instead of creating a new record?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setReactivatePrompt(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmReactivateFromPrompt} className="btn-gold px-4 py-2 text-xs font-semibold cursor-pointer">Reactivate</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {deletingProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setDeletingProduct(null)}>
            <div className="bg-white rounded-2xl border-2 border-rose-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2">Delete Product</h3>
              <p className="text-xs text-slate-600 mb-4">
                Delete <strong>{deletingProduct.name}</strong>? This deactivates the record — past
                sale/purchase/production history is kept intact.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeletingProduct(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmDelete} className="px-4 py-2 text-xs font-semibold cursor-pointer rounded-lg bg-rose-600 text-white hover:bg-rose-700">Delete</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
