/* Meta Assistant · giao diện không gian làm việc */
(() => {
  const copy = {
    inbox: 'Tất cả cuộc trò chuyện, trong một không gian.', templates: 'Những câu trả lời hay, luôn sẵn sàng.',
    crm: 'Theo sát từng khách hàng, từ lần đầu đến đơn tiếp theo.', bulk: 'Chăm sóc đúng nhóm khách, đúng thời điểm.',
    post: 'Biến ý tưởng thành nội dung trên các Page của bạn.', planner: 'Sắp xếp nội dung và duyệt lịch đăng theo cách của bạn.',
    scheduled: 'Theo dõi các bài đã hẹn trực tiếp trên Facebook.', topics: 'Giữ cảm hứng và định hướng nội dung cho từng Page.',
    botrules: 'Thiết lập câu trả lời phù hợp với từng từ khoá.', botcomments: 'Tiếp nhận khách hàng ngay từ bình luận đầu tiên.',
    botflows: 'Kết nối từng bước để tạo hành trình trò chuyện.', botmenu: 'Một lời chào rõ ràng. Một khởi đầu dễ dàng.',
    botlog: 'Xem hoạt động của bot và những đơn hàng mới.', comments: 'Lắng nghe và phản hồi các cuộc thảo luận.',
    scanner: 'Khám phá những nội dung đang được quan tâm.', dashboard: 'Một góc nhìn chung cho tất cả Page đang quản lý.',
    calendar: 'Bức tranh nội dung của bạn, theo từng ngày.', stats: 'Hiểu hiệu quả nội dung để quyết định bước tiếp theo.',
    sales: 'Quản lý đơn hàng và theo dõi kết quả kinh doanh.', settings: 'Thiết lập không gian làm việc phù hợp với bạn.'
  };
  const side = h('aside', { id: 'workspaceSidebar', className: 'workspace-sidebar', hidden: true, 'aria-label': 'Các chức năng' });
  const search = h('input', { type: 'search', placeholder: 'Tìm chức năng…', 'aria-label': 'Tìm chức năng' });
  const sections = h('div', { className: 'sidebar-sections' });
  for (const [group, [label, tabs]] of Object.entries(App.NAV)) {
    const section = h('section', { className: 'sidebar-section' }, h('h2', { textContent: label }));
    for (const [id, routeTitle, ic] of tabs) section.append(h('button', {
      type: 'button', className: 'sidebar-link', dataset: { route: id },
      onclick: () => { App.show(id); close(); title.focus(); }
    }, icon(ic), h('span', { textContent: routeTitle })));
    sections.append(section);
  }
  search.oninput = () => {
    for (const section of sections.children) {
      for (const button of section.querySelectorAll('button')) button.hidden = !norm(button.textContent).includes(norm(search.value));
      section.hidden = !section.querySelector('button:not([hidden])');
    }
  };
  side.append(h('button', { type: 'button', className: 'sidebar-close', textContent: '×', 'aria-label': 'Đóng danh mục', onclick: () => close(true) }), h('div', { className: 'sidebar-search' }, icon('i-search'), search), sections,
    h('div', { className: 'sidebar-footer' }, h('span', { className: 'connection-pip' }), 'Không gian quản lý Page'));
  const toggle = h('button', { id: 'menuToggle', type: 'button', className: 'icon-btn menu-toggle',
    'aria-label': 'Mở danh mục chức năng', 'aria-controls': side.id, 'aria-expanded': 'false', onclick: () => {
      const open = !document.body.classList.contains('sidebar-open');
      document.body.classList.toggle('sidebar-open', open); toggle.setAttribute('aria-expanded', String(open));
      if (open) side.querySelector('[aria-current="page"]')?.focus();
    }
  }, icon('i-grid'));
  const backdrop = h('button', { className: 'sidebar-backdrop', type: 'button', 'aria-label': 'Đóng danh mục', onclick: () => close(true) });
  function close(focus = false) {
    document.body.classList.remove('sidebar-open'); toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus();
  }
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('sidebar-open')) return;
    if (e.key === 'Escape') close(true);
    if (e.key === 'Tab') {
      const targets = [...side.querySelectorAll('button,input')].filter(el => !el.hidden && el.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.querySelector('.header-top').prepend(toggle);
  document.body.append(side, backdrop);
  const title = h('h2', { id: 'workspaceTitle', tabIndex: -1 });
  const subtitle = h('p', { id: 'workspaceDescription' });
  const scope = h('button', { type: 'button', className: 'workspace-scope', onclick: () => $('pageBtn').click() }, icon('i-grid'), h('span'));
  const intro = h('div', { className: 'workspace-intro', hidden: true },
    h('div', {}, h('div', { className: 'workspace-breadcrumb' }), title, subtitle), scope);
  document.querySelector('main').prepend(intro);
  function sync() {
    const current = App.current();
    const entry = Object.values(App.NAV).find(([, tabs]) => tabs.some(([id]) => id === current));
    if (!entry) return;
    const tab = entry[1].find(([id]) => id === current);
    title.textContent = tab[1]; subtitle.textContent = copy[current] || '';
    intro.querySelector('.workspace-breadcrumb').textContent = 'Không gian làm việc / ' + entry[0];
    scope.querySelector('span').textContent = App.selected().length + ' Page đang chọn';
    for (const button of side.querySelectorAll('[data-route]')) {
      if (button.dataset.route === current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
  }
  function ready() { document.body.classList.add('workspace-connected'); side.hidden = intro.hidden = false; sync(); }
  App.onLogin.push(ready); App.onPageChange.push(sync);
  new MutationObserver(sync).observe($('subnav'), { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
  const fitViewport = () => {
    document.documentElement.style.setProperty('--workspace-header-height', document.querySelector('.header').getBoundingClientRect().height + 'px');
    const visibleHeight = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--workspace-viewport-height', visibleHeight + 'px');
    document.body.classList.toggle('compact-chat', visibleHeight < 650);
    document.body.classList.toggle('keyboard-chat', window.innerWidth <= 620 && visibleHeight < window.innerHeight - 120 && document.activeElement?.id === 'ibText');
  };
  new ResizeObserver(fitViewport).observe(document.querySelector('.header'));
  window.addEventListener('resize', fitViewport);
  document.addEventListener('focusin', fitViewport);
  window.visualViewport?.addEventListener('resize', fitViewport);
  fitViewport();
  if (App.pages.length) ready();
})();
