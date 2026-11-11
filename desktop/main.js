// Meta Assistant cho Windows: mở trang web (luôn là bản mới nhất trên GitHub Pages) trong cửa sổ riêng
// và chạy sẵn tiện ích Studio AI (ChatGPT) bên trong, không cần Chrome.
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');

const WEB = process.env.META_ASSISTANT_URL || 'https://vanxharu.github.io/quan-ly-page/';
const EXT = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '../extension/chatgpt-connector');
const ICON = path.join(__dirname, 'icon.png');
// Facebook/Google chặn đăng nhập trong "trình duyệt nhúng": bỏ chữ Electron khỏi User-Agent để giống Chrome.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|meta-assistant)\/\S+/g, '');

// Đăng nhập Facebook / ChatGPT phải mở trong app (cần window.opener); link khác mở bằng trình duyệt mặc định.
const IN_APP = /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|chatgpt\.com|openai\.com|google\.com|live\.com|microsoftonline\.com|apple\.com)\//i;
const inApp = url => url === 'about:blank' || url.startsWith(WEB) || IN_APP.test(url);

let extensions, mainWindow;
function newWindow(url, opts = {}) {
  const win = new BrowserWindow({ width: 1280, height: 860, icon: ICON, autoHideMenuBar: true, show: false, ...opts,
    webPreferences: { sandbox: true, contextIsolation: true } });
  wire(win);
  win.once('ready-to-show', () => win.show());
  if (url) win.loadURL(url);
  return win;
}
function wire(win) {
  extensions.addTab(win.webContents, win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inApp(url)) return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', child => wire(child));
  win.webContents.on('will-navigate', (e, url) => { if (!inApp(url) && /^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); } });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  // Thay cho declarativeNetRequest (Electron không có): cho phép nhúng khung ChatGPT trong Studio AI.
  ses.webRequest.onHeadersReceived({ urls: ['https://chatgpt.com/*'] }, (d, done) => {
    if (d.resourceType !== 'subFrame') return done({});
    const headers = Object.fromEntries(Object.entries(d.responseHeaders || {}).filter(([k]) => !/^(x-frame-options|frame-options|content-security-policy)$/i.test(k)));
    done({ responseHeaders: headers });
  });
  extensions = new ElectronChromeExtensions({
    session: ses,
    createTab: details => { const win = newWindow(details.url || WEB); return [win.webContents, win]; },
    selectTab: (_wc, win) => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); },
    removeTab: (_wc, win) => { if (!win.isDestroyed()) win.close(); },
    createWindow: details => newWindow(details.url, { width: details.width || 450, height: details.height || 820 }),
    removeWindow: win => { if (!win.isDestroyed()) win.close(); },
  });
  try { await (ses.extensions || ses).loadExtension(EXT, { allowFileAccess: true }); }
  catch (e) { console.error('Không nạp được Studio AI:', e); }
  mainWindow = newWindow(WEB);
  mainWindow.on('closed', () => { mainWindow = null; });
  if (app.isPackaged) require('electron-updater').autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
app.on('window-all-closed', () => app.quit());
