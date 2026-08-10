// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/businessAccounts.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const CODES = require('../constants/reservedAccounts');
const { withTransaction } = require('../db/pool');

// Cross-feature reads go through here rather than another feature reaching into
// businessAccounts.repository.js directly (e.g. transfers.service.js validating from_ba_id/to_ba_id).
async function getById(baId) {
  const account = await repository.findById(baId);
  if (!account) throw ApiError.notFound('Business account not found');
  return account;
}

// Auto-creates a business_accounts row under a reserved chart account (UC-08/UC-09 pattern: a
// vendor/customer/bank never exposes a separate account-setup step — one row appears here,
// linked via the party's own ba_id, the moment the party is created). §3.2 composition: code =
// parent chart code + 4-digit zero-padded serial, serial = MAX(existing under that parent) + 1.
// Takes the CALLER's transaction (e.g. vendors.service.js:create()) and returns just the new
// ba_id, not a fetched row — the account and the party that owns it must commit or roll back
// together, so this never reads back through a separate connection mid-transaction.
async function createUnderChartCode(transaction, chartCode, name, extra = {}) {
  const chartAccount = await chartAccountsRepository.findByCode(chartCode);
  if (!chartAccount) {
    throw new Error(`Reserved chart account (code ${chartCode}) not found — run npm run seed`);
  }
  const serial = await repository.nextSerial(transaction, chartCode);
  const code = chartCode + String(serial).padStart(4, '0');
  return repository.insert(transaction, { code, name, ac_id: chartAccount.ac_id, ...extra });
}

// UC-08 step 6 / UC-09 equivalent: renaming the party keeps the linked account's name in sync.
function renameLinked(baId, name) {
  return repository.updateName(baId, name);
}

// The one business account seeded for cash (db/seeds/run.js#ensureCashBusinessAccount) — lets
// transfers.service.js/reports.service.js resolve "the Cash ba_id" by its reserved chart code
// instead of a hardcoded id, same as every other reserved-account lookup in this codebase.
async function getCashAccount() {
  const chartAccount = await chartAccountsRepository.findByCode(CODES.CASH_IN_HAND);
  if (!chartAccount) throw new Error(`Reserved chart account CASH IN HAND (code ${CODES.CASH_IN_HAND}) not found — run npm run seed`);
  const account = await repository.findByAcId(chartAccount.ac_id);
  if (!account) throw new Error('Cash business account not found — run npm run seed');
  return account;
}

// The single business account seeded under a reserved chart head (Cash, Journal Voucher). Kept
// here rather than each caller reaching into businessAccounts.repository directly — cross-feature
// reads go through this service (see CLAUDE.md).
function getByAcId(acId) {
  return repository.findByAcId(acId);
}

// ── UC-17 setup screen (list/get/create/update/remove) ──────────────────────────────────────
// getById() above stays a plain, unrestricted lookup — every cross-feature caller (transfers,
// cheques, reports) already depends on that exact shape. These add the setup screen's own
// TASK-14 restricted-parent hiding on top, rather than changing getById()'s existing contract.

function list(filters = {}, session) {
  const isAdmin = session?.role === 'ADMIN';
  return repository.list({ ...filters, excludeRestrictedParent: !isAdmin });
}

// UC-03 point 4: "A `USER` who requests a restricted account directly receives a 403."
//
// The restriction belongs to the ACCOUNT, not to any one screen or channel, so this is the guard
// every money-writing document calls before it touches a business account — expenses, receipts and
// settlements alike. Locking channels could never achieve the same thing: a USER blocked from
// expenses:create would simply have reached a Directors-Drawings account through receipts:create
// or settlements:create instead.
//
// `session` omitted means an internal caller with no request behind it (db/seeds/dev-sample-data.js,
// scripts). Those run as the machine, not as a person, and are trusted — the ipc layer always has a
// real session and always passes it, which is where untrusted input actually arrives.
async function assertAccessible(baId, session) {
  if (!session || session.role === 'ADMIN') return;
  const account = await repository.findByIdWithRestriction(baId);
  // A missing account is not this function's error to report; the caller's own lookup will 404.
  if (account?.is_restricted) {
    throw ApiError.unauthorized('This account is restricted to administrators');
  }
}

async function getForSetup(baId, session) {
  const account = await repository.findByIdWithRestriction(baId);
  if (!account) throw ApiError.notFound('Business account not found');
  if (account.is_restricted && session?.role !== 'ADMIN') {
    throw ApiError.notFound('Business account not found');
  }
  return account;
}

// CK_business_accounts_opening requires opening_balance/opening_date together or neither —
// checked here so a mismatched pair gets a clear 400 instead of a raw CHECK-constraint violation
// surfacing as an opaque INTERNAL error through ipc/wrap.js.
// CK_business_accounts_opening requires both or neither — an opening balance with no date cannot be
// placed on a timeline, so a ledger could not tell whether it sits before or after the first
// document. Checked here so a mismatched pair is a clear 400 rather than a raw constraint violation.
// Shared by create, update and the party services, so all five screens reject the same way.
function validateOpeningPair(payload) {
  const hasBalance = payload.opening_balance !== undefined && payload.opening_balance !== null && payload.opening_balance !== '';
  const hasDate = payload.opening_date !== undefined && payload.opening_date !== null && payload.opening_date !== '';
  if (hasBalance !== hasDate) {
    throw ApiError.badRequest('opening_balance and opening_date must be provided together, or not at all');
  }
  return {
    opening_balance: hasBalance ? Number(payload.opening_balance) : null,
    opening_date: hasDate ? payload.opening_date : null,
  };
}

// The opening pair only, for the party setup screens (vendor/customer/employee/bank) — they own
// name/region/city on their own row, so update() above would clobber them.
//
// NOTE: opening_balance is a stored INPUT that netBalance() adds in whenever opening_date is in
// range — NOT a ledger row. Changing it on an account with posted history therefore rewrites every
// past balance and report for that account, with no reversing entry. That is deliberate (it is how
// a migration mistake gets corrected) and the UI warns before saving.
// Applied ONLY when the caller actually supplied one of the two keys. The party setup screens
// (vendor/customer/employee/bank) cannot show the current opening balance on edit — it lives on the
// linked business account and their list queries do not join it — so an untouched form would send
// blanks and silently WIPE an existing opening balance on every unrelated rename. Skipping the
// no-op means those screens can set an opening balance when opening the account, and the Business
// Account screen (which does load the stored values) remains the place to view, change or clear it.
async function setOpening(baId, payload) {
  const supplied = payload.opening_balance !== undefined || payload.opening_date !== undefined;
  if (!supplied) return repository.findById(baId);
  const opening = validateOpeningPair(payload);
  await repository.updateOpening(baId, opening);
  return repository.findById(baId);
}

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (!payload.ac_id) throw ApiError.badRequest('ac_id is required');
  validateOpeningPair(payload);
}

// UC-17: a generic business account (an expense head), not a vendor/customer/employee/bank's
// auto-created one — no duplicate-name check (UC-17 doesn't call for one, and there's no DB-level
// UNIQUE(name) on this table, unlike group/chart accounts' name-scoped constraints). Reuses
// nextSerial()'s exact §3.2 composition (parent chart code + 4-digit serial) — same mechanism
// createUnderChartCode() uses, just resolving the parent by id instead of a reserved code.
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const chartAccount = await chartAccountsRepository.findById(payload.ac_id);
  if (!chartAccount) throw ApiError.badRequest('ac_id does not exist');
  if (chartAccount.status === 'CLOSED') {
    throw ApiError.conflict('Cannot create a business account under a closed chart account', 'CHART_ACCOUNT_CLOSED');
  }

  const id = await withTransaction(async (transaction) => {
    const serial = await repository.nextSerial(transaction, chartAccount.code);
    const code = chartAccount.code + String(serial).padStart(4, '0');
    return repository.insert(transaction, {
      code, name, ac_id: payload.ac_id, region_id: payload.region_id, city_id: payload.city_id,
      opening_balance: payload.opening_balance, opening_date: payload.opening_date,
    });
  });
  return repository.findById(id);
}

// name/region/city only — ac_id (and therefore code) fixed at creation, same reasoning as
// chartAccounts.service.js#update().
async function update(baId, payload, session) {
  await getForSetup(baId, session);
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  const name = payload.name.trim();

  const opening = validateOpeningPair(payload);
  // Previously dropped silently: the screen showed the opening-balance fields on an existing
  // account, accepted an edit, reported success and changed nothing.
  await repository.update(baId, {
    name, region_id: payload.region_id, city_id: payload.city_id, ...opening,
  });
  return repository.findById(baId);
}

// No hard delete — "removing" means closing (status = 'CLOSED'), excluded from expense-head
// selection lists from then on but history stays intact. Blocked entirely for a party-linked
// account (vendor/customer/employee/bank each own theirs via their own setup screen instead —
// closing it out from under them here would silently break their accounting).
async function remove(baId, session) {
  await getForSetup(baId, session);
  const linked = await repository.isPartyLinked(baId);
  if (linked) {
    throw ApiError.conflict(
      'This account belongs to a vendor, customer, employee, or bank — manage it from that setup screen instead',
      'PARTY_LINKED_ACCOUNT',
    );
  }
  await repository.setStatus(baId, 'CLOSED');
  return { ok: true };
}

async function reactivate(baId, session) {
  await getForSetup(baId, session);
  await repository.setStatus(baId, 'ACTIVE');
  return repository.findById(baId);
}

module.exports = {
  createUnderChartCode, renameLinked, getById, getCashAccount, getByAcId, setOpening, validateOpeningPair,
  list, getForSetup, assertAccessible, create, update, remove, reactivate,
};
