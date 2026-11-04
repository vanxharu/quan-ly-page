/* Tổng quan (giống Bảng điều khiển của page-hub.js): mỗi Page một thẻ — người theo dõi, hội thoại chưa đọc, bài hẹn trên FB,
 * bài gần nhất (cảnh báo quá 3 ngày), bài trong hàng chờ/lỗi; tổng cộng và cảnh báo ở trên. Bấm thẻ để mở Hộp thư của Page. */
(() => {
  let cache = null, at = 0, cacheKey = '';
  App.tab('dashboard', {
    mount(el) {
      el.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', id: 'dbTitle', textContent: 'Tổng quan các Page đang chọn' }),
        h('button', { className: 'btn btn-soft', onclick: () => { cache = null; this.refresh(); } }, icon('i-sync'), 'Cập nhật')),
        h('div', { className: 'kpis', id: 'dbKpis' }), h('div', { id: 'dbAlerts' }), h('div', { className: 'pcards section-gap', id: 'dbCards' }));
    },
    async refresh() {
      const sel = App.selected(), selKey = sel.map(p => p.id).join();
      if (!cache || cacheKey !== selKey || Date.now() - at > 5 * 60e3) {
        cacheKey = selKey;
        $('dbCards').replaceChildren(empty(`Đang đọc số liệu của ${sel.length} Page…`));
        cache = await pool(sel, 5, async p => {
          const t = p.access_token, r = { page: p };
          const [info, convs, sched, last] = await Promise.all([
            api(`/${p.id}`, { fields: 'followers_count,fan_count' }, 'GET', t).catch(e => ({ error: e.message })),
            api(`/${p.id}/conversations`, { platform: 'messenger', fields: 'unread_count', limit: 50 }, 'GET', t).catch(() => ({ data: [] })),
            api(`/${p.id}/scheduled_posts`, { fields: 'id', limit: 100 }, 'GET', t).catch(() => ({ data: [] })),
            api(`/${p.id}/posts`, { fields: 'created_time', limit: 1 }, 'GET', t).catch(() => ({ data: [] }))]);
          r.error = info.error; r.followers = info.followers_count ?? info.fan_count ?? 0;
          r.unread = (convs.data || []).filter(c => c.unread_count).length;
          r.scheduled = (sched.data || []).length;
          r.lastPost = last.data?.[0] ? new Date(last.data[0].created_time).getTime() : 0;
          return r;
        });
        at = Date.now();
      }
      const queue = await DB.get('fbScheduleQueueV1', []);
      const appts = (await DB.get('inboxApptsV1', [])).filter(a => !a.done);
      const rows = cache.map(r => {
        const q = queue.filter(i => App.planner.pageOf(i)?.id === r.page.id);
        return { ...r, drafts: q.filter(i => ['draft', 'approved'].includes(i.status)).length, errors: q.filter(i => ['error', 'missed'].includes(i.status)).length,
          appts: appts.filter(a => a.pageId === r.page.id).length, stale: !r.lastPost || Date.now() - r.lastPost > 3 * 864e5 };
      });
      const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
      $('dbTitle').textContent = `Tổng quan ${rows.length} Page · cập nhật ${new Date(at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
      $('dbKpis').replaceChildren(...[['Người theo dõi', num(sum('followers'))], ['Hội thoại chưa đọc', num(sum('unread'))], ['Bài hẹn trên FB', num(sum('scheduled'))],
        ['Bài trong Lịch đăng', num(sum('drafts'))], ['Nhắc hẹn chưa xong', num(sum('appts'))]].map(([l, v]) => h('div', { className: 'kpi' }, h('div', { className: 'label', textContent: l }), h('div', { className: 'value', textContent: v }))));
      const alerts = [
        ...rows.filter(r => r.unread).map(r => ['pending', `💬 ${r.page.name}: ${r.unread} hội thoại chưa đọc`, () => App.openConversation(r.page.id, '')]),
        ...rows.filter(r => r.errors).map(r => ['err', `⚠ ${r.page.name}: ${r.errors} bài lỗi/lỡ giờ trong Lịch đăng`, () => App.show('planner')]),
        ...rows.filter(r => r.stale && !r.error).map(r => ['pending', `🕒 ${r.page.name}: ${r.lastPost ? 'đã ' + Math.floor((Date.now() - r.lastPost) / 864e5) + ' ngày chưa đăng' : 'chưa có bài'}`, () => { App.setSelected([r.page.id]); App.show('post'); }])];
      $('dbAlerts').replaceChildren(...alerts.slice(0, 12).map(([cls, t, fn]) => h('div', { className: 'status ' + cls, style: 'margin-bottom:4px;cursor:pointer', textContent: t, onclick: fn })));
      $('dbCards').replaceChildren(...rows.sort((a, b) => b.unread - a.unread || b.followers - a.followers).map(r => h('div', { className: 'pcard', onclick: () => App.openConversation(r.page.id, '') },
        h('div', { className: 'n', title: r.page.name, style: 'display:flex;gap:8px;align-items:center' }, App.avatar(r.page.name, App.pageAvatarUrl(r.page), 26), h('span', { style: 'overflow:hidden;text-overflow:ellipsis', textContent: r.page.name })),
        r.error ? h('div', { className: 'status err', textContent: r.error }) : h('div', { className: 'm' },
          h('span', {}, 'Theo dõi ', h('b', { textContent: num(r.followers) })), h('span', {}, 'Chưa đọc ', h('b', { textContent: r.unread })),
          h('span', {}, 'Hẹn FB ', h('b', { textContent: r.scheduled })), h('span', {}, 'Hàng chờ ', h('b', { textContent: r.drafts })),
          h('span', { style: 'grid-column:1/-1' + (r.stale ? ';color:var(--err-text)' : '') }, 'Bài gần nhất: ', h('b', { textContent: r.lastPost ? fmtShort(r.lastPost) : 'chưa có' }))))));
    }
  });
})();
