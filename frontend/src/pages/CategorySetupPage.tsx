import { Fragment, useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Trash2, Edit2, Search, Settings, Save, ChevronDown, ChevronRight, X } from 'lucide-react';
import DuplicateNamePromptModal from '@/components/DuplicateNamePromptModal';
import type { ProductCategory } from '@/types';

export default function CategorySetupPage() {
  const { state, dispatch } = useApp();

  const [categorySearch, setCategorySearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<ProductCategory | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Drill-down: clicking a category row expands it to show every product registered under that category
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null);

  // Form State
  const [catName, setCatName] = useState('');
  const [successCat, setSuccessCat] = useState('');
  const [errorCat, setErrorCat] = useState('');

  const handleOpenAddModal = () => {
    setSelectedCatId(null);
    setCatName('');
    setErrorCat('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (cat: { id: string; name: string }) => {
    setSelectedCatId(cat.id);
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

  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = catName.trim();
    if (!typed) {
      return setErrorCat('Category name is required.');
    }

    if (selectedCatId) {
      // Edit mode
      dispatch({
        type: 'UPDATE_CATEGORY',
        category: { id: selectedCatId, name: typed }
      });
      setSuccessCat('Category details updated successfully.');
    } else {
      // Add mode - Flow A duplicate check
      const match = state.categories.find(c => c.name.toLowerCase() === typed.toLowerCase());
      if (match) {
        if (match.isActive !== false) {
          return setErrorCat('A category with this name already exists.');
        } else {
          setDupMatch(match);
          setIsDupModalOpen(true);
          return;
        }
      }

      const newId = 'cat_' + Date.now();
      dispatch({
        type: 'ADD_CATEGORY',
        category: { id: newId, name: typed }
      });
      setSuccessCat('New product category registered successfully.');
    }

    setTimeout(() => setSuccessCat(''), 3000);
    handleCloseModal();
  };

  const handleActivateDuplicate = (id: string) => {
    const match = state.categories.find(c => c.id === id);
    if (match) {
      dispatch({
        type: 'UPDATE_CATEGORY',
        category: { ...match, isActive: true }
      });
      setSuccessCat('Category reactivated successfully.');
      setTimeout(() => setSuccessCat(''), 3000);
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    handleCloseModal();
  };

  const handleDeleteCategory = (id: string) => {
    // Check if category is used by any active products
    const productCount = state.products.filter(p => p.categoryId === id && p.isActive !== false).length;
    if (productCount > 0) {
      alert(`Cannot delete this category. It is currently assigned to ${productCount} registered products.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this category?')) {
      dispatch({ type: 'DELETE_CATEGORY', id });
      setSuccessCat('Category deleted successfully.');
      setTimeout(() => setSuccessCat(''), 3000);
      handleCloseModal();
    }
  };

  const filteredCategories = useMemo(() => {
    const activeCategories = state.categories.filter(c => c.isActive !== false);
    if (!categorySearch.trim()) return activeCategories;
    const q = categorySearch.toLowerCase();
    return activeCategories.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.id.toLowerCase().includes(q)
    );
  }, [state.categories, categorySearch]);

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
                {filteredCategories.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center p-8 text-slate-400">
                      No registered categories found.
                    </td>
                  </tr>
                ) : (
                  filteredCategories.map(cat => {
                    const associatedProducts = state.products.filter(p => p.categoryId === cat.id && p.isActive !== false);
                    const isExpanded = expandedCatId === cat.id;

                    return (
                      <Fragment key={cat.id}>
                        <tr
                          className="border-b hover:bg-slate-50/50 transition-colors cursor-pointer"
                          style={{ borderColor: 'var(--border-table)' }}
                          onClick={() => setExpandedCatId(isExpanded ? null : cat.id)}
                        >
                          <td className="p-3 pl-4 text-slate-400">
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </td>
                          <td className="p-3 font-semibold text-slate-500 font-mono text-xs">{cat.id}</td>
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
                                onClick={() => handleDeleteCategory(cat.id)}
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
                                        <th className="p-2 text-right pr-3">Current Stock</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {associatedProducts.map(p => (
                                        <tr key={p.id} className="border-t" style={{ borderColor: 'var(--border-table)' }}>
                                          <td className="p-2 pl-3 font-mono text-slate-600">{p.id}</td>
                                          <td className="p-2 font-semibold text-slate-700">{p.name}</td>
                                          <td className="p-2 text-slate-500">{state.vendors.find(v => v.id === p.vendorId)?.name || 'General'}</td>
                                          <td className={`p-2 text-right pr-3 font-bold ${(p.stock || 0) <= 0 ? 'text-red-600' : 'text-slate-800'}`}>{(p.stock || 0).toLocaleString()}</td>
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

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="product category"
          status="inactive"
          matches={dupMatch ? [{ id: dupMatch.id, name: dupMatch.name }] : []}
          allowCreateOnActive={false}
          onActivate={handleActivateDuplicate}
          onCreateNew={() => {}}
          onCancel={() => {
            setIsDupModalOpen(false);
            setDupMatch(null);
          }}
        />

      </div>
    </AppLayout>
  );
}
