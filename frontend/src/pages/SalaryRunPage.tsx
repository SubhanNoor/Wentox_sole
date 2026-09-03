import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { EmployeeRow, SalaryRunRow } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import AppLayout from '@/components/AppLayout';
import { Save, BadgeDollarSign, History, Edit2, Undo2, AlertTriangle, RotateCcw, X } from 'lucide-react';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';

interface FormLine {
  employee_id: number;
  employee_name: string;
  salary_amount: number;
  amount: number;
  remarks?: string;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);   // 'YYYY-MM'

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

export default function SalaryRunPage() {
  const [salariedEmployees, setSalariedEmployees] = useState<EmployeeRow[]>([]);
  const [runs, setRuns] = useState<SalaryRunRow[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [editingRunId, setEditingRunId] = useState<number | null>(null);
  // A New Salary Run's own in-progress fields persist across switching pages AND an app restart
  // (usePersistentField — see src/hooks/usePersistentField.ts). Deliberately NOT applied to
  // editingRunId — an already-saved run loaded for edit is safely re-openable by id at any time,
  // so caching it risks showing a stale copy instead; only unsaved "new" work is ever at risk of
  // being lost for good.
  const clearSalaryRunDraft = useClearPageDraft('salary-run');
  const [periodMonth, setPeriodMonth] = usePersistentField('salary-run', 'periodMonth', thisMonth());

  // A new run's lines are DERIVED from the current roster, never stored — so
  // adding a salaried employee shows up immediately without an effect syncing
  // state to state. Only what the operator actually typed over is held here.
  const [overrides, setOverrides] = usePersistentField<Record<number, { amount?: number; remarks?: string }>>('salary-run', 'overrides', {});

  // An existing run carries its own snapshots, including for people whose
  // salary has since changed, so editing works from the stored items instead.
  const [editingItems, setEditingItems] = usePersistentField<FormLine[] | null>('salary-run', 'editingItems', null);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [empRes, runRes] = await Promise.all([
      api.employees.list({ employee_type: 'SALARIED' }),
      api.salaryRuns.list(),
    ]);
    if (empRes.ok) setSalariedEmployees(empRes.data);
    if (runRes.ok) setRuns(runRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // A month is unambiguous, so a second POSTED run for it is always a mistake —
  // unlike a wage run, where the settlement period is fuzzy and a second run in
  // a day can be legitimate. Hence a real block here and none there. This is a
  // client-side preview only — the backend re-checks MONTH_ALREADY_CONFIRMED on
  // create()/post() regardless, so a race is still caught server-side.
  const existingPosted = useMemo(
    () => runs.find(r => r.period_month === periodMonth && r.status === 'CONFIRMED' && r.salary_run_id !== editingRunId),
    [runs, periodMonth, editingRunId]
  );

  // The month's lines: every active salaried employee, pre-filled with their
  // salary, with anything typed over layered on top.
  const lines: FormLine[] = useMemo(() => {
    if (editingItems) return editingItems;
    return salariedEmployees.map(e => {
      const o = overrides[e.employee_id] || {};
      const salaryAmount = e.monthly_salary || 0;
      return {
        employee_id: e.employee_id,
        employee_name: e.name,
        salary_amount: salaryAmount,
        amount: o.amount ?? salaryAmount,
        remarks: o.remarks
      };
    });
  }, [editingItems, salariedEmployees, overrides]);

  const patch = (employeeId: number, change: { amount?: number; remarks?: string }) => {
    if (editingItems) {
      setEditingItems(prev => (prev || []).map(l => l.employee_id === employeeId ? { ...l, ...change } : l));
    } else {
      setOverrides(prev => ({ ...prev, [employeeId]: { ...prev[employeeId], ...change } }));
    }
  };

  const setAmount = (employeeId: number, amount: number) => patch(employeeId, { amount });
  const setRemarks = (employeeId: number, remarks: string) => patch(employeeId, { remarks: remarks || undefined });

  const resetLine = (employeeId: number) => {
    const line = lines.find(l => l.employee_id === employeeId);
    if (!line) return;
    if (editingItems) {
      setEditingItems(prev => (prev || []).map(l =>
        l.employee_id === employeeId ? { ...l, amount: l.salary_amount, remarks: undefined } : l));
    } else {
      setOverrides(prev => {
        const next = { ...prev };
        delete next[employeeId];
        return next;
      });
    }
  };

  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const deductions = lines.filter(l => Number(l.amount) !== Number(l.salary_amount));

  const resetForm = () => {
    setEditingRunId(null);
    setEditingItems(null);
    setOverrides({});
    setPeriodMonth(thisMonth());
    clearSalaryRunDraft();
  };

  const save = async (shouldPost: boolean) => {
    if (lines.length === 0) return fail('There are no salaried employees to pay.');
    if (shouldPost && existingPosted) {
      return fail(`${monthLabel(periodMonth)} already has a posted salary run. Unpost it first, or open it from History.`);
    }
    const bad = lines.find(l => isNaN(Number(l.amount)) || Number(l.amount) < 0);
    if (bad) return fail(`${bad.employee_name} has an invalid amount.`);

    const overridesPayload = lines
      .filter(l => Number(l.amount) !== Number(l.salary_amount) || l.remarks)
      .map(l => ({ employee_id: l.employee_id, amount: Number(l.amount), remarks: l.remarks || undefined }));

    const payload: api.SalaryRunCreateInput = {
      period_month: periodMonth,
      overrides: overridesPayload,
    };

    const res = editingRunId
      ? await api.salaryRuns.update(editingRunId, payload)
      : await api.salaryRuns.create(payload);
    if (!res.ok) return fail(res.error.message);

    if (shouldPost) {
      const postRes = await api.salaryRuns.post(res.data.salary_run_id);
      if (!postRes.ok) return fail(postRes.error.message);
      flash(`${monthLabel(periodMonth)} salaries posted — ${formatCurrency(total)} across ${lines.length} employee(s).`);
    } else {
      flash('Salary run saved as unposted. It counts toward nothing until posted.');
    }
    resetForm();
    loadAll();
  };

  const editRun = async (run: SalaryRunRow) => {
    if (run.status === 'CONFIRMED') {
      return fail('Unpost this run before editing it — a posted run is counted in every balance it touches.');
    }
    // list() rows have no items — fetch the full row before opening the form.
    const res = await api.salaryRuns.get(run.salary_run_id);
    if (!res.ok) return fail(res.error.message);
    const full = res.data;
    setEditingRunId(full.salary_run_id);
    setPeriodMonth(full.period_month);
    setEditingItems((full.items || []).map(i => ({
      employee_id: i.employee_id,
      employee_name: i.employee_name || '—',
      salary_amount: i.salary_amount,
      amount: i.amount,
      remarks: i.remarks || undefined,
    })));
    setOverrides({});
    switchTab('entry');
  };

  const unpost = async (run: SalaryRunRow) => {
    if (!window.confirm(`Unpost ${monthLabel(run.period_month)}? ${formatCurrency(run.total_amount)} will stop counting toward every salaried employee's balance until it is posted again.`)) return;
    const res = await api.salaryRuns.unpost(run.salary_run_id);
    if (!res.ok) return fail(res.error.message);
    flash('Run unposted. The month is free to be posted again.');
    loadAll();
  };

  // A History row only ever carried the month's summary (list() never returns items) — clicking
  // it now fetches the one detail call (get()) that already existed for editRun, but renders it
  // read-only instead of loading it into the editable entry form. Works for CONFIRMED rows too,
  // unlike editRun, which refuses to touch a posted run.
  const [viewingRun, setViewingRun] = useState<SalaryRunRow | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const viewRun = async (run: SalaryRunRow) => {
    setViewLoading(true);
    const res = await api.salaryRuns.get(run.salary_run_id);
    setViewLoading(false);
    if (!res.ok) return fail(res.error.message);
    setViewingRun(res.data);
  };



  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.period_month.localeCompare(a.period_month)),
    [runs]
  );

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Receipts/Expenses/Cheque/Reports.
  const tabBar = (
    <div className="flex items-center gap-2" data-no-print>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
        <button
          onClick={() => switchTab('entry')}
          className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1.5 ${tab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          <BadgeDollarSign size={14} /> {editingRunId ? 'Editing Run' : 'New Salary Run'}
        </button>
        <button
          onClick={() => switchTab('history')}
          className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1.5 ${tab === 'history' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          <History size={14} /> History ({runs.length})
        </button>
      </div>
      {editingRunId && (
        <button onClick={resetForm} className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          Cancel edit
        </button>
      )}
    </div>
  );

  return (
    <AppLayout pageTitle="Salary Run (Monthly)" headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {tab === 'entry' ? (
          <>
            {/* Toolbar — Save/Post live in one dedicated bar above the card, same shape as the
                Receipts/Expenses/Sale Bill toolbars, instead of at the bottom of a long form. */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-4 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }}>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={!!existingPosted || lines.length === 0}
                  className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save size={16} /> {editingRunId ? 'Save & Post' : 'Post Salary Run'}
                </button>
                <button
                  type="button"
                  onClick={() => save(false)}
                  disabled={lines.length === 0}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save as Unposted
                </button>
              </div>
              <span className="text-sm font-semibold text-slate-700">
                {monthLabel(periodMonth)}{lines.length > 0 && <span className="text-slate-400 font-normal"> · {formatCurrency(total)}</span>}
              </span>
            </div>

            <div
              className={`card-white p-8 md:p-10 bg-white border min-h-[480px] transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}
              style={{ borderColor: 'var(--border-color)' }}
            >

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
                  {formatCurrency(existingPosted.total_amount)} across {existingPosted.item_count ?? '—'} employee(s).
                  <button
                    type="button"
                    onClick={() => { switchTab('history'); }}
                    className="ml-2 underline font-semibold hover:text-amber-900"
                  >
                    Open it in History
                  </button>{' '}
                  to unpost and edit, rather than building a second one.
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-center p-10 text-slate-400 text-sm">Loading…</div>
            ) : lines.length === 0 ? (
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
                        const changed = Number(l.amount) !== Number(l.salary_amount);
                        return (
                          <tr key={l.employee_id} className={`border-b ${changed ? 'bg-amber-50/50' : ''}`} style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-3 pl-4 font-semibold text-slate-900">{l.employee_name}</td>
                            <td className="p-3 text-right text-slate-500 font-mono">{formatCurrency(l.salary_amount)}</td>
                            <td className="p-2">
                              <input
                                type="number" min={0}
                                value={l.amount}
                                onChange={e => setAmount(l.employee_id, Number(e.target.value))}
                                className={`soleria-input py-1.5 text-right text-sm font-semibold ${changed ? 'border-amber-400 bg-amber-50' : ''}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={l.remarks || ''}
                                onChange={e => setRemarks(l.employee_id, e.target.value)}
                                placeholder={changed ? 'Why is this different?' : ''}
                                className={`soleria-input py-1.5 text-sm ${changed && !l.remarks ? 'border-amber-400' : ''}`}
                              />
                            </td>
                            <td className="p-2 text-center">
                              {changed && (
                                <button
                                  type="button"
                                  onClick={() => resetLine(l.employee_id)}
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
                          {formatCurrency(lines.reduce((s, l) => s + l.salary_amount, 0))}
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
              </>
            )}
            </div>
          </>
        ) : (
          /* History */
          <div className={`card-white p-6 md:p-8 bg-white border transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`} style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-lora font-semibold text-lg text-slate-800">Salary Runs</h3>
              {viewLoading && <span className="text-xs text-slate-400">Loading month detail…</span>}
            </div>
            <p className="text-xs text-slate-500 mb-6">
              One posted run per month. Only posted runs count toward a balance — click a row to see who was paid.
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
                  {loading ? (
                    <tr><td colSpan={6} className="text-center p-8 text-slate-400">Loading…</td></tr>
                  ) : sortedRuns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400">
                        No salary runs yet. Post one to start accruing what staff are owed.
                      </td>
                    </tr>
                  ) : sortedRuns.map(r => (
                    <tr
                      key={r.salary_run_id}
                      onClick={() => viewRun(r)}
                      className="border-b hover:bg-slate-50/50 cursor-pointer"
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      <td className="p-3 pl-4 font-semibold text-slate-900">{monthLabel(r.period_month)}</td>
                      <td className="p-3 font-mono text-slate-600">{formatDate(r.run_date)}</td>
                      <td className="p-3 text-center text-slate-600">{r.item_count ?? '—'}</td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(r.total_amount)}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          {r.status === 'CONFIRMED' ? 'Posted' : 'Unposted'}
                        </span>
                        {r.unposted_at && (
                          <div className="text-[10px] text-slate-400 mt-1">was {formatCurrency(r.amount_before || 0)}</div>
                        )}
                      </td>
                      <td className="p-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {r.status === 'CONFIRMED' ? (
                            <button onClick={() => unpost(r)} title="Unpost" className="p-1.5 rounded hover:bg-amber-50 text-slate-500 hover:text-amber-700">
                              <Undo2 size={15} />
                            </button>
                          ) : (
                            <button onClick={() => editRun(r)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800">
                              <Edit2 size={15} />
                            </button>
                          )}
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

      {/* Read-only per-employee breakdown for the History row just clicked — works for CONFIRMED
          rows too (editRun refuses those), since viewing doesn't touch the record. */}
      {viewingRun && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-2xl mx-4 animate-scaleUp max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-800">{monthLabel(viewingRun.period_month)}</h3>
                <p className="text-xs text-slate-500">
                  Posted on {formatDate(viewingRun.run_date)} ·{' '}
                  <span className={`font-bold ${viewingRun.status === 'CONFIRMED' ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {viewingRun.status === 'CONFIRMED' ? 'Posted' : 'Unposted'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingRun(null)}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-x-auto mt-4 max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500 sticky top-0" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Employee</th>
                    <th className="p-3 text-right">Salary</th>
                    <th className="p-3 text-right">Amount Paid</th>
                    <th className="p-3">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewingRun.items || []).length === 0 ? (
                    <tr><td colSpan={4} className="text-center p-6 text-slate-400">No line items on this run.</td></tr>
                  ) : (viewingRun.items || []).map(i => {
                    const changed = Number(i.amount) !== Number(i.salary_amount);
                    return (
                      <tr key={i.item_id} className={`border-b ${changed ? 'bg-amber-50/50' : ''}`} style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-semibold text-slate-900">{i.employee_name || '—'}</td>
                        <td className="p-3 text-right text-slate-500 font-mono">{formatCurrency(i.salary_amount)}</td>
                        <td className="p-3 text-right font-semibold text-slate-800 font-mono">{formatCurrency(i.amount)}</td>
                        <td className="p-3 text-slate-600">{i.remarks || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t-2" style={{ borderColor: 'var(--border-color)' }}>
                    <td className="p-3 pl-4 text-slate-700">Total ({(viewingRun.items || []).length} employee(s))</td>
                    <td className="p-3" />
                    <td className="p-3 text-right text-slate-900">{formatCurrency(viewingRun.total_amount)}</td>
                    <td className="p-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
