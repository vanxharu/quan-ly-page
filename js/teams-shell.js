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
    '<symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></symbol>' +
    '<symbol id="i-tpl" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></symbol>' +
    '<symbol id="i-clip" viewBox="0 0 24 24"><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7.6"/></symbol>' +
    '<symbol id="i-receipt" viewBox="0 0 24 24"><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></symbol>');
  const cut = 'style="stroke:var(--ico-cut,currentColor)"', cutf = 'style="stroke:var(--ico-cut,currentColor);fill:var(--ico-cutfill,none)"';
  sprite?.insertAdjacentHTML('beforeend',
    `<symbol id="r-chat" viewBox="0 0 24 24"><path d="M12 3.5c-4.9 0-8.8 3.3-8.8 7.4 0 2.3 1.2 4.4 3.2 5.8l-.6 3.8 4.2-2.3c.6.1 1.3.2 2 .2 4.9 0 8.8-3.3 8.8-7.5S16.9 3.5 12 3.5z"/><path ${cut} d="M8.3 9.6h7.4M8.3 12.6h4.6"/></symbol>` +
    `<symbol id="r-cal" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path ${cut} d="M3.8 9.6h16.4M8 13.2h.01M12 13.2h.01M16 13.2h.01M8 16.6h.01M12 16.6h.01"/><path d="M8 3v3.5M16 3v3.5"/></symbol>` +
    `<symbol id="r-bolt" viewBox="0 0 24 24"><path d="M13.2 2.8 5 13.4h6.4l-.9 7.8 8.4-10.8h-6.6z"/></symbol>` +
    `<symbol id="r-heart" viewBox="0 0 24 24"><path d="M12 20.2s-7.6-4.6-7.6-10.4A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.6 2.7c0 5.8-7.6 10.4-7.6 10.4z"/></symbol>` +
    `<symbol id="r-chart" viewBox="0 0 24 24"><rect x="4" y="11" width="4" height="9" rx="1.2"/><rect x="10" y="4.5" width="4" height="15.5" rx="1.2"/><rect x="16" y="13.5" width="4" height="6.5" rx="1.2"/></symbol>` +
    `<symbol id="r-gear" viewBox="0 0 24 24"><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/><circle ${cutf} cx="12" cy="12" r="3"/></symbol>` +
    '<symbol id="i-dots" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></symbol>' +
    '<symbol id="i-back" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></symbol><symbol id="i-fwd" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></symbol>');
  const RAIL = { messages: ['Trò chuyện', 'r-chat'], publishing: ['Đăng bài', 'r-cal'], auto: ['Tự động', 'r-bolt'], engage: ['Tương tác', 'r-heart'], manage: ['Quản lý', 'r-chart'] };
  const groupOf = id => Object.keys(App.NAV).find(g => App.NAV[g][1].some(([t]) => t === id));

  // ── Thanh dọc ──
  const btn = (g, label, ic, onclick) => h('button', { type: 'button', className: 'tm-rail-btn', dataset: { g }, title: label, 'aria-label': label, onclick },
    h('span', { className: 'tm-rail-ico' }, icon(ic), h('b', { className: 'tm-badge', hidden: true })), h('span', { className: 'tm-rail-txt', textContent: label }));
  const rail = h('nav', { className: 'tm-rail', id: 'tmRail', hidden: true, 'aria-label': 'Các nhóm chức năng' },
    ...Object.keys(App.NAV).map(g => btn(g, RAIL[g]?.[0] || App.NAV[g][0], RAIL[g]?.[1] || 'i-grid', () => showGroup(g))),
    h('span', { className: 'tm-rail-gap' }),
    btn('settings', 'Cài đặt', 'r-gear', () => App.show('settings')));
  document.body.append(rail);

  // ── Tên nhóm + tab gạch chân ở đầu nội dung (dời thanh tab có sẵn #subnav vào đây) ──
  const title = h('h2', { className: 'tm-title' });
  const bar = h('div', { className: 'tm-bar', hidden: true }, title, $('subnav'));
  $('main').prepend(bar);

  // ← → như Teams: quay lại / tới các màn đã mở.
  const hist = []; let at = -1, jumping = false;
  const back = h('button', { type: 'button', className: 'icon-btn tm-navbtn', title: 'Quay lại', 'aria-label': 'Quay lại', disabled: true, onclick: () => go2(-1) }, icon('i-back'));
  const fwd = h('button', { type: 'button', className: 'icon-btn tm-navbtn', title: 'Tiếp', 'aria-label': 'Tiếp', disabled: true, onclick: () => go2(1) }, icon('i-fwd'));
  const go2 = d => { const i = at + d; if (i < 0 || i >= hist.length) return; at = i; jumping = true; App.show(hist[i]); jumping = false; navState(); };
  const navState = () => { back.disabled = at <= 0; fwd.disabled = at >= hist.length - 1; };
  function sync() {
    const cur = App.current(), g = groupOf(cur);
    if (cur && !jumping && hist[at] !== cur) { hist.splice(at + 1); hist.push(cur); if (hist.length > 50) hist.shift(); at = hist.length - 1; } navState();
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
  const input = h('input', { type: 'search', id: 'tmSearch', placeholder: 'Tìm kiếm (Ctrl+E)', 'aria-label': 'Tìm khách hoặc chức năng', autocomplete: 'off' });
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

  const top = document.querySelector('.header-top');
  const nav = h('div', { className: 'tm-nav' }, back, fwd);
  box.before(nav);
  const right = h('div', { className: 'tm-right' });
  // Menu "…": giao diện sáng / tối, khung ngầm, phiên bản & cập nhật, thanh tiêu đề Windows, đăng xuất.
  const more = h('button', { type: 'button', className: 'icon-btn tm-more', title: 'Cài đặt và nhiều hơn', 'aria-label': 'Cài đặt và nhiều hơn', 'aria-haspopup': 'true' }, icon('i-dots'));
  const menu = h('div', { className: 'tm-menu', hidden: true, role: 'menu' });
  const item = (ic, text, fn, sub = '') => h('button', { type: 'button', role: 'menuitem', className: 'tm-menu-item', onclick: () => { menu.hidden = true; fn(); } },
    h('span', { className: 'tm-menu-ico', textContent: ic }), h('span', { className: 'tm-menu-txt' }, h('span', { textContent: text }), sub ? h('small', { textContent: sub }) : null));
  more.onclick = async e => { e.stopPropagation(); if (!menu.hidden) { menu.hidden = true; return; }
    const dark = document.body.classList.contains('dark-mode'), st = $('bgStatus'), tag = document.querySelector('.pro-tag');
    const fr = window.metaDesktop?.uiFrame ? await window.metaDesktop.uiFrame(null).catch(() => null) : null;
    menu.replaceChildren(
      item(dark ? '☀' : '☾', dark ? 'Giao diện sáng' : 'Giao diện tối', () => $('btnDark').click()),
      st && !st.hidden ? item('●', 'Khung ngầm', () => setTimeout(() => st.click(), 0), st.textContent.trim()) : null,
      tag?.textContent?.trim() ? item('↻', 'Kiểm tra cập nhật', () => tag.click(), 'Phiên bản ' + tag.textContent.trim()) : null,
      fr?.canToggle ? item('▭', fr.frameless ? 'Dùng thanh tiêu đề Windows' : 'Dùng thanh trên kiểu Teams', () => {
        if (confirm(fr.frameless ? 'Dùng lại thanh tiêu đề của Windows (nếu không kéo được cửa sổ)? App sẽ mở lại.' : 'Dùng thanh trên kiểu Teams? App sẽ mở lại.')) window.metaDesktop.uiFrame(fr.frameless); }) : null,
      item('🌐', window.I18N?.lang === 'en' ? 'Tiếng Việt' : 'English', () => window.I18N.set(window.I18N.lang === 'en' ? 'vi' : 'en'), 'Language / Ngôn ngữ'),
      h('div', { className: 'tm-menu-sep' }),
      item('⎋', 'Đăng xuất khỏi trang', () => $('btnLogout').click()));
    menu.hidden = false; };
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.hidden = true; });
  // Chấm trạng thái trên ảnh Page = trạng thái khung ngầm (xanh: sẵn sàng, vàng: đang mở, xám: chưa mở).
  const dot = h('span', { className: 'tm-presence' });
  const syncDot = () => { if (!dot.isConnected) $('pageBtn')?.append(dot); const st = $('bgStatus'); dot.className = 'tm-presence ' + (st && !st.hidden ? (st.className.match(/\b(fast|ready|loading|none|idle)\b/)?.[1] || '') : 'off'); dot.title = st && !st.hidden ? st.textContent.trim() : ''; };
  setInterval(syncDot, 1500);
  // Màu hàng nút thu nhỏ / phóng to / đóng (app Windows) theo giao diện.
  const syncTitle = () => { if (!window.metaDesktop?.titleBar) return; const cs = getComputedStyle(document.body);
    const hex = v => { const m = String(v).trim().match(/^#([0-9a-f]{6})$/i); return m ? '#' + m[1] : null; };
    window.metaDesktop.titleBar({ color: hex(cs.getPropertyValue('--tm-chrome')) || '#0c1820', symbol: document.body.classList.contains('dark-mode') ? '#ffffff' : '#242424' }); };
  new MutationObserver(syncTitle).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncTitle();
  function ready() {
    rail.hidden = bar.hidden = box.hidden = false; document.body.classList.add('teams-on');
    if (!right.isConnected) { // gom phần bên phải: cập nhật · trạng thái (ẩn, dùng qua menu) · … · ảnh Page
      const pk = $('pagePicker'); top.append(right); right.append($('btnUpdate'), document.querySelector('.bg-status-wrap') || '', h('span', { className: 'tm-more-wrap' }, more, menu), pk);
      $('pageBtn')?.append(dot); }
    sync(); syncTitle(); syncDot();
  }
  App.onLogin.push(ready);
  if (App.pages.length) ready();
})();
