const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(cors({ origin: true })); // local Electron renderer / Vite dev server
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./routes')); // central router: routes/index.js

app.use(errorHandler);

module.exports = app;
