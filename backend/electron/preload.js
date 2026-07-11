const { contextBridge } = require('electron');

// The renderer talks to the backend over HTTP (http://127.0.0.1:<port>/api).
// Expose only the API base URL; no Node APIs cross the bridge.
contextBridge.exposeInMainWorld('wentox', {
  apiBaseUrl: `http://127.0.0.1:${process.env.PORT || 4000}`,
});
