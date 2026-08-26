import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  Settings, LogOut, ChevronDown, Home,
  Pin, BookmarkPlus, GripHorizontal, ArrowDownToLine
} from 'lucide-react';
import type { NavPage } from '@/types';
import NotificationBell from '@/components/NotificationBell';
import ZoomControl from '@/components/ZoomControl';
import MenuBar from '@/components/MenuBar';
import { FIELD_SELECTOR, fieldsIn, findSubmitButton } from '@/lib/fieldNav';
import * as api from '@/lib/api';

// Navigation moved out of this file entirely: the five hover menus and their page mapping live in
// MenuBar.tsx as MENU_GROUPS. The sidebar's NavItem/NavSection/navSections went with it.

interface QuickShortcut {
  id: string;
  label: string;
  page: NavPage;
  tab?: string;
}

// Pre-seeded Quick Menu shortcuts for a first-ever launch (empty localStorage) — the pages/tabs
// used often enough day-to-day to be worth one click from anywhere. Cash Book and Business Ledger
// live as sub-tabs of the Reports Hub page, so they're pinned via `tab`, same as clicking their
// own "+ Pin Page to Bar" would produce.
const DEFAULT_SHORTCUTS: QuickShortcut[] = [
  { id: 'default_sale-bill', label: 'Sale Bill', page: 'sale-bill' },
  { id: 'default_purchase-entry', label: 'Purchase', page: 'purchase-entry' },
  { id: 'default_receipts-jamma', label: 'Receipts', page: 'receipts-jamma' },
  { id: 'default_expenses-entry', label: 'Payments', page: 'expenses-entry' },
  { id: 'default_cash-book', label: 'Cash Book', page: 'reports', tab: 'cash-book' },
  { id: 'default_business-ledger', label: 'Ledger', page: 'reports', tab: 'business-ledger' },
  // Stock Voucher is the module's main entry point now (per the user, 2026-08-26) — one "Stock"
  // shortcut, same as before, just pointing at the new page instead of Current Stock Report.
  { id: 'default_stock-voucher', label: 'Stock', page: 'stock-voucher' },
  { id: 'default_search-customer', label: 'Search Customer', page: 'search-customer' },
  { id: 'default_backup', label: 'Backup', page: 'settings', tab: 'backup' },
];

// Where the bar is stored, and which generation of DEFAULT_SHORTCUTS has been published to this
// machine. The seed marker exists because "has this machine ever stored a bar?" is the wrong
// question: an install that ran an older build (whose default was an empty bar) and pinned or
// unpinned anything has a stored list forever, so it would never pick the defaults up. Keying on a
// seed version instead means bumping SHORTCUTS_SEED_VERSION republishes the default set to every
// install exactly once — at the cost of replacing whatever that install had pinned, which is why
// it should only be bumped when the defaults themselves change.
const SHORTCUTS_STORAGE_KEY = 'wento_quick_shortcuts_clean_v3';
const SHORTCUTS_SEED_KEY = 'wento_quick_shortcuts_seed';
const SHORTCUTS_SEED_VERSION = '2026-08-26c';

function loadShortcuts(): QuickShortcut[] {
  if (localStorage.getItem(SHORTCUTS_SEED_KEY) !== SHORTCUTS_SEED_VERSION) {
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(DEFAULT_SHORTCUTS));
    localStorage.setItem(SHORTCUTS_SEED_KEY, SHORTCUTS_SEED_VERSION);
    return DEFAULT_SHORTCUTS;
  }
  // Already seeded, so from here on the user's own bar wins — including an empty one they cleared
  // themselves, which is why this returns [] rather than re-seeding.
  const saved = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : DEFAULT_SHORTCUTS;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}


interface AppLayoutProps {
  children: React.ReactNode;
  pageTitle: string;
  subTabTitle?: string;
  subTabId?: string;
  headerAction?: React.ReactNode;
}

export default function AppLayout({ children, pageTitle, subTabTitle, subTabId, headerAction }: AppLayoutProps) {
  const { state, dispatch } = useApp();
  const [showAdminPopup, setShowAdminPopup] = useState(false);

  // Top Menu Bar Shortcuts State — seeded with the everyday-use pages the first time an install
  // sees this generation of the defaults (see loadShortcuts above); after that the user's own bar
  // wins from then on.
  const [shortcuts, setShortcuts] = useState<QuickShortcut[]>(loadShortcuts);

  // Drag & Drop Quick Menu State
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const popupRef = useRef<HTMLDivElement>(null);

  // The sidebar's scroll-position restore and its adminOnly section filter both went with it —
  // MenuBar does its own role filtering, and a dropdown that opens fresh each time has no scroll
  // position to remember.

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowAdminPopup(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // G-09: Alt+V triggers whichever "Show Print Preview" button is on the current page/tab.
  // Every report page names its own preview button identically, so rather than threading a
  // shortcut prop through every one of them, this finds the visible one by its label — offsetParent
  // is null for anything display:none (a hidden tab's own preview button), which keeps this from
  // firing a preview that isn't actually on screen.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.key.toLowerCase() !== 'v') return;
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      const target = buttons.find(
        (b) => !b.disabled && b.offsetParent !== null && b.textContent?.trim().includes('Show Print Preview')
      );
      if (target) {
        e.preventDefault();
        target.click();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // G-01: auto-focus the first field of any creation window (every one of them is a <form
  // onSubmit>, so watching for a <form> being added to the DOM covers every modal/page without
  // threading a ref through each one) the moment it opens.
  //
  // AppLayout is rendered per-page (every page does `<AppLayout>...</AppLayout>` itself, it's not
  // one shell that stays mounted across navigation) — so this component, and this effect, remounts
  // on every page switch. That made the MutationObserver-only version below miss most pages: React
  // commits the whole new page (AppLayout + its <form>) to the DOM in one synchronous flush, and
  // this effect only runs *after* that commit — so by the time `observer.observe()` starts
  // watching, the form has already been inserted and there's no further mutation left to catch.
  // It only ever "worked" by accident, on whichever page happened to render its form fields in a
  // later pass (e.g. gated behind an async fetch) instead of the initial commit.
  // The fix: also try focusing synchronously on mount, against whatever's already in the DOM —
  // the observer stays too, to catch a form that opens later (a modal, or a genuinely async page).
  useEffect(() => {
    function focusFirstField(root: ParentNode): boolean {
      const form = root.querySelector('form');
      if (!form) return false;
      const first = form.querySelector<HTMLElement>(FIELD_SELECTOR);
      if (!first) return false;
      first.focus();
      return true;
    }

    if (focusFirstField(document)) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const form = node.matches('form') ? node : node.querySelector('form');
          if (!form) continue;
          const first = form.querySelector<HTMLElement>(FIELD_SELECTOR);
          first?.focus();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // G-01: Enter moves to the next field and, on the last field, clicks the form's primary action
  // (Create/Save/Confirm — every creation form in this app marks it button[type="submit"] and
  // marks every other button in the form type="button", so this is a safe, unambiguous lookup).
  // Left/Right move between fields too, but only where there's no native meaning to preserve:
  // a text input only hops once the cursor is already at that edge (so typing/editing is
  // untouched), and number inputs/native <select>s are left alone entirely — Chrome throws
  // reading selectionStart on a number input, and both types already bind Left/Right to their own
  // native behavior.
  // Up/Down also move between fields (same "hop to the next field" behavior as Enter) — with two
  // deliberate exceptions where Up/Down already has a native meaning worth keeping: native
  // <select> elements use them to cycle the selected option, and the app's own dropdown
  // (SearchableSelect, the button[data-field-nav] trigger) uses them to open the panel / move the
  // highlighted option — both keep their own handling untouched. Everywhere else — text inputs
  // and, importantly, number inputs — Up/Down is always prevented from reaching the browser's
  // native spinner (which would silently increment/decrement a price/quantity field) and instead
  // just moves focus, exactly like Tab/Shift+Tab.
  useEffect(() => {
    // [data-field-nav] picks up SearchableSelect's own trigger button (the app's custom dropdown,
    // used in place of a native <select> almost everywhere) without pulling in every other button
    // on the form (delete-row icons, Cancel, etc.).
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const isTextarea = target.tagName === 'TEXTAREA';
      // A textarea's Left/Right/Up/Down keep their native meaning unconditionally — cursor
      // movement is meaningful at every position in multi-line text, not just at a line's start or
      // end the way it is for a single-line input. Enter is handled below instead of exempted here:
      // a Remarks box that swallowed Enter forever, with no way to move on or save, was the one
      // field in the app that broke the "Enter means done with this field" rule every other field
      // follows — reported directly by the user.
      if (isTextarea && e.key !== 'Enter') return;
      const form = target.closest('form');
      if (!form) return;

      if (e.key === 'Enter') {
        // Shift+Enter is the escape hatch for a genuine newline in a textarea. Plain Enter now
        // advances/submits like every other field.
        if (isTextarea && e.shiftKey) return;

        const fields = fieldsIn(form);
        const idx = fields.indexOf(target);
        if (idx === -1) return;
        e.preventDefault();
        if (idx < fields.length - 1) {
          fields[idx + 1].focus();
        } else {
          findSubmitButton(form)?.click();
        }
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (target instanceof HTMLInputElement && ['text', 'search', 'tel', 'password'].includes(target.type)) {
          const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
          const atEnd = target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
          if (e.key === 'ArrowRight' && !atEnd) return;
          if (e.key === 'ArrowLeft' && !atStart) return;
        } else if (target instanceof HTMLInputElement || target.tagName === 'SELECT') {
          return; // number inputs and native <select> keep their own native Left/Right behavior
        }

        const fields = fieldsIn(form);
        const idx = fields.indexOf(target);
        if (idx === -1) return;
        const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
        if (nextIdx >= 0 && nextIdx < fields.length) {
          e.preventDefault();
          fields[nextIdx].focus();
        }
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Native <select> keeps cycling its own options, and SearchableSelect's trigger button
        // keeps opening/highlighting via its own onKeyDown — don't fight either one.
        if (target.tagName === 'SELECT' || (target instanceof HTMLButtonElement && target.dataset.fieldNav)) {
          return;
        }
        const fields = fieldsIn(form);
        const idx = fields.indexOf(target);
        if (idx === -1) return;
        const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        if (nextIdx >= 0 && nextIdx < fields.length) {
          // Always prevented here (unlike Left/Right) — a number input's native Up/Down spinner
          // would otherwise silently increment/decrement a price/quantity instead of navigating.
          e.preventDefault();
          fields[nextIdx].focus();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function navigate(page: string, tab?: string) {
    dispatch({ type: 'NAVIGATE', page, tab });
    setShowAdminPopup(false);
  }

  const currentPage = state.currentPage;

  const isCurrentPagePinned = useMemo(() => {
    return shortcuts.some(s => s.page === currentPage && (!subTabId || s.tab === subTabId));
  }, [shortcuts, currentPage, subTabId]);

  const handlePinCurrentPage = () => {
    if (isCurrentPagePinned) return;
    const newShortcut: QuickShortcut = {
      id: `${currentPage}_${subTabId || 'main'}_${Date.now()}`,
      label: subTabTitle || pageTitle || currentPage,
      page: currentPage as NavPage,
      tab: subTabId
    };
    const updated = [...shortcuts, newShortcut];
    setShortcuts(updated);
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(updated));
  };

  const handleDropShortcut = (e: React.DragEvent) => {
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed.page || !parsed.label) return;

      if (shortcuts.some(s => s.page === parsed.page && s.tab === parsed.tab)) return;

      const newShortcut: QuickShortcut = {
        id: `${parsed.page}_${parsed.tab || 'main'}_${Date.now()}`,
        label: parsed.label,
        page: parsed.page as NavPage,
        tab: parsed.tab
      };
      const updated = [...shortcuts, newShortcut];
      setShortcuts(updated);
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('Error handling dropped shortcut', err);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      {/* Main Content — the sidebar is gone; navigation lives in <MenuBar> below the header. */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top Header */}
        <header
          data-no-print
          className="app-header flex items-center gap-4 px-6 md:px-8 flex-shrink-0"
          style={{
            height: 66,
            background: 'var(--app-bg)',
            borderBottom: '1px solid var(--border-color)'
          }}
        >
          {/* The sidebar toggle used to live here. There is no sidebar to toggle now — navigation is
              the menu bar below this header — so the space goes to the Home button and brand. */}
          <button
            onClick={() => navigate('home')}
            className="flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
            style={{ width: 36, height: 36 }}
            title="Home"
            aria-label="Go to Home"
          >
            <Home size={20} color="var(--dark-heading)" />
          </button>
          
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* Brand mark */}
            <div className="flex flex-col gap-1 brand-mark">
              <span
                className="font-lora uppercase tracking-widest"
                style={{ fontSize: '12.5px', letterSpacing: '2.5px', color: 'var(--brand-navy)' }}
              >
                WENTOX
              </span>
              <div
                className="h-0.5 w-12 solera-pulse rounded-full"
                style={{ background: 'var(--brand-gold)' }}
              />
            </div>
            {/* Divider */}
            <div className="brand-mark" style={{ width: 1, height: 26, background: 'var(--border-color)' }} />
            
            {/* Draggable Page Title & Sub-Tab Breadcrumb */}
            <div className="flex items-center gap-2 font-lora font-semibold truncate" style={{ color: 'var(--dark-heading)' }}>
              <h1
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', JSON.stringify({ page: currentPage, label: pageTitle || currentPage }));
                  setIsDragging(true);
                }}
                onDragEnd={() => {
                  setIsDragging(false);
                  setIsDragOver(false);
                }}
                className="capitalize truncate cursor-grab active:cursor-grabbing flex items-center gap-1.5 group hover:text-[#B08D57] transition-colors"
                style={{ fontSize: '24px' }}
                title="Drag main page title to top Quick Access Menu Bar to pin"
              >
                <span>{pageTitle}</span>
                <GripHorizontal size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </h1>

              {subTabTitle && (
                <>
                  <span className="text-slate-300 font-light text-lg">/</span>
                  <h2
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', JSON.stringify({ page: currentPage, tab: subTabId, label: subTabTitle }));
                      setIsDragging(true);
                    }}
                    onDragEnd={() => {
                      setIsDragging(false);
                      setIsDragOver(false);
                    }}
                    className="capitalize truncate cursor-grab active:cursor-grabbing flex items-center gap-1 text-amber-900 group hover:underline"
                    style={{ fontSize: '20px' }}
                    title="Drag subpage tab title to top Quick Access Menu Bar to pin"
                  >
                    <span>{subTabTitle}</span>
                    <GripHorizontal size={14} className="text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h2>
                </>
              )}
            </div>
          </div>
          {headerAction && (
            <div className="flex-shrink-0 overflow-x-auto">{headerAction}</div>
          )}
          <ZoomControl />
          <NotificationBell />

          {/* The user chip — and with it Settings and Log out — used to sit in the sidebar footer.
              Removing the sidebar without moving it would have taken the only way to log out with
              it, so it lives in the header now. Same popup, same two actions. */}
          <div className="relative flex-shrink-0" ref={popupRef}>
            <button
              onClick={() => setShowAdminPopup(!showAdminPopup)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100 cursor-pointer"
              title="Account"
            >
              <div
                className="flex items-center justify-center rounded-full flex-shrink-0"
                style={{ width: 30, height: 30, background: 'var(--brand-gold)' }}
              >
                <span className="font-inter font-semibold text-[10px]" style={{ color: 'var(--brand-navy)' }}>
                  {state.currentUserRole === 'User' ? 'US' : 'WA'}
                </span>
              </div>
              <div className="text-left hidden md:block">
                <div className="font-semibold text-[12px]" style={{ color: 'var(--dark-heading)' }}>
                  {state.currentUserRole === 'User' ? 'Wentox User' : 'Wentox Admin'}
                </div>
                <div style={{ color: 'var(--brand-gold)', fontSize: '10px' }}>
                  {state.currentUserRole || 'Administrator'}
                </div>
              </div>
              <ChevronDown
                size={12}
                className="transition-transform"
                style={{ color: 'rgba(17,28,42,0.45)', transform: showAdminPopup ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            {showAdminPopup && (
              <div
                className="absolute right-0 rounded-lg overflow-hidden z-50"
                style={{
                  top: 'calc(100% + 6px)',
                  minWidth: 210,
                  background: '#22344f',
                  border: '1px solid rgba(176,141,87,0.35)',
                  boxShadow: '0 14px 34px rgba(0,0,0,0.35)',
                }}
              >
                <button
                  onClick={() => { setShowAdminPopup(false); navigate('settings'); }}
                  className="flex items-center gap-2 w-full px-3.5 py-3 text-sm transition-colors hover:bg-white/5 cursor-pointer"
                  style={{ color: 'rgba(250,248,243,0.85)' }}
                >
                  <Settings size={14} />
                  <span>{state.currentUserRole === 'Admin' ? 'Settings & Updates' : 'Check for Updates'}</span>
                </button>
                <div style={{ borderTop: '1px solid var(--sidebar-sep)' }} />
                <button
                  onClick={() => { void api.logout(); dispatch({ type: 'LOGOUT' }); }}
                  className="flex items-center gap-2 w-full px-3.5 py-3 text-sm transition-colors hover:bg-white/5"
                  style={{ color: '#d99a86' }}
                >
                  <LogOut size={14} />
                  <span>Log out</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* The classic menu bar from the client's previous software — five hover menus, directly
            above the Quick Menu row, replacing the sidebar. */}
        <MenuBar
          currentPage={currentPage}
          subTabId={subTabId}
          isAdmin={state.currentUserRole !== 'User'}
          onNavigate={(page, tab) => navigate(page, tab)}
          onDragStart={() => setIsDragging(true)}
          onDragEnd={() => { setIsDragging(false); setIsDragOver(false); }}
        />

        {/* Top Quick Access Shortcut Drop Zone / Menu Bar */}
        <div
          data-no-print
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            setIsDragging(false);
            handleDropShortcut(e);
          }}
          className={`py-1.5 px-6 flex items-center justify-between flex-nowrap gap-2 text-xs font-inter transition-all duration-200 ${
            isDragOver || isDragging
              ? 'bg-amber-100/90 border-2 border-dashed border-[#B08D57] shadow-md ring-2 ring-amber-400/40 animate-pulse'
              : 'bg-slate-100/90 border-b border-slate-200 shadow-2xs'
          }`}
        >
          {/* flex-1 + min-w-0 is required for overflow-x-auto to actually scroll instead of just
              growing forever — a flex child's default min-width is `auto`, which blocks shrinking
              below its content's width no matter how much content (pinned shortcuts) it holds. */}
          <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 py-0.5">
            <span className="font-bold text-[#111c2a] uppercase tracking-wider text-[11px] shrink-0 flex items-center gap-1">
              <Pin size={12} className="text-[#B08D57]" /> Quick Menu:
            </span>

            {isDragOver ? (
              <span className="text-amber-900 font-bold flex items-center gap-1.5 animate-bounce">
                <ArrowDownToLine size={14} /> Drop page/subpage here to pin to Quick Menu Bar!
              </span>
            ) : shortcuts.length === 0 ? (
              <span className="text-slate-400 italic text-[11px]">
                No pinned pages yet — Drag any subpage heading or click <span className="font-semibold text-slate-600">+ Pin Page to Bar</span> to add quick shortcuts.
              </span>
            ) : (
              <div className="flex items-center gap-1.5 flex-nowrap">
                {shortcuts.map(s => {
                  const isActive = currentPage === s.page && (!subTabId || s.tab === subTabId);
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold transition-all shadow-2xs border ${
                        isActive
                          ? 'bg-[#111c2a] text-[#B08D57] border-[#111c2a]'
                          : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200 hover:border-amber-400'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => navigate(s.page, s.tab)}
                        className="cursor-pointer font-semibold hover:underline"
                      >
                        {s.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pin Current Page Button */}
          <button
            type="button"
            onClick={handlePinCurrentPage}
            disabled={isCurrentPagePinned}
            title={isCurrentPagePinned ? 'Already pinned' : 'Pin current page/subpage to Quick Menu Bar'}
            className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all flex items-center gap-1 border shrink-0 ${
              isCurrentPagePinned
                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-default'
                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-[#111c2a] hover:text-[#B08D57] cursor-pointer shadow-2xs'
            }`}
          >
            <BookmarkPlus size={13} />
            {isCurrentPagePinned ? 'Pinned to Bar' : '+ Pin Page to Bar'}
          </button>
        </div>

        {/* Content — top padding trimmed well below the sides/bottom so the page's own subpage
            tab bar and cards sit close under the Quick Menu bar instead of leaving a tall gap. */}
        <main className="app-main flex-1 overflow-auto" style={{ padding: '12px 32px 32px' }}>
          <div className="app-main-inner animate-pageIn" style={{ maxWidth: 1200, margin: '0 auto' }}>
            {children}
          </div>
        </main>
      </div>

    </div>
  );
}
