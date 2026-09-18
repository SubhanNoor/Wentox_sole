// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/chartAccounts.repository');
const groupAccountsRepository = require('../repositories/groupAccounts.repository');
const businessAccountsRepository = require('../repositories/businessAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

const RESERVED_CODES = new Set(Object.values(CODES));

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (!payload.group_id) throw ApiError.badRequest('group_id is required');
}

// TASK-14/UC-16: is_restricted rows (Cash at Banks, Directors Drawings) are invisible to a
// non-ADMIN session — same restriction reports.service.js#paymentTrail() already applies to those
// same two chart accounts, just enforced here at the list/get level instead of a report bucket.
function list(filters = {}, session) {
  const isAdmin = session?.role === 'ADMIN';
  return repository.list({ ...filters, excludeRestricted: !isAdmin });
}

async function getById(acId, session) {
  const account = await repository.findById(acId);
  if (!account) throw ApiError.notFound('Chart account not found');
  if (account.is_restricted && session?.role !== 'ADMIN') {
    throw ApiError.notFound('Chart account not found');
  }
  return account;
}

// Case-insensitive, scoped to the group (UNIQUE(group_id, name) at the DB level — two different
// groups may legitimately reuse a name).
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const group = await groupAccountsRepository.findById(payload.group_id);
  if (!group) throw ApiError.badRequest('group_id does not exist');

  const duplicate = await repository.findByGroupAndName(payload.group_id, name);
  if (duplicate) throw ApiError.conflict('A chart account with this name already exists under this group', 'DUPLICATE_NAME');

  const id = await withTransaction(async (transaction) => {
    const serial = await repository.nextSerial(transaction, group.code);
    const code = group.code + String(serial).padStart(2, '0');
    return repository.insert(transaction, {
      code, name, group_id: payload.group_id, link_code: payload.link_code,
    });
  });
  return repository.findById(id);
}

// name/link_code only. group_id (and therefore code) is fixed at creation — the code embeds the
// parent group, so re-parenting after the fact would make an already-issued code lie about its
// own hierarchy (§3.2: "the code is stored, not derived ... reorganising the hierarchy later
// cannot silently renumber existing accounts"). status is changed only via remove()/reactivate().
async function update(acId, payload) {
  await getById(acId);
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  const name = payload.name.trim();

  await repository.update(acId, { name, link_code: payload.link_code });
  return repository.findById(acId);
}

// "Removing" a chart account means closing it (status = 'CLOSED', UC-16's own Active/Closed
// field) — excluded from selection lists from then on, but its history stays intact. Reserved
// accounts can never be closed either: closing e.g. CASH_IN_HAND would silently break every CASH
// receipt/expense that resolves it by code. A true hard delete exists too now (per the user,
// 2026-09-17) — see `permanentDelete` below, a separate and stricter action reachable only once a
// chart account is already closed via this function.
async function remove(acId) {
  const account = await getById(acId);
  if (RESERVED_CODES.has(account.code)) {
    throw ApiError.conflict('This is a reserved chart account and cannot be closed', 'RESERVED_ACCOUNT');
  }
  // ACC-02 (changes-14-09-26.md, 2026-09-15): "child accounts" — any business account filed under
  // this chart account — must be dealt with first, same rule groupAccounts.service.js#remove()
  // already applies one level up (chart accounts filed under a group).
  const hasChildren = await repository.hasChildren(acId);
  if (hasChildren) {
    throw ApiError.conflict(
      `${account.name} still has active business accounts filed under it — move or close those first`,
      'CHART_ACCOUNT_HAS_CHILDREN',
    );
  }
  const hasActivity = await repository.hasLedgerActivity(acId);
  if (hasActivity) {
    throw ApiError.conflict(
      `${account.name} has posted ledger transactions and cannot be deleted`,
      'ACCOUNT_HAS_TRANSACTIONS',
    );
  }
  await repository.setStatus(acId, 'CLOSED');
  return { ok: true };
}

async function reactivate(acId) {
  await getById(acId);
  await repository.setStatus(acId, 'ACTIVE');
  return repository.findById(acId);
}

// Permanent delete — per the user, 2026-09-17, added ON TOP OF `remove()` above, not instead of
// it: closing stays the normal, reversible action; this is separate, stricter, and irreversible,
// only reachable for a chart account that is ALREADY closed. `hasAnyReference` is broader than
// `remove()`'s own guards (`hasChildren`/`hasLedgerActivity`, which only ever needed to cover what
// blocks a reversible close) — a hard `DELETE FROM` has to survive every foreign key in the
// schema, including `main_ac_id` on sale bills/stock vouchers that neither existing guard checks.
async function permanentDelete(acId, session) {
  const account = await getById(acId, session);
  if (RESERVED_CODES.has(account.code)) {
    throw ApiError.conflict('This is a reserved chart account and cannot be deleted', 'RESERVED_ACCOUNT');
  }
  // One-step delete (per the user, 2026-09-18: "just one time deletion is fine") — no longer has to
  // be closed first; every in-use check below still applies, so only an unused account can go.
  const closedChildren = await assertPurgeable(account);
  await withTransaction((transaction) => purge(transaction, acId, closedChildren));
  return { ok: true };
}

// Everything a permanent delete of this (closed) chart account would remove, checked up front:
// the chart account itself plus its CLOSED business accounts (per the user, 2026-09-18 — closing
// them and then being refused anyway was the whole complaint). Any ACTIVE business account, or
// anything referencing the chart account or one of those closed children, refuses the lot — and
// names what is in the way instead of a generic "still referenced". Shared with
// groupAccounts.service.js#permanentDelete, which purges whole closed chart accounts the same way.
async function assertPurgeable(account) {
  if (await repository.hasChildren(account.ac_id)) {
    throw ApiError.conflict(
      `${account.name} still has active business accounts filed under it — close those first`,
      'CHART_ACCOUNT_HAS_CHILDREN',
    );
  }
  if (await repository.hasNonChildReference(account.ac_id)) {
    throw ApiError.conflict(
      `${account.name} has posted or draft activity of its own and cannot be permanently deleted`,
      'ACCOUNT_STILL_REFERENCED',
    );
  }
  const closedChildren = await repository.closedChildIds(account.ac_id);
  const inUse = [];
  for (const child of closedChildren) {
    if (await businessAccountsRepository.hasAnyReference(child.ba_id)) inUse.push(child.name);
  }
  if (inUse.length) {
    throw ApiError.conflict(
      `${account.name} cannot be permanently deleted: its closed business account(s) ${inUse.join(', ')} have transactions or are linked to a customer/vendor/employee/bank`,
      'ACCOUNT_STILL_REFERENCED',
    );
  }
  return closedChildren;
}

async function purge(transaction, acId, closedChildren) {
  for (const child of closedChildren) {
    await businessAccountsRepository.hardDelete(transaction, child.ba_id);
  }
  await repository.hardDelete(transaction, acId);
}

module.exports = { list, getById, create, update, remove, reactivate, permanentDelete, assertPurgeable, purge };
