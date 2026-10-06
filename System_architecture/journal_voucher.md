# Journal Voucher (JV) — Page Reference

> Status: **approved baseline** (2026-10-05). The client confirmed the JV rules, design, workflow
> and control buttons as final.
>
> **The shared rules live in [`document_page_standard.md`](document_page_standard.md)** —
> toolbar, Master/Detail edit flow, lock matrix, New gate and Number, Posted/Unposted browsing,
> opening the window, deleting, keyboard flow, what survives a restart, access control. The JV is
> the reference implementation of that standard and follows it **with no exceptions**. This page
> covers only what is specific to the Journal Voucher.
>
> Source of truth for behaviour is the code. This document was written from:
> `frontend/src/pages/JournalVoucherPage.tsx`, `frontend/src/lib/journalVoucherMath.ts`,
> `backend/src/services/journalVouchers.service.js`, `backend/src/services/journalVouchers.math.js`,
> `backend/src/repositories/journalVouchers.repository.js`, `backend/src/ipc/journalVouchers.ipc.js`
> and migrations 016, 023, 024, 033, 034, 035. If the code and this page ever disagree, the code
> wins and this page must be corrected.

---

## Contents

1. [What a Journal Voucher is](#1-what-a-journal-voucher-is)
2. [Where it lives](#2-where-it-lives)
3. [Core concepts](#3-core-concepts)
4. [The sign rule (ACC-01)](#4-the-sign-rule-acc-01)
5. [Save and post rules](#5-save-and-post-rules)
6. [Ledger effect](#6-ledger-effect)
7. [Header band](#7-header-band)
8. [The entry strip](#8-the-entry-strip)
9. [The lines grid](#9-the-lines-grid)
10. [Totals footer](#10-totals-footer)
11. [JV specifics of the shared flow](#11-jv-specifics-of-the-shared-flow)
12. [Find and the JV Ledger tab](#12-find-and-the-jv-ledger-tab)
13. [Data model](#13-data-model)
14. [Backend API (IPC channels)](#14-backend-api-ipc-channels)
15. [Validation messages](#15-validation-messages)
16. [Reports that read JVs](#16-reports-that-read-jvs)
17. [Tests](#17-tests)
18. [Known quirks](#18-known-quirks)
19. [History of decisions](#19-history-of-decisions)

---

## 1. What a Journal Voucher is

A **real multi-line double-entry journal** — the legacy "Journal Entry" screen
(`ref-pics/batch2/jv2.0.jpeg`). One voucher has **N lines**; each line names **its own business
account** and is either a **debit or a credit**. To be posted, the debits and credits must be equal.

There is **no fixed counter-account**. Every line names a real account, so each account's own
ledger shows exactly what the JV moved through it and why.

Typical uses: goodwill written off a party's balance (e.g. Eid compensation), a concession a
vendor grants, a reclassification between two accounts, correcting an entry.

It is **not**:
- **Commission** — that is payment-time trade discount on a receipt, customers only.
- **A deposit** — a one-sided adjustment against the MISCELLANEOUS ADJUSTMENTS chart account.

## 2. Where it lives

| | |
|---|---|
| Menu | **2. DATA ENTRY → 2.21 JOURNAL VOUCHER** (`lib/menu.ts`) |
| Page key | `journal-voucher` |
| Tabs | **New Journal Voucher** (entry screen) · **JV Ledger** (list of all JVs) |

Window and Exit behaviour: standard §1.

## 3. Core concepts

| Concept | Meaning |
|---|---|
| **Header (Master)** | Date, Number, Remarks — one per voucher |
| **Line (Detail)** | Account, Narration, Debit **or** Credit — many per voucher |
| **Status** | `DRAFT` (shown as *Not Posted* / *Unposted*) or `CONFIRMED` (*Posted*) — a column on the same row; JV has **no separate draft table** |
| **jv_id** | Internal identity, used by the API and in ledger narrations |
| **Number (`voucher_no`)** | The visible, system-generated sequential number, assigned at first save |
| **Remarks** | The header field, stored as `reason`. Optional |
| **Narration** | Optional per-line note |

## 4. The sign rule (ACC-01)

The entry strip has **one signed Amount field**, not separate Debit/Credit boxes.

| Typed amount | Becomes | Grid column |
|---|---|---|
| **Positive** (e.g. `5000`) | **Debit** | Debit (NAAM) |
| **Negative** (e.g. `-5000`) | **Credit** | Credit (JAMMA), shown in brackets `(5,000)` |
| `0` | rejected — "Amount can't be 0" | — |

This is the **one sign rule for every account type, no exceptions** (confirmed by the client
2026-09-14). Re-opening a line for editing reverses it: a debit loads as `+`, a credit as `−`.

Implemented once in `frontend/src/lib/journalVoucherMath.ts` (`amountToDebitCredit` /
`debitCreditToAmount`) and unit-tested (`journalVoucherMath.test.ts`) — it once shipped inverted,
so it is kept separate on purpose.

## 5. Save and post rules

The save-vs-post split is the standard (§2). For the JV, **balance is a posting rule, not a
saving rule** — an out-of-balance or single-line voucher is a legitimate draft.

| Rule | Save / Done | Post / Save+Post |
|---|:---:|:---:|
| Date present | ✅ required | ✅ required |
| At least **1** line | ✅ required | — |
| At least **2** lines | — | ✅ required |
| Every line has an account | ✅ required | ✅ |
| Every line is debit **or** credit, not both | ✅ required | ✅ |
| Every line amount > 0, none negative | ✅ required | ✅ |
| **Total debit = total credit** (compared in paisa) | ❌ not required | ✅ required |
| Remarks | optional | optional |
| Narration | optional | optional |
| Accounts accessible to the user | ✅ checked | ✅ checked again at post |

Hover text when Post / Save+Post is disabled for balance:
*"Needs at least two lines, with debit and credit matching, before posting."*

## 6. Ledger effect

**On Post**, in one transaction:
- One `ledger_entries` row **per line**:
  - `entry_date` = voucher date
  - `ba_id` = the line's account
  - `debit` / `credit` = the line's amounts
  - `source_type = 'JOURNAL_VOUCHER'`, `source_id = jv_id`
- Status becomes `CONFIRMED`.

**Narration written to the ledger** for each line:
- `Journal Voucher #<jv_id> — <line narration>` when the line has one, otherwise
- `Journal Voucher #<jv_id> — <header remarks>`, otherwise
- `Journal Voucher #<jv_id>`

**On Un Post**: every ledger row of that JV is deleted and status returns to `DRAFT` (standard §2).

## 7. Header band

The entry card is titled `JOURNAL ENTRY`. Its header band is one row:
**Date\*** · **Number** (read-only) · **Remarks** (optional, placeholder
"e.g. Eid compensation (optional)").

## 8. The entry strip

Generic strip behaviour (commit, Update Line, editing banner): standard §4.

**Visual layout** (2 rows):

| Row 1 | A/C Code\* | Account Description (read-only) | Amount\* |
|---|---|---|---|
| **Row 2** | **Narration** (spans two columns) | | **Balance** (read-only) |

- **A/C Code** — type to filter, or press Enter / ↓ / ↑ (or click ▾) to open the
  **Select Account** search window. Options read `Name (Code) — Parent chart account`; searching
  matches name and code only, not the parent chart account name.
- **Account Description** — the picked account's name, filled automatically.
- **Narration** — optional note for this line.
- **Amount** — signed (see [§4](#4-the-sign-rule-acc-01)). Placeholder `+debit / -credit`.
- **Balance** — the picked account's live balance (shown once an account is picked). It
  refreshes after save, post, unpost and delete.

**Tab order:** **A/C Code → Narration → Amount** — Narration comes before Amount, by the client's
request, even though Amount sits on the first row visually. **Enter on Amount commits the line.**

## 9. The lines grid

Row states, selection and per-row ✏/🗑 behaviour: standard §5.

Columns: ▶ gutter · **A/C Code** · **Account Description** · **Narration** · **Debit (NAAM)** ·
**Credit (JAMMA)** · **Actions** (Edit ✏ / Delete 🗑).

## 10. Totals footer

| Box | Shows |
|---|---|
| **Total Debit** | sum of debits |
| **Total Credit** | sum of credits, in brackets |
| **Net Total** | debit − credit. **Gold on white when 0**; **white on red when not 0** |

When out of balance, a red line under the footer reads:
*"Out of balance by X — you can still save this as an unposted draft; debit and credit must match
before it can be posted."*

## 11. JV specifics of the shared flow

Everything in the standard applies as written. JV-specific values:

| Standard section | JV value |
|---|---|
| §6 Master / Detail | Master = **Date, Remarks** |
| §8 Toolbar — Post rules | ≥ 2 lines and Net Total 0 (see [§5](#5-save-and-post-rules)) |
| §8 Toolbar — Excel | Exports A/C Code, Account, Narration, Debit, Credit |
| §9 Number | Sequence `dbo.seq_journal_voucher_no`; retired numbers logged with `doc_type = 'JOURNAL_VOUCHER'` |
| §15 Restart | Stored under page key `journal-voucher` |
| §16 Access | Restricted-account check runs on **every line** at save, post and unpost |

## 12. Find and the JV Ledger tab

Generic Find and list-tab behaviour: standard §12.

**Find Journal Voucher** searches by **Number or Remarks** only.

**JV Ledger tab:**
- Columns: Date · Number · Remarks · Lines · Total (debit side) · Status (*Posted* / *Not Posted*).
- **Search** matches: number, remarks, **account name or code on any line**, **any line's
  narration**, or **any line's debit/credit amount**.

## 13. Data model

### `dbo.journal_vouchers` (header)

| Column | Type | Notes |
|---|---|---|
| `jv_id` | INT IDENTITY, PK | internal identity |
| `jv_date` | DATE NOT NULL | |
| `voucher_no` | NVARCHAR(30) | system-generated from `seq_journal_voucher_no` (migration 034) |
| `reason` | NVARCHAR(200) NULL | "Remarks" on screen; optional since migration 033 |
| `remarks` | NVARCHAR(500) NULL | not used by the screen |
| `status` | VARCHAR(10), default `DRAFT` | `DRAFT` / `CONFIRMED` (`CK_journal_vouchers_status`) |
| `created_by`, `updated_by` | INT → users | `updated_by` set on post/unpost |
| `created_at`, `updated_at` | DATETIME2(0), UTC | |

### `dbo.journal_voucher_lines`

| Column | Type | Notes |
|---|---|---|
| `line_id` | INT IDENTITY, PK | |
| `jv_id` | INT → journal_vouchers, **ON DELETE CASCADE** | |
| `line_no` | INT | 1-based, in entry order; rewritten on every save |
| `ba_id` | INT → business_accounts | the line's account |
| `debit`, `credit` | DECIMAL(14,2), default 0 | |
| `narration` | NVARCHAR(500) NULL | |

Constraints: `CK_jvl_amounts_nonneg` (both ≥ 0), **`CK_jvl_one_side`** (debit = 0 or credit = 0),
**`CK_jvl_nonzero`** (debit > 0 or credit > 0).

### Other objects

- **`dbo.seq_journal_voucher_no`** — the Number sequence, `NO CACHE`.
- **`dbo.deleted_document_numbers`** — retired numbers, `doc_type = 'JOURNAL_VOUCHER'`.
- **`ledger_entries.source_type = 'JOURNAL_VOUCHER'`**, `source_id = jv_id`.
- Reserved chart account **400007 JOURNAL VOUCHER** — a structural head; its account can't be
  closed. Used by the old single-line model and its backfill.
- Reserved chart account **400008 DISCOUNTS, CLAIMS & COMMISSIONS** — returned by the
  `counterAccount` channel (see [§18](#18-known-quirks)).

### Saving mechanics

- **Create:** header + all lines in one transaction; the Number is allocated in the same
  transaction.
- **Update:** header updated, **all lines deleted and re-inserted** in one transaction (so
  `line_id`s change and `line_no` is renumbered). The Number is never touched.

### Migration history

| # | Change |
|---|---|
| 016 | Single-line JV (one party + direction + amount, countered to account 400007); opens `ledger_entries` to `JOURNAL_VOUCHER` |
| 023 | Manual free-text Number field |
| 024 | Rebuilt as a real multi-line journal: `journal_voucher_lines`; old rows backfilled into two lines each; old columns dropped |
| 033 | Remarks (`reason`) becomes optional |
| 034 | Number becomes system-generated and sequential; existing rows numbered 1, 2, 3… |
| 035 | Sequence set to `NO CACHE`; jumped numbers renumbered back into order |

## 14. Backend API (IPC channels)

Every channel requires a logged-in session.

| Channel | Does |
|---|---|
| `journal-vouchers:list` | List with filters `search`, `status`, `ba_id`, `date_from`, `date_to`; newest first; includes `line_count`, `total_debit`, `total_credit` |
| `journal-vouchers:get` | One JV with its lines (account name and code joined) |
| `journal-vouchers:create` | New DRAFT; save rules apply |
| `journal-vouchers:update` | Replace header + lines; refused if posted (`POSTED_LOCK`) |
| `journal-vouchers:remove` | **Password required**; refused if posted; logs the retired Number |
| `journal-vouchers:post` | Post rules + ledger rows + `CONFIRMED`; `ALREADY_POSTED` if posted |
| `journal-vouchers:unpost` | Delete ledger rows + `DRAFT`; `NOT_POSTED` if not posted |
| `journal-vouchers:listUnposted` | Every DRAFT JV, oldest first |
| `journal-vouchers:postAll` | Post the given ids (or all unposted); returns `{ posted, failed, attempted }`. An already-posted one is skipped, not reported as failed |
| `journal-vouchers:listDeletedNumbers` | Retired Numbers, for the preview |
| `journal-vouchers:counterAccount` | The 400008 business account |

## 15. Validation messages

**On screen (before calling the server):**

| Message | When |
|---|---|
| Select an account before adding the line. | Committing a line with no account |
| Amount can't be 0 — positive for a debit, negative for a credit. | Committing a zero amount |
| Please pick a date. | Saving with no date |
| Add at least one line before saving. | Saving with no lines |
| Every line needs an account. / Every line needs a debit or credit amount greater than 0. | Saving a malformed line |
| Click New to start a voucher first. | Saving on the locked blank form |
| Click the line you want to edit first, then press Edit. | Edit (Detail) with no row selected |

**From the server:**

| Message | Code |
|---|---|
| jv_date is required | 400 |
| A Journal Voucher needs at least one line | 400 |
| Each line must have an account | 400 |
| Debit/credit cannot be negative | 400 |
| Each line must be either a debit or a credit, not both | 400 |
| Each line must have a debit or credit amount > 0 | 400 |
| A Journal Voucher needs at least 2 lines before it can be posted | 400 (post only) |
| Total debit (X) must equal total credit (Y) | 400 (post only) |
| Unpost the Journal Voucher before editing / before deleting | `POSTED_LOCK` |
| Journal Voucher is already posted | `ALREADY_POSTED` |
| Journal Voucher is not posted | `NOT_POSTED` |
| Journal Voucher not found | 404 |

## 16. Reports that read JVs

Only **posted** JVs count anywhere in reports.

- **Account Ledger / Khaata:** each JV ledger row shows type **Journal Voucher**, with the JV's
  Number in the Inv No. column and the stored narration (see [§6](#6-ledger-effect)).
- **Customer Report** and **Vendor Report:** a JV column per account = Σ(credit − debit) of its
  posted JV lines in the date range.
- **Trial balance and balances:** through the ledger rows like any other posting.

## 17. Tests

| Test | Covers |
|---|---|
| `frontend/src/lib/journalVoucherMath.test.ts` (vitest) | The ACC-01 sign rule both ways |
| `backend/e2e/journalVoucher.browseFilter.e2e.js` (real screen, `wentox_test`) | Opens in its own window with no Login flash; Posted choice sticks; New; Post (clears to blank); Un Post; the dropdown matches the voucher on screen after every step |
| `backend/e2e/journalVoucher.saveTwice.e2e.js` (real screen, `wentox_test`) | New → add a line → Save → Save → Done leaves exactly **one** voucher (Save on a new voucher used to make a duplicate on every later press) |

There is no backend unit test of the JV service yet.

## 18. Known quirks

These are current behaviour, recorded so nobody is surprised. None has been reported as a
problem.

1. **The ledger narration names the internal id, not the Number.** It says
   `Journal Voucher #<jv_id>`, while the screen shows the Number. The two can differ (deleted
   vouchers, the migration 035 renumbering). The Account Ledger's Inv No. column does show the
   Number.
2. **Post is disabled while editing.** Press Done first, or use Save+Post (standard §8).
3. **Find searches Number and Remarks only.** To find a JV by account, narration or amount, use
   the JV Ledger tab's search.
4. **Post All posts every unposted JV**, not only the one on screen. Unbalanced or single-line
   ones fail individually and are listed; the rest still post.
5. **The JV Ledger "Total" column** shows the debit total only.
6. **`counterAccount`** (account 400008) is offered by the backend for an "auto-balance the
   second line" default, but the screen doesn't use it.
7. A code comment near the Number preview says the preview is "always shown"; the code shows it
   only after New, which is the agreed rule (standard §9).

## 19. History of decisions

JV-specific decisions only. Decisions about the shared flow, toolbar and workflow are in the
standard's history (§18).

| Date | Decision |
|---|---|
| 2026-08-26 | Multi-line rebuild to match the legacy Journal Entry screen; entry strip with one signed Amount |
| 2026-09-14 | **ACC-01**: +ve = debit, −ve = credit, for every account (fixed an inverted screen). **JV-03**: Remarks optional |
| 2026-09-15 | **JV-01**: system-generated sequential Number. **JV-02**: compact one-row header, Balance readout, Narration before Amount. **JV-04** row delete |
| 2026-09-24 | **Balance is a posting rule** — unbalanced and single-line drafts can be saved |
| 2026-10-06 | Fixed: Save on a new voucher, then Save/Done again, created a duplicate voucher each time — saving now updates whenever the voucher already has an id |
| 2026-10-06 | Split into this page and [`document_page_standard.md`](document_page_standard.md) |
