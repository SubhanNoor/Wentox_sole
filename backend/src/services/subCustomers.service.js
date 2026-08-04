// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/subCustomers.repository');
const ApiError = require('../errors/ApiError');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (!payload.region_id) throw ApiError.badRequest('region_id is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(subCustomerId) {
  const subCustomer = await repository.findById(subCustomerId);
  if (!subCustomer) throw ApiError.notFound('Sub-customer not found');
  return subCustomer;
}

// UC-10: independent record — no parent customer, no linked business account. Post-v4.3:
// region_id is required (city_id optional) so Sale Bill/Sale Return can filter this dropdown to
// the selected customer's region (list({ region_id }) — see subCustomers.repository.js). Also
// reachable from the Sale Bill form's inline "+ Add Sub-Customer" flow (same channel, no
// customer-scoping needed since there's no parent to scope under).
// Same as customers.service.js#create: an ACTIVE same-name match never blocks — real people share
// names. Frontend is expected to call checkName() first for its own prompt; create() just creates.
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const id = await repository.insert({ ...payload, name });
  return repository.findById(id);
}

async function update(subCustomerId, payload) {
  await getById(subCustomerId);
  validate(payload);
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.sub_customer_id !== subCustomerId) {
    throw ApiError.conflict('A sub-customer with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(subCustomerId, { ...payload, name });
  return repository.findById(subCustomerId);
}

// Soft delete — is_active = 0, never a hard DELETE (sale_bills.sub_customer_id references this
// row historically).
async function remove(subCustomerId) {
  await getById(subCustomerId);
  await repository.setActive(subCustomerId, false);
  return { ok: true };
}

// See customers.service.js#checkName for the status meanings — identical rule set here.
async function checkName(name) {
  if (!name || !name.trim()) throw ApiError.badRequest('name is required');
  const matches = await repository.findAllByName(name.trim());
  if (matches.length === 0) return { status: 'none', matches: [] };

  const inactive = matches.filter((m) => !m.is_active);
  if (inactive.length > 0) return { status: 'inactive', matches: inactive };

  return { status: 'active', matches };
}

async function reactivate(subCustomerId) {
  const subCustomer = await repository.findById(subCustomerId);
  if (!subCustomer) throw ApiError.notFound('Sub-customer not found');
  await repository.setActive(subCustomerId, true);
  return repository.findById(subCustomerId);
}

module.exports = { list, getById, create, update, remove, checkName, reactivate };
