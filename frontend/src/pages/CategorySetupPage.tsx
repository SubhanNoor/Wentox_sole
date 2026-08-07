import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Trash2, Edit2, Search, Settings, Save, ChevronDown, ChevronRight, X, RotateCcw } from 'lucide-react';
import * as api from '@/lib/api';
import type { CategoryRow, ProductRow } from '@/lib/api';

export default function CategorySetupPage() {
  const [categorySearch, setCategorySearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);

  const [reactivatePrompt, setReactivatePrompt] = useState<{ category_id: number; name: string } | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<CategoryRow | null>(null);

  // Drill-down: clicking a category row expands it to show every product registered under that category
  const [expandedCatId, setExpandedCatId] = useState<number | null>(null);

  const [categoryList, setCategoryList] = useState<CategoryRow[]>([]);
  const [productList, setProductList] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [catRes, prodRes] = await Promise.all([api.categories.list(), api.products.list()]);
    if (catRes.ok) setCategoryList(catRes.data);
    if (prodRes.ok) setProductList(prodRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Form State
  const [catName, setCatName] = useState('');
  const [successCat, setSuccessCat] = useState('');
  const [errorCat, setErrorCat] = useState('');
  const flash = (m: string) => { setSuccessCat(m); setTimeout(() => setSuccessCat(''), 3000); };

  const handleOpenAddModal = () => {
    setSelectedCatId(null);
    setCatName('');
    setErrorCat('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (cat: CategoryRow) => {
    setSelectedCatId(cat.category_id);
    setCatName(cat.name);
    setErrorCat('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCatId(null);
    setCatName('');
    setErrorCat('');
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = catName.trim();
    if (!typed) return setErrorCat('Category name is required.');

    if (selectedCatId) {
      const res = await api.categories.update(selectedCatId, { name: typed });
      if (!res.ok) return setErrorCat(res.error.message);
      flash('Category details updated successfully.');
    } else {
      const res = await api.categories.create({ name: typed });
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE' && res.error.details) {
          setReactivatePrompt(res.error.details as { category_id: number; name: string });
          return;
        }
        return setErrorCat(res.error.message);
      }
      flash('New product category registered successfully.');
    }

    handleCloseModal();
    loadAll();
  };

  const confirmReactivateFromPrompt = async () => {
    if (!reactivatePrompt) return;
    const res = await api.categories.reactivate(reactivatePrompt.category_id);
    setReactivatePrompt(null);
    if (!res.ok) return setErrorCat('Failed to reactivate: ' + res.error.message);
    flash('Existing category reactivated.');
    handleCloseModal();
    loadAll();
  };

  const confirmDelete = async () => {
    if (!deletingCategory) return;
    const res = await api.categories.remove(deletingCategory.category_id);
    setDeletingCategory(null);
    if (!res.ok) return setErrorCat('Failed to delete: ' + res.error.message);
    flash('Category deleted successfully.');
    handleCloseModal();
    loadAll();
  };

  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categoryList;
    const q = categorySearch.toLowerCase();
    return categoryList.filter(c =>
      c.name.toLowerCase().includes(q) ||
      String(c.category_id).includes(q)
    );
  }, [categoryList, categorySearch]);

  return (
    <AppLayout pageTitle="Product Category Setup">
      <div className="mx-auto" style={{ maxWidth: 880 }}>

        {successCat && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successCat}</div>
        )}
        {errorCat && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorCat}</div>
        )}

        {/* Categories Directory List Card */}
        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="border-b pb-4 mb-5 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-lora font-semibold text-lg text-slate-800">Categories Directory</h3>
              <p className="text-xs text-slate-500 font-medium">Search and manage product category groupings for report filtering and analysis.</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Category
            </button>
          </div>

          {/* Search Toolbar Row */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                placeholder="Search by ID, category name..."
                value={categorySearch}
                onChange={e => setCategorySearch(e.target.value)}
                className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3 top-2 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
              Total: {filteredCategories.length} Categories
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4" style={{ width: '30px' }}></th>
                  <th className="p-3">Category ID</th>
                  <th className="p-3">Category Name</th>
                  <th className="p-3 text-center">Associated Products</th>
                  <th className="p-3 text-center" style={{ width: '80px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : filteredCategories.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center p-8 text-slate-400">
                      No registered categories found.
                    </td>
                  </tr>
                ) : (
                  filteredCategories.map(cat => {
                    const associatedProducts = productList.filter(p => p.category_id === cat.category_id);
                    const isExpanded = expandedCatId === cat.category_id;

                    return (
                      <Fragment key={cat.category_id}>
                        <tr
                          className="border-b hover:bg-slate-50/50 transition-colors cursor-pointer"
                          style={{ borderColor: 'var(--border-table)' }}
                          onClick={() => setExpandedCatId(isExpanded ? null : cat.category_id)}
                        >
                          <td className="p-3 pl-4 text-slate-400">
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </td>
                          <td className="p-3 font-semibold text-slate-500 font-mono text-xs">{cat.category_id}</td>
                          <td className="p-3 font-semibold text-slate-900">{cat.name}</td>
                          <td className="p-3 text-center font-bold text-slate-700">{associatedProducts.length}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => handleOpenEditModal(cat)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                                title="Edit Category"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => setDeletingCategory(cat)}
                                className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                title="Delete Category"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50/70 border-b" style={{ borderColor: 'var(--border-table)' }}>
                            <td></td>
                            <td colSpan={4} className="p-4">
                              {associatedProducts.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-2">No products registered under this category yet.</p>
                              ) : (
                                <div className="bg-white border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                                  <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                      <tr className="bg-slate-50 text-slate-400 uppercase tracking-wider">
                                        <th className="p-2 pl-3">Code</th>
                                        <th className="p-2">Product Name</th>
                                        <th className="p-2">Vendor</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {associatedProducts.map(p => (
                                        <tr key={p.article_id} className="border-t" style={{ borderColor: 'var(--border-table)' }}>
                                          <td className="p-2 pl-3 font-mono text-slate-600">{p.code}</td>
                                          <td className="p-2 font-semibold text-slate-700">{p.name}</td>
                                          <td className="p-2 text-slate-500">{p.vendor_name || 'General'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedCatId ? 'Edit Category' : 'Register New Category'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveCategory} className="p-5 flex flex-col gap-4">
                {errorCat && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorCat}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Category Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={catName}
                    onChange={e => setCatName(e.target.value)}
                    placeholder="e.g. PU Sole, TPR Sole"
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold px-5 py-2 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Save size={14} /> Save Category
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Reactivate-inactive-duplicate prompt */}
        {reactivatePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setReactivatePrompt(null)}>
            <div className="bg-white rounded-2xl border-2 border-amber-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2 flex items-center gap-2">
                <RotateCcw size={18} className="text-amber-500" /> Inactive Category Found
              </h3>
              <p className="text-xs text-slate-600 mb-4">
                An inactive category named <strong>{reactivatePrompt.name}</strong> already exists.
                Reactivate it instead of creating a new record?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setReactivatePrompt(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmReactivateFromPrompt} className="btn-gold px-4 py-2 text-xs font-semibold cursor-pointer">Reactivate</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {deletingCategory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setDeletingCategory(null)}>
            <div className="bg-white rounded-2xl border-2 border-rose-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2">Delete Category</h3>
              <p className="text-xs text-slate-600 mb-4">
                Delete <strong>{deletingCategory.name}</strong>? This deactivates the record.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeletingCategory(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmDelete} className="px-4 py-2 text-xs font-semibold cursor-pointer rounded-lg bg-rose-600 text-white hover:bg-rose-700">Delete</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
