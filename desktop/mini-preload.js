// Cửa sổ chat nhỏ (nổi trên cùng): nhận trạng thái hội thoại từ Hộp thư, gửi tin / đổi khách / đóng.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mini', {
  onState: fn => ipcRenderer.on('mini-state', (_e, st) => fn(st)),
  refresh: () => ipcRenderer.invoke('mini-cmd', 'state'),
  send: text => ipcRenderer.invoke('mini-cmd', 'send', String(text || '')),
  open: id => ipcRenderer.invoke('mini-cmd', 'open', String(id || '')),
  win: name => ipcRenderer.send('mini-win', String(name))
});
