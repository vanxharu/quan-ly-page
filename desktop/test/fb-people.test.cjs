// Chạy: NODE_PATH=<thư mục có playwright> node desktop/test/fb-people.test.cjs
// Thử bộ quét người tương tác (fb-people.js + fb-people-page.js) trên trang Facebook giả, bằng Chrome thật qua Playwright.
const { chromium } = require('playwright'), fs = require('fs'), path = require('path'), assert = require('assert');
const createFbPeople = require('../fb-people');
const FIX = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.route('https://www.facebook.com/**', r => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/shopabc/posts/')) return r.fulfill({ contentType: 'text/html', body: FIX('fb-post.html') });
    if (u.pathname.startsWith('/photo')) return r.fulfill({ contentType: 'text/html', body: FIX('fb-photo.html') });
    if (u.pathname.startsWith('/lan.nguyen')) return r.fulfill({ contentType: 'text/html', body: FIX('fb-profile.html') });
    return r.fulfill({ contentType: 'text/html', body: '<html><body><div role="main">feed</div></body></html>' });
  });
  // BrowserWindow giả: mỗi cửa sổ là một tab Playwright.
  class FakeWin {
    constructor() { this.p = ctx.newPage(); this.dead = false; const self = this;
      this.webContents = { setAudioMuted() {}, setFrameRate() {}, setWindowOpenHandler() {},
        loadURL: async u => (await self.p).goto(u), getURL: () => self.page.url(), executeJavaScript: async c => (await self.p).evaluate(c) }; }
    get page() { return this._pg; }
    isDestroyed() { return this.dead; } destroy() { this.dead = true; this.p.then(p => p.close()); }
  }
  const Win = function (o) { const w = new FakeWin(o); w.p.then(p => { w._pg = p; }); return w; };
  const fp = createFbPeople({ BrowserWindow: Win, partition: 'x', asChrome: async wc => { await new Promise(r => setTimeout(r, 50)); } });

  const steps = [];
  const r = await fp.postPeople({ url: 'https://www.facebook.com/shopabc/posts/123' }, p => { steps.push(p.step); if (process.env.V) console.log(new Date().toISOString().slice(14,19), p.step); });
  if (r.error) throw new Error(r.error);
  console.log(JSON.stringify(r.post), '\nnotes:', r.notes);
  const by = Object.fromEntries(r.people.map(p => [p.name, p]));
  console.table(r.people.map(p => ({ name: p.name, link: p.link, uid: p.uid, reaction: p.reaction, comments: p.comments.join(' | '), replies: p.replies, shared: p.shared, answered: p.answered })));
  assert.equal(r.post.reactions, 7); assert.equal(r.post.comments, 4); assert.equal(r.post.shares, 3); assert.equal(r.post.author, 'Shop ABC');
  assert.ok(!by['Shop ABC'], 'bỏ tác giả bài');
  assert.equal(by['Lan Nguyễn'].reaction, 'like'); assert.equal(by['Minh Trần'].reaction, 'haha'); assert.equal(by['Tuấn Phạm'].reaction, 'love');
  assert.equal(by['Lan Nguyễn'].link, 'https://www.facebook.com/lan.nguyen');
  assert.equal(by['Minh Trần'].uid, '100001234'); assert.equal(by['Minh Trần'].link, 'https://www.facebook.com/profile.php?id=100001234');
  assert.deepEqual(by['Lan Nguyễn'].comments, ['Giá bao nhiêu shop? sđt 0912 345 678']); assert.equal(by['Lan Nguyễn'].answered, true); assert.equal(by['Lan Nguyễn'].replies, 1);
  assert.equal(by['Minh Trần'].answered, false);
  assert.deepEqual(by['Tuấn Phạm'].comments, ['Ship Đà Nẵng bao lâu'], 'đã chuyển sang Tất cả bình luận');
  assert.deepEqual(by['Quân Hồ'].comments, ['Đặt 2 cái'], 'đã bấm Xem thêm bình luận'); assert.equal(by['Quân Hồ'].shared, 1);
  assert.equal(by['Hoa Lê'].shared, 1); assert.equal(r.people.length, 8);
  assert.equal(r.people.filter(p => p.reacted).length, 7, 'đủ 7 người thả cảm xúc'); assert.equal(by['Quân Hồ'].reacted, false);

  // Trang ảnh: bình luận chỉ dựng khi cuộn, thẻ cảm xúc nhãn dài, không có article cho bài.
  const ph = await fp.postPeople({ url: 'https://www.facebook.com/photo/?fbid=55' });
  const pb = Object.fromEntries(ph.people.map(p => [p.name, p]));
  console.log('photo', JSON.stringify(ph.post), ph.notes, ph.people.map(p => `${p.name}:${p.reaction || (p.reacted ? '✓' : '')}:${p.comments.join('/')}:${p.shared}`).join(' ; '));
  assert.equal(ph.post.reactions, 4); assert.equal(ph.post.comments, 3); assert.equal(ph.post.shares, 1); assert.equal(ph.post.author, 'Mầm non ABC');
  assert.equal(pb['Lan Nguyễn'].reaction, 'love'); assert.equal(pb['Minh Trần'].reaction, 'like');
  assert.deepEqual(pb['Lan Nguyễn'].comments, ['Bé dễ thương quá 0905111222']); assert.equal(pb['Mai Võ'].answered, true); assert.equal(pb['Quân Hồ'].shared, 1); assert.ok(!pb['Mầm non ABC']);

  const t0 = Date.now();
  const pc = await fp.profileCounts({ url: 'https://www.facebook.com/lan.nguyen' });
  console.log('profile', pc, Math.round((Date.now() - t0) / 1000) + 's');
  assert.equal(pc.friends, 2345); assert.equal(pc.followers, 1200); assert.equal(pc.following, 312);
  const again = await fp.profileCounts({ url: 'https://www.facebook.com/lan.nguyen' }); assert.ok(again.cached, 'lần 2 lấy từ bộ nhớ, không mở lại');
  const bad = await fp.postPeople({ url: 'https://www.facebook.com/shopabc/videos/1' }); // bị đẩy về trang khác: không đọc nhầm
  console.log('wall:', bad.error || ('people=' + bad.people?.length));
  console.log('OK');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
