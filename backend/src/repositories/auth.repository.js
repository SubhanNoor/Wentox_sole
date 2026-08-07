// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { query, sql } = require('../db/pool');

async function findByUsername(username) {
  const result = await query(
    `SELECT user_id, username, password_hash, role, is_active
     FROM dbo.users
     WHERE username = @username`,
    { username: { type: sql.VarChar, value: username } },
  );
  return result.recordset[0] || null;
}

async function findById(userId) {
  const result = await query(
    `SELECT user_id, username, password_hash, role, is_active
     FROM dbo.users
     WHERE user_id = @userId`,
    { userId: { type: sql.Int, value: userId } },
  );
  return result.recordset[0] || null;
}

async function usernameTaken(username, excludingUserId) {
  const result = await query(
    `SELECT 1 FROM dbo.users
     WHERE username = @username AND user_id <> @excludingUserId`,
    {
      username: { type: sql.VarChar, value: username },
      excludingUserId: { type: sql.Int, value: excludingUserId },
    },
  );
  return result.recordset.length > 0;
}

async function insertUser({ username, passwordHash, fullName, role }) {
  const result = await query(
    `INSERT INTO dbo.users (username, password_hash, full_name, role)
     OUTPUT INSERTED.user_id, INSERTED.username, INSERTED.full_name, INSERTED.role, INSERTED.is_active
     VALUES (@username, @passwordHash, @fullName, @role)`,
    {
      username: { type: sql.VarChar, value: username },
      passwordHash: { type: sql.VarChar, value: passwordHash },
      fullName: { type: sql.NVarChar, value: fullName },
      role: { type: sql.VarChar, value: role },
    },
  );
  return result.recordset[0];
}

async function listUsers() {
  const result = await query(
    `SELECT user_id, username, full_name, role, is_active, created_at
     FROM dbo.users
     ORDER BY user_id`,
    {},
  );
  return result.recordset;
}

// `updates` may contain `username` and/or `passwordHash` — only the provided fields are written.
async function updateCredentials(userId, updates) {
  const sets = [];
  const params = { userId: { type: sql.Int, value: userId } };

  if (updates.username !== undefined) {
    sets.push('username = @username');
    params.username = { type: sql.VarChar, value: updates.username };
  }
  if (updates.passwordHash !== undefined) {
    sets.push('password_hash = @passwordHash');
    params.passwordHash = { type: sql.VarChar, value: updates.passwordHash };
  }
  if (sets.length === 0) return;

  await query(`UPDATE dbo.users SET ${sets.join(', ')} WHERE user_id = @userId`, params);
}

module.exports = { findByUsername, findById, usernameTaken, updateCredentials, insertUser, listUsers };
