# WentoX ERP — Use Cases

**Version 3.0 — rewritten from scratch.**

Derived **solely** from `architecture-v2.md` (the single source of truth) and the data model in
`database_schema.md` v4.0. The previous 21 use cases were discarded rather than edited: they
documented Control Accounts (removed by TASK-11) and sub-customers linked to a parent customer
(removed by TASK-06), and they had no coverage of Purchase, Purchase Return, Regions, Commission,
cheques, roles, or any of the eight reports.

Each use case names the tables it reads and writes, so this document and `database_schema.md` can
be checked against each other.

**Build status legend:** ✅ built · ⚠️ built but needs rework · ❌ not started
(status is of the *feature*, per `architecture-v2.md` §14 — nothing is wired to a backend yet, as
frontend↔backend integration is at 0%).

---

## Contents

| Group | Use cases |
|---|---|
| Home & System | UC-01 … UC-05 |
| Setup | UC-06 … UC-14 |
| Accounting Setup | UC-15 … UC-17 |
| Transactions | UC-18 … UC-27 |
| Stock | UC-28 … UC-30 |
| Reports | UC-31 … UC-38 |

---

# HOME & SYSTEM

## UC-01: Open the app on the Home page — ❌

**Actor:** All users · **Goal:** Land on a clean home screen and see what is most urgent
**Screen:** Home

**Steps:**
1. After login the system shows the Home landing page: WentoX logo, company name, clean layout.
2. An **alerts widget** lists items sorted by **nearest due date first** — the soonest-due cheque
   or payable appears at the top.
3. Clicking an alert navigates to the source record (Account Ledger entry, Receipt, Purchase).
4. Clicking the **Home icon** in the navbar from anywhere returns to this page.

**Data:** reads `receipts` (cheque_date), `sale_bills.due_date`, `purchases.due_date`,
`alert_dismissals`.

---

## UC-02: Log in / log out — ⚠️

**Actor:** All users · **Goal:** Authenticate into or leave the system
**Screen:** Login page / sidebar footer popup

**Steps:**
1. The system shows the login page on app start.
2. User enters username and password and clicks **Log In**.
3. System validates the credentials against the bcrypt hash, issues a session, and loads the
   user's **role**, which determines what appears in the sidebar (UC-03).
4. On success the user lands on Home (UC-01).
5. To log out, the user opens the profile popup in the sidebar footer and clicks **Log out**.

**Data:** reads `users`.
**Rework:** authentication is currently a plaintext comparison against a single hardcoded
`admin`/`admin` pair with no roles and no backend endpoint.

---

## UC-03: Role-based access control — ❌

**Actor:** Administrator · **Goal:** Restrict sensitive accounts to admins

| Role | Access |
|---|---|
| **ADMIN** | Full access to everything |
| **USER** | Everything **except** Cash at Banks and Directors Expenses – Drawings |

**Steps:**
1. Every user record carries a role of `ADMIN` or `USER`.
2. Accounts flagged `chart_of_accounts.is_restricted = 1` are hidden from `USER`-role sessions —
   in dropdowns, in report groupings, and in the sidebar.
3. The API enforces the same rule server-side; hiding a nav item is never the only guard.
4. A `USER` who requests a restricted account directly receives a 403.

**Data:** reads `users.role`, `chart_of_accounts.is_restricted`.

---

## UC-04: Update system settings / credentials — ✅

**Actor:** Administrator · **Goal:** Change login credentials
**Screen:** System Settings (admin popup in the sidebar footer)

**Steps:** enter new username → enter and confirm new password → **Save**. The password is stored
as a bcrypt hash, never in plain text.

**Data:** writes `users`.

---

## UC-05: Review and dismiss alerts — ❌

**Actor:** Accountant / Management · **Goal:** Be warned about cheques and overdue payments
**Screen:** Bell icon + badge in the app header (system-wide, not inside Reports)

**Steps:**
1. The app polls for notifications on load and periodically while open.
2. The system computes alerts live — nothing is stored:
   - **Cheque due/overdue** — receipts where mode is CHEQUE and status is `PENDING` or
     `PARTIALLY_ENDORSED`, whose cheque date falls within the next N days (amber) or has already
     passed (red). These are **unconditional** — every cheque generates them.
   - **Payment overdue** — sale bills or purchases where a `due_date` **was explicitly entered**
     and has passed while the balance is still positive. A record left with a blank due date
     **never** produces this alert; there is no fallback credit period.
3. Alerts are grouped by type and severity in a dropdown.
4. Clicking an alert navigates to the source record.
5. Dismissing or snoozing an alert writes to `alert_dismissals`; dismissed alerts are filtered out
   until they expire. The underlying data is never altered.

**Data:** reads `receipts`, `sale_bills`, `purchases`, `ledger_entries`; writes `alert_dismissals`.

---

# SETUP

> All setup screens share one shape: a **list tab** with text search, an **Add New** button, click
> a row to edit, and **Save**. Codes are auto-generated for new entries. Deleting a record that is
> referenced by a transaction is blocked — the record is deactivated instead of removed.

## UC-06: Manage product categories — ✅

**Actor:** Admin · **Screen:** Categories
Browse → **Add New** or select to edit → system generates the category code → enter the name → **Save**.

**Data:** writes `product_categories`.

---

## UC-07: Manage articles and their colours — ⚠️

**Actor:** Admin / Setup staff · **Goal:** Register an article and its cost breakdown
**Screen:** Product Detail Info

**Steps:**
1. Browse existing articles in the list tab.
2. **Add New**, or select an article to edit.
3. Select the category; the system generates the article code (e.g. `P-101`).
4. Enter the article name, vendor, batch no. and packing (pairs per carton).
5. Enter the cost breakdown — labour, sole stitch, pasting, trim, finishing, socks pasting, DC,
   sock stitch, sheet, stubble, bottom and the rest.
6. **Save.**

**Colour variants:** an article's colours are *not* created here. A new colour is created from the
Current Stock "Add" dialog the first time stock of that colour is added (UC-28), which keeps the
setup form short and means a colour only exists once there is a reason for it to.

**Data:** writes `articles`; reads `product_categories`, `vendors`.
**Rework:** articles and colours are currently one flat table with the article grouping parsed out
of the product name by regex.

---

## UC-08: Manage vendors — ⚠️

**Actor:** Admin · **Goal:** Register a supplier
**Screen:** Vendors

**Steps:**
1. Browse vendors in the list tab.
2. **Add New** or select to edit.
3. Enter name, phone, address, region and city.
4. **Save.**
5. On create the system **automatically creates the vendor's ledger account** — a
   `business_accounts` row under the reserved **VENDORS ACCOUNTS** chart account — and links it via
   `vendors.ba_id`. The user never sees a separate account-setup step.
6. Renaming a vendor keeps the linked account's name in sync.

**Why this matters:** a vendor is a **single source of truth** shared by Purchase (which uses
`vendor_id`) and vendor payments (which are Expense entries and use `ba_id`). Without the link,
Vendor Report cannot put purchases and payments on the same line.

**Data:** writes `vendors`, `business_accounts`; reads `regions`, `cities`, `chart_of_accounts`.

---

## UC-09: Manage customers — ❌

**Actor:** Admin / Sales staff · **Goal:** Register a customer and view their history
**Screen:** Customers (card view)

**Steps:**
1. All customers are shown as **cards**, not a table.
2. **Add New Customer** on the same page opens the form: name, **Region** (required), City, phone,
   address.
3. On save the system creates the customer's ledger account under the reserved **CUSTOMERS
   ACCOUNTS** chart account and links it via `customers.ba_id`, exactly as UC-08 does for vendors.
4. Clicking a card opens the **customer detail / ledger**: a product ledger filterable between two
   dates, overall, by month, or by article, with columns Date, Article, Debit, Credit and **Sale
   Return** (the quantity returned for that article).
5. Print and Export as Excel are available from the detail view.

**Search rule:** customers are found by **Region first, City second** — Region is the primary
grouping and search key throughout the app.

**Data:** writes `customers`, `business_accounts`; reads `regions`, `cities`, `sale_bills`,
`sale_bill_items`, `sale_returns`, `ledger_entries`.

---

## UC-10: Manage sub-customers — ⚠️

**Actor:** Admin / Sales staff · **Goal:** Maintain delivery agents / middlemen
**Screen:** Sub Customers

**Steps:** browse → **Add New** or select to edit → enter name, phone, address → **Save**.

**Sub-customers are independent.** They have **no parent customer**. The dropdown on Sale Bill and
Sale Return lists **every** sub-customer with a search box, not a filtered subset.
A sub-customer can also be added inline from the Sale Bill form.

**Data:** writes `sub_customers`.
**Rework:** the parent-customer link still exists and must be removed.

---

## UC-11: Manage cities — ✅
Browse → **Add New** or select → auto code → enter the city/district name → optionally attach it to
a region → **Save**. **Data:** writes `cities`; reads `regions`.

## UC-12: Manage regions — ⚠️
Browse → **Add New** or select → auto code → enter the region name → **Save**.
Regions are a **first-class lookup**, not a free-text field, because they are the primary customer
search key (UC-09) and the grouping for Sale Analysis and Sale Report.
**Data:** writes `regions`.

## UC-13: Manage stores — ✅
Browse → **Add New** or select → enter the store name → **Save**. The business runs a single store,
so stores are bill metadata (the FROM store on a bill, the TO store on a return) and do not
partition stock. **Data:** writes `stores`.

## UC-14: Manage transport addas — ✅
Browse → **Add New** or select → enter the adda name, city and optional details → **Save**.
**Delete is blocked** when the adda is referenced by any sale bill; deactivate it instead.
**Data:** writes `addas`; reads `sale_bills`.

---

# ACCOUNTING SETUP

> The hierarchy is **Group → Chart → Business**. Control Accounts have been **removed from the
> system entirely** (TASK-11) — the page is gone and every reference to them in the UI is gone.

## UC-15: Manage group accounts — ✅
Browse → **Add New** or select → auto code → enter the name → select the class
(**ASSETS / LIABILITY / INCOME / EXPENSES**) → set sorting → **Save**.
**Data:** writes `group_accounts`.

## UC-16: Manage chart of accounts — ⚠️
Browse → **Add New** or select → **select the parent group account** → auto A/C code → enter the
name → set link code and status (Active/Closed) → **Save**.

Certain chart accounts are **reserved** and must not be deleted: CUSTOMERS ACCOUNTS, VENDORS
ACCOUNTS, CASH IN HAND, SALES, PURCHASES, COMMISSION ALLOWED, CHEQUES IN HAND, plus the five
Payment Trail categories. Cash at Banks and Directors Expenses – Drawings are flagged
**restricted** and are invisible to `USER`-role sessions (UC-03).

**Data:** writes `chart_of_accounts`; reads `group_accounts`.
**Rework:** the parent is currently a control account.

## UC-17: Manage business accounts — ⚠️
Browse → **Add New** or select → **select the parent chart account** → auto A/C code → enter the
name, link code, region and status → **Save**.

Business accounts are the **leaf ledger accounts** — every customer and every vendor has one, and
every expense head is one. Most are created automatically by UC-08 and UC-09 rather than typed here.

**Data:** writes `business_accounts`; reads `chart_of_accounts`, `regions`.

---

# TRANSACTIONS

> **Posting semantics.** Sale Bills, Sale Returns, Purchases and Purchase Returns are
> Posted/Unposted documents. **Posting** writes the ledger rows and stock rows in one database
> transaction; **unposting** deletes them in one transaction. Financial fields may only be edited
> while a document is UNPOSTED — except bilty no. and adda, which may be updated on posted bills
> because they are dispatch metadata, not money (UC-20).

## UC-18: Create a sale bill — ✅

**Actor:** Sales staff · **Screen:** Sale Bill → Billing tab
**Preconditions:** at least one store, customer and article-colour exist.

**Steps:**
1. The system generates a unique system invoice number (the "Inv #").
2. User selects the date and the source store (FROM).
3. User enters the manual bill number (the "Bill #").
4. User selects the customer from a searchable dropdown.
   → **The Main A/C auto-fills from the customer.** If the customer has no account
   (`customers.ba_id IS NULL`), the system shows **"Please add customer account first"**.
5. User sets delivery: **SAME** (to the customer's own address) or **Custom** (select a
   sub-customer as delivery agent, plus an optional custom delivery address).
6. User adds product rows:
   - selects the article and colour from a searchable dropdown,
   - packing auto-fills,
   - entering cartons auto-computes pairs (`cartons × packing`),
   - entering the rate auto-computes gross value,
   - an optional per-article discount (**D%** or flat value) computes the net line value.
7. User optionally enters an invoice-level discount.
8. User optionally enters GP no., bilty no., transport adda, and a **payable due date** (leaving it
   blank means this bill never raises an overdue alert — see UC-05).
9. User enters remarks and clicks **Confirm**, which is enabled only once mandatory fields are filled.
10. The system saves and posts the bill: stock decreases by the pairs sold, and the ledger records
    a **debit** against the customer.

**Discount vs commission:** the D% and invoice discounts here are **discounts** — they reduce the
bill value at sale time and are already inside `net_value`. Commission is a different thing
recorded at payment time (UC-25).

**Drafts:** incomplete bills auto-save to local storage and can be resumed or deleted.
**Print:** A4 Excel-style invoice, plus Export as PDF and Export as Excel.

**Data:** writes `sale_bills`, `sale_bill_items`, `ledger_entries`, `stock_movements`;
reads `customers`, `sub_customers`, `stores`, `addas`, `articles`, `article_colors`.

---

## UC-19: Find and update a sale bill — ✅

**Screen:** Sale Bill → Weekly / Monthly / Overall / Find & Update tabs

**Steps:** open a record tab (Weekly, Monthly, Overall) or **Find & Update** for advanced filtering
by date range, customer, bilty status and article → each row offers **Edit** and **Print** →
Edit loads the bill back into the Billing tab. Financial edits require the bill to be unposted first.

**Data:** reads/writes `sale_bills`, `sale_bill_items`.

---

## UC-20: Search and update bilty / adda — ✅

**Actor:** Dispatch staff · **Goal:** Assign bilty numbers and transport addas after dispatch
**Screen:** Search & Bilty Adda Updation

**Steps:**
1. Filter invoices by date range, customer name, sub-customer name, or bill number.
2. Narrow with radio buttons: **All Invoices / Without Bilty / Without Adda / With Bilty**.
3. Sort by invoice no. or manual bill no.
4. **Select** a row to load it into the Bilty Info Update panel.
5. Enter the bilty number, select the transport adda, and click **Update Bilty & Adda**.

**This works on posted bills** — bilty and adda are non-financial.

**Data:** writes `sale_bills.bilty_no`, `sale_bills.adda_id`.

---

## UC-21: Create a sale return — ✅

**Actor:** Sales staff · **Screen:** Sale Return → Return Entry tab

**Steps:**
1. The system generates a unique return ID.
2. User selects the date and the **destination** store (TO — where stock comes back).
3. User enters the manual invoice number and selects the customer; the main account auto-fills.
4. User sets the delivery agent (sub-customer) if the return is not direct.
5. **All fields are entered manually**, but a dropdown below lists **articles this customer has
   previously bought**, sourced from their sale bills. Selecting one auto-fills the product
   details. The bill slip format itself does not change.
6. User enters cartons, rate and optional discount; pairs and credit value auto-calculate.
7. User optionally enters an invoice-level discount, then the return reason in remarks.
8. **Confirm** saves and posts: stock increases by the returned pairs, and the ledger records a
   **credit** to the customer.

The return flows through to the Account Ledger and to Sale Analysis.

**Data:** writes `sale_returns`, `sale_return_items`, `ledger_entries`, `stock_movements`;
reads `sale_bill_items` (for the prior-purchase dropdown).

---

## UC-22: Find and update a sale return — ✅
Same structure as UC-19, over the Sale Return record tabs. **Data:** reads/writes `sale_returns`,
`sale_return_items`.

---

## UC-23: Record a purchase — ❌

**Actor:** Purchase staff / Accountant · **Goal:** Record raw materials bought from a vendor
**Screen:** Purchase

**Steps:**
1. User selects the date and the **vendor** from a dropdown.
2. User optionally enters the vendor's own bill number.
3. User adds material lines — multiple materials on the same slip, like a sale bill:
   - **Material** — a searchable dropdown of every material used before, **plus the option to type
     a brand-new name**. See the note below.
   - **Unit** — self-assigned (Meters, Buckles, KG…); pre-fills from the material's default unit,
     and can be overridden per line.
   - **Weight** (optional),
   - **Quantity** and **Price per unit**,
   - **Total price** auto-calculates as quantity × price per unit.

   > **Material entry is open-ended, but only once per material.** The first time "PU Sheet Roll"
   > is bought, the user simply types it. On save it is registered in the database, so **every
   > later purchase finds it in the dropdown** and selects it rather than retyping it. This is what
   > keeps Vendor Stock trustworthy: the same real material can never split into "PU Sheet",
   > "PU sheet roll" and "P.U. Sheet Roll" as three separate stock lines. Re-typing an existing
   > name in a different case resolves to the same material, not a duplicate.
4. User optionally sets a **payable due date** (blank = no overdue alert, per UC-05).
5. User enters remarks and confirms.
6. On posting, the system:
   - adds the purchased quantities to **Vendor Stock** (UC-30), and
   - records the amount owed as a **credit to the vendor's account**, which is what Vendor Report's
     Total Purchase column reads.

> **Purchases do not affect finished-goods (pairs) stock.** Materials and finished articles are
> tracked in two separate ledgers with incompatible units. The Current Stock page never changes
> because of a purchase.

**Data:** writes `purchases`, `purchase_items`, `vendor_stock_movements`, `ledger_entries`,
`materials` (auto-registered on first use); reads `vendors`, `materials`.

---

## UC-24: Record a purchase return — ❌

**Actor:** Purchase staff · **Goal:** Record materials sent back to a vendor
**Screen:** Purchase Return

Mirrors UC-23 exactly: select date and vendor, add material lines (same dropdown-of-known-materials
behaviour), enter the return reason, confirm.
On posting the quantities are **deducted from Vendor Stock** and the vendor's account is **debited**,
reducing what is owed. This feeds Vendor Report's Purchase Return column.

**Data:** writes `purchase_returns`, `purchase_return_items`, `vendor_stock_movements`,
`ledger_entries`; reads `vendors`, `materials`.

---

## UC-25: Record a receipt (Jamma) — ⚠️

**Actor:** Accountant / Sales staff · **Goal:** Record a payment received from a customer
**Screen:** Receipts (Jamma) → Entry tab

**Steps:**
1. User selects the date and the customer; the account group auto-fills and the **current
   outstanding balance** is shown inline.
2. User enters the **amount received**.
3. User enters **Commission**, if any (see below).
4. The screen shows **both figures explicitly** — the original amount owed and the amount owed
   after commission — so the before/after is visible at a glance, not just a net balance.
5. User selects the payment mode: **Cash**, **Cheque** or **Online**.
6. For **Cheque**, three further fields are required:
   - **Cheque No.**
   - **Date on Cheque** — the date the customer wrote on it
   - **Cheque Received Date** — the date WentoX physically took delivery of it

   The cheque starts at status `PENDING`.
7. For **Online**, the user enters the reference; for either non-cash mode, bank details go in the
   details field.
8. User enters remarks — **this text becomes the narration** on the Account Ledger row
   (e.g. "CHEQUE 28423916 13-10-2025", "CASH", "PURNA DIFFERENCE").
9. **Confirm** saves the receipt and posts a **credit** to the customer's ledger, plus a **separate
   credit row for the commission** if one was entered.

### Commission is not a discount

| | Discount | Commission |
|---|---|---|
| **When** | At time of sale | At time of payment |
| **Where** | Sale Bill (D% / invoice discount) | Receipts (Jamma) |
| **Effect on the sale amount** | Reduces it | **Leaves it unchanged** |
| **Effect on what's payable** | Already reduced in the bill | Reduces what the customer still owes |

Worked example: the customer owes **1,020,000**; they ask for **20,000** off as goodwill; the sale
bill stays **1,020,000** and is never touched; a commission of **20,000** is recorded here; the
customer pays **1,000,000**. Ledger: Debit 1,020,000 (sale), Credit 20,000 (commission), Credit
1,000,000 (payment) → balance **0**.

**Data:** writes `receipts`, `ledger_entries`; reads `customers`, `sale_bills`, `sale_returns`.
**Rework:** Commission and all four cheque fields need adding; today only free-text details/remarks exist.

---

## UC-26: Record an expense (Kharch) — ✅

**Actor:** Accountant · **Goal:** Record money paid out
**Screen:** Expenses (Kharch) → Entry tab

**Steps:** select the date → select the business account (expense head) from a searchable dropdown;
the parent account auto-fills → enter the amount → select Cash / Cheque / Online → enter payment
details (including cheque number, which the Cash Book needs) → enter remarks → **Confirm**.

**Vendor payments are Expense entries.** There is no separate "pay a vendor" screen. Paying a
vendor means recording an expense against **that vendor's business account** — the one auto-created
in UC-08. Because `vendors.ba_id` links the two, Vendor Report can put a vendor's purchases and
payments on the same row.

Accounts flagged restricted (Cash at Banks, Directors Expenses – Drawings) do not appear in the
dropdown for `USER`-role sessions (UC-03).

**Data:** writes `expenses`, `ledger_entries`; reads `business_accounts`.

---

## UC-27: Dispose of a received cheque — ❌

**Actor:** Accountant · **Goal:** Deposit a cheque, or hand it on to a vendor or expense instead
**Screen:** Receipts (Jamma) → "Dispose of Cheque"

A received cheque is a **pool of value** that gets allocated across one or more destinations —
possibly on the day it arrives, possibly much later — until its unallocated balance reaches zero.

**Steps:**
1. Open the disposal screen; it lists cheques that are pending or partially allocated.
2. Select a cheque and choose a **disposition**: **Deposit**, **Vendor Payment**, or **Expense Payment**.
3. For a payment, select the target vendor or business account.
4. Enter the amount, defaulting to the remaining unallocated balance.
5. A running **"Unallocated balance"** is shown until it reaches zero.
6. Save.

**The three cases that must all work:**
- **Cheque = amount due** — one allocation; vendor settled, cheque fully used.
- **Cheque > amount due** — the vendor is settled and the **remainder must be explicitly assigned**
  somewhere else (another vendor, an expense, or deposited). The UI must not let a remainder be
  silently orphaned.
- **Cheque < amount due** — the allocation reduces but does not clear the vendor's payable; the
  vendor's ledger still shows a balance to be covered separately.

**Cash-flow treatment:** both legs are real cash movements. The cheque counts as a **Jamma
(inflow)** in the Cash Book on the day it was received, and the endorsement counts as a **Naam
(outflow)** on the day of the endorsement — exactly as if the cheque had been banked and a separate
payment made. Neither leg is excluded from the daily totals.

**Bounced cheques cascade.** If a cheque bounces after being endorsed, **both sides reverse
together**: the customer's receipt reverses so their due goes back up, *and* every allocation
sourced from that cheque flips to REVERSED so the vendor's or expense account's balance goes back
up too. Correcting only the customer's ledger is a bug.

**Data:** writes `cheque_allocations`, `ledger_entries`, `receipts.cheque_status`.

---

# STOCK

## UC-28: View current stock and add stock / log production — ⚠️

**Actor:** Warehouse staff / Production manager · **Screen:** Stock → Current Stock

**Main table — one row per article:**
Article code · Category · Total pairs · **Add (+)** button

**Expand a row → colour sub-rows**, one per colour of that article:
Content colour · Pairs per carton · Total cartons · Extra pairs · Total pairs

Cartons and extra pairs are derived, never stored: `cartons = total_pairs ÷ packing`,
`extra = total_pairs mod packing`. Total pairs is the sum of that colour's stock movements.

**Add stock / log production:**
1. Click **+** on an article row.
2. Choose the **colour** from a searchable dropdown, **or type a new colour** — a new colour
   variant is created for the article on save.
3. Enter the quantity and the unit (**Cartons** or **Pairs**).
4. Choose the **production date** (defaults to today).
5. Review the **Updated Stock Preview** showing how levels will change.
6. **Confirm Add & Log** — stock increases and a production log entry is written.

Search by article name/code and filter by category; both persist across tabs. Production history is
viewable Daily / Weekly / Monthly / Overall. Print, Export as PDF and Export as Excel are available.

**Data:** writes `stock_movements` (PRODUCTION), `article_colors`; reads `articles`,
`product_categories`.
**Rework:** the colour sub-row structure, the colour field in the add dialog, and the derivation of
stock from movements rather than a stored column.

---

## UC-29: View the product ledger — ⚠️

**Actor:** Warehouse staff / Management · **Goal:** See the full IN/OUT history of an article in pairs
**Screen:** Stock → Product Ledger (also a Reports tab, UC-38)

- **Debit (IN)** = pairs added — production and sale returns
- **Credit (OUT)** = pairs sold

**Filters:** date range (from/to) · company/vendor · article or category
**Views:** overall · by month · by day
Selecting an article shows its full details alongside the ledger.

**Data:** reads `stock_movements`, `articles`, `article_colors`, `product_categories`, `vendors`.
**Rework:** exists as tabs inside the Stock page with no filters.

---

## UC-30: View vendor stock — ❌

**Actor:** Purchase staff / Warehouse staff
**Goal:** See what raw material is on hand, broken down by the vendor it came from
**Screen:** Stock → Vendor Stock (third sub-page alongside Current Stock and Product Ledger)

**Steps:**
1. The page lists, per vendor, each material bought from them with its unit and current quantity
   on hand — purchases in, minus purchase returns and consumption.
2. Selecting a vendor's stock line allows the user to **reduce its quantity** — recording that this
   much material has been used. The user enters the quantity used and optional remarks; the
   reduction is logged as its own movement, so the history stays complete.

**How this differs from the two neighbouring screens:** Current Stock (UC-28) is finished articles
in **pairs**, with no vendor breakdown. Vendor Report (UC-33) is purchase and payment totals in
**rupees**. This page is raw materials in **material units**, per vendor.

**Data:** reads and writes `vendor_stock_movements`; reads `vendors`, `materials`.

---

# REPORTS

> Reports live in one **Reports** sidebar section with a **top bar acting as tabs**. Each report has
> its own filters below the tabs. The active tab is highlighted; switching tabs loads that report
> with its default filter. **Every report offers Print, Export as PDF and Export as Excel.**
> All reports are read-only.

## UC-31: Sale Analysis — ❌

**Filters:** Group by **Customer Wise** / **Region Wise** · Time: **Overall** / **By Month** /
**Between Two Dates**

**Shows:** Total Sales · Sale Returns · Payment Received (debit/credit breakdown)

Region Wise groups by region first, then breaks each region down by customer.

**Data:** reads `sale_bills`, `sale_returns`, `receipts`, `customers`, `regions`.

---

## UC-32: Sale Report — ❌

**Filters:** Time: Overall / By Month / Between Two Dates · Group by: Customer Wise / Region Wise

| Column | Meaning |
|---|---|
| Total Sales Amount | Gross total of all sale bills |
| Total Cartons | Total cartons sold |
| **Commission** | **Total commission given at payment time** — from Receipts, **not** sale-time discounts |
| Sale Return | Total value of returns (0 if none) |
| Net Sales | Total Sales − Commission − Sale Return |
| Payment | Amount paid by customers |

> The Commission column is the one place this report is easy to get wrong. It sums
> `receipts.commission`. Sale-time D% and invoice discounts are already inside each bill's net
> value and are **not** counted again here.

**Data:** reads `sale_bills`, `sale_returns`, `receipts`, `customers`, `regions`.

---

## UC-33: Vendor Report — ❌

**Filters:** Vendor (dropdown) · Between two dates

| Column | Meaning |
|---|---|
| Vendor / Supplier | Vendor name |
| Total Purchase | Total purchased from this vendor |
| Purchase Return | Total value returned to them |
| Net Purchase | Total Purchase − Purchase Return |
| Payment Paid | Amount actually paid to them |

Purchases and returns come from the purchase documents via `vendor_id`; **Payment Paid comes from
Expense entries against that vendor's linked business account** (UC-08, UC-26), plus any cheques
endorsed to them (UC-27). The `vendors.ba_id` link is what allows all four columns to sit on one row.

A standard ledger view (opening balance, debit, credit, running balance) is also available per vendor.

**Data:** reads `purchases`, `purchase_returns`, `expenses`, `cheque_allocations`,
`ledger_entries`, `vendors`.

---

## UC-34: Payment Trail — ❌

**Filters:** From date → To date

| Account | What the amount means |
|---|---|
| Business Running Expenses | Total spent running the business |
| Cash at Banks | Total held in bank accounts over the range |
| Directors Expenses – Drawings | Total spent by directors |
| Employees | Total spent on employees (salaries etc.) |
| Vendors – Suppliers | Total paid to vendors/suppliers |

Footer shows the **Grand Total** across all accounts.
The two restricted categories are hidden entirely from `USER`-role sessions (UC-03), and the grand
total they see excludes them.

**Data:** reads `expenses`, `business_accounts`, `chart_of_accounts`.

---

## UC-35: Account Ledger (Khaata) — ⚠️

**Actor:** Accountant / Management · **Goal:** Full transaction history for one customer account
**Filters:** Account (searchable) · Between two dates, or overall

**Header:** Code · Title · Print date & time · Date range · **Opening Balance** (top right, before
the first transaction)

| Column | Notes |
|---|---|
| Date | |
| **Inv #** | System invoice number |
| **Bill #** | Manual bill number |
| **Narration** | For CASH/ONLINE: free text from the receipt's remarks. For CHEQUE: splits into three sub-columns — **Cheque No**, **Date on Cheque**, **Cheque Received Date** |
| Pairs | Sale and return rows only; **blank on payment rows** |
| Debit | Amount coming in |
| Credit | Amount going out |
| Balance | Running: `previous + debit − credit` |

**Row sources:**

| Source | Side | Narration |
|---|---|---|
| Sale Bill | **Debit** | "SAME" or the delivery address |
| Sale Return | **Credit** | "SAME" or the delivery address |
| Receipt (Jamma) | **Credit**, shown as a **red row** | Free text / cheque details from remarks |
| Commission | **Credit**, its own separate row | From the same receipt |

Only payment rows are red. Footer shows Total Debit, Total Credit and Closing Balance.

**Data:** reads `ledger_entries`, `sale_bills`, `sale_returns`, `receipts`, `business_accounts`.
**Rework:** currently computed client-side by filtering arrays, with no Inv#/Bill# columns, no
cheque sub-columns and no commission row.

---

## UC-36: Business Accounts Ledger — ✅

**Filters:** All accounts or a specific account · Between two dates · View mode: Summary / Detail / Customer
**Shows:** Code, Description, Main Account, City.
**Data:** reads `ledger_entries`, `business_accounts`, `chart_of_accounts`.

---

## UC-37: Cash Book of the Day — ⚠️

**Actor:** Accountant · **Goal:** See all cash in and out for a day or month
**Filters:** a specific **date** or a **month**

| Column |
|---|
| No. · Account Name · Remarks · Type (CASH/CHEQUE/ONLINE) · Cheque No. |
| Receipts Cheq./Online · Payments Cheq./Online · Receipts Cash · Payments Cash |

A totals row sums all four amount columns.

**Summary box (bottom left):**

| Label | Meaning |
|---|---|
| Opening Cash | Cash at the start of the day |
| Cash Received (Jamma) | Total cash received that day |
| Total Cash | Opening + Received |
| Cash Paid (Naam) | Total cash paid out that day |
| **Cash In Hand** | Total Cash − Cash Paid |

**Sources:** receipts (inflows), expenses (outflows), **and cheque allocations** — an endorsed
cheque posts as an outflow on its allocation date (UC-27).

**Data:** reads `receipts`, `expenses`, `cheque_allocations`, `ledger_entries`.
**Rework:** currently reads receipts only and never expenses, so it is not actually a cash book yet.

---

## UC-38: Product Ledger (Reports tab) — ⚠️

The same report as UC-29, reachable as the eighth Reports tab.
**Filters:** Category / Company (Vendor) / Article · Between two dates, overall, by month, or by day.

---

# Cross-cutting behaviour

| Feature | Description |
|---|---|
| **Draft persistence** | Sale Bill and Sale Return auto-save incomplete entries to local storage; drafts can be resumed, loaded or deleted. |
| **Mandatory field validation** | Required fields carry a red asterisk. The Confirm button stays grey and disabled until all are filled, then turns Navy & Gold. |
| **Searchable dropdowns** | Customer, sub-customer, article, business account and vendor dropdowns all have built-in search. |
| **Record tabs** | Sale Bill, Sale Return, Receipts and Expenses each have Weekly / Monthly / Overall tabs with Edit and Print icons. |
| **A4 print layout** | Every printout uses the same Excel-style A4 layout: black-bordered cells, grid metadata header, double-underlined totals, and three signature lines (Prepared By / Checked By / Authorized Signature). |
| **Export (❌)** | Every screen with a Print button also gets **Export as PDF** and **Export as Excel**. Not implemented anywhere yet. |
| **Posting** | Ledger rows and stock rows are written on post and deleted on unpost, always inside one database transaction. |
| **Soft delete** | Setup records referenced by transactions are deactivated, never hard-deleted. |
| **Theme** | Dark navy `#111c2a` with gold `#B08D57` throughout. |

---

## Coverage summary

| Group | Total | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|
| Home & System | 5 | 1 | 1 | 3 |
| Setup | 9 | 4 | 4 | 1 |
| Accounting Setup | 3 | 1 | 2 | 0 |
| Transactions | 10 | 6 | 1 | 3 |
| Stock | 3 | 0 | 2 | 1 |
| Reports | 8 | 1 | 3 | 4 |
| **Total** | **38** | **13** | **13** | **12** |

> **Document version:** 3.0 · **System:** WentoX ERP — Footwear Wholesale Distribution
> **Source:** `architecture-v2.md` · **Data model:** `database_schema.md` v4.0
