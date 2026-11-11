/**
 * The MenuBar dropdown is shown in a small window of its own (per the user, 2026-11-11): drawn
 * inside the main window's page it could never appear above the open child windows, which float
 * over the main window. The main process only places, sizes, shows and hides that window (backend
 * electron/windowManager.js#ensureMenuPopup); WHAT it shows, and what the user does in it, travel
 * between the two renderers over this BroadcastChannel — the same mechanism lib/dataChanged.ts
 * already relies on across windows (one shared origin).
 */
import { getWindowParam } from './windowParams';

/** Main window → popup: draw this menu group. `seq` must be echoed back to showMenuPopup. */
export interface RenderMessage {
  type: 'render';
  seq: number;
  groupIndex: number;
  isAdmin: boolean;
  currentPage: string;
  subTabId?: string;
  /** CSS pixels — the dropdown scrolls past this, as it did in-page (70% of the main window). */
  maxHeight: number;
}

/** Popup → main window. */
export type PopupMessage =
  | { type: 'ready' }
  | { type: 'hover'; inside: boolean }
  | { type: 'pick'; page: string; tab?: string }
  | { type: 'dragstart'; page: string; tab?: string; label: string }
  | { type: 'dragend' };

export type MenuPopupMessage = RenderMessage | PopupMessage;

const CHANNEL_NAME = 'wentox-menu-popup';

export function openMenuPopupChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

/** This window IS the dropdown popup (backend windowManager.js loads it with ?menuPopup=1). */
export function isMenuPopupWindow(): boolean {
  return getWindowParam('menuPopup') === '1';
}

/** The dropdown can go in its own window — only inside Electron. A plain browser keeps it in-page. */
export function canUseMenuPopup(): boolean {
  return !!window.api && typeof BroadcastChannel !== 'undefined';
}
