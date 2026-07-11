const jwt = require('jsonwebtoken');
const config = require('../config');

// JWT guard — mounted in routes/index.js after the public auth routes.
module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: { message: 'Missing token', code: 'UNAUTHORIZED' } });
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' } });
  }
};
