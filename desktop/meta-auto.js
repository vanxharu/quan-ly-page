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
  // Mọi dòng có UID khách (trừ Instagram/WhatsApp): Meta có thể gắn loại khác "fb_user" cho một số hội thoại (vd đang do AI trả lời).
  const rows = [...document.querySelectorAll('[data-maiba-contact-id]')].filter(el => !/ig|instagram|whatsapp|wa_/i.test(el.getAttribute('data-maiba-contact-type') || '')).map(el => {
    const title = el.querySelector('[data-surface$="lib:thread_title"]'), name = (title?.innerText || '').trim();
    const leaves = [...el.querySelectorAll('span,div,abbr')].filter(x => x.childElementCount === 0 && !title?.contains(x));
    const lines = leaves.map(x => (x.innerText || x.textContent || '').trim()).filter(s => s && s !== name && !/^[·•]$/.test(s));
    // Mốc giờ: dòng chữ giống giờ; không có thì lấy từ thẻ <abbr>/<time>/aria-label (Meta hay đổi cách hiện).
    const tagged = [...el.querySelectorAll('abbr, time, [aria-label]')].map(x => (x.getAttribute('aria-label') || x.getAttribute('title') || x.innerText || '').trim()).find(isTime);
    const time = lines.find(isTime) || tagged || '';
    // Bỏ nhãn của Business Suite trên dòng (vd "Đã chu…", "Khách …", "Nov 02", "AI đang phản hồi") khỏi tin cuối.
    // Nhãn của Business Suite trên dòng (giai đoạn khách, nhãn AI…), kể cả khi Meta cắt ngắn bằng "…" hoặc "..." (vd "Đã chu...").
    const CHIPS = ['AI đang phản hồi', 'AI đã chuyển', 'Trao đổi thêm', 'Đã chuyển đổi', 'Khách hàng mới', 'Tiếp nhận', 'Đủ tiêu chuẩn', 'Không hoạt động', 'Ordered', 'Intake', 'Qualified', 'Converted'];
    const cut = s => s.replace(/\s*(…|\.{3})$/, '');
    const chip = s => (s.length <= 14 && /…$/.test(s)) || /^[A-Z][a-z]{2} \d{1,2}$/.test(s) || CHIPS.some(c => c.toLowerCase() === s.toLowerCase() || (/(…|\.{3})$/.test(s) && cut(s).length >= 2 && c.toLowerCase().startsWith(cut(s).toLowerCase()))) || /^\+\d+ nhãn/.test(s);
    const snippet = lines.filter(s => s !== time && !chip(s)).sort((a, b) => b.length - a.length)[0] || '';
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

function createMetaAuto({ worker, makeWorker = null, composer, metaView, showMeta = () => () => {}, metaShown = () => true, notify = () => {}, progress = () => {}, threadChanged = () => {}, listChanged = () => {} }) {
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
      const t = tasks.shift(); q.runningSince = Date.now(); q.runningPrio = t.prio;
      // Một việc treo (trang đang chuyển, lệnh không trả lời) không được chặn cả hàng: quá 2,5 phút thì bỏ, làm việc sau.
      let timer; const limit = new Promise((_, bad) => { timer = setTimeout(() => bad(new Error('Khung Business Suite không phản hồi (quá 150 giây). Thử lại.')), 150e3); });
      try { t.ok(await Promise.race([t.fn(), limit])); } catch (e) { t.bad(e); } finally { clearTimeout(timer); running = false; q.runningSince = 0; next(); }
    };
    let n = 0;
    const q = (fn, prio = 0) => new Promise((ok, bad) => { tasks.push({ fn, prio, ok, bad, n: n++ }); next(); });
    q.urgent = () => tasks.some(t => t.prio > 0);
    q.waiting = () => tasks.length; // có việc bạn đang chờ (mở hội thoại, gửi tin) → việc nền nên dừng sớm
    return q;
  };
  const composeQueue = makeQueue();
  // Mỗi Page một khung ẩn riêng (chạy song song): đọc danh sách Page này không làm mất hội thoại đang mở của Page khác,
  // bấm khách Page nào cũng mở ngay trong khung của Page đó. Khung đầu tiên dùng cửa sổ có sẵn; tối đa 8 khung, dư thì đóng khung lâu không dùng.
  const slots = new Map();
  // Lệnh chạy trong trang có thể không bao giờ trả lời (trang đang tải lại, khung bị treo) → giới hạn 20 giây mỗi lệnh.
  const guard = wc => {
    if (!wc || wc.__gaGuard) return; wc.__gaGuard = true;
    const run = wc.executeJavaScript.bind(wc);
    wc.executeJavaScript = (code, ...rest) => Promise.race([run(code, ...rest), new Promise((_, bad) => setTimeout(() => bad(new Error('Trang không trả lời')), 20e3))]);
    const send = wc.debugger.sendCommand.bind(wc.debugger);
    wc.debugger.sendCommand = (...a) => Promise.race([send(...a), new Promise((_, bad) => setTimeout(() => bad(new Error('DevTools không trả lời')), 20e3))]);
  };
  guard(worker.webContents);
  // Khung ẩn chỉ cần chữ: chặn video, font và ảnh giao diện (sprite/biểu tượng của Meta) → trang tải nhanh, nhẹ máy.
  // Ảnh trong tin (scontent) và ảnh đại diện vẫn tải để app lấy được. Chỉ áp dụng cho khung ẩn, cột Meta bạn xem vẫn đầy đủ.
  // Kèm theo: ghi lại vài gói dữ liệu tin nhắn gốc Business Suite tải về (để chuyển sang đọc dữ liệu gốc, nhanh hơn đọc màn hình).
  const BLOCK = [{ resourceType: 'Media' }, { resourceType: 'Font' }, { urlPattern: '*static.xx.fbcdn.net*', resourceType: 'Image' }, { urlPattern: '*/rsrc.php/*', resourceType: 'Image' }];
  // ── Dữ liệu gốc Business Suite (giao thức "Lightspeed", qua WebSocket/HTTP của khung ẩn) ──
  // Mỗi gói là cây lệnh [5, "tênLệnh", ...tham số]; số lớn dạng [19,"123"], rỗng [9]. Vị trí tham số đọc từ mẫu thật 11/2026:
  //  upsertMessage: 0 chữ · 3 khách (thread) · 5 giờ (ms) · 8 mã tin · 10 người gửi
  //  insertBlobAttachment: 3/8 ảnh · 6 loại · 27 thread · 31 giờ · 32 mã tin   ·  insertXmaAttachment: 8 ảnh · 25 thread · 29 giờ · 30 mã tin · 58 tiêu đề
  //  deleteThenInsertThread: 0 giờ hoạt động · 1 đã đọc tới · 2 tin cuối · 4 ảnh · 7 thread · 10 thư mục · 18 Page
  //  deleteThenInsertContact: 0 id · 2 ảnh · 9 tên   ·  insertNewMessageRange: 0 thread (đã tải 1 đoạn tin của hội thoại)
  const lsStores = new Map(); // pageId -> { threads, contacts, msgs: Map(uid -> Map(mid -> tin)), loaded:Set(uid), at }
  const lsStore = pageId => { pageId = String(pageId); let st = lsStores.get(pageId); if (!st) lsStores.set(pageId, st = { threads: new Map(), contacts: new Map(), msgs: new Map(), loaded: new Set(), at: 0 }); return st; };
  const lsVal = x => Array.isArray(x) ? (x[0] === 19 ? x[1] : x[0] === 9 ? null : x) : x;
  const lsMsg = (st, uid, mid) => { let m = st.msgs.get(uid); if (!m) st.msgs.set(uid, m = new Map()); let x = m.get(mid); if (!x) m.set(mid, x = { mid, ts: 0, text: '', mine: false, pic: '' }); return x; };
  function lsIngest(pageId, raw) {
    const i = raw.indexOf('{"'); if (i < 0 || !/payload/.test(raw)) return null;
    let outer, p; try { outer = JSON.parse(raw.slice(i)); p = typeof outer.payload === 'string' ? JSON.parse(outer.payload) : null; } catch { return null; }
    if (!p?.step) return null;
    const st = lsStore(pageId), pid = String(pageId), threads = new Set(); let list = false;
    (function walk(a) {
      if (!Array.isArray(a)) return;
      if (a[0] === 5 && typeof a[1] === 'string') {
        const v = a.slice(2).map(lsVal), n = a[1];
        if (n === 'upsertMessage' || n === 'insertMessage') {
          const uid = String(v[3] || ''); if (/^\d+$/.test(uid) && v[8]) {
            const x = lsMsg(st, uid, String(v[8])); x.ts = Number(v[5]) || x.ts; x.text = v[0] && v[0] !== 'null' ? String(v[0]) : x.text; x.mine = String(v[10]) !== uid; threads.add(uid);
            // Khách chưa có trong dữ liệu gốc (danh sách đầu Meta tải sẵn trước khi app nghe): tạo dòng từ tin này.
            if (uid !== pid && !st.threads.has(uid)) st.threads.set(uid, { uid, at: 0, read: 0, snippet: '', pic: '', folder: '' });
          }
        } else if (n === 'insertBlobAttachment' || n === 'insertXmaAttachment') {
          const blob = n === 'insertBlobAttachment', uid = String(v[blob ? 27 : 25] || ''), mid = v[blob ? 32 : 30];
          if (/^\d+$/.test(uid) && mid) { const x = lsMsg(st, uid, String(mid)); x.ts = x.ts || Number(v[blob ? 31 : 29]) || 0;
            const url = [v[8], v[3]].find(u => /^https:\/\//.test(u || '')); if (url) x.pic = url;
            if (!blob && !x.text && v[58]) x.text = String(v[58]); threads.add(uid); }
        } else if (n === 'deleteThenInsertThread') {
          const uid = String(v[7] || ''); if (/^\d+$/.test(uid) && uid !== pid && (!v[18] || String(v[18]) === pid)) {
            st.threads.set(uid, { uid, at: Number(v[0]) || 0, read: Number(v[1]) || 0, snippet: String(v[2] || ''), pic: /^https/.test(v[4] || '') ? v[4] : '', folder: String(v[10] || '') }); list = true; }
        } else if (n === 'deleteThenInsertContact') {
          const id = String(v[0] || ''); if (/^\d+$/.test(id) && v[9]) st.contacts.set(id, { name: String(v[9]), pic: /^https/.test(v[2] || '') ? v[2] : '' });
        } else if (n === 'insertNewMessageRange') {
          // Đoạn tin thật sự (tin đầu khác tin cuối) = đã tải hội thoại; danh sách hội thoại cũng gửi "đoạn" 1 tin cuối, không tính.
          const uid = String(v[0] || ''); if (/^\d+$/.test(uid) && v[3] && v[4] && v[3] !== v[4]) { st.loaded.add(uid); threads.add(uid); }
        }
      }
      for (const x of a) if (Array.isArray(x)) walk(x);
    })(p.step);
    // Tin mới của hội thoại: cập nhật luôn dòng hội thoại (giờ, tin cuối) để danh sách đúng ngay.
    for (const uid of threads) {
      const ms = [...(st.msgs.get(uid)?.values() || [])].sort((a, b) => b.ts - a.ts)[0], t = st.threads.get(uid);
      if (ms && t && ms.ts > t.at) { t.at = ms.ts; t.snippet = (ms.mine ? 'Bạn: ' : '') + (ms.text || (ms.pic ? 'Đã gửi một ảnh.' : '')); if (!ms.mine) t.read = 1; list = true; } // read=1 (< giờ tin) = chưa đọc
    }
    if (threads.size || list) st.at = Date.now();
    return { threads, list };
  }
  // Tin của một hội thoại từ dữ liệu gốc → định dạng như readMessages (mốc giờ khi cách nhau > 30 phút).
  const lsMessages = (pageId, uid) => {
    const all = [...(lsStore(pageId).msgs.get(String(uid))?.values() || [])].filter(m => m.ts && (m.text || m.pic)).sort((a, b) => a.ts - b.ts);
    const out = []; let last = 0;
    for (const m of all) {
      if (m.ts - last > 30 * 60e3) { const d = new Date(m.ts), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        out.push({ sep: new Date().toDateString() === d.toDateString() ? hm : `${hm} ${d.getDate()} Tháng ${d.getMonth() + 1}, ${d.getFullYear()}` }); }
      last = m.ts; out.push({ mine: m.mine, text: m.text, ...(m.pic ? { pic: m.pic } : {}), ts: m.ts });
    }
    return out;
  };
  // Số câu khách nhắn liên tiếp ở cuối hội thoại (từ sau tin trả lời gần nhất của Page).
  const lsStreak = (st, uid) => { let n = 0; for (const m of [...(st.msgs.get(String(uid))?.values() || [])].filter(x => x.ts && (x.text || x.pic)).sort((a, b) => b.ts - a.ts)) { if (m.mine) break; n++; } return n; };
  // Có dữ liệu gốc mới: báo Hộp thư ngay (danh sách đổi / hội thoại đang mở có tin mới), không chờ đọc màn hình.
  const lsGot = (pageId, raw) => {
    const r = lsIngest(pageId, raw); if (!r) return;
    const sl = slots.get(String(pageId));
    if (r.list || r.threads.size) { if (Date.now() - (sl?.lastList || 0) > 800) { if (sl) sl.lastList = Date.now(); try { listChanged(String(pageId)); } catch {} } }
    // Kèm tin cuối của hội thoại → Hộp thư sửa ngay dòng khách (tin cuối, giờ, đưa lên đầu) không cần đọc lại danh sách.
    const st = lsStore(pageId);
    for (const uid of r.threads) {
      const m = [...(st.msgs.get(uid)?.values() || [])].filter(x => x.ts && (x.text || x.pic)).sort((a, b) => b.ts - a.ts)[0];
      const info = m ? { ts: m.ts, mid: m.mid, streak: lsStreak(st, uid), mine: m.mine, pic: m.pic || '', text: m.text || (m.pic ? 'Đã gửi một ảnh.' : ''), name: st.contacts.get(uid)?.name || '' } : null;
      try { threadChanged(`${pageId}:${uid}`, info); } catch {}
    }
  };
  // Trạng thái các khung ẩn → Downloads/GetHelps-debug/trang-thai.json (30 giây/lần) để chẩn đoán khi chậm/kẹt.
  setInterval(() => {
    try {
      const now = Date.now(), data = { at: new Date().toISOString(), slots: [...slots.values()].map(sl => {
        const st = lsStores.get(sl.pageId) || {};
        return { page: sl.pageId, url: (() => { try { return sl.win.webContents.getURL().replace(/[?&](business_id|ir_qe_exposed)=[^&]*/g, '').slice(0, 120); } catch { return 'đã đóng'; } })(),
          opened: sl.opened, busySec: sl.queue.runningSince ? Math.round((now - sl.queue.runningSince) / 1000) : 0, busyPrio: sl.queue.runningPrio, waiting: sl.queue.waiting?.() || 0,
          wsFrames: st.frames || 0, lsThreads: st.threads?.size || 0, lsContacts: st.contacts?.size || 0, lsLoaded: st.loaded?.size || 0, lsAgoSec: st.at ? Math.round((now - st.at) / 1000) : null,
          lsTop: st.threads ? [...st.threads.values()].sort((a, b) => b.at - a.at).slice(0, 3).map(t => (st.contacts.get(t.uid)?.name || '?').slice(0, 3) + '… ' + new Date(t.at).toISOString().slice(5, 16)) : [] };
      }), send: [...sendSlots.values()].map(ss => ({ page: ss.pageId, opened: ss.opened, busySec: ss.queue.runningSince ? Math.round((now - ss.queue.runningSince) / 1000) : 0, waiting: ss.queue.waiting?.() || 0,
        url: (() => { try { return ss.win.webContents.getURL().slice(0, 100); } catch { return 'đã đóng'; } })() })) };
      const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'trang-thai.json'), JSON.stringify(data, null, 1));
    } catch {}
  }, 30e3);
  // Mẫu gói tin gửi (Downloads/GetHelps-debug/ls-gui-mau.json, 12 gói gần nhất): chỉ ghi trong ~20 giây quanh mỗi lần app gửi tin.
  const sentSamples = [];
  const sentSample = (pageId, x) => { try { sentSamples.unshift({ page: String(pageId), ...x }); sentSamples.splice(20); const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ls-gui-mau.json'), JSON.stringify(sentSamples, null, 1)); } catch {} };
  // Giữ tham chiếu tới WebSocket của trang (cài trước khi trang tạo kết nối, có hiệu lực từ lần tải trang sau) → bước sau gửi thẳng qua kết nối này.
  const WS_HOOK = `(() => { const W = window.WebSocket; if (!W || W.__ga) return;
    const G = function (...a) { const ws = new W(...a); try { (window.__gaWS = window.__gaWS || []).push(ws); if (window.__gaWS.length > 6) window.__gaWS.shift(); } catch (e) {} return ws; };
    G.prototype = W.prototype; Object.setPrototypeOf(G, W); G.__ga = true;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) try { Object.defineProperty(G, k, { value: W[k] }); } catch (e) {}
    window.WebSocket = G; })();`;
  const lighten = async (wc, pageId, quiet = false) => {
    if (!wc || wc.__gaLight) return; wc.__gaLight = true;
    const got = quiet ? (pid, raw) => { lsIngest(pid, raw); } : lsGot; // khung gửi: chỉ ghi nhận dữ liệu gốc (để xác nhận đã gửi), không báo Hộp thư (khung đọc đã báo)
    const dbg = wc.debugger, pending = new Map();
    dbg.on('message', (_e, method, params) => {
      // Gói tin Business Suite gửi lên Meta (qua WebSocket) trong lúc app gửi tin → ghi mẫu để làm "gửi thẳng" (không bấm nút).
      if (method === 'Network.webSocketFrameSent' && Date.now() < (lsStore(pageId).capture || 0)) {
        const f = params.response || {}, raw = f.opcode === 2 ? Buffer.from(String(f.payloadData || ''), 'base64') : Buffer.from(String(f.payloadData || ''), 'utf8');
        if (raw.length > 40 && raw.includes('/ls_req') && !raw.includes('"type":2')) sentSample(pageId, { at: new Date().toISOString(), opcode: f.opcode, bytes: raw.length, text: raw.toString('utf8').replace(/[\x00-\x08\x0e-\x1f]/g, '·').slice(0, 20000), b64: raw.length < 60000 ? raw.toString('base64') : '' });
      }
      // Ảnh đang tải lên Meta (để chỉ bấm Gửi khi ảnh đã lên xong).
      if (method === 'Network.requestWillBeSent' && /upload|rupload/i.test(params.request?.url || '') && /POST|PUT/i.test(params.request?.method || '')) { const up = lsStore(pageId).uploads ||= new Map(); up.set(params.requestId, Date.now()); }
      else if ((method === 'Network.loadingFinished' || method === 'Network.loadingFailed') && lsStore(pageId).uploads?.delete(params.requestId)) lsStore(pageId).uploadsDone = Date.now();
      if (method === 'Fetch.requestPaused') dbg.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      else if (method === 'Network.webSocketFrameReceived' && (lsStore(pageId).frames = (lsStore(pageId).frames || 0) + 1)) { const f = params.response || {}; const raw = f.opcode === 2 ? Buffer.from(String(f.payloadData || ''), 'base64').toString('utf8') : String(f.payloadData || ''); if (/ls_resp|upsertMessage|deleteThenInsert/.test(raw)) got(pageId, raw); }
      else if (method === 'Network.responseReceived' && /\/api\/graphql|lightspeed|ls_req/i.test(params.response?.url || '')) pending.set(params.requestId, params.response.url);
      else if (method === 'Network.loadingFinished' && pending.has(params.requestId)) {
        const url = pending.get(params.requestId); pending.delete(params.requestId);
        dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId }).then(b => { const raw = b?.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : String(b?.body || ''); if (/upsertMessage|deleteThenInsert/.test(raw)) for (const part of raw.split(/\r?\n(?=\{)/)) got(pageId, part); }).catch(() => {});
      }
    });
    await dbg.sendCommand('Fetch.enable', { patterns: BLOCK }).catch(() => {});
    await dbg.sendCommand('Network.enable', { maxResourceBufferSize: 4e6, maxTotalBufferSize: 2e7 }).catch(() => {});
    await dbg.sendCommand('Page.enable').catch(() => {});
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: WS_HOOK }).catch(() => {});
  };
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
      guard(win.webContents);
      sl = { pageId, win, opened: '', used: Date.now(), queue: shared?.queue || makePrioQueue(), lastPing: 0 };
      if (!shared) sl.win.webContents.on('console-message', (e, level, message) => {
        const msg = typeof e?.message === 'string' ? e.message : String(message || '');
        // Danh sách hội thoại của Page đổi (khách nhắn mới…) → báo Hộp thư đọc lại danh sách ngay.
        if (msg === '__GA_LIST_CHANGED__') {
          if (Date.now() - (sl.lastList || 0) < 2500) return; sl.lastList = Date.now();
          for (const x of slots.values()) if (x.win === sl.win && wcPage(x)) try { listChanged(x.pageId); } catch {}
          return;
        }
        if (msg !== '__GA_THREAD_CHANGED__' || Date.now() - sl.lastPing < 1500) return;
        // Khung gửi dấu hiệu → báo hội thoại đang mở của (các) Page dùng khung này.
        for (const x of slots.values()) if (x.win === sl.win && x.opened) { sl.lastPing = Date.now(); try { threadChanged(x.opened); } catch {} }
      });
      slots.set(pageId, sl);
    }
    sl.used = Date.now();
    return sl;
  };
  const wcPage = x => x.win.webContents.getURL().includes(`asset_id=${x.pageId}`);
  // Theo dõi danh sách hội thoại trong khung ẩn: dòng mới / tin mới / đổi thứ tự → báo ngay (chỉ những thay đổi đáng kể: tên, tin cuối, thứ tự).
  const watchList = wc => wc.executeJavaScript(`(() => { try { window.__gaListObs?.disconnect(); } catch {}
    let box = document.querySelector('[data-maiba-contact-id]'); if (!box) return false;
    while (box.parentElement && box !== document.body && !(box.scrollHeight > box.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    const sig = () => [...document.querySelectorAll('[data-maiba-contact-id]')].slice(0, 8).map(r => r.getAttribute('data-maiba-contact-id') + '|' + (r.innerText || '').replace(/\\s+/g, ' ').slice(0, 160)).join('#');
    let last = sig(), t = 0;
    window.__gaListObs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { const now = sig(); if (now !== last) { last = now; console.log('__GA_LIST_CHANGED__'); } }, 400); });
    window.__gaListObs.observe(box, { childList: true, subtree: true, characterData: true }); return true; })()`).catch(() => false);
  // ── Khung GỬI riêng cho mỗi Page: luôn mở sẵn Hộp thư, không chung hàng đợi với việc đọc nền (danh sách, đọc trước…) → bấm gửi là đi ngay.
  // Bạn mở hội thoại nào trong app thì khung gửi mở sẵn hội thoại đó. Không tạo được khung mới (app cũ) thì dùng khung đọc như trước.
  const sendSlots = new Map();
  const sendSlot = pageId => {
    pageId = String(pageId); if (!makeWorker) return slot(pageId);
    let ss = sendSlots.get(pageId);
    if (!ss) {
      if (sendSlots.size >= 8) { const old = [...sendSlots.entries()].sort((a, b) => a[1].used - b[1].used)[0]; sendSlots.delete(old[0]); try { old[1].win.destroy(); } catch {} }
      const win = makeWorker(); guard(win.webContents);
      ss = { pageId, win, opened: '', used: Date.now(), queue: makePrioQueue(), send: true };
      sendSlots.set(pageId, ss);
    }
    ss.used = Date.now();
    return ss;
  };
  const sendQueue = (pageId, fn, prio = 1) => { const ss = sendSlot(pageId); return ss.queue(async () => { await ss.win.ready; await lighten(ss.win.webContents, ss.pageId, !!ss.send); return fn(ss); }, prio); };
  // Mở sẵn: tải Hộp thư của Page vào khung gửi (lúc app đọc danh sách), mở sẵn hội thoại bạn đang xem.
  const warmSend = pageId => { if (!makeWorker || !/^\d+$/.test(String(pageId))) return; const ss = sendSlot(pageId); if (ss.warmed) return; ss.warmed = true;
    sendQueue(pageId, async s => { const wc = s.win.webContents; if (!wc.getURL().includes(`asset_id=${pageId}`)) await wc.loadURL(`https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&mailbox_id=${pageId}`).catch(() => {}); }, 0).catch(() => {}); };
  const preOpenSend = (pageId, uid) => { if (!makeWorker || !threadArgs({ pageId, uid })) return; const ss = sendSlot(pageId); if (ss.opened === `${pageId}:${uid}` || ss.queue.waiting()) return;
    sendQueue(pageId, s => openThreadHidden(String(pageId), String(uid), s), 0).catch(() => {}); };
  const queue = (pageId, fn, prio = 0) => { const sl = slot(pageId); return sl.queue(async () => { await sl.win.ready; await lighten(sl.win.webContents, sl.pageId); return fn(); }, prio); };

  // Danh sách hội thoại Business Suite: mỗi dòng có data-maiba-contact-id (UID Facebook thật của khách), tên và ảnh.
  // Đọc cả danh sách của một Page một lần (lưu 10 phút), rồi so tên với khách trong app.
  const domTop = new Map(); // pageId -> uid các khách đầu danh sách lần đọc màn hình gần nhất
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
  // Danh sách từ dữ liệu gốc (giờ chính xác tới mili giây, có cả khách chưa hiện trên màn hình) nếu đã có đủ; không thì đọc màn hình.
  const lsList = (pageId, max) => {
    const st = lsStores.get(String(pageId)); if (!st || st.threads.size < 3) return null;
    // Chỉ tin dữ liệu gốc khi nó có đủ các khách đầu danh sách trên màn hình (lần đọc gần nhất); thiếu → đọc màn hình.
    const top = domTop.get(String(pageId)); if (!top?.length || top.some(uid => !st.threads.has(uid) || !st.threads.get(uid).at)) return null;
    const names = pageRows.get(String(pageId))?.rows, nameOf = uid => { for (const [, l] of names || []) for (const r of l) if (r.uid === uid) return r.name; return ''; };
    const rows = [...st.threads.values()].filter(t => t.at && t.folder !== 'spam').sort((a, b) => b.at - a.at).slice(0, max).map(t => {
      const c = st.contacts.get(t.uid), name = c?.name || nameOf(t.uid);
      return { uid: t.uid, name: name || '', snippet: t.snippet, time: '', at: t.at, unread: t.read > 0 && t.read < t.at && !/^Bạn:/.test(t.snippet) ? Math.max(1, lsStreak(st, t.uid)) : 0, pic: c?.pic || t.pic };
    });
    // Thiếu tên vài khách (dữ liệu liên hệ chưa về): vẫn dùng nếu đa số có tên; khách thiếu tên tạm ghi "Khách Messenger".
    if (rows.filter(r => r.name).length < Math.ceil(rows.length * 0.7)) return null;
    for (const r of rows) if (!r.name) r.name = 'Khách Messenger';
    return rows;
  };
  const listThreads = ({ pageId, max = 15, full = false }) => (warmSend(pageId), !/^\d+$/.test(String(pageId))) ? Promise.resolve({ error: 'Thiếu Page.' })
    : (!full && lsList(pageId, Math.min(Math.max(Number(max) || 15, 5), 80))) ? Promise.resolve({ rows: lsList(pageId, Math.min(Math.max(Number(max) || 15, 5), 80)), source: 'ls' })
    : queue(pageId, async () => {
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
    // Đã đọc đủ danh sách gần đây: lần làm mới chỉ đọc phần đầu (hội thoại mới luôn nổi lên trên), không cuộn → 1–2 giây thay vì 10 giây.
    const quick = !full && here && sl.listedAt && Date.now() - sl.listedAt < 10 * 60e3;
    max = Math.min(Math.max(Number(max) || 15, 5), 80);
    // Business Suite trong khung ẩn có khi tải 15–20 giây: còn vòng xoay (progressbar / aria-busy) và chưa có dòng nào thì chờ tiếp, tối đa 30 giây.
    // Chờ tới khi danh sách có dòng đầu tiên (tối đa 60 giây: nhiều Page tải cùng lúc thì mỗi trang chậm hơn), không chỉ lúc còn vòng xoay.
    const hasRows = () => wc.executeJavaScript(`!!document.querySelector('[data-maiba-contact-id]')`).catch(() => false);
    while (Date.now() - started < 60000 && !await hasRows()) { await sleep(700); if (isLogin(wc.getURL())) return { error: 'login' }; }
    if (!await hasRows()) { const dir = await dumpPage(wc, 'khong-co-danh-sach'); return { error: `Business Suite chưa hiện danh sách hội thoại sau 60 giây (${wc.getURL().slice(0, 80)})${dir ? ' · đã lưu ảnh chụp vào ' + dir : ''}` }; }
    for (let i = 0, got = 0; i < (quick ? 1 : 12); i++) {
      await sleep(i ? 700 : quick ? 300 : 1500);
      if (i && sl.queue.urgent()) break; // bạn vừa bấm mở hội thoại: nhường khung ngay
      if (isLogin(wc.getURL())) return { error: 'login' };
      const part = await wc.executeJavaScript(`(${readThreads})(${JSON.stringify(seen.size > 0)})`).catch(() => []);
      for (const r of part) if (!seen.has(r.uid)) seen.set(r.uid, r);
      if (seen.size >= max || (seen.size && seen.size === got && i > 4)) break; // đủ, hoặc cuộn hết
      got = seen.size;
    }
    // Cuộn danh sách về đầu: hội thoại mới nhất luôn có sẵn để bấm mở ngay (danh sách chỉ vẽ phần đang thấy).
    await wc.executeJavaScript(`(() => { let box = document.querySelector('[data-maiba-contact-id]');
      while (box && !(box.scrollHeight > box.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (box) box.scrollTop = 0; })()`).catch(() => {});
    if (!quick && seen.size) sl.listedAt = Date.now();
    await watchList(wc);
    const rows = [...seen.values()].slice(0, max);
    // Nhiều dòng không đọc được giờ: lưu mẫu chữ của các dòng đó để chỉnh cách đọc (Downloads/GetHelps-debug).
    // Mẫu cấu trúc danh sách (loại dòng, thứ tự) để đối chiếu với Business Suite khi thiếu hội thoại.
    try {
      const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); fs.mkdirSync(dir, { recursive: true });
      const shape = await wc.executeJavaScript(`[...document.querySelectorAll('[data-maiba-contact-id]')].slice(0, 30).map(el => ({ type: el.getAttribute('data-maiba-contact-type'),
        uid: (el.getAttribute('data-maiba-contact-id') || '').slice(-4), name: ((el.querySelector('[data-surface$="lib:thread_title"]') || el).innerText || '').split('\\n')[0].slice(0, 3) + '…',
        top: Math.round(el.getBoundingClientRect().top) }))`).catch(e => 'lỗi ' + e.message);
      fs.writeFileSync(path.join(dir, `danh-sach-${pageId}.json`), JSON.stringify({ at: new Date().toISOString(), url: wc.getURL(), read: rows.map(r => r.name.slice(0, 3) + '… ' + r.time), shape }, null, 1));
    } catch {}
    const noTime = rows.filter(r => !r.time);
    if (noTime.length > rows.length / 3) try {
      const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `gio-danh-sach-${pageId}.json`), JSON.stringify(noTime.slice(0, 15).map(r => ({ name: r.name.slice(0, 2) + '…', raw: r.raw })), null, 1));
    } catch {}
    for (const r of rows) delete r.raw;
    // Dùng luôn cho tra avatar (cùng Page, khỏi tải lại).
    const entry = { at: Date.now(), rows: new Map(), full: false };
    for (const r of rows) entry.rows.set(key(r.name), [...(entry.rows.get(key(r.name)) || []), r]);
    if (rows.length) { pageRows.set(String(pageId), entry); domTop.set(String(pageId), rows.slice(0, 8).map(r => r.uid)); }
    return { rows };
  });

  // Mở hội thoại của khách (UID) trong khung ẩn: tải hộp thư của Page rồi bấm vào dòng của khách.
  const mouse = async (wc, spec) => {
    const r = await wc.executeJavaScript(`(${findTarget})(${JSON.stringify(spec)})`).catch(() => null); if (!r) return false;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  };
  const openThreadHidden = async (pageId, uid, sl = slot(pageId)) => {
    const wc = sl.win.webContents, id = `${pageId}:${uid}`;
    if (sl.opened === id && wc.getURL().includes(`asset_id=${pageId}`)) return true;
    // Khung chi tiết đã đúng khách này (data-surface "<uid>:<tên>") và có tin → xong.
    const ready = async () => !!(await wc.executeJavaScript(`(() => { const col = document.querySelector('[data-surface$="lib:inbox:detail_column"]');
      // Thẻ "<uid>:<tên>" có thể nằm ở cột thông tin khách (ngoài detail_column) → tìm trên toàn trang; cột tin phải có tin.
      // Hoặc địa chỉ trang đã chọn đúng khách (selected_item_id=<uid>) và cột tin đã có tin.
      return !!(col && (document.querySelector('[data-surface^="${uid}:"], [data-surface*="/${uid}:"]') || /[?&]selected_item_id=${uid}(&|$)/.test(location.search)) && col.querySelector('[data-message-id]')); })()`).catch(() => false));
    // Nhanh: đang ở hộp thư của đúng Page → bấm thẳng vào dòng của khách (cuộn danh sách về đầu nếu cần), không tải lại trang (tiết kiệm 10–30 giây).
    if (wc.getURL().includes(`asset_id=${pageId}`)) {
      for (let i = 0; i < 2; i++) {
        if (await mouse(wc, { selector: `[data-maiba-contact-id="${uid}"]` })) {
          for (let k = 0; k < 20; k++) { await sleep(300); if (await ready()) { sl.opened = id; await watchThread(wc); await watchList(wc); return true; } }
          // Không nhận ra dấu hiệu nhưng trang đã chọn đúng khách và có tin → dùng luôn, không tải lại cả trang (tiết kiệm 15–25 giây).
          if (wc.getURL().includes(`selected_item_id=${uid}`) && (await wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null))?.messages?.length) { sl.opened = id; await watchThread(wc); await watchList(wc); return true; }
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
      if (await ready()) { sl.opened = id; await watchThread(wc); await watchList(wc); return true; }
    }
    // Không nhận ra được khách trong khung chi tiết (Meta đổi giao diện): vẫn nhận nếu đã có tin.
    const r = await wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null);
    if (r?.messages?.length) { sl.opened = id; await watchThread(wc); await watchList(wc); return true; }
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
    // Dấu hiệu đã nhận ảnh: có ảnh xem trước (blob/data) HOẶC vùng soạn tin đổi hẳn (Business Suite chèn khung đính kèm), kiểm tra mỗi 150ms.
    const compSize = () => wc.executeJavaScript(`(() => { const b = document.querySelector('[data-ga-composer]'); return b ? b.getElementsByTagName('*').length : 0; })()`).catch(() => 0);
    const size0 = await compSize();
    const waitPreview = async (ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { await sleep(150); if (await pics() > before || await compSize() > size0 + 3) { await sleep(250); return true; } } return false; };
    const m = String(image).match(/^data:(image\/(\w+));base64,(.+)$/);
    // Các cách đưa ảnh vào ô nhập. Cách nào thành công thì nhớ lại (attach-method.txt) và lần sau thử cách đó trước → không mất thời gian cho cách hỏng.
    const ways = {
      file: async () => { const id = await fileInput(); tried.push(id ? 'ô file: có' : 'ô file: không'); return !!id && await putImage(dbg, id, image, 'anh') && await waitPreview(); },
      paste: () => synth('paste'), drop: () => synth('drop'),
      button: async () => {
        try {
          await dbg.sendCommand('Page.enable');
          await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
          const chooser = new Promise(resolve => { const on = (_e, method, params) => { if (method === 'Page.fileChooserOpened') { dbg.removeListener('message', on); resolve(params); } };
            dbg.on('message', on); setTimeout(() => { dbg.removeListener('message', on); resolve(null); }, 5000); });
          const clicked = await mouse(wc, { selector: '[data-ga-composer] [role="button"], [data-ga-composer] button, [data-ga-composer] [aria-label]', text: /đính kèm|ảnh|photo|image|attach|tệp|file/i.source });
          const params = clicked ? await chooser : null;
          let id = params?.backendNodeId ? (await dbg.sendCommand('DOM.resolveNode', { backendNodeId: params.backendNodeId }).catch(() => null))?.object?.objectId : '';
          if (!id && clicked) id = await fileInput();
          tried.push(clicked ? (params ? 'nút đính kèm: mở hộp chọn' : 'nút đính kèm: không mở hộp chọn') : 'nút đính kèm: không thấy');
          return !!id && await putImage(dbg, id, image, 'anh') && await waitPreview();
        } catch (e) { tried.push('nút đính kèm lỗi: ' + e.message); return false; } finally { await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {}); }
      },
      clip: async () => { // dán ảnh thật từ clipboard (trả lại chữ cũ trong clipboard sau đó)
        let oldText = '', oldImg = null; try { oldText = String(clipboard.readText() || ''); const im = clipboard.readImage(); if (!im.isEmpty()) oldImg = im; } catch {}
        try {
          const img = nativeImage.createFromDataURL(image); if (img.isEmpty()) { tried.push('ảnh hỏng'); return false; }
          if (!await mouse(wc, { selector: '[data-ga-editor]' })) { tried.push('dán: không bấm được ô nhập'); return false; }
          if (typeof clipboard.writeImage !== 'function') { tried.push('dán: không dùng được clipboard'); return false; }
          await sleep(200); clipboard.writeImage(img); wc.paste();
          if (await waitPreview()) return true;
          tried.push('dán: không thấy ảnh'); return false;
        } catch (e) { tried.push('dán lỗi: ' + e.message); return false; }
        finally { setTimeout(() => { try { if (oldImg) clipboard.writeImage(oldImg); else if (oldText) clipboard.writeText(oldText); } catch {} }, 1500); } // trả lại bộ nhớ tạm như cũ
      }
    };
    // Giả dán / kéo-thả ngay trên ô nhập.
    async function synth(kind) {
      const edId = (await dbg.sendCommand('Runtime.evaluate', { expression: `document.querySelector('[data-ga-editor]')` }).catch(() => null))?.result?.objectId || '';
      if (!edId || !m) { tried.push(kind + ': bỏ qua'); return false; }
      const r = await dbg.sendCommand('Runtime.callFunctionOn', { objectId: edId, returnByValue: true, arguments: [{ value: m[3] }, { value: m[1] }, { value: 'anh.' + (m[2] === 'jpeg' ? 'jpg' : m[2]) }, { value: kind }],
        functionDeclaration: `function (b64, type, name, kind) {
          const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type })); this.focus();
          if (kind === 'paste') { const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); this.dispatchEvent(ev); return ev.defaultPrevented; }
          let ok = false; for (const t of ['dragenter', 'dragover', 'drop']) { const ev = new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }); this.dispatchEvent(ev); ok = ok || ev.defaultPrevented; }
          return ok; }` }).catch(e => ({ error: e.message }));
      // Trang đã nhận (chặn xử lý mặc định) = Messenger đã lấy ảnh → chỉ chờ ngắn cho khung đính kèm hiện (không chờ đủ 4 giây).
      if (await waitPreview(r?.result?.value ? 1500 : 4000)) return true;
      if (r?.result?.value) return true;
      tried.push(`${kind}: ${r?.error ? 'lỗi ' + r.error : 'không nhận'}`);
      return false;
    }
    // Dán ảnh thật (clip) trước: Messenger nhận là ẢNH (tự nén trước khi tải lên, có ảnh xem trước) thay vì tệp "anh.jpg" → tải lên nhanh hơn.
    const order = ['clip', 'paste', 'file', 'drop', 'button'], best = attachBest();
    for (const k of best ? [best, ...order.filter(x => x !== best)] : order) {
      if (await ways[k]()) { if (k !== best) attachBest(k); tried.push('ok: ' + k); return true; }
    }
    return false;
  };
  // Cách đính ảnh thành công gần nhất (nhớ qua các lần mở app).
  const attachFile = () => path.join(app.getPath('userData'), 'attach-method-v2.txt'); // v2: học lại với thứ tự mới (dán thật trước)
  let attachMem = null;
  function attachBest(set) {
    if (set) { attachMem = set; try { fs.writeFileSync(attachFile(), set); } catch {} return set; }
    if (attachMem == null) { try { attachMem = fs.readFileSync(attachFile(), 'utf8').trim(); } catch { attachMem = ''; } }
    return attachMem;
  }
  // Dọn ô nhập ngay tại chỗ (chữ + ảnh đính kèm còn sót từ lần trước) thay vì tải lại cả trang Business Suite (tiết kiệm 5–10 giây).
  // Trả về false nếu vẫn còn ảnh sót (khi đó mới tải lại trang).
  // Nút "×" gỡ ảnh đính kèm của ô soạn tin (cột tin nhắn). Cột thông tin khách bên phải cũng có nút cùng tên → phải lọc đúng vùng.
  const ATT_CLOSE = '[data-surface*="messenger_detail_view/lib:message-thread-attachment-preview-button-close"]';
  async function clearComposer(wc) {
    for (let i = 0; i < 6; i++) { if (!await mouse(wc, { selector: ATT_CLOSE })) break; await sleep(300); }
    const hasText = await wc.executeJavaScript(`!!(document.querySelector('[data-ga-editor]')?.innerText || '').trim()`).catch(() => false);
    if (hasText && await mouse(wc, { selector: '[data-ga-editor]' })) {
      const dbg = wc.debugger, mod = process.platform === 'darwin' ? 4 : 2;
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: mod }).catch(() => {});
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: mod }).catch(() => {});
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }).catch(() => {});
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }).catch(() => {});
      await sleep(100);
    }
    return !(await wc.executeJavaScript(`document.querySelectorAll('${ATT_CLOSE}').length`).catch(() => 0));
  }
  const threadArgs = ({ pageId, uid }) => /^\d+$/.test(String(pageId)) && /^\d+$/.test(String(uid));
  // Hội thoại đã có dữ liệu gốc (đã tải một đoạn tin, tin mới tự đổ về): trả ngay, không phải mở trong khung ẩn.
  const lsReady = args => !args.older && lsStores.get(String(args.pageId))?.loaded.has(String(args.uid)) && lsMessages(args.pageId, args.uid).some(m => !m.sep);
  // Đọc cùng một hội thoại nhiều lần liền nhau (tin mới tới dồn dập, đọc định kỳ 20 giây) → dùng chung một lượt đọc đang chờ, không xếp hàng chồng lên làm tắc việc gửi tin.
  const reading = new Map();
  const readThread = args => { if (!threadArgs(args)) return Promise.resolve({ error: 'Thiếu Page hoặc khách.' });
    if (!args.bg && !args.older) preOpenSend(args.pageId, args.uid); // bạn đang xem khách này → khung gửi mở sẵn hội thoại
    if (lsReady(args)) return Promise.resolve({ messages: lsMessages(args.pageId, args.uid), source: 'ls' });
    const k = `${args.pageId}:${args.uid}:${args.older ? 'o' : ''}`;
    if (reading.has(k)) return reading.get(k);
    const pr = readThreadQ(args).finally(() => reading.delete(k)); reading.set(k, pr); return pr; };
  const lsWaited = new Set();
  const readThreadQ = args => queue(args.pageId, async () => {
    const ok = await openThreadHidden(String(args.pageId), String(args.uid));
    if (ok === 'login') return { error: 'login' };
    if (!ok) return { error: 'Không mở được hội thoại trong Business Suite.' };
    const wc = slot(args.pageId).win.webContents, st = lsStore(args.pageId), uid = String(args.uid);
    if (args.older) { await wc.executeJavaScript(`(${readMessages})(true)`).catch(() => {}); await sleep(2500); }
    // Vừa mở hội thoại: dữ liệu gốc thường về trong ~1 giây → dùng nó (đủ, chính xác hơn đọc màn hình).
    if (!lsWaited.has(uid)) { lsWaited.add(uid); for (let i = 0; i < 6 && !st.loaded.has(uid); i++) await sleep(250); } // chỉ chờ lần đầu
    if (st.loaded.has(uid) && lsMessages(args.pageId, uid).some(m => !m.sep)) return { messages: lsMessages(args.pageId, uid), source: 'ls' };
    return await wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null) || { error: 'Không đọc được tin.' };
  }, args.bg ? 0 : 1); // đọc trước (nền) nhường việc bạn đang chờ
  // Gửi tin như người dùng gõ trong Business Suite (không qua API → không bị giới hạn của app chưa duyệt).
  // Nhật ký thời gian gửi (Downloads/GetHelps-debug/gui-tin.json, 20 lần gần nhất): chờ hàng đợi, mở hội thoại, đính ảnh, xác nhận…
  const sendLog = [];
  const writeSendLog = e => { try { sendLog.unshift(e); sendLog.splice(20); const dir = path.join(app.getPath('downloads'), 'GetHelps-debug'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'gui-tin.json'), JSON.stringify(sendLog, null, 1)); } catch {} };
  const sendThread = args => { const T = { at: new Date().toISOString(), anh: !!args.image, kb: args.image ? Math.round(String(args.image).length * 0.75 / 1024) : 0, chu: String(args.text || '').length, buoc: {} }, t0 = Date.now();
    const mark = k => { T.buoc[k] = (Date.now() - t0) / 1000; };
    if (!threadArgs(args)) return Promise.resolve({ error: 'Thiếu Page hoặc khách.' });
    return sendQueue(args.pageId, ss => { mark('hang-doi'); T.khung = ss.send ? 'gui' : 'doc'; return sendCore(args, mark, ss); }, 1).then(r => { mark('xong'); T.ketqua = r?.error ? 'lỗi: ' + String(r.error).slice(0, 80) : 'ok'; T.cach = attachImage.last?.tried?.slice(-1)[0] || ''; writeSendLog(T); return r; },
      e => { mark('xong'); T.ketqua = 'lỗi: ' + e.message; writeSendLog(T); throw e; });
  };
  const sendCore = async (args, mark, sl) => {
    const text = String(args.text || '').trim(), image = args.image || '';
    if (!text && !image) return { error: 'Thiếu nội dung.' };
    let ok = await openThreadHidden(String(args.pageId), String(args.uid), sl);
    mark('mo-hoi-thoai');
    if (ok !== true) return { error: ok === 'login' ? 'login' : 'Không mở được hội thoại trong Business Suite.' };
    const wc = sl.win.webContents, dbg = wc.debugger;
    // Dọn ô nhập tại chỗ (gỡ ảnh sót, xoá chữ cũ). Không tải lại trang nữa: dấu hiệu "còn ảnh sót" hay nhận nhầm, tốn 20+ giây.
    if (await findComposer(wc, 4000)) await clearComposer(wc);
    mark('don-o-nhap');
    const read = () => wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null);
    const myPics = r => (r?.messages || []).filter(m => m.mine && m.pic).length;
    const allPics = r => (r?.messages || []).filter(m => m.pic).length;
    const r0 = await read(), picsBefore = myPics(r0), allBefore = allPics(r0);
    const attached = image ? await attachImage(wc, image) : true;
    if (image) mark('dinh-anh');
    if (!attached) {
      const d = attachImage.last;
      if (attachImage.locked) return { error: `Không thấy ô nhập tin trong Business Suite (khung ẩn). ${d?.tried.join(' · ')}` };
      return { error: `Không đưa được ảnh vào Business Suite. [${d?.tried.join(' · ')} · ${describe(d?.comp)}]` };
    }
    const comp = await findComposer(wc, image ? 2000 : 10000);
    if (!comp) { const why = await whyNoComposer(wc), dir = await dumpPage(wc, 'khong-o-nhap'); if (dir) return { error: `Không thấy ô nhập tin trong Business Suite.${why ? ' Meta báo: ' + why + '.' : ''} Đã lưu ảnh chụp vào ${dir}` }; return { error: `Business Suite không cho trả lời hội thoại này (không có ô nhập tin).${why ? ' Meta báo: ' + why + '.' : ''} Thường do khách nhắn lần cuối đã quá 7 ngày: chờ khách nhắn lại, hoặc liên hệ qua Zalo/SĐT.` }; }
    if (!await mouse(wc, { selector: '[data-ga-editor]' })) return { error: `Không bấm được ô nhập tin của Business Suite. [${describe(comp)}]` };
    await sleep(120);
    const lines = text ? text.split('\n') : [];
    for (const [i, line] of lines.entries()) {
      if (i) { // xuống dòng trong cùng một tin
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
      }
      if (line) await dbg.sendCommand('Input.insertText', { text: line });
    }
    await sleep(image ? 300 : 100);
    if (image) { // chờ ảnh tải lên Meta xong (tối đa 10 giây) rồi mới bấm Gửi, nếu không Business Suite chỉ gửi chữ
      const st = lsStore(args.pageId);
      for (let i = 0; i < 66; i++) { const busy = [...(st.uploads?.values() || [])].some(t => Date.now() - t < 30e3); if (!busy && (i >= 2 || st.uploadsDone > Date.now() - 3000)) break; await sleep(150); }
      mark('tai-anh-len');
    }
    mark('go-chu'); const t0 = Date.now(); lsStore(args.pageId).capture = t0 + 20000;
    // Bấm nút "Gửi" của Business Suite (Enter có khi không gửi khi đang có ảnh đính kèm); không thấy nút thì bấm Enter.
    const pressEnter = async () => { await mouse(wc, { selector: '[data-ga-editor]' });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 }); };
    const sendBtn = { selector: 'button, [role="button"]', text: '^(Gửi|Send)$', enabled: true };
    if (!await mouse(wc, sendBtn)) await pressEnter();
    // So khớp bỏ khoảng trắng: Business Suite gộp/bỏ dấu cách đầu dòng (vd dòng thụt lề "   Nội dung CK") nên so nguyên văn sẽ trượt.
    // So khớp chỉ theo chữ + số: Messenger hiện emoji (📌 💳…) thành hình nên chữ đọc trên màn hình không có emoji; tin dài có khi bị rút gọn "Xem thêm".
    const norm = t => String(t || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const all = norm(text), head = all.slice(0, 30), tail = all.slice(-30);
    const hit = t => { const n = norm(t); return !!n && (n.includes(tail) || n.includes(head)); };
    // Hội thoại có thể đã có tin giống hệt (gửi lại cùng mẫu) → chỉ tính tin MỚI: đếm số tin khớp trước khi gửi.
    const hits = r => (r?.messages || []).filter(m => m.text && hit(m.text)).length, hitsBefore = hits(r0);
    const stillTyped = () => wc.executeJavaScript(`(document.querySelector('[data-ga-editor]')?.innerText || '')`).then(t => !!all && norm(t).includes(head)).catch(() => false);
    let backup = false;
    let textOk = !all, picOk = !image;
    // Xác nhận nhanh: dữ liệu gốc của Meta (WebSocket) báo tin của Page vừa gửi trong hội thoại này → xong ngay (thường < 1 giây).
    // Đọc màn hình chỉ là dự phòng (mỗi ~0,9 giây). Tối đa ~16 giây chữ / ~32 giây có ảnh.
    const lsSent = () => [...(lsStore(args.pageId).msgs.get(String(args.uid))?.values() || [])].some(m => m.ts >= t0 - 5000 && hit(m.text));
    // Ảnh: dữ liệu gốc không luôn ghi người gửi cho tệp đính kèm → ảnh mới xuất hiện trong hội thoại ngay sau khi bấm gửi là ảnh vừa gửi.
    const lsPic = () => [...(lsStore(args.pageId).msgs.get(String(args.uid))?.values() || [])].some(m => m.pic && m.ts >= t0 - 3000 && !(m.mine === false && m.text && !hit(m.text) && m.ts < t0));
    const done = async () => { const lr = lsMessages(args.pageId, args.uid); if (lsStore(args.pageId).loaded.has(String(args.uid)) && lr.length) return { done: true, messages: lr, source: 'ls' }; return { done: true, ...(await read()) }; };
    for (let i = 0; i < (image ? 210 : 105); i++) {
      await sleep(150);
      if (all) textOk ||= lsSent(); if (image) picOk ||= lsPic();
      // Ảnh còn nằm trong ô sau khi chữ đã đi (ảnh lên chậm) → bấm Gửi thêm lần nữa khi ảnh tải xong.
      if (image && !picOk && textOk && i === 12 && await wc.executeJavaScript(`document.querySelectorAll('${ATT_CLOSE}').length`).catch(() => 0)) await mouse(wc, sendBtn);
      if (textOk && picOk) { mark('xac-nhan-goc'); return done(); }
      if (i % 6 === 5) {
        const r = await read();
        textOk ||= hits(r) > hitsBefore; picOk ||= myPics(r) > picsBefore;
        // Sau ~2 giây chữ vẫn nằm trong ô nhập = chưa gửi → bấm Enter thêm một lần (dự phòng).
        if (!backup && !textOk && i >= 11 && await stillTyped()) { backup = true; await pressEnter(); }
        if (textOk && picOk) { mark('xac-nhan-man-hinh'); return { done: true, ...r }; }
      }
    }
    if (textOk && !picOk) { await dumpPage(wc, 'gui-thieu-anh'); return { error: 'Chữ đã gửi, nhưng chưa thấy ảnh trong hội thoại. Kiểm tra cột Meta; nếu thiếu ảnh thì Copy ảnh và dán vào đó (đừng gửi lại cả tin để tránh lặp).' }; }
    return { error: 'Đã bấm gửi nhưng chưa thấy tin trong Business Suite — kiểm tra lại trong cột Meta trước khi gửi lại.' };
  };

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
