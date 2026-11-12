// Khoá app bằng mật khẩu: lớp phủ che toàn bộ cửa sổ khi mở app, khi thu nhỏ / khoá màn hình Windows / không dùng N phút.
// Mật khẩu lưu dạng băm scrypt + muối trong thư mục dữ liệu app (không lưu mật khẩu gốc).
const { app, ipcMain, powerMonitor, session, WebContentsView } = require('electron');
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'lock.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return {}; } };
const write = cfg => fs.writeFileSync(FILE(), JSON.stringify(cfg));
const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const verify = (cfg, pw) => !!cfg.hash && crypto.timingSafeEqual(Buffer.from(hash(pw, cfg.salt), 'hex'), Buffer.from(cfg.hash, 'hex'));

function setupLock({ mainWindow, focusPage, sessions = [] }) {
  let cfg = read(), locked = false, mode = '', fails = 0, blockedUntil = 0;
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'lock-preload.js') } });
  const place = () => {
    if (!mode) return view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    const { width, height } = mainWindow.getContentBounds();
    mainWindow.contentView.removeChildView(view); mainWindow.contentView.addChildView(view); // luôn nằm trên cùng
    view.setBounds({ x: 0, y: 0, width, height });
  };
  mainWindow.on('resize', place);
  const open = m => { mode = m; view.webContents.loadFile(path.join(__dirname, 'lock.html'), { query: { mode: m, has: cfg.hash ? '1' : '' } }); place(); view.webContents.focus(); };
  const close = () => { mode = ''; place(); focusPage(); };
  const lock = () => { if (!cfg.hash || locked) return; locked = true; open('unlock'); };
  const state = () => ({ enabled: !!cfg.hash, onMinimize: cfg.onMinimize !== false, idleMinutes: cfg.idleMinutes ?? 10 });

  ipcMain.handle('lock-state', () => state());
  ipcMain.handle('lock-unlock', (e, pw) => {
    if (e.sender !== view.webContents) return { ok: false };
    if (Date.now() < blockedUntil) return { ok: false, error: `Thử lại sau ${Math.ceil((blockedUntil - Date.now()) / 1000)} giây.` };
    if (!verify(cfg, pw)) { if (++fails >= 5) { fails = 0; blockedUntil = Date.now() + 30e3; } return { ok: false, error: 'Sai mật khẩu.' }; }
    fails = 0; locked = false; close(); return { ok: true };
  });
  ipcMain.handle('lock-save', (e, { current, next, onMinimize, idleMinutes, remove }) => {
    if (e.sender !== view.webContents) return { ok: false };
    if (cfg.hash && !verify(cfg, current)) return { ok: false, error: 'Mật khẩu hiện tại không đúng.' };
    if (remove) { cfg = {}; write(cfg); close(); return { ok: true }; }
    if (next != null && next !== '') {
      if (String(next).length < 4) return { ok: false, error: 'Mật khẩu cần ít nhất 4 ký tự.' };
      const salt = crypto.randomBytes(16).toString('hex'); cfg.salt = salt; cfg.hash = hash(next, salt);
    }
    if (!cfg.hash) return { ok: false, error: 'Nhập mật khẩu mới.' };
    cfg.onMinimize = !!onMinimize; cfg.idleMinutes = Math.max(0, Math.min(240, Number(idleMinutes) || 0));
    write(cfg); close(); return { ok: true };
  });
  ipcMain.handle('lock-cancel', e => { if (e.sender === view.webContents && mode === 'setup') close(); });
  // Quên mật khẩu: xoá mật khẩu + đăng xuất mọi phiên trong app (Facebook, Business Suite, ChatGPT) rồi mở lại.
  ipcMain.handle('lock-reset', async e => {
    if (e.sender !== view.webContents) return;
    for (const s of sessions) await s.clearStorageData().catch(() => {});
    cfg = {}; write(cfg); app.relaunch(); app.exit(0);
  });

  mainWindow.on('minimize', () => { if (cfg.onMinimize !== false) lock(); });
  powerMonitor.on('lock-screen', lock);
  powerMonitor.on('suspend', lock);
  setInterval(() => { if (cfg.hash && cfg.idleMinutes > 0 && powerMonitor.getSystemIdleTime() >= cfg.idleMinutes * 60) lock(); }, 30e3);
  lock(); // có mật khẩu thì khoá ngay khi mở app
  return { lock, settings: () => open('setup'), state, view, isLocked: () => locked };
}
module.exports = { setupLock, hash, verify };
