// Provisions/updates the throwaway integration-test database. Not a special case: a test DB is
// just another database name, so this reuses the exact same idempotent migrate()/seed() the real
// app runs on every startup — there is no separate test-only schema to maintain or drift from.
//
// DB_NAME must be set BEFORE requiring src/config (directly or transitively via migrate/seed) —
// config reads process.env.DB_NAME once, synchronously, at require time.
process.env.DB_NAME = process.env.DB_NAME || 'wentox_test';

const migrate = require('../src/db/migrate');
const seed = require('../src/db/seeds/run');

(async () => {
  await migrate();
  await seed();
  console.log(`test database "${process.env.DB_NAME}" ready`);
})().catch((err) => {
  console.error('setup-test-db failed:', err);
  process.exitCode = 1;
});
