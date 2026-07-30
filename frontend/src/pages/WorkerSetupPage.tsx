import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2, Phone, MapPin } from 'lucide-react';
import type { Worker } from '@/types';

// Workers' ledger accounts hang off WORKER WAGES — a LIABILITY container, like
// VENDORS ACCOUNTS. It has to be a liability rather than an expense head because
// a worker can be owed money between doing the work and being paid; an account
// under EXPENSES can only accumulate what was paid out, never a balance due.
// Payment Trail's "Employees" row sums payments made against these accounts.
const WORKER_CHART_ID = '220001';

export default function WorkerSetupPage() {
  const { state, dispatch } = useApp();

  const [activeTab, setActiveTab] = useState<'list' | 'form'>('list');
  const [workerSearch, setWorkerSearch] = useState('');
  const [selectedCityFilter, setSelectedCityFilter] = useState('all');

  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  // Form State
  const [workerName, setWorkerName] = useState('');
  const [workerPhone, setWorkerPhone] = useState('');
  const [workerCityId, setWorkerCityId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const cityName = (id?: string) => state.cities.find(c => c.id === id)?.name || '';

  const handleAddNew = () => {
    setSelectedWorkerId(null);
    setWorkerName('');
    setWorkerPhone('');
    setWorkerCityId('');
    setErrorMsg('');
    setActiveTab('form');
  };

  const handleSelectWorker = (worker: Worker) => {
    setSelectedWorkerId(worker.id);
    setWorkerName(worker.name);
    setWorkerPhone(worker.phone || '');
    setWorkerCityId(worker.cityId || '');
    setErrorMsg('');
    setActiveTab('form');
  };

  /**
   * Next Business Account code under WORKER WAGES.
   *
   * Deliberately a FOUR-digit serial, not the two digits the Vendor page uses.
   * Two digits cap a chart account at 99 children, and the client's legacy data
   * already holds 200+ accounts under one Employees head — an import would hit
   * that ceiling immediately. See database_schema.md §3.2.
   */
  const getNextWorkerAccountCode = () => {
    const existing = state.businessAccounts.filter(acc => acc.controlId === WORKER_CHART_ID);
    const maxSerial = existing.reduce((max, acc) => {
      const serial = parseInt(acc.id.substring(WORKER_CHART_ID.length), 10);
      return isNaN(serial) ? max : Math.max(max, serial);
    }, 0);
    return `${WORKER_CHART_ID}${String(maxSerial + 1).padStart(4, '0')}`;
  };

  const handleSaveWorker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerName.trim()) return setErrorMsg('Worker name is required.');

    if (selectedWorkerId) {
      // Edit — the linked account's name is kept in sync by the reducer
      const existing = state.workers.find(w => w.id === selectedWorkerId);
      dispatch({
        type: 'UPDATE_WORKER',
        worker: {
          id: selectedWorkerId,
          name: workerName.trim(),
          phone: workerPhone.trim() || undefined,
          cityId: workerCityId || undefined,
          baId: existing?.baId || ''
        }
      });
      setSuccessMsg('Worker details updated successfully.');
    } else {
      // Add — auto-create the linked ledger account, same as Vendors do
      const baId = getNextWorkerAccountCode();

      dispatch({
        type: 'ADD_BUSINESS_ACCOUNT',
        account: {
          id: baId,
          name: `${workerName.trim()} A/C`,
          controlId: WORKER_CHART_ID,
          linkCode: 'A',
          region: 'LOCAL',
          status: 'Active'
        }
      });

      dispatch({
        type: 'ADD_WORKER',
        worker: {
          id: 'w_' + Date.now(),
          name: workerName.trim(),
          phone: workerPhone.trim() || undefined,
          cityId: workerCityId || undefined,
          baId
        }
      });
      setSuccessMsg('New worker registered successfully.');
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    setWorkerName('');
    setWorkerPhone('');
    setWorkerCityId('');
    setSelectedWorkerId(null);
    setErrorMsg('');
    setActiveTab('list');
  };

  const handleDeleteWorker = (worker: Worker) => {
    // Deleting a worker also removes their ledger account, which would orphan
    // every payment made to them — so block it while any payment exists.
    const paid = state.expenses.filter(ex => ex.businessAccountId === worker.baId);
    if (paid.length > 0) {
      const total = paid.reduce((s, ex) => s + ex.amount, 0);
      setErrorMsg(
        `Cannot delete ${worker.name}: ${paid.length} payment(s) totalling ${formatCurrency(total)} are recorded against their account.`
      );
      setTimeout(() => setErrorMsg(''), 5000);
      return;
    }

    if (window.confirm(`Delete ${worker.name}? Their ledger account will be removed too.`)) {
      dispatch({ type: 'DELETE_WORKER', id: worker.id });
      setSuccessMsg('Worker deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setSelectedWorkerId(null);
      setActiveTab('list');
    }
  };

  const usedCities = useMemo(() => {
    const ids = new Set(state.workers.map(w => w.cityId).filter(Boolean) as string[]);
    return state.cities.filter(c => ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [state.workers, state.cities]);

  const filteredWorkers = useMemo(() => {
    const cityOf = (id?: string) => state.cities.find(c => c.id === id)?.name || '';
    return state.workers.filter(w => {
      if (workerSearch.trim()) {
        const q = workerSearch.toLowerCase();
        const matches =
          w.name.toLowerCase().includes(q) ||
          w.baId.toLowerCase().includes(q) ||
          (w.phone && w.phone.toLowerCase().includes(q)) ||
          cityOf(w.cityId).toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (selectedCityFilter !== 'all' && w.cityId !== selectedCityFilter) return false;
      return true;
    });
  }, [state.workers, workerSearch, selectedCityFilter, state.cities]);

  return (
    <AppLayout pageTitle="Workers Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Tabs */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => { setActiveTab('list'); setSelectedWorkerId(null); }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Registered Workers
            </button>
            <button
              onClick={handleAddNew}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'form' && !selectedWorkerId ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Register New Worker
            </button>
          </div>

          {activeTab === 'list' && (
            <button onClick={handleAddNew} className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm">
              <Plus size={16} /> Add Worker
            </button>
          )}
        </div>

        {activeTab === 'list' ? (
          <div className="card-white p-6 md:p-8 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Workers Directory</h3>
                <p className="text-xs text-slate-500 font-medium">
                  Each worker has a ledger account under Worker Wages. Payments to them appear
                  in Payment Trail under Employees.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">City:</span>
                  <select
                    value={selectedCityFilter}
                    onChange={e => setSelectedCityFilter(e.target.value)}
                    className="soleria-input py-1.5 cursor-pointer text-xs min-w-[130px]"
                  >
                    <option value="all">All Cities</option>
                    {usedCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="relative">
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search:</span>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Name, phone, code..."
                      value={workerSearch}
                      onChange={e => setWorkerSearch(e.target.value)}
                      className="soleria-input py-2 text-sm pr-9 font-semibold min-w-[220px]"
                    />
                    <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">A/C Code</th>
                    <th className="p-3">Worker Name</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">City</th>
                    <th className="p-3 text-right">Paid to Date</th>
                    <th className="p-3 text-center" style={{ width: '90px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400">
                        {state.workers.length === 0
                          ? 'No workers registered yet. Add one to start recording wage payments.'
                          : 'No workers match this filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredWorkers.map(w => {
                      const paid = state.expenses
                        .filter(ex => ex.businessAccountId === w.baId)
                        .reduce((s, ex) => s + ex.amount, 0);
                      return (
                        <tr key={w.id} className="border-b hover:bg-slate-50/50 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-mono font-semibold text-slate-600">{w.baId}</td>
                          <td className="p-3 font-semibold text-slate-900">{w.name}</td>
                          <td className="p-3 text-slate-600">
                            {w.phone ? (
                              <span className="inline-flex items-center gap-1.5"><Phone size={12} className="text-slate-400" />{w.phone}</span>
                            ) : (
                              <span className="text-slate-300 text-xs italic">—</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-600">
                            {w.cityId ? (
                              <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" />{cityName(w.cityId)}</span>
                            ) : (
                              <span className="text-slate-300 text-xs italic">—</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-bold text-slate-800">
                            {paid > 0 ? formatCurrency(paid) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleSelectWorker(w)}
                                title="Edit Worker"
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => handleDeleteWorker(w)}
                                title="Delete Worker"
                                className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                              >
                                <Trash2 size={15} />
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
          /* Form */
          <div className="card-white p-6 md:p-8 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-start gap-3 border-b pb-4 mb-6">
              <button
                onClick={() => { setActiveTab('list'); setSelectedWorkerId(null); }}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 mt-0.5"
                title="Back to list"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  {selectedWorkerId ? `Edit Worker: ${workerName}` : 'Register New Worker'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedWorkerId
                    ? 'Renaming the worker renames their linked ledger account too.'
                    : 'A ledger account is created automatically under Worker Wages — no separate setup needed.'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveWorker} className="flex flex-col gap-6 max-w-2xl">
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Worker Details
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Worker Name <span className="text-red-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      value={workerName}
                      onChange={e => setWorkerName(e.target.value)}
                      placeholder="e.g. Noman Butt"
                      className="soleria-input font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={workerPhone}
                      onChange={e => setWorkerPhone(e.target.value)}
                      placeholder="e.g. 0301-4455661"
                      className="soleria-input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">City</label>
                    <select
                      value={workerCityId}
                      onChange={e => setWorkerCityId(e.target.value)}
                      className="soleria-input cursor-pointer"
                    >
                      <option value="">Select city...</option>
                      {state.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                {selectedWorkerId && (
                  <div className="text-xs text-slate-500 border-t pt-3">
                    Ledger account:{' '}
                    <span className="font-mono font-semibold text-slate-700">
                      {state.workers.find(w => w.id === selectedWorkerId)?.baId}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={() => { setActiveTab('list'); setSelectedWorkerId(null); }}
                  className="px-5 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                  <Save size={16} /> {selectedWorkerId ? 'Save Changes' : 'Register Worker'}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
