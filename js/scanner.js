/* Quét bài viết (giống post-scanner-tab.js, nhưng chỉ trên Page bạn quản lý vì Graph API không đọc được nhóm/trang người khác):
 * khoảng ngày + số bài mỗi Page → bảng cảm xúc/bình luận/chia sẻ, bấm cột để sắp xếp, chép link, xuất CSV. */
(() => {
  let rows = [], sortKey = 'created', asc = false;
  const COLS = [['created', 'Ngày'], ['page', 'Page'], ['message', 'Nội dung'], ['reactions', 'Cảm xúc'], ['comments', 'Bình luận'], ['shares', 'Chia sẻ'], ['total', 'Tổng']];
  App.tab('scanner', {
    mount(el) {
      el.append(h('div', { className: 'card' },
        h('div', { className: 'toolbar' },
          Object.assign(App.pageSelect('Tất cả Page', App.page()?.id), { id: 'snPage' }),
          h('label', { className: 'row', style: 'gap:6px' }, 'Từ', h('input', { type: 'date', id: 'snFrom', value: Pure.dayKeyOf(Date.now() - 30 * 864e5) })),
          h('label', { className: 'row', style: 'gap:6px' }, 'Đến', h('input', { type: 'date', id: 'snTo', value: Pure.dayKeyOf(Date.now()) })),
          h('label', { className: 'row', style: 'gap:6px' }, 'Tối đa/Page', h('input', { type: 'number', id: 'snMax', value: 50, min: 1, max: 500, style: 'width:80px' })),
          h('button', { className: 'btn btn-primary', id: 'snGo', onclick: () => scan() }, icon('i-search'), 'Quét'),
          h('button', { className: 'btn btn-ghost', textContent: 'Chép link', onclick: () => navigator.clipboard.writeText(sorted().map(r => r.link).join('\n')).then(() => toast(`Đã chép ${rows.length} link.`)) }),
          h('button', { className: 'btn btn-ghost', textContent: 'Xuất CSV', onclick: () => csvDownload(`quet-bai-${Pure.dayKeyOf(Date.now())}.csv`,
            [['Ngày', 'Page', 'Nội dung', 'Cảm xúc', 'Bình luận', 'Chia sẻ', 'Tổng', 'Link'], ...sorted().map(r => [fmtTime(r.created), r.page, r.message, r.reactions, r.comments, r.shares, r.total, r.link])]) })),
        h('div', { className: 'log', id: 'snLog' }),
        h('div', { className: 'scroll', id: 'snTable' })));
    }
  });
  const sorted = () => [...rows].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * (asc ? 1 : -1));
  async function scan() {
    const id = $('snPage').value, pages = id ? [App.pageById(id)] : App.pages;
    const since = Math.floor(new Date($('snFrom').value + 'T00:00').getTime() / 1000), until = Math.floor(new Date($('snTo').value + 'T23:59:59').getTime() / 1000);
    const max = Math.max(1, Number($('snMax').value) || 50);
    $('snGo').disabled = true; $('snLog').replaceChildren(h('div', { className: 'status pending', textContent: `Đang quét ${pages.length} Page…` }));
    const errors = [];
    const lists = await pool(pages, 4, async p => {
      try {
        const posts = await apiPaged(`/${p.id}/posts`, { since, until, limit: Math.min(100, max),
          fields: 'id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)' }, p.access_token, Math.ceil(max / 100) + 1);
        return posts.slice(0, max).map(x => {
          const r = { created: new Date(x.created_time).getTime(), page: p.name, message: (x.message || '').replace(/\s+/g, ' ').slice(0, 200), link: x.permalink_url,
            reactions: x.reactions?.summary?.total_count || 0, comments: x.comments?.summary?.total_count || 0, shares: x.shares?.count || 0 };
          r.total = r.reactions + r.comments + r.shares; return r;
        });
      } catch (e) { errors.push(`${p.name}: ${e.message}`); return []; }
    });
    rows = lists.flat();
    $('snGo').disabled = false;
    $('snLog').replaceChildren(h('div', { className: 'status ok', textContent: `Đã quét ${rows.length} bài.` }), ...errors.map(e => h('div', { className: 'status err', textContent: e })));
    draw();
  }
  function draw() {
    $('snTable').replaceChildren(rows.length ? h('table', {},
      h('thead', {}, h('tr', {}, ...COLS.map(([k, t]) => h('th', { className: 'sort' + (['page', 'message'].includes(k) ? ' left' : ''), textContent: t + (sortKey === k ? (asc ? ' ▲' : ' ▼') : ''),
        onclick: () => { asc = sortKey === k ? !asc : false; sortKey = k; draw(); } })))),
      h('tbody', {}, ...sorted().map(r => h('tr', {},
        h('td', { textContent: fmtShort(r.created) }), h('td', { className: 'left', textContent: r.page }),
        h('td', { className: 'left' }, h('a', { href: r.link, target: '_blank', rel: 'noopener', textContent: r.message || '(xem bài)' })),
        h('td', { textContent: num(r.reactions) }), h('td', { textContent: num(r.comments) }), h('td', { textContent: num(r.shares) }), h('td', { textContent: num(r.total) })))))
      : empty('Chọn Page, khoảng ngày rồi bấm Quét.'));
  }
})();
