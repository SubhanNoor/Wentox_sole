import React, { createContext, useContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type {
  City, Region, Store, Adda, Vendor, Employee, ProductCategory, Product,
  GroupAccount, ChartOfAccount, BusinessAccount,
  Customer, SubCustomer, SaleBill, SaleReturn, Purchase, PurchaseReturn,
  Receipt, Expense, ProductionLog, UserRole,
  ChequeAllocation, AlertDismissal,
  WageRun, SalaryRun, BankAccount, Transfer, Deposit, MaterialAdjustment
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
  { id: 'ad1', name: 'Karachi Goods Transport', regionId: 'rg3', cityId: 'ct3' },
  { id: 'ad2', name: 'Peshawar Niazi Cargo', regionId: 'rg2', cityId: 'ct2' },
  { id: 'ad3', name: 'Multan Adda Service', regionId: 'rg4', cityId: 'ct4' },
  { id: 'ad4', name: 'Sukkur Cargo Express', regionId: 'rg3', cityId: 'ct5' },
];

const demoVendors: Vendor[] = [
  { id: 'v1', name: 'Decent Polyurethane', phone: '0300-1234567', city: 'Lahore', regionId: 'rg1', baId: '21000101' },
  { id: 'v2', name: 'Lahore Chemical Industries', phone: '042-3588991', city: 'Lahore', regionId: 'rg1', baId: '21000102' },
  { id: 'v3', name: 'Star Sole Materials', phone: '0321-7654321', city: 'Karachi', regionId: 'rg3', baId: '21000103' },
  { id: 'v4', name: 'Multan Rubber Works', phone: '061-4552210', city: 'Multan', regionId: 'rg4', baId: '21000104' },
  { id: 'v5', name: 'Sukkur Sole Traders', phone: '071-2298831', city: 'Sukkur', regionId: 'rg3', baId: '21000105' },
  { id: 'v6', name: 'Punjab Buckle & Fasteners', phone: '042-3712209', city: 'Lahore', regionId: 'rg1', baId: '21000106' },
];

// Workers are paid piece-rate per manufacturing stage. Their ledger accounts sit
// under WORKER WAGES (220001) — a LIABILITY, like vendors, because a worker can
// be owed money between doing the work and being paid. Payment Trail's
// "Employees" row sums payments made against these accounts.
// Twelve workers, ONE PER STAGE, so every trade is testable end to end without
// setup. Named in the client's own style ("Amir Bottom Man") — which is both
// realistic and makes it obvious which worker exercises which stage.
//
// w1–w3 are the original three, kept rather than replaced: their baIds
// 2200010001–0003 are referenced by demoExpenses. They just gained trades.
const demoEmployees: Employee[] = [
  { id: 'w1',  name: 'Noman Butt',        phone: '0301-4455661', cityId: 'ct1', baId: '2200010001', employeeType: 'WORKER', stages: ['cutting'] },
  { id: 'w2',  name: 'Zafar Hussain',     phone: '0333-7788992', cityId: 'ct1', baId: '2200010002', employeeType: 'WORKER', stages: ['edging'] },
  { id: 'w3',  name: 'Imran Amir',                               cityId: 'ct1', baId: '2200010003', employeeType: 'WORKER', stages: ['upStitch'] },
  { id: 'w4',  name: 'Rashid Bending Man', phone: '0300-2211334', cityId: 'ct1', baId: '2200010004', employeeType: 'WORKER', stages: ['bending'] },
  { id: 'w5',  name: 'Akram Stubble Man',  phone: '0345-8877221', cityId: 'ct1', baId: '2200010005', employeeType: 'WORKER', stages: ['stubbleDori'] },
  { id: 'w6',  name: 'Waseem Shape Man',                          cityId: 'ct5', baId: '2200010006', employeeType: 'WORKER', stages: ['shapeForm'] },
  { id: 'w7',  name: 'Bilal Chipkai Man',  phone: '0321-4455998', cityId: 'ct1', baId: '2200010007', employeeType: 'WORKER', stages: ['chipkai'] },
  { id: 'w8',  name: 'Amir Bottom Man',    phone: '0302-9988776', cityId: 'ct1', baId: '2200010008', employeeType: 'WORKER', stages: ['bottom'] },
  { id: 'w9',  name: 'Shahid Machine Man', phone: '0333-1122443', cityId: 'ct5', baId: '2200010009', employeeType: 'WORKER', stages: ['machine'] },
  { id: 'w10', name: 'Kashif Trimming Man',                       cityId: 'ct1', baId: '2200010010', employeeType: 'WORKER', stages: ['trimming'] },
  { id: 'w11', name: 'Nadeem Socks Man',   phone: '0301-6677889', cityId: 'ct1', baId: '2200010011', employeeType: 'WORKER', stages: ['sockStitch'] },
  { id: 'w12', name: 'Tariq Finish Man',   phone: '0345-3344556', cityId: 'ct1', baId: '2200010012', employeeType: 'WORKER', stages: ['finish'] },

  // Salaried staff — the roles that actually draw a fixed monthly figure in a
  // sole factory. Their accounts hang under SALARIES PAYABLE (220002), not
  // WORKER WAGES, so a report can separate piece-rate labour (a product cost)
  // from salary (overhead).
  { id: 's1', name: 'Jawad Iqbal (Manager)',     phone: '0300-1010101', cityId: 'ct1', baId: '2200020001', employeeType: 'SALARIED', monthlySalary: 85000 },
  { id: 's2', name: 'Farhan Sheikh (Accountant)', phone: '0321-2020202', cityId: 'ct1', baId: '2200020002', employeeType: 'SALARIED', monthlySalary: 60000 },
  { id: 's3', name: 'Saeed Anwar (Storekeeper)',                         cityId: 'ct1', baId: '2200020003', employeeType: 'SALARIED', monthlySalary: 42000 },
  { id: 's4', name: 'Ilyas Khan (Driver)',        phone: '0333-4040404', cityId: 'ct1', baId: '2200020004', employeeType: 'SALARIED', monthlySalary: 35000 },
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
  // New color variant with zero stock — an edge case for Current Stock's
  // expandable panel and the "Add Stock" dialog on an unproduced color.
  {
    id: '1005', name: 'P-101 Jogger Sole Brown', categoryId: 'cat1', vendorId: 'v1', batchNo: 406, packing: 12,
    salePrice: 475, cutting: 18, edging: 6, upStitch: 22, bending: 9, stubbleDori: 10, shapeForm: 14,
    chipkai: 7, bottom: 40, machine: 12, trimming: 5, sockStitch: 6, finish: 8, color: 'Brown', stock: 0
  },
  {
    id: '2002', name: 'E-551 Casual Slipper Black', categoryId: 'cat2', vendorId: 'v2', batchNo: 121, packing: 12,
    salePrice: 260, cutting: 10, edging: 4, upStitch: 0, bending: 5, stubbleDori: 5, shapeForm: 8,
    chipkai: 4, bottom: 20, machine: 8, trimming: 4, sockStitch: 0, finish: 5, color: 'Black', stock: 210
  },
  // Second zero-stock edge case, on a different article/vendor.
  {
    id: '3002', name: 'F-909 Formal Oxford Sole White', categoryId: 'cat3', vendorId: 'v3', batchNo: 790, packing: 12,
    salePrice: 645, cutting: 28, edging: 11, upStitch: 35, bending: 14, stubbleDori: 15, shapeForm: 20,
    chipkai: 9, bottom: 60, machine: 15, trimming: 8, sockStitch: 10, finish: 12, color: 'White', stock: 0
  },
  // New article/category (Kito Sole, TPR) so cat4 has real products to test
  // category filtering, in two colors.
  {
    id: '4001', name: 'K-303 Kito Sole Black', categoryId: 'cat4', vendorId: 'v4', batchNo: 210, packing: 12,
    salePrice: 310, cutting: 12, edging: 5, upStitch: 0, bending: 6, stubbleDori: 6, shapeForm: 9,
    chipkai: 5, bottom: 22, machine: 9, trimming: 5, sockStitch: 0, finish: 6, color: 'Black', stock: 180
  },
  {
    id: '4002', name: 'K-303 Kito Sole White', categoryId: 'cat4', vendorId: 'v4', batchNo: 210, packing: 12,
    salePrice: 315, cutting: 12, edging: 5, upStitch: 0, bending: 6, stubbleDori: 6, shapeForm: 9,
    chipkai: 5, bottom: 22, machine: 9, trimming: 5, sockStitch: 0, finish: 6, color: 'White', stock: 130
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
  // The KIND, not an instance. Named banks are business accounts beneath this,
  // so a second bank needs no second chart account. isRestricted (UC-03): the
  // `User` role can still credit/debit banks via Receipts/Expenses, but can't
  // see this chart head's ledger, reports, or setup screens.
  { id: '120002', name: 'BANK ACCOUNTS', groupId: '1000', linkCode: 'A', status: 'Active', isRestricted: true },
  // Cheques received but not yet deposited or endorsed (§13). Near-cash, so it
  // sits with cash & bank. An endorsement credits it; a deposit moves it to bank.
  { id: '120003', name: 'CHEQUES IN HAND', groupId: '1000', linkCode: 'A', status: 'Active' },
  // From the legacy Group Accounts list — STOCK IN TRADE, SHORT TERM
  // ADVANCES and FIXED ASSETS had no equivalent yet. TRADE DEBTORS,
  // CASH AND BANK BALANCES were skipped as duplicates already covered above
  // (CUSTOMERS ACCOUNTS / CASH IN HAND + BANK ACCOUNTS + CHEQUES IN HAND).
  { id: '130001', name: 'STOCK IN TRADE', groupId: '1000', linkCode: 'A', status: 'Active' },
  { id: '140001', name: 'SHORT TERM ADVANCES, DEP. & PRE-PAYMENTS', groupId: '1000', linkCode: 'A', status: 'Active' },
  { id: '150001', name: 'FIXED ASSETS', groupId: '1000', linkCode: 'A', status: 'Active' },
  { id: '210001', name: 'VENDORS ACCOUNTS', groupId: '2000', linkCode: 'A', status: 'Active' },
  { id: '220001', name: 'WORKER WAGES', groupId: '2000', linkCode: 'A', status: 'Active' },
  // What we OWE salaried staff, kept apart from WORKER WAGES so piece-rate
  // labour (a product cost) can be read separately from salary (overhead).
  // Blended, you cannot see what a pair actually costs in direct labour.
  { id: '220002', name: 'SALARIES PAYABLE', groupId: '2000', linkCode: 'A', status: 'Active' },
  // MISC.PAYABLES from the legacy list — TRADE CREDITORS skipped as a
  // duplicate of VENDORS ACCOUNTS above.
  { id: '230001', name: 'MISC.PAYABLES', groupId: '2000', linkCode: 'A', status: 'Active' },
  { id: '310001', name: 'WHOLESALE SHOE SALES', groupId: '3000', linkCode: 'A', status: 'Active' },
  // The cost side of wages. WORKER WAGES (220001) is what we OWE a worker;
  // this is what the labour COSTS us. A wage earned debits here and credits the
  // worker's account — the same shape as Purchase debiting PURCHASES and
  // crediting the vendor. Nothing posts to it until wage accrual is built.
  { id: '410001', name: 'WAGES EXPENSE', groupId: '4000', linkCode: 'A', status: 'Active' },
  // The cost side of salaries, mirroring WAGES EXPENSE. A posted salary run
  // debits here and credits each salaried employee's account.
  { id: '410002', name: 'SALARIES EXPENSE', groupId: '4000', linkCode: 'A', status: 'Active' },
  { id: '420001', name: 'UTILITIES & BILLS EXPENSE', groupId: '4000', linkCode: 'A', status: 'Active' },
  // Cost of raw material bought from vendors. A Purchase debits here and credits
  // the vendor's account — the same two-sided shape wages now have.
  { id: '430001', name: 'PURCHASES', groupId: '4000', linkCode: 'A', status: 'Active' },
  // isRestricted (UC-03): same rule as BANK ACCOUNTS above — User can still record a
  // director's expense entry, just can't see this chart head's ledger/reports/setup.
  { id: '440001', name: 'DIRECTORS EXPENSES - DRAWINGS', groupId: '4000', linkCode: 'A', status: 'Active', isRestricted: true },
  // Commission given at payment time (§7) — a cost, never a sale-time discount.
  // A Receipt's commission debits here and credits the customer.
  { id: '450001', name: 'COMMISSION ALLOWED', groupId: '4000', linkCode: 'A', status: 'Active' },
  // COST OF GOODS SOLD and the generic EXPENSES catch-all from the legacy
  // list, kept distinct from PURCHASES (raw material bought, not yet sold).
  { id: '460001', name: 'COST OF GOODS SOLD', groupId: '4000', linkCode: 'A', status: 'Active' },
  { id: '470001', name: 'GENERAL EXPENSES', groupId: '4000', linkCode: 'A', status: 'Active' },
];

const demoBusinessAccounts: BusinessAccount[] = [
  { id: '11000101', name: 'Ahmed Footwear (LHR)', controlId: '110001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '11000102', name: 'Karachi Boot House (KHI)', controlId: '110001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '11000103', name: 'Malik Traders (HYD)', controlId: '110001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '11000104', name: 'Mardan Shoe Mart (MRD)', controlId: '110001', linkCode: 'A', region: 'NORTH', status: 'Active' },
  // The single cash account. 4-digit serial like every other new account; the
  // old 2-digit form caps a chart head at 99 children.
  { id: '1200010001', name: 'Petty Cash', controlId: '120001', linkCode: 'A', region: 'LOCAL', status: 'Active', openingBalance: 50000, openingDate: '2026-07-01' },
  // Banks live UNDER the BANK ACCOUNTS chart head, so adding a third is data,
  // not a schema change. Two here on purpose — a single bank would let the
  // "which account?" picker look decorative when it is load-bearing.
  { id: '1200020001', name: 'Bank Alfalah A/C - 0124', controlId: '120002', linkCode: 'A', region: 'LOCAL', status: 'Active', openingBalance: 850000, openingDate: '2026-07-01' },
  { id: '1200020002', name: 'HBL A/C - 4419', controlId: '120002', linkCode: 'A', region: 'LOCAL', status: 'Active', openingBalance: 320000, openingDate: '2026-07-01' },
  { id: '1200020003', name: 'UBL A/C - 7732', controlId: '120002', linkCode: 'A', region: 'LOCAL', status: 'Active', openingBalance: 150000, openingDate: '2026-07-01' },
  { id: '42000101', name: 'Office Utilities A/C', controlId: '420001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '21000101', name: 'Decent Polyurethane A/C', controlId: '210001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '21000102', name: 'Lahore Chemical Industries A/C', controlId: '210001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '21000103', name: 'Star Sole Materials A/C', controlId: '210001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '21000104', name: 'Multan Rubber Works A/C', controlId: '210001', linkCode: 'A', region: 'CENTRAL', status: 'Active' },
  { id: '21000105', name: 'Sukkur Sole Traders A/C', controlId: '210001', linkCode: 'A', region: 'SOUTH', status: 'Active' },
  { id: '21000106', name: 'Punjab Buckle & Fasteners A/C', controlId: '210001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  // Employees (410001 / WAGES EXPENSE) — off-payroll staff paid straight as an
  // expense, distinct from the piece-rate workers under 220001.
  { id: '41000101', name: 'Noman Butt (Upperman, Muridke)', controlId: '410001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '41000102', name: 'Zafar (Chowkidaar)', controlId: '410001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  // Directors Expenses - Drawings (440001) — every named draw/personal-use
  // account the directors track separately from business running expenses.
  { id: '44000101', name: 'Usman Bhatti', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000102', name: 'Abu Bakar', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000103', name: 'Imran Amir', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000104', name: 'Dhoodh', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000105', name: 'Haji Sb.', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000106', name: 'Zakat', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000107', name: 'Charity', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000108', name: 'Committee', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000109', name: 'Hafiz Irfan', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000110', name: 'Vehicles Owned', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000111', name: 'Saggian Factory', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000112', name: 'Umer Farooq Bhatti', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000113', name: 'Aarzi Account', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000114', name: '@Home Bills', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000115', name: 'UK Remittance', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000116', name: 'Payable Pays', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '44000117', name: 'Borrowings', controlId: '440001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010001', name: 'Noman Butt A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010002', name: 'Zafar Hussain A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010003', name: 'Imran Amir A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010004', name: 'Rashid Bending Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010005', name: 'Akram Stubble Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010006', name: 'Waseem Shape Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010007', name: 'Bilal Chipkai Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010008', name: 'Amir Bottom Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010009', name: 'Shahid Machine Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010010', name: 'Kashif Trimming Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010011', name: 'Nadeem Socks Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200010012', name: 'Tariq Finish Man A/C', controlId: '220001', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  // Salaried staff sit under SALARIES PAYABLE (220002), so their codes run
  // 2200020001+ while workers keep 2200010001+.
  { id: '2200020001', name: 'Jawad Iqbal (Manager) A/C', controlId: '220002', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200020002', name: 'Farhan Sheikh (Accountant) A/C', controlId: '220002', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200020003', name: 'Saeed Anwar (Storekeeper) A/C', controlId: '220002', linkCode: 'A', region: 'LOCAL', status: 'Active' },
  { id: '2200020004', name: 'Ilyas Khan (Driver) A/C', controlId: '220002', linkCode: 'A', region: 'LOCAL', status: 'Active' },
];

const demoCustomers: Customer[] = [
  { id: 'c1', name: 'Ahmed Footwear (LHR)', acId: '110001', regionId: 'rg1', cityId: 'ct1' },
  { id: 'c2', name: 'Karachi Boot House (KHI)', acId: '110001', regionId: 'rg3', cityId: 'ct2' },
  { id: 'c3', name: 'Malik Traders (HYD)', acId: '110001', regionId: 'rg3', cityId: 'ct3' },
  { id: 'c4', name: 'Mardan Shoe Mart (MRD)', acId: '110001', regionId: 'rg2', cityId: 'ct4' },
  { id: 'c5', name: 'Multan Traders (MUL)', acId: '110001', regionId: 'rg4', cityId: 'ct5' },
  { id: 'c6', name: 'Sukkur Wholesale Footwear (SUK)', acId: '110001', regionId: 'rg3', cityId: 'ct6' },
  { id: 'c7', name: 'Gulberg Shoe Palace (LHR)', acId: '110001', regionId: 'rg1', cityId: 'ct1' },
  { id: 'c8', name: 'Saddar Footwear Traders (KHI)', acId: '110001', regionId: 'rg3', cityId: 'ct2' },
];

const demoSubCustomers: SubCustomer[] = [
  { id: 'sub1', name: 'Saleem Transport Agent', regionId: 'rg1', cityId: 'ct1' },
  { id: 'sub2', name: 'Liaqat Traders Karachi', regionId: 'rg3', cityId: 'ct2' },
  { id: 'sub3', name: 'Ghafoor Bakhsh Agency', regionId: 'rg3', cityId: 'ct3' },
  { id: 'sub4', name: 'Khyber Delivery Hub', regionId: 'rg2', cityId: 'ct4' },
  { id: 'sub5', name: 'Multan Freight Forwarders', regionId: 'rg4', cityId: 'ct5' },
  { id: 'sub6', name: 'Sindh Goods Carrier', regionId: 'rg3', cityId: 'ct6' },
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
  },
  {
    id: 'sb4', date: '2026-07-06', storeId: 'st1', customerId: 'c5', subCustomerId: 'sub5',
    billNo: '10048', gpNo: '2315', biltyNo: '77621', addaId: 'ad3', remarks: 'Regular monthly order',
    invoiceDiscount: 300, totalValue: 23700, status: 'Posted',
    items: [
      { id: 'sbi4', productId: '1002', productName: 'P-102 Jogger Sole White', packing: 12, cartons: 4, pairs: 48, rate: 500, discountPercent: 0, discountValue: 0, value: 24000 },
    ]
  },
  {
    // Due date set but still in the future — should NOT raise a payment
    // overdue alert (only past-due unpaid bills alert).
    id: 'sb5', date: '2026-07-09', storeId: 'st2', customerId: 'c6', subCustomerId: null,
    billNo: '10049', gpNo: '2318', biltyNo: '77812', addaId: 'ad4', remarks: 'New account — first order',
    invoiceDiscount: 0, totalValue: 29640, dueDate: '2026-08-15', status: 'Posted',
    items: [
      { id: 'sbi5', productId: '2001', productName: 'E-551 Casual Slipper Brown', packing: 12, cartons: 10, pairs: 120, rate: 260, discountPercent: 5, discountValue: 1560, value: 29640 },
    ]
  },
  {
    // Unposted — exercises the "Post Bill" toggle and confirms it stays out
    // of every ledger/report until posted.
    id: 'sb6', date: '2026-07-19', storeId: 'st1', customerId: 'c7', subCustomerId: null,
    billNo: '10050', gpNo: '2322', biltyNo: '77930', addaId: 'ad1', remarks: 'Awaiting confirmation from customer',
    invoiceDiscount: 0, totalValue: 16920, status: 'Unposted',
    items: [
      { id: 'sbi6', productId: '1001', productName: 'P-101 Jogger Sole Black', packing: 12, cartons: 3, pairs: 36, rate: 470, discountPercent: 0, discountValue: 0, value: 16920 },
    ]
  },
  {
    id: 'sb7', date: '2026-07-21', storeId: 'st1', customerId: 'c8', subCustomerId: 'sub6',
    billNo: '10051', gpNo: '2327', biltyNo: '78015', addaId: 'ad2', remarks: 'Formal wear season order',
    invoiceDiscount: 1440, totalValue: 60000, status: 'Posted',
    items: [
      { id: 'sbi7', productId: '3001', productName: 'F-909 Formal Oxford Sole Black', packing: 12, cartons: 8, pairs: 96, rate: 640, discountPercent: 0, discountValue: 0, value: 61440 },
    ]
  },
  {
    // A second, more recently overdue bill — so alerts/reports show more
    // than one customer with a payment-overdue condition.
    id: 'sb8', date: '2026-06-15', storeId: 'st1', customerId: 'c2', subCustomerId: 'sub2',
    billNo: '10052', gpNo: '2280', biltyNo: '76210', addaId: 'ad1', remarks: 'Credit terms — 20 days',
    invoiceDiscount: 0, totalValue: 46800, dueDate: '2026-07-05', status: 'Posted',
    items: [
      { id: 'sbi8', productId: '2002', productName: 'E-551 Casual Slipper Black', packing: 12, cartons: 15, pairs: 180, rate: 260, discountPercent: 0, discountValue: 0, value: 46800 },
    ]
  },
  {
    id: 'sb9', date: '2026-07-24', storeId: 'st2', customerId: 'c4', subCustomerId: null,
    billNo: '10053', gpNo: '2331', biltyNo: '78122', addaId: 'ad2', remarks: 'Kito sole — new article trial order',
    invoiceDiscount: 0, totalValue: 22320, status: 'Posted',
    items: [
      { id: 'sbi9', productId: '4001', productName: 'K-303 Kito Sole Black', packing: 12, cartons: 6, pairs: 72, rate: 310, discountPercent: 0, discountValue: 0, value: 22320 },
    ]
  },
  {
    id: 'sb10', date: '2026-07-26', storeId: 'st1', customerId: 'c1', subCustomerId: 'sub1',
    billNo: '10054', gpNo: '2335', biltyNo: '78205', addaId: 'ad3', remarks: 'Sample order before bulk commitment',
    invoiceDiscount: 0, totalValue: 15120, status: 'Unposted',
    items: [
      { id: 'sbi10', productId: '4002', productName: 'K-303 Kito Sole White', packing: 12, cartons: 4, pairs: 48, rate: 315, discountPercent: 0, discountValue: 0, value: 15120 },
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
  },
  {
    id: 'sr2', date: '2026-07-08', storeId: 'st1', customerId: 'c2', subCustomerId: 'sub-same',
    billNo: 'RET-002', gpNo: '0', biltyNo: '0', remarks: 'Wrong size shipped', status: 'Posted',
    items: [
      { id: 'sri2', productId: '1002', productName: 'P-102 Jogger Sole White', packing: 12, cartons: 1, pairs: 12, rate: 500, discountPercent: 0, discountValue: 0, value: 6000 }
    ]
  },
  {
    id: 'sr3', date: '2026-07-17', storeId: 'st1', customerId: 'c3', subCustomerId: 'sub-same',
    billNo: 'RET-003', gpNo: '0', biltyNo: '0', remarks: 'Excess quantity delivered, partial return', status: 'Posted',
    items: [
      { id: 'sri3', productId: '2001', productName: 'E-551 Casual Slipper Brown', packing: 12, cartons: 5, pairs: 60, rate: 520, discountPercent: 0, discountValue: 0, value: 31200 }
    ]
  },
  {
    // Unposted return — should not affect any ledger/stock until posted.
    id: 'sr4', date: '2026-07-25', storeId: 'st2', customerId: 'c7', subCustomerId: 'sub-same',
    billNo: 'RET-004', gpNo: '0', biltyNo: '0', remarks: 'Awaiting quality inspection', status: 'Unposted',
    items: [
      { id: 'sri4', productId: '1001', productName: 'P-101 Jogger Sole Black', packing: 12, cartons: 2, pairs: 24, rate: 470, discountPercent: 0, discountValue: 0, value: 11280 }
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
  // Online transfer — lands directly in a named bank.
  { id: 'r4', date: '2026-07-08', customerId: 'c4', amount: 20000, paymentMode: 'Online', bankId: 'bank1', details: 'Online transfer — Bank Alfalah', remarks: 'Partial payment' },
  // Cash with a payment-time Commission (Amount Due -> After Commission).
  { id: 'r5', date: '2026-07-10', customerId: 'c5', amount: 12000, commission: 500, paymentMode: 'Cash', details: 'Cash via agent', remarks: 'Commission deducted at payment time' },
  // Cheque fully DEPOSITED into a bank — one ACTIVE allocation covers it.
  {
    id: 'r6', date: '2026-07-06', customerId: 'c1', amount: 30000, paymentMode: 'Cheque',
    details: 'Alfalah, Model Town Branch',
    chequeNo: '5561203', chequeDate: '2026-07-15', chequeReceivedDate: '2026-07-06',
    chequeStatus: 'DEPOSITED', depositBankId: 'bank1', remarks: 'CHEQUE 5561203 15-07-2026'
  },
  // Cheque CLEARED — deposited and confirmed cleared by the bank.
  {
    id: 'r7', date: '2026-06-25', customerId: 'c2', amount: 18000, paymentMode: 'Cheque',
    details: 'HBL, Shahalam Branch',
    chequeNo: '7789021', chequeDate: '2026-07-01', chequeReceivedDate: '2026-06-25',
    chequeStatus: 'CLEARED', depositBankId: 'bank2', remarks: 'CHEQUE 7789021 01-07-2026 — cleared'
  },
  // Cheque BOUNCED — one prior endorsement got reversed by the bounce cascade.
  {
    id: 'r8', date: '2026-07-09', customerId: 'c3', amount: 25000, paymentMode: 'Cheque',
    details: 'MCB, Latifabad Branch',
    chequeNo: '3341087', chequeDate: '2026-07-14', chequeReceivedDate: '2026-07-09',
    chequeStatus: 'BOUNCED', bouncedDate: '2026-07-22', remarks: 'CHEQUE 3341087 — bounced, insufficient funds'
  },
  // Cheque PARTIALLY_ENDORSED — due soon (amber) since it's still open.
  {
    id: 'r9', date: '2026-07-15', customerId: 'c4', amount: 40000, paymentMode: 'Cheque',
    details: 'Bank Alfalah, DHA Branch',
    chequeNo: '9902234', chequeDate: '2026-08-02', chequeReceivedDate: '2026-07-15',
    chequeStatus: 'PARTIALLY_ENDORSED', remarks: 'CHEQUE 9902234 02-08-2026'
  },
  // Cheque fully ENDORSED to a vendor — no longer alerts even though its
  // date has passed, since it's already disposed.
  {
    id: 'r10', date: '2026-07-11', customerId: 'c1', amount: 22000, paymentMode: 'Cheque',
    details: 'HBL, Gulberg Branch',
    chequeNo: '6647701', chequeDate: '2026-07-25', chequeReceivedDate: '2026-07-11',
    chequeStatus: 'ENDORSED', remarks: 'CHEQUE 6647701 25-07-2026 — endorsed to vendor'
  },
  { id: 'r11', date: '2026-07-20', customerId: 'c6', amount: 18500, paymentMode: 'Cash', details: 'Cash collection on delivery', remarks: 'First order payment' },
  { id: 'r12', date: '2026-07-23', customerId: 'c7', amount: 16920, paymentMode: 'Online', bankId: 'bank2', details: 'Online transfer — HBL', remarks: 'Full settlement' },
];

const demoExpenses: Expense[] = [
  { id: 'exp1', date: '2026-07-02', businessAccountId: '42000101', amount: 3500, paymentMode: 'Cash', details: 'Office utilities bill payment', remarks: 'Paid from petty cash' },
  // Was paymentMode 'Cheque' with the number buried in free text ("Cheque No.
  // 441098 HBL"). It is a cheque WentoX wrote, so it is ChequeIssued, drawn on
  // a real bank account, with the number in its own field.
  { id: 'exp2', date: '2026-07-05', businessAccountId: '21000101', amount: 15000, paymentMode: 'ChequeIssued', bankId: 'bank2', issuedChequeNo: '441098', issuedChequeDate: '2026-07-05', details: 'Raw material payment', remarks: 'Paid to Decent PU' },
  // Directors Expenses - Drawings — exercises TASK-14's restricted category.
  { id: 'exp3', date: '2026-07-06', businessAccountId: '44000101', amount: 25000, paymentMode: 'Cash', details: 'Personal draw', remarks: "Director's drawing — Usman Bhatti" },
  { id: 'exp4', date: '2026-07-09', businessAccountId: '44000106', amount: 50000, paymentMode: 'Online', bankId: 'bank1', details: 'Zakat payment', remarks: 'Annual zakat' },
  // Employees (410001).
  { id: 'exp5', date: '2026-07-12', businessAccountId: '41000101', amount: 18000, paymentMode: 'Cash', details: 'Monthly wage', remarks: 'Employee payment — Noman Butt' },
  { id: 'exp6', date: '2026-07-14', businessAccountId: '41000102', amount: 15000, paymentMode: 'Cash', details: 'Monthly wage', remarks: 'Employee payment — Zafar' },
  // Vendors - Suppliers, across payment modes.
  { id: 'exp7', date: '2026-07-15', businessAccountId: '21000102', amount: 8000, paymentMode: 'Cash', details: 'Partial payment for chemicals', remarks: 'Vendor payment' },
  { id: 'exp8', date: '2026-07-17', businessAccountId: '21000103', amount: 12000, paymentMode: 'Online', bankId: 'bank2', details: 'Online transfer for materials', remarks: 'Vendor payment' },
  { id: 'exp9', date: '2026-07-19', businessAccountId: '42000101', amount: 4200, paymentMode: 'Online', bankId: 'bank1', details: 'Electricity bill', remarks: 'Utility payment' },
  { id: 'exp10', date: '2026-07-21', businessAccountId: '44000110', amount: 30000, paymentMode: 'ChequeIssued', bankId: 'bank2', issuedChequeNo: '441105', issuedChequeDate: '2026-07-21', details: 'Vehicle maintenance', remarks: "Director's expense — Vehicles Owned" },
  { id: 'exp11', date: '2026-07-23', businessAccountId: '44000117', amount: 100000, paymentMode: 'Online', bankId: 'bank1', details: 'Loan repayment installment', remarks: "Director's expense — Borrowings" },
  { id: 'exp12', date: '2026-07-24', businessAccountId: '21000104', amount: 9500, paymentMode: 'Cash', details: 'Cash payment for rubber sheets', remarks: 'Vendor payment' },
  { id: 'exp13', date: '2026-07-25', businessAccountId: '44000107', amount: 20000, paymentMode: 'Cash', details: 'Charity donation', remarks: "Director's expense — Charity" },
  { id: 'exp14', date: '2026-07-26', businessAccountId: '21000106', amount: 6000, paymentMode: 'ChequeIssued', bankId: 'bank1', issuedChequeNo: '441106', issuedChequeDate: '2026-07-26', details: 'Buckle fasteners payment', remarks: 'Vendor payment' },
  // Hands on part of r9's still-open cheque directly from the Expenses page
  // (the "Cheque — Endorse" mode), separate from the Cheques-tab dispose flow.
  { id: 'exp15', date: '2026-07-19', businessAccountId: '21000105', amount: 10000, paymentMode: 'ChequeEndorsed', chequeId: 'r9', details: 'Endorsed part of cheque 9902234 to vendor', remarks: 'Cheque endorsement via Expenses page' },
];

// WentoX's own bank accounts. Same party pattern as vendors and employees:
// profile row plus a unique baId under BANK ACCOUNTS (120002).
const demoBankAccounts: BankAccount[] = [
  { id: 'bank1', name: 'Bank Alfalah A/C - 0124', accountNo: '0124-7901-33', branch: 'Gulberg, Lahore', baId: '1200020001' },
  { id: 'bank2', name: 'HBL A/C - 4419', accountNo: '4419-0088-21', branch: 'Shahalam, Lahore', baId: '1200020002' },
  { id: 'bank3', name: 'UBL A/C - 7732', accountNo: '7732-1145-09', branch: 'Model Town, Lahore', baId: '1200020003' },
];

// Cash banked on the 6th: takings out of petty cash into Alfalah. Neither
// income nor expense — which is exactly why it needs its own document.
const demoTransfers: Transfer[] = [
  { id: 'trf1', date: '2026-07-06', fromBaId: '1200010001', toBaId: '1200020001', amount: 40000, remarks: 'Cash takings banked' },
  { id: 'trf2', date: '2026-07-13', fromBaId: '1200020002', toBaId: '1200020001', amount: 100000, remarks: 'Bank to bank — consolidating funds' },
  { id: 'trf3', date: '2026-07-20', fromBaId: '1200020001', toBaId: '1200010001', amount: 15000, remarks: 'Cash withdrawn to pay wages' },
  { id: 'trf4', date: '2026-07-24', fromBaId: '1200010001', toBaId: '1200020003', amount: 20000, remarks: 'Cash takings banked into UBL' },
];

// Money entering/leaving the books from outside — not a receipt, not a
// transfer. Credit = owner capital / loan / refund. Debit = bank charges /
// error correction / unrecorded deduction.
const demoDeposits: Deposit[] = [
  { id: 'dep1', date: '2026-07-01', toBaId: '1200020001', direction: 'credit', amount: 500000, source: 'Owner Capital', remarks: 'Initial capital injection for the season' },
  { id: 'dep2', date: '2026-07-11', toBaId: '1200020002', direction: 'credit', amount: 300000, source: 'Bank Loan', remarks: 'Working capital loan disbursed' },
  { id: 'dep3', date: '2026-07-16', toBaId: '1200020001', direction: 'debit', amount: 1200, source: 'Bank Charges', remarks: 'Quarterly account maintenance fee' },
  { id: 'dep4', date: '2026-07-22', toBaId: '1200010001', direction: 'credit', amount: 25000, source: 'Insurance Refund', remarks: 'Refund for a non-vendor claim, received in cash' },
  { id: 'dep5', date: '2026-07-27', toBaId: '1200020003', direction: 'debit', amount: 800, source: 'Correction', remarks: 'Reversing a duplicate online transfer entry' },
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
  },
  {
    id: 'pu2', date: '2026-07-08', vendorId: 'v2', remarks: 'Chemical restock',
    items: [
      { id: 'pui3', materialName: 'EVA Foam Sheet', unit: 'Kg', quantity: 300, pricePerUnit: 45, totalPrice: 13500 },
      { id: 'pui4', materialName: 'Adhesive Solution', unit: 'Liters', quantity: 50, pricePerUnit: 220, totalPrice: 11000 }
    ],
    totalValue: 24500
  },
  {
    id: 'pu3', date: '2026-07-12', vendorId: 'v3', remarks: 'Formal sole materials',
    items: [
      { id: 'pui5', materialName: 'PVC Granules', unit: 'Kg', quantity: 500, pricePerUnit: 60, totalPrice: 30000 }
    ],
    totalValue: 30000
  },
  {
    id: 'pu4', date: '2026-07-16', vendorId: 'v4', remarks: 'Rubber compound for Kito sole',
    items: [
      { id: 'pui6', materialName: 'TPR Compound', unit: 'Kg', quantity: 400, pricePerUnit: 55, totalPrice: 22000 }
    ],
    totalValue: 22000
  },
  {
    id: 'pu5', date: '2026-07-20', vendorId: 'v5', remarks: 'Sole material restock — Sukkur',
    items: [
      { id: 'pui7', materialName: 'PU Sheet Roll', unit: 'Meters', quantity: 150, pricePerUnit: 88, totalPrice: 13200 }
    ],
    totalValue: 13200
  },
  {
    id: 'pu6', date: '2026-07-25', vendorId: 'v6', remarks: 'Buckle and fastener restock',
    items: [
      { id: 'pui8', materialName: 'Buckle Fasteners', unit: 'Buckles', quantity: 800, pricePerUnit: 13, totalPrice: 10400 },
      { id: 'pui9', materialName: 'Eyelets', unit: 'Pieces', quantity: 1000, pricePerUnit: 3, totalPrice: 3000 }
    ],
    totalValue: 13400
  }
];

const demoPurchaseReturns: PurchaseReturn[] = [
  {
    id: 'pr1', date: '2026-07-10', vendorId: 'v1', remarks: 'Defective PU sheet roll returned',
    items: [
      { id: 'pri1', materialName: 'PU Sheet Roll', unit: 'Meters', quantity: 20, pricePerUnit: 85, totalPrice: 1700 }
    ],
    totalValue: 1700
  },
  {
    id: 'pr2', date: '2026-07-14', vendorId: 'v2', remarks: 'Excess adhesive returned',
    items: [
      { id: 'pri2', materialName: 'Adhesive Solution', unit: 'Liters', quantity: 10, pricePerUnit: 220, totalPrice: 2200 }
    ],
    totalValue: 2200
  },
  {
    id: 'pr3', date: '2026-07-22', vendorId: 'v4', remarks: 'Substandard TPR compound batch returned',
    items: [
      { id: 'pri3', materialName: 'TPR Compound', unit: 'Kg', quantity: 50, pricePerUnit: 55, totalPrice: 2750 }
    ],
    totalValue: 2750
  }
];

const demoChequeAllocations: ChequeAllocation[] = [
  // r6 — fully deposited into Bank Alfalah.
  { id: 'ca1', receiptId: 'r6', dispositionType: 'DEPOSIT', targetType: null, targetId: null, amount: 30000, allocationDate: '2026-07-07', remarks: 'Deposited into Bank Alfalah', status: 'ACTIVE' },
  // r7 — deposited into HBL, later marked Cleared on the receipt itself.
  { id: 'ca2', receiptId: 'r7', dispositionType: 'DEPOSIT', targetType: null, targetId: null, amount: 18000, allocationDate: '2026-06-26', remarks: 'Deposited into HBL', status: 'ACTIVE' },
  // r8 — was endorsed to a vendor, then the cheque bounced: the allocation
  // is REVERSED (kept, not deleted) by the bounce cascade.
  { id: 'ca3', receiptId: 'r8', dispositionType: 'VENDOR_PAYMENT', targetType: 'VENDOR', targetId: 'v2', amount: 25000, allocationDate: '2026-07-12', remarks: 'Endorsed to Lahore Chemical Industries — later reversed by bounce', status: 'REVERSED' },
  // r9 — only partially endorsed (15,000 of 40,000), leaving 25,000 open —
  // this is what keeps it PARTIALLY_ENDORSED and still alert-eligible.
  { id: 'ca4', receiptId: 'r9', dispositionType: 'EXPENSE_PAYMENT', targetType: 'BUSINESS_ACCOUNT', targetId: '42000101', amount: 15000, allocationDate: '2026-07-18', remarks: 'Partial endorsement to Office Utilities', status: 'ACTIVE' },
  // r10 — fully endorsed to a vendor, so it drops out of the alerts list
  // even though its cheque date has since passed.
  { id: 'ca5', receiptId: 'r10', dispositionType: 'VENDOR_PAYMENT', targetType: 'VENDOR', targetId: 'v3', amount: 22000, allocationDate: '2026-07-20', remarks: 'Full endorsement to Star Sole Materials', status: 'ACTIVE' },
];

// Production entries — the only stock-in source for finished articles (§
// Milestone 4 scope correction). Spread across products/dates so Weekly,
// Monthly, Overall Production and Product Ledger all have real rows to filter.
const demoProductionLogs: ProductionLog[] = [
  { id: 'pl1', date: '2026-06-18', productId: '1001', quantity: 240, qtyValue: 20, unitType: 'cartons', packing: 12 },
  { id: 'pl2', date: '2026-06-20', productId: '1002', quantity: 120, qtyValue: 10, unitType: 'cartons', packing: 12 },
  { id: 'pl3', date: '2026-06-25', productId: '2001', quantity: 360, qtyValue: 30, unitType: 'cartons', packing: 12 },
  { id: 'pl4', date: '2026-06-29', productId: '3001', quantity: 96, qtyValue: 8, unitType: 'cartons', packing: 12 },
  { id: 'pl5', date: '2026-07-01', productId: '1001', quantity: 60, qtyValue: 5, unitType: 'cartons', packing: 12 },
  { id: 'pl6', date: '2026-07-03', productId: '1004', quantity: 84, qtyValue: 7, unitType: 'cartons', packing: 12 },
  { id: 'pl7', date: '2026-07-05', productId: '2002', quantity: 120, qtyValue: 10, unitType: 'cartons', packing: 12 },
  { id: 'pl8', date: '2026-07-07', productId: '4001', quantity: 180, qtyValue: 15, unitType: 'cartons', packing: 12 },
  { id: 'pl9', date: '2026-07-08', productId: '4002', quantity: 108, qtyValue: 9, unitType: 'cartons', packing: 12 },
  { id: 'pl10', date: '2026-07-10', productId: '1002', quantity: 36, qtyValue: 3, unitType: 'cartons', packing: 12 },
  { id: 'pl11', date: '2026-07-12', productId: '3001', quantity: 48, qtyValue: 4, unitType: 'cartons', packing: 12 },
  { id: 'pl12', date: '2026-07-14', productId: '2001', quantity: 240, qtyValue: 20, unitType: 'cartons', packing: 12 },
  { id: 'pl13', date: '2026-07-16', productId: '1001', quantity: 30, qtyValue: 0, unitType: 'pairs', packing: 12 },
  { id: 'pl14', date: '2026-07-18', productId: '4001', quantity: 72, qtyValue: 6, unitType: 'cartons', packing: 12 },
  { id: 'pl15', date: '2026-07-20', productId: '2002', quantity: 96, qtyValue: 8, unitType: 'cartons', packing: 12 },
  { id: 'pl16', date: '2026-07-22', productId: '3001', quantity: 60, qtyValue: 5, unitType: 'cartons', packing: 12 },
  { id: 'pl17', date: '2026-07-24', productId: '1002', quantity: 48, qtyValue: 4, unitType: 'cartons', packing: 12 },
  { id: 'pl18', date: '2026-07-26', productId: '4002', quantity: 24, qtyValue: 2, unitType: 'cartons', packing: 12 },
];

// Piece-rate wage runs, one worker + stage per run, spread across weeks so
// Wage Run history has multiple Posted entries plus one Unposted draft.
const demoWageRuns: WageRun[] = [
  { id: 'wg1', employeeId: 'w1', stage: 'cutting', date: '2026-07-10', status: 'Posted', totalAmount: 2160,
    items: [{ id: 'wgi1', productId: '1001', productName: 'P-101 Jogger Sole Black', rate: 18, cartons: 10, packing: 12, amount: 2160 }] },
  { id: 'wg2', employeeId: 'w2', stage: 'edging', date: '2026-07-10', status: 'Posted', totalAmount: 576,
    items: [{ id: 'wgi2', productId: '1002', productName: 'P-102 Jogger Sole White', rate: 6, cartons: 8, packing: 12, amount: 576 }] },
  { id: 'wg3', employeeId: 'w4', stage: 'bending', date: '2026-07-12', status: 'Posted', totalAmount: 900,
    items: [{ id: 'wgi3', productId: '2001', productName: 'E-551 Casual Slipper Brown', rate: 5, cartons: 15, packing: 12, amount: 900 }] },
  { id: 'wg4', employeeId: 'w8', stage: 'bottom', date: '2026-07-15', status: 'Unposted', totalAmount: 3600,
    items: [{ id: 'wgi4', productId: '3001', productName: 'F-909 Formal Oxford Sole Black', rate: 60, cartons: 5, packing: 12, amount: 3600 }] },
  { id: 'wg5', employeeId: 'w9', stage: 'machine', date: '2026-07-16', status: 'Posted', totalAmount: 1728,
    items: [{ id: 'wgi5', productId: '1001', productName: 'P-101 Jogger Sole Black', rate: 12, cartons: 12, packing: 12, amount: 1728 }] },
  { id: 'wg6', employeeId: 'w12', stage: 'finish', date: '2026-07-18', status: 'Posted', totalAmount: 1200,
    items: [{ id: 'wgi6', productId: '2001', productName: 'E-551 Casual Slipper Brown', rate: 5, cartons: 20, packing: 12, amount: 1200 }] },
  { id: 'wg7', employeeId: 'w3', stage: 'upStitch', date: '2026-07-20', status: 'Posted', totalAmount: 2520,
    items: [{ id: 'wgi7', productId: '3001', productName: 'F-909 Formal Oxford Sole Black', rate: 35, cartons: 6, packing: 12, amount: 2520 }] },
  { id: 'wg8', employeeId: 'w5', stage: 'stubbleDori', date: '2026-07-22', status: 'Unposted', totalAmount: 720,
    items: [{ id: 'wgi8', productId: '4001', productName: 'K-303 Kito Sole Black', rate: 6, cartons: 10, packing: 12, amount: 720 }] },
];

// One month fully Posted, one Posted before it, and the current month still
// an open Unposted draft with one deduction — the three shapes Salary Runs
// need to be tested against.
const demoSalaryRuns: SalaryRun[] = [
  { id: 'sal1', periodMonth: '2026-05', date: '2026-05-31', status: 'Posted', totalAmount: 222000,
    items: [
      { id: 'sri_s1_1', employeeId: 's1', salaryAmount: 85000, amount: 85000 },
      { id: 'sri_s1_2', employeeId: 's2', salaryAmount: 60000, amount: 60000 },
      { id: 'sri_s1_3', employeeId: 's3', salaryAmount: 42000, amount: 42000 },
      { id: 'sri_s1_4', employeeId: 's4', salaryAmount: 35000, amount: 35000 },
    ] },
  { id: 'sal2', periodMonth: '2026-06', date: '2026-06-30', status: 'Posted', totalAmount: 222000,
    items: [
      { id: 'sri_s2_1', employeeId: 's1', salaryAmount: 85000, amount: 85000 },
      { id: 'sri_s2_2', employeeId: 's2', salaryAmount: 60000, amount: 60000 },
      { id: 'sri_s2_3', employeeId: 's3', salaryAmount: 42000, amount: 42000 },
      { id: 'sri_s2_4', employeeId: 's4', salaryAmount: 35000, amount: 35000 },
    ] },
  { id: 'sal3', periodMonth: '2026-07', date: '2026-07-31', status: 'Unposted', totalAmount: 220000,
    items: [
      { id: 'sri_s3_1', employeeId: 's1', salaryAmount: 85000, amount: 85000 },
      { id: 'sri_s3_2', employeeId: 's2', salaryAmount: 60000, amount: 60000 },
      { id: 'sri_s3_3', employeeId: 's3', salaryAmount: 42000, amount: 40000, remarks: 'Advance deducted' },
      { id: 'sri_s3_4', employeeId: 's4', salaryAmount: 35000, amount: 35000 },
    ] },
];

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
  employees: Employee[];
  bankAccounts: BankAccount[];
  transfers: Transfer[];
  deposits: Deposit[];
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
  // Session-scoped, not persisted: true once the Home page's real-alerts card has been closed this
  // login — reset to false on every LOGIN_SUCCESS so it shows again on a fresh session.
  homeAlertsCardClosed: boolean;
  wageRuns: WageRun[];
  salaryRuns: SalaryRun[];
  materialAdjustments: MaterialAdjustment[];

  settings: { username: string; password: string };
}

type Action =
  // Dispatched only after a real `api.login(...)` round-trip has already resolved
  // successfully (see LoginPage.tsx) — the reducer never touches credentials itself.
  | { type: 'LOGIN_SUCCESS'; payload: { username: string; role: UserRole } }
  | { type: 'LOGOUT' }
  // The signed-in user renamed their own account from Settings — updates the display name only,
  // no navigation (unlike LOGIN_SUCCESS, which always lands on Home).
  | { type: 'RENAME_CURRENT_USER'; username: string }
  | { type: 'CLOSE_HOME_ALERTS_CARD' }
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
  | { type: 'ADD_EMPLOYEE'; employee: Employee }
  | { type: 'UPDATE_EMPLOYEE'; employee: Employee }
  | { type: 'DELETE_EMPLOYEE'; id: string }
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
  | { type: 'ADD_STORE'; store: Store }
  | { type: 'UPDATE_STORE'; store: Store }
  | { type: 'DELETE_STORE'; id: string }
  
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
  | { type: 'UPDATE_BILTY_INFO'; billId: string; biltyNo: string; addaId: string }

  // Alerts (§12)
  | { type: 'DISMISS_ALERT'; alertKey: string; dismissedAt: string }
  | { type: 'RESTORE_ALERTS' }

  // Payroll (payroll.md §8). Both run types share one mutation path:
  // Posted → unpost → Unposted → edit → post → Posted. A Posted run is never
  // edited in place, and deleting is permitted only while Unposted — deleting
  // a Posted one would silently move an employee's balance.
  | { type: 'ADD_WAGE_RUN'; run: WageRun }
  | { type: 'UPDATE_WAGE_RUN'; runId: string; run: WageRun }
  | { type: 'DELETE_WAGE_RUN'; runId: string }
  | { type: 'POST_WAGE_RUN'; runId: string }
  | { type: 'UNPOST_WAGE_RUN'; runId: string; unpostedAt: string }
  | { type: 'ADD_SALARY_RUN'; run: SalaryRun }
  | { type: 'UPDATE_SALARY_RUN'; runId: string; run: SalaryRun }
  | { type: 'DELETE_SALARY_RUN'; runId: string }
  | { type: 'POST_SALARY_RUN'; runId: string }
  | { type: 'UNPOST_SALARY_RUN'; runId: string; unpostedAt: string }

  | { type: 'ADD_MATERIAL_ADJUSTMENT'; adjustment: MaterialAdjustment }
  | { type: 'DELETE_MATERIAL_ADJUSTMENT'; id: string }

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
  employees: demoEmployees,
  bankAccounts: demoBankAccounts,
  transfers: demoTransfers,
  deposits: demoDeposits,
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
  productionLogs: demoProductionLogs,
  chequeAllocations: demoChequeAllocations,
  alertDismissals: [],
  homeAlertsCardClosed: false,
  wageRuns: demoWageRuns,
  salaryRuns: demoSalaryRuns,
  materialAdjustments: [],

  settings: { username: 'admin', password: 'admin' },
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
      localStorage.setItem('wento_sidebar_hidden', 'true');
      return {
        ...state,
        isLoggedIn: true,
        currentUserRole: action.payload.role,
        currentUsername: action.payload.username,
        currentPage: 'home',
        homeAlertsCardClosed: false
      };
    case 'LOGOUT':
      localStorage.setItem('wento_sidebar_hidden', 'true');
      return { ...state, isLoggedIn: false, currentUserRole: null, currentUsername: null, currentPage: 'login' };
    case 'RENAME_CURRENT_USER':
      return { ...state, currentUsername: action.username };
    case 'CLOSE_HOME_ALERTS_CARD':
      return { ...state, homeAlertsCardClosed: true };
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
      return { ...state, products: state.products.map(p => p.id === action.id ? { ...p, isActive: false } : p) };
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
        categories: state.categories.map(c => c.id === action.id ? { ...c, isActive: false } : c)
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
        vendors: state.vendors.map(v => v.id === action.id ? { ...v, isActive: false } : v),
        businessAccounts: deletedVendor
          ? state.businessAccounts.filter(b => b.id !== deletedVendor.baId)
          : state.businessAccounts
      };
    }
    case 'ADD_EMPLOYEE':
      return { ...state, employees: [...state.employees, action.employee] };
    case 'UPDATE_EMPLOYEE':
      return {
        ...state,
        employees: state.employees.map(e => e.id === action.employee.id ? action.employee : e),
        businessAccounts: state.businessAccounts.map(b =>
          b.id === action.employee.baId ? { ...b, name: `${action.employee.name} A/C` } : b
        )
      };
    case 'DELETE_EMPLOYEE': {
      const deleted = state.employees.find(e => e.id === action.id);
      return {
        ...state,
        employees: state.employees.filter(e => e.id !== action.id),
        businessAccounts: deleted
          ? state.businessAccounts.filter(b => b.id !== deleted.baId)
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
        cities: state.cities.map(c => c.id === action.id ? { ...c, isActive: false } : c)
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
        regions: state.regions.map(r => r.id === action.id ? { ...r, isActive: false } : r)
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
        subCustomers: state.subCustomers.map(sc => sc.id === action.id ? { ...sc, isActive: false } : sc)
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
        customers: state.customers.map(c => c.id === action.id ? { ...c, isActive: false } : c),
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
        addas: state.addas.map(a => a.id === action.id ? { ...a, isActive: false } : a)
      };
    case 'ADD_STORE':
      return { ...state, stores: [...state.stores, action.store] };
    case 'UPDATE_STORE':
      return {
        ...state,
        stores: state.stores.map(s => s.id === action.store.id ? action.store : s)
      };
    case 'DELETE_STORE':
      return {
        ...state,
        stores: state.stores.map(s => s.id === action.id ? { ...s, isActive: false } : s)
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

    /* ──── Payroll Handlers (payroll.md §8) ────
     * Unlike sale bills, posting a payroll run has no stock side effect to
     * reverse — a run's only effect is on a balance, and getEmployeeBalance
     * counts Posted runs only. So posting and unposting are pure status flips.
     * Unposting stamps unpostedAt and copies the outgoing total to
     * amountBefore: a labourer holds no paperwork of his own, so without that
     * record a silent edit to what he is owed leaves no trace anywhere.
     */
    case 'ADD_WAGE_RUN':
      return { ...state, wageRuns: [action.run, ...state.wageRuns] };
    case 'UPDATE_WAGE_RUN':
      return {
        ...state,
        wageRuns: state.wageRuns.map(r => r.id === action.runId ? action.run : r)
      };
    case 'DELETE_WAGE_RUN':
      // Guarded here as well as in the UI: deleting a Posted run would move an
      // employee's balance with nothing recording that it happened.
      return {
        ...state,
        wageRuns: state.wageRuns.filter(r => r.id !== action.runId || r.status === 'Posted')
      };
    case 'POST_WAGE_RUN':
      return {
        ...state,
        wageRuns: state.wageRuns.map(r => r.id === action.runId ? { ...r, status: 'Posted' } : r)
      };
    case 'UNPOST_WAGE_RUN':
      return {
        ...state,
        wageRuns: state.wageRuns.map(r =>
          r.id === action.runId && r.status === 'Posted'
            ? { ...r, status: 'Unposted', unpostedAt: action.unpostedAt, amountBefore: r.totalAmount }
            : r
        )
      };

    case 'ADD_SALARY_RUN':
      return { ...state, salaryRuns: [action.run, ...state.salaryRuns] };
    case 'UPDATE_SALARY_RUN':
      return {
        ...state,
        salaryRuns: state.salaryRuns.map(r => r.id === action.runId ? action.run : r)
      };
    case 'DELETE_SALARY_RUN':
      return {
        ...state,
        salaryRuns: state.salaryRuns.filter(r => r.id !== action.runId || r.status === 'Posted')
      };
    case 'POST_SALARY_RUN':
      return {
        ...state,
        salaryRuns: state.salaryRuns.map(r => r.id === action.runId ? { ...r, status: 'Posted' } : r)
      };
    case 'UNPOST_SALARY_RUN':
      return {
        ...state,
        salaryRuns: state.salaryRuns.map(r =>
          r.id === action.runId && r.status === 'Posted'
            ? { ...r, status: 'Unposted', unpostedAt: action.unpostedAt, amountBefore: r.totalAmount }
            : r
        )
      };

    case 'ADD_MATERIAL_ADJUSTMENT':
      return {
        ...state,
        materialAdjustments: [action.adjustment, ...state.materialAdjustments]
      };
    case 'DELETE_MATERIAL_ADJUSTMENT':
      return {
        ...state,
        materialAdjustments: state.materialAdjustments.filter(a => a.id !== action.id)
      };

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
  if (value < 0) return `(Rs ${Math.abs(value).toLocaleString('en-US')})`;
  return 'Rs ' + value.toLocaleString('en-US');
}

/**
 * G-05: the app-wide debit/credit color convention — red for a negative (credit/payable) balance,
 * green for zero or positive (debit/receivable). Pair with `formatCurrency(Math.abs(value))` so
 * the sign is carried by color alone, never a leading "-" (formatCurrency itself already swaps a
 * raw negative for parentheses, but every balance display should use this instead of its own
 * red/green/gray ternary so the rule stays one place).
 */
export function balanceColor(value: number): string {
  return value < 0 ? '#e11d48' : '#047857';
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
