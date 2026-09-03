/**
 * Master / Detail edit-scope picker — two bare radio buttons, no card.
 *
 * Which half of a voucher the toolbar's Edit button actually unlocks (Master = header fields,
 * Detail = entry strip + grid). Sits in the empty margin immediately LEFT of the toolbar's New
 * button, just outside the 1200px card.
 *
 * Positioning: `absolute`, anchored via `right: calc(100% + 12px)` to the page wrapper's own
 * left edge and `top: 0`, which is the toolbar row — so it lines up with New, and being absolute
 * it cannot move or shrink the centre card. Deliberately NOT behind a media query: the old
 * gutter panel was gated on `2xl` and disappeared completely at 90% zoom, taking the radios with
 * it (per the user, 2026-09-03). Two radios and two small labels are ~65px wide, which fits the
 * margin the card has at any zoom the app is actually used at.
 *
 * The parent must be `position: relative` (every voucher page's `mx-auto relative` wrapper is).
 *
 * `variant="inline"` is for the pages that already reserve a left-hand column in a flex row
 * (Receipts, Expenses): the radios take that slot directly, sticky to the top as the old card
 * was, so the centre card keeps exactly the position it has today — only the card box around the
 * radios is gone (per the user, 2026-09-03). It keeps that column's old 84px width so the
 * centre card sits exactly where it did.
 */
export default function EditScopeRadios({
  name,
  value,
  onChange,
  variant = 'gutter',
}: {
  /** Radio group name — unique per page so two pages' groups never collide. */
  name: string;
  value: 'master' | 'detail';
  onChange: (scope: 'master' | 'detail') => void;
  /** 'gutter' = absolute, in the margin left of the toolbar; 'inline' = fill a flex-row slot. */
  variant?: 'gutter' | 'inline';
}) {
  const gutter = variant === 'gutter';
  return (
    <div
      className={`flex flex-col gap-1.5 select-none ${gutter ? 'absolute top-0 z-20' : 'shrink-0 sticky top-4'}`}
      style={gutter ? { right: 'calc(100% + 12px)' } : { width: 84 }}
      data-no-print
    >
      {(['master', 'detail'] as const).map(scope => (
        <label
          key={scope}
          title={scope === 'master'
            ? 'Edit unlocks the header fields only'
            : 'Edit unlocks the entry strip and grid only'}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 cursor-pointer hover:text-slate-700 whitespace-nowrap"
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
