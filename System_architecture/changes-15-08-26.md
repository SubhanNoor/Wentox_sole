# WentoX — Change Requests & Bug Fixes
> Grouped by module. All tasks are actionable with no assumptions.

---

## 🌐 GLOBAL / APP-WIDE

### G-01: Keyboard-First Navigation
- In every page, the cursor must auto-focus on the first input field when the page/window opens — ready to type immediately
- Pressing `Enter` moves focus to the next input field
- On the last field, pressing `Enter` triggers the primary action button (Create / Save / Confirm etc.)
- Arrow keys should be usable for navigation throughout the app
- Goal: reduce mouse usage, increase keyboard navigation across the entire app

### G-02: Scrollbar Width
- Increase the width of the scrollbar throughout the entire app for better usability

### G-03: Date Format
- Throughout the entire app, every date field must display and accept dates in `DD/MM/YYYY` format — no exceptions

### G-04: Date Persistence in Creation Windows
- When creating a customer / vendor / account / or anything that has a date field:
  - First time user selects a date → that date stays selected for the entire session of that creation window
  - Date should only reset when the creation window is closed
  - This applies to all creation forms across the app

### G-05: Credit Values Display
- Verify once: is credit currently shown in red throughout the app?
- Keep credit values in red color
- Remove the minus sign (`-`) from negative values
- Instead show negative values in parentheses: e.g. `(5,000)` not `-5,000`
- This applies everywhere credit/negative values are displayed

### G-06: Stay in Creation Window After Creating
- Today: clicking Create/Save closes the window and user has to reopen it
- Change: after clicking Create, the record is saved AND the window stays open, cleared, and ready to create another record
- Applies to: customer creation, vendor creation, business account creation, and any other account/record creation window

### G-07: Remove Cross Button from Quick Menu
- Remove the cross (×) button from the quick menu
- User should NOT be able to close/dismiss the quick menu using a cross button

### G-08: Shorten Quick Menu Icon Names
- Rename the quick menu labels as follows:

| Current Name | New Name |
|---|---|
| Receipts (Jamma) | Receipts |
| Payments (Naam) | Payments |
| Business Ledger | Ledger |
| Current Stock | Stock |

### G-09: `Alt+V` Shortcut for Print Preview
- Add keyboard shortcut `Alt+V` for the Print Preview button throughout the app

---

## 🔐 LOGIN PAGE

### L-01: Auto-focus on Username Field
- When login page loads, cursor must be auto-focused on the username field — ready to type

### L-02: Enter Key Navigation on Login
- Pressing `Enter` on username field moves focus to password field
- Pressing `Enter` on password field triggers the login button

---

## 👤 CUSTOMER / VENDOR / ACCOUNT CREATION

### C-01: Vendor ID Bug — Investigate
- Only one vendor exists but system generated ID = 2
- **Investigate:** check if a vendor was previously created and deleted, which caused the auto-increment to skip
- Fix the root cause — do not just reset the ID manually without understanding why it happened

---

## 🧾 SALE BILL

### SB-01: Save and Post Not Working
- Save and Post button was not working on one specific laptop
- Investigate and fix — likely an environment or browser-specific issue

### SB-02: Article Selection by Typing Article Number
- User can type the article number directly to select an article
- When typed, show brief details of that article (name, rate, packing, stock in hand)
- Allow selecting the same article more than once in the same bill

### SB-03: Stock Validation
- Cannot sell more stock than currently available — enforce this validation
- Show clear error if user tries to exceed available stock

### SB-04: Rate is Editable
- The pre-defined rate of an article should be auto-filled when selected
- But user must be able to edit the rate — sale may happen at a price different from the pre-defined rate

### SB-05: Multiple Bills in Single Run
- After completing one sale bill and saving it, the system should automatically be ready for the next bill input — no need to close and reopen the window
- Each bill gets its own bill number

### SB-06: Batch Post for Multiple Bills
- When creating multiple bills in a single run, do not require posting each bill separately
- Post all bills together at the end

---

## 🔄 SALE RETURN

### SR-01: Rate Must Match Original Sale Rate
- When processing a sale return, the rate must be the rate at which the item was originally sold — not the current pre-defined rate
- Original sale rate may be different (higher or lower) from pre-defined price
- Fetch and auto-fill the rate from the original sale bill

---

## 🛒 PURCHASE

### P-01: Rate is Editable
- Same as SB-04 — pre-defined rate auto-fills but user can edit it
- Purchase may happen at a price different from pre-defined rate

### P-02: Multiple Purchases in Single Run
- Same as SB-05 — after completing one purchase, system is ready for next purchase input automatically
- Each purchase gets its own number

### P-03: Batch Post for Multiple Purchases
- Same as SB-06 — post all purchases together at the end, not one by one

### P-04: Narration Format in Purchase Ledger/Report
- Wherever purchase records are shown and narration is displayed, format it as:
  - `[quantity] [unit] [purchased item name] @ [unit price]`
  - Example: `200 kg MEG @ 230`

---

## 🔁 PURCHASE RETURN

### PR-01: Rate Must Match Original Purchase Rate
- Same logic as SR-01 — rate must be the rate at which item was originally purchased
- Fetch and auto-fill from the original purchase record

---

## 💰 RECEIPTS (JAMMA)

### RJ-01: Move Remarks Field
- In the receipt creation form, move the Remarks field to appear **before** the Amount field

### RJ-02: Account Balance Tooltip
- When a user selects an account in the receipt page:
  - Show the balance of that account in a small tooltip right next to the account field
  - When navigating between accounts using arrow keys, the tooltip should update in real-time to show balance of the currently highlighted account
  - Remove the current behavior of showing balance below after pressing Enter

### RJ-03: Single Voucher with Multiple Entries
- Change the receipt flow to a single voucher per session:
  - User creates multiple receipt entries one after another in the same voucher
  - All entries are listed below as rows (not cards) as they are added
  - When done, user posts the entire voucher at once — no separate posting per entry
  - After posting, system is ready for a new voucher with cursor at first field

### RJ-04: Reduce Scrolling
- Today user creates a receipt, then has to scroll up to post it — this is too much scrolling
- Redesign the layout so post action is accessible without scrolling

### RJ-05: Records Shown as Rows
- In weekly/monthly/overall receipt records, change the display from cards to rows — consistent with other pages in the app

### RJ-06: Delete Receipt Entry
- Add a delete button for receipt entries
- Deletion removes the entry from everywhere (ledger, reports, etc.)
- Deletion requires password confirmation before proceeding

---

## 💸 PAYMENTS (NAAM)

### PN-01: Same Changes as Receipts
- Apply all the same changes from RJ-01 to RJ-06 to the Payments page as well:
  - Move remarks before amount
  - Account balance tooltip
  - Single voucher with multiple entries
  - Reduce scrolling
  - Records shown as rows
  - Delete with password confirmation

---

## 📊 WAGES RUN

### WR-01: Fix Calculation Formula
- Current formula: `rate × cartons × 12` — remove the `×12`
- New formula: `rate × cartons` only
- Note: rate here is per carton, not per pair
- Also remove the "12 packaging" detail from the wages run screen

### WR-02: Keyboard Navigation in Wages Run
- Pressing Enter moves to next field
- When final Enter is pressed on last field of an employee, system is ready for next employee input automatically

### WR-03: Narration for Wages
- Narration for all wage run entries should be: `HISAB`

### WR-04: Delete Wage Entry
- Add a delete option for individual wage entries

### WR-05: Search & Filter in Wages History Tab
- In the history tab, add ability to search by:
  - Worker name
  - Stage name
- Add date filter as well

---

## 💼 SALARY RUN

### SAL-01: Narration Format
- Narration for salary entries should be: `Salary for [Month] [Year]`
- Example: `Salary for July 2026`

### SAL-02: Posted Date = Last Date of Current Month
- When a salary is posted, the date recorded must be the last date of the current month
- Salary is always for the current month — not a previous month
- The ledger entry for that person in business ledger must also show the last date of current month

---

## 📒 CASH BOOK

### CB-01: Show Bank Transfers
- Transfers between two bank accounts are currently not showing in the cash book — fix this

### CB-02: Show Online Receipts
- Online receipts are currently not showing in the cash book — fix this

### CB-03: Show Cheque/Online Payment Events
- For cheques: show the flow/event of the cheque in the cash book
  - Events to show: Issued / Disposed / Endorsed / Received
  - Also note whether it is the company's own cheque or received from someone else
- For online payments: show how the payment was acquired or how it happened
- These events are already tracked in the system — just display them in the cash book

---

## 📋 BUSINESS LEDGER

### BL-01: Search Bar in Detailed Account Ledger
- When viewing the detailed ledger of a specific account inside Business Ledger:
  - Add a search bar that lets user switch to another account's detailed ledger directly
  - No need to go back to the account list and click again

---

## 🏦 CHEQUES PAGE

### CH-01: Rename "Dispose" to "Issue"
- Rename the "Dispose" button/action to "Issue" on the cheques page

### CH-02: Fix Cheque Ledger on Laptop
- Cheque ledger detailed view is not showing on one laptop — investigate and fix

---

## 📝 JOURNAL VOUCHER

### JV-01: Edit a Journal Voucher
- Add the ability to edit an existing journal voucher

### JV-02: Search and Filter JVs
- Add search and filter functionality on the journal voucher listing page

### JV-03: Unpost a Journal Voucher
- Add the ability to unpost a posted journal voucher

---

## 🔍 SEARCH & BILTY ADDA PAGE

### BA-01: Search by Both Bill Numbers
- Add the ability to search by both:
  - Manual bill number
  - System-generated bill number

---

## 🚚 ADDAS SETUP

### AD-01: Remove Region/City Fields, Add Routes
- Remove the region and city fields from adda creation
- Add a **Route** concept to addas:
  - When creating an adda, user selects which cities (routes) that adda serves
  - Available cities are shown as a list (from cities already created in Cities setup)
  - User can check/select multiple cities as the route of that adda

### AD-02: Adda Search with Route Display
- Add a search bar to the adda page
- When an adda is searched: show the routes (cities) of that adda
- When a route/city is searched: show all addas that serve that route

---

## 🏪 STORE SETUP

### ST-01: Multi-Store Stock Management
- Currently only one store (Main Store) exists
- When a second store is created in the future, enable stock movement between stores:
  - Transfer requires approval/confirmation step
  - On approval: stock is deducted from Store A and added to Store B
- When adding stock: ask which store to add to — default is Main Store if not selected
- Stock can be produced in any store

---

## 🔑 PASSWORD / SECURITY

### PW-01: Require Current Password on Reset
- When resetting the app password, the system must ask for the current password first
- This is not happening currently — fix it

---

## Summary Table

| ID | Module | Type | Priority |
|---|---|---|---|
| G-01 | App-wide | Enhancement | High |
| G-02 | App-wide | Enhancement | Low |
| G-03 | App-wide | Enhancement | High |
| G-04 | App-wide | Enhancement | Medium |
| G-05 | App-wide | Enhancement | Medium |
| G-06 | App-wide | Enhancement | High |
| G-07 | App-wide | Change | Low |
| G-08 | App-wide | Change | Low |
| G-09 | App-wide | Enhancement | Low |
| L-01 | Login | Enhancement | High |
| L-02 | Login | Enhancement | High |
| C-01 | Vendor | Bug | High |
| SB-01 | Sale Bill | Bug | High |
| SB-02 | Sale Bill | Enhancement | High |
| SB-03 | Sale Bill | Validation | High |
| SB-04 | Sale Bill | Enhancement | Medium |
| SB-05 | Sale Bill | Enhancement | High |
| SB-06 | Sale Bill | Enhancement | High |
| SR-01 | Sale Return | Bug/Logic | High |
| P-01 | Purchase | Enhancement | Medium |
| P-02 | Purchase | Enhancement | High |
| P-03 | Purchase | Enhancement | High |
| P-04 | Purchase | Enhancement | Medium |
| PR-01 | Purchase Return | Bug/Logic | High |
| RJ-01 | Receipts | Change | Low |
| RJ-02 | Receipts | Enhancement | High |
| RJ-03 | Receipts | Redesign | High |
| RJ-04 | Receipts | Enhancement | Medium |
| RJ-05 | Receipts | Change | Medium |
| RJ-06 | Receipts | New Feature | High |
| PN-01 | Payments | Same as Receipts | High |
| WR-01 | Wages Run | Bug/Logic | High |
| WR-02 | Wages Run | Enhancement | High |
| WR-03 | Wages Run | Change | Low |
| WR-04 | Wages Run | New Feature | Medium |
| WR-05 | Wages Run | Enhancement | Medium |
| SAL-01 | Salary Run | Change | Low |
| SAL-02 | Salary Run | Bug/Logic | High |
| CB-01 | Cash Book | Bug | High |
| CB-02 | Cash Book | Bug | High |
| CB-03 | Cash Book | Enhancement | Medium |
| BL-01 | Business Ledger | Enhancement | Medium |
| CH-01 | Cheques | Change | Low |
| CH-02 | Cheques | Bug | High |
| JV-01 | Journal Voucher | New Feature | Medium |
| JV-02 | Journal Voucher | Enhancement | Medium |
| JV-03 | Journal Voucher | New Feature | Medium |
| BA-01 | Search & Bilty | Enhancement | Medium |
| AD-01 | Addas Setup | Redesign | Medium |
| AD-02 | Addas Setup | Enhancement | Medium |
| ST-01 | Store Setup | New Feature | Low |
| PW-01 | Password | Bug/Security | High |
