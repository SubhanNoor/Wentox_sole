import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Save, BookOpen } from 'lucide-react';

export default function ChartAcSetupPage() {
  const { state, dispatch } = useApp();

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [controlId, setControlId] = useState('');
  const [linkCode, setLinkCode] = useState('A');
  const [status, setStatus] = useState<'Active' | 'Closed'>('Active');
  
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddChartAc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Chart Account code is required.');
    if (!name.trim()) return setErrorMsg('Chart Account name is required.');
    if (!controlId) return setErrorMsg('Please select a parent Control A/C.');

    // Check duplicate code
    if (state.chartAccounts.some(c => c.id === id)) {
      return setErrorMsg('Chart code already exists.');
    }

    const newChart = {
      id: id.trim(),
      name: name.trim(),
      controlId,
      linkCode,
      status
    };

    dispatch({ type: 'ADD_CHART_ACCOUNT', account: newChart });
    setId('');
    setName('');
    setErrorMsg('');
    setSuccessMsg('Chart of Account registered successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <AppLayout pageTitle="Chart of Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          
          {/* Add Chart Ac Form */}
          <div className="md:col-span-2">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <Plus size={18} className="text-amber-600" /> Create Chart A/C
              </h3>
              
              <form onSubmit={handleAddChartAc} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Chart Code</label>
                  <input
                    type="text"
                    value={id}
                    onChange={e => setId(e.target.value)}
                    placeholder="e.g. 110001"
                    className="soleria-input font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Chart Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. CUSTOMERS BALANCES"
                    className="soleria-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Control A/C</label>
                  <select
                    value={controlId}
                    onChange={e => setControlId(e.target.value)}
                    className="soleria-input cursor-pointer"
                  >
                    <option value="">Select Control A/C...</option>
                    {state.controlAccounts.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Link Code</label>
                  <input
                    type="text"
                    value={linkCode}
                    onChange={e => setLinkCode(e.target.value)}
                    className="soleria-input font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as any)}
                    className="soleria-input cursor-pointer"
                  >
                    <option value="Active">Active</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
                <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
                  <Save size={14} /> Save Chart A/C
                </button>
              </form>
            </div>
          </div>

          {/* Chart of Accounts List */}
          <div className="md:col-span-3">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <BookOpen size={18} className="text-slate-600" /> Active General Ledger
              </h3>
              
              <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
                {state.controlAccounts.map(ctrl => {
                  const charts = state.chartAccounts.filter(c => c.controlId === ctrl.id);
                  if (charts.length === 0) return null;
                  return (
                    <div key={ctrl.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <div className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2 border-b pb-1">
                        Control: {ctrl.name} ({ctrl.id})
                      </div>
                      <div className="flex flex-col gap-1.5 pl-2">
                        {charts.map(c => (
                          <div key={c.id} className="text-sm font-semibold text-slate-700 flex justify-between items-center">
                            <span>{c.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-slate-400">Code: {c.id}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${c.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {c.status}
                              </span>
                            </div>
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
