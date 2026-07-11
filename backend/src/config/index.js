require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/wentox',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  jwtExpiry: process.env.JWT_EXPIRY || '12h',
};
