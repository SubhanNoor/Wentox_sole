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
 * G-02 (changes-14-09-26.md, 2026-09-15): true when `el` is a required field currently failing its
 * own native constraint validation — the one condition every keyboard-advance path below must
 * refuse to move past. Backed by the native `required` attribute + `ValidityState.valid` (not just
 * `valueMissing` — RP-02 needs a required Amount field with `min={1}` to trap on a typed "0" too,
 * a `rangeUnderflow`, not a missing value), not a bespoke rule, so a field only ever traps once
 * someone actually marks it `required` — inert everywhere else, meaning this can be rolled out to
 * more fields later without touching this function again.
 *
 * `button[data-field-nav]` (SearchableSelect's trigger) has no native validity to read — it
 * carries its own `data-required`/`data-value-missing` attributes instead (set by SearchableSelect
 * itself from its own `required` prop), checked the same way; a button has no other constraint an
 * equivalent to `min` could ever express, so `data-value-missing` alone is still the whole story
 * there.
 */
export function isRequiredAndEmpty(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    return el.required && !el.validity.valid;
  }
  if (el instanceof HTMLButtonElement) {
    return el.dataset.required === 'true' && el.dataset.valueMissing === 'true';
  }
  return false;
}

// The event a SearchableSelect trigger listens for on itself to show its own inline "required"
// message — dispatched instead of calling `.reportValidity()` (which only exists on native
// form-validatable elements, not a `<button>`). Not bubbled: only the exact trigger blocked should
// react, never an ancestor's own listener for the same event name.
const REQUIRED_BLOCKED_EVENT = 'g02-required-blocked';

/**
 * G-02: the one place every keyboard-advance path calls before actually moving focus. For a native
 * field, shows its own validation message right at the field via the browser's `reportValidity()`
 * bubble — correct positioning for free, even inside a portaled modal, no custom message UI to
 * build or keep in sync. For a SearchableSelect trigger, dispatches `REQUIRED_BLOCKED_EVENT`
 * instead, which the component listens for to show its own inline message underneath itself.
 * Returns true when it blocked (caller should stop, not advance).
 */
export function blockIfRequiredEmpty(el: HTMLElement): boolean {
  if (!isRequiredAndEmpty(el)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    el.reportValidity();
  } else {
    el.dispatchEvent(new CustomEvent(REQUIRED_BLOCKED_EVENT));
  }
  return true;
}

export { REQUIRED_BLOCKED_EVENT };

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

  // G-02: an empty required field traps the advance right here — the field itself already
  // reported why via the browser's own validation bubble. `true`: the key was handled (caller
  // shouldn't fall through to its own default behavior), even though focus didn't move.
  if (blockIfRequiredEmpty(from)) return true;

  if (idx < fields.length - 1) {
    fields[idx + 1].focus();
  } else {
    findSubmitButton(form)?.click();
  }
  return true;
}
