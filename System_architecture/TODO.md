# WentoX — Outstanding Work

Last updated: **2026-07-30**. Written from the actual state of the tree, not from memory —
every claim below has a file:line or a command behind it.

Companion docs: [`payroll.md`](payroll.md), [`cash_and_bank.md`](cash_and_bank.md).
`architecture-v2.md` remains the source of truth for anything not covered here.

---

## 1. Bugs — real defects in code that is already shipped

### 1.1 Business-account serials are 2 digits in four places — **caps a chart head at 99 children**

The numbering scheme is a 6-digit chart code plus a **4-digit** serial. Four pages still generate
two, which silently caps each chart account at 99 children. The client's legacy data already holds
**218+ accounts under one head**, so an import hits the ceiling immediately and starts colliding.

| File | |
|---|---|
| `pages/VendorSetupPage.tsx:56` | `nextSuffix < 10 ? \`0${n}\` : \`${n}\`` |
| `pages/CustomerSetupPage.tsx` | same |
| `pages/PurchasePage.tsx:49` | vendor quick-add |
| `pages/SaleBillPage.tsx` | customer quick-add |

Correct versions to copy: `pages/EmployeeSetupPage.tsx` and `pages/BankSetupPage.tsx`
(`String(max + 1).padStart(4, '0')`).

Note the quick-add paths duplicate the setup pages' logic rather than sharing it — worth extracting
one helper while fixing, or the next new party type will reintroduce it a fifth time.

### 1.2 Cash Book does not show transfers

`grep -c "state.transfers" pages/ReportCashBookPage.tsx` → **0**.

Banking the day's takings is a cash movement, but no receipt or expense records it, so the Cash
Book's rows are now incomplete. The *opening* figure is already right (it defers to
`getAccountBalance`), which makes this worse rather than better: opening and closing include the
transfer, the rows in between do not, so the page will not add up.

Transfers must appear as rows, labelled clearly enough that nobody reads one as income.

### 1.3 `frontend/CLAUDE.md` describes a data model that no longer exists

It documents `Article`/`Slip`/`Client`/`Production`/`ChemPurchase` and pages keyed on
`slips`/`production`/`chemical`/`profit`. None of that is in the app. Anyone — or any tool — reading
it for orientation gets a wrong map of the codebase.

---

## 2. Unverified — built and type-checked, never actually exercised

Being honest about the difference between "compiles" and "works".

### 2.1 The whole cash & bank feature has never been rendered

Type-checked, lint-clean, production build passes, and the **balance arithmetic is proven** by
executing `lib/cashbank.ts` against the demo data (10/10, including a deposit and a bounce
round-trip). But no screen was opened and no button clicked. Specifically unexercised:

- Bank Accounts setup — add, edit, delete-guard, opening balance
- Expenses — the four-mode selector, and whether Endorse/Issue collect the right fields
- Receipts — the bank picker on Online
- Cheque deposit — the new "Deposit Into" picker
- Transfer screen — including the below-zero warning

### 2.2 Payroll unpost round-trip

`CONFIRMED → unpost → edit → post` is implemented and the guards around it were verified, but the
transition itself has never been driven. It sits behind `window.confirm`, which freezes the browser
automation extension — see 4.1.

---

## 3. Assumptions to confirm — cheap to answer, expensive to get wrong

Both were stated in `cash_and_bank.md` and built on without a direct answer.

1. **One cheque is never deposited into two different banks.** The deposit bank therefore lives on
   the cheque (`receipt.depositBankId`), not on the allocation. If a cheque can be split across two
   banks, the bank has to move onto `cheque_allocations` and the derivation changes.
2. **"There is only one petty cash"** was read as *one cash account, called petty cash*. If it means
   a main cash drawer **plus** a petty cash float, that is two accounts and every cash payment and
   receipt needs a "which account" picker it currently does not have.

---

## 4. Debt

### 4.1 `window.confirm` in 18 files blocks all browser testing

A native modal freezes the Chrome automation extension, so any flow behind one cannot be verified
end to end — which is exactly why 2.2 is unverified. Replacing them with an in-page confirm dialog
would unblock testing of every destructive action in the app, not just payroll.

### 4.2 ~35 pre-existing lint errors

Baseline before this session's work was 38; it is now 35. Nothing added by recent work — mostly
`react-refresh/only-export-components` and a few genuine React Compiler complaints
(`SaleBillPage.tsx` accesses `handleNew` before declaration; `VendorReportPage.tsx` reassigns a
value after render).

### 4.3 Derived-total invariants have no enforcement

`wage_runs.total_amount`, `salary_runs.total_amount` and `sale_bills.net_value` all duplicate the sum
of their child rows, and nothing enforces it — a computed column cannot aggregate over a child
table. Whoever writes the backend must rewrite the header total inside the same transaction as any
line change. `wage_run_items.amount` is safe (PERSISTED computed); the headers are not.

---

## 5. Next features, in the order they make sense

1. **Bounce reversal must unwind the bank side.** `cash_and_bank.md` §11 item 14, the one build item
   not completed. The balance helper already handles it correctly by counting `ACTIVE` allocations
   only — proven by test — but no UI flow walks a bounced, *deposited* cheque back out of the bank
   it landed in on the bounce date.
2. **Opening balances for customers and vendors.** `business_accounts.opening_balance` exists and
   cash/bank use it; the customer and vendor setup pages do not expose it. Needed before any legacy
   import, since those 218+ accounts all carry a balance from day one.
3. **Bank reconciliation.** Deliberately deferred, but the reason is now live: an issued cheque
   deducts the bank the day it is **written**, so the in-app balance answers *"what have I
   committed?"* and will not match a statement until the cheque clears.
4. **Inter-account transfer edit.** Transfers can be created and deleted, not edited. Fine for now;
   worth noting before someone reports it.

---

## 6. Deferred by decision — not oversights

Recorded so nobody "fixes" them by accident.

| | Why |
|---|---|
| Attendance tracking / computed salary deductions | A deduction is typed by a person who decided it, with remarks. Nothing derives it from days present |
| Period tracking on a wage run (`period_from`/`period_to`) | The client's sheet has no such columns. Consequence stated: nothing can detect the same week being paid twice; the screen shows recent runs instead |
| Changing an employee's type after creation | Would strand the `ba_id` under the wrong account head and orphan the trades or the salary history |
| Full row-by-row edit history | Only who unposted, when, and the prior total are recorded |
| Cheque clearing dates for issued cheques | Direct consequence of deduct-on-write |

---

## 7. Cross-machine

- **This machine is 4 commits behind `origin/main`** as of writing. Incoming: `e4af48c9`
  *"change backend structure to proper electron app, previously it was based on localhost"*, two
  milestone commits, and a merge of `subhan`. None touches `schema.sql`, `frontend/src` or
  `System_architecture` — verified — so there is no conflict, but the Electron restructure will
  eventually change how the frontend is served and how it reaches the database.
- **The split:** frontend on `main` from this machine, backend by Subhan on `origin/subhan`. Note
  he now merges `subhan` **into** `main`, so `main` is no longer frontend-only — the split holds by
  file, not by branch.
- **`database/schema.sql` is the one file the split does not protect.** Both sides need it. Check it
  specifically before merging anything from the other side.
