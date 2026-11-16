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
  // Phần mềm bảo mật / tường lửa công ty chặn Zalo (vd Kaspersky "Block Access Zalo"): trang chặn thay cho Zalo Web.
  if (/Kaspersky|ESET|Fortinet|FortiGuard|Sophos|Bitdefender|Symantec|web page has been blocked|cannot be provided|trang web (đã )?bị chặn|bị chặn bởi/i.test((document.title || '') + ' ' + (document.body?.innerText || '').slice(0, 600))) return 'blocked';
  const t = document.body?.innerText || '';
  if (/Đang đăng nhập|Logging in/i.test(t)) return 'loading';
  if ((/quét mã|qr code|đăng nhập bằng|với mã qr/i.test(t) || document.querySelector('.qrcode, [class*="qr-code" i], img[src*="qr" i]')) && !document.querySelector('#main-tab')) return 'login';
  return 'loading';
}
// Zalo Web chưa vào được danh sách: tóm tắt màn hình đang hiện (để chẩn đoán) và tự bấm nút "Dùng tại đây / Dùng Zalo ở cửa sổ này" nếu có
// (Zalo chỉ cho 1 cửa sổ web hoạt động; khung ngầm bị đẩy ra khi bạn mở Zalo Web ở nơi khác).
function zDiag() {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const btn = [...document.querySelectorAll('button, [role=button], .btn, a')].find(b => /dùng tại đây|dùng ở đây|sử dụng tại đây|use here|kích hoạt|dùng zalo (ở|trên) (cửa sổ|trình duyệt) này|tiếp tục sử dụng/i.test(b.innerText || ''));
  if (btn) btn.click();
  return { title: document.title.slice(0, 60), text: t.slice(0, 240), clicked: btn ? (btn.innerText || '').trim().slice(0, 40) : '', els: document.querySelectorAll('*').length };
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
    // Thẻ link (khách chia sẻ bài Facebook / TikTok…): lấy link của thẻ.
    const la = el.querySelector('.link-message a[href^="http"], [class*="link-message"] a[href^="http"]'); if (la && !text.includes(la.href)) m.share = la.href;
    if (img) { const d = toData(img); if (d) m.pic = d; }
    const re = zReacts(el); if (re.length) m.re = re;
    if (!m.text && !m.pic && !m.share) {
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
// ── Nhập chữ vào ô chat khi Zalo chạy ngầm ──
// Trang ngầm không có tiêu điểm: Chrome không bắn sự kiện focus, document.hasFocus() = false → ô nhập của Zalo bỏ qua chữ.
// zPrepInput(true): giả lập "đang được chọn" ở mức trang (hasFocus, visibilityState, sự kiện focus) trong lúc gửi; (false): trả về trạng thái nghỉ
// (ép hasFocus = false để Zalo không tự báo "đã xem" các tin tới sau). Trả toạ độ ô nhập để app bấm chuột thật.
function zPrepInput(on) {
  const D = Document.prototype;
  if (!window.__gaFocusPatched) { window.__gaFocusPatched = 1;
    const orig = D.hasFocus; window.__gaHasFocus = () => orig.call(document);
    D.hasFocus = function () { return window.__gaFocus === true ? true : window.__gaFocus === false ? false : orig.call(this); };
    for (const [k, v] of [['visibilityState', 'visible'], ['hidden', false]]) { const d = Object.getOwnPropertyDescriptor(D, k);
      if (d && d.get) Object.defineProperty(document, k, { configurable: true, get() { return window.__gaFocus === true ? v : d.get.call(document); } }); }
  }
  const ed = document.querySelector('#richInput');
  if (!on) { window.__gaFocus = false;
    try { if (ed) { ed.dispatchEvent(new FocusEvent('blur')); ed.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } window.dispatchEvent(new Event('blur')); } catch (e) {}
    return true; }
  window.__gaFocus = true;
  if (!ed) return null;
  try { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
  ed.scrollIntoView({ block: 'nearest' });
  const r = ed.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(r.width / 2, 80)), y: Math.round(r.top + r.height / 2) };
}
// Đặt con trỏ vào CUỐI DÒNG CUỐI của ô nhập (bên trong <div id="input_line_N">, không phải ngay trong #richInput:
// chữ nằm ngoài dòng sẽ bị Zalo xoá khi nó dựng lại ô nhập) + báo Zalo ô nhập vừa được chọn.
function zCaret() {
  const ed = document.querySelector('#richInput'); if (!ed) return 'no-ed';
  ed.focus();
  try { ed.dispatchEvent(new FocusEvent('focus')); ed.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); } catch (e) {}
  const lines = ed.querySelectorAll(':scope > div'), line = lines[lines.length - 1] || ed;
  const sel = getSelection(), r = document.createRange(); r.selectNodeContents(line);
  if (line.lastChild && line.lastChild.nodeName === 'BR') r.setEndBefore(line.lastChild);
  r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  return line === ed ? 'ed' : (line.id || 'div');
}
// Trạng thái ô nhập (để kiểm tra từng cách nhập + ghi chẩn đoán).
function zEdState() {
  const ed = document.querySelector('#richInput'); if (!ed) return null;
  const an = getSelection().anchorNode, host = an ? (an.nodeType === 1 ? an : an.parentElement) : null;
  const text = ed.innerText || '';
  return { text, len: text.replace(/\s+/g, '').length, lines: ed.querySelectorAll(':scope > div').length, kids: ed.childNodes.length,
    caret: host ? (host.id || String(host.className || '').slice(0, 24) || host.tagName) : '-', inEd: !!(host && ed.contains(host)),
    active: (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) || '-',
    focus: window.__gaHasFocus ? window.__gaHasFocus() : document.hasFocus(), vis: document.visibilityState, cls: ed.className };
}
// Cách "dán": sự kiện paste kèm chữ (Zalo tự chia dòng như khi bạn Ctrl+V).
function zInsPaste(text) {
  const ed = document.querySelector('#richInput'); if (!ed) return 'no-ed';
  const an = getSelection().anchorNode, host = an ? (an.nodeType === 1 ? an : an.parentElement) : null, target = host && ed.contains(host) ? host : ed;
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  target.dispatchEvent(ev); return ev.defaultPrevented ? 'zalo-nhận' : 'mặc-định';
}
// Cách "lệnh soạn thảo": chèn chữ tại con trỏ (xuống dòng do trình duyệt tự tách đoạn).
function zInsExec(text) { return document.execCommand('insertText', false, text) ? 'ok' : 'từ-chối'; }
// Cách "ghi thẳng": dựng lại các dòng của ô nhập rồi báo Zalo nội dung đã đổi.
function zInsDom(text) {
  const ed = document.querySelector('#richInput'); if (!ed) return 'no-ed';
  ed.replaceChildren(...String(text).split('\n').map((l, i) => { const d = document.createElement('div'); d.id = 'input_line_' + i; if (l) d.textContent = l; else d.append(document.createElement('br')); return d; }));
  ed.classList.remove('empty');
  const last = ed.lastElementChild, sel = getSelection(), r = document.createRange(); r.selectNodeContents(last); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return 'ok';
}
// Dọn ô nhập về 1 dòng trống (khi phím Ctrl+A / Backspace thật không dọn được).
function zEdReset() {
  const ed = document.querySelector('#richInput'); if (!ed) return false;
  const d = document.createElement('div'); d.id = 'input_line_0'; d.append(document.createElement('br')); ed.replaceChildren(d);
  ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); return true;
}
// Enter giả (khi phím Enter thật không tới được trang).
function zEnterJs() {
  const ed = document.querySelector('#richInput'); if (!ed) return false;
  for (const t of ['keydown', 'keypress', 'keyup']) ed.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: t === 'keypress' ? 13 : 0, bubbles: true, cancelable: true, composed: true }));
  return true;
}
// Toạ độ nút Gửi (hiện thay nút 👍 khi ô nhập có chữ).
function zSendBtn() {
  const box = document.querySelector('#chat-input-right-layout-id, #chat-input-container-id, #chatInput') || document;
  const shown = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  let b = [...box.querySelectorAll('[data-translate-title="STR_SEND"], [data-translate-inner="STR_SEND"], [icon*="Sent" i], [icon*="Send" i], [title="Gửi"], [title="Send"], [data-id*="SendMsg" i], [class*="send-msg" i], [class*="send-btn" i]')].find(shown);
  if (!b) { const g = [...document.querySelectorAll('#normal-buttons-group-id .z--btn--v2')].filter(shown), last = g[g.length - 1];
    if (last && !/STR_TOOLTIP_EMOJI|STR_EMOTICON_TT/.test(last.getAttribute('data-translate-title') || '') && g.length) b = last; }
  if (!b) return null;
  const r = b.getBoundingClientRect(); b.setAttribute('data-ga-send', '1');
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), what: (b.getAttribute('icon') || b.getAttribute('title') || b.className || '').slice(0, 40) };
}
// Dán ảnh (file) vào ô nhập: Zalo hiện ảnh chờ gửi, bấm Enter để gửi.
function zPasteImage(b64, type, name) {
  const ed = document.querySelector('#richInput'); if (!ed) return false;
  const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); ed.dispatchEvent(ev); return ev.defaultPrevented;
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
function zMineCount() { const all = [...document.querySelectorAll('#messageViewScroll [data-component="bubble-message"].me')]; const last = all[all.length - 1];
  return { n: all.length, pics: all.filter(e => e.querySelector('img.zimg-el')).length, lastId: last ? last.id : '', last: ((last && last.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 60) }; }
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

function createZaloAuto({ wc, cdp = null, beginInput = async () => {}, endInput = () => {}, onList = () => {}, onThread = () => {}, log = () => {} }) {
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
    if (s !== 'ready') { const d = await run(zDiag).catch(e => ({ err: e.message }));
      stat.screen = d; if (!stat.since) stat.since = Date.now();
      // Kẹt "đang tải" quá 2 phút (không phải đang đăng nhập, không có nút để bấm) → tải lại khung ngầm 1 lần / 5 phút.
      if (s === 'loading' && !d?.clicked && !/đang đăng nhập|logging in/i.test(d?.text || '') && Date.now() - stat.since > 120e3 && Date.now() - (stat.reloadAt || 0) > 300e3) {
        stat.reloadAt = Date.now(); stat.reloads = (stat.reloads || 0) + 1; stat.since = 0; try { w.reload(); } catch {} }
    } else { stat.since = 0; stat.screen = null; }
    if (s === 'ready') stat.watch = !!(await run(zWatch, TAG).catch(e => { stat.err = 'zWatch: ' + e.message; return false; }));
    return s;
  };
  const err = s => ({ error: s === 'login' || s === 'closed' ? 'login' : s === 'blocked' ? 'Zalo Web đang bị phần mềm bảo mật / mạng công ty chặn (chat.zalo.me). Nhờ quản trị mạng mở chặn hoặc dùng mạng khác.' : 'Zalo Web đang tải, thử lại sau vài giây.' });
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
    try { await beginInput(); } catch (x) { return { error: x.message }; } // vd đang mở cột Zalo
    const e = await open(args.uid); if (e) return e;
    try { return await send0(args); } finally { endInput(); }
  });
  // ── Gửi tin trong khung ngầm ──
  // Mỗi bước đều kiểm tra lại ô nhập; cách nào không ăn thì thử cách kế. Toàn bộ các bước ghi vào Downloads/GetHelps-debug/zalo-gui.json.
  const send0 = async args => {
    const text = String(args.text || '').trim(), image = String(args.image || ''), t0 = Date.now(), steps = [];
    const note = (s, x = {}) => steps.push({ s, ms: Date.now() - t0, ...x });
    const finish = r => { try { log({ at: new Date().toISOString(), chu: text.length, dong: text ? text.split('\n').length : 0, anh: !!image, ketqua: r.error ? 'lỗi: ' + String(r.error).slice(0, 120) : 'ok', steps }); } catch {} return r; };
    // Lệnh trình duyệt (chuột / phím / chèn chữ thật). Lỗi không dừng việc gửi, chỉ ghi lại để thử cách khác.
    const C = async (method, params) => { if (!cdp) return 'không có cdp'; try { await cdp(method, params); return ''; } catch (e) { note('cdp-lỗi', { method, err: String(e.message || e).slice(0, 100) }); return e.message || 'lỗi'; } };
    const click = async p => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await C('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
    const KEYS = { Enter: [13, 'Enter', '\r'], Backspace: [8, 'Backspace', ''], a: [65, 'KeyA', ''] };
    const key = async (k, modifiers = 0) => { const [vk, code, ch] = KEYS[k], base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
      await C('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (ch && !modifiers) await C('Input.dispatchKeyEvent', { type: 'char', ...base, text: ch, unmodifiedText: ch });
      await C('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); };
    const st = async () => (await run(zEdState).catch(e => ({ err: String(e.message).slice(0, 80) }))) || { err: 'không thấy ô nhập' };
    const brief = r => r.err ? { err: r.err } : { len: r.len, lines: r.lines, kids: r.kids, caret: r.caret, inEd: r.inEd, active: r.active, focus: r.focus, vis: r.vis };
    const nn = t => String(t || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(), want = nn(text);
    const good = r => !!r && !r.err && (want ? (nn(r.text) === want || (nn(r.text).length >= want.length * 0.9 && nn(r.text).length <= want.length * 1.15 && nn(r.text).includes(want.slice(0, Math.min(24, want.length))))) : r.len > 0);
    const mine = () => run(zMineCount).catch(() => null);
    const before = await mine() || { n: 0, pics: 0, lastId: '' };
    const sentSince = async (b, ms, pic = false) => { for (let i = 0; i < ms / 150; i++) { await sleep(150); const c = await mine(); if (c && (pic ? c.pics > b.pics || c.n > b.n : c.n > b.n || (c.lastId && c.lastId !== b.lastId))) return true; } return false; };
    const clearEd = async () => { await key('a', 2); await key('Backspace'); await sleep(120); let r = await st();
      if (r.len > 0) { await run(zEdReset).catch(() => {}); await sleep(120); r = await st(); } note('dọn', brief(r)); return r; };
    try {
      // Chuẩn bị: báo trang "đang được chọn", bấm chuột thật vào ô nhập (như khung Business Suite).
      const pos = await run(zPrepInput, true).catch(e => { note('prep-lỗi', { err: String(e.message).slice(0, 80) }); return null; });
      await C('Emulation.setFocusEmulationEnabled', { enabled: true }); await C('Page.setWebLifecycleState', { state: 'active' });
      let replyWarn = '';
      if (text && /^z\d+$/.test(args.replyTo || '')) { if (!(await run(zReplyTo, Number(args.replyTo.slice(1))).catch(() => false))) replyWarn = 'Không bấm được "Trả lời" trên Zalo: tin đã gửi dạng thường.'; }
      if (text) {
        if (!pos) return finish({ error: 'Không thấy ô chat của Zalo trong khung ngầm (khách này có thể không nhắn được).' });
        await click(pos); await sleep(150);
        let r = await st(); note('bấm-ô-nhập', brief(r));
        if (!r.err && !r.inEd) { note('đặt-con-trỏ', { at: await run(zCaret).catch(() => 'lỗi') }); r = await st(); }
        if (r.len > 0) r = await clearEd(); // chữ sót từ lần trước
        const lines = text.split('\n');
        const ways = [
          ['gõ-thật', async () => { for (const [i, line] of lines.entries()) { if (i) await key('Enter', 8); if (line) await C('Input.insertText', { text: line }); } }],
          ['dán', async () => { await run(zCaret); note('dán-kq', { kq: await run(zInsPaste, text) }); }],
          ['lệnh-soạn-thảo', async () => { await run(zCaret); note('lệnh-kq', { kq: await run(zInsExec, text) }); }],
          ['ghi-thẳng', async () => { await run(zInsDom, text); }]];
        let how = '';
        for (const [name, fn] of ways) {
          try { await fn(); } catch (e) { note(name + '-lỗi', { err: String(e.message).slice(0, 80) }); }
          await sleep(280); r = await st(); note(name, { ...brief(r), ok: good(r) });
          if (good(r)) { how = name; break; }
          if (r.len > 0) await clearEd();
        }
        if (!how) return finish({ error: 'Không nhập được chữ vào ô chat Zalo (đã thử 4 cách). Gửi file Downloads/GetHelps-debug/zalo-gui.json cho người hỗ trợ.' });
        // Gửi: Enter thật → Enter giả → bấm nút Gửi. Ô nhập đã trống = Zalo đã nhận tin, không bấm thêm (tránh gửi 2 lần).
        let ok = false;
        const tries = [['enter-thật', () => key('Enter')], ['enter-giả', () => run(zEnterJs)],
          ['nút-gửi', async () => { const b = await run(zSendBtn).catch(() => null); note('tìm-nút-gửi', { thấy: !!b, what: b?.what }); if (b) await click(b); else await run(zClickSend).catch(() => {}); }],
          ['nút-gửi-giả', () => run(zClickSend)]];
        for (const [name, fn] of tries) {
          try { await fn(); } catch (e) { note(name + '-lỗi', { err: String(e.message).slice(0, 80) }); }
          ok = await sentSince(before, 1800); const e2 = await st(); note(name, { ok, len: e2.len });
          if (ok) break;
          if (!e2.err && e2.len === 0) { ok = await sentSince(before, 6000); note('chờ-tin-hiện', { ok }); break; }
        }
        if (!ok) return finish({ error: 'Đã bấm gửi nhưng chưa thấy tin trong Zalo. Kiểm tra cột Zalo trước khi gửi lại.' });
      }
      if (image) {
        const m = image.match(/^data:(image\/(\w+));base64,(.+)$/); if (!m) return finish({ error: text ? 'Chữ đã gửi, ảnh không đọc được.' : 'Ảnh không đọc được.' });
        const b0 = await mine() || before, name = 'anh.' + (m[2] === 'jpeg' ? 'jpg' : m[2]);
        await run(zDropImage, m[3], m[1], name).catch(e => note('thả-ảnh-lỗi', { err: String(e.message).slice(0, 80) }));
        let ok = await sentSince(b0, 7000, true); note('thả-ảnh', { ok });
        if (!ok) { // dán ảnh vào ô nhập rồi Enter
          if (pos) await click(pos); await run(zCaret).catch(() => {});
          note('dán-ảnh', { nhận: await run(zPasteImage, m[3], m[1], name).catch(() => false) }); await sleep(900);
          await key('Enter'); ok = await sentSince(b0, 5000, true); note('dán-ảnh-enter-thật', { ok });
          if (!ok) { await run(zEnterJs).catch(() => {}); ok = await sentSince(b0, 4000, true); note('dán-ảnh-enter-giả', { ok }); }
          if (!ok) { const b = await run(zSendBtn).catch(() => null); if (b) { await click(b); ok = await sentSince(b0, 5000, true); note('dán-ảnh-nút-gửi', { ok }); } }
        }
        if (!ok) return finish({ error: (text ? 'Chữ đã gửi, ảnh chưa gửi được qua Zalo.' : 'Ảnh chưa gửi được qua Zalo.') + ' Gửi file Downloads/GetHelps-debug/zalo-gui.json cho người hỗ trợ.' });
      }
      await sleep(300);
      return finish({ ok: true, ...(replyWarn ? { warn: replyWarn } : {}), ...(await run(zRead, false).catch(() => null) || {}) });
    } finally {
      await run(zPrepInput, false).catch(() => {}); await C('Emulation.setFocusEmulationEnabled', { enabled: false });
    }
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

module.exports = { createZaloAuto, _page: { zPrepInput, zCaret, zEdState, zInsPaste, zInsExec, zInsDom, zEdReset, zEnterJs, zSendBtn, zPasteImage, zInputDiag, zFocusInput, zInputLen, zReacts, zReact, zReplyTo, zState, zDiag, zList, zListAll, zCurrent, zOpen, zRead, zPutText, zDropImage, zClickSend, zMineCount, zWatch } };
