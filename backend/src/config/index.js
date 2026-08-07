require('dotenv').config();

module.exports = {
  db: {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME || 'wentox',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== 'false',
    },
  },
  // Same SQL Server instance/credentials as `db` above — only the database name and physical data
  // file location (from appConfig.getBackupDbFolder(), chosen at install time) differ.
  backupDbName: process.env.BACKUP_DB_NAME || `${process.env.DB_NAME || 'wentox'}_backup`,
};
