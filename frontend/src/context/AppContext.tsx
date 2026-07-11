import React, { createContext, useContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type {
  City, Store, Adda, Vendor, ProductCategory, Product,
  GroupAccount, ControlAccount, ChartOfAccount, BusinessAccount,
  Customer, SubCustomer, SaleBill, SaleReturn,
  Receipt, Expense
} from '@/types';

/* ──────────────────── Demo Data ──────────────────── */

const demoCities: City[] = [
  { id: 'ct1', name: 'Lahore' },
  { id: 'ct2', name: 'Karachi' },
  { id: 'ct3', name: 'Hyderabad' },
  { id: 'ct4', name: 'Mardan' },
  { id: 'ct5', name: 'Multan' },
  { id: 'ct6', name: 'Sukkur' },
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
  { id: 'v1', name: 'Decent Polyurethane', phone: '0300-1234567', city: 'Lahore' },
  { id: 'v2', name: 'Lahore Chemical Industries', phone: '042-3588991', city: 'Lahore' },
  { id: 'v3', name: 'Star Sole Materials', phone: '0321-7654321', city: 'Karachi' },
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
    costPrice: 420, labour: 15, proiCost: 5, soleStich: 20, pasting: 10, trim: 5, finishing: 8, socksPasting: 4,
    dc: 12, sockStich: 6, sheet: 25, stubble: 10, bottom: 40, p1: 10, p2: 5, na: 0, stock: 150
  },
  {
    id: '1002', name: 'P-102 Jogger Sole White', categoryId: 'cat1', vendorId: 'v1', batchNo: 405, packing: 12,
    costPrice: 430, labour: 15, proiCost: 5, soleStich: 20, pasting: 10, trim: 5, finishing: 8, socksPasting: 4,
    dc: 12, sockStich: 6, sheet: 25, stubble: 10, bottom: 40, p1: 10, p2: 5, na: 0, stock: 95
  },
  {
    id: '2001', name: 'E-551 Casual Slipper Brown', categoryId: 'cat2', vendorId: 'v2', batchNo: 120, packing: 12,
    costPrice: 220, labour: 10, proiCost: 2, soleStich: 0, pasting: 8, trim: 4, finishing: 5, socksPasting: 3,
    dc: 8, sockStich: 0, sheet: 15, stubble: 5, bottom: 20, p1: 5, p2: 2, na: 0, stock: 320
  },
  {
    id: '3001', name: 'F-909 Formal Oxford Sole Black', categoryId: 'cat3', vendorId: 'v3', batchNo: 789, packing: 12,
    costPrice: 580, labour: 25, proiCost: 10, soleStich: 35, pasting: 15, trim: 8, finishing: 12, socksPasting: 6,
    dc: 15, sockStich: 10, sheet: 35, stubble: 15, bottom: 60, p1: 15, p2: 8, na: 0, stock: 80
  },
];

const demoGroupAccounts: GroupAccount[] = [
  { id: '1000', name: 'ASSETS', class: 'ASSETS' },
  { id: '2000', name: 'LIABILITY', class: 'LIABILITY' },
  { id: '3000', name: 'INCOME', class: 'INCOME' },
  { id: '4000', name: 'EXPENSES', class: 'EXPENSES' },
];

const demoControlAccounts: ControlAccount[] = [
  { id: '1100', name: 'TRADE DEBTORS (RECEIVABLES)', groupId: '1000', sorting: 1 },
  { id: '1200', name: 'CASH & BANK BALANCES', groupId: '1000', sorting: 2 },
  { id: '2100', name: 'TRADE CREDITORS (PAYABLES)', groupId: '2000', sorting: 1 },
  { id: '3100', name: 'SALES REVENUE', groupId: '3000', sorting: 1 },
  { id: '4100', name: 'DIRECT OPERATING COSTS', groupId: '4000', sorting: 1 },
  { id: '4200', name: 'ADMINISTRATIVE EXPENSES', groupId: '4000', sorting: 2 },
];

const demoChartAccounts: ChartOfAccount[] = [
  { id: '110001', name: 'CUSTOMERS ACCOUNTS', controlId: '1100', linkCode: 'A', status: 'Active' },
  { id: '120001', name: 'CASH IN HAND', controlId: '1200', linkCode: 'A', status: 'Active' },
  { id: '120002', name: 'BANK ALFALAH AC - 0124', controlId: '1200', linkCode: 'A', status: 'Active' },
  { id: '210001', name: 'VENDORS ACCOUNTS', controlId: '2100', linkCode: 'A', status: 'Active' },
  { id: '310001', name: 'WHOLESALE SHOE SALES', controlId: '3100', linkCode: 'A', status: 'Active' },
  { id: '410001', name: 'LABOUR WAGES CHARGES', controlId: '4100', linkCode: 'A', status: 'Active' },
  { id: '420001', name: 'UTILITIES & BILLS EXPENSE', controlId: '4200', linkCode: 'A', status: 'Active' },
];

const demoBusinessAccounts: BusinessAccount[] = [
  { id: '11000101', name: 'Ahmed Footwear (LHR)', controlId: '110001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '11000102', name: 'Karachi Boot House (KHI)', controlId: '110001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '11000103', name: 'Malik Traders (HYD)', controlId: '110001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '11000104', name: 'Mardan Shoe Mart (MRD)', controlId: '110001', linkCode: 'A', region: 'NORTH', status: 'Active' },
  { id: '12000101', name: 'Lahore Cash Vault', controlId: '120001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '21000101', name: 'Decent Polyurethane A/C', controlId: '210001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
];

const demoCustomers: Customer[] = [
  { id: 'c1', name: 'Ahmed Footwear (LHR)', acId: '110001', cityId: 'ct1' },
  { id: 'c2', name: 'Karachi Boot House (KHI)', acId: '110001', cityId: 'ct2' },
  { id: 'c3', name: 'Malik Traders (HYD)', acId: '110001', cityId: 'ct3' },
  { id: 'c4', name: 'Mardan Shoe Mart (MRD)', acId: '110001', cityId: 'ct4' },
];

const demoSubCustomers: SubCustomer[] = [
  { id: 'sub-same', name: 'SAME (Direct)', customerId: 'c1' },
  { id: 'sub1', name: 'Saleem Transport Agent', customerId: 'c1' },
  { id: 'sub2', name: 'Liaqat Traders Karachi', customerId: 'c2' },
  { id: 'sub3', name: 'Ghafoor Bakhsh Agency', customerId: 'c3' },
  { id: 'sub4', name: 'Khyber Delivery Hub', customerId: 'c4' },
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
  { id: 'r2', date: '2026-07-04', customerId: 'c2', amount: 50000, paymentMode: 'Cheque', details: 'HBL Cheque No. 9812401', remarks: 'Cleared' },
];

const demoExpenses: Expense[] = [
  { id: 'exp1', date: '2026-07-02', businessAccountId: '12000101', amount: 3500, paymentMode: 'Cash', details: 'Office utilities bill payment', remarks: 'Paid via Cash Vault' },
  { id: 'exp2', date: '2026-07-05', businessAccountId: '21000101', amount: 15000, paymentMode: 'Cheque', details: 'Cheque No. 441098 HBL', remarks: 'Paid to Decent PU' }
];

/* ──────────────────── App State ──────────────────── */

interface State {
  isLoggedIn: boolean;
  currentPage: string;
  selectedBillId: string | null;
  selectedReturnId: string | null;
  
  cities: City[];
  stores: Store[];
  addas: Adda[];
  vendors: Vendor[];
  categories: ProductCategory[];
  products: Product[];
  
  groupAccounts: GroupAccount[];
  controlAccounts: ControlAccount[];
  chartAccounts: ChartOfAccount[];
  businessAccounts: BusinessAccount[];
  
  customers: Customer[];
  subCustomers: SubCustomer[];
  
  saleBills: SaleBill[];
  saleReturns: SaleReturn[];
  receipts: Receipt[];
  expenses: Expense[];
  
  settings: { username: string; password: string };
}

type Action =
  | { type: 'LOGIN'; payload: { username: string; password: string } }
  | { type: 'LOGOUT' }
  | { type: 'NAVIGATE'; page: string }
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
  | { type: 'ADD_CITY'; city: City }
  | { type: 'UPDATE_CITY'; city: City }
  | { type: 'DELETE_CITY'; id: string }
  | { type: 'ADD_SUB_CUSTOMER'; subCust: SubCustomer }
  | { type: 'UPDATE_SUB_CUSTOMER'; subCust: SubCustomer }
  | { type: 'DELETE_SUB_CUSTOMER'; id: string }
  | { type: 'ADD_CUSTOMER'; customer: Customer }
  | { type: 'ADD_ADDA'; adda: Adda }
  | { type: 'UPDATE_ADDA'; adda: Adda }
  | { type: 'DELETE_ADDA'; id: string }
  
  // Account Actions
  | { type: 'ADD_GROUP_ACCOUNT'; account: GroupAccount }
  | { type: 'UPDATE_GROUP_ACCOUNT'; account: GroupAccount }
  | { type: 'DELETE_GROUP_ACCOUNT'; id: string }
  | { type: 'ADD_CONTROL_ACCOUNT'; account: ControlAccount }
  | { type: 'UPDATE_CONTROL_ACCOUNT'; account: ControlAccount }
  | { type: 'DELETE_CONTROL_ACCOUNT'; id: string }
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
  
  // Receipt Actions
  | { type: 'ADD_RECEIPT'; receipt: Receipt }
  // Expense Actions
  | { type: 'ADD_EXPENSE'; expense: Expense }
  | { type: 'DELETE_EXPENSE'; id: string }
  | { type: 'UPDATE_SETTINGS'; settings: { username: string; password: string } };

const initialState: State = {
  isLoggedIn: false,
  currentPage: 'login',
  selectedBillId: null,
  selectedReturnId: null,
  
  cities: demoCities,
  stores: demoStores,
  addas: demoAddas,
  vendors: demoVendors,
  categories: demoCategories,
  products: demoProducts,
  
  groupAccounts: demoGroupAccounts,
  controlAccounts: demoControlAccounts,
  chartAccounts: demoChartAccounts,
  businessAccounts: demoBusinessAccounts,
  
  customers: demoCustomers,
  subCustomers: demoSubCustomers,
  
  saleBills: demoSaleBills,
  saleReturns: demoSaleReturns,
  receipts: demoReceipts,
  expenses: demoExpenses,
  
  settings: { username: 'admin', password: 'admin' },
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOGIN': {
      const { username, password } = action.payload;
      if (username === state.settings.username && password === state.settings.password) {
        return { ...state, isLoggedIn: true, currentPage: 'sale-bill' };
      }
      return state;
    }
    case 'LOGOUT':
      return { ...state, isLoggedIn: false, currentPage: 'login' };
    case 'NAVIGATE':
      return { ...state, currentPage: action.page };
    case 'SELECT_BILL':
      return { ...state, selectedBillId: action.billId };
    case 'SELECT_RETURN':
      return { ...state, selectedReturnId: action.returnId };

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
        vendors: state.vendors.map(v => v.id === action.vendor.id ? action.vendor : v)
      };
    case 'DELETE_VENDOR':
      return {
        ...state,
        vendors: state.vendors.filter(v => v.id !== action.id)
      };
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
    case 'ADD_CONTROL_ACCOUNT':
      return { ...state, controlAccounts: [...state.controlAccounts, action.account] };
    case 'UPDATE_CONTROL_ACCOUNT':
      return {
        ...state,
        controlAccounts: state.controlAccounts.map(c => c.id === action.account.id ? action.account : c)
      };
    case 'DELETE_CONTROL_ACCOUNT':
      return {
        ...state,
        controlAccounts: state.controlAccounts.filter(c => c.id !== action.id)
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
        customers: state.customers.map(c => c.id === action.account.id ? { ...c, name: action.account.name } : c)
      };
    case 'DELETE_BUSINESS_ACCOUNT':
      return {
        ...state,
        businessAccounts: state.businessAccounts.filter(b => b.id !== action.id),
        customers: state.customers.filter(c => c.id !== action.id),
        subCustomers: state.subCustomers.filter(sc => sc.customerId !== action.id)
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

    /* ──── Receipt Handlers ──── */
    case 'ADD_RECEIPT':
      return { ...state, receipts: [action.receipt, ...state.receipts] };

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
