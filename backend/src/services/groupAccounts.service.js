// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/groupAccounts.repository');
const accountClassesRepository = require('../repositories/accountClasses.repository');
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
      'This group still has chart accounts filed under it — move or close those first',
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

module.exports = { list, getById, create, update, remove, reactivate };
