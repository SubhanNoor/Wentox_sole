// Tiny request validator: pass a fn(body) that throws ApiError.badRequest(...)
// or returns the cleaned body. Fuller per-feature validation lives in services.
module.exports = function validate(check) {
  return (req, res, next) => {
    try {
      req.body = check(req.body) || req.body;
      next();
    } catch (err) {
      err.status = err.status || 400;
      err.code = err.code || 'VALIDATION';
      next(err);
    }
  };
};
