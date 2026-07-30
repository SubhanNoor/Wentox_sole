// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftSaleBills.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

module.exports = {};
