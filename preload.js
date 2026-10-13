const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loginWithCredentials: (username, password) => ipcRenderer.invoke('auth:login-credentials', { username, password }),
  submit2FACode: (code) => ipcRenderer.invoke('auth:submit-2fa', { code }),
  openWebviewLogin: () => ipcRenderer.invoke('auth:open-webview'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getUserState: () => ipcRenderer.invoke('auth:get-state'),
  
  getGameData: () => ipcRenderer.invoke('data:get-maps-and-agents'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (newConfig) => ipcRenderer.invoke('config:save', newConfig),
  
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),

  onLog: (callback) => ipcRenderer.on('app:log', (_, log) => callback(log)),
  onStatusUpdate: (callback) => ipcRenderer.on('app:status', (_, status) => callback(status)),
  onAuthSuccess: (callback) => ipcRenderer.on('app:auth-success', (_, user) => callback(user)),
  onUpdateAvailable: (callback) => ipcRenderer.on('app:update-available', (_, data) => callback(data)),
});
