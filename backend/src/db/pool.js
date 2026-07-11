const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.databaseUrl });

async function query(text, params) {
  return pool.query(text, params);
}

// Runs fn(client) inside BEGIN/COMMIT; rolls back on any error.
// All multi-write operations (bill + items, post/unpost) must use this.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
