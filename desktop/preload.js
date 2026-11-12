// Cầu nối nhỏ cho trang web trong app: mở hộp thư Business Suite ở cột bên, xem phiên bản và cập nhật app.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('metaDesktop', {
  openMetaInbox: url => ipcRenderer.send('open-meta-inbox', String(url)),
  tabChanged: group => ipcRenderer.send('tab-changed', String(group)),
  lookupProfile: args => ipcRenderer.invoke('meta-lookup', args),
  composePost: args => ipcRenderer.invoke('meta-compose', args),
  loginFacebook: args => ipcRenderer.send('fb-login', args),
  lockSettings: () => ipcRenderer.send('app-lock', 'settings'),
  lockNow: () => ipcRenderer.send('app-lock', 'now'),
  lockState: () => ipcRenderer.invoke('lock-state'),
  version: () => ipcRenderer.invoke('app-version'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
