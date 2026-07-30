import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { getEmployeeBalance } from '@/lib/payroll';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, ArrowLeft, Settings, Save, Edit2, Trash2, Phone, MapPin, HardHat, BadgeDollarSign } from 'lucide-react';
import { COST_FIELDS } from '@/types';
import type { Employee, EmployeeType, CostFieldKey } from '@/types';

/**
 * Staff ledger accounts hang off a LIABILITY container, like VENDORS ACCOUNTS.
 * It has to be a liability rather than an expense head because staff can be
 * owed money between doing the work and being paid; an account under EXPENSES
 * can only accumulate what was paid out, never a balance due.
 *
 * The two kinds hang under DIFFERENT heads — the only thing employeeType
 * changes at creation time. Keeping them apart lets a report separate
 * piece-rate labour (a product cost) from salary (overhead).
 */
const CHART_ID_BY_TYPE: Record<EmployeeType, string> = {
  WORKER: '220001',   // WORKER WAGES
  SALARIED: '220002', // SALARIES PAYABLE
};

type Tab = 'workers' | 'salaried' | 'form';

export default function EmployeeSetupPage() {
  const { state, dispatch } = useApp();

  const [activeTab, setActiveTab] = useState<Tab>('workers');
  const [returnTab, setReturnTab] = useState<Tab>('workers');
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('all');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form state
  const [empType, setEmpType] = useState<EmployeeType>('WORKER');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cityId, setCityId] = useState('');
  const [stages, setStages] = useState<CostFieldKey[]>([]);
  const [salary, setSalary] = useState('');

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const cityName = (id?: string) => state.cities.find(c => c.id === id)?.name || '';
  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (msg: string) => { setErrorMsg(msg); setTimeout(() => setErrorMsg(''), 5000); };

  const handleAddNew = (type: EmployeeType) => {
    setSelectedId(null);
    setEmpType(type);
    setName('');
    setPhone('');
    setCityId('');
    setStages([]);
    setSalary('');
    setErrorMsg('');
    setReturnTab(type === 'WORKER' ? 'workers' : 'salaried');
    setActiveTab('form');
  };

  const handleSelect = (emp: Employee) => {
    setSelectedId(emp.id);
    setEmpType(emp.employeeType);
    setName(emp.name);
    setPhone(emp.phone || '');
    setCityId(emp.cityId || '');
    setStages(emp.stages ? [...emp.stages] : []);
    setSalary(emp.monthlySalary ? String(emp.monthlySalary) : '');
    setErrorMsg('');
    setReturnTab(emp.employeeType === 'WORKER' ? 'workers' : 'salaried');
    setActiveTab('form');
  };

  const backToList = () => { setActiveTab(returnTab); setSelectedId(null); setErrorMsg(''); };

  const toggleStage = (key: CostFieldKey) => {
    setStages(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  /**
   * Next Business Account code under the head this employee's type implies.
   *
   * Deliberately a FOUR-digit serial, not the two digits the Vendor page uses.
   * Two digits cap a chart account at 99 children, and the client's legacy data
   * already holds 200+ accounts under one Employees head — an import would hit
   * that ceiling immediately. See database_schema.md §3.2.
   */
  const getNextAccountCode = (type: EmployeeType) => {
    const chartId = CHART_ID_BY_TYPE[type];
    const existing = state.businessAccounts.filter(acc => acc.controlId === chartId);
    const maxSerial = existing.reduce((max, acc) => {
      const serial = parseInt(acc.id.substring(chartId.length), 10);
      return isNaN(serial) ? max : Math.max(max, serial);
    }, 0);
    return `${chartId}${String(maxSerial + 1).padStart(4, '0')}`;
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrorMsg('Employee name is required.');

    // A worker with no trades can never be paid for anything, so saving one
    // makes a dead record. Failing here is kinder than failing on the wage
    // screen weeks later.
    if (empType === 'WORKER' && stages.length === 0) {
      return setErrorMsg('Pick at least one trade — a worker with no trades cannot be paid for any work.');
    }
    if (empType === 'SALARIED') {
      const n = Number(salary);
      if (!salary.trim() || isNaN(n) || n <= 0) {
        return setErrorMsg('A monthly salary is required for a salaried employee.');
      }
    }

    const shared = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      cityId: cityId || undefined,
      employeeType: empType,
      stages: empType === 'WORKER' ? stages : undefined,
      monthlySalary: empType === 'SALARIED' ? Number(salary) : undefined,
    };

    if (selectedId) {
      const existing = state.employees.find(e => e.id === selectedId);
      dispatch({
        type: 'UPDATE_EMPLOYEE',
        employee: { ...shared, id: selectedId, baId: existing?.baId || '' }
      });
      flash('Employee details updated successfully.');
    } else {
      const baId = getNextAccountCode(empType);

      dispatch({
        type: 'ADD_BUSINESS_ACCOUNT',
        account: {
          id: baId,
          name: `${name.trim()} A/C`,
          controlId: CHART_ID_BY_TYPE[empType],
          linkCode: 'A',
          region: 'LOCAL',
          status: 'Active'
        }
      });

      dispatch({
        type: 'ADD_EMPLOYEE',
        employee: { ...shared, id: (empType === 'WORKER' ? 'w_' : 's_') + Date.now(), baId }
      });
      flash(empType === 'WORKER' ? 'New worker registered successfully.' : 'New salaried employee registered successfully.');
    }

    setSelectedId(null);
    setErrorMsg('');
    setActiveTab(empType === 'WORKER' ? 'workers' : 'salaried');
  };

  const handleDelete = (emp: Employee) => {
    // Deleting an employee also removes their ledger account, which would
    // orphan everything recorded against it — so block while any trace exists.
    const paid = state.expenses.filter(ex => ex.businessAccountId === emp.baId);
    if (paid.length > 0) {
      const total = paid.reduce((s, ex) => s + ex.amount, 0);
      return fail(`Cannot delete ${emp.name}: ${paid.length} payment(s) totalling ${formatCurrency(total)} are recorded against their account.`);
    }
    const runs = emp.employeeType === 'WORKER'
      ? state.wageRuns.filter(r => r.employeeId === emp.id).length
      : state.salaryRuns.filter(r => r.items.some(i => i.employeeId === emp.id)).length;
    if (runs > 0) {
      return fail(`Cannot delete ${emp.name}: they appear on ${runs} ${emp.employeeType === 'WORKER' ? 'wage' : 'salary'} run(s).`);
    }

    if (window.confirm(`Delete ${emp.name}? Their ledger account will be removed too.`)) {
      dispatch({ type: 'DELETE_EMPLOYEE', id: emp.id });
      flash('Employee deleted successfully.');
      setSelectedId(null);
      setActiveTab(emp.employeeType === 'WORKER' ? 'workers' : 'salaried');
    }
  };

  const listType: EmployeeType = activeTab === 'salaried' ? 'SALARIED' : 'WORKER';

  const usedCities = useMemo(() => {
    const ids = new Set(state.employees.map(e => e.cityId).filter(Boolean) as string[]);
    return state.cities.filter(c => ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [state.employees, state.cities]);

  const filtered = useMemo(() => {
    const cityOf = (id?: string) => state.cities.find(c => c.id === id)?.name || '';
    return state.employees.filter(e => {
      if (e.employeeType !== listType) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          e.name.toLowerCase().includes(q) ||
          e.baId.toLowerCase().includes(q) ||
          (e.phone && e.phone.toLowerCase().includes(q)) ||
          cityOf(e.cityId).toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (cityFilter !== 'all' && e.cityId !== cityFilter) return false;
      return true;
    });
  }, [state.employees, listType, search, cityFilter, state.cities]);

  const workerCount = state.employees.filter(e => e.employeeType === 'WORKER').length;
  const salariedCount = state.employees.filter(e => e.employeeType === 'SALARIED').length;

  const stageLabel = (key: CostFieldKey) => COST_FIELDS.find(f => f.key === key)?.workerLabel || key;

  return (
    <AppLayout pageTitle="Employees Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {/* Tabs — two sections, one per kind of staff */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => { setActiveTab('workers'); setSelectedId(null); }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5 ${activeTab === 'workers' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <HardHat size={15} /> Workers ({workerCount})
            </button>
            <button
              onClick={() => { setActiveTab('salaried'); setSelectedId(null); }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5 ${activeTab === 'salaried' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <BadgeDollarSign size={15} /> Salaried Employees ({salariedCount})
            </button>
          </div>

          {activeTab !== 'form' && (
            <button onClick={() => handleAddNew(listType)} className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm">
              <Plus size={16} /> Add {listType === 'WORKER' ? 'Worker' : 'Salaried Employee'}
            </button>
          )}
        </div>

        {activeTab !== 'form' ? (
          <div className="card-white p-6 md:p-8 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  {listType === 'WORKER' ? 'Workers Directory' : 'Salaried Employees Directory'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {listType === 'WORKER'
                    ? 'Paid per piece, for the trades they are registered for. Accounts sit under Worker Wages.'
                    : 'Paid a fixed amount each month. Accounts sit under Salaries Payable.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">City:</span>
                  <select
                    value={cityFilter}
                    onChange={e => setCityFilter(e.target.value)}
                    className="soleria-input py-1.5 cursor-pointer text-xs min-w-[130px]"
                  >
                    <option value="all">All Cities</option>
                    {usedCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search:</span>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Name, phone, code..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
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
                    <th className="p-3">Name</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">City</th>
                    <th className="p-3">{listType === 'WORKER' ? 'Trades' : 'Monthly Salary'}</th>
                    <th className="p-3 text-right">Balance Due</th>
                    <th className="p-3 text-center" style={{ width: '90px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-slate-400">
                        {(listType === 'WORKER' ? workerCount : salariedCount) === 0
                          ? `No ${listType === 'WORKER' ? 'workers' : 'salaried employees'} registered yet.`
                          : 'No one matches this filter.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map(emp => {
                      // Balance, not "paid to date": what they are OWED. Positive
                      // means we owe them; negative means we have paid ahead.
                      const bal = getEmployeeBalance(state, emp.id);
                      return (
                        <tr key={emp.id} className="border-b hover:bg-slate-50/50 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-mono font-semibold text-slate-600">{emp.baId}</td>
                          <td className="p-3 font-semibold text-slate-900">{emp.name}</td>
                          <td className="p-3 text-slate-600">
                            {emp.phone
                              ? <span className="inline-flex items-center gap-1.5"><Phone size={12} className="text-slate-400" />{emp.phone}</span>
                              : <span className="text-slate-300 text-xs italic">—</span>}
                          </td>
                          <td className="p-3 text-slate-600">
                            {emp.cityId
                              ? <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" />{cityName(emp.cityId)}</span>
                              : <span className="text-slate-300 text-xs italic">—</span>}
                          </td>
                          <td className="p-3 text-slate-600">
                            {emp.employeeType === 'WORKER' ? (
                              <div className="flex flex-wrap gap-1">
                                {(emp.stages || []).map(s => (
                                  <span key={s} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600">
                                    {stageLabel(s)}
                                  </span>
                                ))}
                                {(emp.stages || []).length === 0 && <span className="text-rose-500 text-xs italic">no trades set</span>}
                              </div>
                            ) : (
                              <span className="font-semibold text-slate-800">{formatCurrency(emp.monthlySalary || 0)}</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-bold">
                            {bal === 0
                              ? <span className="text-slate-300">—</span>
                              : <span className={bal < 0 ? 'text-amber-600' : 'text-slate-800'}>{formatCurrency(bal)}</span>}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => handleSelect(emp)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors">
                                <Edit2 size={15} />
                              </button>
                              <button onClick={() => handleDelete(emp)} title="Delete" className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors">
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
            <p className="text-[11px] text-slate-400 mt-4">
              Balance Due is what is still owed: everything earned on posted runs, minus everything paid.
              A negative figure (amber) means they have been paid more than they have earned so far.
            </p>
          </div>
        ) : (
          /* Form */
          <div className="card-white p-6 md:p-8 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-start gap-3 border-b pb-4 mb-6">
              <button onClick={backToList} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 mt-0.5" title="Back to list">
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  {selectedId ? `Edit Employee: ${name}` : 'Register New Employee'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedId
                    ? 'Renaming the employee renames their linked ledger account too.'
                    : 'A ledger account is created automatically under the right head — no separate setup needed.'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSave} className="flex flex-col gap-6 max-w-2xl">

              {/* Type first — everything below depends on it */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Employee Type
                </div>

                {selectedId ? (
                  <div className="text-sm">
                    <span className="font-semibold text-slate-800">
                      {empType === 'WORKER' ? 'Worker (piece rate)' : 'Salaried employee (fixed monthly)'}
                    </span>
                    <p className="text-xs text-slate-500 mt-1">
                      The type cannot be changed after creation — it would strand the ledger account
                      under the wrong head and orphan either the trades or the salary history.
                      To move someone, deactivate them and register again.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {([
                      { t: 'WORKER' as EmployeeType, icon: HardHat, title: 'Worker', sub: 'Paid per piece, for the trades he works. Accrues on a wage run.' },
                      { t: 'SALARIED' as EmployeeType, icon: BadgeDollarSign, title: 'Salaried Employee', sub: 'Paid a fixed amount every month. Accrues on the monthly salary run.' },
                    ]).map(opt => {
                      const Icon = opt.icon;
                      const on = empType === opt.t;
                      return (
                        <button
                          type="button"
                          key={opt.t}
                          onClick={() => setEmpType(opt.t)}
                          className={`text-left p-3 rounded-lg border-2 transition-all ${on ? 'border-[#B08D57] bg-white shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                        >
                          <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                            <Icon size={16} className={on ? 'text-[#B08D57]' : 'text-slate-400'} /> {opt.title}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-snug">{opt.sub}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Common details */}
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Settings size={15} className="text-[#B08D57]" /> Details
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Name <span className="text-red-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={empType === 'WORKER' ? 'e.g. Amir Bottom Man' : 'e.g. Jawad Iqbal (Manager)'}
                      className="soleria-input font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="e.g. 0301-4455661"
                      className="soleria-input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">City</label>
                    <select value={cityId} onChange={e => setCityId(e.target.value)} className="soleria-input cursor-pointer">
                      <option value="">Select city...</option>
                      {state.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Type-specific */}
              {empType === 'WORKER' ? (
                <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between border-b pb-2">
                    <span className="flex items-center gap-1.5">
                      <HardHat size={15} className="text-[#B08D57]" /> Trades <span className="text-red-500 font-bold">*</span>
                    </span>
                    <span className="text-[11px] font-medium text-slate-500 normal-case tracking-normal">
                      {stages.length} of {COST_FIELDS.length} selected
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 -mt-1">
                    On the wage run screen this worker can only be paid for the trades ticked here.
                    Pick at least one.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {COST_FIELDS.map(f => {
                      const on = stages.includes(f.key);
                      return (
                        <button
                          type="button"
                          key={f.key}
                          onClick={() => toggleStage(f.key)}
                          className={`text-left px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${on ? 'border-[#B08D57] bg-[#B08D57]/10 text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                        >
                          <span className="block">{f.workerLabel}</span>
                          <span className="block text-[10px] font-medium text-slate-400 mt-0.5">{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-3 text-[11px] font-semibold">
                    <button type="button" onClick={() => setStages(COST_FIELDS.map(f => f.key))} className="text-slate-500 hover:text-slate-800 underline">Select all</button>
                    <button type="button" onClick={() => setStages([])} className="text-slate-500 hover:text-slate-800 underline">Clear</button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                    <BadgeDollarSign size={15} className="text-[#B08D57]" /> Monthly Salary <span className="text-red-500 font-bold">*</span>
                  </div>
                  <div className="max-w-xs">
                    <input
                      type="number"
                      min={0}
                      value={salary}
                      onChange={e => setSalary(e.target.value)}
                      placeholder="e.g. 60000"
                      className="soleria-input font-semibold text-right"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Pre-fills this employee's line on every monthly salary run. Changing it later
                    does not touch months already posted — each run keeps a snapshot of what the
                    salary was at the time.
                  </p>
                </div>
              )}

              {selectedId && (
                <div className="text-xs text-slate-500 border-t pt-3">
                  Ledger account:{' '}
                  <span className="font-mono font-semibold text-slate-700">
                    {state.employees.find(e => e.id === selectedId)?.baId}
                  </span>
                  <span className="text-slate-400"> — under {empType === 'WORKER' ? 'Worker Wages' : 'Salaries Payable'}</span>
                </div>
              )}

              <div className="flex gap-3 justify-end border-t pt-4">
                <button type="button" onClick={backToList} className="px-5 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                  <Save size={16} /> {selectedId ? 'Save Changes' : 'Register Employee'}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
