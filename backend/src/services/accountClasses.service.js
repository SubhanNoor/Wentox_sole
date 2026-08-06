// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/accountClasses.repository');
const ApiError = require('../errors/ApiError');

// Read-only lookup (UC-15: the 4 classes — ASSETS/LIABILITY/INCOME/EXPENSES — are seeded fixed
// values a group account is filed under; UC-15 only ever SELECTS one, never creates/edits/deletes
// one, so there is no create()/update()/remove() here at all, matching milestones/milestone8.md's
// own "read-only lookup CRUD" description).
function list() {
  return repository.list();
}

async function getById(classId) {
  const accountClass = await repository.findById(classId);
  if (!accountClass) throw ApiError.notFound('Account class not found');
  return accountClass;
}

module.exports = { list, getById };
