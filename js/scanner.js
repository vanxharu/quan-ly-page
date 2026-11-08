/* Quét bài viết (giống post-scanner-tab.js, nhưng chỉ trên Page bạn quản lý vì Graph API không đọc được nhóm/trang người khác):
 * - Quét theo khoảng ngày → bảng bài (ảnh, Page, loại, cảm xúc/bình luận/chia sẻ), tổng quan, lọc, sắp xếp, chép link, xuất CSV.
 * - Dán link/ID một bài → quét riêng bài đó.
 * - Quét bình luận của một bài → tên khách, nội dung, SĐT tự nhận, Page đã trả lời chưa; lọc, chép SĐT, xuất CSV khách. */
(() => {
  let rows = [], sortKey = 'created', asc = false, filter = { q: '', min: 0, type: '' };
  const cm = { post: null, list: [], q: '', phone: false, unanswered: false, hidePage: true, loading: false };
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
        h('td', {}, h('button', { className: 'btn btn-soft btn-sm', textContent: 'Quét bình luận', disabled: !r.comments, title: r.comments ? '' : 'Bài chưa có bình luận', onclick: () => openComments(r) }))))))
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
  App.scannerPhones = phonesIn;
})();
