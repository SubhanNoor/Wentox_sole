import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { focusFirstField } from '@/lib/fieldNav';
import { useHeldKey } from '@/hooks/useHeldKey';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { ProductCosts, CostFieldKey } from '@/types';
import { COST_FIELDS } from '@/types';
import { Plus, Trash2, Edit2, Search, ArrowLeft, RotateCcw, Layers } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import SearchableSelect from '@/components/SearchableSelect';
import ProductArticleForm, { emptyArticleValues } from '@/components/ProductArticleForm';
import type { ArticleFormValues, ArticleFieldErrors } from '@/components/ProductArticleForm';
import * as api from '@/lib/api';
import type { ProductRow, CategoryRow, VendorRow, ProductBatchFieldError } from '@/lib/api';

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

/** An article counts as "unsaved work" once the user has typed a name or picked a vendor for it. */
function articleHasContent(a: ArticleFormValues): boolean {
  return a.name.trim() !== '' || a.vendorId !== '' || a.color.trim() !== '' ||
    a.packing > 0 || a.salePrice > 0 || Object.values(a.costs).some(v => v > 0);
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
  // Every article belongs to the single system vendor (migration 017) — the business manufactures
  // its own product. The field stays visible so it is clear what a product is attributed to, but it
  // is locked, and products.service.js ignores whatever vendor_id arrives regardless.
  const systemVendor = vendorList.find(v => v.is_system);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [prodRes, catRes, venRes] = await Promise.all([
      api.products.list(),
      api.listCategories(),
      api.listVendors({ includeSystem: true }),
    ]);
    if (prodRes.ok) setProductList(prodRes.data);
    if (catRes.ok) setCategoryList(catRes.data);
    if (venRes.ok) setVendorList(venRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Selected product for edit — null means "adding new" (multi-article workflow below)
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProductCode, setSelectedProductCode] = useState('');

  const [reactivatePrompt, setReactivatePrompt] = useState<{ article_id: number; name: string; articleIndex?: number } | null>(null);

  // --- Single-product edit form state (unchanged behaviour: category editable inline, vendor fixed) ---
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editValues, setEditValues] = useState<ArticleFormValues>(emptyArticleValues());

  // --- Multi-article "Add New Product" workflow state ---
  const [batchCategoryId, setBatchCategoryId] = useState('');
  const [articles, setArticles] = useState<ArticleFormValues[]>([emptyArticleValues()]);
  const [articleErrors, setArticleErrors] = useState<Record<number, ArticleFieldErrors>>({});
  const [pendingCategoryChange, setPendingCategoryChange] = useState<string | null>(null);

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 4000); };

  const handleAddNew = () => {
    setSelectedProductId(null);
    setSelectedProductCode('');
    setBatchCategoryId('');
    setArticles([emptyArticleValues()]);
    setArticleErrors({});
    setErrorMsg('');
    handleSwitchTab('form');
  };

  const handleSelectProduct = (prod: ProductRow) => {
    setSelectedProductId(prod.article_id);
    setSelectedProductCode(prod.code);
    setEditCategoryId(String(prod.category_id));
    setEditValues({
      name: prod.name,
      color: '',
      vendorId: String(prod.vendor_id),
      packing: prod.packing || 0,
      salePrice: prod.sale_price || 0,
      costs: costsFromRow(prod),
    });
    setErrorMsg('');
    handleSwitchTab('form');
    // Prefill the color field from the article's own existing variant, if any — reflects today's
    // one-color-per-product UX without needing a full colors list UI.
    api.productColors.listByArticle(prod.article_id).then(r => {
      if (r.ok && r.data.length > 0) setEditValues(prev => ({ ...prev, color: r.data[0].color }));
    });
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const typedName = editValues.name.trim();
    if (!typedName) return fail('Product Article Name is required.');
    if (!editCategoryId) return fail('Category is required. Please select a category.');
    if (!editValues.vendorId) return fail('Vendor Partner is required. Please select a vendor partner.');
    if (!editValues.packing || editValues.packing <= 0) return fail('Packing (pairs/carton) must be greater than 0.');

    const costFields = costsToApiPayload(editValues.costs);

    const res = await api.products.update(selectedProductId!, {
      name: typedName, category_id: Number(editCategoryId), packing: editValues.packing,
      sale_price: editValues.salePrice, ...costFields,
    });
    if (!res.ok) return fail(res.error.message);
    const articleId = res.data.article_id;
    flash('Product details updated successfully.');

    if (editValues.color.trim()) {
      await api.productColors.resolveOrCreate({ article_id: articleId, color: editValues.color.trim(), packing: editValues.packing });
    }

    setSelectedProductId(null);
    setErrorMsg('');
    handleSwitchTab('list');
    loadAll();
  };

  // --- Multi-article helpers ---

  const updateArticle = (idx: number, patch: Partial<ArticleFormValues>) => {
    setArticles(prev => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const addArticle = () => setArticles(prev => [...prev, emptyArticleValues()]);

  // Keyboard entry without the mouse — same pattern as SaleBillPage/SaleReturnPage/PurchasePage.
  // Plain Enter on the last field of the last article already reaches G-01's own handler and
  // submits the whole batch (Save All) — left completely alone, that's correct as-is. Shift+Enter,
  // Ctrl+Enter, or '.'+Enter from the LAST field of ANY article row instead appends a new blank
  // article at the end and focuses into it, so a run of new articles can be typed one after
  // another without reaching for the mouse or the Add Article button.
  const articleRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const periodHeld = useHeldKey('.');

  function handleArticleLastFieldKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !(e.shiftKey || e.ctrlKey || periodHeld.current)) return;
    e.preventDefault();
    e.stopPropagation(); // stop AppLayout's own Enter handler from also walking/submitting this keystroke
    const newRowIndex = articles.length; // always the end, regardless of which row triggered this
    addArticle();
    requestAnimationFrame(() => focusFirstField(articleRowRefs.current[newRowIndex]));
  }

  // This batch form always needs at least one article to type into, so removing the last
  // remaining one clears its fields back to blank instead of removing the row itself.
  const removeArticle = (idx: number) => {
    if (articles.length <= 1) {
      setArticles(prev => prev.map((a, i) => (i === idx ? emptyArticleValues() : a)));
      setArticleErrors(prev => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
      return;
    }
    setArticles(prev => prev.filter((_, i) => i !== idx));
    setArticleErrors(prev => {
      const next: Record<number, ArticleFieldErrors> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const i = Number(key);
        if (i < idx) next[i] = val;
        else if (i > idx) next[i - 1] = val;
      });
      return next;
    });
  };

  const handleCategoryChange = (newVal: string) => {
    if (newVal === batchCategoryId) return;
    const hasUnsaved = articles.some(articleHasContent);
    if (hasUnsaved) {
      setPendingCategoryChange(newVal);
      return;
    }
    setBatchCategoryId(newVal);
  };

  const confirmCategoryChange = () => {
    if (pendingCategoryChange === null) return;
    setBatchCategoryId(pendingCategoryChange);
    setArticles([emptyArticleValues()]);
    setArticleErrors({});
    setPendingCategoryChange(null);
  };

  const validateArticles = (): boolean => {
    const errs: Record<number, ArticleFieldErrors> = {};
    articles.forEach((a, i) => {
      const e: ArticleFieldErrors = {};
      if (!a.name.trim()) e.name = 'Article name is required.';

      if (!a.packing || a.packing <= 0) e.packing = 'Must be greater than 0.';
      if (Object.keys(e).length) errs[i] = e;
    });
    setArticleErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const applyServerFieldErrors = (errors: ProductBatchFieldError[]) => {
    const errs: Record<number, ArticleFieldErrors> = {};
    errors.forEach(fe => { errs[fe.index] = { name: fe.message }; });
    setArticleErrors(errs);
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchCategoryId) return fail('Category is required. Please select a category.');
    if (!validateArticles()) return fail('Please fix the highlighted fields before saving.');

    const res = await api.products.createBatch({
      category_id: Number(batchCategoryId),
      articles: articles.map(a => ({
        name: a.name.trim(),
        // Ignored server-side (always the system vendor) — sent only to satisfy the payload shape.
        vendor_id: systemVendor?.vendor_id ?? 0,
        packing: a.packing,
        sale_price: a.salePrice,
        ...costsToApiPayload(a.costs),
      })),
    });

    if (!res.ok) {
      const details = res.error.details as { index?: number; article_id?: number; name?: string; errors?: ProductBatchFieldError[] } | undefined;
      if (res.error.code === 'BATCH_VALIDATION_FAILED' && details?.errors) {
        applyServerFieldErrors(details.errors);
        return fail('Please fix the highlighted articles.');
      }
      if (res.error.code === 'INACTIVE_DUPLICATE' && details?.article_id != null && details?.name) {
        setReactivatePrompt({ article_id: details.article_id, name: details.name, articleIndex: details.index });
        return;
      }
      if (details?.index != null) {
        setArticleErrors({ [details.index]: { name: res.error.message } });
        return fail(res.error.message);
      }
      return fail(res.error.message);
    }

    // Resolve each article's color the same way the single-product flow does, matched by order —
    // createBatch()/service returns rows in the same order the articles were submitted in.
    await Promise.all(res.data.map((row, i) => {
      const color = articles[i]?.color.trim();
      if (!color) return Promise.resolve();
      return api.productColors.resolveOrCreate({ article_id: row.article_id, color, packing: row.packing });
    }));

    flash(`${res.data.length} product article${res.data.length > 1 ? 's' : ''} registered successfully.`);
    setBatchCategoryId('');
    setArticles([emptyArticleValues()]);
    setArticleErrors({});
    handleSwitchTab('list');
    loadAll();
  };

  const confirmReactivateFromPrompt = async () => {
    if (!reactivatePrompt) return;
    const res = await api.products.reactivate(reactivatePrompt.article_id);
    const wasBatchMode = selectedProductId === null;
    setReactivatePrompt(null);
    if (!res.ok) return fail('Failed to reactivate: ' + res.error.message);
    flash('Existing product reactivated.');
    loadAll();
    if (!wasBatchMode) {
      setSelectedProductId(null);
      handleSwitchTab('list');
    }
    // In batch mode, stay on the form — the rest of the in-progress articles are preserved so the
    // user can remove the colliding one and press Save All again.
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

  const isEditing = selectedProductId !== null;
  const selectedCategoryLabel = categoryList.find(c => String(c.category_id) === batchCategoryId)?.name;

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

              <DataListTable<ProductRow>
                rows={filteredProducts}
                rowKey={prod => prod.article_id}
                onRowClick={prod => handleSelectProduct(prod)}
                loading={loading}
                emptyMessage="No registered products found."
                columns={[
                  {
                    key: 'code',
                    header: 'Code',
                    width: '120px',
                    render: prod => <span className="font-semibold text-slate-700">{prod.code}</span>,
                  },
                  {
                    key: 'name',
                    header: 'Article Name',
                    render: prod => <span className="font-semibold text-slate-900">{prod.name}</span>,
                  },
                  {
                    key: 'category',
                    header: 'Category',
                    render: prod => (
                      <span className="text-slate-500 font-medium">{prod.category_name || 'General'}</span>
                    ),
                  },
                  {
                    key: 'vendor',
                    header: 'Vendor',
                    render: prod => (
                      <span className="text-slate-600 font-semibold">{prod.vendor_name || 'N/A'}</span>
                    ),
                  },
                  {
                    key: 'packing',
                    header: 'Packing (Pairs)',
                    align: 'center',
                    render: prod => <span className="font-semibold text-slate-700">{prod.packing}</span>,
                  },
                  {
                    key: 'sale_price',
                    header: 'Sale Price',
                    align: 'right',
                    render: prod => (
                      <span className="font-bold text-amber-800">{formatCurrency(prod.sale_price)}</span>
                    ),
                  },
                ]}
                actionsWidth="80px"
                actions={prod => (
                  <>
                    <button
                      onClick={() => handleSelectProduct(prod)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                      title="Edit Product"
                    >
                      <Edit2 size={15} />
                    </button>
                  </>
                )}
              />
            </div>
          ) : isEditing ? (
            /* View 2a: Edit Existing Product — unchanged single-product form */
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
                    Edit Product: {editValues.name}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Fill in the fields below to update product specifications and pricing breakdown.</p>
                </div>
              </div>

              <form onSubmit={handleSaveProduct} className="flex flex-col gap-6">
                <ProductArticleForm
                  values={editValues}
                  onChange={patch => setEditValues(prev => ({ ...prev, ...patch }))}
                  vendorList={vendorList}
                  vendorLocked
                  vendorLockedLabel={vendorList.find(v => String(v.vendor_id) === editValues.vendorId)?.name || '—'}
                  leadingSlot={
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Product / Article Code</label>
                      <input
                        type="text"
                        value={selectedProductCode}
                        disabled
                        className="soleria-input font-semibold bg-slate-100 text-slate-500 cursor-not-allowed"
                      />
                    </div>
                  }
                  categorySlot={
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
                      <SearchableSelect
                        options={[
                          { value: '', label: 'Select Category...' },
                          ...categoryList.map(c => ({ value: String(c.category_id), label: c.name }))
                        ]}
                        value={editCategoryId}
                        onChange={setEditCategoryId}
                        placeholder="Select Category..."
                      />
                    </div>
                  }
                />

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
                  <button type="submit" className="btn-gold px-6 py-2 cursor-pointer">
                    Save Product Details
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* View 2b: Add New — multi-article entry workflow */
            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="flex items-center gap-2 border-b pb-3 mb-6">
                <button
                  onClick={() => handleSwitchTab('list')}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <ArrowLeft size={16} />
                </button>
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">Register New Products</h3>
                  <p className="text-xs text-slate-500 font-medium">Pick a category once, then add as many articles under it as you need.</p>
                </div>
              </div>

              <form onSubmit={handleSaveAll} className="flex flex-col gap-6">
                {/* Category — fixed at the top, applies to every article below */}
                <div className="p-4 rounded-xl border-2 flex flex-col sm:flex-row sm:items-end gap-4" style={{ borderColor: 'var(--brand-gold)', background: 'linear-gradient(180deg, #fbf7f0 0%, #ffffff 100%)' }}>
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Category</label>
                    <SearchableSelect
                      options={[
                        { value: '', label: 'Select Category...' },
                        ...categoryList.map(c => ({ value: String(c.category_id), label: c.name }))
                      ]}
                      value={batchCategoryId}
                      onChange={handleCategoryChange}
                      placeholder="Select Category..."
                    />
                  </div>
                  {batchCategoryId && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-navy)] bg-white border border-[var(--brand-gold)]/50 rounded-lg px-3 py-2 whitespace-nowrap">
                      <Layers size={14} className="text-[#B08D57]" />
                      {articles.length} article{articles.length > 1 ? 's' : ''} in this batch
                    </div>
                  )}
                </div>

                {!batchCategoryId ? (
                  <div className="text-center py-12 text-sm text-slate-400 font-medium border-2 border-dashed rounded-xl" style={{ borderColor: 'var(--border-color)' }}>
                    Select a category above to start adding product articles.
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b pb-2">
                      Articles under <span className="text-[var(--brand-navy)]">{selectedCategoryLabel}</span>
                    </div>

                    {articles.map((article, idx) => (
                      <div key={idx} ref={el => { articleRowRefs.current[idx] = el; }} className="rounded-xl border-2 border-slate-200 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-[#111c2a]">
                          <span className="text-xs font-bold text-[#B08D57] uppercase tracking-wider">Article {idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeArticle(idx)}
                            title="Remove this article (clears fields if it's the last one)"
                            className="p-1 rounded-md text-slate-300 hover:text-rose-400 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="p-4">
                          <ProductArticleForm
                            values={article}
                            onChange={patch => updateArticle(idx, patch)}
                            vendorList={vendorList}
                            vendorLocked
                            vendorLockedLabel={systemVendor?.name || 'Manufacturing Product'}
                            errors={articleErrors[idx]}
                            onLastFieldKeyDown={handleArticleLastFieldKeyDown}
                          />
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addArticle}
                      className="btn-dashed flex items-center justify-center gap-1.5 py-3 cursor-pointer"
                    >
                      <Plus size={15} /> Add New Article
                    </button>
                  </div>
                )}

                <div className="flex gap-3 justify-end border-t pt-4">
                  <button
                    type="button"
                    onClick={() => handleSwitchTab('list')}
                    className="btn-outline px-5 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!batchCategoryId}
                    className="btn-gold px-6 py-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Save All{batchCategoryId ? ` (${articles.length})` : ''}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Confirm category change when unsaved articles exist */}
        {pendingCategoryChange !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setPendingCategoryChange(null)}
            onKeyDown={e => { if (e.key === 'Escape') { (() => setPendingCategoryChange(null))(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-amber-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2">Unsaved Articles</h3>
              <p className="text-xs text-slate-600 mb-4">
                You have unsaved articles under the current category. Changing the category will
                clear these entries. Continue?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setPendingCategoryChange(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmCategoryChange} className="px-4 py-2 text-xs font-semibold cursor-pointer rounded-lg bg-rose-600 text-white hover:bg-rose-700">Change Category</button>
              </div>
            </div>
          </div>
        )}

        {/* Reactivate-inactive-duplicate prompt */}
        {reactivatePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setReactivatePrompt(null)}
            onKeyDown={e => { if (e.key === 'Escape') { (() => setReactivatePrompt(null))(); } }}
            tabIndex={-1}>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setDeletingProduct(null)}
            onKeyDown={e => { if (e.key === 'Escape') { (() => setDeletingProduct(null))(); } }}
            tabIndex={-1}>
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
