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
  },
  // Same SQL Server instance/credentials as `db` above — only the database name and physical data
  // file location (from appConfig.getBackupDbFolder(), chosen at install time) differ.
  backupDbName: process.env.BACKUP_DB_NAME || `${dbName}_backup`,
};
