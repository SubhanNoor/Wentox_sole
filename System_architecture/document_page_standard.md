# Document Page Standard — Shared Rules for Every Voucher

> Status: **approved baseline** (2026-10-05). These are the rules, layout, workflow and control
> buttons the client confirmed as final on the Journal Voucher page, written so they apply to
> **every numbered document page** (Journal Voucher, Sale Bill, Sale Return, Purchase, Receipts, …).
>
> The **reference implementation** is the Journal Voucher page
> (`frontend/src/pages/JournalVoucherPage.tsx`). What only the JV does — its fields, sign rule,
> balance rule, ledger effect, data model — is in [`journal_voucher.md`](journal_voucher.md).
> Each document page has its own page file for its specifics; this file covers what they share.
>
> Words used here:
> - **Document** — one voucher/bill of any type (a JV, a sale bill, …).
> - **Header (Master)** — the one-per-document fields (date, number, remarks, party, …).
> - **Line (Detail)** — the many-per-document rows (account lines, item lines, …).
> - **Unposted / Posted** — the document's status (`DRAFT` / `CONFIRMED` on the JV).
>
> If a page deliberately differs from this standard, its own page file must say so and why.

---

## Contents

1. [Where a document page lives](#1-where-a-document-page-lives)
2. [Save vs post](#2-save-vs-post)
3. [Screen layout](#3-screen-layout)
4. [The entry strip](#4-the-entry-strip)
5. [The lines grid](#5-the-lines-grid)
6. [Master / Detail — the edit flow](#6-master--detail--the-edit-flow)
7. [Lock matrix — what is editable when](#7-lock-matrix--what-is-editable-when)
8. [Toolbar — every button](#8-toolbar--every-button)
9. [The New gate and the document Number](#9-the-new-gate-and-the-document-number)
10. [Browsing: Posted / Unposted, First / Pre. / Next / Last](#10-browsing-posted--unposted-first--pre--next--last)
11. [Opening the window](#11-opening-the-window)
12. [Find and the ledger/list tab](#12-find-and-the-ledgerlist-tab)
13. [Deleting](#13-deleting)
14. [Keyboard flow](#14-keyboard-flow)
15. [What survives a page switch or restart](#15-what-survives-a-page-switch-or-restart)
16. [Access control](#16-access-control)
17. [Agreed exceptions](#17-agreed-exceptions)
18. [History of decisions](#18-history-of-decisions)

---

## 1. Where a document page lives

| | |
|---|---|
| Menu | Under **2. DATA ENTRY** (`lib/menu.ts`) |
| Window | Opens in its **own window** (child window), with no Login-page flash |
| Tabs | An **entry tab** ("New <Document>") and a **ledger/list tab** listing every document of that type |
| Exit | Closes the document window and brings the main window forward; if opened inside the main window, goes Home |

## 2. Save vs post

**Saving and posting are separate steps with separate rules.**

- **Save** stores the document as **Unposted**. Only the minimum needed for a meaningful record
  is required (date, at least one line, each line well-formed). A half-finished document is a
  legitimate draft to come back to.
- **Post** applies the stricter rules the page needs (e.g. JV: debit = credit, ≥ 2 lines) and
  writes the document's ledger rows in **one transaction**, then marks it **Posted**.
- **Nothing reaches the ledger until Post.**
- **Un Post** deletes that document's ledger rows and returns it to Unposted, in one transaction.
  No reversing entry is written — the document simply leaves the ledger.
- **Posted documents are locked.** Edit, delete and new lines all need **Un Post** first. The
  server refuses with `POSTED_LOCK`.
- **Amounts are rounded to 2 decimals** on save.
- **Closed (deleted) accounts can't be picked.**
- **An empty document can't exist.** A saved document always has at least one line (see
  [§13](#13-deleting)).
- Only **posted** documents count in reports.

## 3. Screen layout

Top to bottom on the entry tab:

1. **Toolbar** — icon-over-label buttons, with the **Posted / Unposted** dropdown on the same row
   (with counts, e.g. `Unposted (3)`).
2. **Post All result banner** — only after Post All; stays until *Dismiss*.
3. **Master / Detail radios** — centred under the toolbar.
4. **Entry card**, filling the remaining window height:
   - **Header band** — the Master fields, compact; the **Number** box is read-only.
   - **Entry strip** — hidden in view mode (see [§4](#4-the-entry-strip)).
   - **Lines grid** — the **only part that scrolls**.
   - **Totals footer**.

Messages appear as **floating toasts** in the right-hand gutter, so they never push the toolbar
down mid-click. Success toasts fade after 3.5 s, errors after 5 s.

## 4. The entry strip

One editable line at a time (the "bound-record" pattern of the legacy screens), not one
editable row per grid line.

- **Committing a line** — press **Enter on the last field**, or click **Add Line**:
  - New line → appended to the grid; while editing an existing line the button reads
    **Update Line** and replaces that row in place.
  - The strip clears, the cursor returns to the first strip field, and the header is untouched.
  - The committed row gets the ▶ marker (see [§5](#5-the-lines-grid)).
  - A line only lives on screen until **Save / Done**. Committing a line does not save the
    document.
- **Account / item pickers** — type to filter, or press Enter / ↓ / ↑ (or click ▾) to open the
  search window. Picking moves to the next field.
- **Editing banner:** while a line is loaded for editing, a blue bar reads *"Editing an existing
  line — commit … to save, or cancel."* with a **Cancel** link that empties the strip without
  changing the row.

## 5. The lines grid

The last column is always **Actions** (Edit ✏ / Delete 🗑). Empty state: *"No lines added yet."*

**Three row states, always visually distinct** — they differ in **colour and** each carries a 4px
left bar:

| State | Look | Set by |
|---|---|---|
| **Loaded for editing** | blue background, blue left bar | Edit / Edit Row / the row's ✏ |
| **Selected** | gold tint, gold left bar | clicking the row |
| **Last entered** | ▶ in the gutter (never a background) | committing a line |

Rules:
- **Clicking a row only selects it** — it never loads it for editing. Clicking again clears the
  selection. It works **in every state**, even while another row is in the strip: editing row 1
  and clicking row 2 highlights row 2 (row 1 stays blue); pressing Edit then switches the edit to
  row 2.
- **The row's ✏** loads that line into the strip (unlocking the detail half — see [§6](#6-master--detail--the-edit-flow)).
- **The row's 🗑** removes that line (see [§13](#13-deleting)).
- Row buttons work **straight from view mode** — no need to press Edit first. They are disabled
  only on a **posted** document (tooltip: *"Unpost the voucher to change its lines"*).
- **▶ marker on delete:** deleting the marked row moves the marker to the row that takes its place
  (or the new last row); deleting a row above it shifts it up by one.
- The marked row scrolls into view automatically.

## 6. Master / Detail — the edit flow

The **Master / Detail radios only choose which half New and Edit act on.** They never unlock
anything by themselves.

- **Master** = the header.
- **Detail** = the entry strip and the grid.
- The radio **follows the user's clicks** — clicking or focusing inside the header moves it to
  Master, inside the strip/grid moves it to Detail. That only changes the target of New/Edit; it
  does **not** unlock that half.

**Only the Edit button (or New for adding a line) unlocks a half.**

On an open, **unposted** document:

| Action | Radio on **Master** | Radio on **Detail** |
|---|---|---|
| **New** | Starts a **whole new document** | **Adds a line** to this document — no Edit needed; the header stays locked |
| **Edit** | Unlocks the **header** only | Edits the **selected** line — same as Edit Row and the row's ✏ (needs a selected row: *"Click the line you want to edit first, then press Edit."*) |

Details:
- **New + Detail** works on any document on screen, **saved or not**. On an unsaved new document
  it simply clears the strip for the next line (both halves are already open); it never wipes
  the lines already typed.
- **New** on a **posted** document, or with nothing on screen, always starts a new document.
- **Edit, Edit Row and the row's ✏ are the same job** — all three are kept.
- **Edit stays live while already editing**, because pressing it is the only way to move the
  unlock from one half to the other.
- **Opening any document** (navigation, Find, the ledger tab, after Un Post) opens it
  **read-only** with nothing unlocked and the radio on Master.
- **Done** returns the document to read-only and clears the unlock. **Save** keeps editing.
- **Cancel** throws away unsaved changes, reloads the saved copy and returns to read-only.

## 7. Lock matrix — what is editable when

| Screen state | How you get there | Header | Entry strip | Grid row ✏ / 🗑 |
|---|---|:---:|:---:|:---:|
| **Blank, waiting for New** | Opened with nothing unposted, after Post, Post All or Delete | 🔒 | 🔒 | — (no lines) |
| **New document** | New pressed | ✏️ open | ✏️ open | ✏️ open |
| **Viewing an unposted document** | Opened, or Done | 🔒 | hidden | ✏️ open (unlocks Detail) |
| **Editing — Master** | Edit with Master selected | ✏️ open | 🔒 (shown, disabled) | ✏️ open (moves unlock to Detail) |
| **Editing — Detail** | Edit / Edit Row / ✏ / 🗑 / New+Detail | 🔒 | ✏️ open | ✏️ open |
| **Viewing a posted document** | Opened, Posted list | 🔒 | hidden | 🔒 |

## 8. Toolbar — every button

Order on screen: **New · Delete · Edit Row · Edit · Save · Done · Cancel | First · Pre. · Next ·
Last | Print · Find | Un Post · Post | Exit | Save+Post · Post All · PDF · Excel**, then the
**Posted/Unposted** dropdown.

| Button | What it does | Enabled when |
|---|---|---|
| **New** | Master: start a new document (and allow a Number). Detail + an unposted document on screen: add a line. | Always |
| **Delete** | Deletes the **whole document** and all its lines, after your password. One meaning only — single rows are deleted with the row's 🗑. | A saved document is open and it is **not posted** |
| **Edit Row** | Loads the **selected** row into the strip for editing | A row is selected and the document is not posted (also on an unsaved new document) |
| **Edit** | Master: unlock the header. Detail: edit the selected line. | A saved document is open and it is not posted |
| **Save** | Saves and **keeps editing** | Not in view mode, and the document passes the save rules |
| **Done** | Saves and **finishes** — back to read-only | Same as Save |
| **Cancel** | Drops unsaved edits, reloads the saved copy, read-only | While editing |
| **First / Last** | First / most recent document in the current list | The current list is not empty |
| **Pre. / Next** | Previous / next document in the current list (from a blank screen, goes to the first) | Not already at that end |
| **Print** | Prints the document (toolbar and controls are hidden on paper) | Viewing a saved document |
| **Find** | Opens the Find dialog (see [§12](#12-find-and-the-ledgerlist-tab)) | Always |
| **Un Post** | Removes the document from the ledger, back to Unposted, **read-only** | Viewing a **posted** document |
| **Post** | Posts to the ledger, then **always** clears to a blank document **keeping the same date**, cursor on New — also for a document opened from the list (2026-10-06) | Viewing a saved, unposted document that passes the **post rules** |
| **Exit** | Closes the window and focuses the main window (Home if not in its own window) | Always |
| **Save+Post** | Saves (as Done) then posts, in one click | Not in view mode, passes the save rules **and** the post rules |
| **Post All (n)** | Posts **every** unposted document, oldest first, each on its own; a failure never undoes the others. Shows "x of y posted · z failed" with the reasons. Then clears to a blank document keeping the date. | Not busy, dropdown on **Unposted**, and at least one unposted document exists |
| **PDF** | The print dialog — choose *Save as PDF* | Viewing a saved document |
| **Excel** | Exports the lines | Viewing a saved document |

- When Post / Save+Post is disabled by a post rule, its hover text says which rule.
- **Post is not available while editing.** Press **Done** first (or use **Save+Post**).

## 9. The New gate and the document Number

The client's "hard and fast rule" (2026-09-18), shared by every numbered document:

- **No Number is shown, and no document can be created, until New is deliberately clicked.** A
  blank form reached any other way (first open with nothing unposted, after Post, after Post All,
  after Delete, after the Unposted dropdown finds nothing) is **locked**, the Number box is
  **empty**, and the cursor waits on **New** so Enter starts the next document.
- The **"New <Document>" tab button** counts as a deliberate New too. It **always** starts a
  whole new document, whatever the radio says.
- Saving on the locked blank form is refused: *"Click New to start a voucher first."*

**The Number:**
- **Preview** (after New, before the first save): the highest number in use, including **deleted**
  numbers, + 1 — shown as `#N`. It is only a preview and is not reserved.
- **Real number**: assigned by the document type's database sequence at the **first save** (a
  draft gets its number immediately, before it is posted). It never changes afterwards.
- **Sequential and never reused.** A deleted document's number is logged in
  `deleted_document_numbers` (with its `doc_type`) and skipped forever.
- Sequences are `NO CACHE` so a SQL Server restart can't make numbers jump (the old "after 5
  comes 56" bug).
- The Number box is always read-only. The server ignores any number sent by the client.

## 10. Browsing: Posted / Unposted, First / Pre. / Next / Last

- The dropdown picks which list the four navigation buttons walk:
  - **Unposted** (default) — the working list: add, finish and post documents.
  - **Posted** — browse posted documents, e.g. to Un Post one.
- Both lists run **oldest → newest**, so First = oldest and Last = most recent. Each option
  shows its count.
- **The dropdown always follows the document on screen**: opening a posted document (by Find,
  the ledger tab, navigation) switches it to Posted; an unposted one or a blank form switches it
  to Unposted. Un Post moves it back to Unposted.
- **Picking Unposted** reloads the list, opens the **most recent** unposted document (or a blank
  locked form if there are none), and puts the cursor on New.
- **Picking Posted** reloads the list and opens the **most recent** posted document.
- A choice made while the page is still auto-opening is never overwritten by that auto-open.
- **New** stays enabled on the Posted view.
- **Deleted numbers are not browse stops** — First/Pre./Next/Last skip them (2026-10-06; six pages
  used to show a greyed-out "deleted" placeholder). The number itself stays retired (§9).

## 11. Opening the window

1. If there is **unsaved typing** from last time (lines or header of a new document, or a saved
   document that was being edited — even one whose lines were all deleted), it is restored
   exactly as left. Nothing is re-fetched over it.
2. Otherwise the page behaves as if **Unposted** was picked: it opens the **most recent
   unposted** document, or a blank locked form if there are none, with the cursor on New.
3. If there are no unposted documents and the screen was left on a **posted** one, it resets to
   the blank locked form.
4. The first header field (Date) takes focus whenever the entry tab becomes editable.

## 12. Find and the ledger/list tab

**Find** (toolbar):
- Searches **posted and unposted** documents (instant, up to 30 results).
- Each result shows `#Number`, a short description, date and a **posted / unposted** badge.
  Click one to open it read-only.
- Escape or *Close* dismisses it.

**Ledger/list tab:**
- Lists **every** document of the type, newest first, with its Status (*Posted* / *Not Posted*).
- **Search** runs on the server, 250 ms after typing stops, and finds a document "from any
  detail" — header fields and line contents.
- **Status filter**: All Statuses · Posted · Not Posted.
- Clicking a row opens that document on the entry tab, read-only.

## 13. Deleting

| What | How | Password | Allowed |
|---|---|:---:|---|
| **Whole document** | Toolbar **Delete** | ✅ (checked on the server) | Only **unposted** |
| **One line** of a document with 2+ lines | Row 🗑 | — | Only unposted. The line disappears on screen and the document goes into Detail edit; it is removed for good at the next **Save / Done** (Cancel brings it back) |
| **The last line** of a **saved** document | Row 🗑 | ✅ | A document can't be empty, so this deletes the **whole document**. The prompt says so: *"That was the voucher's last line — a voucher can't be empty, so deleting it removes the WHOLE voucher…"* |
| **The last line** of an **unsaved** new document | Row 🗑 | — | Just clears it locally |

- A posted document must be **Un Posted** before any delete.
- A deleted document's **Number is retired** and logged (never reused).
- Deleting the document on screen resets to the blank locked form.
- Deleting all lines one by one and closing the window does **not** bring them back on reopen;
  the emptied edit is kept as unsaved work.

## 14. Keyboard flow

- **Enter** moves to the next field (app-wide field walk). The strip's tab order is set per page
  and may differ from the visual order when the client asks for it.
- **Picker fields:** Enter opens the search seeded with what you typed; ↓ / ↑ open it blank.
  Picking moves to the next field.
- **Enter on the strip's last field commits the line**, clears the strip and returns to its first
  field.
- After **Post / Post All / Delete**, the cursor waits on **New**: Enter starts the next document
  and lands on Date.
- **Escape** closes the Find window (and any open dialog, topmost first).

## 15. What survives a page switch or restart

Stored per page (keyed by the page key) and restored exactly:

| Kept | Not kept |
|---|---|
| mode (new/edit/view), document id, Number, status | the selected row |
| Master/Detail radio, which half is unlocked | the row loaded for editing |
| all header fields, all lines | the ▶ marker |
| the entry strip's typed line | the active tab |
| whether New was clicked | the dropdown (it re-follows the document on screen) |

Saving, posting or resetting clears the stored draft.

## 16. Access control

- Every backend channel requires a logged-in session.
- **Delete** needs the current user's password, checked on the server.
- **Restricted accounts** (UC-03): a USER-role login can't save, post or unpost a document that
  touches an account restricted to administrators. The check runs at save **and again at post
  and unpost**, so a draft left by an admin can't be posted by a user.
- Accounts used by any document line count as having history, so they can't be hard-deleted.

## 17. Agreed exceptions

Deliberate differences from the rules above, each confirmed by the user.

| Page | Exception | Why |
|---|---|---|
| **Receipts, Payments** | **Each entry is saved to the server as it is added** (draft lines), instead of lines living on screen until Save. So Save and Done do the same thing, **Save+Post is off**, and a voucher being filled in stays in "new" mode rather than reaching view mode — which is why **Print / PDF / Excel stay enabled** whenever a voucher is on screen. Deleting an entry is immediate (password-gated) rather than "removed at the next Save". Everything else — row selection, Edit / Edit Row on the selected entry, New + Detail, Cancel, Un Post landing read-only, last-entry delete, numbering — follows the standard. | Per-entry saving is the RJ-03 design (a day's takings as one voucher); kept by the user 2026-10-06. |
| **Sale Bill** | A **posted** bill can still have its **bilty / adda** details edited (UC-07), opened through the Find & Update tab's Edit; saving asks for the password. | Bilty / adda arrive after posting. |
| **Receipts** | A standalone endorsement (settlement) is its own one-line document: Edit unlocks its fields directly. | It has no header/lines split. |

## 18. History of decisions

These were decided on the Journal Voucher page and are the shared standard.

| Date | Decision |
|---|---|
| 2026-08-26 | Entry strip (one line at a time); toolbar set copied from the reference picture; Post clears to a blank document; Date gets focus on open |
| 2026-08-30 | Posted / Unposted dropdown; Unposted is the default working list |
| 2026-08-31 | Master / Detail radios; toasts float instead of pushing the layout |
| 2026-09-03 | Pending Posting side panel removed; Post All result shown under the toolbar |
| 2026-09-04 | Radio follows the half being worked in; landing on the page opens the newest unposted document |
| 2026-09-07 | Navigation walks the Unposted list too |
| 2026-09-15 | **G-05** ▶ marker; row delete; posted documents can't enter edit |
| 2026-09-17 | Closed accounts can't be picked |
| 2026-09-18 | The New gate: no Number and no document without New; cursor waits on New. Sequences `NO CACHE` |
| 2026-09-20 | Toolbar standardised: Save vs Done, Cancel, Save+Post, Exit, PDF, Excel; per-row ✏/🗑 at the end of each row; toolbar Delete always means the whole document |
| 2026-09-24 | **The Master/Detail flow** ([§6](#6-master--detail--the-edit-flow)): New adds, Edit edits, only Edit unlocks a half; New+Detail never wipes typed lines; row click only selects (three distinct row states); save and post rules separated; Un Post lands read-only; emptied edits survive a reopen |
| 2026-09-26 | Deleting the last line of a saved document deletes the whole document, with a clear prompt |
| 2026-09-30 | New enabled on the Posted view; dropdown always follows the document on screen; a user's dropdown choice is never overwritten by the auto-open |
| 2026-10-05 | Exit closes the document window and brings the main window forward. **The flow is approved as final** |
| 2026-10-06 | **Rolled out to every document page** (Sale Bill, Sale Return, Purchase, Purchase Return, Receipts, Payments, Stock Voucher). User rulings: the Master/Detail flow replaces G-08 and the 2026-08-31 rules everywhere; Post always clears (SB-05/P-02 dropped); deleted numbers are no longer browse stops; Receipts/Payments/Stock Voucher numbers come from never-reused sequences (migration 042, reversing the 2026-09-07 reuse); Receipts/Payments keep per-entry saving (§17) |
