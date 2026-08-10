// Throw from services with a proper HTTP status; errorHandler middleware formats it.
class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
    this.details = details;
  }

  // details, like conflict() below: batch validation needs to say WHICH row failed, and
  // ipc/wrap.js already forwards err.details across the boundary. Without this parameter the
  // { errors: [{ index, message }] } that products.service.js#createBatch and
  // businessAccounts.service.js#createBatch both pass was silently discarded, so a failed batch
  // could only report "one or more rows are invalid" with no way to mark the offending row.
  static badRequest(message, code = 'VALIDATION', details) {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message, 'NOT_FOUND');
  }

  // details: optional plain data the frontend needs to act on the conflict (e.g. the id/name of
  // the inactive row it's colliding with, so it can offer "reactivate this one?").
  static conflict(message, code = 'CONFLICT', details) {
    return new ApiError(409, message, code, details);
  }
}

module.exports = ApiError;
