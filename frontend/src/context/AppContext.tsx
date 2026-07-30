import React, { createContext, useContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type {
  City, Region, Store, Adda, Vendor, Worker, ProductCategory, Product,
  GroupAccount, ChartOfAccount, BusinessAccount,
  Customer, SubCustomer, SaleBill, SaleReturn, Purchase, PurchaseReturn,
  Receipt, Expense, ProductionLog, UserRole,
  ChequeAllocation, ChequeStatus, AlertDismissal
} from '@/types';
import { deriveChequeStatus } from '@/lib/cheques';

// TASK-14: fixed second demo account, alongside the editable Admin
// credential in state.settings. Not stored in state / not editable via
// Settings — it's a static demo login, same as how Admin worked before.
const DEMO_USER_ACCOUNT = { username: 'user', password: 'user' };

/* ──────────────────── Demo Data ──────────────────── */

const demoCities: City[] = [
  { id: 'ct1', name: 'Lahore' },
  { id: 'ct2', name: 'Karachi' },
  { id: 'ct3', name: 'Hyderabad' },
  { id: 'ct4', name: 'Mardan' },
  { id: 'ct5', name: 'Multan' },
  { id: 'ct6', name: 'Sukkur' },
];

const demoRegions: Region[] = [
  { id: 'rg1', name: 'LOCAL' },
  { id: 'rg2', name: 'NORTH' },
  { id: 'rg3', name: 'SOUTH' },
  { id: 'rg4', name: 'CENTRAL' },
];

const demoStores: Store[] = [
  { id: 'st1', name: 'MAIN STORE LHR' },
  { id: 'st2', name: 'SECONDARY STORE SHP' },
];

const demoAddas: Adda[] = [
  { id: 'ad1', name: 'Karachi Goods Transport' },
  { id: 'ad2', name: 'Peshawar Niazi Cargo' },
  { id: 'ad3', name: 'Multan Adda Service' },
  { id: 'ad4', name: 'Sukkur Cargo Express' },
];

const demoVendors: Vendor[] = [
  { id: 'v1', name: 'Decent Polyurethane', phone: '0300-1234567', city: 'Lahore', regionId: 'rg1', baId: '21000101' },
  { id: 'v2', name: 'Lahore Chemical Industries', phone: '042-3588991', city: 'Lahore', regionId: 'rg1', baId: '21000102' },
  { id: 'v3', name: 'Star Sole Materials', phone: '0321-7654321', city: 'Karachi', regionId: 'rg3', baId: '21000103' },
];

// Workers are paid piece-rate per manufacturing stage. Their ledger accounts sit
// under WORKER WAGES (220001) — a LIABILITY, like vendors, because a worker can
// be owed money between doing the work and being paid. Payment Trail's
// "Employees" row sums payments made against these accounts.
const demoWorkers: Worker[] = [
  { id: 'w1', name: 'Noman Butt', phone: '0301-4455661', cityId: 'ct1', baId: '2200010001' },
  { id: 'w2', name: 'Zafar Hussain', phone: '0333-7788992', cityId: 'ct1', baId: '2200010002' },
  { id: 'w3', name: 'Imran Amir', cityId: 'ct1', baId: '2200010003' },
];

const demoCategories: ProductCategory[] = [
  { id: 'cat1', name: 'Jogger Sole (PU)' },
  { id: 'cat2', name: 'Slipper Sole (EVA)' },
  { id: 'cat3', name: 'Formal Shoe Sole (PVC)' },
  { id: 'cat4', name: 'Kito Sole (TPR)' },
];

const demoProducts: Product[] = [
  {
    id: '1001', name: 'P-101 Jogger Sole Black', categoryId: 'cat1', vendorId: 'v1', batchNo: 405, packing: 12,
    salePrice: 470, cutting: 18, edging: 6, upStitch: 22, bending: 9, stubbleDori: 10, shapeForm: 14,
    chipkai: 7, bottom: 40, machine: 12, trimming: 5, sockStitch: 6, finish: 8, stock: 150
  },
  {
    id: '1002', name: 'P-102 Jogger Sole White', categoryId: 'cat1', vendorId: 'v1', batchNo: 405, packing: 12,
    salePrice: 480, cutting: 18, edging: 6, upStitch: 22, bending: 9, stubbleDori: 10, shapeForm: 14,
    chipkai: 7, bottom: 40, machine: 12, trimming: 5, sockStitch: 6, finish: 8, stock: 95
  },
  {
    id: '1004', name: 'P-101 Jogger Sole White', categoryId: 'cat1', vendorId: 'v1', batchNo: 405, packing: 12,
    salePrice: 470, cutting: 18, edging: 6, upStitch: 22, bending: 9, stubbleDori: 10, shapeForm: 14,
    chipkai: 7, bottom: 40, machine: 12, trimming: 5, sockStitch: 6, finish: 8, stock: 60
  },
  {
    id: '2001', name: 'E-551 Casual Slipper Brown', categoryId: 'cat2', vendorId: 'v2', batchNo: 120, packing: 12,
    salePrice: 260, cutting: 10, edging: 4, upStitch: 0, bending: 5, stubbleDori: 5, shapeForm: 8,
    chipkai: 4, bottom: 20, machine: 8, trimming: 4, sockStitch: 0, finish: 5, stock: 320
  },
  {
    id: '3001', name: 'F-909 Formal Oxford Sole Black', categoryId: 'cat3', vendorId: 'v3', batchNo: 789, packing: 12,
    salePrice: 640, cutting: 28, edging: 11, upStitch: 35, bending: 14, stubbleDori: 15, shapeForm: 20,
    chipkai: 9, bottom: 60, machine: 15, trimming: 8, sockStitch: 10, finish: 12, stock: 80
  },
];

const demoGroupAccounts: GroupAccount[] = [
  { id: '1000', name: 'ASSETS', class: 'ASSETS' },
  { id: '2000', name: 'LIABILITY', class: 'LIABILITY' },
  { id: '3000', name: 'INCOME', class: 'INCOME' },
  { id: '4000', name: 'EXPENSES', class: 'EXPENSES' },
];

const demoChartAccounts: ChartOfAccount[] = [
  { id: '110001', name: 'CUSTOMERS ACCOUNTS', groupId: '1000', linkCode: 'A', status: 'Active' },
  { id: '120001', name: 'CASH IN HAND', groupId: '1000', linkCode: 'A', status: 'Active' },
  { id: '120002', name: 'BANK ALFALAH AC - 0124', groupId: '1000', linkCode: 'A', status: 'Active' },
  // Cheques received but not yet deposited or endorsed (§13). Near-cash, so it
  // sits with cash & bank. An endorsement credits it; a deposit moves it to bank.
  { id: '120003', name: 'CHEQUES IN HAND', groupId: '1000', linkCode: 'A', status: 'Active' },
  { id: '210001', name: 'VENDORS ACCOUNTS', groupId: '2000', linkCode: 'A', status: 'Active' },
  { id: '220001', name: 'WORKER WAGES', groupId: '2000', linkCode: 'A', status: 'Active' },
  { id: '310001', name: 'WHOLESALE SHOE SALES', groupId: '3000', linkCode: 'A', status: 'Active' },
  // The cost side of wages. WORKER WAGES (220001) is what we OWE a worker;
  // this is what the labour COSTS us. A wage earned debits here and credits the
  // worker's account — the same shape as Purchase debiting PURCHASES and
  // crediting the vendor. Nothing posts to it until wage accrual is built.
  { id: '410001', name: 'WAGES EXPENSE', groupId: '4000', linkCode: 'A', status: 'Active' },
  { id: '420001', name: 'UTILITIES & BILLS EXPENSE', groupId: '4000', linkCode: 'A', status: 'Active' },
  // Cost of raw material bought from vendors. A Purchase debits here and credits
  // the vendor's account — the same two-sided shape wages now have.
  { id: '430001', name: 'PURCHASES', groupId: '4000', linkCode: 'A', status: 'Active' },
  { id: '440001', name: 'DIRECTORS EXPENSES - DRAWINGS', groupId: '4000', linkCode: 'A', status: 'Active' },
  // Commission given at payment time (§7) — a cost, never a sale-time discount.
  // A Receipt's commission debits here and credits the customer.
  { id: '450001', name: 'COMMISSION ALLOWED', groupId: '4000', linkCode: 'A', status: 'Active' },
];

const demoBusinessAccounts: BusinessAccount[] = [
  { id: '11000101', name: 'Ahmed Footwear (LHR)', controlId: '110001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '11000102', name: 'Karachi Boot House (KHI)', controlId: '110001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '11000103', name: 'Malik Traders (HYD)', controlId: '110001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '11000104', name: 'Mardan Shoe Mart (MRD)', controlId: '110001', linkCode: 'A', region: 'NORTH', status: 'Active' },
  { id: '12000101', name: 'Lahore Cash Vault', controlId: '120001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '42000101', name: 'Office Utilities A/C', controlId: '420001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '21000101', name: 'Decent Polyurethane A/C', controlId: '210001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '21000102', name: 'Lahore Chemical Industries A/C', controlId: '210001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '21000103', name: 'Star Sole Materials A/C', controlId: '210001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '44000101', name: "Director's Drawings A/C", controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010001', name: 'Noman Butt A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010002', name: 'Zafar Hussain A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010003', name: 'Imran Amir A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
];

const demoCustomers: Customer[] = [
  { id: 'c1', name: 'Ahmed Footwear (LHR)', acId: '110001', regionId: 'rg1', cityId: 'ct1' },
  { id: 'c2', name: 'Karachi Boot House (KHI)', acId: '110001', regionId: 'rg3', cityId: 'ct2' },
  { id: 'c3', name: 'Malik Traders (HYD)', acId: '110001', regionId: 'rg3', cityId: 'ct3' },
  { id: 'c4', name: 'Mardan Shoe Mart (MRD)', acId: '110001', regionId: 'rg2', cityId: 'ct4' },
];

const demoSubCustomers: SubCustomer[] = [
  { id: 'sub1', name: 'Saleem Transport Agent' },
  { id: 'sub2', name: 'Liaqat Traders Karachi' },
  { id: 'sub3', name: 'Ghafoor Bakhsh Agency' },
  { id: 'sub4', name: 'Khyber Delivery Hub' },
];

const demoSaleBills: SaleBill[] = [
  {
    id: 'sb1',
    date: '2026-07-01',
    storeId: 'st1',
    customerId: 'c1',
    subCustomerId: 'sub1',
    billNo: '10045',
    gpNo: '2301',
    biltyNo: '98451',
    addaId: 'ad3',
    remarks: 'Delivered in good condition',
    invoiceDiscount: 500,
    totalValue: 9100,
    status: 'Posted',
    items: [
      { id: 'sbi1', productId: '1001', productName: 'P-101 Jogger Sole Black', packing: 12, cartons: 2, pairs: 24, rate: 450, discountPercent: 10, discountValue: 1080, value: 9720 },
    ]
  },
  {
    id: 'sb2',
    date: '2026-07-03',
    storeId: 'st1',
    customerId: 'c2',
    subCustomerId: 'sub2',
    billNo: '10046',
    gpNo: '2305',
    biltyNo: '87412',
    addaId: 'ad1',
    remarks: 'Fast shipment requested',
    invoiceDiscount: 1000,
    totalValue: 15600,
    status: 'Unposted',
    items: [
      { id: 'sbi2', productId: '1002', productName: 'P-102 Jogger Sole White', packing: 12, cartons: 3, pairs: 36, rate: 500, discountPercent: 5, discountValue: 900, value: 17100 },
    ]
  },
  {
    // Posted, with an explicit due date already in the past and a balance still
    // outstanding — this is what raises a payment-overdue alert. A bill left
    // without a due date never alerts, by design.
    id: 'sb3',
    date: '2026-06-20',
    storeId: 'st1',
    customerId: 'c3',
    subCustomerId: null,
    billNo: '10047',
    gpNo: '2311',
    biltyNo: '90233',
    addaId: 'ad4',
    remarks: 'Bulk order — credit terms agreed',
    invoiceDiscount: 0,
    totalValue: 250000,
    dueDate: '2026-07-10',
    status: 'Posted',
    items: [
      { id: 'sbi3', productId: '2001', productName: 'E-551 Casual Slipper Brown', packing: 12, cartons: 40, pairs: 480, rate: 520, discountPercent: 0, discountValue: 0, value: 249600 },
    ]
  }
];

const demoSaleReturns: SaleReturn[] = [
  {
    id: 'sr1',
    date: '2026-07-02',
    storeId: 'st1',
    customerId: 'c1',
    subCustomerId: 'sub-same',
    billNo: 'RET-001',
    gpNo: '0',
    biltyNo: '0',
    remarks: 'Defective batch returned',
    status: 'Posted',
    items: [
      { id: 'sri1', productId: '1001', productName: 'P-101 Jogger Sole Black', packing: 12, cartons: 1, pairs: 12, rate: 450, discountPercent: 0, discountValue: 0, value: 5400 }
    ]
  }
];

const demoReceipts: Receipt[] = [
  { id: 'r1', date: '2026-07-02', customerId: 'c1', amount: 15000, paymentMode: 'Cash', details: 'Direct cash deposit', remarks: 'Part payment' },
  // Cheque already past its date — shows as an overdue (red) alert.
  {
    id: 'r2', date: '2026-07-04', customerId: 'c2', amount: 50000, paymentMode: 'Cheque',
    details: 'HBL, Gulberg Branch',
    chequeNo: '9812401', chequeDate: '2026-07-20', chequeReceivedDate: '2026-07-04',
    chequeStatus: 'PENDING', remarks: 'CHEQUE 9812401 20-07-2026'
  },
  // Cheque falling due shortly — shows as a due-soon (amber) alert.
  {
    id: 'r3', date: '2026-07-18', customerId: 'c3', amount: 60000, paymentMode: 'Cheque',
    details: 'MCB, Hyderabad',
    chequeNo: '4471902', chequeDate: '2026-08-01', chequeReceivedDate: '2026-07-18',
    chequeStatus: 'PENDING', remarks: 'CHEQUE 4471902 01-08-2026'
  },
];

const demoExpenses: Expense[] = [
  { id: 'exp1', date: '2026-07-02', businessAccountId: '42000101', amount: 3500, paymentMode: 'Cash', details: 'Office utilities bill payment', remarks: 'Paid via Cash Vault' },
  { id: 'exp2', date: '2026-07-05', businessAccountId: '21000101', amount: 15000, paymentMode: 'Cheque', details: 'Cheque No. 441098 HBL', remarks: 'Paid to Decent PU' }
];

const demoPurchases: Purchase[] = [
  {
    id: 'pu1',
    date: '2026-07-03',
    vendorId: 'v1',
    remarks: 'Raw material restock',
    items: [
      { id: 'pui1', materialName: 'PU Sheet Roll', unit: 'Meters', quantity: 200, pricePerUnit: 85, totalPrice: 17000 },
      { id: 'pui2', materialName: 'Buckle Fasteners', unit: 'Buckles', quantity: 500, pricePerUnit: 12, totalPrice: 6000 }
    ],
    totalValue: 23000
  }
];

const demoPurchaseReturns: PurchaseReturn[] = [];

const demoChequeAllocations: ChequeAllocation[] = [];

/* ──────────────────── App State ──────────────────── */

export interface State {
  isLoggedIn: boolean;
  currentUserRole: UserRole | null;
  currentUsername: string | null;
  currentPage: string;
  currentTab: string | null;   // optional deep-link into a page's tab (alert click-through)
  selectedBillId: string | null;
  selectedReturnId: string | null;

  cities: City[];
  regions: Region[];
  stores: Store[];
  addas: Adda[];
  vendors: Vendor[];
  workers: Worker[];
  categories: ProductCategory[];
  products: Product[];
  
  groupAccounts: GroupAccount[];
  chartAccounts: ChartOfAccount[];
  businessAccounts: BusinessAccount[];
  
  customers: Customer[];
  subCustomers: SubCustomer[];
  
  saleBills: SaleBill[];
  saleReturns: SaleReturn[];
  purchases: Purchase[];
  purchaseReturns: PurchaseReturn[];
  receipts: Receipt[];
  expenses: Expense[];
  productionLogs: ProductionLog[];
  chequeAllocations: ChequeAllocation[];
  alertDismissals: AlertDismissal[];

  settings: { username: string; password: string };
}

type Action =
  | { type: 'LOGIN'; payload: { username: string; password: string } }
  | { type: 'LOGOUT' }
  | { type: 'NAVIGATE'; page: string; tab?: string }
  | { type: 'ADD_PRODUCTION_LOG'; log: ProductionLog }
  | { type: 'SELECT_BILL'; billId: string | null }
  | { type: 'SELECT_RETURN'; returnId: string | null }
  
  // Setup Actions
  | { type: 'ADD_PRODUCT'; product: Product }
  | { type: 'UPDATE_PRODUCT'; product: Product }
  | { type: 'DELETE_PRODUCT'; id: string }
  | { type: 'ADD_CATEGORY'; category: ProductCategory }
  | { type: 'UPDATE_CATEGORY'; category: ProductCategory }
  | { type: 'DELETE_CATEGORY'; id: string }
  | { type: 'ADD_VENDOR'; vendor: Vendor }
  | { type: 'UPDATE_VENDOR'; vendor: Vendor }
  | { type: 'DELETE_VENDOR'; id: string }
  | { type: 'ADD_WORKER'; worker: Worker }
  | { type: 'UPDATE_WORKER'; worker: Worker }
  | { type: 'DELETE_WORKER'; id: string }
  | { type: 'ADD_CITY'; city: City }
  | { type: 'UPDATE_CITY'; city: City }
  | { type: 'DELETE_CITY'; id: string }
  | { type: 'ADD_REGION'; region: Region }
  | { type: 'UPDATE_REGION'; region: Region }
  | { type: 'DELETE_REGION'; id: string }
  | { type: 'ADD_SUB_CUSTOMER'; subCust: SubCustomer }
  | { type: 'UPDATE_SUB_CUSTOMER'; subCust: SubCustomer }
  | { type: 'DELETE_SUB_CUSTOMER'; id: string }
  | { type: 'ADD_CUSTOMER'; customer: Customer }
  | { type: 'UPDATE_CUSTOMER'; customer: Customer }
  | { type: 'DELETE_CUSTOMER'; id: string }
  | { type: 'ADD_ADDA'; adda: Adda }
  | { type: 'UPDATE_ADDA'; adda: Adda }
  | { type: 'DELETE_ADDA'; id: string }
  
  // Account Actions
  | { type: 'ADD_GROUP_ACCOUNT'; account: GroupAccount }
  | { type: 'UPDATE_GROUP_ACCOUNT'; account: GroupAccount }
  | { type: 'DELETE_GROUP_ACCOUNT'; id: string }
  | { type: 'ADD_CHART_ACCOUNT'; account: ChartOfAccount }
  | { type: 'UPDATE_CHART_ACCOUNT'; account: ChartOfAccount }
  | { type: 'DELETE_CHART_ACCOUNT'; id: string }
  | { type: 'ADD_BUSINESS_ACCOUNT'; account: BusinessAccount }
  | { type: 'UPDATE_BUSINESS_ACCOUNT'; account: BusinessAccount }
  | { type: 'DELETE_BUSINESS_ACCOUNT'; id: string }
  
  // Bill Actions
  | { type: 'ADD_SALE_BILL'; bill: SaleBill }
  | { type: 'UPDATE_SALE_BILL'; billId: string; bill: SaleBill }
  | { type: 'DELETE_SALE_BILL'; billId: string }
  | { type: 'POST_SALE_BILL'; billId: string }
  | { type: 'UNPOST_SALE_BILL'; billId: string }
  | { type: 'UPDATE_BILTY_INFO'; billId: string; biltyNo: string; addaId: string }
  
  // Return Actions
  | { type: 'ADD_SALE_RETURN'; returnObj: SaleReturn }
  | { type: 'UPDATE_SALE_RETURN'; returnId: string; returnObj: SaleReturn }
  | { type: 'DELETE_SALE_RETURN'; returnId: string }
  | { type: 'POST_SALE_RETURN'; returnId: string }

  // Purchase Actions
  | { type: 'ADD_PURCHASE'; purchase: Purchase }
  | { type: 'DELETE_PURCHASE'; id: string }
  | { type: 'ADD_PURCHASE_RETURN'; purchaseReturn: PurchaseReturn }
  | { type: 'DELETE_PURCHASE_RETURN'; id: string }

  // Receipt Actions
  | { type: 'ADD_RECEIPT'; receipt: Receipt }

  // Cheque disposition / bounce (§13)
  // The id is assigned by the reducer, not the caller — mirrors a real API
  // where the server owns identity, and keeps the page component pure.
  | { type: 'ADD_CHEQUE_ALLOCATION'; allocation: Omit<ChequeAllocation, 'id'> }
  | { type: 'MARK_CHEQUE_CLEARED'; receiptId: string }
  | { type: 'BOUNCE_CHEQUE'; receiptId: string; bouncedDate: string }

  // Alerts (§12)
  | { type: 'DISMISS_ALERT'; alertKey: string; dismissedAt: string }
  | { type: 'RESTORE_ALERTS' }

  // Expense Actions
  | { type: 'ADD_EXPENSE'; expense: Expense }
  | { type: 'DELETE_EXPENSE'; id: string }
  | { type: 'UPDATE_SETTINGS'; settings: { username: string; password: string } };

const initialState: State = {
  isLoggedIn: false,
  currentUserRole: null,
  currentUsername: null,
  currentPage: 'login',
  currentTab: null,
  selectedBillId: null,
  selectedReturnId: null,

  cities: demoCities,
  regions: demoRegions,
  stores: demoStores,
  addas: demoAddas,
  vendors: demoVendors,
  workers: demoWorkers,
  categories: demoCategories,
  products: demoProducts,
  
  groupAccounts: demoGroupAccounts,
  chartAccounts: demoChartAccounts,
  businessAccounts: demoBusinessAccounts,
  
  customers: demoCustomers,
  subCustomers: demoSubCustomers,
  
  saleBills: demoSaleBills,
  saleReturns: demoSaleReturns,
  purchases: demoPurchases,
  purchaseReturns: demoPurchaseReturns,
  receipts: demoReceipts,
  expenses: demoExpenses,
  productionLogs: [],
  chequeAllocations: demoChequeAllocations,
  alertDismissals: [],

  settings: { username: 'admin', password: 'admin' },
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOGIN': {
      const { username, password } = action.payload;
      if (username === state.settings.username && password === state.settings.password) {
        return { ...state, isLoggedIn: true, currentUserRole: 'Admin', currentUsername: username, currentPage: 'home' };
      }
      if (username === DEMO_USER_ACCOUNT.username && password === DEMO_USER_ACCOUNT.password) {
        return { ...state, isLoggedIn: true, currentUserRole: 'User', currentUsername: username, currentPage: 'home' };
      }
      return state;
    }
    case 'LOGOUT':
      return { ...state, isLoggedIn: false, currentUserRole: null, currentUsername: null, currentPage: 'login' };
    case 'NAVIGATE':
      return { ...state, currentPage: action.page, currentTab: action.tab ?? null };
    case 'SELECT_BILL':
      return { ...state, selectedBillId: action.billId };
    case 'SELECT_RETURN':
      return { ...state, selectedReturnId: action.returnId };
    case 'ADD_PRODUCTION_LOG':
      return { ...state, productionLogs: [...state.productionLogs, action.log] };

    /* ──── Setup Handlers ──── */
    case 'ADD_PRODUCT':
      return { ...state, products: [...state.products, action.product] };
    case 'UPDATE_PRODUCT':
      return {
        ...state,
        products: state.products.map(p => p.id === action.product.id ? action.product : p)
      };
    case 'DELETE_PRODUCT':
      return { ...state, products: state.products.filter(p => p.id !== action.id) };
    case 'ADD_CATEGORY':
      return { ...state, categories: [...state.categories, action.category] };
    case 'UPDATE_CATEGORY':
      return {
        ...state,
        categories: state.categories.map(c => c.id === action.category.id ? action.category : c)
      };
    case 'DELETE_CATEGORY':
      return {
        ...state,
        categories: state.categories.filter(c => c.id !== action.id)
      };
    case 'ADD_VENDOR':
      return { ...state, vendors: [...state.vendors, action.vendor] };
    case 'UPDATE_VENDOR':
      return {
        ...state,
        vendors: state.vendors.map(v => v.id === action.vendor.id ? action.vendor : v),
        businessAccounts: state.businessAccounts.map(b =>
          b.id === action.vendor.baId ? { ...b, name: `${action.vendor.name} A/C` } : b
        )
      };
    case 'DELETE_VENDOR': {
      const deletedVendor = state.vendors.find(v => v.id === action.id);
      return {
        ...state,
        vendors: state.vendors.filter(v => v.id !== action.id),
        businessAccounts: deletedVendor
          ? state.businessAccounts.filter(b => b.id !== deletedVendor.baId)
          : state.businessAccounts
      };
    }
    case 'ADD_WORKER':
      return { ...state, workers: [...state.workers, action.worker] };
    case 'UPDATE_WORKER':
      return {
        ...state,
        workers: state.workers.map(w => w.id === action.worker.id ? action.worker : w),
        businessAccounts: state.businessAccounts.map(b =>
          b.id === action.worker.baId ? { ...b, name: `${action.worker.name} A/C` } : b
        )
      };
    case 'DELETE_WORKER': {
      const deletedWorker = state.workers.find(w => w.id === action.id);
      return {
        ...state,
        workers: state.workers.filter(w => w.id !== action.id),
        businessAccounts: deletedWorker
          ? state.businessAccounts.filter(b => b.id !== deletedWorker.baId)
          : state.businessAccounts
      };
    }
    case 'ADD_CITY':
      return { ...state, cities: [...state.cities, action.city] };
    case 'UPDATE_CITY':
      return {
        ...state,
        cities: state.cities.map(c => c.id === action.city.id ? action.city : c)
      };
    case 'DELETE_CITY':
      return {
        ...state,
        cities: state.cities.filter(c => c.id !== action.id)
      };
    case 'ADD_REGION':
      return { ...state, regions: [...state.regions, action.region] };
    case 'UPDATE_REGION':
      return {
        ...state,
        regions: state.regions.map(r => r.id === action.region.id ? action.region : r)
      };
    case 'DELETE_REGION':
      return {
        ...state,
        regions: state.regions.filter(r => r.id !== action.id)
      };
    case 'ADD_SUB_CUSTOMER':
      return { ...state, subCustomers: [...state.subCustomers, action.subCust] };
    case 'UPDATE_SUB_CUSTOMER':
      return {
        ...state,
        subCustomers: state.subCustomers.map(sc => sc.id === action.subCust.id ? action.subCust : sc)
      };
    case 'DELETE_SUB_CUSTOMER':
      return {
        ...state,
        subCustomers: state.subCustomers.filter(sc => sc.id !== action.id)
      };
    case 'ADD_CUSTOMER':
      return { ...state, customers: [...state.customers, action.customer] };
    case 'UPDATE_CUSTOMER':
      return {
        ...state,
        customers: state.customers.map(c => c.id === action.customer.id ? action.customer : c),
        businessAccounts: state.businessAccounts.map(b =>
          b.id === action.customer.id ? { ...b, name: action.customer.name } : b
        )
      };
    case 'DELETE_CUSTOMER':
      return {
        ...state,
        customers: state.customers.filter(c => c.id !== action.id),
        businessAccounts: state.businessAccounts.filter(b => b.id !== action.id)
      };
    case 'ADD_ADDA':
      return { ...state, addas: [...state.addas, action.adda] };
    case 'UPDATE_ADDA':
      return {
        ...state,
        addas: state.addas.map(a => a.id === action.adda.id ? action.adda : a)
      };
    case 'DELETE_ADDA':
      return {
        ...state,
        addas: state.addas.filter(a => a.id !== action.id)
      };

    /* ──── Account Handlers ──── */
    case 'ADD_GROUP_ACCOUNT':
      return { ...state, groupAccounts: [...state.groupAccounts, action.account] };
    case 'UPDATE_GROUP_ACCOUNT':
      return {
        ...state,
        groupAccounts: state.groupAccounts.map(g => g.id === action.account.id ? action.account : g)
      };
    case 'DELETE_GROUP_ACCOUNT':
      return {
        ...state,
        groupAccounts: state.groupAccounts.filter(g => g.id !== action.id)
      };
    case 'ADD_CHART_ACCOUNT':
      return { ...state, chartAccounts: [...state.chartAccounts, action.account] };
    case 'UPDATE_CHART_ACCOUNT':
      return {
        ...state,
        chartAccounts: state.chartAccounts.map(c => c.id === action.account.id ? action.account : c)
      };
    case 'DELETE_CHART_ACCOUNT':
      return {
        ...state,
        chartAccounts: state.chartAccounts.filter(c => c.id !== action.id)
      };
    case 'ADD_BUSINESS_ACCOUNT':
      return { ...state, businessAccounts: [...state.businessAccounts, action.account] };
    case 'UPDATE_BUSINESS_ACCOUNT':
      return {
        ...state,
        businessAccounts: state.businessAccounts.map(b => b.id === action.account.id ? action.account : b),
        customers: state.customers.map(c => c.id === action.account.id ? { ...c, name: action.account.name } : c),
        vendors: state.vendors.map(v => v.baId === action.account.id ? { ...v, name: action.account.name } : v)
      };
    case 'DELETE_BUSINESS_ACCOUNT':
      return {
        ...state,
        businessAccounts: state.businessAccounts.filter(b => b.id !== action.id),
        customers: state.customers.filter(c => c.id !== action.id)
      };

    /* ──── Sale Bill Handlers ──── */
    case 'ADD_SALE_BILL': {
      // Deduct stock if posted
      let updatedProducts = [...state.products];
      if (action.bill.status === 'Posted') {
        updatedProducts = state.products.map(p => {
          const item = action.bill.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: Math.max(0, (p.stock || 0) - item.pairs) };
          }
          return p;
        });
      }
      return { ...state, saleBills: [action.bill, ...state.saleBills], products: updatedProducts };
    }
    case 'UPDATE_SALE_BILL': {
      const oldBill = state.saleBills.find(b => b.id === action.billId);
      let updatedProducts = [...state.products];
      
      // Reverse old stock deduction if old bill was posted
      if (oldBill && oldBill.status === 'Posted') {
        updatedProducts = updatedProducts.map(p => {
          const item = oldBill.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: (p.stock || 0) + item.pairs };
          }
          return p;
        });
      }
      // Apply new stock deduction if new bill is posted
      if (action.bill.status === 'Posted') {
        updatedProducts = updatedProducts.map(p => {
          const item = action.bill.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: Math.max(0, (p.stock || 0) - item.pairs) };
          }
          return p;
        });
      }

      return {
        ...state,
        saleBills: state.saleBills.map(b => b.id === action.billId ? action.bill : b),
        products: updatedProducts
      };
    }
    case 'DELETE_SALE_BILL': {
      const oldBill = state.saleBills.find(b => b.id === action.billId);
      let updatedProducts = [...state.products];
      
      // Reverse old stock deduction if old bill was posted
      if (oldBill && oldBill.status === 'Posted') {
        updatedProducts = updatedProducts.map(p => {
          const item = oldBill.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: (p.stock || 0) + item.pairs };
          }
          return p;
        });
      }
      return {
        ...state,
        saleBills: state.saleBills.filter(b => b.id !== action.billId),
        products: updatedProducts
      };
    }
    case 'POST_SALE_BILL': {
      const bill = state.saleBills.find(b => b.id === action.billId);
      if (!bill || bill.status === 'Posted') return state;

      // Deduct stock
      const updatedProducts = state.products.map(p => {
        const item = bill.items.find(it => it.productId === p.id);
        if (item) {
          return { ...p, stock: Math.max(0, (p.stock || 0) - item.pairs) };
        }
        return p;
      });

      return {
        ...state,
        saleBills: state.saleBills.map(b => b.id === action.billId ? { ...b, status: 'Posted' } : b),
        products: updatedProducts
      };
    }
    case 'UNPOST_SALE_BILL': {
      const bill = state.saleBills.find(b => b.id === action.billId);
      if (!bill || bill.status === 'Unposted') return state;

      // Restore stock
      const updatedProducts = state.products.map(p => {
        const item = bill.items.find(it => it.productId === p.id);
        if (item) {
          return { ...p, stock: (p.stock || 0) + item.pairs };
        }
        return p;
      });

      return {
        ...state,
        saleBills: state.saleBills.map(b => b.id === action.billId ? { ...b, status: 'Unposted' } : b),
        products: updatedProducts
      };
    }
    case 'UPDATE_BILTY_INFO': {
      return {
        ...state,
        saleBills: state.saleBills.map(b =>
          b.id === action.billId
            ? { ...b, biltyNo: action.biltyNo, addaId: action.addaId }
            : b
        )
      };
    }

    /* ──── Sale Return Handlers ──── */
    case 'ADD_SALE_RETURN': {
      // Add back to stock if posted
      let updatedProducts = [...state.products];
      if (action.returnObj.status === 'Posted') {
        updatedProducts = state.products.map(p => {
          const item = action.returnObj.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: (p.stock || 0) + item.pairs };
          }
          return p;
        });
      }
      return { ...state, saleReturns: [action.returnObj, ...state.saleReturns], products: updatedProducts };
    }
    case 'UPDATE_SALE_RETURN': {
      const oldReturn = state.saleReturns.find(r => r.id === action.returnId);
      let updatedProducts = [...state.products];
      
      // Reverse old stock addition if old return was posted
      if (oldReturn && oldReturn.status === 'Posted') {
        updatedProducts = updatedProducts.map(p => {
          const item = oldReturn.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: Math.max(0, (p.stock || 0) - item.pairs) };
          }
          return p;
        });
      }
      // Apply new stock addition if new return is posted
      if (action.returnObj.status === 'Posted') {
        updatedProducts = updatedProducts.map(p => {
          const item = action.returnObj.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: (p.stock || 0) + item.pairs };
          }
          return p;
        });
      }

      return {
        ...state,
        saleReturns: state.saleReturns.map(r => r.id === action.returnId ? action.returnObj : r),
        products: updatedProducts
      };
    }
    case 'DELETE_SALE_RETURN': {
      const oldReturn = state.saleReturns.find(r => r.id === action.returnId);
      let updatedProducts = [...state.products];
      
      // Reverse old stock addition if old return was posted
      if (oldReturn && oldReturn.status === 'Posted') {
        updatedProducts = updatedProducts.map(p => {
          const item = oldReturn.items.find(it => it.productId === p.id);
          if (item) {
            return { ...p, stock: Math.max(0, (p.stock || 0) - item.pairs) };
          }
          return p;
        });
      }
      return {
        ...state,
        saleReturns: state.saleReturns.filter(r => r.id !== action.returnId),
        products: updatedProducts
      };
    }
    case 'POST_SALE_RETURN': {
      const returnObj = state.saleReturns.find(r => r.id === action.returnId);
      if (!returnObj || returnObj.status === 'Posted') return state;

      // Add stock
      const updatedProducts = state.products.map(p => {
        const item = returnObj.items.find(it => it.productId === p.id);
        if (item) {
          return { ...p, stock: (p.stock || 0) + item.pairs };
        }
        return p;
      });

      return {
        ...state,
        saleReturns: state.saleReturns.map(r => r.id === action.returnId ? { ...r, status: 'Posted' } : r),
        products: updatedProducts
      };
    }

    /* ──── Purchase Handlers ──── */
    case 'ADD_PURCHASE':
      return { ...state, purchases: [action.purchase, ...state.purchases] };
    case 'DELETE_PURCHASE':
      return { ...state, purchases: state.purchases.filter(p => p.id !== action.id) };
    case 'ADD_PURCHASE_RETURN':
      return { ...state, purchaseReturns: [action.purchaseReturn, ...state.purchaseReturns] };
    case 'DELETE_PURCHASE_RETURN':
      return { ...state, purchaseReturns: state.purchaseReturns.filter(p => p.id !== action.id) };

    /* ──── Receipt Handlers ──── */
    case 'ADD_RECEIPT':
      return { ...state, receipts: [action.receipt, ...state.receipts] };

    /* ──── Cheque disposition / bounce (§13) ──── */
    case 'ADD_CHEQUE_ALLOCATION': {
      const receipt = state.receipts.find(r => r.id === action.allocation.receiptId);
      if (!receipt) return state;

      const allocation: ChequeAllocation = {
        ...action.allocation,
        id: `ca_${Date.now()}_${state.chequeAllocations.length}`
      };
      const allocations = [...state.chequeAllocations, allocation];
      const nextStatus = deriveChequeStatus(receipt, allocations);

      return {
        ...state,
        chequeAllocations: allocations,
        receipts: state.receipts.map(r =>
          r.id === receipt.id ? { ...r, chequeStatus: nextStatus } : r
        )
      };
    }
    case 'MARK_CHEQUE_CLEARED':
      return {
        ...state,
        receipts: state.receipts.map(r =>
          r.id === action.receiptId && r.chequeStatus === 'DEPOSITED'
            ? { ...r, chequeStatus: 'CLEARED' as ChequeStatus }
            : r
        )
      };
    case 'BOUNCE_CHEQUE': {
      // A bounce reverses BOTH sides together: the customer's receipt (their
      // due goes back up) and every allocation sourced from that cheque (the
      // vendor's / expense account's balance goes back up too). Rows are kept
      // rather than deleted — the counter-entries are dated `bouncedDate`, so
      // previously printed reports still reconcile.
      return {
        ...state,
        receipts: state.receipts.map(r =>
          r.id === action.receiptId
            ? { ...r, chequeStatus: 'BOUNCED' as ChequeStatus, bouncedDate: action.bouncedDate }
            : r
        ),
        chequeAllocations: state.chequeAllocations.map(a =>
          a.receiptId === action.receiptId ? { ...a, status: 'REVERSED' as const } : a
        )
      };
    }

    /* ──── Alerts (§12) ──── */
    case 'DISMISS_ALERT':
      return {
        ...state,
        alertDismissals: [
          ...state.alertDismissals.filter(d => d.alertKey !== action.alertKey),
          { alertKey: action.alertKey, dismissedAt: action.dismissedAt }
        ]
      };
    case 'RESTORE_ALERTS':
      return { ...state, alertDismissals: [] };

    /* ──── Expense Handlers ──── */
    case 'ADD_EXPENSE':
      return { ...state, expenses: [action.expense, ...state.expenses] };
    case 'DELETE_EXPENSE':
      return { ...state, expenses: state.expenses.filter(e => e.id !== action.id) };

    case 'UPDATE_SETTINGS':
      return { ...state, settings: action.settings };

    default:
      return state;
  }
}

/* ──────────────────── Context Setup ──────────────────── */

interface ContextType {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<ContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

/* ──────────────────── Helper Functions ──────────────────── */

export function formatCurrency(value: number): string {
  return 'Rs ' + value.toLocaleString('en-US');
}

export function isDateInCurrentWeek(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  
  // Calculate start (Monday) and end (Sunday) of current week
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(now.setDate(diff));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  end.setHours(23, 59, 59, 999);

  return date >= start && date <= end;
}

export function isDateInCurrentMonth(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

export function isDateInMonth(dateStr: string, month: number, year: number): boolean {
  const date = new Date(dateStr);
  return date.getMonth() === month && date.getFullYear() === year;
}

export function getMonthName(m: number): string {
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return names[m];
}
