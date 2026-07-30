# config/ — Configuration

| File | Purpose |
| --- | --- |
| `index.js` | Loads `.env` (via dotenv) and exports typed config: `db` (server/port/database/user/password/options for the `mssql` `ConnectionPool`). No port/JWT settings — there's no HTTP server or bearer token in this architecture. Every other file reads config from here — never `process.env` directly. |

See `backend/.env` for the expected variables.
