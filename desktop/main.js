// Meta Assistant cho Windows: mở trang web (luôn là bản mới nhất trên GitHub Pages) trong cửa sổ riêng
// và chạy sẵn tiện ích Studio AI (ChatGPT) bên trong, không cần Chrome.
const { app, BaseWindow, BrowserWindow, Menu, WebContentsView, clipboard, ipcMain, net, safeStorage, screen, session, shell } = require('electron');
const path = require('path'), crypto = require('crypto');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { createMetaAuto } = require('./meta-auto');
const { createZaloAuto } = require('./zalo-auto');
const { setupLock } = require('./app-lock');
const { readCatalog } = require('./svc-catalog');
const createFbPeople = require('./fb-people');
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
const IN_APP = /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|chatgpt\.com|openai\.com|google\.com|live\.com|microsoftonline\.com|apple\.com|zalo\.me|zaloapp\.com|zalo\.vn)\//i;
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

let extensions, mainWindow, pageView, panelView, metaView, zaloView, svcView, side = 'studio', group = '', studio; // side: cột phải 'studio' | 'meta' | ''; group: nhóm tab đang mở trên trang
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
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-prevent-unload', ev => ev.preventDefault());
  // Chuột phải ở mọi cửa sổ/khung (cửa sổ bật ra, cột Meta, Zalo, Studio…): sao chép link trang / link đang trỏ, mở trong trình duyệt.
  wc.on('context-menu', (_ev, p) => {
    const page = cleanUrl(wc.getURL()), link = cleanUrl(p.linkURL), items = [];
    if (link) items.push({ label: 'Sao chép link', click: () => clipboard.writeText(link) }, { label: 'Mở link trong trình duyệt', click: () => shell.openExternal(link) }, { type: 'separator' });
    if (p.isEditable) items.push({ label: 'Cắt', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Sao chép', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Dán', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' });
    else if (p.selectionText) items.push({ label: 'Sao chép', role: 'copy' }, { type: 'separator' });
    if (p.mediaType === 'image' && /^https?:/.test(p.srcURL)) items.push({ label: 'Sao chép link ảnh', click: () => clipboard.writeText(cleanUrl(p.srcURL)) }, { type: 'separator' });
    if (page) items.push({ label: 'Sao chép link trang này', accelerator: 'Ctrl+Shift+C', click: () => clipboard.writeText(page) }, { label: 'Mở trang này trong trình duyệt', click: () => shell.openExternal(page) });
    items.push({ label: 'Quay lại', enabled: wc.navigationHistory?.canGoBack?.() ?? wc.canGoBack(), click: () => wc.navigationHistory?.goBack ? wc.navigationHistory.goBack() : wc.goBack() }, { label: 'Tải lại', click: () => wc.reload() });
    Menu.buildFromTemplate(items).popup();
  });
  // Ctrl+Shift+C: sao chép link trang đang mở (cửa sổ bật ra không có thanh địa chỉ).
  wc.on('before-input-event', (ev, i) => { if (i.type === 'keyDown' && i.control && i.shift && !i.alt && i.key.toLowerCase() === 'c' && cleanUrl(wc.getURL())) { ev.preventDefault(); clipboard.writeText(cleanUrl(wc.getURL())); } });
});
// Link để sao chép: chỉ http(s), bỏ token đăng nhập nếu có trong link.
function cleanUrl(u) {
  try { const url = new URL(u); if (!/^https?:$/.test(url.protocol)) return ''; for (const k of ['access_token', 'token']) url.searchParams.delete(k); url.hash = /access_token/.test(url.hash) ? '' : url.hash; return url.href; } catch { return ''; }
}
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
  // Giao diện kiểu Teams (Windows): bỏ thanh tiêu đề của Windows; nút thu nhỏ / phóng to / đóng vẽ đè lên thanh trên 48px của trang
  // (màu theo giao diện sáng / tối do trang báo qua 'title-bar'). Tắt được ở menu "…" › Thanh tiêu đề Windows (lưu ui.json).
  const UI_FILE = path.join(app.getPath('userData'), 'ui.json');
  let ui = {}; try { ui = JSON.parse(require('fs').readFileSync(UI_FILE, 'utf8')); } catch {}
  const FRAMELESS = process.platform === 'win32' && !ui.nativeFrame, TB = FRAMELESS ? 48 : 0;
  mainWindow = new BaseWindow({ width: 1440, height: 880, icon: ICON, title: 'Get Helps',
    ...(FRAMELESS ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0c1820', symbolColor: '#ffffff', height: TB }, backgroundColor: '#0c1820' } : {}) });
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
  // Zalo chạy NGẦM như khung Business Suite: cửa sổ ẩn dựng hình ngoài màn hình (luôn "đang hiện", nhận gõ phím thật).
  // Cột Zalo chỉ mở trang khi bạn mở cột; lúc đó khung ngầm tạm nghỉ (Zalo Web chỉ cho 1 tab dùng cùng lúc), đóng cột thì khung ngầm chạy lại.
  const zaloWorker = new BrowserWindow({ show: false, width: 820, height: 940, webPreferences: { partition: ZALO, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  zaloWorker.webContents.setAudioMuted(true); zaloWorker.webContents.setFrameRate(10);
  zaloWorker.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  const ZW = () => zaloWorker.webContents;
  // Khung Zalo ngầm (không hiện ra) phải được Zalo Web coi là cửa sổ đang mở, đang được chọn: nếu không, Zalo chờ mãi ở "Đang đăng nhập…"
  // / không tải danh sách. Gắn sẵn từ trước khi trang chạy: giả "đang hiện + đang được chọn" và giữ trang ở trạng thái hoạt động.
  const zaloAwake = async () => { try { const d = ZW().debugger; if (!d.isAttached()) d.attach('1.3');
      if (!zaloAwake.done) { zaloAwake.done = 1; await d.sendCommand('Page.enable');
        await d.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `try { Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.hasFocus = () => true; } catch (e) {}` }); }
      await d.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      await d.sendCommand('Page.setWebLifecycleState', { state: 'active' }).catch(() => {}); } catch {} };
  ZW().on('did-start-loading', () => { if (ZW().getURL() !== 'about:blank') zaloAwake(); });
  zaloAwake();
  // Web dịch vụ (vd dichvu.baostar.net): cột riêng, phiên đăng nhập riêng.
  const svcSes = session.fromPartition('persist:svc');
  svcSes.setUserAgent(app.userAgentFallback);
  svcView = new WebContentsView({ webPreferences: { partition: 'persist:svc', sandbox: true, contextIsolation: true } });
  for (const wc of [metaView.webContents, worker.webContents, composer.webContents]) await asChrome(wc); // Zalo Web chạy như trình duyệt thường (giả Chrome có thể làm Zalo treo "Đang đăng nhập…")
  mainWindow.contentView.addChildView(panelView);
  mainWindow.contentView.addChildView(metaView);
  mainWindow.contentView.addChildView(zaloView);
  mainWindow.contentView.addChildView(svcView);
  // Độ rộng cột phải (tỉ lệ cửa sổ), nhớ giữa các lần mở app.
  const LAYOUT_FILE = path.join(app.getPath('userData'), 'layout.json');
  let widths = { studio: 0.32, meta: 0.45, zalo: 0.45, svc: 0.5 };
  try { widths = { ...widths, ...JSON.parse(require('fs').readFileSync(LAYOUT_FILE, 'utf8')) }; } catch {}
  const saveWidths = () => { try { require('fs').writeFileSync(LAYOUT_FILE, JSON.stringify(widths)); } catch {} };
  const BAR = 30;
  const bar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'bar-preload.js') } });
  mainWindow.contentView.addChildView(bar);
  let cur = '';
  // Mở cột Zalo → tạm dừng khung ngầm (giải phóng phiên); đóng cột → trả cột về trang trống, khung ngầm mở lại Zalo.
  let zaloColOpen = false;
  const zaloSide = open => { if (open === zaloColOpen) return; zaloColOpen = open;
    if (open) { try { ZW().loadURL('about:blank'); } catch {} if (!/zalo\.me/.test(zaloView.webContents.getURL())) zaloView.webContents.loadURL('https://chat.zalo.me/').catch(() => {}); }
    else { setTimeout(() => { if (zaloColOpen) return; zaloView.webContents.loadURL('about:blank').catch(() => {}); ZW().loadURL('https://chat.zalo.me/').catch(() => {}); }, 400); } };
  let padNow = null;
  const padTitle = pad => { if (!FRAMELESS || padNow === pad) return; padNow = pad;
    pageView.webContents.executeJavaScript(`document.documentElement.classList.add('frameless');document.documentElement.classList.toggle('tb-pad',${pad})`).catch(() => { padNow = null; }); };
  pageView.webContents.on('dom-ready', () => { padNow = null; layout(); });
  const layout = () => {
    const { width, height } = mainWindow.getContentBounds();
    // Studio AI chỉ hiện khi đang ở nhóm Đăng bài.
    cur = side === 'studio' && (group !== 'publishing' || !studio) ? '' : side;
    const w = cur ? Math.round(Math.min(0.8, Math.max(0.2, widths[cur])) * width) : 0;
    pageView.setBounds({ x: 0, y: 0, width: width - w, height });
    // Cột phải nằm dưới hàng nút cửa sổ (TB); trang chính chừa chỗ cho các nút đó khi không có cột phải (lớp tb-pad).
    bar.setBounds(cur ? { x: width - w, y: TB, width: w, height: BAR } : { x: width, y: 0, width: 0, height: 0 });
    padTitle(!cur);
    // Zalo ẩn vẫn phải "đang hiện" với kích thước thật (Zalo Web chỉ vẽ dòng/tin đang thấy, khung 0×0 hay ngoài cửa sổ thì không chạy):
    // đặt nó NẰM DƯỚI trang chính (bị trang chính che kín); mở cột Zalo thì đưa lên trên cùng.
    for (const [name, v] of [['studio', panelView], ['meta', metaView], ['zalo', zaloView], ['svc', svcView]]) v.setBounds(cur === name ? { x: width - w, y: TB + BAR, width: w, height: height - TB - BAR } : { x: width, y: 0, width: 0, height: 0 });
    zaloSide(cur === 'zalo');
    const title = cur === 'meta' ? 'Hộp thư Meta' : cur === 'studio' ? 'Studio AI' : cur === 'zalo' ? 'Zalo' : cur === 'svc' ? 'Dịch vụ' : '';
    if (title && bar.webContents.__title !== title) { bar.webContents.__title = title; bar.webContents.loadFile(path.join(__dirname, 'bar.html'), { query: { t: title } }); }
  };
  mainWindow.on('resize', layout);
  wire(pageView.webContents, mainWindow);
  wire(panelView.webContents, mainWindow, false);
  wire(metaView.webContents, mainWindow, false);
  wire(zaloView.webContents, mainWindow, false);
  wire(svcView.webContents, mainWindow, false);
  // Luôn lấy index.html mới (GitHub Pages cho trình duyệt giữ bản cũ ~10 phút → trang chạy code cũ sau mỗi lần cập nhật web).
  pageView.webContents.loadURL(WEB, { extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n' });
  if (studio) panelView.webContents.loadURL(`chrome-extension://${studio.id}/sidepanel.html?desktop=1`);
  const fromPage = e => e.sender === pageView.webContents;
  // Màu hàng nút cửa sổ theo giao diện (sáng / tối) của trang.
  ipcMain.on('title-bar', (e, o) => { if (!fromPage(e) || !FRAMELESS) return; const hex = v => /^#[0-9a-f]{6}$/i.test(String(v || '').trim()) ? String(v).trim() : null;
    const color = hex(o?.color), symbolColor = hex(o?.symbol); if (!color) return;
    try { mainWindow.setTitleBarOverlay({ color, symbolColor: symbolColor || '#ffffff', height: TB }); mainWindow.setBackgroundColor(color); } catch {} });
  ipcMain.handle('ui-frame', (e, native) => { if (!fromPage(e)) return null;
    if (native == null) return { frameless: FRAMELESS, canToggle: process.platform === 'win32' };
    try { require('fs').writeFileSync(UI_FILE, JSON.stringify({ ...ui, nativeFrame: !!native })); } catch {}
    app.relaunch(); app.exit(0); return true; });
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
  // Zalo Web treo "Đang đăng nhập…": lần 1 xoá bộ nhớ đệm + service worker rồi tải lại (giữ đăng nhập); lần 2 xoá hẳn phiên → hiện mã QR quét lại.
  let zaloFix = 0, zaloWatch = 0;
  const resetZalo = async full => {
    try { await zaloSes.clearStorageData(full ? {} : { storages: ['serviceworkers', 'cachestorage', 'shadercache'] }); await zaloSes.clearCache(); } catch {}
    (zaloColOpen ? zaloView.webContents : ZW()).loadURL('https://chat.zalo.me/').catch(() => {});
  };
  const watchZalo = () => { clearTimeout(zaloWatch); zaloWatch = setTimeout(async () => {
    const stuck = await (zaloColOpen ? zaloView.webContents : ZW()).executeJavaScript(`/Đang đăng nhập|Logging in/i.test(document.body?.innerText || '') && !document.querySelector('canvas, img[src*="qr"], [class*="qr" i]')`).catch(() => false);
    if (!stuck) { zaloFix = 0; return; }
    if (zaloFix >= 2) return; // đã thử 2 lần: để bạn bấm "Đăng nhập lại Zalo"
    // Zalo đang chạy ngầm: chỉ dọn bộ nhớ đệm + service worker rồi tải lại (giữ đăng nhập), tối đa 2 lần; không bao giờ xoá phiên khi ẩn.
    if (side !== 'zalo') { if (zaloFix < 2) { zaloFix++; await resetZalo(false); } watchZalo(); return; }
    await resetZalo(zaloFix++ === 1); watchZalo();
  }, 25000); };
  zaloView.webContents.on('did-finish-load', () => { if (zaloView.webContents.getURL().startsWith('https://chat.zalo.me')) watchZalo(); });
  const openZalo = () => show('zalo', true); // mở cột → zaloSide() tải Zalo vào cột
  ipcMain.on('zalo-reset', (e, full) => { if (!fromPage(e)) return; zaloFix = 0; resetZalo(!!full); show('zalo', true); });
  ipcMain.on('open-zalo', e => { if (fromPage(e)) openZalo(); });
  // Mở web dịch vụ ở cột phải (trang chủ do người dùng đặt trong tab Dịch vụ; chỉ https).
  ipcMain.on('open-svc', (e, url) => {
    if (!fromPage(e)) return;
    try { const u = new URL(url); if (u.protocol !== 'https:') return; if (svcView.webContents.getURL() !== u.href) svcView.webContents.loadURL(u.href).catch(() => {}); } catch { return; }
    show('svc', true);
  });
  // API dịch vụ (SMM, vd smm.baostar.net/api/v2): gọi từ tiến trình chính vì trang web gọi thẳng bị chặn CORS.
  // Chỉ POST JSON tới URL https người dùng đặt; khoá API chỉ đi tới đúng URL đó.
  ipcMain.handle('svc-api', async (e, { url, body } = {}) => {
    if (!fromPage(e)) return { error: 'denied' };
    let u; try { u = new URL(url); } catch { return { error: 'URL API không hợp lệ.' }; }
    if (u.protocol !== 'https:') return { error: 'URL API phải là https.' };
    try {
      const r = await net.fetch(u.href, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}) });
      const text = await r.text();
      try { return { status: r.status, json: JSON.parse(text) }; } catch { return { status: r.status, error: `API trả về không phải JSON (HTTP ${r.status}): ${text.slice(0, 160)}` }; }
    } catch (err) { return { error: 'Không gọi được API dịch vụ: ' + err.message }; }
  });
  // Ảnh cho hoá đơn dịch vụ (QR VietQR, ảnh Page): trang không đọc được ảnh khác nguồn để vẽ lên canvas,
  // nên tải ở tiến trình chính. Chỉ nhận đúng các nguồn này, tối đa 3 MB, trả data URL.
  const IMG_HOSTS = /^(img\.vietqr\.io|([\w-]+\.)+fbcdn\.net|graph\.facebook\.com|([\w-]+\.)?fbsbx\.com)$/i; // ảnh trong tin: scontent.xx.fna.fbcdn.net
  ipcMain.handle('svc-image', async (e, url) => {
    if (!fromPage(e)) return { error: 'denied' };
    let u; try { u = new URL(url); } catch { return { error: 'URL ảnh không hợp lệ.' }; }
    if (u.protocol !== 'https:' || !IMG_HOSTS.test(u.hostname)) return { error: 'Nguồn ảnh không được phép.' };
    try {
      const r = await net.fetch(u.href);
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\//.test(type)) return { error: 'Không tải được ảnh (HTTP ' + r.status + ').' };
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3e6) return { error: 'Ảnh quá lớn.' };
      return { dataUrl: `data:${type.split(';')[0]};base64,${buf.toString('base64')}` };
    } catch (err) { return { error: 'Không tải được ảnh: ' + err.message }; }
  });
  // Kho theo tài khoản Facebook trên máy (tin mẫu, gói bán, API key, tài khoản ngân hàng): file riêng cho từng tài khoản trong thư mục app,
  // mã hoá bằng khoá của Windows (safeStorage). Vẫn còn khi xoá dữ liệu trình duyệt trong app / quên mật khẩu khoá app / cài lại.
  const vaultFile = id => path.join(app.getPath('userData'), 'vault', `fb-${id}.bin`);
  ipcMain.handle('vault-get', async (e, id) => {
    if (!fromPage(e) || !/^\d{3,30}$/.test(String(id))) return { error: 'denied' };
    try { const fs = require('fs'), buf = fs.readFileSync(vaultFile(id));
      const text = buf[0] === 0x7b ? buf.toString('utf8') : safeStorage.decryptString(buf);
      return { data: JSON.parse(text) }; } catch { return { data: {} }; }
  });
  ipcMain.handle('vault-set', async (e, id, data) => {
    if (!fromPage(e) || !/^\d{3,30}$/.test(String(id)) || !data || typeof data !== 'object') return { error: 'denied' };
    try { const fs = require('fs'), text = JSON.stringify(data); if (text.length > 50e6) return { error: 'Dữ liệu quá lớn.' };
      fs.mkdirSync(path.dirname(vaultFile(id)), { recursive: true });
      const tmp = vaultFile(id) + '.tmp';
      fs.writeFileSync(tmp, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8'));
      fs.renameSync(tmp, vaultFile(id)); return { ok: true }; } catch (err) { return { error: err.message }; }
  });
  // Danh mục dịch vụ từ trang web (ghi chú gốc, giá web, bảo trì, thời gian TB): đọc bằng phiên cột Dịch vụ, chỉ đọc.
  let svcCatalogRun = null;
  ipcMain.handle('svc-catalog', async (e, { origin } = {}) => {
    if (!fromPage(e)) return { error: 'denied' };
    let o; try { o = new URL(origin); } catch { return { error: 'Địa chỉ web dịch vụ không hợp lệ.' }; }
    if (o.protocol !== 'https:') return { error: 'Web dịch vụ phải là https.' };
    if (svcCatalogRun) return svcCatalogRun;
    const fetchText = async url => { const r = await svcSes.fetch(url, { headers: { accept: 'text/html' } }); if (!r.ok) throw Error('HTTP ' + r.status); return r.text(); };
    const progress = (done, total) => pageView.webContents.executeJavaScript(`window.App?.services?.catalogProgress?.(${done},${total})`).catch(() => {});
    svcCatalogRun = readCatalog(o.origin, fetchText, { onProgress: progress })
      .then(list => ({ list }), err => ({ error: 'Không đọc được web dịch vụ: ' + err.message }))
      .finally(() => { svcCatalogRun = null; });
    return svcCatalogRun;
  });
  // Số dư đúng như web hiện (VND): API Baostar trả số dư theo tiền khác (vd USD) nên đọc thẳng "Số dư: 50,475" trên trang web.
  ipcMain.handle('svc-web-balance', async (e, { origin } = {}) => {
    if (!fromPage(e)) return { error: 'denied' };
    let o; try { o = new URL(origin); } catch { return { error: 'bad origin' }; }
    if (o.protocol !== 'https:') return { error: 'https' };
    // Số dư do JavaScript của web điền sau khi tải (HTML gốc ghi "Số dư: 0") → đọc trên trang ĐÃ CHẠY: cột Dịch vụ nếu đang mở web đó,
    // không thì mở ẩn trang chủ bằng phiên cột Dịch vụ, chờ trang điền số rồi đọc.
    const READ = `(() => { const t = (document.body?.innerText || '').replace(/\\s+/g, ' ');
      const all = [...t.matchAll(/Số dư\\s*:?\\s*([\\d.,]+)/gi)].map(m => ({ raw: m[1], ctx: t.slice(Math.max(0, m.index - 60), m.index + 40) }));
      return { all, login: /đăng nhập|login/i.test(t) && !/đăng xuất|logout/i.test(t) }; })()`;
    const n = v => Number(String(v).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) || 0;
    const pick = r => { const ok = (r?.all || []).filter(a => n(a.raw) > 0); return ok.length ? { raw: ok.sort((a, b) => n(b.raw) - n(a.raw))[0].raw, all: r.all.slice(0, 5) } : null; };
    const read = async wc => { for (let i = 0; i < 16; i++) { const r = await wc.executeJavaScript(READ).catch(() => null); const p = pick(r); if (p) return p; if (r?.login) return { error: 'login', all: r.all }; await new Promise(x => setTimeout(x, 500)); }
      return { error: 'web-zero', all: (await wc.executeJavaScript(READ).catch(() => null))?.all?.slice(0, 5) }; };
    try { if (svcView.webContents.getURL().startsWith(o.origin) && !svcView.webContents.isLoading()) { const r = await read(svcView.webContents); if (r.raw) return { ...r, from: 'cot-dich-vu' }; } } catch {}
    const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:svc', offscreen: true, sandbox: true, contextIsolation: true } });
    try { w.webContents.setAudioMuted(true); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await Promise.race([w.loadURL(o.origin + '/'), new Promise(x => setTimeout(x, 20e3))]).catch(() => {});
      return { ...(await read(w.webContents)), from: 'an' };
    } catch (err) { return { error: err.message }; } finally { if (!w.isDestroyed()) w.destroy(); }
  });
  // Ảnh thực tế của link khách (trang TikTok, bài Facebook…): mở ẩn kiểu điện thoại, chờ trang hiện số liệu rồi chụp phần đầu.
  // Facebook / Instagram dùng phiên Facebook trong app (xem được như bạn xem); trang khác dùng phiên riêng không đăng nhập.
  const snapCache = new Map();
  ipcMain.handle('svc-snap', async (e, { url } = {}) => {
    if (!fromPage(e)) return { error: 'denied' };
    let u; try { u = new URL(url); } catch { return { error: 'link không hợp lệ' }; }
    if (!/^https?:$/.test(u.protocol)) return { error: 'link không hợp lệ' };
    const hit = snapCache.get(u.href); if (hit && Date.now() - hit.at < 60e3) return { dataUrl: hit.dataUrl, metrics: hit.metrics };
    const fbLike = /(^|\.)(facebook\.com|fb\.watch|fb\.me|instagram\.com|threads\.(net|com))$/i.test(u.hostname);
    // Trang Facebook / Instagram / Threads dùng chung phiên đăng nhập Business Suite → phải cùng "thiết bị" với các khung khác của app
    // (cùng kiểu trình duyệt máy tính). Một phiên mà lúc là Chrome máy tính, lúc là iPhone là dấu hiệu Facebook dễ bắt xác minh (checkpoint).
    // Trang khác (TikTok…) chụp kiểu điện thoại bằng phiên riêng, không đăng nhập.
    const w = new BrowserWindow({ show: false, width: fbLike ? 900 : 430, height: fbLike ? 1500 : 932, webPreferences: { partition: fbLike ? META : 'persist:snap', offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    try {
      w.webContents.setAudioMuted(true); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
      const load = async href => { await Promise.race([w.loadURL(href), new Promise(r => setTimeout(r, 20e3))]).catch(() => {}); };
      const isFeed = href => { try { const x = new URL(href); return /facebook\.com$/i.test(x.hostname) && (/^\/(home\.php)?$/.test(x.pathname) || /^\/(login|checkpoint)/.test(x.pathname)); } catch { return false; } };
      if (fbLike) await asChrome(w.webContents); // cùng kiểu trình duyệt với cột Meta và các khung ngầm
      else w.webContents.setUserAgent(MOBILE);
      await load(u.href); // link chia sẻ (/share/…, fb.me…) tự chuyển tới bài thật
      if (fbLike) await new Promise(r => setTimeout(r, 1200));
      // Bị đẩy về Bảng tin / trang đăng nhập / xác minh: không phải bài của khách → không chụp (tránh ảnh sai).
      if (isFeed(w.webContents.getURL())) return { error: 'Facebook không mở được bài này (bài riêng tư, đã xoá, hoặc link chia sẻ không còn dùng được)' };
      await new Promise(r => setTimeout(r, 4500)); // chờ trang điền số follow / like
      // Trang không đăng nhập: đóng hộp "mở ứng dụng / đăng nhập" che trang (nếu có). Trang Facebook đang đăng nhập: chỉ xem, không bấm gì.
      if (!fbLike) await w.webContents.executeJavaScript(`(() => { for (const b of document.querySelectorAll('[aria-label*="Close" i],[aria-label*="Đóng" i],[data-e2e*="close" i]')) try { b.click(); } catch (e) {} scrollTo(0, 0); })()`).catch(() => {});
      await new Promise(r => setTimeout(r, 600));
      // Facebook bản máy tính: tìm dòng số liệu của bài (cảm xúc · bình luận · chia sẻ), cuộn tới (chỉ cuộn, không bấm) và cắt khung ảnh
      // từ đầu bài tới hết dòng số liệu + thanh Thích/Bình luận/Chia sẻ. Bài dài (ảnh to) thì giữ phần dưới có số liệu.
      let clip = fbLike ? { x: 0, y: 56, width: 900, height: 720 } : { x: 0, y: 0, width: 430, height: 620 };
      if (fbLike) {
        const box = await w.webContents.executeJavaScript(`(() => {
          const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const LAB = /^(Tất cả cảm xúc|All reactions|Xem ai đã bày tỏ cảm xúc|See who reacted)/i;
          const TXT = /^(Tất cả cảm xúc:?\\s*)?[\\d][\\d.,]*\\s*(K|N|Tr|M)?\\s*(bình luận|comments?|lượt chia sẻ|chia sẻ|shares?|lượt xem|views?)$/i;
          const cands = [...document.querySelectorAll('[aria-label]')].filter(el => LAB.test(el.getAttribute('aria-label') || '') && vis(el))
            .concat([...document.querySelectorAll('span, div')].filter(el => el.childElementCount <= 1 && TXT.test((el.innerText || '').trim()) && vis(el)));
          if (!cands.length) return null;
          const el = cands.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
          el.scrollIntoView({ block: 'center' });
          const art = el.closest('[role="article"]') || el.closest('[role="dialog"]') || el.closest('[role="main"]');
          const mr = el.getBoundingClientRect(), ar = art ? art.getBoundingClientRect() : null;
          // Cả dòng số liệu: các số cùng hàng (cảm xúc bên trái, bình luận / chia sẻ bên phải) → lấy đáy thấp nhất trong hàng.
          const row = cands.map(c => c.getBoundingClientRect()).filter(r => Math.abs(r.top - mr.top) < 30);
          return { mTop: mr.top, mBot: Math.max(...row.map(r => r.bottom), mr.bottom), aTop: ar ? ar.top : null, aL: ar ? ar.left : 0, aR: ar ? ar.right : innerWidth, H: innerHeight, W: innerWidth };
        })()`).catch(() => null);
        if (box) {
          await new Promise(r => setTimeout(r, 700)); // ảnh / số vừa cuộn tới kịp vẽ
          const bot = Math.min(box.H, Math.round(box.mBot + 56)); // + thanh Thích / Bình luận / Chia sẻ
          let top = Math.max(56, Math.round(box.aTop != null ? box.aTop - 8 : bot - 720));
          if (bot - top > 1000) top = bot - 1000; // bài quá dài: giữ phần dưới (có số liệu)
          if (bot - top < 260) top = Math.max(56, bot - 260);
          const L = Math.max(0, Math.round(box.aL - 8)), R = Math.min(box.W, Math.round(box.aR + 8));
          clip = { x: L, y: top, width: Math.max(320, R - L), height: bot - top };
        }
      }
      const img = await w.webContents.capturePage(clip);
      if (img.isEmpty()) return { error: 'không chụp được trang' };
      const dataUrl = 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64');
      // Đọc số thật đang hiện trên trang (TikTok: follower / following / thích của kênh, hoặc tim / bình luận / chia sẻ của video).
      const metrics = await w.webContents.executeJavaScript(`(() => { const out = {};
        const n = t => { t = String(t || '').trim().replace(/\\s/g, ''); const m = t.match(/^([\\d.,]+)([KkMmBbNnTr]*)/); if (!m) return null;
          let v = m[1], u = m[2].toLowerCase(); if (u) v = v.replace(',', '.'); else v = v.replace(/[.,]/g, '');
          const k = u.startsWith('k') || u === 'n' ? 1e3 : u.startsWith('m') || u === 'tr' ? 1e6 : u.startsWith('b') ? 1e9 : 1; const x = parseFloat(v) * k; return isFinite(x) ? Math.round(x) : null; };
        const q = (k, sel) => { const el = document.querySelector(sel); if (el) { const v = n(el.textContent); if (v != null) out[k] = v; } };
        q('followers', '[data-e2e="followers-count"]'); q('following', '[data-e2e="following-count"]'); q('likes', '[data-e2e="likes-count"]');
        q('likes', '[data-e2e="like-count"], [data-e2e="browse-like-count"]'); q('comments', '[data-e2e="comment-count"], [data-e2e="browse-comment-count"]');
        q('shares', '[data-e2e="share-count"]'); q('views', '[data-e2e="video-views"], [data-e2e="view-count"]');
        // Trang bản điện thoại không có data-e2e: đọc theo chữ "63 Followers", "214 Likes", "1,2K người theo dõi"…
        const t = (document.body?.innerText || '').replace(/\\u00a0/g, ' ');
        const g = (k, re) => { if (out[k] != null) return; const m = t.match(re); if (m) { const v = n(m[1]); if (v != null) out[k] = v; } };
        const NUM = /([\\d][\\d.,]*\\s?(?:[KkMmBb]|N|Tr)?)\\s*/.source;
        g('followers', new RegExp(NUM + '(?:Followers?|người theo dõi)', 'i'));
        g('following', new RegExp(NUM + '(?:Following|Đang theo dõi|đang follow)', 'i'));
        // Facebook bản máy tính: "Tất cả cảm xúc: 46" / "All reactions: 46"
        { const m = t.match(/(?:Tất cả cảm xúc|All reactions)\\s*:?\\s*([\\d][\\d.,]*\\s?(?:[KkMm]|N|Tr)?)/i); if (m && out.likes == null) { const v = n(m[1]); if (v != null) out.likes = v; } }
        g('likes', new RegExp(NUM + '(?:Likes?|lượt thích|Thích|lượt tim|lượt bày tỏ cảm xúc|cảm xúc|reactions?)', 'i'));
        // Facebook: "Bạn và 45 người khác" / "Lan và 45 người khác" → 46
        if (out.likes == null) { const m = t.match(/và\\s+([\\d][\\d.,]*\\s?(?:[KkMm]|N|Tr)?)\\s+người khác|and\\s+([\\d][\\d.,]*[KkMm]?)\\s+others/i); if (m) { const v = n(m[1] || m[2]); if (v != null) out.likes = v + 1; } }
        g('views', new RegExp(NUM + '(?:views?|lượt xem)', 'i'));
        g('comments', new RegExp(NUM + '(?:comments?|bình luận)', 'i'));
        return out; })()`).catch(() => ({}));
      snapCache.set(u.href, { at: Date.now(), dataUrl, metrics }); if (snapCache.size > 30) snapCache.delete(snapCache.keys().next().value);
      return { dataUrl, metrics };
    } catch (err) { return { error: err.message }; } finally { if (!w.isDestroyed()) w.destroy(); }
  });
  const openMetaInbox = url => {
    if (!/^https:\/\/business\.facebook\.com\/latest\/inbox/.test(url)) return;
    if (metaView.webContents.getURL() !== url) metaView.webContents.loadURL(url);
    show('meta', true);
  };
  // Ghi lỗi JavaScript của Business Suite (cột Meta + cửa sổ soạn ngầm) để chẩn đoán vì sao ô văn bản không hiện.
  const consoleLog = [];
  for (const [name, wc] of [['cot-phai', metaView.webContents], ['soan-ngam', composer.webContents]])
    wc.on('console-message', (e) => { const lvl = e.level ?? ''; if (!['error', 'warning', 2, 3].includes(lvl)) return; consoleLog.push(`[${new Date().toISOString()}] ${name} ${lvl}: ${String(e.message).slice(0, 500)} (${e.sourceId || ''}:${e.lineNumber || ''})`); if (consoleLog.length > 300) consoleLog.shift(); });
  // Khung ẩn thêm cho từng Page (Hộp thư Business Suite chạy song song). Cùng phiên đăng nhập, giả Chrome như khung gốc.
  const makeWorker = () => {
    const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: META, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setFrameRate(10); w.webContents.setAudioMuted(true);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.ready = asChrome(w.webContents); // giả Chrome xong mới cho tải Business Suite
    return w;
  };
  const auto = createMetaAuto({ worker, makeWorker, composer, metaView, showMeta: showMetaTemp, metaShown: () => side === 'meta',
    isAway: () => { try { return !!appLock?.isLocked?.(); } catch { return false; } }, // app đang khoá (màn che mật khẩu)
    progress: data => pageView.webContents.executeJavaScript(`window.App?.composeProgress?.(${JSON.stringify(data)})`).catch(() => {}),
    notify: msg => pageView.webContents.executeJavaScript(`typeof toast === 'function' && toast(${JSON.stringify(msg)}, 30000)`).catch(() => {}),
    threadRead: (id, at) => pageView.webContents.executeJavaScript(`window.App?.inbox?.bsRead?.(${JSON.stringify(String(id))}, ${Number(at) || 0})`).catch(() => {}),
    receiptChanged: (id, rc) => pageView.webContents.executeJavaScript(`window.App?.inbox?.bsReceipt?.(${JSON.stringify(String(id))}, ${JSON.stringify(rc || null)})`).catch(() => {}),
    threadChanged: (id, info) => pageView.webContents.executeJavaScript(`window.App?.inbox?.bsChanged?.(${JSON.stringify(String(id))}, ${JSON.stringify(info || null)})`).catch(() => {}),
    listChanged: pageId => pageView.webContents.executeJavaScript(`window.App?.inbox?.bsListChanged?.(${JSON.stringify(String(pageId))})`).catch(() => {}) });
  worker.webContents.setAudioMuted(true);
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Quét bài viết › Người tương tác: đọc người thả cảm xúc / bình luận / chia sẻ của bài bất kỳ bằng phiên Facebook trong app;
  // số bạn bè / theo dõi chỉ đọc khi bạn bấm từng người.
  const fbPeople = createFbPeople({ BrowserWindow, partition: META, asChrome,
    // Downloads/GetHelps-debug/nguoi-tuong-tac.json: cấu trúc trang bài lần quét gần nhất (để chẩn đoán khi đọc thiếu).
    saveDebug: d => { try { const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); require('fs').mkdirSync(dir, { recursive: true });
      require('fs').writeFileSync(path.join(dir, 'nguoi-tuong-tac.json'), JSON.stringify({ app: app.getVersion(), at: new Date().toISOString(), ...d }, null, 1)); } catch {} } });
  ipcMain.handle('fb-post-people', (e, args) => !fromPage(e) ? { error: 'denied' } : fbPeople.postPeople(args || {},
    p => pageView.webContents.executeJavaScript(`window.App?.scannerProgress?.(${JSON.stringify(p)})`).catch(() => {})));
  ipcMain.handle('fb-profile-counts', (e, args) => !fromPage(e) ? { error: 'denied' } : fbPeople.profileCounts(args || {}));
  ipcMain.handle('meta-lookup', (e, args) => fromPage(e) ? auto.lookupProfile(args || {}) : { error: 'denied' });
  // Lệnh trình duyệt (CDP) cho khung ngầm Zalo: bấm chuột / phím / chèn chữ thật như khung Business Suite.
  const zaloCdp = async (method, params) => { const d = ZW().debugger; if (!d.isAttached()) d.attach('1.3'); return d.sendCommand(method, params || {}); };
  // Nhật ký gửi tin Zalo (10 lần gần nhất) → Downloads/GetHelps-debug/zalo-gui.json: từng cách nhập / gửi đã thử và kết quả (không ghi nội dung tin).
  const zaloSendLog = [];
  // Zalo cá nhân đi chung đường với Business Suite: Hộp thư gọi đọc/gửi với pageId "zalo".
  const zalo = createZaloAuto({ wc: () => ZW(), cdp: zaloCdp,
    // Khung ngầm dựng hình ngoài màn hình: không cướp tiêu điểm, không mở cột.
    beginInput: async () => { if (zaloColOpen) throw Error('Đang mở cột Zalo: gửi tin trong cột Zalo, hoặc đóng cột (Ctrl+Shift+Z) để app gửi ngầm.'); },
    endInput: () => {},
    log: entry => { try { zaloSendLog.unshift({ app: app.getVersion(), ...entry }); zaloSendLog.splice(10); const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); require('fs').mkdirSync(dir, { recursive: true });
      require('fs').writeFileSync(path.join(dir, 'zalo-gui.json'), JSON.stringify(zaloSendLog, null, 1)); } catch {} },
    onList: rows => pageView.webContents.executeJavaScript(`window.App?.inbox?.zaloList?.(${JSON.stringify(rows)})`).catch(() => {}),
    onThread: id => pageView.webContents.executeJavaScript(`window.App?.inbox?.bsChanged?.(${JSON.stringify('zalo:' + id)}, null)`).catch(() => {}) });
  ZW().on('console-message', (ev, ...a) => zalo.onConsole(ev?.message ?? a[1]));
  // Zalo Web vừa tải xong: chờ danh sách hiện (đăng nhập xong) rồi gửi danh sách cho Hộp thư + bắt đầu nghe tin mới.
  let zaloBoot = 0;
  const bootZalo = async () => { const run = ++zaloBoot;
    for (let i = 0; i < 60 && run === zaloBoot; i++) { await new Promise(r => setTimeout(r, i ? 3000 : 1500));
      const r = await zalo.list({ deep: true }).catch(() => null);
      if (r?.rows) { pageView.webContents.executeJavaScript(`window.App?.inbox?.zaloList?.(${JSON.stringify(r.rows)})`).catch(() => {}); return; } } };
  ZW().on('did-finish-load', () => { if (ZW().getURL().startsWith('https://chat.zalo.me')) { bootZalo(); watchZalo(); } });
  // Đã đăng nhập Zalo lần trước → mở sẵn Zalo Web (ẩn) khi bật app để Hộp thư có tin Zalo ngay.
  // Zalo luôn mở (ẩn dưới trang chính) từ lúc bật app; chỉ mở MỘT lần, đọc / gửi tin không bao giờ tải lại trang.
  if (!ZW().getURL()) ZW().loadURL('https://chat.zalo.me/').catch(() => {});
  ZW().on('render-process-gone', () => setTimeout(() => { if (!zaloColOpen) ZW().loadURL('https://chat.zalo.me/').catch(() => {}); }, 3000)); // khung ngầm bị đóng bất thường: mở lại
  ipcMain.handle('thread-react', (e, args) => !fromPage(e) ? { error: 'denied' } : args?.pageId === 'zalo' ? zalo.react(args) : auto.react(args || {}));
  ipcMain.handle('zalo-list', async (e, args) => { if (!fromPage(e)) return { error: 'denied' };
    // Chưa mở Zalo Web: mở ẩn rồi báo Hộp thư chờ. Đang tải thì KHÔNG tải lại (tải lại liên tục làm Zalo không bao giờ mở xong).
    if (zaloColOpen) return { error: 'Đang mở cột Zalo (đóng cột để Hộp thư đọc Zalo ngầm).' };
    const w = ZW(), url = w.getURL();
    if (!url && !w.isLoading()) { w.loadURL('https://chat.zalo.me/').catch(() => {}); return { error: 'loading' }; }
    if (/^https:\/\/([a-z0-9-]+\.)*zalo\.me\//.test(url) && !url.startsWith('https://chat.zalo.me')) return { error: 'login' }; // bị chuyển sang trang đăng nhập Zalo
    if (!url.startsWith('https://chat.zalo.me')) return { error: w.isLoading() ? 'loading' : 'login' };
    const r = await zalo.list(args || {});
    return r.error && /đang tải/i.test(r.error) && zalo.status().state === 'login' ? { error: 'login' } : r; });
  ipcMain.handle('meta-thread-read', (e, args) => !fromPage(e) ? { error: 'denied' } : args?.pageId === 'zalo' ? zalo.read(args) : auto.readThread(args || {}));
  ipcMain.handle('meta-thread-prime', (e, args) => !fromPage(e) || args?.pageId === 'zalo' ? { ok: false } : auto.primeImage(args || {}));
  ipcMain.handle('meta-thread-send', (e, args) => !fromPage(e) ? { error: 'denied' } : args?.pageId === 'zalo' ? zalo.send(args) : auto.sendThread(args || {}));
  ipcMain.handle('meta-threads', (e, args) => fromPage(e) ? auto.listThreads(args || {}) : { error: 'denied' });
  // ── Cửa sổ chat nhỏ nổi trên cùng: phản chiếu hội thoại đang mở trong Hộp thư (5 tin gần nhất), gửi tin, đổi nhanh giữa khách đang chờ ──
  let mini = null, miniBounds = null;
  const pageJs = code => pageView.webContents.executeJavaScript(code, true);
  const openMini = () => {
    if (mini && !mini.isDestroyed()) { mini.showInactive(); mini.focus(); return; }
    const wa = screen.getPrimaryDisplay().workArea, W = 330, H = 460;
    mini = new BrowserWindow({ ...(miniBounds || { x: wa.x + wa.width - W - 16, y: wa.y + wa.height - H - 16, width: W, height: H }), minWidth: 260, minHeight: 300,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: false, resizable: true, fullscreenable: false, maximizable: false, title: 'Chat nhanh', icon: ICON,
      webPreferences: { preload: path.join(__dirname, 'mini-preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    mini.setAlwaysOnTop(true, 'floating'); mini.setMenu(null);
    mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mini.on('close', () => { try { miniBounds = mini.getBounds(); } catch {} });
    mini.on('closed', () => { mini = null; pageJs('window.App?.inbox?.miniClosed?.()').catch(() => {}); });
    mini.loadFile(path.join(__dirname, 'mini.html'));
  };
  ipcMain.on('mini-open', e => { if (fromPage(e)) openMini(); });
  ipcMain.on('mini-push', (e, st) => { if (fromPage(e) && mini && !mini.isDestroyed()) mini.webContents.send('mini-state', st); });
  ipcMain.on('mini-win', (e, name) => { if (!mini || e.sender !== mini.webContents) return;
    if (name === 'close') mini.close(); else if (name === 'min') mini.minimize();
    else if (name === 'app') { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); pageJs("window.App?.show?.('inbox'); window.App?.inbox?.setPane?.('thread')").catch(() => {}); } });
  ipcMain.handle('mini-cmd', async (e, cmd, arg) => { if (!mini || e.sender !== mini.webContents) return null;
    if (cmd === 'state') return pageJs('window.App?.inbox?.miniState?.()').catch(() => null);
    if (cmd === 'send') return pageJs(`window.App?.inbox?.compose?.({ key: window.App.inbox.openKey(), text: ${JSON.stringify(String(arg || '').slice(0, 5000))}, autoSend: true })`).catch(x => x.message);
    if (cmd === 'open') return pageJs(`window.App?.inbox?.openId?.(${JSON.stringify(String(arg || ''))})`).catch(() => null);
    return null; });
  ipcMain.handle('meta-hidden-status', e => fromPage(e) ? auto.hiddenStatus() : []);
  // Zalo: trạng thái cho thanh trên cùng + ghi Downloads/GetHelps-debug/zalo.json (30 giây/lần) để chẩn đoán.
  ipcMain.handle('zalo-status', async e => { if (!fromPage(e)) return null;
    if (zaloColOpen) return { ...zalo.status(), state: 'loading', err: 'đang mở cột Zalo' };
    const url = ZW().getURL(); if (!url.startsWith('https://chat.zalo.me')) return { state: 'closed', ...zalo.status(), url };
    await zalo.ready().catch(() => {}); return zalo.status(); });
  setInterval(() => { try { const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); require('fs').mkdirSync(dir, { recursive: true });
    require('fs').writeFileSync(path.join(dir, 'zalo.json'), JSON.stringify({ at: new Date().toISOString(), url: ZW().getURL().slice(0, 80), colOpen: zaloColOpen, ...zalo.status(), listAgo: zalo.status().listAt ? Math.round((Date.now() - zalo.status().listAt) / 1000) : null }, null, 1));
    // Zalo ngầm chưa vào được: chụp màn hình khung ngầm (zalo-man-hinh.png) để thấy nó đang kẹt ở đâu.
    if (!zaloColOpen && zalo.status().state !== 'ready' && ZW().getURL().startsWith('https://chat.zalo.me')) ZW().capturePage().then(img => { if (!img.isEmpty()) require('fs').writeFileSync(path.join(dir, 'zalo-man-hinh.png'), img.toPNG()); }).catch(() => {});
  } catch {} }, 30e3);
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
      const done = token => { clearTimeout(timer); clearInterval(nudge); refreshing = null; if (!win.isDestroyed()) win.destroy(); resolve(token ? { token } : {}); };
      // Không lấy được token: chụp màn hình hộp thoại Facebook (dang-nhap-fb.png) để biết vì sao (đòi mật khẩu, đòi xác nhận…).
      const shot = () => win.webContents.capturePage().then(img => { const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); require('fs').mkdirSync(dir, { recursive: true }); require('fs').writeFileSync(path.join(dir, 'dang-nhap-fb.png'), img.toPNG()); }).catch(() => {});
      const timer = setTimeout(async () => { if (!win.isDestroyed()) await shot(); done(''); }, 30000);
      // Hộp thoại Đăng nhập cho doanh nghiệp hay hỏi lại "Tiếp tục dưới tên …" dù đã cấp quyền → tự bấm Tiếp tục / OK (tối đa 4 lần).
      // Gặp trang đòi mật khẩu / mã xác minh thì dừng ngay: cần bạn đăng nhập lại thật.
      let clicks = 0;
      const nudge = setInterval(async () => {
        if (win.isDestroyed()) return clearInterval(nudge);
        const r = await win.webContents.executeJavaScript(`(() => {
          if (document.querySelector('input[type=password], input[name=approvals_code], input[name=email]')) return 'login';
          const want = /^(tiếp tục|continue|tiếp tục dưới tên.*|continue as.*|ok|đồng ý|xác nhận|cho phép|allow)$/i;
          const el = [...document.querySelectorAll('button, [role=button], input[type=submit], a[role=button]')].find(b => { const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim(); const r = b.getBoundingClientRect(); return want.test(t) && r.width > 0 && r.height > 0 && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; });
          if (el) { el.click(); return 'clicked'; }
          return '';
        })()`).catch(() => '');
        if (r === 'login') { clearInterval(nudge); await shot(); done(''); }
        else if (r === 'clicked' && ++clicks >= 4) clearInterval(nudge);
      }, 1500);
      win.on('closed', () => clearInterval(nudge));
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
    downloaded = r.updateInfo.version; // luôn là bản mới nhất vừa kiểm tra (không giữ bản tải từ lần trước)
    return { state: 'ready', version: downloaded };
  };
  const checkUpdate = () => checking ||= (async () => {
    try {
      // Luôn hỏi lại GitHub: đã tải sẵn bản cũ hơn mà có bản mới hơn thì tải bản mới (bản đã tải thì electron-updater dùng lại ngay).
      try { return await checkOnce(); } catch { await sleep(5000); try { return await checkOnce(); } catch (e) { if (downloaded) return { state: 'ready', version: downloaded }; throw e; } }
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
  ipcMain.handle('update-install', async e => {
    if (!fromPage(e)) return;
    // Ngay trước khi cài: kiểm tra lại một lần để luôn lên bản mới nhất (có thể vừa phát hành thêm bản sau lúc tải sẵn).
    await checkUpdate().catch(() => {});
    if (!downloaded) return;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
    getUpdater().quitAndInstall(true, true);
  });
  layout();
  // Khoá app bằng mật khẩu (lớp phủ trên cùng); tạo sau mọi khung khác để luôn che được.
  const appLock = setupLock({ mainWindow, focusPage: () => pageView.webContents.focus(), sessions: [ses, metaSes, zaloSes, svcSes] });
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
      { label: 'Đăng nhập lại Zalo (xoá phiên, quét QR)', click: () => { zaloFix = 0; resetZalo(true); show('zalo', true); } },
      { label: 'Lưu chẩn đoán Zalo', click: async () => {
        const dir = app.getPath('desktop'), stamp = new Date().toISOString().replace(/[:.]/g, '-'), wc = zaloColOpen ? zaloView.webContents : ZW();
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
  app.toggleStudio = toggleStudio; app.views = { page: pageView, panel: panelView, meta: metaView, zalo: zaloView, svc: svcView, worker, bar };
  // Tắt cửa sổ chính = thoát hẳn: đóng mọi cửa sổ ẩn (Business Suite ngầm, ChatGPT của Studio AI…) và ép thoát sau 2 giây
  // nếu còn gì giữ app sống, để không còn "Get Helps.exe" chạy ngầm làm bộ cài báo "không thể đóng".
  mainWindow.on('closed', () => { mainWindow = null; for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.quit(); setTimeout(() => app.exit(0), 2000).unref?.(); });
  if (app.isPackaged) { checkUpdate().catch(() => {}); setInterval(() => checkUpdate().catch(() => {}), 2 * 3600e3); }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { setTimeout(() => app.exit(0), 4000).unref?.(); });
