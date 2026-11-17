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
  // Gốc của bài: hộp xem bài (ảnh / video / bài trong nhóm mở dạng hộp) hoặc bài đầu tiên của trang.
  const postRoot = () => topDialog() || document.querySelector('[role="main"] [role="article"]') || document.querySelector('[role="article"]') || document.querySelector('[role="main"]') || document.body;
  const REACT = [['like', '👍', /^(thích|like)$/i], ['love', '❤️', /^(yêu thích|love)$/i], ['care', '🥰', /^(thương thương|care)$/i], ['haha', '😆', /^haha$/i],
    ['wow', '😮', /^wow$/i], ['sad', '😢', /^(buồn|sad)$/i], ['angry', '😡', /^(phẫn nộ|angry)$/i]];
  const reactOf = label => { const l = String(label || '').replace(/[,:]?\s*[\d.,]+\s*(K|N|Tr|M)?\s*$/i, '').trim(); const r = REACT.find(x => x[2].test(l)); return r ? r[0] : ''; };

  // Số liệu + tác giả bài.
  const stats = () => {
    const root = postRoot(), t = txt(root), out = { url: location.href };
    const g = (k, re) => { const m = t.match(re); if (m) { const v = num(m[1]); if (v != null) out[k] = v; } };
    const lab = [...root.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).find(a => /^(Tất cả cảm xúc|All reactions)/i.test(a || ''));
    if (lab) { const m = lab.match(new RegExp(NUM)); if (m) out.reactions = num(m[1]); }
    if (out.reactions == null) g('reactions', new RegExp('(?:Tất cả cảm xúc|All reactions)\\s*:?\\s*' + NUM, 'i'));
    if (out.reactions == null) { const m = t.match(new RegExp('(?:và|and)\\s+' + NUM + '\\s+(?:người khác|others?)', 'i')); if (m) out.reactions = num(m[1]) + 1; }
    // (không dùng \\b: chữ có dấu như "sẻ" không được coi là chữ cái)
    g('comments', new RegExp(NUM + '\\s*(?:bình luận|comments?)(?![A-Za-z])', 'i'));
    g('shares', new RegExp(NUM + '\\s*(?:lượt chia sẻ|chia sẻ|shares?)(?![A-Za-z])', 'i'));
    const a = [...root.querySelectorAll('h2 a[href], h3 a[href], h4 a[href], strong a[href]')].find(x => txt(x) && profileOf(x.href));
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
      const label = t.getAttribute('aria-label') || [...t.querySelectorAll('img[alt], [aria-label]')].map(x => x.getAttribute('alt') || x.getAttribute('aria-label')).find(Boolean) || txt(t);
      return { i, label, type: reactOf(label), selected: t.getAttribute('aria-selected') === 'true' };
    }).filter(t => t.type); };
  const clickTab = i => { const d = topDialog(); const t = d && [...d.querySelectorAll('[role="tab"]')].filter(vis)[i]; return clickEl(t); };
  const closeDialog = () => { const d = topDialog(); if (!d) return true;
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
    const sc = topDialog() ? scroller(topDialog()) : null; if (sc) sc.scrollTop = sc.scrollHeight; else window.scrollBy(0, 1200);
    return n;
  };
  // Đọc các bình luận đang hiện.
  const comments = () => {
    const root = postRoot(), out = [], seen = new Set();
    const arts = [...root.querySelectorAll('[role="article"]')].filter(a => /^(Bình luận|Phản hồi|Comment|Reply)/i.test(a.getAttribute('aria-label') || ''));
    for (const a of arts) {
      const label = a.getAttribute('aria-label') || '';
      const link = [...a.querySelectorAll('a[href]')].find(x => txt(x) && profileOf(x.href) && !/comment_id=.*reply_comment_id|^\d/.test(txt(x)));
      if (!link) continue;
      const p = profileOf(link.href), name = txt(link);
      // Nội dung: các khối chữ trong bình luận, bỏ tên người và các bình luận con lồng bên trong.
      const own = [...a.querySelectorAll('div[dir="auto"], span[dir="auto"]')].filter(x => x.closest('[role="article"]') === a && !x.closest('a') && !x.querySelector('div[dir="auto"], span[dir="auto"]'));
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
  const debug = () => ({ url: location.href, title: document.title, dialogs: document.querySelectorAll('[role="dialog"]').length,
    articles: [...document.querySelectorAll('[role="article"]')].slice(0, 12).map(a => (a.getAttribute('aria-label') || '').slice(0, 60)),
    labels: [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).filter(l => /cảm xúc|react|chia sẻ|share|bình luận|comment/i.test(l)).slice(0, 25),
    buttons: [...document.querySelectorAll('[role="button"]')].map(txt).filter(t => t && t.length < 40).slice(0, 60) });
  window.__fbp = { stats, openReactions, openShares, dialogPeople, reactionTabs, clickTab, closeDialog, allCommentsMenu, allCommentsPick, moreComments, comments, profile, debug, profileOf, num };
  return true;
})()`;
