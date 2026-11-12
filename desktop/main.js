// Meta Assistant cho Windows: mở trang web (luôn là bản mới nhất trên GitHub Pages) trong cửa sổ riêng
// và chạy sẵn tiện ích Studio AI (ChatGPT) bên trong, không cần Chrome.
const { app, BaseWindow, BrowserWindow, Menu, WebContentsView, ipcMain, session, shell } = require('electron');
const path = require('path'), crypto = require('crypto');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { createMetaAuto } = require('./meta-auto');

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
  pageView.webContents.executeJavaScript(`localStorage.setItem('fbTok', ${JSON.stringify(token)}); localStorage.setItem('autoLogin', '1'); location.reload();`);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
else app.setAsDefaultProtocolClient(PROTOCOL);

let extensions, mainWindow, pageView, panelView, metaView, side = 'studio', group = '', studio; // side: cột phải 'studio' | 'meta' | ''; group: nhóm tab đang mở trên trang
function newWindow(url, opts = {}) {
  const win = new BrowserWindow({ width: 1280, height: 860, icon: ICON, autoHideMenuBar: true, show: false, ...opts,
    webPreferences: { sandbox: true, contextIsolation: true } });
  wire(win.webContents, win);
  win.once('ready-to-show', () => win.show());
  if (url) win.loadURL(url);
  return win;
}
function wire(wc, win, asTab = true) {
  if (asTab) extensions.addTab(wc, win);
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?facebook\.com\/[^?]*dialog\/oauth/i.test(url) && !url.includes(encodeURIComponent(LOGIN_PAGE))) { loginInBrowser(url); return { action: 'deny' }; }
    if (inApp(url)) return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', child => wire(child.webContents, child));
  wc.on('will-navigate', (e, url) => { if (!inApp(url) && /^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); } });
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
    createWindow: details => {
      if (String(details.url).endsWith('/sidepanel.html') && mainWindow) { app.toggleStudio(true); mainWindow.focus(); return mainWindow; }
      return newWindow(details.url, { width: details.width || 450, height: details.height || 820 });
    },
    removeWindow: win => { if (!win.isDestroyed()) win.close(); },
  });
  try { studio = await (ses.extensions || ses).loadExtension(EXT, { allowFileAccess: true }); }
  catch (e) { console.error('Không nạp được Studio AI:', e); }
  // Một cửa sổ: trang web bên trái, Studio AI luôn nằm kế bên phải (thay cho bảng bên của Chrome).
  mainWindow = new BaseWindow({ width: 1440, height: 880, icon: ICON, title: `Meta Assistant ${app.getVersion()}` });
  // Khung ẩn để đọc Business Suite: avatar + UID khách.
  // Cửa sổ vẽ ngầm (offscreen): vẫn chạy cuộn / tải thêm như trang thật nhưng không hiện ra.
  const worker = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  worker.webContents.setFrameRate(10);
  pageView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'preload.js') } });
  panelView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  mainWindow.contentView.addChildView(pageView);
  metaView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  mainWindow.contentView.addChildView(panelView);
  mainWindow.contentView.addChildView(metaView);
  // Độ rộng cột phải (tỉ lệ cửa sổ), nhớ giữa các lần mở app.
  const LAYOUT_FILE = path.join(app.getPath('userData'), 'layout.json');
  let widths = { studio: 0.32, meta: 0.45 };
  try { widths = { ...widths, ...JSON.parse(require('fs').readFileSync(LAYOUT_FILE, 'utf8')) }; } catch {}
  const saveWidths = () => { try { require('fs').writeFileSync(LAYOUT_FILE, JSON.stringify(widths)); } catch {} };
  const BAR = 30;
  const bar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'bar-preload.js') } });
  mainWindow.contentView.addChildView(bar);
  let cur = '';
  const layout = () => {
    const { width, height } = mainWindow.getContentBounds();
    // Studio AI chỉ hiện khi đang ở nhóm Đăng bài.
    cur = side === 'studio' && (group !== 'publishing' || !studio) ? '' : side;
    const w = cur ? Math.round(Math.min(0.8, Math.max(0.2, widths[cur])) * width) : 0;
    pageView.setBounds({ x: 0, y: 0, width: width - w, height });
    bar.setBounds(cur ? { x: width - w, y: 0, width: w, height: BAR } : { x: width, y: 0, width: 0, height: 0 });
    for (const [name, v] of [['studio', panelView], ['meta', metaView]]) v.setBounds(cur === name ? { x: width - w, y: BAR, width: w, height: height - BAR } : { x: width, y: 0, width: 0, height: 0 });
    const title = cur === 'meta' ? 'Hộp thư Meta' : cur === 'studio' ? 'Studio AI' : '';
    if (title && bar.webContents.__title !== title) { bar.webContents.__title = title; bar.webContents.loadFile(path.join(__dirname, 'bar.html'), { query: { t: title } }); }
  };
  mainWindow.on('resize', layout);
  wire(pageView.webContents, mainWindow);
  wire(panelView.webContents, mainWindow, false);
  wire(metaView.webContents, mainWindow, false);
  pageView.webContents.loadURL(WEB);
  if (studio) panelView.webContents.loadURL(`chrome-extension://${studio.id}/sidepanel.html`);
  const fromPage = e => e.sender === pageView.webContents;
  let dragFrom = null;
  ipcMain.on('side-bar', (e, name, x) => {
    if (e.sender !== bar.webContents || !cur) return;
    const width = mainWindow.getContentBounds().width;
    if (name === 'close') { side = ''; layout(); return; }
    if (name === 'narrow' || name === 'wide') widths[cur] = Math.min(0.8, Math.max(0.2, widths[cur] + (name === 'wide' ? 0.05 : -0.05)));
    else if (name === 'drag-start') dragFrom = { x, ratio: widths[cur] };
    else if (name === 'drag' && dragFrom) widths[cur] = Math.min(0.8, Math.max(0.2, dragFrom.ratio + (dragFrom.x - x) / width));
    else if (name === 'drag-end') dragFrom = null;
    layout();
    if (name !== 'drag') saveWidths();
  });
  const show = (name, open) => { side = (typeof open === 'boolean' ? open : side !== name) ? name : ''; layout(); };
  const toggleStudio = open => show('studio', open);
  const openMetaInbox = url => {
    if (!/^https:\/\/business\.facebook\.com\/latest\/inbox/.test(url)) return;
    if (metaView.webContents.getURL() !== url) metaView.webContents.loadURL(url);
    show('meta', true);
  };
  const auto = createMetaAuto({ worker, metaView, showMeta: () => show('meta', true) });
  worker.webContents.setAudioMuted(true);
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ipcMain.handle('meta-lookup', (e, args) => fromPage(e) ? auto.lookupProfile(args || {}) : { error: 'denied' });
  ipcMain.handle('meta-compose', (e, args) => fromPage(e) ? auto.composePost(args || {}) : { error: 'denied' });
  ipcMain.on('tab-changed', (e, g) => { if (e.sender === pageView.webContents) { group = String(g); layout(); } });
  ipcMain.on('open-meta-inbox', (e, url) => { if (e.sender === pageView.webContents) openMetaInbox(url); });
  // Cập nhật: kiểm tra GitHub Releases, tải về, rồi khởi động lại để cài khi người dùng bấm.
  let updater = null, downloaded = '';
  const getUpdater = () => {
    if (!updater) { updater = require('electron-updater').autoUpdater; updater.autoInstallOnAppQuit = true; updater.on('update-downloaded', info => { downloaded = info.version; }); }
    return updater;
  };
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-check', async e => {
    if (!fromPage(e)) return { state: 'denied' };
    if (!app.isPackaged) return { state: 'dev' };
    if (downloaded) return { state: 'ready', version: downloaded };
    const r = await getUpdater().checkForUpdates();
    const v = r?.updateInfo?.version;
    if (!v || v === app.getVersion() || !r.downloadPromise) return { state: 'latest' };
    await r.downloadPromise;
    return { state: 'ready', version: v };
  });
  // Cài im lặng rồi tự mở lại app: không hiện trình cài đặt, không phải bấm Next.
  ipcMain.handle('update-install', e => { if (fromPage(e) && downloaded) getUpdater().quitAndInstall(true, true); });
  layout();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Studio AI', accelerator: 'Ctrl+Shift+A', click: () => toggleStudio() },
    { label: 'Hộp thư Meta', accelerator: 'Ctrl+Shift+M', click: () => { if (!metaView.webContents.getURL()) metaView.webContents.loadURL('https://business.facebook.com/latest/inbox/all'); show('meta'); } },
    { label: 'Xem', submenu: [
      { label: 'Tải lại', accelerator: 'F5', click: () => pageView.webContents.reload() },
      { label: 'Tải lại Studio AI', click: () => panelView.webContents.reload() },
      { label: 'Tải lại hộp thư Meta', click: () => metaView.webContents.reload() },
      // Lưu trang Business Suite mà app vừa đọc (khung ẩn) + cột Hộp thư Meta ra Desktop, để sửa cách đọc avatar/UID theo giao diện thật.
      { label: 'Lưu chẩn đoán Business Suite', click: async () => {
        const dir = app.getPath('desktop'), stamp = new Date().toISOString().replace(/[:.]/g, '-');
        for (const [name, v] of [['an', worker], ['cot-phai', metaView]]) {
          const wc = v.webContents; if (!wc.getURL()) continue;
          const html = await wc.executeJavaScript('location.href + "\\n" + document.documentElement.outerHTML').catch(e => String(e));
          require('fs').writeFileSync(path.join(dir, `meta-assistant-chan-doan-${name}-${stamp}.html`), html);
          const img = await wc.capturePage().catch(() => null);
          if (img) require('fs').writeFileSync(path.join(dir, `meta-assistant-chan-doan-${name}-${stamp}.png`), img.toPNG());
        }
        shell.openPath(dir);
      } }, { type: 'separator' },
      { label: 'Phóng to', accelerator: 'Ctrl+=', click: () => pageView.webContents.setZoomLevel(pageView.webContents.getZoomLevel() + 0.5) },
      { label: 'Thu nhỏ', accelerator: 'Ctrl+-', click: () => pageView.webContents.setZoomLevel(pageView.webContents.getZoomLevel() - 0.5) },
      { label: 'Cỡ gốc', accelerator: 'Ctrl+0', click: () => pageView.webContents.setZoomLevel(0) }, { type: 'separator' },
      { label: 'Công cụ lỗi', accelerator: 'F12', click: () => pageView.webContents.toggleDevTools() }] },
  ]));
  app.toggleStudio = toggleStudio; app.views = { page: pageView, panel: panelView, meta: metaView, worker, bar };
  mainWindow.on('closed', () => { mainWindow = null; if (!worker.isDestroyed()) worker.destroy(); app.quit(); });
  if (app.isPackaged) getUpdater().checkForUpdatesAndNotify().catch(() => {});
});
app.on('window-all-closed', () => app.quit());
