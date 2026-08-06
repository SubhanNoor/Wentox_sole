import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { getEmployeeBalance } from '@/lib/payroll';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Trash2, Phone, MapPin, HardHat, BadgeDollarSign, X, Tag } from 'lucide-react';
import { COST_FIELDS } from '@/types';
import type { Employee, EmployeeType } from '@/types';
import SearchableSelect from '@/components/SearchableSelect';

const CHART_ID_BY_TYPE: Record<EmployeeType, string> = {
  WORKER: '220001',   // WORKER WAGES
  SALARIED: '220002', // SALARIES PAYABLE
};

type ListTab = 'workers' | 'salaried';

export default function EmployeeSetupPage() {
  const { state, dispatch } = useApp();

  const [activeTab, setActiveTab] = useState<ListTab>('workers');
  const [isClosing, setIsClosing] = useState(false);

  const handleSwitchTab = (tab: ListTab) => {
    setIsClosing(true);
    setTimeout(() => {
      setActiveTab(tab);
      setIsClosing(false);
    }, 200);
  };

  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form state
  const [empType, setEmpType] = useState<EmployeeType>('WORKER');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cityId, setCityId] = useState('');
  const [stages, setStages] = useState<string[]>([]);
  const [customTrade, setCustomTrade] = useState('');
  const [salary, setSalary] = useState('');

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const cityName = (id?: string) => state.cities.find(c => c.id === id)?.name || '';
  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (msg: string) => { setErrorMsg(msg); setTimeout(() => setErrorMsg(''), 5000); };

  const handleOpenAddModal = (type: EmployeeType) => {
    setSelectedId(null);
    setEmpType(type);
    setName('');
    setPhone('');
    setCityId('');
    setStages([]);
    setCustomTrade('');
    setSalary('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (emp: Employee) => {
    setSelectedId(emp.id);
    setEmpType(emp.employeeType);
    setName(emp.name);
    setPhone(emp.phone || '');
    setCityId(emp.cityId || '');
    setStages(emp.stages ? [...emp.stages] : []);
    setCustomTrade('');
    setSalary(emp.monthlySalary ? String(emp.monthlySalary) : '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setName('');
    setPhone('');
    setCityId('');
    setStages([]);
    setCustomTrade('');
    setSalary('');
    setErrorMsg('');
  };

  const toggleStage = (key: string) => {
    setStages(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleAddCustomTrade = () => {
    const trimmed = customTrade.trim();
    if (!trimmed) return;
    if (!stages.includes(trimmed)) {
      setStages(prev => [...prev, trimmed]);
    }
    setCustomTrade('');
  };

  // Compile pre-existing trade options (standard COST_FIELDS + custom trades registered across workers)
  const allTradeOptions = useMemo(() => {
    const standard = COST_FIELDS.map(f => ({ key: f.key, label: f.workerLabel }));
    const customKeys = new Set<string>();

    state.employees.forEach(e => {
      if (e.employeeType === 'WORKER' && e.stages) {
        e.stages.forEach(st => {
          if (!standard.some(s => s.key === st)) {
            customKeys.add(st);
          }
        });
      }
    });

    stages.forEach(st => {
      if (!standard.some(s => s.key === st)) {
        customKeys.add(st);
      }
    });

    const customOptions = Array.from(customKeys).map(k => ({ key: k, label: k }));
    return [...standard, ...customOptions];
  }, [state.employees, stages]);

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
      flash(`${empType === 'WORKER' ? 'Worker' : 'Salaried employee'} added successfully.`);
    }

    handleCloseModal();
  };

  const remove = (emp: Employee) => {
    const isWorker = emp.employeeType === 'WORKER';
    const used = isWorker
      ? state.wageRuns.filter(r => r.employeeId === emp.id).length
      : state.salaryRuns.some(r => r.items.some(it => it.employeeId === emp.id));
    if (used) {
      return fail(`Cannot delete ${emp.name}: payroll records exist for this employee.`);
    }
    if (window.confirm(`Delete ${emp.name}?`)) {
      dispatch({ type: 'DELETE_EMPLOYEE', id: emp.id });
      flash('Employee deleted.');
      handleCloseModal();
    }
  };

  const activeEmployees = useMemo(
    () => state.employees.filter(e => e.employeeType === (activeTab === 'workers' ? 'WORKER' : 'SALARIED')),
    [state.employees, activeTab]
  );

  const filtered = useMemo(() => {
    let list = activeEmployees;
    if (cityFilter !== 'all') {
      list = list.filter(e => e.cityId === cityFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.phone || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeEmployees, cityFilter, search]);

  const totalOutstanding = useMemo(
    () => activeEmployees.reduce((s, e) => s + getEmployeeBalance(state, e.id), 0),
    [state, activeEmployees]
  );

  const formatStageLabels = (keys?: string[]) => {
    if (!keys || !keys.length) return '—';
    return keys.map(k => {
      const found = COST_FIELDS.find(f => f.key === k);
      return found ? found.workerLabel : k;
    }).join(', ');
  };

  return (
    <AppLayout pageTitle="Employee & Worker Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {/* Subpage Header & Action Button */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1">
            <button
              onClick={() => handleSwitchTab('workers')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'workers' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <HardHat size={15} /> Piece-Rate Workers ({state.employees.filter(e => e.employeeType === 'WORKER').length})
            </button>
            <button
              onClick={() => handleSwitchTab('salaried')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'salaried' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <BadgeDollarSign size={15} /> Salaried Staff ({state.employees.filter(e => e.employeeType === 'SALARIED').length})
            </button>
          </div>

          <button
            onClick={() => handleOpenAddModal(activeTab === 'workers' ? 'WORKER' : 'SALARIED')}
            className="btn-gold flex items-center gap-1.5 px-4 py-2 text-xs font-semibold shadow-2xs hover:shadow-xs cursor-pointer"
          >
            <Plus size={16} /> Register {activeTab === 'workers' ? 'Worker' : 'Salaried Employee'}
          </button>
        </div>

        {/* Directory View Container */}
        <div className={`transition-all duration-200 ${isClosing ? 'opacity-0 translate-y-2 scale-98' : 'opacity-100 translate-y-0 scale-100 animate-in fade-in duration-200'}`}>
          <div className="card-white p-6 md:p-8 bg-white border overflow-visible">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                  {activeTab === 'workers' ? (
                    <><HardHat size={20} className="text-[#B08D57]" /> Piece-Rate Workers</>
                  ) : (
                    <><BadgeDollarSign size={20} className="text-[#B08D57]" /> Salaried Staff</>
                  )}
                </h3>
                <p className="text-xs text-slate-500">
                  {activeTab === 'workers'
                    ? 'Workers earn per-piece on wage runs according to registered trades.'
                    : 'Salaried staff receive fixed monthly pay credited automatically on salary runs.'}
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-48">
                  <SearchableSelect
                    options={[
                      { value: 'all', label: 'All Cities' },
                      ...state.cities.map(c => ({ value: c.id, label: c.name }))
                    ]}
                    value={cityFilter}
                    onChange={setCityFilter}
                    placeholder="All Cities"
                  />
                </div>

                <div className="relative min-w-[200px]">
                  <input
                    type="text"
                    placeholder="Search name, phone..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="soleria-input w-full py-1.5 text-xs pr-9 font-semibold"
                  />
                  <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">A/C Code</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">City</th>
                    {activeTab === 'workers' ? (
                      <th className="p-3">Registered Trades</th>
                    ) : (
                      <th className="p-3 text-right">Fixed Monthly Salary</th>
                    )}
                    <th className="p-3 text-right">Current Balance</th>
                    <th className="p-3 text-center" style={{ width: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-slate-400">
                        {activeEmployees.length === 0
                          ? `No registered ${activeTab === 'workers' ? 'workers' : 'salaried staff'} yet.`
                          : 'No employees match this search.'}
                      </td>
                    </tr>
                  ) : filtered.map(emp => {
                    const bal = getEmployeeBalance(state, emp.id);
                    return (
                      <tr key={emp.id} className="border-b hover:bg-slate-50/50 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono font-semibold text-slate-500">{emp.baId}</td>
                        <td className="p-3 font-semibold text-slate-900">{emp.name}</td>
                        <td className="p-3 text-slate-600">
                          {emp.phone ? <span className="flex items-center gap-1"><Phone size={12} className="text-slate-400" /> {emp.phone}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="p-3 text-slate-600">
                          {emp.cityId ? <span className="flex items-center gap-1"><MapPin size={12} className="text-slate-400" /> {cityName(emp.cityId)}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        {activeTab === 'workers' ? (
                          <td className="p-3 text-slate-700 font-medium">{formatStageLabels(emp.stages)}</td>
                        ) : (
                          <td className="p-3 text-right font-semibold text-slate-900">
                            {emp.monthlySalary != null ? formatCurrency(emp.monthlySalary) : '—'}
                          </td>
                        )}
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(bal)}</td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEditModal(emp)}
                              title="Edit Employee"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => remove(emp)}
                              title="Delete Employee"
                              className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {activeEmployees.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-900 text-white font-bold text-xs">
                      <td colSpan={5} className="p-3 pl-4 uppercase tracking-wider text-[#B08D57]">
                        Total Outstanding ({activeTab === 'workers' ? 'Workers' : 'Salaried Staff'})
                      </td>
                      <td className="p-3 text-right text-sm text-[#B08D57] font-mono">{formatCurrency(totalOutstanding)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedId ? 'Edit Employee Details' : `Register New ${empType === 'WORKER' ? 'Worker' : 'Salaried Employee'}`}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                {/* Employee Type selector if new */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Employment Model</label>
                  {selectedId ? (
                    <div className="text-xs text-slate-700 font-semibold bg-slate-100 px-3 py-2 rounded-lg border border-slate-200">
                      {empType === 'WORKER' ? 'Worker (piece rate)' : 'Salaried employee (fixed monthly)'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { t: 'WORKER' as EmployeeType, icon: HardHat, title: 'Worker', sub: 'Paid per piece' },
                        { t: 'SALARIED' as EmployeeType, icon: BadgeDollarSign, title: 'Salaried Employee', sub: 'Fixed monthly' },
                      ].map(opt => {
                        const Icon = opt.icon;
                        const on = empType === opt.t;
                        return (
                          <button
                            type="button"
                            key={opt.t}
                            onClick={() => setEmpType(opt.t)}
                            className={`text-left p-2.5 rounded-xl border-2 transition-all cursor-pointer ${on ? 'border-[var(--brand-gold)] bg-amber-50/30 shadow-xs' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                          >
                            <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-800">
                              <Icon size={15} className={on ? 'text-[var(--brand-gold)]' : 'text-slate-400'} /> {opt.title}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5">{opt.sub}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Name & Phone & City */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Name <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={empType === 'WORKER' ? 'e.g. Amir Bottom Man' : 'e.g. Jawad Iqbal (Manager)'}
                      className="soleria-input w-full font-semibold"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone Number</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="e.g. 0301-4455661"
                      className="soleria-input w-full font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">City Location</label>
                    <SearchableSelect
                      options={[
                        { value: '', label: 'Select city...' },
                        ...state.cities.map(c => ({ value: c.id, label: c.name }))
                      ]}
                      value={cityId}
                      onChange={setCityId}
                      placeholder="Select city..."
                    />
                  </div>
                </div>

                {/* Worker Trades vs Salaried Monthly Salary */}
                {empType === 'WORKER' ? (
                  <div className="p-3.5 bg-slate-50/70 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between border-b pb-2">
                      <span className="flex items-center gap-1.5">
                        <HardHat size={14} className="text-[#B08D57]" /> Registered Trades <span className="text-rose-500 font-bold">*</span>
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
                        {stages.length} selected
                      </span>
                    </div>

                    {/* Pre-existing and custom trade buttons grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-1">
                      {allTradeOptions.map(f => {
                        const on = stages.includes(f.key);
                        return (
                          <button
                            type="button"
                            key={f.key}
                            onClick={() => toggleStage(f.key)}
                            className={`text-left px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer flex items-center justify-between gap-1 ${on ? 'border-[#B08D57] bg-[#B08D57]/15 text-slate-900 font-bold shadow-2xs' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                          >
                            <span className="truncate">{f.label}</span>
                            {on && <span className="text-[10px] text-[var(--brand-gold)] font-bold">✓</span>}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-semibold pt-1 border-t border-slate-200/60">
                      <div className="flex gap-3">
                        <button type="button" onClick={() => setStages(allTradeOptions.map(f => f.key))} className="text-slate-600 hover:text-slate-900 underline cursor-pointer">Select all</button>
                        <button type="button" onClick={() => setStages([])} className="text-slate-600 hover:text-slate-900 underline cursor-pointer">Clear</button>
                      </div>
                    </div>

                    {/* Add Custom Registered Trade input section */}
                    <div className="pt-2 border-t border-slate-200/60">
                      <label className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
                        <Tag size={12} className="text-[#B08D57]" /> Register Custom Trade
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customTrade}
                          onChange={e => setCustomTrade(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomTrade();
                            }
                          }}
                          placeholder="e.g. Embroiderer, Sole Buffer..."
                          className="soleria-input flex-1 text-xs py-1.5 px-2.5 font-semibold bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleAddCustomTrade}
                          className="btn-outline px-3 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1"
                        >
                          <Plus size={13} /> Add Trade
                        </button>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Monthly Fixed Salary (PKR) <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={salary}
                      onChange={e => setSalary(e.target.value)}
                      placeholder="e.g. 60000"
                      className="soleria-input w-full font-semibold"
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold px-5 py-2 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Save size={14} /> Save Employee
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
