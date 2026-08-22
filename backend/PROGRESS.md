# Wentox Backend — Progress Log

**Current milestone:** All of Milestones 1–8 are backend-complete, and Milestone 9.2 (frontend
integration) is now genuinely complete — every page in `frontend/src/pages/`/`components/` calls the
real backend (`ReportsHubPage.tsx` is the one non-data tab-router shell, not a gap). Milestone 8.2/8.3
(accounting hierarchy — Group/Chart/Business Accounts) backend was already complete; its frontend
wiring plus Module 8.1's (Cities/Regions/Stores/Addas) were the last pages still on demo data and are
now connected too (see dated entries below). Milestone 9.3's packaging/installer/auto-SQL-Server-setup
work is extensive and already fully checked off in `milestone9.md` — only three end-to-end
verification checkboxes remain open there (full continuous flow test, unpost/bounce reversal
double-check, A4 print against real data), each already partially exercised piecemeal across many
individual session entries in this log, just never done as one single continuous pass.
**Status:** SQL Server is up and `wentox_db` migrated + seeded. Milestone 1 code-complete and its migrate/seed scripts verified working end-to-end (including live `auth:login`/`requireSession` checks). Milestone 2: **Modules 2.1 and 2.2 both complete and verified end-to-end** (create/post/unpost, ledger + stock direction, drafts, password re-verification guard, and the `status`-column removal / `due_date` addition). Milestone 3: **Modules 3.1 and 3.2 both complete and verified end-to-end** (create with material auto-registration, post/unpost, drafts with zero vendor-stock effect until confirmed, no password guard). Milestone 6: **Modules 6.1, 6.2, and 6.3 all complete and verified end-to-end** (Product Details/`articles`, Categories, Vendors with auto-linked business account). Milestone 7: **Modules 7.2 and 7.3 complete and verified end-to-end** (Customers mirroring Vendors' auto-linked-account pattern, Sub-Customers as a flat independent CRUD per UC-10, later given a required `region_id` for Sale Bill/Return dropdown filtering); **Module 7.1 moved to Milestone 4 Module 4.5** (it was never actually "blocked," `payroll.md` fully designs it). Milestone 8: **all of 8.1/8.2/8.3 complete, backend AND frontend, verified end-to-end** (see dated entries below for the frontend wiring pass — Regions/Cities/Stores/Addas, Group/Chart/Business Accounts, including the reserved-account delete guard and role-based restricted-account hiding). "Reactivate an inactive duplicate-named row instead of rejecting on create()" — implemented across every built entity — vendors (name+phone key), customers/sub-customers (name-only, never blocks on active match), regions/cities/stores/categories/addas (name-only, blocks on active match, matching their existing DB-level `UNIQUE(name)`), and products (name+vendor_id key). See `System_architecture/soft_delete_and_duplicate_check.md`. A real, first-of-its-kind **admin user-management feature** (create additional `USER`-role logins, deactivate/reactivate, admin password reset) was added on top of the original milestone scope — see dated entry below, since UC-03's role-based access had no way to actually create a second login before this.

Log every completed task here (newest first within its milestone). Format:

```
### YYYY-MM-DD — <Task name> (Milestone X, Module X.Y)
- **What:** what was built/changed
- **How:** approach, key decisions, gotchas
- **Files:** paths touched
```

---

## Navigation

### 2026-08-18 — Dropdowns: focus and type, Enter selects and moves on
- **What:** every dropdown in the app used to need a click to open before you could search it, and
  Enter parked the cursor back on the same field. Now focusing a dropdown and simply typing starts the
  search, and Enter takes the match and moves to the next field. 14 native `<select>`s were also
  converted so they behave the same way; 12 deliberately were not.
- **Two things found while reading the code, both of which shaped the fix:**
  1. **The portal defeats the existing Enter rule.** The dropdown panel renders into `document.body`,
     so from its search box `target.closest('form')` is null and AppLayout's app-wide G-01 handler
     ("Enter moves to the next field") returns before it can move anything. That is *why* Enter only
     ever closed the panel. The component has to advance focus itself.
  2. **Not every dropdown was a `SearchableSelect`** — 64 were, but 26 native `<select>`s also
     existed, split between real entry fields and small filters.
- **How:** `lib/fieldNav.ts` now holds the one definition of "the fields of this form" and "move to
  the next one". That logic was private to `AppLayout`; the dropdown needs the identical notion, and a
  second copy inside the component is exactly how the two would have drifted apart later. AppLayout
  was refactored onto it (it had the selector string duplicated twice internally, too).
  `lib/keyboard.ts` holds `isTypeAheadKey` — "is this the user typing, or a control key?". Extracted
  rather than inlined because it is three subtle guards, it is unit-testable on its own, and the
  native-select work needs the same predicate. `key.length === 1` separates printable characters from
  named keys (Tab/Enter/Escape/F1/Shift all report multi-character names); the modifier check keeps
  application shortcuts alive — **without it a focused dropdown would swallow Alt+V and search for
  "v" instead of opening Print Preview (G-09)**.
  In `SearchableSelect`: a printable key on the focused trigger opens the panel and **seeds the search
  with that character**, so the keystroke that opened it is not lost — otherwise the user ends up one
  letter short of what they typed. Space opens with an empty search rather than searching for " ",
  since it is also the conventional open-a-select key. Enter commits and advances; **a mouse click
  commits without advancing**, because a mouse user did not ask to be moved on. Focus is restored to
  the trigger before advancing, both because that is the right resting place if there is no next
  field and because `focusNextField` locates the next field relative to the trigger — it cannot work
  from the search box, which has no enclosing form.
- **Native selects — converted (14):** store on Sale Bill and Sale Return, customer on Sale Return,
  account class on Group Accounts, the region+city pairs in all four quick-add modals (sub-customer
  ×2, customer, vendor), the copy-from-prior-purchase picker on Purchase Return, and the colour picker
  on Current Stock's add-stock modal. The last two were outside the line originally drawn and were
  pulled in on a second look: both are variable-length data-entry lists, which is precisely where
  type-to-search earns its keep.
- **Native selects — left alone (12), on purpose:** filters (cheque status, JV status, adda), the four
  draft loaders, and tiny fixed lists — Cartons/Pairs, SAME/Custom delivery, cheque disposition, and
  the two unit presets. Turning a two-option control into a searchable panel makes it worse, not
  better. Dependent filtering was preserved everywhere: picking a region still narrows its city list.
- **Files:** `frontend/src/lib/fieldNav.ts` (new), `frontend/src/lib/keyboard.ts` (new),
  `frontend/src/components/SearchableSelect.tsx`, `frontend/src/components/AppLayout.tsx`,
  `frontend/src/pages/{SaleBillPage,SaleReturnPage,PurchasePage,PurchaseReturnPage,GroupAcSetupPage,ReportStockPage}.tsx`
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint at the project baseline (102 before and
  after). `isTypeAheadKey`/`isBlankOpenKey` were esbuild-bundled and **unit-tested against 37
  assertions**: letters, digits, punctuation and accented characters begin a search; 21 named keys fall
  through; Alt+V, Ctrl+C, Ctrl+V and Cmd+A are ignored while Shift+K still types a capital. Counted
  mechanically: SearchableSelect instances 64 → 78, native selects 26 → 12, and each remaining one was
  listed and checked against the keep-it list.
- **Not verified:** the feel of it in the running app — no way to click an Electron window from here.
  `focusNextField` is a verbatim extraction of the logic already powering G-01, so it is not new code,
  but the type-to-search path itself has only been reasoned about and unit-tested at the predicate
  level. Worth checking: that the first typed character reliably lands in the search box, and that
  Enter lands on the field you expect on a line-item grid.
- **Also:** ST-01 (multi-store stock) was planned and approved, then parked when this task arrived.
  Nothing was built, so there is nothing to unwind — the plan stands in this log's own history.


### 2026-08-18 — Reclaiming the sidebar's space: wider list pages, last card grids to rows
- **What:** two follow-ups to removing the sidebar, so the pages actually grow into the ~256px it was
  taking. (1) The wide page-width cap goes from 1400 to 1750. (2) The last six card grids become row
  tables.
- **Why these two and not a redesign:** the question asked was whether to switch cards from vertical
  to horizontal. Checking the tree answered it differently: **19 pages already use row tables**
  (`DataListTable`), and only 6 components still used the 3-column card grid — precisely the Sale Bill
  and Sale Return Weekly/Monthly/Overall tabs. The Receipts and Expenses equivalents had already been
  converted, because the client asked for exactly this in **RJ-05** ("change the display from cards to
  rows — consistent with other pages in the app"). So this is not a new design direction, it is
  finishing one the client already chose on the six screens RJ-05 did not reach. Inventing a third
  "horizontal card" idiom would have left the app in three states instead of one.
- **Width:** 28 occurrences of `maxWidth: 1400` → `1750`. That number was chosen when a 256px sidebar
  was eating the left of the screen; with it gone a 1400 cap left ~260px of dead margin each side at
  1920px. **Deliberately NOT applied to the 1000/1100/1150/1200/1250 caps** (29 more occurrences):
  those are on forms, and a form field stretched to 1750px is harder to read, not easier — the eye
  loses the line. Only the wide list/table tier moved.
- **Cards → rows:** the six tabs now use the same table shape as the already-converted
  `WeeklyReceiptsTab`, so all records screens read alike. A row is ~40px against a 190px card
  three-across, so roughly four times as many customers fit without scrolling. The conversion also
  **recovered data the cards were discarding**: every one of these tabs already computed
  `totalCartons`, `totalPairs` and `totalValue` per customer and displayed none of them — the card had
  room only for a bill count. The row shows all three. Customer code now renders `account_code`
  (C-01) rather than the raw IDENTITY, matching the setup screens.
  Each file kept its own empty-state wording ("No Monthly Records Found", "No Weekly Returns Found",
  …) and its own collection name — the Sale tabs group `data.bills`, the Return tabs `data.returns` —
  rather than being flattened to one generic string.
- **Files:** 28 files for the width change; `frontend/src/components/{Weekly,Monthly,Overall}Tab.tsx`
  and `{Weekly,Monthly,Overall}ReturnTab.tsx` for the conversion
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint at exactly the project baseline (102
  problems before and after). Counted mechanically: 0 occurrences of `maxWidth: 1400` remain and 28 of
  `1750`; the form-tier caps are untouched at their original counts; **0 card grids remain** in
  `src/pages` or `src/components`. Each converted tab reports a 6-column header row and a matching
  `colSpan={6}` empty state.
- **Not verified:** appearance in the running app. Worth an eye on `TransferPage` in particular — it is
  the one page in the 1400 tier whose wrapper holds a form as well as a list, so it is the most likely
  place a widened container looks stretched.

### 2026-08-18 — Sidebar replaced by the legacy-style menu bar (`ref-pics/`)
- **What:** the left sidebar is gone. Navigation is now five hover menus across the top —
  **1.SETUP · 2.DATA ENTRY · 3.ACCOUNT REPORTS · 4.STOCK REPORTS · 5.SALE REPORTS** — sitting
  directly above the Quick Menu row, reproducing the client's previous software (photographed in
  `ref-pics/`). Pages get the full window width back.
- **Decisions taken with the user:** legacy names AND legacy numbering (`1.1 GROUP ACCOUNTS`,
  `3.16 CASH BOOK SUMMARY`); legacy items this app has no page for are left out rather than shown
  greyed; the sidebar is removed outright and dropdown items become the drag source for pinning.
- **How, and what the numbering means:** the numbers keep their original gaps. The old menu already
  skipped (2.1, 2.3, 2.4, 2.13 — no 2.2), and omitting unbuilt items adds more. That is deliberate:
  staff navigate by "3.16" the way they navigate by name, so a renumbered-but-tidy menu would be
  worse than a gappy faithful one. Pages this app has that the old menu never listed are appended
  inside the matching group with fresh numbers (1.11+, 2.14+, 3.23+) so none collides with a number
  somebody already knows.
  Menu data lives in `frontend/src/lib/menu.ts`, not in the component — exporting `MENU_GROUPS`
  alongside the component tripped `react-refresh/only-export-components`, and `lib/` is already where
  this codebase keeps non-component modules.
  Hover behaviour: opening is immediate, closing is delayed ~180ms so the diagonal pointer path from
  a menu button into its own dropdown doesn't cross dead space and shut it. Click toggles too (hover
  alone is unusable on a touch screen), and both Escape and an outside click close.
  Role filtering is applied inside `MenuBar`, and separators left leading/trailing/doubled by that
  filter are collapsed — otherwise hiding an admin-only item strands a rule at the foot of the menu.
- **Two things that had to move, or they would have been lost with the sidebar:**
  1. **Log out.** The user chip carrying Settings and Log out lived in the sidebar footer. It is now
     in the header, same popup and same two actions. Deleting the sidebar without moving it would
     have removed the only way to log out.
  2. **Pinning.** The Quick Menu was populated by dragging a sidebar nav item onto it. Dropdown items
     are now the drag source, carrying the same `{page, tab, label}` payload, so pinning still works;
     the "+ Pin Page to Bar" button was already independent and is untouched.
- **Also removed as dead:** `toggleSidebar`, the sidebar open/hidden state, the module-level nav
  scroll-position memo, the `.app-sidebar*` CSS rules, and the `wento_sidebar_hidden` localStorage
  writes in `AppContext`'s LOGIN_SUCCESS/LOGOUT (nothing reads that key any more).
- **Files:** `frontend/src/lib/menu.ts` (new), `frontend/src/components/MenuBar.tsx` (new),
  `frontend/src/components/AppLayout.tsx`, `frontend/src/context/AppContext.tsx`,
  `frontend/src/index.css`
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint back to exactly the project baseline
  (102 problems before and after; both new files are lint-clean). **Coverage checked mechanically
  rather than by eye:** the set of `page:` targets in the old sidebar was diffed against the new menu
  — 32 pages each, **zero orphaned**, so nothing the sidebar could reach became unreachable. The menu
  was then rendered from its real data for both roles: admin-only items (1.14 Bank Accounts,
  1.17 Manage Users, 2.20 Transfer) correctly vanish for a `User`, with no stray separators left.
- **Not verified:** appearance and hover feel in the running app — no way to click an Electron window
  from here. Worth checking: that the dropdown sits correctly over page content, that the ~180ms
  close delay feels right, and that the menu bar doesn't crowd the Quick Menu on a 1366px laptop.
- **Open questions flagged to the user:** 1.2 CONTROL ACCOUNTS is mapped to this app's Chart of
  Accounts page (`database_schema_v4.3.md` records `ac_id` as "was control_id", so chart accounts ARE
  the control level; `project_overview.md` says otherwise — the schema was followed). Legacy 1.3 MAIN
  ACCOUNTS, 2.13 DAY BOOK ENTRY and 5.4 CUSTOMER WISE SALES ANALYSIS are omitted — see `lib/menu.ts`
  for the reason at each site.

## Change requests — `System_architecture/changes-15-08-26.md`

### 2026-08-17 — SB-01: make a silent failure name itself (Change request SB-01)
- **What:** "Save and Post did nothing on one laptop", with no error shown and nothing in any log.
  This does **not** fix that laptop — the cause is still unknown and unreproduced. It makes the class
  of failure that matches the symptom impossible to miss next time.
- **Why this and not a fix:** every failure the API *reports* was already surfaced in the page's
  banner, so a reported error cannot be the explanation. What was NOT covered is a failure that
  **throws**: a rejected promise inside the click handler, or a `TypeError` from reading a property of
  an undefined `window.api.<feature>` — the exact trap `backend/CLAUDE.md` warns about, where a
  channel added without its feature name in `ipcBridge.ts`'s FEATURES array throws instead of
  returning a failed ApiResult. Either unwinds the handler silently, leaving the button genuinely
  looking dead. `ErrorBoundary` (added earlier for CH-02) cannot catch these — it only catches errors
  thrown while rendering.
- **How:** two layers. `main.tsx` registers `unhandledrejection` and `error` listeners that log with
  a `[Wentox]` prefix and show the error on screen in a dismissible banner, asking for a screenshot.
  Built with plain DOM rather than React state deliberately: it has to survive a React tree that is
  already in trouble and must not depend on any component being mounted. Second layer:
  `handleSaveAndPost` on `SaleBillPage` is wrapped in its own try/catch so that specific button also
  reports locally — the body moved to `saveAndPost()` and the handler is now the guard.
- **Files:** `frontend/src/main.tsx`, `frontend/src/pages/SaleBillPage.tsx`
- **Verified:** the diagnostic was extracted and exercised against a DOM stub, since a *broken*
  diagnostic is worse than none. Confirmed: it renders for the exact SB-01 shape (a TypeError from an
  undefined `window.api.saleBills`) and reports it as `TypeError: Cannot read properties of undefined
  (reading 'post')`; an error message containing markup goes through `textContent`, never `innerHTML`,
  so it cannot inject; repeated reports replace rather than stack; the dismiss button is wired.
  **The test found a real weakness and it was fixed:** a non-Error rejection (a plain object, which is
  exactly what a rejected ApiResult looks like) rendered as the useless `"[object Object]"`. It now
  JSON-serialises objects, falling back to `[object Object]` only for circular ones — verified both.
  `tsc -b`, `npm run build` and ESLint all clean, lint identical to baseline (102 problems before and
  after, whole `src` tree).
- **Still open:** SB-01 is recorded as diagnosed-but-unresolved, not done. Closing it needs the actual
  laptop: reproduce the click, and the banner will name the cause.

### 2026-08-17 — RJ-03 / PN-01: the voucher screens (Change requests RJ-03, PN-01)
- **What:** `ReceiptsPage.tsx` and `ExpensesPage.tsx` now drive the voucher model built in the entry
  above. Fill the entry row → **Done** commits it as a line and re-arms the form with the cursor back
  in the first field → repeat → **Post Voucher** posts the lot. A grid of committed lines sits under
  the form with the client's own columns (A/C Code, Account Description, Narration, Cheque No, Type,
  Rs.) and a footer of Total Cash / Cheque / Online plus the voucher total.
- **Scope decided with the user:** only the entry form was rebuilt. The Weekly/Monthly/Overall record
  tabs, the RJ-02 balance tooltip, cheque handling and the RJ-06 password-gated delete all stay as
  they were, and the record lists still show **individual lines**, not grouped vouchers — a voucher is
  an entry convenience; the ledger and every report still read per-receipt.
- **How, and the decisions inside it:**
  **The voucher is created lazily, on the first Done** — not when the page opens. `voucher_no` is the
  client's "C.Book No", allocated MAX+1, so creating one eagerly would burn a number every time
  somebody merely opened the screen and walked away.
  **Date and Remarks are head-level**, matching the client's screen — one Date for the whole voucher.
  Editing either goes through `receipt-vouchers:update`, which carries the change down onto every
  line in the same transaction; both fields lock as soon as anything is posted, because the backend
  refuses the edit then (POSTED_LOCK) and offering the field would be a lie. Remarks persist on blur,
  not per keystroke.
  **Done ≠ Post.** Done is the client's word for committing a line; the line is created DRAFT and has
  no effect on any balance until the voucher is posted. The submit button says so.
  **The cursor is put back explicitly.** The app-wide G-01 auto-focus fires when a form mounts, but
  this form never unmounts between lines — so Done re-focuses the first entry field itself, finding
  it via `button[data-field-nav]`, the same hook G-01's own field walker uses (no ref forwarding
  needed through SearchableSelect).
  **The post-result panel is never auto-hidden**, unlike the ordinary success banner: a voucher can
  post 8 of 10 lines and the two that failed are the entire point of the message.
  **Per-line Edit/Delete are unposted-only** — the backend rejects both on a posted line, so showing
  the buttons would only manufacture an error.
  **Opening a receipt/expense from the records list now opens its whole voucher**, so its sibling
  entries, the totals and Post/Un Post are all on screen — otherwise the user is looking at one line
  of a document with no way to reach the rest of it.
- **Two regressions caught and fixed while doing this:**
  1. An **endorsement is not a voucher line** — it lives in `dbo.settlements`, has no cash/bank leg
     and no `voucher_id`. Replacing the Receipts header's Post/Unpost with voucher-level buttons
     would have left endorsements with no way to post at all. They keep their own badge and their own
     Post/Unpost, shown only when `docKind === 'SETTLEMENT'`.
  2. `ExpensesPage`'s now-dead per-expense `handlePost`/`handleUnpost` also called
     `refreshCheques()`. A CHEQUE_ENDORSED line's allocation against a received cheque changes when
     it posts, so deleting them as-is would have left the endorsement picker offering value that was
     already spent. That refresh moved into the voucher handlers before the dead code went.
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`,
  `frontend/src/lib/api.ts` (`ReceiptVoucherRow`, `ExpenseVoucherRow`, `VoucherStatus`,
  `VoucherActionResult`, `voucher_id`/`account_code` on the row types, both bridge blocks and both
  `receiptVouchers`/`expenseVouchers` export objects with date normalisation)
- **Verified:** `tsc -b` clean, `npm run build` clean, and ESLint **identical to baseline across the
  whole `src` tree** — 102 problems before, 102 after (nothing added; the pre-existing ones are
  untouched). Two behaviours that looked risky were checked live against `wentox_db` rather than
  reasoned about: editing a line through `receipts.update` / `expenses.update` **keeps its
  `voucher_id`** (the repositories' `updateHeader` deliberately doesn't touch the column, so a line
  cannot be moved between vouchers by an edit), and `account_code` is populated on voucher lines so
  the grid's A/C Code column is not blank. Both passed; test rows deleted afterwards.
- **Not verified:** the screens have not been driven in the running app — no way to click an Electron
  window from this environment. Everything statically checkable passes and every backend call the
  pages make is individually proven against the live database, but the rendering and the
  Done→Done→Post rhythm need a real run. Specifically worth checking: that the cursor genuinely lands
  back in the account picker after Done, and that the head Date/Remarks lock at the right moment.

### 2026-08-17 — RJ-03 / PN-01: receipt & payment vouchers — database and backend (Change requests RJ-03, PN-01)
- **What:** receipts and expenses were standalone documents, each posted on its own. They are now
  **entry lines under a voucher**: one header (date, C.Book No, remarks) over many lines, each line
  naming its own account, posted with a single action. Backend and schema only — the screens come
  next.
- **Client's actual requirement** (confirmed from a photo of their previous software plus an explicit
  clarification): a day's takings are entered at the END of the day and they are **not one
  customer's** — "records maybe for different customer". So this is a header with **any party per
  row**, not a per-customer grouping. Fill an entry, press Done, it drops into a grid, cursor
  returns ready for the next; Post posts the lot; Un Post reverses. Footer totals per Cash / Cheque
  / Online.
- **How:** migration `022_receipt_and_expense_vouchers.sql` adds `dbo.receipt_vouchers` and
  `dbo.expense_vouchers` plus a `voucher_id` on `receipts`/`expenses`. Three decisions worth
  recording:
  **1. Status is derived, never stored.** Posting is per line (each line keeps its own transaction,
  so one that cannot post never rolls back the lines that already did — the client's explicit
  choice), which means a voucher can legitimately sit half-posted. A stored header status would be a
  second source of truth that is wrong the moment that happens. `deriveStatus()` reads it off the
  lines: none confirmed → UNPOSTED, all → POSTED, otherwise → PARTIAL. An **empty** voucher reads
  UNPOSTED, not POSTED — "every line is confirmed" is vacuously true of no lines.
  **2. The per-line date stays.** The ledger, Cash Book and every report read `receipt_date` /
  `expense_date`; dropping it was out of scope. `syncLineDates()` writes the header's date down onto
  its lines in the same transaction, so the two cannot disagree.
  **3. Every existing row was backfilled into a one-line voucher of its own.** Not left NULL — that
  would mean a permanent "voucher_id IS NULL means legacy" branch in every query. Each pre-existing
  receipt genuinely WAS its own document, so a one-line voucher is the honest representation. The
  backfill uses an INSERT-only `MERGE ... ON 1=0` with `OUTPUT inserted.voucher_id, src.receipt_id`
  to map new headers back to their lines — IDENTITY order is not guaranteed to match insertion
  order, so pairing them by id sequence would have been a silent corruption risk.
  Header edits and deletes are blocked once anything on the voucher is posted (`POSTED_LOCK`): a
  posted line has `ledger_entries` stamped with its date, so moving the header would leave the
  ledger disagreeing with the document. The FK on `voucher_id` is deliberately **not** ON DELETE
  CASCADE — a cascade would silently delete posted lines and strand their ledger rows.
  `expenseVouchers.*` is a separate file rather than a shared generic voucher service: expenses
  carry four payment modes (two unrelated cheque mechanics) and `expenses.service#post` takes a
  `userId` that `receipts.service#post` does not, so a shared abstraction would branch on document
  type in every method. Both cheque modes total together as `total_cheque` on the footer.
- **Files:** `backend/src/db/migrations/022_receipt_and_expense_vouchers.sql`,
  `backend/src/repositories/{receiptVouchers,expenseVouchers}.repository.js`,
  `backend/src/services/{receiptVouchers,expenseVouchers}.service.js`,
  `backend/src/ipc/{receiptVouchers,expenseVouchers}.ipc.js`, `backend/src/ipc/index.js`,
  `backend/src/repositories/{receipts,expenses}.repository.js` (voucher_id on insert),
  `backend/src/services/{receipts,expenses}.service.js` (voucher_id in buildFields),
  `frontend/src/lib/ipcBridge.ts` (`receiptVouchers`, `expenseVouchers` added to FEATURES),
  `System_architecture/database_schema_v4.3.md`
- **Verified:** migration applied live to `wentox_db` — 8 receipts → 8 vouchers numbered 1–8 in date
  order, 4 expenses → 4 vouchers, **zero** rows left without a voucher, **zero** line/header date
  mismatches, total receipt amount unchanged at 210,500. Then both services driven end to end
  against the live database, reproducing the client's own screen: a voucher with three lines of
  65,000 / 37,000 / 10,000 across **two different accounts**, totalling 112,000 cash — the same
  figures as their photo. Confirmed: empty voucher reads UNPOSTED; post wrote 6 ledger entries and
  the voucher read POSTED; header edit and delete both blocked with POSTED_LOCK while posted; unpost
  removed all 6 ledger entries and returned to UNPOSTED; posting 1 of 3 lines read **PARTIAL**;
  header date edit propagated to all three lines; list() returned the derived status and per-mode
  totals. Same sequence passed for payment vouchers. Every test row was deleted afterwards — the
  database is back to its pre-test counts (8 receipts, 4 expenses, 0 orphans).
- **Not done yet:** the screens. `ReceiptsPage.tsx` and `ExpensesPage.tsx` still drive the old
  one-receipt-per-posting flow and do not call these channels at all, so nothing is user-visible
  yet. RJ-03/PN-01 stay open until those are rebuilt.

### 2026-08-17 — SB-06 / P-03: post a whole run of documents at once (Change requests SB-06, P-03)
- **What:** every bill and every purchase had to be posted individually. Both screens now carry a
  "Pending Posting" panel listing what is saved but not yet in the ledger, with one Post All action
  and a per-document result.
- **How:** `listUnposted()` on both repositories defines unposted as the **absence of ledger
  entries** — the same definition `isPosted()` already uses; there is no status column on
  `sale_bills` to read instead (it was removed, see `database_schema_v4.3.md`). Ordered oldest
  first so a run lands in the ledger in the order it was typed. These select only the display
  fields the panel needs, not `SELECT *` — nothing here renders a document.
  `postAll(ids)` loops those (or an explicit id list) and calls the existing per-document `post()`.
  Two properties matter and are commented at the call site:
  **Each document keeps its own transaction.** Per the user's explicit choice, one document that
  can't post must not roll back the ones that already did. So `postAll` **resolves** with
  `{ posted, failed, attempted }` rather than throwing on first failure — unlike
  `products`/`businessAccounts` `createBatch`, which reject the whole batch. `ok: true` therefore
  does NOT mean everything posted; callers must read `failed`. Both the IPC comment and the
  `PostAllResult` type say so, because this is exactly the kind of contract that gets misread.
  **The loop is sequential, deliberately.** Two unposted bills can each pass the SB-03 stock check
  alone yet not together; `postLedgerAndStock()` reads `pairsOnHand()` live, so posting one after
  another is precisely what makes the second correctly fail with a specific INSUFFICIENT_STOCK
  message. `Promise.all` here would let both read the same pre-sale stock and oversell. Left an
  explicit "do not turn this into a Promise.all" note.
  A document already posted by someone else is skipped rather than reported as a failure — the
  user's intent ("get these posted") is satisfied either way. Non-`ApiError` failures are logged
  with their stack but reported generically, since the batch summary is the only place the user
  sees them.
  Frontend: the result panel is **not** auto-hidden on a timer like the ordinary success banner —
  a run can post 18 of 20, and the two that failed are the entire point of the message, so it stays
  until dismissed. Both mount effects fold the new list into the page's existing one rather than
  adding a second `useEffect`, which keeps the lint count at baseline.
- **Files:** `backend/src/repositories/{saleBills,purchases}.repository.js`,
  `backend/src/services/{saleBills,purchases}.service.js`,
  `backend/src/ipc/{saleBills,purchases}.ipc.js` (`:listUnposted`, `:postAll`),
  `frontend/src/lib/api.ts` (`UnpostedBillRow`, `UnpostedPurchaseRow`, `PostAllResult`, bindings),
  `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/PurchasePage.tsx`
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint at baseline (12 on these two files
  before and after). Executed live against `wentox_db`: `listUnposted()` returned the 2 genuinely
  unposted bills and 1 unposted purchase with correct customer/vendor names and totals, and
  `postAll([999999])` on both services returned
  `{posted:[], failed:[{... "Sale bill not found", code:"NOT_FOUND"}], attempted:1}` — a bad id
  lands in `failed` rather than throwing the batch out.
- **Not verified:** the partial-success path itself — "some post, some fail" — has not been driven,
  because exercising it means posting the user's real unposted bills into their ledger, which was
  not done without asking. Also unverified: the panel rendering and the Post All button, same
  Electron-clicking limitation as SB-05.

### 2026-08-17 — SB-05 / P-02: ready for the next document after posting (Change requests SB-05, P-02)
- **What:** posting a sale bill or a purchase left the finished document on screen, so entering a
  run of twenty bills meant twenty trips through the New button. A document completed in this run
  now clears itself back to a blank form, ready to type the next one.
- **How:** the reset reuses each page's existing `handleNew()` rather than repeating its field
  list, so "a blank bill" stays defined in one place; `readyForNextBill()` / `readyForNextPurchase()`
  then put the working **date** back, because `handleNew()` snaps to today and a run entered for an
  earlier date would otherwise reset on every single document. Bill numbers are already regenerated
  by `handleNew()`, satisfying SB-05's "each bill gets its own number". The cursor lands in the
  first field on its own — the app-wide G-01 auto-focus rule fires when the form remounts, so
  nothing page-specific was needed.
  The non-obvious part is **when** to reset. "After posting" is too broad: opening a bill from the
  Find tab and posting it there would wipe a screen the user deliberately navigated to. Both pages
  now carry a `createdInThisRun` ref — set only when `create()` succeeds (never on an edit of an
  existing document), cleared by `handleNew()` and by loading any existing row — and the reset is
  gated on it. Sale Bill's save-and-post path and its standalone Post button both honour it;
  Purchase has no combined action, so its Post button is the completion moment there.
  A save that succeeds but whose **post** fails deliberately does not reset: the document exists and
  must stay on screen so the user can see which one failed and retry. Success messages now name the
  document ("Bill 34871 saved & posted. Ready for the next one.") because once the form empties, the
  clearing is otherwise the only evidence anything was saved.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/PurchasePage.tsx`
- **Verified:** `tsc -b` clean, `npm run build` clean, and ESLint unchanged against baseline — 9
  errors before, the same 9 after (all pre-existing, including the `handleNew`-before-declaration
  one already recorded in `System_architecture/TODO.md` §4.2).
- **Not verified:** the behaviour itself has not been driven in the running app — this is frontend
  state, and there is no way to click an Electron window from this environment. Needs a click-through:
  enter a bill → Save & Post → confirm the form clears, keeps the date, has a new bill number, and
  the cursor is in the first field; then open a bill from Find, post it, and confirm it does NOT clear.
- **Known consequence:** the just-posted bill is no longer on screen to print. It stays reachable
  from the Find tab, but if printing immediately after posting is part of the daily routine, this
  ordering needs revisiting (print-then-clear, or a "print last bill" action).

### 2026-08-16 — PR-01: Purchase Return prefills the price actually paid (Change request PR-01)
- **What:** a purchase return priced its lines off whatever the user typed, so it could credit the
  vendor at a price that was never paid. It now prefills each line from this vendor's last POSTED
  purchase of that material — the counterpart of SR-01, which already did this for Sale Return.
- **How:** mirrored SR-01's implementation rather than inventing a second approach —
  `purchases.repository#lastPurchasedRate` is `saleBills.repository#lastSoldRate` with the sale
  tables swapped for the purchase ones, same `EXISTS(ledger_entries)` posted-only rule, same
  `ORDER BY date DESC, id DESC`.
  Two deliberate differences from SR-01. **Keyed on material NAME, not id:** the Purchase/Purchase
  Return screens hold free text and only resolve to a `material_id` at save time via
  `materials.repository#resolveOrCreate`, so an id-keyed lookup had nothing to pass. Matching is a
  plain `=` on `m.name`, leaning on the same case-insensitive collation `resolveOrCreate` already
  leans on. It is strictly read-only — it never registers a material, so typing an unknown name
  returns null instead of quietly creating a `materials` row. **Returns the unit with the price:**
  a purchase line's unit is self-assigned, so "200 kg @ 230" and "200 meters @ 230" are different
  purchases and a price without its unit is ambiguous.
  Frontend fires on **blur** of the material name, not on change — mid-typing, the name matches
  nothing. A `resolvedNames` ref records the name each row was last priced from, so re-blurring an
  untouched field never overwrites a price the user has since edited by hand, while genuinely
  changing the material does refill. The ref is cleared when the vendor changes (same material,
  different last-paid price), and **pre-seeded** on both load paths — copy-from-purchase and
  open-existing-return — because those lines already carry the source document's own rates, which
  beat "last posted purchase" when the two differ. A fetched unit outside `UNIT_PRESETS` also flips
  that row's unit control to free-text, or the select would snap the line back to a preset.
- **Files:** `backend/src/repositories/purchases.repository.js`,
  `backend/src/services/purchases.service.js`, `backend/src/ipc/purchases.ipc.js`
  (`purchases:lastPurchasedRate`), `frontend/src/lib/api.ts` (`LastPurchasedRate`, bridge binding),
  `frontend/src/pages/PurchaseReturnPage.tsx`
- **Verified:** `tsc -b` clean; executed live against `wentox_db` — exact name returned
  `{ price_per_unit: 12, unit: 'Buckles' }`, a lowercased name returned the same row (collation),
  a wrong vendor and an unknown material both returned null, the service's blank-name and
  no-vendor guards short-circuited before SQL, and **an unposted purchase's price did not leak**
  (a draft line at 688 returned null).
- **Not exercised:** the most-recent-wins ordering — this database has only one posted purchase per
  material, and proving it would have meant writing extra purchases into the user's data. The
  ORDER BY is verbatim from the already-proven `lastSoldRate`.
- **Not wired:** `purchases:lastPurchasedRate` is a new channel on an existing feature, so
  `ipcBridge.ts`'s `FEATURES` array needed no change (`purchases` is already listed).

### 2026-08-16 — C-01: show the account code, not the IDENTITY value (Change request C-01)
- **What:** Vendor and Customer setup screens showed the raw `vendor_id`/`customer_id` as the
  party's "ID". Those are `IDENTITY` values and they skip, which the client reported as a bug
  ("only one vendor exists but the system generated ID = 2"). Both screens now show the linked
  business account's `code` instead, relabelled Vendor Code / Customer Code.
- **How:** there was no defect to fix — the skipping is expected behaviour, and confirmed live on
  `wentox_db`: vendor_ids run 1, 2, 3, **1003** while their account codes run 2000010001–…0004
  with no gap at all. The 1000 jump is SQL Server's identity cache losing its reserved block on an
  unclean shutdown; a rolled-back create burns a value the same way, and `vendors.create()` wraps
  the vendor and its business account in one transaction, so any failure there consumes an id.
  Soft-deleted rows hold theirs permanently too. The account code has none of these properties —
  it's allocated `MAX(serial under parent) + 1` by `businessAccounts.service.js` and is already the
  number printed on the ledger and the voucher for that same party, so the screens now agree with
  the accounts.
  `list()`/`findById()` in both repositories gained a `LEFT JOIN dbo.business_accounts ba ON
  ba.ba_id = <t>.ba_id` and select `ba.code AS account_code` — LEFT, not INNER, so a party with no
  linked account still lists (renders as `—`) rather than vanishing from the screen. Both search
  filters now match `ba.code` alongside the name, and the two client-side search boxes match
  `account_code` **as well as** the old raw id, so anyone who has memorised the old number can
  still type it. Display-only: no migration, no renumbering, no data touched.
- **Files:** `backend/src/repositories/vendors.repository.js`,
  `backend/src/repositories/customers.repository.js`, `frontend/src/lib/api.ts`
  (`VendorRow.account_code`, `CustomerRow.account_code`),
  `frontend/src/pages/VendorSetupPage.tsx` (list column, search, detail panel),
  `frontend/src/pages/CustomerSetupPage.tsx` (list column, search, ledger header, printed statement)
- **Verified:** `tsc -b` clean; both repositories executed live against `wentox_db` — 4 vendors and
  6 customers all returned a populated `account_code`, `findById` carried it, and searching by a
  full account code returned exactly the one matching row on both entities.

## Backing the database up to an external drive

### 2026-08-13 — External-drive backup, and a staging path the mirror could never have written on Windows (Milestone 9, follow-up)
- **What:** a second backup target — a full `.bak` written straight onto a USB/external drive from
  Settings → Backup. This is the first copy that survives the PC itself: the main database and the
  live mirror both sit on the same disk, on the same SQL Server instance, so a dead disk took both.
  **One file, always overwritten, manual only** — decided explicitly with the user. The drive is not
  expected to be plugged in most of the time, so nothing here runs on a timer, and there is no dated
  history (so a mistake noticed a week later is still unrecoverable — stated, accepted, not solved).
- **How:** SQL Server writes to the drive directly (`BACKUP DATABASE ... TO DISK` with
  `INIT, FORMAT, CHECKSUM`) rather than the app backing up locally and copying the file across —
  one ~400MB write instead of two, and no staging folder that both the SQL Server service account
  and the logged-in user must be able to write. `RESTORE VERIFYONLY` runs immediately after, so
  success means the file **on the drive** was read back and is complete, not merely that a write
  returned no error. No `WITH COMPRESSION`: unavailable in SQL Server Express, and including it
  fails the statement outright.
- **The error messages are the feature.** `ipc/wrap.js` flattens anything that isn't an `ApiError`
  into `"Internal error"`, which for this is useless — "Operating system error 5 (Access is denied)"
  is the whole diagnosis. Known failures are mapped to their own codes
  (`EXTERNAL_NOT_CONFIGURED`, `EXTERNAL_DRIVE_MISSING`, `EXTERNAL_ACCESS_DENIED`,
  `EXTERNAL_DISK_FULL`) and everything else keeps the raw SQL Server text. **Gotcha found by
  testing, not by reading:** a failed `BACKUP` raises *two* errors — the real cause, then
  "BACKUP DATABASE is terminating abnormally." mssql puts the cause in `err.precedingErrors` and the
  useless one in `err.message`, so the first implementation reported the useless one and the
  access-denied case fell through to the generic branch. The folder's existence is checked with
  `fs.existsSync` *before* starting, so an unplugged drive fails instantly rather than after minutes.
- **Separate latent bug, fixed in the same pass:** `runSyncNow()` staged the mirror's `.bak` through
  `os.tmpdir()`. On Windows that is the *user's* `%TEMP%`, and SQL Server Express is installed here
  with no `/SQLSVCACCOUNT` (`build/setup-sqlserver.ps1:168`), so it runs as the virtual account
  `NT Service\MSSQLSERVER` — which has no rights there. **The existing mirror backup would almost
  certainly have failed on the client's machine**, and could not have been caught in this sandbox
  because SQL Server runs in a container and writes to its own `/tmp`. It now stages inside the
  mirror's own folder, which SQL Server demonstrably can write: the mirror's `.mdf`/`.ldf` live
  there. Still unproven on real Windows — see below.
- **`RESTORE-INSTRUCTIONS.txt`** is written next to the `.bak`, containing the actual
  `RESTORE FILELISTONLY` / `RESTORE DATABASE ... WITH MOVE` commands for that exact file. The drive
  has to explain itself: whoever holds it in an emergency may have neither this app nor this repo.
- **Verified:** 17/17 on a purpose-built functional run — the `.bak` lands on the drive,
  `VERIFYONLY` passes, and it **restores into a scratch database with all six checked tables
  matching** (`sale_bills` 61, `sale_bill_items` 65, `ledger_entries` 695, `customers` 96,
  `cheques` 52, `users` 2). All three failure paths produce their own readable message and never
  `"Internal error"`; two simultaneous presses share one run. The mirror was re-tested after the
  staging change and still syncs exactly. Full suite 113/113 on a database built from nothing,
  IPC audit clean (267 channels), `tsc` clean, lint unchanged at the 88/10 baseline, production
  build clean.
- **Still to do on Windows:** the permission question is only genuinely answered there — plug in a
  real drive, run it, unplug and re-run for the "drive not found" message, and restore the `.bak` on
  a different PC. That same run is what finally confirms the mirror too.
- **Files:** `backend/src/services/backup.service.js`, `backend/src/ipc/backup.ipc.js`,
  `backend/src/config/appConfig.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/SettingsPage.tsx`

---

## QA pass over the whole app, and the cheque-deposit hole it found

### 2026-08-10 — Full-app QA run; deposited cheques never reached the bank (Milestone 9, verification)
- **What:** a structured QA sweep of the entire app, then a fix for the one material defect it
  surfaced. Three static audits (renderer→bridge→handler surface: 260 call sites, 0 gaps;
  ipc→service method references: 261, 0 missing; every nav page routed: 31/31) plus a 14-phase live
  run against a database built from nothing — auth/roles, masters, structural guards, stock,
  purchases + returns, sale bills + returns (including editing a POSTED bill), receipts, expenses,
  endorsements, transfers, deposits, payroll, JV, the full cheque lifecycle, all 16 reports, alerts,
  backup, and per-document double-entry integrity. **113 checks, 0 failures** after the fix.
- **The defect — a deposited cheque moved nothing.** `cheques.service.js#deposit()` deliberately
  wrote no ledger row, deferring to `cash_and_bank.md` §10's derived-balance helper
  (`balance(bank) = ... + Σ cheque DEPOSITs where the cheque's bank_id = B`). **That helper was
  never built** — every balance the app shows reads `ledger_entries`, and nothing anywhere derives a
  balance from `cheque_allocations`. So banking a cheque (even marking it CLEARED) never credited
  the bank and never drained CHEQUES IN HAND. Evidence from the QA database: bank 222,800 with an
  8,000 CLEARED cheque missing, CHEQUES IN HAND still holding that same 8,000. Both errors are equal
  and opposite, which is exactly why the trial balance stayed at zero and never flagged it — and why
  it survived the earlier full-flow check, which asserted on the trial balance.
- **How fixed:** `deposit()` now writes Dr bank BA / Cr CHEQUES IN HAND like every other money
  movement — the same pair `reports.repository.js#cashBookNonCashRows` already documented a deposit
  as being. Chose this over building the §10 derivation helper: one mechanism for all money
  movements beats a second, parallel one that only cheque deposits use and that every future report
  would have to remember to call. `reverseCheque()` gained the matching branch, so a cheque that
  bounces *after* being banked now pulls the money back out of the bank (a DEPOSITED cheque is not
  terminal, so this path is reachable); its other side is the bank on the cheque itself, since
  `cheque_allocations` has no bank column. `markCleared()` stays a pure status flip — the money
  moved at deposit time.
- **Migration 019** backfills the missing pair for deposits made before the fix. ACTIVE allocations
  only: a REVERSED one wrote nothing and was reversed against nothing, so its two errors already
  cancel and inserting one side now would *create* an imbalance. Both legs go in one `CROSS APPLY`
  statement so a half-written pair is impossible, and `NOT EXISTS` on `allocation_id` makes re-runs
  a no-op. Verified on `wentox_demo`: Meezan Bank 232,000 → 292,000, CHEQUES IN HAND 297,000 →
  237,000, ledger still nets to zero with no unbalanced document.
- **Gotcha caught in testing:** the first version of 019 `THROW`-ed when CHEQUES IN HAND was absent.
  Migrations run *before* seeds, so that aborted `npm run migrate` on every brand-new database. It
  is now a guarded no-op — no chart account means no cheques, so there is nothing to backfill.
- **Second gotcha, spotted by the user:** 019 tagged its narration `(backfilled by migration 019)`,
  which is not an internal note — `ledger_entries.narration` renders verbatim in the Narration column
  of the account and cheque ledgers the client reads. A backfilled deposit is the *same business
  event* as a live one, so the wording now matches `deposit()`'s byte for byte, and which code path
  wrote the row is left to `schema_migrations.applied_at` where it belongs. The six rows already
  written locally were stripped with a one-off UPDATE. **Note this edits an already-applied
  migration**, against the standing rule — justified only because 019 is uncommitted and unreleased
  and had run on exactly two local databases (scratch QA and `wentox_demo`), both corrected here. Had
  it shipped, the fix would have had to be migration 020 doing that UPDATE.
- **Still open, reported not fixed:** (1) read-side role guard — `reports:account-ledger`,
  `:account-balance` and `:business-ledger` only `requireSession()`, so a USER can read restricted
  accounts (Bank, Directors Drawings) that the write side correctly blocks, and no frontend filters
  on `is_restricted`; (2) `products.service.js#createBatch` 404s on a `vendor_id` it then overwrites
  with the system vendor; (3) `direction: 'CREDIT'` means opposite ledger sides on Deposits vs
  Journal Vouchers; (4) `accountBalance` cuts off at today while `accountLedger` does not, so the two
  disagree on a future-dated document.
- **Not a defect:** cheque disposal actions are ADMIN-only by design, on screen (`ChequePage`'s
  Disposal tab) *and* in the API (`requireRole('ADMIN')` on all six channels). A `User` sees the
  cheque on the read-only "Cheque in Hand" tab with no actions and no explanation of why — a
  discoverability gap, not a permissions bug.
- **Files:** `backend/src/services/cheques.service.js`,
  `backend/src/db/migrations/019_backfill_cheque_deposit_ledger.sql`

### 2026-08-12 — PDF-backed print preview: built, could not be made reliable, reverted
- **Goal:** the preview showed one continuous sheet that just grew taller, with no page boundaries,
  so it could never show where page 2 began. Client asked for real A4 pages. Approach chosen with
  them: render the window through Chromium's own print engine (`webContents.printToPDF`) and show
  that PDF, making the preview literally the print output.
- **It worked in every isolated test and failed in the real app.** Standalone Electron harnesses
  produced correct multi-page A4 PDFs every time — including one reproducing the modal's exact DOM
  against the app's real compiled CSS. In the running app the same call returned a **blank document:
  three A4 pages of correct height with zero text**, ~2KB instead of ~103KB. Not a hang (350ms), not
  a missing channel (it logged), not the report being absent (the DOM measured 4,304 characters and
  2,260px of laid-out report at capture time).
- **Ruled out, each by measurement rather than reasoning:** the entrance animation (identical output
  captured at 30/150/600ms); `overflow` on the wrapper (3 pages, 120 rows either way); the app DOM's
  size (`content-visibility` on `#root` made no difference to blankness); webfonts
  (`document.fonts.ready` did not help); print-media emulation before capturing; settle delays up to
  two seconds. The same window printed a correct 103KB PDF when driven from the main process a few
  seconds later, which is what makes it a timing/context problem inside the print engine rather than
  a document problem.
- **Two real bugs were found and fixed along the way**, and they stay fixed: the preview state
  survived a close, so reopening pointed the iframe at a **revoked blob URL** (`ERR_FILE_NOT_FOUND`)
  while the report sat off-screen — the fresh capture was then taken of an off-screen document; and
  `[data-no-print]` was being **overridden** by a later `.report-modal-scroll-wrapper` rule of equal
  specificity, so the preview pane was never actually excluded from printing.
- **Reverted** to the HTML preview. Kept: the `items-start` fix (without it the sheet is pinned to
  one page and long reports spill onto the backdrop), the explicit `@page size: A4`, and every
  page-level print fix from the audit. The printed output was correct the whole time — this only
  ever affected what the preview showed.
- **If it is picked up again**, the promising direction is rendering the PDF in a **dedicated
  offscreen window** containing only the report: every isolated harness did exactly that and never
  failed. The obstacle is getting the app's CSS and asset URLs into that window (Vite injects styles
  as JS in dev, so there is no stylesheet to link).
- **Files:** `frontend/src/components/reports/ReportPrintPreviewModal.tsx`,
  `frontend/src/index.css`; `backend/src/ipc/print.ipc.js` added then removed.

### 2026-08-12 — Print audit across all 18 reports; grand total was repeating on every page
- **Why:** user reported "some issue when data expands to two pages". Audited every printable
  report rather than the one that prompted it — 18 reports, all going through
  `ReportPrintPreviewModal`.
- **The defect: `<tfoot>` repeats on every printed page.** That is what
  `display: table-footer-group` means in paged media, and `index.css` set it for every
  `.excel-print-table`. Right for a running footer, wrong for what this app actually puts in one —
  a grand total. On a two-page Cash Book, "Totals : …" printed at the foot of page 1 *and* page 2,
  and the page-1 figure is not the total of page 1, on a document someone reconciles by hand.
  **Affected the Cash Book and Bilty & Adda Updation** — the only two reports whose print table uses
  a real `<tfoot>`; every other one already puts its total in `<tbody>` as the last row. Fixed
  globally with `display: table-row-group`, since both have `<tfoot>` after `<tbody>` in DOM order
  and no report here ever wants a repeating footer. The `<thead>` rule is the opposite case and
  stays: column headings **must** repeat or page 2 is unlabelled numbers.
- **`@page` now names the paper, not just the orientation** — `size: A4 portrait|landscape`. Without
  a size the print dialog's default wins (Letter on US-configured Windows), silently reflowing a
  report whose own toolbar says "A4 (210mm × 297mm)" and moving every page break.
- **Audited and found sound:** headers repeat on page 2 (every table inside a print preview carries
  `.excel-print-table` — checked by walking each `renderPrintable*` body); rows never split
  mid-row; the table itself is free to break; `#root` is hidden so only the modal portal prints;
  the preview's `transform: scale()` is reset for print, which the CSS itself flags as
  "CRITICAL: transform scale breaks multi-page breaking"; no `overflow`, `max-height` or fixed
  height anywhere inside a print body that could clip page 2.
- **Sign-off block kept whole (done).** `components/reports/ReportFooter.tsx` exists but is **dead
  code — nothing imports it**, so all 19 reports carry hand-rolled copies of the strip (three ruled
  signature lines + the company/printed-at bar). The wrapper markup is byte-identical across every
  file, which made a scripted edit safe: `className="report-signoff"` added to **18 signature rows
  and 21 printed-at bars across 19 files**, plus one print rule giving them `break-inside: avoid`.
  Proven rather than assumed — a straddle had to be hunted for, because a page break falls inside
  the block only within a ~24px window, and stepping by whole table rows kept skipping it. Scanning
  filler height by 8px found it: at 940px the block **split, TOPMARK landing on page 1 and the
  signature labels on page 2**; with the class, both move to page 2 together.
- **Letterhead logo halved.** Note it is in the report *header*, not the footer. It was 160–180px
  across 20 reports — 180px is 47.6mm at 96dpi, about 17% of A4's 281mm usable height gone before a
  single row of data. Now a consistent 90px (~24mm), a normal letterhead.
- **Left alone:** `ReportFooter.tsx` is still unused. It is worth either adopting or deleting, but
  its wording differs from the copies in use ("Checked By" vs "Audited By", "WENTOX SOLE ERP System
  Report" vs "WENTOX FOOTWEAR DISTRIBUTION"), so switching to it would change what prints.
- **The one the user actually saw: the preview sheet stopped at one page.** Screenshot showed the
  last rows, the subtotal and the GRAND TOTAL rendering *outside* the white paper, on the dark
  backdrop. Cause is one missing flex property, not print CSS: the scroll wrapper is a row-direction
  `flex` with no `align-items`, so it defaults to **stretch**, which gives the sheet a DEFINITE
  height instead of letting `minHeight: 297mm` grow with content. Measured in headless Chrome —
  sheet **1123px (exactly one A4 page)** against **3186px** of content, so ~2000px hung off the
  bottom. Adding `items-start` restores height:auto; sheet measures 3186px, nothing spills. Print
  output was unaffected (the print rules already reset display/height), but the preview looked like
  a broken document, which is how it was reported.
- **Both print fixes verified on real PDFs**, not by reasoning — Chrome `--print-to-pdf` over a
  reduction of the same markup and CSS:
  | tfoot display | pages | "GRAND TOTAL" prints on | column headers on |
  |---|---|---|---|
  | `table-footer-group` (before) | 2 | **pages 1 and 2** | pages 1, 2 |
  | `table-row-group` (after) | 2 | page 2 only | pages 1, 2 |
  `pdfinfo` also confirms **594.96 × 841.92 pts = A4**, so the new explicit `size: A4` takes effect
  and headers still repeat, which was the thing not to break.
- **Files:** `frontend/src/index.css`, `frontend/src/components/reports/ReportPrintPreviewModal.tsx`

### 2026-08-12 — Zoom in / out for the whole app
- **What:** a zoom control in the header of every page — `−` / percentage / `+`, with the percentage
  acting as reset-to-100% — plus Ctrl `+` / Ctrl `−` / Ctrl `0`. The level is remembered per machine
  and a fresh install starts at **90%**. Asked for because the app renders too large on the client's
  Windows box: Electron honours the OS display scaling (commonly 125% on Windows) and this UI is
  built in fixed pixels, so less fits on screen than should.
- **Native zoom, not CSS.** `webContents.setZoomFactor()` via a new `zoom:` channel, not a CSS
  transform or the CSS `zoom` property. The app shell is `h-screen` + `overflow-hidden`; CSS zoom
  scales content while `100vh` carries on measuring the *unzoomed* viewport, so the shell would grow
  past the window and clip its own bottom edge. Native zoom leaves every layout calculation alone.
- **The default menu had to go.** Electron's built-in menu carries `zoomIn`/`zoomOut`/`resetZoom` on
  those exact accelerators. Left in place, one keypress fires both it and our handler: the window
  moves two steps while the on-screen percentage moves one, and the label stops describing the
  window. `main.js#buildMenu()` now installs a menu keeping Edit (Ctrl+C/V in inputs), Reload,
  **Toggle DevTools** and Fullscreen, minus the zoom roles. The alternative — main sending zoom
  changes back to the renderer — would have meant adding a listener to `preload.js`, the one thing
  that file deliberately does not do.
- **No `requireSession()` on `zoom:`,** unlike every other channel, and commented as deliberate: the
  login screen has to be zoomable, and it is by definition reached before a session exists.
- **One definition of the level.** `lib/zoom.ts` holds the ladder, the storage key, the 90% default
  and `readStoredZoom()`; `main.tsx` re-applies it after `installApiBridge()` and **before** the
  first render, because Electron's zoom factor does not survive a restart — without that, every
  launch opens at 100% and visibly resizes a moment later. The main process returns the factor it
  actually applied after its clamp, and that is what gets stored, so the label can never drift from
  the window.
- **Verified:** clamp holds (3 → 1.5, 0.1 → 0.5); the ladder keeps 90% and 100% as exact stops and
  snaps stray values onto it (0.87 → 0.9, 1.4 → 1.5); the renderer→bridge→handler audit passes at
  262 call sites with `zoom` present in `FEATURES`; all 44 IPC modules still required *and* called;
  `tsc -b`, lint and the production build clean; suite 113/113. **Not visually verified** — that
  needs the app running, and the print-at-non-100%-zoom check needs the Windows box.
- **Files:** `backend/src/ipc/zoom.ipc.js` (new), `backend/src/ipc/index.js`,
  `backend/electron/main.js`, `frontend/src/lib/zoom.ts` (new),
  `frontend/src/components/ZoomControl.tsx` (new), `frontend/src/components/AppLayout.tsx`,
  `frontend/src/lib/{api,ipcBridge}.ts`, `frontend/src/main.tsx`

### 2026-08-12 — The remaining QA lows, cleared in one pass
- **post()/unpost() now re-check the restricted-account rule.** The guard only ran on create/update,
  so an ADMIN could leave a draft against a bank or Directors account and a USER could post it —
  demonstrated live before the fix. Added to **transfers, deposits, receipts, expenses, journal
  vouchers and settlements**, not just the two it was found on, since a partial fix leaves the same
  hole open elsewhere. `draftExpenses.confirm()` carries the session through too. Verified: a USER
  posting an admin-made cash→bank transfer, bank deposit and Directors JV is refused on all three,
  ADMIN unaffected.
- **`products.createBatch` no longer 404s on a `vendor_id` it discards.** The loop validated the
  caller's vendor and then overwrote every row with the system vendor anyway, so a batch failed
  outright whenever the form's vendor list had not loaded and it fell back to `?? 0` — a check that
  could only ever reject valid input. The in-batch duplicate key now uses the vendor the rows are
  actually written with.
- **Balances and ledgers now agree.** `accountBalance` defaulted its cutoff to today while
  `accountLedger` applied none, so an entry dated ahead of today appeared on the statement but not
  in the balance panel beside it — two numbers for one account, both called "balance".
  `netBalance`/`businessAccountBalancesAsOf` take an OPTIONAL cutoff now; absent means the whole
  book. Verified with an entry dated 2027-01-15: balance −4,019, ledger closing −4,019.
- **The Disposal screen stops offering actions that cannot succeed.** `cheques.repository.list()`
  now carries `receipt_status`, so a cheque whose receipt is still DRAFT shows a "Receipt not
  posted" tag instead of a Dispose button that always came back "This receipt is not posted yet".
- **Bank Accounts shows what each bank actually holds.** The screen could only ever set an opening
  balance. One `businessLedger({view:'summary'})` call fills a Balance column for every row rather
  than a round-trip per bank.
- **Cheque in Hand gained a way out, not duplicated actions.** A per-row "Dispose →" button switches
  to the Disposal tab (`ChequePage` passes `switchTab`). The tab stays read-only — the machinery
  belongs on one screen — but landing here with a cheque and no route to acting on it was the
  complaint that started all of this. **Also fixed while in there:** its TOTAL IN HAND used
  `colSpan={5}`, which covered the In Hand column itself and put the figure under **Status**. Same
  family as yesterday's Cheque Ledger bug, and one my cell-count sweep could not catch — the count
  was right, the placement was not.
- **Not done, by instruction:** the CREDIT/DEBIT naming clash between Deposits and Journal Vouchers.
- **Files:** `backend/src/services/{transfers,deposits,receipts,expenses,journalVouchers,settlements,draftExpenses,products,reports}.service.js`,
  `backend/src/repositories/{reports,cheques}.repository.js`,
  `backend/src/ipc/{transfers,deposits,receipts,expenses,journalVouchers,settlements,draftExpenses}.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/components/ChequesTab.tsx`,
  `frontend/src/pages/{ChequeInHandContent,ChequePage,BankSetupPage}.tsx`

### 2026-08-12 — Cheque Ledger total row was a column short
- **What:** the Cheque Ledger's on-screen total row had **8 cells against 9 headers**
  (`colSpan={6}` where it needed 7), so every figure sat one column to the left of where it
  belonged — the gold total under **Bank**, the received/issued split under **Amount**, spilling
  toward Reversed. Reported from a screenshot.
- **How fixed:** `colSpan={7}` + amount + one empty cell = 9. The received/issued split moved
  alongside the label and was spelled out ("Received … · Issued …" rather than "R: … / I: …") —
  Reversed is a badge column barely wider than the word and cannot hold two figures. The print
  table's cell count was already right but had the same cramming, so it got the same treatment and
  now matches the screen.
- **Then swept the whole app for the same class of bug:** a script comparing header count against
  total-row cells across every table, 42 total rows. One more real mismatch — `ChequesTab`'s printed
  report was one cell short (the Status column had no footer), fixed the same way. The other eight
  flags were artifacts of the scan, verified by hand and dismissed: grouped `<th colSpan={2}>`
  headers (OverallTrail), a computed `colSpan={3 + colors.length}` (ReportStock), and conditional
  columns behind `{showDate && <th/>}` (Cash Book) — none of which a regex can count.
- **Note for next time:** `tsc` cannot see this and neither can lint. A cell-count check is worth
  running whenever a table's columns change — this is the second time a miscounted row has shipped.
- **Files:** `frontend/src/pages/ChequeLedgerContent.tsx`, `frontend/src/components/ChequesTab.tsx`

### 2026-08-12 — Two QA mediums: bill-number sort, and deposited cheques vanishing
- **Bill numbers sorted as text.** `BiltyUpdatePage`'s "Sort by Bill No" used a bare
  `localeCompare`, so `BILL-10` came before `BILL-2` and `BILL-9` — wrong for any customer past
  their ninth bill. Now passes `{ numeric: true, sensitivity: 'base' }`, the same options
  `ChartAcSetupPage` and `BusinessAcSetupPage` already use for account codes. Verified:
  `BILL-2, BILL-9, BILL-10, BILL-21, BILL-100`.
- **A deposited cheque disappeared from the Disposal tab.** The status filter defaults to "open",
  which meant PENDING/PARTIALLY_ENDORSED only — so the moment a cheque was fully deposited its row
  dropped out of the default view. Since **Mark Cleared renders only on a DEPOSITED row**, the
  button became unreachable unless the operator knew to switch the filter by hand. Banking a cheque
  does not settle it: the bank has not confirmed it, and clearing is the next thing someone must do
  to it. `OPEN_STATUSES` now includes DEPOSITED and the option reads "Open (not yet cleared)".
  Verified against a live DEPOSITED cheque — hidden under the old rule, shown under the new, with
  Mark Cleared on the row. `unallocatedFor` returns 0 for a fully deposited cheque, so Dispose stays
  hidden on it and the Unallocated total is unchanged.
- **Left alone deliberately:** the "Cheque in Hand" tab still lists PENDING/PARTIALLY_ENDORSED only.
  That tab answers "what is physically still with us", and a banked cheque is not.
- **Files:** `frontend/src/pages/BiltyUpdatePage.tsx`, `frontend/src/components/ChequesTab.tsx`

### 2026-08-11 — UC-03 closed on the read side, and on Transfers/Deposits
- **What:** the two remaining holes in the USER rule, both closed by the same mechanism the write
  side already used. (1) **Reports.** `payment-trail` was the only report channel that received the
  session, so a USER could pull the balance and full ledger of any bank or Directors account through
  the Reports Hub. `account-ledger`, `account-balance`, `business-ledger`, `overall-trail` and
  `overall-search-ledger` now take it. (2) **Transfers and Deposits.** Neither service called
  `assertAccessible` at all — the pages are hidden from a USER, but the channels accepted anything,
  and every account these two documents touch is a bank.
- **How:** two helpers in `reports.service.js`. `assertReadable({ba_id, ac_id}, session)` rejects a
  restricted account by id — it takes `ac_id` too, because `reports:account-ledger` accepts either
  and BANK ACCOUNTS / Directors Drawings are themselves chart accounts a USER could name directly.
  `visibleTo(session, rows)` drops restricted rows from a list rather than throwing, because asking
  for "every account" is a legitimate request that should simply return fewer rows. Both follow
  `assertAccessible`'s existing contract: **no session means an internal caller** (vendorLedger, the
  Cash Book) and is unfiltered — only a request that arrived with a session is judged.
  `businessAccountsWithCategory()` gained `ca.is_restricted` to make the filtering possible.
- **Verified by role** on a database built from nothing — USER: bank ledger ❌, bank balance ❌,
  Directors ledger ❌, BANK ACCOUNTS by `ac_id` ❌, a customer's ledger ✅; business ledger lists 10
  accounts to a USER vs 12 to an ADMIN, with zero restricted rows among them; transfer to a bank ❌,
  deposit into a bank ❌; ADMIN unaffected on all of them. Full suite 113/113.
- **The Overall Trail collapses rather than filters** (client's choice, 2026-08-11). Plain filtering
  left the trial balance 230,800 out — and that gap *was* the restricted total, so it hid nothing
  while breaking the report. A USER now gets one line, "Restricted accounts (administrator only)",
  carrying their combined net: 15 rows either way, debit 315,250 = credit 315,250, difference 0 for
  both roles, with `QA Bank` named only for the ADMIN. The row has no `ba_id`/`ac_id` and a new
  `is_aggregate` flag; `OverallTrailContent` keys its drill-down off that flag, so the row renders
  un-clickable instead of asking the backend for a ledger with neither id. **Caveat worth
  remembering:** with only ONE restricted account carrying a balance the aggregate equals that
  account's balance — the collapse hides which accounts and how they split, not the total.
- **Files:** `backend/src/services/reports.service.js`, `backend/src/repositories/reports.repository.js`,
  `backend/src/ipc/reports.ipc.js`, `backend/src/services/transfers.service.js`,
  `backend/src/services/deposits.service.js`, `backend/src/ipc/transfers.ipc.js`,
  `backend/src/ipc/deposits.ipc.js`

### 2026-08-11 — Cheque disposal un-restricted; the USER rule stated plainly
- **What:** removed `requireRole('ADMIN')` from all six cheque disposal channels and the `adminOnly`
  flag from the Cheque page's Disposal tab, then covered the same ground properly with the
  account-level guard.
- **Why it was wrong:** traced with `git log -S`. The on-screen restriction originated in Subhan's
  old Receipts "Cheques Disposal" tab (`73bbb2ce`, 4 Aug), carried across to the new Cheque page
  (`c8125838`), and I then hardened it into the API (`3c6cadf4`) citing UC-03 point 3 — "the API
  enforces the same rule server-side". The flaw: UC-03's restriction list is *only* Cash at Banks and
  Directors Expenses – Drawings, and the doc explicitly says the restriction is about visibility,
  "not the ability to record a bank or director's-drawings transaction". I enforced an inherited UI
  behaviour instead of the specified rule. It showed: a USER could receive a cheque and then do
  nothing with it, yet could still `reverse-allocation` — undo an endorsement they were barred from
  making. **Client confirmed 2026-08-11: a USER is restricted to those two heads and everything
  under them; everything else is open.**
- **The guard that replaces it:** opening the channels exposed two accounts a USER must not reach —
  `deposit`'s bank (every bank is under the restricted head) and `endorse-to-expense`'s
  `target_ba_id` (could be Directors Drawings). All three targeting actions now take the session and
  call `assertAccessible`, the same account-level guard receipts/expenses/settlements/JV use.
  `bounce`/`return-to-sender` stay unguarded on purpose: their target was fixed at disposal time, and
  blocking a USER from recording a bounce would recreate the dead end.
- **Verified by role** on a database built from nothing — USER: endorse to vendor ✅, endorse to an
  expense head ✅, deposit into a bank ❌, endorse to Directors ❌; ADMIN: both ✅. Ledger nets to
  zero; full suite still 113/113.
- **Consequence worth flagging:** a USER can no longer bank a cheque at all, since every bank is
  restricted. That follows from the rule as stated rather than contradicting it, but it is the one
  outcome the client may not have pictured.
- **Files:** `backend/src/ipc/cheques.ipc.js`, `backend/src/services/cheques.service.js`,
  `frontend/src/pages/ChequePage.tsx`, `System_architecture/use_cases.md`

### 2026-08-10 — Bank balances made visible: directory column + Transfer page panels
- **What:** two places to read a balance that previously had none. (1) The Business Ledger
  directory (Reports Hub → Business Ledger) gained a **Balance** column — `businessLedger({view:
  'summary'})` had always returned `closing_balance` on every row and the table simply never
  rendered it, so reading a bank or cash balance meant opening one statement at a time. (2) The
  **Transfer page** now shows both sides' balances as you pick them, and the Deposit form shows its
  target's — the one screen where you need to know the money is actually there before moving it.
- **How:** `AccountBalancePanel` gained a `variant` prop (`'party'` default | `'money'`). Its
  Receivable/Payable wording is right for Receipts/Expenses but reads as nonsense on a bank
  ("Receivable 349,000"), so `'money'` says In Hand / Overdrawn / Empty instead. Same sign
  convention either way — positive is a debit balance — only the words change; Receipts and Expenses
  are untouched. The directory column uses **Dr/Cr** rather than either wording, because that list
  mixes customers, vendors, employees, banks and expense heads in one table, and the statement's own
  columns already say Dr/Cr.
- **Gotcha:** the first version bumped the panels' `refreshKey` inside `refreshTransfers`/
  `refreshDeposits`, which the mount effect also calls — that turned a clean call into a
  `react-hooks/set-state-in-effect` error. Moved to the six save/post/delete handlers instead
  (`bumpBalances()`); the panels fetch on mount by themselves anyway. Changed files add **zero** new
  lint problems over baseline (TransferPage 1 and ReportKhaataPage 1 were both pre-existing,
  verified by linting the stashed originals).
- **Data correction:** two cheques deposited into Meezan (12,000 + 45,000) by an app instance still
  running the pre-fix `deposit()` had left no ledger rows. Migration 019 had already run, and it is
  a one-shot, so it did not pick them up — cleared its `schema_migrations` row and re-ran the
  (idempotent) backfill. Meezan Bank 292,000 → **349,000**, CHEQUES IN HAND 237,000 → 180,000,
  ledger nets to zero, no unbalanced document. Worth knowing for the rollout: the one-shot is
  correct for the upgrade path (install the new build → 019 backfills what exists → `deposit()`
  writes its own rows from then on), but any deposit made by an OLD instance after 019 has run needs
  the same manual re-run.
- **Files:** `frontend/src/components/AccountBalancePanel.tsx`, `frontend/src/pages/TransferPage.tsx`,
  `frontend/src/pages/ReportKhaataPage.tsx`

---

## Account setup — batch entry, and the two structural accounts protected

### 2026-08-10 — Going-live prep: dozens of accounts to create, safely
- **Framing established before building.** The user's real database `wentox` was found to be
  **already clean** — 17 chart accounts, 1 business account, zero customers/vendors/ledger rows. All
  demo data is confined to `wentox_demo`. And the system is **already generic**: nothing is
  hardcoded per account except the reserved *codes*, which the engine resolves by code, never by
  name or id. So the work was not "make it generic" — it was **volume** and **safety**.
- **Piece 1 — batch entry.** `businessAccounts.service#createBatch({ ac_id, accounts })`, mirroring
  `products.service#createBatch` rather than inventing a second pattern: every row validated before
  any is written, failures returned as `{ index, message }`, serials drawn per row **inside** the
  transaction so codes stay contiguous and concurrent batches cannot collide on
  `UQ_business_accounts_code`. Opening balances flow through the existing `syncOpeningEntries`, so a
  batched account posts its `OPENING` pair like any other. New `business-accounts:createBatch`
  channel; `businessAccounts` was already in `ipcBridge.ts`'s FEATURES — **verified rather than
  assumed**, since a missing entry there is what silently broke `settlements` earlier.
- **Piece 2 — protect the structural accounts.** `remove()` previously only blocked *party-linked*
  accounts, so **Cash in Hand and Journal Voucher could both be closed** — verified by query, both
  reported `NOT protected`. Closing Cash breaks every transfer and the Cash Book; closing the JV
  account breaks Journal Voucher posting. Now refused, and flagged `is_reserved` for a **System**
  badge on the setup screen.
- **A bug my own verification caught, worth recording.** The first guard compared the *parent chart
  account's* code against the full reserved set — which flagged **all 41 accounts**, because every
  business account sits under a reserved head (CUSTOMERS ACCOUNTS, Directors Drawings, …). That
  would have frozen the entire chart. Narrowed to `STRUCTURAL_ACCOUNT_HEADS` = the two heads that
  hold exactly ONE seeded account and are resolved by `ac_id` (`getCashAccount`, `getJvAccount`).
  Re-verified: 2 flagged, ordinary heads still closable, party accounts still handled by their own
  guard. **Being under a reserved head is not the same as being structural.**
- **A second, pre-existing bug found on the way:** `ApiError.badRequest(message, code)` accepted no
  `details` argument, so the `{ errors: [{ index, message }] }` that **`products.service#createBatch`
  has always passed** was silently discarded — a failed product batch could only ever say "one or
  more rows are invalid" with no way to mark the row. `ipc/wrap.js` was already forwarding
  `err.details`; only the factory dropped it. Added the parameter, matching `conflict()`. Fixes the
  products batch as a side effect.
- **Verified** on `wentox_demo`: an invalid row rejected the whole batch with both offending indices
  and wrote nothing (41 accounts before and after); a valid batch of 5 produced contiguous codes
  `4000030004`–`0008`; the two rows carrying opening balances each got 2 `OPENING` ledger rows with
  the trial balance still at difference **0**; a `USER` batching under Directors Drawings was
  refused; Cash and JV refused closure while an ordinary expense head still closed.
  `tsc -b` clean, `BusinessAcSetupPage` lint count identical to baseline (1).
- **Files:** `backend/src/errors/ApiError.js`,
  `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/ipc/businessAccounts.ipc.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/BusinessAcSetupPage.tsx`

---

## Opening balances are now real ledger entries (double-entry closed)

### 2026-08-10 — The one place the books did not balance
- **The hole:** `business_accounts.opening_balance` was a stored number that `netBalance()` added
  into an account's balance with **no counter-entry anywhere**. Every other document in the system
  posts two legs; an opening balance posted one. Proved before building: with none set, the trial
  balance was 2,357,736.60 on both sides; one 100,000 opening balance on a single customer threw it
  out by **exactly 100,000**, while `ledger_entries` itself still netted to zero — it never saw the
  opening balance at all.
- **Why it had become urgent:** opening balances were made enterable on five screens earlier the
  same day, and 2,000+ legacy accounts are due to be imported carrying balances. Zero existed in the
  database, so this was the cheapest possible moment — nothing to backfill.
- **Fix:** new reserved chart account **OPENING BALANCE EQUITY** (`200003`, under LIABILITY — there
  is no EQUITY class and what the business owes its owners is the closest fit). Setting an opening
  balance now writes a real `source_type='OPENING'` pair dated `opening_date`: positive → Dr account
  / Cr equity, negative → the reverse. **The schema anticipated exactly this** — `'OPENING'` was
  already in `CK_ledger_entries_src` and `ledger_entries`' own comment described these rows. It was
  designed and never built, so **no migration was needed at all**.
- **`opening_balance` stays the INPUT; the rows are DERIVED** and replaced whole on every change —
  delete-then-insert rather than update, because an opening balance can be cleared (no rows) or flip
  sign (the legs swap accounts), both of which an UPDATE would have to special-case.
- **Two places had to stop adding the stored column**, or it would double-count against its own
  rows: `netBalance()` (both ba_id branches) and `businessAccountBalancesAsOf()` (the trial balance).
- **Self-healing by design.** `syncOpeningEntries()` runs in its own transaction because party
  creation commits the business account inside a transaction it cannot join — so a failure could
  leave the stored input without its rows. `db/seeds/opening-balances.js` re-syncs every account on
  startup, which is both the backfill for pre-existing values and a standing repair. All four party
  creates (vendor/customer/employee/bank) sync after their commit, so a new account does not have to
  wait for a restart.
- **Verified:** the same 100,000 opening balance that previously broke the trial balance now leaves
  it at **2,457,736.60 / 2,457,736.60, difference 0**, with `ledger_entries` still netting to zero.
  Flipping to −40,000 kept it balanced; clearing removed both rows and returned the trial balance to
  its starting figures exactly. The account's own Khaata now opens with an "Opening Balance" row
  (Dr 50,000, dated 31-Dec-2025) and the equity account mirrors the total at −50,000. Cash Book,
  Sale Report, Vendor Report and Business Ledger all unchanged.
- **Still open from the same discussion, neither required for this fix:** routing the 13
  ledger-writing repositories through one guard that refuses unbalanced pairs, and surfacing a
  debits-vs-credits check in the app.
- **Files:** `backend/src/constants/reservedAccounts.js`,
  `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/services/{vendors,customers,employees,bankAccounts}.service.js`,
  `backend/src/repositories/reports.repository.js`,
  `backend/src/db/seeds/opening-balances.js` (new), `backend/src/db/seeds/run.js`

---

## Cheque screens — one standard column order everywhere

### 2026-08-10 — Six cheque tables, five different orders, now one
- **What was asked:** wherever cheque detail is shown, lead with
  **Received Date · Party Name · Cheque No · Due Date · Amount · rest**.
- **Survey first:** six tables across four screens, in five different orders — Disposal summary
  (print) and detail (screen), Cheque in Hand, Cheque Ledger (print + screen), Cheque Returns.
- **"Due date" = `cheques.cheque_date`, and that is evidenced, not assumed:** the index over it is
  named `IX_cheques_due` and commented "§12 cheque-due alerts". The alerts already treat the date
  written on the cheque as when it falls due; the screens were calling the same column "Cheque Date"
  and "Date on Cheque". Relabelled to **Due Date** so the UI agrees with the behaviour.
- **Two places the standard does not fit as written, both raised before building:**
  1. **Issued cheques** (ones we wrote, from `expenses`) have no received date and no receiving
     party — their party is who we *paid*. User chose an equivalent layout rather than blank
     columns: **Issue Date · Paid To · Cheque No · Due Date · Amount**.
  2. **Cheque Ledger is an event log**, not a cheque list — its date column is the *event* date and
     deliberately differs per row. It keeps that as the leading date and gains Due Date as its own
     column, so the field order still reads the same left-to-right.
- **One backend addition:** `cheque_allocations` rows carried no cheque date, so the Returns table
  had no Due Date to show for an endorsed cheque. Added `ch.cheque_date` / `ch.cheque_received_date`
  to that query.
- **A bug caught by reading rather than by tooling:** reordering the on-screen Cheque Ledger left a
  duplicate `{r.party}` cell after Event, so the row had 10 cells against 9 headers — every column
  from Bank rightward would have rendered one place off. `tsc` cannot see this (JSX cell counts are
  not typed) and it produces no error, just silently wrong columns. Wrote a header-vs-cell counter
  across all six tables afterwards; all now match (9/9, 9/9, 6/6, 7/7, 7/7).
- **Also updated the Disposal Excel export** to the same order — it had its own hardcoded header
  list that would otherwise have disagreed with the screen it exports.
- **Verified:** `tsc -b` clean; ChequesTab 0 lint errors, the other three carry 1 each — all the
  pre-existing `react-hooks/set-state-in-effect` on their mount loaders, none introduced here (the
  changes are JSX reordering only).
- **Note:** a `git stash` used for a lint baseline comparison was interrupted by a command timeout
  before its `pop`, leaving the work stashed. Recovered intact with `git stash pop`. Avoid
  stash-based baselines inside a single timed command.
- **Files:** `backend/src/repositories/cheques.repository.js`, `frontend/src/lib/api.ts`,
  `frontend/src/components/ChequesTab.tsx`,
  `frontend/src/pages/{ChequeInHandContent,ChequeLedgerContent,ChequeReturnsContent}.tsx`

---

## Products — one system vendor, "Manufacturing Product" (migration 017)

### 2026-08-10 — The product form's vendor field locked to a single system vendor
- **What was asked:** the vendor input on Add New Product "doesn't have any work here", so point it
  permanently at a Manufacturing Product account that cannot be changed.
- **Two corrections established before building, both confirmed with the user:**
  1. **It could not be a business account.** `articles.vendor_id` is `NOT NULL` with an FK to
     `dbo.vendors`, so the row has to be a **vendor**; creating one auto-creates its business
     account under VENDORS ACCOUNTS, which gives the account for free.
  2. **The field is not decorative.** It scopes batch numbering (`batch_no = MAX + 1` per vendor,
     protected by `UQ_articles_vendor_batch`) and the duplicate-name rule (name + vendor). Both
     simply become global now, which is arguably better — two vendors could previously each hold a
     "P-101".
- **The blocker, and why it dissolved:** moving the 5 existing articles onto one vendor violates
  `UNIQUE (vendor_id, batch_no)` — three shared batch 1 and two shared batch 2, legal only because
  they sat under different vendors. Renumbering meant rewriting numbers the schema calls
  "immutable". Traced `batch_no` end to end first: **never typed, never edited, never rendered on
  any screen, and read by nothing except its own MAX + 1.** The user confirmed batch numbers mean
  nothing outside the app, so renumbering is invisible. That turned a blocking decision into a
  non-issue — worth the twenty minutes it took to check rather than warning about a promise nothing
  depended on.
- **How it was done:** migration 017 adds `vendors.is_system` with a **filtered unique index**
  (`WHERE is_system = 1`), so at most one can ever exist. A flag, not a name match — `dbo.vendors`
  has no code column and deliberately no `UNIQUE(name)`, so matching on the string would break the
  moment anyone added a second "Manufacturing Product". The row itself is seeded in
  `db/seeds/manufacturing-vendor.js`, not the migration, because it needs the VENDORS ACCOUNTS
  chart account and reserved accounts are seeded *after* migrations run.
- **The move is one statement** — `UPDATE … SET vendor_id = @mfg, batch_no = ROW_NUMBER() OVER
  (ORDER BY article_id)`. Setting the vendor first and renumbering second would trip the unique
  constraint mid-flight. Idempotent: re-running matches nothing.
- **The lock is server-side.** `products.service.js#create()` and the batch-create path both ignore
  whatever `vendor_id` arrives and resolve the system vendor themselves, so a disabled input is not
  the only guard. `vendors.service` now refuses to rename or deactivate the system row — either
  would silently break product creation.
- **Hidden where it would invite a wrong entry** (user's choice): excluded by default from the
  Purchase / Purchase Return vendor dropdowns, Vendor Report, the Expenses "who to pay" picker,
  Vendor Setup and the Cheques tab. Two callers pass `includeSystem: true` — the product form, and
  Product Ledger's read-only "Company (Vendor)" filter, which the user chose to keep and which
  would otherwise be unable to select the only vendor that has any products. `ReportStockPage` keeps
  the default: its vendor list is the Vendor Stock tab (raw materials from real suppliers), and you
  do not buy materials from your own factory.
- **Verified:** all 5 articles moved and renumbered 1–5; re-running the seed moved nothing; a
  product created while deliberately naming a real vendor stored as **Manufacturing Product**;
  renaming and deleting the system vendor were both blocked; `vendors.list()` returns 3 vendors by
  default and 4 with `includeSystem`. `tsc -b` clean, both changed pages' lint counts identical to
  baseline (1 and 1).
- **Files:** `backend/src/db/migrations/017_manufacturing_product_vendor.sql` (new),
  `backend/src/db/seeds/manufacturing-vendor.js` (new), `backend/src/db/seeds/run.js`,
  `backend/src/repositories/vendors.repository.js`,
  `backend/src/services/{vendors,products}.service.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/{ProductSetupPage,ProductLedgerContent}.tsx`

---

## Opening balances — settable on every account-opening screen, and editable

### 2026-08-10 — Was create-only on two screens and editable on none
- **What was actually wrong** (narrower and wider than "we can't edit it"):
  - **Business Account** and **Bank** screens already asked for an opening balance on create.
  - On the Business Account screen the fields were wrapped in `{!selectedId && …}` — **hidden
    entirely when editing**, and `businessAccounts.service#update()` only ever passed
    `name`/`region_id`/`city_id` to the repository, whose UPDATE didn't mention the opening columns
    at all. So there was no route to change one after creation, on any screen.
  - **Vendor, Customer and Employee** never asked, despite each auto-creating a business account —
    which matters now that 2,000+ legacy accounts are coming over with balances attached.
- **Fix:** `repository.update()` now writes the pair; `updateOpening()` added for the party screens,
  which own name/region/city on their own row and must not have them overwritten. The paired
  both-or-neither check moved into a shared `validateOpeningPair()` used by create, update and all
  four party services, so every screen rejects a half-filled pair identically. Vendor, Customer and
  Employee forward the pair into `createUnderChartCode`'s extra, exactly as `bankAccounts.service`
  always has.
- **A data-loss trap caught before it shipped.** The party pages cannot *show* the current opening
  balance on edit — it lives on the linked business account and none of those three repositories
  join it. An untouched edit form would therefore have sent blanks and **wiped the opening balance
  on every unrelated rename**. `setOpening()` now applies only when the caller actually supplied one
  of the keys. Consequence, stated rather than papered over: party screens can **set and change** an
  opening balance but not clear it; the Business Account screen (which does load the stored values)
  remains the place to view, change or clear one.
- **`OpeningBalanceFields.tsx`** shared by all four screens so the wording, the both-or-neither hint
  and the warning cannot drift between copies. When editing an existing account it warns plainly
  that this **rewrites past balances and reports** with no reversing entry — because
  `opening_balance` is a stored input `netBalance()` adds in, not a ledger row — and points at a
  Journal Voucher for anything that actually happened. Per the user's choice, no role gate.
- **Verified** end to end: vendor created with 25,000 opening → balance 25,000; changed via the
  vendor screen → 40,000; changed via the Business Account screen (the path that previously had no
  effect) → 12,345; cleared → 0; a rename carrying no opening keys left 7,000 **untouched**; an
  unpaired balance was rejected; and an opening dated 2027 correctly counted as 0 today. `tsc -b`
  clean; all four pages' lint counts identical to baseline (1/1/2/1) and the new component 0.
- **Files:** `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/{businessAccounts,vendors,customers,employees,bankAccounts}.service.js`,
  `frontend/src/components/OpeningBalanceFields.tsx` (new), `frontend/src/lib/api.ts`,
  `frontend/src/pages/{BusinessAcSetupPage,VendorSetupPage,CustomerSetupPage,EmployeeSetupPage}.tsx`

---

## Bridge allow-list — `settlements` and `journalVouchers` were never registered

### 2026-08-10 — window.api.<feature> undefined; symptom surfaced as an empty dropdown
- **Reported as** "when I select account in JV it says no matching option". The account fetch was
  fine. `frontend/src/lib/ipcBridge.ts` keeps an explicit `FEATURES` allow-list and neither new
  feature was in it, so `window.api.journalVouchers` was **undefined** and the call threw a
  TypeError rather than returning a failed ApiResult. On the JV page that aborted the whole loader
  (`Promise.all([listBusinessAccounts(), journalVouchers.account()])`), so `setAccounts` never ran
  and the dropdown had zero options.
- **`settlements` was missing too** — so the Receipts "Endorse" option shipped in `6c07a777` was
  broken in exactly the same way, and reported as working. Backend verification ran against the
  services directly, which never touches the bridge, so the gap was invisible to it. **Lesson:
  service-level verification does not prove a feature reaches the screen.**
- **Also keyed wrongly:** `window.api['journal-vouchers']`. The bridge keys by the CAMEL feature
  name and derives the kebab wire channel itself, so that lookup would have stayed undefined even
  once registered.
- **Root cause of the miss:** `backend/CLAUDE.md`'s "adding a feature" checklist said to add the
  name to `electron/preload.js`'s `FEATURES` array. That array does not exist there — preload has
  exposed a single `__ipcInvoke` primitive since the contextBridge/Proxy fix, and the real list is
  in `ipcBridge.ts`. The checklist has been corrected, with a note on the failure mode, and
  `ipcBridge.ts` now says why the allow-list fails loudly-but-elsewhere.
- **Files:** `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`, `backend/CLAUDE.md`

---

## Journal Voucher (UC-40, migration 016)

### 2026-08-10 — Goodwill written off a party's balance, with its own account and ledger
- **What:** a customer with an outstanding payable asks for an *eidi* — a concession on what they
  owe. Not a payment, not a discount on the sale: compensation granted afterwards. The amount comes
  off their balance and the cost lands on a dedicated **JOURNAL VOUCHER** account. Any business
  account can be named, not just customers. New page under Transactions with two tabs: entry, and
  the JV account's own ledger.
- **Two things it is deliberately NOT, both flagged to the user before building:**
  - **Not commission.** `receipts.commission` (§7) only exists attached to a receipt and only for a
    customer. A JV stands alone.
  - **Not a Deposit.** `dbo.deposits` (Module 4b) is structurally almost identical — a one-sided
    CREDIT/DEBIT adjustment against the *Miscellaneous Adjustments* chart account. The user chose to
    keep both rather than merge: a JV counters against a real **business account**, so "what have we
    given away in JVs" is an openable ledger instead of a figure buried in a mixed head.
- **Posts as** (both legs `ba_id`, `source_type='JOURNAL_VOUCHER'`): CREDIT → Dr JV BA / Cr party
  BA (what they owe us falls); DEBIT → the reverse (what we owe them falls). Both directions were
  the user's call — with any account selectable, the reverse case arrives eventually and adding it
  later would be a migration.
- **The JV account is a business account, not just a chart head** — that is what makes the ledger
  openable, since `ledger_entries` needs a `ba_id` to point at. Seeded like Cash is;
  `ensureCashBusinessAccount` was generalised to `ensureNamedBusinessAccount` and the cash-specific
  duplicate removed, so both reserved single-account heads share one helper.
- **Reports, per the user's explicit wording** ("shouldn't have a separate column — a separate row
  record that JV of this amount was applied"): Sale Report and Vendor Report gain a **row beneath
  the party**, shown only when non-zero, never a column and never folded into Payment Received or
  Net Sales. A JV reduces what is owed but is not money collected; folding it in would make
  collections read higher than the cash actually taken.
- **Guards:** `reason` is NOT NULL and rejected when blank — an unexplained write-off against a
  party balance is exactly the entry that gets questioned later. A JV against the JV account itself
  is blocked (both legs would land on one account). `assertAccessible` applies, so a USER cannot
  raise a JV against a restricted account.
- **Verified end to end** on `wentox_demo` with Ahmed Footwear: a 3,000 CREDIT moved the party
  **−3,000** and the JV account **+3,000**, the report row read 3,000 while **Payment Received
  stayed 134,500 unchanged**, both ledgers carried the reason ("Journal Voucher #1 — Eid
  compensation" / "JV #1 to Ahmed Footwear — Eid compensation"), the Cash Book showed nothing, a
  DEBIT of 500 moved the balance the other way, self-JV and blank-reason were both rejected, and
  unpost + delete restored both balances exactly. `tsc -b` clean; the two report pages' lint counts
  are identical to baseline (1 and 2), and the new page carries one — the `set-state-in-effect`
  pattern every page here shares, after the avoidable second instance was refactored out.
- **Files:** `backend/src/db/migrations/016_journal_vouchers.sql` (new),
  `backend/src/repositories/journalVouchers.repository.js` (new),
  `backend/src/services/journalVouchers.service.js` (new),
  `backend/src/ipc/journalVouchers.ipc.js` (new), `backend/src/ipc/index.js`,
  `backend/src/constants/reservedAccounts.js`, `backend/src/db/seeds/run.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/repositories/reports.repository.js`, `backend/src/services/reports.service.js`,
  `frontend/src/pages/JournalVoucherPage.tsx` (new), `frontend/src/lib/api.ts`,
  `frontend/src/pages/{SaleReportPage,VendorReportPage}.tsx`, `frontend/src/App.tsx`,
  `frontend/src/components/AppLayout.tsx`, `frontend/src/types/index.ts`,
  `System_architecture/{use_cases.md,database_schema_v4.3.md}`

---

## UC-03 — server-side role enforcement (was UI-only)

### 2026-08-10 — Restricted accounts guarded on the account, not the channel
- **The gap:** every cheque and expense IPC channel called `requireSession()` and nothing more.
  `requireRole` existed but only `backup` and `auth` used it. So role restriction was enforced
  *entirely by hiding things on screen* — exactly what UC-03 point 3 warns against ("hiding a nav
  item is never the only guard").
- **The request was "add requireRole to cheque and expense channels"; that alone would have been
  both too much and too little,** and the user agreed to the split after it was laid out:
  - **Too much** — 13 of those 22 channels are ordinary expense entry. Locking them stops a `USER`
    recording any expense, contradicting UC-03's own written decision that "Receipts/Expenses entry
    remain intentionally unrestricted for `User` — the restriction is about *visibility*".
  - **Too little** — the actual exposure is the **account**, not the channel. A `USER` blocked from
    `expenses:create` would simply have reached a Directors-Drawings account through
    `receipts:create` or `settlements:create`, neither of which is a "cheque or expense" channel.
- **Two pieces, both done:**
  1. **`requireRole('ADMIN')` on the six cheque disposal channels** (`deposit`,
     `endorse-to-vendor`, `endorse-to-expense`, `mark-cleared`, `bounce`, `return-to-sender`) — the
     ones the Cheque page already treats as admin-only, so nothing that works today stops working.
     Deliberately NOT the Returns actions (`reverse-allocation`, `bounceIssuedCheque`,
     `returnIssuedCheque`): a `USER` can do those today and could before the Cheque page existed —
     verified against `c8125838^` rather than assumed — so locking them would remove behaviour
     rather than close a gap.
  2. **`businessAccounts.service.js#assertAccessible(baId, session)`** — UC-03 point 4's 403.
     Called by expenses (on the resolved target), receipts, and settlements (**both** sides) on
     create and update. The guard lives on the account, so a new document type cannot forget it by
     picking a different channel name.
- **`session` omitted = trusted internal caller** (seeds, scripts). Those run as the machine, not a
  person; the ipc layer always has a real session and always passes it, which is where untrusted
  input actually arrives. Without this the demo seed would have started failing.
- **Verified with a real USER session against `USMAN BHATTI`** (under Directors Expenses - Drawings):
  `expenses.create`, `receipts.create` and `settlements.create` (as payee) **all blocked** with
  "This account is restricted to administrators"; the same USER against `Aslam Cutter` **allowed**;
  ADMIN against the restricted account **allowed**; a no-session internal call **allowed**. All
  services still load and list (expenses 13, receipts 16), cash book and alerts unchanged.
- **Docs:** UC-03's rework note said "server-side enforcement does not exist at all yet" — replaced
  with what is now actually enforced, including what is deliberately still open and why.
- **Files:** `backend/src/ipc/cheques.ipc.js`, `backend/src/ipc/{expenses,receipts,settlements}.ipc.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/services/{expenses,receipts,settlements}.service.js`,
  `System_architecture/use_cases.md`

---

## Cross-cutting — "today" was UTC everywhere; now local, and defined once

### 2026-08-10 — `src/utils/dates.js`; eight copies of a UTC date formatter replaced
- **What:** `new Date().toISOString().slice(0, 10)` had been copy-pasted into eight files as the
  definition of "today". `toISOString()` converts to UTC first, so in PKT (UTC+5) the server's
  "today" is still **yesterday between 19:00 and midnight local**. Every business date in WentoX is
  a local one — the pickers emit local dates, a business day is a local day — so this was simply
  wrong, for five hours a day, in eight places.
- **It was not cosmetic.** Found via Direct Settlement: a settlement dated today moved **no balance
  at all**, because `accountBalance()`'s `up_to_date` cutoff excluded it. Same cutoff made the
  Receipts/Expenses balance panel read stale every evening and opened the Cash Book a day behind.
- **A second, worse instance found during this sweep:** `cashBook()`'s month range was built as
  `new Date(y, m-1, 1).toISOString()`. That Date is LOCAL midnight, so converting to UTC shifted
  **both ends back a day** — "August" was really **31-Jul → 30-Aug**, silently including the
  previous month's last day and dropping the selected month's. Confirmed directly:
  `2026-07-31 -> 2026-08-30` before, `2026-08-01 -> 2026-08-31` after.
- **Fix:** new `src/utils/dates.js` — `toISODate()` (formats from local `getFullYear/getMonth/
  getDate` parts, no timezone conversion at all), `todayISO()`, `daysFromNowISO()`. One definition,
  imported everywhere, so a ninth copy cannot drift.
- **Changed:** the six document services' `resolveDateRange` (`saleBills`, `saleReturns`,
  `purchases`, `purchaseReturns`, `receipts`, `expenses` — Weekly/Monthly tabs), `reports.service`'s
  own `resolveDateRange` **and** its cash-book month range, and `alerts.service`'s
  `todayISO`/`cutoffISO`/`toISODate` — the last of which shifted **when a cheque-due alert fires**,
  not merely which rows a list showed.
- **Deliberately left alone: `salaryRuns.service.js`.** Its `period_month` normalisation is UTC on
  purpose and self-consistent (`Date.UTC` in, `getUTC*` out); changing it would be churn, not a fix.
- **`backend/CLAUDE.md` updated** — `src/utils/` is a new folder and the layer list is meant to be
  the truth about the structure.
- **Verified:** every changed service smoke-tested across weekly/monthly/overall
  (saleBills 2/2/14, saleReturns 0/0/3, purchases 0/0/6, purchaseReturns 0/0/2, receipts 5/6/16,
  expenses 4/4/13); `alerts.refreshAlerts()` returned 4 alerts; the August cash book now spans
  01–31 Aug and its summary reconciles (42,500 + 18,500 − 26,768 = 34,232).
- **Files:** `backend/src/utils/dates.js` (new), `backend/src/services/{saleBills,saleReturns,
  purchases,purchaseReturns,receipts,expenses,reports,alerts}.service.js`, `backend/CLAUDE.md`

---

## Direct Settlement — endorse a payment from the Receipts screen (UC-39, migration 015)

### 2026-08-09 — Debtor pays our creditor directly; no cash, bank or cheque involved
- **What:** on Receipts (Jamma), ticking **"Endorse this payment to another account"** reveals a
  *Pay To* picker. Saving writes a `settlements` row instead of a `receipts` row: the payer settles
  their debt by paying one of OUR creditors directly. Both obligations shrink and **no money passes
  through cash, bank or the cheque drawer**. Distinct from cheque endorsement (UC-27), which needs a
  physical cheque already in CHEQUES IN HAND — this needs no instrument at all.
- **Built as a standalone page first, then moved.** The user's follow-up was explicit: no new page,
  put it on Receipts. The page was deleted (`DirectSettlementPage.tsx`, its route, its NavPage entry
  and its sidebar item all removed); the service/repository/IPC layer survived unchanged, which is
  the payoff for having kept the document type separate from its UI.
- **Posts as** Dr `to_ba_id` (our creditor) / Cr `from_ba_id` (our debtor), `source_type='SETTLEMENT'`.
  **Both legs carry `ba_id` and neither carries `ac_id`.** With no chart account on either side there
  is nowhere for it to reach CASH IN HAND, a bank or CHEQUES IN HAND — the isolation is structural,
  not a rule every report must remember.
- **New table rather than reusing `dbo.transfers`,** which has the identical shape. Transfers means
  "money between OUR OWN accounts" and its schema note says "USED BY: every cash/bank balance (both
  sides); Cash Book"; `cash_and_bank.md` §10's balance formula includes transfers by definition.
  Overloading it would mean auditing every consumer of `source_type='TRANSFER'`. A separate table
  keeps "every TRANSFER is cash" true.
- **`payment_mode`/`cheque_no`/`cheque_date` are INFORMATION only** (user's choice over hiding the
  fields). They record how the *other two parties* transacted and select no posting target, since no
  mode can make a settlement touch our accounts. `CK_settlements_cheque` rejects a cheque number on
  a non-cheque mode rather than storing a contradiction. The ONLINE bank picker is hidden while
  endorsing — no bank of ours receives anything — and so is Commission.
- **Counts as payment in both party reports** (user's choice): Sale Analysis / Sale Report "Payment
  Received" via `from_ba_id`, Vendor Report "Payment Paid" via `to_ba_id`. The debt really was
  settled, so omitting it would leave a squared-up party looking permanently outstanding.
- **Two bugs caught while building:**
  1. The settlements subquery in `saleAggregateByCustomer()` was first written as
     `receiptWhere.replace('receipt_date', 'settlement_date')`. `String.replace` with a string
     argument swaps only the FIRST occurrence, so the `date_to` half kept pointing at a column
     `settlements` does not have — fine with no date filter, broken the moment a range was picked.
     Now built from its own column name.
  2. **`todayISO()` returned the UTC date, not the local one.** In PKT (UTC+5) that means between
     19:00 and midnight local, the server's "today" is still YESTERDAY. A settlement dated today
     moved no balance at all, because `accountBalance()`'s `up_to_date` cutoff excluded it — the
     balance panel read stale for five hours every evening, and the Cash Book opened on the previous
     day. Every business date here is a local one (the pickers emit local dates, a business day is a
     local day), so `reports.service.js#todayISO()` now formats from local parts with no timezone
     conversion. **The same UTC pattern exists in seven other services'
     `resolveDateRange` helpers** — those only affect the weekly/monthly filter convenience, not a
     balance, so they are flagged rather than changed.
- **Verified end to end** on `wentox_demo`: a 5,000 CHEQUE endorsement (Ahmed Footwear →
  Al-Madina Rubber) dated **local today** moved customer **−5,000** and vendor **+5,000**, left
  **Cash In Hand unchanged**, wrote explicit narrations on both ledgers ("Settled directly to
  Al-Madina Rubber" / "Settled directly by Ahmed Footwear"), showed nothing on the Cash Book, and
  unpost + delete restored both balances exactly. A cheque number on a CASH settlement was rejected.
  Migration 015 was extended in place rather than adding a 016, since it had not been pushed —
  the table was dropped, its `schema_migrations` row deleted, and the migration re-applied clean.
  `tsc -b` clean; ReceiptsPage's lint count unchanged from its pre-existing baseline.
- **Files:** `backend/src/db/migrations/015_direct_settlements.sql` (new),
  `backend/src/repositories/settlements.repository.js` (new),
  `backend/src/services/settlements.service.js` (new), `backend/src/ipc/settlements.ipc.js` (new),
  `backend/src/ipc/index.js`, `backend/src/repositories/reports.repository.js`,
  `backend/src/services/reports.service.js`, `frontend/src/pages/ReceiptsPage.tsx`,
  `frontend/src/lib/api.ts`, `System_architecture/database_schema_v4.3.md`,
  `System_architecture/use_cases.md`

---

## Cash Book — cheque endorsements were missing from the outflow columns

### 2026-08-09 — `cheque_allocations` added as a third Cash Book source; stale doc note corrected
- **Cause was a bad assumption, not a bad design.** `use_cases.md` UC-37 carried a note saying
  cheque allocations "do not exist yet"; that was taken at face value while building the Cash Book,
  so `cashBookNonCashRows()` read only `receipts` and `expenses`. Cheque endorsement has in fact
  been built for some time — eleven `cheques:` IPC channels (`endorse-to-vendor`,
  `endorse-to-expense`, `reverse-allocation`, …), UC-27 marked ✅, and live `cheque_allocations`
  rows in the demo data. **Lesson already on record and not applied: design docs are historical
  intent, not current state — check the code.**
- **Symptom:** a VENDOR_PAYMENT endorsement never appeared anywhere on the Cash Book. Verified
  before the fix — allocation #3 (20,000, dated 2026-08-01) produced a completely empty report for
  that date, despite UC-37 explicitly requiring "an endorsed cheque posts as an outflow on its
  allocation date". EXPENSE_PAYMENT endorsements were fine by accident: they carry an `expense_id`,
  so their `expenses` row (`payment_mode='CHEQUE_ENDORSED'`) was already being picked up.
- **Fix:** third UNION branch over `cheque_allocations`, filling Payments Cheq./Online and naming
  the target vendor. **VENDOR_PAYMENT + ACTIVE only** — the other two dispositions are excluded
  because including them would double-count, which is the whole reason this needed care rather than
  a blanket join:
  - `EXPENSE_PAYMENT` → already present via its `expenses` row (see above).
  - `DEPOSIT` → an internal asset move (Dr bank / Cr CHEQUES IN HAND), not new money; the receipt
    that brought the cheque in already appears as a Receipts Cheq./Online row on its own date.
  - `REVERSED` → the bounce/return cascade already put the money back.
- **Verified** on `wentox_demo` across all three allocation rows: 01-Aug now shows
  `Al-Madina Rubber | CHEQUE 91002233 | Payments Cheq./Online 20,000` with `cash_in_hand` unchanged
  at 42,500 (view-only, as required); 08-Jul (allocation #2, REVERSED) and 23-Jun (allocation #1,
  DEPOSIT) both correctly still show nothing; the August month view shows the endorsement exactly
  once, no duplication.
- **Docs:** UC-37's note rewritten to describe what actually runs, including why the two
  dispositions are excluded, with an explicit dated correction of the false "does not exist yet"
  claim so the next reader does not repeat it.
- **Files:** `backend/src/repositories/reports.repository.js`,
  `backend/src/services/reports.service.js`, `System_architecture/use_cases.md`

---

## Receipts (Jamma) — Post/Unpost buttons were missing entirely

### 2026-08-09 — Every receipt entered through the UI was stranded as an invisible DRAFT
- **Found via a user report** ("I paid Aslam Cutter 2000 but its balance doesn't update"). The
  entry turned out to be on the wrong screen — recorded as Jamma (money received) rather than Naam —
  but chasing it exposed a much bigger, pre-existing bug behind it.
- **The bug:** `receipts.service.create()` always inserts `status='DRAFT'` and only `post()` writes
  `ledger_entries`. `receipts:post` / `receipts:unpost` exist on the backend **and** are declared in
  `frontend/src/lib/api.ts` — but `ReceiptsPage.tsx` never called either one. Confirmed pre-existing
  with `git show HEAD:...ReceiptsPage.tsx` → zero `receipts.post`/`unpost` calls. So **every receipt
  ever entered through that screen sat as a DRAFT forever and never reached the ledger, any balance,
  or any report.** The 13 receipts in the demo dataset look fine only because
  `dev-sample-data.js` calls `receiptsService.post()` directly in code, bypassing the UI.
  The page's one "Confirm" button belongs to the separate `draft_receipts` table — a different
  feature that happens to share the word.
- **Fix:** Post / Unpost buttons mirroring `ExpensesPage#handlePost/handleUnpost` (the user chose
  this over auto-posting on save, keeping the two money screens consistent). Edit is now hidden once
  posted, matching Expenses. `CHEQUE_IN_USE` from unpost surfaces in the banner rather than the
  button being hidden — same choice ExpensesPage already made for its own reversal guard.
- **Also made the state visible**, since an unposted receipt looked identical to a posted one: the
  form header now shows an amber "Not Posted" badge (tooltip: "Saved but not yet in the ledger")
  instead of showing nothing at all when unposted. Fixed the receipts list's stale "Customer" column
  header → "Account", left over from migration 014.
- **Data cleanup:** deleted the user's two duplicate 2,000 DRAFT receipts (#1004, #1005) against
  Aslam Cutter at their request. Neither had posted, so nothing needed reversing; his balance is
  unchanged at 1,032 (9,000 Dr from expense #9 less 7,968 Cr from wage run #1). The real payment
  will be entered by the user as an Expense.
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`

---

## Receipts / Expenses — account balance shown on selection

### 2026-08-09 — "Balance before → after" panel on both money-entry screens
- **What:** Picking an account on Receipts (Jamma) or Expenses (Naam) now shows its balance, the
  effect of the entry being typed, and the balance that will result — live, before saving. This is
  UC-25 steps 1 and 4 ("the current outstanding balance is shown inline" / "the screen shows BOTH
  figures explicitly"), which were specified but never built.
- **New `reports:account-balance`** → `reports.service.accountBalance({ ba_id })` →
  `repository.netBalance()`. Deliberately **not** `accountLedger()`: that fetches every ledger row
  just to derive a closing balance, which is far too much work to put behind a dropdown's onChange.
  `netBalance()` sums in SQL **and** adds `business_accounts.opening_balance`, which a plain
  `ledger_entries` sum would miss for an account whose history predates WentoX.
- **Signs run opposite on the two screens**, which is the whole reason the panel takes signed
  `lines` from its caller rather than computing them itself: a receipt **credits** the selected
  account (`−amount`, `−commission`), an expense **debits** it (`+amount`). Commission's line is
  suppressed for non-customer accounts, matching where the field itself is hidden.
- **Shared `AccountBalancePanel.tsx`** so the two screens cannot drift. Labels are Receivable /
  Payable / Settled on the absolute value rather than Dr/Cr — the ledger reports already carry the
  accounting vocabulary; this screen is read by people thinking in who-owes-whom.
- **Two correctness details:** an in-flight request is cancelled when the account changes, and the
  fetched value is stored *with* its `ba_id` so switching accounts derives back to "loading" instead
  of briefly showing the previous account's balance. The second also keeps the component free of
  `react-hooks/set-state-in-effect`, which a synchronous reset inside the effect would have tripped.
  A `refreshKey` bumped after every post/unpost/confirm stops the figure going stale.
- **Verified** against `wentox_demo`: `accountBalance()` matched `accountLedger().closing_balance`
  plus `opening_balance` for four accounts across both signs (customers positive/Receivable,
  vendors negative/Payable). Then posted a 5,000 + 500 commission receipt against a vendor account —
  actual post-save balance `-162,650` equalled the panel's predicted `before − amount − commission`
  exactly; unpost + delete restored `-157,150`. `tsc -b` clean, new component lints clean, and the
  two pages' pre-existing lint counts are unchanged.
- **Files:** `frontend/src/components/AccountBalancePanel.tsx` (new),
  `backend/src/services/reports.service.js`, `backend/src/ipc/reports.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/ReceiptsPage.tsx`,
  `frontend/src/pages/ExpensesPage.tsx`, `System_architecture/use_cases.md`

---

## Receipts (Jamma) — any business account, not just customers

### 2026-08-09 — `receipts.customer_id` → `receipts.ba_id` (migration 014)
- **What:** Jamma could only ever name a **customer**, because `dbo.receipts.customer_id` was
  `NOT NULL` with an FK to `dbo.customers`. Money coming back from a director, an employee, a
  vendor or a bank had nowhere to go. Replaced `customer_id` with `ba_id` on `dbo.receipts` **and**
  `dbo.draft_receipts`, so Jamma now works exactly like Naam has all along.
- **The Naam side needed no change at all.** `ExpensesPage` already builds its picker from
  `listBusinessAccounts()`, which filters nothing beyond hiding restricted-parent accounts from the
  USER role. Only Receipts was restricted, and the restriction was in the schema, not the UI.
- **No information lost, and one useful side effect.** `customers.ba_id` has a UNIQUE filtered
  index, so "which customer paid this" is still answerable via `JOIN customers c ON c.ba_id =
  r.ba_id` — and that join *automatically excludes* non-customer receipts, which is why
  `saleAggregateByCustomer()` (Sale Analysis / Sale Report "Payment Received") stays correct after
  being re-grouped from `customer_id` to `ba_id`. Money from a director can never inflate a
  customer's payment total.
- **Migration aborts rather than degrades.** `customers.ba_id` is nullable (TASK-05's "add customer
  account first"), so the backfill can leave a row behind. 014 `THROW`s with an actionable message
  instead of silently keeping the column nullable. Verified zero such rows before running it.
- **Posting got simpler:** `postWithinTransaction()` no longer resolves a customer to find a ba_id —
  it credits `receipt.ba_id` directly, and the old `NO_CUSTOMER_ACCOUNT` guard is gone, since
  `ba_id` is a NOT NULL FK. `cheques.service.js`'s bounce/return reversal likewise credits
  `receipt.ba_id`. Both files dropped their now-unused `customers.service` import.
- **Wider blast radius than expected** — every query joining `receipts → customers` had to move to
  `receipts → business_accounts` with an optional customers hop: `cheques.repository` (2 queries),
  `alerts.repository#chequeDueRows` (the cheque-due alert detail now names the account),
  `reports.repository#ledgerRows` (`rc_customer_name` → `rc_account_name`) and `cashBookNonCashRows`.
  Frontend: the three Weekly/Monthly/Overall Receipts tabs grouped their cards by `customer_id` and
  now group by `ba_id`; `ChequesTab` labels fall back to `account_name`.
- **Commission is now customer-only.** It is payment-time trade discount to a customer (§7) and has
  no meaning on money from a director or a bank, so the field is hidden — and stripped from the
  payload — unless the selected account belongs to a customer.
- **Verified end to end** against `wentox_demo`: migration applied, `customer_id` gone, all 13
  seeded receipts backfilled and still resolving to their customers. Then created + posted a 7,500
  CASH receipt against **USMAN BHATTI** (an imported directors account, definitively not a
  customer): ledger wrote Dr CASH IN HAND / Cr USMAN BHATTI, it appeared in the Cash Book under its
  own name, and Sale Analysis `total_payment` was **395,500 before and after** — unchanged, as
  required. Unpost + delete then cleaned it back out. `tsc -b` clean; eslint problem count identical
  to the pre-change baseline (3 pre-existing `set-state-in-effect` errors).
- **Docs now behind:** `database_schema_v4.3.md` and `use_cases.md` still describe
  `receipts.customer_id`. Not updated in this pass.
- **Files:** `backend/src/db/migrations/014_receipts_any_business_account.sql` (new),
  `backend/src/repositories/{receipts,draftReceipts,cheques,alerts,reports}.repository.js`,
  `backend/src/services/{receipts,draftReceipts,cheques,alerts,reports}.service.js`,
  `backend/src/db/seeds/dev-sample-data.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/ReceiptsPage.tsx`,
  `frontend/src/components/{Weekly,Monthly,Overall}ReceiptsTab.tsx`,
  `frontend/src/components/ChequesTab.tsx`

---

## UC-37 Cash Book — columns and summary reworked to the client's layout

### 2026-08-09 — Cash Book gains cheque/online columns; summary moved to the end
- **What:** The client supplied a photo of their old system's cash book. Adopted its *content* —
  nine columns (S# / Account Name / Remarks / Type / Cheque No / Receipts Cheq.-Online / Payments
  Cheq.-Online / Receipts Cash / Payments Cash), a Totals row across the four amount columns, and
  the five-line cash summary (Opening Cash / Cash Received (Jamma) / Total Cash / Cash Paid (Naam) /
  Cash In Hand) **moved from the top of the page to the end**, on screen and in print. The running
  **Balance** column is gone — the reference has none.
- **Explicitly NOT adopted: the legacy report's visual style.** A first pass rebuilt the page in the
  old system's look (red title, blue headers, dense hairline grid, bare numbers) and the user
  rejected it — the app's own design language stays, only the layout of the content changes. If a
  future reference photo arrives, copy what the columns *say*, not how they look.
- **The real problem was not styling.** `cashBook()` read *only* the CASH IN HAND ledger, so the two
  Cheq./Online columns could never have held anything: a CHEQUE receipt posts to CHEQUES IN HAND and
  an ONLINE one to the receiving bank. Added `repository.cashBookNonCashRows()`, which reads the
  **source documents** (`receipts`/`expenses` with `payment_mode <> 'CASH'`, CONFIRMED only) rather
  than the ledger. The two sets are disjoint by construction, so there is no double-count risk.
  Per the user's requirement, those rows are **view-only**: they fill their own two columns and the
  Totals strip and are excluded from opening/received/paid/in-hand entirely — the summary box stays
  strictly "what the cash drawer did".
- **Account Name is the counterparty, never "Cash".** New `cashBookAccountName()` resolves per
  `source_type`: expense → `expenses.ba_id`'s name (covers expense heads, workers, employees, the
  imported directors accounts), receipt → customer, transfer → whichever side isn't cash (the bank
  rows on the reference), wage run → employee. `ledgerRows()` gained three columns for this
  (`ex.payment_mode`, `ex.issued_cheque_no`, and a join to `employees` for the wage-run name); every
  other caller ignores them.
- **Gotcha found against real data:** using `formatLedgerRow()`'s narration for the Remarks column
  printed the Account Name twice, because that helper falls back to the paying account's own name.
  Split out `cashBookRemarks()`, which takes only the document's typed-in remarks and falls back to
  the payment type ("CASH"), matching the reference. Bounce/return reversal narrations still win.
- **Two deliberate departures**, both the user's call: the By Date / By Month toggle stays (month
  view adds a Date column the single-day reference has no use for), and the print keeps its existing
  Wentox letterhead, signature block and footer rather than the reference's old-vendor branding.
  Print preview switched to landscape — nine columns do not fit A4 portrait.
- **Verified:** `tsc -b` clean; ran `cashBook()` against `wentox_demo` for `2026-08-04` and
  `2026-08` — a 35,000 cheque receipt showed in Receipts Cheq./Online with Opening and Cash In Hand
  both unchanged at 42,500, and the month view reconciled (42,500 + 16,500 − 25,800 = 33,200).
  Pre-existing `react-hooks/set-state-in-effect` lint error on `useEffect(() => { load(); })` left
  alone — it predates this change and `PaymentTrailPage`/`ProductLedgerContent` share it.
- **Files:** `backend/src/repositories/reports.repository.js`,
  `backend/src/services/reports.service.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/ReportCashBookPage.tsx`

---

## Data import — legacy KHAATA business accounts

### 2026-08-09 — First batch of the client's old business-accounts ledger imported as seed data
- **What:** The client sent a screenshot of their previous system's "BUSINESS ACCOUNTS LEDGER
  (KHAATA)" screen. Transcribed the 19 visible accounts into a new idempotent seed module and wired
  it into `npm run seed`: 2 under `Employees` (`400005`) and 17 under `Directors Expenses -
  Drawings` (`400004`), all city Lahore. Applied to `wentox_demo` only, per the user's choice —
  `wentox` was deliberately left alone.
- **How:** New `src/db/seeds/legacy-accounts.js` exporting `seedLegacyAccounts(pool)`, called from
  `run.js` after the reserved chart accounts exist (it hangs rows off them, and throws loudly if a
  parent code is missing rather than importing under the wrong head).
  - **Idempotency key is `legacy_code`, not `name`.** `schema.sql` defines that column for exactly
    this ("old system's number; import reconciliation only"), and keying on it means renaming an
    imported account inside WentoX won't cause the next `seed` run to insert a duplicate.
  - New `code` follows §3.2 like everything else — parent chart code + 4-digit serial, recomputed
    per insert (`MAX(RIGHT(code,4)) + 1`) so a partially-completed import resumes instead of
    colliding on `UQ_business_accounts_code`. The Directors serials therefore start at `0002`:
    `4000040001` was already taken by `seed:dev`'s demo data.
  - Raw parameterised SQL on `run.js`'s pool rather than `businessAccounts.repository.insert()` —
    that repository doesn't carry `legacy_code`, and widening it for an import-only path wasn't
    worth it.
  - Ensures `Punjab`/`Lahore` first (`run.js` seeds no geography); spelling matches
    `dev-sample-data.js` so the demo DB ends up with one Lahore, not two.
- **Two things to keep in mind:** (1) the screenshot is a *partial* view — its first legacy code is
  `...2218`, so ~2,200 accounts sit above it; later batches just append to `LEGACY_ACCOUNTS`.
  (2) `Directors Expenses - Drawings` is seeded `is_restricted = 1`, so those 17 accounts are
  invisible to the `USER` role by design (TASK-14) — only the 2 Employees rows show for both roles.
- **Verified:** `npm run seed` reported 19 imported; a join back through `chart_of_accounts` +
  `cities` confirmed every row's parent and city; a second `npm run seed` inserted nothing.
- **Files:** `backend/src/db/seeds/legacy-accounts.js` (new), `backend/src/db/seeds/run.js`

---

## Dev tooling — `seed:dev` extended into a full demo dataset (and a real finding about opening balances)

### 2026-08-09 — `wentox_demo` database: ~3 months of posted transactions so every report can be verified
- **What:** Reports and flows couldn't be checked because there was nothing to look at — `wentox`
  held 1 region, 1 store, 1 sub-customer and **zero transactions**, so every report (which all read
  `ledger_entries`) rendered empty regardless of whether it worked. `seed:dev` already existed but
  only created **master data**; it made no bills, receipts, expenses, purchases, cheques or payroll.
  Extended `dev-sample-data.js` from 153 → ~640 lines with a transactions phase and deliberate edge
  states.
- **Target is a throwaway database, not the working one.** `DB_NAME=wentox_demo` is all that's
  needed — `src/config/index.js` already reads `process.env.DB_NAME` and `src/db/migrate.js`
  already creates a missing database, so **no `.env` edit is required**:
  `DB_NAME=wentox_demo npm run migrate && … run seed && … run seed:dev && … run electron:dev`.
  Drop the prefix to go back to `wentox`, which was confirmed untouched (row counts identical
  before and after).
- **How:** everything goes through the **real service layer**, never raw SQL, so linked business
  accounts, generated codes and every validation rule fire as they do through the UI. Master data
  keeps the existing idempotent `ensure()`; the transaction phase is guarded by a `sale_bills`
  sentinel, since re-running would double the books. All dates are fixed offsets from today
  (`daysAgo(n)`) — no randomness, so runs are reproducible and totals are hand-checkable.
- **Contents:** 3 regions/cities, 3 vendors, 5 products (with the 12 stage-cost columns populated —
  a Wage Run snapshots its rate from those, so zero-cost products would produce worthless runs),
  6 customers, 2 banks, 4 employees, expense heads under BUSINESS RUNNING EXPENSES and DIRECTORS
  DRAWINGS; then 14 sale bills, 3 sale returns, 6 purchases, 2 purchase returns, 9 receipts (several
  **with commission**), 4 cheques covering all four dispositions, 10 expenses, 3 transfers, 3 wage
  runs, 1 salary run, plus drafts, a CLOSED account and a soft-deleted customer.
- **A real finding, not a seed bug — `business_accounts.opening_balance` has no contra entry.**
  The first cut gave each bank a 500,000 opening balance, and Overall Trail then came out
  **unbalanced by exactly 1,000,000** (debit 2,272,436.60 vs credit 1,272,436.60). `opening_balance`
  is a stored INPUT that `businessAccountBalancesAsOf()` adds to the ledger sum, but nothing ever
  writes a matching contra row — this schema has no Opening Balance Equity account. **Any non-zero
  opening balance therefore breaks the trial balance by that amount.** PROGRESS.md's earlier claim
  that Overall Trail "genuinely balances" was verified when no opening balances existed, so this had
  never been exercised. Worked around in the seed by funding both banks with a real **Deposit**
  (`Dr bank / Cr MISC ADJUSTMENTS`, code 400006) — a balanced posting, and exactly what the deposits
  feature was built for. **The underlying gap is still open** and should be a decision: either add a
  contra account for opening balances, or accept that Overall Trail can't balance once they're used.
- **Second gap found the same way:** Payment Trail's **Employees** bucket read 0 even with payroll
  posted, because a wage/salary *run* only accrues the liability — paying it out is a separate
  Expense against the employee's own business account. Added two staff payments; the bucket now
  reads 54,000. ("Cash at Banks" stays 0 by design — expenses are never posted *against* a bank
  account, banks are the funding side.)
- **Verified:** raw SQL confirms the whole ledger balances — 129 rows, **debit = credit =
  3,684,246.60, diff 0.00**. Every report returns data through the service layer, and again through
  the real UI over CDP: Sale Analysis 5 rows (Region grouping gives KPK/Punjab/Sindh), Sale Report
  (Overall row arithmetic checks out: 556,423.60 − 4,100 commission − 20,280 returns = 532,043.60
  net), Vendor Report 3, Payment Trail 5 buckets, Account Ledger 6, Business Ledger 19, Cash Book 2,
  Product Ledger 22, Overall Trail 32 accounts and **BALANCED**. The bounce cascade was checked at
  row level: cheque 55120744 → BOUNCED, its VENDOR_PAYMENT allocation → REVERSED, both reversal
  ledger pairs written (30k allocation + 50k receipt), and the *other* cheque's allocations left
  ACTIVE. All 4 cheque states present (CLEARED / BOUNCED / PENDING / PARTIALLY_ENDORSED). 3 alerts
  generate and show on the bell. Zero console errors.
- **One usability fix during verification:** Cash Book opens on *today*, so with nothing dated today
  it rendered empty and looked broken. Added a same-day cash receipt and expense.
- **Files:** `backend/src/db/seeds/dev-sample-data.js` (extended).

---

## Cross-cutting (frontend) — Setup directories: card grid → shared row template

### 2026-08-09 — Last 4 card lists converted; no card-style list remains anywhere in the app
- **What:** Per instruction ("do that one as well and any other left now do them also"), a
  whole-codebase scan for card-style lists (any `.map()` rendering bordered/rounded `<div>`s, plus
  any `lg:grid-cols-3` whose children come from a map) found four remaining, all now converted:
  1. `ReportKhaataPage.tsx` — the Accounts Directory customer picker (avatar cards → Code · Account
     Name · Main Account · City · *View Statement*). Its subtitle copy said "Select an account
     **card**"; updated to "row".
  2. `GroupAcSetupPage.tsx` — the drill-down modal's *Registered Chart Accounts* list.
  3. `ChartAcSetupPage.tsx` — the drill-down modal's *Linked Sub-Ledgers / Business Accounts* list.
  4. `DuplicateNamePromptModal.tsx` — the matched-records list inside the duplicate-name prompt.
     `actionsHeader` is blanked and `actions` omitted entirely on an *active* match, since the
     Activate button only exists for the inactive case.
- **A re-scan now reports zero card-style lists in `pages/` and `components/`.** Three `.map()`
  grids remain and are correctly untouched because they are **not** record lists:
  `ReportHeader.tsx` (print metadata key/value grid), `EmployeeSetupPage` (the trades checkbox
  picker inside the form), `ProductSetupPage` (the 12 manufacturing cost fields).
  `BiltyUpdatePage.tsx`'s `lg:grid-cols-3` is a form layout.
- **Verified live** over CDP: Khaata's Account Ledger tab renders the directory as a table with the
  right headers and no card grid (0 rows — there are no customers in this DB, so it shows the
  in-table empty state); the Group Accounts drill-down modal shows its 4 child chart accounts as
  Code · Chart Account · Status; the Chart Accounts drill-down shows its 1 linked business account
  (`#1000020001`) the same way. Console clean apart from the stock CSP dev warning. `npx tsc -b` clean.
- **NOT live-verified — `DuplicateNamePromptModal`.** Triggering it needs a duplicate-name save,
  and the Sub Customer form's required Region field is a custom `SearchableSelect` that did not
  respond to synthetic clicks over CDP after two attempts; I stopped rather than keep forcing it.
  Confirmed no data was written (sub-customer count unchanged at 1 throughout). The modal
  type-checks and is structurally the same table used by 17 other call sites, but its *rendered*
  output has not been seen. Worth a manual look the next time a duplicate name is entered.
- **Files:** `frontend/src/pages/ReportKhaataPage.tsx`, `frontend/src/pages/GroupAcSetupPage.tsx`,
  `frontend/src/pages/ChartAcSetupPage.tsx`, `frontend/src/components/DuplicateNamePromptModal.tsx`.

### 2026-08-09 — Final 6 pages onto the template; template gained expand + footer support; a real React 19 warning found and fixed
- **What:** Per instruction ("do those five as well and the overall search page as well"), the five
  pages already on hand-rolled tables plus Overall Search were migrated: **Sub Customer, Category,
  Product, Employee, User Management, Overall Search**. **16 pages now share `DataListTable`** and
  no card grid remains in any list on any page.
- **Two additive template capabilities, both driven by a page that genuinely needed them:**
  - **Expandable rows** (`renderExpanded` / `isExpanded` / `onToggleExpand`) — Categories toggles a
    row open to show that category's products in a nested table. Adding a leading chevron column
    was the only way to keep that feature; the page still owns the expansion state. Confirmed with
    the user before building rather than silently dropping the drill-down.
  - **`footer`** — Employees has a `<tfoot>` "Total Outstanding" row. The page supplies the whole
    `<tr>` so it controls its own colSpans. Rendered only when there are rows.
  - Employees also proved the columns array can be built conditionally: it swaps a *Registered
    Trades* column for *Fixed Monthly Salary* depending on the Workers/Salaried tab.
- **A real bug found by live verification, not by `tsc`:** the first cut of expandable rows wrapped
  each row in `<Fragment key={…}>`. React 19 then logged
  `Invalid prop 'code-path' supplied to React.Fragment` **once per rendered row, on every page with
  data** — because this project's dev-only Vite plugin `kimi-plugin-inspect-react` (`inspectAttr()`
  in `frontend/vite.config.ts`) stamps a `code-path` attribute onto every JSX element for
  click-to-source, and `Fragment` accepts only `key`/`children`. Fixed by dropping the Fragment
  entirely: the row map is now a **`flatMap` returning sibling `<tr>` elements** with their own
  keys, which needs no wrapper. Verified the warning is gone from all 16 pages. Worth knowing: this
  is latent wherever `<Fragment>` is used — `ReportStockPage`, `ChequesTab`, `SaleReportPage`,
  `OverallTrailContent` and `SaleAnalysisPage` all still trip it, pre-existing and untouched here.
  It is dev-server-only and cannot reach a production build.
- **One page deliberately left alone:** `ReportKhaataPage.tsx` still renders its customer picker as
  a card grid (`lg:grid-cols-3`, with initial-letter avatars). It was not in scope and was not
  mentioned — flagging it as the last remaining card list in the app.
  (`BiltyUpdatePage.tsx`'s `lg:grid-cols-3` is a *form* layout, not a list — correctly untouched.)
- **Verified live** over CDP after a hard reload: all 16 pages render 0 card grids and exactly 1
  table, 29 real data rows across them, correct headers everywhere, and **zero console
  errors/warnings**. Categories' expand was proven end-to-end by creating a throwaway category
  through the real API, confirming the chevron cell, expanding it (nested "no products" panel
  appeared), collapsing it again, then removing it — it is soft-deleted (`is_active=0`, this app has
  no hard delete for categories) so it no longer appears in the UI. `npx tsc -b` clean.
- **Files:** `frontend/src/components/DataListTable.tsx`,
  `frontend/src/pages/{SubCustomer,Category,Product,Employee}SetupPage.tsx`,
  `frontend/src/pages/UserManagementPage.tsx`, `frontend/src/pages/OverallSearchPage.tsx`.

### 2026-08-09 — All 10 pages converted (follow-up to the entry below, same day)
- **What:** The remaining 9 pages were converted onto the same `DataListTable` template in one pass,
  per explicit instruction ("do the remaining pages"): **Group Ac, Business Ac, Region, City, Store,
  Adda, Vendor, Customer, Bank**. Zero `lg:grid-cols-3` card grids remain in any `*SetupPage.tsx`.
- **How:** Same rule everywhere — each page's columns are exactly what its card already showed, so
  nothing was invented; row click keeps whatever that page opened before. `ArrowRight` dropped from
  the 6 pages where it only fed the card's footer arrow.

  | Page | Columns | Row click opens |
  |---|---|---|
  | Group Ac | Code · Name · Account Class · Sorting | child chart-accounts drill-down |
  | Chart Ac | Code(+RESERVED) · Name · Group · Link Code · Status | sub-ledgers drill-down |
  | Business Ac | Code · Name · Control A/C · Region · Status | edit modal |
  | Region | Code · Name · Status | edit modal |
  | City | Code · Name · Region · Status | edit modal |
  | Store | Code · Name · Status | edit modal |
  | Adda | Code · Name · Region · City · Details | edit modal |
  | Vendor | ID · Name · Phone · Region · City · Articles | purchase history |
  | Customer | ID · Name · Region · City · Address | product ledger |
  | Bank | A/C Code · Bank · Account No. · Branch · Status | edit view |

- **One deliberate behaviour change, flagged:** `BankSetupPage.tsx` was **already** a hand-rolled
  table, not cards (an earlier grid-class grep matched its *form* layout, not its list). It was in
  the approved page list, so it moved onto the shared template for consistency — same columns, same
  look. Its rows are now **clickable → `select(b)`**, which they were not before; on an inactive
  bank that reaches the edit view by a route the row previously did not offer (the row only exposed
  Reactivate). Harmless and trivially revertable, but it is new behaviour rather than a like-for-like
  port. `SubCustomer`, `Category`, `Product`, `Employee` and `UserManagement` were left alone —
  already tables, and outside the approved list.
- **Verified live** via the CDP-driven Electron instance, sweeping all 10 pages: every page renders
  exactly 1 table, 0 card grids, with the correct headers listed above. Data-bearing pages showed
  real rows (Chart 17, Group 4, Business 1, Store 1); the 6 empty tables (Region, City, Adda,
  Vendor, Customer, Bank — all 0 rows in this DB) correctly showed the in-table empty state with
  headers still visible. Interactions re-checked per page: Group Ac row click → the group's
  drill-down, and its **Edit button opened the edit modal without also firing the row click**;
  Business Ac and Store row clicks → edit modals pre-filled with the right record. **Zero console
  errors or exceptions across the whole sweep** (Electron's stock dev-mode CSP warning filtered out).
  `npx tsc -b` clean.
- **Files:** `frontend/src/pages/{GroupAc,BusinessAc,Region,City,Store,Adda,Vendor,Customer,Bank}SetupPage.tsx`.

### 2026-08-09 — New `DataListTable` row template; Chart of Accounts converted first, verified live
- **What:** Every non-transactional setup screen rendered its records as a 3-across card grid
  (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, ~190px tiles) — 10 pages do this: Region, City,
  Store, Adda, Group Ac, Chart Ac, Business Ac, Customer, Vendor, Bank. Cards fit only 7–9 records
  per screen, are hard to scan/compare, and were already inconsistent with the 5 setup pages that
  use tables (Sub Customer, Category, Product, Employee, User Management). Per client instruction
  these become **row-wise lists, with the row itself clickable to open whatever detail that page
  already opened**, and the row design is a **template defined once and reused**, not per-page
  markup. This entry builds the template and converts the first page; the other 9 follow one at a
  time.
- **How:**
  - New `frontend/src/components/DataListTable.tsx` — generic over the row type, no domain
    knowledge. Page supplies `columns` (`{key, header, render, align?, width?, cellClassName?}`),
    `rows`, `rowKey`, optional `onRowClick`, and an optional `actions(row)` render-prop.
    Markup/classes are **lifted verbatim from the table already in `SubCustomerSetupPage.tsx`** —
    the established house style, deliberately not a new one. Two behaviours those tables lack were
    added: the whole row is clickable (plus `role="button"`/`tabIndex=0`/Enter-Space, and a gold
    focus ring), and loading/empty states render as a `<td colSpan>` **inside** the table so the
    header row stays visible instead of being replaced by a card.
  - The actions cell is wrapped in `<div onClick={e => e.stopPropagation()}>` — the same guard the
    cards used — so Edit/Delete never also fire the row click. This is the one genuinely new failure
    mode the card→row move introduces, and it is the thing most worth re-checking on each page as
    the rollout proceeds.
  - `ChartAcSetupPage.tsx`: only the card-grid block was replaced. Columns are Chart Code (mono,
    with the gold RESERVED marker beneath), Account Name, Group Account, Link Code, Status
    (unchanged emerald/rose pill), Actions (unchanged Edit + the same
    `status === 'CLOSED' ? Reactivate : Delete` branch, keeping `disabled={isReserved}`). Row click
    → `setViewingChartId(c.ac_id)`, exactly what the card did. Data loading, filtering, search, the
    sort toggle, the header card, and both modals are untouched — this is a presentation swap.
    Dropped the now-unused `ArrowRight` import.
- **Verified live** via a second Electron instance on `--remote-debugging-port=9222` (driven over
  CDP; the already-running `electron:dev` window was left alone): logged in as `admin`, opened
  Chart of Accounts — all 17 seeded accounts render as rows, 0 card grids remain, all 6 headers
  correct, RESERVED marker present. Row click opened the Sub-Ledgers drill-down for the right
  account and closed cleanly; **Edit opened the edit modal pre-filled and did NOT also open the
  drill-down** (confirming the stopPropagation guard); Delete on a reserved account is genuinely
  `disabled`, with the right tooltip; Sort by Name reordered alphabetically and Sort by Code
  restored; search `WAGES` → 2 rows; a nonsense search showed the empty state **with the table
  header still visible**; clearing search restored 17. Enter on a focused row opened the
  drill-down. Console clean apart from Electron's stock dev-mode CSP warning (pre-existing,
  unrelated). `npx tsc -b` clean.
- **Not verified live, and why:** the **Delete-enabled** and **Reactivate** branches were not
  exercised — all 17 seeded chart accounts are in `RESERVED_ACCOUNT_CODES` (17 codes, 17 rows) and
  all are `ACTIVE`, so neither branch is reachable with current data. Proving them needs a
  throwaway chart account, and `chartAccounts.remove()` is a soft close (no hard delete), so the
  test row would persist. Both branches reuse the card's exact handlers/conditions inside the same
  guarded actions cell that Edit was proven in.
- **Still pending:** the other 9 card pages — Group Ac, Business Ac, Region, City, Store, Adda,
  Vendor, Customer, Bank. Customer and Vendor open a detail/ledger drill-down rather than the edit
  modal; each page keeps whatever it opens today.
- **Files:** `frontend/src/components/DataListTable.tsx` (new),
  `frontend/src/pages/ChartAcSetupPage.tsx`.

---

## Milestone 9, Module 9.2 — Admin: Manage Users (new capability, not in the original milestone scope)

### 2026-08-08 — Admin can create, list, deactivate/reactivate additional logins, and reset any user's password
- **What:** UC-03's role-based access control was fully built (`chart_of_accounts.is_restricted`
  hides Cash at Banks/Directors Drawings from `USER`-role sessions) but there was no way to actually
  *create* a second, limited-access login — only the single seeded `admin` account ever existed, and
  `auth.service.js` only supported `login`/`updateCredentials` (self-service, requires the caller's
  own current password)/`verifyPassword`. Added: `auth:createUser` (admin-only, always creates
  `role: 'USER'` — the frontend can never create another admin), `auth:listUsers`,
  `auth:setUserActive` (deactivate/reactivate — this app's only "delete" for a user, matching the
  soft-delete convention used everywhere else), and `auth:resetPassword` (admin sets ANOTHER user's
  password directly, unlike `updateCredentials` which needs the target's own current password).
  `session.js#requireRole('ADMIN')` existed but had zero real call-sites anywhere in the codebase
  before this — these four channels are its first actual use.
- **How:** Two footguns guarded against in `setUserActive()`: an admin can't deactivate their own
  account (`session.userId === targetUserId` check), and can't deactivate the last active admin
  (`repository.countActiveAdmins()` check) — both would otherwise lock everyone out with no way to
  undo it. New frontend page `UserManagementPage.tsx` (`setup-users` NavPage, admin-only sidebar
  entry under System Setup) — create-user form, live account list with role/active badges, per-row
  deactivate/reactivate and a "Reset Password" modal. Also found and fixed while wiring this:
  `ipcBridge.ts`'s `FEATURES` array was missing `'alerts'` and `'updates'` entirely — same class of
  bug as an earlier missing `'accountClasses'` entry — both channels would have silently resolved
  `window.api.alerts`/`window.api.updates` as `undefined`.
- **Follow-up, same session:** per explicit request, `SettingsPage.tsx` is now role-gated —
  non-admins only ever see the "Check for Updates" tab (the footer popup link itself now reads
  "Check for Updates" instead of "Settings & Updates" for a `USER` session); the credentials/password
  tab and its pill-tab selector are hidden outright, not just defaulted away, so there's no path to
  them for a non-admin.
- **Verified live** via a real Electron instance (CDP): created a `worker1` USER account, confirmed a
  real bcrypt-hashed row in `dbo.users`; duplicate username correctly blocked (`USERNAME_TAKEN`);
  logged in as `worker1` and confirmed `createUser`/`listUsers` are both rejected
  ("Requires ADMIN role"), confirmed the sidebar hides every `adminOnly` item for that role, and
  confirmed `SettingsPage.tsx` shows only "Check for Updates" with no way to reach the credentials
  form; deactivated `worker1` → login correctly rejected → reactivated → login works again → admin
  reset `worker1`'s password → confirmed the new password actually logs in; confirmed the
  self-deactivate button is genuinely disabled (not just hidden) on the admin's own row.
- **Files:** `backend/src/repositories/auth.repository.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`,
  `frontend/src/types/index.ts`, `frontend/src/components/AppLayout.tsx`,
  `frontend/src/pages/UserManagementPage.tsx` (new), `frontend/src/pages/SettingsPage.tsx`,
  `frontend/src/App.tsx`.

## Milestone 8, Modules 8.1/8.2/8.3 — System Setup + Accounting Setup frontend wiring

### 2026-08-07 — Connected Cities/Regions/Stores/Addas and Group/Chart/Business Accounts to real `window.api` — verified live
- **What:** The last System Setup pages still on demo `AppContext` data — `CitySetupPage.tsx`,
  `RegionSetupPage.tsx`, `StoreSetupPage.tsx`, `AddaSetupPage.tsx`, `GroupAcSetupPage.tsx`,
  `ChartAcSetupPage.tsx`, `BusinessAcSetupPage.tsx` — rewired onto the real backend (all of which was
  already built and complete per Module 8.1/8.2/8.3's backend entries above). Cities/Regions/
  Stores/Addas follow the blocking-duplicate pattern (case-insensitive name match, active blocks,
  inactive offers reactivate) already used by vendors/categories/products. Addas' region/city
  required-vs-optional was inverted in the old demo page (region optional, city required) —
  corrected to match the real backend (`region_id` NOT NULL, `city_id` nullable). Group/Chart/
  Business Accounts' manual code-entry fields were dropped — codes are server-generated
  (`<classDigit><serial>` → `<groupCode><serial>` → `<chartCode><serial>`) and now shown read-only.
  `ChartAcSetupPage.tsx` disables the delete action outright for any of the 16 reserved codes
  (`reservedAccounts.js`), rather than only surfacing the backend's `RESERVED_ACCOUNT` error after
  the fact. `BusinessAcSetupPage.tsx`'s stale `controlId === '110001'` → demo `ADD_CUSTOMER` side
  effect was dropped (real customer creation already links its own account server-side).
  `ipcBridge.ts`'s `FEATURES` array was missing `'accountClasses'` — fixed.
- **Verified live:** created a City/Region/Store/Adda (region required, city optional now); active
  duplicate blocked inline; inactive duplicate → reactivate-offer modal worked; deleting an
  Adda referenced by a real sale bill correctly blocked with `ADDA_IN_USE`. Created a Group Account
  under a class (code `1001`), a Chart Account under it (`100101`), a Business Account under that
  (`1001010001`) — full code-generation chain confirmed; creating a business account under the real
  `CUSTOMERS_ACCOUNTS` code did NOT also create a demo customer (confirms the dropped side effect);
  deleting a reserved chart account blocked both in the UI (disabled) and by the backend
  (`RESERVED_ACCOUNT`); deleting a Group Account with chart-account children blocked
  (`GROUP_IN_USE`). Logged in as a `USER`-role session and confirmed Bank Accounts/Directors
  Drawings are absent from Business/Chart Accounts lists — the real, pre-existing `is_restricted`
  hiding, exercised end-to-end for the first time with an actual second account (see the Manage
  Users entry above).
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/lib/ipcBridge.ts`,
  `frontend/src/pages/{City,Region,Store,Adda}SetupPage.tsx`,
  `frontend/src/pages/{GroupAc,ChartAc,BusinessAc}SetupPage.tsx`.

## Milestone 9, Module 9.1 — Alerts: real-backend Home card, manual + timed refresh (follow-up)

### 2026-08-08 — Alerts moved off demo data onto the real backend; auto-popup sidebar replaced with an inline Home card
- **What:** The alerts panel (right-side auto-popup on Home) and bell dropdown were computing alerts
  client-side from frozen `AppContext` demo arrays — never actually wired to the real, already-built
  `alerts:list`/`alerts:dismiss` backend (Module 9.1, above). Per explicit request: removed the
  auto-popup sidebar entirely (deleted `NotificationSidePanel.tsx`); new `HomeAlertsCard.tsx` renders
  inline on the Home page (bottom half, centered) instead, using real `alerts:list`/`alerts:dismiss`.
  Card-level "Close" is a new session-scoped `homeAlertsCardClosed` flag in `AppContext` (resets on
  every `LOGIN_SUCCESS`) — deliberately NOT the real backend dismiss, which is permanent and would
  never satisfy "shown again next login"; per-row dismiss (the small X) IS the real, permanent
  `alerts:dismiss` call, matching what that endpoint was actually built for. Bell dropdown
  (`NotificationBell.tsx`) also switched to the same real data source, and no longer special-cases
  Home (previously toggled the now-deleted side panel there; now behaves identically everywhere).
- **Follow-up in the same session — refresh was stale and then slow:** `refreshAlerts()` (the job
  that populates `dbo.generated_alerts`, which `alerts:list` just reads) ran once at Electron
  startup only — a cheque/bill newly entering the 7-day window mid-session wouldn't show until an app
  restart. Widened to also re-run every 15 minutes (`electron/main.js`), plus a new on-demand
  `alerts:refresh` channel and a manual refresh button (bell dropdown — always reachable even with
  zero current alerts — and the Home card). Found the refresh itself was doing a SELECT-then-INSERT/
  UPDATE per alert, sequentially, one at a time (2 DB round trips × N alerts, never parallelized) —
  replaced with a single `MERGE` per alert (`alerts.repository.js#mergeGeneratedAlert`, one round
  trip) run in parallel via `Promise.all` instead of a `for await` loop; `alerts:refresh` now also
  returns the fresh list directly rather than making the renderer do a second round trip after.
  Measured: a real refresh went from what was effectively N sequential round trips down to ~90ms.
- **Verified live:** confirmed no auto-popup on Home; card shows real alert data (cross-checked
  against a raw `alerts:list()` call); clicking a row navigates correctly using the backend's own
  `target_page`/`target_tab`; card stays hidden across navigation once closed, reappears after
  logout→login; per-row dismiss is permanent (confirmed gone from a fresh `alerts:list()` call);
  simulated the exact "just added a cheque, not showing yet" scenario by clearing
  `generated_alerts` mid-session — bell dropdown correctly said "Nothing needs attention," clicking
  Refresh made the cheque appear instantly, no restart needed.
- **Files:** `backend/electron/main.js`, `backend/src/ipc/alerts.ipc.js`,
  `backend/src/repositories/alerts.repository.js`, `backend/src/services/alerts.service.js`,
  `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`, `frontend/src/context/AppContext.tsx`,
  `frontend/src/components/AppLayout.tsx`, `frontend/src/components/NotificationBell.tsx`,
  `frontend/src/components/HomeAlertsCard.tsx` (new), `frontend/src/pages/HomePage.tsx`; deleted
  `frontend/src/components/NotificationSidePanel.tsx`.

## Milestone 5, Module 5.2 — Reports: two bug fixes found via a full click-through sweep

### 2026-08-08 — `sale-bills:biltySearch`/`updateBilty` channel-name mismatch; Add Quantity input UX
- **What:** A systematic click-through of every sidebar page (checking for console errors/blank
  renders, since this app has no React error boundaries) found the "Search & Bilty Adda Updation"
  page completely broken — `sale-bills:bilty-search`/`sale-bills:update-bilty` were registered
  kebab-case on the backend, but the frontend calls them via `window.api.saleBills.biltySearch(...)`/
  `.updateBilty(...)` (camelCase — the IPC bridge Proxy passes the action segment through with no
  case conversion, confirmed against `auth.ipc.js`'s own documented convention). Renamed both
  channels to camelCase. Separately, in `ReportStockPage.tsx`'s "Add Stock / Log Production" modal,
  the "Add Quantity" field defaulted to `1` with no `onFocus` select and an `onChange` that forced
  the value back to a minimum of 1 on every keystroke — typing "20" over the default produced "120"
  since the "1" was never selectable/clearable. Fixed with `onFocus={e => e.target.select()}`, an
  `onChange` that allows the field to go genuinely empty while typing, and an `onBlur` that clamps
  back to 1 only if left empty.
- **Verified live:** direct `window.api.saleBills.biltySearch({})` call returns real bill rows post-fix
  (previously threw "No handler registered"); simulated the exact select-then-type interaction for
  the quantity field and confirmed the result is `20`, not `120`.
- **Files:** `backend/src/ipc/saleBills.ipc.js`, `frontend/src/pages/ReportStockPage.tsx`.

## Milestone 5, Module 5.2 — Reports: Overall Trail per-account print preview (all 6 categories)

### 2026-08-08 — "Show Print Preview" added to the account drill-down, previously only on the summary view
- **What:** `OverallTrailContent.tsx` has two views — a trial-balance summary (which already had a
  working print preview) and a per-account drill-down ledger (Customer/Vendor/Bank/Employee/Chart
  Account/Business Account — reached by clicking any account row). The drill-down had no print
  preview at all, for any category. Since the drill-down view has zero per-category branching
  (`loadLedger()` makes one identical `accountLedger({ba_id, ac_id, ...})` call regardless of which
  category the account came from — the backend resolves whichever id applies), one shared addition
  covers all six categories at once: new `renderPrintableLedger()` (ported from
  `ReportKhaataPage.tsx`'s already-working "select account → print its ledger" pattern), a second
  `ReportPrintPreviewModal` instance, and a new Excel-export handler.
- **Verified live:** drilled into a Customer, a Vendor, and a Chart Account (the latter using `ac_id`
  instead of `ba_id`, confirming the shared renderer handles both id types) — each showed the correct
  account header, real ledger rows, opening/closing balance, and Excel export worked.
- **Files:** `frontend/src/pages/OverallTrailContent.tsx`.

## Milestone 7 — System Setup frontend wiring (Customers, Sub-Customers)

### 2026-08-07 — Connected Customer/Sub-Customer Setup pages to real `window.api` — verified live
- **What:** `CustomerSetupPage.tsx`, `SubCustomerSetupPage.tsx` rewired off the demo `AppContext`
  reducer onto real `customers`/`subCustomers` IPC calls — full CRUD including the real
  `checkName()` pre-flight channel, which neither page had wired to anything before (both already
  had `DuplicateNamePromptModal` built and rendered against demo data, just never touching the real
  backend). `lib/api.ts` gained `CustomerUpdateInput`/`SubCustomerUpdateInput`,
  `CustomerCheckNameResult`/`SubCustomerCheckNameResult`, and full `window.api` typings/wrapper
  objects for both (previously only `list`/`create` were typed).
- **How:**
  - Confirmed from code (not assumed): customers/sub-customers are the **non-blocking duplicate
    branch** — `create()` never checks for an active-name collision at all; the real flow is a
    `checkName({name})` pre-flight call before `create()` (`'none'` → create directly; `'active'` →
    advisory only, `DuplicateNamePromptModal`'s `allowCreateOnActive: true` fits exactly; `'inactive'`
    → reactivate-or-create-new). Only `update()` blocks on an exact-name collision with a different
    row (`DUPLICATE_NAME`). This is the opposite of every entity connected so far (vendors/
    categories/products/employees/bank accounts all block on active match).
  - Relaxed the frontend's `city_id`-required validation to match the backend (only `region_id` is
    required, `city_id` is nullable) on both pages.
  - Customer's delete guard (hard-blocked if referenced by demo sale bills/returns/receipts) dropped
    in favor of a plain confirm dialog — real `remove()` is unconditional soft delete, same
    precedent as every prior module.
  - Customer's manual `ADD_BUSINESS_ACCOUNT` dispatch dropped — `customers:create` already creates
    and links the account server-side in its own transaction.
  - Customer's "Product Ledger" drill-down (previously hand-built per-article rows from demo sale
    bills/returns) replaced with a direct reuse of `reports.accountLedger({ba_id})` — the exact same
    channel/wrapper `ReportKhaataPage.tsx` (Module 5) already uses — no new backend work, and the
    real result is richer (running balance, receipts/commission/bounce rows too, not just sale
    bills/returns).
  - Live-verified via Electron + CDP: created a customer with the **same name as an existing active
    customer** and confirmed it was NOT blocked — the advisory modal appeared ("You can still create
    a new one — this is just a heads-up"), "Create New Anyway" succeeded, and both rows coexist
    active in `dbo.customers` with separate `ba_id`s under the real `CUSTOMERS_ACCOUNTS` chart code
    (`100001`) — this is the key behavioral difference from every other connected module, confirmed
    working correctly; renaming a customer to another customer's exact name via edit was correctly
    blocked with `DUPLICATE_NAME`; soft-delete → re-create with the same name → `checkName` returned
    `'inactive'` → reactivate offer worked, for both customers and sub-customers; the Product Ledger
    drill-down rendered real Sale Bill/Receipt rows with correct running balance (28,200 → 13,200 →
    7,200) for a seeded customer with real history. No console errors across the full run.
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/pages/CustomerSetupPage.tsx`,
  `frontend/src/pages/SubCustomerSetupPage.tsx`.

## Milestone 6 — System Setup frontend wiring (Products, Categories, Vendors)

### 2026-08-07 — Connected Product/Category/Vendor Setup pages to real `window.api` — verified live
- **What:** `ProductSetupPage.tsx`, `CategorySetupPage.tsx`, `VendorSetupPage.tsx` rewired off the
  demo `AppContext` reducer onto real `products`/`productColors`/`categories`/`vendors` IPC calls —
  full CRUD, not just the read-only `list()` lookups these three already had from earlier modules.
  `lib/api.ts` gained `ProductCreateInput`/`ProductUpdateInput` (vendor_id immutable on update, per
  the service), `productColors` wrapper, `CategoryCreateInput`, `VendorUpdateInput`, and full
  `window.api` typings/wrapper objects for all four.
- **How:**
  - User-confirmed decision: Product colors stay a single field on the form (today's UX) — resolved/
    created behind the scenes via `product-colors:resolveOrCreate` rather than building a
    multi-variant list UI.
  - Duplicate-name handling follows the same ad hoc reactivate-offer pattern as every other
    connected module (`BankSetupPage.tsx`/`EmployeeSetupPage.tsx`), not the built-but-unwired
    `DuplicateNamePromptModal.tsx` — that component expects a `checkName()` pre-check endpoint these
    three modules don't have, and its "Create New Anyway" action has no real backend affordance for
    an inactive match here (a retry just throws the same error again).
  - Delete guards dropped the demo's hard "used in a sale bill/purchase" blocking checks — the real
    `remove()` for all three is a plain soft delete with no such check — replaced with a plain
    confirm dialog, same precedent as Employees.
  - Vendor's manual `ADD_BUSINESS_ACCOUNT` dispatch + `getNextVendorAccountCode()` computation
    dropped entirely — `vendors:create` already creates and links the account server-side.
    Vendor's free-text city field replaced with real `region_id`/`city_id` dropdowns.
  - Category's "Associated Products" count/drill-down and Vendor's purchase-history drill-down both
    now read off the real `products`/`purchases` lists (`purchases:list()` is header-only — no
    `items` — so the drill-down shows date/bill_no/remarks/status/total_value, not a materials
    breakdown; matches the same list-lacks-detail gotcha every prior module has hit).
  - Live-verified via Electron + CDP: created a category, a vendor (with real region/city), and a
    product under them (server-generated `code`/`batch_no` confirmed: `P-104`, `batch_no=4`); the
    vendor's linked business account landed under the real `VENDORS_ACCOUNTS` reserved chart code
    (`200001`, not `210001` as originally assumed in planning — corrected against the actual
    `reservedAccounts.js` constant); the product's color field correctly created a real
    `article_colors` row via `resolveOrCreate`; duplicate-name (active) blocked with the right
    message for all three; soft-delete → re-create → `INACTIVE_DUPLICATE` reactivate offer worked
    for all three; editing a product's sale price persisted while its `vendor_id` stayed immutable
    (edit form shows it read-only, "(fixed after creation)"). No console errors across the full run.
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/pages/ProductSetupPage.tsx`,
  `frontend/src/pages/CategorySetupPage.tsx`, `frontend/src/pages/VendorSetupPage.tsx`.

## Milestone 5 — Reports frontend wiring (Current Stock, Reports Hub's 9 sub-reports, Bilty/Adda Updation, Overall Searching)

### 2026-08-07 — Connected all of Milestone 5's frontend to real `window.api` — wire-only pass, not live-verified
- **What:** `ReportStockPage.tsx` (all 7 tabs), the 9 Reports Hub sub-report components
  (`SaleAnalysisPage`, `SaleReportPage`, `VendorReportPage`, `PaymentTrailPage`,
  `ReportKhaataPage`, `BusinessLedgerContent`, `ReportCashBookPage`, `ProductLedgerContent`,
  `OverallTrailContent`), `BiltyUpdatePage.tsx`, and `OverallSearchPage.tsx` all rewired off the
  demo `AppContext` reducer onto real `reports`/`stock`/`saleBills` IPC calls. `lib/api.ts` gained
  `stock`/`reports` wrapper objects plus every row/result type for the ~15 report channels, a
  `CategoryRow`/`listCategories()` (Milestone 6 backend, previously unwired), and a `ProductRow`
  widening to include the 12 cost columns (already returned by `a.*`, just not typed).
- **How:**
  - Per explicit instruction, **this pass has no live Electron/CDP verification** — only
    `npx tsc -b` (clean) and direct SQL-level checks against `wentox_db` for the one backend
    change. Flagging this explicitly: none of Milestone 5's ~15 report views have been exercised
    against real data end-to-end the way every prior module was.
  - Real semantic simplifications made where the demo's shape had no backend equivalent: Cash
    Book dropped its Cheque/Online columns (the real `reports:cash-book` is CASH_IN_HAND-only by
    design, per its own code comment); Business Ledger's summary view shows `closing_balance`
    instead of a Debit/Credit split (the backend computes a point-in-time balance, not a
    period activity split, for the summary — only `view: 'detail'` has real Debit/Credit rows);
    Overall Trail dropped the `subcustomer` filter pill (sub-customers have no `ba_id` and never
    appear in `reports:overall-trail`, confirmed by the service's own code comment) and gained a
    `bank` one (the real `entity_type`/`category` enums distinguish `BANK` from generic
    `BUSINESS_ACCOUNT`, which the demo data model never did).
  - Material Stock Adjustment modal (`ReportStockPage.tsx`) dropped the Add-material direction —
    only `stock:reduce-vendor-stock` (consume) is real; user-approved decision from planning.
  - Every "opening balance" and "running balance" figure across Vendor Report, Khaata, Business
    Ledger, Overall Trail, and Overall Search now comes directly from the backend's own
    `accountLedger()`/`netBalance()` computation (`business_accounts.opening_balance` + ledger sum
    to date) instead of being derived client-side from raw demo arrays — these were never
    equivalent, so this is a full replacement, not a like-for-like port.
- **Files:** `backend/src/repositories/reports.repository.js` (see the widening entry above),
  `frontend/src/lib/api.ts`, `frontend/src/pages/ReportStockPage.tsx`,
  `frontend/src/pages/SaleAnalysisPage.tsx`, `frontend/src/pages/SaleReportPage.tsx`,
  `frontend/src/pages/VendorReportPage.tsx`, `frontend/src/pages/PaymentTrailPage.tsx`,
  `frontend/src/pages/ReportKhaataPage.tsx`, `frontend/src/pages/BusinessLedgerContent.tsx`,
  `frontend/src/pages/ReportCashBookPage.tsx`, `frontend/src/pages/ProductLedgerContent.tsx`,
  `frontend/src/pages/OverallTrailContent.tsx`, `frontend/src/pages/BiltyUpdatePage.tsx`,
  `frontend/src/pages/OverallSearchPage.tsx`.

## Milestone 5, Module 5.1 — Vendor Stock breakdown widening for frontend wiring

### 2026-08-07 — Widened `reports:vendor-stock` with purchased/returned breakdown
- **What:** `reports.repository.js#vendorStock()` now returns `purchased_qty`/`returned_qty`
  alongside the existing `on_hand`, needed to preserve the frontend Current Stock page's existing
  Material Stock breakdown view (rather than simplifying the UI to net-only, per explicit user
  decision). No schema change — `dbo.vendor_stock_movements.movement_type` was already a real,
  CHECK-constrained discriminator (`PURCHASE`/`PURCHASE_RETURN`/`CONSUMPTION`/`ADJUSTMENT`) with
  sign-constrained `qty`, conditional aggregation was all that was needed.
- **How:** Also dropped the existing `HAVING SUM(vsm.qty) <> 0` — it would hide a material that
  was purchased and later fully consumed (on_hand = 0 but real purchased/returned history exists),
  which the breakdown view needs to show. Verified live: query executes cleanly against
  `wentox_db`.
- **Files:** `backend/src/repositories/reports.repository.js`.

## Milestone 4, Modules 4.5/4.6/4.7 — Payroll frontend wiring (Employees & Stages, Wage Run, Salary Run)

### 2026-08-07 — Connected all three Payroll pages to real `window.api` — Milestone 4 frontend now fully complete
- **What:** `EmployeeSetupPage.tsx`, `WageRunPage.tsx`, `SalaryRunPage.tsx` rewired off the demo
  `AppContext` reducer onto real `employees`/`stages`/`wageRuns`/`salaryRuns` IPC calls — the last
  remaining frontend gap in Milestone 4. `frontend/src/lib/api.ts` gained `StageRow`/`EmployeeRow`/
  `WageRunRow`/`WageRunItemRow`/`SalaryRunRow`/`SalaryRunItemRow` types and matching wrapper
  objects (`stages`, `employees`, `wageRuns`, `salaryRuns`), plus a `ProductRow` widening to
  include the 12 manufacturing-stage cost columns (`a.*` in `products.repository.js` already
  returned them — the typed wrapper just hadn't caught up).
- **How:**
  - Dropped the frontend's free-text "Register Custom Trade" escape hatch — the real `stages`
    table is a closed, seeded set of 12, and `employees.service.js#validate()` rejects any
    unknown `stage_key`. The trade grid now sources from `stages:list()` directly.
  - Dropped the 100%-frontend business-account-code computation
    (`getNextAccountCode`/`ADD_BUSINESS_ACCOUNT`) — `employees:create()` already creates the
    linked `business_accounts` row server-side in its own transaction.
  - Duplicate-name (`DUPLICATE_NAME`/`INACTIVE_DUPLICATE`) handling added to
    `EmployeeSetupPage.tsx`, same reactivate-offer pattern as `BankSetupPage.tsx`/`vendors`.
  - `lib/payroll.ts`'s `accruedUpto`/`paidUpto`/`getEmployeeBalance`/`getRunBalanceBlock` used to
    read `state.wageRuns`/`state.salaryRuns`/`state.expenses` directly — since (matching every
    other connected module) `AppContext`'s demo arrays stay untouched and real data lives in each
    page's own local state, these were rewritten to take explicit arrays as parameters instead.
    Since `salaryRuns:list()` carries no line items (only the new `item_count`), a salaried
    employee's accrual across multiple runs required flattening each CONFIRMED run's `items` via
    `salaryRuns.get(id)` once on `EmployeeSetupPage` mount — small, bounded by run count (roughly
    one per month), not per employee.
  - **Found and fixed a real bug during live verification, not introduced by this change but
    exposed by it**: the stage-picker dropdown on `WageRunPage.tsx` called `useState`/`useRef`/
    `useEffect` inside an IIFE that only executed once a selected worker had ≥1 registered trade —
    a Rules-of-Hooks violation (conditionally-called hooks) that had been sitting in the demo code
    unnoticed because nothing had exercised that exact state transition before. Selecting a worker
    with a trade threw "Rendered more hooks than during the previous render" and blanked the whole
    page (no error boundary). Fixed by hoisting the hooks to the component's top level,
    unconditional.
  - Live-verified via Electron + CDP (Node `WebSocket`, same technique as every prior module):
    worker with 0 trades rejected; worker with 1 real trade created, linked BA under `220001`
    confirmed; salaried employee created, linked BA under `220002` confirmed; duplicate name+phone
    against an active employee correctly rejected with no crash; Wage Run — worker/stage picker
    correctly restricted to the real registered trade, article pick correctly snapshotted
    rate/packing, 20×5×12=1200 computed correctly, post → `Dr WAGES EXPENSE(410001) 1200 /
    Cr worker.ba_id 1200` confirmed in `ledger_entries`, unpost → ledger rows removed + audit
    columns set, edit-and-repost round-tripped correctly; Salary Run — roster built from the real
    salaried employee, override to 55000 with remarks posted → `Dr SALARIES EXPENSE(410002) 55000
    / Cr employee.ba_id 55000` confirmed, `salary_run_items` snapshot correct
    (`salary_amount=60000`, `amount=55000`); a second CONFIRMED run for the same month correctly
    shown as already-posted with Post disabled; Employees directory's Current Balance column
    verified correct for both the worker (Rs 1,200 accrued, nothing paid) and the salaried
    employee (Rs 55,000 accrued from the posted run).
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/lib/payroll.ts`,
  `frontend/src/pages/EmployeeSetupPage.tsx`, `frontend/src/pages/WageRunPage.tsx`,
  `frontend/src/pages/SalaryRunPage.tsx`.

## Milestone 4, Modules 4.5/4.6/4.7 — Payroll `list()` widenings for frontend wiring

### 2026-08-07 — Widened `employees`/`wageRuns`/`salaryRuns` list() to close the list-lacks-detail gap
- **What:** Three small, additive `list()` widenings needed to start wiring the Payroll frontend
  (Employees & Stages, Wage Run, Salary Run) to real data — the same "list rows lack detail"
  gotcha every prior connected module has hit. No new tables/columns, no service changes, no
  migration.
- **How:** `employees.repository.js#list()` gained a correlated `STRING_AGG(ws.stage_key, ',')
  WITHIN GROUP (ORDER BY s.sort_order)` subquery over `worker_stages`↔`stages`, returned as
  `stage_keys` — lets the Employees directory show a worker's trades, and lets the Wage Run
  screen restrict its stage picker to the selected worker's trades, both off the list alone (no
  N+1 `get()` per row/selection). `wageRuns.repository.js#list()` and
  `salaryRuns.repository.js#list()` each gained a scalar `item_count` subquery (`COUNT(*)` over
  `wage_run_items`/`salary_run_items`) so their History tables can show line/employee counts
  without fetching full `items` per row. Verified live against `wentox_db` (currently 0 rows in
  all three tables, but the STRING_AGG/subquery syntax executes cleanly).
- **Files:** `backend/src/repositories/employees.repository.js`,
  `backend/src/repositories/wageRuns.repository.js`,
  `backend/src/repositories/salaryRuns.repository.js`.

## Milestone 4 — new `businessAccounts:list` (read-only)

### 2026-08-07 — New `businessAccounts:list` channel (+ a bug fixed same-day)
- **What:** Added a read-only listing endpoint for "any business account" — needed by two pickers
  that hit the same gap during frontend wiring: Expenses' non-vendor payment target (Office Rent,
  Utilities, an employee — `expenses.service.js#resolveTarget()` already accepted a raw `ba_id` for
  this, just had nothing to list from) and Cheques' EXPENSE_PAYMENT disposition (disabled in the
  frontend during Module 4c for the same reason). `businessAccounts.ipc.js` was previously an empty
  stub (`create`/`update`/`remove`/`get`/`list` all commented out as `TODO(milestone)`).
  `create`/`update`/`remove`/`get` remain unregistered — no UI needs direct business-account CRUD
  yet (accounts are still only ever created via a party's own setup flow — vendor, customer,
  bank account).
- **How:** `businessAccounts.repository.js#list(filters)` — joins `chart_of_accounts` for
  `chart_code`/`chart_name` (so a picker can show/filter by parent head, e.g. "under Vendors
  Accounts" vs "under Business Running Expenses"), filterable by `ac_id?`/`status?` (default
  `ACTIVE`)/`search?`. Thin passthrough in `businessAccounts.service.js#list()`, registered as the
  wire channel `business-accounts:list` (kebab-case — `window.api.businessAccounts.list()` on the
  frontend, per `ipcBridge.ts`'s `camelToKebab()` convention every other feature already follows).
- **Bug found during live verification**: the channel was initially registered as
  `businessAccounts:list` (camelCase, matching the JS file/service name instead of the wire
  convention) — every other `*.ipc.js` file in this codebase registers kebab-case
  (`sub-customers:list`, `bank-accounts:list`, etc), and `ipcBridge.ts`'s Proxy always calls the
  kebab form. Caught immediately by a live "No handler registered for 'business-accounts:list'"
  error the moment the Expenses page tried to use it; fixed to `business-accounts:list`.
- **Files:** `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/businessAccounts.service.js`, `backend/src/ipc/businessAccounts.ipc.js`.
- **Verified:** live end-to-end via the real Electron app as part of the Expenses frontend wiring
  pass (see Module 4.2 log).

---

## Milestone 4, Module 4.1 — Receipts/Cheques (bug fix)

### 2026-08-07 — `receipts:get` was missing `cheque_received_date`
- **What:** `receipts.repository.js#findById()`'s join to `dbo.cheques` selected `cheque_no`/
  `cheque_date`/`cheque_status`/`bank_id` but omitted `cheque_received_date` — a real column,
  genuinely missing from the SELECT list (not a design choice). Found while wiring the frontend's
  Receipts edit flow: reopening a CHEQUE receipt for edit always came back with the received-date
  field blank.
- **How:** One-line fix — added `ch.cheque_received_date` to the SELECT.
- **Files:** `backend/src/repositories/receipts.repository.js`.
- **Verified:** module loads cleanly; live verification happens as part of the frontend wiring pass.

---

## Milestone 4, Module 4.1 — Receipts/Cheques (allocation-history addendum)

### 2026-08-06 — New `cheques:allocations-for-receipt` channel
- **What:** Added a read-only channel exposing the full allocation history (all disposition types,
  including DEPOSIT and REVERSED rows) for one cheque's receipt — needed by the Cheques tab's
  per-cheque history view during frontend wiring. `cheques:endorsed-allocations` was already built
  but deliberately excludes DEPOSIT/REVERSED (it's the narrower "Cheque Return" undo-picker), so it
  couldn't serve this purpose.
- **How:** `repository.listAllocations(receiptId)` already existed (used internally elsewhere) but
  had no IPC channel — just wired it through a thin `cheques.service.js#listAllocationsForReceipt()`
  passthrough. No schema/migration change, no new logic.
- **Files:** `backend/src/services/cheques.service.js`, `backend/src/ipc/cheques.ipc.js`.
- **Verified:** both files load cleanly (`node -e "require(...)"`); live end-to-end verification
  happens as part of the frontend wiring pass for this module.

---

## Milestone 4, Module 4.4 — Transfer (Deposit addendum)

### 2026-08-06 — New "Deposit" feature (one-sided manual account adjustment)
- **What:** Added a `deposits` feature alongside `transfers` — a one-sided manual credit/debit
  adjustment to a single business account (owner capital, bank fees, etc), requested during
  frontend wiring of the Transfer module since the frontend's demo `TransferPage.tsx` has a
  "Deposit" mode with no prior backend equivalent at all.
- **How:** Mirrors `transfers.*` almost exactly (create as DRAFT, `update`/`remove` blocked once
  CONFIRMED via `POSTED_LOCK`, `post`/`unpost` toggling ledger rows + status, no password guard),
  but one side of the double-entry is a fixed reserved chart account (`MISC_ADJUSTMENTS`, code
  `400006`, new entry in `reservedAccounts.js` + seeded in `db/seeds/run.js`) instead of a second
  `ba_id` — same pattern Purchases already uses for `PURCHASES`. `direction='CREDIT'` → Dr `to_ba_id`
  / Cr `MISC_ADJUSTMENTS`; `direction='DEBIT'` → Dr `MISC_ADJUSTMENTS` / Cr `to_ba_id`,
  `source_type='DEPOSIT'`. New table `dbo.deposits` (mirrors `dbo.transfers`' shape minus the second
  account) added via a temporary migration (`010_deposits.sql`), applied + verified against
  `wentox_db`, then folded directly into `database/schema.sql` and the migration file deleted — same
  cycle used for this project's other schema changes. `CK_ledger_entries_src` widened to allow
  `'DEPOSIT'` as a `source_type` (also via the same migration, folded in place in schema.sql).
- **Files:** `database/schema.sql` (new `dbo.deposits` table + widened `CK_ledger_entries_src`),
  `backend/src/repositories/deposits.repository.js`, `backend/src/services/deposits.service.js`,
  `backend/src/ipc/deposits.ipc.js`, `backend/src/ipc/index.js` (registered), `backend/src/constants/reservedAccounts.js`
  (+`MISC_ADJUSTMENTS`), `backend/src/db/seeds/run.js` (+seeded the new chart account),
  `frontend/src/lib/ipcBridge.ts` (+`deposits` to `FEATURES`).
- **Verified:** ran the migration + seed against the live dev DB — confirmed `dbo.deposits` exists,
  `MISC_ADJUSTMENTS` (code `400006`) seeded at `ac_id=17`, and `CK_ledger_entries_src` now permits
  `'DEPOSIT'`. Live end-to-end CREDIT/DEBIT posting verification happens as part of the frontend
  wiring pass for this module (see Module 9.2 log once that lands).

---
## Milestone 9, Module 9.1 — follow-up: alerts computed by a startup job, persisted, not live

### 2026-08-05 — New `generated_alerts` table; a real (if minimal) "cron job"
- **What:** User wanted alerts computed by a job that runs when the app starts, not recomputed
  live on every `alerts:list` call. New `dbo.generated_alerts` table (migration
  `011_generated_alerts.sql`, folded into `database/schema.sql` directly too, matching how
  migration 010 was handled). `alerts.service.js#refreshAlerts()` is the job body: same
  cheque-due/sale-bill-due queries `list()` used to run live, now upserted into `generated_alerts`
  by `alert_key`, with a cleanup pass (`deleteGeneratedNotIn`) removing any stored row no longer in
  the fresh set. `list()` now just reads that table — cheap, no recomputation — and derives
  `severity` live from `alert_date` vs today at read time (deliberately not stored, so display
  can't go stale between job runs even though the job itself doesn't repeat).
- **Trigger, per explicit choice (asked directly, user picked "startup only, no repeat" over
  hourly/15-minute options):** `electron/main.js#app.whenReady()` calls `refreshAlerts()` once,
  right after `registerIpcHandlers()`, not awaited (so a slow/unreachable DB doesn't delay the
  window opening) and wrapped in `.catch()` (so a failure logs instead of crashing startup). No
  `setInterval`, no scheduler library — "once per app launch" is the entire mechanism.
- **Known trade-off, accepted not fixed:** since the job never repeats, a cheque/bill that newly
  enters the 7-day window during a long-running session won't appear until the app is restarted.
  This was the explicit choice offered and picked, not an oversight.
- **Files:** `backend/src/db/migrations/011_generated_alerts.sql`, `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md`, `backend/src/repositories/alerts.repository.js`,
  `backend/src/services/alerts.service.js`, `backend/electron/main.js`.

## Migration 010's columns folded into `database/schema.sql` directly

### 2026-08-05 — `database/schema.sql`'s own `dbo.expenses` now carries the issued-cheque reversal columns
- **What:** Per explicit instruction, `010_expenses_issued_cheque_reversal.sql`'s columns
  (`issued_cheque_status`/`issued_cheque_bounced_date`/`issued_cheque_returned_date`/
  `issued_cheque_return_reason`), its three CHECK constraints, and its filtered index are now also
  baked directly into `database/schema.sql`'s `dbo.expenses` table — not just the migration file
  and `database_schema_v4.3.md`. Matches the existing precedent already in this file for
  `sale_bills.due_date` (added post-v4.3 the same way, flagged "POST-v4.3: re-added").
  `dbo.draft_expenses` was deliberately NOT touched — a draft is never posted, so it can't have a
  bounced/returned status to track.
- **Still needed on a live/already-applied database:** `schema.sql` only describes a *fresh*
  database — an existing `wentox_db` still needs migration `010_expenses_issued_cheque_reversal.sql`
  run against it to actually gain these columns; editing `schema.sql` doesn't retroactively alter a
  database that was already created from an earlier copy of this file.
- **Files:** `database/schema.sql` only.

### 2026-08-05 — Simplified per explicit instruction: no schema change needed
- **What:** Removed the "Disposition" column entirely. Every row — endorsed-to-vendor/expense
  (`ALLOCATION`), cheque-we-wrote (`ISSUED`), and deposited-awaiting-clearance (`DEPOSITED`) — now
  shows the exact same two buttons: **Return** and **Mark Cleared**. What each button actually does
  underneath is still routed by the row's real `kind` internally (never shown) — an `ALLOCATION`
  Return still reverses one allocation, an `ISSUED` Return still reverses the expense's ledger
  entry, a `DEPOSITED` Return now means "the bank bounced/rejected it" (reverses the *original
  receipt*), and a `DEPOSITED` Mark Cleared is still the real `MARK_CHEQUE_CLEARED` dispatch.
- **Key decision, resolved via two clarifying rounds:** "Mark Cleared" on an `ALLOCATION`/`ISSUED`
  row has **no equivalent backend concept** — once a cheque is endorsed or issued, the money
  already moved, so there's nothing pending to "clear" (unlike a deposited cheque, which has a real
  `CLEARED` status waiting on bank confirmation). Explicitly chosen as a **local-only dismissal**
  (a `dismissedKeys` Set in component state) rather than inventing a new schema status for this —
  **no migration, no schema change**. Only `DEPOSITED`'s Mark Cleared writes real state.
- **Files:** `frontend/src/pages/ChequeReturnPage.tsx` only — no backend files touched.

## Milestone 9, Module 9.3 — follow-up: Check for Updates gets its own page; deposited cheques get both actions

### 2026-08-05 — Two corrections after user review of the running app
- **Check for Updates moved to its own page.** It was a card inside `SettingsPage.tsx`; user said
  "make proper page." New `CheckForUpdatesPage.tsx`, own `NavPage` value (`check-updates`), own
  sidebar entry under System Setup (admin-only), routed in `App.tsx`. `SettingsPage.tsx` reverted
  back to just the admin-credentials form — nothing else changed about the update-check logic
  itself, only where it lives.
- **Cheque Return's `DEPOSITED` row now shows BOTH "Return" and "Mark Cleared."** Originally built
  with "Mark Cleared" only; user pointed out a deposited cheque has two real, mutually exclusive
  outcomes — the bank clears it, or the bank bounces/rejects it — so both need to be offered,
  matching how `ChequesTab.tsx` already shows multiple coexisting actions per cheque. "Return" on a
  `DEPOSITED` row now opens the same confirm modal as the other two row kinds, with its own
  copy describing a bank bounce (reverses the *original receipt*, restoring the customer's due —
  the same whole-cheque reversal `cheques.service.js#bounce()`/`#returnToSender()` do on the real
  backend, distinct from `ALLOCATION`'s narrower single-allocation reversal). "Mark Cleared" is
  unchanged (still a real dispatch, not a preview).
- **Files:** `frontend/src/pages/CheckForUpdatesPage.tsx` (new), `frontend/src/pages/SettingsPage.tsx`
  (reverted), `frontend/src/App.tsx`, `frontend/src/components/AppLayout.tsx`,
  `frontend/src/types/index.ts`, `frontend/src/pages/ChequeReturnPage.tsx`.

## Milestone 9, Module 9.3 — Check for Updates; Cheque Return — Mark Cleared follow-up

### 2026-08-05 — electron-updater wired (check/install), first real window.api page; Cheque Return gained a Mark Cleared row
- **What (Check for Updates):** New `electron-updater` dependency. `src/services/updates.service.js`
  (no repository — nothing here touches SQL): `check()` probes internet via a HEAD request to
  `api.github.com` specifically (not a generic host), then calls `autoUpdater.checkForUpdates()`
  (fed via `setFeedURL({provider:'github', owner:'SubhanNoor', repo:'Wentox_sole'})`, not an
  electron-builder-generated `app-update.yml`, since packaging isn't set up yet). Two distinct
  failure points per explicit instruction: no internet AT ALL upfront throws `ApiError`
  (`NO_INTERNET`, shown to the user); a connection dropping *during* the actual update lookup
  (having passed the internet check) is caught internally and reported as "no update," never
  surfaced as an error. `install()` downloads and calls `quitAndInstall()` once the user confirms.
  `updates:check`/`updates:install` IPC channels. `SettingsPage.tsx` (frontend) gained a real
  "Check for Updates" card calling `window.api.updates.check()`/`.install()` — the first page in
  this entire frontend to call the real backend instead of `AppContext` demo data (there's no
  meaningful demo version of an internet/update check to fake). New `frontend/src/types/
  electron-api.d.ts` ambient type for `window.api` (didn't exist at all before this).
- **Also found while scoping this**: `npm run electron:dev` (Vite + Electron concurrently) was
  already present in `package.json` — nothing to build there, milestone9.md checkbox just hadn't
  been ticked. `electron-builder` packaging config intentionally deferred — nothing meaningful to
  package while the frontend still runs on demo data (Module 9.2).
- **What (Cheque Return — Mark Cleared):** User pointed out a gap on the "Cheque Return" page: a
  deposited cheque that's actually cleared by the bank has no reason to keep sitting on that page
  (nothing left to return), but its ledger entry must stay untouched. Added a third row kind,
  `DEPOSITED`, sourced from `state.receipts` where `chequeStatus === 'DEPOSITED'`. "Mark Cleared"
  dispatches the real `MARK_CHEQUE_CLEARED` reducer action (already used correctly by
  `ChequesTab.tsx`) rather than a preview message — the one deliberate exception to this page's
  "not connected" scaffolding, since there's no reason to fake an action that already works. The
  row disappears from the list on its own once `chequeStatus` flips to `'CLEARED'`, no extra
  removal logic needed.
- **Debugger pass, twice** (Check for Updates backend, then the frontend `SettingsPage.tsx`
  addition + the `ChequeReturnPage.tsx` `DEPOSITED` row together) — both clean, no bugs found.
  Checked: `checkInternet()`'s promise-settlement paths, the internet-check-vs-mid-check failure
  boundary, `install()`'s double-reject safety, IPC/`FEATURES` registration, and that a `DEPOSITED`
  row can never reach the Return-confirmation modal's `ALLOCATION`/`ISSUED`-only ternary.
- **Not live-verified this session** — no SQL Server or packaged Electron build available in this
  sandbox; the update-check flow additionally can't be meaningfully tested at all until
  `electron-builder` packaging exists.
- **Files:** `backend/package.json`, `backend/src/services/updates.service.js`,
  `backend/src/ipc/updates.ipc.js`, `backend/src/ipc/index.js`, `backend/electron/preload.js`,
  `frontend/src/pages/SettingsPage.tsx`, `frontend/src/types/electron-api.d.ts`,
  `frontend/src/pages/ChequeReturnPage.tsx`.

## Milestone 9, Module 9.1 — Alerts

### 2026-08-05 — Cheque-due AND sale-bill-due-date alerts, both wired up
- **What:** `alerts:list`/`alerts:dismiss`. User explicitly asked for both a cheque-date alert and a
  sale-bill due-date alert, 7 days out, dismissible — overriding milestone9.md's original "payment-
  overdue alert dropped in v4.3, cheque-due only" plan. Turned out to need no schema change at all:
  `database/schema.sql` already had `sale_bills.due_date` and `alert_dismissals` re-added, with a
  comment on the latter literally saying "this alert isn't wired up yet" — `database_schema_v4.3.md`
  had the same column already in its own CREATE TABLE block, just stale surrounding prose from
  before that restoration. Only the code (`alerts.repository/service/ipc.js`) was actually missing.
- **How:** `chequeDueRows()` reuses `IX_cheques_due`'s exact filter (`cheque_status IN ('PENDING',
  'PARTIALLY_ENDORSED')`); `saleBillDueRows()` only considers POSTED bills (derived via a
  `ledger_entries` existence check, matching how "posted" is derived everywhere else — `sale_bills`
  has no status column of its own). Both are unconditional — no "balance still positive" check —
  since that would need a per-bill payment link this schema doesn't have (receipts are customer-
  level, never tied to a specific bill); matches what was actually asked for, not UC-05's original,
  now-stale wording. `alert_key` = `CHEQUE_DUE:<cheque_id>` / `PAYMENT_OVERDUE:<bill_id>`; dismiss
  is permanent (`dismissed_until` stays `NULL`) and idempotent.
- **Not live-verified this session** — no SQL Server reachable in this sandbox.
- **Files:** `src/repositories/alerts.repository.js`, `src/services/alerts.service.js`,
  `src/ipc/alerts.ipc.js`, `src/ipc/index.js`, `electron/preload.js`,
  `System_architecture/database_schema_v4.3.md` (prose reconciliation only, no schema change).

## Milestone 8, Modules 8.2 & 8.3 — Account Classes, Group/Chart/Business Accounts CRUD, Accounts Tree

### 2026-08-05 — Built the last unbuilt system-setup layer (UC-15/16/17), found and fixed one real IPC bug before it shipped
- **What:** `accountClasses` (read-only lookup), `groupAccounts` (full CRUD), `chartAccounts` (full
  CRUD), `businessAccounts` (filled in `list()`/`update()`/`remove()`/`reactivate()` on top of the
  existing `createUnderChartCode()`/`getById()`/`getCashAccount()`), and a new `accounts:tree`
  cross-entity read. Full detail in `milestones/milestone8.md` Modules 8.2/8.3.
- **Key decisions:** `groupAccounts` code = `<classDigit><3-digit serial>` (new class→digit
  mapping, since `account_classes.code` is text); `chartAccounts` code = `<group.code><2-digit
  serial>`, matching the majority of already-seeded reserved codes (4 payroll codes are pre-existing
  outliers, flagged not fixed). Neither `chart_of_accounts` nor `business_accounts` has a hard
  delete — both "remove" to `status = 'CLOSED'` (their only soft-delete column), blocked outright
  for reserved chart codes and for any business account already owned by a vendor/customer/
  employee/bank. `is_restricted` chart accounts (and business accounts under them) hidden from
  non-ADMIN sessions across `list()`/`get()`/the tree, reusing `reports.service.js#paymentTrail()`'s
  existing `session.role === 'ADMIN'` pattern (TASK-14) rather than inventing a new one.
- **Bug found and fixed before this was ever run**: every new multi-word-feature `.ipc.js` file
  (`businessAccounts`, `chartAccounts`, `groupAccounts`, `accountClasses`) registered camelCase
  channel prefixes (`businessAccounts:list`), but `preload.js`'s `camelToKebab()` only ever computes
  a kebab-case prefix from the `FEATURES` array (`business-accounts`) — every one of those channels,
  including `businessAccounts:getCashAccount` from the earlier Cash/Transfer fix this same day,
  would have been unreachable from the renderer. Fixed across all four files to match
  `bankAccounts.ipc.js`/`subCustomers.ipc.js`'s existing convention.
- **Debugger pass found one more real bug**: `businessAccounts.service.js#create()`'s `validate()`
  only checked `name`/`ac_id` — `dbo.business_accounts`'s `CK_business_accounts_opening` requires
  `opening_balance`/`opening_date` together or neither, so a payload with only one of the two would
  have hit a raw SQL CHECK-constraint violation, which isn't an `ApiError` and so gets swallowed by
  `ipc/wrap.js` into an opaque `INTERNAL` error with no indication which field was wrong. Fixed with
  an explicit both-or-neither check in `validate()`, matching `CK_receipts_cheque`-style guards
  elsewhere in this codebase that exist specifically to keep a DB constraint violation from ever
  reaching the wire unexplained.
- **Not live-verified this session** — no SQL Server reachable in this sandbox; no schema change
  needed (the four tables already exist), but every new channel still needs a real CRUD pass
  against `wentox_db` before this is "done" the way the rest of this log has been.
- **Files:** `src/repositories/{accountClasses,groupAccounts,chartAccounts,businessAccounts,
  accountsTree}.repository.js`, `src/services/{accountClasses,groupAccounts,chartAccounts,
  businessAccounts,accountsTree}.service.js`, `src/ipc/{accountClasses,groupAccounts,chartAccounts,
  businessAccounts,accounts}.ipc.js`, `src/ipc/index.js`, `electron/preload.js`.

## Milestone 4, Module 4.4 — Transfer — follow-up: cash had no business account, so cash↔bank transfers were impossible

### 2026-08-05 — Seeded a Cash business account; Cash Book now reads both dimensions cash posts across
- **What:** Auditing milestones 1–7 for anything still missing (excluding frontend wiring) surfaced
  a real gap: `dbo.transfers.from_ba_id`/`to_ba_id` are FKs to `business_accounts` only, but
  `src/db/seeds/run.js` never created a `business_accounts` row for `CASH_IN_HAND` — only banks got
  one. So a cash↔bank transfer was impossible to create at all, even though
  `database/schema.sql`'s own comment on `business_accounts.opening_balance` says "cash needs one,
  every bank needs one," and `cash_and_bank.md` §9 (decisions 4/5) requires exactly this (a single
  Petty Cash account, opening balance on `business_accounts`) — §7 calls bank→cash "likely the most
  common [transfer] of all" (wage withdrawals).
- **How:** `ensureCashBusinessAccount()` added to `src/db/seeds/run.js` — idempotent, same
  `code = chartCode + '0001'` composition every other reserved-account row uses, runs right after
  the `CASH_IN_HAND` chart account is ensured, backfills on a re-seed of an already-live DB.
  `businessAccountsRepository.findByAcId()` + `businessAccountsService.getCashAccount()` resolve it
  by chart code (matching every other reserved-account lookup pattern in this codebase, e.g.
  `chartAccountsRepository.findByCode`), rather than a hardcoded id. New
  `businessAccounts:getCashAccount` IPC channel for a future Transfer screen's "Cash" option.
  Fixed the report-side consequence at the same time: `reports.service.js#cashBook()` was reading
  only `ledger_entries WHERE ac_id = CASH_IN_HAND's ac_id` — since a cash-side transfer posts via
  the new Cash `ba_id` instead (same as every other transfer party), that query would have silently
  missed it. `reports.repository.js#ledgerRows()`/`#netBalance()` gained an OR-condition path for
  when BOTH `ba_id` and `ac_id` are passed together (only `cashBook()` does this; every other
  caller still passes exactly one, unchanged) — matches rows from either dimension. Opening balance
  for the combined query still only comes from the `business_accounts` side (chart accounts have no
  `opening_balance` column).
- **Known trade-off, not fixed:** Overall Trail will now show cash as two separate rows whenever a
  cash-side transfer exists — one Chart-of-Account row for `CASH_IN_HAND` (from CASH
  receipts/expenses, unchanged), one business-account row for the new Cash account (from transfers
  only). Each is individually correct; nothing is double-counted or lost, it's just split across
  two lines instead of one. Fully unifying it would mean switching CASH receipts/expenses to post
  via the Cash `ba_id` too (matching how banks work — ONLINE/CHEQUE_ISSUED never post to a chart
  account directly) — a larger, riskier change touching `receipts.service.js`/`expenses.service.js`
  and out of scope for this fix.
- **Not verified live this session** — no SQL Server reachable in this sandbox. Needs `npm run
  seed` (backfills the Cash business account on the existing `wentox_db`) + a live cash↔bank
  transfer create/post + Cash Book check, on a machine with the DB running, before this is
  considered done the way every other entry in this log has been.
- **Files:** `src/db/seeds/run.js`, `src/repositories/businessAccounts.repository.js`,
  `src/services/businessAccounts.service.js`, `src/ipc/businessAccounts.ipc.js`,
  `src/repositories/reports.repository.js`, `src/services/reports.service.js`.

## Milestone 4, Module 4.2 — Expenses / Kharch — follow-up: Cheque Return for issued cheques

### 2026-08-05 — Bounce/return for CHEQUE_ISSUED expenses (a cheque WE wrote, not just endorsed ones)
- **What:** The existing "Cheque Return" page (2026-08-04 entry below) only covered undoing one
  endorsement of a customer's cheque we'd passed on (`cheques.service.js#reverseAllocation`). User
  pointed out the gap: a cheque **we** write to pay a vendor (`CHEQUE_ISSUED` expense) can also
  bounce, and had no reversal path at all — deliberately, by the original schema design
  (deduct-on-write, no pending state, no `cheques` row). Added `expenses.service.js#bounceIssuedCheque()`
  / `#returnIssuedCheque()`, the mirror image of `cheques.service.js#reverseCheque()` but for an
  `expenses` row instead of `cheques`/`receipts` rows.
- **How:** New columns directly on `expenses` — `issued_cheque_status` (`PENDING`/`BOUNCED`/
  `RETURNED`), `issued_cheque_bounced_date`, `issued_cheque_returned_date`,
  `issued_cheque_return_reason` — same shape as `cheques`' own bounce/return columns, kept here
  instead since a cheque we write still isn't a `cheques` row. `reverseIssuedCheque()` (shared by
  both actions) requires the expense to be `CHEQUE_ISSUED`, `CONFIRMED`, and still `PENDING`, then
  writes the opposite ledger pair (`Dr bank ba_id / Cr expense.ba_id` — undoing the original
  `Dr ba_id / Cr bank_id`) dated the bounce/return date, and flips the status — nothing deleted or
  rewritten, same reverse-never-delete rule as every other bounce/return flow. New
  `listReturnableIssuedCheques()` (CONFIRMED, `CHEQUE_ISSUED`, `PENDING`) feeds the same "Cheque
  Return" page as the existing endorsed-allocations list, per explicit user request — one page, one
  merged row set, with the "From" column showing our bank's name instead of a customer's name for
  these rows. New IPC channels `expenses:bounceIssuedCheque` / `expenses:returnIssuedCheque` /
  `expenses:returnableIssuedCheques` (camelCase action names, matching the documented
  `productColors.ipc.js` convention — `cheques.ipc.js`'s kebab-case actions predate that
  convention and were left as-is, not touched here). Frontend: `ChequeReturnPage.tsx` (still
  NOT CONNECTED demo scaffolding, same as the rest of the frontend) now merges endorsed-allocation
  rows and issued-cheque rows into one table; `Expense` type gained the matching
  `issuedChequeStatus`/`issuedChequeBouncedDate`/`issuedChequeReturnedDate`/`issuedChequeReturnReason`
  fields.
- **Files:** `System_architecture/database_schema_v4.3.md`,
  `backend/src/db/migrations/010_expenses_issued_cheque_reversal.sql`,
  `backend/src/repositories/expenses.repository.js`, `backend/src/services/expenses.service.js`,
  `backend/src/ipc/expenses.ipc.js`, `frontend/src/types/index.ts`,
  `frontend/src/pages/ChequeReturnPage.tsx`.

## Milestone 5, Module 5.2 — Reports — Milestone 5 now fully complete

### 2026-08-04 — All 11 reports built in one pass (9 originally-deferred + 2 new user-requested), backed directly by `ledger_entries`
- **What:** Every report in the sidebar's Reports Hub, plus a new "Overall Trail" (a full trial
  balance across every account) and a new "Overall Searching" directory (type a name, get back
  the matching customer/vendor/employee/sub-customer/business account, backed by a SQL VIEW per
  explicit user request so it auto-reflects source-table changes with no app-side merge code).
  Both new reports came from the user attaching screenshots of an already-built demo frontend page
  (`OverallTrailContent.tsx`, `OverallSearchPage.tsx`) and asking for the real backend behind it.
- **Core design decision:** rather than recomputing balances from source documents the way the
  demo frontend does (client-side, filtering arrays), everything here reads `dbo.ledger_entries`
  directly — the single double-entry journal every CONFIRMED document already posts to. This is
  what `database_schema_v4.3.md`'s own comments on `ledger_entries`/`chart_of_accounts` describe as
  the intended query shape ("Trial Balance report (GROUP BY ac_id/ba_id, SUM(debit), SUM(credit))"),
  and it means the Overall Trail's grand total genuinely balances (verified live: total debit ==
  total credit across every account) rather than being an approximation.
- **Shared building block:** `reports.repository.js#ledgerRows()` — one query per account (ba_id
  or ac_id) that LEFT JOINs `ledger_entries` back to whichever source doc produced each row based
  on `source_type` (sale_bills, sale_returns, receipts→cheques, expenses→business_accounts,
  wage_runs, salary_runs, transfers→business_accounts). Backs 4 of the 11 reports: Account Ledger
  (Khaata), Business Ledger's detail view, Overall Trail's drill-down, and Overall Search's
  drill-down. `netBalance()`/`businessAccountBalancesAsOf()`/`chartAccountBalancesAsOf()` compute
  balance-as-of-a-date the same way everywhere: `business_accounts.opening_balance` (a stored
  INPUT, if `opening_date` is on/before the date) + every ledger row up to that date — chart
  accounts have no opening_balance column, so they skip straight to the ledger sum.
- **A real bug caught during live testing, not by the debugger:** the first version of
  `formatLedgerRow()` always preferred `receipts.remarks` over `ledger_entries.narration` for
  `RECEIPT`-sourced rows — correct for a normal receipt (UC-35's own spec: narration = the
  receipt's free text), but WRONG for a bounce/return reversal, which deliberately reuses
  `source_type='RECEIPT'` on the same `receipt_id` (reverse-never-erase, §6.1) with its own
  narration like `"BOUNCED reversal of receipt #18"`. Found by manually inspecting real leftover
  test data from an earlier session's bounce test — the reversal row was silently showing the
  original receipt's remarks instead of "BOUNCED reversal...". Fixed with a targeted check
  (`/reversal/i` in the ledger row's own narration wins over the receipt's remarks).
- **Two chart-account mapping judgment calls, made from the actual posting code rather than the
  reserved-code names alone** (documented inline in `reports.repository.js#paymentTrailRows()`):
  Payment Trail's "Vendors – Suppliers" bucket maps to `VENDORS_ACCOUNTS` (200001 — where
  `vendors.service.js` actually creates a vendor's `ba_id`), not the separately-reserved but
  never-used `VENDORS_SUPPLIERS` (200002); "Employees" maps to `WORKER_WAGES`+`SALARIES_PAYABLE`
  (220001/220002 — where `employees.service.js` actually creates an employee's `ba_id`), not the
  unused `EMPLOYEES` (400005). A generic "create a business account directly under an arbitrary
  chart account" feature (`businessAccounts.ipc.js`) is still an unbuilt TODO stub, so
  `BUSINESS_RUNNING_EXPENSES`/`DIRECTORS_DRAWINGS` buckets will correctly show 0 until that's built
  — not a report bug, a real current-data gap.
- **`reports:payment-trail` restricted-bucket filtering (UC-34):** `BANK_ACCOUNTS`/
  `DIRECTORS_DRAWINGS` are `is_restricted` in `chart_of_accounts` (seeded, TASK-14/§8) but nothing
  in the backend enforced that restriction anywhere before now — `paymentTrail()` hides those two
  buckets entirely for non-ADMIN sessions and excludes them from `grand_total`, the first place
  `is_restricted` is actually read outside the seed script.
- **UC-30 Vendor Stock is the one write inside "Reports":** `reports:vendor-stock` (read, listing
  on-hand material per vendor) stays in the `reports` module per the milestone's own naming, but
  the write side (UC-30 step 2, "this much material has been used") went into `stock.service.js`
  as `stock:reduce-vendor-stock` instead — Reports is otherwise strictly read-only, and this is the
  one documented exception, so it lives with the rest of the stock-writing surface. Rejects a
  reduction that would take on-hand negative (`INSUFFICIENT_STOCK`), verified live.
- **`dbo.vw_overall_directory` (migration 008):** `UNION ALL`s customers/vendors/employees/
  sub_customers/business_accounts. The business_accounts branch excludes rows already owned by a
  customer/vendor/employee (`NOT EXISTS` against each), so only "generic" accounts (banks, expense
  heads) show up under their own name — verified live that the directory's row count matches
  `customers + vendors + employees + sub_customers + (business_accounts not claimed by any of
  those)` with no double-listing. Sub-customers carry no `ba_id` (delivery-address-only party,
  never financially responsible for a bill) so they always search-match by name but their
  drill-down returns `{ has_account: false, message: "..." }` instead of a fabricated balance.
- **Verified live against `wentox_db`:** every one of the 11 report functions run end-to-end
  through the service layer (bypassing IPC, same as prior milestones' smoke tests) — Overall
  Trail's grand total debit/credit balances exactly; the reversal-narration fix confirmed against
  real leftover bounce-test data; vendor-stock reduce accepted a valid reduction and correctly
  rejected an over-reduction; payment-trail correctly hides the 2 restricted buckets for a `USER`
  role and includes them for `ADMIN`; business-ledger summary (all accounts, one balance query
  each via `businessAccountBalancesAsOf()`, not N+1) and detail (one account's full ledger) both
  checked; overall-search directory counts matched expectations with no double-listing.
- **Debugger review:** clean overall — SQL injection, N+1s, date-range boundaries, restricted-
  bucket leakage, and IPC session guards all checked and confirmed sound. One PLAUSIBLE finding:
  `vw_overall_directory` (migration 008) excluded rows already claimed by customers/vendors/
  employees from its generic branch but had no exclusion — or own branch — for `bank_accounts`, so
  a bank account would show up mislabeled as generic `BUSINESS_ACCOUNT` in Overall Search instead
  of `BANK`, inconsistent with `businessAccountsWithCategory()`'s 5-way categorization already used
  by Overall Trail. Unobservable in the live DB at review time (no bank accounts existed yet) but
  would surface as soon as one was created. Fixed via `009_overall_directory_bank_branch.sql`
  (adds the `BANK` branch, sourced through `bank_accounts.ba_id` → `business_accounts.city_id`
  since `bank_accounts` has no `city_id` of its own), re-verified live post-migration.
- **Files:** `reports.repository.js`/`reports.service.js`/`reports.ipc.js` (all heavily
  rewritten), `stock.repository.js`/`stock.service.js`/`stock.ipc.js` (vendor-stock
  read+write added), `materials.repository.js` (added `findById`), migrations
  `008_overall_directory_view.sql` and `009_overall_directory_bank_branch.sql`.
- **Not done:** frontend wiring (both `OverallTrailContent.tsx`/`OverallSearchPage.tsx` and the
  other 8 report tabs already exist on the demo frontend, untouched this pass, still running on
  demo in-memory data per the session's established "don't connect it" pattern).

---

## Milestone 4, Module 4.2 — Expenses / Kharch — Milestone 4 now fully complete

### 2026-08-04 — expenses/draftExpenses built, plus a user-requested "Cheque Return" feature, 5 real bugs found and fixed across 3 debugger rounds
- **What:** The last piece of Milestone 4. `expenses` (CASH/ONLINE/CHEQUE_ISSUED/CHEQUE_ENDORSED),
  `draftExpenses`, and — beyond the original checklist, at explicit user request — a "Cheque
  Return" capability to undo one specific cheque endorsement without touching the rest of the
  cheque or the underlying receipt.
- **The core design decision, reached through back-and-forth with the user before coding:**
  `CHEQUE_ENDORSED` (paying a vendor/expense with a cheque already sitting in Cheques in Hand) is
  the *exact same real-world action* as Module 4.1's Cheques-page endorsement — so rather than
  building a second, parallel ledger-writing mechanism, `expenses.service.js#post()` for this mode
  delegates entirely to `cheques.service.js#endorseToExpense()` (already debugged clean). Only one
  ledger trail per cheque disposal ever exists, regardless of which screen triggered it, and the
  existing bounce/return-to-sender reversal (already built) handles it correctly with zero new
  reversal code. The user specifically corrected a wrong assumption mid-discussion — that endorsing
  a cheque protects it from later bouncing — with the design doc's own flagship example (bounce
  *after* full endorsement, reversing both sides); that correction is what led directly to the
  "reuse the same function" design instead of a bespoke one.
  - CASH/ONLINE/CHEQUE_ISSUED post normally (`Dr ba_id / Cr <cash/bank>`, own `EXPENSE`-sourced
    ledger rows). CHEQUE_ISSUED debits the same bank ONLINE would — deduct-on-write, the day the
    cheque is written, no separate `cheques` row (that table is for cheques *received*).
  - `unpost()` is deliberately BLOCKED for `CHEQUE_ENDORSED` (`USE_CHEQUE_REVERSAL`) — undoing a
    cheque disposition only ever happens through the cheque's own reversal mechanisms.
- **User-requested addition — "Cheque Return":** undo ONE `VENDOR_PAYMENT`/`EXPENSE_PAYMENT`
  allocation (e.g. a vendor hands the cheque back) without touching the cheque's other allocations
  or the receipt — narrower than `bounce()`/`returnToSender()` (which reverse *every* active
  allocation on a receipt). New `cheques.service.js#reverseAllocation()` — rejects a `DEPOSIT`
  (excluded on purpose, a different action), an already-`REVERSED` allocation, or a terminal
  cheque; writes one reversing ledger pair; recomputes cheque status back toward `PENDING`/
  `PARTIALLY_ENDORSED` (the mirror image of the existing forward-direction `recomputeStatus()`).
  New `listEndorsedAllocations()` + `cheques:endorsed-allocations`/`cheques:reverse-allocation` IPC
  channels.
- **Four real bugs found and fixed this pass:**
  1. `expenses.payment_mode`/`draft_expenses.payment_mode` were `VARCHAR(10)` — too narrow for
     `CHEQUE_ENDORSED` (15 chars) / `CHEQUE_ISSUED` (13 chars), sized for the old single-word modes.
     Widened via migration `005_expenses_payment_mode_width.sql` to `VARCHAR(20)` — but the FIRST
     fix attempt only widened the DB column and missed that `expenses.repository.js`/
     `draftExpenses.repository.js` ALSO declare the mssql parameter type width explicitly
     (`sql.VarChar(10)`), which Tedious enforces independent of the actual column width. Caught by
     a raw TDS protocol error on the very first CHEQUE_ISSUED test; had to fix both the column AND
     every `sql.VarChar(10)` parameter declaration referencing it.
  2. `draft_expenses` had drifted out of parity with `expenses` (documented as a "field-for-field
     mirror," but still only allowed the pre-split `'CHEQUE'` value and had no
     `issued_cheque_no`/`issued_cheque_date` columns at all). Fixed via migration
     `004_draft_expenses_parity.sql` — added the two columns, updated the mode CHECK to the 4-value
     set, added a `CK_draft_expenses_payment` mirroring `CK_expenses_payment`'s exact per-mode
     shape rules. Also synced the parallel, even-more-stale copy of this table (and `expenses`
     itself) in `database_schema_v4.3.md`, which still showed the pre-`cash_and_bank.md`-redesign
     shape entirely (plain `'CHEQUE'`, no split, no issued-cheque columns) — a pre-existing
     documentation drift from before this session, not something introduced now.
  3. **HIGH** — `post()` on a `CHEQUE_ENDORSED` expense called `endorseToExpense()` (its own
     committing transaction — real money movement) then flipped the expense's own `status` in a
     SEPARATE transaction. A failure in that second step after the first had committed would leave
     the expense stuck `DRAFT` with the cheque already genuinely disposed of; retrying `post()`
     would call `endorseToExpense()` a second time, silently double-allocating the cheque, and
     `draftExpenses.confirm()`'s compensating-delete safety net would then delete the expense row
     outright, orphaning the real allocation. Fixed via migration
     `006_cheque_allocations_expense_link_and_receipt_unique.sql`, adding a nullable
     `cheque_allocations.expense_id` back-reference — `post()` now checks
     `findAllocationByExpenseId()` before calling `endorseToExpense()` again, making it safely
     idempotent on retry; `draftExpenses.confirm()`'s catch block does the same check before
     deciding whether the compensating delete is safe. Found by the debugger (not by the extensive
     happy-path manual testing, which structurally can't hit a failure in that exact window) —
     re-verified live by explicitly simulating the failure: calling `endorseToExpense()` directly
     without the status flip (as if the process crashed there), then confirming a real
     `post()` retry detected the existing allocation, created no duplicate, and completed correctly
     — total allocated amount confirmed unchanged, not doubled.
  4. LOW — `dbo.cheques.receipt_id` had no DB-level uniqueness, only an app-level invariant (a
     cheque row is only ever inserted once, in the same transaction as its receipt). Added
     `UNIQUE INDEX UQ_cheques_receipt` in the same migration as fix 3, as defense in depth.
  5. Also caught and fixed, unrelated to the above: neither `receipts.service.js#list()` nor
     `expenses.service.js#list()` actually had the "Weekly/Monthly/Overall" `resolveDateRange()`
     convenience despite an earlier progress-log entry claiming receipts already did — both were
     thin `repository.list(filters)` pass-throughs with no shorthand resolution. Added to both,
     matching the `saleBills.service.js`/`purchases.service.js` convention exactly.
- **Frontend:** built `frontend/src/pages/ChequeReturnPage.tsx` — the "Endorsed Cheques" list +
  return-confirmation dialog UI, styled consistently with the existing (pre-existing, already
  demo-wired) `ChequesTab.tsx`. Per explicit instruction, **NOT connected** — "Confirm Return" does
  not dispatch against `AppContext`'s demo reducer (no such action exists there) and does not call
  the real backend; it shows a preview-only message and closes. Not added to navigation/routing.
- **Verified live** against `wentox_db`, extensively: CASH/ONLINE-to-vendor/CHEQUE_ISSUED all
  posted with correct ledger pairs (exact `ac_id`/`ba_id`/debit/credit checked); CHEQUE_ENDORSED
  against a freshly-received-and-posted cheque resulted in zero `EXPENSE`-sourced ledger rows and
  exactly the correct `CHEQUE_ALLOCATION`-sourced pair, cheque correctly `PARTIALLY_ENDORSED`;
  unpost blocked (`USE_CHEQUE_REVERSAL`); `reverseAllocation()` correctly freed the cheque back to
  `PENDING`, wrote the correct 2-row reversal, left the linked expense's status untouched
  (`CONFIRMED`, never touched — same philosophy as a bounced receipt); double-reverse rejected; the
  freed cheque was re-endorsed for its full amount (confirming the balance really was restored) and
  successfully bounced afterward; draft CRUD + confirm for all 4 modes; the compensating-delete
  safety net verified with a genuine failure (bad bank account, no allocation ever created —
  correctly deleted). Full regression pass of the whole Module 4.1+4.2 suite re-ran clean after
  every one of the 3 fix rounds. All test data cleaned up after.
- **Debugger review round 2** (verifying round 1's HIGH fix) found a further gap:
  `draftExpenses.confirm()` still minted a brand-new `expenses` row on EVERY call — so `post()`'s
  new per-`expense_id` idempotency check (from round 1's fix) would never find a PRIOR attempt's
  allocation, since a fresh `confirm()` retry always produces a fresh `expense_id`. This is the
  realistic recovery path a real user takes (retrying via the Drafts UI after a failed confirm)
  rather than a direct `expenses:post` retry, so it reopened the same double-disposal risk one
  layer up. **Fix**: added `draft_expenses.pending_expense_id` (migration
  `007_draft_expenses_pending_expense.sql`) — set on the draft right after `create()` succeeds but
  BEFORE `post()` is attempted, so ANY later `confirm()` call on that draft resumes against the
  SAME `expense_id` instead of minting another one. `confirm()`'s catch no longer deletes the
  expense at all for `CHEQUE_ENDORSED` (the old existence-check was superseded — resuming is now
  always possible via `pending_expense_id`, whether or not an allocation was actually created
  yet). Added a matching guard on `remove()`: deleting a draft with an unresolved
  `pending_expense_id` is now blocked (`PENDING_EXPENSE_UNRESOLVED`) — it would otherwise orphan a
  real stuck expense with no way back to it. Re-verified live by directly simulating the exact
  scenario (manually replicating `confirm()`'s first phase getting stuck — real expense created,
  `pending_expense_id` set, real allocation created via `endorseToExpense()`, status-flip
  deliberately skipped — then calling the real `confirm()` again on the same draft): correctly
  skipped `create()`, resumed against the same `expense_id`, completed via the idempotent `post()`,
  exactly 1 expense and 1 allocation existed throughout, draft deleted only on success.
- **Debugger review round 3** (verifying round 2's fix): clean — confirmed every throw point inside
  `post()`'s `CHEQUE_ENDORSED` branch is correctly covered by `pending_expense_id` resuming (not
  just the one specific failure point that was manually tested), confirmed the FK/guard/IPC-layer
  plumbing is all correct, and flagged one accepted residual risk (a narrower race between
  `create()`'s commit and `setPendingExpenseId()`'s commit — strictly less harmful than the
  original bug since nothing gets `post()`ed from that state, matches the same single-admin-
  desktop-app threat model already accepted elsewhere in this codebase for a similar TOCTOU, e.g.
  `milestones/milestone7.md`'s customer-duplicate-name check). One LOW finding: deleting a stuck
  expense directly (via the Expenses screen, not the Drafts UI) would hit the new
  `FK_draft_expenses_pending_expense` constraint with an opaque `INTERNAL` error, since raw SQL
  errors aren't `ApiError`s. **Fixed**: added `draftExpensesRepository.findByPendingExpenseId()`
  and a matching guard on `expenses.service.js#remove()` — throws a clear
  `PENDING_DRAFT_UNRESOLVED` pointing at the specific stuck draft instead. Re-verified live:
  direct-delete of a stuck expense correctly rejected with the clear message; resolving via
  `confirm()` retry still works cleanly afterward. Full regression pass (all three test scripts —
  the main Module 4.1+4.2 suite, the idempotent-`post()` simulation, and the `confirm()`-resume
  simulation) re-ran clean with zero failures. This closes out Module 4.2 — no further debugger
  rounds needed.
- **Not done:** frontend not wired to real data (see above — matches every other module so far).
- **Files:** `src/repositories/expenses.repository.js` (new), `src/services/expenses.service.js`
  (new), `src/ipc/expenses.ipc.js` (filled in from TODO stub); `src/repositories/
  draftExpenses.repository.js` (new), `src/services/draftExpenses.service.js` (new),
  `src/ipc/draftExpenses.ipc.js` (new); `src/repositories/cheques.repository.js`/
  `src/services/cheques.service.js`/`src/ipc/cheques.ipc.js` (extended — `findAllocationById`,
  `listEndorsedAllocations`, `reverseOneAllocation`/`reverseAllocation`,
  `findAllocationByExpenseId`, `insertAllocation`'s new `expense_id` param); `src/services/
  receipts.service.js` (added the missing `resolveDateRange()`); `src/ipc/index.js` (registered
  `draftExpenses`); `electron/preload.js` (FEATURES); `src/db/migrations/
  004_draft_expenses_parity.sql`, `005_expenses_payment_mode_width.sql`,
  `006_cheque_allocations_expense_link_and_receipt_unique.sql`,
  `007_draft_expenses_pending_expense.sql` (all new, all applied); `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md` (all four migrations' end-states folded in, plus
  the pre-existing `expenses`/`draft_expenses` doc drift fixed);
  `frontend/src/pages/ChequeReturnPage.tsx` (new, unconnected); `backend/milestones/milestone4.md`
  (checkboxes — Module 4.2 now fully checked off, Milestone 4 complete).

## Milestone 4, Module 4.1 — Receipts / Jamma & Cheque Disposal

### 2026-08-04 — receipts/cheques/draftReceipts built, extensively live-verified; two real schema bugs found and fixed
- **What:** The largest, most interlocking module built this session: `receipts` (CASH/ONLINE/CHEQUE,
  commission tracking), `cheques` (the received-cheque disposal lifecycle: deposit/endorse-to-
  vendor/endorse-to-expense/mark-cleared/bounce), and `draftReceipts`. Plus a user-requested
  addition beyond the original checklist: a "returned to sender" cheque disposition, distinct from
  a bank bounce.
- **How — Receipts:**
  - Always created `DRAFT` explicitly (same discipline as transfers/wage_runs/salary_runs — never
    relies on the column's own `DEFAULT('CONFIRMED')`).
  - `resolveDebitSide(payment_mode, bank_id)` centralizes which account a receipt debits: CASH →
    `CASH_IN_HAND` chart account (`ac_id`), ONLINE → the **specific bank's own linked
    `business_accounts.ba_id`** (not the generic `BANK_ACCOUNTS` chart code — Module 4.3 built
    earlier this session specifically gives each bank its own account for this reason), CHEQUE →
    `CHEQUES_IN_HAND` chart account. This same function is reused by the bounce/return reversal
    logic, so a reversal always lands back on the exact account the original posting used.
  - Commission > 0 writes a wholly separate `Dr COMMISSION_ALLOWED / Cr customer BA` ledger pair —
    the underlying sale bill is never retroactively touched (`database_schema_v4.3.md` §7).
  - A CHEQUE-mode receipt auto-creates its linked `cheques` row (status `PENDING`) in the SAME
    transaction as the receipt insert — the schema's own circular-FK note (`cheques.receipt_id` /
    `receipts.cheque_id` reference each other) describes a 3-step dance: insert receipt with
    `cheque_id` NULL, insert the cheque, link back. `update()`/`remove()` on a DRAFT receipt that
    switches out of CHEQUE mode (or is deleted outright) correctly unlinks before deleting the
    orphaned cheque row, in that order (breaking the FK the same way it was built).
- **How — Cheques:**
  - Once the underlying receipt is `CONFIRMED`, a cheque can be disposed of three ways, split across
    multiple partial actions: **DEPOSIT** (no ledger entry at all — the customer was already
    credited at receipt-post time; depositing only relocates the money to a specific bank for
    balance-tracking, per `cash_and_bank.md` §10's derived-balance formula; enforced that one cheque
    is never deposited into two different banks), **VENDOR_PAYMENT**/**EXPENSE_PAYMENT** (both DO
    write `Dr target BA / Cr CHEQUES_IN_HAND` — handing a cheque to someone else actually moves
    money out, unlike a deposit into your own bank). `recomputeStatus()` derives
    `DEPOSITED`/`ENDORSED`/`PARTIALLY_ENDORSED` from the remaining un-allocated balance after each
    action, computed via a transaction-aware sum (see bug #1 below). `markCleared()` is a
    `DEPOSITED`-only pure status flip, no ledger effect.
  - **User-requested addition**: `RETURNED` — a new cheque status distinct from `BOUNCED`, same
    reverse-never-delete mechanics, own `returned_date`/`return_reason` columns, for a reason that
    isn't a bank bounce (e.g. a due-date issue). Added via migration `002_cheques_returned_status.sql`.
  - `reverseCheque()` — one shared function for both BOUNCE and RETURN: reverses every `ACTIVE`
    `cheque_allocations` row for the receipt (flips to `REVERSED`, writes an opposite ledger pair),
    then reverses the receipt's own ledger effect (only if it was `CONFIRMED`) using the same
    `resolveDebitSide()` logic posting used — all dated the bounce/return date, all new rows,
    nothing deleted (`database_schema_v4.3.md` §6.1).
- **Two real bugs found and fixed mid-session, both caught by live testing, not just review:**
  1. **`recomputeStatus()` read stale data.** It calls `sumActiveAllocations()` right after inserting
     a new allocation in the same transaction — but the original `sumActiveAllocations()` used the
     plain connection pool (a different DB connection than the transaction), which cannot see an
     uncommitted insert from another connection. Added a transaction-aware
     `sumActiveAllocationsInTransaction()` variant and switched `recomputeStatus()` to use it. Caught
     by re-deriving the logic during implementation, before the first live test run.
  2. **Reversing a DEPOSIT allocation crashed.** `reverseCheque()` originally tried to write a
     reversal ledger pair for EVERY reversed allocation — but `DEPOSIT` allocations never had a
     ledger entry to begin with (that's the whole point of the deposit-has-no-ledger-effect design),
     so the attempted reversal row had neither `ac_id` nor `ba_id` set, violating
     `CK_ledger_entries_one`. This one WAS only caught by the first live test run (bouncing a cheque
     that had both a partial deposit and a vendor endorsement on it) — fixed by skipping `DEPOSIT`
     allocations in the reversal loop (their status still flips to `REVERSED` via
     `reverseAllocations()`, just no ledger write), re-verified live.
  3. **Found and fixed a genuine schema bug, not just an app bug**: `CK_receipts_cheque` as
     originally written (`payment_mode='CHEQUE' AND cheque_id IS NOT NULL`) is literally impossible
     to satisfy given the schema's own documented two-step insert plan — SQL Server checks `CHECK`
     constraints per-statement, not deferred to commit, so step 1 (`insert receipts with cheque_id
     NULL`) would always violate it immediately. This surfaced as a real `CK_receipts_cheque`
     violation on the very first CHEQUE-receipt test. Relaxed via migration
     `003_receipts_cheque_check_relax.sql` to `(payment_mode <> 'CHEQUE' AND cheque_id IS NULL) OR
     (payment_mode = 'CHEQUE')` — still catches a non-cheque receipt ever carrying a `cheque_id`
     (the bug class actually worth a DB-level guard), while allowing the transient NULL the insert
     plan requires. The "every CHEQUE receipt eventually gets a real `cheque_id`" guarantee now
     lives at the application layer (`receipts.service.js#create()` always does both inserts in one
     `withTransaction`). Both `database_schema_v4.3.md` and `database/schema.sql` updated to match.
- **How — draftReceipts:** CASH/ONLINE only — `dbo.draft_receipts` carries a `cheque_id` FK for
  shape-symmetry with `dbo.receipts` but has no `cheque_no`/`cheque_date` columns of its own, so a
  genuinely useful draft CHEQUE receipt isn't representable; rejected with a message pointing at
  `receipts:create` instead. `confirm()` = create the real receipt + post it, as two sequential
  transactions (not one shared transaction like `draftPurchases.confirm()`) — acceptable since a
  receipt has no line items to keep atomic alongside posting, unlike a purchase.
- **Verified live** against `wentox_db`, extensively (two full runs, the first caught bug #3 above):
  CASH receipt posted with correct ledger pair; ONLINE + commission posted with correct 4 rows
  (exact `ac_id`/`ba_id`/debit/credit checked on each); CHEQUE receipt created `PENDING`;
  deposit-before-posting rejected (`RECEIPT_NOT_POSTED`); partial deposit (12000/20000) →
  `PARTIALLY_ENDORSED`, zero new ledger rows; cross-bank deposit rejected; remaining balance
  endorsed to a vendor → `ENDORSED`, exactly 2 correct ledger rows; separate cheque fully deposited
  → `DEPOSITED` → `markCleared()` → `CLEARED`; double-clear rejected (`NOT_DEPOSITED`); bouncing the
  partially-deposited-then-fully-endorsed cheque correctly reversed BOTH allocations to `REVERSED`,
  wrote exactly ONE reversal ledger pair (vendor endorsement only, confirming bug #2's fix), and
  reversed the receipt's original 2 rows with 2 new rows dated the bounce date, landing on the exact
  same accounts, debit/credit swapped, originals completely unchanged; double-bounce rejected
  (`CHEQUE_TERMINAL`); unposting a receipt with an already-disposed cheque rejected
  (`CHEQUE_IN_USE`); return-to-sender on a fresh cheque correctly stored a reason and reversed
  correctly; draft receipt CRUD, CHEQUE-mode draft rejection, `confirm()`, and
  update-while-DRAFT/blocked-while-CONFIRMED all verified. All test data cleaned up after.
- **Debugger review:** found 2 issues (thorough pass given this module's size). **Moderate**:
  `draftReceipts.confirm()` ran `create()`+`post()` as two separate transactions — a failure in
  `post()` after `create()` had committed left an orphaned DRAFT receipt AND the draft itself
  intact, so retrying `confirm()` would call `create()` again and produce a duplicate real receipt.
  Fixed by refactoring `receipts.service.js` into transaction-scoped building blocks
  (`insertReceipt()`, `postWithinTransaction()`) that both `create()`/`post()` and
  `draftReceipts.confirm()` now share, so confirm is genuinely one atomic transaction. Re-verified
  live with a forced mid-transaction failure (a customer with `ba_id` temporarily nulled): 0
  orphaned receipts, draft still present and safely retryable, exactly 1 receipt (not 2) after
  fixing the cause and retrying. **Minor**: `cheques.service.js#reverseCheque()`'s commission-
  reversal branch was missing the same `if (!commissionAccount) throw ...` guard every other
  reserved-account lookup in this module has — added for consistency (low real-world risk, seeding
  guarantees the row exists, but would've thrown an opaque error instead of the clear diagnostic
  used everywhere else).
- **Not done:** no frontend page for Receipts/Cheques exists yet.
- **Files:** `src/repositories/receipts.repository.js` (new), `src/services/receipts.service.js`
  (new), `src/ipc/receipts.ipc.js` (filled in from TODO stub); `src/repositories/cheques.repository.js`
  (new), `src/services/cheques.service.js` (new), `src/ipc/cheques.ipc.js` (new);
  `src/repositories/draftReceipts.repository.js` (new), `src/services/draftReceipts.service.js`
  (new), `src/ipc/draftReceipts.ipc.js` (new); `src/ipc/index.js` (registered both new features);
  `electron/preload.js` (FEATURES); `src/db/migrations/002_cheques_returned_status.sql`,
  `src/db/migrations/003_receipts_cheque_check_relax.sql` (both new, applied); `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md` (both migrations' end-states folded in);
  `backend/milestones/milestone4.md` (checkboxes).

## Milestone 5, Modules 5.1 & 5.3 — Current Stock/Production, Search & Bilty/Adda Updation

### 2026-08-04 — stock/reports/bilty-search built, live-verified; Module 5.2 (Reports) deliberately skipped
- **What:** Two of Milestone 5's three modules, per explicit instruction to skip 5.2 (Reports) for
  later. No schema changes — `dbo.stock_movements`/`dbo.article_colors` already existed; Module
  5.3 extends the existing `saleBills` module rather than creating a new one.
- **How:**
  - **5.1 (`stock`, `reports:stock`/`reports:production`):** stock is tracked per VARIANT
    (article+color), not per article — `stock:log-production` resolves/auto-creates the variant via
    `productColorsService.resolveOrCreate()` (UC-28, pre-existing helper from an earlier
    milestone), then normalizes an operator-typed CARTONS or PAIRS quantity into `qty_pairs` using
    the variant's effective packing (`COALESCE(article_colors.packing, articles.packing)`),
    snapshotting that packing onto the row regardless of which unit was typed. `stock:adjust`
    handles OPENING/ADJUSTMENT (signed qty, no packing/input_qty/input_unit — those are
    PRODUCTION-only columns per the schema's own comments); a zero `qty_pairs` is rejected as a
    friendly 400 even though the DB itself doesn't forbid it. `reports:stock` (Current Stock tab)
    is a thin pass-through to `stock.service.js#currentStock()` rather than a separate
    implementation — kept as its own channel per the milestone's naming. `reports:production`
    filters to PRODUCTION-only movements with the same daily/weekly/monthly/overall date-range
    convention as `saleBills.service.js`/`purchases.service.js`.
  - **5.3 (`sale-bills:bilty-search`/`sale-bills:update-bilty`):** `updateBiltyInfo()` touches only
    `bilty_no`/`adda_id` — never `ledger_entries`/`stock_movements`/any other header field — so
    unlike the full `update()` (which reverses+reapplies ledger/stock when editing an
    already-posted bill) it doesn't check or care about posted status at all, matching "allowed on
    POSTED bills; non-financial." `biltySearch()` reuses the same filter shape as the pre-existing
    `list()` but joins in customer/sub-customer/adda display names for the search screen.
- **Verified live** against `wentox_db`: production logged in CARTONS against a brand-new color
  auto-created the variant and normalized correctly (5×12=60 pairs); a second production log in
  PAIRS against the same color resolved to the SAME variant, not a duplicate; an ADJUSTMENT of -3
  recorded; movement history returned all 3 rows; current stock correctly showed 65 total pairs →
  5 cartons + 5 extra pairs; production report with a date range correctly excluded the ADJUSTMENT;
  invalid `input_unit` and zero-`qty_pairs` adjustment both rejected. Bilty: search by customer_id
  and by bill_no both returned correct joined rows; `update-bilty` changed `bilty_no`/`adda_id`
  while `is_posted` was confirmed unchanged before/after; missing `bilty_no` rejected; original
  value restored after the test. All test rows cleaned up after.
- **Debugger review:** clean, no bugs found (packing fallback, sign-constraint safety, `GROUP BY`
  correctness, cross-service conventions, `updateBiltyInfo()` genuinely ledger/stock-free — all
  confirmed). Noted one pre-existing quirk, not a regression: `resolveDateRange()`'s `'daily'`
  range value isn't explicitly handled anywhere in the codebase (falls through to no date filter)
  — true of the original `saleBills.service.js` version this was copied from too.
- **Not done:** Module 5.2 (Reports — 9 more
  `reports:*` channels: product-ledger, vendor-stock, sale-analysis, sale-report, vendor-report,
  payment-trail, account-ledger, business-ledger, cash-book) deliberately not started, per explicit
  instruction to leave it for later. No frontend page for Current Stock/Production or Search &
  Bilty Updation exists yet.
- **Files:** `src/repositories/stock.repository.js`, `src/services/stock.service.js`,
  `src/ipc/stock.ipc.js` (all replaced empty/TODO stubs); `src/repositories/reports.repository.js`,
  `src/services/reports.service.js`, `src/ipc/reports.ipc.js` (same — only `stock`/`production`
  built, the rest of Module 5.2 left as empty exports); `src/repositories/saleBills.repository.js`,
  `src/services/saleBills.service.js`, `src/ipc/saleBills.ipc.js` (extended, not rewritten — new
  `biltySearch`/`updateBiltyInfo` functions and two new IPC handlers appended);
  `backend/milestones/milestone5.md` (checkboxes).

## Milestone 4, Module 4.7 — Salary Run

### 2026-08-04 — salaryRuns CRUD + post/unpost built, live-verified, debugged clean
- **What:** One run per calendar month, covering every ACTIVE salaried employee automatically —
  unlike Wage Run, the caller never enumerates lines, only supplies optional per-employee
  `overrides`. No schema changes — `dbo.salary_runs`/`dbo.salary_run_items` already existed.
- **How:**
  - `buildLines()` is server-authoritative: queries `employeesRepository.list({employee_type:
    'SALARIED'})` fresh every time (create AND update), builds one line per active employee.
    `salary_amount` is always a fresh snapshot of `employees.monthly_salary`, never trusted from
    any override; `amount` defaults to `salary_amount` unless an override for that `employee_id`
    supplies one — matching payroll.md §11's two-column design (snapshot vs. what was credited)
    exactly. Unlike `wage_run_items.amount`, `salary_run_items.amount`/`salary_amount` are plain
    columns, not DB-computed — nothing to derive, both written explicitly.
  - `normalizeMonth()` truncates whatever date the caller sends down to that month's 1st
    (UTC-safe), matching `CK_salary_runs_month`, so the caller never has to get the day right.
  - One CONFIRMED run per month enforced twice: `assertMonthNotConfirmed()` at both `create()` time
    and again at `post()` time (a DRAFT built before a sibling DRAFT for the same month got
    confirmed first would otherwise slip through the create()-time check alone), backstopped by the
    DB's own filtered `UQ_salary_runs_month` (CONFIRMED-only — DRAFTs for the same month are
    unconstrained by design, "a correction can be built alongside").
  - Post writes 1 debit (SALARIES EXPENSE, `410002`, the run's total) + N credit rows, one per
    line, against each employee's own `ba_id` for their own (possibly overridden) `amount` — not a
    single Dr/Cr pair like Wage Run or Transfer.
  - Lifecycle otherwise mirrors Wage Run exactly: always created DRAFT explicitly; update()/
    remove() blocked while CONFIRMED; update() rebuilds the roster fresh (delete-then-reinsert,
    never patched); unpost is audited the same way (`unposted_at`/`unposted_by`/`amount_before`,
    cleared back to `NULL` on every re-post).
  - Mid-session fix: initially had no guard against creating a run when zero active salaried
    employees exist — caught while re-checking the milestone's own verify checklist line ("create a
    run for a month with no active salaried employees → empty/rejected appropriately"), which
    hadn't actually been tested yet. Added a clean `ApiError.badRequest` in both `create()` and
    `update()`, re-verified live before the debugger pass.
  - Registered `ipc/salaryRuns.ipc.js` in `src/ipc/index.js`; added `'salaryRuns'` to
    `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db` (two throwaway SALARIED employees, salaries 50000/40000,
  any other pre-existing active salaried employees temporarily deactivated so the test roster was
  exact): create with no overrides → both included, total=90000; second DRAFT for same month
  allowed; update with a deduction override (emp2 → amount=35000, remarks) → total=85000,
  `salary_amount` stayed 40000 on that line; post → ledger confirmed as exactly 1 debit
  (85000) + 2 credits (35000, 50000) against the right `ba_id`s; second run for the now-confirmed
  month rejected (`MONTH_ALREADY_CONFIRMED` with the existing run's id); double-post blocked;
  update-while-posted blocked; unpost → `amount_before`=85000, ledger rows removed, month usable
  again afterward; remove-while-draft succeeded; empty-roster create correctly rejected. All test
  rows cleaned up after. Debugger review: clean, no bugs found — also independently confirmed the
  `update()`-skips-month-recheck design is safe, since `post()` always re-checks regardless.
- **Not done:** no frontend page for Salary Run exists yet.
- **Files:** `src/repositories/salaryRuns.repository.js` (new), `src/services/salaryRuns.service.js`
  (new), `src/ipc/salaryRuns.ipc.js` (new), `src/ipc/index.js` (registered), `electron/preload.js`
  (FEATURES), `backend/milestones/milestone4.md` (checkboxes).

**Milestone 4 status:** Modules 4.3–4.7 are now all code-complete and debugged clean across this
session. Modules 4.1 (Receipts) and 4.2 (Expenses) remain unbuilt (empty stub files) — Milestone 4
is not finished until those are done too, even though the harder/newer payroll and cash-and-bank
scope (4.3-4.7) is now ahead of the originally-planned 4.1/4.2.

## Milestone 4, Module 4.6 — Wage Run

### 2026-08-04 — wageRuns CRUD + post/unpost built, live-verified with real arithmetic
- **What:** One settlement = one worker + one stage + many article lines, reading `dbo.articles`'
  12 stage-cost columns (write-only until now) and writing `ledger_entries` only — no stock
  movement. No schema changes — `dbo.wage_runs`/`dbo.wage_run_items` already existed and were
  already applied.
- **How:**
  - `validateEmployeeStage()` fetches the worker via `employeesService.getById()` and checks the
    requested `stage_key` is actually one of that worker's trades before anything else runs — this
    is the real enforcement of "the stage list on create must filter to the chosen worker's trades
    only" (the frontend filters visually, this is where it's actually guaranteed); the composite FK
    `(employee_id, employee_type)` pinned to `'WORKER'` backstops it at the DB level regardless.
  - `resolveLines()` snapshots `rate`/`packing` from the article's CURRENT figures at the moment a
    line is (re-)added, using `src/constants/stages.js`'s stage_key→cost_column map (built in
    Module 4.5) to know which of the 12 columns to read. `rate` can be overridden by a
    caller-supplied value (operator can type over the auto-filled rate, per payroll.md §7);
    `packing` never can — always `article.packing`, ignoring anything the caller supplies for it.
  - `buildTotal()` computes `total_amount` in JS using the exact same formula
    (`rate * cartons * packing`) as `wage_run_items.amount`'s DB-side `PERSISTED` computed column,
    confirmed matching exactly in the live test (1200 for 5×20×12, 2400 for 10×20×12) — no drift.
  - Lifecycle mirrors transfers/purchases: always created `DRAFT` explicitly; `update()`/`remove()`
    blocked while `CONFIRMED` (unpost first); `update()` always deletes-then-reinserts items rather
    than patching, matching payroll.md §8's "an edit is a fresh statement of what happened."
  - Post: `Dr WAGES EXPENSE (410001) / Cr worker.ba_id`, `source_type='WAGE_RUN'`.
  - Unpost is audited (payroll.md §8): `unposted_at`/`unposted_by`/`amount_before` are set on every
    unpost. Note: `CK_wage_runs_unpost` at the DB level only actually requires `unposted_at IS NOT
    NULL` when any of the three are set — not true all-or-nothing, despite the milestone checklist's
    original "enforces all-or-nothing" phrasing (checked schema.sql directly to confirm). The
    service sets all three together regardless, which is the intended behavior either way.
    `markPosted()` clears all three back to `NULL` on every post, so a stale audit trail from an
    earlier unpost cycle never lingers on a run that's since been reposted.
  - No duplicate-settlement guard, by design (payroll.md §5) — `recentRuns()`/`wage-runs:recent`
    returns that worker's last 3 runs for the selected stage (any status) instead.
  - Registered `ipc/wageRuns.ipc.js` in `src/ipc/index.js`; added `'wageRuns'` to
    `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db` (throwaway WORKER with a 'cutting' trade, throwaway article
  with cutting rate=20/packing=12): stage-not-in-worker's-trades rejected; create with 5 cartons →
  `total_amount=1200`, correct rate/cartons/packing snapshot on the item; `recentRuns` returned 1
  row; post → `CONFIRMED` with correct Dr(ac_id)/Cr(ba_id) ledger pair; double-post blocked
  (`ALREADY_POSTED`); update-while-posted blocked (`POSTED_LOCK`); unpost → `DRAFT`,
  `unposted_by`/`amount_before`/`unposted_at` all correctly set, ledger rows removed; edit-while-
  draft re-snapshotted with 10 cartons → `total_amount=2400`; remove-while-draft succeeded. All
  test rows cleaned up after.
- **Not done:** debugger review still running as of this entry. No frontend page for Wage Run
  exists yet. The full `getEmployeeBalance()` helper from payroll.md §6 (BAQAYA/BANAM/NET BALANCE)
  was deliberately NOT built here — it needs Expenses (payments) data, which doesn't exist yet;
  revisit when Expenses is built or this becomes a reports concern.
- **Files:** `src/repositories/wageRuns.repository.js` (new), `src/services/wageRuns.service.js`
  (new), `src/ipc/wageRuns.ipc.js` (new), `src/ipc/index.js` (registered), `electron/preload.js`
  (FEATURES), `backend/milestones/milestone4.md` (checkboxes).

## Milestone 4, Module 4.5 — Employees, Stages & Worker Trades

### 2026-08-04 — employees/stages CRUD built, live-verified against payroll.md's exact checklist
- **What:** `employees` (WORKER/SALARIED, one table per payroll.md §2) and `stages` (read-only, the
  12 manufacturing stages). No schema changes — `dbo.employees`/`dbo.stages`/`dbo.worker_stages`
  already existed and were already applied.
- **How:**
  - New `src/constants/stages.js` — single source of truth for the 12 stages' seed data (stage_key/
    form_label/worker_label/cost_column, sort_order = array index+1), seeded into `dbo.stages` by
    `src/db/seeds/run.js`. Frontend's `COST_FIELDS` (`types/index.ts`) is the only other copy —
    different runtime, left alone, not a third duplicate of the same data.
  - 4 new reserved chart-account codes added to `reservedAccounts.js` and seeded: `WORKER_WAGES`
    (`220001`), `SALARIES_PAYABLE` (`220002`) — both LIABILITY, since baqaya/net-balance is a debt,
    not an expense, per payroll.md §3 — and `WAGES_EXPENSE` (`410001`)/`SALARIES_EXPENSE`
    (`410002`), both EXPENSES, for Module 4.6/4.7's posting later.
  - `employees.service.js:validate(payload, employeeType)` takes the type as an explicit param
    rather than reading `payload.employee_type` internally — this is what lets `update()` validate
    against the row's real, existing type instead of trusting whatever the payload claims.
  - `employee_type` immutability (payroll.md §7): `update()` rejects outright
    (`payload.employee_type !== existing.employee_type` → `TYPE_IMMUTABLE`, 400) before anything
    else runs; every type-dependent field afterward (`monthly_salary`, whether trades apply) is
    derived from `existing.employee_type`, never the payload — so omitting `employee_type` from an
    update call can't accidentally slip a type change through a gap in the explicit check.
  - `create()` auto-links a `business_accounts` row under the correct head via
    `createUnderChartCode` (same transaction-safety pattern as vendors/customers/bankAccounts); a
    WORKER's trades are written via `replaceTrades()` (delete-all-then-reinsert) inside the same
    transaction.
  - Mid-session fix: `employees.repository.js:update()` was originally a plain non-transactional
    `query()` call (copy-pasted from the vendors reference pattern before this module's specific
    need became clear) — changed to accept a `transaction` param so it commits/rolls back together
    with `replaceTrades()` in `update()`'s single `withTransaction` block, catching a would-be gap
    before it was ever run live.
  - Duplicate-name handling: same reactivate-instead-of-reject pattern as vendors (name+phone key),
    built in from day one.
  - Registered `ipc/employees.ipc.js`/`ipc/stages.ipc.js` in `src/ipc/index.js`; added
    `'employees'`/`'stages'` to `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db`, matching payroll.md's/milestone4.md's exact verify
  checklist: 0-trade worker rejected; invalid `stage_key` rejected; worker with 1 trade created →
  linked BA confirmed under chart code `220001`; salaried employee with no salary rejected →
  linked BA confirmed under `220002`; `employee_type` change on update rejected; worker's trade set
  successfully replaced (remove one, add another) via `update()`; active-duplicate rejected;
  soft-delete → inactive-duplicate correctly flagged with reactivate `details`; `reactivate()`
  restores `is_active`. All test rows cleaned up after.
- **Debugger review:** clean, no critical/high-severity bugs (monthly_salary correctness,
  replaceTrades() WORKER-only gating, TYPE_IMMUTABLE bypass check, transaction safety, IPC/preload
  wiring, stages read-only-ness, SQL injection — all confirmed correct). One low-severity gap
  found and fixed same-pass: `validate()` didn't dedupe `payload.stages`, so a duplicate
  `stage_key` (e.g. `['cutting','cutting']`) would hit `PK_worker_stages` and surface a raw SQL
  error instead of a clean 400 — added a `Set` size check, re-verified live.
- **Not done:** no frontend page for Employees exists yet (same gap as everywhere else). Module
  4.6/4.7 (Wage Run/Salary Run posting, which is what actually reads the trades/salary this module
  writes) not started.
- **Files:** `src/constants/stages.js` (new), `src/constants/reservedAccounts.js` (4 new codes),
  `src/db/seeds/run.js` (seed logic), `src/repositories/employees.repository.js` (new),
  `src/services/employees.service.js` (new), `src/ipc/employees.ipc.js` (new),
  `src/repositories/stages.repository.js` (new), `src/services/stages.service.js` (new),
  `src/ipc/stages.ipc.js` (new), `src/ipc/index.js` (registered both), `electron/preload.js`
  (FEATURES), `backend/milestones/milestone4.md` (checkboxes).

## Milestone 4, Module 4.4 — Transfer

### 2026-08-04 — transfers CRUD + post/unpost built, live-verified
- **What:** `transfers` — moves money between two of WentoX's own `business_accounts` rows (cash↔
  bank, bank↔bank). No schema changes needed — `dbo.transfers` and `TRANSFER` in
  `CK_ledger_entries_src` already existed in `database/schema.sql`.
- **How:**
  - `dbo.transfers` has a real stored `status` column (`DRAFT`/`CONFIRMED`), unlike sale_bills/
    purchases which derive "posted" from `ledger_entries` existence — so this module's `isPosted`
    equivalent is just reading `status` directly, not a derived query. `create()` explicitly inserts
    `'DRAFT'` regardless of the column's `DEFAULT ('CONFIRMED')` — only `post()` moves it to
    `CONFIRMED` and writes the ledger pair; `unpost()` deletes the ledger pair and reverts to
    `DRAFT`. Same create-as-DRAFT-then-post shape as `purchases.service.js`.
  - Post writes exactly one ledger pair per transfer: `Dr to_ba_id` / `Cr from_ba_id`,
    `source_type='TRANSFER'` (`cash_and_bank.md` §7) — verified live the debit lands on the
    destination and credit on the source, not swapped.
  - `from_ba_id === to_ba_id` validated in the service (`ApiError.badRequest`, clean 400) ahead of
    the DB's own `CK_transfers_distinct`, which still backstops it.
  - `update()`/`remove()` blocked while `status === 'CONFIRMED'` (unpost first) — same rule as
    `purchases.service.js:update()`. `remove()` is a hard `DELETE`, not soft-delete — `transfers` is
    a transaction table, and schema.sql's own top-of-file convention note says soft-delete
    (`is_active`) is for lookup/setup tables only, transactions "live in DRAFT or get edited."
    (`dbo.transfers` has no `is_active` column at all, confirming this.)
  - Added `businessAccountsService.getById()` (didn't exist — only `createUnderChartCode`/
    `renameLinked` were exported) so `transfers.service.js` validates `from_ba_id`/`to_ba_id`
    actually exist (404s otherwise) through the proper service layer instead of reaching into
    `businessAccounts.repository.js` directly from another feature.
  - Registered `ipc/transfers.ipc.js` in `src/ipc/index.js`; added `'transfers'` to
    `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db`: create → DRAFT; same-account rejected; post → `CONFIRMED`
  with correct Dr/Cr ledger pair; double-post blocked (`ALREADY_POSTED`); update-while-posted
  blocked (`POSTED_LOCK`); unpost → ledger rows gone, back to `DRAFT`; remove works while `DRAFT`.
  Two throwaway bank accounts (via `bankAccounts.service.js`) stood in for the two sides; all test
  rows cleaned up after. Debugger review: clean, no bugs found.
- **Not done:** report-level exclusion of `TRANSFER` from Cash Book/income/expense totals
  (`cash_and_bank.md` §11 item 13) — no reports exist at all yet (Milestone 5). No frontend screen.
- **Files:** `src/repositories/transfers.repository.js` (new), `src/services/transfers.service.js`
  (new), `src/ipc/transfers.ipc.js` (new), `src/ipc/index.js` (registered), `electron/preload.js`
  (FEATURES), `src/services/businessAccounts.service.js` (added `getById`),
  `backend/milestones/milestone4.md` (checkboxes).

## Milestone 4, Module 4.3 — Bank Accounts

### 2026-08-04 — bankAccounts CRUD built (repository/service/ipc), reactivate pattern from day one
- **What:** First code for Module 4.3. `bankAccounts` party pattern, same shape as vendors/customers
  — own `bank_id` PK plus a linked `business_accounts` row under the reserved BANK ACCOUNTS chart
  account, both writes in one transaction.
- **How:**
  - Schema: added `account_no`/`branch` columns to `dbo.bank_accounts` (the table only had `name`
    before this — milestone spec calls for name/account_no/branch/opening_balance/opening_date, but
    opening_balance/opening_date deliberately live on the linked `business_accounts` row instead,
    per `cash_and_bank.md` §3's explicit reasoning, not on `bank_accounts` itself). Dropped the
    table's `UNIQUE(name)` constraint — two bank accounts can share a bank name with a different
    account_no (e.g. two "Meezan Bank" accounts), so uniqueness is name+account_no, service-layer
    only, same shape as vendors' name+phone.
  - `CODES.CASH_AT_BANKS` renamed to `CODES.BANK_ACCOUNTS` — this reserved chart account (code
    `100003`) already existed and was already seeded, just under its stale pre-correction name
    "Cash at Banks"; `cash_and_bank.md` §11 item 6 explicitly calls for this rename. Seed name
    corrected to `'BANK ACCOUNTS'` in `src/db/seeds/run.js`. Note: `ensureChartAccount()` in that
    seed script is insert-only (no-op if the code already exists), so this rename only takes effect
    on a fresh `npm run seed` — not an issue right now since `database/schema.sql` hasn't been
    applied to a real DB in this environment yet, but flag it if this is ever run against a DB that
    was seeded before this change.
  - Built the reactivate-instead-of-reject duplicate pattern (see the Cross-cutting section below)
    into `create()`/`update()` from the start, rather than needing a later retrofit like every other
    entity did: name+account_no key, ACTIVE match blocks (`DUPLICATE_NAME`), INACTIVE match throws
    `INACTIVE_DUPLICATE` with `details`, new `bank-accounts:reactivate` IPC channel.
  - Registered `ipc/bankAccounts.ipc.js` in `src/ipc/index.js`; added `'bankAccounts'` to
    `electron/preload.js`'s `FEATURES` array — it was missing, so the channel wouldn't have been
    reachable from the renderer even once the handler existed.
- **Not done:** not run against a live `wentox_db` yet (code untested end-to-end — no migrate/seed/
  manual IPC call verification this pass). No frontend page for Bank Accounts exists at all yet
  (same "backend real, frontend still on demo data" state as every other entity).
- **Files:** `database_schema_v4.3.md`, `database/schema.sql` (bank_accounts columns/constraint);
  `src/constants/reservedAccounts.js`, `src/db/seeds/run.js` (rename); `src/repositories/
  bankAccounts.repository.js` (new), `src/services/bankAccounts.service.js` (filled in from empty
  stub), `src/ipc/bankAccounts.ipc.js` (new), `src/ipc/index.js` (registered); `electron/
  preload.js` (added to FEATURES); `backend/milestones/milestone4.md` (checkboxes).

## Cross-cutting — Reactivate-instead-of-reject duplicate handling

### 2026-08-04 — Rolled out to every built entity (vendors, customers, sub-customers, regions, cities, stores, categories, addas, products)
- **What:** Replaced flat "reject on any name match" duplicate checks with reactivate-aware ones,
  everywhere that entity actually has CRUD code today. Two branches (see
  `System_architecture/soft_delete_and_duplicate_check.md` for full reasoning):
  - **Unique-by-nature** (vendors, regions, cities, stores, categories, addas, products) — ACTIVE
    match still blocks `create()` (`DUPLICATE_NAME`, 409); INACTIVE match now throws
    `INACTIVE_DUPLICATE` with the existing row's id/name in `ApiError`'s new `details` field
    (threaded through `wrap.js`), and a new `<feature>:reactivate` channel flips it back to active.
    Vendors and products key on name+phone / name+vendor_id (a second field, since those two can
    legitimately repeat a name); regions/cities/stores/categories/addas key on name alone, matching
    their existing DB-level `UNIQUE(name)` constraints, which were left in place.
  - **Non-blocking** (customers, sub-customers) — real people share names, so an ACTIVE match never
    blocks `create()`. New `checkName(name)` fn + `<feature>:checkName` channel the frontend is
    expected to call *before* `create()`, returning `{status:'none'|'active'|'inactive', matches:[]}`;
    only `'inactive'` needs a decision (reactivate one of the matches, or create new anyway).
  - **Products** had no duplicate-name check of any kind before this — added key = name+vendor_id.
  - Dropped two stray DB-level `UNIQUE(name)` constraints that would have silently overridden the
    non-blocking branch: `vendors.name`, `sub_customers.name` (`customers.name` never had one).
  - **Not done:** bank accounts and employees — both are still empty stub files (Milestone 4, no
    CRUD written yet), so there's nothing to attach this pattern to there.
- **Frontend:** Built `frontend/src/components/DuplicateNamePromptModal.tsx`, a reusable prompt
  covering both branches (`allowCreateOnActive` toggles which). **Not wired into any page** —
  every setup page for these entities (`RegionSetupPage.tsx`, `CitySetupPage.tsx`,
  `StoreSetupPage.tsx`, `CategorySetupPage.tsx`, `AddaSetupPage.tsx`, `VendorSetupPage.tsx`,
  `ProductSetupPage.tsx`, `CustomerSetupPage.tsx`, `SubCustomerSetupPage.tsx`) still runs on the
  old in-memory `useReducer` demo state (`AppContext.tsx`), not real `window.api` IPC calls —
  wiring the modal in for real means switching each page off demo data first, which hasn't been
  done.
- **Files:** `errors/ApiError.js`, `ipc/wrap.js`; `repositories/{vendors,customers,subCustomers,
  regions,cities,stores,categories,addas,products}.repository.js`; `services/` (same list);
  `ipc/{vendors,customers,subCustomers,regions,cities,stores,categories,addas,products}.ipc.js`;
  `database_schema_v4.3.md`/`database/schema.sql` (dropped the two stray constraints, plus earlier
  in this session: dropped `customers.phone`/`sub_customers.phone`, `vendors.address`);
  `frontend/src/components/DuplicateNamePromptModal.tsx` (new, unwired).

## Milestone 4 — planning only (no code yet)

### 2026-08-19 — Found and planned: Bank Accounts, Transfer, Payroll (Employees/Wage/Salary Run)
- **What:** User pointed out the frontend sidebar has screens (Employees/Workers, Bank Accounts,
  Transfer, Wage Run, Salary Run) with no corresponding milestone module — screenshots showed the
  live UI for Bank Accounts and the Transactions sidebar section listing Wage Run/Salary Run/
  Transfer. Investigated and found these are NOT actually undefined: `database/schema.sql` already
  has complete, applied tables for all of them (`bank_accounts`, `cheques`, `transfers`,
  `employees`, `stages`, `worker_stages`, `wage_runs`/`wage_run_items`, `salary_runs`/
  `salary_run_items`), and two dedicated, thorough design docs exist —
  `System_architecture/cash_and_bank.md` (Bank Accounts, cheque routing, Transfer) and
  `System_architecture/payroll.md` (Employees, Wage Run, Salary Run) — neither of which had been
  folded into `database_schema_v4.3.md`/`use_cases.md` or referenced by any milestone file. This is
  exactly why Milestone 7's Module 7.1 ("Workers — blocked, no definition exists") was wrong: that
  check only looked in the two files that don't cover this scope.
- **How:** No code was written this pass — purely planning/documentation, per explicit user
  instruction to add these to the milestones and update the schema doc before continuing backend
  work (session was about to clear context). `backend/milestones/milestone4.md` rewritten: renamed
  from "Receipts (Jamma) & Expenses (Kharch)" to "Receipts, Expenses, Bank Accounts, Transfer,
  Payroll," keeping the original Modules 4.1/4.2 verbatim and adding four new modules — **4.3 Bank
  Accounts** (party pattern, same `createUnderChartCode` helper as Vendors/Customers, under chart
  code `120002`), **4.4 Transfer** (debit `to_ba_id`/credit `from_ba_id`, must be excluded from
  income/expense report totals), **4.5 Employees** (moved from Milestone 7 Module 7.1 — type-first
  form, Worker requires ≥1 trade, Salaried requires `monthly_salary`, `employee_type` immutable
  after creation, auto-links a BA under `220001`/`220002` depending on type), **4.6 Wage Run**
  (reads `dbo.articles`' stage-cost columns but only writes `ledger_entries`; `rate`/`packing`
  snapshotted per line; deliberately has no duplicate-settlement guard — the frontend instead shows
  the worker's last 3 runs for the chosen stage; unpost is audited via `unposted_at`/
  `unposted_by`/`amount_before`, not silent), **4.7 Salary Run** (one run per calendar month,
  every active salaried employee pre-filled and editable per-line, one credit line per employee on
  post, blocked from a second CONFIRMED run in the same month by `UQ_salary_runs_month`).
  `backend/milestones/milestone7.md`'s Module 7.1 replaced with a pointer to Milestone 4 Module
  4.5, explaining why the old "blocked" note was wrong. `System_architecture/database_schema_v4.3.md`
  got a new top-of-file note listing exactly which tables it doesn't describe and pointing at
  `cash_and_bank.md`/`payroll.md` as the actual source of truth for them, so this gap can't recur
  the same way — matches the existing "Post-v4.3 amendments" pointer-note pattern already used
  there rather than copying hundreds of lines of DDL that already live correctly elsewhere.
- **Not done / still open:** none of Modules 4.3–4.7 have any code yet — repository/service/ipc
  files for `bankAccounts`, `transfers`, `employees`, `stages`, `wageRuns`, `salaryRuns` are all
  still TODO stubs or don't exist. Reserved chart-account codes referenced by the new docs
  (`120002` BANK ACCOUNTS, `220001` WORKER WAGES, `220002` SALARIES PAYABLE, `410001` WAGES
  EXPENSE, `410002` SALARIES EXPENSE) are NOT yet in `backend/src/constants/reservedAccounts.js`
  or seeded in `backend/src/db/seeds/run.js` — check both before starting Module 4.3 or 4.5, since
  `createUnderChartCode` will 404 without them. `cash_and_bank.md` §11 also lists several *schema*
  changes beyond just adding the new tables (e.g. splitting `expenses.payment_mode` into
  `CHEQUE_ENDORSED`/`CHEQUE_ISSUED`, adding `issued_cheque_no`/`issued_cheque_date` to `expenses`,
  relaxing `CK_cheque_allocations_target`) — re-read that doc's §11 in full before building Module
  4.1's cheque-deposit-bank piece or Module 4.2, since some of those may already be applied in
  `schema.sql` and some may not be (not independently re-verified this pass — check column-by-column
  against the live `expenses`/`cheque_allocations` tables before assuming either way).
- **Files:** `backend/milestones/milestone4.md`, `backend/milestones/milestone7.md`,
  `System_architecture/database_schema_v4.3.md`

## Milestone 6 — System Setup: Product Details, Categories, Vendors (follow-up)

### 2026-08-18 — articles.batch_no: free-text → system-generated, scoped per vendor
- **What:** Per explicit client instruction ("Ali has his own batch number, Abdullah has his own"),
  `batch_no` on Product Details stopped being a free-typed field and became a system-generated
  integer with its own sequence per vendor — the same "each vendor has an independent counter"
  shape already established for `businessAccounts`' §3.2 serials, just scoped to `articles`
  instead of `business_accounts`.
- **How:** Confirmed the exact rules with the user before touching anything (global vs. per-vendor
  scope, unique + immutable vs. editable) since this was a real schema change, not just app logic.
  Schema: `articles.batch_no` `VARCHAR(50) NULL` → `INT NOT NULL`; `articles.vendor_id` promoted
  from nullable to `NOT NULL` (a batch number can't be generated without a vendor to scope it to —
  the user confirmed this consequence explicitly rather than leaving vendor optional and batch_no
  null in that case). New `UQ_articles_vendor_batch UNIQUE (vendor_id, batch_no)`.
  `products.repository.js` gained `nextBatchNo(vendorId)` (`MAX(batch_no) + 1 WHERE vendor_id =
  @vendorId`, starting at 1); `insert()` now requires both `vendor_id`/`batch_no` as `sql.Int`
  (previously `batch_no` was typed `sql.VarChar(50)`); `update()` excludes both from its `SET`
  clause entirely — immutable after creation, since changing the vendor later would orphan the
  article's batch number from the sequence it actually came from. `products.service.js:create()`
  gained `validateVendor()` (400 if missing) and a `vendorsService.getById()` call (404 if the
  vendor doesn't exist) before generating the batch number, so a bad `vendor_id` never burns a
  sequence slot on a request that was going to fail anyway.
  Schema change went through the usual path: a temporary numbered migration, applied to
  `wentox_db`, then folded directly into `database/schema.sql` and the migration file deleted — a
  fresh `schema.sql`-only import needs nothing else.
- **Debugger review caught a real bug before it shipped:** the migration's first draft backfilled
  every pre-existing row's new `batch_no` column to a flat `1`, rather than a real per-vendor
  sequence — harmless against `wentox_db` today (only one pre-existing article, from earlier test
  fixtures), but would have hard-failed the new unique constraint (or produced wrong numbers) on
  any database with more than one existing article under the same vendor. Fixed using `ROW_NUMBER()
  OVER (PARTITION BY vendor_id ORDER BY article_id)` instead, and re-verified against a seeded
  4-article, 2-vendor, 1-null-vendor scenario in a disposable scratch database — Vendor A's two
  articles correctly got `batch_no` 1 and 2, Vendor B's one article independently got 1, and the
  previously-vendorless article was backfilled to a vendor and got the next number in that vendor's
  sequence.
- **Verified:** live against `wentox_db` — missing `vendor_id` on create rejected; two products
  created under the same vendor got sequential `batch_no` values continuing from the existing
  fixture; an update attempt that tried to change `vendor_id` and other fields left `vendor_id`/
  `batch_no` completely unchanged while every other field updated normally. Also re-verified the
  from-scratch `schema.sql`-only import path against a second disposable scratch database, matching
  `wentox_db`'s column types/constraints exactly.
- **Files:** `database/schema.sql`, `backend/src/repositories/products.repository.js`,
  `backend/src/services/products.service.js`, `backend/milestones/milestone6.md`

## Milestone 8 — System Setup: City Creation & Accounts Hierarchy

### 2026-08-17 — Module 8.1 complete: regions, cities, stores, addas
- **What:** Confirmed exact scope with the user before building (same module-by-module check-in
  discipline as Milestone 7): flat CRUD for Regions/Cities/Stores, Addas with a UC-14 delete-guard
  plus a new required `region_id` column. Two doc mismatches caught and deliberately NOT followed
  before writing any code: (1) UC-11/UC-12 mention an "auto code" step for cities/regions, but the
  applied schema has no `code` column on either table — confirmed with the user this is stale
  wording, built as plain name-only (+ optional `region_id` on cities) CRUD instead; (2) a
  "reactivate an inactive duplicate-named row instead of rejecting" idea was raised mid-session,
  explicitly parked/flagged rather than built into any entity, old or new.
  - **Regions** (`regions.*`): plain CRUD. `regions.ipc.js` didn't exist at all, and `regions` was
    missing from both `src/ipc/index.js` and `electron/preload.js`'s `FEATURES` array — all three
    gaps fixed as part of this module (not a pre-existing bug elsewhere, just never wired up).
  - **Cities** (`cities.*`): CRUD, `region_id` optional per UC-11 ("optionally attach it to a
    region"), list/get join region name for display.
  - **Stores** (`stores.*`): plain CRUD.
  - **Addas** (`addas.*`): CRUD plus UC-14's delete-guard — `remove()` checks `isReferenced()`
    (`sale_bills`, `sale_returns`, `draft_sale_bills`, `draft_sale_returns`, all by `adda_id`)
    before soft-deleting; if referenced, throws `409 ADDA_IN_USE` and makes no change at all,
    rather than silently soft-deleting. Also gained a new required `region_id` (see schema change
    below) — `list()` supports an optional `region_id` filter for a future region-scoped adda
    dropdown, mirroring `sub_customers`.
  - **Schema change:** `addas.region_id INT NOT NULL` added, FK'd to `regions`, per explicit
    client instruction — same rationale/pattern as `sub_customers.region_id` from the prior
    session. One pre-existing "Test Adda" fixture row (created during earlier Sale Bill/Return
    verification) had a `NULL` city and no region at all — backfilled to a real region via the
    migration before the `NOT NULL` constraint was applied, so the `ALTER COLUMN` wouldn't fail
    against existing data. Folded directly into `database/schema.sql` afterward (temporary
    migration file applied, verified live, then deleted), same pattern as every prior schema
    change this project. `use_cases.md` UC-14 and `database_schema_v4.3.md` updated to match.
- **Verified:** debugger-subagent review (column names against schema.sql, `isReferenced()`'s four
  table/column checks, guard-before-soft-delete ordering, correct optional-vs-required `region_id`
  split between Cities/Addas, duplicate-name-excludes-own-row pattern, no hard deletes, IPC action
  casing, migration step ordering against existing data, `regions` actually wired into both
  registration points) came back clean. Then live against `wentox_db`: Regions/Cities/Stores CRUD
  with duplicate rejection and soft-delete; Addas — missing `region_id` rejected, create/update,
  an unreferenced adda soft-deletes successfully, and the pre-existing genuinely-referenced
  "Test Adda" row (used by real sale bills/returns from earlier verification runs) correctly
  blocked deletion with `ADDA_IN_USE`. Also re-verified the from-scratch `schema.sql`-only import
  path against a disposable scratch database — `addas.region_id` `NOT NULL`, matching `wentox_db`
  exactly.
- **Files:** `backend/src/{repositories,services,ipc}/regions.*` (new `ipc` file),
  `backend/src/{repositories,services,ipc}/cities.*`,
  `backend/src/{repositories,services,ipc}/stores.*`,
  `backend/src/{repositories,services,ipc}/addas.*`, `backend/src/ipc/index.js`,
  `backend/electron/preload.js`, `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md`, `System_architecture/use_cases.md`,
  `backend/milestones/milestone8.md`

## Milestone 7 — System Setup: Workers, Customers, Sub-Customers

### 2026-08-16 — Added region_id/city_id to sub_customers (schema change, per client instruction)
- **What:** Sale Bill/Sale Return's "deliver to" sub-customer dropdown needs to narrow to the
  selected customer's region — sub_customers previously had no region/city at all. Confirmed the
  exact requirements with the user first (region_id required, city_id optional/informational;
  filter matches region only, not city) before touching schema or code.
- **How:** `region_id INT NOT NULL` + `city_id INT NULL` (both FK'd to `regions`/`cities`) added to
  `dbo.sub_customers`, folded directly into `database/schema.sql` (table was empty in `wentox_db`,
  so the `NOT NULL` add needed no backfill — applied via a temporary migration first, verified
  live, then folded in and the migration deleted, same pattern as every other schema change this
  project). `subCustomers.repository.js`'s `list()` gained a `region_id` filter (unfiltered still
  returns everyone — this is opt-in narrowing, not a hard restriction), `findById()`/`list()` now
  join `regions` (INNER, required) and `cities` (LEFT, optional) for display names, `insert()`/
  `update()` carry the new columns through. `subCustomers.service.js`'s `validate()` now requires
  `region_id`. Also corrected two docs that were now stale: `use_cases.md`'s UC-10, which
  explicitly said the dropdown lists "every sub-customer... not a filtered subset" (struck
  through, replaced with the new region-match behavior), and `database_schema_v4.3.md`'s
  `sub_customers` CREATE TABLE block + a new "Post-v4.3 amendment" note.
- **Verified:** live against `wentox_db` — missing `region_id` rejected; created two sub-customers
  in different regions; `list({ region_id: lahoreId })` correctly included the matching one and
  excluded the other; unfiltered `list()` still returned both. Also re-verified the from-scratch
  `schema.sql`-only import path against a disposable scratch database (`sub_customers.region_id`
  `NOT NULL`, `city_id` nullable, matching the live database exactly).
- **Files:** `database/schema.sql`, `System_architecture/database_schema_v4.3.md`,
  `System_architecture/use_cases.md`, `backend/src/repositories/subCustomers.repository.js`,
  `backend/src/services/subCustomers.service.js`, `backend/milestones/milestone7.md`

### 2026-08-15 — Modules 7.2 & 7.3 complete: customers, subCustomers
- **What:** Built module-by-module with a functionality check-in before each, per explicit
  direction this session (confirm scope/approach first, then implement — not the whole milestone
  in one pass).
  - **Customers** (`customers.*`, Module 7.2, UC-09): confirmed as an exact mirror of Module 6.3's
    Vendors before building — same CRUD shape, same auto-linked-`business_accounts`-on-create
    pattern (reusing `businessAccountsService.createUnderChartCode` under CUSTOMERS ACCOUNTS this
    time), same rename-syncs-the-account behavior, same transaction-safe `create()` from the
    start (no repeat of the Vendors orphan-row bug — a debugger review confirmed this). One real
    schema difference correctly handled: `region_id` is required (`NOT NULL` on `dbo.customers`,
    unlike vendors' nullable `region_id`), validated accordingly. Debugger review flagged one
    low-risk informational note: `customers.name` has no DB-level `UNIQUE` constraint (unlike
    `vendors.name`'s `UQ_vendors_name`) — duplicate protection is service-layer-only, accepted as
    low risk in this single-admin-session desktop app, not schema-patched.
  - **Sub-Customers** (`subCustomers.*`, Module 7.3, UC-10): milestone7.md's checklist said
    sub-customers "must belong to a customer" — checked this against the actual schema (no
    `customer_id` column on `dbo.sub_customers`) and UC-10's explicit text ("Sub-customers are
    independent. They have no parent customer... the parent-customer link still exists and must
    be *removed*") and confirmed with the user that the milestone doc's line was stale before
    building. Built as a flat CRUD instead: `name`/`phone`/`address`/`is_active` only, no
    region/city, no linked business account. The Sale Bill inline "+ Add Sub-Customer" flow uses
    the same `sub-customers:create` channel as the standalone screen (no parent to scope under, so
    no separate customer-scoped channel needed, correcting milestone7.md's other stale line).
- **How:** Both modules follow the same list/get/create/update/remove IPC shape as every other
  Milestone 6/7 module. `milestone7.md` updated in place to strike the two stale lines with a
  note explaining what was actually built and why.
- **Verified:** debugger-subagent review on each module separately (Customers: confirmed
  transaction safety, correct `region_id` requirement, correct `CODES.CUSTOMERS_ACCOUNTS` usage,
  correct JOIN directions; Sub-Customers: confirmed no parent-link anywhere, correct IPC channel
  casing) — both clean. Then live against `wentox_db` for each before moving to the next: Customers
  (missing region rejected → create with linked account `100001XXXX` → duplicate rejected → update
  renames both → soft-delete, account stays `ACTIVE`); Sub-Customers (create → duplicate rejected →
  update → list/soft-delete).
- **Files:** `backend/src/{repositories,services,ipc}/customers.*`,
  `backend/src/{repositories,services,ipc}/subCustomers.*`, `backend/milestones/milestone7.md`

## Milestone 6 — System Setup: Product Details, Categories, Vendors

### 2026-08-14 — Modules 6.1, 6.2, 6.3 complete: products, categories, vendors
- **What:** Pulled forward ahead of Milestone 4 (see status line above) so Sale Bill/Return/
  Purchase/Return have real dropdown data to test against instead of hardcoded fixture IDs. Built
  module-by-module, checking in and live-verifying after each before moving to the next, per
  explicit direction partway through this session.
  - **Categories** (`categories.*`): plain CRUD, duplicate-name rejected, soft delete via `is_active`.
  - **Products** (`products.*`, queries `dbo.articles` — see milestone6.md's naming note):
    CRUD with the full 12-column manufacturing cost breakdown; `code` (e.g. `P-101`) is
    system-generated on create, never typed — `nextCode()` takes
    `MAX(TRY_CAST(SUBSTRING(code,3,30) AS INT))` over `code LIKE 'P-%'` and adds 1, starting at 101.
    `create()`/`update()` validate `category_id` exists via `categoriesService.getById` first, for a
    clean 404 instead of a raw FK-violation.
  - **Product Colors** (`productColors.*`, queries `dbo.article_colors`): per UC-07, colors are
    *not* created from the Product Details form — `resolveOrCreate(article_id, color, packing)` is
    what the Current Stock "Add" dialog (UC-28, Milestone 5) will call later; case-insensitive
    dedup on `(article_id, color)`, backed by `UQ_article_colors_acolor`.
  - **Vendors** (`vendors.*`): full CRUD; `create()` auto-creates a linked `business_accounts` row
    under the reserved VENDORS ACCOUNTS chart account (§3.2 composition: parent 6-digit chart code
    + 4-digit zero-padded serial, `serial = MAX(existing under that parent) + 1`) and links it via
    `vendors.ba_id` — the user never sees a separate account-setup step (UC-08). Renaming a vendor
    renames the linked account too.
  - New reusable helper: `businessAccountsService.createUnderChartCode(transaction, chartCode,
    name, extra)` — the §3.2 code-generation logic pulled out so Customers/Sub-Customers
    (Milestone 7) can call the identical pattern under CUSTOMERS ACCOUNTS instead of
    reimplementing it.
- **How:** A debugger-subagent review of the Vendors module caught a real bug before it shipped:
  the first version created the `business_accounts` row and the `vendors` row as two separate,
  non-transactional `query()` calls — if the vendor insert failed after the account insert
  succeeded, the account row would be permanently orphaned (a ledger account with no vendor
  pointing at it, visible in Chart of Accounts listings with no way to clean it up from the UI).
  Fixed by threading a `transaction` parameter through `businessAccounts.repository.js`
  (`nextSerial`, `insert`) and `vendors.repository.js` (`insert`), and wrapping both calls in one
  `withTransaction` block in `vendors.service.js:create()` — same pattern every other multi-write
  service in this codebase already follows.
  Also fixed, while auditing for the same bug class: `auth.ipc.js`'s `auth:update-credentials`/
  `auth:verify-password` channels were kebab-case on the action segment, but
  `electron/preload.js`'s `window.api` Proxy only kebab-cases the *feature* prefix, not the action
  — it passes the JS property access straight through unmodified. A future
  `window.api.auth.verifyPassword(...)` call would have silently mismatched. Renamed to
  `auth:updateCredentials`/`auth:verifyPassword`. New `productColors.ipc.js` channels
  (`listByArticle`, `resolveOrCreate`) were written camelCase from the start to avoid the same trap.
- **Verified:** debugger-subagent review on both the Products/Categories/ProductColors batch and
  the Vendors batch (separately) came back clean after the transaction fix; then live against
  `wentox_db` for each module before moving to the next: category → product (auto-code, rejects
  unknown category) → second product (incremented code) → update → two color variants (including
  a different-case duplicate resolving to the same variant) → soft-delete variant → soft-delete
  product; vendor create (linked business account `200001XXXX`) → duplicate name rejected → update
  (renames both) → list/soft-delete (linked account stays `ACTIVE`) → structural check confirming
  no orphaned `business_accounts` row.
- **Files:** `backend/src/{repositories,services,ipc}/categories.*`,
  `backend/src/{repositories,services,ipc}/products.*`,
  `backend/src/{repositories,services,ipc}/productColors.*` (new `ipc` file),
  `backend/src/{repositories,services,ipc}/vendors.*`,
  `backend/src/{repositories,services}/businessAccounts.*`, `backend/src/ipc/index.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/electron/preload.js`,
  `backend/milestones/milestone6.md`

## Milestone 3 — Purchase & Purchase Return

### 2026-08-13 — Modules 3.1 & 3.2 complete: purchases, purchaseReturns, both draft mirrors
- **What:** Full Purchase (UC-23) and Purchase Return (UC-24) backend, same shape as Sale
  Bill/Return but with real differences settled via a short round of clarifying questions before
  building: (1) no password guard anywhere — there's no edit-a-posted-purchase UI flow, so
  `update()` just blocks entirely once posted (`POSTED_LOCK`), never reverses+reapplies ledger;
  (2) `draft_purchases`/`draft_purchase_returns` are their own tables (not a status value), per
  client instruction; (3) unlike `draft_sale_bills`, saving/deleting a draft purchase has **zero**
  effect on `vendor_stock_movements` — nothing physically arrives before a purchase is recorded.
  New: `materials.repository.js` (`resolveOrCreate` — case-insensitive material lookup-or-register,
  transactional), `purchaseMath.js` (shared line/total math, no packing/discount concept — just
  `quantity × price_per_unit`), `purchases`/`purchaseReturns`/`draftPurchases`/
  `draftPurchaseReturns` (ipc/service/repository each), `vendors.service.js`/
  `vendors.repository.js` gained the same minimal `getById`/`findById` pattern
  `customers.service.js` already has (full CRUD still deferred to Milestone 7).
- **How:** Posting (schema §7): Purchase → debit PURCHASES chart account / credit vendor BA,
  positive `PURCHASE` vendor_stock_movements row per line. Purchase Return → reverse — debit
  vendor BA / credit PURCHASES, negative `PURCHASE_RETURN` row (return items are stored positive
  per `CK_purchase_return_items_qty`, negated only when building the vendor-stock movement).
  Purchases never touch `stock_movements` (finished-goods/pairs) — only `vendor_stock_movements`
  (material units), per UC-23's explicit note. Schema changes (drop `status` from both tables, add
  the four draft tables) went through the usual path: a temporary numbered migration, applied and
  verified live, then folded directly into `database/schema.sql` and the migration file deleted —
  a fresh `schema.sql`-only import needs nothing else (verified against a disposable scratch
  database, `wentox_db` unaffected/no-op on re-migrate).
- **Verified:** `debugger`-pattern subagent review (posting signs, transaction scoping — material
  resolution happens inside the same transaction as the line it belongs to, not a separate
  connection — export/usage consistency, draft-confirm asymmetry vs. Sale Bill) came back clean.
  Then live against `wentox_db`: create with a brand-new material name → auto-registered in
  `dbo.materials`; a second purchase using a different-case spelling of the same name resolved to
  the identical `material_id` (case-insensitive collation); post → correct ledger direction +
  positive vendor-stock row; double-post rejected; update-while-posted rejected
  (`POSTED_LOCK`, not a reverse+reapply); unpost removes the rows; Purchase Return posted the exact
  reverse (debit vendor BA / credit PURCHASES, negative vendor-stock row); draft create/delete
  confirmed zero net vendor-stock movement; draft confirm (both Purchase and Purchase Return)
  posted exactly once and deleted the draft row.
- **Files:** `backend/src/repositories/materials.repository.js`,
  `backend/src/services/purchaseMath.js`,
  `backend/src/repositories/vendors.repository.js`, `backend/src/services/vendors.service.js`,
  `backend/src/{ipc,services,repositories}/{purchases,draftPurchases,purchaseReturns,draftPurchaseReturns}.*`,
  `backend/src/ipc/index.js`, `backend/electron/preload.js`, `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md`, `backend/milestones/milestone3.md`

## Milestone 2 — Sale Bill & Sale Return

### 2026-08-07 — Folded the status-drop/due_date migrations directly into database/schema.sql
- **What:** Per explicit client instruction ("only run schema.sql on import"), consolidated the two
  migrations from the entry below (`001_sale_bills_due_date.sql`, `002_drop_sale_status.sql`)
  directly into `database/schema.sql`'s `sale_bills`/`sale_returns` `CREATE TABLE` blocks, then
  deleted both migration files and the now-empty `src/db/migrations/` directory. This is a
  deliberate one-time exception to the project's usual "never edit an applied schema file" rule
  (see `backend/CLAUDE.md`) — done only because consolidating is exactly what was asked for.
- **How:** `sale_bills` now declares `due_date DATE NULL` directly (no `status` column);
  `sale_returns` declares neither. Also updated the `alert_dismissals` block comment, which used to
  say `due_date` "was removed from sale_bills/purchases" — now notes it's back on `sale_bills` (not
  `purchases`) for the pending notification feature, though the alert itself isn't wired up yet.
  `database_schema_v4.3.md`'s CREATE TABLE blocks for both tables were updated to match (the doc's
  blocks are meant to mirror the actual applied schema), and its top-of-file amendments note was
  reworded from "applied via migrations" to "folded directly into schema.sql."
  For the already-migrated `wentox_db`, this is a no-op — `migrate.js` tracks applied files by
  basename in `schema_migrations`, so it never re-runs `schema.sql`, and the two migration files it
  already ran are simply gone from disk now (their effect is already permanently in that database).
- **Verified:** created a disposable scratch database (`wentox_schema_scratch_test`) on the same SQL
  Server instance, applied `schema.sql` alone (no migrations directory, none exist anymore),
  confirmed `sale_bills` has `due_date` and no `status`, confirmed `sale_returns` has no `status`,
  then dropped the scratch database — `wentox_db` was never touched by this verification.
- **Files:** `database/schema.sql`, `System_architecture/database_schema_v4.3.md`; removed
  `backend/src/db/migrations/001_sale_bills_due_date.sql`,
  `backend/src/db/migrations/002_drop_sale_status.sql`, and the (now-empty) `migrations/` dir.

### 2026-08-07 — Dropped `status` from sale_bills/sale_returns; re-added `sale_bills.due_date`
- **What:** Two schema amendments beyond the applied `database/schema.sql` (both via new files
  under `src/db/migrations/`, per the project's "never edit an applied schema file" rule):
  1. `001_sale_bills_due_date.sql` — `ALTER TABLE sale_bills ADD due_date DATE NULL`. Reverses
     v4.3's deliberate removal of this column, per explicit client instruction, ahead of a planned
     payment-overdue notification feature (details pending). Wired through
     `saleBills.repository.js` (`insert`, `updateHeader`) and `saleBills.service.js`
     (`buildBillFields`). Not added to `sale_returns` (schema note: "a return is not a payable").
  2. `002_drop_sale_status.sql` — drops `status` (+ its `DF_*`/`CK_*` constraints) from both
     `sale_bills` and `sale_returns`, per client confirmation that the column never actually
     changed value given the frontend's real button set: Confirm creates+posts atomically, and
     editing an already-posted document reverses+reapplies its ledger inside `update()` itself
     (from an earlier session), so a real row is never left visibly "unposted" in between.
- **How:** Both repositories gained `isPosted(id)` — `SELECT CASE WHEN EXISTS (... ledger_entries
  WHERE source_type=... AND source_id=@id) THEN 1 ELSE 0 END` — and `findById` now attaches the
  result as `is_posted` on every returned row. `create()` no longer sets any status field.
  `update()`/`post()`/`unpost()` in both services branch on `existing.is_posted` /`bill.is_posted`
  instead of a stored string; `setStatus` removed from both repositories entirely.
  `draftSaleBills.service.js`/`draftSaleReturns.service.js`'s `confirm()` no longer builds a
  `status: 'CONFIRMED'` field when assembling the row to insert (posting happens right after via
  `postLedgerAndStock`, which is what makes it "posted" now). The two ipc handlers
  (`sale-bills:update`, `sale-returns:update`) that gate the password check on "is this document
  currently posted" now read `existing.is_posted` instead of `existing.status === 'CONFIRMED'`.
  `database_schema_v4.3.md` got a "Post-v4.3 live amendments" note up top rather than rewritten
  CREATE TABLE blocks, since the doc's blocks are meant to match the *original* applied
  `schema.sql`, not the migrations layered on top.
- **Verified:** live against `wentox_db` — confirmed zero `status` columns remain on either table;
  full bill lifecycle (create → `is_posted=false` → post → `is_posted=true` → double-post rejected
  → edit-while-posted, ledger/stock correctly reversed+reapplied at new totals → unpost →
  `is_posted=false` → double-unpost rejected); same lifecycle on sale return; draft-return
  `confirm()` still produces a correctly-posted return with no `status` field involved anywhere.
- **Files:** `backend/src/db/migrations/001_sale_bills_due_date.sql`,
  `backend/src/db/migrations/002_drop_sale_status.sql`,
  `backend/src/repositories/{saleBills,saleReturns}.repository.js`,
  `backend/src/services/{saleBills,saleReturns,draftSaleBills,draftSaleReturns}.service.js`,
  `backend/src/ipc/{saleBills,saleReturns}.ipc.js`,
  `System_architecture/database_schema_v4.3.md`

### 2026-07-31 — Module 2.1 complete: sale-bills:list/get/update/post/unpost
- **What:** Finished every remaining `milestone2.md` Module 2.1 checkbox. `saleBills.repository.js`
  gained `deleteItems`, `updateHeader`, `setStatus`, `deleteLedgerAndStock`, `list(filters)`.
  `saleBills.service.js` gained `list` (with a `resolveDateRange` helper — `weekly`/`monthly`/
  `overall` convenience on top of explicit `date_from`/`date_to`, explicit always wins), `update`
  (blocked unless `status = 'DRAFT'`, i.e. unposted — reuses the exact same totals math as `create`
  via two new extracted helpers, `resolveLinesAndTotals`/`buildBillFields`, so the two don't drift),
  `post` (reuses the existing `postLedgerAndStock` built earlier for `draftSaleBills.confirm`, then
  sets `status = 'CONFIRMED'`; blocked if already posted), `unpost` (deletes the bill's
  `ledger_entries`/`stock_movements` rows and sets `status = 'DRAFT'`; blocked if not posted).
  `saleBills.ipc.js` wired `sale-bills:list/get/update/post/unpost`.
- **How:** Verified the full lifecycle with a stubbed-dependency `node -e` test: create → update
  while DRAFT (succeeds, totals recompute) → post (ledger + stock rows written, status flips) →
  update while CONFIRMED (blocked) → double-post (blocked) → unpost (ledger/stock rows removed,
  status flips back) → double-unpost (blocked) → list with a weekly range (correct date window). A
  separate subagent debug review (briefed from `.claude/agents/debugger.md`) checked the parts that
  test wouldn't catch — `deleteLedgerAndStock`'s WHERE clause can't touch a different bill's rows or
  a `SALE_RETURN`'s rows, `updateHeader` updates every column `insert` sets except `status`/
  `created_by` (correctly immutable outside `setStatus`), no invalid status string is ever written,
  and every multi-write path is inside one `withTransaction` call. No bugs found.
- **Files:** `backend/src/repositories/saleBills.repository.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`
- **Module 2.1 is now fully complete.** Next: Module 2.2 (Sale Return) — same shape, mirrored
  direction. No live SQL Server yet — everything here is logic-verified, not DB-verified.

### 2026-07-30 — Module 2.1 (partial): sale-bills:create + debug pass
- **What:** Implemented the first `milestone2.md` checklist item: `saleBills.repository.js`
  (`getVariantPackings`, `insert`, `insertItems`, `findById`), `saleBills.service.js` (`create` —
  validation, server-computed pairs/discounts/totals, one `withTransaction`), `saleBills.ipc.js`
  (`sale-bills:create` behind `requireSession()`).
- **How:** A separate subagent review (briefed from `.claude/agents/debugger.md`, not done inline)
  found and I fixed 4 real bugs: (1) **critical** — the repository joined against `dbo.products`/
  `product_id`, which doesn't exist; `database/schema.sql` (the real, authoritative schema — more
  current than `System_architecture/database_schema_v4.3.md`, which still describes the old
  `products` shape) actually has `dbo.articles`/`article_id`, with a completely different cost
  breakdown (12 real manufacturing-stage columns + `sale_price`, not `cost_price`/`labour`/etc.) —
  every `sale-bills:create` call would have failed at the first query; (2) `discount_percent`
  defaulted to `0` one line too late in `buildLine`, so omitting it produced `NaN` through the whole
  totals chain; (3) missing validation for the schema's `CK_sale_bills_custdlv` (sub_customer_id
  required unless `delivery_type = 'SAME'`); (4) missing validation that `cartons > 0` per line
  (schema's `CK_sale_bill_items_pairs` requires `pairs > 0`, and `pairs = cartons × packing`).
  Verified all 4 fixes with stubbed-dependency `node -e` tests (module-cache injection to avoid
  needing `mssql`/a live DB) — confirmed correct totals math and that all three validation cases now
  throw before reaching the transaction.
- **Files:** `backend/src/repositories/saleBills.repository.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`, `backend/electron/preload.js` (kebab-case channel name fix —
  `window.api.saleBills.list()` now correctly calls `sale-bills:list`, not `saleBills:list`)
- **Resolved:** `products` vs `articles` naming — decided to keep the feature/screen name
  `products` (matches the frontend sidebar and `use_cases.md`), with its SQL querying the real
  `dbo.articles` table underneath, same pattern as `saleBills.repository.js`. No renaming needed;
  noted in `milestone6.md`'s Module 6.1.
- **Pending:** `sale-bills:list`, `sale-bills:get`, update, post/unpost, and Module 2.2 (Sale
  Return) are not started. No live SQL Server yet — everything here is logic-verified, not
  DB-verified.

### 2026-07-30 — Module 2.1: draftSaleBills (create/list/get/remove/confirm) + shared posting logic
- **What:** Implemented the second `milestone2.md` checklist item (schema §5.6.1). New:
  `draftSaleBills.repository.js` (own `getVariantPackings`/`insertStockMovements` copies, plus
  `insertDraft`/`insertDraftItems`/`findById`/`list`/`deleteDraft`), `draftSaleBills.service.js`
  (`create` — deducts stock via a negative `ADJUSTMENT` movement on save; `remove` — restores via a
  positive one, never deleting the original per the schema's reverse-never-erase pattern; `confirm`
  — per the user's actual workflow (draft now, finish and confirm later that same session), this
  behaves as **create + post in one step**, not a separate later post), `draftSaleBills.ipc.js`
  (`draft-sale-bills:create/list/get/remove/confirm`). Extracted shared pairs/discount/totals math
  and item/header validation out of `saleBills.service.js` into a new `saleBillMath.js` (both
  features need the identical formula). Added minimal `chartAccounts.repository.js` (`findByCode`)
  and `customers.repository.js`/`service.js` (`findById`/`getById`) — just enough for posting to
  resolve the `SALES` account and a customer's `ba_id`, full CRUD for both is Milestone 7/8. Added
  `src/constants/reservedAccounts.js` (shared codes between `seeds/run.js` and posting logic).
  `saleBills.service.js` gained `postLedgerAndStock`/`insertConfirmed`/`getById` exports so
  `draftSaleBills.confirm()` reuses the exact same posting path a normal bill uses.
- **How:** Confirming a draft first inserts a *positive* reversing `ADJUSTMENT` stock movement
  (canceling the draft's original deduction), then inserts the real `sale_bills` row with
  `status = 'CONFIRMED'` directly, then runs the normal post (ledger entries + negative `SALE`
  stock movement), then deletes the draft — net stock effect over the full lifecycle is exactly one
  deduction, same as a bill that was never a draft. Verified this arithmetic directly with stubbed
  `node -e` tests tracing every stock-movement row's sign and source. A separate subagent debug
  review (briefed from `.claude/agents/debugger.md`) found one real bug: `confirm()` checked
  `bill_no`/`gp_no`/`bilty_no`/`adda_id` but not the schema's `CK_sale_bills_custdlv` rule
  (`sub_customer_id` required unless `delivery_type = 'SAME'`) — `draft_sale_bills` has no such
  constraint so a draft could reach `confirm()` in a state the real `sale_bills` table would reject,
  surfacing as an opaque `INTERNAL` error. Fixed by extracting `validateDeliveryCustomer()` into
  `saleBillMath.js` and calling it from both `saleBills.service.js` and `draftSaleBills.confirm()`.
  A second, lower-severity finding (inconsistent `Error` vs `ApiError` for the "SALES account
  missing" case) was deliberately left as-is: that case is a setup/seed problem, not a normal-user
  error, and `wrap.js` only `console.error`s non-`ApiError` throws — converting it would have
  silenced a real misconfiguration instead of surfacing it. Verified the fix with three cases
  (`SAME` delivery, `CUSTOM` with no sub-customer, `CUSTOM` with one) — all behave correctly.
- **Files:** `backend/src/repositories/draftSaleBills.repository.js`,
  `backend/src/services/draftSaleBills.service.js`, `backend/src/ipc/draftSaleBills.ipc.js`,
  `backend/src/services/saleBillMath.js` (new), `backend/src/services/saleBills.service.js`,
  `backend/src/repositories/saleBills.repository.js`, `backend/src/repositories/chartAccounts.repository.js` (new),
  `backend/src/repositories/customers.repository.js`, `backend/src/services/customers.service.js`,
  `backend/src/constants/reservedAccounts.js` (new), `backend/src/db/seeds/run.js`,
  `backend/src/ipc/index.js`, `backend/electron/preload.js`

### 2026-07-30 — Second debug pass on wrap.js: unexpected errors weren't actually sanitized
- **What:** A follow-up review (run as a genuinely separate subagent this time, briefed with
  `.claude/agents/debugger.md`, not done inline) found that the previous `wrap.js` fix only *logged*
  non-`ApiError` failures — it didn't actually replace their `message`/`code` before returning. A
  raw `mssql`/Tedious driver error (e.g. connection failure) would still leak its real `.code`
  (`ESOCKET`, `ETIMEOUT`, `ELOGIN`, ...) and message (which can contain host/port/driver internals)
  straight to the renderer, contradicting the documented "sanitized to `INTERNAL`" contract.
- **How:** Restructured the `catch` block to branch explicitly: `ApiError` → pass through its real
  `message`/`code`; anything else → `console.error` the full error, then always return the fixed
  `{ message: 'Internal error', code: 'INTERNAL' }` pair, no fallback to `err.message`/`err.code`.
  Verified with a `node -e` harness simulating a real driver error shape (`ESOCKET` + a message
  containing an IP and port): confirmed it now returns the sanitized shape while still logging the
  real error to console.
- **Files:** `backend/src/ipc/wrap.js`
- **Also this session:** updated `.claude/settings.json` to add a `PostToolUse` hook (fires the
  debugger review after every `Write`/`Edit`, not just once at `Stop`) matching the pattern from
  another project, and pointed both hooks at reading `.claude/agents/debugger.md` fresh each run
  instead of a hardcoded paraphrase of it.

### 2026-07-30 — Debug pass on Module 1.3: wrap.js error-serialization bug
- **What:** Debugger-persona review (`.claude/agents/debugger.md`, run inline since the Stop hook's
  `agent`-type mechanism means acting as that persona directly on the diff, not invoking a separate
  subagent) of the Module 1.3 auth code found two real bugs, both in `src/ipc/wrap.js`, not in the
  auth logic itself: (1) `wrap.js` was throwing a `new Error()` with `.code` attached back across
  `ipcMain.handle` — but Electron only preserves a thrown error's `.message` crossing into the
  renderer's rejected promise, silently dropping custom properties, so every `ApiError`'s `.code`
  (`UNAUTHORIZED`, `USERNAME_TAKEN`, etc.) was being lost in transit, contradicting the documented
  `{ message, code }` contract. (2) unexpected non-`ApiError` failures (real bugs, not business
  errors) were sanitized to `code: 'INTERNAL'` with no logging anywhere, making them undebuggable.
- **How:** Rewrote `wrap.js` to **resolve always** instead of throwing — `{ ok: true, data }` on
  success, `{ ok: false, error: { message, code } }` on failure — which sidesteps Electron's
  property-stripping entirely rather than working around it, and added `console.error(err)` for any
  caught error that isn't an `ApiError` instance. Verified both paths directly (a plain `node -e`
  harness calling `wrap()` with a success case, a thrown `ApiError.unauthorized`, and a thrown
  `TypeError`): the `ApiError` case now correctly surfaces `code: 'UNAUTHORIZED'`, and the
  `TypeError` case printed to console before resolving as `code: 'INTERNAL'`.
- **Files:** `backend/src/ipc/wrap.js`, `backend/CLAUDE.md`, `backend/plan.md`,
  `backend/src/ipc/README.md`, `backend/src/errors/README.md`
- **Note for Milestone 9:** `frontend/src/lib/api.ts` must check `.ok` on every `window.api.x.y()`
  call — it never rejects/throws anymore, it always resolves.

### 2026-07-30 — Transport switch: Express/HTTP → Electron IPC
- **What:** Client wants a real desktop app, not something reachable like a local website, so the
  renderer↔backend transport changed from Express REST-over-localhost to Electron IPC — no HTTP
  server, no port, no JWT/bearer token. Removed `src/app.js`, `src/server.js`, `src/routes/`,
  `src/controllers/`, `src/middleware/{auth,errorHandler}.js`, and the dead `controlAccounts`
  feature (already gone from schema v4.3). Added `src/ipc/` (one `<feature>.ipc.js` per feature,
  replacing `routes.js`+`controller.js`; `index.js` central registrar; `session.js` — in-memory
  `{ userId, username, role }`, `requireSession()`/`requireRole()`; `wrap.js` — normalizes thrown
  `ApiError`s into a plain `{ message, code }`). `electron/main.js` now registers IPC handlers
  before opening the window; `electron/preload.js` exposes `window.api.<feature>.<action>(payload)`
  via a generic `Proxy`-based `contextBridge`, not just an API base URL. `package.json` dropped
  `express`/`cors`/`jsonwebtoken`; `config/index.js` dropped `port`/`jwtSecret`/`jwtExpiry` (DB
  connection only); `.env`/`.env.example` trimmed to just the `DB_*` vars.
- **How:** Renderer and backend logic share one OS process tree in this architecture, so there's no
  network boundary to protect with a token — "logged in" is just state held in `session.js`, same
  idea as the old JWT middleware but without a token to verify. `ipc/<feature>.ipc.js` collapses
  `routes`+`controllers` into one file since there's no URL routing or req/res object to separate.
  Milestone docs (`milestone1.md`, `milestone5–9.md`, `README.md`) converted from HTTP-shorthand
  endpoints (`GET /api/x`) to IPC channel names (`x:list`) via a documented mechanical mapping, so
  existing task detail didn't need a line-by-line rewrite.
- **Files:** `backend/package.json`, `backend/electron/{main.js,preload.js,README.md}`,
  `backend/src/ipc/**`, `backend/src/config/{index.js,README.md}`, `backend/src/middleware/{validate.js,README.md}`,
  `backend/src/{README.md,errors/README.md,services/README.md,repositories/README.md}`,
  `backend/.env`, `backend/.env.example`, `backend/CLAUDE.md`, `backend/plan.md`,
  `backend/milestones/{milestone1,milestone5,milestone7,milestone8,milestone9,README}.md`
- **Pending:** Module 1.3 (Auth) itself is still TODO stubs — `auth:login`/`logout`/`update-credentials`
  not yet implemented.

## Milestone 1 — Foundation & Auth

### 2026-07-30 — Module 1.3: Auth over IPC (login/logout/update-credentials)
- **What:** Implemented `auth.repository.js` (`findByUsername`, `findById`, `usernameTaken`,
  `updateCredentials`), `auth.service.js` (`login` — bcrypt compare, returns `{user_id, username,
  role}`; `updateCredentials` — verifies `currentPassword`, allows changing username and/or
  password together, checks the new username isn't taken via `UQ_users_name` before writing, hashes
  a new password with bcrypt if provided), and `auth.ipc.js` (`auth:login` calls the service then
  `session.login(user)`; `auth:logout` calls `session.logout()`; `auth:update-credentials` calls
  `session.requireSession()` first, then the service).
- **How:** Kept `auth.service.js` free of any IPC/session import — it just verifies credentials and
  returns data, so it stays testable without Electron; `session.login()`/`session.requireSession()`
  are only ever called from the `ipc` layer, matching the layering rule in `CLAUDE.md`.
- **Files:** `backend/src/repositories/auth.repository.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/milestones/milestone1.md`
- **Pending:** end-to-end verification blocked on `npm install` (package.json's `mssql` swap isn't
  installed yet) and a live SQL Server instance to seed against.

### 2026-07-11 — Backend scaffolding & planning docs
- **What:** Rewrote `System_architecture/database_schema.md` (v3: 21 relations, enums, ledger +
  stock-movement design, full DDL). Created milestones 1–5, CLAUDE.md, this file, layered-modular
  folder structure with minimal boilerplate (Express skeleton, pg pool, config, migration runner
  placeholders), and `.claude/settings.json` wiring the pre-edit-approval and debugger hooks.
- **How:** Schema gaps (users, expenses, stock, ledger) closed per use cases UC-01…UC-20; posting
  semantics documented in the schema doc's Design Decisions.
- **Files:** `System_architecture/database_schema.md`, `backend/*`

### 2026-07-11 — Layer stubs in every module + errors folder
- **What:** Added `routes.js / controller.js / service.js / repository.js` stubs to all 16 modules;
  split `accounts` into `groups / controls / chart / business` submodules with an aggregating
  `accounts/routes.js`; added `src/errors/ApiError.js` (used by services + errorHandler).
- **How:** Each stub encodes its layer's rule (controllers: no SQL/logic; repositories: parameterized
  SQL only; services: ApiError + withTransaction). All files pass `node --check`.
- **Files:** `backend/src/{routes,controllers,services,repositories}/**`, `backend/src/errors/ApiError.js`

### 2026-07-11 — Schema v3.1 for updated use cases (UC-08 production, UC-21 addas)
- **What:** Use cases v2.1 changed UC-08 to "Manage Stock & Production Logs" and added UC-21
  (Transport Addas with delete protection). Schema updated: `PRODUCTION` added to
  `stock_movement_type`; `stock_movements` gained `input_qty`, `input_unit` (CARTONS/PAIRS) and
  `packing` snapshot so PRODUCTION rows double as the production log; `vendors` gained
  `phone`/`city`; `products` gained `color` (matching new frontend types).
- **How:** No new table needed — production logs are PRODUCTION stock movements filtered by date.
  Adda delete protection comes from the existing FK (RESTRICT) + a 409 guard in the service
  (Milestone 2.3). Milestones 2/4/5 and routes README updated accordingly.
- **Files:** `System_architecture/database_schema.md`, `backend/src/db/migrations/001_init.sql`,
  `backend/milestones/milestone{2,4,5}.md`, `backend/src/routes/README.md`

### 2026-07-30 — Milestones restructured to follow frontend sidebar order
- **What:** Replaced milestones 1–5 (layer-first: Foundation, Setup CRUD, Accounts, Transactions,
  Reports) with milestones 1–9, where 2–8 follow the frontend sidebar's own screen order (Sale
  Bill → Sale Return → Purchase → Purchase Return → Receipts → Expenses → Current
  Stock/Reports/Search → System Setup → Accounts Hierarchy), 2–3 screens per milestone.
- **How:** All original task detail (posting rules, v4.3 notes, UC references) carried over
  unchanged — only the grouping/order changed. `Workers` (sidebar item with no schema/use-case
  entry) flagged as blocked in Milestone 7 rather than inventing fields for it.
- **Files:** `backend/milestones/milestone{1..9}.md`, `backend/milestones/README.md`,
  `backend/CLAUDE.md`, `backend/plan.md`

### 2026-07-30 — src/ scaffolding pass (later superseded — see next entry)
- **What:** Scaffolded controller/service/repository/routes stubs for every feature missing from
  the layered folder tree (regions, accountClasses, productColors, purchases, purchaseReturns,
  drafts, bankAccounts, cheques, alerts); removed stale `controlAccounts.*` (dropped in v4.3);
  fixed a stale Postgres-style (`$1, $2`) comment in repository file templates to describe `mssql`
  named params instead.
- **How:** Matched the existing TODO-stub style; `routes/index.js` remounted everything grouped by
  milestone. User reverted this specific pass afterward (kept the milestone doc updates) — the
  repo's real base state for Milestone 1 work is the original pre-scaffold stubs.
- **Files:** `backend/src/{controllers,services,repositories,routes}/**`

### 2026-07-30 — Module 1.1 & 1.2: engine switch to MS SQL Server
- **What:** Swapped the backend off Postgres (`pg`) onto MS SQL Server (`mssql`/Tedious), per
  `plan.md` Step 2. `package.json` dependency swap; `.env.example` + `config/index.js` rewritten
  around a `db` connection object (server/port/database/user/password/options) instead of
  `DATABASE_URL`; `pool.js` rewritten around `mssql.ConnectionPool` (`query()` + `withTransaction()`
  wrapping an `mssql` `Transaction`); `migrate.js` rewritten to apply T-SQL batches split on `GO`,
  tracked in `dbo.schema_migrations`; seed script (`src/db/seeds/run.js`) added — admin user,
  account classes/groups, reserved chart accounts (CUSTOMERS/VENDORS ACCOUNTS, CASH IN HAND, SALES,
  PURCHASES, COMMISSION ALLOWED, CHEQUES IN HAND, Payment Trail heads), default store, idempotent.
- **How:** Schema source of truth is `database/schema.sql` (repo root, T-SQL generated from
  `database_schema_v4.3.md`, 39 tables) — the user maintains this file directly, not a
  `src/db/migrations/001_init.sql` copy. `migrate.js` applies `database/schema.sql` first, then any
  later numbered files under `src/db/migrations/`, tracked by basename so both share one
  `schema_migrations` ledger. The old Postgres migration and its planned `001_init.sql` replacement
  were both removed, not archived, once `database/schema.sql` became the actual source of truth.
- **Files:** `backend/package.json`, `backend/.env.example`, `backend/.env`,
  `backend/src/config/{index.js,README.md}`, `backend/src/db/{pool.js,migrate.js,README.md}`,
  `backend/src/db/seeds/run.js`, `backend/src/db/migrations/README.md` (removed),
  `backend/CLAUDE.md`, `backend/milestones/milestone1.md`
- **Pending:** no SQL Server instance set up yet — migration/seed scripts are unverified end-to-end.

## Milestone 2 — Sale Bill & Sale Return

### Module 2.1 — Sale Bill (UC-18, UC-19)
- **What:** `saleBills`/`draftSaleBills` (ipc/service/repository) — create with items, server-side
  totals, list with weekly/monthly/overall/date-range + customer filters, get, update
  (UNPOSTED-only), post/unpost (ledger + stock, one transaction), and the confirm-as-create+post
  draft flow.
- **Files:** `backend/src/{ipc,services,repositories}/{saleBills,draftSaleBills}.*`,
  `backend/src/services/saleBillMath.js`
- **Verified:** stubbed-dependency review only — no live SQL Server yet.

### Module 2.2 — Sale Return (UC-21, UC-22)
- **What:** `saleReturns`/`draftSaleReturns` (ipc/service/repository) — mirror of Module 2.1, with
  the schema's reversed semantics: no `main_ac_id`/`delivery_type`/`delivery_address` (not columns
  on `sale_returns`); post debits SALES / credits customer BA with positive `SALE_RETURN` stock
  movements (reverse of sale bill posting); draft-save restores stock (positive `ADJUSTMENT`),
  draft-delete deducts it back out (negative `ADJUSTMENT`) — reverse of draft sale bills.
- **New cross-cutting requirement (password re-verification), final design:** the frontend's edit
  icon never unposts anything on open — it just opens the form on a still-`CONFIRMED` row. Only
  pressing Confirm/Save actually writes anything, so `update(id, payload)` itself now branches on
  the row's *existing* status: `DRAFT` → plain header/item replace, no ledger involved, no
  password. `CONFIRMED` → the same call also deletes the old `ledger_entries`/`stock_movements`
  rows and reposts fresh ones against the new totals, all inside one `withTransaction` — the
  unpost→edit→repost cycle collapsed into a single atomic step so `status` never visibly leaves
  `CONFIRMED`. The password is required only for that `CONFIRMED` branch: the ipc handler fetches
  the existing row via `service.getById` first, and calls `authService.verifyPassword` only if
  `status === 'CONFIRMED'`, before calling `service.update`. `post()` (the initial Confirm/Save on
  a still-DRAFT row) always requires the password. `unpost()` was reverted to a plain standalone
  action with no password guard — it's no longer part of the edit flow.
  Added `auth.service.js:verifyPassword(userId, password)` + `auth:verify-password` IPC channel
  (re-checks the session user's password without touching session state, distinct from login/
  updateCredentials) to back this. Scoped to Sale Bill/Sale Return for now; same pattern extends
  to Purchase/Receipts/Expenses when those milestones come up.
- **Files:** `backend/src/{ipc,services,repositories}/{saleReturns,draftSaleReturns}.*`,
  `backend/src/services/saleReturnMath.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`, `backend/src/ipc/index.js`, `backend/electron/preload.js`
- **Verified:** static review + `debugger` subagent pass, then live end-to-end against a real SQL
  Server (`wentox_db`, migrated + seeded): sale bill post → debit customer BA / credit SALES,
  negative `SALE` stock movement; sale return post → debit SALES / credit customer BA, positive
  `SALE_RETURN` stock movement (confirmed reverse of the bill); unpost removes ledger + stock rows
  on both; draft-return create restores stock (+12 pairs), delete deducts it back out (net 0);
  draft-return confirm reverses the restoration and posts exactly one `SALE_RETURN` movement,
  deletes the draft row; `authService.verifyPassword` rejects a wrong password and accepts the
  right one. Re-verified again after the update()-redesign: editing a CONFIRMED bill (cartons 2→5)
  produced exactly 2 ledger rows and 1 stock row reflecting the new total, `status` stayed
  `CONFIRMED` throughout; editing a DRAFT bill produced 0 ledger rows, `status` stayed `DRAFT`.
- **Pending:** frontend wiring for the password prompt on save/confirm when editing a posted
  document.

## Milestone 3 — Purchase & Purchase Return
_Not started._

## Milestone 4 — Receipts (Jamma) & Expenses (Kharch)
_Not started._

## Milestone 5 — Current Stock, Reports & Search/Bilty-Adda Updation
_Not started._

## Milestone 6 — System Setup: Products, Categories, Vendors
_Not started._

## Milestone 7 — System Setup: Workers, Customers, Sub-Customers
_Not started._
- Removed `phone` column from `customers` and `sub_customers` in `database_schema_v4.3.md` and
  `database/schema.sql` (schema.sql not yet applied, edited directly rather than via migration).
  Dropped `phone` param/column from `customers.repository.js` and `subCustomers.repository.js`
  insert/update queries. No service-layer or vendor changes — vendors keep `phone`.
- Implemented the non-blocking duplicate-name flow for customers and sub-customers (name-only key,
  case-insensitive — neither table carries phone). `create()` no longer rejects same-name ACTIVE
  rows at all (real people share names); it just creates. New `checkName(name)` service fn +
  `<feature>:checkName` IPC channel returns `{status:'none'|'active'|'inactive', matches:[...]}` —
  frontend is expected to call it before create() and show its own prompt, using `'inactive'`'s
  matches to offer per-row reactivate. New `reactivate(id)` fn + `<feature>:reactivate` channel
  flips a row back to active. Also dropped the stray `UQ_sub_customers_name UNIQUE(name)` DB
  constraint (customers never had one) — it would have hard-blocked legitimate same-name
  sub-customers regardless of the app-level check.
- Built (not wired) `frontend/src/components/DuplicateNamePromptModal.tsx` — reusable modal for the
  checkName() result: informational-only on an active match for customers/sub-customers-style
  entities (`allowCreateOnActive`), blocking-with-activate-option on an inactive match either way.
  Not yet imported into `CustomerSetupPage.tsx`/`SubCustomerSetupPage.tsx` or any save flow —
  scaffolding only, per explicit "don't connect it yet" instruction. Note: those pages currently
  run on the old in-memory `useReducer` demo state (`AppContext.tsx`), not real IPC calls to the
  backend at all yet — wiring this up for real also means switching those pages off demo data.

## Milestone 6 — System Setup: Products, Categories, Vendors
- Removed `address` column from `vendors` in `database_schema_v4.3.md` and `database/schema.sql`
  (edited directly, not yet applied). Dropped `address` param/column from
  `vendors.repository.js` insert/update queries. `vendors.phone` untouched.
- Added duplicate handling for `vendors.create()`/`update()` keyed on **name + phone together**
  (not name alone — corrected after review, since two real vendors can share a business name):
  case-insensitive name + NULL-safe exact phone match. Active match blocks (`DUPLICATE_NAME`),
  inactive match throws `INACTIVE_DUPLICATE` with the existing row's id/name/phone in a new
  `ApiError.details` field (threaded through `wrap.js`), and a new `vendors:reactivate`
  channel/service fn lets the frontend flip that row back to active instead of creating a
  duplicate. Also dropped the stray `UNIQUE(name)` DB constraint on `vendors.name` in
  `database_schema_v4.3.md`/`database/schema.sql` — it would have silently blocked legitimate
  same-name vendors regardless of the app-level check. Reference implementation for the same
  pattern on regions/cities/stores/products/employees, and a variant (non-blocking active match,
  list-of-matches on inactive match) for customers/sub-customers — write-up in
  `System_architecture/soft_delete_and_duplicate_check.md`.

## Milestone 8 — System Setup: Cities & Accounts Hierarchy
_Stale note — this was true when first written; superseded by the entries near the top of this log
(backend and frontend both complete for all of 8.1/8.2/8.3, verified live)._

## Milestone 9 — Alerts, Frontend Integration & Electron
- Module 9.1 (Alerts) and most of 9.3 (Electron main/preload, dev script, update-check page) were
  already done in an earlier session but never reflected here — this entry had gone stale. Module
  9.2 (frontend wired to real `window.api` calls, off `AppContext` demo data) confirmed complete
  by explicit user confirmation this session — not independently re-verified line-by-line here.
- **New scope: live backup database.** A second SQL Server database, kept in sync via native
  `BACKUP DATABASE`/`RESTORE DATABASE` (not row-by-row dual writes — avoids `IDENTITY` id drift
  between the two DBs) rather than a live queryable mirror written to on every insert.
  `backend/src/services/backup.service.js` — `sync()`/`syncIfDirty()`, an in-flight-promise guard
  so a manual click during an auto-sync just awaits the same run. `pool.js#withTransaction()` now
  sets a dirty flag on commit; a 10-minute timer in `electron/main.js` calls `syncIfDirty()`,
  skipping the (expensive) BACKUP/RESTORE entirely when nothing changed. Failures are caught/
  logged, never block or roll back the main write. `backup:runNow`/`backup:status` IPC (admin-
  only) + a "Backup Database" card on `SettingsPage.tsx` (Backup Now button, last-sync display).
  Install-time: `build/installer.nsh` adds one custom NSIS page (main install path stays fixed,
  per explicit requirement) asking for the backup folder, writes it to
  `%APPDATA%\Wentox\backup-config.json`; `src/config/appConfig.js` reads it at runtime via
  `app.getPath('userData')` (`app.setName('Wentox')` added to `main.js` so that path resolves
  correctly — package.json's own `name` is the npm package `wentox-backend`, not this).
  electron-builder config added to `package.json` (`build` block, NSIS target, `extraResources`
  copying `frontend/dist` in since the packaged app can't rely on the monorepo's relative
  `../../frontend` layout) — new `npm run dist:win` script.
- **Not yet live-verified** — no SQL Server reachable in this sandbox, and `electron-builder --win`
  needs an actual Windows build to confirm the NSIS script and packaged app end-to-end. Next real
  step: run `npm run dist:win` on a Windows machine (or CI), install it, and confirm the backup
  page appears, the config file lands correctly, and Backup Now actually produces a synced
  `wentox_backup` database.
- **Files:** `backend/src/services/backup.service.js`, `backend/src/ipc/backup.ipc.js`,
  `backend/src/config/appConfig.js`, `backend/src/config/index.js`, `backend/src/db/pool.js`,
  `backend/src/ipc/index.js`, `backend/electron/main.js`, `backend/build/installer.nsh`,
  `backend/package.json`, `frontend/src/pages/SettingsPage.tsx`,
  `frontend/src/lib/ipcBridge.ts`, `frontend/src/types/electron-api.d.ts`

## Sale Bill — stock reserved at save, not at post
- **Behavior change (explicit user decision):** saving a sale bill (the existing "Save Bill"
  button — no separate "New Bill" button added, kept as one action) now deducts stock immediately,
  the same reserve-on-save model `draftSaleBills.service.js` already used, instead of waiting
  until `post()`. The ledger (`ledger_entries`) still only gets written at `post()`/`postAll()`,
  and only removed at `unpost()` — stock no longer moves on post/unpost at all, since it's already
  reserved from the moment the bill is saved and stays reserved for as long as the bill exists.
- `saleBills.service.js`: `create()` now inserts a negative ADJUSTMENT `stock_movements` row per
  item (via new `assertStockAvailable()`/`saleStockMovements()` helpers, mirroring
  `draftSaleBills.service.js`). `update()` unconditionally reconciles stock (release old lines,
  reserve new ones) via a new `assertStockAvailableForEdit()` that nets out the bill's own
  existing reservation before checking against `pairsOnHand()` — otherwise editing a bill's own
  quantities without changing the total would look like a false oversell. `post()`/`update()`'s
  posted branch now call a new ledger-only `writeLedger()` (split out of `postLedgerAndStock`,
  which stays intact for `draftSaleBills.confirm()` — that flow still writes ledger+stock together
  in one step). `unpost()` only deletes ledger entries now, never stock.
- `saleBills.repository.js`: `deleteLedgerAndStock()` split into `deleteLedgerEntries()` +
  `deleteStockMovements()`.
- No frontend changes needed — `SaleBillPage.tsx`'s existing "Save Bill" button (edit mode) and
  the "Post All" button already implement exactly this save-unposted-then-post-later flow; the
  stock timing was the only thing that needed to move.
- **Not yet live-verified** — no SQL Server reachable in this sandbox; run through create → edit
  quantities → Post All → unpost on a real DB to confirm stock lands correctly at each step.
- **Files:** `backend/src/services/saleBills.service.js`, `backend/src/repositories/saleBills.repository.js`

## Sale Bill — Pending Posting moved to a vertical sidebar, grouped by customer
- **UI change (explicit user request):** the "Pending Posting" panel moved out of the main
  content flow into a persistent left-side vertical rail (`SaleBillPage.tsx`), shown across all
  sub-tabs, not only the billing form. Bills are grouped by customer (click a customer to expand/
  collapse their bills) instead of one flat list. Clicking a bill loads it into the form via the
  existing password-gated edit path (`handleEditSpecificBill`, fetching the full row with
  `api.saleBills.get` since `listUnposted` only returns summary fields). Each bill row also has
  its own small "Post" button (`handlePostOneUnposted`) to post just that one without leaving the
  sidebar; "Post All" is unchanged.
- `listUnposted()` (`saleBills.repository.js`) now also selects `sb.customer_id` so bills can be
  grouped reliably instead of only by name string; `UnpostedBillRow` (`frontend/src/lib/api.ts`)
  gained the matching `customer_id` field.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/lib/api.ts`,
  `backend/src/repositories/saleBills.repository.js`

## Sale Bill — Pending Posting: corrected to leave the main card untouched, flat list
- **Follow-up correction (explicit user feedback):** the previous change had shrunk/shifted the
  main Sale Bill card to make room for the sidebar via flexbox, and grouped unposted bills by
  customer — both undone. The main card (`mx-auto`, `maxWidth: 1200`) is back to its original,
  unmodified layout. "Pending Posting" instead sits `position: absolute` in the unused left
  margin (`hidden xl:block absolute left-0 top-0 w-64`, inside a `relative` wrapper around the
  whole page body) so it never affects the card's own width or centering. Customer grouping
  removed — back to one flat list of every unposted bill (bill_no, customer name, date, value),
  each row still click-to-edit and carrying its own individual Post button; "Post All" unchanged.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill — Pending Posting: fixed overlap with the main card
- **Bug fix (user-reported, with screenshot):** the absolute-positioned left-margin placement from
  the prior entry overlapped the main card at normal window widths — it assumed more spare margin
  existed than actually did. Replaced with a real flex layout: the Pending Posting list is a flex
  sibling with a fixed `w-64` column (`hidden lg:block`, sticky), and the card's wrapper
  (`mx-auto`, `maxWidth: 1200`, unchanged otherwise) is `flex-1 min-w-0` so it centers within
  whatever space remains next to that column — guaranteed no overlap at any width, at the cost of
  the card recentering slightly left of full-page-center when the sidebar is showing.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill — Pending Posting: card left genuinely untouched
- **Follow-up correction (user-reported, with screenshot):** the flex-sibling fix removed the
  overlap but visibly narrowed/shifted the card (it centered within the remaining flex space
  instead of its original position). Replaced with: the Pending Posting list now lives INSIDE the
  same `mx-auto`/`maxWidth: 1200` wrapper as the card (that wrapper now also carries `relative`),
  positioned `absolute` and anchored via `right: calc(100% + 24px)` to that wrapper's own left
  edge — not to the viewport, not to a guessed margin. Being `absolute`, it's out of flow, so it
  cannot affect the card's width or position at all; wherever the card's real edge lands, the list
  sits just outside it. Shown only from the `2xl` breakpoint up (≥1536px viewport), since below
  that there generally isn't ~280px of real margin for it to land in without spilling past the
  window edge.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill — compacted form to fit one screen (no scroll to reach Save/Post)
- **UI request:** the form's vertical stack (toolbar → header fields → customer/delivery boxes →
  item table → remarks/calculations) ran well past typical window height, so posting a bill
  always required scrolling. Tightened spacing throughout `SaleBillPage.tsx` rather than removing
  any field:
  - Toolbar and card outer padding trimmed (`p-4`→`p-3`, `p-6 md:p-8`→`p-4 md:p-5`).
  - Header fields grid, Customer Information box, Delivery & Logistics box: `gap-4/6`→`gap-2/3`,
    `mb-6 pb-6`→`mb-3 pb-3`, box padding `p-4`→`p-3`.
  - Item table cell padding `p-3`→`p-2` throughout (header + body cells).
  - Remarks/Due Date/Calculations: was a tall stacked column (120px textarea + due date + helper
    line, `mt-6 pt-4` gap) next to a `min-h-[160px]` calculations box. Now Remarks and Payment Due
    Date sit side-by-side (2-col sub-grid) with a 2-row textarea (`minHeight: 52px`), shortened
    helper text, and the calculations box padding/line-gaps tightened — no `min-h` floor left, it
    sizes to content.
  - Banners (error/success/stock-limit) and the Drafts panel: padding/margins trimmed to match
    (`py-3`→`py-2.5`, `mb-4`→`mb-3`, etc.)
  - No fields removed or hidden — same data, tighter spacing.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Return — same form compaction as Sale Bill
- Applied the identical spacing tightening from the Sale Bill pass to `SaleReturnPage.tsx`'s main
  card: toolbar/drafts-panel/banner padding-margins, card outer padding (`p-6 md:p-8`→`p-4 md:p-5`),
  header fields grid, Customer Information / Dispatch Logistics box padding+gaps, item table cell
  padding (`p-3`→`p-2`), Add Item Row button margin, and the Remarks/Calculations row (textarea
  4 rows→2 rows with no forced growth, calculations box `min-h-[160px]` floor removed).
  Sale Return has no due-date field, so there was nothing to move under Remarks here — the rest of
  the compaction is otherwise a direct match.
- **Files:** `frontend/src/pages/SaleReturnPage.tsx`

## Sale Return — Saved Drafts moved to a left-side vertical list (same pattern as Sale Bill)
- **User request:** move the "Saved Drafts" panel the same way SaleBillPage's Pending Posting
  panel was moved — off the main flow, onto the left. Replaced the horizontal
  select+"Confirm Draft (Post)"+"Delete Selected Draft" bar with a flat vertical list, positioned
  identically to SaleBillPage's sidebar: `absolute`, anchored via `right: calc(100% + 24px)` to
  the card wrapper's own left edge (not the viewport), `hidden 2xl:block` so it only shows when
  there's realistically enough margin, living inside the same `mx-auto`/`maxWidth: 1200` wrapper
  (now also `relative`) so it can never affect the card's own width/position.
- Each row (bill_no, customer name, date) is click-to-load (`handleOpenDraftRow`) plus its own
  small Post (`handleConfirmDraftRow`) / Delete (`handleDeleteDraftRow`) buttons — self-contained
  per row instead of the old single-selection + two buttons acting on `selectedDraftId`. The old
  `handleConfirmDraft` (select-driven) was removed as dead code once nothing referenced it.
- **Files:** `frontend/src/pages/SaleReturnPage.tsx`

## Sale Bill / Sale Return — further compaction, icon action buttons, Sale Return Post All
1. **Further compaction (both pages):** an additional tightening pass on top of the earlier one —
   card outer padding `p-4 md:p-5`→`p-3 md:p-4`, toolbar `p-3 mb-3`→`p-2.5 mb-2`, header fields
   grid and Customer/Dispatch section outer grid `gap-3 mb-3 pb-3`→`gap-2 mb-2 pb-2`, the two info
   boxes `p-3`→`p-2.5` with tighter internal gaps, item table cell padding `p-2`→`p-1.5`
   throughout, Add Item Row margin `mb-3`→`mb-2`, Remarks/Calculations row `gap-3 mt-3 pt-3`→
   `gap-2 mt-2 pt-2`. Also caught `SaleReturnPage.tsx`'s item table wrapper, which still had the
   original `mb-6` — missed in the first compaction pass.
2. **Draft/pending-list row actions → icon buttons, horizontal:** replaced the text "Post"/"Del"
   buttons in both SaleBillPage's Pending Posting list and SaleReturnPage's Saved Drafts list with
   small icon-only buttons (`CheckCircle2` for post, `Trash2` for delete) laid out in a horizontal
   row (`flex flex-row gap-1`) instead of stacked/full-width text buttons.
3. **Sale Return: added a "Post All" button** for drafts. There's no backend batch-post endpoint
   for sale returns the way `saleBills.postAll()` exists for bills (a draft return already IS the
   unposted state — there's no separate "saved but unposted" return the way a saved bill is), so
   `handlePostAllDrafts` confirms every draft sequentially client-side through the same
   `draftSaleReturns.confirm()` a single row's Post button uses, sequential (not `Promise.all`)
   for the same one-failure-shouldn't-block-the-rest reasoning as `saleBills.postAll()`, reporting
   posted/failed counts the same way.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`

## Sale Return — fixed Transport Adda wrapping + wasted space beside Customer box
- **Bug fix:** "Delivery Agent (if any)" was `col-span-2` (full width), pushing Transport Adda
  onto its own third row instead of sitting beside Delivery Agent the way SaleBillPage pairs its
  Delivery field with Transport Adda. That extra row made the Dispatch Logistics box taller than
  the Customer Information box beside it in the same grid row — since grid items stretch to match
  by default, the shorter Customer box visibly had empty space below Customer Code. Removed the
  `col-span-2`, so Delivery Agent and Transport Adda now share row 1 (GP No./Bilty No. stay row
  2) — 2 rows total, matching Customer Information's height, no more empty space.
- **Files:** `frontend/src/pages/SaleReturnPage.tsx`

## Sale Bill — Delete button on a specific unposted bill (password-gated)
- **New capability:** the Pending Posting sidebar's row icons gained a Delete (trash icon) next
  to Post. Backend: `saleBills.service.js#remove()` — throws if the bill is posted (must unpost
  first, same restriction pattern used elsewhere), otherwise releases the stock `create()`
  reserved at save time (`deleteStockMovements`), deletes the items, then the bill row, all in one
  transaction. New repository `deleteBill()`. New IPC channel `sale-bills:remove` — password
  verified server-side (`authService.verifyPassword`) unconditionally before calling the service,
  same guard level as editing an already-posted bill, since deleting has no reverse-never-erase
  trail. Frontend: `api.saleBills.remove(id, password)`; the sidebar's Delete button reuses the
  existing `PasswordPromptModal` flow via a new `delete_unposted_bill` password-action branch — on
  success, refreshes the Pending Posting list and stock, and resets the form if the bill just
  deleted was the one open on screen.
- **Files:** `backend/src/services/saleBills.service.js`,
  `backend/src/repositories/saleBills.repository.js`, `backend/src/ipc/saleBills.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill / Sale Return — item table scrolls internally past 3 rows
- **UI request:** adding item rows was growing the card indefinitely (and re-triggering the
  scroll problem task 1 fixed). The item table wrapper is now `overflow-y-auto` with
  `maxHeight: 230px` (~header + 3 rows) instead of `overflow-visible` with no cap — the 4th row
  onward scrolls inside the table instead of growing the card. The header row (`<th>`s) is
  `sticky top-0` within that scroll box so column labels stay visible past row 3.
  `SearchableSelect`'s own dropdown already renders through a `position: fixed` React portal (not
  a descendant of the scroll box in the DOM), so it isn't clipped by the new `overflow-y: auto`
  even when opened on a row near the bottom edge — confirmed by reading its source before making
  this change, since clipping a dropdown menu would have been a real regression otherwise.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`

## Sale Bill / Sale Return — new item rows insert at the top, not the bottom
- **UI request:** "+ Add Item Row" (and its keyboard equivalent — Shift+Enter/Ctrl+Enter/'.'+Enter
  from the last field of any row) now prepends the new row instead of appending it, on both pages.
  Pairs with the recent 2-row scroll cap on the item table: the newest article is the one the user
  is about to type into, so it should be the one visible without scrolling down past everything
  already entered. The keyboard shortcut's focus target changed from `items.length` (old last
  index) to a fixed `0` (new row is always the top row now).
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`

## Purchase Page — Recorded Purchases moved to its own tab, Save button moved up, 10-row scroll cap
- **UI request:** three changes to `PurchasePage.tsx`, bringing it in line with the Sale Bill /
  Sale Return pattern:
  1. **Recorded Purchases → its own tab.** Was an always-rendered card below the live entry form
     (every purchase ever recorded, no filter, pushing the page well past one screen). Added a
     `tabBar` (New Purchase / Recorded Purchases) in `AppLayout`'s `headerAction` slot, matching
     SaleBillPage's tab switcher placement. The records tab has a From/To date-range filter
     (`recordsDateFrom`/`recordsDateTo`, either end optional — blank means unbounded) via a new
     `filteredPurchases` memo; clicking a row loads it and switches back to the entry tab in view
     mode, same as the other pages' record tabs.
  2. **Save/Update Purchase button moved up** into the toolbar row at the top of the form
     (alongside Edit/Post/Unpost/New Purchase), instead of sitting below the entire item table —
     matching SaleBillPage/SaleReturnPage, where the primary action doesn't require scrolling past
     the item table to reach. "Cancel Edit" moved with it; "Add Line Item" stayed where it was,
     next to the table.
  3. **Item table capped to ~10 rows**, `overflow-y-auto` + `maxHeight: 620px` with a `sticky`
     header, same pattern as the other pages' item tables (SaleBill/SaleReturn cap at ~2 rows;
     this one's taller since a purchase routinely lists more distinct materials than a sale bill
     lists articles). Purchase's own item fields are plain `<input>`/native `<select>` rather than
     `SearchableSelect`, so there's no dropdown-portal clipping concern here.
- **Files:** `frontend/src/pages/PurchasePage.tsx`

## Purchase Return Page — same treatment as PurchasePage
- Applied the identical set of changes made to `PurchasePage.tsx` to `PurchaseReturnPage.tsx`:
  1. Recorded Purchase Returns moved to its own tab (`tabBar` in `AppLayout`'s `headerAction`),
     off the always-rendered inline card. Date-range filter defaults to the last three months
     (`getThreeMonthsAgoDate()` to `getTodayDate()`) via a new `filteredReturns` memo, both ends
     editable/clearable. Clicking a row loads it and switches back to the entry tab.
  2. Save/Update Return button moved up into the top toolbar row (with Edit/Post/Unpost/New
     Return), instead of below the item table. "Cancel Edit" moved with it; "Add Line Item" stayed
     by the table.
  3. Item table capped to ~8 rows (`overflow-y-auto`, `maxHeight: 500px`) with a `sticky` header,
     same as PurchasePage. No unposted/Pending-Posting concept exists on this page (returns post/
     unpost individually, no batch), so nothing else needed moving.
- **Files:** `frontend/src/pages/PurchaseReturnPage.tsx`

## Receipts Page — Recorded Receipts now shows unposted only
- **UI request:** "Recorded Receipts" was mixing CONFIRMED (posted) and DRAFT (unposted) rows
  together. `sortedReceipts` now filters to `status !== 'CONFIRMED'` before sorting; the endorsed
  settlements appended into the same table (a separate `settlements` list, joined visually via the
  Type column) get the identical filter via a new `unpostedSettlements` memo. Empty-state check
  and copy updated to account for both lists together ("No unposted receipts."), and the section
  heading now reads "Recorded Receipts — Unposted".
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`

## Receipts Page — Enter-walk reaches Payment Mode; Endorse checkbox gets the Shift+Enter chord
- **Bug 1 — Enter-walk skipped Payment Mode entirely:** the Cash/Cheque/Online buttons were plain
  `button[type="button"]` with no `data-field-nav` — AppLayout's G-01 Enter-walk only recognizes
  `input`/`select`/`textarea`/`button[data-field-nav]`, so the group was invisible to it and Enter
  jumped straight from Remarks to the Endorse checkbox, skipping Payment Mode. Fixed with a
  roving-stop pattern: only the currently SELECTED button carries `data-field-nav` (`PAYMENT_MODES`/
  `PAYMENT_MODE_LABELS` + `paymentModeRefs`), so the group is exactly one stop, landing on whichever
  mode is active. Left/Right now cycles the selection and moves focus with it
  (`handlePaymentModeKeyDown`, `stopPropagation`'d so AppLayout's own Left/Right field-walk doesn't
  also fire), giving keyboard users a way to actually change the mode.
- **Bug 2 — Endorse checkbox's Enter behavior made explicit:** adopted the same
  Shift+Enter/Ctrl+Enter/'.'+Enter convention already used elsewhere (SaleBillPage/
  SaleReturnPage/PurchasePage's "add a row") — on the checkbox, that chord checks Endorse and
  focuses straight into the newly-revealed Pay To field (`handleEndorseCheckboxKeyDown`, new
  `endorseToWrapRef` + `focusFirstField`). Plain Enter is left completely untouched, so G-01's
  existing handler runs exactly as it already does everywhere else: walk to the next field, or —
  if the checkbox is the last field currently on screen — submit (save the receipt unposted).
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`

## Expenses Page — same Enter-walk fix as Receipts
- **Bug fix (mirrors ReceiptsPage):** Payment Mode here is a 4-way button toggle (Cash/Cheque
  Endorsed/Cheque Issued/Online), same plain `button[type="button"]` issue — invisible to
  AppLayout's G-01 Enter-walk (`input`/`select`/`textarea`/`button[data-field-nav]` only), so Enter
  skipped straight past it. Same roving-stop fix: only the selected button carries
  `data-field-nav` (`PAYMENT_MODES`/`PAYMENT_MODE_LABELS` + `paymentModeRefs`), Left/Right cycles
  the selection and moves focus with it (`handlePaymentModeKeyDown`, `stopPropagation`'d). Reused
  the existing `selectPaymentMode()` helper (already resets mode-dependent fields) rather than
  calling `setPaymentMode` directly.
  No Endorse-checkbox equivalent exists on this page — Cheque Endorsed is just one of the four
  button modes, already reachable once the roving-stop fix landed — so there was nothing else to
  change here.
- **Files:** `frontend/src/pages/ExpensesPage.tsx`

## Fixed: Enter on the last field did nothing on Receipts/Expenses/Journal Voucher/Transfer/
## User Management — submit button lookup didn't account for form="<id>" association
- **Root cause:** these pages put the primary action button in a toolbar row ABOVE the card,
  outside the `<form>` element, associated via the HTML `form="<id>"` attribute instead of being
  nested inside it. Both `AppLayout.tsx`'s G-01 Enter handler and `lib/fieldNav.ts`'s
  `focusNextField()` (used by SearchableSelect/add-row flows) found the submit button via
  `form.querySelector('button[type="submit"]')` — which only walks DOM descendants and has no
  concept of the `form` attribute association — so on every one of these pages, pressing Enter on
  the last field silently did nothing. Reported directly by the user on Receipts (the Endorse
  checkbox specifically, but the bug affects the whole form on all five pages equally, not
  anything specific to that field).
- **Fix:** new shared `findSubmitButton(form)` in `lib/fieldNav.ts` — scans
  `document.querySelectorAll('button[type="submit"]:not(:disabled)')` and filters by
  `btn.form === form`. `HTMLButtonElement.form` is the browser's own resolved association,
  correct for both a nested button and one linked via the attribute, so this works uniformly
  without the caller needing to know which shape a given page uses. Both `AppLayout.tsx`'s inline
  Enter-handler logic and `focusNextField()` now call it instead of duplicating (and
  independently getting wrong) the same `querySelector` lookup.
- **Files:** `frontend/src/lib/fieldNav.ts`, `frontend/src/components/AppLayout.tsx`

## Expenses Page — Recorded Expenses now shows unposted only
- **UI request (mirrors ReceiptsPage):** "Recorded Expenses" was mixing CONFIRMED (posted) and
  DRAFT (unposted) rows. `sortedExpenses` now filters to `status !== 'CONFIRMED'` before sorting.
  Empty-state copy updated ("No unposted expenses.") and the section heading now reads "Recorded
  Expenses — Unposted".
- **Files:** `frontend/src/pages/ExpensesPage.tsx`

## Journal Voucher — added Number field (matches legacy Journal Entry screen)
- **User request:** match the old system's Journal Entry screen's fields, scoped down after
  confirming with the user to just the missing field rather than rebuilding JV as a full
  multi-line general journal (the old screen's A/C Code/Debit/Credit grid across N accounts is a
  fundamentally different tool than today's simplified 2-leg "one account vs the fixed JOURNAL
  VOUCHER clearing account" design — that would need a new `journal_voucher_lines` table and
  balance-to-zero posting logic; user chose to keep the current model).
- Added `voucher_no NVARCHAR(30) NULL` via new migration `023_journal_vouchers_number.sql`
  (schema.sql is already-applied, per convention never edited directly). Optional, unvalidated,
  same treatment as `sale_bills.gp_no`/`bilty_no` — a manual office cross-reference number,
  distinct from `jv_id`.
  Threaded through `journalVouchers.repository.js` (insert/update), `journalVouchers.service.js`'s
  `buildFields()`, `JournalVoucherRow`/`JournalVoucherCreateInput` in `lib/api.ts`, and
  `JournalVoucherPage.tsx` (new `voucherNo` state, form field next to Date, list table column,
  included in the JV search filter).
- **Not yet live-verified** — no SQL Server reachable in this sandbox; run `npm run migrate` on a
  real DB to confirm the column lands and create/update/list round-trip it correctly.
- **Files:** `backend/src/db/migrations/023_journal_vouchers_number.sql`,
  `backend/src/repositories/journalVouchers.repository.js`,
  `backend/src/services/journalVouchers.service.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/JournalVoucherPage.tsx`

## Journal Voucher — removed Remarks field (Reason covers it)
- Removed the Remarks textarea and its `remarks` state from `JournalVoucherPage.tsx`'s entry form
  — Reason (required) is enough, per explicit user decision. Dropped from `handleNew`,
  `buildPayload` (no longer sent — the field stays optional server-side, so omitting it is a valid
  payload), `loadRow`, and the JV search filter; search placeholder updated to mention Number
  instead of remarks. Backend (`journal_vouchers.remarks` column, service/repository support)
  left untouched — harmless unused capability, no migration needed to remove a nullable column
  nothing writes to anymore.
- **Files:** `frontend/src/pages/JournalVoucherPage.tsx`

## Fixed: unposted Purchase/Sale Bill amounts leaking into Vendor/Sale reports
- **Bug reported by user:** an unposted purchase showed up in "the ledger" (specifically, its
  amount was already counted in the Vendor Report's Total Purchase, before Post ever wrote
  anything to `ledger_entries`). Audited every aggregation query in
  `reports.repository.js` for the same class of bug — reading straight from a document table
  (`sale_bills`/`sale_returns`/`purchases`/`purchase_returns`, none of which carry a stored status
  column; "posted" is derived from `ledger_entries` existing for the row) without gating on
  that — and found two:
  - `vendorReportRows()` (Vendor Report, UC-33): `total_purchase` (from `purchases`) and
    `total_return` (from `purchase_returns`) had NO posted-only filter, while every other bucket in
    the same query (expenses, cheque allocations, settlements, JVs) already correctly filtered to
    CONFIRMED/ACTIVE. Fixed by adding
    `EXISTS (SELECT 1 FROM ledger_entries WHERE source_type = 'PURCHASE'/'PURCHASE_RETURN' AND
    source_id = ...)` to both subqueries, same idiom already used in
    `purchases.repository.js#lastPurchasedRate`.
  - `saleAggregateByCustomer()` (Sale Analysis & Sale Report, UC-31/32): same bug, same fix —
    `total_sales` (`sale_bills`)/`total_returns` (`sale_returns`) now gated on the equivalent
    `SALE_BILL`/`SALE_RETURN` EXISTS check, matching how the receipts/settlements/JVs buckets in
    that same query already worked.
  - Everything else in the file checked clean: `ledgerRows`/`netBalance`/
    `businessAccountBalancesAsOf`/`chartAccountBalancesAsOf`/`chartAccountsWithActivity`/
    `cashBookRows` all read strictly from `ledger_entries` (inherently posted-only); `paymentTrailRows`/
    `cashBookNonCashRows`/`cashBookBankTransfers`/`cashBookChequeDeposits` already filter to
    CONFIRMED/ACTIVE. `productionLog`/`productLedger`/`vendorStock` read `stock_movements`/
    `vendor_stock_movements`, which fill at SAVE time by design (the reserve-on-save stock model
    covered earlier in this log) — not a bug, a different, already-agreed-on rule.
  - Also checked `alerts.repository.js` (already correctly EXISTS-gated) and `addas.repository.js`
    (a delete-reference COUNT, not a balance figure — doesn't need the filter).
  - Frontend (`VendorReportPage.tsx`, `SaleReportPage.tsx`, `SaleAnalysisPage.tsx`) only consumes
    these backend totals directly, no separate client-side aggregation — fixing the two queries
    fixes every screen that shows them.
- **Not yet live-verified** — no SQL Server reachable in this sandbox; create an unposted purchase
  and confirm it no longer moves the Vendor Report's Total Purchase/balance until actually Posted,
  same for an unposted Sale Bill against Sale Analysis/Sale Report.
- **Files:** `backend/src/repositories/reports.repository.js`

## Product Setup (multi-article "Add Article" batch) — Shift+Enter/'.'+Enter adds a new article row
- **UI request:** plain Enter on the last field of the batch already submits the whole "Add
  Article(s)" form via G-01 (correct, left untouched). Added the same
  Shift+Enter/Ctrl+Enter/'.'+Enter chord convention used on SaleBillPage/SaleReturnPage/
  PurchasePage's item rows: from the last field of ANY article row (not only the last one), it
  appends a new blank article at the end and focuses into it, instead of submitting/walking past.
- `ProductArticleForm.tsx` gained an optional `onLastFieldKeyDown` prop, wired onto its actual last
  field (the final cost-breakdown input) — omitted by the single-product edit form's usage, which
  has no "add another" concept. `ProductSetupPage.tsx` added `articleRowRefs` (one per row wrapper
  div, used with the existing `focusFirstField()` helper the same way SaleBillPage's
  `articleCellRefs` works) and `handleArticleLastFieldKeyDown`, passed to every row in the batch.
- **Files:** `frontend/src/components/ProductArticleForm.tsx`, `frontend/src/pages/ProductSetupPage.tsx`

## Fixed: Vendor purchase-history modal showed unposted purchases
- **Bug reported by user:** VendorSetupPage's per-vendor "purchase history" drill-down (click a
  vendor card → modal listing that vendor's purchases) showed unposted purchases alongside posted
  ones — a purchase that hasn't happened yet (no ledger effect) read as a real recorded one.
- Root cause: `purchases.repository.js#list()` was a plain `SELECT *`, never computing
  `is_posted` at all (only `get()`/`create()`/`update()`/`post()`/`unpost()` did, via a separate
  `isPosted()` query) — despite `PurchaseRow.is_posted` being a required, non-optional field in the
  frontend type, so every `list()` caller was silently getting `undefined` there. Added the same
  `EXISTS (SELECT 1 FROM ledger_entries WHERE source_type = 'PURCHASE' ...)` computed column used
  elsewhere, so `list()` now genuinely matches its own declared type.
  `VendorSetupPage.tsx#openPurchaseHistory` now filters to `p.is_posted` before displaying.
- **Files:** `backend/src/repositories/purchases.repository.js`, `frontend/src/pages/VendorSetupPage.tsx`

## Fixed (thorough pass): Recorded Purchases / Recorded Purchase Returns showed unposted rows
- **Same bug class as the VendorSetupPage fix, applied everywhere else it appeared.** Both
  `PurchasePage.tsx`'s "Recorded Purchases" tab and `PurchaseReturnPage.tsx`'s "Recorded Purchase
  Returns" tab were built on `purchases.repository.js`/`purchaseReturns.repository.js#list()`,
  which — same root cause as before — never computed `is_posted` (plain `SELECT *`), so there was
  nothing for the frontend to filter on even after the vendor-modal fix landed.
  - `purchaseReturns.repository.js#list()`: added the identical
    `EXISTS (SELECT 1 FROM ledger_entries WHERE source_type = 'PURCHASE_RETURN' ...)` computed
    `is_posted` column `purchases.repository.js#list()` already got in the previous fix.
  - `PurchasePage.tsx`'s `sortedPurchases` and `PurchaseReturnPage.tsx`'s `sortedReturns` (the
    memos feeding their respective "Recorded ..." tabs) now filter to `.is_posted` before sorting.
    An unposted purchase/return is still reachable exactly where it always was — the Pending
    Posting panel (Purchase) or the entry form directly (Return) — this only removes it from the
    posted-history list, same split already applied to Sale Bill/Sale Return/Receipts/Expenses.
- **Files:** `backend/src/repositories/purchaseReturns.repository.js`,
  `frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`

## MAJOR ARCHITECTURE CHANGE — Sale Bill: unposted documents now live in the draft table
- **User-approved plan:** "Save" no longer inserts an unposted row into `sale_bills` — it now
  inserts into `draft_sale_bills`, the same table that used to be reserved for genuinely
  incomplete entries. `sale_bills` now strictly NEVER holds an unposted document. "Post" moves the
  row draft → real (writes ledger, deletes the draft — this is what `draftSaleBills.confirm()`
  already did for incomplete drafts; it's now the ONLY posting path). "Unpost" is the new reverse:
  moves the row real → draft again (new `saleBills.service.js#unconfirm()`), rather than the old
  behavior of just clearing the bill's ledger entries and leaving it sitting in `sale_bills`.
  Scoped to **Sale Bill only** for this pass, per explicit user choice — Sale Return, Purchase,
  Purchase Return, Receipts, Expenses are UNCHANGED (still today's "real row, no ledger yet" model)
  and Journal Voucher has no draft table to move this pattern to yet.
- **Backend:**
  - `draftSaleBills.repository.js`: added `updateDraftHeader()`/`deleteDraftItems()` (editing a
    draft's header/items — previously only insert/find/delete existed).
  - `draftSaleBills.service.js`: added `update(draftId, payload)` — stock reconciled
    unconditionally (release old lines' reservation via a positive reversing ADJUSTMENT — never
    delete the original row, matching the reverse-never-erase pattern `remove()`/`confirm()`
    already use — then reserve the new lines), netting out the draft's own existing reservation
    before checking availability (mirrors `saleBills.service.js`'s own edit-reconciliation logic).
    Added `confirmAll(ids, userId)` — Post All for drafts, same `{posted, failed, attempted}`
    contract as `saleBills.service.js#postAll()`, sequential for the same live-stock-read reason.
  - `saleBills.service.js`: added `unconfirm(id)` — the reverse of `draftSaleBills.confirm()`.
    Deletes the bill's ledger entries, releases its `SALE_BILL` stock reservation, inserts a new
    `draft_sale_bills` row (+ items + a fresh `DRAFT_SALE_BILL` reservation) from the bill's own
    data, then deletes the real bill + its items. Requires `draftSaleBills.repository` directly
    (not its service) to avoid a circular require, since `draftSaleBills.service.js` already
    requires `saleBills.service.js` the other way for `confirm()`.
  - New IPC channels: `draft-sale-bills:update`, `draft-sale-bills:confirmAll`,
    `sale-bills:unconfirm`. `draft-sale-bills:remove` now requires a password (verified
    server-side) — deleting any saved-unposted bill is destructive with no undo trail, so it gets
    the same guard editing an already-posted bill does; this used to have no password since it was
    only ever a genuinely-incomplete entry before.
  - `sale-bills:create`/`:post`/`:unpost`/`:remove`/`:listUnposted`/`:postAll` and their service
    functions are left in place but are now DEAD CODE for the Sale Bill flow — nothing in the
    frontend calls them anymore. Not deleted, to keep the change reversible/lower-risk; a future
    cleanup pass could remove them once this is confirmed working end-to-end.
- **Frontend (`SaleBillPage.tsx`):** the old two-separate-concepts UI ("Saved Drafts" panel +
  select-a-draft dropdown, and "Pending Posting" sidebar reading real unposted rows) collapsed
  into ONE — the Pending Posting sidebar now reads `draftSaleBills.list()` directly, since there's
  no longer a meaningful distinction between "incomplete" and "complete but unposted." The old
  Saved Drafts panel/dropdown/Confirm/Delete buttons and `handleConfirmDraft` were removed
  entirely. `executeSave()` branches on a new `isEditingPostedBill` flag
  (`mode === 'edit' && currentBillIsPosted`): that one case still goes through
  `saleBills.update()` (an already-posted bill can still be edited in place, unaffected by this
  change); every other save — a brand-new bill, or editing a still-unposted one — goes through
  `draftSaleBills.create()`/`.update()`. Only editing an ALREADY-POSTED bill is password-gated now
  (opening/editing a draft from the sidebar needs no password, same as drafts always worked).
  `billId` now means either a `bill_id` or a `draft_id` depending on `currentBillIsPosted` — every
  handler that posts/unposts/deletes updates it to the new id space after a successful call, since
  posting/unposting genuinely changes which row (and which table) the document lives in.
- **Known gaps, explicitly flagged:**
  - **No SQL Server reachable in this sandbox — none of this has been live-verified.** Before
    trusting it: create a new bill (confirm it lands in `draft_sale_bills`, stock reserved), edit
    it as a draft, Post it (confirm it lands in `sale_bills` with ledger entries, draft gone),
    Unpost it (confirm it's back in `draft_sale_bills` under a new id, ledger gone), delete a
    draft (password prompt, stock released), and run Post All across a few drafts.
  - **Pre-existing data migration**: if a real deployment already has unposted rows sitting in
    `sale_bills` from before this change, they will NOT automatically move to `draft_sale_bills` —
    this only governs new saves going forward. A one-time migration script would be needed to
    backfill any such rows if this ships against a database that already has some.
- **Files:** `backend/src/repositories/draftSaleBills.repository.js`,
  `backend/src/services/draftSaleBills.service.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/draftSaleBills.ipc.js`, `backend/src/ipc/saleBills.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/SaleBillPage.tsx`
- **Live-verified by the user** after restarting the Electron app end-to-end (create → post →
  confirm — this was also the run that surfaced the `draft-sale-bills:confirmAll` "no handler"
  error, which turned out to be a stale running process, not a code bug; a full quit+restart of
  `npm start` fixed it since the main process needs to re-execute the new backend code).

## Draft/Real Table Architecture — Sale Return (rollout, module 2 of 6)

- Same "draft table until posted, real table only ever posted, unpost moves it back to draft"
  architecture as Sale Bill, applied to Sale Return.
- **Backend:**
  - `saleReturns.repository.js`: split the old combined `deleteLedgerAndStock` into
    `deleteLedgerEntries(transaction, returnId)` and `deleteReturn(transaction, returnId)` (kept
    the combined helper too, for backward compat with existing callers).
  - `draftSaleReturns.repository.js`: added `updateDraftHeader`, `deleteDraftItems` (against
    `dbo.draft_sale_return_items`).
  - `draftSaleReturns.service.js`: added `update(draftId, payload)` — stock reconciliation with
    signs flipped vs Sale Bill, since a return RESTORES stock rather than reserving it (so there's
    no oversell check needed: restoring stock can't drive it negative) — and `confirmAll(ids,
    userId)`.
  - `saleReturns.service.js`: added `unconfirm(id)`, mirroring `saleBills.service.js#unconfirm()`
    with signs flipped (releases a negative ADJUSTMENT on `SALE_RETURN`, restores a positive one
    on `DRAFT_SALE_RETURN`). Requires `draftSaleReturns.repository.js` directly, same
    circular-require avoidance as Sale Bill.
  - Confirmed Sale Return's `postLedgerAndStock` has no stock-availability check at that position
    (unlike Sale Bill's), so the deadlock bug fixed there does not apply here — no
    `pairsOnHandTx`-style fix was needed.
  - New IPC channels: `sale-returns:unconfirm`; `draft-sale-returns.ipc.js` rewritten with
    `create`/`list`/`get`/password-gated `remove`/`update`/`confirm`/`confirmAll`.
- **Frontend (`SaleReturnPage.tsx`):** same collapse-into-one-sidebar treatment as Sale Bill —
  `drafts` state now reads real `DraftSaleReturnRow[]`, `isEditingPostedReturn` flag branches
  `executeSave`, Post/Unpost/Delete rewired to the new draft-table-backed channels, "Post All" now
  calls the real `draftSaleReturns.confirmAll()` instead of a client-side sequential loop.
- Full project `npx tsc -b --force` confirmed clean after these changes.
- **Files:** `backend/src/repositories/saleReturns.repository.js`,
  `backend/src/repositories/draftSaleReturns.repository.js`,
  `backend/src/services/draftSaleReturns.service.js`, `backend/src/services/saleReturns.service.js`,
  `backend/src/ipc/draftSaleReturns.ipc.js`, `backend/src/ipc/saleReturns.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/SaleReturnPage.tsx`

## Draft/Real Table Architecture — Purchase (rollout, module 3 of 6)

- Same architecture applied to Purchase. Key simplification found here: a draft purchase has
  **zero stock effect** (nothing physically arrives before a purchase is recorded — the existing
  code already said so), and `purchases.service.js#update()` already unconditionally blocked
  editing a posted purchase in place (`POSTED_LOCK`) — so unlike Sale Bill/Return there's no
  `isEditingPosted` branching needed on the frontend: `mode === 'edit'` always means editing a
  draft now.
- **Backend:**
  - `purchases.repository.js`: added `deletePurchase(transaction, purchaseId)`.
  - `draftPurchases.repository.js`: added `updateDraftHeader`, `deleteDraftItems` (against
    `dbo.draft_purchase_items`).
  - `draftPurchases.service.js`: added `update(draftId, payload)` (simple — no stock
    reconciliation needed) and `confirmAll(ids, userId)`.
  - `purchases.service.js`: added `unconfirm(id)` — reverses via the existing
    `deleteLedgerAndStock` (removes both ledger entries and vendor_stock_movements in one call,
    since there's no reservation to hand off), rebuilds a draft from the purchase's own fields via
    `draftPurchasesRepository.insertDraft`/`insertDraftItems`, then deletes the real row. Requires
    `draftPurchasesRepository` directly, same circular-require avoidance as the other modules.
    Confirmed no deadlock risk (`purchases.service.js` has no `pairsOnHand` calls anywhere).
  - New IPC channel: `purchases:unconfirm`; `draftPurchases.ipc.js` rewritten with password-gated
    `remove`, new `update`, `confirmAll`.
  - All backend files syntax-checked clean via `node -c`.
- **Frontend (`PurchasePage.tsx`):** same collapse-into-one-sidebar treatment. `unpostedPurchases`
  now reads real `DraftPurchaseRow[]` via `draftPurchases.list()`; `handleSave` always uses
  `draftPurchases.create()`/`.update()`; `handlePost`/`handlePostAll` call
  `draftPurchases.confirm()`/`confirmAll()`; `handleUnpost` calls `purchases.unconfirm()`. Added
  `loadDraftIntoForm`, `handleOpenUnposted`, `handlePostOneUnposted`, and a password-gated delete
  flow (`handleDeleteUnposted` + `PasswordPromptModal`, mirroring the other modules' guard on
  deleting a saved-unposted document). The Pending Posting panel's row list is now interactive
  (click to open, inline Post/Delete icon buttons) and resolves the vendor name locally via
  `vendors.find(...)` since `DraftPurchaseRow` carries no `vendor_name` field.
- Full project `npx tsc -b --force` confirmed clean after these changes.
- **Files:** `backend/src/repositories/purchases.repository.js`,
  `backend/src/repositories/draftPurchases.repository.js`,
  `backend/src/services/draftPurchases.service.js`, `backend/src/services/purchases.service.js`,
  `backend/src/ipc/draftPurchases.ipc.js`, `backend/src/ipc/purchases.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/PurchasePage.tsx`
- **Not yet live-verified** — needs the same create→post→unpost→delete→Post-All run-through the
  user did for Sale Bill before trusting it.

## Draft/Real Table Architecture — Receipts & Expenses (rollout, modules 5 and 6)

Completes the rollout. The instruction was explicit: **relocate where an unposted row lives, change
no logic** — every cheque / online / endorsement / bounce / voucher rule behaves exactly as before.

- **Migration `024_draft_receipts_expenses_full_parity.sql`** — the draft tables were missing the
  columns needed to hold *any* unposted receipt/expense, which is the real reason these two modules
  had been created straight into the real table under a `status` column in the first place:
  - `draft_receipts.cheque_no / cheque_date / cheque_received_date` — a CHEQUE receipt could not be
    drafted before, because `cheques.receipt_id` is NOT NULL so the cheques row cannot exist until
    the receipt does. The draft now holds the cheque's details as plain columns and the real
    `dbo.cheques` row is still created at confirm time by the SAME
    `receipts.service#insertReceipt()` code as always — so the cheque is born PENDING at post time
    and every downstream deposit/endorse/bounce path sees precisely what it saw before.
  - `draft_receipts.voucher_id`, `draft_expenses.voucher_id` — receipts/expenses gained `voucher_id`
    in migration 022 but the draft tables did not, so a draft could not belong to the voucher it was
    entered on.
  - All added columns are nullable; nothing is dropped or rewritten, and no data migration runs.
- **Vouchers (RJ-03 / PN-01) — the significant structural piece.** A voucher's lines now live in two
  tables: posted ones in the real table, unposted ones in the draft table. `listLines()` UNIONs both
  halves into the single list the screen always rendered, so nothing upstream had to learn there are
  two tables:
  - `status` is *derived* from which side a row came from ('CONFIRMED' for real, 'DRAFT' for draft),
    so `deriveStatus()`'s UNPOSTED/PARTIAL/POSTED judgement is unchanged, as is the decision (from
    migration 022) not to store a voucher status at all.
  - each line carries exactly one of `receipt_id`/`draft_id` (resp. `expense_id`/`draft_id`), naming
    which table it is in and which id the per-line actions address.
  - the aggregate `list()` query now counts a UNION of both tables — counting only the posted half
    would report a fully-unposted voucher as having zero lines, which `deriveStatus` would then read
    as POSTED-of-zero rather than UNPOSTED.
  - voucher `post()` walks the draft lines through `draftX.confirm()`, `unpost()` walks the real
    lines through `X.unconfirm()`; the per-line-transaction isolation and the partial-success
    `{ posted, failed, attempted }` contract are untouched.
  - `update()` (header date) now syncs the draft half's line dates too; `remove()` deletes draft
    lines as well as real ones.
  - **Entry order is preserved across a post/unpost round-trip**: `confirm()`/`unconfirm()` carry
    `created_at` across, and `listLines` orders the two halves together by it. Without this a line
    would jump to the bottom of its voucher the moment it posted.
- **`receipts.service#unconfirm()` / `expenses.service#unconfirm()`** — the reverse of the matching
  `confirm()`. Every guard the existing `unpost()` applied still applies, unchanged and for the same
  reasons:
  - Receipts: a CHEQUE receipt whose cheque has moved past PENDING is still refused
    (`CHEQUE_IN_USE`). Because that guard *guarantees* the cheque is still PENDING (never deposited,
    endorsed or allocated), the cheques row can safely be dropped and its details carried back onto
    the draft — exactly what `remove()` already did for an unposted cheque receipt, and the precise
    reverse of what `confirm()` does on the way in.
  - Expenses: `CHEQUE_ENDORSED` is still refused outright (`USE_CHEQUE_REVERSAL` — its ledger effect
    belongs to a `cheque_allocations` row, and the only correct way to undo a disposition is the
    cheque's own bounce/return flow), and a `CHEQUE_ISSUED` cheque that already bounced/returned is
    still refused (`ISSUED_CHEQUE_TERMINAL`). **No endorsement logic was touched.**
  - `draftExpenses`' `pending_expense_id` stuck-confirm recovery is untouched, and the new
    `draftExpenses.update()` is blocked while it is set, for the same reason `remove()` already was.
- **Security guards moved with the create path.** UC-03 point 4 (`assertAccessible`) now also runs in
  `draftReceipts.create/update` and `draftExpenses.create/update`, because that is where a new
  receipt/expense is actually created now — leaving it only on the real table's `create()` would
  have silently dropped the check. `draft-receipts:remove` / `draft-expenses:remove` also gained the
  password guard that `receipts:remove` / `expenses:remove` already had, since they now hold every
  unposted document rather than a throwaway scratch entry.
- **Frontend (`ReceiptsPage.tsx`, `ExpensesPage.tsx`):**
  - voucher lines are saved via `draftX.create/update`; a new `entryIsDraft` flag says which id
    space the entry row's id is in.
  - the "Recorded Receipts"/"Recorded Expenses" tables were already unposted-only, and unposted rows
    now live in the draft tables — so they read `drafts` instead of filtering the real list (which,
    by the new invariant, would always filter down to empty). Clicking a row opens it for editing in
    place, and opens the voucher it belongs to, exactly as before.
  - the old "Saved Drafts / N incomplete cached" banner is now "Pending Posting / N unposted"; a
    loaded draft is edited **in place** rather than copied into a real row and the original deleted,
    so the duplicate-then-delete dance is gone.
  - `loadReceiptRow`/`loadExpenseRow` were removed as unreachable — their only caller was the
    unposted-only records list, which now goes through `loadDraft`.
- Full project `npx tsc -b --force` clean; all touched backend files pass `node -c` and the whole
  service graph loads without circular-require breakage.
- **Files:** `backend/src/db/migrations/024_draft_receipts_expenses_full_parity.sql`,
  `backend/src/repositories/{draftReceipts,receipts,receiptVouchers,draftExpenses,expenses,expenseVouchers}.repository.js`,
  `backend/src/services/{receipts,draftReceipts,receiptVouchers,expenses,draftExpenses,expenseVouchers}.service.js`,
  `backend/src/ipc/{receipts,draftReceipts,receiptVouchers,expenses,draftExpenses}.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/{ReceiptsPage,ExpensesPage}.tsx`
- **Run `npm run migrate` before starting the app** — migration 024 must be applied or every
  receipt/expense write will fail on the missing columns.
- **Live-verified against the real SQL Server** (`npm run migrate` applied 024 cleanly), with a
  23-case integration script exercising every module's full draft→post→unpost round-trip directly
  through the service layer. All 23 passed, including the priority checks:
  - Sale Bill / Sale Return / Purchase / Purchase Return: draft → confirm → unconfirm → confirmAll →
    unconfirm → delete, with direct SQL assertions that the real table has zero rows for a
    not-yet-posted id and the draft row is gone the instant it's posted.
  - Receipt CASH / ONLINE: full round-trip. Receipt CHEQUE: draft → confirm creates the cheques row
    PENDING → unconfirm while PENDING moves it cleanly back to draft with cheque_no/cheque_date
    intact → re-confirm → deposit → confirm unconfirm is refused (CHEQUE_IN_USE) → bounce it →
    confirm unconfirm is STILL refused (extends correctly to a terminal BOUNCED status, not just
    "disposed of somehow").
  - Expense CASH, CHEQUE_ISSUED (round-trip while PENDING), CHEQUE_ISSUED-then-bounced (unconfirm
    refused with ISSUED_CHEQUE_TERMINAL), CHEQUE_ENDORSED (unconfirm always refused with
    USE_CHEQUE_REVERSAL, confirming no endorsement logic changed).
  - Receipt Voucher and Expense Voucher: create a voucher, add two draft lines, confirm entry order
    is preserved, Post All, confirm both lines are CONFIRMED and STILL in original entry order
    (created_at carried across confirm), Unpost All, confirm both are back to DRAFT in the same
    order, delete the voucher.
  - All test rows (and the deliberately-left posted/bounced ones used to prove a guard) were
    cleaned up afterward via direct SQL in dependency order; a final sweep confirmed zero residue.
- **Pre-existing rows:** any receipt/expense already sitting in the real table with `status='DRAFT'`
  from before this change stays there — it is not migrated into the draft tables. Such a row will no
  longer appear in this screen's unposted list (which now reads the draft tables). The voucher grid
  still renders it, and the `line.draft_id == null` branches in the delete/edit paths were kept
  deliberately so it stays actionable. A one-time backfill script would be needed to move them.

## Draft/Real Table Architecture — rollout stopped at 4 modules (SUPERSEDED)

> Superseded by the section above — the user subsequently asked for Receipts and Expenses to be done
> too, with the constraint that no logic change. Kept for the reasoning it records.


- Investigated Receipts next and found it's not a blank slate like the first 4: it already has its
  own draft-table split (`draft_receipts` + `draftReceipts.service.js#confirm()`, built in an
  earlier session), but only for CASH/ONLINE — CHEQUE-mode receipts deliberately stay in the real
  `receipts` table under a `status='DRAFT'` column, since `draft_receipts` has no
  `cheque_no`/`cheque_date` columns to hold a draft cheque. Receipts also carries RJ-03
  voucher/settlement/endorsement logic layered on top of `status`, which none of the first 4
  modules had to account for. Expenses almost certainly mirrors this same shape
  (`draftExpenses.service.js` exists too, not yet inspected in detail).
  - Presented this to the user with three options (extend architecture to Receipts/Expenses same
    as the first 4, extend CASH/ONLINE-only via an `unconfirm`, or a full redesign covering
    CHEQUE/vouchers/settlements too) — user chose to **stop the rollout at 4 modules** and leave
    Receipts/Expenses on their existing DRAFT/CONFIRMED status design, since it already
    distinguishes posted from unposted (just via a column instead of a separate table) and
    touching the voucher/settlement/endorsement code paths carries materially more risk than the
    first 4 modules did.
- **Rollout scope as it now stands, final:** Sale Bill, Sale Return, Purchase, Purchase Return —
  all 4 on the full draft-table architecture (draft table until posted, real table strictly only
  posted, unpost moves the row back to draft). Receipts/Expenses intentionally excluded per the
  above.

## Draft/Real Table Architecture — Purchase Return (rollout, module 4 of 6)

- Same architecture as Purchase, applied to Purchase Return — the two modules already mirrored
  each other closely (draft purchase returns also have zero stock effect, and
  `purchaseReturns.service.js#update()` already unconditionally blocked editing a posted return in
  place), so no new design decisions were needed here.
- **Backend:**
  - `purchaseReturns.repository.js`: added `deleteReturn(transaction, returnId)`.
  - `draftPurchaseReturns.repository.js`: added `updateDraftHeader`, `deleteDraftItems` (against
    `dbo.draft_purchase_return_items`).
  - `draftPurchaseReturns.service.js`: added `update(draftId, payload)` (no stock reconciliation)
    and `confirmAll(ids, userId)`.
  - `purchaseReturns.service.js`: added `unconfirm(id)` — reverses via `deleteLedgerAndStock`,
    rebuilds a draft via `draftPurchaseReturnsRepository.insertDraft`/`insertDraftItems`, then
    deletes the real row via the new `deleteReturn`. Requires `draftPurchaseReturnsRepository`
    directly, same circular-require avoidance as the other modules.
  - New IPC channel: `purchase-returns:unconfirm`; `draftPurchaseReturns.ipc.js` rewritten with
    password-gated `remove`, new `update`, `confirmAll`.
  - All backend files syntax-checked clean via `node -c`.
- **Frontend (`PurchaseReturnPage.tsx`):** added the same Pending Posting panel as PurchasePage
  (this page previously had none at all — every return saved straight to the real table with no
  batching UI). `handleSave`/`handlePost`/`handleUnpost` rewired to the draft-table-backed
  channels; added `loadDraftIntoForm`, `handleOpenUnposted`, `handlePostOneUnposted`,
  `handlePostAll`, and a password-gated `handleDeleteUnposted` + `PasswordPromptModal`, all
  mirroring PurchasePage.tsx. The page's existing PR-01 features (copy-from-prior-purchase,
  last-purchased-rate lookup on blur) were preserved unchanged.
- Full project `npx tsc -b --force` confirmed clean after these changes.
- **Files:** `backend/src/repositories/purchaseReturns.repository.js`,
  `backend/src/repositories/draftPurchaseReturns.repository.js`,
  `backend/src/services/draftPurchaseReturns.service.js`,
  `backend/src/services/purchaseReturns.service.js`,
  `backend/src/ipc/draftPurchaseReturns.ipc.js`, `backend/src/ipc/purchaseReturns.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/PurchaseReturnPage.tsx`
- **Not yet live-verified** — needs the same create→post→unpost→delete→Post-All run-through the
  user did for Sale Bill before trusting it.
## Journal Voucher — full multi-line double-entry rebuild
- **User request:** the client's legacy "Journal Entry" screen reference pictures (`ref-pics/batch2/
  journal voucher.jpeg`, `jv2.0.jpeg`) confirmed it was never the simplified 2-leg tool the earlier
  entry above scoped down to — `jv2.0.jpeg` shows a live example with two different accounts each
  carrying their own debit/credit (`FINE SHOES - SADIQ ABAD` credited 5,300, `DISCOUNTS, CLAIMS, &
  COMMISSIONS` debited 5,300, Net Total 0). User explicitly chose the full rebuild this time: a real
  multi-line double-entry journal, no fixed counter-account, plan approved before coding per this
  file's workflow rule. Toolbar/visual design stays consistent with the rest of the app (no legacy
  icon/color replication) — user's explicit call. Per-line optional Narration added (distinct from
  the header's single Reason) — also user's explicit call this round, not a reversal of the earlier
  Remarks-removal decision above (that was header-level; this is per-line).
- **Migration `024_journal_voucher_lines.sql`:** new `dbo.journal_voucher_lines` (line_id, jv_id FK
  CASCADE, line_no, ba_id, debit, credit, narration), constraints mirroring `ledger_entries`
  (single-sided per line, non-negative, non-zero). Backfills every existing `journal_vouchers` row
  into two lines (the party leg + the old fixed JOURNAL VOUCHER account leg) before dropping the
  now-superseded `ba_id`/`direction`/`amount` header columns and their constraints — no historical
  data silently dropped. Guarded with an `IF NOT EXISTS`/`RAISERROR` on the reserved JOURNAL VOUCHER
  business account before the second backfill INSERT, so a missing seed fails loudly instead of
  silently backfilling an unbalanced single-leg row.
- **New `journalVouchers.math.js`** (mirrors `purchaseMath.js`): `buildLines`/`validateBalance`
  (≥2 lines, `SUM(debit) === SUM(credit)` compared in paisa to avoid float drift)/`buildTotals`.
- **`journalVouchers.repository.js`** rewritten: header CRUD no longer touches
  `ba_id/direction/amount`; added `insertLines`/`getLines`/`deleteLines` (update = delete-all-then-
  reinsert, same as `purchase_items`); `insertLedgerEntries` now loops one `ledger_entries` row per
  line instead of a fixed 2-row pair; `list()`/`findById()` roll up `line_count`/`total_debit`/
  `total_credit` per voucher via `CROSS APPLY` (always exactly one row per header, so it can't drop
  a voucher with zero lines — not reachable anyway since create/update always insert header+lines
  in one transaction). Removed `getJvAccount()`.
- **`journalVouchers.service.js`** rewritten: `resolveLines()` validates + checks
  `businessAccountsService.getById`/`assertAccessible` per line (not just one account); `post()`
  re-validates balance defensively before writing ledger entries; `create`/`update`/`post`/`unpost`
  all `withTransaction`. Removed the fixed-counter-account lookup entirely.
- **`journalVouchers.ipc.js`:** removed the `account` channel (no more fixed counter-account to
  look up for a "JV Ledger" screen).
- **`reports.repository.js`:** `customerReportRows`/`vendorReportRows`'s JV subqueries rewritten
  from `SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END)` grouped by
  `journal_vouchers.ba_id` to `SUM(jvl.credit - jvl.debit)` grouped by `journal_voucher_lines.ba_id`,
  joined back to `journal_vouchers` (aliased `h`) for the existing date/status `jvWhere` filter —
  same "what does this party's JVs net to" semantics, now correct across N lines instead of 1.
- **`frontend/src/lib/api.ts`:** `JournalVoucherRow`/`JournalVoucherCreateInput` replaced with
  `lines: JournalVoucherLineInput[]` (`ba_id, debit, credit, narration?`) instead of flat
  `ba_id/direction/amount`; `JournalVoucherRow.lines` is optional since `list()` only returns
  rolled-up totals, not per-line detail — `get()` is what carries the full lines array. Removed the
  `account()` wrapper.
- **`JournalVoucherPage.tsx`** rebuilt: dropped the Direction toggle, single `SearchableSelect`
  account field, and `AccountBalancePanel` single-account preview; added a line-items grid (account
  `SearchableSelect` + Debit + Credit + Narration per row, typing into one of Debit/Credit clears
  the other — single-sided per line, matching `ledger_entries`), a `+ Add Line` button, a per-row
  remove button (floor of 2 lines), and a Net Total footer (Total Debit/Total Credit/Difference,
  with an inline "out of balance by X" warning). Save is disabled until ≥2 lines, every line has an
  account and exactly one of debit/credit > 0, and totals balance to zero — mirrors the
  service-side rule. Removed the JV Ledger sub-tab entirely: it only ever showed the fixed JOURNAL
  VOUCHER account's ledger, which no longer exists as a forced counter-party — each line's ledger
  effect is visible on its own real account via the existing account Ledger screen. "Recorded
  Journal Vouchers" columns changed from Account/Direction/Amount (single-valued, no longer
  possible) to Lines (count) / Total. Row click now fetches the full voucher via `get()` to hydrate
  `lines`, since the listing query only carries rolled-up totals.
- **Debugger review pass:** ran a full read-through of every changed/new file plus a cross-codebase
  grep for lingering references to the old single-line shape — no functional bugs found. Two
  non-blocking hardening items were still worth doing and are folded into the changes above: the
  migration's `IF NOT EXISTS` guard, and a `?? 0` defensive fallback on `formatCurrency(v.total_debit)`
  in the listing table (unreachable today since a voucher always has ≥2 lines by the time it's
  listed, but cheap to guard).
- **Not yet live-verified** — no SQL Server reachable in this sandbox; `npm run migrate` on a real
  DB is needed to confirm the backfill and the new table land correctly, and the app needs a manual
  create → save-blocked-when-unbalanced → post → unpost → edit-lines pass.
- **Files:** `backend/src/db/migrations/024_journal_voucher_lines.sql` (new),
  `backend/src/services/journalVouchers.math.js` (new),
  `backend/src/repositories/journalVouchers.repository.js`,
  `backend/src/services/journalVouchers.service.js`, `backend/src/ipc/journalVouchers.ipc.js`,
  `backend/src/repositories/reports.repository.js`, `backend/src/services/businessAccounts.service.js`
  (comment only), `frontend/src/lib/api.ts`, `frontend/src/pages/JournalVoucherPage.tsx`

## Journal Voucher — compact single-screen layout (follow-up to the multi-line rebuild above)
- **User request:** the multi-line rebuild above matched the legacy grid's column layout, but not
  the broader compact-page redesign already applied to `PurchasePage.tsx`/`SaleBillPage.tsx` — a
  single-screen density (no scrolling the whole page to reach the line-item grid or the toolbar).
  User pointed this out directly after reviewing the first pass.
- Copied the exact pattern from `PurchasePage.tsx` (that page was read directly since its compact
  redesign was still uncommitted in the working tree, not yet on `origin/main` that this worktree
  branched from):
  - Toolbar (New/Save/Cancel Edit/Edit/Post/Unpost) is now a standalone compact row above the
    card — every button always renders, only `disabled` toggles per `mode`/`isPosted`/`isValid`,
    instead of whole groups mounting/unmounting.
  - The entry `<form>` IS the card, height pinned to `window.innerHeight - top - 32` (recomputed
    on resize and whenever the banners above it change), laid out `flex flex-col` so the
    line-items table (`flex-1 min-h-0 overflow-y-auto`, sticky `<thead>`) grows into whatever
    space is left — the outer app window never scrolls, only the grid does.
  - "Recorded Journal Vouchers" moved out of the entry page's inline flow into its own tab
    (`activeTab: 'entry' | 'records'`, same tab bar shape as Purchase/SaleBill's `headerAction`
    slot) instead of always rendering below the live entry form.
  - Dropped the descriptive `<p>` paragraph under the card header — the compact pattern doesn't
    carry one on Purchase/SaleBill either.
- `react-hooks/set-state-in-effect` fires on the accounts-load effect (`refresh()` called inside
  a mount `useEffect`) — pre-existing pattern, confirmed by running the same lint rule against
  `SaleBillPage.tsx`, which trips the identical warning. Not a regression, left as-is for
  consistency with the rest of the app.
- **Files:** `frontend/src/pages/JournalVoucherPage.tsx`

## Journal Voucher — pending-posting batch feature + JV Ledger search by any detail
- **User feedback after reviewing the compact layout:** (1) JV was missing the "enter a run of
  records first, post them all in one action" feature every other document type has (P-03 on
  Purchase, SB-06 on Sale Bill) — pointed out directly, not something this rebuild had considered.
  (2) The listing tab (renamed **JV Ledger** to match the actual feature name the user meant, not
  "Recorded Journal Vouchers") needs to find a JV "from any detail" — previously only matched
  `reason`/`voucher_no`.
- **`journalVouchers.repository.js`:** `list()`'s `search` filter now matches the header
  (`reason`/`voucher_no`) OR `EXISTS` against any line — joined `business_accounts` for
  name/code, plus per-line `narration`/`debit`/`credit` (cast to text for a `LIKE` match) — so a
  search box finds a JV regardless of which field the term actually landed in. New
  `listUnposted()`: every JV still `status = 'DRAFT'`, oldest first — reads straight off the
  status column (unlike `purchases.repository.js`'s version, which derives "unposted" from
  `ledger_entries` not existing, since purchases dropped their own status column and JV didn't).
- **`journalVouchers.service.js`:** new `listUnposted()` (passthrough) and `postAll(ids, userId,
  session)` — mirrors `purchases.service.js#postAll` exactly: each JV posts in its own
  transaction via the existing `post()`, so one failure never rolls back the ones that already
  posted; `ALREADY_POSTED` is swallowed as "met the user's intent," not reported as a failure.
- **`journalVouchers.ipc.js`:** added `journal-vouchers:listUnposted`/`journal-vouchers:postAll`
  channels, same shape as `purchases:listUnposted`/`purchases:postAll`.
- **Frontend:** `lib/api.ts` gained `UnpostedJournalVoucherRow`, `JournalVoucherListFilters.search`,
  and `journalVouchers.listUnposted()`/`postAll()`. `JournalVoucherPage.tsx` gained the same
  "Pending Posting" `<aside>` sidebar (2xl+ only, pinned outside the card's left edge) with a
  Post All button and a dismissible per-run result summary, copied from `PurchasePage.tsx`'s
  exact markup. The JV Ledger tab's search input is now debounced (250ms) and sent to the backend
  as `filters.search` instead of filtering the already-fetched page client-side — needed since the
  new search reaches into per-line data the listing query doesn't otherwise fetch to the client.
- **Files:** `backend/src/repositories/journalVouchers.repository.js`,
  `backend/src/services/journalVouchers.service.js`, `backend/src/ipc/journalVouchers.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/JournalVoucherPage.tsx`
