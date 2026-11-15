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
  if ((/quét mã|qr code|đăng nhập bằng|với mã qr/i.test(t) || document.querySelector('.qrcode, [class*="qr-code" i], img[src*="qr" i]')) && !document.querySelector('#main-tab')) return 'login';
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
      oa: !!el.querySelector('[id^="zic_svg-Verified"], [style*="Verified_24"]'), y: parseFloat(el.style.top) || 0 }; // chỉ tài khoản có dấu tích xanh (Zalo OA)
  }).filter(r => r.id && /^g?\d+$/.test(r.id)).sort((a, b) => a.y - b.y);
}
// Cuộn danh sách (ảo: chỉ dòng đang thấy mới có trong trang) để lấy thêm hội thoại, rồi cuộn về đầu.
async function zListAll(max) {
  const box = document.querySelector('#conversationList'), sc = box?.parentElement;
  if (!box || !sc) return null;
  const seen = new Map(), add = () => { for (const r of window.__gaZList()) if (!seen.has(r.id)) seen.set(r.id, r); };
  window.__gaZList = window.__gaZList || (() => []);
  add();
  for (let i = 0; i < 8 && seen.size < max && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4; i++) {
    sc.scrollTop += Math.max(200, sc.clientHeight * 0.7); await new Promise(r => setTimeout(r, 250)); add();
  }
  await new Promise(r => setTimeout(r, 250)); add();
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
    const m = { mine, text, ts, mid: ts ? 'z' + ts : '' };
    if (img) { const d = toData(img); if (d) m.pic = d; }
    const re = zReacts(el); if (re.length) m.re = re;
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
// Cảm xúc đang hiện trên tin (ngoài nút thả và bảng chọn): mã Zalo → emoji.
const Z_EMO = { '/-strong': '👍', '/-heart': '❤️', ':>': '😆', ':o': '😮', ':-((': '😢', ':-h': '😡' };
function zReacts(el) {
  const out = [], box = el.querySelector('.message-reaction-container'); if (!box) return out;
  for (const n of box.querySelectorAll('.emoji-sizer, img')) {
    if (n.closest('.emoji-list-wrapper') || n.classList.contains('default-react-icon-thumb')) continue;
    const t = (n.textContent || n.getAttribute('alt') || '').trim(), e = Z_EMO[t] || (/\p{Extended_Pictographic}/u.test(t) ? t : '');
    if (e && !out.some(x => x.e === e)) out.push({ e, mine: false });
  }
  return out;
}
// Thả cảm xúc: rê vào nút thả của tin (giờ ts) rồi bấm biểu tượng thứ i trong bảng 6 cảm xúc của Zalo.
async function zReact(ts, i) {
  const el = document.getElementById('bb_msg_id_' + ts); if (!el) return 'Không thấy tin này trong cột Zalo.';
  el.scrollIntoView({ block: 'center' });
  const btn = el.querySelector('[id^="reaction-btn-"]'); if (!btn) return 'Tin này không thả cảm xúc được.';
  const hover = n => { for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
  hover(el); hover(btn); await new Promise(r => setTimeout(r, 350));
  const icon = btn.querySelectorAll('.reaction-emoji-icon')[i] || el.querySelectorAll('.reaction-emoji-icon')[i];
  if (!icon) return 'Không mở được bảng cảm xúc của Zalo.';
  const target = icon.querySelector('.emoji-sizer') || icon;
  hover(icon); for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
  return 'ok';
}
// Bấm "Trả lời" cho tin (giờ ts): rê vào tin tìm nút Trả lời, không có thì mở menu chuột phải. Trả true khi ô nhập hiện khung trích dẫn.
async function zReplyTo(ts) {
  const el = document.getElementById('bb_msg_id_' + ts); if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const fire = (n, ts2) => { for (const t of ts2) n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: t === 'contextmenu' ? 2 : 0 })); };
  const quoted = () => !!(document.querySelector('.chat-box-input__heading')?.innerText || '').trim();
  const find = () => [...document.querySelectorAll('[title], [data-translate-title], [data-id], [icon], li, [role="menuitem"]')].find(n => {
    const v = [n.getAttribute('title'), n.getAttribute('data-translate-title'), n.getAttribute('data-id'), n.getAttribute('icon'), n.matches('li, [role="menuitem"]') ? n.innerText : ''].join(' ');
    return /(^|\s)(Trả lời|Reply)(\s|$)|STR_REPLY|_Reply|Reply_/i.test(v) && n.getBoundingClientRect().width > 0; });
  fire(el.querySelector('.message-frame, .message-non-frame') || el, ['pointerover', 'mouseover', 'mouseenter', 'mousemove']); await new Promise(r => setTimeout(r, 300));
  let b = find();
  if (!b) { fire(el.querySelector('.message-frame, .message-non-frame') || el, ['contextmenu']); await new Promise(r => setTimeout(r, 300)); b = find(); }
  if (!b) return false;
  fire(b, ['mousedown', 'mouseup', 'click']);
  for (let i = 0; i < 15 && !quoted(); i++) await new Promise(r => setTimeout(r, 100));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // đóng menu chuột phải (nếu còn)
  return quoted();
}
// Đặt chữ vào ô nhập (dán như người dùng → giữ xuống dòng); trả số ký tự ô nhập có.
async function zPutText(text) {
  const ed = document.querySelector('#richInput'); if (!ed) return -1;
  ed.focus();
  const sel = window.getSelection(); sel.selectAllChildren(ed); document.execCommand('delete');
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 200)); // ô nhập Zalo xử lý dán chậm một nhịp
  if (!(ed.innerText || '').trim()) { document.execCommand('insertText', false, text); await new Promise(r => setTimeout(r, 100)); }
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  return (ed.innerText || '').trim().length;
}
// Đặt con trỏ vào ô nhập (rỗng) để app gõ chữ thật (webContents.insertText) khi dán không ăn.
function zFocusInput() { const ed = document.querySelector('#richInput'); if (!ed) return false; ed.focus(); const sel = window.getSelection(); sel.selectAllChildren(ed); document.execCommand('delete');
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); return document.activeElement === ed; }
function zInputDiag() { const ed = document.querySelector('#richInput'), a = document.activeElement;
  return `ô nhập: ${ed ? 'có' : 'KHÔNG CÓ'}${ed ? ` (${ed.getAttribute('contenteditable')}, ${Math.round(ed.getBoundingClientRect().width)}px)` : ''} · đang chọn: ${a ? (a.id || a.tagName) : '-'} · trang có tiêu điểm: ${document.hasFocus() ? 'có' : 'không'} · khách đang mở: ${document.querySelector('#ava_chat_box_view img[data-ava-uid]')?.getAttribute('data-ava-uid') || '-'} · ô chat khác: ${[...document.querySelectorAll('[contenteditable="true"]')].map(e => e.id || e.className.slice(0, 20)).join(',') || '-'}`; }
function zInputLen() { return (document.querySelector('#richInput')?.innerText || '').trim().length; }
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

function createZaloAuto({ wc, sendKey, typeText = null, beginInput = async () => {}, endInput = () => {}, onList = () => {}, onThread = () => {}, log = () => {} }) {
  // Trạng thái để chẩn đoán (thanh trạng thái + Downloads/GetHelps-debug/zalo.json).
  const stat = { state: 'closed', url: '', rows: 0, kept: 0, err: '', listAt: 0, events: 0, watch: false };
  // Hàm chạy trong trang kèm hàm phụ (zReacts dùng trong zRead).
  const PRELUDE = `const Z_EMO = ${JSON.stringify(Z_EMO)}; ${zReacts}; ${zCurrent};`;
  const run = (fn, ...args) => wc().executeJavaScript(`(() => { ${PRELUDE} return (${fn})(${args.map(a => JSON.stringify(a)).join(',')}); })()`, true);
  let chain = Promise.resolve();
  const queue = job => { const p = chain.then(job, job); chain = p.catch(() => {}); return p; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ready = async () => {
    const w = wc(); if (!w || w.isDestroyed()) return 'closed';
    if (!w.getURL().startsWith('https://chat.zalo.me')) return 'closed';
    stat.url = w.getURL().slice(0, 60);
    const s = await run(zState).catch(e => { stat.err = 'zState: ' + e.message; return 'loading'; });
    stat.state = s;
    if (s === 'ready') stat.watch = !!(await run(zWatch, TAG).catch(e => { stat.err = 'zWatch: ' + e.message; return false; }));
    return s;
  };
  const err = s => ({ error: s === 'login' || s === 'closed' ? 'login' : 'Zalo Web đang tải, thử lại sau vài giây.' });
  let lastList = [];
  const list = ({ deep = false } = {}) => queue(async () => {
    const s = await ready(); if (s !== 'ready') return err(s);
    await run(`() => { window.__gaZList = ${zList}; }`).catch(() => {});
    const rows = deep ? await run(zListAll, 20).catch(e => { stat.err = 'zListAll: ' + e.message; return null; }) : await run(zList).catch(e => { stat.err = 'zList: ' + e.message; return null; });
    if (!rows) return { error: 'Không đọc được danh sách Zalo.' };
    stat.rows = rows.length; stat.listAt = Date.now(); stat.err = '';
    stat.sample = rows.slice(0, 40).map(r => `${r.name.slice(0, 14)}${r.group ? ' [nhóm]' : ''}${r.oa ? ' [OA]' : ''}`);
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
    // Zalo chỉ nhận chữ khi trang thật sự được chọn: hiện cột Zalo trong lúc gửi (vài giây) rồi trả lại như cũ.
    await beginInput(); try { return await send0(args); } finally { endInput(); }
  });
  const send0 = async args => {
    const text = String(args.text || '').trim(), image = String(args.image || '');
    const before = await run(zMineCount).catch(() => ({ n: 0, pics: 0 }));
    let replyWarn = '';
    if (text && /^z\d+$/.test(args.replyTo || '')) { if (!(await run(zReplyTo, Number(args.replyTo.slice(1))).catch(() => false))) replyWarn = 'Không bấm được "Trả lời" trên Zalo: tin đã gửi dạng thường.'; }
    if (text) {
      let len = await run(zPutText, text).catch(() => -1);
      // Dán không ăn (trang Zalo ẩn không có tiêu điểm…): gõ chữ thật vào ô nhập như bàn phím.
      for (const mode of ['paste', 'type']) { if (len > 0 || !typeText) break;
        if (!(await run(zFocusInput).catch(() => false))) break;
        await typeText(text, mode); await sleep(300); len = await run(zInputLen).catch(() => 0); stat.lastInput = mode + ':' + len; }
      if (len <= 0) { const dg = await run(zInputDiag).catch(e => 'lỗi đọc: ' + e.message); stat.lastSendDiag = dg;
        return { error: 'Không nhập được chữ vào ô chat Zalo · ' + dg }; }
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
    return { ok: true, ...(replyWarn ? { warn: replyWarn } : {}), ...(await run(zRead, false).catch(() => null) || {}) };
  };
  const EMO = ['👍', '❤️', '😆', '😮', '😢', '😡'];
  const react = args => queue(async () => {
    const e = await open(args.uid); if (e) return e;
    const i = EMO.indexOf(String(args.emoji || '')), ts = Number(String(args.mid || '').slice(1));
    if (i < 0) return { error: 'Zalo chỉ có 6 cảm xúc: ' + EMO.join(' ') + ' (bỏ cảm xúc thì bấm trong cột Zalo).' };
    if (!ts) return { error: 'Không xác định được tin.' };
    const r = await run(zReact, ts, i).catch(x => 'lỗi: ' + x.message);
    if (r !== 'ok') return { error: r };
    await sleep(600);
    const got = await run(zRead, false).catch(() => null) || {};
    // Zalo chưa kịp hiện cảm xúc trên tin: vẫn ghi nhận để Hộp thư hiện ngay.
    const m = (got.messages || []).find(x => x.mid === args.mid); if (m && !(m.re || []).some(x => x.e === args.emoji)) m.re = [...(m.re || []), { e: args.emoji, mine: true }];
    return { ok: true, ...got };
  });
  const current = () => run(zCurrent).catch(() => '');
  // Tin mới: danh sách đổi → đọc lại danh sách; hội thoại đang mở đổi → báo Hộp thư đọc lại.
  let busyList = false, againList = false;
  const onConsole = async msg => {
    if (!String(msg || '').startsWith(TAG)) return;
    stat.events++;
    if (msg === TAG + 'list') {
      if (busyList) { againList = true; return; } busyList = true;
      try { const r = await list(); if (r.rows) onList(r.rows); } catch {} finally { busyList = false; if (againList) { againList = false; onConsole(TAG + 'list'); } }
    } else if (msg === TAG + 'thread') { const id = await current(); if (id) onThread(id); }
  };
  return { list, read, send, react, onConsole, ready, status: () => ({ ...stat }) };
}

module.exports = { createZaloAuto, _page: { zInputDiag, zFocusInput, zInputLen, zReacts, zReact, zReplyTo, zState, zList, zListAll, zCurrent, zOpen, zRead, zPutText, zDropImage, zClickSend, zMineCount, zWatch } };
