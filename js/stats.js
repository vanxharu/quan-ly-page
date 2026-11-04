/* Số liệu Page: 28 ngày qua (chỉ số còn dùng được sau đợt Meta bỏ page_impressions*), và bản đồ giờ đăng theo tương tác
 * của bài 90 ngày qua (giống mục Thống kê của page-hub.js): 3 giờ tốt nhất (≥ 2 bài) đặt được làm khung giờ trong Lịch đăng. */
(() => {
  const METRICS = { page_media_view: 'Lượt xem', page_total_media_view_unique: 'Người xem', page_post_engagements: 'Tương tác', page_follows: 'Người theo dõi' };
  App.tab('stats', {
    mount(el) {
      el.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Số liệu 28 ngày qua' }), h('button', { className: 'btn btn-soft', onclick: () => this.refresh() }, icon('i-sync'), 'Tải lại')),
        h('div', { className: 'kpis', id: 'stKpis' }), h('div', { className: 'card' }, h('div', { className: 'bars', id: 'stBars' }), h('div', { className: 'scroll section-gap', id: 'stTable' })),
        h('div', { className: 'card' }, h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Giờ đăng hiệu quả (bài 90 ngày qua)' })), h('div', { id: 'stHeat' })));
    },
    async refresh() {
      await guard($('stTable'), insights);
      await guard($('stHeat'), heat);
    }
  });
  async function insights() {
    const pid = App.page().id, until = Math.floor(Date.now() / 1000), since = until - 28 * 86400;
    const info = await api(`/${pid}`, { fields: 'followers_count,fan_count' });
    // Gọi từng chỉ số riêng: một chỉ số bị Meta bỏ thì các chỉ số khác vẫn hiện.
    const rows = {}, cols = [], errors = [];
    await Promise.all(Object.keys(METRICS).map(async m => {
      try {
        const res = await api(`/${pid}/insights`, { metric: m, period: 'day', since, until });
        for (const v of res.data[0]?.values || []) (rows[v.end_time.slice(0, 10)] ||= {})[m] = typeof v.value === 'number' ? v.value : Object.values(v.value || {}).reduce((a, b) => a + b, 0);
        cols.push(m);
      } catch (e) { errors.push(`${METRICS[m]}: ${e.message}`); }
    }));
    const order = Object.keys(METRICS).filter(m => cols.includes(m));
    const days = Object.keys(rows).sort();
    const total = m => days.reduce((s, d) => s + (rows[d][m] || 0), 0);
    $('stKpis').replaceChildren(h('div', { className: 'kpi' }, h('div', { className: 'label', textContent: 'Người theo dõi hiện tại' }), h('div', { className: 'value', textContent: num(info.followers_count ?? info.fan_count ?? 0) })),
      ...order.map(m => h('div', { className: 'kpi' }, h('div', { className: 'label', textContent: METRICS[m] + ' (28 ngày)' }), h('div', { className: 'value', textContent: num(total(m)) }))));
    const main = order[0], peak = Math.max(1, ...days.map(d => rows[d][main] || 0));
    $('stBars').replaceChildren(...(main ? days.map(d => h('div', { className: 'b', style: `height:${Math.max(2, (rows[d][main] || 0) / peak * 100)}%`, dataset: { tip: `${d.slice(8)}/${d.slice(5, 7)}: ${num(rows[d][main] || 0)} ${METRICS[main].toLowerCase()}` } })) : []));
    $('stTable').replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, h('th', { textContent: 'Ngày' }), ...order.map(m => h('th', { textContent: METRICS[m] })))),
      h('tbody', {}, ...[...days].reverse().map(d => h('tr', {}, h('td', { textContent: d.split('-').reverse().join('/') }), ...order.map(m => h('td', { textContent: rows[d][m] == null ? '' : num(rows[d][m]) })))))),
      ...errors.map(e => h('p', { className: 'hint', textContent: e })));
  }
  async function heat() {
    const page = App.page();
    const posts = await apiPaged(`/${page.id}/posts`, { since: Math.floor(Date.now() / 1000) - 90 * 86400, limit: 100,
      fields: 'created_time,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)' }, page.access_token, 3);
    if (!posts.length) return $('stHeat').replaceChildren(empty('Chưa có bài trong 90 ngày qua.'));
    const cell = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, sum: 0 })));
    const byHour = Array.from({ length: 24 }, () => ({ n: 0, sum: 0 }));
    for (const p of posts) {
      const d = new Date(p.created_time), e = (p.reactions?.summary?.total_count || 0) + (p.comments?.summary?.total_count || 0) + (p.shares?.count || 0);
      const c = cell[(d.getDay() + 6) % 7][d.getHours()]; c.n++; c.sum += e;
      byHour[d.getHours()].n++; byHour[d.getHours()].sum += e;
    }
    const max = Math.max(1, ...cell.flat().map(c => c.n ? c.sum / c.n : 0));
    const best = byHour.map((x, hr) => ({ hr, avg: x.n >= 2 ? x.sum / x.n : -1, n: x.n })).filter(x => x.avg >= 0).sort((a, b) => b.avg - a.avg).slice(0, 3);
    const windows = best.map(b => `${String(b.hr).padStart(2, '0')}:00–${String(b.hr + 1).padStart(2, '0')}:00`).join(', ');
    $('stHeat').replaceChildren(
      h('div', { className: 'scroll' }, h('div', { className: 'heat', style: 'min-width:560px' }, h('span'), ...Array.from({ length: 24 }, (_, i) => h('span', { className: 'l', textContent: i % 3 ? '' : i })),
        ...['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].flatMap((d, w) => [h('span', { className: 'l', textContent: d }),
          ...cell[w].map((c, hr) => h('span', { className: 'c', title: c.n ? `${d} ${hr}h: ${c.n} bài, TB ${Math.round(c.sum / c.n)} tương tác` : '',
            style: c.n ? `background:color-mix(in srgb, var(--primary) ${Math.round(15 + 85 * (c.sum / c.n) / max)}%, transparent)` : '' }))]))),
      h('div', { className: 'row', style: 'margin-top:12px' },
        best.length ? h('span', {}, 'Giờ tốt nhất (≥ 2 bài): ', h('b', { textContent: best.map(b => `${b.hr}h (TB ${Math.round(b.avg)})`).join(' · ') })) : h('span', { className: 'hint', textContent: 'Chưa đủ dữ liệu (cần ≥ 2 bài cùng giờ).' }),
        best.length ? h('button', { className: 'btn btn-soft btn-sm', textContent: 'Đặt làm khung giờ Lịch đăng cho Page này', onclick: async () => {
          const s = await DB.get('fbScheduleSettingsV1', {});
          s.pages ||= {}; s.pages[page.id] = { ...(s.pages[page.id] || { perDay: s.perDay || 1, weekdays: s.weekdays || [0, 1, 2, 3, 4, 5, 6] }), windows };
          await DB.set('fbScheduleSettingsV1', s); toast(`Đã đặt khung giờ ${windows} cho ${page.name}.`);
        } }) : null),
      h('p', { className: 'hint', textContent: `Tính từ ${posts.length} bài: tương tác = cảm xúc + bình luận + chia sẻ. Ô càng đậm, trung bình càng cao.` }));
  }
})();
