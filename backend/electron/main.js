const path = require('path');
const { app, BrowserWindow } = require('electron');
const { start } = require('../src/server');
const config = require('../src/config');

let server;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL); // dev: Vite server
  } else {
    win.loadFile(path.join(__dirname, '../../frontend/dist/index.html')); // prod: built frontend
  }
}

app.whenReady().then(() => {
  server = start(config.port); // local Express API on 127.0.0.1
  createWindow();
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
