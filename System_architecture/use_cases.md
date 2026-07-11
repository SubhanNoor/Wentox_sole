# Wentox Warehouse ERP — Use Cases

---

## TRANSACTIONS

---

### UC-01: Create a Sale Bill

**Actor:** Sales staff  
**Goal:** Record a new sale to a customer  
**Screen:** Sale Bill → Billing Tab

**Preconditions:**
- At least one Store, Customer, and Product must exist in the system

**Steps:**
1. Open Sale Bill screen — system lands on Billing tab
2. System auto-generates a unique System Invoice ID
3. User selects date and source store (From)
4. User enters a manual bill number
5. User selects customer from searchable dropdown — main account auto-fills
6. User sets delivery type:
   - **SAME (Direct):** delivery goes to customer address
   - **Custom:** user selects a sub-customer as the delivery agent
7. User optionally enters custom delivery address
8. User adds product rows one by one:
   - Selects article/product from searchable dropdown
   - System auto-fetches packing value
   - User enters cartons — system auto-calculates pairs (cartons × packing)
   - User enters rate — system auto-calculates gross value (pairs × rate)
   - User optionally enters discount (% or flat value) — system computes net row value
9. User optionally enters invoice-level discount in the Calculations box
10. User fills optional fields: GP No., Bilty No., Transport Adda
11. User enters remarks/notes
12. User clicks **Confirm** (Navy & Gold button activates only when mandatory fields are filled)
13. System saves the bill and posts it

**Draft Support:**
- System auto-saves incomplete bills to local storage as drafts
- User can resume, load, or delete drafts from the Drafts panel

**Print Support:**
- User can click **Print Invoice** to get an A4 Excel-style printout with company header, metadata grid, items table, totals, and signature lines

---

### UC-02: Find & Update an Existing Sale Bill

**Actor:** Sales staff  
**Goal:** Search, view, edit, or print a previously saved sale bill  
**Screen:** Sale Bill → Weekly / Monthly / Overall / Find & Update tabs

**Steps:**
1. Open Sale Bill screen
2. Navigate to one of the record tabs:
   - **Weekly Records** — shows bills from the current week
   - **Monthly Records** — shows bills from the current month
   - **Overall Records** — shows all bills
   - **Find & Update Bill** — advanced search with filters (date range, customer, bilty status, article, etc.)
3. Each tab shows a table of matching bills with Edit (pencil) and Print (printer) action icons
4. Click **Edit** to load the bill back into the Billing tab for modification
5. Click **Print** to directly print the bill in A4 Excel-style format

---

### UC-03: Process a Sale Return

**Actor:** Sales staff  
**Goal:** Record goods returned by a customer  
**Screen:** Sale Return → Return Entry Tab

**Preconditions:**
- At least one Store, Customer, and Product must exist

**Steps:**
1. Open Sale Return screen — system lands on Return tab
2. System auto-generates a unique Return ID
3. User selects date and destination store (TO — where stock is returned)
4. User enters manual invoice number
5. User selects customer — main account auto-fills
6. User sets delivery agent (sub-customer) if not direct return
7. User adds returned product rows:
   - Selects article/product
   - Enters cartons, rate, and optional discount
   - System auto-calculates pairs and credit value
8. User optionally enters invoice-level discount
9. User enters return reason / remarks
10. User clicks **Confirm** (Navy & Gold button — activates on validation)
11. System saves and posts the return

**Draft / Print Support:** Same as Sale Bill (local drafts, A4 Excel-style printing)

---

### UC-04: Find & Update an Existing Sale Return

**Actor:** Sales staff  
**Goal:** Search, view, edit, or print a previously saved sale return  
**Screen:** Sale Return → Weekly / Monthly / Overall / Find & Update tabs

**Steps:**
1. Navigate to one of the record tabs (same structure as Sale Bill records)
2. Each tab shows a table of matching returns with Edit and Print action icons
3. Click **Edit** to load the return for modification
4. Click **Print** to print in A4 Excel-style format

---

### UC-05: Record a Receipt (Jamma)

**Actor:** Accountant / Sales staff  
**Goal:** Record a payment received from a customer  
**Screen:** Receipts (Jamma) → Entry Tab

**Steps:**
1. Open Receipts (Jamma) screen — system lands on Entry tab
2. User selects date
3. User selects customer from searchable dropdown — account group auto-fills
4. User enters amount received
5. User selects payment mode: **Cash**, **Cheque**, or **Online**
6. User enters payment details (cheque no., bank name, etc.)
7. User enters remarks
8. User clicks **Confirm** to save the receipt
9. System records the receipt

**Record Tabs:** Weekly / Monthly / Overall tabs show saved receipts with action icons

---

### UC-06: Record an Expense (Kharch)

**Actor:** Accountant  
**Goal:** Record a business expense  
**Screen:** Expenses (Kharch) → Entry Tab

**Steps:**
1. Open Expenses (Kharch) screen — system lands on Entry tab
2. User selects date
3. User selects business account (expense head) from searchable dropdown — parent account auto-fills
4. User enters amount
5. User selects payment mode: **Cash**, **Cheque**, or **Online**
6. User enters payment details
7. User enters remarks
8. User clicks **Confirm** to save the expense

**Record Tabs:** Weekly / Monthly / Overall tabs show saved expenses

---

### UC-07: Search and Update Bilty / Adda on an Invoice

**Actor:** Sales staff / Dispatch staff  
**Goal:** Assign or update bilty number and transport adda on existing invoices  
**Screen:** Find & Update Bill tab (within Sale Bill page)

**Steps:**
1. Open Sale Bill → Find & Update Bill tab
2. Filter invoices using:
   - Date range (start / end)
   - Customer name (text search)
   - Sub-customer name (text search)
   - Bill number
3. Use radio buttons to narrow down:
   - **All Invoices** — no filter
   - **Without Bilty** — invoices missing bilty number
   - **Without Adda** — invoices missing transport adda
   - **With Bilty** — invoices that already have bilty
4. Sort results by Invoice No. or Manual Bill No.
5. Click **Select** on a row to load it into the Bilty Info Update panel
6. Enter bilty number and select transport adda
7. Click **Update Bilty & Adda**

---

## REPORTS

---

### UC-08: Manage Stock & Production Logs

**Actor:** Warehouse staff / Sales staff / Production manager  
**Goal:** Track inventory and log daily/weekly/monthly/overall production  
**Screen:** Stock & Production Center

**Steps to view stock & production:**
1. Open Stock & Production Center screen.
2. The page lands on the **Current Stock** tab, showing real-time inventory counts (cartons, extra pairs, total pairs).
3. Switch between tabs to view historical production records:
   - **Daily Production**: Production logs for a single chosen date (defaults to today).
   - **Weekly Production**: Production logs for the selected week (Monday to Sunday).
   - **Monthly Production**: Production logs for the selected month and year.
   - **Overall Production**: Production logs for all time (with custom start/end date range filters).
4. Apply search filters (by Article Name/Code or Category) which remain active across all tabs.
5. Click **Print Report** to generate a clean A4 Excel-style layout of the current tab's records.

**Steps to add stock / log production:**
1. From the **Current Stock** tab, locate the product and click the square plus (`+`) button at the end of the row.
2. In the modal, input the quantity to add and select the unit type (**Carton(s)** or **Pair(s)**).
3. Choose the **Production Date** (defaults to the current date).
4. Review the **Updated Stock Preview** showing how the warehouse levels will change.
5. Click **Confirm Add & Log** to update the product stock level and save the production log.

---

### UC-09: View Business Accounts Ledger (Khaata)

**Actor:** Accountant / Management  
**Goal:** View ledger of all business accounts for a date range  
**Screen:** Accounts Ledger

**Steps:**
1. Open Accounts Ledger screen
2. Set starting and ending date
3. Choose view mode — **Summary**, **Detail**, or **Customer**
4. Click **View** — system generates the report
5. User can print the ledger in A4 format

---

### UC-10: View Cash Book Summary

**Actor:** Accountant / Management  
**Goal:** View cash transactions for a specific date  
**Screen:** Cash Book

**Steps:**
1. Open Cash Book Summary screen
2. Pick a date from the calendar
3. System shows cash summary for that day (receipts, expenses, opening/closing balance)
4. User can print the cash book in A4 format

---

## SYSTEM SETUP

---

### UC-11: Add / Edit a Product

**Actor:** Admin / Setup staff  
**Goal:** Register a new product/article or edit an existing one  
**Screen:** Product Details

**Steps:**
1. Open Product Details screen
2. Browse existing products in the list tab
3. Click **Add New** or select an existing product to edit
4. Select category from dropdown
5. System auto-generates product code (for new products)
6. Enter product name, vendor, batch no., packing
7. Enter cost breakdown fields (labour, sole stitch, pasting, etc.)
8. Click **Save**

---

### UC-12: Add / Edit a Product Category

**Actor:** Admin  
**Goal:** Add a new category or edit an existing one  
**Screen:** Categories

**Steps:**
1. Open Categories screen
2. Browse existing categories in the list tab
3. Click **Add New** or select an existing category to edit
4. System auto-generates category code (for new entries)
5. Enter category name
6. Click **Save**

---

### UC-13: Add / Edit a Sub-Customer

**Actor:** Admin / Sales staff  
**Goal:** Register a sub-customer and link to a main customer  
**Screen:** Sub Customers

**Steps:**
1. Open Sub Customers screen
2. Browse existing sub-customers in the list tab
3. Click **Add New** or select an existing sub-customer to edit
4. System auto-generates code (for new entries)
5. Enter sub-customer name
6. Link to a main customer
7. Click **Save**

**Note:** Sub-customers can also be added inline from the Sale Bill form using the "+ Add Sub-Customer" modal

---

### UC-14: Add / Edit a City

**Actor:** Admin  
**Goal:** Add a new city/district to the system  
**Screen:** City Creation

**Steps:**
1. Open City Creation screen
2. Browse existing cities in the list tab
3. Click **Add New** or select an existing city to edit
4. System auto-generates city code (for new entries)
5. Enter city/district name
6. Click **Save**

---

### UC-21: Manage Transport Addas

**Actor:** Admin  
**Goal:** Add, edit, or delete transport addas (dispatch terminals) in the system  
**Screen:** Transport Addas Setup

**Steps:**
1. Open Transport Addas screen from the sidebar.
2. Browse existing addas in the list tab, utilizing the text search filter.
3. Click **Add New** or select an existing Adda to edit.
4. Fill in the Adda name and optional details.
5. Click **Save** to persist the record.
6. To delete an Adda, click **Delete** (the system automatically checks if the Adda is assigned to any existing sale bills; if it is active, deletion is blocked to maintain referential integrity).

---

## ACCOUNTING SETUP

---

### UC-15: Manage Group Accounts

**Actor:** Accountant  
**Goal:** Add or edit a group account and assign it a class  
**Screen:** Group Accounts

**Steps:**
1. Open Group Accounts screen
2. Browse existing group accounts in the list tab, with search functionality
3. Click **Add New** or select an existing group to edit
4. System auto-generates group code (for new entries)
5. Enter group name
6. Select class: **ASSETS** / **LIABILITY** / **INCOME** / **EXPENSES**
7. Click **Save**

---

### UC-16: Manage Control Accounts

**Actor:** Accountant  
**Goal:** Add or edit a control account and link to a group account  
**Screen:** Control Accounts

**Steps:**
1. Open Control Accounts screen
2. Browse existing control accounts in the list tab, with search functionality
3. Click **Add New** or select an existing control account to edit
4. System auto-generates control account code (for new entries)
5. Enter control account name
6. Select parent group account from dropdown
7. Set sorting order
8. Click **Save**

---

### UC-17: Manage Chart of Accounts

**Actor:** Accountant  
**Goal:** Add individual accounts under a control account  
**Screen:** Chart of Accounts

**Steps:**
1. Open Chart of Accounts screen
2. Browse existing accounts in the list tab, with search functionality
3. Click **Add New** or select an existing account to edit
4. Select control account from dropdown
5. System auto-generates A/C code (for new entries)
6. Enter account name
7. Set link code and status (**Active** / **Closed**)
8. Click **Save**

---

### UC-18: Manage Business Accounts

**Actor:** Accountant  
**Goal:** Add sub-accounts under chart of accounts with region info  
**Screen:** Business Accounts

**Steps:**
1. Open Business Accounts screen
2. Browse existing business accounts in the list tab, with search functionality
3. Click **Add New** or select an existing account to edit
4. Select control account from dropdown
5. System auto-generates A/C code (for new entries)
6. Enter account name, link code, region, status
7. Click **Save**

---

## SYSTEM ADMINISTRATION

---

### UC-19: Update Admin Credentials

**Actor:** Administrator  
**Goal:** Change the system login username and password  
**Screen:** System Settings

**Steps:**
1. Open System Settings from the admin popup (sidebar footer)
2. Enter new username
3. Enter new password
4. Confirm new password
5. Click **Save Admin Settings**

---

### UC-20: Login / Logout

**Actor:** All users  
**Goal:** Authenticate into or log out of the system  
**Screen:** Login Page / Admin Popup

**Login Steps:**
1. Navigate to the application URL
2. System displays the Wentox Warehouse login page
3. Enter username and password (demo credentials are pre-filled)
4. Click **Log In**
5. System validates credentials and navigates to the Sale Bill screen

**Logout Steps:**
1. Click the admin profile button in the sidebar footer
2. Click **Log out** from the popup menu
3. System returns to the login page

---

## Cross-Cutting Features

| Feature | Description |
|---|---|
| **Draft Persistence** | Sale Bill and Sale Return forms auto-save incomplete entries to `localStorage` as drafts. Users can resume, load, or delete drafts. |
| **Mandatory Field Validation** | Required fields are marked with red asterisks (`*`). The Confirm button remains grey/disabled until all mandatory fields are filled, then transitions to premium Navy & Gold styling. |
| **A4 Print Layout** | All print outputs use a standardized Excel-style layout: A4 page size, black-bordered table cells, grid-based metadata header, totals with double-underline, and 3 signature lines (Prepared By / Checked By / Authorized Signature). |
| **Searchable Dropdowns** | Long-form dropdowns (Customer, Product, Business Account) include built-in search filtering for scalability. |
| **Record Tabs** | Transaction screens (Sale Bill, Sale Return, Receipts, Expenses) have Weekly / Monthly / Overall record tabs showing filtered historical data with Edit and Print action icons. |
| **Premium Navy & Gold Theme** | The entire UI follows a boutique "Wentox Warehouse" aesthetic with dark navy (`#111c2a`) and gold (`#B08D57`) as primary brand colours. |

---

> **Total Use Cases:** 21  
> **Document Version:** 2.1  
> **Last Updated:** July 2026  
> **System:** Wentox Warehouse ERP — Footwear Wholesale Distribution
