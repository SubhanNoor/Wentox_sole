# config/ — Configuration

| File | Purpose |
| --- | --- |
| `index.js` | Loads `.env` (via dotenv) and exports typed config: `port`, `databaseUrl`, `jwtSecret`, `jwtExpiry`. Every other file reads config from here — never `process.env` directly. |

See `backend/.env.example` for the expected variables.
