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

// Re-verifies the current session user's password without changing session state — used to gate
// sensitive actions (e.g. editing/posting a sale bill or return) that require re-entering the
// password mid-session, distinct from login (which establishes the session) and
// updateCredentials (which changes it).
async function verifyPassword(userId, password) {
  const user = await repository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');

  const matches = await bcrypt.compare(password || '', user.password_hash);
  if (!matches) throw ApiError.unauthorized('Incorrect password');

  return { ok: true };
}

// Admin-only (enforced by the ipc layer via requireRole('ADMIN')) — creates a new login. `role` is
// never taken from the caller: this only ever creates limited-access USER accounts.
async function createUser(payload) {
  const { username, password, fullName } = payload;
  if (!username || !username.trim()) throw ApiError.badRequest('Username is required');
  if (!password) throw ApiError.badRequest('Password is required');

  const existing = await repository.findByUsername(username.trim());
  if (existing) throw ApiError.conflict('Username already taken', 'USERNAME_TAKEN');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  return repository.insertUser({
    username: username.trim(),
    passwordHash,
    fullName: fullName || null,
    role: 'USER',
  });
}

async function listUsers() {
  return repository.listUsers();
}

// Admin-only. Deactivating is this app's only "delete" (matches the soft-delete convention used
// everywhere else — vendors, customers, products, etc. — never a hard DELETE). Two footguns guarded
// against: an admin locking themselves out, and deactivating the last active admin, which would
// leave nobody able to log in and undo it.
async function setUserActive(targetUserId, isActive, currentUserId) {
  const user = await repository.findById(targetUserId);
  if (!user) throw ApiError.notFound('User not found');

  if (!isActive) {
    if (targetUserId === currentUserId) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }
    if (user.role === 'ADMIN') {
      const activeAdmins = await repository.countActiveAdmins();
      if (activeAdmins <= 1) {
        throw ApiError.badRequest('Cannot deactivate the last active admin account');
      }
    }
  }

  await repository.setActive(targetUserId, isActive);
  return { ok: true };
}

// Admin-only, resets ANOTHER user's password directly — unlike updateCredentials(), this never
// checks the target's current password (the admin isn't the one who'd know it).
async function resetPassword(targetUserId, newPassword) {
  if (!newPassword) throw ApiError.badRequest('New password is required');
  const user = await repository.findById(targetUserId);
  if (!user) throw ApiError.notFound('User not found');

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await repository.updateCredentials(targetUserId, { passwordHash });
  return { ok: true };
}

module.exports = {
  login, updateCredentials, verifyPassword, createUser, listUsers, setUserActive, resetPassword,
};
