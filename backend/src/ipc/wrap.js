// Wraps an ipc handler's (event, payload) signature down to (payload), and turns thrown errors
// into a plain { message, code } shape so ipcRenderer.invoke's rejection is predictable in the
// renderer — the IPC equivalent of Express's errorHandler middleware.
function wrap(handler) {
  return async (event, payload) => {
    try {
      return await handler(payload, event);
    } catch (err) {
      const error = new Error(err.message || 'Internal error');
      error.code = err.code || 'INTERNAL';
      throw error;
    }
  };
}

module.exports = { wrap };
