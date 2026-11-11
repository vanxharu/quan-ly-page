// Meta Assistant cho Windows: mở trang web (luôn là bản mới nhất trên GitHub Pages) trong cửa sổ riêng
// và chạy sẵn tiện ích Studio AI (ChatGPT) bên trong, không cần Chrome.
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('path'), crypto = require('crypto');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');

const WEB = process.env.META_ASSISTANT_URL || 'https://vanxharu.github.io/quan-ly-page/';
const EXT = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '../extension/chatgpt-connector');
const ICON = path.join(__dirname, 'icon.png');
// Facebook/Google chặn đăng nhập trong "trình duyệt nhúng": bỏ chữ Electron khỏi User-Agent để giống Chrome.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|meta-assistant)\/\S+/g, '');

// Đăng nhập Facebook / ChatGPT phải mở trong app (cần window.opener); link khác mở bằng trình duyệt mặc định.
const IN_APP = /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|chatgpt\.com|openai\.com|google\.com|live\.com|microsoftonline\.com|apple\.com)\//i;
const inApp = url => url === 'about:blank' || url.startsWith(WEB) || IN_APP.test(url);

// Đăng nhập Facebook bằng trình duyệt mặc định (đã có phiên Facebook, khỏi gõ lại mật khẩu):
// Facebook trả token về desktop-login.html, trang đó mở lại app qua metaassistant://login.
const LOGIN_PAGE = WEB + 'desktop-login.html', PROTOCOL = 'metaassistant';
let loginState = '';
function loginInBrowser(sdkUrl) {
  const u = new URL(sdkUrl), q = new URLSearchParams({ client_id: u.searchParams.get('client_id') || u.searchParams.get('app_id'), redirect_uri: LOGIN_PAGE,
    response_type: 'token', state: loginState = crypto.randomBytes(16).toString('hex') });
  for (const k of ['config_id', 'scope']) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k));
  shell.openExternal(`https://www.facebook.com/v25.0/dialog/oauth?${q}`);
}
function handleDeepLink(link) {
  let u; try { u = new URL(link); } catch { return; }
  const token = u.searchParams.get('access_token');
  // Chỉ nhận token của lượt đăng nhập app vừa mở (state khớp), tránh trang lạ gửi token giả vào app.
  if (!token || !loginState || u.searchParams.get('state') !== loginState || !mainWindow) return;
  loginState = '';
  mainWindow.webContents.executeJavaScript(`localStorage.setItem('fbTok', ${JSON.stringify(token)}); localStorage.setItem('autoLogin', '1'); location.reload();`);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
else app.setAsDefaultProtocolClient(PROTOCOL);

let extensions, mainWindow, studio;
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
    if (/^https:\/\/(www\.)?facebook\.com\/[^?]*dialog\/oauth/i.test(url) && !url.includes(encodeURIComponent(LOGIN_PAGE))) { loginInBrowser(url); return { action: 'deny' }; }
    if (inApp(url)) return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', child => wire(child));
  win.webContents.on('will-navigate', (e, url) => { if (!inApp(url) && /^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); } });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const link = argv.find(a => a.startsWith(PROTOCOL + '://'));
  if (link) return handleDeepLink(link);
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});
app.on('open-url', (e, link) => { e.preventDefault(); handleDeepLink(link); });

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
  try { studio = await (ses.extensions || ses).loadExtension(EXT, { allowFileAccess: true }); }
  catch (e) { console.error('Không nạp được Studio AI:', e); }
  // Studio AI là một phần của app: mở từ menu thay vì từ biểu tượng tiện ích của Chrome.
  const openStudio = () => studio ? newWindow(`chrome-extension://${studio.id}/sidepanel.html`, { width: 450, height: 820 }) : null;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Studio AI', accelerator: 'Ctrl+Shift+A', click: openStudio },
    { label: 'Xem', submenu: [{ role: 'reload', label: 'Tải lại' }, { role: 'forceReload', label: 'Tải lại hết' }, { type: 'separator' },
      { role: 'zoomIn', label: 'Phóng to' }, { role: 'zoomOut', label: 'Thu nhỏ' }, { role: 'resetZoom', label: 'Cỡ gốc' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'Công cụ lỗi' }] },
  ]));
  mainWindow = newWindow(WEB, { autoHideMenuBar: false });
  app.openStudio = openStudio;
  mainWindow.on('closed', () => { mainWindow = null; });
  if (app.isPackaged) require('electron-updater').autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
app.on('window-all-closed', () => app.quit());
