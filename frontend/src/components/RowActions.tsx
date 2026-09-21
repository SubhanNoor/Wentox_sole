import { Edit2, Trash2 } from 'lucide-react';

/**
 * The Edit/Delete pair that sits at the right-hand end of every document's line grid (per the user,
 * 2026-09-20: "at the end of every row right side there should be button to edit and delete the
 * row", and the toolbar standardisation that followed). Receipts/Payments already had this pair;
 * this is the same thing, shared, so every grid looks and behaves identically.
 *
 * Both buttons stopPropagation: the row itself is clickable (it records the selection the toolbar's
 * Edit Row/Delete act on), and without it the row handler fires alongside this one.
 *
 * Always coloured, never grey-until-hover (per the user, same day) — grey means genuinely disabled.
 */
export default function RowActions({
  onEdit, onDelete, disabled = false, editTitle = 'Edit this row', deleteTitle = 'Delete this row',
  disabledTitle, editDisabledTitle, deleteDisabledTitle,
}: {
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
  editTitle?: string;
  deleteTitle?: string;
  /** Shown on both buttons while `disabled` — says WHY, rather than leaving a dead control. */
  disabledTitle?: string;
  /** Per-button override of disabledTitle, for a page whose edit/delete are disabled for
   * different reasons (e.g. Receipts/Expenses: "Select Detail to edit/delete voucher entries").
   * Falls back to disabledTitle, then editTitle/deleteTitle, same as before. */
  editDisabledTitle?: string;
  deleteDisabledTitle?: string;
}) {
  return (
    <div className="flex items-center justify-center gap-1" data-no-print>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); if (!disabled) onEdit(); }}
        disabled={disabled}
        title={disabled ? (editDisabledTitle ?? disabledTitle ?? editTitle) : editTitle}
        className="p-1 text-blue-600 hover:text-blue-800 transition-colors disabled:text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Edit2 size={14} />
      </button>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); if (!disabled) onDelete(); }}
        disabled={disabled}
        title={disabled ? (deleteDisabledTitle ?? disabledTitle ?? deleteTitle) : deleteTitle}
        className="p-1 text-rose-600 hover:text-rose-800 transition-colors disabled:text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
