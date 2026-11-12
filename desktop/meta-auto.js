// Tự động hoá trang Meta Business Suite (đã đăng nhập trong app) cho những việc Graph API bị chặn khi app chưa Live:
//  - lookupProfile: mở hội thoại của khách trong một khung ẩn, đọc ảnh đại diện + UID (link trang cá nhân);
//  - composePost: mở trình soạn bài, điền sẵn nội dung + ảnh (qua debugger), người dùng bật nút Gửi tin nhắn / hẹn giờ rồi bấm Đăng.
// Mỗi lần chỉ làm một việc, có nghỉ giữa các lượt, để giống thao tác người thật.
const fs = require('fs'), os = require('os'), path = require('path');
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

function createMetaAuto({ worker, metaView, showMeta, metaShown = () => true }) {
  // Hai hàng chờ riêng: đọc avatar (khung ẩn) không phải chờ trình soạn bài (có thể mở lâu).
  const makeQueue = () => { let chain = Promise.resolve(); return fn => (chain = chain.then(fn, fn)); };
  const queue = makeQueue(), composeQueue = makeQueue();

  // Danh sách hội thoại Business Suite: mỗi dòng có data-maiba-contact-id (UID Facebook thật của khách), tên và ảnh.
  // Đọc cả danh sách của một Page một lần (lưu 10 phút), rồi so tên với khách trong app.
  const pageRows = new Map(); // pageId -> { at, rows: Map(nameKey -> [{uid,name,pic}]) }
  const key = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const loadRows = async (pageId, wantName) => {
    const cached = pageRows.get(pageId);
    if (cached && Date.now() - cached.at < 10 * 60e3 && (!wantName || cached.rows.has(key(wantName)) || cached.full)) return cached;
    const wc = worker.webContents;
    if (!cached || !wc.getURL().includes(`asset_id=${pageId}`)) {
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

  // Điền sẵn trình soạn bài Business Suite. Trả về khi người dùng đã đăng/hẹn (trang rời khỏi trình soạn) hoặc sau 15 phút.
  const composePost = ({ pageId, text, image }) => composeQueue(async () => {
    if (!/^\d+$/.test(String(pageId))) return { error: 'Thiếu Page.' };
    const wc = metaView.webContents;
    showMeta();
    await wc.loadURL(`https://business.facebook.com/latest/composer/?asset_id=${pageId}&context_ref=POSTS&ref=meta_assistant`).catch(() => {});
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      await sleep(1000);
      if (isLogin(wc.getURL())) return { error: 'login' };
      ready = await wc.executeJavaScript(`!!document.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"]')`).catch(() => false);
    }
    if (!ready) return { error: 'Không thấy ô soạn bài của Business Suite.' };
    const dbg = wc.debugger;
    let file = '';
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      if (image) {
        const m = String(image).match(/^data:image\/(\w+);base64,(.+)$/);
        if (m) {
          file = path.join(os.tmpdir(), `meta-assistant-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
          fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
          const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
          const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"][accept*="image"], input[type="file"]' });
          if (nodeId) await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] });
        }
      }
      if (text) {
        await wc.executeJavaScript(`(document.querySelector('[contenteditable="true"][role="textbox"]') || document.querySelector('[contenteditable="true"]')).focus(); true`);
        await sleep(300);
        await dbg.sendCommand('Input.insertText', { text: String(text) });
      }
    } catch (e) { return { error: 'Không điền sẵn được bài: ' + e.message }; }
    finally { try { dbg.detach(); } catch {} }
    // Người dùng tự bật "Gửi tin nhắn", chọn giờ, bấm Đăng/Lên lịch → trang rời trình soạn.
    for (let i = 0; i < 900; i++) {
      await sleep(1000);
      if (wc.isDestroyed() || !/\/composer/.test(wc.getURL())) break;
      if (!metaShown()) { if (file) fs.rm(file, () => {}); return { error: 'Đã đóng trình soạn Business Suite, bài chưa được đăng.' }; } // bấm ✕ trên cột = huỷ
    }
    if (file) fs.rm(file, () => {});
    return { done: !/\/composer/.test(wc.isDestroyed() ? '' : wc.getURL()) };
  });

  return { lookupProfile, composePost };
}
module.exports = { createMetaAuto, extractProfile };
