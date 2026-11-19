// Tìm bài trên trang cá nhân / Page của khách khi khách không gửi link (gửi ảnh chụp bài, nói "bài đầu luôn"…).
// Mở trang khách bằng phiên Facebook trong app (ngầm, chỉ đọc), lấy vài bài mới nhất: link, chữ đầu, ảnh thu nhỏ của bài;
// nếu khách có gửi ảnh: so ảnh khách gửi với ảnh của từng bài (img-match.js) và chọn sẵn bài giống nhất.
const { gray, bestDistance } = require('./img-match');

module.exports = function createFbPosts({ BrowserWindow, partition, asChrome, ses, nativeImage }) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let chain = Promise.resolve();
  const one = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const READ = `(() => {
    const top = [...document.querySelectorAll('[role="article"], div[aria-posinset]')].filter(a => !a.parentElement?.closest('[role="article"], div[aria-posinset]'));
    const POST = /\\/posts\\/|story_fbid=|\\/permalink\\/|\\/photo(\\.php|\\/)|\\/videos\\/|\\/reel\\/|\\/share\\/p\\//;
    return top.map(a => { const r = a.getBoundingClientRect();
      const links = [...a.querySelectorAll('a[href]')].map(x => x.href).filter(h => POST.test(h) && !/comment_id=/.test(h));
      const best = links.find(h => /\\/posts\\/|story_fbid=|\\/permalink\\//.test(h)) || links[0] || '';
      const imgs = [...a.querySelectorAll('img')].filter(i => Math.max(i.naturalWidth, i.width) >= 120).map(i => i.currentSrc || i.src).filter(u => /scontent|fbcdn/.test(u)).slice(0, 4);
      const msg = a.querySelector('[data-ad-preview="message"],[data-ad-comet-preview="message"],div[dir="auto"]');
      return { link: best, imgs, text: (msg?.innerText || '').trim().slice(0, 220), top: r.top + scrollY, h: r.height };
    }).filter(p => p.link);
  })()`;
  const clean = href => { try { const u = new URL(href); const keep = ['story_fbid', 'id', 'fbid', 'set', 'v']; [...u.searchParams.keys()].forEach(k => { if (!keep.includes(k)) u.searchParams.delete(k); }); u.hash = ''; return u.href; } catch { return href; } };
  const grab = async (url, width) => { // ảnh xám thu nhỏ
    try { const r = await ses.fetch(url); if (!r.ok) return null; const img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer())); if (img.isEmpty()) return null;
      const s = img.resize({ width }), { width: w, height: h } = s.getSize(); return gray(s.toBitmap(), w, h, true); } catch { return null; }
  };
  const findPosts = ({ url, pics = [], max = 6 } = {}) => one(async () => {
    let u; try { u = new URL(url); } catch { return { error: 'Chưa có link trang Facebook của khách.' }; }
    const w = new BrowserWindow({ show: false, width: 1000, height: 1600, webPreferences: { partition, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await asChrome(w.webContents);
      await Promise.race([w.webContents.loadURL(u.href), wait(25e3)]).catch(() => {});
      await wait(4000 + Math.random() * 1500);
      const at = w.webContents.getURL();
      if (/\/(login|checkpoint)/.test(new URL(at).pathname)) return { error: 'Phiên Facebook trong app cần đăng nhập lại (mở cột Meta).' };
      const seen = new Map();
      for (let i = 0; i < 6 && seen.size < max; i++) {
        const list = await w.webContents.executeJavaScript(READ).catch(() => []);
        for (const p of list) { const k = clean(p.link); if (!seen.has(k)) seen.set(k, { ...p, link: k }); }
        await w.webContents.executeJavaScript('scrollBy(0, 1300)').catch(() => {}); await wait(1600 + Math.random() * 900);
      }
      const posts = [...seen.values()].sort((a, b) => a.top - b.top).slice(0, max);
      if (!posts.length) return { error: 'Không đọc được bài nào trên trang khách (trang riêng tư, chỉ bạn bè xem, hoặc Facebook đổi giao diện).', url: at };
      // Ảnh thu nhỏ từng bài để bạn nhìn chọn.
      for (const p of posts) {
        try { await w.webContents.executeJavaScript(`scrollTo(0, ${Math.max(0, p.top - 20)})`); await wait(700);
          const cap = await w.webContents.capturePage({ x: 0, y: 0, width: 1000, height: Math.min(1600, Math.max(300, Math.round(p.h) + 40)) });
          p.thumb = cap.isEmpty() ? '' : cap.resize({ width: 320 }).toDataURL(); } catch { p.thumb = ''; }
      }
      // So ảnh khách gửi với ảnh của bài.
      const shots = []; for (const src of pics.slice(0, 3)) { const g = await grab(src, 200); if (g) shots.push(g); }
      if (shots.length) for (const p of posts) {
        let d = 64; for (const src of p.imgs) { const g = await grab(src, 72); if (!g) continue; for (const s of shots) d = Math.min(d, bestDistance(s, g)); }
        p.dist = d;
      }
      let best = -1;
      if (shots.length) { const ds = posts.map(p => p.dist ?? 64), m = Math.min(...ds), second = ds.filter((_, i) => i !== ds.indexOf(m)).reduce((a, b) => Math.min(a, b), 64);
        if (m <= 12 && second - m >= 3) best = ds.indexOf(m); }
      return { posts: posts.map(({ top, h, imgs, ...p }) => ({ ...p, hasImg: imgs.length > 0 })), best, compared: shots.length };
    } catch (e) { return { error: e.message }; } finally { if (!w.isDestroyed()) w.destroy(); }
  });
  return { findPosts };
};
