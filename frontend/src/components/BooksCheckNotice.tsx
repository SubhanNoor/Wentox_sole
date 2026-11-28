import { useState, useEffect } from 'react';
import { AlertTriangle, X, RotateCw, CheckCircle2, CheckCheck } from 'lucide-react';
import * as api from '@/lib/api';
import type { BooksCheckResult, BooksCheckItemRef } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

// Once when the main window opens, then once a day while it stays open (per the user, 2026-10-25).
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Books Check (backend/src/services/booksCheck.service.js): the read-only checks the books must
 * always pass — debits equal credits, Cheques in Hand matches the cheques held, no cheque entered
 * twice, none used beyond its amount, nothing posted twice. Always shown as a button in the main
 * window's header (per the user, 2026-11-28 — it used to vanish when all was well):
 * red when something fails, green when all is clear; it opens the records.
 * Admin only — the backend refuses anyone else, and the header only mounts this for an admin.
 *
 * Mark as cleared (per the user, 2026-11-28): an item the client already settled by hand can be
 * cleared so it stops showing red. Two clicks (Mark as cleared → Confirm) so it can't happen by
 * accident. A cleared item then disappears from this window entirely (per the user, same day) —
 * the clearance stays recorded in books_check_clearances. If the item's records change, the
 * backend no longer matches it to its clearance and it turns red again by itself.
 */
export default function BooksCheckNotice() {
  const [result, setResult] = useState<BooksCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  // `${check_key}::${item_key}` of the row awaiting its Confirm click, and of a request in flight.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscapeToClose(open, () => setOpen(false));

  // Defined inside the effect, with state set only after the await (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const res = await api.booksCheck.run();
      if (!cancelled && res.ok) setResult(res.data);
    };
    tick();
    const id = setInterval(tick, DAY_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const runAgain = async () => {
    setRunning(true);
    try {
      const res = await api.booksCheck.run();
      if (res.ok) setResult(res.data);
    } finally { setRunning(false); }
  };

  const clear = async (ref: BooksCheckItemRef) => {
    const id = `${ref.check_key}::${ref.item_key}`;
    setBusy(id); setError(null);
    try {
      const res = await api.booksCheck.clear(ref);
      if (res.ok) { setResult(res.data); setConfirming(null); }
      else setError(res.error.message);
    } finally { setBusy(null); }
  };

  if (!result) return null;
  const failed = result.checks.filter(c => !c.ok);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={result.ok ? 'Books Check: everything passes — click to see the checks' : 'Books Check found a problem — click to see the records'}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
        style={{ background: result.ok ? '#047857' : '#b91c1c' }}
      >
        {result.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
        {result.ok ? 'Books Check: All clear' : `Books Check: ${failed.length} problem${failed.length === 1 ? '' : 's'}`}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl w-[720px] max-w-[92vw] max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <div>
                <h2 className="text-base font-bold text-[#1B2A41]">Books Check</h2>
                <p className="text-xs text-gray-500">Last run {formatDateTime(result.ran_at)} — read-only, nothing is changed</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={runAgain} disabled={running}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  <RotateCw size={13} className={running ? 'animate-spin' : ''} /> Run again
                </button>
                <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-3">
              {result.checks.map(c => (
                <div key={c.key} className="rounded-lg border px-4 py-3" style={{ borderColor: c.ok ? '#d1fae5' : '#fecaca', background: c.ok ? '#f0fdf4' : '#fef2f2' }}>
                  <div className="flex items-center gap-2 text-sm font-bold" style={{ color: c.ok ? '#047857' : '#b91c1c' }}>
                    {c.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    {c.title}
                  </div>
                  <div className="text-xs text-gray-700 mt-1">{c.summary}</div>
                  {c.items.length > 0 && (
                    <ul className="mt-2 space-y-1.5 text-xs font-mono text-gray-800">
                      {c.items.map(r => {
                        const id = `${c.key}::${r.key}`;
                        return (
                          <li key={r.key} className="flex items-start gap-2">
                            <span className="flex-1">• {r.text}</span>
                            {c.clearable && (confirming === id ? (
                              <span className="flex items-center gap-1 shrink-0 font-sans">
                                <button type="button" disabled={busy === id}
                                  onClick={() => clear({ check_key: c.key, item_key: r.key, item_text: r.text })}
                                  className="px-2 py-0.5 rounded text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
                                  Confirm
                                </button>
                                <button type="button" onClick={() => setConfirming(null)}
                                  className="px-2 py-0.5 rounded text-[11px] font-bold text-gray-600 border border-gray-300 hover:bg-gray-50">
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button type="button" onClick={() => { setConfirming(id); setError(null); }}
                                title="Already settled by hand — stop showing this item as a problem"
                                className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded text-[11px] font-bold font-sans text-emerald-700 border border-emerald-300 bg-white hover:bg-emerald-50">
                                <CheckCheck size={12} /> Mark as cleared
                              </button>
                            ))}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
              {error && <p className="text-xs font-bold text-red-700">{error}</p>}
              {!result.ok && (
                <p className="text-xs text-gray-500">
                  These need a correcting entry by someone who knows what really happened — the check never changes anything itself.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
