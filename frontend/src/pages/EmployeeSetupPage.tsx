import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { EmployeeRow, EmployeeType, StageRow, CityRow, WageRunRow, ExpenseRow } from '@/lib/api';
import { getEmployeeBalance, type FlatSalaryItem } from '@/lib/payroll';
import AppLayout from '@/components/AppLayout';
import OpeningBalanceFields from '@/components/OpeningBalanceFields';
import { Plus, Search, Settings, Save, Edit2, Phone, MapPin, HardHat, BadgeDollarSign, X, RotateCcw } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import SearchableSelect from '@/components/SearchableSelect';

type ListTab = 'workers' | 'salaried';

export default function EmployeeSetupPage() {
  const [employeeList, setEmployeeList] = useState<EmployeeRow[]>([]);
  const [stageList, setStageList] = useState<StageRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [wageRuns, setWageRuns] = useState<WageRunRow[]>([]);
  const [salaryItems, setSalaryItems] = useState<FlatSalaryItem[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);

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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Form state
  const [empType, setEmpType] = useState<EmployeeType>('WORKER');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cityId, setCityId] = useState('');
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [salary, setSalary] = useState('');
  // The opening balance lives on the auto-created business account, not on this row — the service
  // forwards it there (same route bankAccounts.service.js has always used).
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState('');

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [reactivatePrompt, setReactivatePrompt] = useState<{ employee_id: number; name: string; phone: string | null } | null>(null);

  const cityName = (id?: number | null) => cities.find(c => c.city_id === id)?.name || '';
  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (msg: string) => { setErrorMsg(msg); setTimeout(() => setErrorMsg(''), 5000); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [empRes, stageRes, cityRes, wrRes, srRes, exRes] = await Promise.all([
      api.employees.list({ includeInactive: true }),
      api.stages.list(),
      api.listCities(),
      api.wageRuns.list(),
      api.salaryRuns.list({ status: 'CONFIRMED' }),
      api.expenses.list({ status: 'CONFIRMED' }),
    ]);
    if (empRes.ok) setEmployeeList(empRes.data);
    if (stageRes.ok) setStageList(stageRes.data);
    if (cityRes.ok) setCities(cityRes.data);
    if (wrRes.ok) setWageRuns(wrRes.data);
    if (exRes.ok) setExpenses(exRes.data);

    // salaryRuns:list() has no line items — flatten each CONFIRMED run's items via get()
    // once here so getEmployeeBalance() can sum a salaried employee's accrual across runs.
    if (srRes.ok) {
      const details = await Promise.all(srRes.data.map(r => api.salaryRuns.get(r.salary_run_id)));
      const flat: FlatSalaryItem[] = [];
      details.forEach(d => {
        if (!d.ok || !d.data.items) return;
        d.data.items.forEach(it => flat.push({
          employee_id: it.employee_id,
          amount: it.amount,
          run_date: d.data.run_date,
          status: d.data.status,
        }));
      });
      setSalaryItems(flat);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleOpenAddModal = (type: EmployeeType) => {
    setSelectedId(null);
    setEmpType(type);
    setName('');
    setPhone('');
    setCityId('');
    setSelectedStages([]);
    setSalary('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = async (emp: EmployeeRow) => {
    setSelectedId(emp.employee_id);
    setEmpType(emp.employee_type);
    setName(emp.name);
    setPhone(emp.phone || '');
    setCityId(emp.city_id != null ? String(emp.city_id) : '');
    setSalary(emp.monthly_salary != null ? String(emp.monthly_salary) : '');
    setErrorMsg('');
    setIsModalOpen(true);
    if (emp.employee_type === 'WORKER') {
      // list() only carries a comma stage_keys string — get() has the authoritative set.
      const res = await api.employees.get(emp.employee_id);
      setSelectedStages(res.ok && res.data.stages ? res.data.stages.map(s => s.stage_key) : []);
    } else {
      setSelectedStages([]);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setName('');
    setPhone('');
    setCityId('');
    setSelectedStages([]);
    setSalary('');
    setOpeningBalance('');
    setOpeningDate('');
    setErrorMsg('');
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next
  // employee — instead of closing. G-04: openingDate is deliberately NOT reset here; it stays
  // selected for the rest of this window's session and only clears on handleCloseModal.
  const resetForNextEmployee = () => {
    setSelectedId(null);
    setName('');
    setPhone('');
    setCityId('');
    setSelectedStages([]);
    setSalary('');
    setOpeningBalance('');
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const toggleStage = (key: string) => {
    setSelectedStages(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrorMsg('Employee name is required.');

    if (empType === 'WORKER' && selectedStages.length === 0) {
      return setErrorMsg('Pick at least one trade — a worker with no trades cannot be paid for any work.');
    }
    if (empType === 'SALARIED') {
      const n = Number(salary);
      if (!salary.trim() || isNaN(n) || n <= 0) {
        return setErrorMsg('A monthly salary is required for a salaried employee.');
      }
    }

    const payload: api.EmployeeCreateInput = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      city_id: cityId ? Number(cityId) : undefined,
      employee_type: empType,
      stages: empType === 'WORKER' ? selectedStages : undefined,
      monthly_salary: empType === 'SALARIED' ? Number(salary) : undefined,
      opening_balance: openingBalance.trim() ? Number(openingBalance) : undefined,
      opening_date: openingDate.trim() || undefined,
    };

    if (selectedId) {
      const res = await api.employees.update(selectedId, payload);
      if (!res.ok) return setErrorMsg(res.error.message);
      flash('Employee details updated successfully.');
      handleCloseModal();
    } else {
      const res = await api.employees.create(payload);
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE' && res.error.details) {
          setReactivatePrompt(res.error.details as { employee_id: number; name: string; phone: string | null });
          return;
        }
        return setErrorMsg(res.error.message);
      }
      flash(`${empType === 'WORKER' ? 'Worker' : 'Salaried employee'} added successfully.`);
      resetForNextEmployee();
    }

    loadAll();
  };

  const confirmReactivateFromPrompt = async () => {
    if (!reactivatePrompt) return;
    const res = await api.employees.reactivate(reactivatePrompt.employee_id);
    setReactivatePrompt(null);
    if (!res.ok) return fail('Failed to reactivate: ' + res.error.message);
    flash('Existing employee reactivated.');
    resetForNextEmployee();
    loadAll();
  };



  const activeEmployees = useMemo(
    () => employeeList.filter(e => e.is_active && e.employee_type === (activeTab === 'workers' ? 'WORKER' : 'SALARIED')),
    [employeeList, activeTab]
  );

  const filtered = useMemo(() => {
    let list = activeEmployees;
    if (cityFilter !== 'all') {
      list = list.filter(e => String(e.city_id ?? '') === cityFilter);
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
    () => activeEmployees.reduce((s, e) => s + getEmployeeBalance(e, wageRuns, salaryItems, expenses), 0),
    [activeEmployees, wageRuns, salaryItems, expenses]
  );

  const formatStageLabels = (stageKeys?: string | null) => {
    if (!stageKeys) return '—';
    return stageKeys.split(',').map(k => {
      const found = stageList.find(s => s.stage_key === k);
      return found ? found.worker_label : k;
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
              <HardHat size={15} /> Piece-Rate Workers ({employeeList.filter(e => e.is_active && e.employee_type === 'WORKER').length})
            </button>
            <button
              onClick={() => handleSwitchTab('salaried')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'salaried' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <BadgeDollarSign size={15} /> Salaried Staff ({employeeList.filter(e => e.is_active && e.employee_type === 'SALARIED').length})
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
                      ...cities.map(c => ({ value: String(c.city_id), label: c.name }))
                    ]}
                    value={cityFilter}
                    onChange={setCityFilter}
                    placeholder="Filter City..."
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
            <DataListTable<EmployeeRow>
              rows={filtered}
              rowKey={emp => emp.employee_id}
              onRowClick={emp => handleOpenEditModal(emp)}
              loading={loading}
              emptyMessage={activeEmployees.length === 0
                ? `No registered ${activeTab === 'workers' ? 'workers' : 'salaried staff'} yet.`
                : 'No employees match this search.'}
              columns={[
                {
                  key: 'code',
                  header: 'A/C Code',
                  width: '120px',
                  render: emp => <span className="font-mono font-semibold text-slate-500">{emp.ba_id}</span>,
                },
                {
                  key: 'name',
                  header: 'Name',
                  render: emp => <span className="font-semibold text-slate-900">{emp.name}</span>,
                },
                {
                  key: 'phone',
                  header: 'Phone',
                  render: emp => emp.phone
                    ? <span className="text-slate-600 flex items-center gap-1"><Phone size={12} className="text-slate-400" /> {emp.phone}</span>
                    : <span className="text-slate-300">—</span>,
                },
                {
                  key: 'city',
                  header: 'City',
                  render: emp => emp.city_id
                    ? <span className="text-slate-600 flex items-center gap-1"><MapPin size={12} className="text-slate-400" /> {cityName(emp.city_id)}</span>
                    : <span className="text-slate-300">—</span>,
                },
                // Workers show their trades; salaried staff show their fixed salary instead.
                activeTab === 'workers'
                  ? {
                      key: 'trades',
                      header: 'Registered Trades',
                      render: emp => (
                        <span className="text-slate-700 font-medium">{formatStageLabels(emp.stage_keys)}</span>
                      ),
                    }
                  : {
                      key: 'salary',
                      header: 'Fixed Monthly Salary',
                      align: 'right',
                      render: emp => (
                        <span className="font-semibold text-slate-900">
                          {emp.monthly_salary != null ? formatCurrency(emp.monthly_salary) : '—'}
                        </span>
                      ),
                    },
                {
                  key: 'balance',
                  header: 'Current Balance',
                  align: 'right',
                  render: emp => (
                    <span className="font-bold text-slate-800">
                      {formatCurrency(getEmployeeBalance(emp, wageRuns, salaryItems, expenses))}
                    </span>
                  ),
                },
              ]}
              actionsWidth="90px"
              actions={emp => (
                <>
                  <button
                    onClick={() => handleOpenEditModal(emp)}
                    title="Edit Employee"
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  >
                    <Edit2 size={15} />
                  </button>
                </>
              )}
              footer={activeEmployees.length > 0 ? (
                <tr className="bg-slate-900 text-white font-bold text-xs">
                  <td colSpan={5} className="p-3 pl-4 uppercase tracking-wider text-[#B08D57]">
                    Total Outstanding ({activeTab === 'workers' ? 'Workers' : 'Salaried Staff'})
                  </td>
                  <td className="p-3 text-right text-sm text-[#B08D57] font-mono">{formatCurrency(totalOutstanding)}</td>
                  <td />
                </tr>
              ) : undefined}
            />
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
                      ref={nameInputRef}
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
                      options={cities.map(c => ({ value: String(c.city_id), label: c.name }))}
                      value={cityId}
                      onChange={setCityId}
                      placeholder="Select city..."
                    />
                  </div>
                </div>

                <OpeningBalanceFields
                  balance={openingBalance}
                  date={openingDate}
                  onBalanceChange={setOpeningBalance}
                  onDateChange={setOpeningDate}
                  isExisting={selectedId != null}
                />

                {/* Worker Trades vs Salaried Monthly Salary */}
                {empType === 'WORKER' ? (
                  <div className="p-3.5 bg-slate-50/70 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between border-b pb-2">
                      <span className="flex items-center gap-1.5">
                        <HardHat size={14} className="text-[#B08D57]" /> Registered Trades <span className="text-rose-500 font-bold">*</span>
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
                        {selectedStages.length} selected
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-1">
                      {stageList.map(f => {
                        const on = selectedStages.includes(f.stage_key);
                        return (
                          <button
                            type="button"
                            key={f.stage_key}
                            onClick={() => toggleStage(f.stage_key)}
                            className={`text-left px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer flex items-center justify-between gap-1 ${on ? 'border-[#B08D57] bg-[#B08D57]/15 text-slate-900 font-bold shadow-2xs' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                          >
                            <span className="truncate">{f.worker_label}</span>
                            {on && <span className="text-[10px] text-[var(--brand-gold)] font-bold">✓</span>}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-semibold pt-1 border-t border-slate-200/60">
                      <div className="flex gap-3">
                        <button type="button" onClick={() => setSelectedStages(stageList.map(f => f.stage_key))} className="text-slate-600 hover:text-slate-900 underline cursor-pointer">Select all</button>
                        <button type="button" onClick={() => setSelectedStages([])} className="text-slate-600 hover:text-slate-900 underline cursor-pointer">Clear</button>
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

        {/* Reactivate-inactive-duplicate prompt */}
        {reactivatePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setReactivatePrompt(null)}>
            <div className="bg-white rounded-2xl border-2 border-amber-400 shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2 flex items-center gap-2">
                <RotateCcw size={18} className="text-amber-500" /> Inactive Employee Found
              </h3>
              <p className="text-xs text-slate-600 mb-4">
                An inactive employee named <strong>{reactivatePrompt.name}</strong>
                {reactivatePrompt.phone ? <> (phone {reactivatePrompt.phone})</> : null} already
                exists. Reactivate it instead of creating a new record?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setReactivatePrompt(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmReactivateFromPrompt} className="btn-gold px-4 py-2 text-xs font-semibold cursor-pointer">Reactivate</button>
              </div>
            </div>
          </div>
        )}



      </div>
    </AppLayout>
  );
}
