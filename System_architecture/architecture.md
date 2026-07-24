# WentoX — Complete Architecture & Relational Flow

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        WentoX ERP (Electron)                    │
│                                                                 │
│   React Frontend  ◄──── IPC/HTTP ────►  Express Backend        │
│                                              │                  │
│                                         SQLite DB               │
│                                      (local on client PC)       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Entry Pages (INPUT)

These pages are where data is created. Everything else reads from them.

```
┌─────────────────────┐     ┌─────────────────────┐
│    SETUP PAGES      │     │   TRANSACTION PAGES  │
│                     │     │                      │
│  • Product Category │     │  • Sale Bill         │
│  • Products         │     │  • Sale Return       │
│  • Vendors          │     │  • Purchase          │
│  • Customers        │     │  • Receipts (Jamma)  │
│  • Sub Customers    │     │  • Payments (Naam)   │
│  • Cities/Regions   │     │                      │
│  • Stores/Addas     │     │                      │
│  • Group Accounts   │     │                      │
│  • Chart of Accounts│     │                      │
│  • Business Accounts│     │                      │
└─────────────────────┘     └─────────────────────┘
```

---

## 3. Core Relational Flow

```
VENDORS
  │
  ├──► PURCHASE PAGE ──────────────────────────────────┐
  │         │                                           │
  │         ▼                                           │
  │    STOCK (adds pairs to product stock)              │
  │         │                                           │
  │         ▼                                           ▼
  │    CURRENT STOCK PAGE              VENDOR LEDGER / VENDOR REPORT
  │    (shows stock per article)       (total purchase, purchase return,
  │         │                           net purchase, payment paid)
  │         ▼
  │    PRODUCT LEDGER
  │    (pairs IN from purchase,
  │     pairs OUT from sale)
  │
CUSTOMERS
  │
  ├──► SALE BILL ──────────────────────────────────────────┐
  │         │                                               │
  │         │ reduces stock                                 │
  │         ▼                                               │
  │    CURRENT STOCK (stock in hand decreases)              │
  │         │                                               │
  │         ▼                                               ▼
  │    PRODUCT LEDGER (credit/OUT)              ACCOUNT LEDGER (KHAATA)
  │                                             (debit row = sale amount)
  │                                                         │
  ├──► SALE RETURN ──────────────────────────────────────── │
  │         │                                               │
  │         │ increases stock back                          │
  │         ▼                                               │
  │    CURRENT STOCK (stock in hand increases)              │
  │         │                                               ▼
  │         ▼                                    ACCOUNT LEDGER (KHAATA)
  │    PRODUCT LEDGER (debit/IN back)            (credit row = return amount)
  │
  ├──► RECEIPTS (JAMMA) ───────────────────────────────────┐
  │         │                                               │
  │         │ fields: Amount, Type, Narration,              │
  │         │ Cheque No, Date on Cheque,                    │
  │         │ Cheque Received Date, Commission              │
  │         ▼                                               ▼
  │    CASH BOOK OF THE DAY              ACCOUNT LEDGER (KHAATA)
  │    (receipts cash/cheque/online)     (RED row = payment received)
  │                                      (separate row for commission)
  │
BUSINESS ACCOUNTS (expenses entered here)
  │
  ├──► PAYMENT TRAIL
  │    (Business Running Expenses,
  │     Cash at Banks, Directors Expenses,
  │     Employees, Vendors-Suppliers)
  │
  └──► CASH BOOK OF THE DAY
       (payments cash/cheque/online)
```

---

## 4. Reports & Views (OUTPUT)

All reports ONLY READ data — they never insert anything.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          REPORTS / VIEWS                            │
│                                                                     │
│  SOURCE DATA          REPORT                  WHAT IT SHOWS         │
│  ───────────────────────────────────────────────────────────────    │
│                                                                     │
│  Sale Bills      ──► Account Ledger       Debit rows (sales)        │
│  Sale Returns    ──► Account Ledger       Credit rows (returns)     │
│  Receipts/Jamma  ──► Account Ledger       Red rows (payments)       │
│                       + Commission rows                             │
│                                                                     │
│  Sale Bills +        Sale Analysis        Customer wise /           │
│  Sale Returns +  ──► (TASK-09)            Region wise sales,        │
│  Receipts            Sale Report          returns, payments         │
│                       (TASK-18)                                     │
│                                                                     │
│  Receipts +          Cash Book            Daily cash in/out,        │
│  Payments        ──► of the Day           opening cash,             │
│  Business Accts       (TASK-15)           cash in hand              │
│                                                                     │
│  Business Accts  ──► Payment Trail        Amounts per account       │
│  Receipts             (TASK-17)           category, grand total     │
│                                                                     │
│  Purchase +          Vendor Report        Total purchase,           │
│  Purchase Return ──► (TASK-10)            purchase return,          │
│  Vendor Payments                          net purchase,             │
│                                           payment paid              │
│                                                                     │
│  Purchase +          Product Ledger       Pairs IN / OUT            │
│  Sale Bills      ──► (TASK-02)            per article/category      │
│  Sale Returns                                                       │
│                                                                     │
│  All above       ──► Customer Page        Customer cards +          │
│                       (TASK-08)           customer ledger           │
│                                           article wise              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Account Ledger — Row Source Map

```
Account Ledger (Khaata) rows come from:

  SALE BILL       → Debit row    (pairs filled, narration = SAME or delivery)
  SALE RETURN     → Credit row   (pairs filled, narration = SAME or delivery)
  RECEIPT/JAMMA   → RED row      (pairs empty, narration = CASH/CHEQUE/ONLINE)
                    + Commission  (separate row when commission given)
```

---

## 6. Stock Flow

```
PURCHASE (product bought)
    │
    ▼
STOCK INCREASES (+pairs)
    │
    ▼
SALE BILL (product sold)
    │
    ▼
STOCK DECREASES (-pairs)
    │
    ▼
SALE RETURN (product returned by customer)
    │
    ▼
STOCK INCREASES BACK (+pairs)

Current Stock Page = live snapshot of above at any point in time
Product Ledger     = full history of above movements
```

---

## 7. Commission vs Discount Flow

```
SALE BILL
  │
  ├── D% (per article discount)    ──► reduces sale line value
  └── Invoice Discount              ──► reduces total bill value
        │
        └── These are DISCOUNTS — bill amount is already reduced

RECEIPTS (JAMMA)
  │
  └── Commission field              ──► sale bill stays unchanged
        │                               only payable amount reduces
        └── Example:
            Bill = 1,020,000
            Commission = 20,000
            Customer pays = 1,000,000
            Balance = 0
            
            In Ledger:
            Debit (sale)       = 1,020,000
            Commission row     =    20,000
            Credit (payment)   = 1,000,000
            Balance            =         0
```

---

## 8. User Access Control

```
┌─────────────────────────────────────────────────────┐
│                    ALL PAGES                        │
│                                                     │
│   ADMIN ──────────────────────► Full Access ✅      │
│                                                     │
│   USER  ──────────────────────► All pages ✅        │
│            EXCEPT:                                  │
│            • Bank Accounts ❌                       │
│            • Directors Expenses - Drawings ❌        │
└─────────────────────────────────────────────────────┘
```

---

## 9. Complete Page Map

```
WentoX
│
├── HOME (landing page — logo + company name)
│
├── SETUP
│   ├── Product Category
│   ├── Product Detail Info
│   ├── Vendors
│   ├── Customers (cards view — TASK-08)
│   ├── Sub Customers
│   ├── Cities / Regions
│   ├── Stores
│   ├── Addas
│   ├── Group Accounts
│   ├── Chart of Accounts
│   └── Business Accounts
│
├── DATA ENTRY
│   ├── Sale Bill
│   ├── Sale Return
│   ├── Purchase
│   ├── Receipts (Jamma)
│   └── Payments (Naam)
│
├── STOCK
│   ├── Current Stock (with expandable rows + product ledger)
│   └── Product Ledger (filter by date, vendor, article/category)
│
├── ACCOUNTS
│   ├── Account Ledger (Khaata)
│   ├── Business Accounts Ledger
│   └── Cash Book of the Day
│
└── REPORTS (sidebar section)
    │   [Top bar on every report: Daily | Monthly | Annually | Custom]
    │
    ├── Sale Analysis (customer wise + region wise)
    ├── Sale Report (total sales, cartons, commission, return, net, payment)
    ├── Vendor Report (purchase, return, net, payment)
    ├── Payment Trail
    ├── Account Ledger (Khaata)
    ├── Business Accounts Ledger
    ├── Cash Book of the Day
    ├── Product Ledger
    └── Search & Bilty Adda Updation
```

---

## 10. Key Rules (Business Logic)

| Rule | Detail |
|---|---|
| Purchase → Stock | Every purchase immediately adds pairs to stock |
| Sale Bill → Stock | Every sale bill reduces stock |
| Sale Return → Stock | Every return adds pairs back to stock |
| Commission → Jamma | Commission is only recorded in Receipts page, never in sale bill |
| Ledger balance | Opening Balance + all Debits - all Credits = Closing Balance |
| Red rows | Only payment rows (from Jamma) are red in ledger |
| Customer search | Primary = by Region, Secondary = by City |
| Sub customers | Independent — no link to parent customer |
| User role | User cannot see bank accounts or directors expenses |
| Export | Every page with Print also has PDF + Excel export |
