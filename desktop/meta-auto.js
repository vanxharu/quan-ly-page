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

// Chạy trong trang: tìm phần tử hiện trên màn hình theo selector / role / chữ / nhãn (aria-labelledby), cuộn vào giữa, trả toạ độ tâm.
function findTarget({ selector, role, text, label }) {
  const re = s => s ? new RegExp(s, 'i') : null, tRe = re(text), lRe = re(label);
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };
  const own = el => (el.innerText || el.getAttribute('aria-label') || '').trim();
  let list = [...document.querySelectorAll(selector || (role ? `[role="${role}"]` : 'button,[role="button"],a,span,div,label'))];
  if (tRe) list = list.filter(el => tRe.test(own(el)) && (selector || role || ![...el.children].some(c => tRe.test(own(c)))));
  if (lRe) list = list.filter(el => (el.getAttribute('aria-labelledby') || '').split(' ').some(id => lRe.test((document.getElementById(id)?.innerText || '').trim())));
  const el = list.find(shown);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

function createMetaAuto({ worker, metaView, showMeta, metaShown = () => true, notify = () => {} }) {
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
  // Trình soạn Business Suite (giao diện 11/2026): nút "Thêm ảnh/video" mở hộp chọn file, ô văn bản nằm trong
  // pagelet BusinessComposerTextEditor (tải chậm), mục "Nút" là combobox, "Đặt ngày và giờ" là công tắc.
  // Mỗi bước làm riêng, bước nào hỏng thì báo để bạn làm tay; luôn chép sẵn nội dung vào clipboard.
  const composePost = ({ pageId, text, image, when }) => composeQueue(async () => {
    if (!/^\d+$/.test(String(pageId))) return { error: 'Thiếu Page.' };
    const wc = metaView.webContents;
    if (text) clipboard.writeText(String(text));
    showMeta();
    await wc.loadURL(`https://business.facebook.com/latest/composer/?asset_id=${pageId}&context_ref=POSTS&ref=meta_assistant`).catch(() => {});
    const find = spec => wc.executeJavaScript(`(${findTarget})(${JSON.stringify(spec)})`).catch(() => null);
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      await sleep(1000);
      if (isLogin(wc.getURL())) return { error: 'login' };
      ready = !!(await find({ text: /^Thêm ảnh\/video$|^Add photo\/video$/i.source }));
    }
    if (!ready) return { error: 'Không mở được trình soạn bài của Business Suite.' };
    const dbg = wc.debugger, done = { image: !image, text: !text, button: false, schedule: !when };
    const click = async spec => {
      const r = await find(spec); if (!r) return false;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await dbg.sendCommand('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
      return true;
    };
    const waitFor = async (spec, ms = 5000) => { for (let t = 0; t < ms; t += 250) { if (await find(spec)) return true; await sleep(250); } return false; };
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      // 1) Ảnh: bắt hộp chọn file của trình duyệt rồi đưa ảnh thẳng từ bộ nhớ vào ô chọn file (không ghi file ra máy).
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
        if (params?.backendNodeId) {
          const { object } = await dbg.sendCommand('DOM.resolveNode', { backendNodeId: params.backendNodeId });
          const r = await dbg.sendCommand('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
            arguments: [{ value: m[3] }, { value: m[1] }, { value: `bai-viet.${m[2] === 'jpeg' ? 'jpg' : m[2]}` }],
            functionDeclaration: `function (b64, type, name) {
              const bin = atob(b64), bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
              this.files = dt.files;
              this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
              return this.files.length;
            }` });
          done.image = r?.result?.value === 1;
        }
        await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      }
      // 2) Nội dung: chờ ô văn bản thật của bài (không dùng ô mô tả thước phim ẩn).
      if (text && await waitFor({ selector: '[data-pagelet="BusinessComposerTextEditor"] [contenteditable="true"]' }, 15000)) {
        await click({ selector: '[data-pagelet="BusinessComposerTextEditor"] [contenteditable="true"]' });
        await sleep(300);
        await dbg.sendCommand('Input.insertText', { text: String(text) });
        done.text = true;
      }
      // 3) Nút: combobox "Nút" → "Gửi tin nhắn".
      if (await click({ role: 'combobox', label: /^Nút$|^Button$/i.source })) {
        await sleep(600);
        done.button = await click({ role: 'option', text: /gửi tin nhắn|send message/i.source });
      }
      // 4) Hẹn giờ: bật "Đặt ngày và giờ"; ngày giờ cụ thể bạn chọn (ô ngày giờ của Meta khác nhau theo tài khoản).
      if (when && await click({ selector: 'label[for]', text: /^Đặt ngày và giờ$|^Set date and time$/i.source })) done.schedule = 'toggled';
    } catch (e) { notify(`Business Suite: lỗi khi điền sẵn (${e.message}). Làm tay phần còn lại.`); }
    finally { try { dbg.detach(); } catch {} }
    const todo = [!done.image && 'thêm ảnh (Thêm ảnh/video)', !done.text && 'dán nội dung (Ctrl+V, đã chép sẵn)', !done.button && 'chọn Nút › Gửi tin nhắn',
      when && `chọn giờ ${new Date(when * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`].filter(Boolean);
    notify(`Business Suite: ${todo.length ? 'còn ' + todo.join(', ') + ', rồi' : 'đã điền xong,'} bấm ${when ? 'Lên lịch' : 'Đăng'}. Bấm ✕ trên cột để huỷ.`);
    for (let i = 0; i < 900; i++) {
      await sleep(1000);
      if (wc.isDestroyed() || !/\/composer/.test(wc.getURL())) break;
      if (!metaShown()) return { error: 'Đã đóng trình soạn Business Suite, bài chưa được đăng.' }; // bấm ✕ trên cột = huỷ
    }
    return { done: !/\/composer/.test(wc.isDestroyed() ? '' : wc.getURL()), filled: done };
  });

  return { lookupProfile, composePost };
}
module.exports = { createMetaAuto, extractProfile, findTarget };
