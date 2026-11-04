/* Hộp thư (giống inbox-tab.js của tiện ích, nhưng đọc qua Graph API): một hoặc tất cả Page, lọc, thời gian khách chờ,
 * tự gắn nhãn theo lời khách (InboxRules), mẫu tin bằng nút "Mẫu" hoặc gõ "/", ảnh đính kèm, khung CRM, báo tin mới. */
(() => {
  const S = { scope: local.get('ibScope') || 'one', filter: 'all', convs: [], conv: null, tpl: null, image: '', loading: 0 };
  const settings = async () => InboxRules.withDefaults(await DB.get(InboxRules.SETTINGS_KEY));

  async function fetchConvs(page, limit = 50) {
    const res = await api(`/${page.id}/conversations`, { platform: 'messenger', limit,
      fields: 'id,updated_time,snippet,unread_count,participants,messages.limit(1){from,created_time}' }, 'GET', page.access_token);
    return (res.data || []).map(c => {
      const other = c.participants?.data.find(u => u.id !== page.id) || {};
      const last = c.messages?.data?.[0];
      return { ...c, page, other, fromCustomer: last ? last.from?.id !== page.id : true,
        lastAt: new Date(last?.created_time || c.updated_time).getTime(), key: App.crmKey(page.id, other.name) };
    });
  }
  App.inbox = { fetchConvs };
  App.openConversation = (pageId, name) => {
    if (App.pageById(pageId)) { $('page').value = pageId; local.set('lastPage', pageId); }
    S.scope = 'one'; S.pending = name; App.show('inbox');
  };

  App.tab('inbox', {
    mount(el) {
      const picker = App.templates.picker(t => pickTemplate(t));
      S.picker = picker;
      el.append(h('div', { className: 'split' },
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Hội thoại' }),
            h('div', { className: 'row', style: 'gap:6px' },
              h('select', { id: 'ibScope', style: 'width:auto', onchange: e => { S.scope = e.target.value; local.set('ibScope', S.scope); load(); } },
                h('option', { value: 'one', textContent: 'Page đang chọn' }), h('option', { value: 'all', textContent: 'Tất cả Page' })),
              h('button', { className: 'btn btn-soft', onclick: () => load() }, icon('i-sync'), 'Tải lại'))),
          h('input', { type: 'search', id: 'ibSearch', placeholder: '🔍 Tìm theo tên khách hoặc nội dung tin…', oninput: () => drawList() }),
          h('div', { className: 'row', style: 'margin:10px 0;gap:6px' },
            h('div', { className: 'chips', id: 'ibFilter' }, ...[['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['unanswered', 'Chưa trả lời'], ['today', 'Hôm nay']].map(([f, t]) =>
              h('button', { className: 'chip', dataset: { f }, textContent: t, 'aria-pressed': String(f === S.filter), onclick: () => { S.filter = f; drawList(); } }))),
            h('select', { id: 'ibLabel', style: 'width:auto;padding:4px 8px;font-size:12px', onchange: () => drawList() })),
          h('div', { className: 'list', id: 'ibList' })),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', id: 'ibTitle', textContent: 'Chưa chọn hội thoại' }),
            h('button', { className: 'btn btn-ghost', id: 'ibReload', hidden: true, textContent: 'Đọc lại', onclick: () => S.conv && openConv(S.conv) })),
          h('div', { className: 'thread', id: 'ibThread' }, empty('Chọn một hội thoại bên trái để xem tin nhắn.')),
          h('div', { id: 'ibCrm', className: 'crm', hidden: true }),
          h('div', { className: 'composer' },
            h('div', { className: 'popover', id: 'ibPicker', hidden: true }, picker.el),
            h('div', { className: 'attach', id: 'ibAttach', hidden: true }),
            h('div', { className: 'composer-row' },
              h('button', { className: 'tpl-btn', id: 'ibTplBtn', onclick: () => togglePicker() }, icon('i-msg'), 'Mẫu'),
              h('label', { className: 'tpl-btn', title: 'Đính kèm ảnh' }, '📎', h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
                const f = e.target.files[0]; if (f) { S.image = await fileToDataUrl(f); drawAttach(); } e.target.value = '';
              } })),
              h('textarea', { id: 'ibText', placeholder: 'Nhập tin trả lời… (gõ / để chọn mẫu)', rows: 1, oninput: onType, onkeydown: onKey }),
              h('button', { className: 'send-btn', id: 'ibSend', disabled: true, 'aria-label': 'Gửi', onclick: send }, icon('i-send'))),
            h('div', { className: 'hint', style: 'margin-top:6px' }, h('kbd', {}, 'Enter'), ' gửi · ', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Enter'), ' xuống dòng · ',
              h('kbd', {}, '/'), ' chọn mẫu · chỉ trả lời được trong 24 giờ kể từ tin cuối của khách')))));
    },
    refresh() { $('ibScope').value = S.scope; load(); }
  });
  App.onPageChange.push(() => { S.conv = null; resetThread(); });

  async function load() {
    const pages = S.scope === 'all' ? App.pages : [App.page()];
    const run = ++S.loading;
    $('ibList').replaceChildren(empty(`Đang tải hội thoại của ${pages.length} Page…`));
    const errors = [];
    const lists = await pool(pages, 5, p => fetchConvs(p).catch(e => { errors.push(`${p.name}: ${e.message}`); return []; }));
    if (run !== S.loading) return;
    S.convs = lists.flat().sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
    S.crm = await App.crm.all();
    const labels = await App.crm.allLabels();
    const cur = $('ibLabel').value;
    $('ibLabel').replaceChildren(h('option', { value: '', textContent: 'Mọi nhãn' }), ...labels.map(l => h('option', { value: l, textContent: l, selected: l === cur })));
    S.errors = errors;
    if (S.pending) { $('ibSearch').value = S.pending; const hit = S.convs.find(c => norm(c.other.name) === norm(S.pending)); S.pending = ''; if (hit) openConv(hit); }
    drawList();
  }
  async function drawList() {
    const st = await settings();
    const q = norm($('ibSearch').value), lab = $('ibLabel').value, today = new Date().toDateString();
    [...$('ibFilter').children].forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === S.filter)));
    const list = S.convs.filter(c =>
      (S.filter !== 'unread' || c.unread_count) && (S.filter !== 'unanswered' || c.fromCustomer) &&
      (S.filter !== 'today' || new Date(c.updated_time).toDateString() === today) &&
      (!lab || (S.crm?.[c.key]?.labels || []).includes(lab)) &&
      (!q || norm(`${c.other.name} ${c.snippet} ${(S.crm?.[c.key]?.labels || []).join(' ')}`).includes(q)));
    const multi = S.scope === 'all';
    $('ibList').replaceChildren(...(S.errors || []).map(e => h('div', { className: 'status err', textContent: e })),
      ...(list.length ? list.map(c => {
        const wait = c.fromCustomer ? (Date.now() - c.lastAt) / 60e3 : null;
        const labels = S.crm?.[c.key]?.labels || [];
        return h('div', { className: 'item' + (c.unread_count ? ' unread' : '') + (S.conv?.id === c.id ? ' active' : ''), onclick: () => openConv(c) },
          h('div', { className: 'avatar', textContent: initials(c.other.name) }),
          h('div', { className: 'body' },
            h('div', { className: 'top' }, h('span', { className: 'name', textContent: c.other.name || 'Khách' }),
              c.unread_count ? h('span', { className: 'badge', textContent: c.unread_count }) : null,
              h('span', { className: 'time', textContent: fmtShort(c.updated_time) })),
            h('div', { className: 'snippet', textContent: c.snippet || '' }),
            (multi || wait != null || labels.length) ? h('div', { className: 'tags' },
              multi ? h('span', { className: 'page-chip', textContent: c.page.name }) : null,
              wait != null && wait < 7 * 1440 ? h('span', { className: 'wait' + (wait > st.waitMinutes ? ' late' : ''), title: 'Khách đang chờ trả lời', textContent: '⏳ ' + InboxRules.formatWait(wait) }) : null,
              ...labels.slice(0, 3).map(l => tag(l))) : null));
      }) : [empty(S.convs.length ? 'Không có hội thoại khớp bộ lọc.' : 'Chưa có tin nhắn.')]));
  }
  function resetThread() {
    $('ibTitle').textContent = 'Chưa chọn hội thoại'; $('ibReload').hidden = true; $('ibSend').disabled = true; $('ibCrm').hidden = true;
    $('ibThread').replaceChildren(empty('Chọn một hội thoại bên trái để xem tin nhắn.'));
  }
  async function openConv(c) {
    S.conv = c;
    $('ibTitle').textContent = `${c.other.name || 'Khách'}${S.scope === 'all' ? ' · ' + c.page.name : ''}`;
    $('ibReload').hidden = false; $('ibSend').disabled = !c.other.id;
    drawList();
    await guard($('ibThread'), async () => {
      const res = await api(`/${c.id}`, { fields: 'messages.limit(40){message,from,created_time,attachments{image_data,mime_type,name,file_url}}' }, 'GET', c.page.access_token);
      if (S.conv !== c) return;
      const msgs = (res.messages?.data || []).reverse();
      $('ibThread').replaceChildren(...msgs.map(m => h('div', { className: 'msg' + (m.from?.id === c.page.id ? ' me' : ''), title: fmtTime(m.created_time) },
        m.message || null,
        ...(m.attachments?.data || []).map(a => a.image_data?.url ? h('img', { src: a.image_data.url, alt: '', style: 'display:block;max-width:220px;border-radius:10px;margin-top:4px' })
          : h('a', { href: a.file_url || '#', target: '_blank', rel: 'noopener', textContent: `📎 ${a.name || 'Tệp đính kèm'}` })),
        !m.message && !m.attachments?.data?.length ? '(nhãn dán / tin đặc biệt)' : null)));
      $('ibThread').scrollTop = $('ibThread').scrollHeight;
      c.unread_count = 0;
      S.messages = msgs.map(m => ({ isCustomer: m.from?.id !== c.page.id, text: m.message || '' }));
      const st = await settings();
      if (st.autoTag) {
        const auto = InboxRules.detectAutoLabels(S.messages, st.rules);
        if (auto.length) await App.crm.addLabels(c.key, auto, { pageId: c.page.id, pageName: c.page.name, name: c.other.name, psid: c.other.id });
      }
      S.crm = await App.crm.all();
      $('ibCrm').hidden = false;
      await App.crm.renderPanel($('ibCrm'), { page: c.page, psid: c.other.id, name: c.other.name || '', messages: S.messages });
      drawList();
    });
  }

  // ── Soạn tin & mẫu ────────────────────────────────────────
  function togglePicker(force) {
    const open = force ?? $('ibPicker').hidden;
    $('ibPicker').hidden = !open;
    $('ibTplBtn').setAttribute('aria-expanded', String(open));
  }
  function pickTemplate(t) {
    S.tpl = t;
    $('ibText').value = App.resolveVars(t.content, { name: S.conv?.other.name || '', pageName: S.conv?.page.name || '' });
    S.image = t.imageData || '';
    drawAttach(); togglePicker(false); $('ibText').focus();
  }
  function drawAttach() {
    $('ibAttach').hidden = !S.image;
    $('ibAttach').replaceChildren(...(S.image ? [h('img', { className: 'thumb', src: S.image, alt: '' }), h('span', { className: 'hint', textContent: 'Ảnh gửi sau chữ' }),
      h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Bỏ ảnh', onclick: () => { S.image = ''; drawAttach(); } })] : []));
  }
  function onType(e) {
    const v = e.target.value;
    if (v.startsWith('/') && !v.includes('\n')) { togglePicker(true); S.picker.filter(v); }
    else if (!$('ibPicker').hidden && !v) togglePicker(false);
    if (!v) S.tpl = null;
  }
  async function onKey(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const v = $('ibText').value;
    if (v.startsWith('/') && !$('ibPicker').hidden) { const t = await S.picker.first(); if (t) pickTemplate(t); return; }
    send();
  }
  async function send() {
    const c = S.conv, text = $('ibText').value.trim();
    if (!c?.other.id || (!text && !S.image)) return;
    $('ibSend').disabled = true;
    try {
      await App.sendMessage(c.page, c.other.id, text, S.image);
      if (S.tpl) await App.recordTemplateUse(S.tpl, c.key);
      $('ibText').value = ''; S.image = ''; S.tpl = null; drawAttach();
      c.fromCustomer = false;
      await openConv(c);
    } catch (e) {
      $('ibThread').append(h('div', { className: 'status err', textContent: e.code === 10 || e.sub === 2018278 ? 'Đã quá 24 giờ kể từ tin cuối của khách, Meta không cho Page nhắn tiếp.' : e.message }));
    }
    $('ibSend').disabled = false;
  }

  // ── Báo tin mới khi trang đang mở (Cài đặt › Hộp thư) ─────
  const seen = new Map(); let first = true;
  async function poll() {
    const st = await settings();
    if (!st.webNotify) return;
    const pages = App.pages.filter(p => !st.mutedPages.includes(p.id));
    let unread = 0;
    await pool(pages, 4, async p => {
      const convs = await fetchConvs(p, 20).catch(() => []);
      for (const c of convs) {
        unread += c.unread_count ? 1 : 0;
        const prev = seen.get(c.id);
        if (!first && c.unread_count && c.fromCustomer && prev !== c.updated_time && InboxRules.notifyAllowed(st, p.id)) App.notify(`💬 ${c.other.name || 'Khách'} · ${p.name}`, c.snippet || 'Tin nhắn mới');
        seen.set(c.id, c.updated_time);
      }
    });
    first = false;
    document.title = unread ? `(${unread}) Meta Assistant` : 'Meta Assistant';
    if (App.current() === 'inbox' && !document.hidden) load();
  }
  App.onLogin.push(async () => {
    poll();
    const loop = async () => { const st = await settings(); setTimeout(async () => { await poll(); loop(); }, Math.max(1, Number(st.pollMinutes) || 2) * 60e3); };
    loop();
  });
})();
