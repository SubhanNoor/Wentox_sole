# WentoX Frontend — Milestone Plan

> Source of truth: `architecture-v2.md` (all open questions resolved as of
> this plan). **Backend has no real data yet, so this plan works entirely
> against `AppContext`'s in-memory demo data** — no API layer, no real
> auth. Everything below stays inside the existing reducer/demo-array
> pattern; wiring to a real backend is a separate, later effort (was
> "Milestone 1 — API Layer & Auth" in the earlier draft of this plan —
> **skipped for now** per explicit instruction). Role-based nav guarding
> (TASK-14) can still be built against `AppContext`'s existing fake
> `admin`/`admin` login — it just won't be backed by a real JWT/role column
> until the API layer milestone happens later.

---

## Milestone 2 — Setup Pages Rework ✅ DONE

**Goal:** Bring Setup pages in line with the resolved schema decisions
before any transaction pages depend on them.

- [x] Remove Control Accounts page/nav entirely (TASK-11)
- [x] Sub Customer: remove `customerId` requirement, flat independent list,
      searchable dropdown where sub customer is picked elsewhere (TASK-06)
- [x] New **Regions** setup page (new lookup, independent of Cities)
- [x] Customer: add Region (required, searched first) + City (secondary)
      fields; update customer search/filter UI to filter by Region first
- [x] Vendor create form: no visible "pick a group account" step — creating
      a Vendor in the reducer auto-creates a matching demo `businessAccount`
      entry under a "Vendors" group and links it, so both demo lists stay in
      sync (single form, per resolved decision; same behavior a real
      backend will need to replicate later)
- [x] Customer page redesign — card-based view + per-customer ledger,
      article-wise (TASK-08)
- [x] Home/landing page — logo + company name, entry point (TASK-13)
- [x] Verify: creating a Vendor, then finding it in an Expense account
      picker under "Vendors" group, resolves to the same vendor

---

## Milestone 3 — Transactions ✅ DONE

**Goal:** Add the missing transaction types and extend existing ones per
the resolved decisions.

- [x] **Purchase page (new)** — vendor, product, unit, weight, price/unit,
      multi-line entry (TASK-01); raw-material purchase, does NOT feed
      `Product.stock` (scope corrected in Milestone 4 below) — includes
      inline vendor creation with region assignment, added mid-cycle
- [x] **Purchase Return page (new)** — mirrors Sale Return exactly
- [x] Sale Bill: auto-fill Main A/C from selected customer, warn if missing
      (TASK-05)
- [x] Sale Return: add "products previously bought by this customer"
      dropdown sourced from that customer's sale bills, keep manual entry
      as fallback (TASK-12)
- [x] Receipts (Jamma): add **Commission** field — payment-time only,
      shown as "Amount Due" → "After Commission" (not just netted silently)
- [x] Receipts (Jamma): add cheque fields — Cheque No, Date on Cheque,
      Cheque Received Date, status
- [x] Sale Bill / vendor payable: add **optional** `due_date` field (no
      default/global credit period — blank means no payment-overdue alert
      for that record)
- [x] Vendor payment via Expenses: when the selected Expense account's
      parent group is "Vendors", treat it as a vendor payment for Vendor
      Report purposes (UI-level distinction, no new page)
- [x] Verify: a full Purchase → Purchase Return → stock reconciliation
      cycle, and a Receipt with Commission + cheque fields showing correct
      before/after amounts

---

## Milestone 4 — Stock ✅ DONE

**Goal:** Redesign the stock views. **Scope correction (this cycle):**
Purchase (M3) was clarified to be **raw-material purchasing**, separate
from `Product.stock` (pairs) — it does NOT feed Current Stock or Product
Ledger. Production remains the only stock-in source for finished articles.
The original plan item "Purchase as a stock-in source" is dropped.

- [x] Current Stock redesign — table + expandable sub-rows, color field in
      add-stock dialog (TASK-03) — **corrected during implementation**:
      products of the same article/style code but different colors group
      into ONE row with an expandable panel showing color variants as
      sub-rows (not separate top-level rows per color)
- [x] Product Ledger — date range, vendor, article/category filters
      (TASK-02 UPDATE) — **corrected during implementation**: lives as its
      own top-level tab alongside Weekly/Monthly/Overall Production, not
      embedded inside the Current Stock expandable panel
- [x] Verify: Current Stock redesign renders correctly against existing
      Production-only stock-in data; Purchase records remain absent from
      both views (by design)

---

## Milestone 5 — Reports ✅ DONE

**Goal:** Build out the reports layer, most of which doesn't exist yet.

- [x] Account Ledger (Khaata) redesign — Inv#/Bill# columns, cheque
      narration sub-columns, Commission row (credit, same side as payment)
      (TASK-16); also restored Opening Balance display above the
      From/To date filters per follow-up correction
- [x] Cash Book of the Day redesign — opening cash, Jamma, Naam
      (incl. cheque-endorsement in/out), cash-in-hand, per cheque/online/
      cash breakdown (TASK-15) — must read both Receipts and Expenses
- [x] Sale Analysis — customer-wise / region-wise (TASK-09)
- [x] Sale Report — Total Sales, Cartons, Commission (payment-time only),
      Sale Return, Net Sales, Payment (TASK-18)
- [x] Vendor Report — Total Purchase, Purchase Return, Net Purchase,
      Payment Paid (joins Purchase-side + Expense-side for the same vendor)
      (TASK-10 / TASK-10 UPDATE)
- [x] Payment Trail — grouped by Business Running Expenses, Cash at Banks,
      Directors Expenses, Employees, Vendors-Suppliers (TASK-17)
- [x] Unified tabbed Reports sidebar section (TASK-19) — built as a single
      `ReportsHubPage.tsx` using a Content/Page component split so each
      report renders as a tab without double-nesting the app shell; also
      added a standalone Business Accounts Ledger tab (general-purpose
      ledger over all business accounts, not just customers/vendors)
- [x] Wire `BiltyUpdatePage.tsx` into the Reports nav ("Search & Bilty Adda
      Updation") — page itself needs no changes
- [x] PDF + Excel export on every page that has Print (TASK-04) — shared
      `src/lib/export.ts` helpers (`exportToPDF`, `exportRowsToExcel`)
      applied across ~13 pages/components
- [x] Verify: every report total cross-checks against Account Ledger for a
      sample date range

---

## TASK-14 — User Roles & Access Control ✅ DONE

**Goal:** Two-tier demo access — Admin (full access) vs. User (blocked from
Bank Accounts and Director Expenses - Drawings). Added mid-cycle, not part
of the original 6-milestone plan; slots in after Milestone 5 since it
touches Business Accounts setup and several report pages built there.

- [x] `UserRole` type (`'Admin' | 'User'`) added to `src/types/index.ts`
- [x] Fixed second demo login (`user`/`user`) wired into `AppContext.tsx`
      (`DEMO_USER_ACCOUNT` constant, `LOGIN`/`LOGOUT` reducer cases)
- [x] `LoginPage.tsx` — demo credentials hint updated for both accounts
- [x] `AppLayout.tsx` — sidebar footer reflects current role (avatar
      initials, name, role text); "Change Password" hidden for User role
- [x] Access restriction (`RESTRICTED_CHART_IDS = ['120002', '440001']`)
      applied in `BusinessAcSetupPage.tsx`, `PaymentTrailPage.tsx`
      (also hides the Cash at Banks row/export), and
      `BusinessLedgerContent.tsx`
- [x] Verified via `tsc -b` (clean) and dev server health check

---

## Milestone 6 — Alerts & Cheque Endorsement ✅ DONE

**Goal:** The two new features designed this cycle (`architecture-v2.md`
§12/§13). Depends on Milestones 3 and 5 (cheque fields, Cash Book) being in
place first.

- [x] Bell icon + badge in `AppLayout` header (`NotificationBell.tsx`), alerts
      computed client-side from `AppContext` state on each render plus a 60s
      interval so a cheque crossing its date lights up without a reload — the
      same derivation a future `GET /api/notifications` runs server-side
- [x] Alerts dropdown: cheque due/overdue (unconditional) + payment overdue
      (only for bills with an explicit `dueDate` **and** a positive balance),
      grouped by severity, sorted nearest-date first, click-through to the
      source record, dismiss + "Restore" action (dismissals held in
      `AppContext`, not a persisted table)
- [x] **Amber window = 7 days** before the date on the cheque; red once passed
- [x] "Dispose of Cheque" workflow — new **Cheques tab** on Receipts (Jamma)
      listing every cheque with its unallocated balance; dialog picks
      disposition / target / amount (defaults to the remaining balance) and
      **stays open while a remainder is outstanding**, so it can never be
      silently orphaned
- [x] Full `ChequeStatus` lifecycle wired: Pending → Deposited → Cleared,
      Pending → (Partially) Endorsed, and Bounced from any state
- [x] Endorsed allocations post as real Cash Book outflows on their allocation
      date (a plain `DEPOSIT` is *not* an outflow — it only moves the cheque
      to the bank), and feed Vendor Report's "Payment Paid"
- [x] Bounced-cheque cascade: reverses the customer receipt **and** every
      allocation sourced from it. **Reversal is posted as counter-entries
      dated the bounce**, not by erasing history — a Cash Book printed before
      the bounce still reconciles with the same report printed after it
- [x] Bounced receipts also excluded from Sale Analysis / Sale Report payment
      totals (they were previously counted as received)
- [x] Verified end-to-end in the browser: partial (under-match) allocation with
      enforced remainder, endorsement reaching Cash Book, bounce-after-
      endorsement reversing customer + vendor + cash book together, alert
      click-through and dismissal

**Files:** `lib/cheques.ts` (new — pure derivations, kept out of `AppContext`
so Fast Refresh still works), `components/NotificationBell.tsx` (new),
`components/ChequesTab.tsx` (new), `context/AppContext.tsx`, `types/index.ts`,
`components/AppLayout.tsx`, `pages/ReceiptsPage.tsx`,
`pages/ReportCashBookPage.tsx`, `pages/ReportKhaataPage.tsx`,
`pages/VendorReportPage.tsx`, `pages/SaleAnalysisPage.tsx`,
`pages/SaleReportPage.tsx`

### Cheque Register — RESOLVED (was "YBD")
- [x] Resolved as the **Cheques tab inside Receipts (Jamma)**
      (`components/ChequesTab.tsx`), not a standalone page or a Reports tab —
      it sits alongside where cheques are captured and where Dispose/Mark
      Cleared/Mark Bounced already act on them. Lists every cheque received
      (across all Receipts) as its own row — Cheque No, Date on Cheque,
      Received, Customer, Amount, Unallocated balance, Status — with a status
      filter (Open / All / each individual `ChequeStatus`) and a search box
      (cheque no. or customer). Status changes happen **inline** in the same
      row (Dispose / Mark Cleared / Mark Bounced), so there is no separate
      register-vs-workflow split. Print / Export PDF / Export Excel included.

---

## Sequencing Notes

- Milestone 2 blocks Milestone 3 (Purchase needs Vendor's linked account;
  Sale Bill's due-date/Commission work touches Customer).
- Milestone 3 blocks Milestone 4 (stock needs Purchase to exist) and
  Milestone 5 (reports need Purchase/Purchase Return/Commission/cheque data
  to summarize).
- Milestone 6 is last — it depends on cheque fields (M3) and a working Cash
  Book (M5) both being in place.
- All of the above is demo-data only. A later, separate milestone (the
  original "Milestone 1 — API Layer & Auth") replaces `AppContext`'s
  in-memory arrays with real backend calls once the backend exists — every
  reducer action added in M2–M6 should stay easy to swap for an API call
  later (keep action shapes close to what the eventual request/response
  bodies would look like) rather than being a throwaway prototype.
