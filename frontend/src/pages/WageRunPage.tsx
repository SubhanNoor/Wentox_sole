import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { EmployeeRow, ProductRow, StageRow, WageRunRow, ExpenseRow } from '@/lib/api';
import { getRunBalanceBlock } from '@/lib/payroll';
import { formatDate } from '@/lib/utils';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Plus, Trash2, Save, HardHat, AlertTriangle, Edit2, Undo2, History, Clock, ChevronDown, Check } from 'lucide-react';

interface FormItem {
  key: string;
  articleId: number | '';
  articleName: string;
  rate: number;
  cartons: number;
  packing: number;
  amount: number;
}

function emptyItem(): FormItem {
  return { key: 'wri_' + Date.now() + Math.random().toString(36).slice(2, 7), articleId: '', articleName: '', rate: 0, cartons: 0, packing: 0, amount: 0 };
}

const today = () => new Date().toISOString().split('T')[0];

export default function WageRunPage() {
  const [workers, setWorkers] = useState<EmployeeRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stageList, setStageList] = useState<StageRow[]>([]);
  const [runs, setRuns] = useState<WageRunRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [recentRuns, setRecentRuns] = useState<{ wage_run_id: number; run_date: string; total_amount: number; status: 'DRAFT' | 'CONFIRMED' }[]>([]);
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
  const [date, setDate] = useState(today());
  const [employeeId, setEmployeeId] = useState('');
  const [stage, setStage] = useState('');
  const [items, setItems] = useState<FormItem[]>([emptyItem()]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [isStageOpen, setIsStageOpen] = useState(false);
  const [stagePos, setStagePos] = useState<{ top: number; left: number; width: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stagePanelRef = useRef<HTMLDivElement>(null);

  // The panel is portaled onto document.body (see SearchableSelect for why:
  // .card-white sets overflow:hidden, which clips an absolutely-positioned
  // dropdown instead of letting it float over the page).
  const openStageDropdown = () => {
    const el = stageRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setStagePos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setIsStageOpen(v => !v);
  };

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (stageRef.current?.contains(target)) return;
      if (stagePanelRef.current?.contains(target)) return;
      setIsStageOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [empRes, prodRes, stageRes, runRes, exRes] = await Promise.all([
      api.employees.list({ employee_type: 'WORKER' }),
      api.listProducts(),
      api.stages.list(),
      api.wageRuns.list(),
      api.expenses.list({ status: 'CONFIRMED' }),
    ]);
    if (empRes.ok) setWorkers(empRes.data);
    if (prodRes.ok) setProducts(prodRes.data);
    if (stageRes.ok) setStageList(stageRes.data);
    if (runRes.ok) setRuns(runRes.data);
    if (exRes.ok) setExpenses(exRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const workerOptions = useMemo(
    () => workers.map(w => ({ value: String(w.employee_id), label: w.name })),
    [workers]
  );

  const selectedWorker = useMemo(
    () => workers.find(w => String(w.employee_id) === employeeId),
    [workers, employeeId]
  );

  // The stage list shows ONLY this worker's trades. A man registered for
  // Bottom cannot be paid for Cutting by accident.
  const availableStages = useMemo(() => {
    if (!selectedWorker?.stage_keys) return [];
    const own = selectedWorker.stage_keys.split(',');
    return own.map(key => {
      const s = stageList.find(f => f.stage_key === key);
      return { key, label: s ? s.worker_label : key };
    });
  }, [selectedWorker, stageList]);

  const stageObj = useMemo(() => stageList.find(s => s.stage_key === stage), [stageList, stage]);

  const productOptions = useMemo(
    () => products.map(p => ({ value: String(p.article_id), label: `${p.code} — ${p.name}` })),
    [products]
  );

  /* ── line editing ─────────────────────────────────────────── */

  const recalc = (it: FormItem): FormItem => ({
    ...it,
    amount: Number(it.rate) * Number(it.cartons) * Number(it.packing)
  });

  const pickProduct = (itemKey: string, articleIdStr: string) => {
    const p = products.find(pr => String(pr.article_id) === articleIdStr);
    if (!p || !stageObj) return;
    setItems(prev => prev.map(it => it.key !== itemKey ? it : recalc({
      ...it,
      articleId: p.article_id,
      articleName: p.name,
      // SNAPSHOTS, both of them. Editing the product later must not rewrite a
      // wage already paid — and without packing stored, nobody could tell
      // afterwards whether this article packed 12 or 24.
      rate: (p as unknown as Record<string, number>)[stageObj.cost_column],
      packing: p.packing
    })));
  };

  const updateItem = (itemKey: string, field: 'cartons' | 'rate', value: number) => {
    setItems(prev => prev.map(it => it.key !== itemKey ? it : recalc({ ...it, [field]: value })));
  };

  const addRow = () => setItems(prev => [...prev, emptyItem()]);
  const removeRow = (key: string) =>
    setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter(it => it.key !== key));

  /* ── derived figures ──────────────────────────────────────── */

  const filledItems = items.filter(it => it.articleId !== '' && Number(it.cartons) > 0);
  const grandTotal = filledItems.reduce((s, it) => s + it.amount, 0);

  const block = employeeId && selectedWorker
    ? getRunBalanceBlock(selectedWorker, date, grandTotal, runs, expenses, editingRunId ?? undefined)
    : { baqaya: 0, banam: 0, net: 0 };

  // Settling by PERIOD rather than by day makes a same-date duplicate check
  // close to worthless — the real risk is paying the same fortnight twice, a
  // week apart, which a date-equality warning never catches. Showing the last
  // few runs instead lets the operator see it.
  useEffect(() => {
    if (!employeeId || !stage) { setRecentRuns([]); return; }
    let cancelled = false;
    api.wageRuns.recent(Number(employeeId), stage).then(res => {
      if (cancelled) return;
      setRecentRuns(res.ok ? res.data.filter(r => r.wage_run_id !== editingRunId) : []);
    });
    return () => { cancelled = true; };
  }, [employeeId, stage, editingRunId]);

  const zeroRateRows = filledItems.filter(it => Number(it.rate) === 0);

  /* ── save / post ──────────────────────────────────────────── */

  const resetForm = () => {
    setEditingRunId(null);
    setDate(today());
    setEmployeeId('');
    setStage('');
    setItems([emptyItem()]);
  };

  const save = async (shouldPost: boolean) => {
    if (!employeeId) return fail('Pick a worker first.');
    if (!stage) return fail('Pick which stage this settlement is for.');
    if (filledItems.length === 0) return fail('Add at least one article line with a quantity.');

    const payload: api.WageRunCreateInput = {
      employee_id: Number(employeeId),
      stage_key: stage,
      run_date: date,
      items: filledItems.map(it => ({ article_id: it.articleId as number, cartons: it.cartons, rate: it.rate })),
    };

    const res = editingRunId
      ? await api.wageRuns.update(editingRunId, payload)
      : await api.wageRuns.create(payload);
    if (!res.ok) return fail(res.error.message);

    if (shouldPost) {
      const postRes = await api.wageRuns.post(res.data.wage_run_id);
      if (!postRes.ok) return fail(postRes.error.message);
      flash(`Wage run posted — ${formatCurrency(postRes.data.total_amount)} credited to ${selectedWorker?.name}.`);
    } else {
      flash('Wage run saved as unposted. It counts toward nothing until posted.');
    }
    resetForm();
    loadAll();
  };

  /* ── history actions ──────────────────────────────────────── */

  const editRun = async (run: WageRunRow) => {
    // A Posted run is never edited in place — unpost first. That keeps
    // "posted" meaning one thing: counted, and not currently being changed.
    if (run.status === 'CONFIRMED') {
      return fail('Unpost this run before editing it — a posted run is counted in the worker\'s balance.');
    }
    // list() rows have no items — fetch the full row before opening the form.
    const res = await api.wageRuns.get(run.wage_run_id);
    if (!res.ok) return fail(res.error.message);
    const full = res.data;
    setEditingRunId(full.wage_run_id);
    setDate(full.run_date);
    setEmployeeId(String(full.employee_id));
    setStage(full.stage_key);
    setItems(full.items && full.items.length
      ? full.items.map(i => ({ key: 'wri_' + i.item_id, articleId: i.article_id, articleName: i.article_name || '', rate: i.rate, cartons: i.cartons, packing: i.packing, amount: i.amount }))
      : [emptyItem()]);
    setTab('entry');
  };

  const unpost = async (run: WageRunRow) => {
    if (!window.confirm(`Unpost this run? ${formatCurrency(run.total_amount)} will stop counting toward ${nameOf(run.employee_id)}'s balance until it is posted again.`)) return;
    const res = await api.wageRuns.unpost(run.wage_run_id);
    if (!res.ok) return fail(res.error.message);
    flash('Run unposted. It now counts toward nothing and can be edited.');
    loadAll();
  };



  function nameOf(id: number) {
    return workers.find(e => e.employee_id === id)?.name || '—';
  }
  const stageLabel = (k: string) => stageList.find(f => f.stage_key === k)?.worker_label || k;

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.run_date.localeCompare(a.run_date)),
    [runs]
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
              onClick={() => switchTab('entry')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <HardHat size={15} /> {editingRunId ? 'Editing Run' : 'New Wage Run'}
            </button>
            <button
              onClick={() => switchTab('history')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'history' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <History size={15} /> History ({runs.length})
            </button>
          </div>
          {editingRunId && (
            <button onClick={resetForm} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              Cancel edit
            </button>
          )}
        </div>

        {tab === 'entry' ? (
          <div className={`flex flex-col gap-5 transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>

            {/* Header */}
            <div className="card-white p-6 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Settlement Date</label>
                  <input type="date"
            value={date} onChange={e => setDate(e.target.value)} className="soleria-input" />
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
                  ) : (() => {
                    const selLabel = availableStages.find(f => f.key === stage)?.label || 'Select stage...';
                    return (
                      <div className="relative" ref={stageRef}>
                        <button
                          type="button"
                          onClick={openStageDropdown}
                          className="flex items-center justify-between w-full pl-3.5 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-700 transition-all cursor-pointer shadow-2xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30"
                        >
                          <span className={`truncate font-semibold ${stage ? 'text-slate-800' : 'text-slate-400'}`}>{selLabel}</span>
                          <ChevronDown className={`ml-2 flex-shrink-0 text-slate-400 transition-transform duration-200 ${isStageOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} size={16} />
                        </button>
                        {isStageOpen && stagePos && createPortal(
                          <div
                            ref={stagePanelRef}
                            style={{ position: 'fixed', top: stagePos.top, left: stagePos.left, width: stagePos.width, zIndex: 9999, boxShadow: '0 14px 34px rgba(27,42,65,0.14)' }}
                            className="py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl"
                          >
                            <button type="button" onClick={() => { setStage(''); setItems([emptyItem()]); setIsStageOpen(false); }}
                              className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${!stage ? 'bg-[var(--brand-gold)] text-white font-semibold' : 'text-slate-600 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'}`}>
                              <span>Select stage...</span>
                              {!stage && <Check size={13} className="text-white" />}
                            </button>
                            <div className="my-1 border-t border-slate-100" />
                            {availableStages.map(f => {
                              const isSelected = stage === f.key;
                              return (
                                <button key={f.key} type="button"
                                  onClick={() => { setStage(f.key); setItems([emptyItem()]); setIsStageOpen(false); }}
                                  className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${isSelected ? 'bg-[var(--brand-gold)] text-white font-semibold' : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'}`}>
                                  <span>{f.label}</span>
                                  {isSelected && <Check size={13} className="text-white flex-shrink-0" />}
                                </button>
                              );
                            })}
                          </div>,
                          document.body
                        )}
                      </div>
                    );
                  })()}
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
                    <Clock size={13} /> Recent {stage ? stageLabel(stage) : ''} runs for {nameOf(Number(employeeId))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentRuns.map(r => (
                      <span key={r.wage_run_id} className="px-2 py-1 rounded bg-white border border-amber-200 text-xs font-semibold text-slate-700">
                        {formatDate(r.run_date)} — {formatCurrency(r.total_amount)}
                        {r.status === 'DRAFT' && <span className="ml-1 text-slate-400 font-medium">(unposted)</span>}
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
                        const zero = it.articleId !== '' && Number(it.rate) === 0;
                        return (
                          <tr key={it.key} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-2 pl-4">
                              <SearchableSelect
                                options={productOptions}
                                value={it.articleId === '' ? '' : String(it.articleId)}
                                onChange={val => pickProduct(it.key, val)}
                                placeholder="Select article..."
                              />
                              {zero && (
                                <div className="flex items-start gap-1.5 mt-1.5 text-[11px] text-amber-700">
                                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                  <span>
                                    This article has no cost set for {stageLabel(stage)}.
                                    Type a rate, or fix it on the product form.
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="p-2">
                              <input
                                type="number" min={0}
                                value={it.rate || ''}
                                onChange={e => updateItem(it.key, 'rate', Number(e.target.value))}
                                disabled={it.articleId === ''}
                                className={`soleria-input py-1.5 text-right text-sm ${zero ? 'border-amber-400 bg-amber-50' : ''}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number" min={0}
                                value={it.cartons || ''}
                                onChange={e => updateItem(it.key, 'cartons', Number(e.target.value))}
                                disabled={it.articleId === ''}
                                className="soleria-input py-1.5 text-right text-sm font-semibold"
                              />
                            </td>
                            <td className="p-2 text-right text-slate-500 font-mono text-sm">
                              {it.articleId !== '' ? it.packing : '—'}
                            </td>
                            <td className="p-2 text-right font-bold text-slate-800">
                              {it.amount ? formatCurrency(it.amount) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="p-2 text-center">
                              <button onClick={() => removeRow(it.key)} className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600" title="Remove line">
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
                  <Figure label="Baqaya" value={block.baqaya} hint={`Owed before ${formatDate(date)}`} />
                  <Figure label="Banam" value={block.banam} hint={`Paid on/after ${formatDate(date)}`} />
                  <Figure label="Net Balance" value={block.net} hint="Still owed after this run" strong highlight />
                </div>
                {block.net < 0 && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Net balance is negative — {nameOf(Number(employeeId))} has been paid more than they have
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
                  <button onClick={() => save(false)} className="px-5 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Save as Unposted
                  </button>
                  <button onClick={() => save(true)} className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                    <Save size={16} /> {editingRunId ? 'Save & Post' : 'Post Wage Run'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* History */
          <div className={`card-white p-6 md:p-8 bg-white border transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`} style={{ borderColor: 'var(--border-color)' }}>
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
                  {loading ? (
                    <tr><td colSpan={7} className="text-center p-8 text-slate-400">Loading…</td></tr>
                  ) : sortedRuns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-slate-400">
                        No wage runs yet. Post one to start accruing what workers are owed.
                      </td>
                    </tr>
                  ) : sortedRuns.map(r => (
                    <tr key={r.wage_run_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(r.run_date)}</td>
                      <td className="p-3 font-semibold text-slate-900">{r.employee_name || nameOf(r.employee_id)}</td>
                      <td className="p-3 text-slate-600">{r.stage_label || stageLabel(r.stage_key)}</td>
                      <td className="p-3 text-center text-slate-600">{r.item_count ?? '—'}</td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(r.total_amount)}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          {r.status === 'CONFIRMED' ? 'Posted' : 'Unposted'}
                        </span>
                        {r.unposted_at && (
                          <div className="text-[10px] text-slate-400 mt-1">
                            was {formatCurrency(r.amount_before || 0)}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
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
