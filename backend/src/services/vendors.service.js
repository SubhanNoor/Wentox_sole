// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/vendors.repository');
const ApiError = require('../errors/ApiError');

// Minimal read used internally by posting logic. Full CRUD lands in Milestone 7.
async function getById(vendorId) {
  const vendor = await repository.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  return vendor;
}

module.exports = { getById };
