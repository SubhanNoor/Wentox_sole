const app = require('./app');
const config = require('./config');

function start(port = config.port) {
  return app.listen(port, '127.0.0.1', () => {
    console.log(`Wentox API listening on http://127.0.0.1:${port}`);
  });
}

if (require.main === module) start();

module.exports = { start }; // imported by electron/main.js
