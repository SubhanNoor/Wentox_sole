import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavPage } from '@/types';
import { MENU_GROUPS, visibleMenuItems } from '@/lib/menu';
import { canUseMenuPopup, openMenuPopupChannel, type MenuPopupMessage, type RenderMessage } from '@/lib/menuPopup';
import { hideMenuPopup, placeMenuPopup } from '@/lib/api';
import MenuDropdown from './MenuDropdown';

// The five hover menus themselves. Their contents — and the reasoning behind the numbering — live
// in lib/menu.ts.
//
// Inside Electron each dropdown is shown in a window of its own (lib/menuPopup.ts) so it appears
// above the open child windows instead of hidden under them (per the user, 2026-11-11). This
// component still owns open/close and its timing; the popup only reports hover, clicks and drags
// back. Outside Electron (a plain browser) the dropdown is drawn in-page as before.

interface Props {
  currentPage: string;
  subTabId?: string;
  /** 'User' hides adminOnly items — same rule the sidebar applied. */
  isAdmin: boolean;
  /** Every item opens its own new (child) window — no in-place navigation, no modifier key
   *  needed, per the user 2026-09-03: every bar/menu item is a document launcher, matching the
   *  legacy app's per-page floating windows (ref-pics/batch2). */
  onOpenWindow: (page: NavPage, tab?: string) => void;
  /** Pinning: a dropdown item is the drag source now that the sidebar is gone. */
  onDragStart: (payload: { page: NavPage; tab?: string; label: string }) => void;
  onDragEnd: () => void;
}

export default function MenuBar({ currentPage, subTabId, isAdmin, onOpenWindow, onDragStart, onDragEnd }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [usePopup] = useState(canUseMenuPopup);
  // Closing is delayed so the diagonal mouse path from a menu button down into its own dropdown
  // doesn't pass over dead space and shut the menu — the single most annoying way a hover menu can
  // fail. Opening is immediate.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While an item is being dragged to the Quick Menu the dropdown must stay put — closing it would
  // take the drag's source away mid-drag.
  const draggingRef = useRef(false);
  // Pointer is over one of the menu buttons. The popup's "left the dropdown" arrives a moment after
  // the button's own mouseenter when moving back up, and must not close the menu under the pointer.
  const overBarRef = useRef(false);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (draggingRef.current) return;
    closeTimer.current = setTimeout(() => setOpenIndex(null), 180);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  // Click anywhere outside, or Escape, closes — a hover menu still needs both, because a menu left
  // open after the pointer leaves the window has no other way back. The popup window never takes
  // focus, so Escape keeps reaching this window while it is open. Leaving the window for another
  // one or another app closes it too.
  useEffect(() => {
    if (openIndex === null) return;
    function onDocClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenIndex(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenIndex(null);
    }
    function onBlur() {
      if (!draggingRef.current) setOpenIndex(null);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [openIndex]);

  // ---- Dropdown in its own window ----------------------------------------------------------------

  const channelRef = useRef<BroadcastChannel | null>(null);
  // The menu the popup should be showing, re-sent if the popup (re)loads after it was asked for.
  const lastRenderRef = useRef<RenderMessage | null>(null);
  // Latest props for the channel listener, which is attached once.
  const latest = useRef({ onOpenWindow, onDragStart, onDragEnd });
  useEffect(() => { latest.current = { onOpenWindow, onDragStart, onDragEnd }; });

  useEffect(() => {
    if (!usePopup) return;
    const channel = openMenuPopupChannel();
    channelRef.current = channel;
    if (!channel) return;
    channel.onmessage = (e: MessageEvent<MenuPopupMessage>) => {
      const msg = e.data;
      switch (msg?.type) {
        case 'ready':
          if (lastRenderRef.current) channel.postMessage(lastRenderRef.current);
          break;
        case 'hover':
          // Pointer crossed between the menu button and its dropdown window: same timing rules as
          // when both were in this page.
          if (msg.inside) cancelClose();
          else if (!overBarRef.current) scheduleClose();
          break;
        case 'pick':
          cancelClose();
          setOpenIndex(null);
          latest.current.onOpenWindow(msg.page as NavPage, msg.tab);
          break;
        case 'dragstart':
          draggingRef.current = true;
          cancelClose();
          latest.current.onDragStart({ page: msg.page as NavPage, tab: msg.tab, label: msg.label });
          break;
        case 'dragend':
          draggingRef.current = false;
          latest.current.onDragEnd();
          // Dropped (or cancelled) somewhere else — the pointer is no longer over the menu.
          setOpenIndex(null);
          break;
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
      // Logging out (or anything unmounting the bar) must not leave a dropdown on screen.
      void hideMenuPopup();
    };
  }, [usePopup, cancelClose, scheduleClose]);

  // Open → place the window under this menu's button, then tell it what to draw; it shows itself
  // once drawn and measured. Sliding across to another menu just re-places the same window.
  useEffect(() => {
    if (!usePopup) return;
    if (openIndex === null) {
      lastRenderRef.current = null;
      void hideMenuPopup();
      return;
    }
    const anchor = groupRefs.current[openIndex];
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    let stale = false;
    void placeMenuPopup(rect.left, rect.bottom).then(res => {
      // A newer open/close has happened since — its own call takes over.
      if (stale || !res.ok || res.data.seq === null) return;
      const msg: RenderMessage = {
        type: 'render',
        seq: res.data.seq,
        groupIndex: openIndex,
        isAdmin,
        currentPage,
        subTabId,
        // 1.SETUP is ~500px tall: on a short laptop screen it scrolls instead of running off it.
        maxHeight: Math.round(window.innerHeight * 0.7),
      };
      lastRenderRef.current = msg;
      channelRef.current?.postMessage(msg);
    });
    return () => { stale = true; };
  }, [usePopup, openIndex, isAdmin, currentPage, subTabId]);

  return (
    <div
      ref={barRef}
      data-no-print
      // NO overflow here, deliberately. `overflow-x: auto` makes overflow-y compute to `auto` as
      // well (CSS spec: `visible` on one axis becomes `auto` when the other isn't `visible`), which
      // turns this bar into a clipping box exactly the height of the buttons — so every dropdown was
      // opening correctly and then being sliced off at the bar's bottom edge, invisible. The five
      // labels are short and fit comfortably; if a future window is narrow enough to overflow, fix it
      // by shrinking the labels, not by re-adding overflow.
      className="relative flex items-stretch flex-nowrap"
      style={{
        background: 'var(--brand-navy)',
        borderBottom: '1px solid rgba(176,141,87,0.35)',
      }}
    >
      {MENU_GROUPS.map((group, idx) => {
        const items = visibleMenuItems(group, isAdmin);
        if (items.length === 0) return null;
        const isOpen = openIndex === idx;
        // The group whose page you are on stays marked, the way the sidebar highlighted its section.
        const holdsCurrent = items.some(
          i => i && i.page === currentPage && (!i.tab || i.tab === subTabId),
        );

        return (
          <div
            key={group.title}
            ref={el => { groupRefs.current[idx] = el; }}
            className="relative flex-shrink-0"
            onMouseEnter={() => { overBarRef.current = true; cancelClose(); setOpenIndex(idx); }}
            onMouseLeave={() => { overBarRef.current = false; scheduleClose(); }}
          >
            <button
              type="button"
              // Click toggles as well as hover: hover alone is unusable from a touch screen, and a
              // click is how someone verifies the menu is theirs to control.
              onClick={() => setOpenIndex(isOpen ? null : idx)}
              className="h-full px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-wide whitespace-nowrap transition-colors cursor-pointer"
              style={{
                color: isOpen || holdsCurrent ? 'var(--brand-navy)' : 'rgba(250,248,243,0.86)',
                background: isOpen
                  ? 'var(--brand-gold)'
                  : holdsCurrent
                    ? 'rgba(176,141,87,0.85)'
                    : 'transparent',
              }}
            >
              {group.title}
            </button>

            {isOpen && !usePopup && (
              <MenuDropdown
                items={items}
                currentPage={currentPage}
                subTabId={subTabId}
                onPick={item => { setOpenIndex(null); onOpenWindow(item.page, item.tab); }}
                onDragStart={item => onDragStart({ page: item.page, tab: item.tab, label: item.label })}
                onDragEnd={onDragEnd}
                className="absolute left-0 top-full z-50"
                style={{
                  boxShadow: '0 16px 38px rgba(0,0,0,0.28)',
                  // 1.SETUP is ~500px tall. The app root is `overflow-hidden` on a full-height flex
                  // column, so on a short laptop screen the foot of that menu would be clipped with
                  // no way to reach it. Cap it and let the menu itself scroll instead.
                  maxHeight: '70vh',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
