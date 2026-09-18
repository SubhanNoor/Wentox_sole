// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/bankAccounts.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  // Same both-or-neither rule as business_accounts.opening_balance/opening_date
  // (CK_business_accounts_opening) — enforced here too for a clean 400 instead of a raw
  // constraint error surfacing from the insert.
  const hasBalance = payload.opening_balance !== undefined && payload.opening_balance !== null;
  const hasDate = payload.opening_date !== undefined && payload.opening_date !== null;
  if (hasBalance !== hasDate) {
    throw ApiError.badRequest('opening_balance and opening_date must be given together');
  }
}

function list(filters) {
  return repository.list(filters);
}

async function getById(bankId) {
  const bankAccount = await repository.findById(bankId);
  if (!bankAccount) throw ApiError.notFound('Bank account not found');
  return bankAccount;
}

// Module 4.3: on create, auto-creates the bank account's ledger account under the reserved BANK
// ACCOUNTS chart account and links it via bank_accounts.ba_id — same pattern as vendors/customers
// (UC-08/UC-09). opening_balance/opening_date live on the linked business_accounts row, not here
// (cash_and_bank.md §3: "on business_accounts rather than bank_accounts on purpose"). Both writes
// share one transaction, so a failure partway through never leaves an orphaned business_accounts
// row with no bank account pointing at it.
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  // Case-insensitive name+account_no collision (not name alone — two accounts can share a bank
  // name with a different account_no). ACTIVE match blocks; INACTIVE match (soft-deleted earlier)
  // throws INACTIVE_DUPLICATE with the existing row's id/name/account_no in `details`, so the
  // frontend can offer "reactivate?" instead of creating a confusing second row.
  const accountNo = payload.account_no ?? null;
  const existing = await repository.findByNameAndAccountNo(name, accountNo);
  if (existing) {
    if (existing.is_active) {
      throw ApiError.conflict('A bank account with this name and account number already exists', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive bank account with this name and account number already exists',
      'INACTIVE_DUPLICATE',
      { bank_id: existing.bank_id, name: existing.name, account_no: existing.account_no },
    );
  }

  const id = await withTransaction(async (transaction) => {
    const baId = await businessAccountsService.createUnderChartCode(transaction, CODES.BANK_ACCOUNTS, name, {
      opening_balance: payload.opening_balance ?? null,
      opening_date: payload.opening_date ?? null,
    });
    return repository.insert(transaction, { ...payload, name, ba_id: baId });
  });

  const created = await repository.findById(id);
  // The business account was created inside the transaction above with its opening balance stored;
  // its derived OPENING ledger pair is written after the commit (see syncOpeningEntries' own note).
  if (created.ba_id) await businessAccountsService.syncOpeningEntries(created.ba_id);
  return created;
}

// Renaming a bank account keeps the linked account's name in sync (same as vendors — UC-08 step 6).
async function update(bankId, payload) {
  const existing = await getById(bankId);
  validate(payload);
  const name = payload.name.trim();

  const accountNo = payload.account_no ?? null;
  const duplicate = await repository.findByNameAndAccountNo(name, accountNo);
  if (duplicate && duplicate.bank_id !== bankId) {
    throw ApiError.conflict('A bank account with this name and account number already exists', 'DUPLICATE_NAME');
  }

  await repository.update(bankId, { ...payload, name });
  if (existing.ba_id && name !== existing.name) {
    await businessAccountsService.renameLinked(existing.ba_id, name);
  }
  // The opening balance lives on the linked business account, not on this row — create() already
  // set it there, so editing has to go the same route.
  if (existing.ba_id) await businessAccountsService.setOpening(existing.ba_id, payload);

  return repository.findById(bankId);
}

// Soft delete — is_active = 0, never a hard DELETE (receipts/expenses/cheques.bank_id reference
// this row historically). The linked business_accounts row stays ACTIVE for ledger/history integrity.
//
// ACC-02 (changes-14-09-26.md, 2026-09-15): blocked while the linked business account carries
// transactions — a bank account never posts ledger rows against its OWN bank_id, only against its
// linked ba_id (see repository.hasLedgerActivity's own comment), so both checks read that linked
// account instead.
async function remove(bankId) {
  const bankAccount = await getById(bankId);
  const openingBalance = bankAccount.ba_id ? await repository.findLinkedOpeningBalance(bankId) : null;
  if (openingBalance != null && Number(openingBalance) !== 0) {
    throw ApiError.conflict(
      `${bankAccount.name} has a non-zero opening balance — clear it before deleting the account`,
      'ACCOUNT_HAS_TRANSACTIONS',
    );
  }
  const hasActivity = await repository.hasLedgerActivity(bankId);
  if (hasActivity) {
    throw ApiError.conflict(
      `${bankAccount.name} has posted ledger transactions and cannot be deleted`,
      'ACCOUNT_HAS_TRANSACTIONS',
    );
  }
  await repository.setActive(bankId, false);
  return { ok: true };
}

// Frontend calls this instead of create() when the user confirms "reactivate the existing one"
// off an INACTIVE_DUPLICATE conflict. findById (not getById) skips the active check on purpose.
async function reactivate(bankId) {
  const bankAccount = await repository.findById(bankId);
  if (!bankAccount) throw ApiError.notFound('Bank account not found');
  await repository.setActive(bankId, true);
  return repository.findById(bankId);
}

// Permanent delete — per the user, 2026-09-17, added on top of remove() above, not instead of it:
// closing stays the normal, reversible action; this is separate, stricter, and irreversible, only
// reachable for a bank account already closed. Scoped like remove() itself — only this
// bank_accounts row is ever hard-deleted; the linked business_accounts row is left untouched
// (same reasoning as remove()'s own comment: ledger/history integrity).
async function permanentDelete(bankId) {
  const bankAccount = await getById(bankId);
  if (bankAccount.is_active) {
    throw ApiError.conflict(
      `${bankAccount.name} must be closed (deleted) first — permanent delete is only for an already-closed account`,
      'ACCOUNT_NOT_CLOSED',
    );
  }
  const referenced = await repository.hasAnyReference(bankId);
  if (referenced) {
    throw ApiError.conflict(
      `${bankAccount.name} is still referenced elsewhere (a cheque, receipt, or expense that deposits to or draws from it) and cannot be permanently deleted`,
      'ACCOUNT_STILL_REFERENCED',
    );
  }
  await withTransaction((transaction) => repository.hardDelete(transaction, bankId));
  return { ok: true };
}

module.exports = { list, getById, create, update, remove, reactivate, permanentDelete };
