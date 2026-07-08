import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2 } from 'lucide-react';

export default function BusinessAcSetupPage() {
  const { state, dispatch } = useApp();

  // Tab State: 'list' | 'form'
  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [controlId, setControlId] = useState(''); // parent chart account ID
  const [linkCode, setLinkCode] = useState('A');
  const [region, setRegion] = useState('LOCAL');
  const [status, setStatus] = useState<'Active' | 'Closed'>('Active');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNew = () => {
    setSelectedId(null);
    setId('');
    setName('');
    setControlId('');
    setLinkCode('A');
    setRegion('LOCAL');
    setStatus('Active');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectBusinessAc = (biz: any) => {
    setSelectedId(biz.id);
    setId(biz.id);
    setName(biz.name);
    setControlId(biz.controlId);
    setLinkCode(biz.linkCode || 'A');
    setRegion(biz.region || 'LOCAL');
    setStatus(biz.status || 'Active');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErrorMsg('Business Account code is required.');
    if (!name.trim()) return setErrorMsg('Business Account title / name is required.');
    if (!controlId) return setErrorMsg('Please select a parent Chart A/C.');

    // Duplicate check only if adding new
    if (!selectedId && state.businessAccounts.some(b => b.id.toLowerCase() === id.trim().toLowerCase())) {
      return setErrorMsg('A Business Account with this code already exists.');
    }

    const accountData = {
      id: id.trim(),
      name: name.trim(),
      controlId,
      linkCode: linkCode.trim(),
      region: region.trim(),
      status
    };

    if (selectedId) {
      // Update
      dispatch({ type: 'UPDATE_BUSINESS_ACCOUNT', account: accountData });
      setSuccessMsg('Business Account updated successfully.');
    } else {
      // Add
      dispatch({ type: 'ADD_BUSINESS_ACCOUNT', account: accountData });

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
      setSuccessMsg('Business Account registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setActiveTab('list');
    setSelectedId(null);
  };

  const handleDeleteBusinessAc = (bizId: string) => {
    // Safety check: is it in use by sale bills?
    const hasBills = state.saleBills.some(bill => bill.customerId === bizId);
    if (hasBills) {
      setErrorMsg('Cannot delete: This business account is linked to active sale bills.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    // Safety check: is it in use by sub-customers (other than auto SAME)?
    const customSubs = state.subCustomers.filter(sc => sc.customerId === bizId && sc.name !== 'SAME (Direct)');
    if (customSubs.length > 0) {
      setErrorMsg('Cannot delete: This customer has custom registered agents/sub-customers mapped.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    if (window.confirm('Are you sure you want to delete this Business Account?')) {
      dispatch({ type: 'DELETE_BUSINESS_ACCOUNT', id: bizId });
      setSuccessMsg('Business Account deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return state.businessAccounts;
    const q = searchQuery.toLowerCase();
    return state.businessAccounts.filter(b => 
      b.name.toLowerCase().includes(q) || 
      b.id.toLowerCase().includes(q) ||
      (b.region && b.region.toLowerCase().includes(q))
    );
  }, [state.businessAccounts, searchQuery]);

  return (
    <AppLayout pageTitle="Business Accounts Setup">
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
                setActiveTab('list');
                setSelectedId(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Business Ledgers Directory
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Add New Business Account
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={handleAddNew}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              <Plus size={16} /> Register Business Account
            </button>
          )}
        </div>

        {/* View 1: Business Accounts Cards Directory */}
        {activeTab === 'list' ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Business Ledgers Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Search and manage custom business ledgers, customer accounts, and expense files.</p>
              </div>
              
              <div className="relative min-w-[270px]">
                <input
                  type="text"
                  placeholder="Search by code, account title..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
              </div>
            </div>

            {filteredAccounts.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl bg-white">
                No registered business accounts found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAccounts.map(biz => {
                  const initialLetter = biz.name.charAt(0).toUpperCase();
                  const chartName = state.chartAccounts.find(c => c.id === biz.controlId)?.name || 'UNKNOWN A/C';

                  return (
                    <div
                      key={biz.id}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      onClick={() => handleSelectBusinessAc(biz)}
                    >
                      <div>
                        {/* Card Top: Code & Status badge */}
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider flex-shrink-0">
                            CODE: {biz.id}
                          </span>
                          <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider">
                            {biz.status?.toUpperCase() || 'ACTIVE'}
                          </span>
                        </div>

                        {/* Card Middle: Avatar circle + Name */}
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-amber-800 transition-colors leading-tight text-[15px] truncate">
                              {biz.name}
                            </h4>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5 uppercase tracking-wider truncate">
                              {chartName} ({biz.region || 'LOCAL'})
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Actions */}
                      <div className="border-t pt-3 mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectBusinessAc(biz)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          title="Edit Business Account"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteBusinessAc(biz.id)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Business Account"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* View 2: Form View */
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="flex items-center gap-3 border-b pb-4 mb-6">
              <button 
                onClick={() => {
                  setActiveTab('list');
                  setSelectedId(null);
                }}
                className="p-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft size={16} className="text-slate-600" />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  {selectedId ? 'Edit Business Account' : 'Register New Business Account'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">Configure properties, parent chart accounts, and tracking status parameters.</p>
              </div>
            </div>

            <form onSubmit={handleSave} className="max-w-xl flex flex-col gap-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={15} className="text-[#B08D57]" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Business Account Configuration</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Business Account Code</label>
                  <input
                    type="text"
                    value={id}
                    onChange={e => setId(e.target.value)}
                    placeholder="e.g. 11000105"
                    disabled={!!selectedId}
                    className="soleria-input font-mono font-semibold disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Account Title / Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Shalimar Footwear Agency"
                    className="soleria-input font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Chart of Account</label>
                  <select
                    value={controlId}
                    onChange={e => setControlId(e.target.value)}
                    className="soleria-input cursor-pointer font-medium"
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
                    className="soleria-input font-medium"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Link Code</label>
                  <input
                    type="text"
                    value={linkCode}
                    onChange={e => setLinkCode(e.target.value)}
                    className="soleria-input font-mono font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as any)}
                    className="soleria-input cursor-pointer font-medium"
                  >
                    <option value="Active">Active</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setSelectedId(null);
                  }}
                  className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-gold flex items-center gap-1.5 px-6 py-2.5 text-xs font-bold text-slate-900 uppercase tracking-wider"
                >
                  <Save size={14} /> Save Details
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
