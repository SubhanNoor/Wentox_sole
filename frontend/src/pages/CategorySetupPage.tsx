import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Trash2, Edit2, Search, ArrowLeft, Settings, Save } from 'lucide-react';

export default function CategorySetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [categorySearch, setCategorySearch] = useState('');

  // Editing state
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);

  // Form State
  const [catName, setCatName] = useState('');
  const [successCat, setSuccessCat] = useState('');
  const [errorCat, setErrorCat] = useState('');

  const handleAddNew = () => {
    setSelectedCatId(null);
    setCatName('');
    setErrorCat('');
    setActiveTab('form');
  };

  const handleSelectCategory = (cat: { id: string; name: string }) => {
    setSelectedCatId(cat.id);
    setCatName(cat.name);
    setErrorCat('');
    setActiveTab('form');
  };

  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) {
      return setErrorCat('Category name is required.');
    }

    if (selectedCatId) {
      // Edit mode
      dispatch({
        type: 'UPDATE_CATEGORY',
        category: { id: selectedCatId, name: catName.trim() }
      });
      setSuccessCat('Category details updated successfully.');
    } else {
      // Add mode
      const newId = 'cat_' + Date.now();
      dispatch({
        type: 'ADD_CATEGORY',
        category: { id: newId, name: catName.trim() }
      });
      setSuccessCat('New product category registered successfully.');
    }

    setTimeout(() => setSuccessCat(''), 3000);
    setCatName('');
    setSelectedCatId(null);
    setErrorCat('');
    setActiveTab('list');
  };

  const handleDeleteCategory = (id: string) => {
    // Check if category is used by any products
    const productCount = state.products.filter(p => p.categoryId === id).length;
    if (productCount > 0) {
      alert(`Cannot delete this category. It is currently assigned to ${productCount} registered products.`);
      return;
    }

    if (window.confirm('Are you sure you want to delete this category?')) {
      dispatch({ type: 'DELETE_CATEGORY', id });
      setSuccessCat('Category deleted successfully.');
      setTimeout(() => setSuccessCat(''), 3000);
      setSelectedCatId(null);
      setActiveTab('list');
    }
  };

  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return state.categories;
    const q = categorySearch.toLowerCase();
    return state.categories.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.id.toLowerCase().includes(q)
    );
  }, [state.categories, categorySearch]);

  return (
    <AppLayout pageTitle="Product Category Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {successCat && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successCat}</div>
        )}
        {errorCat && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorCat}</div>
        )}

        {/* Tab Selection Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => {
                setActiveTab('list');
                setSelectedCatId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Existing Categories
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedCatId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Category
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Category
            </button>
          )}
        </div>

        {/* View 1: Categories Directory List */}
        {activeTab === 'list' ? (
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="border-b pb-3 mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Categories Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage product category groupings for report filtering and analysis.</p>
              </div>
              
              <div className="relative min-w-[240px]">
                <input
                  type="text"
                  placeholder="Search by ID, category name..."
                  value={categorySearch}
                  onChange={e => setCategorySearch(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold"
                />
                <Search className="absolute right-3 top-2 text-slate-400" size={14} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Category ID</th>
                    <th className="p-3">Category Name</th>
                    <th className="p-3 text-center">Associated Products</th>
                    <th className="p-3 text-center" style={{ width: '80px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCategories.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center p-8 text-slate-400">
                        No registered categories found.
                      </td>
                    </tr>
                  ) : (
                    filteredCategories.map(cat => {
                      const associatedCount = state.products.filter(p => p.categoryId === cat.id).length;

                      return (
                        <tr
                          key={cat.id}
                          className="border-b hover:bg-slate-50/50 transition-colors"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-semibold text-slate-500">{cat.id}</td>
                          <td className="p-3 font-semibold text-slate-900">{cat.name}</td>
                          <td className="p-3 text-center font-bold text-slate-700">{associatedCount}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleSelectCategory(cat)}
                                className="text-slate-500 hover:text-amber-600 p-1 rounded hover:bg-slate-100"
                                title="Edit Category"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteCategory(cat.id)}
                                className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-slate-100"
                                title="Delete Category"
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
          /* View 2: Add New / Edit Category Form */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-2 border-b pb-3 mb-6">
              <button
                onClick={() => {
                  setActiveTab('list');
                  setSelectedCatId(null);
                }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-[#111c2a]">
                  {selectedCatId ? `Edit Category: ${catName}` : 'Register New Category'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Specify the name of the category classification below.</p>
              </div>
            </div>

            <form onSubmit={handleSaveCategory} className="flex flex-col gap-6">
              {/* Category Details */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Category Configuration
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Category Name</label>
                    <input
                      type="text"
                      value={catName}
                      onChange={e => setCatName(e.target.value)}
                      placeholder="e.g. PU Sole, TPR Sole"
                      className="soleria-input font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex gap-3 justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedCatId(null);
                  }}
                  className="btn-outline px-5 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold px-6 py-2 flex items-center gap-1.5"
                >
                  <Save size={16} /> Save Category Details
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
