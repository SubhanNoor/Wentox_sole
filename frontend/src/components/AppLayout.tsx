import { useState, useRef, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import {
  ShoppingCart, Receipt, Package, FileText, Layers,
  Settings, LogOut, Lock, Menu, X, ChevronDown, MapPin, Home,
  Users, Folder, BookOpen, DollarSign, ListCollapse, Wallet, Truck, Milestone, ShoppingBag, Undo2, Search, HardHat,
  BadgeDollarSign
} from 'lucide-react';
import type { NavPage } from '@/types';
import NotificationBell from '@/components/NotificationBell';

interface NavItem {
  page: NavPage;
  label: string;
  icon: React.ComponentType<{ size: number; className?: string }>;
}

interface NavSection {
  title: string;
  items: NavItem[];
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
      // Payroll accrual — under Transactions, not Setup, because these post
      // financial entries. Paying staff is still an Expense above.
      { page: 'wage-run', label: 'Wage Run (Piece Rate)', icon: HardHat },
      { page: 'salary-run', label: 'Salary Run (Monthly)', icon: BadgeDollarSign },
    ]
  },
  {
    title: 'Reports',
    items: [
      { page: 'report-stock', label: 'Current Stock', icon: Package },
      { page: 'reports', label: 'Reports', icon: FileText },
      { page: 'bilty-update', label: 'Search & Bilty Adda Updation', icon: Search },
    ]
  },
  {
    title: 'System Setup',
    items: [
      { page: 'setup-product', label: 'Product Details', icon: Folder },
      { page: 'setup-category', label: 'Categories', icon: Layers },
      { page: 'setup-vendor', label: 'Vendors', icon: Truck },
      { page: 'setup-employee', label: 'Employees', icon: HardHat },
      { page: 'setup-customer', label: 'Customers', icon: Users },
      { page: 'setup-sub-cust', label: 'Sub Customers', icon: Users },
      { page: 'setup-city', label: 'City Creation', icon: MapPin },
      { page: 'setup-region', label: 'Regions', icon: MapPin },
      { page: 'setup-adda', label: 'Transport Addas', icon: Milestone },
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

interface AppLayoutProps {
  children: React.ReactNode;
  pageTitle: string;
  headerAction?: React.ReactNode;
}

export default function AppLayout({ children, pageTitle, headerAction }: AppLayoutProps) {
  const { state, dispatch } = useApp();
  const [showAdminPopup, setShowAdminPopup] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowAdminPopup(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [state.currentPage]);

  function navigate(page: string) {
    dispatch({ type: 'NAVIGATE', page });
    setShowAdminPopup(false);
    setSidebarOpen(false);
  }

  const currentPage = state.currentPage;

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="app-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        data-no-print
        className={`app-sidebar flex flex-col flex-shrink-0${sidebarOpen ? ' app-sidebar-open' : ''}`}
        style={{ width: 256, background: 'var(--brand-navy)' }}
      >
        {/* Logo Block */}
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
            <button
              onClick={() => setSidebarOpen(false)}
              className="sidebar-close-btn"
              aria-label="Close menu"
            >
              <X size={20} color="#ffffff" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2.5 px-3 scrollbar-thin">
          {navSections.map((section, sIdx) => (
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
                      onClick={() => navigate(item.page)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors text-left"
                      style={{
                        background: isActive ? 'var(--brand-gold)' : 'transparent',
                        color: isActive ? 'var(--brand-navy)' : 'rgba(250,248,243,0.72)',
                        fontWeight: isActive ? 600 : 500,
                      }}
                    >
                      <Icon size={16} />
                      <span style={{ fontSize: '13px' }}>{item.label}</span>
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
              {state.currentUserRole === 'Admin' && (
              <button
                onClick={() => navigate('settings')}
                className="flex items-center gap-2 w-full px-3.5 py-3 text-sm transition-colors hover:bg-white/5"
                style={{ color: 'rgba(250,248,243,0.85)' }}
              >
                <Lock size={14} />
                <span>Change Password</span>
              </button>
              )}
              <div style={{ borderTop: '1px solid var(--sidebar-sep)' }} />
              <button
                onClick={() => dispatch({ type: 'LOGOUT' })}
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
        {/* Header */}
        <header
          data-no-print
          className="app-header flex items-center gap-4 px-8 flex-shrink-0"
          style={{
            height: 66,
            background: 'var(--app-bg)',
            borderBottom: '1px solid var(--border-color)'
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="hamburger-btn"
            aria-label="Open menu"
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
            {/* Page title */}
            <h1
              className="font-lora font-semibold capitalize truncate"
              style={{ fontSize: '24px', color: 'var(--dark-heading)' }}
            >
              {pageTitle}
            </h1>
          </div>
          {headerAction && (
            <div>{headerAction}</div>
          )}
          {/* §12 — system-wide alert bell, not tucked inside Reports */}
          <NotificationBell />
        </header>

        {/* Content */}
        <main className="app-main flex-1 overflow-auto" style={{ padding: 32 }}>
          <div className="app-main-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
