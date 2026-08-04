// Repository layer: SQL only — parameterized queries via mssql named params, no req/res.
// Read-only lookup — the 12 rows are seeded (src/db/seeds/run.js from src/constants/stages.js),
// never created/edited through the app.
const { query } = require('../db/pool');

async function list() {
  const result = await query('SELECT * FROM dbo.stages WHERE is_active = 1 ORDER BY sort_order');
  return result.recordset;
}

module.exports = { list };
