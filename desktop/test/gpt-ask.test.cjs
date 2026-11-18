// Chạy: NODE_PATH=<thư mục có playwright> node desktop/test/gpt-ask.test.cjs
// Thử gpt-ask.js trên trang ChatGPT giả (ô soạn contenteditable, nút gửi, trả lời chạy chữ dần + nút Dừng).
const { chromium } = require('playwright'), fs = require('fs'), path = require('path'), assert = require('assert');
const createGpt = require('../gpt-ask');
async function run(fixture) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('https://chatgpt.com/**', r => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8') }));
  class FakeWin { constructor() { this.p = ctx.newPage(); const self = this; this.dead = false;
    this.webContents = { setAudioMuted() {}, setWindowOpenHandler() {}, loadURL: async u => (await self.p).goto(u), executeJavaScript: async c => (await self.p).evaluate(c) }; }
    isDestroyed() { return this.dead; } destroy() { this.dead = true; } }
  const g = createGpt({ BrowserWindow: FakeWin });
  const steps = [], prompt = 'Bạn là nhân viên bán hàng.\nKhách: cho mình 1k like "bài này" nha';
  const t = await g.ask(prompt, { onStep: s => steps.push(s) });
  assert(t.includes('"replies"') && t.trim().endsWith('```'), 'đọc đủ câu trả lời: ' + t);
  const pages = ctx.pages(); const sentPrompt = await pages[0].evaluate(() => window.lastPrompt);
  assert.strictEqual(sentPrompt.trim(), prompt, 'dán đúng lời nhắc nhiều dòng');
  // Hỏi lần 2 (hàng đợi, mở trò chuyện mới)
  const t2 = await g.ask('câu hỏi 2'); assert(t2.includes('replies'));
  const sends = await pages[0].evaluate(() => window.sends ?? 1); assert.strictEqual(sends, 1, 'gửi đúng 1 lần, không trùng');
  console.log('OK', fixture, steps.join(' → '));
  await browser.close();
}
(async () => { await run('chatgpt.html'); await run('chatgpt-2026.html'); })().catch(e => { console.error('FAIL', e.message); process.exit(1); });
