// Meta Assistant cho Windows: mở trang web (luôn là bản mới nhất trên GitHub Pages) trong cửa sổ riêng
// và chạy sẵn tiện ích Studio AI (ChatGPT) bên trong, không cần Chrome.
const { app, BaseWindow, BrowserWindow, Menu, WebContentsView, ipcMain, session, shell } = require('electron');
const path = require('path'), crypto = require('crypto');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { createMetaAuto } = require('./meta-auto');
const { setupLock } = require('./app-lock');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const WEB = process.env.META_ASSISTANT_URL || 'https://vanxharu.github.io/quan-ly-page/';
const EXT = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '../extension/chatgpt-connector');
const ICON = path.join(__dirname, 'icon.png');
// Facebook/Google chặn đăng nhập trong "trình duyệt nhúng": bỏ chữ Electron khỏi User-Agent để giống Chrome.
// Tên app (file exe, shortcut, tiêu đề) là "Get Helps" nhưng dữ liệu (đăng nhập, mật khẩu khoá, Studio AI…) vẫn ở thư mục cũ.
app.setPath('userData', path.join(app.getPath('appData'), 'Meta Assistant'));
app.setAppUserModelId('com.vanxharu.metaassistant'); // biểu tượng + nhóm đúng trên taskbar Windows
// Windows tự "cho ngủ" cửa sổ bị app khác che kín hoặc bị thu nhỏ (đúng lúc app tự khoá) → ChatGPT trong Studio AI
// ngừng vẽ/đếm giờ và lượt tạo bài, tạo ảnh bị treo. Tắt hẳn để chạy ngầm như khi đang mở.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling');
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|meta-assistant)\/\S+/g, '');

// Đăng nhập Facebook / ChatGPT phải mở trong app (cần window.opener); link khác mở bằng trình duyệt mặc định.
const IN_APP = /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|chatgpt\.com|openai\.com|google\.com|live\.com|microsoftonline\.com|apple\.com)\//i;
const inApp = url => url === 'about:blank' || url.startsWith(WEB) || IN_APP.test(url);

// Đăng nhập Facebook (API) ngay trong cột Meta của app: dùng chung phiên bạn đã đăng nhập Business Suite ở đó,
// bạn tự bấm Tiếp tục; Facebook trả token về desktop-login.html, trang đó chuyển sang metaassistant://login và app bắt lại.
const LOGIN_PAGE = WEB + 'desktop-login.html', PROTOCOL = 'metaassistant';
let loginState = '';
let openLoginPane = () => {}, afterLogin = () => {};
function loginInBrowser(sdkUrl) {
  const u = new URL(sdkUrl), q = new URLSearchParams({ client_id: u.searchParams.get('client_id') || u.searchParams.get('app_id'), redirect_uri: LOGIN_PAGE,
    response_type: 'token', state: loginState = crypto.randomBytes(16).toString('hex') });
  for (const k of ['config_id', 'scope']) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k));
  openLoginPane(`https://www.facebook.com/v25.0/dialog/oauth?${q}`);
}
function handleDeepLink(link) {
  let u; try { u = new URL(link); } catch { return; }
  const token = u.searchParams.get('access_token');
  // Chỉ nhận token của lượt đăng nhập app vừa mở (state khớp), tránh trang lạ gửi token giả vào app.
  if (!token || !loginState || u.searchParams.get('state') !== loginState || !mainWindow) return;
  loginState = '';
  pageView.webContents.executeJavaScript(`localStorage.setItem('fbTok', ${JSON.stringify(token)}); localStorage.setItem('autoLogin', '1'); location.reload();`);
  metaView.webContents.loadURL('https://business.facebook.com/latest/inbox/all').catch(() => {});
  afterLogin(); afterLogin = () => {};
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
// Bản cũ (1.0.1–1.0.12) đăng ký metaassistant:// với Windows để đăng nhập qua Chrome; giờ không dùng nữa.
app.removeAsDefaultProtocolClient(PROTOCOL);

let extensions, mainWindow, pageView, panelView, metaView, zaloView, side = 'studio', group = '', studio; // side: cột phải 'studio' | 'meta' | ''; group: nhóm tab đang mở trên trang
function newWindow(url, opts = {}) {
  const win = new BrowserWindow({ width: 1280, height: 860, icon: ICON, autoHideMenuBar: true, show: false, ...opts,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
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
  wc.on('did-create-window', child => wire(child.webContents, child, child.webContents.session === session.defaultSession));
  // Bắt token ngay khi Facebook chuyển về desktop-login.html#access_token=… (chuyển hướng máy chủ hoặc trang tự chuyển).
  const catchLogin = (e, url) => {
    if (url.startsWith(PROTOCOL + '://')) { e?.preventDefault?.(); handleDeepLink(url); return true; }
    if (url.startsWith(LOGIN_PAGE) && url.includes('#')) {
      const q = new URLSearchParams(url.split('#')[1]);
      if (q.get('access_token')) { e?.preventDefault?.(); handleDeepLink(`${PROTOCOL}://login?` + new URLSearchParams({ access_token: q.get('access_token'), state: q.get('state') || '' })); return true; }
    }
    return false;
  };
  wc.on('will-redirect', (e, url) => { catchLogin(e, url); });
  wc.on('did-navigate', (_e, url) => { catchLogin(null, url); });
  wc.on('did-navigate-in-page', (_e, url) => { catchLogin(null, url); });
  wc.on('will-navigate', (e, url) => {
    if (catchLogin(e, url)) return;
    if (!inApp(url) && /^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
// Trang có "bạn có muốn rời trang?" (Business Suite đang soạn bài…) không được chặn app thoát: chặn thì bộ cập nhật không ghi đè được file.
app.on('web-contents-created', (_e, wc) => wc.on('will-prevent-unload', ev => ev.preventDefault()));
app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

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
  try {
    const exts = ses.extensions || ses;
    studio = await exts.loadExtension(EXT, { allowFileAccess: true });
    // Electron giữ service worker cũ của tiện ích nếu cùng số phiên bản → code mới của Studio AI không chạy.
    // Mã của tiện ích đổi (so băm các file .js) thì xoá service worker đã lưu rồi nạp lại. Dữ liệu chrome.storage (bản nháp) giữ nguyên.
    const fs = require('fs'), stamp = path.join(app.getPath('userData'), 'studio-code.txt');
    const digest = require('crypto').createHash('sha1').update(fs.readdirSync(EXT).filter(f => f.endsWith('.js') || f === 'manifest.json').sort().map(f => fs.readFileSync(path.join(EXT, f))).join('\n')).digest('hex');
    let old = ''; try { old = fs.readFileSync(stamp, 'utf8'); } catch {}
    if (old !== digest) {
      exts.removeExtension(studio.id);
      await ses.clearStorageData({ origin: `chrome-extension://${studio.id}`, storages: ['serviceworkers', 'cachestorage'] }).catch(() => {});
      studio = await exts.loadExtension(EXT, { allowFileAccess: true });
      fs.writeFileSync(stamp, digest);
    }
  }
  catch (e) { console.error('Không nạp được Studio AI:', e); }
  // Một cửa sổ: trang web bên trái, Studio AI luôn nằm kế bên phải (thay cho bảng bên của Chrome).
  mainWindow = new BaseWindow({ width: 1440, height: 880, icon: ICON, title: 'Get Helps' });
  // Ẩn thanh menu cho gọn (bấm Alt để hiện); các phím tắt Ctrl+Shift+A / Ctrl+Shift+M vẫn dùng được.
  mainWindow.setAutoHideMenuBar(true); mainWindow.setMenuBarVisibility(false);
  // Khung ẩn để đọc Business Suite: avatar + UID khách.
  // Cửa sổ vẽ ngầm (offscreen): vẫn chạy cuộn / tải thêm như trang thật nhưng không hiện ra.
  // Business Suite chạy trong phiên riêng (persist:meta): phiên mặc định có script của tiện ích Studio AI gắn vào mọi trang,
  // làm trình soạn Business Suite lỗi (invariant #23746, mất ô văn bản). Cột Meta + 2 cửa sổ ngầm dùng chung phiên này.
  const META = 'persist:meta', metaSes = session.fromPartition(META);
  const worker = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: META, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  worker.webContents.setFrameRate(10);
  // Cửa sổ vẽ ngầm thứ hai cho trình soạn bài (đăng ngay không cần hiện cột Meta); tách khỏi khung đọc avatar để không giẫm nhau.
  const composer = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: META, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  composer.webContents.setFrameRate(10);
  composer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // backgroundThrottling: false — thu nhỏ / khoá app vẫn chạy ngầm đúng nhịp (tải tin, báo tin, lên lịch, Studio AI tạo ảnh).
  pageView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') } });
  panelView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  mainWindow.contentView.addChildView(pageView);
  metaView = new WebContentsView({ webPreferences: { partition: META, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  // Business Suite trong Electron báo lỗi (invariant #23746) và không dựng ô viết bài. UA đã bỏ chữ Electron nhưng
  // "client hints" (navigator.userAgentData, sec-ch-ua) vẫn thiếu thương hiệu Google Chrome → Facebook nhận là trình duyệt lạ.
  // Dùng DevTools Protocol giả đầy đủ Chrome cho cột Meta + 2 cửa sổ ngầm (áp dụng cho mọi lần tải trang sau đó).
  const chromeMajor = process.versions.chrome.split('.')[0];
  const asChrome = async wc => {
    try {
      if (!wc.getURL()) await wc.loadURL('about:blank'); // chưa có trang thì lệnh DevTools không trả lời
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const brands = [{ brand: 'Google Chrome', version: chromeMajor }, { brand: 'Chromium', version: chromeMajor }, { brand: 'Not_A Brand', version: '24' }];
      await wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: app.userAgentFallback, platform: 'Win32', acceptLanguage: 'vi-VN,vi;q=0.9,en;q=0.8',
        userAgentMetadata: { brands, fullVersionList: brands.map(b => ({ ...b, version: b.brand === 'Not_A Brand' ? '24.0.0.0' : process.versions.chrome })),
          platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false } });
    } catch (e) { console.error('Không giả Chrome được cho Business Suite:', e.message); }
  };
  // Zalo cá nhân (không có API): chạy Zalo Web trong cột riêng, phiên đăng nhập riêng (quét QR một lần, app giữ đăng nhập).
  const ZALO = 'persist:zalo', zaloSes = session.fromPartition(ZALO);
  zaloSes.setUserAgent(app.userAgentFallback);
  zaloView = new WebContentsView({ webPreferences: { partition: ZALO, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  for (const wc of [metaView.webContents, worker.webContents, composer.webContents, zaloView.webContents]) await asChrome(wc);
  mainWindow.contentView.addChildView(panelView);
  mainWindow.contentView.addChildView(metaView);
  mainWindow.contentView.addChildView(zaloView);
  // Độ rộng cột phải (tỉ lệ cửa sổ), nhớ giữa các lần mở app.
  const LAYOUT_FILE = path.join(app.getPath('userData'), 'layout.json');
  let widths = { studio: 0.32, meta: 0.45, zalo: 0.45 };
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
    for (const [name, v] of [['studio', panelView], ['meta', metaView], ['zalo', zaloView]]) v.setBounds(cur === name ? { x: width - w, y: BAR, width: w, height: height - BAR } : { x: width, y: 0, width: 0, height: 0 });
    const title = cur === 'meta' ? 'Hộp thư Meta' : cur === 'studio' ? 'Studio AI' : cur === 'zalo' ? 'Zalo' : '';
    if (title && bar.webContents.__title !== title) { bar.webContents.__title = title; bar.webContents.loadFile(path.join(__dirname, 'bar.html'), { query: { t: title } }); }
  };
  mainWindow.on('resize', layout);
  wire(pageView.webContents, mainWindow);
  wire(panelView.webContents, mainWindow, false);
  wire(metaView.webContents, mainWindow, false);
  wire(zaloView.webContents, mainWindow, false);
  // Luôn lấy index.html mới (GitHub Pages cho trình duyệt giữ bản cũ ~10 phút → trang chạy code cũ sau mỗi lần cập nhật web).
  pageView.webContents.loadURL(WEB, { extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n' });
  if (studio) panelView.webContents.loadURL(`chrome-extension://${studio.id}/sidepanel.html?desktop=1`);
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
  // Mở cột Meta tạm thời; hàm trả về đưa cột về như trước (ẩn lại nếu trước đó đang ẩn).
  const showMetaTemp = () => {
    const prev = side; show('meta', true);
    return () => { if (side === 'meta' && prev !== 'meta') { side = prev; layout(); if (prev !== 'meta') metaView.webContents.loadURL('https://business.facebook.com/latest/inbox/all').catch(() => {}); } };
  };
  openLoginPane = url => { afterLogin = showMetaTemp(); metaView.webContents.loadURL(url).catch(() => {}); mainWindow.focus(); };
  // Chưa đăng nhập Facebook trong app: mở trang đăng nhập Business Suite ở cột phải ngay khi khởi động.
  metaSes.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' }).then(c => {
    if (c.length) return;
    metaView.webContents.loadURL('https://business.facebook.com/latest/inbox/all').catch(() => {});
    show('meta', true);
  }).catch(() => {});
  const openZalo = () => { if (!zaloView.webContents.getURL().startsWith('https://chat.zalo.me')) zaloView.webContents.loadURL('https://chat.zalo.me/').catch(() => {}); show('zalo', true); };
  ipcMain.on('open-zalo', e => { if (fromPage(e)) openZalo(); });
  const openMetaInbox = url => {
    if (!/^https:\/\/business\.facebook\.com\/latest\/inbox/.test(url)) return;
    if (metaView.webContents.getURL() !== url) metaView.webContents.loadURL(url);
    show('meta', true);
  };
  // Ghi lỗi JavaScript của Business Suite (cột Meta + cửa sổ soạn ngầm) để chẩn đoán vì sao ô văn bản không hiện.
  const consoleLog = [];
  for (const [name, wc] of [['cot-phai', metaView.webContents], ['soan-ngam', composer.webContents]])
    wc.on('console-message', (e) => { const lvl = e.level ?? ''; if (!['error', 'warning', 2, 3].includes(lvl)) return; consoleLog.push(`[${new Date().toISOString()}] ${name} ${lvl}: ${String(e.message).slice(0, 500)} (${e.sourceId || ''}:${e.lineNumber || ''})`); if (consoleLog.length > 300) consoleLog.shift(); });
  const auto = createMetaAuto({ worker, composer, metaView, showMeta: showMetaTemp, metaShown: () => side === 'meta',
    progress: data => pageView.webContents.executeJavaScript(`window.App?.composeProgress?.(${JSON.stringify(data)})`).catch(() => {}),
    notify: msg => pageView.webContents.executeJavaScript(`typeof toast === 'function' && toast(${JSON.stringify(msg)}, 30000)`).catch(() => {}) });
  worker.webContents.setAudioMuted(true);
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ipcMain.handle('meta-lookup', (e, args) => fromPage(e) ? auto.lookupProfile(args || {}) : { error: 'denied' });
  ipcMain.handle('meta-thread-read', (e, args) => fromPage(e) ? auto.readThread(args || {}) : { error: 'denied' });
  ipcMain.handle('meta-thread-send', (e, args) => fromPage(e) ? auto.sendThread(args || {}) : { error: 'denied' });
  ipcMain.handle('meta-threads', (e, args) => fromPage(e) ? auto.listThreads(args || {}) : { error: 'denied' });
  // Mở đúng hội thoại trong cột Meta: tải hộp thư của Page rồi bấm vào dòng của khách (UID).
  ipcMain.handle('meta-open-thread', async (e, { pageId, uid } = {}) => {
    if (!fromPage(e) || !/^\d+$/.test(String(pageId)) || !/^\d+$/.test(String(uid))) return false;
    openMetaInbox(`https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&mailbox_id=${pageId}`);
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const ok = await metaView.webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-maiba-contact-id="${uid}"]'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`).catch(() => false);
      if (ok) return true;
    }
    return false;
  });
  ipcMain.handle('meta-compose', (e, args) => fromPage(e) ? auto.composePost(args || {}) : { error: 'denied' });
  ipcMain.on('fb-login', (e, a) => {
    if (!fromPage(e) || !/^\d+$/.test(String(a?.appId))) return;
    loginInBrowser(`https://www.facebook.com/dialog/oauth?client_id=${a.appId}${/^\d+$/.test(String(a.configId)) ? `&config_id=${a.configId}` : ''}`);
  });
  // Token Facebook trong app chỉ sống ~1–2 giờ. Xin token mới ngầm: mở hộp thoại đăng nhập trong khung ẩn dùng phiên Facebook
  // của cột Meta; app đã được cấp quyền thì Facebook chuyển thẳng về kèm token. Hỏi lại (cần bấm Tiếp tục) → trả rỗng sau 20 giây.
  let refreshing = null;
  ipcMain.handle('fb-refresh', (e, a = {}) => {
    if (!fromPage(e) || !/^\d+$/.test(String(a.appId))) return {};
    return refreshing ||= new Promise(resolve => {
      const state = crypto.randomBytes(16).toString('hex');
      const q = new URLSearchParams({ client_id: a.appId, redirect_uri: LOGIN_PAGE, response_type: 'token', state });
      if (/^\d+$/.test(String(a.configId))) q.set('config_id', a.configId);
      const win = new BrowserWindow({ show: false, webPreferences: { partition: META, offscreen: true, sandbox: true, contextIsolation: true } });
      const done = token => { clearTimeout(timer); refreshing = null; if (!win.isDestroyed()) win.destroy(); resolve(token ? { token } : {}); };
      const timer = setTimeout(() => done(''), 20000);
      const check = (ev, url) => {
        if (!String(url).startsWith(LOGIN_PAGE)) return;
        ev?.preventDefault?.();
        const h = new URLSearchParams(String(url).split('#')[1] || '');
        done(h.get('state') === state ? h.get('access_token') : '');
      };
      for (const name of ['will-redirect', 'will-navigate']) win.webContents.on(name, check);
      win.webContents.on('did-navigate', (_e, url) => check(null, url));
      win.webContents.loadURL(`https://www.facebook.com/v25.0/dialog/oauth?${q}`).catch(() => {});
    });
  });
  ipcMain.on('tab-changed', (e, g) => { if (e.sender === pageView.webContents) { group = String(g); layout(); } });
  ipcMain.on('open-meta-inbox', (e, url) => { if (e.sender === pageView.webContents) openMetaInbox(url); });
  // Cập nhật: kiểm tra GitHub Releases, tải về, rồi khởi động lại để cài khi người dùng bấm.
  // Chỉ một lượt kiểm tra/tải chạy cùng lúc (lúc mở app, nút trên trang, kiểm tra định kỳ dùng chung), lỗi mạng thì thử lại 1 lần,
  // tải nguyên file (tải "vi sai" qua blockmap hay hỏng giữa chừng).
  let updater = null, downloaded = '', checking = null;
  const getUpdater = () => {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      // Không tự cài lúc thoát app: tắt máy giữa lúc cài làm hỏng app (file app.asar còn 0 byte, mất app). Chỉ cài khi bấm Cập nhật.
      updater.autoDownload = true; updater.autoInstallOnAppQuit = false; updater.disableDifferentialDownload = true;
      updater.on('update-downloaded', info => { downloaded = info.version; });
      updater.on('error', () => {}); // lỗi trả về qua lượt kiểm tra, không để văng thông báo lỗi của Electron
    }
    return updater;
  };
  const checkOnce = async () => {
    const u = getUpdater(), r = await u.checkForUpdates();
    if (!r?.isUpdateAvailable) return { state: 'latest' };
    await (r.downloadPromise || new Promise((ok, bad) => { u.once('update-downloaded', ok); u.once('error', bad); }));
    return { state: 'ready', version: downloaded || r.updateInfo.version };
  };
  const checkUpdate = () => checking ||= (async () => {
    try {
      if (downloaded) return { state: 'ready', version: downloaded };
      try { return await checkOnce(); } catch { await sleep(5000); return await checkOnce(); }
    } finally { checking = null; }
  })();
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-check', async e => {
    if (!fromPage(e)) return { state: 'denied' };
    if (!app.isPackaged) return { state: 'dev' };
    return checkUpdate();
  });
  // Cài im lặng rồi tự mở lại app: không hiện trình cài đặt, không phải bấm Next.
  // Đóng hẳn mọi cửa sổ trước (kể cả khung ẩn Business Suite / ChatGPT) để bộ cài ghi đè được file; còn tiến trình giữ file thì bộ cài hỏng giữa chừng.
  ipcMain.handle('update-install', e => {
    if (!fromPage(e) || !downloaded) return;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
    getUpdater().quitAndInstall(true, true);
  });
  layout();
  // Khoá app bằng mật khẩu (lớp phủ trên cùng); tạo sau mọi khung khác để luôn che được.
  const appLock = setupLock({ mainWindow, focusPage: () => pageView.webContents.focus(), sessions: [ses, metaSes, zaloSes] });
  ipcMain.on('app-lock', (e, what) => { if (!fromPage(e)) return; if (what === 'settings') appLock.settings(); else if (what === 'now') appLock.lock(); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Studio AI', accelerator: 'Ctrl+Shift+A', click: () => toggleStudio() },
    { label: 'Bảo mật', submenu: [{ label: 'Khoá ngay', accelerator: 'Ctrl+L', click: () => appLock.lock() }, { label: 'Mật khẩu & tự khoá…', click: () => appLock.settings() }] },
    { label: 'Zalo', accelerator: 'Ctrl+Shift+Z', click: () => side === 'zalo' ? show('zalo', false) : openZalo() },
    { label: 'Hộp thư Meta', accelerator: 'Ctrl+Shift+M', click: () => { if (!metaView.webContents.getURL()) metaView.webContents.loadURL('https://business.facebook.com/latest/inbox/all'); show('meta'); } },
    { label: 'Xem', submenu: [
      { label: 'Tải lại', accelerator: 'F5', click: () => pageView.webContents.reloadIgnoringCache() },
      { label: 'Tải lại Studio AI', click: () => panelView.webContents.reload() },
      { label: 'Tải lại hộp thư Meta', click: () => metaView.webContents.reload() },
      // Lưu trang Business Suite mà app vừa đọc (khung ẩn) + cột Hộp thư Meta ra Desktop, để sửa cách đọc avatar/UID theo giao diện thật.
      { label: 'Lưu chẩn đoán Business Suite', click: async () => {
        const dir = app.getPath('desktop'), stamp = new Date().toISOString().replace(/[:.]/g, '-');
        require('fs').writeFileSync(path.join(dir, `meta-assistant-chan-doan-loi-${stamp}.txt`), consoleLog.join('\n') || '(không có lỗi)');
        for (const [name, v] of [['an', worker], ['cot-phai', metaView], ['soan-ngam', composer]]) {
          const wc = v.webContents; if (!wc.getURL()) continue;
          const html = await wc.executeJavaScript('location.href + "\\n" + document.documentElement.outerHTML').catch(e => String(e));
          require('fs').writeFileSync(path.join(dir, `meta-assistant-chan-doan-${name}-${stamp}.html`), html);
          const img = await wc.capturePage().catch(() => null);
          if (img) require('fs').writeFileSync(path.join(dir, `meta-assistant-chan-doan-${name}-${stamp}.png`), img.toPNG());
        }
        shell.openPath(dir);
      } },
      // Lưu trang Zalo Web đang mở (danh sách hội thoại / hội thoại đang xem) để viết phần đọc tin Zalo theo giao diện thật.
      { label: 'Lưu chẩn đoán Zalo', click: async () => {
        const dir = app.getPath('desktop'), stamp = new Date().toISOString().replace(/[:.]/g, '-'), wc = zaloView.webContents;
        if (!wc.getURL()) return openZalo();
        const html = await wc.executeJavaScript('location.href + "\\n" + document.documentElement.outerHTML').catch(e => String(e));
        require('fs').writeFileSync(path.join(dir, `get-helps-zalo-${stamp}.html`), html);
        const img = await wc.capturePage().catch(() => null);
        if (img) require('fs').writeFileSync(path.join(dir, `get-helps-zalo-${stamp}.png`), img.toPNG());
        shell.openPath(dir);
      } }, { type: 'separator' },
      { label: 'Phóng to', accelerator: 'Ctrl+=', click: () => pageView.webContents.setZoomLevel(pageView.webContents.getZoomLevel() + 0.5) },
      { label: 'Thu nhỏ', accelerator: 'Ctrl+-', click: () => pageView.webContents.setZoomLevel(pageView.webContents.getZoomLevel() - 0.5) },
      { label: 'Cỡ gốc', accelerator: 'Ctrl+0', click: () => pageView.webContents.setZoomLevel(0) }, { type: 'separator' },
      { label: 'Công cụ lỗi', accelerator: 'F12', click: () => pageView.webContents.toggleDevTools() }] },
  ]));
  app.appLock = appLock;
  app.toggleStudio = toggleStudio; app.views = { page: pageView, panel: panelView, meta: metaView, zalo: zaloView, worker, bar };
  mainWindow.on('closed', () => { mainWindow = null; for (const w of [worker, composer]) if (!w.isDestroyed()) w.destroy(); app.quit(); });
  if (app.isPackaged) { checkUpdate().catch(() => {}); setInterval(() => checkUpdate().catch(() => {}), 2 * 3600e3); }
});
app.on('window-all-closed', () => app.quit());
