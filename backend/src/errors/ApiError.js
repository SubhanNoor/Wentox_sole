// Throw from services with a proper HTTP status; errorHandler middleware formats it.
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }

  static badRequest(message, code = 'VALIDATION') {
    return new ApiError(400, message, code);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message, 'NOT_FOUND');
  }

  static conflict(message, code = 'CONFLICT') {
    return new ApiError(409, message, code);
  }
}

module.exports = ApiError;
