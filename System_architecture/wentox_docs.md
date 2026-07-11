# Wento ERP System — Functional Documentation

> Software by: 3g Software Solutions (pvt) Ltd.
> Fiscal Year observed: 2025–2026

---

## 1. Sale Bill

**Purpose:** Create a sale bill when a customer places an order.

---

### Header Fields

| Field | Description |
|---|---|
| **No.** | Auto-generated primary key for the bill (system assigns it) |
| **Date** | User selects manually |
| **From** | Shipment source (e.g. MAIN STORE LHR) — values come from a stores table in DB |
| **Bill No.** | The printed bill number (e.g. on paper register) — separate from system No. |
| **GP No.** | Gate pass number (manual entry) |
| **Bilty No.** | Delivery receipt number (manual entry) |
| **Adda Code** | An integer code that maps to a transport/adda name in DB (e.g. 89 → some transport name) |

---

### Customer Section

| Field | Description |
|---|---|
| **Customer (code)** | Auto-generated PK from the customers table |
| **Customer Name** | Any string — name of the customer/shop |
| **Main A/C** | Auto-generated PK from parent accounts table — represents the account group/category (e.g. CUSTOMERS ACCOUNTS) |
| **Remarks** | Free text — any notes |

---

### Delivery Section

| Field | Description |
|---|---|
| **Delivery** | `1` = SAME (direct delivery to customer's warehouse). If not SAME, a sub-customer is selected and their delivery info is entered |
| **Sub Cust. Input** | Only filled when delivery is not SAME — holds the sub-customer delivery details |

---

### Product Entry (per line)

| Field | Description |
|---|---|
| **Product No.** | Auto-generated PK in the products table. User enters article number and the product ID is auto-fetched from DB |
| **Packing** | Number of pairs per carton (e.g. 12 = one carton has 12 pairs) |
| **Stock In Hand** | Current available stock for this article (read-only, fetched from DB) |
| **Cartons** | Number of cartons being sold |
| **Pairs** | Total pairs (Cartons × Packing) |
| **Rate** | Price per pair |
| **D%** | Discount percentage per article |
| **DV** | Discount value per article |
| **Value** | Line total = Pairs × Rate after discount |

---

### Bill Summary (bottom)

| Field | Description |
|---|---|
| **Product line items table** | Shows all products added to this bill with Packing, Cartons, Pairs, Rate, Value |
| **Total Cartons** | Sum of all cartons in the bill |
| **Total Pairs** | Sum of all pairs in the bill |
| **Invoice Discount** | Additional discount applied on the total bill (separate from per-article discount) |
| **Total Value** | Final bill amount after all discounts |

---

### Discount Logic

There are **two levels of discount:**
1. **Per article** — D% and DV fields on each product line
2. **Invoice level** — Invoice Discount field at the bottom applied to the total bill

---

### Toolbar Actions

| Button | Action |
|---|---|
| New | Create a new bill |
| Delete | Delete current bill |
| Edit | Edit current bill |
| Save | Save changes |
| Done | Mark as done |
| First / Pre / Next / Last | Navigate between bills |
| Print | Print the bill |
| Find | Search for a bill |
| Un Post / Post | Unpost or post the bill to accounts |
| Exit | Close the screen |

---

### Status
- Bill can be in **Posted** or **Unposted** state
- View toggles between **Master** (header info) and **Detail** (line items)

---

## 2. Sale Return

**Purpose:** Record when a customer returns goods back to the store.

**Most fields are same as Sale Bill.** Key differences:

| Field | Difference |
|---|---|
| **No.** | Auto-generated PK in DB (same logic, separate table) |
| **Date** | Same as Sale Bill |
| **TO** | Instead of FROM — this is where the returned goods are going back to (e.g. MAIN STORE LHR) |
| **Rest of fields** | Same as Sale Bill |

---

## 6. Search & Bilty Adda Updation

**Purpose:** Search invoices and update Bilty No. and Adda info on them.

### Search Filters

| Field | Description |
|---|---|
| **By Date** | Filter invoices by date |
| **By Customer Name** | Filter by customer name (text) |
| **By Sub Customer Name** | Filter by sub-customer name (text) |
| **By Bill No.** | Filter by bill number + Edit button to edit that bill |
| **Enter Bill No.** | Enter a specific bill number to update |
| **Enter Bilty No.** | Enter bilty number to assign to the invoice |
| **Select Adda** | Select adda to assign to the invoice |
| **Update** | Save the Bilty No. and Adda against the invoice |
| **Print** | Print the current result |

### Radio Button Filters (view/sort options)

| Option | What it does |
|---|---|
| **All Invoices** | Show all invoices |
| **Invoices without Bilty No.** | Show only invoices that have no bilty assigned yet |
| **Invoices without Adda** | Show only invoices with no adda assigned |
| **Invoices with Bilty No.** | Show only invoices that already have a bilty |
| **Sort by Inv. No.** | Sort results by invoice number |
| **Sort by Bill No.** | Sort results by bill number |

### Results Table Columns

| Column | Description |
|---|---|
| **Inv. Date** | Invoice date |
| **Inv. No** | System invoice number (auto PK) |
| **Manual No.** | Manual bill number (paper register) |
| **Customer Name** | Customer name |
| **Sub Customer Name** | Sub-customer name (SAME if direct delivery) |
| **Bilty No.** | Bilty number assigned to this invoice |
| **Adda** | Adda name for this invoice |
| **AC** | Adda code (int that maps to adda name in DB) |

---

## 7. Group Accounts

**Purpose:** Top-level grouping of accounts. Each group belongs to a class.

| Field | Description |
|---|---|
| **Code** | Auto-generated PK |
| **Name** | Group name (string) e.g. EXPENSES, SALES |
| **Select Class** | The class this group belongs to — fixed options: ASSETS, LIABILITY, INCOME, EXPENSES |

### Sort Options
- Sort by Code
- Sort by Name

---

## 8. Sub Customer

**Purpose:** Add sub-customers and link them to a main customer.

| Field | Description |
|---|---|
| **Code** | Auto-generated PK |
| **Name** | Sub-customer name (string) |
| **Main Customer** | Linked to the main customer (foreign key from customers table) |

---

## 9. City Creation

**Purpose:** Manage the list of cities the business operates in.

| Field | Description |
|---|---|
| **Code** | Auto-generated PK |
| **Name** | City/District name (string) |

---

## 10. Chart of Accounts

**Purpose:** Manage individual accounts under a control account.

| Field | Description |
|---|---|
| **Control Account** | Parent account selected from control accounts table (e.g. 8410 - EXPENSES) |
| **A/C Code** | Auto-generated PK of the individual account |
| **A/C Name** | Account name (string) |
| **Link Code** | As-is (A) |
| **A/C Status** | Active or Closed |
| **Other Info.** | Extra info button for the account |

### Accounts List Table
Shows all accounts under the selected control account with: A/C Code, A/C Name, Status, Link.

---

## 11. Cash Book Summary

**Purpose:** View cash summary for a specific date.

| Field | Description |
|---|---|
| **Date** | User picks a date from calendar — shows cash book for that day only |

---

## 12. Business Accounts

**Purpose:** Sub-accounts under Chart of Accounts. One more level down.

Same fields as Chart of Accounts with one extra field:

| Field | Description |
|---|---|
| **Regions** | LOCAL or other — defines the region of this account |

---

## 13. Business Accounts Ledger (Khaata)

**Purpose:** Read-only view of all business accounts with date range filter.

| Field | Description |
|---|---|
| **All Accounts** | Checkbox to show all accounts |
| **Search** | Filter by account name |
| **Starting Date** | Date range start |
| **Ending Date** | Date range end |
| **View Mode** | Summary / Detail / Customer |
| **View** | Load the results |

### Results Table Columns
Code, Description, Main Account, City

---

## 14. Control Accounts

> **To be discussed and documented later.**

---

## 15. Receipts (Jamma)

> **To be discussed and documented later.**

---

### Notes / Issues with Current UI
- Old Windows desktop app (circa 2012), dialog-based UI
- No clear navigation structure — everything opens as a floating popup
- Inconsistent color coding across forms
- No input validation feedback
- Toolbar icon buttons are small and unclear
- Many fields are unlabeled or poorly labeled
- Too many fields crammed in one form with no clear grouping
- Color coding (yellow, green fields) is inconsistent and confusing
- Toolbar uses small icon buttons with no clear hierarchy
- No validation feedback visible to user
- Discount logic is split across two places with no clear labeling

