import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Save, List } from 'lucide-react';

export default function ControlAcSetupPage() {
  const { state, dispatch } = useApp();

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [sorting, setSorting] = useState(1);
  
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddControlAc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Control Account code is required.');
    if (!name.trim()) return setErrorMsg('Control Account name is required.');
    if (!groupId) return setErrorMsg('Please select a parent Group.');

    // Check duplicate code
    if (state.controlAccounts.some(c => c.id === id)) {
      return setErrorMsg('Control code already exists.');
    }

    const newControl = {
      id: id.trim(),
      name: name.trim(),
      groupId,
      sorting
    };

    dispatch({ type: 'ADD_CONTROL_ACCOUNT', account: newControl });
    setId('');
    setName('');
    setErrorMsg('');
    setSuccessMsg('Control Account registered successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <AppLayout pageTitle="Control Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          
          {/* Add Control Ac Form */}
          <div className="md:col-span-2">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <Plus size={18} className="text-amber-600" /> Create Control Account
              </h3>
              
              <form onSubmit={handleAddControlAc} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Control Code</label>
                  <input
                    type="text"
                    value={id}
                    onChange={e => setId(e.target.value)}
                    placeholder="e.g. 1100"
                    className="soleria-input font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Control Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. CASH &amp; BANK ACCs"
                    className="soleria-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Group A/C</label>
                  <select
                    value={groupId}
                    onChange={e => setGroupId(e.target.value)}
                    className="soleria-input cursor-pointer"
                  >
                    <option value="">Select Group...</option>
                    {state.groupAccounts.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Sorting Priority</label>
                  <input
                    type="number"
                    value={sorting}
                    onChange={e => setSorting(parseInt(e.target.value) || 1)}
                    className="soleria-input font-mono"
                  />
                </div>
                <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
                  <Save size={14} /> Save Control A/C
                </button>
              </form>
            </div>
          </div>

          {/* Control Accounts List */}
          <div className="md:col-span-3">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <List size={18} className="text-slate-600" /> Active Control Directory
              </h3>
              
              <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
                {state.groupAccounts.map(grp => {
                  const ctrls = state.controlAccounts.filter(c => c.groupId === grp.id);
                  if (ctrls.length === 0) return null;
                  return (
                    <div key={grp.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <div className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2 border-b pb-1">
                        Group: {grp.name} ({grp.id})
                      </div>
                      <div className="flex flex-col gap-1.5 pl-2">
                        {ctrls.map(c => (
                          <div key={c.id} className="text-sm font-semibold text-slate-700 flex justify-between items-center">
                            <span>{c.name}</span>
                            <span className="font-mono text-[10px] text-slate-400">Code: {c.id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
