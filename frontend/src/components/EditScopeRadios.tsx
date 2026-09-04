/**
 * Master / Detail edit-scope picker — two bare radio buttons, side by side.
 *
 * Which half of a voucher the toolbar's Edit button actually unlocks (Master = header fields,
 * Detail = entry strip + grid).
 *
 * Placement: normal document flow, centred, directly under the toolbar row (per the user,
 * 2026-09-04). It used to be parked in the page's left margin — absolutely positioned so it
 * couldn't shift the centre card — but that put it out at the edge of the window, far from the
 * Edit button it modifies. In flow and centred it sits with the controls it belongs to, and since
 * it is a single short row it costs almost no vertical space.
 *
 * The two scopes read left-to-right in the same order the form itself does: Master (the header,
 * at the top) then Detail (the entry strip and grid, below it).
 */
export default function EditScopeRadios({
  name,
  value,
  onChange,
}: {
  /** Radio group name — unique per page so two pages' groups never collide. */
  name: string;
  value: 'master' | 'detail';
  onChange: (scope: 'master' | 'detail') => void;
}) {
  return (
    <div className="flex items-center justify-center gap-5 mb-2 select-none" data-no-print>
      {(['master', 'detail'] as const).map(scope => (
        <label
          key={scope}
          title={scope === 'master'
            ? 'Edit unlocks the header fields only'
            : 'Edit unlocks the entry strip and grid only'}
          className={`flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors ${
            value === scope ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === scope}
            onChange={() => onChange(scope)}
            className="cursor-pointer"
          />
          {scope === 'master' ? 'Master' : 'Detail'}
        </label>
      ))}
    </div>
  );
}
