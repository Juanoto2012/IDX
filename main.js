const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');
const http = require('http');
const fs = require('fs');

const appVersion = '1.0.1';
const REPO_RELEASE_URL = 'https://api.github.com/repos/Juanoto2012/Ventarys-IDX/releases/latest';

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
    https.get(REPO_RELEASE_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const currentParts = appVersion.replace('v', '').split('.').map(Number);
          const latestParts = (parsed.tag_name || 'v1.0.0').replace('v', '').split('.').map(Number);
          
          let isNewer = false;
          for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
            const c = currentParts[i] || 0;
            const l = latestParts[i] || 0;
            if (l > c) { isNewer = true; break; }
            if (l < c) break;
          }
          
          resolve({
            version: parsed.tag_name,
            url: parsed.html_url,
            downloadUrl: parsed.assets?.find(a => a.name.endsWith('.exe'))?.browser_download_url || null,
            isUpdate: isNewer
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
    
    // Track the current pty process so we can kill and respawn it
    let currentPtyProcess = null;

    function createPty(cwd) {
      if (currentPtyProcess) {
        try { currentPtyProcess.kill(); } catch(e) {}
      }
      currentPtyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: cwd || (process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH),
        env: { ...process.env, LANG: 'es_ES.UTF-8' }
      });
      return currentPtyProcess;
    }

    let ptyProcess = createPty();

    ipcMain.on('terminal-input', (event, data) => {
      if (currentPtyProcess) currentPtyProcess.write(data);
    });
    ipcMain.on('terminal-spawn', (event, cwd, silent = false) => {
      if (!cwd || typeof cwd !== 'string') {
        cwd = os.homedir();
      }
      cwd = cwd.replace(/\//g, '\\');
      if (!require('fs').existsSync(cwd)) {
        cwd = os.homedir();
      }
      if (currentPtyProcess) {
        try { currentPtyProcess.kill(); } catch(e) {}
      }
      try {
        currentPtyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
          cwd: cwd,
          env: { ...process.env, LANG: 'es_ES.UTF-8' }
        });
        currentPtyProcess.onData((data) => win.webContents.send('terminal-output', data));
      } catch (e) {
        currentPtyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
          cwd: os.homedir(),
          env: { ...process.env, LANG: 'es_ES.UTF-8' }
        });
        currentPtyProcess.onData((data) => win.webContents.send('terminal-output', data));
      }
    });
    ipcMain.on('terminal-resize', (event, size) => {
      if (currentPtyProcess) currentPtyProcess.resize(size.cols, size.rows);
    });
    
    // Initial pty data handler
    ptyProcess.onData((data) => win.webContents.send('terminal-output', data));

    ipcMain.handle('get-os-info', () => ({
      platform: os.platform(),
      release: os.release(),
      type: os.type(),
      shell: shell
    }));

    ipcMain.handle('show-notification', (event, title, body) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body, silent: false });
      notification.on('click', () => {
        if (win.isMinimized()) win.restore();
        win.focus();
      });
      notification.show();
    });

    ipcMain.handle('check-updates', async () => {
      try {
        return await checkForUpdates();
      } catch (e) {
        return { error: e.message, isUpdate: false };
      }
    });
    
    // Handle portable update installation
    ipcMain.handle('apply-update', async (event, { downloadUrl, version }) => {
      const { dialog } = require('electron');
      const os = require('os');
      const fs = require('fs');
      const path = require('path');
      const https = require('https');
      
      try {
        const tempExePath = path.join(os.tmpdir(), `Ventarys_Update_${version}.exe`);
        const currentExePath = process.execPath;
        const currentDir = path.dirname(currentExePath);
        
        // Download the update
        await new Promise((resolve, reject) => {
          https.get(downloadUrl, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
              https.get(res.headers.location, res2 => {
                res2.pipe(fs.createWriteStream(tempExePath)).on('finish', resolve);
              }).on('error', reject);
            } else {
              res.pipe(fs.createWriteStream(tempExePath)).on('finish', resolve);
            }
          }).on('error', reject);
        });
        
        // Create batch script for update
        const batPath = path.join(os.tmpdir(), `update_ventarys_${Date.now()}.bat`);
        const batContent = `@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion
echo Waiting for Ventarys to close...
timeout /t 3 /nobreak > nul
copy /Y "${tempExePath}" "${currentExePath}" > nul
del "${tempExePath}" > nul
start "" "${currentExePath}"
del "%~f0"
`.trim();
        
        fs.writeFileSync(batPath, batContent, 'utf8');
        
        // Launch batch script detached
        require('child_process').spawn('cmd.exe', ['/c', batPath], {
          detached: true,
          stdio: 'ignore'
        }).unref();
        
        // Quit the app
        setTimeout(() => app.quit(), 1000);
        
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
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
    
    ipcMain.handle('open-folder-dialog', async () => {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory']
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    });
    
    ipcMain.handle('list-directory', (event, dirPath) => {
      try {
        const resolved = path.resolve(dirPath);
        if (!fs.existsSync(resolved)) return { error: 'Directory not found' };
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        return entries.map(e => ({
          name: e.name,
          isFile: e.isFile(),
          isDirectory: e.isDirectory()
        }));
      } catch (e) {
        return { error: e.message };
      }
    });
    
    ipcMain.handle('read-file', (event, filePath) => {
      try {
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) return { error: 'File not found' };
        return { content: fs.readFileSync(resolved, 'utf8') };
      } catch (e) {
        return { error: e.message };
      }
    });
    
    ipcMain.handle('write-file', (event, filePath, content) => {
      try {
        const resolved = path.resolve(filePath);
        fs.writeFileSync(resolved, content, 'utf8');
        return { success: true };
      } catch (e) {
        return { error: e.message };
      }
    });

    ipcMain.handle('path-join', (event, ...segments) => {
      return path.join(...segments);
    });

    ipcMain.handle('path-basename', (event, filePath) => {
      return path.basename(filePath);
    });

    ipcMain.handle('check-git-branch', (event, dirPath) => {
      try {
        const resolved = path.resolve(dirPath);
        const gitDirPath = path.join(resolved, '.git');
        if (!fs.existsSync(gitDirPath)) {
          return { isGitRepo: false, branch: null };
        }
        const headPath = path.join(gitDirPath, 'HEAD');
        if (fs.existsSync(headPath)) {
          const headText = fs.readFileSync(headPath, 'utf8');
          const branchMatch = headText.match(/refs\/heads\/(.*)/);
          const branch = branchMatch ? branchMatch[1].trim() : 'detached';
          return { isGitRepo: true, branch };
        }
        return { isGitRepo: false, branch: null };
      } catch (e) {
        return { isGitRepo: false, branch: null };
      }
    });

    ipcMain.handle('get-git-branch', (event, dirPath) => {
      try {
        const resolved = path.resolve(dirPath);
        const gitDirPath = path.join(resolved, '.git');
        if (!fs.existsSync(gitDirPath)) {
          return { isGitRepo: false, branch: null };
        }
        const headPath = path.join(gitDirPath, 'HEAD');
        if (fs.existsSync(headPath)) {
          const headText = fs.readFileSync(headPath, 'utf8');
          const branchMatch = headText.match(/refs\/heads\/(.*)/);
          const branch = branchMatch ? branchMatch[1].trim() : 'detached';
          return { isGitRepo: true, branch };
        }
        return { isGitRepo: false, branch: null };
      } catch (e) {
        return { isGitRepo: false, branch: null };
      }
    });

    ipcMain.on('window-minimize', () => win.minimize());
    ipcMain.on('window-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
    ipcMain.on('window-close', () => win.close());
    ipcMain.on('quit-app', () => {
      setTimeout(() => app.quit(), 500);
    });
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