const sql = require('mssql');
const config = require('../config');

let poolPromise = null;

// ── Connection resilience (2026-09-23) ───────────────────────────────────────────────────────
// "Internal error (ConnectionError · ESOCKET)" kept coming back, most often at login. Three
// separate faults, all here:
//
//   1. A FAILED first connect was cached forever. `poolPromise` held the rejected promise, so every
//      later call got the same failure until the app was restarted. Logging in right after the PC
//      boots hits this constantly: Electron starts before the SQL Server service finishes starting,
//      the first connect fails, and the app is then permanently broken for that session.
//   2. A DROPPED connection was never recycled. A socket idled out by Windows/the network stayed in
//      the pool and the next query died on it.
//   3. No retry anywhere, so any single blip surfaced as a hard error to the user.
//
// Now: a failed connect is never cached, connecting retries with backoff (covers a service still
// starting), a pool that errors is discarded so the next call reconnects, and a query that fails on
// a dead connection is retried once on a fresh pool.

const CONNECT_ATTEMPTS = 5;
const CONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

// Faults that mean "the connection is gone", not "your SQL is wrong" — only these are retried.
const TRANSIENT_CODES = new Set(['ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ETIMEOUT', 'ENOCONN']);
function isTransientConnectionError(err) {
  if (!err) return false;
  if (TRANSIENT_CODES.has(err.code)) return true;
  return /connection is closed|connection lost|socket hang up|not connected|closed the connection/i
    .test(err.message || '');
}

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function connectWithRetry() {
  let lastError;
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    try {
      const pool = await new sql.ConnectionPool(config.db).connect();
      // A pool-level error (server restarted, cable pulled) must not leave a dead pool cached.
      pool.on('error', (err) => {
        console.error('SQL pool error — dropping the pool so the next call reconnects:', err.message);
        if (poolPromise) { poolPromise = null; pool.close().catch(() => {}); }
      });
      return pool;
    } catch (err) {
      lastError = err;
      if (!isTransientConnectionError(err) || attempt === CONNECT_ATTEMPTS - 1) break;
      console.error(`SQL connect attempt ${attempt + 1} failed (${err.code || err.message}) — retrying…`);
      await delay(CONNECT_BACKOFF_MS[attempt]);
    }
  }
  throw lastError;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = connectWithRetry().catch((err) => {
      // Never cache a rejection — the next caller gets a fresh attempt (fault 1 above).
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// ── Keep-alive heartbeat ─────────────────────────────────────────────────────────────────────
// Reconnecting when a user hits a dead connection still costs that user a failed action. The
// heartbeat instead proves the connection every 20s and repairs it in the background, so by the
// time anyone presses Login the pool is already good. TCP keep-alive (tedious, 30s) stops an idle
// socket being dropped in the first place; this catches everything it cannot — the SQL Server
// service restarting, a laptop waking from sleep, a network that dropped while the app sat idle.
const HEARTBEAT_INTERVAL_MS = 20000;
let heartbeatTimer = null;

async function pingDatabase() {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
}

// Connects (retrying) and confirms the connection actually answers. Called once at startup so the
// app waits for a still-starting SQL Server instead of failing the first login against it.
async function ensureConnected() {
  return withConnectionRetry(pingDatabase);
}

function startHeartbeat(intervalMs = HEARTBEAT_INTERVAL_MS) {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    try {
      await pingDatabase();
    } catch (err) {
      console.error('Heartbeat: database did not answer — reconnecting:', err.code || err.message);
      await discardPool();
      // Re-open straight away rather than waiting for the next user action to pay for it.
      try {
        await ensureConnected();
        console.error('Heartbeat: reconnected.');
      } catch (reconnectErr) {
        console.error('Heartbeat: reconnect failed, will try again next tick:', reconnectErr.code || reconnectErr.message);
      }
    }
  }, intervalMs);
  // Never hold the process open just for the heartbeat.
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// Throws away the current pool so the next getPool() dials a new connection.
async function discardPool() {
  const promise = poolPromise;
  poolPromise = null;
  if (!promise) return;
  try {
    const pool = await promise;
    await pool.close();
  } catch {
    // Already broken — nothing to close.
  }
}

// Runs `fn`, and on a dead-connection failure reconnects and runs it exactly once more. Only for
// work that is safe to repeat: a single query, or a transaction that never got as far as begin().
async function withConnectionRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientConnectionError(err)) throw err;
    console.error('SQL connection lost — reconnecting and retrying once:', err.code || err.message);
    await discardPool();
    return fn();
  }
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
  return withConnectionRetry(async () => {
    const pool = await getPool();
    const request = pool.request();
    applyParams(request, params);
    return request.query(text);
  });
}

// Runs fn(request) inside a transaction; commits on success, rolls back on any thrown error.
// All multi-write operations (bill + items, post/unpost) must use this.
async function withTransaction(fn) {
  // Retry covers ONLY getting a connection and starting the transaction — never the body. Once
  // begin() succeeds, work may have been written, and re-running it could post the same document
  // twice; a failure from there on is reported as-is.
  const transaction = await withConnectionRetry(async () => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    return tx;
  });
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
  isTransientConnectionError, ensureConnected, startHeartbeat, stopHeartbeat,
  consumeDirty, isDirty,
};
