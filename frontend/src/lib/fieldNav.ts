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

/**
 * The first focusable field inside `container`, using the same definition of "a field" as
 * `fieldsIn()`. For a repeating row (a sale-bill line item, a wage-run row) the row's own fields
 * aren't known to the caller by name — this lets "focus the new row" mean "focus whatever its
 * first field turns out to be" without the caller needing to know if that's a text input or a
 * SearchableSelect's trigger button.
 */
export function focusFirstField(container: HTMLElement | null | undefined): void {
  container?.querySelector<HTMLElement>(FIELD_SELECTOR)?.focus();
}

/** The form's focusable fields in document order, skipping anything not currently on screen. */
export function fieldsIn(form: HTMLFormElement): HTMLElement[] {
  return Array.from(form.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * The form's primary action button — NOT necessarily a descendant of `form`. Several pages
 * (Receipts, Expenses, Journal Voucher, Transfer, User Management) put the submit button in a
 * toolbar row that sits visually ABOVE the card, outside the `<form>` element entirely, and
 * associate it with the form via the HTML `form="<id>"` attribute instead of nesting. A plain
 * `form.querySelector('button[type="submit"]')` never finds that button — querySelector only
 * walks descendants, and the `form` ATTRIBUTE isn't a parent/child relationship it knows about —
 * so Enter on the last field silently did nothing on every one of those pages (reported directly
 * by the user on Receipts). `HTMLButtonElement.form` is the browser's own resolved association,
 * correct for both a nested button and one linked via the attribute, so a document-wide scan
 * filtered by it works uniformly for every case without the caller needing to know which one it
 * is.
 */
export function findSubmitButton(form: HTMLFormElement): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]:not(:disabled)'))
    .find((btn) => btn.form === form) ?? null;
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
    findSubmitButton(form)?.click();
  }
  return true;
}
