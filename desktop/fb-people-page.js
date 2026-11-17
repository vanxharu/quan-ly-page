// Bộ đọc chạy TRONG trang Facebook (bản máy tính, đang đăng nhập): người thả cảm xúc, bình luận, chia sẻ một bài; số bạn bè / theo dõi của trang cá nhân.
// Chỉ đọc và chỉ bấm vào những chỗ mở danh sách để xem (số cảm xúc, số chia sẻ, thẻ loại cảm xúc, "Xem thêm bình luận", bộ lọc "Tất cả bình luận").
// Không bấm Thích / Thêm bạn bè / Theo dõi / gửi gì cả.
// Được nạp nguyên văn vào trang (executeJavaScript) → không dùng biến ngoài, chỉ gắn window.__fbp.
module.exports = String.raw`(() => {
  if (window.__fbp) return true;
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const txt = el => (el ? (el.innerText || el.textContent || '') : '').replace(/ /g, ' ').trim();
  // "1,2K" "3,4 N" "1.234" "2 Tr" → số
  const num = t => { t = String(t || '').trim().replace(/\s/g, ''); const m = t.match(/^([\d.,]+)(K|k|N|n|Tr|tr|M|m|B|b)?/); if (!m) return null;
    let v = m[1], u = (m[2] || '').toLowerCase(); if (u) v = v.replace(',', '.'); else v = v.replace(/[.,]/g, '');
    const x = parseFloat(v) * (u === 'k' || u === 'n' ? 1e3 : u === 'm' || u === 'tr' ? 1e6 : u === 'b' ? 1e9 : 1); return isFinite(x) ? Math.round(x) : null; };
  const NUM = '([\\d][\\d.,]*\\s?(?:K|k|N|Tr|M|m)?)';
  // Link trang cá nhân / Page sạch: bỏ tham số theo dõi; nhóm /groups/<g>/user/<uid>/ → /<uid>.
  const profileOf = href => {
    let u; try { u = new URL(href, location.href); } catch (e) { return null; }
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const p = u.pathname.replace(/\/+$/, '');
    let m = p.match(/^\/groups\/[^/]+\/user\/(\d+)$/); if (m) return { link: 'https://www.facebook.com/profile.php?id=' + m[1], uid: m[1] };
    if (p === '/profile.php' && /^\d+$/.test(u.searchParams.get('id') || '')) return { link: 'https://www.facebook.com/profile.php?id=' + u.searchParams.get('id'), uid: u.searchParams.get('id') };
    m = p.match(/^\/people\/[^/]+\/(\d+)$/); if (m) return { link: 'https://www.facebook.com/profile.php?id=' + m[1], uid: m[1] };
    if (/^\/[A-Za-z0-9.]{3,80}$/.test(p) && !/^\/(home|watch|groups|pages|events|marketplace|gaming|reel|reels|stories|photo|photos|videos|hashtag|search|friends|notifications|messages|bookmarks|settings|help|privacy|policies|login|checkpoint|share|permalink\.php|story\.php|photo\.php|profile\.php|ufi|sharer|dialog|ads|business|l\.php)$/i.test(p))
      return { link: 'https://www.facebook.com' + p, uid: '' };
    return null;
  };
  const topDialog = () => { const ds = [...document.querySelectorAll('[role="dialog"]')].filter(vis); return ds[ds.length - 1] || null; };
  // Gốc của bài, chốt một lần lúc mới mở (trước khi mở hộp cảm xúc / chia sẻ): hộp xem bài nếu bài mở dạng hộp (ảnh, video, bài nhóm),
  // không thì cả trang. Không lấy [role=article] đầu tiên: ở trang ảnh, đó có thể là một bình luận.
  let ROOT = null, BASE_DIALOGS = 0;
  const markRoot = () => { BASE_DIALOGS = [...document.querySelectorAll('[role="dialog"]')].filter(vis).length; ROOT = topDialog() || document.body; return BASE_DIALOGS; };
  const postRoot = () => (ROOT && ROOT.isConnected ? ROOT : (markRoot(), ROOT));
  const extraDialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(vis).length - BASE_DIALOGS;
  const REACT = [['like', '👍', /^(thích|like)$/i], ['love', '❤️', /^(yêu thích|love)$/i], ['care', '🥰', /^(thương thương|care)$/i], ['haha', '😆', /^haha$/i],
    ['wow', '😮', /^wow$/i], ['sad', '😢', /^(buồn|sad)$/i], ['angry', '😡', /^(phẫn nộ|angry)$/i]];
  // Nhãn thẻ có thể là "Thích, 25", "Hiển thị 25 người đã bày tỏ cảm xúc Yêu thích"…: tìm tên cảm xúc ở bất kỳ đâu ("Yêu thích" trước "Thích").
  const REACT_ANY = [['love', /yêu thích|\blove\b/i], ['care', /thương thương|\bcare\b/i], ['angry', /phẫn nộ|\bangry\b/i], ['haha', /haha/i], ['wow', /\bwow\b/i], ['sad', /buồn|\bsad\b/i], ['like', /thích|\blike\b/i]];
  const reactOf = label => { const l = String(label || '').trim(); if (!l || /^(tất cả|all)\b/i.test(l) || /^(khác|more|thêm)\b/i.test(l)) return '';
    const r = REACT.find(x => x[2].test(l.replace(/[,:]?\s*[\d.,]+\s*(K|N|Tr|M)?\s*$/i, '').trim())) || REACT_ANY.find(x => x[1].test(l)); return r ? r[0] : ''; };

  // Số liệu + tác giả bài.
  const stats = () => {
    const root = postRoot(), out = { url: location.href };
    let t = txt(root); const m0 = t.search(/(Phù hợp nhất|Most relevant|Bình luận hàng đầu|Top comments|Mới nhất|Newest|Tất cả bình luận|All comments|Viết bình luận|Write a comment)/i);
    const tHead = m0 > 0 ? t.slice(0, m0) : t; // số liệu nằm trên phần bình luận
    t = tHead;
    const g = (k, re) => { const m = t.match(re); if (m) { const v = num(m[1]); if (v != null) out[k] = v; } };
    const lab = [...root.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).find(a => /^(Tất cả cảm xúc|All reactions)/i.test(a || ''));
    if (lab) { const m = lab.match(new RegExp(NUM)); if (m) out.reactions = num(m[1]); }
    if (out.reactions == null) g('reactions', new RegExp('(?:Tất cả cảm xúc|All reactions)\\s*:?\\s*' + NUM, 'i'));
    if (out.reactions == null) { const m = t.match(new RegExp('(?:và|and)\\s+' + NUM + '\\s+(?:người khác|others?)', 'i')); if (m) out.reactions = num(m[1]) + 1; }
    // (không dùng \\b: chữ có dấu như "sẻ" không được coi là chữ cái)
    g('comments', new RegExp(NUM + '\\s*(?:bình luận|comments?)(?![A-Za-z])', 'i'));
    g('shares', new RegExp(NUM + '\\s*(?:lượt chia sẻ|chia sẻ|shares?)(?![A-Za-z])', 'i'));
    const art = root.querySelector('[role="main"] [role="article"]:not([aria-label^="Bình luận"]):not([aria-label^="Comment"])') || root;
    const a = [...art.querySelectorAll('h2 a[href], h3 a[href], h4 a[href], strong a[href], span a[href][role="link"]')].find(x => txt(x) && profileOf(x.href) && !x.closest('[role="article"][aria-label]'));
    if (a) { out.author = txt(a); out.authorLink = profileOf(a.href).link; }
    const body = [...root.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')].map(txt).join('\n') ||
      [...root.querySelectorAll('div[dir="auto"]')].map(txt).find(s => s.length > 20) || '';
    out.text = body.slice(0, 500);
    out.loginWall = !!document.querySelector('form[action*="login"], input[name="email"][type="text"], input[name="pass"]');
    return out;
  };

  const clickEl = el => { if (!el) return false; el.scrollIntoView({ block: 'center' }); for (const t of ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); el.click(); return true; };
  // Mở danh sách người thả cảm xúc.
  const openReactions = () => {
    const root = postRoot();
    const el = [...root.querySelectorAll('[aria-label]')].find(e => /^(Tất cả cảm xúc|All reactions|Xem ai đã bày tỏ cảm xúc|See who reacted)/i.test(e.getAttribute('aria-label') || '') && vis(e))
      || [...root.querySelectorAll('span, div')].find(e => e.childElementCount <= 2 && /^(Tất cả cảm xúc|All reactions)\s*:?\s*[\d]/i.test(txt(e)) && vis(e));
    const btn = el && (el.closest('[role="button"]') || el);
    return clickEl(btn);
  };
  // Mở danh sách người chia sẻ.
  const openShares = () => {
    const root = postRoot();
    const el = [...root.querySelectorAll('[role="button"], span, div')].find(e => e.childElementCount <= 2 && /^[\d][\d.,]*\s?(K|N|Tr|M)?\s*(lượt chia sẻ|chia sẻ|shares?)$/i.test(txt(e)) && vis(e));
    return clickEl(el && (el.closest('[role="button"]') || el));
  };
  // Khung cuộn của hộp đang mở.
  const scroller = d => { if (!d) return null; const all = [d, ...d.querySelectorAll('div')]; let best = null;
    for (const e of all) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 10 && (!best || e.scrollHeight > best.scrollHeight)) best = e; } return best; };
  // Người trong hộp đang mở (danh sách cảm xúc / chia sẻ): mỗi link trang cá nhân có tên.
  const dialogPeople = () => {
    const d = topDialog(); if (!d) return { open: false, people: [] };
    const seen = new Map();
    for (const a of d.querySelectorAll('a[href]')) {
      const name = txt(a), p = profileOf(a.href);
      if (!p || !name || name.length > 80 || /\n/.test(name) || /^(\d|Thêm bạn bè|Add friend|Theo dõi|Follow|Nhắn tin|Message)/i.test(name)) continue;
      if (!seen.has(p.link)) seen.set(p.link, { name, link: p.link, uid: p.uid });
    }
    const sc = scroller(d); let more = false;
    if (sc) { const before = sc.scrollTop; sc.scrollTop = sc.scrollHeight; more = sc.scrollTop > before + 5; }
    // Danh sách chưa đủ dài để cuộn: đưa người cuối vào tầm nhìn để Facebook tải thêm.
    else { const links = d.querySelectorAll('a[href]'); if (links.length) { links[links.length - 1].scrollIntoView({ block: 'end' }); } }
    return { open: true, people: [...seen.values()], more };
  };
  // Thẻ loại cảm xúc trong hộp (bỏ thẻ "Tất cả" và "Khác/More").
  const reactionTabs = () => { const d = topDialog(); if (!d) return [];
    return [...d.querySelectorAll('[role="tab"]')].filter(vis).map((t, i) => {
      const labels = [t.getAttribute('aria-label'), ...[...t.querySelectorAll('img[alt], [aria-label], image')].map(x => x.getAttribute('alt') || x.getAttribute('aria-label')), txt(t)].filter(Boolean);
      const label = labels.find(l => reactOf(l)) || labels[0] || '';
      return { i, label, type: reactOf(label), selected: t.getAttribute('aria-selected') === 'true' };
    }).filter(t => t.type); };
  const clickTab = i => { const d = topDialog(); const t = d && [...d.querySelectorAll('[role="tab"]')].filter(vis)[i]; return clickEl(t); };
  const closeDialog = () => { if (extraDialogs() <= 0) return true; const d = topDialog(); if (!d) return true;
    const b = [...d.querySelectorAll('[aria-label]')].find(e => /^(Đóng|Close)$/i.test(e.getAttribute('aria-label') || '') && vis(e));
    if (b) return clickEl(b);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); return true; };

  // Bình luận: chuyển bộ lọc sang "Tất cả bình luận".
  const allCommentsMenu = () => {
    const root = postRoot();
    const b = [...root.querySelectorAll('[role="button"]')].find(e => /^(Phù hợp nhất|Most relevant|Bình luận hàng đầu|Top comments|Mới nhất|Newest)$/i.test(txt(e)) && vis(e));
    return clickEl(b);
  };
  const allCommentsPick = () => {
    const m = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')].find(e => /^(Tất cả bình luận|All comments)/i.test(txt(e)) && vis(e));
    return clickEl(m);
  };
  // Bấm "Xem thêm bình luận" / "Xem N phản hồi" (tối đa vài nút mỗi lượt). Trả số nút đã bấm.
  const moreComments = (withReplies = true) => {
    const root = postRoot(); let n = 0;
    const RE = withReplies ? /^(Xem thêm( \d+)? bình luận|Xem bình luận trước|View more comments|View previous comments|View \d+ more comments?|Xem tất cả \d+ phản hồi|Xem \d+ phản hồi|Xem thêm phản hồi|View all \d+ repl(y|ies)|View \d+ repl(y|ies)|View more replies|\d+ phản hồi|\d+ repl(y|ies))/i
      : /^(Xem thêm( \d+)? bình luận|Xem bình luận trước|View more comments|View previous comments|View \d+ more comments?)/i;
    for (const e of root.querySelectorAll('[role="button"]')) {
      if (n >= 4) break;
      const t = txt(e); if (!t || t.length > 40 || !RE.test(t) || !vis(e) || e.__fbpClicked) continue;
      e.__fbpClicked = true; clickEl(e); n++;
    }
    // Facebook chỉ dựng bình luận khi cuộn tới: cuộn khung bài (hộp) hoặc cả trang xuống dần.
    const sc = ROOT && ROOT !== document.body ? scroller(ROOT) : null;
    if (sc) sc.scrollTop = Math.min(sc.scrollHeight, sc.scrollTop + 1400); else window.scrollBy(0, 1400);
    const arts = commentArts(); if (arts.length) arts[arts.length - 1].scrollIntoView({ block: 'center' });
    return n;
  };
  // Bình luận = [role=article] có nhãn "Bình luận …/Phản hồi …/Comment …/Reply …", hoặc article nằm trong bài (không phải bài chính).
  const CM = /^(Bình luận|Phản hồi|Comment|Reply)/i;
  const commentArts = () => { const root = postRoot();
    let arts = [...root.querySelectorAll('[role="article"]')].filter(a => CM.test(a.getAttribute('aria-label') || '') && !(extraDialogs() > 0 && topDialog()?.contains(a) && topDialog() !== ROOT));
    if (!arts.length) { const main = root.querySelector('[role="main"] [role="article"]'); arts = main ? [...main.querySelectorAll('[role="article"]')] : []; }
    return arts; };
  // Đọc các bình luận đang hiện.
  const comments = () => {
    const out = [], seen = new Set();
    const arts = commentArts();
    for (const a of arts) {
      const label = a.getAttribute('aria-label') || '';
      const link = [...a.querySelectorAll('a[href]')].find(x => txt(x) && profileOf(x.href) && !/comment_id=.*reply_comment_id|^\d/.test(txt(x)));
      if (!link) continue;
      const p = profileOf(link.href), name = txt(link);
      // Nội dung: các khối chữ trong bình luận, bỏ tên người và các bình luận con lồng bên trong.
      const own = [...a.querySelectorAll('div[dir="auto"], span[dir="auto"]')].filter(x => x.closest('[role="article"]') === a && !x.closest('a') && !x.querySelector('div[dir="auto"], span[dir="auto"]')
        && !/^(Thích|Like|Phản hồi|Reply|Chia sẻ|Share|Đã chỉnh sửa|Edited|Tác giả|Author|Fan cứng|Top fan|\d+\s*(giây|phút|giờ|ngày|tuần|năm|s|m|h|d|w|y))$/i.test(txt(x)));
      let text = [...new Set(own.map(txt).filter(s => s && s !== name))].join('\n').trim();
      const key = p.link + '|' + text.slice(0, 80) + '|' + label.slice(-30); if (seen.has(key)) continue; seen.add(key);
      const reply = /^(Phản hồi|Reply)/i.test(label);
      // Bài trả lời của tác giả bài trong cùng nhánh (để biết bình luận đã được trả lời chưa).
      const li = a.closest('li') || a.parentElement;
      const replyNames = reply ? [] : [...(li ? li.querySelectorAll('[role="article"]') : [])].filter(x => x !== a).map(x => { const l = [...x.querySelectorAll('a[href]')].find(y => txt(y) && profileOf(y.href)); return l ? txt(l) : ''; }).filter(Boolean);
      out.push({ name, link: p.link, uid: p.uid, text, reply, replyNames });
    }
    return out;
  };

  // Trang cá nhân / Page: số bạn bè, người theo dõi, đang theo dõi (chữ trên đầu trang).
  const profile = () => {
    const out = { url: location.href, name: txt(document.querySelector('[role="main"] h1')) || document.title.replace(/\s*\|\s*Facebook\s*$/i, '') };
    const fromLinks = (k, re) => { for (const a of document.querySelectorAll('a[href]')) { if (!re.test(a.getAttribute('href') || '')) continue; const m = txt(a).match(new RegExp(NUM)); if (m && !/chung|mutual/i.test(txt(a))) { out[k] = num(m[1]); return; } } };
    fromLinks('friends', /\/friends(_all)?\/?(\?|$)|sk=friends/);
    fromLinks('followers', /\/followers\/?(\?|$)|sk=followers/);
    fromLinks('following', /\/following\/?(\?|$)|sk=following/);
    const head = txt(document.querySelector('[role="main"]') || document.body).slice(0, 4000);
    const g = (k, re) => { if (out[k] != null) return; const m = head.match(re); if (m) { const v = num(m[1]); if (v != null) out[k] = v; } };
    g('friends', new RegExp(NUM + '\\s*(?:người bạn|bạn bè|friends)(?!\\s*(chung|in common))', 'i'));
    g('followers', new RegExp(NUM + '\\s*(?:người theo dõi|followers)', 'i'));
    g('following', new RegExp('(?:Đang theo dõi|Following)\\s*' + NUM, 'i'));
    g('following', new RegExp(NUM + '\\s*(?:đang theo dõi|following)', 'i'));
    g('likes', new RegExp(NUM + '\\s*(?:lượt thích|likes)', 'i'));
    out.unavailable = /Nội dung này hiện không hiển thị|This content isn.t available|Trang này không có sẵn|This page isn.t available/i.test(head);
    out.loginWall = !!document.querySelector('input[name="pass"]');
    return out;
  };
  // Ghi lại cấu trúc trang khi không đọc được gì (để chẩn đoán, không có nội dung riêng tư ngoài tên hiển thị).
  const debug = () => ({ url: location.href, title: document.title, dialogs: document.querySelectorAll('[role="dialog"]').length, base: BASE_DIALOGS, root: ROOT === document.body ? 'body' : 'dialog',
    articleCount: document.querySelectorAll('[role="article"]').length, comments: commentArts().length,
    tabs: [...document.querySelectorAll('[role="tab"]')].slice(0, 12).map(t => [t.getAttribute('aria-label'), ...[...t.querySelectorAll('img[alt],[aria-label]')].map(x => x.getAttribute('alt') || x.getAttribute('aria-label'))].filter(Boolean).join(' | ').slice(0, 120)),
    text: txt(postRoot()).slice(0, 1500),
    articles: [...document.querySelectorAll('[role="article"]')].slice(0, 12).map(a => (a.getAttribute('aria-label') || '').slice(0, 60)),
    labels: [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).filter(l => /cảm xúc|react|chia sẻ|share|bình luận|comment/i.test(l)).slice(0, 25),
    buttons: [...document.querySelectorAll('[role="button"]')].map(txt).filter(t => t && t.length < 40).slice(0, 60) });
  window.__fbp = { markRoot, extraDialogs, commentArts, stats, openReactions, openShares, dialogPeople, reactionTabs, clickTab, closeDialog, allCommentsMenu, allCommentsPick, moreComments, comments, profile, debug, profileOf, num };
  return true;
})()`;
