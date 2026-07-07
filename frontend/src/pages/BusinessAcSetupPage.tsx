import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Save, Settings } from 'lucide-react';

export default function BusinessAcSetupPage() {
  const { state, dispatch } = useApp();

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [controlId, setControlId] = useState(''); // links to chart accounts
  const [linkCode, setLinkCode] = useState('A');
  const [region, setRegion] = useState('LOCAL');
  const [status, setStatus] = useState<'Active' | 'Closed'>('Active');
  
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddBusinessAc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Business Account code is required.');
    if (!name.trim()) return setErrorMsg('Business Account name is required.');
    if (!controlId) return setErrorMsg('Please select a parent Chart A/C.');

    // Check duplicate code
    if (state.businessAccounts.some(b => b.id === id)) {
      return setErrorMsg('Business account code already exists.');
    }

    const newBiz = {
      id: id.trim(),
      name: name.trim(),
      controlId,
      linkCode,
      region,
      status
    };

    dispatch({ type: 'ADD_BUSINESS_ACCOUNT', account: newBiz });
    
    // Also auto-add to customers if linked under customer balances (e.g. 110001)
    if (controlId === '110001') {
      const cityId = state.cities[0]?.id || 'ct1';
      dispatch({
        type: 'ADD_CUSTOMER',
        customer: {
          id: id.trim(),
          name: name.trim(),
          acId: controlId,
          cityId
        }
      });
      // also create default SAME sub customer
      dispatch({
        type: 'ADD_SUB_CUSTOMER',
        subCust: {
          id: 'sub_' + id.trim(),
          name: 'SAME (Direct)',
          customerId: id.trim()
        }
      });
    }

    setId('');
    setName('');
    setErrorMsg('');
    setSuccessMsg('Business Account registered successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <AppLayout pageTitle="Business Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          
          {/* Add Business Ac Form */}
          <div className="md:col-span-2">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <Plus size={18} className="text-amber-600" /> Create Business A/C
              </h3>
              
              <form onSubmit={handleAddBusinessAc} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Business Account Code</label>
                  <input
                    type="text"
                    value={id}
                    onChange={e => setId(e.target.value)}
                    placeholder="e.g. 11000105"
                    className="soleria-input font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Account Title / Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Shalimar Footwear Agency"
                    className="soleria-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Chart of Account</label>
                  <select
                    value={controlId}
                    onChange={e => setControlId(e.target.value)}
                    className="soleria-input cursor-pointer"
                  >
                    <option value="">Select Chart A/C...</option>
                    {state.chartAccounts.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Region / Location</label>
                  <input
                    type="text"
                    value={region}
                    onChange={e => setRegion(e.target.value)}
                    placeholder="e.g. LOCAL, SOUTH"
                    className="soleria-input"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
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
                </div>
                <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
                  <Save size={14} /> Save Business A/C
                </button>
              </form>
            </div>
          </div>

          {/* Business Accounts List */}
          <div className="md:col-span-3">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <Settings size={18} className="text-slate-600" /> Active Business Ledgers
              </h3>
              
              <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
                {state.chartAccounts.map(chart => {
                  const items = state.businessAccounts.filter(b => b.controlId === chart.id);
                  if (items.length === 0) return null;
                  return (
                    <div key={chart.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <div className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2 border-b pb-1">
                        Chart: {chart.name} ({chart.id})
                      </div>
                      <div className="flex flex-col gap-1.5 pl-2">
                        {items.map(b => (
                          <div key={b.id} className="text-sm font-semibold text-slate-700 flex justify-between items-center">
                            <span>{b.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400 text-xs">{b.region}</span>
                              <span className="font-mono text-[10px] text-slate-400">Code: {b.id}</span>
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
