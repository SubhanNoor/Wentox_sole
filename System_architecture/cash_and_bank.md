# WentoX — Cash, Bank & Cheque Routing

**Status: design, not built.** This document is for review before any code is written.

**Revision 2** — all five open questions answered (§9). Three things changed the shape of the work:
WentoX **does** issue its own cheques (§6), money **does** move between own accounts so a Transfer
document is needed (§7), and accounts open with a real balance rather than zero (§8).

Covers where money physically sits, which account every payment moves it through, and how those
balances stay right.

---

## 1. The plan, as stated

> A chart of account named **Bank Accounts** will be created, and business accounts created under
> it — there may be multiple. When paying or receiving any payment it should ask **which bank
> account**. When payment mode is **cash** it goes to **Cash in Hand**; when it is **cheque** it goes
> to **Cheques in Hand** until it is deposited to a bank (also selected) or endorsed. Data must stay
> consistent — a payment or receipt must update the respective account.

That is the right model, and it is close to what the schema already assumes. The gap is mostly in
the **frontend**.

---

## 2. The surprise: the schema already does most of this

Worth knowing before planning any work, because it changes what "build this" means.

| Already in `schema.sql` | |
|---|---|
| `receipts.bank_id` | *"ONLINE only; CHEQUE's bank lives on cheques.bank_id"* |
| `expenses.bank_id` | same |
| `receipts.cheque_id` / `expenses.cheque_id` | links the payment to a cheque row |
| `cheques.bank_id` | *"which bank_accounts row the cheque deposits to"* |
| `dbo.bank_accounts` | profile table + `ba_id` into `business_accounts` — the same party pattern as vendors, customers and employees |
| `CK_receipts_mode` / `CK_expenses_mode` | **enforces** `ONLINE ⇒ bank_id IS NOT NULL`, and `CHEQUE ⇒ cheque_id IS NOT NULL` |

So the database already refuses an online payment that names no bank. What does not exist is any
frontend that supplies one: `Receipt` and `Expense` in `types/index.ts` carry **neither `bankId` nor
`chequeId`** — only `paymentMode` and a free-text `details` string. Every payment recorded today is
one-sided. You can see a worker was paid Rs 50,000; nothing records that the cash left anywhere.

This is the same shape as the wages gap: a well-formed database half, and a frontend that never met
it.

---

## 3. Account structure

Today the seed has one *named bank* sitting at chart level:

```
1000 ASSETS
 └─ 120001  CASH IN HAND
 └─ 120002  BANK ALFALAH AC - 0124     <-- a specific bank, at chart level
 └─ 120003  CHEQUES IN HAND
```

That does not scale — a second bank would need a second chart account, and the chart is meant to
hold *kinds* of thing, not instances. Under the plan:

```
1000 ASSETS
 └─ 120001  CASH IN HAND
 │   └─ 1200010001  Petty Cash                 <-- the single cash account (✔ §9.4)
 └─ 120002  BANK ACCOUNTS                      <-- the KIND
 │   └─ 1200020001  Bank Alfalah A/C - 0124    <-- the INSTANCE
 │   └─ 1200020002  Meezan Bank A/C - 8891
 │   └─ ...
 └─ 120003  CHEQUES IN HAND
```

Exactly the pattern vendors, customers and employees already follow: a chart account naming the
kind, business accounts naming the instances.

**Three different names are in play** and one has to win: `BANK ALFALAH AC - 0124` (the seed),
`CASH AT BANKS` (the comment on `bank_accounts.ba_id`), and **`BANK ACCOUNTS`** (the plan). The plan
wins; the other two get corrected.

**Numbering.** New bank business accounts use the **4-digit** serial — `1200020001`, not
`12000201`. The existing cash account `12000101` uses the old 2-digit form, which is the known
latent bug (2 digits caps a head at 99 children). Banks should not inherit it.

**`dbo.bank_accounts` earns its place.** Keep it. A bank has attributes a generic business account
has nowhere to put — account number, branch, IBAN. It mirrors `vendors` / `employees`: profile row
plus a unique `ba_id`. Its comment needs correcting to say **BANK ACCOUNTS**.

---

## 4. Where each payment mode moves money

One rule per mode, one account per movement.

### Receipt — money coming in

| Mode | Lands in | Asked on screen |
|---|---|---|
| **Cash** | `CASH IN HAND` | nothing — there is only one cash account (✔ §9.4) |
| **Online** | the **selected bank account** | **which bank** — required |
| **Cheque** | `CHEQUES IN HAND` | nothing yet — the bank is chosen later, at deposit |

```
Cash receipt:     Dr  CASH IN HAND        Cr  customer
Online receipt:   Dr  <selected bank>     Cr  customer
Cheque receipt:   Dr  CHEQUES IN HAND     Cr  customer
```

A received cheque is **not** money in the bank. It is a claim sitting in a drawer, which is why
`CHEQUES IN HAND` exists as its own account and why the plan holds it there until it moves.

### Payment / expense — money going out

| Mode | Comes from | Asked on screen |
|---|---|---|
| **Cash** | `CASH IN HAND` | nothing |
| **Online** | the **selected bank account** | **which bank** — required |
| **Cheque — endorsed** | a received cheque, out of `CHEQUES IN HAND` | **which cheque** |
| **Cheque — issued** | the **selected bank account** (✔ §9.1) | **which bank**, cheque no. & date |

```
Cash payment:      Dr  party    Cr  CASH IN HAND
Online payment:    Dr  party    Cr  <selected bank>
Cheque endorsed:   Dr  party    Cr  CHEQUES IN HAND
Cheque issued:     Dr  party    Cr  <selected bank>      -- on the date written (§6)
```

**"Cheque" now means two different things**, and the screen has to distinguish them, because they
credit different accounts. Endorsing hands over someone else's cheque; issuing writes your own.
Today only the first exists.

---

## 5. The received-cheque lifecycle

A received cheque sits in `CHEQUES IN HAND` until it is disposed of. The dispositions already exist
(`cheque_allocations.disposition_type`):

```
                       ┌── DEPOSIT ──────────► a bank account   (bank must be chosen)
cheque received        │
  → CHEQUES IN HAND ───┼── VENDOR_PAYMENT ───► a vendor's account
                       │
                       └── EXPENSE_PAYMENT ──► an expense head
```

A cheque may be **split** across dispositions — hence `PARTIALLY_ENDORSED` — so value leaves
`CHEQUES IN HAND` allocation by allocation, not all at once.

### The one thing DEPOSIT cannot currently say: which bank

```sql
CONSTRAINT CK_cheque_allocations_target CHECK (
      (disposition_type = 'DEPOSIT' AND target_vendor_id IS NULL AND target_ba_id IS NULL)
   OR ...
```

DEPOSIT is **required** to name no target at all. So today, depositing a cheque records that it left
the drawer but not where it landed — precisely the gap the plan calls out.

**Resolution:** one cheque is never deposited into two different banks (✔ §9.3, assumed — say so if
wrong), so the bank belongs on the **cheque**, not the allocation. `cheques.bank_id` already exists
and already means this. The CHECK simply needs relaxing so a DEPOSIT allocation is valid while the
cheque carries the bank, and the deposit screen must set it.

### Bounce still reverses, never erases

Unchanged and load-bearing: a bounce writes counter-entries dated `bounced_date` and leaves the
originals and their `allocation_date` untouched, so a report printed before the bounce still
reconciles after it. With bank routing added, the reversal has to unwind the **bank** side too — a
deposited cheque that bounces must take the money back out of the bank it landed in, **on the bounce
date, not the deposit date**.

---

## 6. Cheques WentoX writes

✔ §9.1: the business does issue its own cheques, and **the bank is deducted the day the cheque is
written**, not when it clears.

**That choice removes a whole subsystem.** Deduct-on-clear would have needed an issued-cheque table,
a pending state, a "mark cleared" step and someone chasing stale cheques. Deduct-on-write needs none
of it: an issued cheque is simply *an expense paid from a bank account, with a cheque number written
on it*. No new table.

```
expenses gains:
  issued_cheque_no    VARCHAR(50) NULL
  issued_cheque_date  DATE        NULL
```

and `payment_mode` splits the two cheque meanings:

| `payment_mode` | Means | Requires |
|---|---|---|
| `CHEQUE_ENDORSED` | handing over a cheque received from a customer | `cheque_id`, no `bank_id` |
| `CHEQUE_ISSUED` | writing our own cheque | `bank_id`, `issued_cheque_no`, no `cheque_id` |

The existing `'CHEQUE'` value on **expenses** is renamed `CHEQUE_ENDORSED` — nothing is deployed, so
this costs an edit rather than a migration. **Receipts keep plain `'CHEQUE'`**: you can only ever
*receive* someone else's cheque, so there is nothing to disambiguate there.

**The honest limitation of deduct-on-write:** the bank balance in WentoX will not match the bank's
own statement while a written cheque is uncleared. That is expected and normal — it is exactly what
a bank reconciliation resolves — but it means the figure on screen answers *"what have I committed?"*
rather than *"what would the bank tell me right now?"*. Worth knowing before someone reports it as a
bug.

---

## 7. Transfers between own accounts

✔ §9.2. Depositing cash takings into the bank is neither a receipt nor an expense — nobody paid us
and we paid nobody. Recording it as an expense-plus-receipt pair would inflate both income and
expenses with money that never left the business, so every report would read wrong. It needs its own
document.

```
transfers
  transfer_id    PK
  transfer_date  DATE
  from_ba_id     FK -> business_accounts    -- cash or bank
  to_ba_id       FK -> business_accounts
  amount         DECIMAL(14,2)  CHECK (amount > 0)
  remarks        NVARCHAR(500)  NULL
  status         VARCHAR(10)    CONFIRMED | DRAFT
  created_by / updated_by / created_at / updated_at

  CHECK (from_ba_id <> to_ba_id)
```

`ledger_entries.source_type` gains **`TRANSFER`** (`Dr` destination, `Cr` source).

**The rule that matters:** a transfer must never appear in any income or expense total. Cash Book,
Sale Analysis and the expense reports all have to skip `TRANSFER` explicitly. This is the single
easiest thing to get wrong here, because a transfer *looks* like a payment from every angle except
the one that counts.

Covers cash → bank, bank → bank, and bank → cash (a withdrawal for wages, which given piece-rate
workers is likely the most common one of all).

---

## 8. Opening balances

✔ §9.5. An account created in the live app already holds real money.

`business_accounts` gains:

```
  opening_balance  DECIMAL(14,2) NULL
  opening_date     DATE          NULL
```

Deliberately on **`business_accounts`**, not on `bank_accounts` — because cash needs one too, and so
will every customer and vendor when the client's legacy ledger is imported. Memory of that data puts
218+ accounts under one head, all of them carrying a balance from day one. One mechanism, used
everywhere, beats a bank-only field that gets duplicated three more times later.

It is a stored **input**, not a stored balance — the same category as a snapshot. The derived
balance simply starts from it.

---

## 9. Decisions — all questions answered

1. ✔ **WentoX issues its own cheques, deducted when written.** No issued-cheque table, no pending
   state (§6).
2. ✔ **Transfers between own accounts are needed** — their own document, excluded from income and
   expense totals (§7).
3. ✔ **One cheque is never deposited into two banks** *(assumed — flag if wrong)*, so the deposit
   bank lives on `cheques.bank_id` and no new column is needed on the allocation (§5).
4. ✔ **One cash account only**, called **Petty Cash**. Cash payments and receipts never ask which
   account. *Read as: the single cash account is the petty cash — if there is a main drawer AND a
   petty cash float, that is two and this flips.* The demo's "Lahore Cash Vault" should be renamed.
5. ✔ **Opening balance typed when the account is created**, on `business_accounts` so cash, banks
   and the legacy import all use one mechanism (§8).

---

## 10. Keeping the balances right

*"Data stays consistent — when a payment/receipt is made it should update the respective account."*

**Derive it; never store a running balance.** Not a preference — it is what the rest of the system
does, and the payroll design landed on it for a concrete reason: any stored balance goes stale the
moment an earlier document is edited or unposted, silently, with nothing to flag it. There is no
stored balance anywhere in the current 46 tables.

So every screen showing a cash or bank balance computes it from the documents naming that account:

```
balance(bank B)  =  opening_balance(B)
                 +  Σ receipts ONLINE           where bank_id = B
                 +  Σ cheque DEPOSITs           where the cheque's bank_id = B   (ACTIVE only)
                 +  Σ transfers TO B                                             (CONFIRMED only)
                 −  Σ expenses ONLINE           where bank_id = B
                 −  Σ expenses CHEQUE_ISSUED    where bank_id = B
                 −  Σ transfers FROM B

balance(cash)    =  opening_balance(cash)
                 +  Σ receipts CASH   +  Σ transfers TO cash
                 −  Σ expenses CASH   −  Σ transfers FROM cash

balance(cheques) =  Σ cheque receipts still PENDING / PARTIALLY_ENDORSED
                 −  Σ ACTIVE allocations against them
```

`ACTIVE only` is what makes the bounce rule work: a reversed allocation stops counting without being
deleted. `CONFIRMED only` mirrors the payroll rule — a draft moves nothing.

One helper, used by the Cash Book, the account ledgers and the new Bank Accounts screen — same shape
as `lib/payroll.ts`. Written once, it cannot disagree with itself.

---

## 11. What has to be built

### Schema

1. Seed the **`BANK ACCOUNTS`** chart account (`120002`); move Bank Alfalah down to `1200020001`.
   Rename the cash account to **Petty Cash**.
2. `expenses`: add `issued_cheque_no`, `issued_cheque_date`; split `payment_mode` into
   `CHEQUE_ENDORSED` / `CHEQUE_ISSUED`; update `CK_expenses_mode` for both arms.
3. New **`transfers`** table; add `TRANSFER` to `CK_ledger_entries_src`.
4. `business_accounts`: add `opening_balance`, `opening_date`.
5. Relax `CK_cheque_allocations_target` so DEPOSIT is valid with the bank held on the cheque.
6. Correct the `bank_accounts.ba_id` comment: *CASH AT BANKS* → *BANK ACCOUNTS*.

### Frontend (the bulk)

7. `Receipt` and `Expense` types gain `bankId?`, `chequeId?`, and the issued-cheque fields.
8. **Bank Accounts setup page** — does not exist at all. Add/edit banks with account number and
   opening balance, auto-creating the `ba_id` under `BANK ACCOUNTS`, exactly as the Employees page
   does for its two heads.
9. **Receipts screen**: *Online* requires a bank.
10. **Expenses screen**: *Online* requires a bank; cheque splits into **Endorse** (pick a held
    cheque) and **Issue** (pick a bank, enter cheque no. and date).
11. **Cheque deposit** (`ChequesTab`): DEPOSIT asks which bank and sets `cheques.bank_id`. It
    currently passes `targetId: null`.
12. **Transfer screen** — from, to, amount, date.
13. **One derivation helper** (§10), plus balances on the new page and the Cash Book, and reports
    taught to exclude `TRANSFER`.
14. Bounce reversal extended to unwind the bank side on the bounce date.

---

## 12. Not in scope

- **Bank reconciliation** against a real statement. See the limitation noted in §6.
- **Cheque clearing dates** for issued cheques — a direct consequence of deduct-on-write.
- **Backend.** Still scaffolding; this is frontend plus schema.

---

## 13. Build order

1. Schema changes 1–6 above, in one pass.
2. Frontend types + the derivation helper.
3. Bank Accounts setup page (nothing else can name a bank until banks exist).
4. Receipts and Expenses screens.
5. Cheque deposit bank.
6. Transfer screen.
7. Balances, report exclusions, bounce reversal.

Related: [`payroll.md`](payroll.md) for the derive-never-store precedent and the party pattern;
`database_schema.md` §13 for the cheque disposition rules this builds on.
