const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  terminalInput: (data) => ipcRenderer.send('terminal-input', data),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (event, data) => callback(data)),
  resizeTerminal: (cols, rows) => ipcRenderer.send('terminal-resize', {cols, rows}),
  spawnTerminal: (cwd) => ipcRenderer.send('terminal-spawn', cwd, true),
  spawnTerminalSilent: (cwd) => ipcRenderer.send('terminal-spawn', cwd, true),
  spawnTerminalVerbose: (cwd) => ipcRenderer.send('terminal-spawn', cwd, false),
  getOsInfo: () => ipcRenderer.invoke('get-os-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getDirectoryHandle: (path) => ipcRenderer.invoke('get-directory-handle', path),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  quitApp: () => ipcRenderer.send('quit-app'),
  applyUpdate: (data) => ipcRenderer.invoke('apply-update', data),
  pathJoin: (...segments) => ipcRenderer.invoke('path-join', ...segments),
  pathBasename: (filePath) => ipcRenderer.invoke('path-basename', filePath),
  checkGitBranch: (dirPath) => ipcRenderer.invoke('check-git-branch', dirPath),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body)
});
