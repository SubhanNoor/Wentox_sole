# Wento ERP — Use Cases

---

## UC-01: Create a Sale Bill

**Actor:** Sales staff  
**Goal:** Record a new sale to a customer

**Steps:**
1. Open Sale Bill screen
2. System auto-generates bill No.
3. User selects date and source store
4. User selects customer — main account auto-fills
5. User sets delivery (SAME or sub-customer)
6. User adds products one by one — packing and stock in hand auto-fetch
7. User enters cartons, rate, and discount per product
8. User enters invoice-level discount if any
9. User fills bill no., GP no., bilty no., adda code
10. User saves and posts the bill

---

## UC-02: Process a Sale Return

**Actor:** Sales staff  
**Goal:** Record goods returned by a customer

**Steps:**
1. Open Sale Return screen
2. System auto-generates return No.
3. User selects date and destination store (TO)
4. User selects customer
5. User sets delivery agent if not direct
6. User adds returned products with quantities and rate
7. User saves and posts the return

---

## UC-03: Search and Update Bilty / Adda on an Invoice

**Actor:** Sales staff / Dispatch staff  
**Goal:** Assign or update bilty number and adda on existing invoices

**Steps:**
1. Open Search & Bilty Adda Updation screen
2. Filter invoices by date, customer name, sub-customer, or bill no.
3. Use radio buttons to narrow down (e.g. invoices without bilty)
4. Select invoice from list
5. Enter bilty no. and select adda
6. Click Update

---

## UC-04: Add a New Product

**Actor:** Admin / Setup staff  
**Goal:** Register a new product/article in the system

**Steps:**
1. Open Product Detail Info screen
2. Select category from dropdown
3. System auto-generates product code
4. Enter product name, vendor, batch no., packing
5. Enter all cost breakdown fields (labour, sole stitch, pasting, etc.)
6. Save

---

## UC-05: Check Product Current Stock

**Actor:** Warehouse staff / Sales staff  
**Goal:** Check how many units of a product are in stock

**Steps:**
1. Open Product Current Stock screen
2. Select product by name or code
3. Click View — system shows current stock from main store

---

## UC-06: Add a Product Category

**Actor:** Admin  
**Goal:** Add a new category for products

**Steps:**
1. Open Product Category screen
2. System auto-generates code
3. Enter category name
4. Save

---

## UC-07: Manage Group Accounts

**Actor:** Accountant  
**Goal:** Add or edit a group account and assign it a class

**Steps:**
1. Open Group Accounts screen
2. System auto-generates code
3. Enter group name
4. Select class (ASSETS / LIABILITY / INCOME / EXPENSES)
5. Save

---

## UC-08: Manage Chart of Accounts

**Actor:** Accountant  
**Goal:** Add individual accounts under a control account

**Steps:**
1. Open Chart of Accounts screen
2. Select control account from dropdown
3. System auto-generates A/C code
4. Enter account name
5. Set link code and status (Active / Closed)
6. Save

---

## UC-09: Manage Business Accounts

**Actor:** Accountant  
**Goal:** Add sub-accounts under chart of accounts with region info

**Steps:**
1. Open Business Accounts screen
2. Select control account
3. System auto-generates A/C code
4. Enter account name, link code, region, status
5. Save

---

## UC-10: View Business Accounts Ledger (Khaata)

**Actor:** Accountant / Management  
**Goal:** View ledger of all business accounts for a date range

**Steps:**
1. Open Business Accounts Ledger screen
2. Set starting and ending date
3. Choose view mode — Summary, Detail, or Customer
4. Click View

---

## UC-11: Add a Sub-Customer

**Actor:** Admin / Sales staff  
**Goal:** Register a sub-customer and link to a main customer

**Steps:**
1. Open Sub Customer screen
2. System auto-generates code
3. Enter sub-customer name
4. Link to main customer
5. Save

---

## UC-12: Add a City

**Actor:** Admin  
**Goal:** Add a new city to the system

**Steps:**
1. Open City Creation screen
2. System auto-generates code
3. Enter city/district name
4. Save

---

## UC-13: View Cash Book Summary

**Actor:** Accountant / Management  
**Goal:** View cash transactions for a specific date

**Steps:**
1. Open Cash Book Summary screen
2. Pick a date from the calendar
3. System shows cash summary for that day

---

## UC-14: View Product Ledger

**Actor:** Accountant / Warehouse staff  
**Goal:** View ledger of product movement by category or company

**Steps:**
1. Open Product Ledger screen
2. Select filter mode — Category Wise or With Company Wise
3. Enter category/company code or select from dropdown
4. Select store — Main Store or Selected Store
5. Set date range
6. Click View

---

> **Pending Use Cases:** Control Accounts, Receipts (Jamma) — to be added after discussion.
