// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const bcrypt = require('bcrypt');
const repository = require('../repositories/auth.repository');
const ApiError = require('../errors/ApiError');

const SALT_ROUNDS = 10;

// Verifies credentials and returns the user; does not touch session state — that's the ipc
// layer's job (src/ipc/session.js), so this stays testable without Electron.
async function login(username, password) {
  const user = await repository.findByUsername(username);
  if (!user || !user.is_active) throw ApiError.unauthorized('Invalid username or password');

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) throw ApiError.unauthorized('Invalid username or password');

  return { user_id: user.user_id, username: user.username, role: user.role };
}

// `payload` may include `currentPassword` (required), `username` (optional — rename) and
// `newPassword` (optional). At least one of username/newPassword must actually change something.
async function updateCredentials(userId, payload) {
  const { currentPassword, username, newPassword } = payload;
  const user = await repository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');

  const matches = await bcrypt.compare(currentPassword || '', user.password_hash);
  if (!matches) throw ApiError.unauthorized('Current password is incorrect');

  const updates = {};

  if (username && username !== user.username) {
    const taken = await repository.usernameTaken(username, userId);
    if (taken) throw ApiError.conflict('Username already taken', 'USERNAME_TAKEN');
    updates.username = username;
  }

  if (newPassword) {
    updates.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  }

  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest('Nothing to update');
  }

  await repository.updateCredentials(userId, updates);
  return { username: updates.username || user.username };
}

module.exports = { login, updateCredentials };
