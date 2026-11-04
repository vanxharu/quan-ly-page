/* Hộp thư (giống inbox-tab.js của tiện ích, nhưng đọc qua Graph API): một hoặc tất cả Page, lọc, thời gian khách chờ,
 * tự gắn nhãn theo lời khách (InboxRules), mẫu tin bằng nút "Mẫu" hoặc gõ "/", ảnh đính kèm, khung CRM, báo tin mới. */
(() => {
  const S = { filter: 'all', convs: [], conv: null, tpl: null, image: '', loading: 0, pics: new Map(), sending: false, more: new Map(), extra: new Map() };
  const draftKey = c => c?.other.id ? `inboxDraft:${c.page.id}|${c.other.id}` : '';
  function saveDraft(c = S.conv) {
    const key = draftKey(c);
    if (!key || !S.draftReady) return Promise.resolve();
    return DB.set(key, { text: $('ibText').value, image: S.image, updatedAt: Date.now() }).catch(() => {});
  }
  function updateSendState() {
    if ($('ibSend')) $('ibSend').disabled = S.sending || !S.conv?.other.id || !S.draftReady || (!($('ibText').value.trim()) && !S.image);
  }

  const settings = async () => InboxRules.withDefaults(await DB.get(InboxRules.SETTINGS_KEY));
  const normalizeConversation = (page, c) => {
    const other = c.participants?.data?.find(u => u.id !== page.id) || {};
    const last = c.messages?.data?.[0];
    return { ...c, page, other, fromCustomer: last ? last.from?.id !== page.id : true,
      lastAt: new Date(last?.created_time || c.updated_time).getTime(), key: App.crmKey(page.id, other.name) };
  };

  async function fetchConvs(page, limit = 50, next) {
    const res = await api(next || `/${page.id}/conversations`, next ? {} : { platform: 'messenger', limit,
      fields: 'id,updated_time,snippet,unread_count,participants,messages.limit(1){from,created_time}' }, 'GET', page.access_token);
    // Chỉ lưu dữ liệu hội thoại, không lưu token Page hay URL phân trang vào bản lưu dự phòng.
    if (!next && limit === 50) await DB.set(`inboxConversationCacheV1:${page.id}`, { at: Date.now(), data: res.data || [] }).catch(() => {});
    const list = (res.data || []).map(c => normalizeConversation(page, c));
    list.next = res.paging?.next || '';
    return list;
  }
  App.inbox = { fetchConvs };
  // Mở hội thoại của một khách (từ Khách hàng, Tổng quan…): thêm Page đó vào danh sách đang chọn nếu chưa có.
  App.openConversation = (pageId, name) => {
    S.pending = name;
    if (App.pageById(pageId) && !App.isSelected(pageId)) App.setSelected([...App.selected().map(p => p.id), String(pageId)]);
    App.show('inbox');
  };

  App.tab('inbox', {
    mount(el) {
      const picker = App.templates.picker(t => pickTemplate(t));
      S.picker = picker;
      el.append(h('div', { className: 'split' },
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Hội thoại' }),
            h('div', { className: 'row', style: 'gap:6px' },
              h('button', { className: 'btn btn-soft', onclick: () => load() }, icon('i-sync'), 'Tải lại'))),
          h('input', { type: 'search', id: 'ibSearch', placeholder: '🔍 Tìm theo tên khách hoặc nội dung tin…', oninput: () => drawList() }),
          h('div', { className: 'row', style: 'margin:10px 0;gap:6px' },
            h('div', { className: 'chips', id: 'ibFilter' }, ...[['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['unanswered', 'Chưa trả lời'], ['today', 'Hôm nay']].map(([f, t]) =>
              h('button', { className: 'chip', dataset: { f }, textContent: t, 'aria-pressed': String(f === S.filter), onclick: () => { S.filter = f; drawList(); } }))),
            h('select', { id: 'ibLabel', style: 'width:auto;padding:4px 8px;font-size:12px', onchange: () => drawList() })),
          h('div', { className: 'list', id: 'ibList' }),
          h('button', { type: 'button', className: 'btn btn-ghost btn-sm', id: 'ibMore', hidden: true, textContent: 'Tải thêm hội thoại', onclick: loadMore })),
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
                const c = S.conv, f = e.target.files[0];
                if (f) { const image = await fileToDataUrl(f); if (draftKey(S.conv) === draftKey(c)) { S.image = image; drawAttach(); saveDraft(); } }
                e.target.value = '';
              } })),
              h('textarea', { id: 'ibText', 'aria-label': 'Nội dung trả lời', placeholder: 'Nhập tin trả lời… (gõ / để chọn mẫu)', rows: 1, disabled: true, oninput: onType, onkeydown: onKey }),
              h('button', { className: 'send-btn', id: 'ibSend', disabled: true, 'aria-label': 'Gửi', onclick: send }, icon('i-send'))),
            h('div', { className: 'hint', style: 'margin-top:6px' }, h('kbd', {}, 'Enter'), ' gửi · ', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Enter'), ' xuống dòng · ',
              h('kbd', {}, '/'), ' chọn mẫu · chỉ trả lời được trong 24 giờ kể từ tin cuối của khách')))));
    },
    refresh() { load(S.convs.length > 0); }
  });
  App.onPageChange.push(() => { saveDraft(); S.conv = null; S.more.clear(); S.extra.clear(); resetThread(); });

  async function load(silent) {
    const pages = App.selected();
    if (!pages.length) { S.convs = []; $('ibList').replaceChildren(empty('Chưa tick Page nào.')); return; }
    const scope = pages.map(p => p.id).join();
    if (S.listBusy && S.fetchScope === scope) return;
    const run = ++S.loading;
    S.listBusy = true; S.fetchScope = scope; S.lastListAt = Date.now();
    try {
    if (!silent) $('ibList').replaceChildren(empty(`Đang tải hội thoại của ${pages.length} Page…`));
    const errors = [];
    const lists = await pool(pages, 3, p => fetchConvs(p).catch(async e => {
      errors.push(`${p.name}: ${e.message}${e.code ? ` (mã ${e.code}${e.sub ? '/' + e.sub : ''})` : ''}`);
      const previous = S.convs.filter(c => c.page.id === p.id);
      if (previous.length) return previous;
      const cache = await DB.get(`inboxConversationCacheV1:${p.id}`, {}).catch(() => ({}));
      return Date.now() - cache.at < 7 * 864e5 && Array.isArray(cache.data) ? cache.data.map(c => normalizeConversation(p, c)) : [];
    }));
    if (run !== S.loading) return;
    S.failures = errors.length === pages.length ? (S.failures || 0) + 1 : 0;
    S.retryAt = S.failures ? Date.now() + Math.min(300e3, 30e3 * 2 ** (S.failures - 1)) : 0;
    lists.forEach((list, i) => { if (!S.more.has(pages[i].id) && typeof list.next === 'string') S.more.set(pages[i].id, { page: pages[i], next: list.next }); });
    S.convs = [...new Map([...S.extra.values(), ...lists.flat()].map(c => [c.id, c])).values()].sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
    S.crm = await App.crm.all();
    const labels = await App.crm.allLabels();
    const cur = $('ibLabel').value;
    $('ibLabel').replaceChildren(h('option', { value: '', textContent: 'Mọi nhãn' }), ...labels.map(l => h('option', { value: l, textContent: l, selected: l === cur })));
    S.errors = errors;
    // Hội thoại đang mở có tin mới → đọc lại luôn.
    const fresh = S.conv && S.convs.find(c => c.id === S.conv.id);
    if (fresh && fresh.updated_time !== S.conv.updated_time) { fresh.unread_count = 0; openConv(fresh, { silent: true }); }
    loadPics(S.convs);
    if (S.pending) { $('ibSearch').value = S.pending; const hit = S.convs.find(c => norm(c.other.name) === norm(S.pending)); S.pending = ''; if (hit) openConv(hit); }
    drawList();
    } finally { if (run === S.loading) S.listBusy = false; }
  }
  async function loadMore() {
    if (S.moreBusy) return;
    const scope = App.selected().map(p => p.id).join();
    S.moreBusy = true; $('ibMore').disabled = true; $('ibMore').textContent = 'Đang tải…';
    try {
      const batches = await pool([...S.more.values()].filter(x => x.next), 3, async ({ page, next }) => {
        try { return { page, list: await fetchConvs(page, 50, next) }; }
        catch (e) { toast(`${page.name}: ${e.message}`, 5000); return null; }
      });
      if (scope !== App.selected().map(p => p.id).join()) return;
      for (const result of batches.filter(Boolean)) {
        S.more.set(result.page.id, { page: result.page, next: result.list.next });
        for (const c of result.list) S.extra.set(c.id, c);
      }
      S.convs = [...new Map([...S.extra.values(), ...S.convs].map(c => [c.id, c])).values()].sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
      loadPics(S.convs); await drawList();
    } finally { S.moreBusy = false; $('ibMore').disabled = false; $('ibMore').textContent = 'Tải thêm hội thoại'; }
  }
  async function loadPics(convs) {
    const byPage = new Map();
    for (const c of convs) if (c.other.id && !S.pics.has(c.other.id)) (byPage.get(c.page) || byPage.set(c.page, []).get(c.page)).push(c.other.id);
    await pool([...byPage], 3, async ([page, ids]) => { for (const [id, url] of await App.customerPics(page, ids)) if (url) S.pics.set(id, url); });
    if (byPage.size) {
      drawList();
      if (S.conv) { drawHead(S.conv); refreshThreadAvatars(S.conv); }
    }
  }
  // Cập nhật riêng avatar khi ảnh về muộn; giữ nguyên tin nhắn, vị trí cuộn và ô soạn.
  function messageAvatar(c) {
    const url = S.pics.get(c.other.id) || '';
    const avatar = App.avatar(c.other.name, url, 24);
    Object.assign(avatar.dataset, { customerAvatar: '1', pageId: c.page.id, psid: c.other.id, avatarUrl: url });
    return avatar;
  }
  function refreshThreadAvatars(c) {
    const url = S.pics.get(c.other.id) || '';
    for (const avatar of $('ibThread').querySelectorAll('[data-customer-avatar]')) {
      if (avatar.dataset.pageId === c.page.id && avatar.dataset.psid === c.other.id && avatar.dataset.avatarUrl !== url) {
        avatar.replaceWith(messageAvatar(c));
      }
    }
  }
  // Ảnh khách kèm ảnh Page nhỏ ở góc (như Business Suite).
  const custAvatar = (c, size = 36) => {
    const pg = App.avatar(c.page.name, App.pageAvatarUrl(c.page), Math.round(size * .42));
    pg.classList.add('pg'); pg.title = c.page.name;
    return h('span', { className: 'avwrap' }, App.avatar(c.other.name, S.pics.get(c.other.id), size), pg);
  };
  function drawHead(c) {
    $('ibTitle').replaceChildren(h('span', { className: 'thread-head' }, custAvatar(c, 32),
      h('span', { style: 'min-width:0' }, h('div', { className: 'card-title', textContent: c.other.name || 'Khách' }), h('div', { className: 'hint', textContent: c.page.name }))));
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
    const multi = App.selected().length > 1;
    $('ibMore').hidden = ![...S.more.values()].some(x => x.next);
    const errors = S.errors?.length ? [h('details', { className: 'status err' },
      h('summary', { textContent: `${S.errors.length} Page chưa tải được tin mới.${S.convs.length ? ' Đang giữ danh sách đã tải.' : ''} Bấm xem chi tiết.` }),
      ...S.errors.map(e => h('div', { style: 'margin-top:8px', textContent: e })))] : [];
    $('ibList').replaceChildren(...errors,
      ...(list.length ? list.map(c => {
        const wait = c.fromCustomer ? (Date.now() - c.lastAt) / 60e3 : null;
        const labels = S.crm?.[c.key]?.labels || [];
        return h('div', { className: 'item' + (c.unread_count ? ' unread' : '') + (S.conv?.id === c.id ? ' active' : ''), onclick: () => openConv(c) },
          custAvatar(c),
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
    S.draftReady = false; S.image = ''; S.tpl = null;
    $('ibText').value = ''; $('ibText').disabled = true; drawAttach();
    $('ibTitle').replaceChildren('Chưa chọn hội thoại'); $('ibReload').hidden = true; $('ibSend').disabled = true; $('ibCrm').hidden = true;
    $('ibThread').replaceChildren(empty('Chọn một hội thoại bên trái để xem tin nhắn.'));
  }
  async function openConv(c, { silent = false } = {}) {
    const switching = draftKey(S.conv) !== draftKey(c) || !S.draftReady;
    if (switching) saveDraft();
    S.conv = c;
    drawHead(c);
    $('ibReload').hidden = false;
    if (switching) {
      S.draftReady = false; S.tpl = null; S.image = '';
      $('ibText').value = ''; $('ibText').disabled = true; drawAttach();
      $('ibCrm').hidden = true;
      $('ibThread').replaceChildren(empty('Đang tải tin nhắn…'));
      const draft = await DB.get(draftKey(c), {}).catch(() => ({}));
      if (S.conv !== c) return;
      $('ibText').value = draft.text || ''; S.image = draft.image || '';
      S.draftReady = true; $('ibText').disabled = !c.other.id; drawAttach();
    }
    updateSendState();
    drawList();
    await guard($('ibThread'), async () => {
      const res = await api(`/${c.id}`, { fields: 'messages.limit(40){message,from,created_time,attachments{image_data,mime_type,name,file_url}}' }, 'GET', c.page.access_token)
        .catch(e => {
          if (S.conv !== c) return null;
          if (silent) {
            $('ibThreadError')?.remove();
            $('ibThread').append(h('div', { id: 'ibThreadError', className: 'status err', textContent: 'Chưa cập nhật được tin mới. Đang giữ lịch sử đã tải. ' + e.message }));
            return null;
          }
          throw e;
        });
      if (!res) return;
      if (S.conv !== c) return;
      const msgs = (res.messages?.data || []).reverse();
      const thread = $('ibThread'), oldTop = thread.scrollTop;
      const atBottom = thread.scrollHeight - thread.clientHeight - oldTop < 70;
      const me = m => m.from?.id === c.page.id;
      $('ibThread').replaceChildren(...msgs.map((m, i) => h('div', { className: 'msgrow' + (me(m) ? ' me' : '') },
        // Ảnh chỉ hiện ở tin cuối của mỗi chuỗi tin liên tiếp cùng người gửi.
        msgs[i + 1] && me(msgs[i + 1]) === me(m) ? h('span', { style: 'width:24px;flex:none' })
          : me(m) ? App.avatar(c.page.name, App.pageAvatarUrl(c.page), 24) : messageAvatar(c),
        h('div', { className: 'msg' + (me(m) ? ' me' : ''), title: fmtTime(m.created_time) },
        m.message || null,
        ...(m.attachments?.data || []).map(a => a.image_data?.url ? h('img', { src: a.image_data.url, alt: '', style: 'display:block;max-width:220px;border-radius:10px;margin-top:4px' })
          : h('a', { href: a.file_url || '#', target: '_blank', rel: 'noopener', textContent: `📎 ${a.name || 'Tệp đính kèm'}` })),
        !m.message && !m.attachments?.data?.length ? '(nhãn dán / tin đặc biệt)' : null))));
      thread.scrollTop = !silent || atBottom ? thread.scrollHeight : oldTop;
      c.unread_count = 0;
      S.messages = msgs.map(m => ({ isCustomer: m.from?.id !== c.page.id, text: m.message || '' }));
      const st = await settings();
      if (S.conv !== c) return;
      if (st.autoTag) {
        const auto = InboxRules.detectAutoLabels(S.messages, st.rules);
        if (auto.length) await App.crm.addLabels(c.key, auto, { pageId: c.page.id, pageName: c.page.name, name: c.other.name, psid: c.other.id });
      }
      S.crm = await App.crm.all();
      if (S.conv !== c) return;
      $('ibCrm').hidden = false;
      // Tải tin mới không dựng lại biểu mẫu CRM đang nhập dở.
      if (!silent || switching) await App.crm.renderPanel($('ibCrm'), { page: c.page, psid: c.other.id, name: c.other.name || '', messages: S.messages,
        isCurrent: () => draftKey(S.conv) === draftKey(c) });
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
    drawAttach(); saveDraft(); togglePicker(false); $('ibText').focus();
  }
  function drawAttach() {
    $('ibAttach').hidden = !S.image;
    $('ibAttach').replaceChildren(...(S.image ? [h('img', { className: 'thumb', src: S.image, alt: '' }), h('span', { className: 'hint', textContent: 'Ảnh gửi sau chữ' }),
      h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Bỏ ảnh', onclick: () => { S.image = ''; drawAttach(); saveDraft(); } })] : []));
    updateSendState();
  }
  function onType(e) {
    const v = e.target.value;
    if (v.startsWith('/') && !v.includes('\n')) { togglePicker(true); S.picker.filter(v); }
    else if (!$('ibPicker').hidden && !v) togglePicker(false);
    if (!v) S.tpl = null;
    saveDraft(); updateSendState();
  }
  async function onKey(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const v = $('ibText').value;
    if (v.startsWith('/') && !$('ibPicker').hidden) { const t = await S.picker.first(); if (t) pickTemplate(t); return; }
    send();
  }
  async function send() {
    const c = S.conv, text = $('ibText').value.trim();
    if (S.sending || !S.draftReady || !c?.other.id || (!text && !S.image)) return;
    const image = S.image, tpl = S.tpl;
    S.sending = true; updateSendState();
    try {
      await App.sendMessage(c.page, c.other.id, text, image);
      // Chỉ xoá đúng bản nháp vừa gửi, không xoá nội dung mới hoặc hội thoại khác.
      const current = S.conv && draftKey(S.conv) === draftKey(c);
      const unchanged = current && $('ibText').value.trim() === text && S.image === image;
      if (unchanged) { $('ibText').value = ''; S.image = ''; S.tpl = null; drawAttach(); await saveDraft(); }
      else if (!current) {
        const draft = await DB.get(draftKey(c), {});
        if ((draft.text || '').trim() === text && (draft.image || '') === image) await DB.set(draftKey(c), { text: '', image: '', updatedAt: Date.now() });
      }
      if (tpl) await App.recordTemplateUse(tpl, c.key);
      c.fromCustomer = false;
      if (S.conv && draftKey(S.conv) === draftKey(c)) await openConv(S.conv, { silent: true });
    } catch (e) {
      if (e.partialTextSent) {
        if (S.conv && draftKey(S.conv) === draftKey(c) && $('ibText').value.trim() === text) { $('ibText').value = ''; await saveDraft(); }
        else if (!S.conv || draftKey(S.conv) !== draftKey(c)) {
          const draft = await DB.get(draftKey(c), {});
          if ((draft.text || '').trim() === text) await DB.set(draftKey(c), { ...draft, text: '' });
        }
      }
      const message = (e.partialTextSent ? 'Chữ đã gửi, nhưng ảnh chưa gửi được. Gửi lại ảnh để tránh lặp nội dung. ' : '') + (e.sub === 2018278 ? 'Đã quá 24 giờ kể từ tin cuối của khách, Meta không cho Page nhắn tiếp.' : e.message) + (e.code ? ` (mã ${e.code}${e.sub ? '/' + e.sub : ''})` : '');
      if (S.conv && draftKey(S.conv) === draftKey(c)) $('ibThread').append(h('div', { className: 'status err', textContent: message }));
      else toast(`${c.other.name || 'Khách'}: ${message}`, 7000);
    } finally { S.sending = false; updateSendState(); }
  }

  // ── Báo tin mới khi trang đang mở (Cài đặt › Hộp thư) ─────
  const seen = new Map(); let first = true;
  async function poll() {
    if (Date.now() < (S.retryAt || 0)) return;
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
  // Ưu tiên hội thoại đang đọc; hạn chế quét lại hàng chục Page khi Facebook đang lỗi.
  setInterval(async () => {
    if (!App.pages.length || App.current() !== 'inbox' || document.hidden || Date.now() < (S.retryAt || 0)) return;
    const listInterval = App.selected().length > 5 ? 60e3 : 30e3;
    if (Date.now() - (S.lastListAt || 0) >= listInterval) return load(true);
    if (S.conv && S.draftReady && !S.reading && !S.listBusy) {
      S.reading = true;
      try { await openConv(S.conv, { silent: true }); } finally { S.reading = false; }
    }
  }, 8e3);
  App.onLogin.push(async () => {
    poll();
    const loop = async () => { const st = await settings(); setTimeout(async () => { await poll(); loop(); }, Math.max(1, Number(st.pollMinutes) || 2) * 60e3); };
    loop();
  });
})();
