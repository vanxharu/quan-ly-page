// Tự động hoá trang Meta Business Suite (đã đăng nhập trong app) cho những việc Graph API bị chặn khi app chưa Live:
//  - lookupProfile: mở hội thoại của khách trong một khung ẩn, đọc ảnh đại diện + UID (link trang cá nhân);
//  - composePost: mở trình soạn bài, điền sẵn nội dung + ảnh (qua debugger), người dùng bật nút Gửi tin nhắn / hẹn giờ rồi bấm Đăng.
// Mỗi lần chỉ làm một việc, có nghỉ giữa các lượt, để giống thao tác người thật.
const { clipboard } = require('electron');
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
  const isTime = s => /^(vừa xong|now|\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|[smhdwy])|\d{1,2}:\d{2}|th\s?[2-7]|cn|\d{1,2}\s*thg\s*\d{1,2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?)$/i.test(s);
  const rows = [...document.querySelectorAll('[data-maiba-contact-id][data-maiba-contact-type="fb_user"]')].map(el => {
    const title = el.querySelector('[data-surface$="lib:thread_title"]'), name = (title?.innerText || '').trim();
    const leaves = [...el.querySelectorAll('span,div,abbr')].filter(x => x.childElementCount === 0 && !title?.contains(x));
    const lines = leaves.map(x => (x.innerText || x.textContent || '').trim()).filter(s => s && s !== name && !/^[·•]$/.test(s));
    const time = lines.find(isTime) || '';
    const snippet = lines.filter(s => s !== time).sort((a, b) => b.length - a.length)[0] || '';
    const leaf = snippet && leaves.find(x => (x.innerText || x.textContent || '').trim() === snippet);
    return {
      uid: el.getAttribute('data-maiba-contact-id'), name, snippet, time,
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

// Chạy trong trang Business Suite: tin của hội thoại đang mở. Không dựa vào tên class (Meta đổi liên tục) mà dựa vào bố cục:
// vùng cuộn lớn nhất trong cột hội thoại; bong bóng lệch phải = Page gửi, lệch trái = khách, nằm giữa = mốc giờ.
// scrollUp=true thì cuộn lên đầu để Business Suite tải tin cũ hơn.
function readMessages(scrollUp) {
  const col = document.querySelector('[data-surface$="lib:inbox:detail_column"]');
  if (!col) return null;
  const scroller = [...col.querySelectorAll('div')].filter(d => d.clientHeight > 80 && /auto|scroll/.test(getComputedStyle(d).overflowY))
    .sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (!scroller) return null;
  if (scrollUp) { scroller.scrollTop = 0; return { scrolled: true }; }
  const box = scroller.getBoundingClientRect(), mid = box.left + box.width / 2;
  const items = [];
  for (const el of scroller.querySelectorAll('[dir="auto"], img')) {
    if (el.closest('[contenteditable="true"],[role="textbox"],[role="button"],button')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const center = r.left + r.width / 2, mine = center > mid, centered = Math.abs(center - mid) < box.width * 0.08 && r.width < box.width * 0.6;
    if (el.tagName === 'IMG') {
      const src = el.currentSrc || el.src;
      if (Math.max(r.width, r.height) >= 60 && /scontent|fbcdn\.net\/v\//.test(src)) items.push({ y: r.top, mine, pic: src });
      continue;
    }
    if (el.querySelector('[dir="auto"]')) continue; // chỉ lấy lớp chữ trong cùng
    const text = (el.innerText || '').trim(); if (!text) continue;
    items.push(centered ? { y: r.top, sep: text } : { y: r.top, mine, text });
  }
  items.sort((a, b) => a.y - b.y);
  return { messages: items.map(({ y, ...m }) => m), atTop: scroller.scrollTop === 0 };
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

function createMetaAuto({ worker, composer, metaView, showMeta = () => () => {}, metaShown = () => true, notify = () => {}, progress = () => {} }) {
  // Hai hàng chờ riêng: đọc avatar (khung ẩn) không phải chờ trình soạn bài (có thể mở lâu).
  const makeQueue = () => { let chain = Promise.resolve(); return fn => (chain = chain.then(fn, fn)); };
  const queue = makeQueue(), composeQueue = makeQueue();

  // Danh sách hội thoại Business Suite: mỗi dòng có data-maiba-contact-id (UID Facebook thật của khách), tên và ảnh.
  // Đọc cả danh sách của một Page một lần (lưu 10 phút), rồi so tên với khách trong app.
  let openedThread = ''; // hội thoại đang mở trong khung ẩn (pageId:uid); tải lại trang thì xoá
  const pageRows = new Map(); // pageId -> { at, rows: Map(nameKey -> [{uid,name,pic}]) }
  const key = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const loadRows = async (pageId, wantName) => {
    const cached = pageRows.get(pageId);
    if (cached && Date.now() - cached.at < 10 * 60e3 && (!wantName || cached.rows.has(key(wantName)) || cached.full)) return cached;
    const wc = worker.webContents;
    if (!cached || !wc.getURL().includes(`asset_id=${pageId}`)) {
      openedThread = '';
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
  const lookupProfile = ({ pageId, psid, name }) => queue(async () => {
    if (!/^\d+$/.test(String(pageId)) || !/^\d+$/.test(String(psid))) return { error: 'Thiếu Page hoặc khách.' };
    const entry = await loadRows(String(pageId), name);
    if (entry.error) return entry;
    const found = entry.rows.get(key(name)) || [];
    if (found.length !== 1) return { error: found.length ? 'trùng tên' : 'not-found' }; // trùng tên thì không đoán
    const { uid, pic } = found[0];
    return { pic, uid, profileUrl: `https://www.facebook.com/profile.php?id=${uid}` };
  });

  // Hộp thư dự phòng khi Graph API lỗi: đọc danh sách hội thoại mới nhất của Page trong khung ẩn.
  const listThreads = ({ pageId, max = 40 }) => queue(async () => {
    if (!/^\d+$/.test(String(pageId))) return { error: 'Thiếu Page.' };
    const wc = worker.webContents;
    openedThread = '';
    await wc.loadURL(`https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&mailbox_id=${pageId}`).catch(() => {});
    const seen = new Map(), started = Date.now();
    // Business Suite trong khung ẩn có khi tải 15–20 giây: còn vòng xoay (progressbar / aria-busy) và chưa có dòng nào thì chờ tiếp, tối đa 30 giây.
    const loading = () => wc.executeJavaScript(`!!document.querySelector('[role="progressbar"],[aria-busy="true"]') && !document.querySelector('[data-maiba-contact-id]')`).catch(() => true);
    while (!seen.size && Date.now() - started < 30000 && await loading()) { await sleep(1000); if (isLogin(wc.getURL())) return { error: 'login' }; }
    for (let i = 0, got = 0; i < 12; i++) {
      await sleep(i ? 700 : 1500);
      if (isLogin(wc.getURL())) return { error: 'login' };
      const part = await wc.executeJavaScript(`(${readThreads})(${JSON.stringify(seen.size > 0)})`).catch(() => []);
      for (const r of part) if (!seen.has(r.uid)) seen.set(r.uid, r);
      if (seen.size >= max || (seen.size && seen.size === got && i > 4)) break; // đủ, hoặc cuộn hết
      got = seen.size;
    }
    const rows = [...seen.values()].slice(0, max);
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
    const wc = worker.webContents, id = `${pageId}:${uid}`;
    if (openedThread === id && wc.getURL().includes(`asset_id=${pageId}`)) return true;
    openedThread = '';
    await wc.loadURL(`https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&mailbox_id=${pageId}`).catch(() => {});
    for (let i = 0; i < 35; i++) { // Business Suite ẩn có khi tải chậm: chờ tối đa ~35 giây cho dòng của khách hiện ra
      await sleep(1000);
      if (isLogin(wc.getURL())) return 'login';
      if (await mouse(wc, { selector: `[data-maiba-contact-id="${uid}"]` })) break;
      if (i === 34) return false;
    }
    for (let i = 0; i < 15; i++) {
      await sleep(800);
      const r = await wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null);
      if (r?.messages?.length) { openedThread = id; return true; }
    }
    return false;
  };
  const threadArgs = ({ pageId, uid }) => /^\d+$/.test(String(pageId)) && /^\d+$/.test(String(uid));
  const readThread = args => queue(async () => {
    if (!threadArgs(args)) return { error: 'Thiếu Page hoặc khách.' };
    const ok = await openThreadHidden(String(args.pageId), String(args.uid));
    if (ok === 'login') return { error: 'login' };
    if (!ok) return { error: 'Không mở được hội thoại trong Business Suite.' };
    const wc = worker.webContents;
    if (args.older) { await wc.executeJavaScript(`(${readMessages})(true)`).catch(() => {}); await sleep(2500); }
    return await wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null) || { error: 'Không đọc được tin.' };
  });
  // Gửi tin như người dùng gõ trong Business Suite (không qua API → không bị giới hạn của app chưa duyệt).
  const sendThread = args => queue(async () => {
    const text = String(args.text || '').trim(), image = args.image || '';
    if (!threadArgs(args) || (!text && !image)) return { error: 'Thiếu nội dung.' };
    const ok = await openThreadHidden(String(args.pageId), String(args.uid));
    if (ok !== true) return { error: ok === 'login' ? 'login' : 'Không mở được hội thoại trong Business Suite.' };
    const wc = worker.webContents, dbg = wc.debugger;
    const read = () => wc.executeJavaScript(`(${readMessages})(false)`).catch(() => null);
    const myPics = r => (r?.messages || []).filter(m => m.mine && m.pic).length;
    const picsBefore = myPics(await read());
    if (image) { // ô chọn ảnh của khung trả lời (Messenger luôn để sẵn một ô ẩn)
      const objectId = (await dbg.sendCommand('Runtime.evaluate', { expression: `(() => { const col = document.querySelector('[data-surface$="lib:inbox:detail_column"]');
        return [...(col || document).querySelectorAll('input[type="file"]')].find(i => /image|\\*/.test(i.accept || '*')) || null; })()` }).catch(() => null))?.result?.objectId;
      if (!await putImage(dbg, objectId, image, 'anh')) return { error: 'Không đưa được ảnh vào Business Suite.' };
      await sleep(1500);
    }
    if (!await mouse(wc, { selector: '[data-surface$="lib:inbox:detail_column"] [contenteditable="true"]' })) return { error: 'Không thấy ô nhập tin của Business Suite.' };
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
    const tail = lines.filter(Boolean).pop();
    for (let i = 0; i < 20; i++) { // ảnh tải lên lâu hơn chữ
      await sleep(800);
      const r = await read();
      const last = r?.messages?.filter(m => m.mine && m.text).pop();
      if ((!tail || (last && last.text.includes(tail))) && (!image || myPics(r) > picsBefore)) return { done: true, ...r };
    }
    return { error: 'Đã bấm gửi nhưng chưa thấy tin trong Business Suite — kiểm tra lại trong cột Meta trước khi gửi lại.' };
  });

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
