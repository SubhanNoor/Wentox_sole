// Service layer: business logic, validation, transactions.
const repository = require('../repositories/stages.repository');

function list() {
  return repository.list();
}

module.exports = { list };
