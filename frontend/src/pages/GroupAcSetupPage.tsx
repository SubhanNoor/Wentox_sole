import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Save, ListCollapse } from 'lucide-react';

export default function GroupAcSetupPage() {
  const { state, dispatch } = useApp();

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [acClass, setAcClass] = useState<'ASSETS' | 'LIABILITY' | 'INCOME' | 'EXPENSES'>('ASSETS');
  
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddGroupAc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Group Account code is required.');
    if (!name.trim()) return setErrorMsg('Group Account name is required.');

    // Check duplicate code
    if (state.groupAccounts.some(g => g.id === id)) {
      return setErrorMsg('Group code already exists.');
    }

    const newGroup = {
      id: id.trim(),
      name: name.trim(),
      class: acClass
    };

    dispatch({ type: 'ADD_GROUP_ACCOUNT', account: newGroup });
    setId('');
    setName('');
    setErrorMsg('');
    setSuccessMsg('Group Account registered successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <AppLayout pageTitle="Group Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          
          {/* Add Group Ac Form */}
          <div className="md:col-span-2">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <Plus size={18} className="text-amber-600" /> Create Group Account
              </h3>
              
              <form onSubmit={handleAddGroupAc} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Group Code</label>
                  <input
                    type="text"
                    value={id}
                    onChange={e => setId(e.target.value)}
                    placeholder="e.g. 5000"
                    className="soleria-input font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Group Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. MANUFACTURING OVERHEADS"
                    className="soleria-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Account Class</label>
                  <select
                    value={acClass}
                    onChange={e => setAcClass(e.target.value as any)}
                    className="soleria-input cursor-pointer"
                  >
                    <option value="ASSETS">ASSETS</option>
                    <option value="LIABILITY">LIABILITY</option>
                    <option value="INCOME">INCOME</option>
                    <option value="EXPENSES">EXPENSES</option>
                  </select>
                </div>
                <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
                  <Save size={14} /> Save Group A/C
                </button>
              </form>
            </div>
          </div>

          {/* Group Accounts List */}
          <div className="md:col-span-3">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <ListCollapse size={18} className="text-slate-600" /> Active Groups Ledger
              </h3>
              
              <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
                {state.groupAccounts.map(grp => (
                  <div key={grp.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 flex justify-between items-center text-sm font-semibold text-slate-700">
                    <div>
                      <div>{grp.name}</div>
                      <span className="font-mono text-[10px] text-slate-400 font-normal">Code: {grp.id}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${grp.class === 'ASSETS' ? 'bg-blue-100 text-blue-800' : grp.class === 'LIABILITY' ? 'bg-amber-100 text-amber-800' : grp.class === 'INCOME' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {grp.class}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
