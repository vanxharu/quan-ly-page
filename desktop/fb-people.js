// Quét người tương tác một bài Facebook bất kỳ (Page khác, nhóm, trang cá nhân công khai) bằng phiên Facebook trong app,
// và đọc số bạn bè / theo dõi của một người khi bạn bấm vào người đó.
// - Một việc một lúc, có nghỉ giữa các bước như người xem thật; trang cá nhân cách nhau ít nhất 8 giây.
// - Cùng kiểu trình duyệt máy tính với cột Meta và các khung ngầm (không đổi "thiết bị" trên cùng phiên).
// - Chỉ đọc; chỉ bấm vào chỗ mở danh sách để xem (xem fb-people-page.js).
const PAGE = require('./fb-people-page');

module.exports = function createFbPeople({ BrowserWindow, partition, asChrome, saveDebug }) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const jitter = (a, b) => wait(a + Math.random() * (b - a));
  let chain = Promise.resolve();
  const one = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }; // một việc một lúc
  let lastProfile = 0;
  const profCache = new Map(); // link → { at, data }

  const open = async (url, { width = 1100, height = 1400 } = {}) => {
    const w = new BrowserWindow({ show: false, width, height, webPreferences: { partition, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true); w.webContents.setFrameRate(5);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await asChrome(w.webContents);
    await Promise.race([w.webContents.loadURL(url), wait(25e3)]).catch(() => {});
    return w;
  };
  const run = (w, code) => w.webContents.executeJavaScript(`(${PAGE}, ${code})`);
  // Đóng hộp cảm xúc / chia sẻ: bấm Đóng, rồi phím Esc thật; kiểm tra lại cho tới khi chỉ còn hộp của bài.
  const closeAll = async w => { for (let i = 0; i < 4; i++) {
    if ((await run(w, '__fbp.extraDialogs()').catch(() => 0)) <= 0) return true;
    if (i < 2) await run(w, '__fbp.closeDialog()').catch(() => {});
    else { w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); }
    await jitter(900, 1400); } return false; };
  const isWall = href => { try { const x = new URL(href); return /facebook\.com$/i.test(x.hostname) && (/^\/(home\.php)?$/.test(x.pathname) || /^\/(login|checkpoint|two_step)/.test(x.pathname)); } catch { return false; } };

  // Đọc hết một danh sách trong hộp đang mở: cuộn tới khi không thêm người (3 lượt) hoặc đủ giới hạn.
  const drain = async (w, cap, onStep) => {
    const all = new Map(); let still = 0;
    for (let i = 0; i < 80 && all.size < cap; i++) {
      const r = await run(w, '__fbp.dialogPeople()').catch(() => null);
      if (!r?.open) break;
      const before = all.size; for (const p of r.people) if (!all.has(p.link)) all.set(p.link, p);
      onStep?.(all.size);
      still = all.size === before && !r.more ? still + 1 : 0;
      if (still >= 3) break;
      await jitter(900, 1700);
    }
    return [...all.values()].slice(0, cap);
  };

  const postPeople = ({ url, reactions = true, comments = true, shares = true, max = 800 } = {}, progress = () => {}) => one(async () => {
    let u; try { u = new URL(url); } catch { return { error: 'Link không hợp lệ.' }; }
    if (!/(^|\.)(facebook\.com|fb\.watch|fb\.me)$/i.test(u.hostname)) return { error: 'Chỉ quét được link bài Facebook.' };
    const w = await open(u.href);
    const notes = [];
    try {
      await jitter(3500, 5000);
      if (isWall(w.webContents.getURL())) return { error: 'Facebook không mở được bài này (bài riêng tư, đã xoá, link hết hạn, hoặc phiên Facebook trong app cần đăng nhập lại ở cột Meta).' };
      await run(w, '__fbp.markRoot()');
      const post = await run(w, '__fbp.stats()');
      if (post.loginWall) return { error: 'Phiên Facebook trong app đã đăng xuất. Mở cột Meta và đăng nhập lại.' };
      const people = new Map(); // link → người
      const person = p => { let x = people.get(p.link); if (!x) people.set(p.link, x = { name: p.name, link: p.link, uid: p.uid || '', reaction: '', reacted: false, comments: [], replies: 0, shared: 0, answered: false }); if (!x.uid && p.uid) x.uid = p.uid; return x; };

      if (reactions && post.reactions !== 0) {
        progress({ step: 'Đang đọc người thả cảm xúc…' });
        if (await run(w, '__fbp.openReactions()')) {
          await jitter(2200, 3200);
          const list = await drain(w, max, n => progress({ step: `Đang đọc người thả cảm xúc… ${n}` }));
          for (const p of list) person(p).reacted = true;
          // Loại cảm xúc: đọc từng thẻ (Thích, Yêu thích, Haha…) để gắn loại cho từng người.
          const tabs = await run(w, '__fbp.reactionTabs()').catch(() => []);
          if (tabs.length === 1) for (const p of list) person(p).reaction = tabs[0].type;
          else if (tabs.length > 1) for (const t of tabs) {
            progress({ step: `Đang đọc loại cảm xúc: ${t.label}…` });
            await run(w, `__fbp.clickTab(${t.i})`); await jitter(1600, 2400);
            for (const p of await drain(w, max)) { const x = person(p); x.reaction ||= t.type; x.reacted = true; }
          }
          if (list.length < (post.reactions || 0)) notes.push(`Facebook chỉ hiện ${list.length}/${post.reactions} người thả cảm xúc.`);
          if (!await closeAll(w)) notes.push('Không đóng được hộp cảm xúc.');
        } else notes.push('Không thấy nút mở danh sách cảm xúc.');
      }

      if (post.comments == null || post.shares == null) { const again = await run(w, '__fbp.stats()').catch(() => ({})); for (const k of ['reactions', 'comments', 'shares', 'author', 'authorLink']) if (post[k] == null && again[k] != null) post[k] = again[k]; }
      if (comments && post.comments !== 0) {
        progress({ step: 'Đang mở tất cả bình luận…' });
        if (await run(w, '__fbp.allCommentsMenu()')) { await jitter(900, 1400); await run(w, '__fbp.allCommentsPick()'); await jitter(2200, 3000); }
        let idle = 0;
        for (let i = 0; i < 45 && idle < 3; i++) {
          const n = await run(w, '__fbp.moreComments(true)').catch(() => 0);
          const seen = (await run(w, '__fbp.comments().length').catch(() => 0));
          progress({ step: `Đang đọc bình luận… ${seen}` });
          if (seen >= max) break;
          idle = n ? 0 : idle + 1;
          await jitter(1400, 2400);
        }
        const list = await run(w, '__fbp.comments()').catch(() => []);
        const author = (post.author || '').trim();
        for (const c of list) {
          const x = person(c);
          if (c.reply) x.replies++; else x.comments.push(c.text);
          if (!c.reply && author && c.replyNames.includes(author)) x.answered = true;
        }
        if (!list.length && post.comments !== 0) notes.push('Không đọc được bình luận nào. Bạn mở mục Thông tin chẩn đoán bên dưới, chụp gửi người hỗ trợ.');
      }

      if (shares && post.shares !== 0) {
        progress({ step: 'Đang đọc người chia sẻ…' });
        if (await run(w, '__fbp.openShares()')) {
          await jitter(2500, 3500);
          const list = await drain(w, max, n => progress({ step: `Đang đọc người chia sẻ… ${n}` }));
          for (const p of list) person(p).shared++;
          notes.push(post.shares ? `Người chia sẻ: Facebook chỉ cho xem ${list.length}/${post.shares} lượt chia sẻ công khai.` : `Người chia sẻ công khai: ${list.length}.`);
          await closeAll(w);
        } else if (post.shares) notes.push('Không mở được danh sách chia sẻ.');
      }

      // Bỏ tác giả bài khỏi danh sách người tương tác.
      if (post.authorLink) people.delete(post.authorLink);
      if (post.reactions == null && post.comments == null && post.shares == null && !people.size) notes.push('Không nhận ra bài viết trên trang này (link có đúng là một bài viết không?).');
      const out = { post, people: [...people.values()], notes };
      out.debug = await run(w, '__fbp.debug()').catch(() => null);
      out.debug && (out.debug.counts = { people: out.people.length, reacted: out.people.filter(p => p.reacted).length, typed: out.people.filter(p => p.reaction).length,
        commented: out.people.filter(p => p.comments.length).length, shared: out.people.filter(p => p.shared).length }, out.debug.post = post, out.debug.notes = notes);
      saveDebug?.(out.debug);
      return out;
    } catch (err) { return { error: err.message }; } finally { if (!w.isDestroyed()) w.destroy(); }
  });

  // Số bạn bè / theo dõi của một người (chỉ khi bạn bấm). Lưu 24 giờ để không mở lại trang cá nhân.
  const profileCounts = ({ url } = {}) => one(async () => {
    let u; try { u = new URL(url); } catch { return { error: 'Link không hợp lệ.' }; }
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return { error: 'Chỉ đọc được trang Facebook.' };
    const hit = profCache.get(u.href); if (hit && Date.now() - hit.at < 864e5) return { ...hit.data, cached: true };
    const gap = 8000 + Math.random() * 4000 - (Date.now() - lastProfile); if (gap > 0) await wait(gap);
    lastProfile = Date.now();
    const w = await open(u.href, { width: 1100, height: 1000 });
    try {
      await jitter(3000, 4500);
      if (isWall(w.webContents.getURL())) return { error: 'Facebook không mở được trang này.' };
      const d = await run(w, '__fbp.profile()');
      if (d.loginWall) return { error: 'Phiên Facebook trong app đã đăng xuất.' };
      profCache.set(u.href, { at: Date.now(), data: d }); if (profCache.size > 500) profCache.delete(profCache.keys().next().value);
      return d;
    } catch (err) { return { error: err.message }; } finally { lastProfile = Date.now(); if (!w.isDestroyed()) w.destroy(); }
  });

  return { postPeople, profileCounts };
};
