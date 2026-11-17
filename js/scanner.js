/* Quét bài viết (giống post-scanner-tab.js, nhưng chỉ trên Page bạn quản lý vì Graph API không đọc được nhóm/trang người khác):
 * - Quét theo khoảng ngày → bảng bài (ảnh, Page, loại, cảm xúc/bình luận/chia sẻ), tổng quan, lọc, sắp xếp, chép link, xuất CSV.
 * - Dán link/ID một bài → quét riêng bài đó.
 * - Quét bình luận của một bài → tên khách, nội dung, SĐT tự nhận, Page đã trả lời chưa; lọc, chép SĐT, xuất CSV khách.
 * - Người tương tác (app máy tính): bài bất kỳ (Page khác, nhóm, trang cá nhân công khai) → ai thả cảm xúc (loại gì), bình luận, chia sẻ;
 *   số bạn bè / người theo dõi đọc khi bấm từng người (mở trang cá nhân bằng phiên Facebook trong app, cách nhau ≥ 8 giây). */
(() => {
  let rows = [], sortKey = 'created', asc = false, filter = { q: '', min: 0, type: '' };
  const cm = { post: null, list: [], q: '', phone: false, unanswered: false, hidePage: true, loading: false };
  const pp = { want: { react: true, cmt: true, share: true }, post: null, people: [], notes: [], loading: false, step: '', error: '', debug: null,
    q: '', both: false, phone: false, unanswered: false, shared: false, react: '', minFollow: 0, sortKey: 'score', asc: false, busy: new Set() };
  const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){9}\b/g;
  const COLS = [['created', 'Ngày'], ['page', 'Page'], ['message', 'Bài viết'], ['type', 'Loại'], ['reactions', 'Cảm xúc'], ['comments', 'Bình luận'], ['shares', 'Chia sẻ'], ['total', 'Tổng']];
  const TYPES = { added_photos: 'Ảnh', photo: 'Ảnh', added_video: 'Video', video: 'Video', shared_story: 'Chia sẻ', share: 'Chia sẻ', link: 'Link', mobile_status_update: 'Chữ', status: 'Chữ', created_event: 'Sự kiện' };
  const FIELDS = 'id,message,created_time,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
  const phonesIn = text => [...new Set((String(text || '').match(PHONE) || []).map(p => p.replace(/[\s.-]/g, '').replace(/^\+?84/, '0')))];
  const toRow = (x, p) => {
    const r = { id: x.id, created: new Date(x.created_time).getTime(), page: p.name, pageObj: p, message: (x.message || '').replace(/\s+/g, ' ').trim(), link: x.permalink_url,
      img: x.full_picture || '', type: TYPES[x.status_type] || (x.full_picture ? 'Ảnh' : 'Chữ'),
      reactions: x.reactions?.summary?.total_count || 0, comments: x.comments?.summary?.total_count || 0, shares: x.shares?.count || 0 };
    r.total = r.reactions + r.comments + r.shares; return r;
  };
  // ── Link bài của Page bất kỳ: bookmarklet chép link + làm sạch ──
  // Hàm đứng riêng (không dùng biến ngoài) để nhúng nguyên văn vào bookmarklet chạy trên facebook.com.
  function cleanFbLink(raw) {
    let u; try { u = new URL(String(raw || '').trim(), 'https://www.facebook.com'); } catch (e) { return ''; }
    if (!/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.watch$/i.test(u.hostname)) return '';
    const p = u.pathname.replace(/\/+$/, ''), q = u.searchParams, base = 'https://www.facebook.com';
    if (/^\/(permalink|story)\.php$/.test(p) && q.get('story_fbid')) return `${base}/permalink.php?story_fbid=${q.get('story_fbid')}${q.get('id') ? '&id=' + q.get('id') : ''}`;
    if (/^\/photo(\.php)?$/.test(p) && q.get('fbid')) return `${base}/photo/?fbid=${q.get('fbid')}`;
    if (/^\/watch$/.test(p) && q.get('v')) return `${base}/watch/?v=${q.get('v')}`;
    if (/^\/[^/]+\/(posts|videos)\/[^/]+$/.test(p) || /^\/(reel|share\/[prv])\/[^/]+$/.test(p) || /^\/[^/]+\/photos\/[^/]+\/\d+$/.test(p) || /^\/groups\/[^/]+\/(posts|permalink)\/\d+$/.test(p)) return base + p;
    return '';
  }
  const bookmarklet = () => 'javascript:' + encodeURIComponent(`(function(){var clean=${cleanFbLink};var S=window.__maLinks=window.__maLinks||new Set();var before=S.size;
var act=document.activeElement;document.querySelectorAll('[aria-posinset] a, [role=article] a').forEach(function(a){var h=a.getAttribute('href')||'';if(h&&h.charAt(0)!=='?'&&h!=='#')return;['pointerover','pointerenter','mouseover','mouseenter'].forEach(function(t){try{a.dispatchEvent(new (window.PointerEvent&&t.indexOf('pointer')===0?PointerEvent:MouseEvent)(t,{bubbles:true}));}catch(e){}});try{a.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));a.focus({preventScroll:true});}catch(e){}});try{if(act&&act.focus)act.focus({preventScroll:true});else document.activeElement.blur();}catch(e){}
setTimeout(function(){document.querySelectorAll('a[href]').forEach(function(a){var c=clean(a.getAttribute('href'));if(c&&!/comment_id=/.test(a.href))S.add(c);});
var old=document.getElementById('__maBox');if(old)old.remove();var mk=function(t,css,txt){var e=document.createElement(t);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e;};
var list=Array.from(S),box=mk('div','position:fixed;z-index:2147483647;right:16px;bottom:16px;width:380px;max-width:92vw;background:#fff;color:#111;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.35);padding:12px;font:13px/1.4 system-ui,sans-serif');box.id='__maBox';
var head=mk('div');head.appendChild(mk('b','', 'Meta Assistant · Link bài '));head.appendChild(mk('span','color:#666',list.length+' link (+'+(list.length-before)+' mới)'));box.appendChild(head);
box.appendChild(mk('div','color:#666;margin:4px 0 6px','Cuộn xuống để hiện thêm bài rồi bấm lại nút để gom tiếp.'));
var ta=mk('textarea','width:100%;height:150px;font:12px monospace;box-sizing:border-box');ta.value=list.join('\\n');box.appendChild(ta);
var row=mk('div','display:flex;gap:6px;margin-top:6px'),btn='padding:7px 10px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer';
var c=mk('button','flex:1;padding:7px;border:0;border-radius:8px;background:#1877f2;color:#fff;font-weight:600;cursor:pointer','Chép '+list.length+' link');
c.onclick=function(){ta.select();var done=function(){c.textContent='Đã chép '+list.length+' link';};if(navigator.clipboard)navigator.clipboard.writeText(ta.value).then(done,function(){document.execCommand('copy');done();});else{document.execCommand('copy');done();}};
var r=mk('button',btn,'Xoá');r.onclick=function(){S.clear();box.remove();};var x=mk('button',btn,'Đóng');x.onclick=function(){box.remove();};
row.appendChild(c);row.appendChild(r);row.appendChild(x);box.appendChild(row);document.body.appendChild(box);ta.select();},700);})()`.replace(/\n/g, ''));
  App.cleanFbLink = cleanFbLink;
  App.tab('scanner', {
    mount(el) {
      el.append(h('div', { className: 'card' },
        h('div', { className: 'toolbar' },
          h('label', { className: 'row', style: 'gap:6px' }, 'Từ', h('input', { type: 'date', id: 'snFrom', value: Pure.dayKeyOf(Date.now() - 30 * 864e5) })),
          h('label', { className: 'row', style: 'gap:6px' }, 'Đến', h('input', { type: 'date', id: 'snTo', value: Pure.dayKeyOf(Date.now()) })),
          h('label', { className: 'row', style: 'gap:6px' }, 'Tối đa/Page', h('input', { type: 'number', id: 'snMax', value: 50, min: 1, max: 500, style: 'width:80px' })),
          h('button', { className: 'btn btn-primary', id: 'snGo', onclick: () => scan() }, icon('i-search'), 'Quét các Page')),
        h('form', { className: 'toolbar sn-link', onsubmit: e => { e.preventDefault(); scanLink($('snLink').value); } },
          h('input', { type: 'text', id: 'snLink', placeholder: 'Dán link hoặc ID một bài viết của Page bạn quản lý…', 'aria-label': 'Link bài viết' }),
          h('button', { className: 'btn btn-soft', id: 'snLinkGo' }, 'Quét bài này'),
          h('span', { className: 'hint', textContent: 'Chỉ đọc được bài của các Page đang kết nối.' })),
        window.metaDesktop?.fbPostPeople ? h('form', { className: 'toolbar sn-link sn-people-form', onsubmit: e => { e.preventDefault(); scanPeople($('snPeopleLink').value); } },
          h('input', { type: 'text', id: 'snPeopleLink', placeholder: '👥 Dán link bài bất kỳ (Page khác, nhóm, trang cá nhân công khai) để quét người tương tác…', 'aria-label': 'Link bài để quét người tương tác' }),
          ...[['react', 'Cảm xúc'], ['cmt', 'Bình luận'], ['share', 'Chia sẻ']].map(([k, t]) => h('label', { className: 'row', style: 'gap:5px' },
            h('input', { type: 'checkbox', checked: pp.want[k], onchange: e => { pp.want[k] = e.target.checked; } }), t)),
          h('button', { className: 'btn btn-primary', id: 'snPeopleGo' }, 'Quét người tương tác'))
          : h('div', { className: 'hint', textContent: '👥 Quét người tương tác (cảm xúc, bình luận, chia sẻ, số bạn bè / follow) của bài bất kỳ: chỉ có trong app máy tính Get Helps.' }),
        h('details', { className: 'sn-links' },
          h('summary', {}, h('strong', { textContent: 'Lấy link bài của Page bất kỳ' }), h('span', { className: 'hint', textContent: ' · Page đối thủ, nhóm, trang cá nhân công khai' })),
          h('ol', { className: 'sn-steps' },
            h('li', {}, 'Kéo nút này lên thanh dấu trang (Ctrl+Shift+B để hiện thanh): ', h('a', { className: 'btn btn-soft btn-sm sn-bm', href: bookmarklet(), title: 'Kéo lên thanh dấu trang', onclick: e => { e.preventDefault(); toast('Kéo nút này lên thanh dấu trang, đừng bấm ở đây.'); } }, '📋 Chép link bài FB')),
            h('li', { textContent: 'Mở Page cần lấy trên facebook.com, tự cuộn xuống tới khi hiện đủ bài.' }),
            h('li', { textContent: 'Bấm nút “📋 Chép link bài FB” trên thanh dấu trang → bấm Chép. Cuộn thêm rồi bấm lại để gom tiếp (không trùng).' }),
            h('li', { textContent: 'Dán vào ô dưới để lọc trùng, xuất CSV, hoặc quét số liệu nếu là bài của Page bạn quản lý.' })),
          h('textarea', { id: 'snPaste', rows: 4, placeholder: 'Dán loạt link bài viết vào đây (mỗi dòng một link, hoặc dán cả đoạn văn có link)…', oninput: () => drawPasted() }),
          h('div', { id: 'snPasted' })),
        h('div', { className: 'log', id: 'snLog' }),
        h('div', { id: 'snKpis', className: 'sn-kpis' }),
        h('div', { className: 'toolbar', id: 'snFilters', hidden: true },
          h('input', { type: 'search', placeholder: 'Lọc theo nội dung…', style: 'flex:1 1 220px;max-width:340px', oninput: e => { filter.q = e.target.value; draw(); } }),
          h('select', { style: 'width:auto', onchange: e => { filter.type = e.target.value; draw(); } }, h('option', { value: '', textContent: 'Mọi loại bài' }), ...['Ảnh', 'Video', 'Chữ', 'Link', 'Chia sẻ'].map(t => h('option', { value: t, textContent: t }))),
          h('label', { className: 'row', style: 'gap:6px' }, 'Tương tác ≥', h('input', { type: 'number', min: 0, value: 0, style: 'width:80px', oninput: e => { filter.min = Number(e.target.value) || 0; draw(); } })),
          h('span', { className: 'grow' }),
          h('button', { className: 'btn btn-ghost', textContent: 'Chép link', onclick: () => navigator.clipboard.writeText(visible().map(r => r.link).join('\n')).then(() => toast(`Đã chép ${visible().length} link.`)) }),
          h('button', { className: 'btn btn-ghost', textContent: 'Xuất CSV', onclick: () => csvDownload(`quet-bai-${Pure.dayKeyOf(Date.now())}.csv`,
            [['Ngày', 'Page', 'Nội dung', 'Loại', 'Cảm xúc', 'Bình luận', 'Chia sẻ', 'Tổng', 'Link'], ...visible().map(r => [fmtTime(r.created), r.page, r.message, r.type, r.reactions, r.comments, r.shares, r.total, r.link])]) })),
        h('div', { className: 'scroll', id: 'snTable' }),
        h('div', { id: 'snPeople' }),
        h('div', { id: 'snComments' })));
      draw();
    }
  });
  const visible = () => { const q = norm(filter.q); return rows.filter(r => (!q || norm(r.message).includes(q)) && (!filter.type || r.type === filter.type) && r.total >= filter.min); };
  const sorted = () => visible().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * (asc ? 1 : -1));
  async function scan() {
    const pages = App.selected();
    const since = Math.floor(new Date($('snFrom').value + 'T00:00').getTime() / 1000), until = Math.floor(new Date($('snTo').value + 'T23:59:59').getTime() / 1000);
    const max = Math.max(1, Number($('snMax').value) || 50);
    $('snGo').disabled = true; $('snLog').replaceChildren(h('div', { className: 'status pending', textContent: `Đang quét ${pages.length} Page…` }));
    const errors = [];
    const lists = await pool(pages, 4, async p => {
      try {
        const posts = await apiPaged(`/${p.id}/posts`, { since, until, limit: Math.min(100, max), fields: FIELDS }, p.access_token, Math.ceil(max / 100) + 1);
        return posts.slice(0, max).map(x => toRow(x, p));
      } catch (e) { errors.push(`${p.name}: ${e.message}`); return []; }
    });
    rows = lists.flat();
    $('snGo').disabled = false;
    $('snLog').replaceChildren(h('div', { className: 'status ok', textContent: `Đã quét ${rows.length} bài.` }), ...errors.map(e => h('div', { className: 'status err', textContent: e })));
    draw();
  }

  // ── Link → bài viết ──────────────────────────────────────
  // Nhận: ID "pageid_postid", link /posts/<số>, story_fbid=…&id=…, fbid=…, /photos/…/<số>, /videos/<số>, link pfbid (dò trong bài gần đây).
  App.scannerParseLink = raw => {
    const s = String(raw || '').trim();
    if (/^\d+_\d+$/.test(s)) return { full: s };
    if (/^\d{6,}$/.test(s)) return { post: s };
    let u; try { u = new URL(/^https?:/i.test(s) ? s : 'https://' + s); } catch { return null; }
    const q = u.searchParams, path = u.pathname;
    if (q.get('story_fbid') && /^\d+$/.test(q.get('story_fbid'))) return { post: q.get('story_fbid'), page: q.get('id') || '' };
    const pf = (path.match(/pfbid[0-9A-Za-z]+/) || q.get('story_fbid')?.match(/pfbid[0-9A-Za-z]+/) || [])[0];
    if (pf) return { pfbid: pf };
    const m = path.match(/\/(?:posts|videos|reel|permalink)\/(\d+)/) || path.match(/\/photos\/[^/]+\/(\d+)/) || (q.get('fbid') && [0, q.get('fbid')]) || (q.get('v') && [0, q.get('v')]);
    return m ? { post: String(m[1]) } : null;
  };
  async function scanLink(raw) {
    const ref = App.scannerParseLink(raw);
    if (!ref) return $('snLog').replaceChildren(h('div', { className: 'status err', textContent: 'Không nhận ra link. Dán link bài viết Facebook hoặc ID dạng 123_456.' }));
    const pages = ref.page ? App.pages.filter(p => p.id === ref.page) : App.selected().length ? App.selected() : App.pages;
    $('snLinkGo').disabled = true; $('snLog').replaceChildren(h('div', { className: 'status pending', textContent: 'Đang tìm bài…' }));
    let found = null;
    try {
      if (ref.full) { const p = App.pageById(ref.full.split('_')[0]); if (p) found = toRow(await api(`/${ref.full}`, { fields: FIELDS }, 'GET', p.access_token), p); }
      for (const p of pages) { if (found || !ref.post) break; try { found = toRow(await api(`/${p.id}_${ref.post}`, { fields: FIELDS }, 'GET', p.access_token), p); } catch {} }
      if (!found && (ref.pfbid || ref.post)) for (const p of pages) {
        if (found) break;
        const recent = await apiPaged(`/${p.id}/posts`, { limit: 100, fields: FIELDS }, p.access_token, 3).catch(() => []);
        const hit = recent.find(x => (ref.pfbid && String(x.permalink_url || '').includes(ref.pfbid)) || (ref.post && String(x.id).endsWith('_' + ref.post)));
        if (hit) found = toRow(hit, p);
      }
    } finally { $('snLinkGo').disabled = false; }
    if (!found) return $('snLog').replaceChildren(h('div', { className: 'status err', textContent: 'Không tìm thấy bài trong các Page đang chọn (chỉ đọc được bài của Page bạn quản lý; link pfbid chỉ dò được trong ~300 bài gần nhất mỗi Page).' }));
    rows = [found, ...rows.filter(r => r.id !== found.id)];
    $('snLog').replaceChildren(h('div', { className: 'status ok', textContent: `Đã tìm thấy bài của ${found.page}.` }));
    draw(); openComments(found);
  }

  // Dán loạt link: tách link, làm sạch, bỏ trùng; đánh dấu link thuộc Page bạn quản lý để quét số liệu.
  function drawPasted() {
    const text = $('snPaste').value, found = String(text).match(/https?:\/\/[^\s"'<>]+|(?:www\.|m\.)?facebook\.com\/[^\s"'<>]+/gi) || [];
    const links = [...new Set(found.map(cleanFbLink).filter(Boolean))];
    const own = l => App.pages.find(p => l.includes('/' + p.id + '/') || l.includes('id=' + p.id));
    $('snPasted').replaceChildren(!text.trim() ? '' : h('div', {},
      h('div', { className: 'toolbar' }, h('span', { className: 'hint', textContent: `${links.length} link bài hợp lệ (đã bỏ trùng${found.length > links.length ? `, bỏ ${found.length - links.length} link không phải bài/trùng` : ''})` }), h('span', { className: 'grow' }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Chép', disabled: !links.length, onclick: () => navigator.clipboard.writeText(links.join('\n')).then(() => toast(`Đã chép ${links.length} link.`)) }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Xuất CSV', disabled: !links.length, onclick: () => csvDownload(`link-bai-${Pure.dayKeyOf(Date.now())}.csv`, [['STT', 'Link'], ...links.map((l, i) => [i + 1, l])]) })),
      links.length ? h('div', { className: 'scroll sn-linklist' }, h('table', { className: 'sn-table' }, h('tbody', {}, ...links.map((l, i) => h('tr', {},
        h('td', { textContent: i + 1 }), h('td', { className: 'left' }, h('a', { href: l, target: '_blank', rel: 'noopener', textContent: l })),
        h('td', {}, own(l) ? h('button', { className: 'btn btn-soft btn-sm', textContent: 'Quét số liệu', onclick: () => scanLink(l) }) : h('span', { className: 'hint', textContent: 'Page khác' }))))))) : null));
  }

  // ── Bảng bài + tổng quan ──────────────────────────────────
  function draw() {
    if (!$('snTable')) return;
    const list = sorted();
    $('snFilters').hidden = !rows.length;
    const sum = k => list.reduce((a, r) => a + r[k], 0), best = [...list].sort((a, b) => b.total - a.total)[0];
    $('snKpis').replaceChildren(...(rows.length ? [
      ['Bài viết', num(list.length)], ['Tổng tương tác', num(sum('total'))], ['TB mỗi bài', num(list.length ? Math.round(sum('total') / list.length) : 0)],
      ['Bình luận', num(sum('comments'))], ['Chia sẻ', num(sum('shares'))]].map(([k, v]) => h('div', { className: 'sn-kpi' }, h('span', { textContent: k }), h('strong', { textContent: v })))
      .concat(best ? [h('a', { className: 'sn-kpi sn-best', href: best.link, target: '_blank', rel: 'noopener', title: best.message },
        h('span', { textContent: 'Bài tốt nhất · ' + num(best.total) + ' tương tác' }), h('strong', { textContent: (best.message || '(xem bài)').slice(0, 60) }))] : []) : []));
    $('snTable').replaceChildren(rows.length ? h('table', { className: 'sn-table' },
      h('thead', {}, h('tr', {}, ...COLS.map(([k, t]) => h('th', { className: 'sort' + (['page', 'message'].includes(k) ? ' left' : ''), textContent: t + (sortKey === k ? (asc ? ' ▲' : ' ▼') : ''),
        onclick: () => { asc = sortKey === k ? !asc : false; sortKey = k; draw(); } })), h('th', {}))),
      h('tbody', {}, ...list.map(r => h('tr', { className: cm.post?.id === r.id ? 'is-active' : '' },
        h('td', { textContent: fmtShort(r.created) }),
        h('td', { className: 'left' }, h('span', { className: 'sn-page' }, App.avatar(r.page, App.pageAvatarUrl(r.pageObj), 22), h('span', { textContent: r.page }))),
        h('td', { className: 'left' }, h('a', { className: 'sn-post', href: r.link, target: '_blank', rel: 'noopener', title: r.message },
          r.img ? h('img', { src: r.img, alt: '', loading: 'lazy' }) : h('span', { className: 'sn-noimg', textContent: 'Aa' }), h('span', { textContent: r.message || '(xem bài)' }))),
        h('td', { textContent: r.type }), h('td', { textContent: num(r.reactions) }), h('td', { textContent: num(r.comments) }), h('td', { textContent: num(r.shares) }), h('td', {}, h('strong', { textContent: num(r.total) })),
        h('td', {}, h('div', { className: 'row', style: 'gap:6px;flex-wrap:nowrap' },
          h('button', { className: 'btn btn-soft btn-sm', textContent: 'Quét bình luận', disabled: !r.comments, title: r.comments ? '' : 'Bài chưa có bình luận', onclick: () => openComments(r) }),
          window.metaDesktop?.fbPostPeople ? h('button', { className: 'btn btn-ghost btn-sm', textContent: '👥 Người tương tác', disabled: !r.total || !r.link, title: 'Ai thả cảm xúc, bình luận, chia sẻ bài này', onclick: () => scanPeople(r.link) }) : null))))))
      : empty('Chọn Page, khoảng ngày rồi bấm Quét các Page, hoặc dán link một bài.'));
  }

  // ── Bình luận của một bài ─────────────────────────────────
  async function openComments(r) {
    cm.post = r; cm.list = []; cm.loading = true; drawComments(); draw();
    $('snComments').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    try {
      const raw = await apiPaged(`/${r.id}/comments`, { filter: 'toplevel', order: 'chronological', limit: 100,
        fields: 'id,from{id,name},message,created_time,like_count,comment_count,permalink_url,comments.limit(25){from{id}}' }, r.pageObj.access_token, 30);
      cm.list = raw.map(c => ({ id: c.id, name: c.from?.name || '(ẩn danh)', uid: c.from?.id || '', message: c.message || '', at: new Date(c.created_time).getTime(), likes: c.like_count || 0,
        replies: c.comment_count || 0, link: c.permalink_url || r.link, phones: phonesIn(c.message), fromPage: String(c.from?.id) === String(r.pageObj.id),
        answered: (c.comments?.data || []).some(x => String(x.from?.id) === String(r.pageObj.id)) }));
    } catch (e) { toast('Chưa quét được bình luận: ' + e.message, 6000); }
    cm.loading = false; drawComments();
  }
  const cmVisible = () => { const q = norm(cm.q); return cm.list.filter(c => (!cm.hidePage || !c.fromPage) && (!cm.phone || c.phones.length) && (!cm.unanswered || (!c.answered && !c.fromPage)) && (!q || norm(c.name + ' ' + c.message).includes(q))); };
  function drawComments() {
    const box = $('snComments'); if (!box) return;
    if (!cm.post) return box.replaceChildren();
    const list = cmVisible(), customers = cm.list.filter(c => !c.fromPage), phones = [...new Set(list.flatMap(c => c.phones))];
    const toggle = (key, label) => h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: cm[key], onchange: e => { cm[key] = e.target.checked; drawComments(); } }), label);
    box.replaceChildren(h('div', { className: 'sn-comments' },
      h('div', { className: 'card-head' },
        h('div', {}, h('h3', { className: 'card-title', textContent: 'Bình luận của bài' }), h('a', { className: 'hint', href: cm.post.link, target: '_blank', rel: 'noopener', textContent: `${cm.post.page} · ${(cm.post.message || '(xem bài)').slice(0, 90)}` })),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Đóng', onclick: () => { cm.post = null; drawComments(); draw(); } })),
      cm.loading ? h('div', { className: 'status pending', textContent: 'Đang quét bình luận…' }) : h('div', {},
        h('div', { className: 'sn-kpis' }, ...[['Bình luận của khách', customers.length], ['Có số điện thoại', customers.filter(c => c.phones.length).length], ['Page chưa trả lời', customers.filter(c => !c.answered).length], ['Người bình luận', new Set(customers.map(c => c.uid || c.name)).size]]
          .map(([k, v]) => h('div', { className: 'sn-kpi' }, h('span', { textContent: k }), h('strong', { textContent: num(v) })))),
        h('div', { className: 'toolbar' },
          h('input', { type: 'search', placeholder: 'Tìm tên hoặc nội dung…', value: cm.q, style: 'flex:1 1 200px;max-width:300px', oninput: e => { cm.q = e.target.value; drawComments(); } }),
          toggle('phone', 'Có SĐT'), toggle('unanswered', 'Page chưa trả lời'), toggle('hidePage', 'Ẩn bình luận của Page'),
          h('span', { className: 'grow' }),
          h('button', { className: 'btn btn-ghost btn-sm', textContent: `Chép ${phones.length} SĐT`, disabled: !phones.length, onclick: () => navigator.clipboard.writeText(phones.join('\n')).then(() => toast(`Đã chép ${phones.length} số điện thoại.`)) }),
          h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Xuất CSV', disabled: !list.length, onclick: () => csvDownload(`binh-luan-${cm.post.id}.csv`,
            [['Thời gian', 'Tên', 'Bình luận', 'SĐT', 'Thích', 'Trả lời', 'Page đã trả lời', 'Link'], ...list.map(c => [fmtTime(c.at), c.name, c.message, c.phones.join(' '), c.likes, c.replies, c.fromPage ? 'Page' : c.answered ? 'Có' : 'Chưa', c.link])]) })),
        list.length ? h('div', { className: 'scroll' }, h('table', { className: 'sn-table' },
          h('thead', {}, h('tr', {}, ...['Thời gian', 'Người bình luận', 'Bình luận', 'SĐT', 'Thích', 'Page trả lời', ''].map((t, i) => h('th', { className: [1, 2].includes(i) ? 'left' : '', textContent: t })))),
          h('tbody', {}, ...list.map(c => h('tr', {},
            h('td', { textContent: fmtShort(c.at) }), h('td', { className: 'left' }, h('strong', { textContent: c.name })), h('td', { className: 'left sn-cmt', textContent: c.message || '(ảnh / nhãn dán)' }),
            h('td', {}, ...c.phones.map(p => h('div', { className: 'tag tone-green', textContent: p }))), h('td', { textContent: num(c.likes) }),
            h('td', {}, h('span', { className: 'status ' + (c.fromPage ? 'ok' : c.answered ? 'ok' : 'pending'), textContent: c.fromPage ? 'Page' : c.answered ? 'Đã trả lời' : 'Chưa' })),
            h('td', {}, h('a', { className: 'btn btn-ghost btn-sm', href: c.link, target: '_blank', rel: 'noopener', textContent: 'Mở ↗' })))))))
          : empty(cm.list.length ? 'Không có bình luận khớp bộ lọc.' : 'Bài chưa có bình luận.'))));
  }

  // ── Người tương tác của một bài (app máy tính, phiên Facebook trong app) ──
  const REACT = { like: '👍', love: '❤️', care: '🥰', haha: '😆', wow: '😮', sad: '😢', angry: '😡' };
  const REACT_NAME = { like: 'Thích', love: 'Yêu thích', care: 'Thương thương', haha: 'Haha', wow: 'Wow', sad: 'Buồn', angry: 'Phẫn nộ' };
  // Số bạn bè / follow đã đọc: lưu trên máy theo link trang cá nhân (không mở lại trang cá nhân khi quét bài khác).
  const PC_KEY = 'fbProfileCounts';
  const pcAll = () => { try { return JSON.parse(local.get(PC_KEY) || '{}'); } catch { return {}; } };
  const pcGet = link => pcAll()[link] || null;
  const pcSet = (link, d) => { const all = pcAll(); all[link] = { friends: d.friends ?? null, followers: d.followers ?? null, following: d.following ?? null, likes: d.likes ?? null, at: Date.now() };
    const keys = Object.keys(all); if (keys.length > 3000) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 3000)) delete all[k];
    local.set(PC_KEY, JSON.stringify(all)); };
  const enrich = p => { p = { ...p, reacted: p.reacted || !!p.reaction }; const c = pcGet(p.link) || {}; const phones = phonesIn(p.comments.join('\n'));
    return { ...p, phones, nCmt: p.comments.length + p.replies, friends: c.friends ?? null, followers: c.followers ?? c.likes ?? null, following: c.following ?? null,
      score: (p.reacted ? 1 : 0) + p.comments.length * 2 + p.replies + p.shared * 3 }; };
  App.scannerProgress = p => { if (!pp.loading) return; pp.step = p?.step || pp.step; const el = $('snPeopleStep'); if (el) el.textContent = pp.step; };

  async function scanPeople(raw) {
    const link = String(raw || '').trim();
    if (!link) return toast('Dán link bài viết Facebook trước.');
    if (!pp.want.react && !pp.want.cmt && !pp.want.share) return toast('Chọn ít nhất một loại: Cảm xúc, Bình luận hoặc Chia sẻ.');
    if (pp.loading) return toast('Đang quét một bài, đợi xong rồi quét tiếp.');
    if (batch.running) return toast('Đang xem bạn bè / follow cả danh sách. Bấm Dừng trước rồi quét bài khác.');
    Object.assign(pp, { post: { url: link }, people: [], notes: [], error: '', debug: null, loading: true, step: 'Đang mở bài trên Facebook…' });
    drawPeople(); $('snPeople').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    const btn = $('snPeopleGo'); if (btn) btn.disabled = true;
    try {
      const r = await window.metaDesktop.fbPostPeople({ url: link, reactions: pp.want.react, comments: pp.want.cmt, shares: pp.want.share });
      if (r?.error) pp.error = r.error === 'denied' ? 'App chưa cho phép lệnh này.' : r.error;
      else { pp.post = { ...r.post, url: link }; pp.people = r.people || []; pp.notes = r.notes || []; pp.debug = r.debug || null; }
    } catch (e) { pp.error = 'App chưa có chức năng này, hãy cập nhật app (bấm số phiên bản ở góc trên).'; }
    pp.loading = false; if (btn) btn.disabled = false; drawPeople();
  }
  // Trả 'ok' | 'hidden' | 'error:<lý do>'. quiet: không hiện thông báo (khi xem cả danh sách).
  async function lookupCounts(p, quiet = false) {
    if (pp.busy.has(p.link)) return 'busy';
    pp.busy.add(p.link); drawPeople(); let res = 'ok';
    try {
      const d = await window.metaDesktop.fbProfileCounts({ url: p.link });
      if (d?.error) { res = 'error:' + d.error; if (!quiet) toast(`${p.name}: ${d.error}`, 6000); }
      else if (d?.unavailable) { pcSet(p.link, {}); res = 'hidden'; if (!quiet) toast(`${p.name}: trang cá nhân không xem được (đã khoá hoặc chặn).`, 5000); }
      else { pcSet(p.link, d); if (d.friends == null && d.followers == null && d.likes == null) { res = 'hidden'; if (!quiet) toast(`${p.name}: người này ẩn số bạn bè và người theo dõi.`, 5000); } }
    } catch { res = 'error:App chưa có chức năng này, hãy cập nhật app.'; if (!quiet) toast('App chưa có chức năng này, hãy cập nhật app.', 6000); }
    pp.busy.delete(p.link); drawPeople(); return res;
  }
  // Xem bạn bè / follow cả danh sách đang hiện, lần lượt từng người (app tự giãn cách 8–12 giây mỗi người),
  // nghỉ 1–2 phút sau mỗi 25 người; tự dừng khi Facebook báo lỗi 3 lần liền (đăng xuất, checkpoint, chặn).
  const batch = { running: false, stop: false, done: 0, total: 0, hidden: 0, failed: 0, note: '' };
  const fmtMin = s => s >= 3600 ? `${Math.floor(s / 3600)} giờ ${Math.round(s % 3600 / 60)} phút` : `${Math.max(1, Math.round(s / 60))} phút`;
  async function lookupAll() {
    if (batch.running) { batch.stop = true; batch.note = 'Đang dừng sau người hiện tại…'; return drawPeople(); }
    const todo = ppSorted().filter(p => !pcGet(p.link));
    if (!todo.length) return toast('Mọi người đang hiện đều đã có số bạn bè / follow.');
    if (todo.length > 40 && !confirm(`Xem bạn bè / follow của ${todo.length} người, mất khoảng ${fmtMin(todo.length * 14 + Math.floor(todo.length / 25) * 90)}.\n\nApp mở lần lượt trang cá nhân từng người bằng tài khoản Facebook trong app. Mở nhiều trang cá nhân liên tục có thể khiến Facebook bắt xác minh (checkpoint).\nApp giãn cách 8–12 giây mỗi người, nghỉ 1–2 phút sau mỗi 25 người, tự dừng nếu Facebook báo lỗi. Bạn bấm Dừng lúc nào cũng được.\n\nBắt đầu?`)) return;
    Object.assign(batch, { running: true, stop: false, done: 0, total: todo.length, hidden: 0, failed: 0, note: '' });
    let errRun = 0, lastErr = '';
    for (const p of todo) {
      if (batch.stop || !pp.post) break;
      if (batch.done && batch.done % 25 === 0) {
        const rest = 60 + Math.round(Math.random() * 60);
        for (let i = rest; i > 0 && !batch.stop; i--) { batch.note = `Nghỉ ${i} giây cho an toàn…`; drawBatch(); await new Promise(r => setTimeout(r, 1000)); }
        batch.note = ''; if (batch.stop) break;
      }
      const r = await lookupCounts(p, true);
      batch.done++;
      if (r === 'hidden') batch.hidden++;
      if (r.startsWith('error:')) { batch.failed++; errRun++; lastErr = r.slice(6); } else errRun = 0;
      if (errRun >= 3 || /đăng xuất|đăng nhập/i.test(lastErr)) { batch.stop = true; batch.note = `Đã tự dừng: ${lastErr}`; break; }
      drawBatch();
    }
    const msg = batch.note.startsWith('Đã tự dừng') ? batch.note : `Đã xem ${batch.done}/${batch.total} người` + (batch.hidden ? `, ${batch.hidden} người ẩn số` : '') + (batch.failed ? `, ${batch.failed} lỗi` : '') + '.';
    Object.assign(batch, { running: false, stop: false, note: '' }); toast(msg, 8000); drawPeople();
  }
  // Chỉ vẽ lại dòng tiến độ (không vẽ lại cả bảng mỗi giây).
  const batchText = () => { const left = batch.total - batch.done;
    return batch.note || `Đang xem bạn bè / follow: ${batch.done}/${batch.total}` + (batch.hidden ? ` · ${batch.hidden} người ẩn số` : '') + (batch.failed ? ` · ${batch.failed} lỗi` : '') + (left ? ` · còn khoảng ${fmtMin(left * 14 + Math.floor(left / 25) * 90)}` : ''); };
  const drawBatch = () => { const el = $('snBatch'); if (el) el.textContent = batchText(); };
  const ppVisible = () => { const q = norm(pp.q);
    return pp.people.map(enrich).filter(p => (!q || norm(p.name + ' ' + p.comments.join(' ')).includes(q)) && (!pp.both || (p.reacted && p.comments.length)) && (!pp.phone || p.phones.length)
      && (!pp.unanswered || (p.comments.length && !p.answered)) && (!pp.shared || p.shared) && (!pp.react || p.reaction === pp.react) && (!pp.minFollow || (p.followers ?? -1) >= pp.minFollow)); };
  const PCOLS = [['name', 'Người tương tác', 'left'], ['reaction', 'Cảm xúc'], ['nCmt', 'Bình luận', 'left'], ['phones', 'SĐT'], ['shared', 'Chia sẻ'], ['friends', 'Bạn bè'], ['followers', 'Người theo dõi'], ['score', 'Mức']];
  const ppSorted = () => { const k = pp.sortKey, v = x => k === 'phones' ? x.phones.length : k === 'name' || k === 'reaction' ? String(x[k] || '') : (x[k] ?? -1);
    return ppVisible().sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * (pp.asc ? 1 : -1)); };
  const n0 = v => v == null ? '' : num(v);
  function drawPeople() {
    const box = $('snPeople'); if (!box) return;
    if (!pp.post) return box.replaceChildren();
    const all = pp.people.map(enrich), list = ppSorted(), phones = [...new Set(list.flatMap(p => p.phones))];
    const toggle = (key, label) => h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: pp[key], onchange: e => { pp[key] = e.target.checked; drawPeople(); } }), label);
    const P = pp.post, stat = [P.reactions != null && `${num(P.reactions)} cảm xúc`, P.comments != null && `${num(P.comments)} bình luận`, P.shares != null && `${num(P.shares)} chia sẻ`].filter(Boolean).join(' · ');
    const head = h('div', { className: 'card-head' },
      h('div', {}, h('h3', { className: 'card-title', textContent: '👥 Người tương tác' }),
        h('a', { className: 'hint', href: P.url, target: '_blank', rel: 'noopener', textContent: [P.author, (P.text || '').slice(0, 70) || P.url, stat].filter(Boolean).join(' · ') })),
      h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Đóng', disabled: pp.loading, onclick: () => { if (batch.running) batch.stop = true; pp.post = null; drawPeople(); } }));
    if (pp.loading) return box.replaceChildren(h('div', { className: 'sn-comments' }, head,
      h('div', { className: 'status pending', id: 'snPeopleStep', textContent: pp.step }),
      h('div', { className: 'hint', textContent: 'App mở bài bằng phiên Facebook trong app (cột Meta), cuộn và đọc như người xem thật, nên mất khoảng 1–3 phút với bài nhiều tương tác.' })));
    if (pp.error) return box.replaceChildren(h('div', { className: 'sn-comments' }, head, h('div', { className: 'status err', textContent: pp.error })));
    box.replaceChildren(h('div', { className: 'sn-comments' }, head,
      h('div', { className: 'sn-kpis' }, ...[['Người tương tác', all.length], ['Thả cảm xúc', all.filter(p => p.reacted).length],
        ['Bình luận', all.filter(p => p.comments.length).length], ['Chia sẻ', all.filter(p => p.shared).length], ['Có SĐT', all.filter(p => p.phones.length).length],
        ['Vừa cảm xúc vừa bình luận', all.filter(p => p.reacted && p.comments.length).length]].map(([k, v]) => h('div', { className: 'sn-kpi' }, h('span', { textContent: k }), h('strong', { textContent: num(v) })))),
      ...pp.notes.map(n => h('div', { className: 'hint', textContent: 'ℹ️ ' + n })),
      h('div', { className: 'toolbar' },
        h('input', { type: 'search', placeholder: 'Tìm tên hoặc nội dung bình luận…', value: pp.q, style: 'flex:1 1 200px;max-width:280px', oninput: e => { pp.q = e.target.value; drawPeople(); } }),
        h('select', { style: 'width:auto', onchange: e => { pp.react = e.target.value; drawPeople(); } }, h('option', { value: '', textContent: 'Mọi cảm xúc' }),
          ...Object.keys(REACT).filter(k => all.some(p => p.reaction === k)).map(k => h('option', { value: k, selected: pp.react === k, textContent: `${REACT[k]} ${REACT_NAME[k]}` }))),
        toggle('both', 'Vừa cảm xúc + bình luận'), toggle('phone', 'Có SĐT'), toggle('unanswered', 'Bình luận chưa được trả lời'), toggle('shared', 'Đã chia sẻ'),
        h('label', { className: 'row', style: 'gap:6px', title: 'Chỉ tính người đã bấm Xem số bạn bè / follow' }, 'Follow ≥',
          h('input', { type: 'number', min: 0, value: pp.minFollow || '', placeholder: '0', style: 'width:90px', oninput: e => { pp.minFollow = Number(e.target.value) || 0; drawPeople(); } }))),
      h('div', { className: 'toolbar' },
        h('span', { className: 'hint', textContent: `Đang hiện ${num(list.length)}/${num(all.length)} người.` + (pp.minFollow ? ' Lọc follow chỉ tính người đã xem số follow.' : '') }),
        batch.running ? h('span', { className: 'status pending', id: 'snBatch', textContent: batchText() }) : null,
        h('span', { className: 'grow' }),
        (() => { const n = list.filter(p => !pcGet(p.link)).length;
          return h('button', { className: 'btn btn-sm ' + (batch.running ? 'btn-danger' : 'btn-primary'), disabled: !batch.running && !n,
            title: 'Mở lần lượt trang cá nhân của những người đang hiện (chưa xem) để đọc số bạn bè và người theo dõi',
            textContent: batch.running ? `⏸ Dừng (${batch.done}/${batch.total})` : `Xem bạn bè/follow tất cả (${n})`, onclick: lookupAll }); })(),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: `Chép ${phones.length} SĐT`, disabled: !phones.length, onclick: () => navigator.clipboard.writeText(phones.join('\n')).then(() => toast(`Đã chép ${phones.length} số điện thoại.`)) }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Chép link', disabled: !list.length, onclick: () => navigator.clipboard.writeText(list.map(p => p.link).join('\n')).then(() => toast(`Đã chép ${list.length} link trang cá nhân.`)) }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Xuất CSV', disabled: !list.length, onclick: () => csvDownload(`nguoi-tuong-tac-${Pure.dayKeyOf(Date.now())}.csv`,
          [['Tên', 'Link trang cá nhân', 'UID', 'Cảm xúc', 'Số bình luận', 'Bình luận', 'SĐT', 'Phản hồi', 'Đã chia sẻ', 'Tác giả đã trả lời', 'Bạn bè', 'Người theo dõi', 'Đang theo dõi', 'Link bài'],
            ...list.map(p => [p.name, p.link, p.uid, p.reaction ? REACT_NAME[p.reaction] : p.reacted ? 'Có' : '', p.comments.length, p.comments.join(' | '), p.phones.join(' '), p.replies, p.shared ? 'Có' : '',
              p.comments.length ? (p.answered ? 'Có' : 'Chưa') : '', p.friends ?? '', p.followers ?? '', p.following ?? '', P.url])]) })),
      list.length ? h('div', { className: 'scroll sn-people' }, h('table', { className: 'sn-table' },
        h('thead', {}, h('tr', {}, ...PCOLS.map(([k, t, c]) => h('th', { className: 'sort' + (c ? ' ' + c : ''), textContent: t + (pp.sortKey === k ? (pp.asc ? ' ▲' : ' ▼') : ''),
          onclick: () => { pp.asc = pp.sortKey === k ? !pp.asc : ['name'].includes(k); pp.sortKey = k; drawPeople(); } })), h('th', {}))),
        h('tbody', {}, ...list.slice(0, 1500).map(p => h('tr', {},
          h('td', { className: 'left' }, h('a', { className: 'sn-person', href: p.link, target: '_blank', rel: 'noopener', title: p.link }, h('strong', { textContent: p.name }), ' ↗')),
          h('td', { title: p.reaction ? REACT_NAME[p.reaction] : p.reacted ? 'Đã thả cảm xúc (chưa rõ loại)' : '', textContent: REACT[p.reaction] || (p.reacted ? '✓' : '') }),
          h('td', { className: 'left sn-cmt' }, p.comments.length ? h('div', {}, h('div', { textContent: p.comments[0] || '(ảnh / nhãn dán)' }),
              h('div', { className: 'sn-cmt-meta' }, h('span', { className: 'status ' + (p.answered ? 'ok' : 'pending'), textContent: p.answered ? 'Đã trả lời' : 'Chưa trả lời' }),
                p.comments.length > 1 || p.replies ? h('span', { className: 'hint', textContent: `+${p.comments.length - 1 + p.replies} bình luận khác`, title: p.comments.slice(1).join('\n') }) : null))
            : p.replies ? h('span', { className: 'hint', textContent: `${p.replies} phản hồi` }) : ''),
          h('td', {}, ...p.phones.map(x => h('div', { className: 'tag tone-green', textContent: x }))),
          h('td', { textContent: p.shared ? '🔁' : '' }),
          h('td', { textContent: n0(p.friends) }), h('td', { textContent: n0(p.followers) }), h('td', { textContent: p.score }),
          h('td', {}, pp.busy.has(p.link) ? h('span', { className: 'status pending', textContent: 'Đang xem…' })
            : h('button', { className: 'btn btn-ghost btn-sm', textContent: p.friends != null || p.followers != null ? '↻' : 'Xem bạn bè/follow',
              title: p.friends != null || p.followers != null ? 'Đọc lại số bạn bè / follow' : 'Mở trang cá nhân người này bằng phiên Facebook trong app để đọc số bạn bè và người theo dõi',
              onclick: () => lookupCounts(p) })))))))
        : empty(pp.people.length ? 'Không có người khớp bộ lọc.' : 'Không đọc được người tương tác nào.'),
      pp.debug ? h('details', { className: 'hint' }, h('summary', { textContent: 'Thông tin chẩn đoán (gửi cho người hỗ trợ, cũng lưu ở Downloads › GetHelps-debug › nguoi-tuong-tac.json)' }),
        h('pre', { style: 'white-space:pre-wrap;font-size:11px', textContent: JSON.stringify(pp.debug, null, 1) })) : null));
  }
  App.scannerPhones = phonesIn;
})();
