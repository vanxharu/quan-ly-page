// Cầu nối nhỏ cho trang web trong app: chỉ cho phép mở hộp thư Business Suite ở cột bên.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('metaDesktop', { openMetaInbox: url => ipcRenderer.send('open-meta-inbox', String(url)) });
