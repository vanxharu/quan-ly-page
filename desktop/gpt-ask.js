// Hỏi ChatGPT ngầm (gợi ý trả lời khách trong Hộp thư): dùng tài khoản ChatGPT đã đăng nhập trong app (phiên mặc định, chung với Studio AI).
// Mỗi lần hỏi mở một cuộc trò chuyện tạm thời (không lưu vào lịch sử ChatGPT), dán lời nhắc, gửi, chờ ChatGPT viết xong rồi đọc chữ.
// Hỏi lần lượt (hàng đợi): một cửa sổ ngầm dùng lại cho mọi lần.
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = function createGpt({ BrowserWindow, session, url = 'https://chatgpt.com/?temporary-chat=true' }) {
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
  const EDITOR = `document.querySelector('#prompt-textarea,[data-testid="prompt-textarea"],div[contenteditable="true"].ProseMirror,form textarea')`;
  const SEND = `document.querySelector('[data-testid="send-button"],[data-testid="fruitjuice-send-button"],button[aria-label="Send prompt"],button[aria-label="Gửi lời nhắc"]')`;
  const ASSIST = `[...document.querySelectorAll('[data-message-author-role="assistant"]')]`;

  async function run(prompt, { timeout = 150e3, onStep } = {}) {
    const w = get(), step = t => { try { onStep?.(t); } catch {} };
    step('Đang mở ChatGPT…');
    await w.webContents.loadURL(url).catch(() => {});
    const ready = await waitFor(w, `!!${EDITOR}`, 35e3);
    if (!ready) {
      const login = await js(w, `!!document.querySelector('[data-testid="login-button"],a[href*="/auth/login"]') || /log in|sign up|đăng nhập/i.test((document.body?.innerText || '').slice(0, 3000))`).catch(() => false);
      throw Error(login ? 'login' : 'ChatGPT chưa mở được (mạng chậm hoặc ChatGPT đang bắt xác minh). Mở Studio AI kiểm tra rồi thử lại.');
    }
    const before = await js(w, `${ASSIST}.length`).catch(() => 0);
    step('Đang gửi câu hỏi cho ChatGPT…');
    // Dán lời nhắc vào ô soạn (ProseMirror nhận execCommand insertText như gõ phím); không được thì dùng insertText của Electron.
    const pasted = await js(w, `(() => { const e = ${EDITOR}; if (!e) return false; e.focus();
      if (e.tagName === 'TEXTAREA') { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(e, ${JSON.stringify(prompt)}); e.dispatchEvent(new Event('input', { bubbles: true })); }
      else { document.execCommand('selectAll', false); document.execCommand('insertText', false, ${JSON.stringify(prompt)}); }
      return (e.value ?? e.innerText ?? '').trim().length > 20; })()`).catch(() => false);
    if (!pasted && w.webContents.insertText) { await js(w, `${EDITOR}?.focus()`).catch(() => {}); w.webContents.focus?.(); await w.webContents.insertText(prompt); }
    const sent = await waitFor(w, `(() => { const b = ${SEND}; if (b && !b.disabled) { b.click(); return true; } return false; })()`, 12e3);
    if (!sent) {
      if (!w.webContents.sendInputEvent) throw Error('Không bấm được nút gửi của ChatGPT.');
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); w.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
    step('ChatGPT đang viết…');
    // Xong khi: có tin trả lời mới, không còn nút Dừng, và chữ đứng yên 2 lần đọc liền nhau.
    let last = '', stable = 0; const end = Date.now() + timeout;
    while (Date.now() < end) {
      await sleep(800);
      const r = await js(w, `(() => { const a = ${ASSIST}; const el = a.length > ${Number(before) || 0} ? a[a.length - 1] : null;
        const body = el && (el.querySelector('.markdown,[data-message-content]') || el);
        return { t: body ? (body.innerText || body.textContent || '').trim() : '', busy: !!document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Dừng phát trực tuyến"]'),
          err: (document.querySelector('[class*="text-token-text-error"],[data-testid="error-message"]')?.innerText || '').slice(0, 200) }; })()`).catch(() => null);
      if (!r) continue;
      if (r.err && !r.t) throw Error('ChatGPT báo lỗi: ' + r.err);
      if (r.t && !r.busy && r.t === last) { if (++stable >= 2) return r.t; } else stable = 0;
      last = r.t;
    }
    if (last) return last;
    throw Error('ChatGPT trả lời quá lâu, thử lại sau.');
  }
  return {
    ask(prompt, opts) { const r = queue.then(() => run(prompt, opts)); queue = r.catch(() => {}); return r; },
    close() { if (win && !win.isDestroyed()) win.destroy(); win = null; }
  };
};
