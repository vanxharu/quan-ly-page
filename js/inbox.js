/* Hộp thư (giống inbox-tab.js của tiện ích, nhưng đọc qua Graph API): một hoặc tất cả Page, lọc, thời gian khách chờ,
 * tự gắn nhãn theo lời khách (InboxRules), mẫu tin bằng nút "Mẫu" hoặc gõ "/", ảnh đính kèm, khung CRM, báo tin mới. */
(() => {
  const S = { filter: 'all', convs: [], conv: null, tpl: null, image: '', loading: 0, pics: new Map(), identities: new Map(), sending: false, more: new Map(), extra: new Map(), manual: {} };
  const draftKey = c => c?.other.id ? `inboxDraft:${c.page.id}|${c.other.id}` : '';
  function saveDraft(c = S.conv) {
    const key = draftKey(c);
    if (!key || !S.draftReady) return Promise.resolve();
    return DB.set(key, { text: $('ibText').value, image: S.image, updatedAt: Date.now() }).catch(() => {});
  }
  function updateSendState() {
    if ($('ibSend')) $('ibSend').disabled = S.sending || !S.conv?.other.id || !S.draftReady || (!($('ibText').value.trim()) && !S.image);
  }

  // Ảnh theo UID nhập tay: ưu tiên hơn ảnh Meta trả về. Link ảnh fbcdn hết hạn sau vài ngày nên lấy lại sau 2 ngày.
  DB.get(App.customerUidKey, {}).then(all => { S.manual = all || {}; for (const [key, v] of Object.entries(S.manual)) S.pics.set(key, v.url); }).catch(() => {});
  App.onLogin.push(async () => {
    const old = Object.entries(S.manual).filter(([, v]) => v.uid && !v.auto && Date.now() - (v.at || 0) > 2 * 864e5);
    for (const [key, v] of old) { S.manual[key] = { ...v, url: await App.uidPicture(v.uid), at: Date.now() }; S.pics.set(key, S.manual[key].url); }
    if (old.length) { await DB.set(App.customerUidKey, S.manual); paintPictures(); }
  });
  // App Windows: app chưa Live nên Graph không trả ảnh khách → đọc ảnh + UID từ Business Suite (khung ẩn của app).
  // Chỉ chạy cho hội thoại bạn mở (và nút "Lấy avatar" cho danh sách), từng khách một.
  const autoPics = !!window.metaDesktop?.lookupProfile;
  let loginWarned = false;
  async function lookupFromMeta(c, { force = false } = {}) {
    const key = pictureKey(c), cur = S.manual[key];
    if (!autoPics || !c.other.id || (cur && (!cur.auto || (!force && Date.now() - (cur.at || 0) < 2 * 864e5)))) return false;
    const r = await window.metaDesktop.lookupProfile({ pageId: String(c.page.id), psid: String(c.other.id), name: c.other.name || '' }).catch(e => ({ error: e.message }));
    if (r.error) {
      if (r.error === 'login' && !loginWarned) { loginWarned = true; toast('Mở menu "Hộp thư Meta" và đăng nhập Business Suite một lần để app tự lấy avatar khách.', 8000); }
      return false;
    }
    if (!r.pic) return false;
    const all = await DB.get(App.customerUidKey, {});
    all[key] = S.manual[key] = { uid: r.uid || '', url: r.pic, at: Date.now(), auto: true };
    await DB.set(App.customerUidKey, all);
    S.pics.set(key, r.pic); paintPictures();
    if (S.conv && pictureKey(S.conv) === key) drawHead(S.conv);
    return true;
  }
  async function lookupList(btn) {
    const todo = S.convs.filter(c => !S.pics.get(pictureKey(c))).slice(0, 30);
    if (!todo.length) return toast('Danh sách đã có đủ avatar.');
    btn.disabled = true; let ok = 0;
    for (const [i, c] of todo.entries()) { btn.textContent = `Đang lấy ${i + 1}/${todo.length}…`; if (await lookupFromMeta(c, { force: true })) ok++; }
    btn.disabled = false; btn.textContent = 'Lấy avatar';
    toast(`Đã lấy avatar cho ${ok}/${todo.length} khách.`);
  }
  // Ô nhập ngay dưới tên khách (app Windows/Electron không hỗ trợ prompt()).
  function setCustomerUid(c) {
    const key = pictureKey(c);
    $('ibUidForm')?.remove();
    const input = h('input', { type: 'text', autocomplete: 'off', value: S.manual[key]?.uid || '', placeholder: 'UID số hoặc link facebook.com/profile.php?id=…', 'aria-label': 'UID Facebook của khách', style: 'flex:1;min-width:0' });
    const form = h('form', { id: 'ibUidForm', className: 'row', style: 'gap:6px;margin-top:8px;width:100%' }, input,
      h('button', { className: 'btn btn-primary btn-sm', textContent: 'Lưu' }),
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Huỷ', onclick: () => form.remove() }));
    form.onsubmit = async e => { e.preventDefault(); form.querySelector('button').disabled = true; await saveCustomerUid(c, input.value); };
    $('ibTitle').append(form); input.focus(); input.select();
  }
  async function saveCustomerUid(c, text) {
    const key = pictureKey(c);
    const all = await DB.get(App.customerUidKey, {});
    if (!text.trim()) { delete all[key]; delete S.manual[key]; S.pics.delete(key); pictureChecked.delete(key); }
    else {
      const uid = App.parseFacebookUid(text);
      if (!uid) { $('ibUidForm')?.querySelector('button')?.removeAttribute('disabled'); return toast('Cần UID dạng số hoặc link có ?id=… (link dạng facebook.com/ten-rieng không đọc được UID).', 6000); }
      all[key] = S.manual[key] = { uid, url: await App.uidPicture(uid), at: Date.now() };
      S.pics.set(key, all[key].url);
    }
    await DB.set(App.customerUidKey, all);
    paintPictures(); drawHead(c);
    if (!text.trim()) queuePics([c]);
  }
  const settings = async () => InboxRules.withDefaults(await DB.get(InboxRules.SETTINGS_KEY));
  const normalizeConversation = (page, c) => {
    const other = c.participants?.data?.find(u => String(u.id) !== String(page.id)) || {};
    if(App.noteCustomerConversation?.(page,c,other))refreshPictureEvidence({page,other});
    const last = c.messages?.data?.[0];
    return { ...c, page, other, fromCustomer: last ? last.from?.id !== page.id : true,
      lastAt: new Date(last?.created_time || c.updated_time).getTime(), key: App.crmKey(page.id, other.name) };
  };

  const CONV_FIELDS = 'id,updated_time,snippet,unread_count,participants,messages.limit(1){from,created_time}';
  const cacheKey = page => `inboxConversationCacheV1:${page.id}`;
  const fetchedKey = page => `inboxFetchedV1:${page.id}`;
  const REFRESH_LIMIT = 25, FIRST_LIMIT = 50, CACHE_MAX = 150, DIRTY_GAP = 10e3;
  const dirty = new Set();
  const toList = (page, data, after = '') => { const list = (data || []).map(c => normalizeConversation(page, c)); list.after = after; return list; };
  // Gọi Facebook lấy hội thoại. `after` là con trỏ phân trang (không chứa token), dùng cho "Tải thêm".
  async function fetchConvs(page, limit = FIRST_LIMIT, after = '', { low = false } = {}) {
    const res = await api(`/${page.id}/conversations`, { platform: 'messenger', limit, fields: CONV_FIELDS, ...(after ? { after } : {}) }, 'GET', page.access_token, { low });
    const data = res.data || [], cursor = res.paging?.next ? res.paging?.cursors?.after || '' : '';
    // Bản lưu dùng chung mọi tab: gộp theo ID, chỉ dữ liệu hội thoại (không token, không URL phân trang).
    const cache = await DB.get(cacheKey(page), {}).catch(() => ({}));
    const merged = [...new Map([...data, ...(Array.isArray(cache.data) ? cache.data : [])].map(c => [c.id, c])).values()]
      .sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time)).slice(0, CACHE_MAX);
    await DB.set(cacheKey(page), { at: Date.now(), data: merged, after: after ? cache.after || '' : cursor }).catch(() => {});
    return toList(page, data, cursor);
  }
  // Lấy hội thoại của một Page qua bản lưu chung: tab nào vừa gọi Facebook thì tab khác, Hộp thư và báo tin mới
  // dùng lại kết quả, không gọi trùng. Page có webhook báo tin mới (dirty) được tải lại ngay.
  async function convsFor(page, { maxAge = 60e3, force = false, low = true } = {}) {
    const now = Date.now(), last = Number(local.get(fetchedKey(page))) || 0;
    const cache = await DB.get(cacheKey(page), {}).catch(() => ({}));
    const hasCache = Array.isArray(cache.data) && cache.at;
    const wantFresh = force || !hasCache || now - last >= maxAge || (dirty.has(page.id) && now - last >= DIRTY_GAP);
    const blocked = (App.graphTraffic?.blockedUntil?.(page.id) || 0) > now;
    if (hasCache && (!wantFresh || blocked)) return Object.assign(toList(page, cache.data, cache.after || ''), { cached: true, blockedUntil: blocked ? App.graphTraffic.blockedUntil(page.id) : 0 });
    // Giữ chỗ trước khi gọi để tab khác cùng lúc không gọi trùng.
    local.set(fetchedKey(page), String(now));
    try {
      await fetchConvs(page, hasCache ? REFRESH_LIMIT : FIRST_LIMIT, '', { low: low && hasCache });
      dirty.delete(page.id);
    } catch (e) {
      if (!e.rateLimited && e.code !== 'BACKGROUND_PAUSED') local.set(fetchedKey(page), String(last));
      if (!hasCache) throw e;
      if (e.code !== 'BACKGROUND_PAUSED') throw Object.assign(e, { cache: toList(page, cache.data, cache.after || '') });
    }
    const fresh = await DB.get(cacheKey(page), {}).catch(() => ({}));
    return toList(page, fresh.data, fresh.after || '');
  }
  App.inbox = { fetchConvs, convsFor };
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
          h('div', { className: 'card-head inbox-search-row' },
            h('input', { type: 'search', id: 'ibSearch', 'aria-label': 'Tìm hội thoại', placeholder: 'Tìm khách hoặc nội dung tin…', oninput: () => drawList() }),
            h('button', { className: 'icon-btn', title: 'Tải lại hội thoại', 'aria-label': 'Tải lại hội thoại', onclick: () => load(false, { force: true }) }, icon('i-sync'))),
          h('div', { className: 'row', style: 'margin:10px 0;gap:6px' },
            h('div', { className: 'chips', id: 'ibFilter' }, ...[['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['unanswered', 'Chưa trả lời'], ['today', 'Hôm nay']].map(([f, t]) =>
              h('button', { className: 'chip', dataset: { f }, textContent: t, 'aria-pressed': String(f === S.filter), onclick: () => { S.filter = f; drawList(); } }))),
            h('select', { id: 'ibLabel', style: 'width:auto;padding:4px 8px;font-size:12px', onchange: () => drawList() }),
            window.metaDesktop?.lookupProfile ? h('button',{type:'button',className:'btn btn-ghost btn-sm',textContent:'Lấy avatar',title:'Đọc avatar + UID khách từ Business Suite (từng khách, tối đa 30)',onclick:e=>lookupList(e.currentTarget)}) : null,
            h('button',{type:'button',className:'btn btn-ghost btn-sm',textContent:'Báo lỗi ảnh',title:'Tải báo lỗi ảnh khách trên phiên hiện tại',onclick:downloadAvatarDiagnostic})),
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
            h('div', { id: 'ibWindow', className: 'status', hidden: true, style: 'margin-bottom:6px' }),
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
              h('kbd', {}, '/'), ' chọn mẫu · quá 24 giờ: tự gửi kèm thẻ Nhân viên trả lời (tới 7 ngày)')))));
    },
    refresh() { load(S.convs.length > 0); }
  });
  App.onPageChange.push(() => { saveDraft(); S.conv = null; S.more.clear(); S.extra.clear(); resetThread(); });

  // Khoảng làm mới danh sách khi đang xem Hộp thư; Page đã nối webhook máy chủ thì thưa hơn (tin mới được báo ngay).
  const listInterval = page => App.server?.livePages?.has?.(String(page.id)) ? 5 * 60e3 : App.selected().length > 5 ? 120e3 : 60e3;
  async function load(silent, { force = false } = {}) {
    const pages = App.selected();
    if (!pages.length) { S.convs = []; $('ibList').replaceChildren(empty('Chưa tick Page nào.')); return; }
    const scope = pages.map(p => p.id).join();
    if (S.listBusy && S.fetchScope === scope) return;
    const run = ++S.loading;
    S.listBusy = true; S.fetchScope = scope; S.lastListAt = Date.now();
    try {
    if (!silent) $('ibList').replaceChildren(empty(`Đang tải hội thoại của ${pages.length} Page…`));
    const errors = [];
    const lists = await pool(pages, 3, p => convsFor(p, { maxAge: force ? 0 : silent ? listInterval(p) : 30e3, force, low: silent }).catch(async e => {
      errors.push(`${p.name}: ${e.message}${e.code ? ` (mã ${e.code}${e.sub ? '/' + e.sub : ''})` : ''}`);
      if (e.cache) return e.cache;
      const previous = S.convs.filter(c => c.page.id === p.id);
      if (previous.length) return previous;
      const cache = await DB.get(cacheKey(p), {}).catch(() => ({}));
      return Date.now() - cache.at < 7 * 864e5 && Array.isArray(cache.data) ? toList(p, cache.data) : [];
    }));
    if (run !== S.loading) return;
    lists.forEach((list, i) => { if (list.blockedUntil > Date.now()) errors.push(`${pages[i].name}: Meta đang giới hạn Page này, đang hiện danh sách đã lưu. Tự tải lại sau ${new Date(list.blockedUntil).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`); });
    S.failures = errors.length === pages.length ? (S.failures || 0) + 1 : 0;
    S.retryAt = S.failures ? Date.now() + Math.min(300e3, 30e3 * 2 ** (S.failures - 1)) : 0;
    lists.forEach((list, i) => { if (!S.more.has(pages[i].id) && typeof list.after === 'string') S.more.set(pages[i].id, { page: pages[i], after: list.after }); });
    S.convs = [...new Map([...S.extra.values(), ...lists.flat()].map(c => [c.id, c])).values()].sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
    S.crm = await App.crm.all();
    const labels = await App.crm.allLabels();
    const cur = $('ibLabel').value;
    $('ibLabel').replaceChildren(h('option', { value: '', textContent: 'Mọi nhãn' }), ...labels.map(l => h('option', { value: l, textContent: l, selected: l === cur })));
    S.errors = errors;
    // Hội thoại đang mở có tin mới → đọc lại luôn.
    const fresh = S.conv && S.convs.find(c => c.id === S.conv.id);
    if (fresh && fresh.updated_time !== S.conv.updated_time) { fresh.unread_count = 0; openConv(fresh, { silent: true }); }
    queuePics(S.convs);
    if (S.pending) { $('ibSearch').value = S.pending; const hit = S.convs.find(c => norm(c.other.name) === norm(S.pending)); S.pending = ''; if (hit) openConv(hit); }
    drawList();
    } finally { if (run === S.loading) S.listBusy = false; }
  }
  async function loadMore() {
    if (S.moreBusy) return;
    const scope = App.selected().map(p => p.id).join();
    S.moreBusy = true; $('ibMore').disabled = true; $('ibMore').textContent = 'Đang tải…';
    try {
      const batches = await pool([...S.more.values()].filter(x => x.after), 3, async ({ page, after }) => {
        try { return { page, list: await fetchConvs(page, 50, after) }; }
        catch (e) { toast(`${page.name}: ${e.message}`, 5000); return null; }
      });
      if (scope !== App.selected().map(p => p.id).join()) return;
      for (const result of batches.filter(Boolean)) {
        S.more.set(result.page.id, { page: result.page, after: result.list.after });
        for (const c of result.list) S.extra.set(c.id, c);
      }
      S.convs = [...new Map([...S.extra.values(), ...S.convs].map(c => [c.id, c])).values()].sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
      queuePics(S.convs); await drawList();
    } finally { S.moreBusy = false; $('ibMore').disabled = false; $('ibMore').textContent = 'Tải thêm hội thoại'; }
  }
  function downloadAvatarDiagnostic(){
    const report=App.customerAvatarDiagnostic?.()||{capturedAt:new Date().toISOString(),items:[]};
    const redact=value=>{let text=String(value||'');for(const page of App.pages||[])if(page.access_token)text=text.split(page.access_token).join('[ẩn]');return text.replace(/https?:\/\/\S+/gi,'[link]').replace(/(?:access_token|authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi,'[ẩn]').replace(/EA[A-Za-z0-9_-]{20,}/g,'[ẩn]').slice(0,300);};
    if(report.transport?.error)report.transport={...report.transport,error:redact(report.transport.error)};
    report.visibleCustomers=S.convs.filter(c=>c.other?.id).slice(0,150).map(c=>({pageId:String(c.page.id),id:String(c.other.id),hasPhoto:S.pics.has(pictureKey(c)),identityError:redact(App.customerIdentityStatus?.get(pictureKey(c)))}));
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=h('a',{href:url,download:'meta-assistant-avatar-diagnostic.json'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Đã tải báo lỗi ảnh khách.');
  }
  const pictureKey = c => c.page.id + ':' + c.other.id;

  const failedPictures = new Set(), pictureLoads = new Map(), pictureChecked = new Map();
  let picturePaintTimer;
  function paintPictures() {
    if (picturePaintTimer) return;
    picturePaintTimer = setTimeout(() => {
      picturePaintTimer = null;
      if (!$('ibList')) return;
      drawList().catch(() => {});
      if (S.conv) { drawHead(S.conv); refreshThreadAvatars(S.conv); if (typeof drawSeen === 'function') drawSeen(S.conv); }
    }, 50);
  }
  const queuePics = convs => { loadPics(convs).catch(() => {}); };
  async function loadPics(convs, force = false) {
    const byPage = new Map(), waiting = new Set(), tasks = [];
    for (const c of convs) {
      if (!c.other.id || S.manual?.[pictureKey(c)]) continue;
      const key = pictureKey(c), pending = pictureLoads.get(key);
      if (pending) { waiting.add(pending); continue; }
      const ttl = S.pics.has(key) ? 5 * 60e3 : 60e3;
      if (!force && pictureChecked.has(key) && Date.now() - pictureChecked.get(key) < ttl) continue;
      if (!byPage.has(c.page.id)) byPage.set(c.page.id, { page: c.page, ids: new Set() });
      byPage.get(c.page.id).ids.add(c.other.id);
    }
    for (const { page, ids } of byPage.values()) {
      const update = (id, url) => {
        const key = page.id + ':' + id, before = S.pics.get(key) || '';
        if (S.manual?.[key]) return;
        if (url) S.pics.set(key, url); else S.pics.delete(key);
        pictureChecked.set(key, Date.now());
        if (before !== url) paintPictures();
      };
      // Đặt khoá trước khi gọi để danh sách, hội thoại và ảnh lỗi không tải trùng cùng khách.
      let start;
      const pending = new Promise(resolve => { start = resolve; }).then(async () => {
        const result = await App.customerPics(page, [...ids], { force, onResult: update, onIdentity: (id,profile) => {S.identities.set(page.id+':'+id,profile);paintPictures();} });
        for (const [id, url] of result) update(id, url);
      }).catch(() => { for (const id of ids) pictureChecked.set(page.id + ':' + id, Date.now()); })
        .finally(() => { for (const id of ids) pictureLoads.delete(page.id + ':' + id); });
      tasks.push(async () => { start(); await pending; });
      for (const id of ids) pictureLoads.set(page.id + ':' + id, pending);
      waiting.add(pending);
    }
    await Promise.all([pool(tasks, 3, task => task()), ...waiting]);
  }
  function refreshPictureEvidence(c) {
    const key=pictureKey(c);if(S.pics.has(key))return;
    pictureChecked.delete(key);
    // Dữ liệu mới đến khi lượt cũ còn chạy: thử lại ngay sau lượt đó, không mất tín hiệu.
    const pending=pictureLoads.get(key);
    if(pending)pending.finally(()=>{if(S.pics.has(key))return;pictureChecked.delete(key);queuePics([c]);});
  }
  function retryPicture(c, url) {
    if(url)App.noteCustomerAvatarImageError?.(c.page,c.other.id);
    const key = pictureKey(c) + ':' + url;
    if (!url || failedPictures.has(key) || S.manual?.[pictureKey(c)]) return;
    failedPictures.add(key); S.pics.delete(pictureKey(c)); pictureChecked.delete(pictureKey(c));
    loadPics([c], true).catch(() => {});
  }
  window.addEventListener('customer-avatars-ready',()=>{for(const c of S.convs)if(!S.pics.has(pictureKey(c)))pictureChecked.delete(pictureKey(c));if(App.current()==='inbox')queuePics(S.convs);});
  // Cập nhật riêng avatar khi ảnh về muộn; giữ nguyên tin nhắn, vị trí cuộn và ô soạn.
  function messageAvatar(c) {
    const url = S.pics.get(pictureKey(c)) || '';
    const avatar = App.avatar(c.other.name, url, 24, () => retryPicture(c, url));
    Object.assign(avatar.dataset, { customerAvatar: '1', pageId: c.page.id, psid: c.other.id, avatarUrl: url });
    return avatar;
  }
  function refreshThreadAvatars(c) {
    const url = S.pics.get(pictureKey(c)) || '';
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
    return h('span', { className: 'avwrap' }, App.avatar(c.other.name, S.pics.get(pictureKey(c)), size, () => retryPicture(c, S.pics.get(pictureKey(c)))), pg);
  };
  function drawHead(c) {
    const identity=S.identities.get(pictureKey(c));
    $('ibTitle').replaceChildren(h('span', { className: 'thread-head' }, custAvatar(c, 32),
      h('span', { style: 'min-width:0' }, h('div', { className: 'card-title', textContent: c.other.name || 'Khách' }), h('div', { className: 'hint', textContent: c.page.name }),
        S.manual?.[pictureKey(c)]?.uid ? h('a',{className:'hint',href:'https://www.facebook.com/profile.php?id='+S.manual[pictureKey(c)].uid,target:'_blank',rel:'noopener noreferrer',textContent:'UID '+S.manual[pictureKey(c)].uid})
          : identity?h('a',{className:'hint',href:identity.profileUrl,target:'_blank',rel:'noopener noreferrer',textContent:'UID '+identity.uid}):null),
      h('button',{type:'button',className:'btn btn-ghost btn-sm',title:'Nhập UID Facebook của khách để hiện ảnh đại diện',textContent:S.manual?.[pictureKey(c)]?.uid?'Đổi UID':'Gắn UID',onclick:()=>setCustomerUid(c)}),
      App.metaLink(App.businessInboxUrl(c.page.id, c.other.id), 'Hộp thư Meta ↗')));
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
    $('ibMore').hidden = ![...S.more.values()].some(x => x.after);
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
    if(!$('ibText'))return; // Đổi Page trước khi mở Hộp thư vẫn hợp lệ.
    $('ibText').value = ''; $('ibText').disabled = true; drawAttach();
    $('ibTitle').replaceChildren('Chưa chọn hội thoại'); $('ibReload').hidden = true; $('ibSend').disabled = true; $('ibCrm').hidden = true;
    $('ibThread').replaceChildren(empty('Chọn một hội thoại bên trái để xem tin nhắn.'));
  }
  // Báo trước khung nhắn của hội thoại đang mở, để không phải gõ xong mới biết Meta từ chối.
  function drawWindow(c) {
    const box = $('ibWindow'); if (!box || S.conv !== c) return;
    const win = App.humanAgent.windowOf(c.lastCustomerAt);
    if (win === 'open' || win === 'unknown') { box.hidden = true; return box.replaceChildren(); }
    const left = Math.max(0, 7 - Math.floor((Date.now() - c.lastCustomerAt) / 864e5));
    const link = App.metaLink(App.businessInboxUrl(c.page.id, c.other.id), 'Mở trong Business Suite ↗');
    box.hidden = false;
    if (win === 'closed') { box.className = 'status err'; return box.replaceChildren(App.humanAgent.CLOSED, ' ', link); }
    box.className = 'status pending';
    box.replaceChildren(App.humanAgent.denied()
      ? h('span', {}, `Quá 24 giờ (còn ${left} ngày để nhân viên trả lời). Ứng dụng chưa có quyền Human Agent nên Meta từ chối; trả lời trong Business Suite. `,
          h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Thử lại', title: 'Đã được Meta duyệt Human Agent? Bấm để thử gửi lại kèm thẻ', onclick: () => { App.humanAgent.reset(); drawWindow(c); } }), ' ', link)
      : h('span', {}, `Khách nhắn đã quá 24 giờ. Tin bạn gõ sẽ gửi kèm thẻ Nhân viên trả lời (còn ${left} ngày). Chỉ dùng để hỗ trợ khách, không gửi quảng cáo/khuyến mãi. `, link));
  }
  async function openConv(c, { silent = false } = {}) {
    const switching = draftKey(S.conv) !== draftKey(c) || !S.draftReady;
    if (switching) saveDraft();
    S.conv = c;
    drawHead(c);
    queuePics([c]);
    if (switching) lookupFromMeta(c);
    $('ibReload').hidden = false;
    if (switching) {
      S.draftReady = false; S.tpl = null; S.image = '';
      $('ibText').value = ''; $('ibText').disabled = true; drawAttach();
      $('ibCrm').hidden = true;
      $('ibThread').replaceChildren(empty('Đang tải tin nhắn…'));
      if ($('ibWindow')) { $('ibWindow').hidden = true; $('ibWindow').replaceChildren(); }
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
      // Sắp theo giờ gửi thay vì tin vào thứ tự Graph trả về (có lúc không phải mới nhất trước).
      const msgs = (res.messages?.data || []).slice().sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
      // Giờ tin cuối của khách: quyết định khung nhắn (24 giờ / 7 ngày với thẻ Nhân viên trả lời / đã đóng).
      const lastCust = [...msgs].reverse().find(m => m.from?.id !== c.page.id);
      c.lastCustomerAt = lastCust ? new Date(lastCust.created_time).getTime() || 0 : 0;
      drawWindow(c);
      if(App.noteCustomerConversation?.(c.page,{...c,messages:{data:msgs}},c.other))refreshPictureEvidence(c);
      queuePics([c]);
      const thread = $('ibThread'), oldTop = thread.scrollTop;
      const atBottom = thread.scrollHeight - thread.clientHeight - oldTop < 70;
      const me = m => m.from?.id === c.page.id;
      $('ibThread').replaceChildren(...msgs.map((m, i) => h('div', { className: 'msgrow' + (me(m) ? ' me' : ''), dataset: { at: String(new Date(m.created_time).getTime() || 0), me: me(m) ? '1' : '' } },
        // Ảnh chỉ hiện ở tin cuối của mỗi chuỗi tin liên tiếp cùng người gửi.
        msgs[i + 1] && me(msgs[i + 1]) === me(m) ? h('span', { style: 'width:24px;flex:none' })
          : me(m) ? App.avatar(c.page.name, App.pageAvatarUrl(c.page), 24) : messageAvatar(c),
        h('div', { className: 'msg' + (me(m) ? ' me' : ''), title: fmtTime(m.created_time) },
        m.message || null,
        ...(m.attachments?.data || []).map(a => a.image_data?.url ? h('img', { src: a.image_data.url, alt: '', style: 'display:block;max-width:220px;border-radius:10px;margin-top:4px' })
          : h('a', { href: a.file_url || '#', target: '_blank', rel: 'noopener', textContent: `📎 ${a.name || 'Tệp đính kèm'}` })),
        !m.message && !m.attachments?.data?.length ? '(nhãn dán / tin đặc biệt)' : null))));
      drawSeen(c);
      loadSeen(c);
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

  // ── Khách đã xem ──────────────────────────────────────────
  // Facebook chỉ báo "đã xem" qua webhook message_reads; máy chủ lưu mốc read_watermark vào Supabase.
  // Web đọc mốc đó (không gọi Facebook) và đặt avatar khách dưới tin cuối cùng của Page mà khách đã xem.
  const seenKey = c => c.page.id + ':' + c.other.id;
  const reads = new Map(), realtimeRows = new Map();
  async function loadSeen(c) {
    const sb = App.server?.sb;
    if (!sb || !App.server.user || !c.other.id) return;
    try {
      const { data, error } = await sb.from('conversations').select('read_watermark').eq('page_id', String(c.page.id)).eq('psid', String(c.other.id)).maybeSingle();
      if (error) return;
      const at = data?.read_watermark ? new Date(data.read_watermark).getTime() : 0;
      if (at && at !== reads.get(seenKey(c))) { reads.set(seenKey(c), at); if (S.conv && seenKey(S.conv) === seenKey(c)) drawSeen(c); }
    } catch {}
  }
  function drawSeen(c) {
    const thread = $('ibThread');
    if (!thread?.querySelectorAll) return;
    thread.querySelectorAll('.seen-row').forEach(el => el.remove());
    const at = reads.get(seenKey(c)) || 0;
    if (!at) return;
    const rows = [...thread.querySelectorAll('.msgrow[data-at]')];
    // Tin cuối của Page có thời điểm ≤ mốc đã xem; bỏ qua nếu khách đã nhắn lại sau đó (Messenger cũng không hiện).
    let target = -1;
    rows.forEach((row, i) => { if (row.dataset.me && Number(row.dataset.at) <= at) target = i; });
    if (target < 0 || rows.slice(target + 1).some(row => !row.dataset.me)) return;
    const url = S.pics.get(pictureKey(c)) || '';
    const avatar = App.avatar(c.other.name, url, 16, () => retryPicture(c, url));
    rows[target].after(h('div', { className: 'seen-row', title: 'Đã xem lúc ' + fmtTime(new Date(at).toISOString()) }, avatar));
  }
  // Máy chủ báo hội thoại thay đổi. Chỉ đổi mốc đã xem → cập nhật avatar, không tải lại danh sách từ Facebook.
  App.inbox.realtime = row => {
    if (!row?.page_id || !row?.psid) return;
    const key = row.page_id + ':' + row.psid, prev = realtimeRows.get(key);
    realtimeRows.set(key, { last_at: row.last_at, read: row.read_watermark });
    const at = row.read_watermark ? new Date(row.read_watermark).getTime() : 0;
    if (at && at > (reads.get(key) || 0)) { reads.set(key, at); if (S.conv && seenKey(S.conv) === key) drawSeen(S.conv); }
    if (prev && prev.last_at === row.last_at && prev.read !== row.read_watermark) return;
    App.inbox.changed(row.page_id);
  };

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
      const sent = await App.sendMessage(c.page, c.other.id, text, image, { humanAgent: true, lastCustomerAt: c.lastCustomerAt });
      if (sent?.humanAgent) toast('Đã gửi kèm thẻ Nhân viên trả lời (khách nhắn đã quá 24 giờ).', 5000);
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
      const message = (e.partialTextSent ? 'Chữ đã gửi, nhưng ảnh chưa gửi được. Gửi lại ảnh để tránh lặp nội dung. ' : '') + (e.window ? e.message : e.sub === 2018278 ? 'Đã quá 24 giờ kể từ tin cuối của khách, Meta không cho Page nhắn tiếp.' : e.message) + (e.code ? ` (mã ${e.code}${e.sub ? '/' + e.sub : ''})` : '');
      if (S.conv && draftKey(S.conv) === draftKey(c)) {
        $('ibThread').append(h('div', { className: 'status err' }, message,
          e.window || Number(e.sub) === 2018300 ? h('div', { style: 'margin-top:6px' }, App.metaLink(App.businessInboxUrl(c.page.id, c.other.id), 'Mở hội thoại trong Business Suite ↗')) : null));
        // App Windows: API bị chặn (quá hạn / app khác giữ hội thoại) → mở luôn hộp thư Meta của Page đó ở cột bên.
        if (window.metaDesktop && (e.window || Number(e.sub) === 2018300)) App.openMetaInbox(App.businessInboxUrl(c.page.id, c.other.id));
        if (e.window) drawWindow(c);
      } else toast(`${c.other.name || 'Khách'}: ${message}`, 7000);
    } finally { S.sending = false; updateSendState(); }
  }

  // ── Báo tin mới khi trang đang mở (Cài đặt › Hộp thư) ─────
  // Một bộ hẹn giờ duy nhất cho cả danh sách và báo tin mới. Hội thoại đang mở chỉ đọc lại khi danh sách báo có tin mới
  // (updated_time đổi), không đọc lại định kỳ. Mọi tab dùng chung bản lưu nên mở nhiều tab không nhân số lần gọi.
  const NOTIFIED = 'inboxNotifiedV1';
  const seen = new Map(); let first = true, lastPoll = 0, ticking = false;
  const pollEvery = (st, pages) => {
    const base = Math.max(2, Number(st.pollMinutes) || 2) * 60e3;
    const live = App.server?.livePages;
    return pages.length && live?.size && pages.every(p => live.has(String(p.id))) ? Math.max(base, 10 * 60e3) : base;
  };
  async function poll(st, only) {
    if (Date.now() < (S.retryAt || 0)) return;
    st ||= await settings();
    if (!st.webNotify) return;
    const pages = (only || App.pages).filter(p => !st.mutedPages.includes(p.id) && (App.graphTraffic?.blockedUntil?.(p.id) || 0) <= Date.now());
    let notified = {}; try { notified = JSON.parse(local.get(NOTIFIED) || '{}'); } catch {}
    let unread = 0;
    await pool(pages, 3, async p => {
      const convs = await convsFor(p, { maxAge: Math.max(30e3, pollEvery(st, App.pages) - 10e3), low: true }).catch(e => e.cache || []);
      for (const c of convs) {
        unread += c.unread_count ? 1 : 0;
        const prev = seen.get(c.id);
        // notified dùng chung các tab: một tin chỉ báo một lần dù mở nhiều tab.
        if (!first && c.unread_count && c.fromCustomer && prev !== c.updated_time && notified[c.id] !== c.updated_time && InboxRules.notifyAllowed(st, p.id)) {
          notified[c.id] = c.updated_time;
          App.notify(`💬 ${c.other.name || 'Khách'} · ${p.name}`, c.snippet || 'Tin nhắn mới');
        }
        seen.set(c.id, c.updated_time);
      }
    });
    const ids = Object.keys(notified); if (ids.length > 500) for (const id of ids.slice(0, ids.length - 500)) delete notified[id];
    local.set(NOTIFIED, JSON.stringify(notified));
    if (!only) { first = false; document.title = unread ? `(${unread}) Meta Assistant` : 'Meta Assistant'; }
  }
  async function tick() {
    if (!App.pages.length || ticking) return;
    ticking = true;
    try {
      const st = await settings();
      if (App.current() === 'inbox' && !document.hidden && Date.now() >= Math.max(S.retryAt || 0, App.graphTraffic?.until?.() || 0)) {
        queuePics(S.conv ? [S.conv, ...S.convs] : S.convs);
        const pages = App.selected();
        if (pages.length && Date.now() - (S.lastListAt || 0) >= Math.min(...pages.map(listInterval))) await load(true);
      }
      if (Date.now() - lastPoll >= pollEvery(st, App.pages) && Date.now() >= (App.graphTraffic?.until?.() || 0)) { lastPoll = Date.now(); await poll(st); }
    } finally { ticking = false; }
  }
  // Máy chủ (webhook) báo Page có tin mới: tải lại đúng Page đó, không đợi chu kỳ.
  let changedTimer = 0; const changedPages = new Set();
  App.inbox.changed = pageId => {
    if (!pageId) return;
    dirty.add(String(pageId)); changedPages.add(String(pageId));
    clearTimeout(changedTimer);
    changedTimer = setTimeout(async () => {
      const ids = [...changedPages]; changedPages.clear();
      if (App.current() === 'inbox' && !document.hidden && ids.some(id => App.isSelected(id))) await load(true);
      await poll(null, ids.map(id => App.pageById(id)).filter(Boolean));
    }, 800);
  };
  setInterval(() => { tick().catch(() => {}); }, 15e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick().catch(() => {}); });
  App.onLogin.push(async () => { lastPoll = Date.now(); await poll().catch(() => {}); });
})();
