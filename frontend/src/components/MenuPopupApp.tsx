import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MENU_GROUPS, visibleMenuItems } from '@/lib/menu';
import { openMenuPopupChannel, type MenuPopupMessage, type PopupMessage, type RenderMessage } from '@/lib/menuPopup';
import { showMenuPopup } from '@/lib/api';
import MenuDropdown from './MenuDropdown';

// The whole page of the MenuBar dropdown's own window (lib/menuPopup.ts). It draws whichever menu
// the main window asks for, measures it, and only then asks to be shown at that size — so the window
// never appears empty, at the wrong size, or with the previous menu in it. Hover, clicks and drags
// are reported back to the main window's MenuBar, which still owns open/close.
export default function MenuPopupApp() {
  const [render, setRender] = useState<RenderMessage | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const post = (msg: PopupMessage) => channelRef.current?.postMessage(msg);

  useEffect(() => {
    // The window is exactly the dropdown's size: no page margin, scrollbars or app background.
    for (const el of [document.documentElement, document.body]) {
      el.style.margin = '0';
      el.style.overflow = 'hidden';
      el.style.background = '#fdfbf4';
    }
    const channel = openMenuPopupChannel();
    channelRef.current = channel;
    if (!channel) return;
    channel.onmessage = (e: MessageEvent<MenuPopupMessage>) => {
      if (e.data?.type === 'render') setRender(e.data);
    };
    // A menu opened before this window finished loading is re-sent on this.
    channel.postMessage({ type: 'ready' } satisfies PopupMessage);
    return () => { channel.close(); channelRef.current = null; };
  }, []);

  useLayoutEffect(() => {
    if (!render) return;
    const seq = render.seq;
    // Wait for the web fonts, or the first menu ever shown would be measured in the fallback font.
    void document.fonts.ready.then(() => {
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      void showMenuPopup(seq, rect.width, rect.height);
    });
  }, [render]);

  const group = render ? MENU_GROUPS[render.groupIndex] : undefined;
  if (!render || !group) return null;

  return (
    <div
      ref={boxRef}
      style={{ width: 'max-content' }}
      onMouseEnter={() => post({ type: 'hover', inside: true })}
      onMouseLeave={() => post({ type: 'hover', inside: false })}
    >
      <MenuDropdown
        // Keyed per menu, so a hover highlight left over from the last one never shows on this one.
        key={render.groupIndex}
        items={visibleMenuItems(group, render.isAdmin)}
        currentPage={render.currentPage}
        subTabId={render.subTabId}
        onPick={item => post({ type: 'pick', page: item.page, tab: item.tab })}
        onDragStart={item => post({ type: 'dragstart', page: item.page, tab: item.tab, label: item.label })}
        onDragEnd={() => post({ type: 'dragend' })}
        style={{ maxHeight: render.maxHeight }}
      />
    </div>
  );
}
