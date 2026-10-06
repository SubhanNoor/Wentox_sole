# Document Pages vs the Standard — Gap List

> Audit 2026-10-06, then **rolled out the same day**: every document page now follows
> [`document_page_standard.md`](document_page_standard.md), except the agreed exceptions in its
> §17. This page records what was different, what was done about it, and what is still open.
>
> Pages: **SB** Sale Bill · **SR** Sale Return · **PU** Purchase · **PR** Purchase Return ·
> **RC** Receipts · **EX** Payments (Expenses) · **SV** Stock Voucher · **JV** Journal Voucher.
> Not in scope: Wage Run, Salary Run, Transfer, Cheque — they don't use the shared document flow.

## User rulings (2026-10-06)

| Question | Ruling |
|---|---|
| RC/EX save each entry as it is added | **Keep** — recorded as an exception (standard §17) |
| RC/EX reuse a deleted newest number; SV has no real number | **Sequences everywhere** — RC/EX/SV numbers never reused (migration 042) |
| SB/SR/PU/PR/SV on the old G-08 / 2026-08-31 Master/Detail rules | **Port the JV's 2026-09-24 flow** |
| Deleted-number placeholders while browsing (six pages) | **Remove** — browsing skips deleted numbers, like the JV |
| Post keeps a document opened from the list on screen (SB-05/P-02) | **Always clear** after Post, keeping the date |

## What was done

| # | Rule | Was | Now |
|---|---|---|---|
| 1 | Exit closes the window | Only JV | All pages |
| 2 | New + Detail adds a line on a viewed or unsaved document | Only JV (others: only while already editing, and it wiped typed lines otherwise) | All pages |
| 3 | Edit stays live while editing | JV, RC, EX | All pages |
| 4 | Edit + Detail edits the selected row | Only JV | All pages |
| 5 | Edit Row edits the selected row, from view mode too | JV, SV (RC/EX: "last entry touched") | All pages |
| 6 | A row click selects in every state | Only JV | All pages |
| 7 | Three row looks (blue editing / gold selected / ▶) with a 4px bar | Only JV | All pages |
| 8 | Row ✏/🗑 work from view mode and unlock Detail | JV, RC, EX | All pages |
| 9 | Row 🗑 in view mode puts the document into edit | **Bug** on SB/SR/SV: row vanished but couldn't be saved | Fixed |
| 10 | Deleting the last line deletes the whole document | Only JV | All pages |
| 11 | ▶ moves to the next row when its row is deleted | Only JV | All pages |
| 12 | Cancel reloads the saved copy | JV, SV; **PU/PR Cancel reloaded from the posted table with a draft id** (wrong record or error); SB/SR didn't reload | All pages reload the saved copy, read-only |
| 13 | Save+Post | Missing on PU/PR | Added (RC/EX: off by exception) |
| 14 | Save twice on a new document | **Bug** on JV and SV: made a duplicate document | Fixed (keyed on the id) |
| 15 | First/Last enabled whenever the list isn't empty | RC/EX greyed out at the ends | Fixed |
| 17 | Numbers from a never-reused sequence | RC/EX reused; SV showed its internal id, deletes not logged | Migration 042: RC/EX/SV sequences, SV `voucher_no` (backfilled with the id it always showed), SV deletes logged |
| 18 | Emptied edit survives a reopen | Only JV | All line-grid pages (RC/EX save per entry, n/a) |
| 20 | Deleted-number placeholders | Six pages | Removed (`DeletedDocumentOverlay` deleted) |
| — | Post always clears, keeping the date | SB/SR/PU kept an opened document; PR never cleared | All pages clear |
| — | Un Post lands read-only | JV only (others dropped into edit) | All pages |
| — | Sale Return auto-opens the newest draft | **Bug**: never auto-opened in a shop with no transport addas | Fixed |

## Tests

- `backend/e2e/masterDetail.e2e.js` (new) — the Master/Detail flow on the real screen, on SB, SR,
  PU, PR, SV: read-only open, select vs edit, Edit / Edit Row / Cancel, row delete from view mode,
  New + Detail, Edit + Master, Exit closes the window.
- `backend/e2e/journalVoucher.saveTwice.e2e.js` (new) — Save, Save, Done leaves one voucher.
- `saleBill` / `purchaseReturn` browse tests updated for "Post always clears".
- All 15 real-screen tests, 25 backend tests and 17 frontend tests pass on `wentox_test`.

## Still open

- **JV (and every page): closed accounts are blocked on screen only** — the services don't reject
  a closed account.
- **Post / Un Post / Delete read the status outside their transaction** — two simultaneous Posts
  (two windows) could write the ledger rows twice. Unlikely in practice.
- **RC/EX** have no real-screen test of the selection / Edit Row / Cancel changes yet (their
  existing browse and endorsed-line tests pass).
- **Migration 042 has only run on `wentox_test`** (which has no receipt/payment vouchers). It must
  be run on a copy of real data before release.
