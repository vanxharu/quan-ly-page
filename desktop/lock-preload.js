const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lockApi', {
  state: () => ipcRenderer.invoke('lock-state'),
  unlock: pw => ipcRenderer.invoke('lock-unlock', String(pw)),
  save: v => ipcRenderer.invoke('lock-save', v),
  cancel: () => ipcRenderer.invoke('lock-cancel'),
  reset: () => ipcRenderer.invoke('lock-reset'),
});
