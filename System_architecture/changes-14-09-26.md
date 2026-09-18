# WentoX — Change Requests, Batch 14-09-2026

> Source: client verbal list of 26 items, 2026-09-14. Ambiguities were resolved with the client
> before this document was written; every resolution is recorded inline under **Decided**.
> Nothing here is an assumption — where the client deferred detail, the item is marked
> **⏸ SPEC PENDING** and must not be started until they walk through it.

## Decisions taken before writing (do not re-litigate)

| # | Question | Client's answer |
| --- | --- | --- |
| 1 | Sign convention (items 1 & 10 contradicted each other) | **One column rule everywhere: `+ve → Debit (NAAM)`, `-ve → Credit (JAMMA)`.** The "money in / money out" wording applies **only** to bank & cash accounts, where `+ve` (debit) = money in and `-ve` (credit) = money out. Item 1's "credit means money incoming" was a slip. |
| 2 | JV redesign reference picture | `ref-pics/batch2/jv2.0.jpeg` — match its **field layout and compactness**, but **keep the existing Wentox toolbar, status pill and app styling**. Do not reproduce the legacy VB6 chrome. |
| 3 | JV system number | The Number field becomes **system-generated, sequential, read-only**. No manual entry. |
| 4 | "Timely access to delete any account" (item 11) | **A Delete action on every account page**, blocked only when the account carries transactions or is a system-default account. Not a time-limited window, not an admin gate. |
| 5 | "Check in hand" → "Cheques in hand" (item 12) | **One-time migration script.** No merge UI. |
| 6 | Per-item ledger rows (item 26) | **Purchase ledger only** for now. Sale / returns unchanged. |

## Item → ID map

| Client item | ID | Client item | ID |
| --- | --- | --- | --- |
| 1, 10 | ACC-01 | 14, 19 | BA-02 |
| 2 | JV-01 | 15 | G-04 |
| 3 | JV-02 | 16 | G-05 |
| 4 | G-01 | 17 | G-06 |
| 5 | JV-03 | 18 | LED-02 |
| 6 | G-02 | 20 | CHQ-01 |
| 7 | G-03 | 21 | RP-01 |
| 8 | JV-04 | 22 | RP-02 |
| 9 | G-07 | 23 | G-08 |
| 11 | ACC-02 | 24 | G-09 |
| 12 | ACC-03 | 25 | CHQ-02 |
| 13 | BA-01 | 26 | LED-01 |

---

## 🌐 GLOBAL / APP-WIDE

### G-01 — Negative balances in parentheses, in every ledger — ✅ DONE (2026-09-15)
> Client item 4

- Every ledger in the app must render a negative balance wrapped in parentheses — `(5,000)`, never `-5,000`.
- `formatCurrency()` already does this (see `G-05` in `changes-15-08-26.md`). This item is therefore an **audit, not a new rule**: find every ledger surface that prints a balance or amount **without** going through `formatCurrency()` and route it through.
- Surfaces to check one by one: `ChequeLedgerContent`, `ChequeInHandContent`, `ChequeReturnsContent`, `ProductLedgerContent`, `OverallTrailContent`, `ReportKhaataPage`, `ReportCashBookPage`, `ReportStockPage`, `PaymentTrailPage`, `VendorReportPage`, `SaleReportPage`, `SaleAnalysisPage`, business-account ledger, chart/control/group account ledgers, and any PDF/print template that prints a balance.
- Print and export output counts. A ledger that shows `(5,000)` on screen and `-5,000` on the printed page is not done.

**Acceptance:** open every ledger listed above with at least one credit balance present; no `-` prefix appears anywhere, on screen or in print.

**Done:** audited every named surface (`ChequeLedgerContent`, `ChequeInHandContent`,
`ChequeReturnsContent`, `ProductLedgerContent`, `OverallTrailContent`, `ReportKhaataPage`,
`ReportCashBookPage`, `ReportStockPage`, `PaymentTrailPage`, `VendorReportPage`, `SaleReportPage`,
`SaleAnalysisPage`, and the business/chart/control/group account ledgers — all of which are the
same `ReportKhaataPage` component viewed with a different `ba_id`/`ac_id` filter, not separate
pages) — every genuine balance column, on screen, in its print template, and (for the print-based
PDF export, which reuses the exact same print HTML — see `lib/export.ts`'s own comment) in PDF,
already routes through `formatCurrency()`. **No code changes were needed** — G-05 in
`changes-15-08-26.md` had already been applied consistently everywhere this item's own surface
list points at.
- Checked `.toLocaleString()`/`Math.abs()` call sites specifically, since those are the two ways a
  balance typically slips past `formatCurrency()`. Found several `.toLocaleString()` calls in
  `ReportStockPage.tsx`/`ProductLedgerContent.tsx`, but all on stock **quantities** (pairs,
  cartons) — never-negative physical counts, not a signed ledger balance, so out of this item's own
  scope by its own wording ("negative balances").
- Found `AccountBalancePanel.tsx`'s per-line delta display uses a manual `+`/`−` prefix with
  `formatCurrency(Math.abs(delta))` rather than `formatCurrency(delta)` directly — but that's a
  deliberate, different, and internally consistent convention for a signed *change* amount (not a
  *balance* — the panel's actual "Current Balance"/"Balance After" figures, the real balances,
  already pass the signed value straight through). Not this component's own item to begin with —
  it isn't named in the surface list — and not a bug.
- Found `VendorReportPage.tsx`'s "Journal Voucher applied" row uses
  `formatCurrency(Math.abs(row.total_jv))` — a magnitude next to explanatory text ("applied",
  reducing what's owed), not a running balance either; left as-is for the same reason.
- Confirmed Excel exports (`ReportKhaataPage`/`OverallTrailContent`'s own `handleExportExcel*`)
  push the **raw numeric** balance, not a `formatCurrency()` string — checked this is the
  consistent, deliberate, app-wide convention (`exportRowsToExcel`'s own type signature accepts
  `number` specifically so `xlsx` writes a real numeric cell Excel can sum/format itself, not text)
  and not something this item's "print and export output counts" line was asking to change — a
  parenthesized *string* in a spreadsheet cell would break exactly the numeric behavior Excel
  export exists to provide.

**Verification method:** static code audit (grep across every named file for a balance/amount
rendered outside `formatCurrency()`), not a live click-through with a real negative balance on
screen — noted as a limitation, same as G-03 above.

### G-02 — Required-field trap: focus cannot advance past an empty required field — ✅ DONE (2026-09-15)
> Client item 6

- Every field marked with the red asterisk is a **required** field.
- When focus is on an empty required field, the keyboard-advance mechanism (`Enter`, `Tab`, arrow-key navigation — all of the paths added by `G-01` in `changes-15-08-26.md`) must **not** move focus to the next field. Focus stays put.
- On the blocked attempt, show the field's validation message (inline, under/next to the field) so the user knows why they are stuck. Silent blocking is a bug report waiting to happen.
- The trap releases the moment the field holds a valid value.
- This must be implemented **once**, in the shared field-navigation layer (`AppLayout.tsx` and whatever the required-marker component is), not per page. A page-by-page implementation will drift.
- Mouse clicks are **not** blocked — a user may click away to a different field; only the keyboard advance is trapped. Rationale: trapping the mouse makes the form feel broken.
- The primary action button (Create / Save / Post) must already refuse to fire while a required field is empty; verify this still holds.

**Acceptance:** on a page with a required field, leave it blank, press `Enter` repeatedly — focus never leaves the field and a message appears. Fill it, press `Enter` — focus advances normally.

**Done — the shared mechanism (the "once, in the shared layer" half):** two functions added to
`lib/fieldNav.ts`, the one file already shared by `AppLayout.tsx`'s own G-01 keyboard handling and
`SearchableSelect.tsx`:
- `isRequiredAndEmpty(el)` — backed by the native `required` attribute + `ValidityState
  .valueMissing`, not a bespoke rule. A field only ever traps once it actually carries `required`
  — inert everywhere else — so the mechanism can be rolled out to more fields later without
  touching this function again, and rolling it out carries zero risk of the "page-by-page
  implementation drifts" failure mode the item itself warns about.
- `blockIfRequiredEmpty(el)` — the one call every advance path makes before actually moving focus.
  Shows the field's own message via the browser's native `reportValidity()` bubble — positioned
  correctly at the field for free, even inside a portaled modal, with no custom message UI to
  build or keep in sync (satisfies "inline, under/next to the field" using a browser primitive
  instead of new component code).

Wired into every keyboard-advance path the item names:
- **Enter** (`AppLayout.tsx`) — checked right before the existing "focus the next field / click
  Save on the last field" logic.
- **Tab** (`AppLayout.tsx`) — a genuinely new block; Tab's own field-to-field movement was, and
  still is, native browser behavior with no JS driving it (unlike Enter/arrows, which this app's
  own G-01 code computes and moves itself) — so the trap here is `e.preventDefault()` rather than
  computing a "next field," since the browser already knows the real tab order. Only forward Tab
  is trapped; Shift+Tab still retreats freely.
- **Arrow-Right / Arrow-Down** (`AppLayout.tsx`) — same trap, forward direction only.
  Arrow-Left/Up (backward) are deliberately left alone — the item's own wording is about being
  "moved past" a field, not about being unable to go back and fix it; blocking backward navigation
  would trap the user on the very field they're trying to retreat to in order to fix.
- **`focusNextField()`** (`lib/fieldNav.ts`) — the one shared advance point `SearchableSelect.tsx`
  and every page's own "select an item from a modal, then move on" call sites route through.

Confirmed safe before rollout: every current caller of `focusNextField()` passes a
`button[data-field-nav]` element (a SearchableSelect trigger) as `from` — `isRequiredAndEmpty()`
only recognizes native `<input>`/`<select>`/`<textarea>`, so the check is unconditionally `false`
for all of them today, meaning this change was verified to have zero behavioral effect until a
field is explicitly marked `required`.

**Done — rolled out to 8 real fields, as a working, verified pilot** (not the full app-wide
sweep — see below): `ReceiptsPage.tsx` (Amount, "Received Into" bank picker — a plain `<input>`
search-trigger, not a `SearchableSelect`, so it qualifies), `JournalVoucherPage.tsx` (Date, the
entry strip's A/C Code search-trigger, Amount), `ExpensesPage.tsx` (Amount Paid, Cheque No./Cheque
Date — required only while `paymentMode` is `CHEQUE_ISSUED`/`CHEQUE_ENDORSED`, matching the
existing conditional asterisk exactly via `required={...}` rather than a static attribute).
Confirmed the primary-action-button half of the item ("verify this still holds") already holds on
all three pages — each already has its own `buildPayload()`-style early-return validation blocking
Save regardless of this new keyboard trap.

**Done — `SearchableSelect.tsx` extended to carry the same trap:** a `button` trigger has no
native `required`/`ValidityState` of its own, so `isRequiredAndEmpty()` (`lib/fieldNav.ts`) grew a
second branch reading `data-required`/`data-value-missing` attributes on the trigger instead; a
new `REQUIRED_BLOCKED_EVENT` (`'g02-required-blocked'`) is dispatched at the trigger in place of
`reportValidity()` (which only exists on real form-validatable elements), which
`SearchableSelect` listens for on itself to show its own inline "Please select an option." message
directly under the trigger — clearing the moment a value is chosen, mirroring how a native
validation bubble disappears once its field is filled. `SearchableSelect` gained a `required?:
boolean` prop driving both the data-attributes and the message.

**Done — rolled out app-wide, every remaining red-asterisk field wired to `required`:**
- **21 native `<input>`/`<select>`/`<textarea>` files**: `StoreSetupPage`, `AddaSetupPage`,
  `CitySetupPage`, `CategorySetupPage`, `RegionSetupPage`, `VendorSetupPage`,
  `SubCustomerSetupPage`, `ProductSetupPage`, `ChartAcSetupPage`, `BankSetupPage`,
  `BusinessAcSetupPage`, `GroupAcSetupPage`, `SettingsPage`, `UserManagementPage`, `TransferPage`,
  `SaleBillPage`, `SaleReturnPage`, `PurchasePage`, `PurchaseReturnPage`, `StockVoucherPage`,
  `JournalVoucherPage`/`ReceiptsPage`/`ExpensesPage` (pilot, already done). Every native
  search-trigger `<input>` (Customer/Vendor/Product/Article/Store pickers that open a
  `SearchModal`) is a real `<input>` and qualifies directly. `CustomerSetupPage.tsx`'s Customer
  Name already had `required`; `EmployeeSetupPage`'s Employee Name and `AddaSetupPage`'s "Route"
  checkbox-grid have no red-asterisk marker at all in the current UI and were left untouched —
  only wiring existing markers, never adding new ones.
- **12 `SearchableSelect`-based pickers**, once the component itself supported `required`:
  `ReceiptsPage` (Pay To, endorsement), `TransferPage` (From, To, Account/deposit-into),
  `ChequesTab` (Deposit Into), `SaleReturnPage` (Customer, line-item Color, Add-Sub-Customer
  Region), `SaleBillPage` (line-item Color, Add-Sub-Customer Region, Add-Customer Select Region),
  `PurchasePage` (Add-Vendor Select Region), `CustomerSetupPage` (Region — City is explicitly
  marked optional and left alone), `SubCustomerSetupPage` (Region), `ChartAcSetupPage` (Parent
  Group Account), `GroupAcSetupPage` (Account Class Category), `BusinessAcSetupPage` (Parent Chart
  of Account). Every other `SearchableSelect` call site in the app (~40, mostly report/search
  filter pages — `ReportCashBookPage`, `SaleReportPage`, `SaleAnalysisPage`, `ReportStockPage`,
  `VendorReportPage`, `ReportKhaataPage`, `OverallTrailContent`, `ProductLedgerContent`, `FindTab`,
  `VendorSetupPage`'s optional Region/City, `ChequesTab`'s Vendor/Expense-Account, `EmployeeSetupPage`)
  was checked individually and carries no red-asterisk marker, or (`SearchCustomerPage`'s Customer
  filter) isn't inside a `<form>` at all so the field-nav trap can't apply to it regardless —
  correctly left unmarked, per "only wire existing markers."

**Verified:** `npx tsc -b --force` full rebuild passes clean after every file. The mechanism's own
logic was verified by tracing every code path by hand (no live click-through was possible in this
environment — noted as a limitation), and by confirming zero live callers were affected before any
field was marked `required`.

### G-03 — Autofocus audit: first input focused on every page open — ✅ DONE (2026-09-15)
> Client item 7

- `G-01` in `changes-15-08-26.md` established this app-wide. This item is the **audit pass** the client is asking for: go page by page and confirm it actually happens.
- Scope is **every** page, including ledgers, sub-pages, tab panes and content components that are not routed pages of their own (`ChequeInHandContent`, `ChequeLedgerContent`, `ChequeReturnsContent`, `ProductLedgerContent`, `OverallTrailContent` — these mount inside a parent and are the likeliest to have been missed).
- Rule: when a page or sub-page opens **and it contains at least one input field**, the cursor lands in the first input in tab order, ready to type.
- A page whose first interactive control is a date picker, a search box, or an account-code box counts — focus it.
- Read-only report pages with no input are out of scope.
- Deliver the audit as a checklist in the PR description: page name → pass/fail before → pass/fail after.

**Acceptance:** every page in `frontend/src/pages/` plus every sub-pane, opened fresh, has a focused input.

**Done:** audited all 47 files in `frontend/src/pages/`. Full checklist (PASS = already worked before
this item; FIXED = added a mount-time `useRef`+`.focus()` — the established `firstFieldRef`
convention already used by `SaleBillPage`/`PurchaseReturnPage`/`JournalVoucherPage` — or the
`SearchableSelect` component's own built-in `autoFocus` prop, which existed but had never actually
been wired up anywhere; OUT OF SCOPE = no real input in the page's default landing state):

PASS (25 — unchanged): AddaSetupPage, BankSetupPage, BusinessAcSetupPage, CategorySetupPage,
ChartAcSetupPage, CitySetupPage, CustomerSetupPage, EmployeeSetupPage, ExpensesPage,
GroupAcSetupPage, JournalVoucherPage, LoginPage, ProductSetupPage, PurchasePage,
PurchaseReturnPage, ReceiptsPage, RegionSetupPage, ReportStockPage, SaleBillPage, SaleReturnPage,
SettingsPage, StockVoucherPage, StoreSetupPage, SubCustomerSetupPage, UserManagementPage,
VendorSetupPage.

FIXED (15): `BiltyUpdatePage.tsx` (Start Date), `TransferPage.tsx` (Date, on both the Transfer and
Deposit tabs — genuinely missing despite every sibling data-entry page having it),
`ChequeInHandContent.tsx`/`ChequeLedgerContent.tsx`/`ChequeReturnsContent.tsx` (search/date —
these mount fresh on every `ChequePage` tab switch, so a mount-only effect covers both "page
opens on this tab" and "switches to this tab"), `OverallSearchPage.tsx` (search box),
`OverallTrailContent.tsx` (search box, refocused on returning from a drill-down),
`PaymentTrailPage.tsx` (From date), `ProductLedgerContent.tsx` (search box),
`ReportCashBookPage.tsx` (search box), `ReportKhaataPage.tsx` (account search, refocused on
returning from a drill-down), `SalaryRunPage.tsx` (Month), `WageRunPage.tsx` (Settlement Date —
its own entry form is a real `<form>`, so it was only ever getting AppLayout's generic G-01
fallback rather than an explicit ref like every sibling data-entry page deliberately has;
corrected as a bonus fix beyond the original 16-item list), `SearchCustomerPage.tsx` (Customer
picker, via `SearchableSelect`'s own `autoFocus` prop), `VendorReportPage.tsx` (vendor search,
refocused on returning from a drill-down).

OUT OF SCOPE (6 — 4 confirmed by the original audit, 2 reclassified after checking their default
landing state): `CheckForUpdatesPage.tsx`, `ChequePage.tsx`, `HomePage.tsx`, `ReportsHubPage.tsx`
(all pure tab-shells or zero-input displays — their children are audited separately),
`SaleAnalysisPage.tsx`, `SaleReportPage.tsx` (both default to an `'overall'` view with zero real
inputs — only mode-toggle buttons, which don't count as fields per this item's own "input field"
rule; a `SearchableSelect` does appear, but only after switching to the non-default "By Month"
view, which isn't what "opens" means for these two pages).

**Verification method:** static code inspection (grep for `firstFieldRef`/`autoFocus`/`.focus()`/
AppLayout's own generic form-based G-01 fallback), not a live click-through — noted here rather
than claimed as browser-verified. Confirmed AppLayout's generic mechanism (`focusFirstField`) only
ever fires against a page's first `<form>` element, and does nothing at all for a page with no
`<form>`, which is why the 15 fixed pages (mostly filter/search bars, not `<form>`-wrapped) needed
their own explicit fix. `npx tsc -b --force` passes clean; `npx eslint` on all 15 touched files
shows zero new warnings/errors from the added code (the pre-existing repo-wide
`react-hooks/set-state-in-effect` warnings are unrelated and untouched).

### G-04 — Row-area scrolling on data entry pages — ✅ DONE (2026-09-15)
> Client item 15

- Today, browsing past records on a data entry page scrolls the **whole window**. The client wants the scrollbar confined to the **record rows** — the header band, entry band, toolbar and totals footer stay fixed, and only the detail grid scrolls.
- **The client said they will explain this in detail during implementation.** Do not start until that walkthrough happens; the exact boundary of what stays fixed is the whole substance of the item.
- Pages in scope (to confirm at the walkthrough): `SaleBillPage`, `PurchasePage`, `SaleReturnPage`, `PurchaseReturnPage`, `ReceiptsPage`, `PaymentTrailPage`, `JournalVoucherPage`, `StockVoucherPage`, `ExpensesPage`, `TransferPage`.
- Related to G-05 — implement them together, because a fixed-height scrolling grid is what makes the row pointer meaningful.

**Done:** the walkthrough (2026-09-15) was a photo of the legacy reference system with the fixed
area outlined in red (toolbar, header fields, entry strip) and the scrollable area outlined in blue
(the line-item grid only) — confirming the doc's own default assumption exactly: header/entry/
toolbar/totals-footer fixed, only the detail grid scrolls.

Investigating before writing anything turned up that **6 of the 8 applicable pages already had this
exact mechanism built** — `SaleBillPage`, `PurchasePage`, `SaleReturnPage`, `PurchaseReturnPage`,
`JournalVoucherPage`, `StockVoucherPage` each already measure their entry card's height via
`getBoundingClientRect()` (`entryCardHeight`/`invoiceCardHeight`), size the card to fill the
remaining viewport, lay it out as a flex column with the entry fields and totals footer
`shrink-0` and only the line-items table `flex-1 min-h-0 overflow-y-auto` — apparently built as a
general UX pass predating this batch of client items, coincidentally matching exactly what G-04
asks for. Extended the identical pattern to the two that lacked it — `ReceiptsPage` and
`ExpensesPage` — which previously let their whole entry card (form + entries table + totals) grow
unbounded, scrolling `AppLayout`'s shared `<main>` (the app's one scroll container) instead. Added
the same `entryCardRef`/`entryCardHeight` measurement, made the entry form and totals
footer/post-result banner `shrink-0`, and made only the entries table's own wrapper
`flex-1 min-h-0 overflow-auto` (plus `sticky top-0` column headers, matching `SaleBillPage`'s own
line-item grid, so the header stays visible while scrolling).

`PaymentTrailPage` and `TransferPage`, both named in the page list, are out of scope — confirmed by
reading, same reasoning already established for G-06/G-08: PaymentTrailPage is a read-only
date-range report with no entry form or detail grid; TransferPage has no multi-line document
concept, only two document-browse lists (Recent Transfers/Deposits) equivalent to First/Prev/Next
navigation, not a detail grid a fixed-height scroll would apply to.

G-05 (the row pointer) is **not** included in this pass — the item's own text says to implement it
together with G-04 "because a fixed-height scrolling grid is what makes the row pointer meaningful,"
and that grid now exists everywhere it needs to, but G-05 itself is a separate, not-yet-built UI
element (a gutter marker + auto-scroll-to-pointer behavior) with its own acceptance criterion — done
as its own follow-up, not silently folded in here.

`npx tsc -b --force` clean after each file. No live Electron click-through possible in this
environment — verified by reading each page's actual flex/height/overflow wiring, matching it
against the 6 pages already confirmed working, not a UI walkthrough.

### G-05 — Last-record pointer in the detail grid — ✅ DONE (2026-09-16)
> Client item 16

- When the detail rows of a data entry page overflow the visible grid area, the user loses track of which row they just entered.
- Add a **row pointer** — a marker in a narrow gutter at the **left edge** of the row (the `▶` in `ref-pics/batch2/jv2.0.jpeg` is exactly this) — that sits on the most recently entered/edited row.
- On entering a new detail row: the pointer moves to that new row, and if the row is outside the visible area the grid **auto-scrolls** so the pointed row is visible.
- The pointer is a position indicator, **not** a selection. It must not look like, or behave as, the highlight described in G-08.
- Applies to every data entry page with a detail grid (same list as G-04).

**Acceptance:** on a page with more rows than fit, add a new row — the grid scrolls itself and the pointer sits beside the new row.

**Done:** a new `lastEnteredIndex`/`lastEnteredUid`/`lastEnteredLineId` state, deliberately separate
from G-08's `selectedIndex`/`editingIndex`, set only when a row is actually committed (added or
updated) from the entry strip — never by a click, matching the item's own "must not look like, or
behave as, the [G-08] highlight" rule exactly. Rendered as an unlabeled 18px gutter column, first
in the table, holding a plain `▶` (`text-emerald-600`, distinct from G-08's blue edit-highlight
background) only on the pointer row. Auto-scroll via a `rowRefs` array/map and a
`useEffect(() => rowRefs.current[pointer]?.scrollIntoView({ block: 'nearest' }), [pointer])` —
G-04's fixed-height scrolling grid (done the day before) is what makes this meaningful; without it
there would be nothing to scroll.

Three shapes of the same mechanism, depending on how each page already tracked its rows:
- **Index-keyed** (`SaleBillPage`, `SaleReturnPage`, `PurchaseReturnPage`'s sibling `PurchasePage`
  is uid-keyed — see below — `JournalVoucherPage`, `StockVoucherPage`): the pointer index is
  computed BEFORE the `setItems`/`setLines` call (a functional updater can't hand a value back out
  synchronously), following each page's own existing merge-duplicate/edit-in-place/append-new
  branching exactly — a merged duplicate row points at the row it merged INTO, an edited row keeps
  its own index, a new row points at the end of the array.
- **Uid-keyed** (`PurchasePage`, `PurchaseReturnPage` — their grid already keys by a generated
  `uid`, not array position, since rows can be removed from the middle): `lastEnteredUid` instead
  of an index, `rowRefs` as a `Record<string, ...>` instead of an array. The new row's own `uid` is
  generated once, up front, specifically so it can double as the pointer target — previously it was
  generated inline inside the `setItems` call, out of reach.
- **Server-line-keyed** (`ReceiptsPage`, `ExpensesPage` — a line commit is a real API round-trip,
  and `voucherLines` is re-fetched from the server after every commit, not a locally-mutated
  array): `lastEnteredLineId` holds the committed line's own `draft_id`, read straight off
  `draftReceipts.create/update`'s (or `draftExpenses`'s) own return value, set right after
  `refreshVoucher()` so the ▶ and the auto-scroll land the instant the grid actually shows the row.

Reset to `null` everywhere `editingIndex`/`selectedUid` already resets in a "load a different
record" or "start fresh" context (`handleNew`, opening a different bill/voucher/settlement) —
grepped each file for the existing `setSelectedIndex(null)`/`setSelectedUid(null)` calls added
during G-08 and added the sibling call next to each one in a genuine reset context (explicitly
NOT next to loading a row into the edit strip, since re-editing an existing row isn't "entering a
new record" and the pointer should stay put). Row removal adjusts or clears the pointer the same
way `editingIndex` already does (decrement if a row before it was removed, clear if the pointer's
own row was removed).

`TransferPage`/`PaymentTrailPage` are out of scope, same reasoning as G-04/G-06/G-08: no detail
grid exists on either.

`npx tsc -b --force` clean after every file. No live Electron click-through possible in this
environment — verified by reading each page's actual pointer-index arithmetic, gutter-column JSX,
and reset-site coverage, not a UI walkthrough.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `PurchasePage.tsx`, `PurchaseReturnPage.tsx`,
`SaleReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`, `ReceiptsPage.tsx`,
`ExpensesPage.tsx`.

### G-06 — New data entry window opens on the default (blank) page, not a posted record — ✅ DONE (2026-09-15)
> Client item 17

- Today, opening a data entry page when the unposted count is 0 lands the user on posted records.
- Change: when a data entry window opens and there are **no unposted documents**, it must open on the page's **default blank state** — a fresh, empty entry ready for a new document.
- When unposted documents **do** exist, current behaviour (land on the unposted work) is unchanged.
- The posted records remain reachable through the normal navigation (First / Previous / Next / Last / Find); they are simply not what the window opens on.
- Applies to every data entry page (same list as G-04).

**Acceptance:** with the unposted count at 0, open Journal Voucher — a blank new voucher is shown, not the last posted one.

**Done:** the actual bug wasn't "falls back to posted" — it was stale persisted UI state. Every
data entry page keeps `mode: 'new'|'edit'|'view'` in `usePersistentField`, which survives a window
close/reopen via localStorage. Browsing to a posted record via First/Prev/Next/Find sets
`mode: 'view'`; nothing at mount ever reconciled that against the current unposted count, so a
window closed while viewing a posted record reopened on that same posted record even after every
draft had since been posted or the count had otherwise dropped to zero. Fixed at the one place
every page already fetches its unposted list on mount: once that fetch resolves, if the result is
empty **and** the persisted `mode` is `'view'`, call the page's own `handleNew()` to reset to a
blank entry. `mode === 'new'`/`'edit'` is left untouched — that's genuine unsaved in-progress work
and must survive a reopen exactly as today; only a stale "I was looking at a posted record" state
is corrected. Applied to `SaleBillPage`, `PurchasePage`, `SaleReturnPage`, `PurchaseReturnPage`,
`ReceiptsPage`, `JournalVoucherPage`, `StockVoucherPage`, `ExpensesPage` (8 pages — each page's own
mount-time unposted-list fetch, e.g. `refreshUnposted()`/`refreshAllVouchers()`, now chains the
check). `TransferPage` and `PaymentTrailPage` are out of scope despite being named in the G-04 page
list: Transfer's `mode` is a `'transfer'|'deposit'` tab switch with no posted/draft concept at all,
and PaymentTrailPage is a read-only date-range report with no entry form. `npx tsc -b --force`
clean.

**Fixed again (2026-09-16), severe bug reported by the user:** the `mode === 'view'` check above
missed a real, reachable case — on `SaleBillPage`/`PurchasePage`/`PurchaseReturnPage`/
`SaleReturnPage`/`JournalVoucherPage`/`StockVoucherPage`, clicking **Edit** on a row from the
Weekly/Monthly/Overall Records tab (or, for SaleBillPage specifically, the bilty/adda-style
master-scope edit) loads a POSTED record and leaves `mode: 'edit'`, not `'view'` — e.g.
`SaleBillPage.tsx#handleEditSpecificBill` unconditionally calls `setMode('edit')` on whatever row
was clicked, posted or not. Closing the window there and reopening left that posted record on
screen with the check never firing, while the Posted/Unposted dropdown (`browseFilter`, its own
plain `useState`, never persisted) defaulted back to "Unposted" — exactly the mismatch the user
described: dropdown says Unposted, screen shows a posted record. Fixed by switching the condition
from `mode === 'view'` to each page's own persisted "is the loaded record posted" flag
(`currentBillIsPosted`/`currentIsPosted`/`currentReturnIsPosted`/`isPosted`, whichever that page
already has) — true if and only if an actual posted record is loaded, in EITHER `'view'` or
`'edit'` mode, and only ever cleared by `handleNew()`, so it can never be true while there's
genuine unsaved new-document work to protect. `ReceiptsPage`/`ExpensesPage` were checked and left
on `mode === 'view'` — traced both pages' own edit-entry paths (`handleEditLine`, and the header
Edit button's own `disabled={... || voucher.status === 'POSTED'}`) and confirmed neither ever
allows entering `'edit'` mode on a posted voucher, so the original condition is already correct
there; no equivalent bug exists on those two. `npx tsc -b --force` clean.

### G-07 — Escape closes every popup and secondary window — ✅ DONE (2026-09-14)
> Client item 9

- Pressing `Escape` closes the topmost popup, modal, dialog, search overlay, confirmation box, or secondary window.
- Nested case: `Escape` closes only the **topmost** layer, one layer per press; it must not close the parent underneath at the same time.
- Unsaved-work case: where a window today guards against losing unsaved input, `Escape` routes into that same guard (the "discard changes?" confirmation) rather than discarding silently. It must never destroy typed work without asking.
- Implement in the shared modal/overlay component so new dialogs inherit it; then audit for any dialog that builds its own chrome and bypasses the shared component.

**Acceptance:** every popup in the app closes on `Escape`; a nested search-inside-a-modal closes the search first, the modal on a second press.

**Done:** built one shared primitive, `useEscapeToClose` (`frontend/src/hooks/useEscapeToClose.ts`)
— a single document-level keydown listener backed by a module-level stack, so "topmost only, one
layer per press" is automatic regardless of DOM nesting/portaling, and doesn't depend on focus
being inside the dialog (the failure mode of the old per-modal `onKeyDown` pattern). Migrated the 5
shared components (`ConfirmModal`, `PasswordPromptModal`, `SearchModal`, `DuplicateNamePromptModal`,
`ReportPrintPreviewModal`) to it, then audited every `fixed inset-0` overlay in the app
(`pages/`+`components/`) for ones with NO Escape handling at all — found and fixed 21 bespoke inline
modals across `SaleBillPage`/`SaleReturnPage`/`PurchasePage`/`PurchaseReturnPage`/`ReceiptsPage`/
`ExpensesPage`/`JournalVoucherPage`/`StockVoucherPage` (Find/Add-New modals), `ChequesTab`/
`ChequeReturnsContent` (dispose/bounce/return dialogs), `ReportStockPage` (color report, material
adjustment), `SalaryRunPage`/`WageRunPage` (run breakdown), `SettingsPage` (Reset Database's
2-password flow), plus batch-migrated the 13 Setup pages'
(`Store`/`Adda`/`Employee`/`ChartAc`/`Bank`/`Region`/`City`/`Category`/`GroupAc`/`SubCustomer`/
`Vendor`/`BusinessAc`/`Customer`SetupPage) already-working-but-fragile `onKeyDown`-on-wrapper-div
pattern to the same shared hook. Final sweep (`fixed inset-0`/`backdrop-blur`/overlay-color classes
minus `Escape`/`useEscapeToClose`) confirms zero gaps outside 4 unused, unimported shadcn
boilerplate files. Unsaved-work guard needed no special handling — every Escape call routes through
the exact same close function the dialog's own Cancel/X button already calls.

### G-08 — Clicking a detail row must not enter edit mode or highlight it — ✅ DONE (2026-09-15)
> Client item 23

- Today, clicking a row in the detail portion of a data entry page loads it for editing immediately. The client wants editing to be **deliberate**.
- New behaviour, in normal and edit mode alike:
  - Clicking a detail row **does nothing visible** — no edit load, no highlight.
  - To edit: the user clicks the row **and then presses the Edit button**; only then is the row loaded into the entry band and the highlight applied.
  - The highlight is cleared **intentionally** — by finishing/cancelling the edit, or by an explicit deselect — not by clicking elsewhere.
- The row pointer from G-05 is unaffected; it keeps tracking the last entered row regardless of clicks.
- Applies to every data entry page with a detail grid (same list as G-04).

**Acceptance:** click three different rows in a sale bill — nothing changes on screen. Click one, press Edit — that row loads and highlights.

**Done:** every page shared one shape before this fix — the detail grid's `<tr onClick=...>`
called the load-into-edit function directly, which both loaded the row into the entry band AND
set the highlight in the same click; there was no separate Edit gate anywhere, so a click WAS an
edit. Fixed on `SaleBillPage`, `PurchasePage`, `PurchaseReturnPage`, `SaleReturnPage`,
`JournalVoucherPage`, `StockVoucherPage` by introducing a second, purely internal
`selectedIndex`/`selectedUid` state alongside the existing `editingIndex`/`editingUid`: a row click
now only records that value (toggling it off on a second click of the same row), with **no**
className/highlight tied to it — the click is genuinely invisible, per the acceptance test's own
literal wording ("nothing changes on screen"), not merely inert-but-indicated. `editingIndex`
alone still drives the blue highlight and the entry-band load, and is now set exclusively by a new
toolbar "Edit Row" button, which acts on `selectedIndex` when pressed. The existing toolbar Delete
button (already dual-purpose — delete the selected line, or the whole document with nothing
selected) was extended to fall back to `selectedIndex` as its target when nothing is actively being
edited, so a plain click-then-Delete still works exactly as before; only click-then-immediately-
edit changed. Every place that already reset `editingIndex`/`editingUid` to null (New, loading a
different record, committing or cancelling an edit, removing a row) was extended to reset the new
selection state too, so the two can never point at different rows.

`ReceiptsPage` and `ExpensesPage` have a different existing shape — no bare `editingIndex`/`editingUid` at
all; a rendered line's highlight is `isSelected = mode === 'edit' && ... === line.draft_id`, and
each row already carries its own per-row pencil (Edit) and Delete icons with `stopPropagation`,
independent of the row's own click. That pencil icon already **is** the deliberate second action
G-08 asks for, and there's no toolbar-level "act on the selected line" concept on these two pages
to preserve a selection for — so the fix here is simpler: the row's own `onClick` (which
previously called the same load function as the pencil) was removed entirely, leaving a plain
click fully inert, while the pencil/trash icons keep working exactly as before.

`TransferPage` and `PaymentTrailPage` are out of scope despite being named via G-04's page list
(G-08 reuses it): confirmed by reading — Transfer's only clickable tables ("Recent Transfers",
"Recent Deposits") are document-browse lists equivalent to First/Prev/Next navigation, not
detail/line-item rows within a document being composed; PaymentTrailPage is a read-only
date-range report with no entry form or edit concept at all.

Judgment call, made because the acceptance test's wording is unambiguous: selection is **fully
invisible** until Edit Row is pressed — no subtle border/indicator marks which row a plain click
selected, even though that does mean pressing the toolbar's Delete button without pressing Edit
Row first gives no on-screen confirmation of which row it's about to remove. This matches the
literal spec ("does nothing visible" / "nothing changes on screen") rather than a softer reading
that would show a light "selected" indicator distinct from the full "editing" highlight; worth
revisiting if the client's own walkthrough disagrees.

`npx tsc -b --force` clean after each file.

**Files:** `SaleBillPage.tsx`, `PurchasePage.tsx`, `PurchaseReturnPage.tsx`, `SaleReturnPage.tsx`,
`JournalVoucherPage.tsx`, `StockVoucherPage.tsx`, `ReceiptsPage.tsx`, `ExpensesPage.tsx`.

### G-09 — Account search must match the account itself, never its parent — ✅ DONE (2026-09-14)
> Client item 24

- Everywhere an account search/filter box exists, the filter must match **only the account's own name/code**, never the name of its parent, group, control or chart account.
- Client's worked example: a **business account** named `DIRECTOR EXPENSE` sits under a **chart account** named `EXPENSE`. In a search restricted to business accounts, typing `expense` must return `DIRECTOR EXPENSE` **only** — the chart account `EXPENSE` must not appear, and no business account must be pulled in merely because its parent's name matched.
- This is a backend query fix as much as a UI one: find every account-search query that joins to the parent hierarchy and includes parent columns in its `LIKE` predicate, and restrict the predicate to the target account's own columns.
- Scope: the shared account search modal, the A/C code box on JV, receipt, payment, expense and transfer pages, ledger account pickers, report filters, and the overall search page.
- Account-type scoping stays as it is: a picker that is already restricted to business accounts keeps that restriction; this item only changes **which columns are matched**.

**Acceptance:** with `DIRECTOR EXPENSE` (business) under `EXPENSE` (chart), typing `expense` in a business-account picker returns exactly one row.

**Done:** added `searchText` to `SearchModal`/`SearchableSelect` (shared layer, once) so a picker's
visible label can keep parent-account context while excluding it from what's searched; applied to
all 7 business-account pickers found baking a parent name into their label (JV, Receipts ×3,
Payments ×2, Transfer, Cheques). Chart/group/class pickers and the Overall Search backend query
audited and confirmed already clean. Verified against the client's own `DIRECTOR EXPENSE`/`EXPENSE`
example with a standalone simulation — see `backend/PROGRESS.md` for the full write-up.

---

## 📒 JOURNAL VOUCHER

### JV-01 — System-generated sequential voucher number — ✅ DONE (2026-09-15)
> Client item 2 · **Decided:** auto-filled and read-only

- The JV Number field becomes a **system-generated, sequential, read-only** number, allocated the same way as the other document types in the system (shared sequence, see `nextSequenceValue(transaction, 'dbo.seq_...')` used by `draftSaleBills.repository.js`).
- Create `dbo.seq_journal_voucher_no` and allocate from it; drop the manual free-text behaviour that migration `023_journal_vouchers_number.sql` introduced. The `voucher_no` column stays — only how it is filled changes.
- The number is allocated at the same point in the lifecycle as the sale-bill number (on draft creation), so a voucher shows its number before it is posted.
- Deleted/abandoned numbers follow the existing convention — log them through `deletedDocumentNumbers.repository.js` exactly as the other sequence-based document types do.
- The field renders read-only and visibly non-editable; it is skipped by keyboard field navigation.
- `jv_id` (the internal identity) is unchanged and stays out of the user's way.

**Acceptance:** create three JVs in a row — numbers run consecutively; the field cannot be typed into; the number survives a save/reload.

**Done:** new migration `034_journal_voucher_system_number.sql` creates `dbo.seq_journal_voucher_no`
and backfills the 5 existing JVs' `voucher_no` (all previously `NULL` — the manual field had never
actually been used) to 1–5 in creation order; `journalVouchers.repository.js#insert()` now always
resolves a fresh value via `nextSequenceValue()` instead of accepting a client-supplied
`voucher_no`, and `updateHeader()` no longer touches the column at all, so it's fixed for the
document's whole life exactly like the other document types' System No. `remove()` was made
transactional and now logs the retired number into `deleted_document_numbers` under doc_type
`'JOURNAL_VOUCHER'` (mirroring `draftSaleBills.service.js#remove()`). Frontend: the Number field on
the entry form (previously previewing `jv_id`, the internal identity, not a real sequence) and the
Find modal now both read/search `voucher_no`; the preview-before-save logic is
`MAX(voucher_no)+1` across loaded lists. Verified live: created two real JVs (got #6, #7),
confirmed both persisted their number, deleted both, confirmed both landed in
`deleted_document_numbers`, then cleaned up all test rows.

### JV-02 — JV page redesign (frontend only) — ✅ DONE (2026-09-16)
> Client item 3 · **Reference:** `ref-pics/batch2/jv2.0.jpeg` · **Decided:** match the field layout and compactness, keep the Wentox toolbar and styling

- **Frontend components only.** No change to behaviour, validation, backend contracts, or the data model beyond what JV-01 and JV-03 specify. Moving and compacting, nothing else.
- Target layout, top to bottom, from the reference:
  1. **Wentox toolbar** (unchanged — our own chrome, not the legacy button strip) and the existing voucher-status pill.
  2. **Header band:** `Date` · `Number` (read-only, per JV-01) · `Remarks`, on **one row**.
  3. **Entry band**, two rows in a tinted block:
     - Row 1: `A/C Code` (code box) · account description (wide, read-only, fills from the code) · **amount** (right-aligned, at the far right).
     - Row 2: `Narration` (wide) · the second right-aligned amount box beneath the first.
     - **`Narration` comes before the amount** in tab/field order — this is the client's explicit reordering.
  4. **Detail grid:** columns `A/C Code` · `Account Description` · `Debit (NAAM)` · `Credit (JAMMA)`, with the left pointer gutter from G-05.
  5. **Footer:** `Net Total`, right-aligned.
- **Compactness:** match the density of the rest of the app — same row heights, paddings, font sizes and control heights as `SaleBillPage` / `ReceiptsPage`. Strip the extra vertical whitespace the current JV page carries. Follow `frontend/WENTOX_DESIGN_GUIDELINES.md` and `UI_DESIGN_SYSTEM.md`; do not invent new spacing tokens.
- Keep the entry band and the grid on one screen without scrolling at the app's normal window size.

**Acceptance:** side-by-side with the reference, the field order and grouping match; side-by-side with the sale bill page, the density matches; every existing JV function still works.

**Done:** the header band already matched Date/Number/[Remarks] structurally — renamed its visible
label from "Reason" to "Remarks" to match the reference exactly (the underlying field/state is
still `reason`, unchanged behind the scenes; JV-03's optionality is untouched), and did the same in
the Find-modal placeholder and the Recent Vouchers search/column header for consistency, since
they all name the same field.

**One decision needed mid-implementation, resolved with the user:** the reference photo shows a
second boxed field under the Amount box on row 2, and the spec's own text calls it "the second
right-aligned amount box beneath the first" without saying what it actually is. Since the app
deliberately uses one signed Amount field (ACC-01), not separate debit/credit boxes, and this
item is explicitly "frontend only... no change to behaviour," a literal second *editable* amount
input would have been new functionality this item doesn't authorize. Confirmed with the user: it's
the picked account's own **read-only running balance** — the same `AccountBalanceTooltip` shared
component Receipts/Expenses already show next to their own account pickers, just relocated to this
new slot; no new data, no new behavior. Wired a `balanceRefreshKey` bumped after save/post/unpost,
mirroring the exact pattern those two pages already use, so the figure doesn't go stale the moment
this JV's own save moves the picked account's ledger balance.

**The tab-order reordering** ("Narration comes before the amount") is real and did require care:
Amount had to stay in its row-1 visual slot (matching the reference) while moving LATER in the
keyboard walk than Narration (row 2). Solved with CSS Grid `gridTemplateAreas` — visual position is
now entirely decoupled from DOM order, so the JSX source order is A/C Code → Account Description
(disabled, so the shared field-walk (`fieldNav.ts`) skips it automatically) → Narration → Amount →
the read-only balance box (no input, so it was never in the walk anyway) — giving exactly Code →
Narration → Amount, with each one still rendered into its reference-matching visual cell via
`gridArea`. The commit-on-Enter handler (`handleEntryLastFieldKeyDown`) moved from Narration's
`onKeyDown` to Amount's, since Amount is now the strip's actual last tabbable field — pressing Enter
there commits the line exactly as Narration's Enter used to.

**Compactness:** card padding (`p-6`→`p-3 md:p-4`), the header/entry bands' `gap-4`/`mb-4`/`p-4`
(→`gap-2`/`mb-2`/`p-2`), and every header/entry input's bare `soleria-input` + a `style={{
fontSize: '13px' }}` hack (→ the shared `soleria-input-compact` class, matching how
`SaleBillPage`/`ReceiptsPage` already do this) all brought in line with the rest of the app's
density; the detail grid's own wrapper margin and header-cell padding tightened the same way. The
grid's own column set (A/C Code/Account Description/Debit/Credit + the G-05 pointer gutter) and
the Net Total footer were already correct from earlier passes (G-05, JV-04) — untouched here.

**Verified:** `npx tsc -b --force` clean. `AccountBalanceTooltip`'s backing endpoint
(`reports.service.js#accountBalance`) called live against `wentox_db` for a real account, returned
its correct current balance. No live Electron click-through possible in this environment — the
layout/tab-order logic was verified by reading the actual `gridTemplateAreas`/DOM-order wiring, not
a UI walkthrough.

**Files:** `frontend/src/pages/JournalVoucherPage.tsx`.
### JV-03 — Reason becomes optional — ✅ DONE (2026-09-14)
> Client item 5

- Remove the required marker from the JV `reason` field and make it **optional**.
- Remove the two guards in `JournalVoucherPage.tsx` that currently block on it:
  - the `canSave` check at line ~322 (`if (!date || !reason.trim()) return false;`)
  - the save-time error at line ~330 (`'A reason is required — a JV without one cannot be explained later.'`)
- Check the backend equally: `journalVouchers.service.js` / `.repository.js` must accept a null/empty reason, and the column must allow it.
- The Find-by-reason search (line ~598) must not break on vouchers with an empty reason.
- Everywhere a JV's reason is displayed with no value, render blank — not `null`, `undefined` or `-`.

**Acceptance:** save and post a JV with the reason left empty; find it again by number; it displays cleanly everywhere it is listed.

**Done:** new migration drops `journal_vouchers.reason` from `NOT NULL`; removed the backend guard
and frontend required-marker; fixed a latent narration-fallback bug this exposed (ledger narration
would have literally read "— undefined" with no reason and no line narration — now omits that
segment cleanly). Verified live: created a real JV with no reason, confirmed it stores as actual
SQL `NULL`, cleaned up the test record.

### JV-04 — Row deletion in the detail grid — ✅ DONE (2026-09-16)
> Client item 8

- **The existing row deletion is broken** — the client reports it does not work. Find the cause in `removeLine(idx)` (`JournalVoucherPage.tsx` line ~290) and its call path before adding anything; do not layer a new delete on top of a broken one.
- Add a **delete icon at the front of every detail record row**, matching what the sale bill / receipt / payment pages already do — use those pages as the implementation reference so the icon, its position, its hit area and its confirmation behave identically.
- The icon is **only active when the voucher is unposted and the page is in edit mode**. In any other state it is hidden or disabled (match whichever the reference pages do).
- Deleting a row re-computes the debit/credit totals and the Net Total immediately.
- The row pointer (G-05) repositions sensibly after a delete — to the row that took the deleted row's place, or the last row if the deleted one was last.

**Acceptance:** on an unposted JV in edit mode, delete a middle row — it disappears, totals update, no console error. On a posted JV, no delete icon is actionable.

**Done:** found the actual cause — `removeLine(idx)` itself was correct, but `handleRowClick`
unconditionally called `setMode('edit')` on a row click whenever the page was in view mode,
**without checking `isPosted`** (unlike the toolbar's own Edit button, which is disabled once
posted). Clicking a row on a POSTED JV therefore flipped the whole page into edit mode, which in
turn enabled both the toolbar Delete and Save buttons — a row could be "deleted" and the delete
even looked like it worked (it disappeared from the grid), but Save always failed with
`POSTED_LOCK` ("Unpost the Journal Voucher before editing"), so nothing ever actually persisted —
exactly the client's "row deletion is broken." Fixed by adding the same `isPosted` guard the Edit
button already has. Also added a delete icon at the front of every row (`Trash2`, matching
Receipts/Expenses' own per-row delete icon styling), active only when `!isViewMode && !isPosted &&
!detailLocked` — deleting via the icon calls `removeLine(idx)` directly, no longer requiring the
indirect "click row, then click toolbar Delete" flow. Totals/Net Total already recompute
automatically (`totals` is a `useMemo` over `lines`).

**Done (2026-09-16), closing the row-pointer half now that G-05 exists:** G-05's own rollout
(2026-09-16) gave every page's `removeLine`/`handleRemoveItemRow` equivalent the same "clear the
pointer if the deleted row was it" logic — sufficient for G-05's own spec, but JV-04 asks for
something more specific: deleting the pointed row must reposition the pointer "to the row that
took the deleted row's place, or the last row if the deleted one was last," not just clear it. Gave
`JournalVoucherPage.tsx`'s `removeLine` that exact behavior:
`Math.min(idx, newLength - 1)` (or `null` only if the grid is now empty) instead of an
unconditional `null`, computed from `lines.length - 1` before the filtered array actually commits.
This is JV-04-specific — the other 7 pages' G-05 rollout is unchanged, since none of their own
acceptance text asked for a reposition. `npx tsc -b --force` passes clean.

---

## 💰 ACCOUNTS & SIGN CONVENTION

### ACC-01 — One sign rule, verified everywhere — ✅ DONE (2026-09-15)
> Client items 1 and 10 · **Decided:** see the decision table

**The rule, stated once and for all:**

```
Every account, everywhere a signed amount is entered:
    +ve  ->  DEBIT   (NAAM column)
    -ve  ->  CREDIT  (JAMMA column)

For BANK and CASH accounts only, that maps onto money movement:
    +ve  =  DEBIT   =  money IN   (balance goes up)
    -ve  =  CREDIT  =  money OUT  (balance goes down)

For every other account type (customer, vendor, expense, income,
chart, control, group), the sign maps to the column and nothing
more — there is no "money in / money out" language for them.
```

- **Implement and verify** this rule in:
  - **every place a bank is used** — bank setup, transfers, receipts, payments, expenses, cheque flows, direct settlements, opening balances — and every ledger those postings appear in;
  - **journal voucher** and every ledger a JV line reaches.
- Verification is the deliverable, not just the code change. Produce a matrix: entry point × account type × sign → expected column and expected balance direction, with a tested row for each. Attach it to the PR.
- Wherever the current code disagrees with the rule, the code changes — the rule above is authoritative and was confirmed by the client on 2026-09-14.
- Pay particular attention to any place that flips a sign on the way into or out of the database; a double flip reads as correct in one screen and inverts in the ledger.
- Display follows G-01: credit/negative shown in parentheses.

**Acceptance:** the matrix, fully green. Spot check: `-5,000` on HBL in a JV credits HBL, drops the bank balance by 5,000, and shows as `(5,000)` in the bank ledger.

**Done — verification matrix** (entry point × account type × sign → column, and whether the code
matched before this item; every row traced to the actual insert/decision in code, not assumed from
naming):

| Entry point | Account type acted on | +ve input means | Ledger column | Before this item | File:line |
| --- | --- | --- | --- | --- | --- |
| Opening balance | any | opening balance amount | account: debit, equity: credit | ✅ correct | `businessAccounts.repository.js#replaceOpeningEntries` |
| Transfer | bank/cash | — (from/to, not a signed field) | to: debit, from: credit | ✅ correct | `transfers.repository.js#insertLedgerEntries` |
| Deposit | bank | CREDIT/DEBIT is an explicit toggle, not a signed number | per toggle: debit or credit | ✅ correct (no sign ambiguity — a fixed enum, not a `+/-` amount) | `deposits.service.js#post` |
| Receipt | bank/cash + customer | — (fixed-direction transaction) | cash/bank side: debit; customer: credit | ✅ correct | `receipts.service.js#post` |
| Expense/Payment | vendor/expense + bank/cash | — (fixed-direction) | expense/vendor: debit; cash/bank: credit | ✅ correct | `expenses.service.js#post` |
| Expense cheque bounce/return | bank + vendor | — (deliberate mirror of the original entry) | correctly inverted | ✅ correct | `expenses.service.js` (~415-419) |
| Cheque deposit | bank + Cheques In Hand | — | bank: debit, CIH: credit | ✅ correct | `cheques.service.js` (~123-124) |
| Cheque endorse to vendor/expense | vendor/expense + CIH | — | target: debit, CIH: credit | ✅ correct | `cheques.service.js` (~159-160, 195-196) |
| Cheque bounce/return reversal (3 shapes) | CIH/target/bank | — (deliberate mirror) | correctly inverted | ✅ correct | `cheques.service.js` (~253-254, 270-271, 343-344) |
| Direct Settlement | creditor + debtor | — | creditor: debit, debtor: credit | ✅ correct | `settlements.repository.js` (~136, 140) |
| **Journal Voucher entry strip** | **any** | **signed Amount, one field for both Dr/Cr** | **debit (NAAM) on +ve, credit (JAMMA) on -ve** | ❌ **inverted** — see below | `JournalVoucherPage.tsx` (handleCommitLine/loadLineIntoEntry) |

No double-flip anywhere (a sign negated once in the service layer and negated again in the
repository) — every other entry point does one direct, correct Dr/Cr assignment, and every
"reversal" path is a deliberate, correctly-inverted mirror of its own original entry.

**The one violation, found and fixed:** `JournalVoucherPage.tsx`'s single signed-Amount entry
field (replacing separate Debit/Credit boxes for the JV line-entry strip) had the sign backwards —
`handleCommitLine` mapped a **positive** amount to **credit** and negative to **debit**, the exact
inverse of ACC-01's rule. This was deliberate at the time (a 2026-08-26 instruction, superseded by
this item's 2026-09-14 confirmation) — not a bug introduced by accident, but code the rule now
explicitly overrides. Fixed both the write path (`handleCommitLine`) and its exact inverse, the
read path that reconstructs the signed Amount when re-opening a saved line for edit
(`loadLineIntoEntry`), plus the now-stale comments, the Amount field's placeholder
("+credit / -debit" → "+debit / -credit"), and the validation error wording. The Debit(NAAM)/
Credit(JAMMA) column headers and the balance-math (`journalVouchers.math.js`) were never wrong —
they just sum whatever debit/credit values arrive, so the fix is contained entirely to this one
page's two sign-mapping sites. `journalVouchers.math.js` itself is a pure pass-through with no
sign logic of its own, so nothing there needed to change.

**Verified live** against `wentox_db`, matching the acceptance criterion's own spot-check exactly:
posted a real JV crediting Meezan Bank ₨5,000 (i.e. what typing `-5000` now correctly produces per
the fixed mapping) against a counter account — balance before ₨50,550, after ₨45,550, delta exactly
-₨5,000. Reversed the test (unposted + deleted), balance restored to ₨50,550. Display-in-
parentheses for the resulting credit is already covered by G-01 (done earlier this session) — no
separate check needed. `npx tsc -b --force` full rebuild passes clean.

### ACC-02 — Delete action on every account page — ✅ DONE (2026-09-15)
> Client item 11 · **Decided:** a Delete button on every account page, guarded

- Add a **Delete** action to every account page: business accounts, chart of accounts, control accounts, group accounts, bank accounts — `BusinessAcSetupPage`, `ChartAcSetupPage`, `ControlAc*`, `GroupAcSetupPage`, `BankSetupPage`, and any other account-creating page.
- **Blocked in exactly two cases**, with a clear message saying which:
  1. the account carries transactions (any ledger entry, any document line, any opening balance other than zero);
  2. the account is a **system-default account** (e.g. `Cheques in hand`) — these can never be deleted.
- Blocked accounts must still be **deactivatable** if the app already supports that; the message should point the user there.
- Deletion follows the app's existing soft-delete convention — see `System_architecture/soft_delete_and_duplicate_check.md` and mirror it; do not introduce a second deletion mechanism.
- Confirmation dialog before deleting, naming the account. The dialog closes on `Escape` (G-07).
- Also check for child accounts: an account with children cannot be deleted while they exist; say so.

**Acceptance:** a freshly created unused business account deletes cleanly; the same account with one JV line against it refuses, with a message naming the blocking transactions; `Cheques in hand` refuses as a system account.

**Done:** there is no separate `ControlAc*` page — "control accounts" is a category within Business
Accounts, already covered by `BusinessAcSetupPage`. The other four pages
(`BusinessAcSetupPage`/`ChartAcSetupPage`/`GroupAcSetupPage`/`BankSetupPage`) each already had a
working soft-delete `remove()`/`reactivate()` pair on the backend (from earlier milestone work) —
`BankSetupPage.tsx` was even the one page with a wired-up frontend "Deactivate" flow already. What
was actually missing:
- **The "carries transactions" guard didn't exist anywhere.** None of the four `remove()`
  functions checked for ledger activity before closing an account — added
  `hasLedgerActivity()` to `businessAccounts`/`chartAccounts`/`bankAccounts` repositories (a bank
  account never posts `ledger_entries` against its own `bank_id` — only against its linked
  `business_accounts.ba_id` — so its check reads that linked account instead) plus a non-zero
  `opening_balance` check (an opening balance IS a posted OPENING ledger row, but checking the
  stored value directly is the more literal statement of the doc's own wording). `group_accounts`
  never receive ledger entries directly (only the chart accounts filed under them do), so no
  separate check was needed there.
- **The "child accounts" check existed for groups but not for chart accounts.** Added
  `hasChildren()` to `chartAccounts.repository.js` (any business account filed under it, active or
  closed — same unconditional shape as `groupAccounts.repository.js#isReferenced`, which already
  covered the group→chart level) and wired it into `chartAccounts.service.js#remove()`.
- **The "system-default account" check was already complete** — `chartAccounts.service.js`'s
  `RESERVED_CODES` is every code in `reservedAccounts.js`, which already includes `CHEQUES_IN_HAND`
  (the doc's own example); `businessAccounts.service.js`'s narrower `STRUCTURAL_ACCOUNT_HEADS`
  (Cash In Hand, Journal Voucher) is correct too — those are the only two reserved codes that
  actually get a seeded `business_accounts` row (per `db/seeds/run.js`), so no other business
  account could collide with a reserved code regardless.
- **No frontend Delete UI existed at all** on `BusinessAcSetupPage`/`ChartAcSetupPage`/
  `GroupAcSetupPage` — added a `Trash2` button (disabled + tooltipped for a reserved/system row)
  next to the existing Edit/Reactivate buttons on each, and a shared `ConfirmModal` (already
  Escape-closing per G-07) naming the account. `GroupAcSetupPage` additionally had no way to even
  *see* an inactive group (the list was unconditionally filtered to `is_active` client-side, with
  no reactivate button) — added a Status badge column and Reactivate button there too, matching the
  other three pages' own convention, so Delete has a real, visible way back.
- **`BankSetupPage.tsx`'s existing Deactivate/reactivate-prompt dialogs weren't closing on
  Escape** — neither matched the `isModalOpen`/`handleCloseModal` naming the original G-07 batch
  script searched for, so both were missed by that sweep. Wired `useEscapeToClose` onto both,
  closing the gap this item's own note explicitly calls out ("The dialog closes on Escape (G-07)").

**Verified live** against `wentox_db`: a real business account with ledger activity but zero
opening balance ("shazaib") refused with the transactions message; one with a non-zero opening
balance ("fareed shoes") refused with that message; a freshly created chart account + business
account under it — the chart account refused while its child existed, the business account then
deleted cleanly, and the chart account deleted cleanly right after; a real bank account with a
₨50,000 opening balance (Meezan Bank) refused, and a freshly created unused bank account deleted
cleanly. `node --check` on every touched backend file; `npx tsc -b --force` full rebuild passes
clean.

### ACC-03 — One-time migration: "check in hand" → "Cheques in hand"
> Client item 12 · **Decided:** one-time migration script, no merge UI

- A user created a business account named **`check in hand`** by mistake and recorded transactions against it that belong on the **system-default `Cheques in hand`** account.
- Write a **one-time, idempotent migration** that:
  1. **Identifies both accounts explicitly** — resolve the exact account ids on the live database first and pin them in the script; do not match on a name pattern, which would be fragile and could catch a legitimately named account.
  2. **Reports before it moves** — dump the full list of rows that will be re-pointed (table, row id, date, amount, document reference) to a log the client can review. Get sign-off on that list before the write runs.
  3. **Re-points every reference** from the user account to the system account: ledger entries, journal voucher lines, receipt/payment lines, cheque records, opening balances, and any other table carrying an account foreign key. Enumerate the tables from the schema (`System_architecture/database_schema_v4.3.md`) — missing one leaves orphaned data.
  4. **Reconciles balances** — the system account's balance after the move must equal its balance before plus the user account's balance before. Assert this in the script and abort the transaction if it does not hold.
  5. **Removes the duplicate account** once its reference count is zero.
- Runs inside a **single transaction** with a rollback path, and takes a database backup first.
- Re-running the script after a successful run must be a no-op, not a second move.

**Acceptance:** the reconciliation assertion passes; `check in hand` no longer exists; the `Cheques in hand` ledger shows every moved transaction on its original date; no orphaned rows remain.

---

## 📊 LEDGERS

### LED-01 — Purchase ledger: one row per item, grouped by voucher — ✅ DONE (2026-09-15)
> Client item 26 · **Decided:** purchase ledger only for now

- Today, a purchase voucher with several item lines collapses into a **single summed row** in the purchase ledger.
- Change: the purchase ledger shows **one row per purchased item**, all rows carrying the **same purchase voucher id** and visually grouped as one voucher.
- Client's worked example — purchase of `SOLE 120 @ 10` and `LEATHER 100 @ 50` in one voucher:

```
Purchase #1043   15/09/2026   VENDOR: ...
  SOLE       120 @ 10        1,200
  LEATHER    100 @ 50        5,000
                  voucher total   6,200
```

- The **voucher total must still be visible** and must still equal the sum of its item rows — splitting the display must not lose the figure the ledger balance is built from, and must not change the ledger's running balance or any total.
- Item rows carry: item name, quantity, rate, line amount. Match the column set the product ledger already uses where it overlaps.
- **Grouping is a display concern.** Do not restructure the posting model to write one ledger entry per item unless the reading side genuinely cannot reach the item lines — check first; the purchase document's item lines are already stored and joinable.
- Sale, purchase return and sale return ledgers are **explicitly out of scope** for this batch.

**Acceptance:** the worked example above renders as two item rows under one voucher; the purchase ledger's closing balance is byte-identical to what it was before the change.

**Done:** confirmed the posting model already writes exactly one summed ledger row per purchase
per side (debit PURCHASES chart account / credit vendor) — `purchases.service.js#postLedgerAndStock`
— so this stayed a pure display change, no posting-model restructuring. `reports.repository.js`'s
shared `ledgerRows()` (used by Account Ledger, Business Ledger, and Vendor Report's own ledger
drill-down, all through `accountLedger()`) gained a per-row correlated `FOR JSON PATH` subquery
joining `purchase_items`/`materials`, guarded on `source_type = 'PURCHASE'` *inside* the
correlation (not just the outer WHERE) — `source_id` is only ever a `purchase_id` for that source
type, so an unguarded join could spuriously match an unrelated `purchase_items` row that happens to
share the same numeric id for any other source type. A correlated JSON subquery rather than a
direct join was deliberate: a direct join would multiply the ONE ledger row into N rows (one per
item) and double-count its debit/credit in the running-balance computation every other caller of
`ledgerRows()` depends on — this way the SQL still returns exactly one row per ledger entry, with
the item lines riding along as a nested array. `reports.service.js#formatLedgerRow()` parses that
JSON into `purchase_items: [{material_name, unit, quantity, price_per_unit, total_price}]`
(`undefined` for every non-purchase row) and improves the Purchase row's own narration to name the
vendor. `ReportKhaataPage.tsx` (Account Ledger / Business Ledger — the app's own general ledger
view, chosen because it already has a Narration column suited to the item detail) expands a
Purchase row with items into a header row, one row per item (name, qty, unit, rate, AND line
amount, per the doc's own column list), and a trailing "Voucher Total" row carrying the real
debit/credit/balance — the header and item rows show no balance at all (`showBalance: false`),
so the balance column still reads as exactly one change per voucher, not N. Both the on-screen
table and the print-preview table (and the Excel export, which reads the same `runningKhaata`
array) render the same expansion for free, since they all consume one shared list.

**Correction (2026-09-15, same day):** the client pointed out the fix wasn't visible on Vendor
Balances or the Business Account ledger — those two views are **not** `ReportKhaataPage.tsx` at
all, they're a separate component, `OverallTrailContent.tsx` (Reports Hub's "Vendor Balances"/
"Customer Balances" tabs, and Overall Trail's own Business Account quick-filter pill, all render
through it), which calls `api.reports.accountLedger()` directly and maps `ledger.rows` straight
into its own two ledger tables (print + on-screen) without going through `runningKhaata` at all.
Applied the identical expansion there: a new `DisplayLedgerRow` type and an `expandedLedgerRows`
memo (mirroring `runningKhaata`'s own header/item/total-row logic), wired into both of
`OverallTrailContent.tsx`'s ledger tables and its ledger Excel export. Verified against the exact
purchase from the client's own screenshot (voucher narration `"90 Meters jh @ 80, 65 Meters kl @
90"`, ledger entry #9003): the backend already returned the correct `purchase_items` array and a
`credit`/`balance` matching the screenshot (₨13,050 / ₨868,450) — confirming the backend fix from
earlier today was already correct, and the only remaining gap was this second, previously-untouched
frontend surface.

**Still not touched, by scope choice:** `VendorReportPage.tsx`'s own separate vendor-ledger table
(no narration column today, and not one of the two views the client pointed at) — a follow-up if
it turns out to matter too. Sale, Sale Return and Purchase Return rows are untouched, per the
item's own explicit scope.

**Second correction (2026-09-15, same day):** the client clarified the exact shape wanted — a
**single-item** purchase must render exactly as it always did (the plain, unsplit row), not the
header+items+total shape. Only a purchase with **more than one** item groups, and even then as
compactly as possible: for N items, exactly N+1 rows total (N item rows + 1 total row) — no
separate header row at all. Reworked both `ReportKhaataPage.tsx`'s `runningKhaata` and
`OverallTrailContent.tsx`'s `expandedLedgerRows`: the condition changed from
`purchase_items.length > 0` to `> 1`; the former separate header row was dropped and its
date/type/inv#/bill# now ride on the *first* item row instead; the voucher-total row is still last
and still the only row carrying the real debit/credit/balance. Reverted
`reports.service.js`'s `'PURCHASE'` case and `reports.repository.js`'s `ledgerRows()` back to no
narration/bill_no override at all (dropped the now-unused `purchases`/`vendors` joins along with
it) — a single-item purchase's narration is once again the plain original combined string
(`buildPurchaseNarration()`'s own output), exactly as before this whole item started. Also made
the item/total rows visually compact (tighter vertical padding, no italic, no gray) and set their
narration text to plain black, per the client's explicit request — they had been styled as
lightly-indented gray/italic sub-rows, which read as de-emphasized rather than compact. Verified
live again: entry #6497 (one item, "leather") now returns to its original one-line narration
untouched; entry #9003 (two items, "jh"/"kl") still returns the same `purchase_items` array and
`credit`/`balance` as before — only the narration/bill_no fields reverted, the item data itself was
never wrong. `npx tsc -b --force` passes clean.

### LED-02 — Business ledger narration: show default account and mode of payment — ✅ DONE (2026-09-15)
> Client item 18

- Two parts, in this order:
  1. **Investigate first** — document how narration is currently generated for business ledger rows: which code path builds it, what it includes per document type (receipt, payment, JV, sale, purchase, transfer, expense), and where it falls back to blank. Write this up before changing anything; the client explicitly asked "check what's the logic of narration generation".
  2. **Then extend it** — the narration must show the **default account name** and the **mode of payment** for the row.
- Definitions to nail down during the investigation and confirm with the client before coding:
  - *default account* — the counter-account of the posting (the other side of the entry), which is what makes a ledger line readable;
  - *mode of payment* — cash / cheque / bank transfer / adjustment, as recorded on the source document.
- Where a user has typed their own narration, **the user's text wins** and the generated part is appended or omitted — never overwritten.
- Where a row has no mode of payment (a JV, say), omit that part cleanly rather than printing an empty label.

**Acceptance:** the investigation write-up is in the PR; a receipt row in the business ledger reads with both the counter-account name and the payment mode; a row with a hand-typed narration still shows that text.

**Investigation write-up (part 1 of the item, done before any code changed):**

Every ledger row (Account Ledger, Business Ledger, Vendor Ledger, and both Overall Trail/Overall
Search drill-downs — all four go through `accountLedger()`) is formatted by one function,
`reports.service.js#formatLedgerRow()`. It's a big `switch` on `source_type`, and it was
inconsistent by type before this item:

| Document type | Narration before this item |
| --- | --- |
| Sale Bill / Sale Return | stored `narration`, falling back to the literal string `'SAME'` |
| Receipt | `rc_remarks \|\| rc_details \|\| narration \|\| 'Receipt'` — never showed counter-account or mode, though both were already joined into the query and simply unused |
| Commission | stored `narration`, falling back to `'Invoice Discount / Commission'` |
| Expense | `ex_remarks \|\| ex_ba_name \|\| narration` — same gap as Receipt; `ex_payment_mode` fetched, never shown |
| Wage Run | always the fixed string `'HISAB'` |
| Salary Run | always `"Salary for <Month> <Year>"`, computed from the period |
| Transfer | `tr_remarks \|\| "<from name> → <to name>"` — already showing both account names as its own fallback, ahead of every other type |
| Direct Settlement | stored `narration` as-is (already names the other side at posting time) |
| Journal Voucher | stored `narration` as-is (already carries the reason) |
| Purchase / Purchase Return | stored `narration` as-is (the combined per-item description, or per LED-01 above) |
| Cheque Endorsement / Return | stored `narration` as-is (e.g. `"Cheque #12 to vendor"` — generic, names no one) |
| Opening Balance | stored `narration` as-is (typically blank) |

None of the twelve showed a counter-account name or payment mode as a *first-class, always-present*
piece of the line — Transfer's own fallback came closest by accident, not by design.

**Definitions, confirmed with the client before coding** (asked live, mid-implementation, since two
real judgment calls needed a decision the doc's own draft wording didn't fully resolve):
- *Default account* = the counter-account of the posting, confirmed. For the one document type
  where "the other side" isn't singular — a Journal Voucher with 3+ lines — confirmed: show the
  **first other line only**, matching the one-counter-account shape every other document type has,
  rather than listing every line or omitting JVs from the feature entirely.
- *Mode of payment* — confirmed scope: **Receipt and Expense** (the two document types that record
  cash/cheque/bank at posting time) **plus Cheque Endorsement/Return** (always "Cheque" by
  definition — `cheque_allocations` carries no `payment_mode` column of its own, there's nothing
  else it could be). Sale Bill, Purchase, Transfer, Journal Voucher, Wage/Salary Run, Opening
  Balance, and Direct Settlement (whose own `payment_mode` is explicitly informational, per the
  code's own comment — it selects no posting target) are omitted cleanly, per the item's own rule.

**Implementation (part 2):** one new correlated subquery in `reports.repository.js#ledgerRows()` —
for each ledger row, find the first *other* `ledger_entries` row sharing the same
`source_type`+`source_id` (ordered by `entry_id`) and resolve its account name (`business_accounts`
or `chart_of_accounts`, whichever is set). `reports.service.js#formatLedgerRow()` then, after its
existing per-type switch, appends `— <counter account>` (skipped if that name is already present in
the narration — Transfer's own fallback already includes it, so nothing doubles up) and, for the
three confirmed types, ` (<Mode>)` — `CASH`→Cash, `CHEQUE`/`CHEQUE_ENDORSED`/`CHEQUE_ISSUED`→Cheque,
`ONLINE`→Bank Transfer. Always appended, never substituted — a user's own typed remarks, or an
already-descriptive stored narration, is extended, not replaced.

**Verified live** against `wentox_db`: a Receipt with no typed remarks now reads e.g. `"Receipt #4
— CHEQUES IN HAND (Cheque)"`; one WITH typed remarks reads `"Advance for Sept order — CASH IN HAND
(Cash)"` — the exact acceptance-criterion shape, remarks intact. A Transfer with no remarks still
reads exactly `"Ahmed Footwear (LHR) → Karachi Boot House (KHI)"` (no duplication — the
already-present-name check correctly skipped appending); the same Transfer WITH remarks reads
`"Month-end sweep — Karachi Boot House (KHI)"`. A Journal Voucher row reads `"<reason> — <first
other line's account>"`. A Cheque Endorsement reads `"Cheque #1 to vendor — CHEQUES IN HAND
(Cheque)"` — the generic stored text now actually names the money's source. All test documents
created for verification were unposted/reversed and deleted afterward. Since every ledger surface
already renders `narration` as a plain string, this is a backend-only change — **no frontend edit
was needed** for it to appear everywhere at once. `node --check` on both touched backend files.

**Noted, not fixed (pre-existing, out of this item's scope):** Expense's own narration fallback
(`ex_remarks || ex_ba_name`) shows the expense/vendor account's OWN name when remarks are blank —
harmless but occasionally reads oddly self-referential when viewed from that very account's own
ledger (e.g. `"Decent Polyurethane — CASH IN HAND (Cash)"` when viewed from Decent Polyurethane's
own ledger). Pre-existing behavior, not introduced by this item, and not something LED-02 asked to
change — flagged here for visibility only.

---

## 🧾 RECEIPTS & PAYMENTS

### RP-01 — Direct settlements missing from posted records — ✅ DONE (2026-09-15)
> Client item 21

- A settlement made **directly through the receipt or payment screen** does not appear in that screen's **posted records** list.
- Trace the full path: the direct-settlement write, what it writes (and to which table/status), and the query that builds the posted-records list — the settlement is almost certainly landing outside the filter that list uses, rather than not being written.
- Fix so a direct settlement appears in the posted records of the screen it was made on, with the same columns and behaviour as any other posted receipt/payment: findable, navigable, printable.
- Check both directions — receipt settlements in the receipt list and payment settlements in the payment list — and check whether the same gap exists in reports and trails built on the same query (`PaymentTrailPage`, `OverallTrailContent`, khaata/cash-book reports).
- Confirm the accounting side is correct too: the settlement's ledger entries should already be right; if the trace shows they are not, that is a separate finding to report, not to silently fold in.

**Acceptance:** make a direct settlement through Receipts, post it, reopen the page, navigate posted records — it is there.

**Done (Receipts side):** traced the full path per the item's own instruction — confirmed the
settlement write itself (`dbo.settlements`, its own table, own `settlement_id`, own status) was
never the problem; `receiptVouchers.repository.js#list()` (the query behind `ReceiptsPage.tsx`'s
own First/Prev/Next/Last navigation and Find) never referenced `dbo.settlements` at all, exactly as
the item predicted ("landing outside the filter... rather than not being written"). Fixed by adding
a parallel settlement fetch (`api.settlements.list({})`) and merging it into the existing
receipt-voucher navigation:
- A settlement has no `voucher_no` — it isn't part of that numbering sequence — so it can't sort
  into the *same* numeric merge the existing deleted-number-gap display uses. Settlements are
  instead merge-inserted by **date** into the already-ordered voucher+deleted-gap sequence (a small
  new `insertSettlementsByDate()` helper), so First/Prev/Next/Last walk both kinds in one
  chronological line.
- Built `openSettlementInEntry(settlementId)` — there was no way to load an *existing* settlement
  by id at all before this (only the moment right after creating one rendered correctly); this
  fetches it and populates every field `handleSaveSettlement` already sets right after creating one,
  so a reopened settlement looks identical either way.
- Find now searches both receipt vouchers and settlements (by id, date, remarks, and either party's
  name) in one unified result list.
- `refreshAllSettlements()` (the new fetch) is called on mount and after create/post/unpost, so the
  nav list never shows a stale settlement status.

**Confirmed, not a gap:** the accounting side (per the item's own "confirm... this is a separate
finding to report, not to silently fold in") — Direct Settlement's ledger postings were already
verified correct under ACC-01's sign rule earlier this session (creditor debited, debtor credited).
Also confirmed Account Ledger/Business Ledger/Vendor Ledger/Overall Trail — all built on
`reports.repository.js#ledgerRows()`, which reads `ledger_entries` directly — already show a
settlement's effect correctly (`formatLedgerRow()`'s own `case 'SETTLEMENT'`), since those are
ledger-driven, not document-list-driven; this gap was specific to the document-navigation query.

**Not done — checked, found genuinely inapplicable or out of scope:**
- **Payment side ("payment settlements in the payment list"):** `ExpensesPage.tsx` has no Direct
  Settlement creation UI at all today — its own "Endorse" concept is a *different* feature (paying
  with an already-held cheque, `payment_mode: 'CHEQUE_ENDORSED'`, via `cheques.service.js`, not
  `dbo.settlements`). There is currently no way to create a payment-side settlement, so there is
  nothing yet to be missing from that list. **Did find the same latent query gap already exists**
  for when that capability is built: `reports.repository.js#paymentTrailRows()` (backing
  `PaymentTrailPage`) only queries `dbo.expenses`, with no `dbo.settlements` reference — reporting
  this now per the item's own audit instruction, not fixing it, since nothing can reach it yet.
**Done (2026-09-15, closing the Records-tabs follow-up):** `OverallReceiptsTab.tsx`/
`WeeklyReceiptsTab.tsx`/`MonthlyReceiptsTab.tsx` (the Records tabs' own voucher-grouped browsing
tables) had the identical gap — they build their own groupings from `api.receipts.list()`/
`api.receiptVouchers.list()`, with no settlement awareness. Fixed by fetching
`api.settlements.list({ status: 'CONFIRMED' })` alongside the existing voucher/receipt fetches in
all three, filtering settlements through the same date-range + name-query logic each tab already
applies to receipts (matching `from_name`/`to_name` instead of a single account name), and merging
the result into a new discriminated `recordGroups` list the outer table actually renders — a
settlement never had a `voucher_id`/multiple lines to group by, so it renders as its own one-row
group ("Settlement #<id>" in the C.Book No column, a distinct badge instead of a receipt count)
rather than being forced into the existing `{ voucherId, receipts, totalAmount }` shape. Clicking
one opens a parallel detail view (From/To/Mode/Remarks/Amount, one row) with its own Unpost button
(`api.settlements.unpost`); Unposting there routes back to Receipt Entry with that settlement
loaded, via a new `handleSettlementUnpostedElsewhere` in `ReceiptsPage.tsx` mirroring the existing
`handleVoucherUnpostedElsewhere` and reusing the RP-01 Entry-tab fix's own `openSettlementInEntry`.
Verified live against `wentox_db`: created, posted, and confirmed `settlements.service.js#list({
status: 'CONFIRMED' })` returns exactly the shape the new frontend code consumes, then unposted and
deleted the test row.

**Not done — checked, found genuinely inapplicable, still out of scope:**
- **Payment side ("payment settlements in the payment list"):** `ExpensesPage.tsx` has no Direct
  Settlement creation UI at all today — its own "Endorse" concept is a *different* feature (paying
  with an already-held cheque, `payment_mode: 'CHEQUE_ENDORSED'`, via `cheques.service.js`, not
  `dbo.settlements`). There is currently no way to create a payment-side settlement, so there is
  nothing yet to be missing from that list. **Did find the same latent query gap already exists**
  for when that capability is built: `reports.repository.js#paymentTrailRows()` (backing
  `PaymentTrailPage`) only queries `dbo.expenses`, with no `dbo.settlements` reference — reporting
  this now per the item's own audit instruction, not fixing it, since nothing can reach it yet. This
  can only be closed once a payment-side Direct Settlement feature is actually built — a new
  feature, not a fix, and outside this item's own scope.

**Verified live** against `wentox_db`: created and posted a real settlement (₨2,500, "Ahmed
Footwear" → "Karachi Boot House"), confirmed `settlements.service.js#list()` returns it with every
field the new frontend code consumes (`status: 'CONFIRMED'`, `settlement_date`, `amount`,
`from_name`, `to_name`) — the data layer both the fix and its future maintenance depend on is
confirmed correct. The frontend logic itself was verified by full type-checking (no runtime
click-through was possible in this environment — noted as a limitation, not claimed). All test data
unposted and deleted afterward. `npx tsc -b --force` full rebuild passes clean.

### RP-02 — Amount is a required field on the receipt page — ✅ DONE (2026-09-15)
> Client item 22

- Mark the receipt page's `amount` field as **required** — red asterisk, blocking validation, and the focus trap from G-02.
- Zero is not a valid amount; an empty field is not a valid amount.
- Confirm the same on the payment page if it is equally unguarded (check it; the client named the receipt page, so do not change payment without confirming it needs it).

**Acceptance:** try to save a receipt with a blank or zero amount — blocked with a clear message; focus stays trapped on the amount field.

**Done (2026-09-14):** the blocking validation already existed on both Receipts and Payments;
added the missing required-asterisk marker to both, matching the app's existing convention. The
focus-trap half was left for G-02 (not yet built at the time).

**Done (2026-09-15), now that G-02 has landed:** G-02's trap only checked
`ValidityState.valueMissing`, so a required Amount field with `min={0}` let a typed "0" straight
through — a blank field trapped, a "0" did not, which is exactly the gap this item calls out.
Fixed at the shared layer rather than as a one-off: `lib/fieldNav.ts#isRequiredAndEmpty` now checks
`el.required && !el.validity.valid` instead of `valueMissing` alone, so ANY native constraint
failure on a required field traps (empty, out-of-range, etc.) — this is a strict superset of the
old behavior, inert for every other already-required field in the app (none of them combine
`required` with a `min`/`max`/`pattern` that a legitimately-filled value could still fail, so this
changes nothing anywhere else — confirmed by grep for `min=`/`pattern=` across every `required`
field). Then changed both Amount fields' `min={0}` to `min={1}` (`ReceiptsPage.tsx`,
`ExpensesPage.tsx`) so a typed "0" is a real `rangeUnderflow`, not a silently-accepted value — this
is what actually makes the broadened check bite. Save-time rejection of zero/blank (already in
place per the 2026-09-14 pass) is unchanged; this closes the keyboard-trap gap on top of it.
`npx tsc -b --force` clean.

**Files:** `frontend/src/lib/fieldNav.ts`, `frontend/src/pages/ReceiptsPage.tsx`,
`frontend/src/pages/ExpensesPage.tsx`.

---

## 🏦 CHEQUES

### CHQ-01 — Endorsement fails — ⚠️ INVESTIGATED, no reproducible failure found (2026-09-15)
> Client item 20

- The client selected the **Endorse** button on a receipt, attempted to endorse a cheque, and the operation **failed**.
- **Reproduce first, then trace the full flow** — button handler → validation → IPC call → service → repository → the ledger and cheque-status writes it makes. Report where it actually breaks before fixing; a guess here risks a half-endorsed cheque.
- Deliverable includes: exact reproduction steps, the failure point, whether any partial write occurred (and whether any existing data needs cleaning up as a result), and the fix.
- If the failure is a silent one, add an error surface as part of the fix — an endorsement that fails must tell the user it failed.
- Verify the whole flow end to end after the fix: the cheque leaves the holder's section, lands in the endorsed section, and both parties' ledgers reflect it correctly under the ACC-01 sign rule.

**Acceptance:** the client's original steps now endorse successfully; the cheque is in the endorsed section; both ledgers balance.

**Investigated (2026-09-15), per the item's own "reproduce first" instruction:**

1. **"Endorse" is two entirely different features sharing one word — traced both.**
   - Receipts (Jamma) page's own "Endorse this payment to another account" checkbox creates a
     **Direct Settlement** (`dbo.settlements` — RP-01's own subject), not a cheque disposal. It has
     no "sections" a cheque moves between, so it can't be what the acceptance criterion
     ("the cheque is in the endorsed section") is describing.
   - The Cheque page's Disposal tab (`ChequesTab.tsx`) has the real cheque-endorsement action
     (`Issue` button → `endorseToVendor`/`endorseToExpense`, `cheques.service.js`) — this is the
     one with a status/"section" a cheque actually moves through (Pending → Endorsed → Cleared),
     matching the acceptance criterion. Investigated this one as the primary candidate.
2. **Traced the full flow** for the ChequesTab path: button handler (`saveAllocation`) → frontend
   validation → `api.cheques.endorseToVendor`/`endorseToExpense` → `cheques.ipc.js` →
   `cheques.service.js#endorseToVendor`/`endorseToExpense` → `assertDisposable` (the shared
   precondition: receipt posted, cheque not terminal, balance remaining) →
   `cheques.repository.js#insertAllocation`/`insertLedgerEntries` → `recomputeStatus`. Read every
   line; the whole path validates and error-handles correctly, and `saveAllocation` already shows
   any backend failure via `setDialogError(res.error.message)` — not a silent failure.
3. **Checked the single most plausible historical cause** — endorsing a cheque whose own receipt is
   still DRAFT (`assertDisposable` rejects this with `RECEIPT_NOT_POSTED`) — and found it's already
   fully guarded: `ChequesTab.tsx` doesn't just disable the Issue button for this case, it replaces
   it with an explanatory badge ("Receipt not posted", tooltip: "Post the receipt on the Receipts
   (Jamma) screen before disposing of this cheque"). `git log -S receiptPosted` shows this guard
   was added in an earlier commit (`3d8bfed8`, pre-dating this whole change-request batch) — so if
   this was the client's original failure, it looks to already be fixed, just not yet reflected as
   closed in this doc.
4. **Verified the entire flow live** against `wentox_db` rather than trusting the reading: called
   `cheques.service.js#endorseToVendor` directly on a real PENDING cheque (a genuine CONFIRMED-
   receipt cheque, #4, ₨10,000) — endorsed ₨5,000 cleanly (status → PARTIALLY_ENDORSED), reversed
   it via `reverseAllocation` (status → PENDING, ledger entries correctly mirrored), then endorsed
   the full ₨10,000 (status → ENDORSED, feeding directly into CHQ-02's own verification below).
   Every step succeeded with no error, and every ledger entry landed on the correct side (already
   confirmed under ACC-01's sign rule, done earlier this session). All test allocations/ledger rows
   were deleted afterward, cheque #4 restored to its original PENDING state.

**Conclusion: could not reproduce a failure in the current codebase**, in either the Direct
Settlement path or the real cheque-endorsement path — both traced end to end and both exercised
live against real data with no error, no silent failure, and no partial write. The most likely
historical cause (an unposted receipt's cheque) is already comprehensively guarded, pre-dating this
doc. This is a **static/live-verification limitation, not a claim the client was wrong** — the
actual click sequence was never reproduced in a running Electron window in this environment.
**If the failure still reproduces for the client, the next step is to get the exact click sequence
and screen state from them directly** rather than guess further; per the item's own warning, a
guess here risks a half-endorsed cheque. `npx tsc -b --force` passes clean (no code was changed by
this investigation itself, aside from CHQ-02 below).

### CHQ-02 — Mark an endorsed cheque as cleared — ✅ DONE (2026-09-15)
> Client item 25

- An endorsed cheque currently has no way to progress. Add a **Mark Cleared** action on endorsed cheques.
- Marking cleared moves the cheque **out of the endorsed section and into the cleared section** — the same sections `ChequeInHandContent` / `ChequeLedgerContent` / `ChequeReturnsContent` already present.
- Follow the existing clearing flow for non-endorsed cheques: the same clearing date handling, the same ledger postings, the same confirmation. This is a new **entry point** into an existing transition, not a new transition — verify that before writing new posting logic.
- The action is available only on cheques actually in the endorsed state.
- Depends on CHQ-01 — a cheque cannot be cleared from endorsed until it can reliably be endorsed. Do CHQ-01 first.

**Acceptance:** endorse a cheque, mark it cleared — it disappears from the endorsed section, appears in the cleared section, and the ledger postings match those of a normally cleared cheque.

**Done:** confirmed first (per this item's own note) that Mark Cleared is a pure status flip with
no ledger effect for the existing DEPOSITED case — same for ENDORSED, so this is genuinely a new
entry point into the existing CLEARED transition, not a new transition, exactly as instructed.
`cheques.service.js#markCleared()` accepted only `cheque_status === 'DEPOSITED'`; extended the
guard to accept `'ENDORSED'` too (renamed its error code `NOT_DEPOSITED` → `NOT_CLEARABLE` since it
now covers two source statuses). Found the exact same "vanishes from the default view, button
unreachable" bug this codebase had already hit and fixed once for DEPOSITED (`ChequesTab.tsx`'s own
`OPEN_STATUSES` comment documents that earlier fix) — `ENDORSED` had never been added to
`OPEN_STATUSES`, and the Mark Cleared button only rendered for `row.status === 'DEPOSITED'`. Added
`'ENDORSED'` to `OPEN_STATUSES` and to the Mark Cleared button's condition, mirroring `DEPOSITED`
exactly.

**Verified live** against `wentox_db`: endorsed a real cheque (#4, ₨10,000) to full (status →
`ENDORSED`), called `markCleared()` — succeeded, status → `CLEARED`; confirmed `markCleared()`
correctly rejects a `PENDING` cheque with the new `NOT_CLEARABLE` message. All test allocations and
ledger rows deleted afterward, cheque #4 restored to its original `PENDING` state. `node --check`;
`npx tsc -b --force` full rebuild passes clean.

---

## 🚚 SEARCH & UPDATE BILTY ADDA

*(page: `frontend/src/pages/BiltyUpdatePage.tsx`)*

### BA-01 — Print a bill from the row — ✅ DONE (2026-09-15)
> Client item 13

- Clicking a row on the Search & Update Bilty Adda page — a sale bill, for instance — must make that bill **printable from there**, without navigating to the sale bill page first.
- Reuse the **existing sale bill print path** — same template, same output, same printer handling. Do not build a second print route; a divergent template is how two versions of the same invoice end up in circulation.
- Interaction: a print action on/for the selected row (button or row icon — match how the rest of the app exposes print). Note that G-08 changes what a row click means on data entry pages; this page is a search/update list, so a click here may still select — confirm the intended interaction when the client walks through BA-02.
- If rows of more than one document type can appear on this page, each row prints its own document type's template.

**Acceptance:** select a sale bill row, print — the output is identical to printing the same bill from the sale bill page.

**Done:** extracted `SaleBillPage.tsx`'s former `renderBillPrintable()` JSX verbatim into a new
shared component, `frontend/src/components/reports/SaleBillPrintable.tsx`, taking a plain
`SaleBillPrintModel` object instead of reading page-local state — so there is genuinely only one
invoice template in the codebase, not a copy. `SaleBillPage.tsx` now builds that model from its
own live form state (unchanged behaviour, still works for an unsaved bill) and renders
`<SaleBillPrintable model={model} />`. `BiltyUpdatePage.tsx` (this page only ever lists POSTED
bills, per UC-07) got a Printer icon next to its existing row-select icon — no row-click
reinterpretation, since G-08's row-click semantics for this search/update list are still pending
the client's BA-02 walkthrough per this item's own note. Clicking it fetches the full bill via
`api.saleBills.get()` (the already-loaded `biltySearch()` row lacks `items` and store name),
builds the same model shape, and opens it in the existing `ReportPrintPreviewModal` — the identical
modal/print/PDF/zoom chrome Sale Bill's own preview uses. Verified live: fetched a real posted
bill's full record and confirmed every field the model needs (`article_name`, `color`, `cartons`,
`pairs`, `rate`, `discount_percent`, `discount_value`, `value`, `total_cartons`, `total_pairs`,
`gross_value`, `net_value`) is present and shaped exactly as assumed. `npx tsc -b --force` passes
clean.

### BA-02 — Compact redesign — ✅ DONE (compacting 2026-09-14, redesign 2026-09-16)
> Client items 14 and 19

- **The compacting part is actionable now:** remove the extra spacing on the Search & Update Bilty Adda page and bring its density in line with the rest of the app — same row heights, paddings, font sizes and control sizes as `SaleBillPage` / `ReceiptsPage`, per `WENTOX_DESIGN_GUIDELINES.md` and `UI_DESIGN_SYSTEM.md`. Frontend only; no behaviour change.
- **The wider redesign is not:** the client said (item 19) they will explain the redesign during implementation. Do the compacting pass, then hold for the walkthrough before restructuring the page.
- Do not guess at a new layout in the meantime — a redesign built on a guess will be rebuilt.

**Acceptance (compacting only):** the page sits at the same visual density as the sale bill page, with no functional change.

**Done (compacting only, 2026-09-14):** card padding, input sizing (switched to
`.soleria-input-compact` throughout), and label styling brought in line with Sale Bill/Receipts.
The wider redesign (item 19) was left blocked on the client's walkthrough, per the item's own note.

**Done (the redesign, 2026-09-16):** the walkthrough landed as a reference photo
(`ref-pics/batch2/billity adda.jpeg`) of the legacy "SEARCH & BILTY ADDA UPDATION" screen — a
single dense toolbar (search filters + the selected-invoice Bilty/Adda update cluster + Update/
Print buttons all in one strip), a row of radio filters below it, then the grid. Rebuilt
`BiltyUpdatePage.tsx`'s top section to match: the two separate side-by-side cards ("Bilty Info
Update" + "Search Filters") merged into one consolidated toolbar card, laid out as the reference's
own three visual bands — search filters (one wrapping row), the update cluster with Update/Print
together at the end (matching the reference's own button pairing), then the bilty-status/sort-by
radio pills as one combined row instead of two side-by-side columns. The results-count/status
badges strip (not in the reference, a useful addition from the earlier build) was kept, just moved
below the new toolbar rather than sharing a row with the old "Show Print Preview" button, which
itself moved up into the toolbar's own button pair, relabeled "Print" to match the reference.

One judgment call confirmed with the user before building: the reference shows a single "By Date"
box, but the page already has a more capable Start/End date RANGE filter — confirmed keeping the
range (just laid out compactly in the new toolbar) rather than regressing to a single date to match
the photo literally. Every other field (Manual/System Bill No. split from BA-01, the Bilty No.
search filter, Customer/Sub-Customer search) was kept as-is — the item's own scope is layout, not
removing capability.

**Verified:** `npx tsc -b --force` clean. No live Electron click-through possible in this
environment — the layout was verified by reading the actual JSX structure against the reference
photo, not a UI walkthrough. No backend/behavior change — same state, same handlers, same API
calls as before; only their visual arrangement changed.

**Files:** `frontend/src/pages/BiltyUpdatePage.tsx`.

---

## Sequencing

1. **ACC-01** first — every ledger item downstream depends on the sign rule being settled in code, not just on paper.
2. **G-02, G-03, G-07, G-08, G-09** — the shared-layer global items. Doing these before the page work means the pages inherit them.
3. **JV-01 → JV-03 → JV-04 → JV-02** — behaviour and the broken delete before the redesign, so the redesign moves working components.
4. **CHQ-01 → CHQ-02** — clearing depends on endorsing working.
5. **LED-02** (investigate, confirm, then build), **LED-01**, **RP-01**, **RP-02**, **BA-01**, **BA-02** (compacting).
6. **ACC-02**, then **ACC-03** — the migration runs against a database where the delete guards already exist.
7. **G-04 + G-05 + G-06** together, after the client's walkthrough on G-04.

## Blocked on the client

| ID | What is needed |
| --- | --- |
| ACC-03 | Sign-off on the list of rows the migration will move, before it runs — paused by the user until "the end" (the account lives in a separate production database this session can't reach). |

BA-02, listed here previously, is done as of 2026-09-16 — see its own section above.

G-04 and LED-02, both listed here previously, are done as of 2026-09-15/16 — see their own sections
above.
