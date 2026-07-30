const sql = require('mssql');
const config = require('../config');

let poolPromise = null;

function getPool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(config.db).connect();
  return poolPromise;
}

// Runs a parameterized query. `params` is an object of named params:
// query('SELECT * FROM dbo.cities WHERE city_id = @id', { id: { type: sql.Int, value: 5 } })
// Each value may be a plain value (type inferred by mssql) or { type, value } for an explicit sql.* type.
async function query(text, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  applyParams(request, params);
  return request.query(text);
}

// Runs fn(request) inside a transaction; commits on success, rolls back on any thrown error.
// All multi-write operations (bill + items, post/unpost) must use this.
async function withTransaction(fn) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await fn(transaction);
    await transaction.commit();
    return result;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Builds a fresh request bound to a pool or an in-flight transaction, with named params applied.
function requestWithParams(poolOrTransaction, params = {}) {
  const request = poolOrTransaction.request();
  applyParams(request, params);
  return request;
}

function applyParams(request, params) {
  for (const [name, value] of Object.entries(params)) {
    if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
      request.input(name, value.type, value.value);
    } else {
      request.input(name, value);
    }
  }
}

module.exports = { sql, getPool, query, withTransaction, requestWithParams };
