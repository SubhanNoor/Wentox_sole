// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/groupAccounts.repository');
const accountClassesRepository = require('../repositories/accountClasses.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const chartAccountsService = require('./chartAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

// §3.2's group code is <classDigit><3-digit serial> — matches the already-seeded 1000/2000/3000/
// 4000 (src/db/seeds/run.js), one digit per account_classes.code. Not stored anywhere else, since
// account_classes itself has no numeric column — this is the one place the mapping needs to live.
const CLASS_DIGITS = { ASSETS: '1', LIABILITY: '2', INCOME: '3', EXPENSES: '4' };

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (!payload.class_id) throw ApiError.badRequest('class_id is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(groupId) {
  const group = await repository.findById(groupId);
  if (!group) throw ApiError.notFound('Group account not found');
  return group;
}

// Case-insensitive name collision, reactivate-instead-of-reject on an inactive match — same
// pattern as regions.service.js#create().
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const existing = await repository.findByName(name);
  if (existing) {
    if (existing.is_active) {
      throw ApiError.conflict('A group account with this name already exists', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive group account with this name already exists',
      'INACTIVE_DUPLICATE',
      { group_id: existing.group_id, name: existing.name },
    );
  }

  const accountClass = await accountClassesRepository.findById(payload.class_id);
  if (!accountClass) throw ApiError.badRequest('class_id does not exist');
  const classDigit = CLASS_DIGITS[accountClass.code];
  if (!classDigit) throw new Error(`No code digit mapped for account class '${accountClass.code}'`);

  const id = await withTransaction(async (transaction) => {
    const serial = await repository.nextSerial(transaction, classDigit);
    const code = classDigit + String(serial).padStart(3, '0');
    return repository.insert(transaction, { code, name, class_id: payload.class_id, sorting: payload.sorting });
  });
  return repository.findById(id);
}

// name/sorting only — class_id (and therefore code) is fixed at creation, same reasoning as
// chartAccounts.service.js#update(): the code embeds the parent, so re-parenting after the fact
// would make an already-issued code lie about its own hierarchy.
async function update(groupId, payload) {
  await getById(groupId);
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.group_id !== groupId) {
    throw ApiError.conflict('A group account with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(groupId, { name, sorting: payload.sorting });
  return repository.findById(groupId);
}

// Soft delete — is_active = 0. Blocked while any chart account is still filed under this group.
async function remove(groupId) {
  await getById(groupId);
  const referenced = await repository.isReferenced(groupId);
  if (referenced) {
    throw ApiError.conflict(
      'This group still has active chart accounts filed under it — move or close those first',
      'GROUP_IN_USE',
    );
  }
  await repository.setActive(groupId, false);
  return { ok: true };
}

async function reactivate(groupId) {
  await getById(groupId);
  await repository.setActive(groupId, true);
  return repository.findById(groupId);
}

// Permanent delete — per the user, 2026-09-17, added on top of remove() above, not instead of it:
// deactivating stays the normal, reversible action; this is separate, stricter, and irreversible,
// only reachable for a group already deactivated. `hasAnyReference` is broader than isReferenced()
// (which only ever needed to cover a directly-filed chart account) — it also catches a business
// account resolved transitively through this group's chart accounts.
async function permanentDelete(groupId) {
  const group = await getById(groupId);
  // One-step delete (per the user, 2026-09-18: "just one time deletion is fine") — no longer has to
  // be closed first; every in-use check below still applies, so only an unused account can go.
  // Its CLOSED chart accounts (and their closed business accounts) go with it — per the user,
  // 2026-09-18. Each is checked exactly as a standalone chart-account permanent delete would be;
  // any active child anywhere below, or anything in use, refuses the whole operation.
  if (await repository.isReferenced(groupId)) {
    throw ApiError.conflict(
      `${group.name} still has active chart accounts filed under it — close those first`,
      'GROUP_IN_USE',
    );
  }
  const closedCharts = await repository.closedChartIds(groupId);
  const plan = [];
  for (const { ac_id: acId } of closedCharts) {
    const chart = await chartAccountsRepository.findById(acId);
    plan.push({ acId, children: await chartAccountsService.assertPurgeable(chart) });
  }
  await withTransaction(async (transaction) => {
    for (const { acId, children } of plan) await chartAccountsService.purge(transaction, acId, children);
    await repository.hardDelete(transaction, groupId);
  });
  return { ok: true };
}

module.exports = { list, getById, create, update, remove, reactivate, permanentDelete };
