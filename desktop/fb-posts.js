// Tìm bài trên trang cá nhân / Page của khách khi khách không gửi link (gửi ảnh chụp bài, nói "bài đầu luôn"…).
// Mở trang khách bằng phiên Facebook trong app (ngầm, chỉ đọc), lấy vài bài mới nhất: link, chữ đầu, ảnh thu nhỏ của bài;
// nếu khách có gửi ảnh: so ảnh khách gửi với ảnh của từng bài (img-match.js) và chọn sẵn bài giống nhất.
const { gray, bestDistance, wholeDistance } = require('./img-match');

module.exports = function createFbPosts({ BrowserWindow, partition, asChrome, ses, nativeImage, saveDebug }) {
  // Chẩn đoán: cấu trúc trang lúc đọc (Downloads/GetHelps-debug/tim-bai.json) để chỉnh khi Facebook đổi giao diện.
  const DIAG = `(() => ({ url: location.href, title: document.title, h: [...document.querySelectorAll('h1,h2,h3')].slice(0, 6).map(e => e.innerText.slice(0, 80)),
    articles: document.querySelectorAll('[role="article"]').length, posinset: document.querySelectorAll('div[aria-posinset]').length, feed: document.querySelectorAll('[role="feed"]').length,
    main: !!document.querySelector('[role="main"]'), login: !!document.querySelector('input[name="email"],input[name="pass"]'),
    text: (document.body?.innerText || '').slice(0, 600), links: [...document.querySelectorAll('[role="main"] a[href]')].slice(0, 60).map(a => a.href.slice(0, 140) + ' | ' + (a.innerText || a.getAttribute('aria-label') || '').slice(0, 40)) }))()`;
  const diag = async (w, step, extra) => { try { saveDebug?.(step, { ...(await w.webContents.executeJavaScript(DIAG)), ...extra }); } catch {} };
  const UNAVAIL = /không xem được nội dung này|this content isn't available|content isn.t available|trang này không khả dụng|page isn't available/i;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let chain = Promise.resolve();
  const one = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const READ = `(() => {
    const top = [...document.querySelectorAll('[role="article"], div[aria-posinset]')].filter(a => !a.parentElement?.closest('[role="article"], div[aria-posinset]'));
    const POST = /\\/posts\\/|story_fbid=|\\/permalink\\/|\\/photo(\\.php|\\/)|\\/videos\\/|\\/reel\\/|\\/share\\/p\\//;
    return top.map(a => { const r = a.getBoundingClientRect();
      const links = [...a.querySelectorAll('a[href]')].map(x => x.href).filter(h => POST.test(h) && !/comment_id=/.test(h));
      // Bài nhiều ảnh: link ảnh có set=pcb.<mã bài> → mã của cả bài (không phải 1 ảnh).
      const pcb = (links.map(h => (h.match(/[?&]set=pcb\\.(\\d+)/) || [])[1]).find(Boolean)) || '';
      const best = links.find(h => /\\/posts\\/|story_fbid=|\\/permalink\\//.test(h)) || links[0] || '';
      const imgs = [...a.querySelectorAll('img')].filter(i => Math.max(i.naturalWidth, i.width) >= 120).map(i => i.currentSrc || i.src).filter(u => /scontent|fbcdn/.test(u)).slice(0, 4);
      const msg = a.querySelector('[data-ad-preview="message"],[data-ad-comet-preview="message"],div[dir="auto"]');
      return { link: best, pcb, imgs, text: (msg?.innerText || '').trim().slice(0, 220), top: r.top + scrollY, h: r.height };
    }).filter(p => p.link);
  })()`;
  // Link giờ đăng của bài chỉ có địa chỉ thật khi rê chuột: giả lập rê chuột lên các link chưa có địa chỉ trong bài.
  const HOVER = `(() => { for (const a of document.querySelectorAll('[role="article"] a[role="link"], div[aria-posinset] a[role="link"]')) { const h = a.getAttribute('href') || ''; if (!h || h === '#' || /__cft__/.test(h) && !/\\/posts\\/|story_fbid|permalink/.test(h)) { for (const t of ['mouseover', 'mouseenter', 'focus', 'focusin']) a.dispatchEvent(new (t.startsWith('focus') ? FocusEvent : MouseEvent)(t, { bubbles: true })); } } })()`;
  const clean = href => { try { const u = new URL(href); const keep = ['story_fbid', 'id', 'fbid', 'set', 'v']; [...u.searchParams.keys()].forEach(k => { if (!keep.includes(k)) u.searchParams.delete(k); }); u.hash = ''; return u.href; } catch { return href; } };
  const grab = async (url, width) => { // ảnh xám thu nhỏ
    try { const r = await ses.fetch(url); if (!r.ok) return null; const img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer())); if (img.isEmpty()) return null;
      const s = img.resize({ width }), { width: w, height: h } = s.getSize(); return gray(s.toBitmap(), w, h, true); } catch { return null; }
  };
  const plain = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  const findPosts = ({ url, pics = [], max = 6, name = '' } = {}) => one(async () => {
    let u; try { u = new URL(url); } catch { return { error: 'Chưa có link trang Facebook của khách.' }; }
    const w = new BrowserWindow({ show: false, width: 1000, height: 1600, webPreferences: { partition, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await asChrome(w.webContents);
      await Promise.race([w.webContents.loadURL(u.href), wait(25e3)]).catch(() => {});
      await wait(4000 + Math.random() * 1500);
      const at = w.webContents.getURL();
      if (/\/(login|checkpoint)/.test(new URL(at).pathname)) return { error: 'Phiên Facebook trong app cần đăng nhập lại (mở cột Meta).' };
      const txt = await w.webContents.executeJavaScript(`document.body?.innerText.slice(0, 1500) || ''`).catch(() => '');
      if (UNAVAIL.test(txt)) { await diag(w, 'trang-khach', { name }); return { error: 'Facebook báo không xem được trang này (mã khách từ Business Suite không phải trang cá nhân thật, hoặc khách giới hạn người xem).', unavailable: true }; }
      // Đúng người không: tên khách có trên tiêu đề / đầu trang.
      const head = await w.webContents.executeJavaScript(`(document.title + ' ' + ([...document.querySelectorAll('h1,h2')].slice(0, 3).map(e => e.innerText).join(' ')))`).catch(() => '');
      // Đầu trang chỉ có chữ chung ("Facebook") thì chưa kết luận được → null.
      const nameMatch = !name || plain(head).replace(/facebook|\(\d+\)/g, '').trim().length < 3 ? null : plain(head).includes(plain(name)) || plain(name).split(' ').filter(x => x.length > 1).every(x => plain(head).includes(x));
      const seen = new Map();
      for (let i = 0; i < 6 && seen.size < max; i++) {
        await w.webContents.executeJavaScript(HOVER).catch(() => {}); await wait(900);
        const list = await w.webContents.executeJavaScript(READ).catch(() => []);
        for (const p of list) { const k = p.pcb ? 'pcb:' + p.pcb : clean(p.link); const old = seen.get(k);
          if (!old) seen.set(k, { ...p, link: clean(p.link) }); else if (!/\/posts\/|story_fbid=|\/permalink\//.test(old.link) && /\/posts\/|story_fbid=|\/permalink\//.test(p.link)) old.link = clean(p.link); }
        await w.webContents.executeJavaScript('scrollBy(0, 1300)').catch(() => {}); await wait(1600 + Math.random() * 900);
      }
      // Link của cả bài: ưu tiên link bài thật; chỉ có link ảnh thì đổi mã pcb thành link bài theo trang khách.
      const owner = (() => { try { const x = new URL(at); if (x.pathname === '/profile.php') return { id: x.searchParams.get('id') }; const v = x.pathname.split('/').filter(Boolean)[0]; return v ? { vanity: v } : null; } catch { return null; } })();
      const postLink = p => { if (/\/posts\/|story_fbid=|\/permalink\//.test(p.link) || !p.pcb || !owner) return p.link;
        return owner.id ? `https://www.facebook.com/permalink.php?story_fbid=${p.pcb}&id=${owner.id}` : `https://www.facebook.com/${owner.vanity}/posts/${p.pcb}`; };
      for (const p of seen.values()) p.link = postLink(p);
      const posts = [...seen.values()].sort((a, b) => a.top - b.top).slice(0, max);
      if (!posts.length) await diag(w, 'trang-khach', { name, nameMatch });
      if (!posts.length) return { error: 'Không đọc được bài nào trên trang khách (trang riêng tư, chỉ bạn bè xem, hoặc Facebook đổi giao diện).', url: at, nameMatch };
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
      if (nameMatch === false) await diag(w, 'trang-khach', { name, nameMatch, head });
      return { posts: posts.map(({ top, h, imgs, ...p }) => ({ ...p, hasImg: imgs.length > 0 })), best, compared: shots.length, nameMatch, url: at, head: String(head).replace(/\s*\|\s*Facebook.*$/, '').replace(/^\(\d+\)\s*/, '').slice(0, 80) };
    } catch (e) { return { error: e.message }; } finally { if (!w.isDestroyed()) w.destroy(); }
  });
  // Tìm trang khách theo tên trên Facebook, so ảnh đại diện với ảnh khách trong hộp thư → danh sách người, chọn sẵn người giống nhất.
  const PEOPLE = `(() => {
    const seen = new Map(), skip = /\\/(groups|pages|events|watch|marketplace|gaming|search|hashtag|stories|reel|photo|help|policies|settings)(\\/|$)/;
    for (const a of document.querySelectorAll('[role="main"] a[href], [role="feed"] a[href]')) {
      let u; try { u = new URL(a.href); } catch { continue; }
      if (!/facebook\\.com$/.test(u.hostname) || skip.test(u.pathname)) continue;
      const id = u.pathname === '/profile.php' ? u.searchParams.get('id') : u.pathname.split('/').filter(Boolean)[0];
      if (!id || /^(l\\.php|login|home\\.php)$/.test(id)) continue;
      const link = u.pathname === '/profile.php' ? 'https://www.facebook.com/profile.php?id=' + id : 'https://www.facebook.com/' + id;
      const text = (a.innerText || '').trim().split('\\n')[0], label = (a.getAttribute('aria-label') || '').replace(/^(ảnh đại diện của|profile picture of)\\s*/i, '').trim();
      let box = a, holder = null, pic = ''; for (let i = 0; i < 6 && box && !pic; i++, box = box.parentElement) { const im = box.querySelector('image, img'); if (im) { pic = im.getAttribute('xlink:href') || im.getAttribute('href') || im.currentSrc || im.src || ''; holder = box; } }
      const x = seen.get(link) || { link, name: '', pic: '', info: '' };
      if (text && text.length < 80) x.name = text; else if (!x.name && label && label.length < 80) x.name = label;
      if (!x.pic && /fbcdn|scontent/.test(pic)) x.pic = pic;
      const card = holder?.parentElement; if (!x.info && card) x.info = (card.innerText || '').split('\\n').map(t => t.trim()).filter(t => t && t !== x.name && t !== text).slice(0, 2).join(' · ').slice(0, 120);
      seen.set(link, x);
    }
    return [...seen.values()].filter(x => x.name);
  })()`;
  const findPeople = ({ name = '', avatar = '', max = 6 } = {}) => one(async () => {
    if (!name.trim()) return { error: 'Thiếu tên khách.' };
    const w = new BrowserWindow({ show: false, width: 1100, height: 1500, webPreferences: { partition, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await asChrome(w.webContents);
      await Promise.race([w.webContents.loadURL('https://www.facebook.com/search/people/?q=' + encodeURIComponent(name.trim())), wait(25e3)]).catch(() => {});
      await wait(4500 + Math.random() * 1500);
      if (/\/(login|checkpoint)/.test(new URL(w.webContents.getURL()).pathname)) return { error: 'Phiên Facebook trong app cần đăng nhập lại (mở cột Meta).' };
      let people = await w.webContents.executeJavaScript(PEOPLE).catch(() => []);
      if (!people.length) { await w.webContents.executeJavaScript('scrollBy(0, 900)').catch(() => {}); await wait(3000); people = await w.webContents.executeJavaScript(PEOPLE).catch(() => []); }
      const want = plain(name); people = people.filter(p => plain(p.name).includes(want) || want.split(' ').filter(x => x.length > 1).every(x => plain(p.name).includes(x))).slice(0, max);
      if (!people.length) { await diag(w, 'tim-nguoi', { name, raw: (await w.webContents.executeJavaScript(PEOPLE).catch(() => [])).slice(0, 15) }); return { error: 'Không thấy ai tên "' + name + '" trong kết quả tìm kiếm Facebook.' }; }
      const me = avatar ? await grab(avatar, 64) : null;
      for (const p of people) { const g = me && p.pic ? await grab(p.pic, 64) : null; p.dist = g ? wholeDistance(me, g) : null; }
      let best = -1; if (me) { const ds = people.map(p => p.dist ?? 64), m = Math.min(...ds); const second = ds.filter((_, i) => i !== ds.indexOf(m)).reduce((a, b) => Math.min(a, b), 64); if (m <= 10 && second - m >= 4) best = ds.indexOf(m); }
      return { people, best, compared: !!me };
    } catch (e) { return { error: e.message }; } finally { if (!w.isDestroyed()) w.destroy(); }
  });
  return { findPosts, findPeople };
};
