import type { NavPage } from '@/types';

/**
 * The classic menu bar from the client's previous software (see `ref-pics/`): five menus across the
 * top, each opening on HOVER and listing its pages with the original numbers. It replaces the left
 * sidebar entirely and sits directly above the Quick Menu row.
 *
 * Numbering is the legacy numbering, deliberately including its gaps. The old menu itself skipped
 * (2.1, 2.3, 2.4, 2.13 — no 2.2), and items whose page this app doesn't have are left out rather
 * than shown dead, so more gaps appear. Keeping the real numbers matters more than making them
 * consecutive: staff navigate by "3.16" the way they navigate by name. Pages this app has that the
 * old menu never had are appended inside the same group with fresh numbers, so nothing collides
 * with a number somebody already knows.
 */

export interface MenuItem {
  /** Legacy menu number, e.g. '1.1' or '3.16'. Rendered in its own column. */
  no: string;
  label: string;
  page: NavPage;
  /** Sub-tab within the target page — the Reports Hub's tabs, Settings' backup card. */
  tab?: string;
  /** Hidden from a non-admin, matching the sidebar's own adminOnly filter. */
  adminOnly?: boolean;
}

export interface MenuGroup {
  /** Top-level button label, e.g. '1.SETUP'. */
  title: string;
  /** A `null` entry renders a separator, as the legacy menu had between 1.8 and 1.9. */
  items: (MenuItem | null)[];
}

export const MENU_GROUPS: MenuGroup[] = [
  {
    title: '1.SETUP',
    items: [
      // 1.2 CONTROL ACCOUNTS -> this app's Chart of Accounts page. database_schema_v4.3.md records
      // chart_accounts.ac_id as "was control_id", i.e. the app's chart accounts ARE the legacy
      // control-account level. (project_overview.md describes Chart of Accounts as the level below
      // Control instead — the two docs disagree; the schema wins.) Legacy 1.3 MAIN ACCOUNTS has no
      // separate page here: 1.1/1.2/1.6 already cover all three levels this app models.
      { no: '1.1', label: 'GROUP ACCOUNTS', page: 'setup-group-ac' },
      { no: '1.2', label: 'CONTROL ACCOUNTS', page: 'setup-chart-ac' },
      { no: '1.4', label: 'SUB CUSTOMER', page: 'setup-sub-cust' },
      { no: '1.5', label: 'CITY', page: 'setup-city' },
      { no: '1.6', label: 'BUSINESS ACCOUNTS', page: 'setup-business-ac' },
      { no: '1.7', label: 'PRODUCT CATEGORY', page: 'setup-category' },
      { no: '1.8', label: 'PRODUCT DETAILS', page: 'setup-product' },
      null,
      { no: '1.10', label: 'BILTY ADDA', page: 'setup-adda' },
      null,
      // Appended: pages this app has that the legacy menu never listed.
      { no: '1.11', label: 'CUSTOMERS', page: 'setup-customer' },
      { no: '1.12', label: 'VENDORS', page: 'setup-vendor' },
      { no: '1.13', label: 'EMPLOYEES', page: 'setup-employee' },
      { no: '1.14', label: 'BANK ACCOUNTS', page: 'setup-bank', adminOnly: true },
      { no: '1.15', label: 'REGIONS', page: 'setup-region' },
      { no: '1.16', label: 'STORE SETUP', page: 'setup-store' },
      { no: '1.17', label: 'MANAGE USERS', page: 'setup-users', adminOnly: true },
      { no: '1.18', label: 'SETTINGS', page: 'settings' },
      null,
      // Last in the group, exactly as in the legacy menu.
      { no: '', label: 'DATABASE BACKUP', page: 'settings', tab: 'backup' },
    ],
  },
  {
    title: '2.DATA ENTRY',
    items: [
      // Legacy 2.1 FINISHED STOCK TRANSFER is inter-store stock movement — change request ST-01,
      // deferred by decision, so there is no page to point at yet.
      // Legacy 2.13 DAY BOOK ENTRY is the old single daily cash screen; this app splits it into
      // Receipts (Jamma) and Payments (Naam) below, so a third entry would be misleading.
      { no: '2.3', label: 'SALE / BILL', page: 'sale-bill' },
      { no: '2.4', label: 'SALE RETURN', page: 'sale-return' },
      null,
      { no: '2.14', label: 'PURCHASE', page: 'purchase-entry' },
      { no: '2.15', label: 'PURCHASE RETURN', page: 'purchase-return' },
      null,
      { no: '2.16', label: 'RECEIPTS (JAMMA)', page: 'receipts-jamma' },
      { no: '2.17', label: 'PAYMENTS (NAAM)', page: 'expenses-entry' },
      { no: '2.18', label: 'WAGE RUN (PIECE RATE)', page: 'wage-run' },
      { no: '2.19', label: 'SALARY RUN (MONTHLY)', page: 'salary-run' },
      { no: '2.20', label: 'TRANSFER (CASH / BANK)', page: 'transfer', adminOnly: true },
      { no: '2.21', label: 'JOURNAL VOUCHER', page: 'journal-voucher' },
      { no: '2.22', label: 'CHEQUE', page: 'cheque-return' },
      null,
      { no: '2.23', label: 'SEARCH & BILTY ADDA UPDATION', page: 'bilty-update' },
    ],
  },
  {
    title: '3.ACCOUNT REPORTS',
    items: [
      // Left out for want of a page: 3.3 TRAIL BALANCES, 3.10 CHART OF ACCOUNTS LIST,
      // 3.15 CUSTOMER AGING, 3.17 CUSTOMER BALANCES, 3.20 POST DATED CHEQUE POCKET.
      { no: '3.1', label: 'MAIN ACCOUNTS LEDGER REPORT', page: 'reports', tab: 'account-ledger' },
      { no: '3.9', label: 'BUSINESS ACCOUNT LEDGER (KHAATA)', page: 'reports', tab: 'business-ledger' },
      { no: '3.16', label: 'CASH BOOK SUMMARY', page: 'reports', tab: 'cash-book' },
      { no: '3.18', label: 'VENDORS BALANCES', page: 'reports', tab: 'vendor' },
      { no: '3.19', label: 'TRACK CHEQUE', page: 'cheque-return' },
      { no: '3.21', label: 'RECEIPTS AND PAYMENT TRAIL', page: 'reports', tab: 'payment-trail' },
      { no: '3.22', label: 'PAYMENT TRAIL ALL ACCOUNTS', page: 'reports', tab: 'overall-trail' },
      null,
      { no: '3.23', label: 'SEARCH CUSTOMER', page: 'search-customer' },
      { no: '3.24', label: 'OVERALL SEARCHING', page: 'overall-search' },
    ],
  },
  {
    title: '4.STOCK REPORTS',
    items: [
      // Left out for want of a page: 4.1 PRODUCT LIST REPORT, 4.4 WEEKLY IN AND OUT,
      // 4.5 12 MONTHS IN AND OUT.
      { no: '4.2', label: 'STOCK LEDGER REPORT', page: 'reports', tab: 'product-ledger' },
      { no: '4.3', label: 'CURRENT STOCK REPORT', page: 'report-stock' },
    ],
  },
  {
    title: '5.SALE REPORTS',
    items: [
      // Left out for want of a page: 5.6/5.7/5.8 MONTHLY SALE COMPARISON, 5.11 SALE RATE LIST.
      // 5.4 CUSTOMER WISE SALES ANALYSIS opens the same Sale Analysis screen as 5.2, so it is not
      // listed twice.
      { no: '5.2', label: 'SALES ANALYSIS REPORT', page: 'reports', tab: 'sale-analysis' },
      { no: '5.10', label: 'SALE / BILL LIST REPORT', page: 'reports', tab: 'sale-report' },
    ],
  },
];
