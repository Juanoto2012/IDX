const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');
const http = require('http');
const fs = require('fs');

const appVersion = '1.0.0';

let server = null;
let baseDir = '';

function getResourceDir() {
  if (!app.isPackaged) {
    return app.getAppPath();
  }
  const resourcePath = process.resourcesPath || path.join(app.getAppPath(), '..', '..', 'resources');
  const appPath = path.join(resourcePath, 'app');
  if (fs.existsSync(path.join(appPath, 'index.html'))) {
    return appPath;
  }
  return app.getAppPath();
}

function startLocalServer() {
  return new Promise((resolve) => {
    baseDir = getResourceDir();
    server = http.createServer((req, res) => {
      const servePath = req.url === '/' ? '/index.html' : req.url;
      let filePath = path.join(baseDir, servePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'File not found', path: filePath }));
          return;
        }
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, 'localhost', () => {
      const port = server.address().port;
      resolve(port);
    });
  });
}

function stopLocalServer() {
  if (server) server.close();
}

function checkForUpdates() {
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get('https://api.github.com/repos/Juanoto2012/IDX/releases/latest', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            version: parsed.tag_name,
            url: parsed.html_url,
            isUpdate: parsed.tag_name !== appVersion
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

const windowState = {
  x: undefined,
  y: undefined,
  width: 1200,
  height: 800
};

function saveWindowState(win) {
  try {
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      x: win.getPosition()[0],
      y: win.getPosition()[1],
      width: win.getSize()[0],
      height: win.getSize()[1],
      isMaximized: win.isMaximized()
    }));
  } catch (e) {}
}

function loadWindowState() {
  try {
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    if (fs.existsSync(stateFile)) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      Object.assign(windowState, saved);
    }
  } catch (e) {}
}

function createWindow() {
  loadWindowState();
  
  const splash = new BrowserWindow({
    width: 450,
    height: 350,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets/logo.ico')
  });
  splash.loadFile('splash.html');

  startLocalServer().then(port => {
    const win = new BrowserWindow({
      x: windowState.x,
      y: windowState.y,
      width: windowState.width,
      height: windowState.height,
      frame: false,
      show: false,
      icon: path.join(__dirname, 'assets/logo.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    win.loadURL(`http://localhost:${port}/`);

    if (windowState.isMaximized) win.maximize();

    win.once('ready-to-show', () => {
      setTimeout(() => {
        if (!splash.isDestroyed()) splash.close();
        win.show();
      }, 2500);
    });

    win.on('close', () => saveWindowState(win));

    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
    
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.env.HOME || process.env.USERPROFILE,
      env: { ...process.env, LANG: 'es_ES.UTF-8' }
    });

    ipcMain.on('terminal-input', (event, data) => ptyProcess.write(data));
    ptyProcess.onData((data) => win.webContents.send('terminal-output', data));
    ipcMain.on('terminal-resize', (event, size) => ptyProcess.resize(size.cols, size.rows));

    ipcMain.handle('get-os-info', () => ({
      platform: os.platform(),
      release: os.release(),
      type: os.type(),
      shell: shell
    }));

    ipcMain.handle('check-updates', async () => {
      try {
        return await checkForUpdates();
      } catch (e) {
        return { error: e.message, isUpdate: false };
      }
    });
    ipcMain.handle('get-app-version', () => appVersion);
    ipcMain.handle('get-directory-handle', (event, dirPath) => {
      try {
        const savedDir = path.resolve(dirPath);
        if (fs.existsSync(savedDir)) {
          return { name: path.basename(savedDir), path: savedDir };
        }
      } catch (e) {}
      return null;
    });

    ipcMain.on('window-minimize', () => win.minimize());
    ipcMain.on('window-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
    ipcMain.on('window-close', () => win.close());
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopLocalServer();
  if (process.platform !== 'darwin') app.quit();
});