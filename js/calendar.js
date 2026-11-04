/* Lịch nội dung (giống Công cụ lập kế hoạch của page-hub.js): lịch tháng gộp bài đã đăng, bài hẹn trên Facebook và hàng chờ của
 * Lịch đăng. Kéo bài hàng chờ (màu vàng) sang ngày khác để đổi ngày, giữ giờ; phải sau hiện tại ≥ 35 phút. */
(() => {
  let month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  let pageId = '', fbCache = new Map();
  App.tab('calendar', {
    mount(el) {
      el.append(h('div', { className: 'card' },
        h('div', { className: 'toolbar' },
          h('button', { className: 'btn btn-ghost', textContent: '‹', 'aria-label': 'Tháng trước', onclick: () => { month.setMonth(month.getMonth() - 1); this.refresh(); } }),
          h('strong', { id: 'caMonth', style: 'min-width:130px;text-align:center' }),
          h('button', { className: 'btn btn-ghost', textContent: '›', 'aria-label': 'Tháng sau', onclick: () => { month.setMonth(month.getMonth() + 1); this.refresh(); } }),
          Object.assign(App.pageSelect('Tất cả Page'), { id: 'caPage', onchange: e => { pageId = e.target.value; this.refresh(); } }),
          h('button', { className: 'btn btn-soft', onclick: () => { fbCache.clear(); this.refresh(); } }, icon('i-sync'), 'Tải lại'),
          h('span', { className: 'hint' }, h('span', { className: 'ev posted', style: 'display:inline' }, 'đã đăng'), ' ', h('span', { className: 'ev fb', style: 'display:inline' }, 'hẹn trên FB'), ' ',
            h('span', { className: 'ev queue', style: 'display:inline' }, 'hàng chờ'))),
        h('div', { className: 'log', id: 'caLog' }),
        h('div', { className: 'cal', id: 'caGrid' })));
    },
    async refresh() {
      const y = month.getFullYear(), m = month.getMonth();
      $('caMonth').textContent = `Tháng ${m + 1}/${y}`;
      const start = new Date(y, m, 1 - ((new Date(y, m, 1).getDay() + 6) % 7)); // bắt đầu từ thứ Hai
      const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      const from = days[0].getTime(), to = days[41].getTime() + 864e5;
      const pages = pageId ? [App.pageById(pageId)] : App.pages;
      const key = `${pageId}|${from}`;
      if (!fbCache.has(key)) {
        $('caLog').replaceChildren(h('div', { className: 'status pending', textContent: `Đang đọc bài của ${pages.length} Page…` }));
        const errors = [];
        const lists = await pool(pages, 5, async p => {
          const [posts, sched] = await Promise.all([
            to > Date.now() - 864e5 * 400 && from < Date.now() ? apiPaged(`/${p.id}/posts`, { fields: 'id,message,created_time,permalink_url', since: Math.floor(from / 1000), until: Math.floor(Math.min(to, Date.now()) / 1000), limit: 100 }, p.access_token, 2).catch(e => { errors.push(`${p.name}: ${e.message}`); return []; }) : [],
            to > Date.now() ? api(`/${p.id}/scheduled_posts`, { fields: 'id,message,scheduled_publish_time', limit: 100 }, 'GET', p.access_token).then(r => r.data).catch(() => []) : []]);
          return [...posts.map(x => ({ type: 'posted', at: new Date(x.created_time).getTime(), text: x.message, page: p, link: x.permalink_url })),
            ...sched.map(x => ({ type: 'fb', at: x.scheduled_publish_time * 1000, text: x.message, page: p, fbId: x.id }))];
        });
        fbCache.set(key, lists.flat());
        $('caLog').replaceChildren(...errors.map(e => h('div', { className: 'status err', textContent: e })));
      }
      const queue = (await DB.get('fbScheduleQueueV1', [])).filter(i => i.at && !['scheduled', 'posted'].includes(i.status) && (!pageId || App.planner.pageOf(i)?.id === pageId))
        .map(i => ({ type: ['error', 'missed'].includes(i.status) ? 'error' : 'queue', at: i.at, text: i.text, page: App.planner.pageOf(i), id: i.id }));
      const events = [...fbCache.get(key), ...queue].filter(e => e.at >= from && e.at < to).sort((a, b) => a.at - b.at);
      const today = new Date().toDateString();
      $('caGrid').replaceChildren(...['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => h('div', { className: 'dow', textContent: d })),
        ...days.map(d => {
          const evs = events.filter(e => new Date(e.at).toDateString() === d.toDateString());
          const cell = h('div', { className: 'day' + (d.getMonth() !== m ? ' out' : '') + (d.toDateString() === today ? ' today' : ''),
            ondragover: e => { e.preventDefault(); cell.classList.add('over'); }, ondragleave: () => cell.classList.remove('over'),
            ondrop: e => { e.preventDefault(); cell.classList.remove('over'); move(e.dataTransfer.getData('text/plain'), d); } },
            h('div', { className: 'num', textContent: d.getDate() }),
            ...evs.slice(0, 4).map(e => h(e.link ? 'a' : 'span', { className: 'ev ' + e.type, href: e.link || undefined, target: e.link ? '_blank' : undefined, rel: 'noopener',
              draggable: e.type === 'queue', ondragstart: ev => ev.dataTransfer.setData('text/plain', e.id),
              title: `${new Date(e.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · ${e.page?.name || ''}\n${e.text || ''}`,
              textContent: `${new Date(e.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${pageId ? '' : (e.page?.name || '').slice(0, 10) + ' · '}${(e.text || '(ảnh)').slice(0, 40)}` })),
            evs.length > 4 ? h('span', { className: 'hint', textContent: `+${evs.length - 4} bài` }) : null);
          return cell;
        }));
    }
  });
  async function move(id, day) {
    if (!id) return;
    const queue = await DB.get('fbScheduleQueueV1', []);
    const item = queue.find(i => i.id === id); if (!item) return;
    const old = new Date(item.at), next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes()).getTime();
    if (next < Date.now() + Pure.MIN_LEAD) return toast('Ngày mới phải sau hiện tại ít nhất 35 phút.');
    item.at = next; await DB.set('fbScheduleQueueV1', queue); App.tabs.calendar.refresh();
  }
})();
