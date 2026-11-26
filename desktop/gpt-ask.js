// Hỏi ChatGPT ngầm (gợi ý trả lời khách trong Hộp thư): dùng tài khoản ChatGPT đã đăng nhập trong app (phiên mặc định, chung với Studio AI).
// Mỗi lần hỏi mở một cuộc trò chuyện tạm thời (không lưu vào lịch sử ChatGPT), dán lời nhắc, gửi, chờ ChatGPT viết xong rồi đọc chữ.
// Hỏi lần lượt (hàng đợi): một cửa sổ ngầm dùng lại cho mọi lần.
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = function createGpt({ BrowserWindow, session, url = 'https://chatgpt.com/?temporary-chat=true', saveDebug }) {
  let win = null, queue = Promise.resolve();
  const get = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { ...(session ? { session } : {}), offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.webContents.setAudioMuted?.(true);
    win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    return win;
  };
  const js = (w, code) => w.webContents.executeJavaScript(code, true);
  async function waitFor(w, expr, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { const v = await js(w, expr); if (v) return v; } catch {} await sleep(400); }
    return null;
  }
  // ChatGPT có 2 kiểu giao diện: cũ (ô ProseMirror #prompt-textarea, tin [data-message-author-role]) và mới 11/2026
  // (ô textarea "Ask ChatGPT", nút gửi aria-label "Send message" trong form, tin li[data-message-role="assistant"] có data-message-complete khi xong).
  const EDITOR = `[...document.querySelectorAll('#prompt-textarea,[data-testid="prompt-textarea"],div[contenteditable="true"].ProseMirror,textarea#mobile-composer-prompt,form textarea')].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })`;
  const SEND = `(() => { const e = ${EDITOR}, f = e && e.closest('form');
    return document.querySelector('[data-testid="send-button"],[data-testid="fruitjuice-send-button"],#composer-submit-button,button[aria-label="Send prompt"],button[aria-label="Send message"],button[aria-label="Gửi lời nhắc"],button[aria-label="Gửi tin nhắn"]') || (f && f.querySelector('button[type=submit]')); })()`;
  const ASSIST = `[...document.querySelectorAll('[data-message-author-role="assistant"],li[data-message-role="assistant"]')]`;

  async function run(prompt, { timeout = 150e3, onStep, fresh } = {}) {
    // fresh: bỏ cửa sổ ChatGPT cũ (có thể đang kẹt / lỗi), mở phiên mới.
    if (fresh && win && !win.isDestroyed()) { win.destroy(); win = null; }
    const w = get(), step = t => { try { onStep?.(t); } catch {} };
    // Đánh dấu đầu / cuối câu trả lời bằng mã riêng: đọc được câu trả lời từ chữ trên trang mà không phụ thuộc cấu trúc giao diện
    // (ChatGPT khi đăng nhập / chưa đăng nhập / mỗi lần đổi giao diện dựng tin trả lời khác nhau).
    const id = String(1000 + Math.floor(Math.random() * 9000)), A = `⟦GH${id}⟧`, B = `⟦/GH${id}⟧`;
    prompt = `${prompt}\n\nQUAN TRỌNG: dòng đầu tiên của câu trả lời phải đúng là ${A} và dòng cuối cùng phải đúng là ${B}.`;
    step('Đang mở ChatGPT…');
    await w.webContents.loadURL(url).catch(() => {});
    const ready = await waitFor(w, `!!${EDITOR}`, 35e3);
    if (!ready) {
      const login = await js(w, `!!document.querySelector('[data-testid="login-button"],a[href*="/auth/login"]') || /log in|sign up|đăng nhập/i.test((document.body?.innerText || '').slice(0, 3000))`).catch(() => false);
      throw Error(login ? 'login' : 'ChatGPT chưa mở được (mạng chậm hoặc ChatGPT đang bắt xác minh). Mở Studio AI kiểm tra rồi thử lại.');
    }
    // Chưa đăng nhập ChatGPT (có nút "Log in"): dừng luôn, không dán gì. Dán rồi mà không gửi được thì ChatGPT giữ lời nhắc
    // làm bản nháp (chung phiên với Studio AI) → lời nhắc hiện sẵn trong ô soạn của Studio AI.
    const loggedOut = await js(w, `!!document.querySelector('[data-testid="login-button"],[data-testid="mobile-login-button"]') ||
      [...document.querySelectorAll('header a,header button,nav a,nav button')].some(b => /^(log in|đăng nhập)$/i.test((b.innerText || '').trim()) && b.getBoundingClientRect().width > 0)`).catch(() => false);
    if (loggedOut) throw Error('login');
    try { return await send(w, prompt, A, B, timeout, step); }
    finally { await js(w, `(() => { const e = ${EDITOR}; if (!e || !(e.value ?? e.innerText ?? '').trim()) return;
      if (e.tagName === 'TEXTAREA') { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); }
      else { e.focus(); document.execCommand('selectAll', false); document.execCommand('delete', false); } })()`).catch(() => {}); } // không để lại bản nháp
  }
  async function send(w, prompt, A, B, timeout, step) {
    const before = await js(w, `${ASSIST}.length`).catch(() => 0);
    const USERS = `document.querySelectorAll('[data-message-author-role="user"],li[data-message-role="user"]').length`;
    const users0 = await js(w, USERS).catch(() => 0);
    step('Đang gửi câu hỏi cho ChatGPT…');
    // Trang ChatGPT mới dựng sẵn từ máy chủ rồi mới "gắn" xử lý: bấm Gửi quá sớm thì không có tác dụng.
    // Nên: dán → bấm Gửi → kiểm tra đã gửi chưa (có tin của mình / ô soạn trống / đổi địa chỉ); chưa thì đợi rồi làm lại.
    const paste = () => js(w, `(() => { const e = ${EDITOR}; if (!e) return false; e.focus();
      const want = ${JSON.stringify(prompt)}, has = (e.value ?? e.innerText ?? '').trim();
      if (has === want.trim()) return true;
      if (e.tagName === 'TEXTAREA') { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(e, want); e.dispatchEvent(new Event('input', { bubbles: true })); }
      else { document.execCommand('selectAll', false); document.execCommand('insertText', false, want); }
      return (e.value ?? e.innerText ?? '').trim().length > 20; })()`).catch(() => false);
    // Đã gửi khi: có tin của mình mới, hiện nút Dừng (đang viết), hoặc đổi sang địa chỉ cuộc trò chuyện.
    // Chưa thấy dấu hiệu: ô soạn còn nguyên lời nhắc → bấm Gửi lại (chưa gửi nên không bị trùng); ô soạn bị xoá (trang vừa dựng lại) → dán lại.
    const state = () => js(w, `(() => { if (${USERS} > ${Number(users0) || 0} || /\\/(c|uc)\\//.test(location.pathname) ||
        document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="Dừng tạo"]')) return 'sent';
      const e = ${EDITOR}; return e && (e.value ?? e.innerText ?? '').trim() ? 'typed' : 'empty'; })()`).catch(() => 'empty');
    await sleep(1500);
    let sent = false;
    for (let i = 0; i < 6 && !sent; i++) {
      const st = await state(); if (st === 'sent') { sent = true; break; }
      if (st !== 'typed' && !await paste() && w.webContents.insertText) { await js(w, `${EDITOR}?.focus()`).catch(() => {}); w.webContents.focus?.(); await w.webContents.insertText(prompt); }
      await sleep(600 + i * 400);
      const clicked = await js(w, `(() => { const b = ${SEND}; if (b && !b.disabled) { b.click(); return true; } return false; })()`).catch(() => false);
      if (!clicked && w.webContents.sendInputEvent) { w.webContents.focus?.(); w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); w.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); }
      for (let t = 0; t < 20 && !sent; t++) { await sleep(400); const s2 = await state(); sent = s2 === 'sent'; if (!sent && t >= 6 && s2 === 'typed') break; }
    }
    if (!sent) throw Error('Không gửi được câu hỏi cho ChatGPT (nút Gửi không phản hồi). Mở Studio AI xem ChatGPT có đang bắt đăng nhập / xác minh không.');
    step('ChatGPT đang viết…');
    // Xong khi: có tin trả lời mới, không còn nút Dừng, và chữ đứng yên 2 lần đọc liền nhau.
    let last = '', stable = 0; const end = Date.now() + timeout;
    while (Date.now() < end) {
      await sleep(800);
      const r = await js(w, `(() => { const a = ${ASSIST}; const el = a.length > ${Number(before) || 0} ? a[a.length - 1] : null;
        const body = el && (el.querySelector('[data-assistant-markdown-root],.markdown,[data-message-content]') || el);
        const done = el && el.hasAttribute('data-message-role') ? el.hasAttribute('data-message-complete') : true;
        return { t: body ? (body.innerText || body.textContent || '').trim() : '', busy: !done || !!document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="Dừng phát trực tuyến"],button[aria-label="Dừng tạo"]'),
          err: (document.querySelector('[class*="text-token-text-error"],[data-testid="error-message"]')?.innerText || '').slice(0, 200) }; })()`).catch(() => null);
      if (!r) continue;
      // Cách 1: theo mã đánh dấu (lần xuất hiện cuối của mã đầu nằm trước lần cuối của mã cuối, và giữa có nội dung trả lời).
      const page = await js(w, `(document.querySelector('main') || document.body).innerText`).catch(() => '');
      const ia = page.lastIndexOf(A), ib = page.lastIndexOf(B);
      if (ia >= 0 && ib > ia) { const seg = page.slice(ia + A.length, ib).trim(); if (/"replies"|\{/.test(seg)) return seg; }
      if (r.err && !r.t) throw Error('ChatGPT báo lỗi: ' + r.err);
      if (r.t && !r.busy && r.t === last) { if (++stable >= 2) return r.t; } else stable = 0;
      last = r.t;
    }
    if (last) return last;
    try { saveDebug?.({ when: new Date().toISOString(), url: w.webContents.getURL?.(),
      html: (await js(w, `(document.querySelector('main') || document.body).outerHTML`).catch(() => '')).slice(-200000) }); } catch {}
    const why = await js(w, `(() => { const a = ${ASSIST}; return 'tin trả lời: ' + a.length + ', có mã: ' + (document.body.innerText.split(${JSON.stringify(A)}).length - 1) + ', đang viết: ' + !!document.querySelector('button[aria-label*="Stop"],[data-testid="stop-button"]') + ', trang: ' + location.pathname; })()`).catch(() => '');
    throw Error('ChatGPT trả lời quá lâu, thử lại sau. (' + why + ')');
  }
  return {
    ask(prompt, opts) { const r = queue.then(() => run(prompt, opts)); queue = r.catch(() => {}); return r; },
    close() { if (win && !win.isDestroyed()) win.destroy(); win = null; }
  };
};
