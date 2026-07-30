// Wraps an ipc handler's (event, payload) signature down to (payload), and normalizes its outcome
// into a resolve-always { ok: true, data } | { ok: false, error: { message, code } } shape.
//
// This never throws back to ipcRenderer.invoke on purpose: Electron only preserves a thrown
// Error's `.message` when it crosses from ipcMain.handle into the renderer's rejected promise —
// custom properties like ApiError's `.code` are silently dropped. Resolving instead of throwing
// sidesteps that: the full { message, code } shape survives because it's plain serializable data,
// not an Error instance.
const ApiError = require('../errors/ApiError');

function wrap(handler) {
  return async (event, payload) => {
    try {
      const data = await handler(payload, event);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof ApiError) {
        return { ok: false, error: { message: err.message, code: err.code } };
      }
      // Not a business error we threw on purpose (e.g. a raw mssql/Tedious driver error) — log the
      // full detail here, but never let it reach the renderer: driver errors carry their own .code
      // (ESOCKET, ETIMEOUT, ELOGIN...) and messages with host/port/driver internals in them.
      console.error(err);
      return { ok: false, error: { message: 'Internal error', code: 'INTERNAL' } };
    }
  };
}

module.exports = { wrap };
