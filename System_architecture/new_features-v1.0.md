# WentoX — New Features Task List (Client Meeting)

> These are new requirements and changes discussed with the client.
> Each task maps to a frontend feature to build.

---

## TASK-01: Purchase Page (New Page)

**Overview:** Record purchases made from a vendor.

### Fields
- Vendor name (dropdown from vendors table)
- Product name (TBD — either adds to stock or tracked separately)
- Unit — self assigned e.g. meter, buckle (dropdown or free text)
- Weight
- Price per unit
- Total price (auto calculated)
- Multiple products on the same slip (line items table — same as sale bill)

### Notes
- Similar structure to Sale Bill but for purchases
- Adds stock when saved (TBD with client)

---

## TASK-02: Product Ledger (Inside Stock Page)

**Overview:** Show debit/credit ledger of a product in terms of pairs.

- **Debit (IN)** = pairs added to stock
- **Credit (OUT)** = pairs sold/used
- Show: overall, per month, per day
- Filter: by article
- Location: inside the Current Stock page

---

## TASK-03: Current Stock Page — Major Redesign

**Overview:** Full redesign of the current stock page.

### Main Page (table)
Each row contains:
- Article code (pcode)
- Category name
- Total pairs
- Add button (+)

### On Row Click → Sub Page (expandable inside row)
Each sub-row contains:
- Content color
- Pairs per carton
- Total cartons
- Extra pairs
- Total pairs

Product ledger also appears here (from TASK-02)

### On Add Button Click → Dialog Box
- Same as current dialog
- Add **color** field (dropdown + search)
- When saved → updates total pairs on the main row

---

## TASK-04: Export as PDF and Excel

**Overview:** Wherever there is a Print option, add two more buttons:
- Export as PDF
- Export as Excel

**Applies to:** All pages that currently have a Print button.

---

## TASK-05: Sale Bill — Auto Select Main Account for Customer

**Overview:** When a customer is selected in the sale bill:
- Auto-fill the Main A/C if it exists in DB
- If customer does not have a main account in DB → show warning: **"Please add customer account first"**

---

## TASK-06: Sub Customer — Remove Parent Relation

**Overview:** Sub customers are now independent — no link to a parent customer.

- Sub customer dropdown shows **all sub customers**
- Add **search** option in the dropdown
- Remove the Main Customer foreign key

---

## TASK-07: Add Region Field to Customer + Search Priority Change

**Overview:** When adding a new customer, add a **Region** field.

- Region dropdown (from regions/cities table)

---

## TASK-08: New Customer Page (Full Redesign)

**Overview:** A dedicated page to manage all customers.

### Customer List
- Show all customers as **cards** (follow design guidelines)
- Add new customer button on this page

### Customer Detail / Ledger
- Customer product ledger (between two dates / overall / by month / by article)
- Ledger columns: Date, Article, Debit, Credit, Sale Return (new column — shows returned quantity for that article)
- Print button
- Export as Excel button

---

## TASK-09: Sale Analysis (New Page)

**Overview:** Sales reporting page combining expenses, receipts, sale bills, and sale returns.

### Views
- Overall
- By month
- Between two dates

### Customer Wise
- Total sales
- Sale returns
- Payment received (Debit / Credit breakdown)

### Region Wise
- Same as customer wise but grouped by region first
- Inside each region → customer wise breakdown

---

## TASK-10: Vendor Page (New Page)

**Overview:** Ledger of vendor transactions.

### Columns
- Opening balance
- Debit
- Credit
- (standard ledger format)

### Actions
- View as table (Excel style)
- Print button
- Export as Excel button

---

## TASK-11: Remove Control Accounts

**Overview:** Remove "Control Accounts" from the system entirely.

- Rename: **Chart of Accounts** stays as is
- Control Accounts page → **removed**
- Any reference to control accounts in the UI → removed

---

## TASK-12: Sale Return — Manual Entry with DB Cross-Check

**Overview:** In the sale return page, all fields are entered manually BUT:

- A dropdown below shows all products **previously purchased by the selected customer** (fetched from sale bills in DB)
- User can select from this dropdown to auto-fill product details
- Bill slip format does NOT change
- Sale return must reflect in:
  - Ledger
  - Sale Analysis page

---

## TASK-13: Default Home/Landing Page

**Overview:** When app opens, show a landing page with:

- WentoX logo
- Company name
- Empty / clean look
- When user clicks **Home icon** in navbar → goes back to this page

---

## TASK-14: User Roles & Access Control

**Overview:** Two types of users:

| Role | Access |
|---|---|
| **Admin** | Full access to everything |
| **User** | Everything EXCEPT bank accounts and director expense accounts |

### Restricted for User role:
- Bank accounts section
- Director Expenses - Drawings accounts

---

## Summary Table

| Task | Type | Priority |
|---|---|---|
| TASK-01 | New Page | High |
| TASK-02 | New Feature | High |
| TASK-03 | Redesign | High |
| TASK-04 | Enhancement | Medium |
| TASK-05 | Enhancement | High |
| TASK-06 | Change | Medium |
| TASK-07 | Enhancement | Low |
| TASK-08 | New Page | High |
| TASK-09 | New Page | High |
| TASK-10 | New Page | Medium |
| TASK-11 | Removal | Low |
| TASK-12 | Change | High |
| TASK-13 | New Page | Low |
| TASK-14 | New Feature | High |
| TASK-15 | New Page | High |
| TASK-16 | New Page | High |
| TASK-17 | New Page | Medium |
| TASK-18 | New Report | High |
| TASK-01 UPDATE | Enhancement | High |
| TASK-02 UPDATE | Enhancement | High |
| TASK-10 UPDATE | Enhancement | Medium |
| TASK-19 | New Feature | High |

---

## TASK-15: Cash Book of the Day (New Page)

**Overview:** Shows total cash in/out for a selected date or month.

### Filters
- Select by **date** or **month**

### Table Columns
| Column | Description |
|---|---|
| **No.** | Row number |
| **Account Name** | Account involved in the transaction |
| **Remarks** | Description/notes |
| **Type** | CASH / CHEQUE / ONLINE |
| **Cheque No.** | Cheque number (if type is CHEQUE) |
| **Receipts Cheq./Online** | Amount received via cheque or online |
| **Payments Cheq./Online** | Amount paid via cheque or online |
| **Receipts Cash** | Amount received in cash |
| **Payments Cash** | Amount paid in cash |

### Totals Row
- Sum of all 4 columns at the bottom

### Summary Box (bottom left)
| Label | Description |
|---|---|
| **Opening Cash** | Cash at start of the day |
| **Cash Received (Jamma)** | Total cash received that day |
| **Total Cash** | Opening Cash + Cash Received |
| **Cash Paid (Naam)** | Total cash paid out that day |
| **Cash In Hand** | Total Cash - Cash Paid |

### Actions
- Print
- Export as PDF
- Export as Excel

---

## TASK-16: Account Ledger Page

**Overview:** Detailed ledger for a specific customer account showing all transactions with running balance.

### Header Info
| Field | Description |
|---|---|
| **Code** | Customer account code (e.g. 552000010032) |
| **Title** | Customer name (e.g. FINE SHOES - SADIQ ABAD) |
| **Print Date & Time** | Auto-generated when printing |
| **Date Range** | From / To date filter |
| **Opening Balance** | Balance before the selected date range |

### Table Columns
| Column | Description |
|---|---|
| **Date** | Transaction date |
| **Inv #** | Invoice number |
| **Bill #** | Manual bill number |
| **Narration** | For CASH/ONLINE: free text description. For CHEQUE: splits into 3 sub-columns (see below) |
| **Pairs** | Number of pairs in the transaction (for sale entries) |
| **Debit** | Amount coming IN (sale, debit note) |
| **Credit** | Amount going OUT (payment, return, cheque) |
| **Balance** | Running balance after each transaction |

**Narration sub-columns when type = CHEQUE:**

| Sub-column | Description |
|---|---|
| **Cheque No** | The cheque number |
| **Date on Cheque** | The date written on the cheque by the customer |
| **Cheque Received Date** | The date WentoX physically received the cheque |

### Balance Logic
```
Balance = Previous Balance + Debit - Credit
```

### Row Color Coding
- **Red rows** = rows where customer has made a payment (credit side)
- **Narration source** = comes from Receipts (Jamma) page remarks field (e.g. "CHEQUE 28423916 13-10-2025", "CASH", "PURNA DIFFERENCE")
- For sale rows narration = "SAME" (pulled from delivery field in sale bill)
- All other rows → default color

### Footer / Summary
- Total Debit
- Total Credit
- Closing Balance

### Actions
- Print
- Export as PDF
- Export as Excel

### Notes
- Opening Balance shown at top right before first transaction
- Each cheque entry shows cheque number + date in narration
- Pairs column is only filled for sale/return rows — blank for payment rows

---

## TASK-17: Payment Trail (New Page)

**Overview:** Report showing total payments made between two dates, grouped by account category.

### Filters
- **From Date** → **To Date**

### Table Columns
| Column | Description |
|---|---|
| **Account Title** | Account category name |
| **Amount** | Value depends on account type (see below) |

### Amount Column Meaning per Account Type

| Account | What the amount means |
|---|---|
| **Business Running Expenses** | Total amount spent on running the business |
| **Cash at Banks** | Total cash held in bank accounts during the date range |
| **Directors Expenses - Drawings** | Total amount spent by directors |
| **Employees** | Total amount spent on employees (salaries etc.) |
| **Vendors - Suppliers** | Total amount spent on vendors/suppliers |

### Footer
- **Grand Total** = sum of all amounts paid across all accounts

### Actions
- Print
- Export as PDF
- Export as Excel

---

## TASK-01 UPDATE: Purchase Adds to Stock
When a purchase is saved → stock is automatically updated for that product.

---

## TASK-02 UPDATE: Product Ledger — Additional Filters
- Filter by **date range** (from / to)
- Filter by **company/vendor**
- Filter by **article** or **category**
- Show full details of the article when selected

---

## TASK-18: Sale Report (New Report/View)

**Overview:** Summary report of sales between two dates.

### Filters
- From Date → To Date

### Columns
| Column | Description |
|---|---|
| **Total Sales Amount** | Gross total of all sale bills |
| **Total Cartons** | Total cartons sold |
| **Commission** | Discount given by user on sales (D% / DV fields from sale bill — per article + invoice level discount combined) |
| **Sale Return** | Total value of returns (0 if none) |
| **Net Sales** | Total Sales - Commission - Sale Return |
| **Payment** | Amount paid by customer (from Receipts/Jamma) |

### Views
- Overall
- By month
- Between two dates
- Customer wise
- Region wise

---

## TASK-10 UPDATE: Vendor Page — Grouped Report

**Overview:** Add a grouped summary report by vendor/supplier.

### Columns
| Column | Description |
|---|---|
| **Vendor/Supplier** | Vendor name |
| **Total Purchase** | Total amount purchased from this vendor |
| **Purchase Return** | Total value returned to this vendor |
| **Net Purchase** | Total Purchase - Purchase Return |
| **Payment Paid** | Amount we paid to this vendor |

### Filters
- Between two dates
- By vendor

### Actions
- Print
- Export as PDF
- Export as Excel

---

> **Note on Commission:** Commission = discount given by the user on sale bills. It comes from two places in the sale bill — D% (per article discount) and Invoice Discount (total bill discount). Combined = total commission for that bill.

---

## COMMISSION — Clarification (Important)

**Commission is NOT the same as discount.**

| | Discount | Commission |
|---|---|---|
| **When** | At time of sale | At time of payment |
| **Where recorded** | Sale Bill (D% / DV / Invoice Discount) | Receipts (Jamma) page |
| **Effect on sale amount** | Reduces it | Sale amount stays the same |
| **Effect on payable amount** | Already reduced in bill | Reduces what customer needs to pay |
| **Example** | Bill = 1,000,000 after discount | Bill = 1,020,000, customer pays 1,000,000, commission = 20,000 |

### How it works
1. Customer has a due amount e.g. **1,020,000**
2. Customer requests a reduction of **20,000** as a goodwill gift
3. Original sale bill remains **1,020,000** — unchanged
4. Commission of **20,000** is recorded at payment time
5. Customer actually pays **1,000,000**
6. In ledger: Sale = 1,020,000 | Commission = 20,000 | Payment = 1,000,000 | Balance = 0

### Where to add Commission field
- **Receipts (Jamma) page** — add a Commission field
- **Account Ledger** — show commission as a separate row/column
- **Sale Report (TASK-18)** — commission column = total commission given during payments NOT sale discounts

---

## TASK-19: Reports Sidebar Section

**Overview:** A dedicated **Reports** section in the sidebar. Inside it, a **top bar acts as tabs** to switch between report types. Each report has its own filters below.

---

### Top Bar Tabs (switch between report types)

```
[ Sale Analysis ] [ Sale Report ] [ Vendor Report ] [ Payment Trail ] [ Account Ledger ] [ Business Ledger ] [ Cash Book ] [ Product Ledger ]
```

---

### Each Report + Its Filters

---

#### 1. Sale Analysis
- **Group by:** Customer Wise / Region Wise
- **Time:** Overall / By Month / Between Two Dates
- **Shows:** Total Sales, Sale Returns, Payment Received (Debit/Credit)

---

#### 2. Sale Report
- **Time:** Overall / By Month / Between Two Dates
- **Group by:** Customer Wise / Region Wise
- **Shows:** Total Sales Amount, Total Cartons, Commission, Sale Return, Net Sales, Payment

---

#### 3. Vendor Report
- **Filter by:** Vendor (dropdown)
- **Time:** Between Two Dates
- **Shows:** Total Purchase, Purchase Return, Net Purchase, Payment Paid

---

#### 4. Payment Trail
- **Time:** Between Two Dates
- **Shows:** Account Title, Amount (per account type), Grand Total

---

#### 5. Account Ledger (Khaata)
- **Filter by:** Account (search/dropdown)
- **Time:** Between Two Dates / Overall
- **Shows:** Full transaction history — Inv#, Bill#, Narration, Pairs, Debit, Credit, Balance
- **Color:** Red rows = payments

---

#### 6. Business Accounts Ledger
- **Filter by:** All Accounts / Specific Account
- **Time:** Between Two Dates
- **View Mode:** Summary / Detail / Customer
- **Shows:** Code, Description, Main Account, City

---

#### 7. Cash Book of the Day
- **Time:** Specific Date / Month
- **Shows:** Account Name, Remarks, Type, Cheque No, Receipts, Payments
- **Summary box:** Opening Cash, Jamma, Total, Naam, Cash In Hand

---

#### 8. Product Ledger
- **Filter by:** Category / Company (Vendor) / Article
- **Time:** Between Two Dates / Overall / By Month / By Day
- **Shows:** Full pairs IN/OUT history per article

---

### Notes
- Active tab is highlighted in top bar
- Switching tab → loads that report with its default filter
- All reports have: Print + Export PDF + Export Excel
