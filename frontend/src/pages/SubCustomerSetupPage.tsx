import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Save, Users, UserPlus } from 'lucide-react';

export default function SubCustomerSetupPage() {
  const { state, dispatch } = useApp();

  const [customerId, setCustomerId] = useState('');
  const [subName, setSubName] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddSubCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) return setErrorMsg('Please select a parent Customer.');
    if (!subName.trim()) return setErrorMsg('Please enter a Sub Customer name.');

    const newSub = {
      id: 'sub_' + Date.now(),
      name: subName.trim(),
      customerId
    };

    dispatch({ type: 'ADD_SUB_CUSTOMER', subCust: newSub });
    setSubName('');
    setErrorMsg('');
    setSuccessMsg('Sub Customer registered successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <AppLayout pageTitle="Sub Customer Setup">
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          
          {/* Add Sub Customer (Left 2 cols) */}
          <div className="md:col-span-2">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <UserPlus size={18} className="text-amber-600" /> New Sub Customer
              </h3>
              
              <form onSubmit={handleAddSubCustomer} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Customer</label>
                  <select
                    value={customerId}
                    onChange={e => setCustomerId(e.target.value)}
                    className="soleria-input cursor-pointer"
                  >
                    <option value="">Select customer...</option>
                    {state.customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Sub Customer Name</label>
                  <input
                    type="text"
                    value={subName}
                    onChange={e => setSubName(e.target.value)}
                    placeholder="e.g. Salim Agent LHR"
                    className="soleria-input"
                  />
                </div>
                <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
                  <Save size={14} /> Save Sub Customer
                </button>
              </form>
            </div>
          </div>

          {/* Sub Customers List (Right 3 cols) */}
          <div className="md:col-span-3">
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <Users size={18} className="text-slate-600" /> Sub Customers Directory
              </h3>
              
              <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
                {state.customers.map(cust => {
                  const subs = state.subCustomers.filter(sc => sc.customerId === cust.id);
                  if (subs.length === 0) return null;
                  return (
                    <div key={cust.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <div className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2 border-b pb-1">
                        {cust.name} ({cust.id})
                      </div>
                      <div className="flex flex-col gap-1.5 pl-2">
                        {subs.map(sub => (
                          <div key={sub.id} className="text-sm font-semibold text-slate-700 flex justify-between items-center">
                            <span>{sub.name}</span>
                            <span className="font-mono text-[10px] text-slate-400">Code: {sub.id}</span>
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
