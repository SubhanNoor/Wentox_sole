import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * A plain yes/no confirmation, for an action that is about to do something the operator may not
 * realise is included — not for anything needing a password (that is PasswordPromptModal, whose
 * overlay/panel styling this deliberately mirrors so the two read as the same family).
 *
 * First use: unposting an expense voucher that paid a vendor with an endorsed cheque also reverses
 * that endorsement. The reversal is the point — it is what lets the unpost happen at all — but it
 * changes a cheque's disposition, so it is stated before it happens rather than after.
 */
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  /** The consequence, in the operator's terms. Kept as a node so callers can bold the key part. */
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the confirm button while the action is in flight, so it can't be double-fired. */
  busy?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  body,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onKeyDown={e => {
        // Escape cancels; Enter confirms. Both stopPropagation for the same reason SearchModal's
        // handler does — this modal is not portaled, so an un-stopped key keeps bubbling to the
        // page's own window-level field-walk underneath it.
        if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
        if (e.key === 'Enter' && !busy) { e.preventDefault(); e.stopPropagation(); onConfirm(); }
      }}
    >
      {/* Deliberately NOT `.card-white`: that class carries a global `max-width: 100%` declared
          after Tailwind's utilities in index.css, so it beat `max-w-md` and the dialog stretched
          the full width of the viewport (per the user, 2026-09-03). Its background/border/radius
          are set here anyway, so the class only ever contributed the bug. */}
      <div
        className="w-full max-w-md rounded-xl border shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        style={{ borderColor: 'var(--border-color)', background: '#ffffff' }}
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <span className="mt-0.5 shrink-0 rounded-lg bg-amber-50 border border-amber-200 p-2">
            <AlertTriangle size={18} className="text-amber-600" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-lora font-bold text-base text-slate-900">{title}</h3>
            <div className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            title="Cancel"
            className="shrink-0 p-1 text-slate-400 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t rounded-b-xl" style={{ borderColor: 'var(--border-color)', background: '#fafafa' }}>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="px-3 py-1.5 rounded-lg text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--brand-navy)' }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
