export interface City {
  id: string; // Code
  name: string;
}

export interface Region {
  id: string; // Code
  name: string;
}

export interface Store {
  id: string;
  name: string;
}

export interface Adda {
  id: string;
  name: string;
}

export interface Vendor {
  id: string;
  name: string;
  phone?: string;
  city?: string;
  regionId?: string;
  baId: string; // linked Business Account under the "Vendors" chart account
}

export type EmployeeType = 'WORKER' | 'SALARIED';

/**
 * A member of staff, of one of two kinds — the same shape as a Vendor: a
 * real-world party that also needs a ledger account.
 *
 *   WORKER    paid per piece, via a WageRun. Has `stages` (his trades), no salary.
 *   SALARIED  paid a fixed amount monthly, via a SalaryRun. Has `monthlySalary`,
 *             no trades.
 *
 * One person is ONE kind. Someone who genuinely does both is entered twice, so
 * no screen has to show one person in two sections.
 *
 * The account a `baId` hangs under is the only thing the type changes at
 * creation: WORKER WAGES (220001) for a worker, SALARIES PAYABLE (220002) for a
 * salaried employee. Both are LIABILITY heads — staff can be owed money between
 * doing the work and being paid, and an EXPENSES account can only accumulate
 * what was paid out, never a balance due.
 */
export interface Employee {
  id: string;
  name: string;
  phone?: string;
  cityId?: string;  // the legacy ledger shows City for employee accounts
  baId: string;     // linked Business Account under the head the type implies
  employeeType: EmployeeType;
  /** WORKER only — the stages he may be paid for. At least one; never empty. */
  stages?: CostFieldKey[];
  /** SALARIED only — the fixed monthly figure, typed when the employee is created. */
  monthlySalary?: number;
}

export interface ProductCategory {
  id: string;
  name: string;
}

// The 12 manufacturing stages, in the order they appear on the form.
// Single source of truth: the product form, the demo data, the Product type,
// an employee's trades and the wage screen all derive from this, so adding or
// renaming a stage is a one-line change.
//
// TWO label sets, one list. On the product form a stage is the COST OF THE WORK
// ("Cutting"); on the wage screen it is THE MAN WHO DOES IT ("Cutter Man").
// Both live here so one definition drives both — the schema does the same thing
// with dbo.stages.form_label / worker_label.
export const COST_FIELDS = [
  { key: 'cutting',     label: 'Cutting',        workerLabel: 'Cutter Man' },
  { key: 'edging',      label: 'Edging',         workerLabel: 'Edge Painting' },
  { key: 'upStitch',    label: 'Up Stitch',      workerLabel: 'Upper Man' },
  { key: 'bending',     label: 'Bending',        workerLabel: 'Bending' },
  { key: 'stubbleDori', label: 'Stubble / Dori', workerLabel: 'Stubble Man' },
  { key: 'shapeForm',   label: 'Shape Form',     workerLabel: 'Shape Form' },
  { key: 'chipkai',     label: 'Chipkai',        workerLabel: 'Chipkai Man' },
  { key: 'bottom',      label: 'Bottom',         workerLabel: 'Bottom Man' },
  { key: 'machine',     label: 'Machine',        workerLabel: 'Machine Man' },
  { key: 'trimming',    label: 'Trimming',       workerLabel: 'Trimming' },
  { key: 'sockStitch',  label: 'Sock Stitch',    workerLabel: 'Socks Stitch' },
  { key: 'finish',      label: 'Finish',         workerLabel: 'Finish' },
] as const;

export type CostFieldKey = typeof COST_FIELDS[number]['key'];

/** Per-stage manufacturing costs. Entered by hand and never aggregated. */
export type ProductCosts = Record<CostFieldKey, number>;

export interface Product extends ProductCosts {
  id: string; // Product Code
  name: string;
  color?: string;
  categoryId: string;
  vendorId: string;
  batchNo: number;
  packing: number;
  // The single price on a product — typed in, never computed from the stage
  // costs above. Used wherever the product is sold.
  salePrice: number;
  stock?: number; // Read-only current stock helper
}

export interface GroupAccount {
  id: string; // Code
  name: string;
  class: 'ASSETS' | 'LIABILITY' | 'INCOME' | 'EXPENSES';
}

export interface ChartOfAccount {
  id: string; // Code
  name: string;
  groupId: string; // parent Group Account
  linkCode: string;
  status: 'Active' | 'Closed';
  // UC-03: hidden from User-role sessions in dropdowns, ledgers, reports, and setup nav — mirrors
  // the backend's chart_of_accounts.is_restricted column. Optional so existing demo rows without
  // it just default to visible (see isRestrictedForRole in lib/access.ts).
  isRestricted?: boolean;
}

export interface BusinessAccount {
  id: string; // Code
  name: string;
  controlId: string;
  linkCode: string;
  region: string; // LOCAL etc.
  status: 'Active' | 'Closed';
  /**
   * What the account already held before WentoX started recording it.
   * A stored INPUT, not a stored balance — the running balance is still
   * derived, it just starts here instead of at zero. Lives on the business
   * account rather than on `BankAccount` because cash needs one, every bank
   * needs one, and so will every customer and vendor at legacy import.
   */
  openingBalance?: number;
  openingDate?: string;
}

/**
 * One of WentoX's own bank accounts. Same party pattern as Vendor and Employee:
 * a profile row plus a unique `baId` — here under BANK ACCOUNTS (120002), a
 * chart account naming the KIND, with banks as the instances beneath it.
 */
export interface BankAccount {
  id: string;
  name: string;       // 'Bank Alfalah A/C - 0124'
  accountNo?: string;
  branch?: string;
  baId: string;       // linked Business Account under BANK ACCOUNTS (120002)
}

/**
 * Money moved between WentoX's OWN accounts — cash banked, bank to bank, or a
 * withdrawal to pay wages in cash.
 *
 * Neither a receipt nor an expense: nobody paid us and we paid nobody.
 * Recording it as an expense-plus-receipt pair would inflate both income and
 * expenditure with money that never left the business, so every report built on
 * those totals would read wrong. Hence its own document — and it must be
 * excluded from every income and expense total.
 */
export interface Transfer {
  id: string;
  date: string;
  fromBaId: string;
  toBaId: string;
  amount: number;
  remarks?: string;
}

/**
 * A manual adjustment to a cash/bank account's balance from OUTSIDE WentoX's
 * own recorded books — owner capital or a bank loan credited in (`credit`),
 * or a bank charge, error correction, or unrecorded withdrawal debited out
 * (`debit`).
 *
 * Distinct from a Receipt (always tied to a customer, feeds customer ledgers/
 * aging) and from a Transfer (moves money already recorded between our own
 * accounts, nets to zero). This has no counter-account inside the books —
 * it is money appearing or disappearing from outside — so it is its own
 * document with a `source` describing why, for the audit trail.
 */
export interface Deposit {
  id: string;
  date: string;
  toBaId: string;   // the cash/bank Business Account being adjusted
  direction: 'credit' | 'debit';
  amount: number;
  source: string;   // e.g. "Owner Capital", "Bank Loan", "Bank Charges"
  remarks?: string;
}

export interface Customer {
  id: string; // Code
  name: string;
  acId: string; // Chart of Account ID (parent group, e.g. '110001' CUSTOMERS ACCOUNTS)
  // Linked Business Account leaf (e.g. '11000101') — mirrors Vendor.baId. Optional: matches the
  // real schema's nullable customers.ba_id ("please add customer account first").
  baId?: string;
  regionId: string; // primary identification, checked before City
  cityId: string;
}

export interface SubCustomer {
  id: string; // Code
  name: string;
}

export interface SaleBillItem {
  id: string;
  productId: string;
  productName: string;
  packing: number;
  cartons: number;
  pairs: number;
  rate: number;
  discountPercent: number;
  discountValue: number;
  value: number;
}

export interface SaleBill {
  id: string; // Auto-generated PK
  date: string;
  storeId: string; // e.g. MAIN STORE LHR
  customerId: string;
  subCustomerId: string | null;
  customAddress?: string;
  mainAcId?: string;
  billNo: string; // manual bill number
  gpNo: string; // GP number
  biltyNo: string; // bilty number
  addaId: string; // Adda code reference
  remarks: string;
  invoiceDiscount: number;
  totalValue: number;
  dueDate?: string; // optional — blank means no payment-overdue alert for this bill
  status: 'Posted' | 'Unposted';
  items: SaleBillItem[];
}

export interface SaleReturnItem {
  id: string;
  productId: string;
  productName: string;
  packing: number;
  cartons: number;
  pairs: number;
  rate: number;
  discountPercent: number;
  discountValue: number;
  value: number;
}

export interface SaleReturn {
  id: string; // Auto-generated PK
  date: string;
  storeId: string; // destination store (TO)
  customerId: string;
  subCustomerId: string | null;
  billNo: string; // manual bill number
  gpNo: string;
  biltyNo: string;
  remarks: string;
  invoiceDiscount?: number;
  status: 'Posted' | 'Unposted';
  items: SaleReturnItem[];
}

// RETURNED = an overdue cheque handed back to the customer voluntarily (not a bank rejection —
// that's BOUNCED). Same reversal mechanics as BOUNCED (customer due restored, allocations
// reversed), kept as its own terminal status so the two are distinguishable in reports/history.
export type ChequeStatus = 'PENDING' | 'DEPOSITED' | 'ENDORSED' | 'PARTIALLY_ENDORSED' | 'CLEARED' | 'BOUNCED' | 'RETURNED';

// TASK-14: Admin = full access. User = everything except Bank Accounts and
// Director Expenses - Drawings accounts.
export type UserRole = 'Admin' | 'User';

/** You can only ever RECEIVE someone else's cheque, so no split is needed here. */
export type ReceiptMode = 'Cash' | 'Cheque' | 'Online';

export interface Receipt {
  id: string; // Auto PK
  date: string;
  customerId: string;
  amount: number;
  commission?: number; // payment-time only, reduces payable — never changes the sale bill
  paymentMode: ReceiptMode;
  /** ONLINE only — which of our bank accounts the money landed in. */
  bankId?: string;
  details: string; // bank details, online ref, etc.
  chequeNo?: string;
  chequeDate?: string; // date written on the cheque
  chequeReceivedDate?: string; // date physically received
  chequeStatus?: ChequeStatus;
  /**
   * CHEQUE only — which bank it was deposited into. Held on the cheque (here,
   * the receipt) rather than on the allocation, because one cheque is never
   * split across two banks. Set when the DEPOSIT disposition is recorded.
   */
  depositBankId?: string;
  bouncedDate?: string; // date the bounce was recorded — reversing entries are dated here
  returnedDate?: string; // date the cheque was returned to the sender — reversing entries are dated here
  remarks: string;
}

// §13 — a received cheque is a pool of value allocated across one or more
// destinations until its unallocated balance reaches zero.
export type ChequeDisposition = 'DEPOSIT' | 'VENDOR_PAYMENT' | 'EXPENSE_PAYMENT';

export interface ChequeAllocation {
  id: string;
  receiptId: string;
  dispositionType: ChequeDisposition;
  targetType: 'VENDOR' | 'BUSINESS_ACCOUNT' | null; // null for DEPOSIT
  targetId: string | null;                          // vendorId or businessAccountId
  amount: number;
  allocationDate: string;
  remarks: string;
  // REVERSED = the sourcing cheque bounced. The row is kept, not deleted:
  // history stays intact and a counter-entry is posted on the bounce date.
  status: 'ACTIVE' | 'REVERSED';
}

// §12 — alerts are derived live from state; only the dismissal is stored.
export interface AlertDismissal {
  alertKey: string;
  dismissedAt: string;
}

export type AlertKind = 'CHEQUE_DUE' | 'PAYMENT_OVERDUE';
export type AlertSeverity = 'overdue' | 'due-soon';

export interface AppAlert {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  date: string;   // the cheque/due date driving the alert
  amount: number;
  targetPage: string;
  targetTab?: string;
}

/**
 * "Cheque" means two different things when money goes OUT, and they credit
 * different accounts — so they are different modes, not one:
 *
 *   ChequeEndorsed  hand on a cheque a customer gave us  → Cr CHEQUES IN HAND
 *   ChequeIssued    write our own cheque on our bank     → Cr the selected bank
 */
export type ExpenseMode = 'Cash' | 'ChequeEndorsed' | 'ChequeIssued' | 'Online';

export interface Expense {
  id: string; // Auto PK
  date: string;
  businessAccountId: string;   // WHO was paid
  amount: number;
  paymentMode: ExpenseMode;
  /** Online and ChequeIssued — which of our accounts the money left. */
  bankId?: string;
  /** ChequeEndorsed — the receipt holding the cheque being handed on. */
  chequeId?: string;
  /**
   * ChequeIssued — the cheque we wrote. Deliberately not a cheque record of its
   * own: the bank is deducted the day it is written, so there is no pending
   * state to model — only the number and date, for tracing it on a statement.
   */
  issuedChequeNo?: string;
  issuedChequeDate?: string;
  details: string;
  remarks: string;
}

export interface PurchaseItem {
  id: string;
  materialName: string; // free text, raw material — not linked to Product
  unit: string; // e.g. Meters, Buckles, KG — dropdown or self-typed
  quantity: number;
  pricePerUnit: number;
  totalPrice: number; // auto = quantity * pricePerUnit
}

export interface Purchase {
  id: string; // Auto-generated PK
  date: string;
  vendorId: string;
  remarks: string;
  items: PurchaseItem[];
  totalValue: number;
}

export interface PurchaseReturnItem {
  id: string;
  materialName: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
  totalPrice: number;
}

export interface PurchaseReturn {
  id: string; // Auto-generated PK
  date: string;
  vendorId: string;
  remarks: string;
  items: PurchaseReturnItem[];
  totalValue: number;
}

export interface ProductionLog {
  id: string;
  date: string;
  productId: string;
  quantity: number; // total pairs
  qtyValue: number; // input quantity
  unitType: 'cartons' | 'pairs';
  packing: number;
}

/* ─────────────────────────── Payroll ───────────────────────────
 * Two accrual documents, one per kind of staff. Both behave like a sale bill:
 * Posted counts toward a balance, Unposted counts toward nothing, and the way
 * back from a mistake is unpost → edit → post rather than a reversing entry.
 * See System_architecture/payroll.md.
 */

/**
 * One article on a wage run. `amount` = rate × cartons × packing — the rate is
 * PER PAIR and the quantity is in CARTONS, so the article's own packing is the
 * multiplier (a 24-pair article multiplies by 24, not 12).
 *
 * `rate` and `packing` are SNAPSHOTS, deliberately duplicating the product.
 * The whole point is that they STOP matching when the product is edited —
 * without them, changing one stage cost would rewrite every wage ever paid at
 * that rate, with no record of what the worker actually received.
 */
export interface WageRunItem {
  id: string;
  productId: string;
  productName: string;
  rate: number;     // SNAPSHOT of the product's cost for this run's stage
  cartons: number;  // QUANTITY as entered
  packing: number;  // SNAPSHOT of the product's packing
  amount: number;   // rate × cartons × packing
}

/** One piece-rate settlement: one worker, one stage, many article lines. */
export interface WageRun {
  id: string;
  employeeId: string;
  stage: CostFieldKey;
  /** The SETTLEMENT date, not a work date — a run may cover a week or a fortnight. */
  date: string;
  totalAmount: number;
  status: 'Posted' | 'Unposted';
  unpostedAt?: string;    // last time it went Posted → Unposted
  amountBefore?: number;  // totalAmount at that moment
  items: WageRunItem[];
}

/**
 * One salaried employee's line on a month's salary run.
 *
 * TWO amounts, and the difference is the point: `salaryAmount` is the snapshot
 * of what their salary was, `amount` is what was actually credited. Equal in a
 * normal month. When they differ the deduction is visible AND explicable
 * (`remarks`), instead of the ledger quietly disagreeing with the employee's
 * stated salary. One column could not tell you whether 35,000 was a deduction
 * or simply their salary at the time.
 */
export interface SalaryRunItem {
  id: string;
  employeeId: string;
  salaryAmount: number;  // SNAPSHOT of employee.monthlySalary
  amount: number;        // what was credited — editable, pre-filled from salaryAmount
  remarks?: string;
}

/** One month's salary accrual, covering every active salaried employee. */
export interface SalaryRun {
  id: string;
  /** 'YYYY-MM' — the month being paid for. One Posted run per month. */
  periodMonth: string;
  date: string;          // when it was posted
  totalAmount: number;
  status: 'Posted' | 'Unposted';
  unpostedAt?: string;
  amountBefore?: number;
  items: SalaryRunItem[];
}

export type NavPage =
  | 'login'
  | 'home'
  | 'sale-bill'
  | 'sale-return'
  | 'purchase-entry'
  | 'purchase-return'
  | 'find-bill'
  | 'weekly-records'
  | 'monthly-records'
  | 'overall-records'
  | 'receipts-jamma'
  | 'expenses-entry'
  | 'wage-run'
  | 'salary-run'
  | 'transfer'
  | 'setup-bank'
  | 'setup-product'
  | 'setup-category'
  | 'setup-vendor'
  | 'setup-employee'
  | 'setup-customer'
  | 'setup-group-ac'
  | 'setup-chart-ac'
  | 'setup-business-ac'
  | 'setup-sub-cust'
  | 'setup-city'
  | 'setup-region'
  | 'setup-adda'
  | 'report-stock'
  | 'reports'
  | 'bilty-update'
  | 'settings';
