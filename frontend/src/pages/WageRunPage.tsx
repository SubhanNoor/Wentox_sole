import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { getRunBalanceBlock } from '@/lib/payroll';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { COST_FIELDS } from '@/types';
import type { WageRun, WageRunItem, CostFieldKey } from '@/types';
import { Plus, Trash2, Save, HardHat, AlertTriangle, Edit2, Undo2, History, Clock } from 'lucide-react';

function emptyItem(): WageRunItem {
  return {
    id: 'wri_' + Date.now() + Math.random().toString(36).slice(2, 7),
    productId: '',
    productName: '',
    rate: 0,
    cartons: 0,
    packing: 0,
    amount: 0
  };
}

const today = () => new Date().toISOString().split('T')[0];

export default function WageRunPage() {
  const { state, dispatch } = useApp();

  const [tab, setTab] = useState<'entry' | 'history'>('entry');

  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [employeeId, setEmployeeId] = useState('');
  const [stage, setStage] = useState<CostFieldKey | ''>('');
  const [items, setItems] = useState<WageRunItem[]>([emptyItem()]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const workers = useMemo(
    () => state.employees.filter(e => e.employeeType === 'WORKER'),
    [state.employees]
  );

  const workerOptions = useMemo(
    () => workers.map(w => ({ value: w.id, label: w.name })),
    [workers]
  );

  const selectedWorker = useMemo(
    () => workers.find(w => w.id === employeeId),
    [workers, employeeId]
  );

  // The stage list shows ONLY this worker's trades. A man registered for
  // Bottom cannot be paid for Cutting by accident.
  const availableStages = useMemo(() => {
    if (!selectedWorker) return [];
    const own = selectedWorker.stages || [];
    return COST_FIELDS.filter(f => own.includes(f.key));
  }, [selectedWorker]);

  const productOptions = useMemo(
    () => state.products.map(p => ({ value: p.id, label: `${p.id} — ${p.name}` })),
    [state.products]
  );

  /* ── line editing ─────────────────────────────────────────── */

  const recalc = (it: WageRunItem): WageRunItem => ({
    ...it,
    amount: Number(it.rate) * Number(it.cartons) * Number(it.packing)
  });

  const pickProduct = (itemId: string, productId: string) => {
    const p = state.products.find(pr => pr.id === productId);
    if (!p || !stage) return;
    setItems(prev => prev.map(it => it.id !== itemId ? it : recalc({
      ...it,
      productId: p.id,
      productName: p.name,
      // SNAPSHOTS, both of them. Editing the product later must not rewrite a
      // wage already paid — and without packing stored, nobody could tell
      // afterwards whether this article packed 12 or 24.
      rate: p[stage as CostFieldKey],
      packing: p.packing
    })));
  };

  const updateItem = (itemId: string, field: 'cartons' | 'rate', value: number) => {
    setItems(prev => prev.map(it => it.id !== itemId ? it : recalc({ ...it, [field]: value })));
  };

  const addRow = () => setItems(prev => [...prev, emptyItem()]);
  const removeRow = (id: string) =>
    setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter(it => it.id !== id));

  /* ── derived figures ──────────────────────────────────────── */

  const filledItems = items.filter(it => it.productId && Number(it.cartons) > 0);
  const grandTotal = filledItems.reduce((s, it) => s + it.amount, 0);

  // Computed straight through rather than memoized: it is a handful of reduces
  // over in-memory arrays, and memoizing on `grandTotal` (itself derived from
  // `items` each render) is what the React Compiler flags as unpreservable.
  const block = employeeId
    ? getRunBalanceBlock(state, employeeId, date, grandTotal, editingRunId || undefined)
    : { baqaya: 0, banam: 0, net: 0 };

  // Settling by PERIOD rather than by day makes a same-date duplicate check
  // close to worthless — the real risk is paying the same fortnight twice, a
  // week apart, which a date-equality warning never catches. Showing the last
  // few runs instead lets the operator see it.
  const recentRuns = useMemo(() => {
    if (!employeeId || !stage) return [];
    return state.wageRuns
      .filter(r => r.employeeId === employeeId && r.stage === stage && r.id !== editingRunId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);
  }, [state.wageRuns, employeeId, stage, editingRunId]);

  const zeroRateRows = filledItems.filter(it => Number(it.rate) === 0);

  /* ── save / post ──────────────────────────────────────────── */

  const resetForm = () => {
    setEditingRunId(null);
    setDate(today());
    setEmployeeId('');
    setStage('');
    setItems([emptyItem()]);
  };

  const buildRun = (status: 'Posted' | 'Unposted'): WageRun | null => {
    if (!employeeId) { fail('Pick a worker first.'); return null; }
    if (!stage) { fail('Pick which stage this settlement is for.'); return null; }
    if (filledItems.length === 0) { fail('Add at least one article line with a quantity.'); return null; }

    const existing = editingRunId ? state.wageRuns.find(r => r.id === editingRunId) : undefined;
    return {
      id: editingRunId || 'wr_' + Date.now(),
      employeeId,
      stage: stage as CostFieldKey,
      date,
      totalAmount: grandTotal,
      status,
      unpostedAt: existing?.unpostedAt,
      amountBefore: existing?.amountBefore,
      items: filledItems
    };
  };

  const save = (status: 'Posted' | 'Unposted') => {
    const run = buildRun(status);
    if (!run) return;

    if (editingRunId) {
      dispatch({ type: 'UPDATE_WAGE_RUN', runId: editingRunId, run });
      flash(status === 'Posted' ? 'Wage run updated and posted.' : 'Wage run saved as unposted.');
    } else {
      dispatch({ type: 'ADD_WAGE_RUN', run });
      flash(status === 'Posted'
        ? `Wage run posted — ${formatCurrency(run.totalAmount)} credited to ${selectedWorker?.name}.`
        : 'Wage run saved as unposted. It counts toward nothing until posted.');
    }
    resetForm();
  };

  /* ── history actions ──────────────────────────────────────── */

  const editRun = (run: WageRun) => {
    // A Posted run is never edited in place — unpost first. That keeps
    // "posted" meaning one thing: counted, and not currently being changed.
    if (run.status === 'Posted') {
      return fail('Unpost this run before editing it — a posted run is counted in the worker\'s balance.');
    }
    setEditingRunId(run.id);
    setDate(run.date);
    setEmployeeId(run.employeeId);
    setStage(run.stage);
    setItems(run.items.length ? run.items.map(i => ({ ...i })) : [emptyItem()]);
    setTab('entry');
  };

  const unpost = (run: WageRun) => {
    if (!window.confirm(`Unpost this run? ${formatCurrency(run.totalAmount)} will stop counting toward ${nameOf(run.employeeId)}'s balance until it is posted again.`)) return;
    dispatch({ type: 'UNPOST_WAGE_RUN', runId: run.id, unpostedAt: new Date().toISOString() });
    flash('Run unposted. It now counts toward nothing and can be edited.');
  };

  const removeRun = (run: WageRun) => {
    if (run.status === 'Posted') {
      return fail('A posted run cannot be deleted — unpost it first, so the change to the balance is deliberate.');
    }
    if (!window.confirm('Delete this unposted run? It counts toward nothing, so nothing will move.')) return;
    dispatch({ type: 'DELETE_WAGE_RUN', runId: run.id });
    flash('Unposted run deleted.');
  };

  function nameOf(id: string) {
    return state.employees.find(e => e.id === id)?.name || '—';
  }
  const stageLabel = (k: CostFieldKey) => COST_FIELDS.find(f => f.key === k)?.workerLabel || k;

  const sortedRuns = useMemo(
    () => [...state.wageRuns].sort((a, b) => b.date.localeCompare(a.date)),
    [state.wageRuns]
  );

  /* ── render ───────────────────────────────────────────────── */

  return (
    <AppLayout pageTitle="Wage Run (Piece Rate)">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => setTab('entry')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <HardHat size={15} /> {editingRunId ? 'Editing Run' : 'New Wage Run'}
            </button>
            <button
              onClick={() => setTab('history')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'history' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <History size={15} /> History ({state.wageRuns.length})
            </button>
          </div>
          {editingRunId && (
            <button onClick={resetForm} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              Cancel edit
            </button>
          )}
        </div>

        {tab === 'entry' ? (
          <div className="flex flex-col gap-5">

            {/* Header */}
            <div className="card-white p-6 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Settlement Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="soleria-input" />
                  <p className="text-[10px] text-slate-400 mt-1">The day you settle up — not the day the work was done.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Worker <span className="text-red-500 font-bold">*</span>
                  </label>
                  <SearchableSelect
                    options={workerOptions}
                    value={employeeId}
                    onChange={val => { setEmployeeId(val); setStage(''); setItems([emptyItem()]); }}
                    placeholder="Select worker..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Stage <span className="text-red-500 font-bold">*</span>
                  </label>
                  {!selectedWorker ? (
                    <div className="soleria-input text-slate-400 text-sm flex items-center">Pick a worker first</div>
                  ) : availableStages.length === 0 ? (
                    <div className="soleria-input text-rose-600 text-sm flex items-center font-semibold">
                      Set this worker's trades first
                    </div>
                  ) : (
                    <select
                      value={stage}
                      onChange={e => { setStage(e.target.value as CostFieldKey); setItems([emptyItem()]); }}
                      className="soleria-input cursor-pointer"
                    >
                      <option value="">Select stage...</option>
                      {availableStages.map(f => <option key={f.key} value={f.key}>{f.workerLabel}</option>)}
                    </select>
                  )}
                  {selectedWorker && availableStages.length > 0 && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Only {selectedWorker.name.split(' ')[0]}'s registered trades are listed.
                    </p>
                  )}
                </div>
              </div>

              {/* Recent runs — replaces a same-date duplicate warning */}
              {recentRuns.length > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">
                    <Clock size={13} /> Recent {stage ? stageLabel(stage as CostFieldKey) : ''} runs for {nameOf(employeeId)}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentRuns.map(r => (
                      <span key={r.id} className="px-2 py-1 rounded bg-white border border-amber-200 text-xs font-semibold text-slate-700">
                        {r.date} — {formatCurrency(r.totalAmount)}
                        {r.status === 'Unposted' && <span className="ml-1 text-slate-400 font-medium">(unposted)</span>}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-amber-700 mt-2">
                    Check this settlement does not cover work already paid for above.
                  </p>
                </div>
              )}
            </div>

            {/* Lines */}
            <div className="card-white p-6 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">Articles</h3>
                  <p className="text-xs text-slate-500">
                    Quantity is in <strong>cartons</strong>; the rate is <strong>per pair</strong>, so the
                    amount is rate × cartons × packing.
                  </p>
                </div>
                <button
                  onClick={addRow}
                  disabled={!stage}
                  className="btn-gold flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={14} /> Add Line
                </button>
              </div>

              {!stage ? (
                <div className="text-center p-8 text-slate-400 text-sm">
                  Pick a worker and a stage to start adding articles.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                        <th className="p-3 pl-4" style={{ minWidth: 260 }}>Article</th>
                        <th className="p-3 text-right" style={{ width: 110 }}>Rate / pair</th>
                        <th className="p-3 text-right" style={{ width: 100 }}>Cartons</th>
                        <th className="p-3 text-right" style={{ width: 90 }}>Packing</th>
                        <th className="p-3 text-right" style={{ width: 130 }}>Amount</th>
                        <th className="p-3 text-center" style={{ width: 50 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => {
                        const zero = it.productId && Number(it.rate) === 0;
                        return (
                          <tr key={it.id} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-2 pl-4">
                              <SearchableSelect
                                options={productOptions}
                                value={it.productId}
                                onChange={val => pickProduct(it.id, val)}
                                placeholder="Select article..."
                              />
                              {zero && (
                                <div className="flex items-start gap-1.5 mt-1.5 text-[11px] text-amber-700">
                                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                  <span>
                                    This article has no cost set for {stageLabel(stage as CostFieldKey)}.
                                    Type a rate, or fix it on the product form.
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="p-2">
                              <input
                                type="number" min={0}
                                value={it.rate || ''}
                                onChange={e => updateItem(it.id, 'rate', Number(e.target.value))}
                                disabled={!it.productId}
                                className={`soleria-input py-1.5 text-right text-sm ${zero ? 'border-amber-400 bg-amber-50' : ''}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number" min={0}
                                value={it.cartons || ''}
                                onChange={e => updateItem(it.id, 'cartons', Number(e.target.value))}
                                disabled={!it.productId}
                                className="soleria-input py-1.5 text-right text-sm font-semibold"
                              />
                            </td>
                            <td className="p-2 text-right text-slate-500 font-mono text-sm">
                              {it.productId ? it.packing : '—'}
                            </td>
                            <td className="p-2 text-right font-bold text-slate-800">
                              {it.amount ? formatCurrency(it.amount) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="p-2 text-center">
                              <button onClick={() => removeRow(it.id)} className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600" title="Remove line">
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Balance block */}
            {employeeId && (
              <div className="card-white p-6 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <Figure label="Grand Total" value={grandTotal} hint="Earned on this run" strong />
                  <Figure label="Baqaya" value={block.baqaya} hint={`Owed before ${date}`} />
                  <Figure label="Banam" value={block.banam} hint={`Paid on/after ${date}`} />
                  <Figure label="Net Balance" value={block.net} hint="Still owed after this run" strong highlight />
                </div>
                {block.net < 0 && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Net balance is negative — {nameOf(employeeId)} has been paid more than they have
                      earned. That usually means a payment was recorded for work not yet entered here.
                    </span>
                  </div>
                )}
                {zeroRateRows.length > 0 && (
                  <p className="text-[11px] text-amber-700 mt-3">
                    {zeroRateRows.length} line(s) have a rate of 0 and will add nothing to the total.
                  </p>
                )}

                <div className="flex gap-3 justify-end border-t pt-4 mt-4">
                  <button onClick={() => save('Unposted')} className="px-5 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Save as Unposted
                  </button>
                  <button onClick={() => save('Posted')} className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                    <Save size={16} /> {editingRunId ? 'Save & Post' : 'Post Wage Run'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* History */
          <div className="card-white p-6 md:p-8 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="font-lora font-semibold text-lg text-slate-800 mb-1">Wage Runs</h3>
            <p className="text-xs text-slate-500 mb-6">
              Only posted runs count toward a worker's balance. To correct one: unpost, edit, post again.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Worker</th>
                    <th className="p-3">Stage</th>
                    <th className="p-3 text-center">Lines</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-center" style={{ width: 130 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-slate-400">
                        No wage runs yet. Post one to start accruing what workers are owed.
                      </td>
                    </tr>
                  ) : sortedRuns.map(r => (
                    <tr key={r.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono text-slate-600">{r.date}</td>
                      <td className="p-3 font-semibold text-slate-900">{nameOf(r.employeeId)}</td>
                      <td className="p-3 text-slate-600">{stageLabel(r.stage)}</td>
                      <td className="p-3 text-center text-slate-600">{r.items.length}</td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(r.totalAmount)}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.status === 'Posted' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          {r.status}
                        </span>
                        {r.unpostedAt && (
                          <div className="text-[10px] text-slate-400 mt-1">
                            was {formatCurrency(r.amountBefore || 0)}
                          </div>
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

function Figure({ label, value, hint, strong, highlight }: {
  label: string; value: number; hint: string; strong?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? 'bg-[#111c2a] border-[#111c2a]' : 'bg-slate-50 border-slate-200'}`}>
      <div className={`text-[11px] font-bold uppercase tracking-wider ${highlight ? 'text-[#B08D57]' : 'text-slate-500'}`}>{label}</div>
      <div className={`${strong ? 'text-lg' : 'text-base'} font-bold mt-0.5 ${highlight ? 'text-white' : 'text-slate-800'}`}>
        {formatCurrency(value)}
      </div>
      <div className={`text-[10px] mt-0.5 ${highlight ? 'text-slate-400' : 'text-slate-400'}`}>{hint}</div>
    </div>
  );
}
