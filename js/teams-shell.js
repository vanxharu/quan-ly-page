/* Giao diện kiểu Microsoft Teams:
 * - Thanh biểu tượng dọc bên trái: mỗi nhóm chức năng một nút (Trò chuyện, Đăng bài, Tự động, Tương tác, Quản lý), Cài đặt ở dưới cùng.
 * - Đầu nội dung: tên nhóm + các tab gạch chân (Hộp thư | Mẫu tin | …).
 * - Giữa thanh trên: ô tìm khách / chức năng (Ctrl+E).
 * Màu và bố cục nằm ở css/teams.css (body.teams). */
(() => {
  document.body.classList.add('teams');
  // Biểu tượng thêm cho thanh dọc (nét giống bộ biểu tượng có sẵn).
  const sprite = document.querySelector('svg[style*="display:none"]');
  sprite?.insertAdjacentHTML('beforeend',
    '<symbol id="i-chat2" viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 3 13.5"/><path d="M8 8.5h8M8 12h5"/></symbol>' +
    '<symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12z"/></symbol>' +
    '<symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></symbol>' +
    '<symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></symbol>');
  const RAIL = { messages: ['Trò chuyện', 'i-chat2'], publishing: ['Đăng bài', 'i-cal'], auto: ['Tự động', 'i-bolt'], engage: ['Tương tác', 'i-spark'], manage: ['Quản lý', 'i-chart'] };
  const groupOf = id => Object.keys(App.NAV).find(g => App.NAV[g][1].some(([t]) => t === id));

  // ── Thanh dọc ──
  const btn = (g, label, ic, onclick) => h('button', { type: 'button', className: 'tm-rail-btn', dataset: { g }, title: label, 'aria-label': label, onclick },
    h('span', { className: 'tm-rail-ico' }, icon(ic), h('b', { className: 'tm-badge', hidden: true })), h('span', { className: 'tm-rail-txt', textContent: label }));
  const rail = h('nav', { className: 'tm-rail', id: 'tmRail', hidden: true, 'aria-label': 'Các nhóm chức năng' },
    ...Object.keys(App.NAV).map(g => btn(g, RAIL[g]?.[0] || App.NAV[g][0], RAIL[g]?.[1] || 'i-grid', () => showGroup(g))),
    h('span', { className: 'tm-rail-gap' }),
    btn('settings', 'Cài đặt', 'i-gear', () => App.show('settings')));
  document.body.append(rail);

  // ── Tên nhóm + tab gạch chân ở đầu nội dung (dời thanh tab có sẵn #subnav vào đây) ──
  const title = h('h2', { className: 'tm-title' });
  const bar = h('div', { className: 'tm-bar', hidden: true }, title, $('subnav'));
  $('main').prepend(bar);

  function sync() {
    const cur = App.current(), g = groupOf(cur);
    for (const b of rail.querySelectorAll('.tm-rail-btn')) {
      const on = b.dataset.g === 'settings' ? cur === 'settings' : b.dataset.g === g && cur !== 'settings';
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    title.textContent = cur === 'settings' ? 'Cài đặt' : RAIL[g]?.[0] || App.NAV[g]?.[0] || '';
    document.body.dataset.tmTab = cur || '';
  }
  new MutationObserver(sync).observe($('subnav'), { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });

  // Số khách chưa đọc trên nút Trò chuyện.
  setInterval(() => {
    const n = App.inbox?.unreadTotal?.() || 0, b = rail.querySelector('[data-g="messages"] .tm-badge');
    if (!b) return; b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
  }, 2000);

  // ── Ô tìm kiếm giữa thanh trên: chức năng + khách trong Hộp thư ──
  const input = h('input', { type: 'search', id: 'tmSearch', placeholder: 'Tìm khách, chức năng… (Ctrl+E)', 'aria-label': 'Tìm khách hoặc chức năng', autocomplete: 'off' });
  const pop = h('div', { className: 'tm-search-pop', hidden: true, role: 'listbox' });
  const box = h('div', { className: 'tm-search', hidden: true }, icon('i-search'), input, pop);
  document.querySelector('.header-top .page-picker')?.before(box);
  let items = [], sel = 0;
  const go = it => { input.value = ''; pop.hidden = true; input.blur(); it?.run(); };
  function draw() {
    const q = norm(input.value.trim());
    if (!q) { pop.hidden = true; return; }
    const tabs = Object.entries(App.NAV).flatMap(([g, [gl, list]]) => list.map(([id, label, ic]) => ({ ic, label, sub: RAIL[g]?.[0] || gl, run: () => App.show(id), hay: norm(label + ' ' + gl) })))
      .filter(t => t.hay.includes(q)).slice(0, 6);
    const people = (App.inbox?.search?.(input.value.trim()) || []).slice(0, 8).map(c => ({ pic: c.pic, label: c.name, sub: c.page, run: () => { App.show('inbox'); setTimeout(() => App.inbox.openId(c.id), 50); } }));
    items = [...people, ...tabs]; sel = 0;
    pop.replaceChildren(...(people.length ? [h('div', { className: 'tm-search-h', textContent: 'Khách' })] : []),
      ...people.map((it, i) => row(it, i)),
      ...(tabs.length ? [h('div', { className: 'tm-search-h', textContent: 'Chức năng' })] : []),
      ...tabs.map((it, i) => row(it, people.length + i)),
      ...(items.length ? [] : [h('div', { className: 'tm-search-empty', textContent: 'Không tìm thấy khách hay chức năng nào.' })]));
    pop.hidden = false; mark();
  }
  const row = (it, i) => h('button', { type: 'button', className: 'tm-search-row', dataset: { i }, onmousedown: e => { e.preventDefault(); go(it); } },
    it.pic ? h('img', { src: it.pic, alt: '' }) : it.ic ? h('span', { className: 'tm-search-ico' }, icon(it.ic)) : h('span', { className: 'tm-search-ava', textContent: (it.label || '?').trim()[0]?.toUpperCase() || '?' }),
    h('span', { className: 'tm-search-txt' }, h('b', { textContent: it.label }), h('small', { textContent: it.sub || '' })));
  const mark = () => pop.querySelectorAll('.tm-search-row').forEach(r => r.classList.toggle('on', +r.dataset.i === sel));
  input.oninput = draw; input.onfocus = draw;
  input.onblur = () => setTimeout(() => { pop.hidden = true; }, 120);
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
    else if (e.key === 'Escape') { input.value = ''; pop.hidden = true; input.blur(); }
  };
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'e' && !box.hidden) { e.preventDefault(); input.focus(); input.select(); } });

  function ready() { rail.hidden = bar.hidden = box.hidden = false; document.body.classList.add('teams-on'); sync(); }
  App.onLogin.push(ready);
  if (App.pages.length) ready();
})();
