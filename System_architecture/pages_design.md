# Pages Design — Record-Entry Page Pattern (Purchase Page reference build)

Everything below was built on `src/pages/PurchasePage.tsx` to match the legacy Wentox desktop
app's toolbar/entry flow (`ref-pics/batch2/sale bill.png`). Treat this file as the checklist for
porting the same pattern onto the other master/detail entry pages — Sale Bill, Sale Return,
Purchase Return, Journal Voucher, Receipts, etc. Each section names the exact pieces to copy and
what to rename per page.

Reference screenshot: `ref-pics/batch2/sale bill.png`.

---

## 1. Toolbar — small icon-over-label buttons

Legacy style: small square buttons, colored icon on top, tiny bold label underneath, packed
tightly in one strip — **not** the app's usual pill-shaped colored action buttons.

**CSS** — add once, shared by every page (`src/index.css`, right after `.btn-outline`):

```css
.toolbar-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 50px;
  height: 46px;
  border-radius: 0.375rem;
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
  color: #475569; /* slate-600 */
  transition: background-color 150ms ease;
}
.toolbar-btn:hover:not(:disabled) { background: rgba(27,42,65,0.06); }
.toolbar-btn:disabled { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
```

**Markup** — one button:

```tsx
<button type="button" onClick={handler} disabled={cond} title="Action name" className="toolbar-btn">
  <IconName size={20} strokeWidth={2.5} className="text-emerald-600" />
  <span>Label</span>
</button>
```

- Icon size **20**, `strokeWidth={2.5}` (default lucide stroke is 2 — the extra weight is what
  makes them read as "bold/prominent", per direct user feedback).
- Color the icon per action (not the button background): emerald = create/confirm, rose = delete/
  destructive, sky = edit, blue = save, slate = cancel, amber = navigation.
- Group related buttons with a thin `<div className="w-px self-stretch mx-1" style={{ background:
  'var(--border-color)' }} />` divider, not extra margin.
- Toolbar row wrapper: `flex flex-wrap items-center justify-between gap-2 mb-2 p-2 rounded-xl
  border` (white background) — nav+action buttons in a `flex flex-wrap items-center gap-0.5` on
  the left, the Posted/Unposted `<select>` (§3) on the right via `justify-between`.

Button order (left → right), matching the ref image: **New, Delete (selected line), Edit, Save,
Done, Cancel** | divider | **First, Prev., Next, Last** | divider | **Unpost, Post**. Every
button always renders — only `disabled` changes per state, never whole groups mounting/unmounting.
(Save/Done replaced the single Save/Update button on 2026-08-27 — see §2.)

---

## 2. Master/detail split & locking

- State shape: `mode: 'view' | 'edit' | 'new'` (not a `masterLocked` boolean). `isViewMode = mode
  === 'view'`. Master fields get `disabled={isViewMode}` — they lock the moment a record is saved
  (mode flips to `'view'`), unlock on Edit (`mode = 'edit'`) or New.
- **Saving never clears the form.** Two buttons, differing only in what happens *after* a
  successful save — both keep every entered line on screen:
  - **Save** (`finalize=false`) — stays editable, so more articles can go onto the SAME record.
  - **Done** (`finalize=true`) — locks to `'view'`, where the record stays fully visible and
    **Post** lights up. Posting is always its own deliberate click.

  ```tsx
  const doSave = async (finalize: boolean) => {
    /* ...create-or-update... */
    setMode(finalize ? 'view' : 'edit');   // NOT 'view' unconditionally
  };
  ```

  The `'edit'` on the non-finalize path is load-bearing: the create-vs-update choice reads
  `mode === 'edit' && recordId != null`, so leaving a just-created record in `'new'` mode makes the
  next Save create a **second, duplicate draft**.

  > **Superseded (2026-08-27).** Previously a freshly-saved record cleared back to blank and
  > refocused the first master field (`readyForNextPurchase`-style helper) so a run of entries
  > could be typed without touching the mouse. Reported by the user as a bug: a finished record's
  > articles vanished the instant Save/Done was pressed, before it could be reviewed or posted.
  > Starting the next record is now the **New** button's job alone (`startNewPurchase`-style
  > helper). The reset helper still exists for the post-Post path, which does still clear.

---

## 3. Record navigation: First / Previous / Next / Last + Posted/Unposted dropdown

The dropdown **is a real data filter** — it picks which set of records Prev/Next/First/Last page
through. Each option lists what its label says, and shows a live count:

- `'posted'` (default) — pages through confirmed records (the real table).
- `'unposted'` — pages through saved-but-not-yet-posted **drafts** (the `draft_*` table).

> **Superseded (2026-08-27).** This section previously specified the dropdown as an *arming*
> control: both values browsed the posted list, and `'unposted'` only meant "I'm here to press
> Unpost", with Prev/Next/First/Last dulled on `'posted'`. That was changed on the user's explicit
> instruction because the labels lied — picking "Unposted" showed *posted* records, and a record
> just saved with Save/Done could not be reached from the toolbar at all (only via Find or the
> Pending Posting panel). Don't "fix" it back.

```tsx
const [navFilter, setNavFilter] = useState<'posted' | 'unposted'>('posted');

// Both list() calls return newest-first — reversed for oldest-first, so First = earliest.
const navPostedList = useMemo(() => [...sortedRecords].reverse(), [sortedRecords]);
const navUnpostedList = useMemo(() => [...unpostedRecords].reverse(), [unpostedRecords]);
const navList = navFilter === 'posted' ? navPostedList : navUnpostedList;

// -1 when the record on screen isn't in the ACTIVE list (unsaved, or a draft while the dropdown
// is on Posted and vice versa) — handlers treat that as "start from the beginning".
const navIndex = useMemo(() => {
  if (recordId == null) return -1;
  return navFilter === 'posted'
    ? (currentIsPosted ? navPostedList.findIndex(r => r.record_id === recordId) : -1)
    : (!currentIsPosted ? navUnpostedList.findIndex(r => r.draft_id === recordId) : -1);
}, [currentIsPosted, recordId, navFilter, navPostedList, navUnpostedList]);

const canNavPrevious = navList.length > 0 && navIndex !== 0;
const canNavNext = navList.length > 0 && navIndex !== navList.length - 1;
```

The two lists come from different tables, so `goToNavIndex` needs **both** loaders — the posted
row goes through `loadRecordRow`, the draft through `loadDraftIntoForm(row, { mode: 'view' })`.
That `opts.mode` param exists precisely so browsing opens a draft **read-only** (look-then-decide)
while every other caller keeps the original edit-on-open behaviour; Edit stays a deliberate click.

**Unpost gating + editable landing**:

```tsx
disabled={!isViewMode || recordId == null || !currentIsPosted}
```

Note there is **no `navFilter` condition** — that only made sense while `'unposted'` meant "I'm
here to unpost". Now the Unposted list holds drafts, none of which *can* be unposted, so gating on
it would be backwards. Being on a posted record is the only real precondition.

On success, `handleUnpost` must call `setMode('edit')` (not leave it on `'view'`) — the user
explicitly wants the editable screen immediately after unposting, not a read-only one.

**Dropdown box** — do not force an inline `height` on `.soleria-input`; it fights the class's own
padding/line-height and clips the text. Use the compact modifier instead:

```tsx
<select
  value={navFilter}
  onChange={e => setNavFilter(e.target.value as 'posted' | 'unposted')}
  className="soleria-input soleria-input-compact cursor-pointer font-semibold"
  style={{ width: 'auto' }}
  title="Posted = add new bills. Unposted = browse posted bills to Unpost one."
>
  <option value="posted">Posted</option>
  <option value="unposted">Unposted</option>
</select>
```

**Backend ordering gotcha**: `draft_*.repository.js list()` queries return **newest-first**
(`ORDER BY date DESC, draft_id DESC`) — don't assume oldest-first without checking; a stale comment
claiming otherwise caused a real ordering bug here. If you ever need to browse a *draft* list via
nav too, reverse it explicitly the same way `navPostedList` does.

---

## 4. Line-item entry: one entry row + read-only list (not editable table rows)

This is the biggest structural change from the "editable `<tr>` per row" pattern used elsewhere in
the app. Matches the legacy screenshot: **one** editable field set (Article/Material, Unit, Qty,
Rate, live Value) sits above the grid; the grid itself is read-only display + click-to-reopen.

State:

```tsx
interface CurrentRow { materialName: string; unit: string; quantity: number; pricePerUnit: number; }
const [items, setItems] = useState<UiItem[]>([]);           // committed rows only
const [currentRow, setCurrentRow] = useState<CurrentRow>(emptyCurrentRow());
const [editingUid, setEditingUid] = useState<string | null>(null); // set = re-editing an existing row
```

- **Enter on the last entry field (Rate/Price)** commits: validates all four sub-fields are
  filled, pushes a new row (or updates the row at `editingUid` in place), clears `currentRow` back
  to blank, clears `editingUid`, and **focuses the entry row's first field directly**
  (`materialNameRef.current?.focus()`) — not `focusFirstField(ref)`, which searches a container's
  *descendants* and silently does nothing when handed the input itself (a real bug hit during this
  build).
- **Clicking any row in the grid below** loads it back into the entry fields (`handleEditRow`) —
  highlighted (`bg-blue-50`), with a small "Editing an existing article — Update to save, or
  cancel" banner and a Cancel link. The row stays visible in the grid the whole time it's being
  edited (not pulled out).
- Grid rows: **no per-row delete button** — deleting a line item is a toolbar action (§1's
  "Delete" button), enabled only while a row is selected (`editingUid` set), calling
  `removeItemRow(editingUid)`.
- `isValid` for the whole form reduces to `items.length > 0` (each committed row was already
  validated at commit time) — don't re-validate field-by-field against `items` on submit.

---

## 5. Party/vendor/customer field → `SearchModal`, not `SearchableSelect`

New reusable component: **`src/components/SearchModal.tsx`**. Use it wherever a field should open
a big centered "find" popup showing the *whole* list at once, rather than `SearchableSelect`'s
small panel anchored under the field.

```tsx
<button
  ref={triggerRef}
  type="button"
  data-field-nav="true"
  disabled={isViewMode}
  onClick={openModal}
  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openModal(); } }}
  className="w-full flex items-center justify-between pl-3.5 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed min-h-[38px] text-left"
>
  <span className={selected ? 'text-slate-800 font-semibold' : 'text-slate-400'}>
    {selected ? selected.label : 'Select...'}
  </span>
  <ChevronDown size={16} className="text-slate-400" />
</button>
<SearchModal
  isOpen={isModalOpen}
  title="Select Vendor"
  options={options}          // { value, label, sublabel? }[]
  value={currentValue}
  onSelect={val => { setValue(val); setIsModalOpen(false); requestAnimationFrame(() => focusNextField(triggerRef.current)); }}
  onClose={() => setIsModalOpen(false)}
  searchPlaceholder="Search vendors..."
/>
```

- **Enter (or Arrow Up/Down) on the trigger field opens the modal.** The modal's search box
  autofocuses; Up/Down move the highlight, Enter commits, Escape/backdrop-click closes without
  choosing.
- Modal sizing: centered (`items-center justify-center`, not pinned near the top), `max-w-2xl`,
  `height: 80vh` capped at `640px` — user explicitly asked for it "big" and "in the middle".
- **Critical fix, easy to miss**: every branch of the modal's own keydown handler must call
  `e.stopPropagation()` in addition to `e.preventDefault()`. The modal isn't portaled, so its
  search input is a real DOM descendant of the page's `<form>` — without `stopPropagation`,
  `AppLayout`'s window-level Arrow-Up/Down field-walk handler (`fieldsIn(form)`) also sees the
  search input as just another form field and moves real focus to a field *behind* the modal on
  every arrow press, on top of the modal's own highlight move. Confirmed as the actual root cause
  after a direct bug report.
- On select: close the modal and advance focus via `focusNextField(triggerRef.current)` from
  `@/lib/fieldNav` (the trigger button, not the search input — `focusNextField` needs a form
  descendant to locate the *next* field relative to).

---

## Files touched this build (for diffing when porting)

- `src/pages/PurchasePage.tsx` — everything above, applied end to end.
- `src/components/SearchModal.tsx` — new, generic, reusable as-is on other pages.
- `src/index.css` — added `.toolbar-btn` (shared, don't redefine per page).

## Porting checklist for another page

1. Copy the toolbar block, swap in the page's own handlers/labels, keep the button order and
   divider grouping.
2. Swap `masterLocked`-style booleans (if the page has any) for the `mode` state pattern if not
   already using it.
3. Add `navFilter` + `navPostedList` + nav handlers; wire Prev/Next/First/Last dulling and the
   Unpost gate exactly as in §3 — **don't** let the dropdown filter which list is browsed.
4. Convert any per-row-editable item table to the single-entry-row + read-only-list pattern (§4)
   if the page still uses the old style.
5. Swap `SearchableSelect` → `SearchModal` for the page's main party field (customer, vendor,
   account...) per §5, including the `stopPropagation` fix.
