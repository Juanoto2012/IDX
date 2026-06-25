const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Controles de ventana
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  
  // Terminal
  terminalInput: (data) => ipcRenderer.send('terminal-input', data),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (event, data) => callback(data)),
  resizeTerminal: (cols, rows) => ipcRenderer.send('terminal-resize', {cols, rows}),
  
  // Info OS
  getOsInfo: () => ipcRenderer.invoke('get-os-info')
});