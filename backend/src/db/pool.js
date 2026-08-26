const sql = require('mssql');
const config = require('../config');

let poolPromise = null;

function getPool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(config.db).connect();
  return poolPromise;
}

// Closes the app's own pooled connections and forgets the singleton, so the NEXT getPool() call
// reconnects fresh. Needed before DDL that requires exclusive access to the whole database (e.g.
// systemReset.service.js's DROP DATABASE) — a pool holding open connections against the database
// being dropped would otherwise block ALTER DATABASE ... SET SINGLE_USER indefinitely. Safe to
// call even if no pool was ever opened.
async function closePool() {
  if (!poolPromise) return;
  const promise = poolPromise;
  poolPromise = null;
  try {
    const pool = await promise;
    await pool.close();
  } catch (err) {
    console.error('closePool: error closing pool (ignored):', err.message);
  }
}

// Set whenever a write transaction commits against the main DB; backup.service reads/clears it to
// decide whether the periodic sync has anything new to copy over. Plain writes via `query()`
// (rare — reads mostly use it) aren't tracked, since every real write in this codebase goes
// through `withTransaction()` per the "Posting" convention in CLAUDE.md.
let dirtySinceLastBackup = false;

function markDirty() {
  dirtySinceLastBackup = true;
}

function consumeDirty() {
  const wasDirty = dirtySinceLastBackup;
  dirtySinceLastBackup = false;
  return wasDirty;
}

// Non-consuming peek — lets a caller decide whether to bother starting a sync at all without
// clearing the flag itself (see backup.service.js#sync(), which only consumes the flag at the
// moment it actually kicks off a NEW run, not when joining an already-in-flight one).
function isDirty() {
  return dirtySinceLastBackup;
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
    markDirty();
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

module.exports = { sql, getPool, closePool, query, withTransaction, requestWithParams, consumeDirty, isDirty };
