import { useState, useEffect } from 'react';
import { AlertTriangle, X, RotateCw, CheckCircle2 } from 'lucide-react';
import * as api from '@/lib/api';
import type { BooksCheckResult } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

// Once when the main window opens, then once a day while it stays open (per the user, 2026-10-25).
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Books Check (backend/src/services/booksCheck.service.js): the read-only checks the books must
 * always pass — debits equal credits, Cheques in Hand matches the cheques held, no cheque entered
 * twice, none used beyond its amount, nothing posted twice. Shown only when something fails, as a
 * red button in the main window's header that opens the exact records; silent when all is well.
 * Admin only — the backend refuses anyone else, and the header only mounts this for an admin.
 */
export default function BooksCheckNotice() {
  const [result, setResult] = useState<BooksCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
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

  if (!result || (result.ok && !open)) return null;
  const failed = result.checks.filter(c => !c.ok);

  return (
    <>
      {!result.ok && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Books Check found a problem — click to see the records"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
          style={{ background: '#b91c1c' }}
        >
          <AlertTriangle size={14} />
          Books Check: {failed.length} problem{failed.length === 1 ? '' : 's'}
        </button>
      )}

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
                  {c.rows.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs font-mono text-gray-800">
                      {c.rows.map((r, i) => <li key={i}>• {r}</li>)}
                    </ul>
                  )}
                </div>
              ))}
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
