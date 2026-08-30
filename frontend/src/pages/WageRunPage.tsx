import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { EmployeeRow, ProductRow, StageRow, WageRunRow, ExpenseRow } from '@/lib/api';
import { getRunBalanceBlock } from '@/lib/payroll';
import { formatDate } from '@/lib/utils';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Plus, Trash2, Save, HardHat, AlertTriangle, Edit2, Undo2, History, Clock, ChevronDown, Check, X } from 'lucide-react';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';

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
  // A New Wage Run's own in-progress fields persist across switching pages AND an app restart
  // (usePersistentField — see src/hooks/usePersistentField.ts). Deliberately NOT applied to
  // editingRunId — an already-saved run loaded for edit is safely re-openable by id at any time,
  // so caching it risks showing a stale copy instead; only unsaved "new" work is ever at risk of
  // being lost for good.
  const clearWageRunDraft = useClearPageDraft('wage-run');
  const [date, setDate] = usePersistentField('wage-run', 'date', today());
  const [employeeId, setEmployeeId] = usePersistentField('wage-run', 'employeeId', '');
  const [stage, setStage] = usePersistentField('wage-run', 'stage', '');
  const [items, setItems] = usePersistentField<FormItem[]>('wage-run', 'items', [emptyItem()]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [isStageOpen, setIsStageOpen] = useState(false);
  const [stagePos, setStagePos] = useState<{ top: number; left: number; width: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const workerContainerRef = useRef<HTMLDivElement>(null);
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
    amount: Number(it.rate) * Number(it.cartons)
  });

  // WR-02: Enter moves article -> rate -> cartons -> next line's article, auto-adding a blank
  // line when at the end. Never auto-posts — a stray Enter shouldn't pay someone (confirmed with
  // the client: Post Wage Run stays an explicit button click).
  const articleContainerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rateRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cartonsRefs = useRef<(HTMLInputElement | null)[]>([]);

  function focusArticle(idx: number) {
    articleContainerRefs.current[idx]?.querySelector<HTMLButtonElement>('button[data-field-nav]')?.focus();
  }

  const pickProduct = (itemKey: string, articleIdStr: string) => {
    const p = products.find(pr => String(pr.article_id) === articleIdStr);
    if (!p || !stageObj) return;
    const idx = items.findIndex(i => i.key === itemKey);
    setItems(prev => prev.map(it => it.key !== itemKey ? it : recalc({
      ...it,
      articleId: p.article_id,
      articleName: p.name,
      // SNAPSHOTS, both of them. Editing the product later must not rewrite a
      // wage already paid. rate is per carton; packing is kept for
      // audit/history only (not used in the amount calc, not shown on screen).
      rate: (p as unknown as Record<string, number>)[stageObj.cost_column],
      packing: p.packing
    })));
    if (idx !== -1) requestAnimationFrame(() => rateRefs.current[idx]?.focus());
  };

  const updateItem = (itemKey: string, field: 'cartons' | 'rate', value: number) => {
    setItems(prev => prev.map(it => it.key !== itemKey ? it : recalc({ ...it, [field]: value })));
  };

  function handleRateKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'Enter') { e.preventDefault(); cartonsRefs.current[idx]?.focus(); }
  }

  function handleCartonsKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (idx < items.length - 1) {
      focusArticle(idx + 1);
    } else {
      setItems(prev => [...prev, emptyItem()]);
      requestAnimationFrame(() => focusArticle(idx + 1));
    }
  }

  const addRow = () => setItems(prev => [...prev, emptyItem()]);
  // Last row: reset its fields instead of removing it, keeping the original `key` (rather than
  // emptyItem()'s freshly-generated one) so the row doesn't remount and lose focus.
  const removeRow = (key: string) =>
    setItems(prev => prev.length === 1 ? [{ ...emptyItem(), key: prev[0].key }] : prev.filter(it => it.key !== key));

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
    clearWageRunDraft();
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

  // WR-04: DRAFT-only, matching the backend guard — a posted run must be unposted first, same
  // as edit.
  const deleteRun = async (run: WageRunRow) => {
    if (!window.confirm(`Delete this unposted wage run for ${nameOf(run.employee_id)}? This cannot be undone.`)) return;
    const res = await api.wageRuns.remove(run.wage_run_id);
    if (!res.ok) return fail(res.error.message);
    flash('Wage run deleted.');
    loadAll();
  };



  // A History row only ever carried the run's summary (list() never returns items) — clicking it
  // now fetches the one detail call (get()) that already existed for editRun, but renders it
  // read-only instead of loading it into the editable entry form. Works for CONFIRMED runs too,
  // unlike editRun, which refuses to touch a posted run. Mirrors the identical fix on SalaryRunPage.
  const [viewingRun, setViewingRun] = useState<WageRunRow | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const viewRun = async (run: WageRunRow) => {
    setViewLoading(true);
    const res = await api.wageRuns.get(run.wage_run_id);
    setViewLoading(false);
    if (!res.ok) return fail(res.error.message);
    setViewingRun(res.data);
  };

  function nameOf(id: number) {
    return workers.find(e => e.employee_id === id)?.name || '—';
  }
  const stageLabel = (k: string) => stageList.find(f => f.stage_key === k)?.worker_label || k;

  // WR-05: search (worker/stage name) + date filter on the history tab.
  const [historySearch, setHistorySearch] = useState('');
  const [historyFromDate, setHistoryFromDate] = useState('');
  const [historyToDate, setHistoryToDate] = useState('');

  const sortedRuns = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return [...runs]
      .filter(r => {
        if (historyFromDate && r.run_date < historyFromDate) return false;
        if (historyToDate && r.run_date > historyToDate) return false;
        if (q) {
          const workerName = (r.employee_name || nameOf(r.employee_id)).toLowerCase();
          const stageName = (r.stage_label || stageLabel(r.stage_key)).toLowerCase();
          if (!workerName.includes(q) && !stageName.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.run_date.localeCompare(a.run_date));
  }, [runs, historySearch, historyFromDate, historyToDate, workers, stageList]);

  /* ── render ───────────────────────────────────────────────── */

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Receipts/Expenses/Cheque/Reports/SalaryRun.
  const tabBar = (
    <div className="flex items-center gap-2" data-no-print>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
        <button
          onClick={() => switchTab('entry')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          <HardHat size={14} /> {editingRunId ? 'Editing Run' : 'New Wage Run'}
        </button>
        <button
          onClick={() => switchTab('history')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'history' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
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
    <AppLayout pageTitle="Wage Run (Piece Rate)" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }}>

        {/* Recent runs — pinned outside the card's own left edge, matching PurchasePage/
            SaleBillPage's Pending Posting sidebar exactly (`absolute`, anchored via
            `right: calc(100% + gap)` to this wrapper's left edge, so it can never affect the
            card's width/position). Was previously inline inside the Header card, which pushed
            the header taller and ate horizontal space in a row that only has three fields
            (Date/Worker/Stage) to begin with. Only shown from `2xl` up, same as Purchase/
            SaleBill — below that there usually isn't 280px of free margin for it to land in. */}
        {tab === 'entry' && recentRuns.length > 0 && (
          <aside
            className="hidden 2xl:block absolute top-0 w-64"
            style={{ right: 'calc(100% + 24px)' }}
          >
            <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 uppercase tracking-wide mb-3">
                <Clock size={13} /> Recent {stage ? stageLabel(stage) : ''} runs for {nameOf(Number(employeeId))}
              </div>
              <ul className="space-y-1.5">
                {recentRuns.map(r => (
                  <li key={r.wage_run_id} className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-200 text-xs font-semibold text-slate-700">
                    {formatDate(r.run_date)} — {formatCurrency(r.total_amount)}
                    {r.status === 'DRAFT' && <span className="ml-1 text-slate-400 font-medium">(unposted)</span>}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-700 mt-3">
                Check this settlement does not cover work already paid for above.
              </p>
            </div>
          </aside>
        )}

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {tab === 'entry' ? (
          <>
            {/* Toolbar — Save/Post live in one dedicated bar above the cards, same shape as the
                Receipts/Expenses/Sale Bill toolbars, instead of at the bottom of a long form. */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-4 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }}>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={!employeeId}
                  className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save size={16} /> {editingRunId ? 'Save & Post' : 'Post Wage Run'}
                </button>
                <button
                  type="button"
                  onClick={() => save(false)}
                  disabled={!employeeId}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save as Unposted
                </button>
              </div>
              {employeeId && (
                <span className="text-sm font-semibold text-slate-700">
                  {nameOf(Number(employeeId))}{grandTotal > 0 && <span className="text-slate-400 font-normal"> · {formatCurrency(grandTotal)}</span>}
                </span>
              )}
            </div>

            {/* A real <form> (not a <div>) — AppLayout's G-01 auto-focus/Enter-navigation only
                scans for a <form> in the DOM, and this page had none, so the first field never
                got focused on open. Save/Post stay type="button" (two distinct save modes, no
                single native submit), so onSubmit only guards against the rare native
                implicit-submit-on-Enter case. */}
            <form
              onSubmit={e => e.preventDefault()}
              className={`flex flex-col gap-5 transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}
            >

            {/* Header */}
            <div className="card-white p-6 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Settlement Date</label>
                  <input type="date"
            value={date} onChange={e => setDate(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); workerContainerRef.current?.querySelector<HTMLButtonElement>('button[data-field-nav]')?.focus(); } }}
            className="soleria-input" />
                  <p className="text-[10px] text-slate-400 mt-1">The day you settle up — not the day the work was done.</p>
                </div>
                <div ref={workerContainerRef}>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Worker <span className="text-red-500 font-bold">*</span>
                  </label>
                  <SearchableSelect
                    options={workerOptions}
                    value={employeeId}
                    onChange={val => {
                      setEmployeeId(val); setStage(''); setItems([emptyItem()]);
                      requestAnimationFrame(() => stageRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
                    }}
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
                                  onClick={() => {
                                    setStage(f.key); setItems([emptyItem()]); setIsStageOpen(false);
                                    requestAnimationFrame(() => focusArticle(0));
                                  }}
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
            </div>

            {/* Lines */}
            <div className="card-white p-6 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">Articles</h3>
                  <p className="text-xs text-slate-500">
                    Quantity is in <strong>cartons</strong>; the rate is <strong>per carton</strong>, so the
                    amount is rate × cartons.
                  </p>
                </div>
                <button
                  type="button"
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
                        <th className="p-3 text-right" style={{ width: 110 }}>Rate / carton</th>
                        <th className="p-3 text-right" style={{ width: 100 }}>Cartons</th>
                        <th className="p-3 text-right" style={{ width: 130 }}>Amount</th>
                        <th className="p-3 text-center" style={{ width: 50 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => {
                        const zero = it.articleId !== '' && Number(it.rate) === 0;
                        return (
                          <tr key={it.key} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-2 pl-4">
                              <div ref={el => { articleContainerRefs.current[idx] = el; }}>
                                <SearchableSelect
                                  options={productOptions}
                                  value={it.articleId === '' ? '' : String(it.articleId)}
                                  onChange={val => pickProduct(it.key, val)}
                                  placeholder="Select article..."
                                />
                              </div>
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
                                ref={el => { rateRefs.current[idx] = el; }}
                                type="number" min={0}
                                value={it.rate || ''}
                                onChange={e => updateItem(it.key, 'rate', Number(e.target.value))}
                                onKeyDown={e => handleRateKeyDown(e, idx)}
                                disabled={it.articleId === ''}
                                className={`soleria-input py-1.5 text-right text-sm ${zero ? 'border-amber-400 bg-amber-50' : ''}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                ref={el => { cartonsRefs.current[idx] = el; }}
                                type="number" min={0}
                                value={it.cartons || ''}
                                onChange={e => updateItem(it.key, 'cartons', Number(e.target.value))}
                                onKeyDown={e => handleCartonsKeyDown(e, idx)}
                                disabled={it.articleId === ''}
                                className="soleria-input py-1.5 text-right text-sm font-semibold"
                              />
                            </td>
                            <td className="p-2 text-right font-bold text-slate-800">
                              {it.amount ? formatCurrency(it.amount) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="p-2 text-center">
                              <button type="button" onClick={() => removeRow(it.key)} className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600" title="Remove line">
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
              </div>
            )}
            </form>
          </>
        ) : (
          /* History */
          <div className={`card-white p-6 md:p-8 bg-white border transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`} style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-lora font-semibold text-lg text-slate-800">Wage Runs</h3>
              {viewLoading && <span className="text-xs text-slate-400">Loading run detail…</span>}
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Only posted runs count toward a worker's balance. To correct one: unpost, edit, post again. Click a row to see its article lines.
            </p>

            {/* WR-05: search by worker/stage name, plus a date filter. */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <input
                type="text"
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder="Search worker or stage..."
                className="soleria-input py-1.5 text-xs w-64"
              />
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-slate-500">From</label>
                <input type="date" value={historyFromDate} onChange={e => setHistoryFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-slate-500">To</label>
                <input type="date" value={historyToDate} onChange={e => setHistoryToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
              </div>
              {(historySearch || historyFromDate || historyToDate) && (
                <button
                  type="button"
                  onClick={() => { setHistorySearch(''); setHistoryFromDate(''); setHistoryToDate(''); }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline"
                >
                  Clear filters
                </button>
              )}
            </div>

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
                        {runs.length === 0
                          ? 'No wage runs yet. Post one to start accruing what workers are owed.'
                          : 'No wage runs match your search/filter.'}
                      </td>
                    </tr>
                  ) : sortedRuns.map(r => (
                    <tr
                      key={r.wage_run_id}
                      onClick={() => viewRun(r)}
                      className="border-b hover:bg-slate-50/50 cursor-pointer"
                      style={{ borderColor: 'var(--border-table)' }}
                    >
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
                      <td className="p-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {r.status === 'CONFIRMED' ? (
                            <button onClick={() => unpost(r)} title="Unpost" className="p-1.5 rounded hover:bg-amber-50 text-slate-500 hover:text-amber-700">
                              <Undo2 size={15} />
                            </button>
                          ) : (
                            <>
                              <button onClick={() => editRun(r)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800">
                                <Edit2 size={15} />
                              </button>
                              <button onClick={() => deleteRun(r)} title="Delete" className="p-1.5 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-700">
                                <Trash2 size={15} />
                              </button>
                            </>
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

      {/* Read-only article-line breakdown for the History row just clicked — works for CONFIRMED
          runs too (editRun refuses those), since viewing doesn't touch the record. */}
      {viewingRun && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-2xl mx-4 animate-scaleUp">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-800">
                  {viewingRun.employee_name || nameOf(viewingRun.employee_id)}
                </h3>
                <p className="text-xs text-slate-500">
                  {formatDate(viewingRun.run_date)} · {viewingRun.stage_label || stageLabel(viewingRun.stage_key)} ·{' '}
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
                    <th className="p-3 pl-4">Article</th>
                    <th className="p-3 text-right">Rate</th>
                    <th className="p-3 text-right">Cartons</th>
                    <th className="p-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewingRun.items || []).length === 0 ? (
                    <tr><td colSpan={4} className="text-center p-6 text-slate-400">No line items on this run.</td></tr>
                  ) : (viewingRun.items || []).map(i => (
                    <tr key={i.item_id} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-semibold text-slate-900">{i.article_name || '—'}</td>
                      <td className="p-3 text-right text-slate-500 font-mono">{formatCurrency(i.rate)}</td>
                      <td className="p-3 text-right text-slate-600 font-mono">{i.cartons}</td>
                      <td className="p-3 text-right font-semibold text-slate-800 font-mono">{formatCurrency(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t-2" style={{ borderColor: 'var(--border-color)' }}>
                    <td className="p-3 pl-4 text-slate-700">Total ({(viewingRun.items || []).length} line(s))</td>
                    <td className="p-3" />
                    <td className="p-3" />
                    <td className="p-3 text-right text-slate-900">{formatCurrency(viewingRun.total_amount)}</td>
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
