// Tự động hoá trang Meta Business Suite (đã đăng nhập trong app) cho những việc Graph API bị chặn khi app chưa Live:
//  - lookupProfile: mở hội thoại của khách trong một khung ẩn, đọc ảnh đại diện + UID (link trang cá nhân);
//  - composePost: mở trình soạn bài, điền sẵn nội dung + ảnh (qua debugger), người dùng bật nút Gửi tin nhắn / hẹn giờ rồi bấm Đăng.
// Mỗi lần chỉ làm một việc, có nghỉ giữa các lượt, để giống thao tác người thật.
const { clipboard, nativeImage, app } = require('electron');
const fs = require('fs'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isLogin = url => /\/(login|checkpoint)|loginpage|two_step_verification/i.test(url);

// Chạy trong trang Business Suite. Ưu tiên khung thông tin khách (có "Xem trang cá nhân" + ảnh lớn cạnh tên):
// lấy link trang cá nhân (UID nếu link dạng profile.php?id=… / số) và ảnh gần link đó; không có thì tìm ảnh gần tên khách.
function extractProfile({ pageId, name }) {
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = norm(name);
  const srcOf = el => el.tagName.toLowerCase() === 'img' ? el.currentSrc || el.src : el.getAttribute('xlink:href') || el.getAttribute('href') || '';
  const isPic = el => /fbcdn|fbsbx|scontent/.test(srcOf(el));
  const size = el => { const r = el.getBoundingClientRect(); return Math.max(r.width, r.height) || Number(el.getAttribute('width')) || 0; };
  const unwrap = href => { try { const u = new URL(href, location.href); if (u.hostname.startsWith('l.') || u.pathname === '/l.php') return u.searchParams.get('u') || href; return u.href; } catch { return href || ''; } };
  const uidOf = href => { const m = unwrap(href).match(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:profile\.php\?id=(\d{5,})|(\d{5,}))(?:[/?&#]|$)/); const id = m && (m[1] || m[2]); return id && id !== String(pageId) ? id : ''; };
  const picNear = (el, levels = 6) => {
    let best = null;
    for (let box = el, i = 0; i < levels && box; i++, box = box.parentElement) {
      const pics = [...box.querySelectorAll('img,image')].filter(isPic);
      if (pics.length) { for (const p of pics) if (!best || size(p) > size(best)) best = p; break; }
    }
    return best;
  };
  let uid = '', profileUrl = '', best = null;
  // 1) Link "Xem trang cá nhân" trong khung thông tin khách.
  const link = [...document.querySelectorAll('a,[role="link"]')].find(a => /xem trang cá nhân|view profile|trang cá nhân|xem hồ sơ/i.test(a.textContent || a.getAttribute('aria-label') || ''));
  if (link) {
    const href = link.getAttribute('href') ? unwrap(link.href) : '';
    if (/facebook\.com\//.test(href)) { profileUrl = href; uid = uidOf(href); if (uid) profileUrl = `https://www.facebook.com/profile.php?id=${uid}`; }
    best = picNear(link);
  }
  // 2) Link trang cá nhân dạng số ở bất kỳ đâu (bỏ qua Page).
  if (!uid) for (const a of document.querySelectorAll('a[href]')) { const id = uidOf(a.href); if (id) { uid = id; profileUrl = `https://www.facebook.com/profile.php?id=${id}`; break; } }
  // 3) Ảnh gần tên khách.
  if (!best && want) {
    const named = [...document.querySelectorAll('span,div,a,h1,h2,h3,[aria-label],img[alt]')]
      .filter(el => norm(el.getAttribute('aria-label')) === want || norm(el.getAttribute('alt')) === want || (el.childElementCount === 0 && norm(el.textContent) === want));
    for (const el of named) {
      const p = el.tagName.toLowerCase() === 'img' && isPic(el) ? el : picNear(el);
      if (p && (!best || size(p) > size(best))) best = p;
    }
  }
  const nameSeen = !!want && document.body.innerText.toLowerCase().includes(want);
  // Khung thông tin phải đúng khách (có tên) thì mới tin ảnh/link lấy từ đó.
  if (want && !nameSeen) return { pic: '', uid: '', profileUrl: '', nameSeen };
  return { pic: best ? srcOf(best) : '', uid, profileUrl, nameSeen };
}

// Chạy trong trang Business Suite: đọc các dòng hội thoại đang hiện; scroll=true thì cuộn danh sách xuống để tải thêm.
function readRows(scroll) {
  const rows = [...document.querySelectorAll('[data-maiba-contact-id][data-maiba-contact-type="fb_user"]')].map(el => ({
    uid: el.getAttribute('data-maiba-contact-id'),
    name: (el.querySelector('[data-surface$="lib:thread_title"]')?.innerText || '').trim(),
    pic: [...el.querySelectorAll('img')].map(i => i.currentSrc || i.src).find(u => /scontent|fbcdn\.net\/v\//.test(u) && !/static\.xx/.test(u)) || '',
  })).filter(r => /^\d{5,}$/.test(r.uid) && r.name);
  let end = false;
  if (scroll && rows.length) {
    let box = document.querySelector('[data-maiba-contact-id]');
    while (box && !(box.scrollHeight > box.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (box) { const before = box.scrollTop; box.scrollTop = box.scrollHeight; end = box.scrollTop === before && before > 0; } else end = true;
  }
  return { rows, end };
}

// Chạy trong trang Business Suite: các hội thoại đang hiện, kèm tin cuối, giờ (chữ Meta ghi) và chưa đọc (tin cuối in đậm).
function readThreads(scroll) {
  // Mốc giờ ở cuối mỗi dòng: "09:28", "Hôm qua", "T6"/"Thứ 6"/"Thứ Sáu", "13 Tháng 11", "13/11", "1 ngày", "Nov 13", "Fri"…
  const isTime = s => s.length <= 24 && /^(vừa xong|now|just now|hôm qua|yesterday|\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|[smhdwy])|\d{1,2}:\d{2}(\s*[ap]m)?|(th|thứ|t)\s?[2-7]|thứ\s+(hai|ba|tư|năm|sáu|bảy)|chủ nhật|cn|(mon|tue|wed|thu|fri|sat|sun)[a-z]*|\d{1,2}\s*(thg|tháng)\s*\d{1,2}(,?\s*\d{4})?|[a-z]{3}\s+\d{1,2}(,\s*\d{4})?|\d{1,2}\/\d{1,2}(\/\d{2,4})?)$/i.test(s);
  const rows = [...document.querySelectorAll('[data-maiba-contact-id][data-maiba-contact-type="fb_user"]')].map(el => {
    const title = el.querySelector('[data-surface$="lib:thread_title"]'), name = (title?.innerText || '').trim();
    const leaves = [...el.querySelectorAll('span,div,abbr')].filter(x => x.childElementCount === 0 && !title?.contains(x));
    const lines = leaves.map(x => (x.innerText || x.textContent || '').trim()).filter(s => s && s !== name && !/^[·•]$/.test(s));
    // Mốc giờ: dòng chữ giống giờ; không có thì lấy từ thẻ <abbr>/<time>/aria-label (Meta hay đổi cách hiện).
    const tagged = [...el.querySelectorAll('abbr, time, [aria-label]')].map(x => (x.getAttribute('aria-label') || x.getAttribute('title') || x.innerText || '').trim()).find(isTime);
    const time = lines.find(isTime) || tagged || '';
    const snippet = lines.filter(s => s !== time).sort((a, b) => b.length - a.length)[0] || '';
    const leaf = snippet && leaves.find(x => (x.innerText || x.textContent || '').trim() === snippet);
    return {
      uid: el.getAttribute('data-maiba-contact-id'), name, snippet, time, raw: time ? undefined : lines.slice(0, 8),
      unread: !!leaf && Number(getComputedStyle(leaf).fontWeight) >= 600,
      pic: [...el.querySelectorAll('img')].map(i => i.currentSrc || i.src).find(u => /scontent|fbcdn\.net\/v\//.test(u) && !/static\.xx/.test(u)) || '',
    };
  }).filter(r => /^\d{5,}$/.test(r.uid) && r.name);
  if (scroll && rows.length) { // danh sách chỉ vẽ phần đang thấy: cuộn xuống để Business Suite vẽ thêm
    let box = document.querySelector('[data-maiba-contact-id]');
    while (box && !(box.scrollHeight > box.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (box) box.scrollTop += box.clientHeight;
  }
  return rows;
}

// Chạy trong trang Business Suite: tin của hội thoại đang mở. Mỗi tin là một khối [data-message-id] trong cột hội thoại
// (theo giao diện thật 11/2026); bong bóng lệch phải = Page gửi, lệch trái = khách; dòng mốc "20:55 28 Tháng 10, 2026" = mốc giờ.
// scrollUp=true thì cuộn lên đầu để Business Suite tải tin cũ hơn.
function readMessages(scrollUp) {
  const col = document.querySelector('[data-surface$="lib:inbox:detail_column"]');
  if (!col) return null;
  const blocks = [...col.querySelectorAll('[data-message-id]')];
  if (scrollUp) {
    let box = blocks[0]?.parentElement;
    while (box && box !== col && !(box.scrollHeight > box.clientHeight + 20)) box = box.parentElement;
    if (box) box.scrollTop = 0;
    return { scrolled: true };
  }
  // Khung detail_column gồm cả cột thông tin khách bên phải → lấy đúng vùng danh sách tin (hoặc hợp các khối tin) để chia trái/phải.
  const list = col.querySelector('[aria-label^="Vùng chứa danh sách tin nhắn"], [aria-label^="Message list container"], [role="log"], [role="grid"]');
  const lr = list?.getBoundingClientRect();
  const br = blocks.map(b => b.getBoundingClientRect()).filter(b => b.width > 0);
  const area = lr?.width > 100 ? lr : br.length ? { left: Math.min(...br.map(b => b.left)), right: Math.max(...br.map(b => b.right)), width: Math.max(...br.map(b => b.right)) - Math.min(...br.map(b => b.left)) } : col.getBoundingClientRect();
  const mid = area.left + area.width / 2, items = [];
  for (const el of blocks) {
    // Khối [data-message-id] có khi rộng cả cột → xét chính nội dung (chữ/ảnh): sát lề phải = tin của Page, sát lề trái = tin khách.
    const r = el.getBoundingClientRect();
    const parts = [...el.querySelectorAll('[dir="auto"]')].filter(x => !x.parentElement.closest('[dir="auto"]'));
    const boxes = [...parts, ...el.querySelectorAll('img')].map(x => x.getBoundingClientRect()).filter(b => b.width > 4 && b.height > 4);
    const L = boxes.length ? Math.min(...boxes.map(b => b.left)) : r.left, R = boxes.length ? Math.max(...boxes.map(b => b.right)) : r.right;
    const mine = boxes.length ? (L - area.left) > (area.right - R) : r.left + r.width / 2 > mid;
    const text = parts.map(x => (x.innerText || '').trim()).filter(Boolean).join('\n');
    if (text) items.push({ y: r.top, mine, text });
    for (const img of el.querySelectorAll('img')) {
      const b = img.getBoundingClientRect(), src = img.currentSrc || img.src;
      if (Math.max(b.width, b.height, img.naturalWidth || 0) >= 60 && /fbcdn\.net|scontent|^blob:/.test(src)) items.push({ y: b.top + 0.1, mine, pic: src });
    }
  }
  const SEP = /^\d{1,2}:\d{2}(\s+\d{1,2}\s+tháng\s+\d{1,2}(,\s*\d{4})?)?$|^(hôm nay|hôm qua|today|yesterday)\b/i;
  const seen = new Set();
  for (const el of col.querySelectorAll('div,span')) {
    if (el.childElementCount || el.closest('[data-message-id],[data-surface$="detail_view_header"],[contenteditable="true"]')) continue;
    const t = (el.innerText || '').trim(), y = el.getBoundingClientRect().top;
    if (SEP.test(t) && !seen.has(t + y)) { seen.add(t + y); items.push({ y: y - 0.1, sep: t }); }
  }
  items.sort((a, b) => a.y - b.y);
  return { messages: items.map(({ y, ...m }) => m), count: blocks.length };
}

// Chạy trong trang: tìm phần tử hiện trên màn hình theo selector / role / chữ / nhãn (aria-labelledby), cuộn vào giữa, trả toạ độ tâm.
function findTarget({ selector, role, text, label, enabled }) {
  const re = s => s ? new RegExp(s, 'i') : null, tRe = re(text), lRe = re(label);
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };
  const own = el => (el.innerText || el.getAttribute('aria-label') || '').trim();
  let list = [...document.querySelectorAll(selector || (role ? `[role="${role}"]` : 'button,[role="button"],a,span,div,label'))];
  if (tRe) list = list.filter(el => tRe.test(own(el)) && (selector || role || ![...el.children].some(c => tRe.test(own(c)))));
  if (lRe) list = list.filter(el => (el.getAttribute('aria-labelledby') || '').split(' ').some(id => lRe.test((document.getElementById(id)?.innerText || '').trim())));
  if (enabled) list = list.filter(el => el.getAttribute('aria-disabled') !== 'true' && !el.disabled);
  const el = list.find(shown);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

// Đưa ảnh (data URL) thẳng từ bộ nhớ vào ô chọn file của trang (không ghi file ra máy). Trả true nếu ô nhận đúng 1 file.
async function putImage(dbg, objectId, image, base) {
  const m = String(image || '').match(/^data:(image\/(\w+));base64,(.+)$/);
  if (!m || !objectId) return false;
  const r = await dbg.sendCommand('Runtime.callFunctionOn', { objectId, returnByValue: true,
    arguments: [{ value: m[3] }, { value: m[1] }, { value: `${base}.${m[2] === 'jpeg' ? 'jpg' : m[2]}` }],
    functionDeclaration: `function (b64, type, name) {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
      this.files = dt.files;
      const n = this.files.length; // đếm trước: trang thường xoá ô chọn file ngay sau khi nhận ảnh
      this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
      return n;
    }` }).catch(() => null);
  return r?.result?.value === 1;
}

function createMetaAuto({ worker, makeWorker = null, composer, metaView, showMeta = () => () => {}, metaShown = () => true, notify = () => {}, progress = () => {}, threadChanged = () => {} }) {
  // Hội thoại đang mở trong khung ẩn có tin mới/đổi → báo ngay cho Hộp thư (không phải chờ chu kỳ đọc lại).
  // Trang ẩn theo dõi khung tin bằng MutationObserver và in một dấu hiệu ra console; ở đây bắt dấu hiệu đó.
  const watchThread = wc => wc.executeJavaScript(`(() => { try { window.__gaObs?.disconnect(); } catch {}
    const col = document.querySelector('[data-surface$="lib:inbox:detail_column"]'); if (!col) return false;
    let t = 0; window.__gaObs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => console.log('__GA_THREAD_CHANGED__'), 500); });
    window.__gaObs.observe(col, { childList: true, subtree: true, characterData: true }); return true; })()`).catch(() => false);
  // Hai hàng chờ riêng: đọc avatar (khung ẩn) không phải chờ trình soạn bài (có thể mở lâu).
  const makeQueue = () => { let chain = Promise.resolve(); return fn => (chain = chain.then(fn, fn)); };
  // Khung ẩn làm từng việc một. Việc bạn đang chờ (mở hội thoại, gửi tin) được chen lên trước việc chạy nền (đọc danh sách, tra avatar).
  const makePrioQueue = () => {
    const tasks = []; let running = false;
    const next = async () => {
      if (running || !tasks.length) return;
      running = true;
      tasks.sort((a, b) => b.prio - a.prio || a.n - b.n);
      const t = tasks.shift();
      try { t.ok(await t.fn()); } catch (e) { t.bad(e); } finally { running = false; next(); }
    };
    let n = 0;
    return (fn, prio = 0) => new Promise((ok, bad) => { tasks.push({ fn, prio, ok, bad, n: n++ }); next(); });
  };
  const composeQueue = makeQueue();
  // Mỗi Page một khung ẩn riêng (chạy song song): đọc danh sách Page này không làm mất hội thoại đang mở của Page khác,
  // bấm khách Page nào cũng mở ngay trong khung của Page đó. Khung đầu tiên dùng cửa sổ có sẵn; tối đa 8 khung, dư thì đóng khung lâu không dùng.
  const slots = new Map();
  const slot = pageId => {
    pageId = String(pageId);
    let sl = slots.get(pageId);
    if (!sl) {
      const rootFree = ![...slots.values()].some(x => x.win === worker);
      if (!rootFree && makeWorker && slots.size >= 8) { // đóng khung lâu không dùng nhất (không đóng cửa sổ gốc)
        const old = [...slots.entries()].filter(([, x]) => x.win !== worker).sort((a, b) => a[1].used - b[1].used)[0];
        if (old) { slots.delete(old[0]); try { old[1].win.destroy(); } catch {} }
      }
      const shared = !rootFree && !makeWorker ? [...slots.values()].find(x => x.win === worker) : null; // không tạo được khung mới: dùng chung khung gốc
      const win = rootFree || !makeWorker ? worker : makeWorker();
      sl = { pageId, win, opened: '', used: Date.now(), queue: shared?.queue || makePrioQueue(), lastPing: 0 };
      if (!shared) sl.win.webContents.on('console-message', (e, level, message) => {
        const msg = typeof e?.message === 'string' ? e.message : String(message || '');
        if (msg !== '__GA_THREAD_CHANGED__' || Date.now() - sl.lastPing < 1500) return;
        // Khung gửi dấu hiệu → báo hội thoại đang mở của (các) Page dùng khung này.
        for (const x of slots.values()) if (x.win === sl.win && x.opened) { sl.lastPing = Date.now(); try { threadChanged(x.opened); } catch {} }
      });
      slots.set(pageId, sl);
    }
    sl.used = Date.now();
    return sl;
  };
  const queue = (pageId, fn, prio = 0) => { const sl = slot(pageId); return sl.queue(async () => { await sl.win.ready; return fn(); }, prio); };

  // Danh sách hội thoại Business Suite: mỗi dòng có data-maiba-contact-id (UID Facebook thật của khách), tên và ảnh.
  // Đọc cả danh sách của một Page một lần (lưu 10 phút), rồi so tên với khách trong app.
  const pageRows = new Map(); // pageId -> { at, rows: Map(nameKey -> [{uid,name,pic}]) }
  const key = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const loadRows = async (pageId, wantName) => {
    const cached = pageRows.get(pageId);
    if (cached && Date.now() - cached.at < 10 * 60e3 && (!wantName || cached.rows.has(key(wantName)) || cached.full)) return cached;
    const sl = slot(pageId), wc = sl.win.webContents;
    if (!cached || !wc.getURL().includes(`asset_id=${pageId}`)) {
      sl.opened = '';
      await wc.loadURL(`https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&mailbox_id=${pageId}`).catch(() => {});
      await sleep(2500);
    }
    const entry = { at: Date.now(), rows: new Map(), full: false };
    for (let i = 0; i < 12; i++) {
      if (isLogin(wc.getURL())) return { error: 'login' };
      const r = await wc.executeJavaScript(`(${readRows})(${JSON.stringify(i > 2)})`).catch(() => ({ rows: [] }));
      for (const row of r.rows) {
        const list = entry.rows.get(key(row.name)) || [];
        if (!list.some(x => x.uid === row.uid)) list.push(row);
        entry.rows.set(key(row.name), list);
      }
      if (wantName && entry.rows.has(key(wantName))) break;
      if (r.end) { entry.full = true; break; }
      await sleep(1200 + Math.random() * 800);
    }
    pageRows.set(pageId, entry);
    return entry;
  };
  const lookupProfile = ({ pageId, psid, name }) => queue(pageId, async () => {
    if (!/^\d+$/.test(String(pageId)) || !/^\d+$/.test(String(psid))) return { error: 'Thiếu Page hoặc khách.' };
    const entry = await loadRows(String(pageId), name);
    if (entry.error) return entry;
    const found = entry.rows.get(key(name)) || [];
    if (found.length !== 1) return { error: found.length ? 'trùng tên' : 'not-found' }; // trùng tên thì không đoán
    const { uid, pic } = found[0];
    return { pic, uid, profileUrl: `https://www.facebook.com/profile.php?id=${uid}` };
  });

  // Hộp thư dự phòng khi Graph API lỗi: đọc danh sách hội thoại mới nhất của Page trong khung ẩn.
  const listThreads = ({ pageId, max = 40 }) => !/^\d+$/.test(String(pageId)) ? Promise.resolve({ error: 'Thiếu Page.' }) : queue(pageId, async () => {
    const sl = slot(pageId), wc = sl.win.webContents;
    // Đang ở hộp thư của đúng Page (vd vừa mở hội thoại): đọc danh sách tại chỗ, không tải lại trang → hội thoại đang theo dõi vẫn giữ.
    const here = wc.getURL().includes(`asset_id=${pageId}`) && await wc.executeJavaScript(`!!document.querySelector('[data-maiba-contact-id]')`).catch(() => false);
    if (!here) { sl.opened = ''; await wc.loadURL(`https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&mailbox_id=${pageId}`).catch(() => {}); }
    else { // lần đọc trước đã cuộn danh sách xuống: cuộn về đầu để lấy hội thoại mới nhất
      await wc.executeJavaScript(`(() => { let box = document.querySelector('[data-maiba-contact-id]');
        while (box && !(box.scrollHeight > box.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
        if (box) box.scrollTop = 0; })()`).catch(() => {});
      await sleep(1200);
    }
    const seen = new Map(), started = Date.now();
    // Business Suite trong khung ẩn có khi tải 15–20 giây: còn vòng xoay (progressbar / aria-busy) và chưa có dòng nào thì chờ tiếp, tối đa 30 giây.
    // Chờ tới khi danh sách có dòng đầu tiên (tối đa 60 giây: nhiều Page tải cùng lúc thì mỗi trang chậm hơn), không chỉ lúc còn vòng xoay.
    const hasRows = () => wc.executeJavaScript(`!!document.querySelector('[data-maiba-contact-id]')`).catch(() => false);
    while (Date.now() - started < 60000 && !await hasRows()) { await sleep(700); if (isLogin(wc.getURL())) return { error: 'login' }; }
    if (!await hasRows()) { const dir = await dumpPage(wc, 'khong-co-danh-sach'); return { error: `Business Suite chưa hiện danh sách hội thoại sau 60 giây (${wc.getURL().slice(0, 80)})${dir ? ' · đã lưu ảnh chụp vào ' + dir : ''}` }; }
    for (let i = 0, got = 0; i < 12; i++) {
      await sleep(i ? 700 : 1500);
      if (isLogin(wc.getURL())) return { error: 'login' };
      const part = await wc.executeJavaScript(`(${readThreads})(${JSON.stringify(seen.size > 0)})`).catch(() => []);
      for (const r of part) if (!seen.has(r.uid)) seen.set(r.uid, r);
      if (seen.size >= max || (seen.size && seen.size === got && i > 4)) break; // đủ, hoặc cuộn hết
      got = seen.size;
    }
    const rows = [...seen.values()].slice(0, max);
    // Nhiều dòng không đọc được giờ: lưu mẫu chữ của các dòng đó để chỉnh cách đọc (Downloads/GetHelps-debug).
    const noTime = rows.filter(r => !r.time);
    if (noTime.length > rows.length / 3) try {
      const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `gio-danh-sach-${pageId}.json`), JSON.stringify(noTime.slice(0, 15).map(r => ({ name: r.name.slice(0, 2) + '…', raw: r.raw })), null, 1));
    } catch {}
    for (const r of rows) delete r.raw;
    // Dùng luôn cho tra avatar (cùng Page, khỏi tải lại).
    const entry = { at: Date.now(), rows: new Map(), full: false };
    for (const r of rows) entry.rows.set(key(r.name), [...(entry.rows.get(key(r.name)) || []), r]);
    if (rows.length) pageRows.set(String(pageId), entry);
    return { rows };
  });

  // Mở hội thoại của khách (UID) trong khung ẩn: tải hộp thư của Page rồi bấm vào dòng của khách.
  const mouse = async (wc, spec) => {
    const r = await wc.executeJavaScript(`(${findTarget})(${JSON.stringify(spec)})`).catch(() => null); if (!r) return false;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  };
  const openThreadHidden = async (pageId, uid) => {
    const sl = slot(pageId), wc = sl.win.webContents, id = `${pageId}:${uid}`;
    if (sl.opened === id && wc.getURL().includes(`asset_id=${pageId}`)) return true;
    // Khung chi tiết đã đúng khách này (data-surface "<uid>:<tên>") và có tin → xong.
    const ready = async () => !!(await wc.executeJavaScript(`(() => { const col = document.querySelector('[data-surface$="lib:inbox:detail_column"]');
      return !!(col && col.querySelector('[data-surface^="${uid}:"]') && col.querySelector('[data-message-id]')); })()`).catch(() => false));
    // Nhanh: đang ở hộp thư của đúng Page → bấm thẳng vào dòng của khách (cuộn danh sách về đầu nếu cần), không tải lại trang (tiết kiệm 10–30 giây).
    if (wc.getURL().includes(`asset_id=${pageId}`)) {
      for (let i = 0; i < 2; i++) {
        if (await mouse(wc, { selector: `[data-maiba-contact-id="${uid}"]` })) {
          for (let k = 0; k < 20; k++) { await sleep(300); if (await ready()) { sl.opened = id; await watchThread(wc); return true; } }
          break;
        }
        await wc.executeJavaScript(`(() => { let box = document.querySelector('[data-maiba-contact-id]');
          while (box && !(box.scrollHeight > box.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
          if (box) box.scrollTop = 0; })()`).catch(() => {});
        await sleep(800);
      }
    }
    sl.opened = '';
    await wc.loadURL(`https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&mailbox_id=${pageId}`).catch(() => {});
    for (let i = 0; i < 70; i++) { // Business Suite ẩn có khi tải chậm: chờ tối đa ~35 giây cho dòng của khách hiện ra
      await sleep(500);
      if (isLogin(wc.getURL())) return 'login';
      if (await mouse(wc, { selector: `[data-maiba-contact-id="${uid}"]` })) break;
      if (i === 69) return false;
    }
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      if (await ready()) { sl.opened = id; await watchThread(wc); return true; }
    }
    // Không nhận ra được khách trong khung chi tiết (Meta đổi giao diện): vẫn nhận nếu đã có tin.
    const r = await wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null);
    if (r?.messages?.length) { sl.opened = id; await watchThread(wc); return true; }
    return false;
  };
  // Đưa ảnh vào khung trả lời của Business Suite, thử lần lượt 3 cách (giao diện Meta hay đổi):
  //  1) ô chọn file có sẵn trong trang; 2) bấm nút đính kèm ảnh và bắt hộp chọn file; 3) dán ảnh từ clipboard vào ô nhập.
  // Tìm ô soạn tin trên toàn trang (Business Suite 11/2026: ô trả lời nằm NGOÀI khung detail_column, có thể là textarea).
  // Đánh dấu ô nhập [data-ga-editor] và vùng soạn quanh nó [data-ga-composer] để các bước sau dùng selector cố định.
  function markComposer() {
    document.querySelectorAll('[data-ga-editor],[data-ga-composer]').forEach(e => { e.removeAttribute('data-ga-editor'); e.removeAttribute('data-ga-composer'); });
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; };
    const W = innerWidth;
    const cands = [...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')].filter(vis)
      .filter(el => el.getBoundingClientRect().left > W * 0.25 && !el.closest('[role="search"]') && !/tìm|search/i.test(el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''));
    if (!cands.length) return null;
    const ed = cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    ed.setAttribute('data-ga-editor', '1');
    let box = ed; while (box.parentElement && box.parentElement !== document.body && box.parentElement.getBoundingClientRect().height < 400) box = box.parentElement;
    box.setAttribute('data-ga-composer', '1');
    return { tag: ed.tagName.toLowerCase(), label: ed.getAttribute('aria-label') || ed.getAttribute('placeholder') || '', files: box.querySelectorAll('input[type="file"]').length,
      buttons: [...box.querySelectorAll('[role="button"],button,[aria-label]')].map(b => b.getAttribute('aria-label') || '').filter(Boolean).slice(0, 15) };
  }
  const findComposer = async (wc, wait = 10000) => {
    // Khung ẩn bị coi là "không hiện" → Meta có thể chưa vẽ ô trả lời. Giả như đang hiện và có focus.
    const dbg = wc.debugger;
    await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await dbg.sendCommand('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    const end = Date.now() + wait; let r = null, tookOver = false;
    do {
      r = await wc.executeJavaScript(`(${markComposer})()`).catch(() => null); if (r) return r;
      // Meta Business AI đang trả lời hội thoại này → ô trả lời bị ẩn, chỉ có nút "Bạn hãy tự phản hồi". Bấm để giành lại quyền trả lời.
      if (!tookOver && await mouse(wc, { text: /^(bạn hãy )?tự phản hồi$|^reply yourself$|^take over$|^tự trả lời$/i.source })) { tookOver = true; await sleep(1500); continue; }
      await sleep(700);
    } while (Date.now() < end);
    return null;
  };
  // Không có ô trả lời: thường do Meta khoá hội thoại (khách nhắn lần cuối quá 7 ngày, bị chặn…). Đọc dòng thông báo của Meta để báo đúng lý do.
  const whyNoComposer = wc => wc.executeJavaScript(`(() => { const re = /không thể (trả lời|nhắn|gửi)|can.?t (reply|message|send)|unable to (reply|message)|7 ngày|24 giờ|7 days|24 hours|đã chặn|blocked|không còn khả dụng|unavailable/i;
    const hits = [...document.querySelectorAll('div,span')].filter(el => !el.childElementCount && re.test(el.innerText || '') && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().left > innerWidth * 0.25);
    return hits.map(el => el.innerText.trim()).filter((t, i, a) => t.length < 300 && a.indexOf(t) === i).slice(0, 2).join(' / '); })()`).catch(() => '');
  // Ghi ảnh chụp + cấu trúc trang của khung ẩn ra Downloads/GetHelps-debug để tìm ô trả lời khi Meta đổi giao diện.
  const dumpPage = async (wc, tag) => {
    try {
      const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); fs.mkdirSync(dir, { recursive: true });
      const base = path.join(dir, `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      const img = await wc.capturePage().catch(() => null); if (img) fs.writeFileSync(base + '.png', img.toPNG());
      const info = await wc.executeJavaScript(`(() => {
        const vis = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
        const edit = [...document.querySelectorAll('[contenteditable], textarea, input, [role="textbox"]')].map(el => ({ tag: el.tagName, ce: el.getAttribute('contenteditable'), role: el.getAttribute('role'), type: el.type, label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || '', box: vis(el) }));
        const btns = [...document.querySelectorAll('[aria-label]')].filter(el => el.getBoundingClientRect().left > innerWidth * 0.25).map(el => el.getAttribute('aria-label') + ' @' + vis(el).join(',')).slice(0, 120);
        const frames = [...document.querySelectorAll('iframe')].map(f => f.src.slice(0, 120));
        const surfaces = [...new Set([...document.querySelectorAll('[data-surface]')].map(e => e.getAttribute('data-surface').split(':').slice(-2).join(':')))].slice(0, 80);
        const shadows = [...document.querySelectorAll('*')].filter(e => e.shadowRoot).length;
        return JSON.stringify({ url: location.href, size: [innerWidth, innerHeight], visibility: document.visibilityState, focus: document.hasFocus(), edit, btns, frames, surfaces, shadows,
          bottomText: [...document.querySelectorAll('div,span')].filter(e => !e.childElementCount && e.getBoundingClientRect().top > innerHeight * 0.6 && e.getBoundingClientRect().left > innerWidth * 0.25).map(e => e.innerText.trim()).filter(Boolean).slice(0, 60) }, null, 1); })()`).catch(e => 'lỗi: ' + e.message);
      fs.writeFileSync(base + '.json', String(info));
      return dir;
    } catch { return ''; }
  };
  const describe = c => c ? `ô nhập: ${c.tag}${c.label ? ' "' + c.label + '"' : ''} · ô file: ${c.files} · nút: ${c.buttons.join(' | ') || '—'}` : 'không thấy ô nhập';
  // Đưa ảnh vào khung trả lời, thử lần lượt: ô file → giả dán → giả kéo-thả → nút đính kèm → dán clipboard thật. Ảnh hiện trong vùng soạn mới tính là xong.
  const attachImage = async (wc, image) => {
    const dbg = wc.debugger, tried = [];
    const fileInput = async () => (await dbg.sendCommand('Runtime.evaluate', { expression: `(() => { const box = document.querySelector('[data-ga-composer]');
      const all = [...(box ? box.querySelectorAll('input[type="file"]') : []), ...document.querySelectorAll('input[type="file"]')];
      return all.find(i => /image|\\*/.test(i.accept || '*')) || null; })()` }).catch(() => null))?.result?.objectId || '';
    // Ảnh xem trước của tệp đính kèm là blob:/data: (ảnh trong tin cũ là https fbcdn) → đếm trên toàn trang, cộng nút gỡ tệp đính kèm.
    const pics = () => wc.executeJavaScript(`(() => [...document.querySelectorAll('img, video, source')].filter(e => /^(blob|data):/.test(e.currentSrc || e.src || '')).length
      + [...document.querySelectorAll('[style*="background-image"]')].filter(e => /url\\(["']?(blob|data):/.test(e.style.backgroundImage)).length
      + document.querySelectorAll('[data-surface*="attachment-preview-button-close"], [aria-label*="Gỡ tệp" i], [aria-label*="Xóa tệp" i], [aria-label*="Xoá tệp" i], [aria-label*="Remove attachment" i]').length)()`).catch(() => 0);
    const comp = await findComposer(wc);
    attachImage.last = { tried, comp };
    if (!comp) { const why = await whyNoComposer(wc), dir = await dumpPage(wc, 'khong-o-nhap'); tried.push(why ? 'Meta báo: ' + why : 'trang không có ô trả lời'); if (dir) tried.push('đã lưu ảnh chụp vào ' + dir); attachImage.locked = true; return false; }
    attachImage.locked = false;
    const before = await pics();
    const waitPreview = async () => { for (let i = 0; i < 10; i++) { await sleep(500); if (await pics() > before) return true; } return false; };
    // 1) ô chọn file có sẵn
    let id = await fileInput();
    tried.push(id ? 'ô file: có' : 'ô file: không');
    if (id && await putImage(dbg, id, image, 'anh') && await waitPreview()) return true;
    // 2–3) giả dán / kéo-thả ngay trên ô nhập
    const edId = (await dbg.sendCommand('Runtime.evaluate', { expression: `document.querySelector('[data-ga-editor]')` }).catch(() => null))?.result?.objectId || '';
    const m = String(image).match(/^data:(image\/(\w+));base64,(.+)$/);
    for (const kind of ['paste', 'drop']) {
      if (!edId || !m) break;
      const r = await dbg.sendCommand('Runtime.callFunctionOn', { objectId: edId, returnByValue: true, arguments: [{ value: m[3] }, { value: m[1] }, { value: 'anh.' + (m[2] === 'jpeg' ? 'jpg' : m[2]) }, { value: kind }],
        functionDeclaration: `function (b64, type, name, kind) {
          const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type })); this.focus();
          if (kind === 'paste') { const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); this.dispatchEvent(ev); return ev.defaultPrevented; }
          let ok = false; for (const t of ['dragenter', 'dragover', 'drop']) { const ev = new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }); this.dispatchEvent(ev); ok = ok || ev.defaultPrevented; }
          return ok; }` }).catch(e => ({ error: e.message }));
      if (await waitPreview()) return true;
      // Trang đã nhận (chặn xử lý mặc định) = Messenger đã lấy ảnh, chỉ là app chưa nhận ra khung xem trước.
      // Coi như xong (sau khi gửi, app vẫn kiểm tra ảnh có trong hội thoại); lưu ảnh chụp để chỉnh cách nhận diện.
      if (r?.result?.value) { await dumpPage(wc, 'sau-' + kind); return true; }
      tried.push(`${kind}: ${r?.error ? 'lỗi ' + r.error : 'không nhận'}`);
    }
    // 4) bấm nút đính kèm, bắt hộp chọn file
    try {
      await dbg.sendCommand('Page.enable');
      await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      const chooser = new Promise(resolve => { const on = (_e, method, params) => { if (method === 'Page.fileChooserOpened') { dbg.removeListener('message', on); resolve(params); } };
        dbg.on('message', on); setTimeout(() => { dbg.removeListener('message', on); resolve(null); }, 5000); });
      const clicked = await mouse(wc, { selector: '[data-ga-composer] [role="button"], [data-ga-composer] button, [data-ga-composer] [aria-label]', text: /đính kèm|ảnh|photo|image|attach|tệp|file/i.source });
      const params = clicked ? await chooser : null;
      id = params?.backendNodeId ? (await dbg.sendCommand('DOM.resolveNode', { backendNodeId: params.backendNodeId }).catch(() => null))?.object?.objectId : '';
      if (!id && clicked) id = await fileInput();
      tried.push(clicked ? (params ? 'nút đính kèm: mở hộp chọn' : 'nút đính kèm: không mở hộp chọn') : 'nút đính kèm: không thấy');
      if (id && await putImage(dbg, id, image, 'anh') && await waitPreview()) return true;
    } catch (e) { tried.push('nút đính kèm lỗi: ' + e.message); } finally { await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {}); }
    // 5) dán ảnh thật từ clipboard (trả lại chữ cũ trong clipboard sau đó)
    let oldText = ''; try { oldText = String(clipboard.readText() || ''); } catch {}
    try {
      const img = nativeImage.createFromDataURL(image); if (img.isEmpty()) { tried.push('ảnh hỏng'); return false; }
      if (!await mouse(wc, { selector: '[data-ga-editor]' })) { tried.push('dán: không bấm được ô nhập'); return false; }
      if (typeof clipboard.writeImage !== 'function') { tried.push('dán: không dùng được clipboard'); return false; }
      await sleep(200); clipboard.writeImage(img); wc.paste();
      if (await waitPreview()) return true;
      tried.push('dán: không thấy ảnh');
      return false;
    } catch (e) { tried.push('dán lỗi: ' + e.message); return false; }
    finally { setTimeout(() => { try { if (oldText) clipboard.writeText(oldText); } catch {} }, 1500); }
  };
  const threadArgs = ({ pageId, uid }) => /^\d+$/.test(String(pageId)) && /^\d+$/.test(String(uid));
  const readThread = args => !threadArgs(args) ? Promise.resolve({ error: 'Thiếu Page hoặc khách.' }) : queue(args.pageId, async () => {
    const ok = await openThreadHidden(String(args.pageId), String(args.uid));
    if (ok === 'login') return { error: 'login' };
    if (!ok) return { error: 'Không mở được hội thoại trong Business Suite.' };
    const wc = slot(args.pageId).win.webContents;
    if (args.older) { await wc.executeJavaScript(`(${readMessages})(true)`).catch(() => {}); await sleep(2500); }
    return await wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null) || { error: 'Không đọc được tin.' };
  }, 1);
  // Gửi tin như người dùng gõ trong Business Suite (không qua API → không bị giới hạn của app chưa duyệt).
  const sendThread = args => !threadArgs(args) ? Promise.resolve({ error: 'Thiếu Page hoặc khách.' }) : queue(args.pageId, async () => {
    const text = String(args.text || '').trim(), image = args.image || '';
    if (!text && !image) return { error: 'Thiếu nội dung.' };
    if (image) slot(args.pageId).opened = ''; // tải lại hội thoại: bỏ ảnh đính kèm còn sót từ lần thử trước
    const ok = await openThreadHidden(String(args.pageId), String(args.uid));
    if (ok !== true) return { error: ok === 'login' ? 'login' : 'Không mở được hội thoại trong Business Suite.' };
    const wc = slot(args.pageId).win.webContents, dbg = wc.debugger;
    const read = () => wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null);
    const myPics = r => (r?.messages || []).filter(m => m.mine && m.pic).length;
    const picsBefore = myPics(await read());
    if (image && !await attachImage(wc, image)) {
      const d = attachImage.last;
      if (attachImage.locked) return { error: `Không thấy ô nhập tin trong Business Suite (khung ẩn). ${d?.tried.join(' · ')}` };
      return { error: `Không đưa được ảnh vào Business Suite. [${d?.tried.join(' · ')} · ${describe(d?.comp)}]` };
    }
    const comp = await findComposer(wc, image ? 2000 : 10000);
    if (!comp) { const why = await whyNoComposer(wc), dir = await dumpPage(wc, 'khong-o-nhap'); if (dir) return { error: `Không thấy ô nhập tin trong Business Suite.${why ? ' Meta báo: ' + why + '.' : ''} Đã lưu ảnh chụp vào ${dir}` }; return { error: `Business Suite không cho trả lời hội thoại này (không có ô nhập tin).${why ? ' Meta báo: ' + why + '.' : ''} Thường do khách nhắn lần cuối đã quá 7 ngày: chờ khách nhắn lại, hoặc liên hệ qua Zalo/SĐT.` }; }
    if (!await mouse(wc, { selector: '[data-ga-editor]' })) return { error: `Không bấm được ô nhập tin của Business Suite. [${describe(comp)}]` };
    await sleep(300);
    const lines = text ? text.split('\n') : [];
    for (const [i, line] of lines.entries()) {
      if (i) { // xuống dòng trong cùng một tin
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
      }
      if (line) await dbg.sendCommand('Input.insertText', { text: line });
    }
    await sleep(300);
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 });
    // So khớp bỏ khoảng trắng: Business Suite gộp/bỏ dấu cách đầu dòng (vd dòng thụt lề "   Nội dung CK") nên so nguyên văn sẽ trượt.
    const norm = t => String(t || '').replace(/\s+/g, '').toLowerCase();
    const tail = norm(lines.filter(l => l.trim()).pop()).slice(-40);
    let textOk = !tail, picOk = !image;
    for (let i = 0; i < (image ? 40 : 20); i++) { // ảnh tải lên lâu hơn chữ
      await sleep(800);
      const r = await read();
      const mine = (r?.messages || []).filter(m => m.mine && m.text).slice(-3);
      textOk ||= mine.some(m => norm(m.text).includes(tail)); picOk ||= myPics(r) > picsBefore;
      if (textOk && picOk) return { done: true, ...r };
    }
    if (textOk && !picOk) { await dumpPage(wc, 'gui-thieu-anh'); return { error: 'Chữ đã gửi, nhưng chưa thấy ảnh trong hội thoại. Kiểm tra cột Meta; nếu thiếu ảnh thì Copy ảnh và dán vào đó (đừng gửi lại cả tin để tránh lặp).' }; }
    return { error: 'Đã bấm gửi nhưng chưa thấy tin trong Business Suite — kiểm tra lại trong cột Meta trước khi gửi lại.' };
  }, 1);

  // Điền sẵn trình soạn bài Business Suite. Trả về khi người dùng đã đăng/hẹn (trang rời khỏi trình soạn) hoặc sau 15 phút.
  // Trình soạn Business Suite (giao diện 11/2026): nút "Thêm ảnh/video" mở hộp chọn file, ô văn bản nằm trong
  // pagelet BusinessComposerTextEditor (tải chậm), mục "Nút" là combobox, "Đặt ngày và giờ" là công tắc.
  // Mỗi bước làm riêng, bước nào hỏng thì báo để bạn làm tay; luôn chép sẵn nội dung vào clipboard.
  // Điền trình soạn trong một webContents (cột Meta đang hiện, hoặc cửa sổ vẽ ngầm). Trả về bước nào đã xong.
  const fill = async (wc, { pageId, text, image, when }) => {
    const step = (id, state, note = '') => progress({ id, state, note });
    step('open', 'run');
    await wc.loadURL(`https://business.facebook.com/latest/composer/?asset_id=${pageId}`).catch(() => {});
    const find = spec => wc.executeJavaScript(`(${findTarget})(${JSON.stringify(spec)})`).catch(() => null);
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      await sleep(1000);
      if (isLogin(wc.getURL())) return { error: 'login' };
      ready = !!(await find({ text: /^Thêm ảnh\/video$|^Add photo\/video$/i.source }));
    }
    if (!ready) { step('open', 'fail'); return { error: 'Không mở được trình soạn bài của Business Suite.' }; }
    step('open', 'ok');
    const dbg = wc.debugger, done = { image: !image, text: !text, button: false, schedule: !when };
    const click = async spec => {
      const r = await find(spec); if (!r) return false;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await dbg.sendCommand('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
      return true;
    };
    const BUTTON_BOX = { role: 'combobox', label: /^Nút$|^Button$/i.source };
    const buttonChosen = () => wc.executeJavaScript(`(() => { const re = /^(Nút|Button)$/i;
      const box = [...document.querySelectorAll('[role="combobox"]')].find(b => (b.getAttribute('aria-labelledby') || '').split(' ').some(id => re.test((document.getElementById(id)?.innerText || '').trim())));
      return !!box && /gửi tin nhắn|send message/i.test(box.innerText); })()`).catch(() => false);
    const ensureButton = async () => {
      for (let i = 0; i < 3; i++) {
        if (await buttonChosen()) return true;
        if (!(await click(BUTTON_BOX))) return false;
        await sleep(700);
        await click({ role: 'option', text: /gửi tin nhắn|send message/i.source });
        await sleep(700);
      }
      return buttonChosen();
    };
    const waitFor = async (spec, ms = 5000) => { for (let t = 0; t < ms; t += 250) { if (await find(spec)) return true; await sleep(250); } return false; };
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      // 1) Nội dung TRƯỚC ảnh: ô "Văn bản" chỉ có khi trình soạn đang ở dạng bài viết; thêm ảnh trước có lúc làm ô này biến mất.
      if (text) step('text', 'run');
      if (text && await waitFor({ selector: '[data-pagelet="BusinessComposerTextEditor"] [contenteditable="true"], [contenteditable="true"][role="textbox"]' }, 15000)) {
        await click({ selector: '[data-pagelet="BusinessComposerTextEditor"] [contenteditable="true"], [contenteditable="true"][role="textbox"]' });
        await sleep(300);
        await dbg.sendCommand('Input.insertText', { text: String(text) });
        await sleep(500);
        // Đọc lại: ô thật phải chứa đầu nội dung (tránh gõ nhầm vào ô ẩn).
        const head = String(text).trim().slice(0, 20);
        done.text = await wc.executeJavaScript(`[...document.querySelectorAll('[contenteditable="true"]')].some(e => e.innerText.includes(${JSON.stringify(head)}))`).catch(() => false);
        step('text', done.text ? 'ok' : 'fail');
      }
      // 2) Ảnh: bắt hộp chọn file của trình duyệt rồi đưa ảnh thẳng từ bộ nhớ vào ô chọn file (không ghi file ra máy).
      if (image) step('image', 'run');
      const m = image && String(image).match(/^data:(image\/(\w+));base64,(.+)$/);
      if (m) {        await dbg.sendCommand('Page.enable');
        await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
        const chooser = new Promise(resolve => {
          const on = (_e, method, params) => { if (method === 'Page.fileChooserOpened') { dbg.removeListener('message', on); resolve(params); } };
          dbg.on('message', on); setTimeout(() => { dbg.removeListener('message', on); resolve(null); }, 8000);
        });
        await click({ text: /^Thêm ảnh\/video$|^Add photo\/video$/i.source });
        await sleep(800);
        await click({ role: 'menuitem', text: /tải.*(lên|máy)|upload|máy tính|computer/i.source }); // nếu hiện menu nguồn ảnh
        const params = await chooser;
        // Không bắt được hộp chọn file (cửa sổ ẩn không có "thao tác người dùng"): dùng ô chọn ảnh có sẵn trong trang.
        let objectId = params?.backendNodeId ? (await dbg.sendCommand('DOM.resolveNode', { backendNodeId: params.backendNodeId })).object.objectId : '';
        if (!objectId) objectId = (await dbg.sendCommand('Runtime.evaluate', { expression: `[...document.querySelectorAll('input[type="file"]')].find(i => /image|\\*/.test(i.accept || '*')) || null` })).result?.objectId || '';
        if (objectId) {
          done.image = await putImage(dbg, objectId, image, 'bai-viet');
          step('image', done.image ? 'ok' : 'fail');
        }
        await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      }
      // 3) Nút: combobox "Nút" → "Gửi tin nhắn", rồi đọc lại combobox (bấm trúng menu chưa chắc đã chọn).
      done.button = await ensureButton();
      step('button', done.button ? 'ok' : 'fail');
      // 4) Hẹn giờ: bật "Đặt ngày và giờ" → gõ ngày (ô dd/mm/yyyy) và giờ/phút (2 ô spinbutton "giờ", "phút"), rồi đọc lại để chắc đúng.
      if (when) {
        const at = new Date(when * 1000), pad = n => String(n).padStart(2, '0');
        const key = async (k, vk, text = '', modifiers = 0) => {
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, windowsVirtualKeyCode: vk, text, unmodifiedText: text, modifiers });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: vk, modifiers });
        };
        const typeDigits = async digits => { for (const d of digits) await key(d, 48 + Number(d), d); };
        const dateInput = { selector: 'input[placeholder="dd/mm/yyyy"]' };
        // Công tắc "Đặt ngày và giờ": có tài khoản là <label for>, có tài khoản chỉ là ô switch + chữ rời → thử lần lượt.
        const SW = /^Đặt ngày và giờ$|^Set date and time$/i.source;
        for (const spec of [{ selector: 'label[for]', text: SW }, { selector: 'input[role="switch"][aria-label="Đặt ngày và giờ"], input[role="switch"][aria-label="Set date and time"]' }, { text: SW }]) {
          if (await find(dateInput)) break;
          if (await click(spec)) await waitFor(dateInput, 2500);
        }
        if (await waitFor(dateInput, 5000)) {
          await click(dateInput); await sleep(300);
          await key('a', 65, '', 2); // Ctrl+A
          await dbg.sendCommand('Input.insertText', { text: `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}` });
          await key('Enter', 13, '\r'); await sleep(400);
          for (const [label, value] of [['giờ', at.getHours()], ['phút', at.getMinutes()]]) {
            await click({ selector: `input[role="spinbutton"][aria-label="${label}"]` }); await sleep(200);
            await typeDigits(pad(value)); await sleep(200);
          }
          await key('Tab', 9); await sleep(400);
          const seen = await wc.executeJavaScript(`[document.querySelector('input[placeholder="dd/mm/yyyy"]')?.value || '',
            document.querySelector('input[role="spinbutton"][aria-label="giờ"]')?.getAttribute('aria-valuenow'),
            document.querySelector('input[role="spinbutton"][aria-label="phút"]')?.getAttribute('aria-valuenow')]`).catch(() => ['', '', '']);
          const d = at.getDate(), mo = at.getMonth() + 1, y = at.getFullYear();
          const dateOk = new RegExp(`^0?${d}( Tháng |/0?)${mo}(, |/)${y}$`).test(seen[0].trim());
          done.schedule = dateOk && Number(seen[1]) === at.getHours() && Number(seen[2]) === at.getMinutes();
          step('schedule', done.schedule ? 'ok' : 'fail', seen[0] + ' ' + seen[1] + ':' + seen[2]);
        }
      }
    } catch (e) { notify(`Business Suite: lỗi khi điền sẵn (${e.message}). Làm tay phần còn lại.`); }
    // Giữ debugger gắn: nó mang cấu hình giả Chrome (userAgentMetadata) cho Business Suite, tháo ra là mất.
    for (const k of ['image', 'text', 'button', 'schedule']) if (done[k] !== true) step(k, 'fail');
    return { done, find, click, waitFor, ensureButton };
  };
  const leftComposer = wc => wc.isDestroyed() || !/\/composer/.test(wc.getURL());

  // Đăng ngay (không hẹn giờ): làm hết trong cửa sổ vẽ ngầm, đủ ảnh + chữ + nút thì tự bấm Đăng, không hiện cột Meta.
  // Hẹn giờ, hoặc làm ngầm còn thiếu bước: mở cột Meta, điền sẵn, bạn kiểm tra rồi bấm; xong cột tự ẩn lại như trước.
  const composePost = args => composeQueue(async () => {
    const { pageId, text, when } = args;
    if (!/^\d+$/.test(String(pageId))) return { error: 'Thiếu Page.' };
    if (text) clipboard.writeText(String(text));
    if (composer && !args.visibleOnly) {
      const wc = composer.webContents, r = await fill(wc, args);
      if (r.error === 'login') return r;
      if (!r.error && r.done.image && r.done.text && r.done.button && r.done.schedule === true) {
        const dbg = wc.debugger;
        try {
          if (!dbg.isAttached()) dbg.attach('1.3');
          const publish = { role: 'button', text: (when ? /^Lên lịch$|^Schedule$/i : /^Đăng$|^Publish$|^Post$/i).source, enabled: true };
          // Đặt giờ xong trang có thể dựng lại form: kiểm tra nút Gửi tin nhắn lần cuối trước khi bấm.
          if (!(await r.ensureButton())) throw Error('Mất lựa chọn nút Gửi tin nhắn');
          progress({ id: 'publish', state: 'run' });
          if (await r.waitFor(publish, 60000) && await r.click(publish)) {
            // Xong khi: rời trình soạn, hoặc Business Suite báo đã lên lịch/đã đăng. Hộp xác nhận hiện ra thì bấm luôn;
            // nút Lên lịch còn nguyên và bấm được sau 8 giây = cú bấm chưa ăn → bấm lại một lần bằng element.click().
            const DONE = /đã (được )?lên lịch|đã đăng|đã chia sẻ|has been scheduled|scheduled your post|post (was )?(published|shared)/i;
            let reclicked = false;
            for (let i = 0; i < 60 && !leftComposer(wc); i++) {
              await sleep(1000);
              const st = await wc.executeJavaScript(`(() => {
                const t = [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')].map(e => e.innerText || '').join('\\n');
                const dlg = [...document.querySelectorAll('[role="dialog"] [role="button"],[role="dialog"] button')].find(b => /^(Lên lịch|Schedule|Tiếp tục|Continue|Xác nhận|Confirm|Đồng ý|OK)$/i.test((b.innerText || '').trim()) && b.getAttribute('aria-disabled') !== 'true');
                if (dlg) { dlg.click(); return { text: t, dialog: true }; }
                return { text: t };
              })()`).catch(() => ({ text: '' }));
              if (DONE.test(st.text)) break;
              if (!reclicked && i >= 8 && !st.dialog) {
                const again = await r.find(publish);
                if (again) { reclicked = true; await wc.executeJavaScript(`(() => { const re = new RegExp(${JSON.stringify(publish.text)}, 'i'); const b = [...document.querySelectorAll('[role="button"],button')].filter(x => re.test((x.innerText || '').trim()) && x.getAttribute('aria-disabled') !== 'true').pop(); if (b) b.click(); })()`).catch(() => {}); }
              }
            }
            const ok = leftComposer(wc) || DONE.test(await wc.executeJavaScript(`[...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')].map(e => e.innerText || '').join('\\n')`).catch(() => ''));
            if (ok) { progress({ id: 'publish', state: 'ok' }); wc.loadURL('about:blank').catch(() => {}); return { done: true, filled: r.done, hidden: true }; }
            // Đã bấm mà không chắc kết quả: KHÔNG mở cột Meta ngay (dễ đăng trùng). Trang web kiểm tra lịch thật trên Meta trước.
            progress({ id: 'publish', state: 'run', note: 'Đang kiểm tra trên Meta xem bài đã lên lịch chưa…' });
            return { uncertain: true, filled: r.done };
          }
        } catch {}
      }
      notify('Đăng ngầm chưa xong (Business Suite thiếu bước). Mở cột Meta để bạn hoàn tất…');
      progress({ id: 'reset', state: 'reset' }); // chạy lại các bước trong cột Meta, bảng tiến độ làm mới
      progress({ id: 'publish', state: 'manual', note: 'Mở cột Meta: hoàn tất bước đỏ rồi bấm Đăng / Lên lịch' });
      // Giữ nguyên trang soạn ngầm để "Lưu chẩn đoán" chụp được (xem vì sao thiếu bước).
    }
    const wc = metaView.webContents, restore = showMeta();
    const r = await fill(wc, args);
    if (r.error) { restore(); return r; }
    const { done } = r;
    const todo = [!done.image && 'thêm ảnh (Thêm ảnh/video)', !done.text && 'dán nội dung (Ctrl+V, đã chép sẵn)', !done.button && 'chọn Nút › Gửi tin nhắn',
      when && done.schedule !== true && `chọn giờ ${new Date(when * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`].filter(Boolean);
    notify(`Business Suite: ${todo.length ? 'còn ' + todo.join(', ') + ', rồi' : 'đã điền xong,'} bấm ${when ? 'Lên lịch' : 'Đăng'}. Bấm ✕ trên cột để huỷ.`);
    for (let i = 0; i < 900; i++) {
      await sleep(1000);
      if (wc.isDestroyed() || !/\/composer/.test(wc.getURL())) break;
      if (!metaShown()) return { error: 'Đã đóng trình soạn Business Suite, bài chưa được đăng.' }; // bấm ✕ trên cột = huỷ (cột đã ẩn sẵn)
    }
    restore();
    progress({ id: 'publish', state: leftComposer(wc) ? 'ok' : 'fail' });
    return { done: leftComposer(wc), filled: done };
  });

  return { lookupProfile, listThreads, readThread, sendThread, composePost };
}
module.exports = { readThreads, createMetaAuto, extractProfile, findTarget };
