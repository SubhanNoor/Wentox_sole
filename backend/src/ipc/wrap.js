// Wraps an ipc handler's (event, payload) signature down to (payload), and normalizes its outcome
// into a resolve-always { ok: true, data } | { ok: false, error: { message, code } } shape.
//
// This never throws back to ipcRenderer.invoke on purpose: Electron only preserves a thrown
// Error's `.message` when it crosses from ipcMain.handle into the renderer's rejected promise —
// custom properties like ApiError's `.code` are silently dropped. Resolving instead of throwing
// sidesteps that: the full { message, code } shape survives because it's plain serializable data,
// not an Error instance.
const ApiError = require('../errors/ApiError');
const { isTransientConnectionError } = require('../db/pool');

// A packaged install keeps no log file, so a bare "Internal error" on a production screenshot was
// untraceable (2026-09-18, the external-backup folder picker). Append a SHORT, safe reference: the
// error's type and code, plus — for a file-system error only — the operation and path. Never the
// message itself, which for a driver error can carry host/port/connection details (see below).
function internalMessage(err) {
  const parts = [];
  if (err && err.name && err.name !== 'Error') parts.push(err.name);
  if (err && typeof err.code === 'string') parts.push(err.code);
  if (err && err.syscall && err.path) parts.push(`${err.syscall} ${err.path}`);
  return parts.length ? `Internal error (${parts.join(' · ')})` : 'Internal error';
}

function wrap(handler) {
  return async (event, payload) => {
    try {
      const data = await handler(payload, event);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof ApiError) {
        return { ok: false, error: { message: err.message, code: err.code, details: err.details } };
      }
      // Not a business error we threw on purpose (e.g. a raw mssql/Tedious driver error) — log the
      // full detail here, but never let it reach the renderer: driver errors carry their own .code
      // (ESOCKET, ETIMEOUT, ELOGIN...) and messages with host/port/driver internals in them.
      console.error(err);
      // A lost/refused database connection is not an "internal error" to the person using the app —
      // it is a machine state they can act on (2026-09-23). The pool already retried and reconnected
      // before this point, so reaching here means SQL Server really is unreachable right now.
      if (isTransientConnectionError(err)) {
        return {
          ok: false,
          code: 'DB_UNREACHABLE',
          error: {
            message: 'Cannot reach the database right now. If the PC has just started, SQL Server may still be starting up — wait a few seconds and try again. If it keeps happening, check that the SQL Server service is running.',
            code: 'DB_UNREACHABLE',
          },
        };
      }
      return { ok: false, error: { message: internalMessage(err), code: 'INTERNAL' } };
    }
  };
}

module.exports = { wrap };
