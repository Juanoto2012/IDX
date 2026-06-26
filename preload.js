const { invoke } = window.__TAURI__?.tauri || {};

window.electronAPI = {
  minimize: () => invoke('window_minimize'),
  maximize: () => invoke('window_maximize'),
  close: () => invoke('window_close'),
  terminalInput: (data) => invoke('terminal_input', { data }),
  onTerminalOutput: (callback) => {},
  resizeTerminal: (cols, rows) => invoke('terminal_resize', { cols, rows }),
  getOsInfo: () => invoke('get_os_info'),
  checkForUpdates: () => invoke('check_updates'),
  getAppVersion: () => invoke('get_app_version')
};