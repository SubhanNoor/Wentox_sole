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

// Next value from a SQL Server SEQUENCE, inside an in-flight transaction. `sequenceName` is always
// a hardcoded literal from the calling repository (e.g. 'dbo.seq_sale_bill_no'), never user input.
//
// Exists because `NEXT VALUE FOR` cannot appear inside ISNULL/COALESCE/CASE/IIF/NULLIF — SQL Server
// rejects it outright ("NEXT VALUE FOR function cannot be used within CASE, CHOOSE, COALESCE, IIF,
// ISNULL and NULLIF"). The system_no columns (migration 031) need exactly that shape — a genuinely
// new draft gets a fresh sequence value, one carried over from confirm/unconfirm does not — so the
// choice is made here in JS instead: resolve the value first, then bind it as a plain parameter.
//
// Deliberately never reused once issued (per the user, 2026-09-07: gaps from a deleted document are
// acceptable, but a deleted number being handed to a DIFFERENT later document is not — a number a
// customer was quoted must stay retired). A brief gap-reuse version existed for one iteration and
// was reverted; deletedDocumentNumbers.repository.js instead records a deleted number so the gap can
// still be shown (not silently skipped) when browsing.
async function nextSequenceValue(transaction, sequenceName) {
  const result = await requestWithParams(transaction).query(`SELECT NEXT VALUE FOR ${sequenceName} AS n`);
  return result.recordset[0].n;
}

// Serializes a "SELECT MAX(existing serial)+1, then INSERT" code-allocation pattern under the
// SAME transaction, so a second concurrent transaction wanting the same resourceName blocks until
// the first commits (or rolls back) instead of computing the same next value and colliding on
// INSERT. @LockOwner = 'Transaction' auto-releases the lock at commit/rollback — no explicit
// sp_releaseapplock needed.
//
// This is a genuine, easily-reproduced race, not a theoretical one: 8 concurrent
// customersService.create() calls against the same reserved chart account produced 6 UNIQUE KEY
// violations out of 8 (2026-09-20) — businessAccounts/chartAccounts/groupAccounts/products
// repositories' own nextSerial()/nextCode()/nextBatchNo() functions all had this gap. The
// document-number columns (sale bill/return, purchase/return, journal voucher system_no) already
// solved the same problem a different way — real SQL Server SEQUENCE objects (migration 031/035)
// — but a SEQUENCE is a fixed, statically-named object, a poor fit for these codes, which are
// scoped per parent (per chart code, per class digit, per vendor) rather than one fixed counter.
//
// resourceName MUST distinguish every independently-numbered scope (e.g. one lock per chart code,
// not one lock for the whole table) — otherwise unrelated concurrent creates would serialize
// against each other for no reason. Always a hardcoded prefix + a real id/code, never user input.
async function acquireAppLock(transaction, resourceName) {
  const request = requestWithParams(transaction, { resource: { type: sql.NVarChar(128), value: resourceName } });
  await request.query(`
    DECLARE @lockResult INT;
    EXEC @lockResult = sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000;
    IF @lockResult < 0
      THROW 51000, 'Could not acquire an allocation lock in time — another save for the same code range is still in progress', 1;
  `);
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

module.exports = {
  sql, getPool, closePool, query, withTransaction, requestWithParams, nextSequenceValue, acquireAppLock,
  consumeDirty, isDirty,
};
