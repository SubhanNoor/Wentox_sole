// In-memory session. Renderer and main process are one OS process tree, not client/server over a
// network, so there's no bearer token to verify — "logged in" is just state held here, set by
// auth:login and cleared by auth:logout or app quit. This is the IPC equivalent of the old JWT
// middleware: any handler that requires a logged-in user calls requireSession()/requireRole() first.
const ApiError = require('../errors/ApiError');

let session = null;

function login(user) {
  session = { userId: user.user_id, username: user.username, role: user.role };
  return session;
}

function logout() {
  session = null;
}

function current() {
  return session;
}

function requireSession() {
  if (!session) throw ApiError.unauthorized('Not logged in');
  return session;
}

function requireRole(role) {
  const active = requireSession();
  if (active.role !== role) throw ApiError.unauthorized(`Requires ${role} role`);
  return active;
}

module.exports = { login, logout, current, requireSession, requireRole };
