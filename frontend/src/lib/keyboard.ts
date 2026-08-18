/**
 * Shared keystroke predicates for the app's keyboard-first entry (G-01).
 */

/** The parts of a key event this module needs — so it can be reasoned about, and tested, on its own. */
export interface TypeAheadKeyEvent {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/**
 * Is this keystroke the user starting to TYPE, as opposed to pressing a control key?
 *
 * Used by every dropdown so that merely focusing the field and typing begins a search, with no
 * click to open first.
 *
 * - `key.length === 1` is what separates a printable character from a named key. Tab, Enter,
 *   Escape, Backspace, ArrowLeft, F1, Shift and friends all report multi-character names, so they
 *   fall through to their own handling rather than being eaten as a search term.
 * - Modifiers are excluded so application and browser shortcuts still reach their handlers. Alt+V
 *   opens Print Preview app-wide (G-09); without this guard a focused dropdown would swallow it and
 *   search for "v" instead.
 * - Space returns true (it IS typing — labels contain spaces), but callers are expected to open with
 *   an empty search for it rather than a search for " ", since Space is also the conventional
 *   open-a-select key. See `isBlankOpenKey`.
 */
export function isTypeAheadKey(e: TypeAheadKeyEvent): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
}

/** Space: treated as "open the list" rather than "search for a space". */
export function isBlankOpenKey(e: TypeAheadKeyEvent): boolean {
  return e.key === ' ';
}
