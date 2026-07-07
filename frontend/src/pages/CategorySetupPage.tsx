import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Save, Layers } from 'lucide-react';

export default function CategorySetupPage() {
  const { state, dispatch } = useApp();

  const [catName, setCatName] = useState('');
  const [successCat, setSuccessCat] = useState('');

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;

    const newCat = {
      id: 'cat_' + Date.now(),
      name: catName.trim()
    };

    dispatch({ type: 'ADD_CATEGORY', category: newCat });
    setCatName('');
    setSuccessCat('Category added successfully.');
    setTimeout(() => setSuccessCat(''), 3000);
  };

  return (
    <AppLayout pageTitle="Product Category Setup">
      <div className="mx-auto" style={{ maxWidth: 800 }}>
        
        {successCat && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successCat}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Add Category Form */}
          <div className="card-white p-5 bg-white border">
            <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
              <Plus size={18} className="text-amber-600" /> Add New Category
            </h3>
            
            <form onSubmit={handleAddCategory} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Category Name</label>
                <input
                  type="text"
                  value={catName}
                  onChange={e => setCatName(e.target.value)}
                  placeholder="e.g. PU Sole, TPR Sole"
                  className="soleria-input"
                />
              </div>
              <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
                <Save size={14} /> Add Category
              </button>
            </form>
          </div>

          {/* Categories List */}
          <div className="card-white p-5 bg-white border">
            <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
              <Layers size={18} className="text-slate-600" /> Existing Categories
            </h3>
            
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-1">
              {state.categories.map(cat => (
                <div key={cat.id} className="p-3 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-slate-50/50">
                  {cat.name}
                  <span className="block font-mono text-[10px] text-slate-400 font-normal mt-0.5">ID: {cat.id}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
