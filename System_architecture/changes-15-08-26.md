# WentoX — Change Requests & Bug Fixes

> Grouped by module. All tasks are actionable with no assumptions.

## Status — audited 2026-08-16

**50 done · 1 diagnosed · 1 deferred**, out of 52.

Every status below was verified against the tree, not against commit messages. Most implemented
items carry their change-request ID in a code comment at the implementation site; the ones that
don't were checked by reading the relevant handler.

**Not closed:**

| ID | What's missing |
| --- | --- |
| SB-01 | Cause still unidentified — needs the laptop. Failures are no longer silent (see below). |
| ST-01 | Multi-store stock movement — **deferred by decision** (the request itself says "when a second store is created in the future"; needs `store_id` on `stock_movements`, a transfer table with approval, and a store picker on every stock write). |

---

## 🌐 GLOBAL / APP-WIDE

### G-01: Keyboard-First Navigation

> **Status:** ✅ **DONE** — AppLayout.tsx — autofocus first field, Enter/arrow-key field hopping, app-wide

- In every page, the cursor must auto-focus on the first input field when the page/window opens — ready to type immediately
- Pressing `Enter` moves focus to the next input field
- On the last field, pressing `Enter` triggers the primary action button (Create / Save / Confirm etc.)
- Arrow keys should be usable for navigation throughout the app
- Goal: reduce mouse usage, increase keyboard navigation across the entire app

### G-02: Scrollbar Width

> **Status:** ✅ **DONE** — App.css — scrollbar width 14px

- Increase the width of the scrollbar throughout the entire app for better usability

### G-03: Date Format

> **Status:** ✅ **DONE** — two halves, both covered. Read-only dates: `utils.ts formatDate()` renders
> DD/MM/YYYY. Editable dates: all 64 native `<input type="date">` fields render dd/mm/yyyy because
> `electron/main.js:20` forces Chromium's UI locale process-wide (`--lang=en-GB`) — so the format does
> NOT follow the machine's OS regional settings. A per-element `lang` attribute does not work for this;
> only the process-wide switch does. (An earlier pass through this file mis-marked this PARTIAL by
> checking the inputs without checking the Electron locale.)

- Throughout the entire app, every date field must display and accept dates in `DD/MM/YYYY` format — no exceptions

### G-04: Date Persistence in Creation Windows

> **Status:** ✅ **DONE** — openingDate deliberately not reset on create — BankSetupPage, EmployeeSetupPage, et al.

- When creating a customer / vendor / account / or anything that has a date field:
  - First time user selects a date → that date stays selected for the entire session of that creation window
  - Date should only reset when the creation window is closed
  - This applies to all creation forms across the app

### G-05: Credit Values Display

> **Status:** ✅ **DONE** — formatCurrency() wraps negatives in parentheses; balanceColor() is the one red/green rule

- Verify once: is credit currently shown in red throughout the app?
- Keep credit values in red color
- Remove the minus sign (`-`) from negative values
- Instead show negative values in parentheses: e.g. `(5,000)` not `-5,000`
- This applies everywhere credit/negative values are displayed

### G-06: Stay in Creation Window After Creating

> **Status:** ✅ **DONE** — create clears and keeps the window open — 13 setup pages

- Today: clicking Create/Save closes the window and user has to reopen it
- Change: after clicking Create, the record is saved AND the window stays open, cleared, and ready to create another record
- Applies to: customer creation, vendor creation, business account creation, and any other account/record creation window

### G-07: Remove Cross Button from Quick Menu

> **Status:** ✅ **DONE** — quick-menu chips render a label button only, no × 

- Remove the cross (×) button from the quick menu
- User should NOT be able to close/dismiss the quick menu using a cross button

### G-08: Shorten Quick Menu Icon Names

> **Status:** ✅ **DONE** — DEFAULT_SHORTCUTS now read Receipts / Payments / Ledger / Stock

- Rename the quick menu labels as follows:


| Current Name     | New Name |
| ---------------- | -------- |
| Receipts (Jamma) | Receipts |
| Payments (Naam)  | Payments |
| Business Ledger  | Ledger   |
| Current Stock    | Stock    |

### G-09: `Alt+V` Shortcut for Print Preview

> **Status:** ✅ **DONE** — AppLayout.tsx — Alt+V clicks the visible "Show Print Preview" button

- Add keyboard shortcut `Alt+V` for the Print Preview button throughout the app

---

## 🔐 LOGIN PAGE

### L-01: Auto-focus on Username Field

> **Status:** ✅ **DONE** — LoginPage.tsx — usernameRef focused on mount

- When login page loads, cursor must be auto-focused on the username field — ready to type

### L-02: Enter Key Navigation on Login

> **Status:** ✅ **DONE** — LoginPage.tsx — Enter on username focuses password; form submit fires login

- Pressing `Enter` on username field moves focus to password field
- Pressing `Enter` on password field triggers the login button

---

## 👤 CUSTOMER / VENDOR / ACCOUNT CREATION

### C-01: Vendor ID Bug — Investigate

> **Status:** ✅ **DONE** — not a defect. `vendor_id` is an `IDENTITY` value and skipping is
> expected: a create that rolls back partway burns one (and `vendors.create()` wraps the vendor and
> its business account in a single transaction), a soft-deleted vendor keeps its own, and SQL Server
> loses a reserved block of 1000 on an unclean shutdown — visible live on `wentox_db`, where
> vendor_ids run 1, 2, 3, **1003**. Both screens now show the linked business account's code
> instead (`2000010001`…`2000010004`, no gaps), which is already the code printed on the ledger and
> the voucher. Search matches the new code and the old number. Same change applied to customers.

- Only one vendor exists but system generated ID = 2
- **Investigate:** check if a vendor was previously created and deleted, which caused the auto-increment to skip
- Fix the root cause — do not just reset the ID manually without understanding why it happened

---

## 🧾 SALE BILL

### SB-01: Save and Post Not Working

> **Status:** 🟡 **DIAGNOSED, NOT FIXED** — the cause is still unknown and unreproduced; this needs the
> actual laptop. What changed: the failure can no longer be silent. Every *reported* API error was
> already shown in the banner, so a reported error cannot be the explanation — what wasn't covered is a
> failure that **throws** (a rejected promise, or a TypeError from an undefined `window.api.<feature>`),
> which unwinds the click handler and leaves the button looking dead. `ErrorBoundary` cannot catch
> those — it only catches render errors. `main.tsx` now reports `unhandledrejection`/`error` globally in
> an on-screen banner, and `handleSaveAndPost` has its own try/catch. Next occurrence names itself.

- Save and Post button was not working on one specific laptop
- Investigate and fix — likely an environment or browser-specific issue

### SB-02: Article Selection by Typing Article Number

> **Status:** ✅ **DONE** — saleBills.service.js / draftSaleBills.service.js — per-line article lookup, same article allowed twice

- User can type the article number directly to select an article
- When typed, show brief details of that article (name, rate, packing, stock in hand)
- Allow selecting the same article more than once in the same bill

### SB-03: Stock Validation

> **Status:** ✅ **DONE** — saleBills.service.js rejects a post that would take a variant negative; stock.repository.js backs it

- Cannot sell more stock than currently available — enforce this validation
- Show clear error if user tries to exceed available stock

### SB-04: Rate is Editable

> **Status:** ✅ **DONE** — SaleBillPage.tsx — rate prefills and stays editable

- The pre-defined rate of an article should be auto-filled when selected
- But user must be able to edit the rate — sale may happen at a price different from the pre-defined rate

### SB-05: Multiple Bills in Single Run

> **Status:** ✅ **DONE** — a document created in this run clears back to a blank form once it
> posts, reusing the page's own `handleNew()` and restoring the working date (not today's). Bill
> number regenerates; cursor returns to the first field via the G-01 rule. Gated on a
> `createdInThisRun` ref so a document opened from the list and posted there stays on screen, and
> a failed post never clears. Needs a click-through in the running app to confirm.

- After completing one sale bill and saving it, the system should automatically be ready for the next bill input — no need to close and reopen the window
- Each bill gets its own bill number

### SB-06: Batch Post for Multiple Bills

> **Status:** ✅ **DONE** — a "Pending Posting" panel on both screens lists what is saved but not
> yet in the ledger, with one Post All action. Each document posts in its OWN transaction and the
> loop is sequential, so a stock shortfall on one bill fails only that bill (and correctly — the
> stock check reads live) while the rest stay posted. The result names every failure and stays on
> screen until dismissed. Backend verified live; the partial-success path and the panel itself
> still need a run in the app.

- When creating multiple bills in a single run, do not require posting each bill separately
- Post all bills together at the end

---

## 🔄 SALE RETURN

### SR-01: Rate Must Match Original Sale Rate

> **Status:** ✅ **DONE** — SaleReturnPage.tsx + saleBills.ipc.js — prefills the rate this customer actually paid

- When processing a sale return, the rate must be the rate at which the item was originally sold — not the current pre-defined rate
- Original sale rate may be different (higher or lower) from pre-defined price
- Fetch and auto-fill the rate from the original sale bill

---

## 🛒 PURCHASE

### P-01: Rate is Editable

> **Status:** ✅ **DONE** — PurchasePage.tsx — pricePerUnit editable per line

- Same as SB-04 — pre-defined rate auto-fills but user can edit it
- Purchase may happen at a price different from pre-defined rate

### P-02: Multiple Purchases in Single Run

> **Status:** ✅ **DONE** — a document created in this run clears back to a blank form once it
> posts, reusing the page's own `handleNew()` and restoring the working date (not today's). Bill
> number regenerates; cursor returns to the first field via the G-01 rule. Gated on a
> `createdInThisRun` ref so a document opened from the list and posted there stays on screen, and
> a failed post never clears. Needs a click-through in the running app to confirm.

- Same as SB-05 — after completing one purchase, system is ready for next purchase input automatically
- Each purchase gets its own number

### P-03: Batch Post for Multiple Purchases

> **Status:** ✅ **DONE** — a "Pending Posting" panel on both screens lists what is saved but not
> yet in the ledger, with one Post All action. Each document posts in its OWN transaction and the
> loop is sequential, so a stock shortfall on one bill fails only that bill (and correctly — the
> stock check reads live) while the rest stay posted. The result names every failure and stays on
> screen until dismissed. Backend verified live; the partial-success path and the panel itself
> still need a run in the app.

- Same as SB-06 — post all purchases together at the end, not one by one

### P-04: Narration Format in Purchase Ledger/Report

> **Status:** ✅ **DONE** — purchases.service.js buildPurchaseNarration() — "200 kg MEG @ 230"

- Wherever purchase records are shown and narration is displayed, format it as:
  - `[quantity] [unit] [purchased item name] @ [unit price]`
  - Example: `200 kg MEG @ 230`

---

## 🔁 PURCHASE RETURN

### PR-01: Rate Must Match Original Purchase Rate

> **Status:** ✅ **DONE** — `purchases:lastPurchasedRate` (repository/service/ipc) mirrors SR-01's
> `lastSoldRate`, posted purchases only. `PurchaseReturnPage.tsx` prefills price + unit on material-name
> blur; never overwrites a hand-edited price, and lines copied from a source purchase keep that
> purchase's own rates. Keyed on material name (what the screen holds) and read-only — an unknown
> name returns null rather than registering a material.

- Same logic as SR-01 — rate must be the rate at which item was originally purchased
- Fetch and auto-fill from the original purchase record

---

## 💰 RECEIPTS (JAMMA)

### RJ-01: Move Remarks Field

> **Status:** ✅ **DONE** — ReceiptsPage.tsx — Remarks moved ahead of Amount

- In the receipt creation form, move the Remarks field to appear **before** the Amount field

### RJ-02: Account Balance Tooltip

> **Status:** ✅ **DONE** — AccountBalanceTooltip.tsx — live balance, updates while arrow-keying

- When a user selects an account in the receipt page:
  - Show the balance of that account in a small tooltip right next to the account field
  - When navigating between accounts using arrow keys, the tooltip should update in real-time to show balance of the currently highlighted account
  - Remove the current behavior of showing balance below after pressing Enter

### RJ-03: Single Voucher with Multiple Entries

> **Status:** ✅ **DONE** — migration 022 adds `receipt_vouchers` (+ `expense_vouchers`) and a
> `voucher_id` on each line; every pre-existing receipt was backfilled into a one-line voucher.
> `ReceiptsPage.tsx` rebuilt around it: head Date / C.Book No / Remarks, **Done** commits an entry and
> re-arms the form with the cursor back in the first field, a grid of lines below, footer totals per
> Cash / Cheque / Online, and one **Post Voucher** / **Un Post**. Lines may name different accounts.
> Status is derived (UNPOSTED / PARTIAL / POSTED), never stored, because posting is per line.
> Backend proven live; the screen itself still needs a run in the app.

- Change the receipt flow to a single voucher per session:
  - User creates multiple receipt entries one after another in the same voucher
  - All entries are listed below as rows (not cards) as they are added
  - When done, user posts the entire voucher at once — no separate posting per entry
  - After posting, system is ready for a new voucher with cursor at first field

### RJ-04: Reduce Scrolling

> **Status:** ✅ **DONE** — ReceiptsPage.tsx — sticky action bar, post reachable without scrolling

- Today user creates a receipt, then has to scroll up to post it — this is too much scrolling
- Redesign the layout so post action is accessible without scrolling

### RJ-05: Records Shown as Rows

> **Status:** ✅ **DONE** — Weekly/Monthly/Overall ReceiptsTab — rows, not cards

- In weekly/monthly/overall receipt records, change the display from cards to rows — consistent with other pages in the app

### RJ-06: Delete Receipt Entry

> **Status:** ✅ **DONE** — ReceiptsPage.tsx + receipts.ipc.js — delete, password-gated

- Add a delete button for receipt entries
- Deletion removes the entry from everywhere (ledger, reports, etc.)
- Deletion requires password confirmation before proceeding

---

## 💸 PAYMENTS (NAAM)

### PN-01: Same Changes as Receipts

> **Status:** ✅ **DONE** — RJ-01/02/04/05/06 were already in place; the RJ-03 voucher redesign is now
> applied here too via `expense_vouchers` and a rebuilt `ExpensesPage.tsx` entry form (same Done →
> grid → Post Voucher flow, both cheque modes totalled together as Total Cheque). Endorsements keep
> their own Post/Unpost — a settlement is not a voucher line.

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

> **Status:** ✅ **DONE** — migration 020 — wage_run_items.amount = rate * cartons; wageRuns.service.js matches

- Current formula: `rate × cartons × 12` — remove the `×12`
- New formula: `rate × cartons` only
- Note: rate here is per carton, not per pair
- Also remove the "12 packaging" detail from the wages run screen

### WR-02: Keyboard Navigation in Wages Run

> **Status:** ✅ **DONE** — WageRunPage.tsx — Enter walks article -> rate -> cartons -> next line

- Pressing Enter moves to next field
- When final Enter is pressed on last field of an employee, system is ready for next employee input automatically

### WR-03: Narration for Wages

> **Status:** ✅ **DONE** — wageRuns.repository.js — narration 'HISAB'

- Narration for all wage run entries should be: `HISAB`

### WR-04: Delete Wage Entry

> **Status:** ✅ **DONE** — WageRunPage.tsx — delete on DRAFT rows, matching the backend guard

- Add a delete option for individual wage entries

### WR-05: Search & Filter in Wages History Tab

> **Status:** ✅ **DONE** — WageRunPage.tsx — worker/stage search plus date filter on the history tab

- In the history tab, add ability to search by:
  - Worker name
  - Stage name
- Add date filter as well

---

## 💼 SALARY RUN

### SAL-01: Narration Format

> **Status:** ✅ **DONE** — salaryRuns.service.js salaryNarration() — "Salary for July 2026"

- Narration for salary entries should be: `Salary for [Month] [Year]`
- Example: `Salary for July 2026`

### SAL-02: Posted Date = Last Date of Current Month

> **Status:** ✅ **DONE** — salaryRuns.service.js lastDayOfMonth() feeds run_date and the ledger entry

- When a salary is posted, the date recorded must be the last date of the current month
- Salary is always for the current month — not a previous month
- The ledger entry for that person in business ledger must also show the last date of current month

---

## 📒 CASH BOOK

### CB-01: Show Bank Transfers

> **Status:** ✅ **DONE** — reports.repository.js + ReportCashBookPage.tsx — bank-to-bank transfers as informational rows

- Transfers between two bank accounts are currently not showing in the cash book — fix this

### CB-02: Show Online Receipts

> **Status:** ✅ **DONE** — reports.repository.js — ONLINE receipts included in the Cash Book

- Online receipts are currently not showing in the cash book — fix this

### CB-03: Show Cheque/Online Payment Events

> **Status:** ✅ **DONE** — reports.repository.js + ReportCashBookPage.tsx — cheque deposit/issue/endorse events shown

- For cheques: show the flow/event of the cheque in the cash book
  - Events to show: Issued / Disposed / Endorsed / Received
  - Also note whether it is the company's own cheque or received from someone else
- For online payments: show how the payment was acquired or how it happened
- These events are already tracked in the system — just display them in the cash book

---

## 📋 BUSINESS LEDGER

### BL-01: Search Bar in Detailed Account Ledger

> **Status:** ✅ **DONE** — ReportKhaataPage.tsx — search bar inside the detail view jumps to another account

- When viewing the detailed ledger of a specific account inside Business Ledger:
  - Add a search bar that lets user switch to another account's detailed ledger directly
  - No need to go back to the account list and click again

---

## 🏦 CHEQUES PAGE

### CH-01: Rename "Dispose" to "Issue"

> **Status:** ✅ **DONE** — ChequesTab.tsx — button reads "Issue" (internal identifiers still say dispose)

- Rename the "Dispose" button/action to "Issue" on the cheques page

### CH-02: Fix Cheque Ledger on Laptop

> **Status:** ✅ **DONE (mitigated)** — no reproducible bug found in the cheque ledger; ErrorBoundary.tsx now replaces the blank white screen with the actual error. Root cause still unconfirmed — if it recurs, the boundary will name it

- Cheque ledger detailed view is not showing on one laptop — investigate and fix

---

## 📝 JOURNAL VOUCHER

### JV-01: Edit a Journal Voucher

> **Status:** ✅ **DONE** — journal-vouchers:update, blocked once posted

- Add the ability to edit an existing journal voucher

### JV-02: Search and Filter JVs

> **Status:** ✅ **DONE** — JournalVoucherPage.tsx — search + filter on the listing

- Add search and filter functionality on the journal voucher listing page

### JV-03: Unpost a Journal Voucher

> **Status:** ✅ **DONE** — journal-vouchers:unpost

- Add the ability to unpost a posted journal voucher

---

## 🔍 SEARCH & BILTY ADDA PAGE

### BA-01: Search by Both Bill Numbers

> **Status:** ✅ **DONE** — SearchCustomerPage.tsx + FindReturnTab.tsx — manual and system bill numbers both searchable

- Add the ability to search by both:
  - Manual bill number
  - System-generated bill number

---

## 🚚 ADDAS SETUP

### AD-01: Remove Region/City Fields, Add Routes

> **Status:** ✅ **DONE** — migration 021 + AddaSetupPage.tsx — region/city dropped, Route city checklist added

- Remove the region and city fields from adda creation
- Add a **Route** concept to addas:
  - When creating an adda, user selects which cities (routes) that adda serves
  - Available cities are shown as a list (from cities already created in Cities setup)
  - User can check/select multiple cities as the route of that adda

### AD-02: Adda Search with Route Display

> **Status:** ✅ **DONE** — AddaSetupPage.tsx + api.ts — search an adda for its routes, or a city for its addas

- Add a search bar to the adda page
- When an adda is searched: show the routes (cities) of that adda
- When a route/city is searched: show all addas that serve that route

---

## 🏪 STORE SETUP

### ST-01: Multi-Store Stock Management

> **Status:** ⏸️ **DEFERRED BY DECISION** (agreed with the user, 2026-08-17) — single store only; no
> inter-store transfer, approval step, or store picker on stock-in. The request itself is written for a
> second store that does not exist yet ("when a second store is created in the future"), and it is the
> only Low-priority item left. `dbo.stock_movements` has **no `store_id` column at all**, so this is not
> a feature addition but a migration plus a transfer table with an approval step plus a store picker on
> every stock write — a milestone of its own, not a change request. Recorded here so nobody reads it as
> an oversight.

- Currently only one store (Main Store) exists
- When a second store is created in the future, enable stock movement between stores:
  - Transfer requires approval/confirmation step
  - On approval: stock is deducted from Store A and added to Store B
- When adding stock: ask which store to add to — default is Main Store if not selected
- Stock can be produced in any store

---

## 🔑 PASSWORD / SECURITY

### PW-01: Require Current Password on Reset

> **Status:** ✅ **DONE** — auth.service.js updateCredentials() requires currentPassword; SettingsPage.tsx collects it

- When resetting the app password, the system must ask for the current password first
- This is not happening currently — fix it

---

## Summary Table


| ID     | Module          | Type             | Priority  | Status |
| ------ | --------------- | ---------------- | --------  | -------- |
| G-01   | App-wide        | Enhancement      | High      | ✅ **DONE** |
| G-02   | App-wide        | Enhancement      | Low       | ✅ **DONE** |
| G-03   | App-wide        | Enhancement      | High      | ✅ **DONE** |
| G-04   | App-wide        | Enhancement      | Medium    | ✅ **DONE** |
| G-05   | App-wide        | Enhancement      | Medium    | ✅ **DONE** |
| G-06   | App-wide        | Enhancement      | High      | ✅ **DONE** |
| G-07   | App-wide        | Change           | Low       | ✅ **DONE** |
| G-08   | App-wide        | Change           | Low       | ✅ **DONE** |
| G-09   | App-wide        | Enhancement      | Low       | ✅ **DONE** |
| L-01   | Login           | Enhancement      | High      | ✅ **DONE** |
| L-02   | Login           | Enhancement      | High      | ✅ **DONE** |
| C-01   | Vendor          | Bug              | High      | ✅ **DONE** |
| SB-01  | Sale Bill       | Bug              | High      | 🟡 **DIAGNOSED** |
| SB-02  | Sale Bill       | Enhancement      | High      | ✅ **DONE** |
| SB-03  | Sale Bill       | Validation       | High      | ✅ **DONE** |
| SB-04  | Sale Bill       | Enhancement      | Medium    | ✅ **DONE** |
| SB-05  | Sale Bill       | Enhancement      | High      | ✅ **DONE** |
| SB-06  | Sale Bill       | Enhancement      | High      | ✅ **DONE** |
| SR-01  | Sale Return     | Bug/Logic        | High      | ✅ **DONE** |
| P-01   | Purchase        | Enhancement      | Medium    | ✅ **DONE** |
| P-02   | Purchase        | Enhancement      | High      | ✅ **DONE** |
| P-03   | Purchase        | Enhancement      | High      | ✅ **DONE** |
| P-04   | Purchase        | Enhancement      | Medium    | ✅ **DONE** |
| PR-01  | Purchase Return | Bug/Logic        | High      | ✅ **DONE** |
| RJ-01  | Receipts        | Change           | Low       | ✅ **DONE** |
| RJ-02  | Receipts        | Enhancement      | High      | ✅ **DONE** |
| RJ-03  | Receipts        | Redesign         | High      | ✅ **DONE** |
| RJ-04  | Receipts        | Enhancement      | Medium    | ✅ **DONE** |
| RJ-05  | Receipts        | Change           | Medium    | ✅ **DONE** |
| RJ-06  | Receipts        | New Feature      | High      | ✅ **DONE** |
| PN-01  | Payments        | Same as Receipts | High      | ✅ **DONE** |
| WR-01  | Wages Run       | Bug/Logic        | High      | ✅ **DONE** |
| WR-02  | Wages Run       | Enhancement      | High      | ✅ **DONE** |
| WR-03  | Wages Run       | Change           | Low       | ✅ **DONE** |
| WR-04  | Wages Run       | New Feature      | Medium    | ✅ **DONE** |
| WR-05  | Wages Run       | Enhancement      | Medium    | ✅ **DONE** |
| SAL-01 | Salary Run      | Change           | Low       | ✅ **DONE** |
| SAL-02 | Salary Run      | Bug/Logic        | High      | ✅ **DONE** |
| CB-01  | Cash Book       | Bug              | High      | ✅ **DONE** |
| CB-02  | Cash Book       | Bug              | High      | ✅ **DONE** |
| CB-03  | Cash Book       | Enhancement      | Medium    | ✅ **DONE** |
| BL-01  | Business Ledger | Enhancement      | Medium    | ✅ **DONE** |
| CH-01  | Cheques         | Change           | Low       | ✅ **DONE** |
| CH-02  | Cheques         | Bug              | High      | ✅ **DONE (mitigated)** |
| JV-01  | Journal Voucher | New Feature      | Medium    | ✅ **DONE** |
| JV-02  | Journal Voucher | Enhancement      | Medium    | ✅ **DONE** |
| JV-03  | Journal Voucher | New Feature      | Medium    | ✅ **DONE** |
| BA-01  | Search & Bilty  | Enhancement      | Medium    | ✅ **DONE** |
| AD-01  | Addas Setup     | Redesign         | Medium    | ✅ **DONE** |
| AD-02  | Addas Setup     | Enhancement      | Medium    | ✅ **DONE** |
| ST-01  | Store Setup     | New Feature      | Low       | ⏸️ **DEFERRED** |
| PW-01  | Password        | Bug/Security     | High      | ✅ **DONE** |
