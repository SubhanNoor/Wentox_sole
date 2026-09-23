require('dotenv').config();
const { getDbConnection } = require('./appConfig');

// A packaged install never ships `.env` — it's a dev-only file (and shouldn't carry a real shop
// PC's SQL Server password in git either way). Prefer the connection details the NSIS installer's
// custom page wrote to app-config.json (see build/installer.nsh); fall back to `.env` only when
// that file doesn't exist, i.e. every dev checkout — this is what makes it safe for local dev,
// nothing here changes for anyone still running off `.env`.
const installedDb = getDbConnection();

const dbName = installedDb?.database || process.env.DB_NAME || 'wentox';

module.exports = {
  db: {
    server: installedDb?.server || process.env.DB_SERVER || 'localhost',
    port: parseInt(installedDb?.port || process.env.DB_PORT || '1433', 10),
    database: dbName,
    user: installedDb?.user || process.env.DB_USER || 'sa',
    password: installedDb?.password || process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== 'false',
    },
    // Connection resilience (2026-09-23, after repeated "Internal error (ConnectionError · ESOCKET)"
    // at login). Defaults were: 15s connect, 15s request, a pool that keeps idle sockets forever.
    // A socket idle for minutes gets dropped by Windows/the network, and the next query fails with
    // ESOCKET — so idle ones are retired by us first, and a slow-starting SQL Server service (the
    // usual case right after a PC boots, which is exactly when someone logs in) gets longer to
    // answer before the attempt is called a failure.
    connectionTimeout: 30000,
    requestTimeout: 60000,
    pool: {
      max: 10,
      // min 1: one connection stays open for the life of the app and is re-created by the pool the
      // moment it dies, so there is always a live connection waiting rather than one dialled on
      // demand at the exact moment someone presses Login (per the user, 2026-09-23: "make a
      // mechanism that the db never gets disconnected").
      min: 1,
      idleTimeoutMillis: 60000,
    },
  },
  // Same SQL Server instance/credentials as `db` above — only the database name and physical data
  // file location (from appConfig.getBackupDbFolder(), chosen at install time) differ.
  backupDbName: process.env.BACKUP_DB_NAME || `${dbName}_backup`,
};
