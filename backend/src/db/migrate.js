const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (rowCount > 0) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`failed ${file}:`, err.message);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

migrate();
