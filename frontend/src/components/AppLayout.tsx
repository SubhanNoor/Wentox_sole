import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  ShoppingCart, Receipt, Package, FileText, Layers,
  Settings, LogOut, Menu, X, ChevronDown, MapPin, Home,
  Users, Folder, BookOpen, DollarSign, ListCollapse, Wallet, Truck, Milestone, ShoppingBag, Undo2, Search, HardHat,
  BadgeDollarSign, ArrowLeftRight, Landmark, Pin, BookmarkPlus, Trash2, GripHorizontal, ArrowDownToLine, Warehouse, RotateCcw,
  UserCog, UserSearch
} from 'lucide-react';
import type { NavPage } from '@/types';
import NotificationBell from '@/components/NotificationBell';
import * as api from '@/lib/api';

interface NavItem {
  page: NavPage;
  label: string;
  icon: React.ComponentType<{ size: number; className?: string }>;
  adminOnly?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface QuickShortcut {
  id: string;
  label: string;
  page: NavPage;
  tab?: string;
}

const navSections: NavSection[] = [
  {
    title: 'Transactions',
    items: [
      { page: 'sale-bill', label: 'Sale Bill', icon: ShoppingCart },
      { page: 'sale-return', label: 'Sale Return', icon: Receipt },
      { page: 'purchase-entry', label: 'Purchase', icon: ShoppingBag },
      { page: 'purchase-return', label: 'Purchase Return', icon: Undo2 },
      { page: 'receipts-jamma', label: 'Receipts (Jamma)', icon: DollarSign },
      { page: 'expenses-entry', label: 'Expenses (Kharch)', icon: Wallet },
      { page: 'wage-run', label: 'Wage Run (Piece Rate)', icon: HardHat },
      { page: 'salary-run', label: 'Salary Run (Monthly)', icon: BadgeDollarSign },
      { page: 'transfer', label: 'Transfer (Cash ↔ Bank)', icon: ArrowLeftRight, adminOnly: true },
      { page: 'cheque-return', label: 'Cheque', icon: RotateCcw },
    ]
  },
  {
    title: 'Reports',
    items: [
      { page: 'report-stock', label: 'Current Stock', icon: Package },
      { page: 'reports', label: 'Reports Hub & Ledger', icon: FileText },
      { page: 'bilty-update', label: 'Search & Bilty Adda Updation', icon: Search },
      { page: 'overall-search', label: 'Overall Searching', icon: Users },
      { page: 'search-customer', label: 'Search Customer', icon: UserSearch },
    ]
  },
  {
    title: 'System Setup',
    items: [
      { page: 'setup-product', label: 'Product Details', icon: Folder },
      { page: 'setup-category', label: 'Categories', icon: Layers },
      { page: 'setup-vendor', label: 'Vendors', icon: Truck },
      { page: 'setup-employee', label: 'Employees', icon: HardHat },
      { page: 'setup-bank', label: 'Bank Accounts', icon: Landmark, adminOnly: true },
      { page: 'setup-customer', label: 'Customers', icon: Users },
      { page: 'setup-sub-cust', label: 'Sub Customers', icon: Users },
      { page: 'setup-city', label: 'City Creation', icon: MapPin },
      { page: 'setup-region', label: 'Regions', icon: MapPin },
      { page: 'setup-adda', label: 'Transport Addas', icon: Milestone },
      { page: 'setup-store', label: 'Store Setup', icon: Warehouse },
      { page: 'setup-users', label: 'Manage Users', icon: UserCog, adminOnly: true },
    ]
  },
  {
    title: 'Accounting Setup',
    items: [
      { page: 'setup-group-ac', label: 'Group Accounts', icon: ListCollapse },
      { page: 'setup-chart-ac', label: 'Chart of Accounts', icon: BookOpen },
      { page: 'setup-business-ac', label: 'Business Accounts', icon: Settings },
    ]
  }
];

// Pre-seeded Quick Menu shortcuts for a first-ever launch (empty localStorage) — the pages/tabs
// used often enough day-to-day to be worth one click from anywhere. Cash Book and Business Ledger
// live as sub-tabs of the Reports Hub page, so they're pinned via `tab`, same as clicking their
// own "+ Pin Page to Bar" would produce.
const DEFAULT_SHORTCUTS: QuickShortcut[] = [
  { id: 'default_sale-bill', label: 'Sale Bill', page: 'sale-bill' },
  { id: 'default_purchase-entry', label: 'Purchase', page: 'purchase-entry' },
  { id: 'default_receipts-jamma', label: 'Receipts (Jamma)', page: 'receipts-jamma' },
  { id: 'default_expenses-entry', label: 'Expenses (Kharch)', page: 'expenses-entry' },
  { id: 'default_cash-book', label: 'Cash Book', page: 'reports', tab: 'cash-book' },
  { id: 'default_business-ledger', label: 'Business Ledger', page: 'reports', tab: 'business-ledger' },
  { id: 'default_report-stock', label: 'Current Stock', page: 'report-stock' },
  { id: 'default_search-customer', label: 'Search Customer', page: 'search-customer' },
];

let savedSidebarScrollTop = 0;

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

  // Sidebar toggle state (desktop collapse & mobile drawer) - Default is HIDDEN on fresh login, persists across page navigation
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSidebarHidden, setIsSidebarHidden] = useState<boolean>(() => {
    return localStorage.getItem('wento_sidebar_hidden') !== 'false';
  });

  // Top Menu Bar Shortcuts State — pre-seeded with the everyday-use pages on first-ever launch
  // (nothing in localStorage yet); once the user has saved anything of their own (including
  // clearing it down to zero), that always wins from then on.
  const SHORTCUTS_STORAGE_KEY = 'wento_quick_shortcuts_clean_v3';

  const [shortcuts, setShortcuts] = useState<QuickShortcut[]>(() => {
    const saved = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (!saved) return DEFAULT_SHORTCUTS;
    try {
      return JSON.parse(saved);
    } catch {
      return DEFAULT_SHORTCUTS;
    }
  });

  // Drag & Drop Quick Menu State
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Confirmation modal state for shortcut deletion
  const [shortcutToDelete, setShortcutToDelete] = useState<QuickShortcut | null>(null);

  const popupRef = useRef<HTMLDivElement>(null);

  const navRefCallback = (node: HTMLElement | null) => {
    if (node) node.scrollTop = savedSidebarScrollTop;
  };

  const visibleNavSections = useMemo(() => {
    if (state.currentUserRole !== 'User') return navSections;
    return navSections
      .map(section => ({ ...section, items: section.items.filter(item => !item.adminOnly) }))
      .filter(section => section.items.length > 0);
  }, [state.currentUserRole]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowAdminPopup(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function navigate(page: string, tab?: string) {
    dispatch({ type: 'NAVIGATE', page, tab });
    setShowAdminPopup(false);
  }

  const toggleSidebar = () => {
    const nextHidden = !isSidebarHidden;
    setIsSidebarHidden(nextHidden);
    setSidebarOpen(!sidebarOpen);
    localStorage.setItem('wento_sidebar_hidden', String(nextHidden));
  };

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

  const confirmDeleteShortcut = () => {
    if (!shortcutToDelete) return;
    const updated = shortcuts.filter(s => s.id !== shortcutToDelete.id);
    setShortcuts(updated);
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(updated));
    setShortcutToDelete(null);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="app-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Hideable Animated Sidebar */}
      <aside
        data-no-print
        className={`app-sidebar flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out transform ${
          isSidebarHidden ? '-translate-x-full w-0 opacity-0 overflow-hidden pointer-events-none' : 'translate-x-0 w-64 opacity-100'
        }${sidebarOpen ? ' app-sidebar-open' : ''}`}
        style={{ background: 'var(--brand-navy)' }}
      >
        {/* Logo Block (Clean — 3 lines button removed from inside sidebar) */}
        <div className="px-4 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('home')}
              className="flex items-center gap-2.5 min-w-0 text-left"
              title="Home"
            >
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: 'var(--brand-gold)'
                }}
              >
                <span className="font-lora font-bold text-lg" style={{ color: 'var(--brand-navy)' }}>W</span>
              </div>
              <div className="min-w-0">
                <div
                  className="font-lora font-bold tracking-wide text-white truncate"
                  style={{ fontSize: '14.5px', lineHeight: '1.2' }}
                >
                  WENTOX WAREHOUSE
                </div>
                <div
                  className="font-inter tracking-widest uppercase font-semibold"
                  style={{ color: 'var(--brand-gold)', letterSpacing: '1.1px', fontSize: '9px', marginTop: '1px' }}
                >
                  Footwear Distribution
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Navigation - Items are Draggable to Top Quick Access Menu Bar */}
        <nav
          className="flex-1 overflow-y-auto py-2.5 px-3 scrollbar-thin"
          ref={navRefCallback}
          onScroll={(e) => { savedSidebarScrollTop = e.currentTarget.scrollTop; }}
        >
          {visibleNavSections.map((section, sIdx) => (
            <div key={sIdx} className="mb-4">
              <div
                className="px-3 mb-1.5 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-gold)', opacity: 0.9, letterSpacing: '1.2px' }}
              >
                {section.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {section.items.map(item => {
                  const isActive = currentPage === item.page;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.page}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ page: item.page, label: item.label }));
                        setIsDragging(true);
                      }}
                      onDragEnd={() => {
                        setIsDragging(false);
                        setIsDragOver(false);
                      }}
                      onClick={() => navigate(item.page)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors text-left cursor-grab active:cursor-grabbing group relative"
                      style={{
                        background: isActive ? 'var(--brand-gold)' : 'transparent',
                        color: isActive ? 'var(--brand-navy)' : 'rgba(250,248,243,0.72)',
                        fontWeight: isActive ? 600 : 500,
                      }}
                      title="Drag to top Quick Access Menu Bar to pin"
                    >
                      <Icon size={16} />
                      <span style={{ fontSize: '13px' }} className="flex-1 truncate">{item.label}</span>
                      <GripHorizontal size={12} className="opacity-0 group-hover:opacity-60 transition-opacity text-slate-400" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Admin Footer */}
        <div
          className="relative px-3.5 pt-3.5 pb-4"
          style={{ borderTop: '1px solid var(--sidebar-sep)' }}
        >
          {/* Admin Popup */}
          {showAdminPopup && (
            <div
              ref={popupRef}
              className="absolute left-3 right-3 rounded-lg overflow-hidden"
              style={{
                bottom: 'calc(100% + 8px)',
                background: '#22344f',
                border: '1px solid rgba(176,141,87,0.35)',
                boxShadow: '0 14px 34px rgba(0,0,0,0.35)',
              }}
            >
              <button
                onClick={() => navigate('settings')}
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

          <button
            onClick={() => setShowAdminPopup(!showAdminPopup)}
            className="flex items-center gap-3 w-full rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
          >
            <div
              className="flex items-center justify-center rounded-full flex-shrink-0"
              style={{ width: 36, height: 36, background: 'var(--brand-gold)' }}
            >
              <span className="font-inter font-semibold text-xs" style={{ color: 'var(--brand-navy)' }}>
                {state.currentUserRole === 'User' ? 'US' : 'WA'}
              </span>
            </div>
            <div className="flex-1 text-left">
              <div className="text-white font-semibold text-sm">
                {state.currentUserRole === 'User' ? 'Wentox User' : 'Wentox Admin'}
              </div>
              <div style={{ color: 'var(--brand-gold)', fontSize: '11px' }}>
                {state.currentUserRole || 'Administrator'}
              </div>
            </div>
            <ChevronDown
              size={12}
              className="transition-transform"
              style={{ color: 'rgba(255,255,255,0.5)', transform: showAdminPopup ? 'rotate(180deg)' : 'none' }}
            />
          </button>
        </div>
      </aside>

      {/* Main Content */}
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
          {/* Three Lines (Hamburger) Button to Toggle Sidebar */}
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors text-slate-800 flex items-center justify-center shadow-2xs cursor-pointer"
            aria-label="Toggle Sidebar"
            title={isSidebarHidden ? "Show Sidebar" : "Hide Sidebar"}
          >
            <Menu size={22} color="var(--dark-heading)" />
          </button>

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
            <div>{headerAction}</div>
          )}
          <NotificationBell />
        </header>

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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShortcutToDelete(s);
                        }}
                        title="Remove shortcut"
                        className="p-0.5 rounded-full hover:bg-rose-100 hover:text-rose-600 text-slate-400 transition-colors ml-0.5"
                      >
                        <X size={12} />
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

        {/* Content */}
        <main className="app-main flex-1 overflow-auto" style={{ padding: 32 }}>
          <div className="app-main-inner animate-pageIn" style={{ maxWidth: 1200, margin: '0 auto' }}>
            {children}
          </div>
        </main>
      </div>

      {/* Confirmation Dialog Modal for Deleting Shortcut */}
      {shortcutToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full overflow-hidden">
            <div className="bg-[#111c2a] p-4 text-white flex items-center justify-between border-b border-[#B08D57]/40">
              <div className="flex items-center gap-2">
                <Trash2 size={18} className="text-rose-400" />
                <h3 className="font-lora font-bold text-sm text-[#B08D57]">Remove Quick Shortcut?</h3>
              </div>
              <button
                type="button"
                onClick={() => setShortcutToDelete(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 text-xs font-inter text-slate-600">
              <p className="leading-relaxed">
                Are you sure you want to remove <span className="font-bold text-slate-900 font-lora">"{shortcutToDelete.label}"</span> from your top quick access menu bar?
              </p>
              <p className="mt-2 text-[11px] text-slate-400">
                You can easily re-pin it anytime using drag-and-drop or the <span className="font-semibold text-amber-800">+ Pin Page to Bar</span> button.
              </p>

              <div className="flex items-center justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setShortcutToDelete(null)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteShortcut}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-all shadow-xs"
                >
                  Confirm Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
