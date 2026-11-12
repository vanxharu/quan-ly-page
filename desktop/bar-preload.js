// Thanh nhỏ trên cột phải: gửi lệnh ẩn / thu nhỏ / mở rộng / kéo đổi độ rộng cho app.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bar', { cmd: (name, value) => ipcRenderer.send('side-bar', String(name), Number(value) || 0) });
