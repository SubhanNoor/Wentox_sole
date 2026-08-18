/**
 * One definition of "the fields of a form, in order" and "move to the next one".
 *
 * This was private to AppLayout, which owns the app-wide G-01 rule (Enter/arrows walk the fields of
 * the current form). SearchableSelect now needs the same notion, and it cannot borrow AppLayout's:
 * the dropdown panel is rendered through a PORTAL onto document.body, so `target.closest('form')`
 * from inside the panel's search box returns null and AppLayout's document-level handler bails out
 * before it can move anything. The component therefore has to advance focus itself — and if it
 * carried its own copy of the selector, the two would silently drift the first time one changed.
 */

/**
 * What counts as a field. `button[data-field-nav]` picks up SearchableSelect's own trigger (the
 * app's custom dropdown, used instead of a native <select> almost everywhere) without dragging in
 * every other button on the form — delete-row icons, Cancel, and so on.
 */
export const FIELD_SELECTOR =
  'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button[data-field-nav]:not(:disabled)';

/** The form's focusable fields in document order, skipping anything not currently on screen. */
export function fieldsIn(form: HTMLFormElement): HTMLElement[] {
  return Array.from(form.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Move focus to the field after `from`. On the last field, click the form's primary action instead
 * — every creation form in this app marks that button `type="submit"` and every other button
 * `type="button"`, which is what makes the lookup unambiguous.
 *
 * Returns false when there was nothing to do (no form, or `from` isn't one of its fields), so a
 * caller can fall back to its own behaviour rather than assume focus moved.
 */
export function focusNextField(from: HTMLElement | null | undefined): boolean {
  if (!from) return false;
  const form = from.closest('form');
  if (!form) return false;

  const fields = fieldsIn(form);
  const idx = fields.indexOf(from);
  if (idx === -1) return false;

  if (idx < fields.length - 1) {
    fields[idx + 1].focus();
  } else {
    form.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)')?.click();
  }
  return true;
}
