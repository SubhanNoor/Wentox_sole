import { AlertTriangle } from 'lucide-react';

/**
 * The opening balance / opening date pair, shared by every screen that opens an account —
 * Business Account, Vendor, Customer, Employee, Bank. One component so the both-or-neither rule,
 * the wording and the warning cannot drift between five copies.
 *
 * What the account already held before WentoX started recording it. It is a stored INPUT, not a
 * ledger entry: `netBalance()` adds it in whenever `opening_date` falls within the range being
 * asked about. So editing it on an account that already has posted history rewrites every past
 * balance and report for that account, with no reversing entry — which is exactly what you want
 * when correcting a migration, and worth saying out loud before someone does it by accident.
 */

interface OpeningBalanceFieldsProps {
  balance: string;
  date: string;
  onBalanceChange: (v: string) => void;
  onDateChange: (v: string) => void;
  disabled?: boolean;
  /** True when editing an existing account — switches the note to the retroactive-change warning. */
  isExisting?: boolean;
}

export default function OpeningBalanceFields({
  balance, date, onBalanceChange, onDateChange, disabled = false, isExisting = false,
}: OpeningBalanceFieldsProps) {
  const partial = (balance.trim() !== '') !== (date.trim() !== '');

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-bold text-slate-800">Opening Balance</span>
        <span className="text-[10px] text-slate-400 font-medium">optional — leave blank to start at zero</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Amount (PKR)</label>
          <input
            type="number"
            value={balance}
            disabled={disabled}
            onChange={e => onBalanceChange(e.target.value)}
            placeholder="e.g. 25000"
            className="soleria-input font-semibold font-mono"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Positive = they owe you · Negative = you owe them
          </p>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">As On Date</label>
          <input
            type="date"
            value={date}
            disabled={disabled}
            onChange={e => onDateChange(e.target.value)}
            className="soleria-input font-semibold"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            The balance counts from this date onward
          </p>
        </div>
      </div>

      {partial && (
        <p className="mt-2 text-[11px] font-semibold text-rose-700">
          Enter both, or neither — a balance with no date cannot be placed on the timeline.
        </p>
      )}

      {isExisting && balance.trim() !== '' && (
        <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 flex gap-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Changing this <strong>rewrites past balances and reports</strong> for this account — it
            is not a transaction and leaves no reversing entry. Correct a migration figure with it;
            for anything that actually happened, raise a Journal Voucher instead.
          </span>
        </p>
      )}
    </div>
  );
}
