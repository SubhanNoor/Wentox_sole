// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/customers.repository');
const ApiError = require('../errors/ApiError');

// Minimal read used internally by posting logic. Full CRUD lands in Milestone 7.
async function getById(customerId) {
  const customer = await repository.findById(customerId);
  if (!customer) throw ApiError.notFound('Customer not found');
  return customer;
}

module.exports = { getById };
