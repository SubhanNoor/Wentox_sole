import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { SalaryRun, SalaryRunItem } from '@/types';
import { Save, BadgeDollarSign, History, Edit2, Undo2, Trash2, AlertTriangle, RotateCcw } from 'lucide-react';

const thisMonth = () => new Date().toISOString().slice(0, 7);   // 'YYYY-MM'
const today = () => new Date().toISOString().split('T')[0];

// Module scope on purpose: an id generator is impure, and calling Date.now()
// inside the component body is what react-hooks/purity (rightly) objects to.
const newRunId = () => 'sr_' + Date.now();

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

export default function SalaryRunPage() {
  const { state, dispatch } = useApp();

  const [tab, setTab] = useState<'entry' | 'history'>('entry');
  const [tabAnimating, setTabAnimating] = useState(false);

  const switchTab = (next: 'entry' | 'history') => {
    if (next === tab) return;
    setTabAnimating(true);
    setTimeout(() => {
      setTab(next);
      setTabAnimating(false);
    }, 180);
  };
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [periodMonth, setPeriodMonth] = useState(thisMonth());

  // A new run's lines are DERIVED from the current roster, never stored — so
  // adding a salaried employee shows up immediately without an effect syncing
  // state to state. Only what the operator actually typed over is held here.
  const [overrides, setOverrides] = useState<Record<string, { amount?: number; remarks?: string }>>({});

  // An existing run carries its own snapshots, including for people whose
  // salary has since changed, so editing works from the stored items instead.
  const [editingItems, setEditingItems] = useState<SalaryRunItem[] | null>(null);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const salaried = useMemo(
    () => state.employees.filter(e => e.employeeType === 'SALARIED'),
    [state.employees]
  );

  // A month is unambiguous, so a second POSTED run for it is always a mistake —
  // unlike a wage run, where the settlement period is fuzzy and a second run in
  // a day can be legitimate. Hence a real block here and none there.
  const existingPosted = useMemo(
    () => state.salaryRuns.find(r => r.periodMonth === periodMonth && r.status === 'Posted' && r.id !== editingRunId),
    [state.salaryRuns, periodMonth, editingRunId]
  );

  // The month's lines: every active salaried employee, pre-filled with their
  // salary, with anything typed over layered on top.
  const lines: SalaryRunItem[] = useMemo(() => {
    if (editingItems) return editingItems;
    return salaried.map(e => {
      const o = overrides[e.id] || {};
      const salaryAmount = e.monthlySalary || 0;
      return {
        id: 'sri_' + e.id,
        employeeId: e.id,
        salaryAmount,
        amount: o.amount ?? salaryAmount,
        remarks: o.remarks
      };
    });
  }, [editingItems, salaried, overrides]);

  const patch = (employeeId: string, change: { amount?: number; remarks?: string }) => {
    if (editingItems) {
      setEditingItems(prev => (prev || []).map(l => l.employeeId === employeeId ? { ...l, ...change } : l));
    } else {
      setOverrides(prev => ({ ...prev, [employeeId]: { ...prev[employeeId], ...change } }));
    }
  };

  const setAmount = (employeeId: string, amount: number) => patch(employeeId, { amount });
  const setRemarks = (employeeId: string, remarks: string) => patch(employeeId, { remarks: remarks || undefined });

  const resetLine = (employeeId: string) => {
    const line = lines.find(l => l.employeeId === employeeId);
    if (!line) return;
    if (editingItems) {
      setEditingItems(prev => (prev || []).map(l =>
        l.employeeId === employeeId ? { ...l, amount: l.salaryAmount, remarks: undefined } : l));
    } else {
      setOverrides(prev => {
        const next = { ...prev };
        delete next[employeeId];
        return next;
      });
    }
  };

  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const deductions = lines.filter(l => Number(l.amount) !== Number(l.salaryAmount));

  const nameOf = (id: string) => state.employees.find(e => e.id === id)?.name || '—';

  const resetForm = () => {
    setEditingRunId(null);
    setEditingItems(null);
    setOverrides({});
    setPeriodMonth(thisMonth());
  };

  const save = (status: 'Posted' | 'Unposted') => {
    if (lines.length === 0) return fail('There are no salaried employees to pay.');
    if (status === 'Posted' && existingPosted) {
      return fail(`${monthLabel(periodMonth)} already has a posted salary run. Unpost it first, or open it from History.`);
    }
    const bad = lines.find(l => isNaN(Number(l.amount)) || Number(l.amount) < 0);
    if (bad) return fail(`${nameOf(bad.employeeId)} has an invalid amount.`);

    const existing = editingRunId ? state.salaryRuns.find(r => r.id === editingRunId) : undefined;
    const run: SalaryRun = {
      id: editingRunId || newRunId(),
      periodMonth,
      date: existing?.date || today(),
      totalAmount: total,
      status,
      unpostedAt: existing?.unpostedAt,
      amountBefore: existing?.amountBefore,
      items: lines.map(l => ({ ...l, amount: Number(l.amount) }))
    };

    if (editingRunId) {
      dispatch({ type: 'UPDATE_SALARY_RUN', runId: editingRunId, run });
      flash(status === 'Posted' ? 'Salary run updated and posted.' : 'Salary run saved as unposted.');
    } else {
      dispatch({ type: 'ADD_SALARY_RUN', run });
      flash(status === 'Posted'
        ? `${monthLabel(periodMonth)} salaries posted — ${formatCurrency(total)} across ${lines.length} employee(s).`
        : 'Salary run saved as unposted. It counts toward nothing until posted.');
    }
    resetForm();
  };

  const editRun = (run: SalaryRun) => {
    if (run.status === 'Posted') {
      return fail('Unpost this run before editing it — a posted run is counted in every balance it touches.');
    }
    setEditingRunId(run.id);
    setPeriodMonth(run.periodMonth);
    setEditingItems(run.items.map(i => ({ ...i })));
    setOverrides({});
    switchTab('entry');
  };

  const unpost = (run: SalaryRun) => {
    if (!window.confirm(`Unpost ${monthLabel(run.periodMonth)}? ${formatCurrency(run.totalAmount)} will stop counting toward every salaried employee's balance until it is posted again.`)) return;
    dispatch({ type: 'UNPOST_SALARY_RUN', runId: run.id, unpostedAt: new Date().toISOString() });
    flash('Run unposted. The month is free to be posted again.');
  };

  const removeRun = (run: SalaryRun) => {
    if (run.status === 'Posted') {
      return fail('A posted run cannot be deleted — unpost it first, so the change to the balances is deliberate.');
    }
    if (!window.confirm('Delete this unposted run? It counts toward nothing, so nothing will move.')) return;
    dispatch({ type: 'DELETE_SALARY_RUN', runId: run.id });
    flash('Unposted run deleted.');
  };

  const sortedRuns = useMemo(
    () => [...state.salaryRuns].sort((a, b) => b.periodMonth.localeCompare(a.periodMonth)),
    [state.salaryRuns]
  );

  return (
    <AppLayout pageTitle="Salary Run (Monthly)">
      <div className="mx-auto" style={{ maxWidth: 768 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => switchTab('entry')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <BadgeDollarSign size={15} /> {editingRunId ? 'Editing Run' : 'New Salary Run'}
            </button>
            <button
              onClick={() => switchTab('history')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'history' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <History size={15} /> History ({state.salaryRuns.length})
            </button>
          </div>
          {editingRunId && (
            <button onClick={resetForm} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              Cancel edit
            </button>
          )}
        </div>

        {tab === 'entry' ? (
          <div className={`card-white p-8 md:p-10 bg-white border min-h-[480px] transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`} style={{ borderColor: 'var(--border-color)' }}>

            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  Salaries for {monthLabel(periodMonth)}
                </h3>
                <p className="text-xs text-slate-500">
                  Every line pre-fills from the employee's salary — in a normal month, nothing needs typing.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Month</label>
                <input
                  type="month"
                  value={periodMonth}
                  onChange={e => { setPeriodMonth(e.target.value); setOverrides({}); }}
                  disabled={!!editingRunId}
                  className="soleria-input cursor-pointer disabled:opacity-60"
                />
              </div>
            </div>

            {existingPosted && (
              <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <strong>{monthLabel(periodMonth)} has already been posted</strong> —{' '}
                  {formatCurrency(existingPosted.totalAmount)} across {existingPosted.items.length} employee(s).
                  <button
                    onClick={() => { switchTab('history'); }}
                    className="ml-2 underline font-semibold hover:text-amber-900"
                  >
                    Open it in History
                  </button>{' '}
                  to unpost and edit, rather than building a second one.
                </div>
              </div>
            )}

            {lines.length === 0 ? (
              <div className="text-center p-10 text-slate-400 text-sm">
                No salaried employees registered yet. Add one under Employees → Salaried Employees.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                        <th className="p-3 pl-4">Employee</th>
                        <th className="p-3 text-right" style={{ width: 140 }}>Salary</th>
                        <th className="p-3 text-right" style={{ width: 150 }}>Amount to Pay</th>
                        <th className="p-3" style={{ minWidth: 200 }}>Remarks</th>
                        <th className="p-3 text-center" style={{ width: 50 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(l => {
                        const changed = Number(l.amount) !== Number(l.salaryAmount);
                        return (
                          <tr key={l.id} className={`border-b ${changed ? 'bg-amber-50/50' : ''}`} style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-3 pl-4 font-semibold text-slate-900">{nameOf(l.employeeId)}</td>
                            <td className="p-3 text-right text-slate-500 font-mono">{formatCurrency(l.salaryAmount)}</td>
                            <td className="p-2">
                              <input
                                type="number" min={0}
                                value={l.amount}
                                onChange={e => setAmount(l.employeeId, Number(e.target.value))}
                                className={`soleria-input py-1.5 text-right text-sm font-semibold ${changed ? 'border-amber-400 bg-amber-50' : ''}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={l.remarks || ''}
                                onChange={e => setRemarks(l.employeeId, e.target.value)}
                                placeholder={changed ? 'Why is this different?' : ''}
                                className={`soleria-input py-1.5 text-sm ${changed && !l.remarks ? 'border-amber-400' : ''}`}
                              />
                            </td>
                            <td className="p-2 text-center">
                              {changed && (
                                <button
                                  onClick={() => resetLine(l.employeeId)}
                                  title="Reset to full salary"
                                  className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                                >
                                  <RotateCcw size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-bold">
                        <td className="p-3 pl-4 text-slate-700">Total</td>
                        <td className="p-3 text-right text-slate-400 font-mono">
                          {formatCurrency(lines.reduce((s, l) => s + l.salaryAmount, 0))}
                        </td>
                        <td className="p-3 text-right text-lg text-slate-900">{formatCurrency(total)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {deductions.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <div>
                      {deductions.length} line(s) differ from the employee's salary.
                      {deductions.some(d => !d.remarks) && ' Add remarks so the reason survives — the gap between the two figures is the only record that a deduction happened.'}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 justify-end border-t pt-4 mt-6">
                  <button onClick={() => save('Unposted')} className="px-5 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Save as Unposted
                  </button>
                  <button
                    onClick={() => save('Posted')}
                    disabled={!!existingPosted}
                    className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save size={16} /> {editingRunId ? 'Save & Post' : 'Post Salary Run'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          /* History */
          <div className={`card-white p-6 md:p-8 bg-white border transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`} style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="font-lora font-semibold text-lg text-slate-800 mb-1">Salary Runs</h3>
            <p className="text-xs text-slate-500 mb-6">
              One posted run per month. Only posted runs count toward a balance.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Month</th>
                    <th className="p-3">Posted On</th>
                    <th className="p-3 text-center">Employees</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-center" style={{ width: 130 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400">
                        No salary runs yet. Post one to start accruing what staff are owed.
                      </td>
                    </tr>
                  ) : sortedRuns.map(r => (
                    <tr key={r.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-semibold text-slate-900">{monthLabel(r.periodMonth)}</td>
                      <td className="p-3 font-mono text-slate-600">{r.date}</td>
                      <td className="p-3 text-center text-slate-600">{r.items.length}</td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(r.totalAmount)}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.status === 'Posted' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          {r.status}
                        </span>
                        {r.unpostedAt && (
                          <div className="text-[10px] text-slate-400 mt-1">was {formatCurrency(r.amountBefore || 0)}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {r.status === 'Posted' ? (
                            <button onClick={() => unpost(r)} title="Unpost" className="p-1.5 rounded hover:bg-amber-50 text-slate-500 hover:text-amber-700">
                              <Undo2 size={15} />
                            </button>
                          ) : (
                            <button onClick={() => editRun(r)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800">
                              <Edit2 size={15} />
                            </button>
                          )}
                          <button onClick={() => removeRun(r)} title="Delete" className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
