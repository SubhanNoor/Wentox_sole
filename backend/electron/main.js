const path = require('path');
const { app, BrowserWindow } = require('electron');
const registerIpcHandlers = require('../src/ipc');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL); // dev: Vite server
  } else {
    win.loadFile(path.join(__dirname, '../../frontend/dist/index.html')); // prod: built frontend
  }
}

app.whenReady().then(() => {
  registerIpcHandlers(); // every ipcMain.handle channel must exist before the renderer can call one
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
