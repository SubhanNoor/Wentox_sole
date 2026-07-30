// Tiny payload validator for ipc handlers: pass a fn(payload) that throws ApiError.badRequest(...)
// or returns the cleaned payload. Fuller per-feature validation lives in services.
function validate(payload, check) {
  return check(payload) || payload;
}

module.exports = { validate };
