const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

function createWindow() {
  // 1. Crear Splash Screen
  const splash = new BrowserWindow({
    width: 450,
    height: 350,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets/logo.png')
  });
  splash.loadFile('splash.html');

  // 2. Crear Ventana Principal (oculta inicialmente)
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Ocultamos el marco para usar nuestro título
    show: false,  // No mostrar hasta que cargue
    icon: path.join(__dirname, 'assets/logo.png'), // Icono oficial de Electron
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');

  // 3. Cerrar splash y mostrar app principal cuando esté lista
  win.once('ready-to-show', () => {
    setTimeout(() => {
      if (!splash.isDestroyed()) {
         splash.close();
      }
      win.show();
    }, 2500); // Ligero retraso visual para apreciar la carga
  });

  // --- INTEGRACIÓN DE TERMINAL REAL (NODE-PTY) ---
  // Detectar la shell por defecto (PowerShell en Windows, Bash/Zsh en Unix)
  const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
  
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME || process.env.USERPROFILE,
    env: { ...process.env, LANG: 'es_ES.UTF-8' } // Forzar codificación
  });

  // Comunicación bidireccional Terminal <-> Frontend
  ipcMain.on('terminal-input', (event, data) => ptyProcess.write(data));
  ptyProcess.onData((data) => win.webContents.send('terminal-output', data));
  ipcMain.on('terminal-resize', (event, size) => ptyProcess.resize(size.cols, size.rows));

  // --- OBTENER INFO DEL SISTEMA PARA VENTARYS AI ---
  ipcMain.handle('get-os-info', () => {
    return { 
      platform: os.platform(), 
      release: os.release(), 
      type: os.type(),
      shell: shell 
    };
  });

  // --- CONTROLES DE VENTANA ---
  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on('window-close', () => win.close());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});