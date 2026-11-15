// Zalo cá nhân (không có API): đọc / gửi tin qua Zalo Web chạy trong cột Zalo của app (cùng một trang, ẩn hay hiện đều được).
// Cấu trúc trang lấy từ bản lưu thật 11/2026:
//   danh sách  #conversationList .msg-item[anim-data-id=<id khách | g<id nhóm>>] · tên .conv-item-title__name · tin cuối .z-conv-message__preview-message
//              giờ .preview-time · số chưa đọc .z-noti-badge.--counter (icon fa-<số>_24_Line)
//   hội thoại  #ava_chat_box_view img[data-ava-uid] = khách đang mở · #messageViewScroll: .chat-date (mốc giờ) + [data-component=bubble-message]
//              id="bb_msg_id_<giờ ms>", lớp "me" = tin của bạn · chữ [data-component=text-container] · ảnh img.zimg-el (blob:)
//              .bubble-message-status ("Đã nhận" / "Đã xem") dưới tin cuối của bạn · ô nhập #richInput (contenteditable)
const TAG = '__GA_ZALO__';

// ── Chạy trong trang Zalo ──
function zState() {
  if (document.querySelector('#conversationList')) return 'ready';
  const t = document.body?.innerText || '';
  if (/Đang đăng nhập|Logging in/i.test(t)) return 'loading';
  if (/quét mã|Đăng nhập|QR/i.test(t) && !document.querySelector('#main-tab')) return 'login';
  return 'loading';
}
function zList() {
  const box = document.querySelector('#conversationList');
  if (!box) return null;
  const counter = el => { const b = el.querySelector('.z-noti-badge[class~="--counter"]'); if (!b) return 0;
    const m = ((b.querySelector('i') || {}).className || '').match(/fa-(\d+)(?:_|\b)/); return m ? Number(m[1]) : (parseInt(b.innerText, 10) || 1); };
  return [...box.querySelectorAll('.msg-item[anim-data-id]')].map(el => {
    const id = el.getAttribute('anim-data-id') || '', img = el.querySelector('.conv-item__avatar img');
    const snippet = (el.querySelector('.z-conv-message__preview-message')?.innerText || '').replace(/\s+/g, ' ').trim();
    let unread = counter(el); if (!unread && el.querySelector('.z-conv-message[class~="--unread"]')) unread = 1;
    return { id, name: (el.querySelector('.conv-item-title__name')?.innerText || '').replace(/\s+/g, ' ').trim(), pic: img?.src || '', snippet,
      time: (el.querySelector('.preview-time')?.innerText || '').trim(), unread, group: /^g\d/.test(id), muted: !!el.querySelector('.conv__mute'),
      oa: !!el.querySelector('.zavatar-block, [id^="zic_svg-Verified"]'), y: parseFloat(el.style.top) || 0 };
  }).filter(r => r.id && /^g?\d+$/.test(r.id)).sort((a, b) => a.y - b.y);
}
// Cuộn danh sách (ảo: chỉ dòng đang thấy mới có trong trang) để lấy thêm hội thoại, rồi cuộn về đầu.
async function zListAll(max) {
  const box = document.querySelector('#conversationList'), sc = box?.parentElement;
  if (!box || !sc) return null;
  const seen = new Map(), add = () => { for (const r of window.__gaZList()) if (!seen.has(r.id)) seen.set(r.id, r); };
  window.__gaZList = window.__gaZList || (() => []);
  add();
  for (let i = 0; i < 12 && seen.size < max && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4; i++) {
    sc.scrollTop += Math.max(200, sc.clientHeight * 0.8); await new Promise(r => setTimeout(r, 180)); add();
  }
  sc.scrollTop = 0;
  return [...seen.values()];
}
function zCurrent() { return document.querySelector('#ava_chat_box_view img[data-ava-uid]')?.getAttribute('data-ava-uid') || ''; }
async function zOpen(id) {
  if (zCurrent() === id && document.querySelector('#messageViewScroll')) return true;
  const box = document.querySelector('#conversationList'), sc = box?.parentElement;
  if (!box) return false;
  const find = () => box.querySelector(`.msg-item[anim-data-id="${CSS.escape(id)}"] .conv-item`);
  let el = find();
  if (!el && sc) { sc.scrollTop = 0; for (let i = 0; i < 15 && !el; i++) { await new Promise(r => setTimeout(r, 150)); el = find(); if (!el) sc.scrollTop += sc.clientHeight * 0.8; } }
  if (!el) return false;
  for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); if (zCurrent() === id && document.querySelector('#messageViewScroll [data-component="bubble-message"], #messageViewScroll .chat-date')) return true; }
  return zCurrent() === id;
}
async function zRead(older) {
  const root = document.querySelector('#messageViewScroll');
  if (!root) return null;
  if (older) { const sc = document.querySelector('#messageViewContainer'); if (sc) { sc.scrollTop = 0; await new Promise(r => setTimeout(r, 1500)); } }
  const cache = window.__gaPics || (window.__gaPics = new Map());
  // Ảnh trong Zalo là blob: (chỉ dùng được trong trang Zalo) → đổi sang ảnh nhỏ data URL để Hộp thư hiện được.
  const toData = img => {
    const src = img.currentSrc || img.src; if (!src) return '';
    if (cache.has(src)) return cache.get(src);
    if (!img.complete || !img.naturalWidth) return /^https:/.test(src) ? src : '';
    try { const k = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL('image/jpeg', 0.82); cache.set(src, d); return d; } catch { return /^https:/.test(src) ? src : ''; }
  };
  const out = [];
  for (const el of root.querySelectorAll('.chat-date, [data-component="bubble-message"]')) {
    if (el.classList.contains('chat-date')) { const t = el.innerText.replace(/\s+/g, ' ').trim(); if (t) out.push({ sep: t }); continue; }
    const mine = el.classList.contains('me'), ts = Number((el.id.match(/bb_msg_id_(\d+)/) || [])[1]) || 0;
    let text = (el.querySelector('[data-component="text-container"]')?.textContent || '').trim(); // textContent: giữ xuống dòng của tin
    const img = [...el.querySelectorAll('img.zimg-el')].find(i => !i.closest('.link-message'));
    const m = { mine, text, ts };
    if (img) { const d = toData(img); if (d) m.pic = d; }
    if (!m.text && !m.pic) {
      if (el.querySelector('z-instant')) m.text = '[Tin nhắn mẫu Zalo]';
      else if (el.querySelector('[class*="sticker" i]')) m.text = '[Sticker]';
      else if (el.querySelector('[class*="file" i]')) m.text = '[Tệp] ' + (el.innerText.split('\n').find(s => s.trim()) || '').trim();
      else if (img) m.text = '[Ảnh]';
      else { const t = el.innerText.split('\n').map(s => s.trim()).filter(s => s && !/^\d{1,2}:\d{2}$/.test(s)).slice(0, 2).join(' '); m.text = t || '[Tin nhắn]'; }
    }
    out.push(m);
  }
  const st = [...root.querySelectorAll('.bubble-message-status')].pop()?.innerText.trim() || '';
  return { messages: out, domRc: /đã xem|seen/i.test(st) ? 'seen' : /đã nhận|received|delivered/i.test(st) ? 'dlv' : /đã gửi|sent/i.test(st) ? 'sent' : '' };
}
// Đặt chữ vào ô nhập (dán như người dùng → giữ xuống dòng); trả số ký tự ô nhập có.
function zPutText(text) {
  const ed = document.querySelector('#richInput'); if (!ed) return -1;
  ed.focus();
  const sel = window.getSelection(); sel.selectAllChildren(ed); document.execCommand('delete');
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  if (!(ed.innerText || '').trim()) document.execCommand('insertText', false, text);
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  return (ed.innerText || '').trim().length;
}
// Thả ảnh vào khung tin ("Gửi nhanh" của Zalo Web: thả là gửi luôn).
async function zDropImage(b64, type, name) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
  const view = document.querySelector('#messageView'); if (!view) return false;
  const fire = (el, t) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
  fire(view, 'dragenter'); fire(view, 'dragover');
  await new Promise(r => setTimeout(r, 250));
  const zone = document.querySelector('#dragOverlayMessageView') || view;
  fire(zone, 'dragenter'); fire(zone, 'dragover'); fire(zone, 'drop');
  return true;
}
function zClickSend() {
  const box = document.querySelector('#chat-input-right-layout-id, #chatInput') || document;
  const b = [...box.querySelectorAll('[icon], [title], [data-id]')].find(e => /send/i.test(e.getAttribute('icon') || '') || /^gửi$|^send$/i.test(e.getAttribute('title') || '') || /SendMsg/i.test(e.getAttribute('data-id') || ''));
  if (!b) return false; for (const t of ['mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); return true;
}
function zMineCount() { const all = [...document.querySelectorAll('#messageViewScroll [data-component="bubble-message"].me')]; return { n: all.length, pics: all.filter(e => e.querySelector('img.zimg-el')).length, last: (all.pop()?.innerText || '').replace(/\s+/g, ' ').trim() }; }
// Báo app khi danh sách / hội thoại đang mở đổi (tin mới tới) qua console → main nghe 'console-message'.
function zWatch(tag) {
  if (window.__gaZW) return true; window.__gaZW = 1;
  let tl = 0, tt = 0;
  new MutationObserver(recs => {
    let list = false, thread = false;
    for (const r of recs) { const n = r.target.nodeType === 1 ? r.target : r.target.parentElement; if (!n) continue;
      if (!list && n.closest('#conversationList')) list = true; else if (!thread && n.closest('#messageViewScroll')) thread = true; if (list && thread) break; }
    if (list) { clearTimeout(tl); tl = setTimeout(() => console.log(tag + 'list'), 350); }
    if (thread) { clearTimeout(tt); tt = setTimeout(() => console.log(tag + 'thread'), 350); }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
  return true;
}

function createZaloAuto({ wc, sendKey, onList = () => {}, onThread = () => {}, log = () => {} }) {
  const run = (fn, ...args) => wc().executeJavaScript(`(${fn})(${args.map(a => JSON.stringify(a)).join(',')})`, true);
  let chain = Promise.resolve();
  const queue = job => { const p = chain.then(job, job); chain = p.catch(() => {}); return p; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ready = async () => {
    const w = wc(); if (!w || w.isDestroyed()) return 'closed';
    if (!w.getURL().startsWith('https://chat.zalo.me')) return 'closed';
    const s = await run(zState).catch(() => 'loading');
    if (s === 'ready') await run(zWatch, TAG).catch(() => {});
    return s;
  };
  const err = s => ({ error: s === 'login' || s === 'closed' ? 'login' : 'Zalo Web đang tải, thử lại sau vài giây.' });
  let lastList = [];
  const list = ({ deep = false } = {}) => queue(async () => {
    const s = await ready(); if (s !== 'ready') return err(s);
    await run(`() => { window.__gaZList = ${zList}; }`).catch(() => {});
    const rows = deep ? await run(zListAll, 60).catch(() => null) : await run(zList).catch(() => null);
    if (!rows) return { error: 'Không đọc được danh sách Zalo.' };
    if (!deep) { const m = new Map(lastList.map(r => [r.id, r])); for (const r of rows) m.set(r.id, r); lastList = [...m.values()]; } else lastList = rows;
    return { rows: lastList.map(({ y, ...r }) => r) };
  });
  const open = async uid => { const s = await ready(); if (s !== 'ready') return err(s); return (await run(zOpen, String(uid)).catch(() => false)) ? null : { error: 'Không mở được hội thoại Zalo này (thử kéo danh sách Zalo cho hiện khách).' }; };
  const read = args => queue(async () => {
    const e = await open(args.uid); if (e) return e;
    return await run(zRead, !!args.older).catch(x => null) || { error: 'Không đọc được tin Zalo.' };
  });
  const send = args => queue(async () => {
    const e = await open(args.uid); if (e) return e;
    const text = String(args.text || '').trim(), image = String(args.image || '');
    const before = await run(zMineCount).catch(() => ({ n: 0, pics: 0 }));
    if (text) {
      if ((await run(zPutText, text).catch(() => -1)) <= 0) return { error: 'Không nhập được chữ vào ô chat Zalo.' };
      await sleep(120); sendKey('Enter');
      let ok = false; for (let i = 0; i < 40 && !ok; i++) { await sleep(150); const c = await run(zMineCount).catch(() => before); ok = c.n > before.n;
        if (!ok && i === 14) await run(zClickSend).catch(() => {}); } // Enter không ăn: bấm nút Gửi
      if (!ok) return { error: 'Đã bấm gửi nhưng chưa thấy tin trong Zalo. Kiểm tra cột Zalo trước khi gửi lại.' };
    }
    if (image) {
      const m = image.match(/^data:(image\/(\w+));base64,(.+)$/); if (!m) return { error: text ? 'Chữ đã gửi, ảnh không đọc được.' : 'Ảnh không đọc được.' };
      const b0 = await run(zMineCount).catch(() => before);
      await run(zDropImage, m[3], m[1], 'anh.' + (m[2] === 'jpeg' ? 'jpg' : m[2])).catch(() => false);
      let ok = false; for (let i = 0; i < 100 && !ok; i++) { await sleep(150); const c = await run(zMineCount).catch(() => b0); ok = c.pics > b0.pics || c.n > b0.n; }
      if (!ok) return { error: text ? 'Chữ đã gửi, ảnh chưa gửi được qua Zalo.' : 'Ảnh chưa gửi được qua Zalo.' };
    }
    await sleep(300);
    return { ok: true, ...(await run(zRead, false).catch(() => null) || {}) };
  });
  const current = () => run(zCurrent).catch(() => '');
  // Tin mới: danh sách đổi → đọc lại danh sách; hội thoại đang mở đổi → báo Hộp thư đọc lại.
  let busyList = false, againList = false;
  const onConsole = async msg => {
    if (!String(msg || '').startsWith(TAG)) return;
    if (msg === TAG + 'list') {
      if (busyList) { againList = true; return; } busyList = true;
      try { const r = await list(); if (r.rows) onList(r.rows); } catch {} finally { busyList = false; if (againList) { againList = false; onConsole(TAG + 'list'); } }
    } else if (msg === TAG + 'thread') { const id = await current(); if (id) onThread(id); }
  };
  return { list, read, send, onConsole, ready };
}

module.exports = { createZaloAuto, _page: { zState, zList, zListAll, zCurrent, zOpen, zRead, zPutText, zDropImage, zClickSend, zMineCount, zWatch } };
