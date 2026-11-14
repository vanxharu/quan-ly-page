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
    if (!autoPics || c.bs || !c.other.id || (cur && (!cur.auto || (!force && Date.now() - (cur.at || 0) < 2 * 864e5)))) return false;
    const r = await window.metaDesktop.lookupProfile({ pageId: String(c.page.id), psid: String(c.other.id), name: c.other.name || '' }).catch(e => ({ error: e.message }));
    if (r.error) {
      if (r.error === 'login' && !loginWarned) { loginWarned = true; toast('Mở menu "Hộp thư Meta" và đăng nhập Business Suite một lần để app tự lấy avatar khách.', 8000); }
      else if (!force) toast(`Chưa lấy được avatar ${c.other.name || ''} từ Business Suite (${r.error}). Menu Xem › "Lưu chẩn đoán Business Suite" rồi gửi file cho người hỗ trợ.`, 9000);
      return false;
    }
    if (!r.pic) return false;
    const all = await DB.get(App.customerUidKey, {});
    all[key] = S.manual[key] = { uid: r.uid || '', profileUrl: r.profileUrl || '', url: r.pic, at: Date.now(), auto: true };
    await DB.set(App.customerUidKey, all);
    S.pics.set(key, r.pic); paintPictures();
    if (S.conv && pictureKey(S.conv) === key) drawHead(S.conv);
    return true;
  }
  async function lookupList(btn) {
    const todo = S.convs.filter(c => !c.bs && !S.pics.get(pictureKey(c))).slice(0, 30);
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
    // Lỗi mã 1/2 ("unexpected error, retry later") của Facebook thường do lấy quá nhiều một lần: thử lại, mỗi lần ít hội thoại hơn.
    let res;
    for (const n of [...new Set([limit, 25, 10].filter(x => x <= limit))]) {
      try { res = await api(`/${page.id}/conversations`, { platform: 'messenger', limit: n, fields: CONV_FIELDS, ...(after ? { after } : {}) }, 'GET', page.access_token, { low }); break; }
      catch (e) { if (![1, 2].includes(Number(e.code)) || n === 10 || n === Math.min(limit, 10)) throw e; await new Promise(r => setTimeout(r, 1200)); }
    }
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
          h('div', { className: 'ib-toolbar' },
            h('div', { className: 'chips', id: 'ibFilter' }, ...[['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['unanswered', 'Chưa trả lời'], ['today', 'Hôm nay']].map(([f, t]) =>
              h('button', { className: 'chip', dataset: { f }, textContent: t, 'aria-pressed': String(f === S.filter), onclick: () => { S.filter = f; drawList(); } }))),
            h('select', { id: 'ibLabel', 'aria-label': 'Lọc theo nhãn', onchange: () => drawList() }),
            h('details', { className: 'ib-menu' },
              h('summary', { title: 'Thêm', 'aria-label': 'Thêm' }, '⋯'),
              h('div', { className: 'ib-menu-pop' },
                window.metaDesktop?.listThreads ? h('label', {}, 'Nguồn tin', h('select', { 'aria-label': 'Nguồn tin nhắn', title: 'Business Suite: đọc như hộp thư Meta, trả lời được cả tin quá 7 ngày (trong cột Meta). API: đọc và trả lời ngay trong app.',
                  onchange: e => { local.set('inboxSource', e.target.value); S.convs = []; S.more.clear(); load(false, { force: true }); } },
                  h('option', { value: 'bs', textContent: 'Business Suite', selected: bsFirst() }), h('option', { value: 'api', textContent: 'API', selected: !bsFirst() }))) : null,
                window.metaDesktop?.openZalo ? h('button', { type: 'button', title: 'Mở Zalo Web (Zalo cá nhân) ở cột phải · Ctrl+Shift+Z', onclick: () => window.metaDesktop.openZalo() }, 'Mở Zalo') : null,
                window.metaDesktop?.lookupProfile ? h('button',{type:'button',textContent:'Lấy avatar khách',title:'Đọc avatar + UID khách từ Business Suite (từng khách, tối đa 30)',onclick:e=>lookupList(e.currentTarget)}) : null,
                h('button',{type:'button',textContent:'Báo lỗi ảnh',title:'Tải báo lỗi ảnh khách trên phiên hiện tại',onclick:downloadAvatarDiagnostic})))),
          h('div', { className: 'list', id: 'ibList' }),
          h('button', { type: 'button', className: 'ib-more', id: 'ibMore', hidden: true, textContent: 'Tải thêm hội thoại', onclick: loadMore })),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', id: 'ibTitle', textContent: 'Chưa chọn hội thoại' }),
            h('button', { className: 'btn btn-ghost', id: 'ibReload', hidden: true, textContent: '↻ Đọc lại', title: 'Đọc lại tin của hội thoại', onclick: () => S.conv && (S.conv.bs ? openBs(S.conv, { silent: true }) : openConv(S.conv)) })),
          h('div', { className: 'thread-wrap' }, h('div', { className: 'thread', id: 'ibThread' }, empty('Chọn một hội thoại bên trái để xem tin nhắn.')),
            h('button', { type: 'button', className: 'ib-newmsg', id: 'ibNewMsg', hidden: true, textContent: '↓ Tin mới', onclick: () => toBottom(true) })),
          h('div', { id: 'ibCrm', className: 'crm', hidden: true }),
          h('div', { className: 'composer' },
            h('div', { id: 'ibOrder', hidden: true }),
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
              App.services ? h('button', { type: 'button', className: 'tpl-btn ib-order-btn', id: 'ibOrderBtn', title: 'Tạo đơn dịch vụ cho khách này (mở khung bên trái, vẫn xem được tin nhắn)', disabled: true,
                onclick: () => { const c = S.conv; if (c) App.services.createDialog({ page: c.page, key: c.key, name: c.other.name || '', messages: S.messages, dock: true }); } }, '🧾', h('span', { textContent: 'Tạo đơn' })) : null,
              h('textarea', { id: 'ibText', 'aria-label': 'Nội dung trả lời', placeholder: 'Nhập tin trả lời… (gõ / để chọn mẫu)', title: 'Enter gửi · Shift+Enter xuống dòng · / chọn mẫu · quá 24 giờ: tự gửi kèm thẻ Nhân viên trả lời (tới 7 ngày)', rows: 1, disabled: true, oninput: onType, onkeydown: onKey }),
              h('button', { className: 'send-btn', id: 'ibSend', disabled: true, 'aria-label': 'Gửi', onclick: send }, icon('i-send')))))));
      // Menu ⋯: bấm ra ngoài hoặc chọn một mục thì đóng.
      document.addEventListener('click', e => { const m = el.querySelector('.ib-menu'); if (m?.open && (!m.contains(e.target) || e.target.closest('.ib-menu-pop button'))) m.open = false; });
    },
    refresh() { load(S.convs.length > 0); }
  });
  App.onPageChange.push(() => { saveDraft(); S.conv = null; S.more.clear(); S.extra.clear(); resetThread(); });

  // Khoảng làm mới danh sách khi đang xem Hộp thư; Page đã nối webhook máy chủ thì thưa hơn (tin mới được báo ngay).
  // App Windows: mặc định đọc danh sách hội thoại từ Business Suite (khung ẩn) cho mọi Page, gộp chung; Business Suite lỗi
  // (chưa đăng nhập…) thì dùng Graph API. Bấm vào hội thoại sẽ mở đúng khách trong cột Meta để đọc/trả lời,
  // kể cả tin quá 7 ngày mà API không cho gửi. Mỗi Page đọc lại tối đa 1 lần/phút.
  const bsCache = new Map(), bsNotified = new Map();
  let bsLoginWarned = false;
  const bsFirst = () => !!window.metaDesktop?.listThreads && local.get('inboxSource') !== 'api';
  // Giờ Business Suite ghi dạng chữ ("5 phút", "14:20", "Th 3", "12 thg 11") → mốc thời gian để xếp chung với Page khác.
  function bsTime(text, now = Date.now()) {
    const t = String(text || '').trim().toLowerCase();
    if (/^(vừa xong|now|just now)$/.test(t)) return now;
    if (/^(hôm qua|yesterday)$/.test(t)) return now - 864e5;
    { // thứ trong tuần: "Thứ 6", "Thứ Sáu", "Chủ nhật", "Fri"
      const wd = { hai: 1, ba: 2, 'tư': 3, 'năm': 4, 'sáu': 5, 'bảy': 6, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
      let want = null, w;
      if ((w = t.match(/^(?:thứ|th|t)\s?([2-7])$/))) want = w[1] - 1;
      else if ((w = t.match(/^thứ\s+(hai|ba|tư|năm|sáu|bảy)$/))) want = wd[w[1]];
      else if (/^(chủ nhật|cn)$/.test(t)) want = 0;
      else if ((w = t.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/))) want = wd[w[1]];
      if (want != null) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (((d.getDay() - want) + 7) % 7 || 7)); return d.getTime(); }
    }
    { const mon = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }, w = t.match(/^([a-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
      if (w && mon[w[1]]) { const d = new Date(now); let at = new Date(w[3] ? +w[3] : d.getFullYear(), mon[w[1]] - 1, +w[2], 12).getTime(); if (!w[3] && at > now) at = new Date(d.getFullYear() - 1, mon[w[1]] - 1, +w[2], 12).getTime(); return at; } }
    let m = t.match(/^(\d+)\s*(giây|phút|giờ|ngày|tuần|tháng|năm|[smhdwy])$/);
    if (m) return now - m[1] * ({ 'giây': 1, s: 1, 'phút': 60, m: 60, 'giờ': 3600, h: 3600, 'ngày': 86400, d: 86400, 'tuần': 604800, w: 604800, 'tháng': 2592000, 'năm': 31536000, y: 31536000 }[m[2]]) * 1000;
    const d = new Date(now);
    if ((m = t.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/))) { const hh = (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0); d.setHours(hh, +m[2], 0, 0); return d.getTime() > now ? d.getTime() - 864e5 : d.getTime(); }
    if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) { d.setHours(+m[1], +m[2], 0, 0); return d.getTime() > now ? d.getTime() - 864e5 : d.getTime(); }
    if ((m = t.match(/^(?:th\s?([2-7])|(cn))$/))) { const want = m[2] ? 0 : m[1] - 1; d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (((d.getDay() - want) + 7) % 7 || 7)); return d.getTime(); }
    if ((m = t.match(/^(\d{1,2})(?:\s*(?:thg|tháng)\s*|\/)(\d{1,2})(?:(?:\/|,\s*)(\d{2,4}))?$/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : d.getFullYear();
      let at = new Date(y, m[2] - 1, +m[1], 12).getTime();
      if (!m[3] && at > now) at = new Date(y - 1, m[2] - 1, +m[1], 12).getTime();
      return at;
    }
    return null;
  }
  // Dòng danh sách Business Suite → hội thoại trong app.
  // Nhãn giai đoạn của Business Suite bị đọc nhầm thành tin cuối (vd "Đã chu..." = "Đã chuyển đổi"): bỏ, dùng tin cuối đã biết.
  const BS_CHIPS = ['hôm nay', 'hôm qua', 'today', 'yesterday', 'ai đang phản hồi', 'ai đã chuyển', 'trao đổi thêm', 'đã chuyển đổi', 'khách hàng mới', 'tiếp nhận', 'đủ tiêu chuẩn', 'không hoạt động', 'ordered', 'intake', 'qualified', 'converted'];
  const bsChip = t => { const s = String(t || '').trim().toLowerCase(), cut = s.replace(/\s*(…|\.{3})$/, '');
    return !!s && BS_CHIPS.some(c => c === s || (cut !== s && cut.length >= 2 && c.startsWith(cut))); };
  const lastSaid = id => { const m = (bsMsgCache.get(id)?.messages || []).filter(x => !x.sep && (x.text || x.pic)).pop(); return m ? (m.mine ? 'Bạn: ' : '') + (m.text || 'Đã gửi một ảnh.') : ''; };
  function bsConvs(p, rows, base = Date.now()) {
    let prev = base + 1000;
    for (const row of rows) if (bsChip(row.snippet)) { const id = `bs:${p.id}:${row.uid}`, old = S.convs.find(x => x.id === id)?.snippet;
      row.snippet = old && !bsChip(old) ? old : lastSaid(id); }
    return rows.map((row, i) => {
      // Dùng đúng mốc giờ của từng dòng (dòng ghim / hội thoại Meta AI ở đầu có thể cũ hơn các dòng dưới, không được kéo cả danh sách lùi theo).
      // Dòng không có giờ: ngay sau dòng trước. Cùng mốc (vd cùng "Thứ Sáu") thì trừ vài mili giây để giữ thứ tự của Business Suite.
      const t = row.at ? Number(row.at) : bsTime(row.time, base); // dữ liệu gốc có giờ chính xác
      const at = t != null ? t - i : prev - 1000; prev = at;
      const c = { id: `bs:${p.id}:${row.uid}`, bs: true, uid: row.uid, page: p, other: { id: 'bs' + row.uid, name: row.name },
        snippet: row.snippet, timeText: row.time, updated_time: new Date(at).toISOString(),
        unread_count: Math.max(row.unread ? Math.max(1, Number(row.unread) || 1) : 0, /^(bạn|you)\s*:/i.test(row.snippet || '') ? 0 : unreadHold.get(`bs:${p.id}:${row.uid}`) || 0),
        // Nhãn CRM ghép theo Page + tên khách (giống hội thoại đọc qua API); tin cuối "Bạn: …" là Page đã trả lời.
        key: App.crmKey(p.id, row.name), lastAt: at, fromCustomer: !/^(bạn|you)\s*:/i.test(row.snippet) };
      if (row.pic) S.pics.set(pictureKey(c), row.pic);
      return c;
    });
  }
  // Danh sách đã đọc lần trước (lưu máy, tối đa 3 ngày): hiện ngay khi mở Hộp thư, trong lúc khung ẩn đọc bản mới.
  async function bsSaved(p) {
    const hit = bsCache.get(p.id); if (hit) return hit.list;
    const d = await DB.get('bsList:' + p.id, null).catch(() => null);
    return d?.rows?.length && Date.now() - d.at < 3 * 864e5 ? bsConvs(p, d.rows, d.at) : [];
  }
  // Đọc trước tin của 5 khách mới nhất mỗi Page (chạy nền trong khung ẩn của Page đó): bấm vào khách là hiện tin ngay.
  // Chỉ đọc lại khách có tin cuối đổi. Xong thì mở lại hội thoại bạn đang xem (nếu cùng Page) để vẫn theo dõi trực tiếp.
  const prefetching = new Set(), pf = { todo: 0, done: 0, timer: 0 };
  // Thanh nhỏ trên danh sách: "Đang đọc trước tin 3/12…" → "✓ Đã đọc trước tin 12 khách" (tự ẩn sau 4 giây).
  function pfBar() {
    const list = $('ibList'); if (!list) return;
    let bar = $('ibPf');
    if (!bar) { bar = h('div', { id: 'ibPf', className: 'ib-pf' }, h('span'), h('i')); list.before(bar); }
    const say = (t, pct) => { bar.firstChild.textContent = t; bar.lastChild.style.width = pct + '%'; };
    clearTimeout(pf.timer);
    if (pf.done < pf.todo) { bar.style.opacity = '1'; bar.hidden = false; say(`Đang đọc trước ${pf.done}/${pf.todo}`, Math.round(pf.done / pf.todo * 100)); return; }
    if (!pf.todo) { bar.hidden = true; return; }
    bar.style.opacity = '1'; bar.hidden = false; say(`✓ Đã đọc trước ${pf.done} khách`, 100);
    pf.timer = setTimeout(() => { bar.style.opacity = '0'; pf.timer = setTimeout(() => { bar.hidden = true; pf.todo = pf.done = 0; }, 400); }, 4000);
  }
  // Khách vừa nhắn (tin mới từ dữ liệu gốc) → đọc trước hội thoại đó ngay ở nền, lúc bạn bấm vào là tin đã có sẵn.
  // Gộp các tin dồn dập trong 1,5 giây; khách đang mở thì đã tự cập nhật nên bỏ qua.
  const hotQ = new Map(); let hotT = 0, hotBusy = false;
  function prefetchHot(c) {
    if (!c?.bs || S.conv?.id === c.id || !window.metaDesktop?.readThread) return;
    hotQ.set(c.id, c); clearTimeout(hotT); hotT = setTimeout(runHot, 1500);
  }
  async function runHot() {
    if (hotBusy) { hotT = setTimeout(runHot, 1500); return; }
    hotBusy = true;
    try {
      while (hotQ.size) {
        const [id, c] = hotQ.entries().next().value; hotQ.delete(id);
        if (S.conv?.id === id) continue;
        const r = await window.metaDesktop.readThread({ pageId: String(c.page.id), uid: c.uid, bg: true }).catch(() => null);
        if (!r?.messages?.length) continue;
        const keep = { snippet: c.snippet, messages: r.messages.filter(m => !/^blob:/.test(m.pic || '')).slice(-60) };
        bsMsgCache.set(c.id, keep); DB.set('bsMsg:' + c.id, keep).catch(() => {});
        relabelFrom(c, r.messages).then(ok => { if (ok) App.crm.all().then(x => { S.crm = x; if (App.current() === 'inbox') drawList(); }); }).catch(() => {});
      }
    } finally { hotBusy = false; }
  }
  // Khớp lại nhãn tự gắn ("Hỏi giá"…) từ tin đã đọc của khách (tin Business Suite: mine = của shop).
  async function relabelFrom(c, messages) {
    const said = (messages || []).filter(m => !m.sep).map(m => ({ isCustomer: !m.mine, text: m.text || '' })), st = await settings();
    if (!st.autoTag || !said.some(m => m.isCustomer && m.text)) return false;
    await App.crm.syncAutoLabels(c.key, InboxRules.detectAutoLabels(said, st.rules), { pageId: c.page.id, pageName: c.page.name, name: c.other.name }, st.rules.map(x => x.label)).catch(() => {});
    return true;
  }
  // Mở Hộp thư: khớp lại nhãn cho các khách đã có tin lưu sẵn (gỡ nhãn gắn nhầm trước đây), không cần đọc lại.
  const relabeled = new Set();
  async function relabelCached(list) {
    let n = 0;
    for (const c of list.slice(0, 60)) {
      if (relabeled.has(c.id)) continue; relabeled.add(c.id);
      const old = bsMsgCache.get(c.id) || await DB.get('bsMsg:' + c.id, null).catch(() => null);
      if (old?.messages?.length && await relabelFrom(c, old.messages)) n++;
    }
    if (n) { S.crm = await App.crm.all(); if (App.current() === 'inbox') drawList(); }
  }
  async function bsPrefetch(p, list) {
    if (prefetching.has(p.id) || !window.metaDesktop?.readThread) return;
    prefetching.add(p.id);
    try {
      const top = [...list].sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time)).slice(0, 5);
      let moved = false;
      const need = [];
      for (const c of top) {
        if (S.conv?.id === c.id) continue; // đang xem: tự cập nhật trực tiếp rồi
        const old = bsMsgCache.get(c.id) || await DB.get('bsMsg:' + c.id, null).catch(() => null);
        if (!(old?.snippet === c.snippet && old.messages?.length)) need.push(c);
      }
      if (!need.length) return;
      pf.todo += need.length; pfBar(); let relabel = false;
      for (const c of need) {
        const r = await window.metaDesktop.readThread({ pageId: String(p.id), uid: c.uid, bg: true }).catch(() => null);
        pf.done++; pfBar();
        if (!r?.messages?.length) continue;
        moved = true;
        const keep = { snippet: c.snippet, messages: r.messages.filter(m => !/^blob:/.test(m.pic || '')).slice(-60) };
        bsMsgCache.set(c.id, keep); DB.set('bsMsg:' + c.id, keep).catch(() => {});
        if (await relabelFrom(c, r.messages)) relabel = true; // đọc trước cũng khớp lại nhãn tự gắn
      }
      if (relabel) { S.crm = await App.crm.all(); if (App.current() === 'inbox') drawList(); }
      const cur = S.conv;
      if (moved && cur?.bs && cur.page.id === p.id) window.metaDesktop.readThread({ pageId: String(p.id), uid: cur.uid, bg: true }).catch(() => {});
    } finally { prefetching.delete(p.id); }
  }
  async function bsThreads(p, { force = false } = {}) {
    if (!window.metaDesktop?.listThreads) return null;
    const hit = bsCache.get(p.id);
    if (hit && !force && Date.now() - hit.at < 60e3) return hit.list;
    const r = await window.metaDesktop.listThreads({ pageId: String(p.id), max: S.bsMax || 15, full: force && (S.bsMax || 15) > 15 });
    if (r?.error === 'login') { if (bsLoginWarned) return null; bsLoginWarned = true; toast('Đăng nhập Business Suite trong cột Meta (menu "Hộp thư Meta") để app đọc tin khi API lỗi.', 8000); return null; }
    if (r?.busy) return bsCache.get(p.id)?.list || null; // khung đang mở hội thoại bạn chọn: giữ danh sách hiện có, đọc lại lần sau
    if (r?.error) throw new Error(r.error); // báo lý do lên đầu danh sách thay vì lặng lẽ dùng danh sách API cũ
    if (!r?.rows?.length) return null;
    // Lần làm mới nhanh chỉ đọc phần đầu danh sách: ghép thêm các hội thoại cũ đã biết (không có trong phần vừa đọc).
    const old = await DB.get('bsList:' + p.id, null).catch(() => null), got = new Set(r.rows.map(x => x.uid));
    const keepOld = old?.rows?.length && Date.now() - old.at < 3 * 864e5 ? old.rows.filter(x => !got.has(x.uid)) : [];
    const now = Date.now(), fresh = bsConvs(p, r.rows, now);
    DB.set('bsList:' + p.id, { at: now, rows: [...r.rows, ...keepOld].slice(0, 80) }).catch(() => {});
    const list = [...fresh, ...bsConvs(p, keepOld, old?.at || now)];
    for (const c of fresh) c.src = r.source || 'dom'; // ls = dữ liệu gốc, dom = đọc màn hình
    // Báo tin mới (khách nhắn, chưa đọc) — lần đọc đầu tiên của Page chỉ ghi nhận, không báo.
    const st = await settings();
    const known = bsNotified.has(p.id);
    for (const c of list) {
      const sig = `${c.snippet}|${c.timeText}`;
      if (known && c.unread_count && bsNotified.get(c.id) !== sig && st.webNotify && !st.mutedPages?.includes(p.id) && InboxRules.notifyAllowed(st, p.id))
        App.notify(`💬 ${c.other.name} · ${p.name}`, c.snippet || 'Tin nhắn mới');
      bsNotified.set(c.id, sig);
    }
    bsNotified.set(p.id, true);
    bsCache.set(p.id, { at: Date.now(), list });
    setTimeout(() => { relabelCached(list).catch(() => {}); bsPrefetch(p, list).catch(() => {}); }, 500);
    return list;
  }
  // Hội thoại từ Business Suite: app đọc tin trong khung ẩn và hiện ngay trong khung chat; gửi tin cũng qua khung ẩn
  // (giống bạn gõ trong Business Suite), nên không vướng giới hạn của API.
  const bsMsgCache = new Map();
  async function openBs(c, { silent = false, older = false } = {}) {
    if (!silent) {
      App.services?.closeDock?.();
      saveDraft(); S.conv = c; resetThread(); drawHead(c);
      $('ibReload').hidden = false;
      // Hiện ngay bản đọc lần trước (nếu có) trong lúc khung ẩn mở hội thoại, rồi thay bằng bản mới.
      const cached = bsMsgCache.get(c.id) || await DB.get('bsMsg:' + c.id, null).catch(() => null);
      if (S.conv !== c) return;
      if (cached?.messages?.length) { drawBs(c, cached); $('ibThread').append(h('div', { className: 'hint', style: 'text-align:center;margin:6px 0', id: 'ibBsUpd', textContent: 'Đang cập nhật tin mới…' })); }
      else $('ibThread').replaceChildren(empty('Đang đọc tin từ Business Suite…'));
      c.unread_count = 0; unreadHold.delete(c.id); drawList();
      const draft = await DB.get(draftKey(c), {}).catch(() => ({}));
      if (S.conv !== c) return;
      $('ibText').value = draft.text || ''; S.image = draft.image || ''; S.draftReady = true; $('ibText').disabled = false; drawAttach();
    } else S.conv = c;
    const r = await window.metaDesktop.readThread({ pageId: String(c.page.id), uid: c.uid, older }).catch(e => ({ error: e.message }));
    if (S.conv !== c) return;
    if (r.error && silent && !older) return; // đọc ngầm lỗi: giữ nguyên khung chat
    if (r.error) return $('ibThread').replaceChildren(h('div', { className: 'status err' },
      r.error === 'login' ? 'Chưa đăng nhập Business Suite trong app (menu "Hộp thư Meta").' : `${r.error} Menu Xem › "Lưu chẩn đoán Business Suite" rồi gửi file "an" cho người hỗ trợ.`, ' ',
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Mở trong cột Meta ↗', onclick: () => window.metaDesktop.openThread({ pageId: String(c.page.id), uid: c.uid }) })));
    // Đọc lại ngầm mà không có gì mới: không vẽ lại (giữ chỗ cuộn, không nháy).
    const sig = JSON.stringify(r.messages || []);
    if (silent && !older && c.bsSig === sig) return;
    if (!older) { c.bsSig = sig; const keep = { snippet: c.snippet, messages: (r.messages || []).filter(m => !/^blob:/.test(m.pic || '')).slice(-60) }; bsMsgCache.set(c.id, keep); DB.set('bsMsg:' + c.id, keep).catch(() => {}); }
    drawBs(c, r, older ? { silent: true, keepTop: true } : { silent, older });
    S.messages = (r.messages || []).filter(m => !m.sep).map(m => ({ isCustomer: !m.mine, text: m.text || '' }));
    // Tin cuối trong hội thoại khác dòng trên danh sách (danh sách chưa kịp cập nhật): sửa luôn dòng đó + đưa lên đầu nếu mới hơn.
    const lastMsg = (r.messages || []).filter(m => !m.sep && (m.text || m.pic)).pop();
    if (lastMsg && !older) {
      const snip = (lastMsg.mine ? 'Bạn: ' : '') + (lastMsg.text || 'Đã gửi một ảnh.');
      const row = S.convs.find(x => x.id === c.id);
      if (row && row.snippet !== snip) {
        row.snippet = c.snippet = snip; row.fromCustomer = c.fromCustomer = !lastMsg.mine;
        const at = lastMsg.ts || Date.now();
        if (at > new Date(row.updated_time).getTime()) { row.updated_time = c.updated_time = new Date(at).toISOString(); row.lastAt = c.lastAt = at; row.timeText = c.timeText = ''; }
        S.convs.sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time)); drawList();
      }
    }
    clearIfSent(c, r.messages || []);
    if (!older) await tagAndCrm(c, { render: !silent });
  }
  // Ô nhập vẫn còn nội dung đã thực sự gửi (vd lần gửi trước báo lỗi nhầm): thấy tin của Page trùng nội dung trong hội thoại thì dọn ô nhập.
  // So khớp bỏ dấu cách, emoji, ký tự đặc biệt (Business Suite hiện emoji dạng ảnh nên chữ đọc được thiếu emoji).
  const bare = t => String(t || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  function clearIfSent(c, msgs) {
    if (S.conv !== c || S.sending) return;
    const t = bare($('ibText').value); if (t.length < 12) return;
    const head = t.slice(0, 60), tail = t.slice(-40);
    const sent = msgs.filter(m => m.mine && m.text).slice(-5).some(m => { const b = bare(m.text); return b.includes(head) && b.includes(tail); });
    if (!sent) return;
    $('ibText').value = ''; S.image = ''; S.tpl = null; drawAttach(); saveDraft(); updateSendState();
    toast('Tin này đã có trong hội thoại: đã dọn ô nhập để tránh gửi lặp.', 5000);
  }
  // Chỉ vẽ 10 tin mới nhất; cuộn lên đầu khung chat thì hiện thêm 10 tin (đã đọc sẵn), hết thì tải tin cũ hơn từ Business Suite.
  const BS_STEP = 10;
  // ── Ảnh trong tin: lưu ảnh đã xem trên máy (link ảnh của Facebook hết hạn sau vài ngày, mở lại không phải tải lại), bấm để xem lớn ──
  const picMem = new Map(), picBusy = new Set();
  // Khách có thể vừa chuyển khoản: gửi ảnh, hoặc nhắn "đã ck / đã chuyển / bill…" / gửi mã thanh toán DVxxxx → gợi ý Đã nhận tiền trên thanh đơn.
  const PAY_SAID = /(đã|da|mình|em|chị|anh)\s*(ck|chuyển|chuyen|gửi tiền|thanh toán|tt)\b|\bbill\b|\bck\s*(rồi|r|xong)\b|\bDV[A-Z0-9]{6}\b/i;
  S.payHint = new Map();
  const notePay = (key, why) => { if (!key) return; const had = S.payHint.get(key); S.payHint.set(key, { at: Date.now(), why }); if (!had || had.why !== why) drawOrder().catch(() => {}); };
  const picKey = u => 'pic:' + String(u || '').replace(/[?#].*$/, '').split('/').pop().slice(-90);
  const picSrc = u => picMem.get(picKey(u)) || u;
  async function cachePic(u) {
    if (!/^https:\/\//.test(u || '')) return null;
    const k = picKey(u); if (picMem.get(k)) return picMem.get(k); if (picBusy.has(k)) return null; picBusy.add(k);
    try {
      let d = await DB.get(k, null).catch(() => null);
      if (!d && window.metaDesktop?.svcImage) { const r = await window.metaDesktop.svcImage(u).catch(() => null); d = r?.dataUrl || null;
        if (d) { await DB.set(k, d).catch(() => {}); const idx = (await DB.get('picIndexV1', []).catch(() => [])).filter(x => x !== k); idx.push(k);
          for (const old of idx.splice(0, Math.max(0, idx.length - 200))) DB.del(old).catch(() => {}); DB.set('picIndexV1', idx).catch(() => {}); } }
      if (d) picMem.set(k, d);
      return d;
    } finally { picBusy.delete(k); }
  }
  const viewPic = src => { const box = h('div', { className: 'pic-view', onclick: () => box.remove() }, h('img', { src, alt: '' }), h('a', { href: src, download: 'anh.jpg', className: 'btn btn-ghost btn-sm', textContent: '⬇ Tải ảnh', onclick: e => e.stopPropagation() }));
    document.body.append(box); };
  const picEl = u => { const img = h('img', { src: /^https:/.test(u) ? picSrc(u) : u, alt: '', loading: 'lazy',
      onerror: async () => { if (img.dataset.retry) return; img.dataset.retry = '1'; const d = await cachePic(u); if (d) img.src = d; } });
    if (/^https:/.test(u) && !picMem.get(picKey(u))) cachePic(u).then(d => { if (d && img.src !== d) img.src = d; }).catch(() => {});
    // Ảnh nhỏ gọn trong khung chat; bấm để xem lớn.
    return h('button', { type: 'button', className: 'msg-pic', title: 'Bấm để xem ảnh lớn', onclick: () => viewPic(img.src) }, img, h('span', { className: 'msg-pic-zoom', textContent: '🔍' })); };
  // Tin mới nhất luôn ở cuối và luôn thấy được: mở hội thoại / gửi tin → cuộn xuống đáy; ảnh tải xong làm khung dài ra thì giữ ở đáy.
  // Đang kéo lên xem tin cũ mà có tin mới → hiện nút "↓ Tin mới" thay vì kéo bạn xuống.
  const nearBottom = t => t.scrollHeight - t.clientHeight - t.scrollTop < 80;
  function toBottom(force) { const t = $('ibThread'); if (!t) return; t.scrollTop = t.scrollHeight; if (force) S.stickUntil = Date.now() + 2500; const b = $('ibNewMsg'); if (b) b.hidden = true; }
  function watchThreadScroll() {
    const t = $('ibThread'); if (!t || t.__ga) return; t.__ga = true;
    t.addEventListener('load', () => { if (Date.now() < (S.stickUntil || 0) || S.atBottom) t.scrollTop = t.scrollHeight; }, true); // ảnh tải xong
    t.addEventListener('scroll', () => { S.atBottom = nearBottom(t); if (S.atBottom && $('ibNewMsg')) $('ibNewMsg').hidden = true; }, { passive: true });
  }
  // Ngay dưới link trong tin của khách: nút tạo đơn với đúng link đó (mở khung tạo đơn bên trái, link điền sẵn).
  function linkActions(c, text) {
    const links = App.services?.linksIn ? App.services.linksIn([{ isCustomer: true, text: text || '' }]).reverse() : [];
    if (!links.length) return null;
    return h('div', { className: 'msg-links' }, ...links.map(l => h('button', { type: 'button', className: 'msg-link-btn', title: 'Tạo đơn với link: ' + l,
      onclick: () => App.services.createDialog({ page: c.page, key: c.key, name: c.other.name || '', messages: S.messages, dock: true }, l) },
      '🧾 Tạo đơn', h('span', { textContent: ' · ' + l.replace(/^https?:\/\/(www\.|m\.)?/, '').slice(0, 32) + (l.length > 44 ? '…' : '') }))));
  }
  function drawBs(c, r, { silent = false, older = false, keepTop = false } = {}) {
    watchThreadScroll();
    const prevCount = c.bsShownCount || 0;
    const thread = $('ibThread'), atBottom = thread.scrollHeight - thread.clientHeight - thread.scrollTop < 70;
    const all = r.messages || [];
    { const tail = []; for (let i = all.length - 1; i >= 0 && tail.length < 8; i--) { const m = all[i]; if (m.sep) continue; if (m.mine) break; tail.push(m); }
      if (tail.some(m => m.pic)) notePay(c.key, 'pic'); else if (tail.some(m => PAY_SAID.test(m.text || ''))) notePay(c.key, 'text'); else if (S.payHint.has(c.key) && all.some(m => m.mine)) { S.payHint.delete(c.key); drawOrder().catch(() => {}); } }
    c.bsLast = r;
    if (!silent && !older && !keepTop) c.bsShow = BS_STEP;
    let start = Math.max(0, all.length - (c.bsShow || BS_STEP));
    if (start > 0 && all[start - 1]?.sep) start--; // giữ mốc giờ đi kèm tin đầu
    const msgs = all.slice(start), hiddenOld = start;
    const prevH = thread.scrollHeight, prevTop = thread.scrollTop;
    thread.replaceChildren(
      h('div', { style: 'text-align:center;margin:4px 0' }, h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: hiddenOld ? `Xem tin cũ hơn (${hiddenOld})` : 'Tải tin cũ hơn', onclick: () => bsOlder(c) })),
      ...msgs.map((m, i) => m.sep ? h('div', { className: 'hint', style: 'text-align:center;margin:8px 0', textContent: m.sep })
        : h('div', { className: 'msgrow' + (m.mine ? ' me' : '') },
          msgs[i + 1] && !msgs[i + 1].sep && msgs[i + 1].mine === m.mine ? h('span', { style: 'width:24px;flex:none' })
            : m.mine ? App.avatar(c.page.name, App.pageAvatarUrl(c.page), 24) : messageAvatar(c),
          h('div', { className: 'msg' + (m.mine ? ' me' : '') }, m.text || null, m.mine ? null : linkActions(c, m.text),
            m.pic ? picEl(m.pic) : null))),
      msgs.length ? null : empty('Chưa đọc được tin nào.'));
    // Hiện thêm tin cũ: giữ nguyên chỗ đang đọc (không nhảy).
    thread.scrollTop = keepTop ? thread.scrollHeight - prevH + prevTop : !silent || atBottom ? thread.scrollHeight : thread.scrollTop;
    if (!keepTop && (!silent || atBottom)) { S.stickUntil = Date.now() + (silent ? 1200 : 2500); S.atBottom = true; }
    const cnt = all.filter(m => !m.sep).length; c.bsShownCount = cnt;
    if (silent && !atBottom && !keepTop && cnt > prevCount && prevCount) { const b = $('ibNewMsg'); if (b) b.hidden = false; }
    thread.onscroll = () => { if (thread.scrollTop < 40 && S.conv === c && !c.bsOlderBusy && thread.scrollHeight > thread.clientHeight + 40) bsOlder(c, true); };
  }
  async function bsOlder(c, auto = false) {
    const r = c.bsLast; if (!r || S.conv !== c) return;
    const shown = c.bsShow || BS_STEP, total = (r.messages || []).length;
    if (shown < total) { c.bsShow = shown + BS_STEP; drawBs(c, r, { silent: true, keepTop: true }); return; }
    if (auto && c.bsNoOlderAt && Date.now() - c.bsNoOlderAt < 15e3) return; // vừa tải mà không có thêm: đừng tải liên tục khi cuộn
    c.bsOlderBusy = true;
    try { c.bsShow = shown + BS_STEP; await openBs(c, { silent: true, older: true }); if ((c.bsLast?.messages || []).length <= total) c.bsNoOlderAt = Date.now(); }
    finally { c.bsOlderBusy = false; }
  }
  // Ảnh mẫu tin có thể là link: đổi sang data URL để đưa vào Business Suite từ bộ nhớ.
  const asDataUrl = async src => src.startsWith('data:') ? src : fetch(src).then(r => r.blob()).then(b => new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = no; f.readAsDataURL(b); }));
  // Tự gắn nhãn theo lời khách + khung CRM; dùng chung cho hội thoại API và Business Suite (Business Suite không có PSID).
  // Thanh trạng thái đơn của khách đang mở (trên ô nhập tin) + chip 💳/🚀 trong danh sách khách.
  async function drawOrder() {
    if (!App.services?.orderStates) return;
    S.orderMap = await App.services.orderStates().catch(() => S.orderMap);
    const box = $('ibOrder'); if (!box) return;
    const bar = S.conv ? App.services.orderBar(S.orderMap?.get(S.conv.key), S.payHint?.get(S.conv.key)) : null;
    box.hidden = !bar; box.replaceChildren(...(bar ? [bar] : []));
    if (App.current() === 'inbox') drawList();
  }
  App.inbox.orderChanged = () => drawOrder().catch(() => {});
  setInterval(() => { if (App.current() === 'inbox' && !document.hidden) drawOrder().catch(() => {}); }, 60e3);
  async function tagAndCrm(c, { render }) {
    const st = await settings();
    if (S.conv !== c) return;
    const psid = c.bs ? S.crm?.[c.key]?.psid || '' : c.other.id;
    // Chỉ khớp lại khi đọc được tin của khách (đọc lỗi / chưa có tin khách thì giữ nguyên nhãn).
    if (st.autoTag && S.messages.some(m => m.isCustomer && m.text))
      await App.crm.syncAutoLabels(c.key, InboxRules.detectAutoLabels(S.messages, st.rules), { pageId: c.page.id, pageName: c.page.name, name: c.other.name, psid }, st.rules.map(r => r.label));
    S.crm = await App.crm.all();
    if (S.conv !== c) return;
    $('ibCrm').hidden = false;
    if (render) await App.crm.renderPanel($('ibCrm'), { page: c.page, psid, name: c.other.name || '', messages: S.messages, isCurrent: () => draftKey(S.conv) === draftKey(c) });
    if (render && App.services && S.conv === c) $('ibCrm').append(App.services.inboxBox({ page: c.page, key: c.key, name: c.other.name || '', messages: S.messages }));
    if (render) drawOrder();
    drawList();
  }
  async function sendBs(c, text) {
    const image = S.image, tpl = S.tpl;
    S.sending = true; updateSendState();
    // Xoá ô nhập + hiện tin (chữ, ảnh) "Đang gửi…" ngay, không chờ Business Suite xác nhận; lỗi thì trả chữ / ảnh lại ô nhập.
    let pending = null;
    if ((text || image) && S.conv === c) {
      $('ibText').value = ''; S.tpl = null; S.image = ''; drawAttach(); saveDraft();
      pending = h('div', { className: 'msgrow me ib-pending' }, h('div', { className: 'msg me' }, text || null,
        image ? picEl(image) : null),
        h('span', { className: 'hint', textContent: image ? 'Đang gửi ảnh…' : 'Đang gửi…' }));
      $('ibThread').append(pending); toBottom(true);
    }
    try {
      const data = image ? await asDataUrl(image).catch(() => { throw new Error('Không đọc được ảnh đính kèm.'); }) : '';
      const r = await window.metaDesktop.sendThread({ pageId: String(c.page.id), uid: c.uid, text, image: data });
      // Chữ đã đi, chỉ thiếu ảnh: xoá chữ khỏi ô nhập (giữ ảnh) để bấm gửi lại không lặp tin.
      if (r.error && /^Chữ đã gửi/.test(r.error) && S.conv === c && $('ibText').value.trim() === text) { $('ibText').value = ''; await saveDraft(); updateSendState(); }
      if (r.error && /^Chữ đã gửi/.test(r.error) && pending) { pending.remove(); pending = null; if (S.conv === c && !S.image) { S.image = image; drawAttach(); saveDraft(); } }
      if (r.error) throw new Error(r.error === 'login' ? 'Chưa đăng nhập Business Suite trong app.' : r.error);
      if (tpl) await App.recordTemplateUse(tpl, c.key);
      c.fromCustomer = false;
      if (S.conv === c) { if (!pending && $('ibText').value.trim() === text && S.image === image) { $('ibText').value = ''; S.image = ''; S.tpl = null; drawAttach(); await saveDraft(); }
        // Gửi thẳng (không mở hội thoại trong khung gửi) có thể không kèm danh sách tin → đọc lại để thấy tin vừa gửi.
        if (r.messages?.length) drawBs(c, r); else { pending?.remove(); pending = null; c.bsSig = ''; openBs(c, { silent: true }).catch(() => {}); } }
      pending?.remove();
      bsCache.delete(c.page.id);
    } catch (e) {
      S.sendError = e.message;
      if (pending) { pending.remove(); if (S.conv === c && !$('ibText').value.trim() && !S.image && !/^Đã bấm gửi/.test(e.message)) { $('ibText').value = text; S.tpl = tpl; S.image = image; drawAttach(); saveDraft(); } }
      // Có khi tin đã đi mà app chưa nhận ra: đọc lại hội thoại để bạn thấy ngay, rồi mới hiện lỗi.
      if (S.conv === c) { c.bsSig = ''; await openBs(c, { silent: true }).catch(() => {}); }
      if (S.conv === c) $('ibThread').append(h('div', { className: 'status err' }, e.message));
      else toast(`${c.other.name}: ${e.message}`, 7000);
    } finally { S.sending = false; updateSendState(); }
  }
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
    const errors = [], errorPages = [];
    const viaBs = bsFirst();
    // Business Suite đọc từng Page một (10–30 giây/Page): hiện ngay danh sách đã lưu, rồi mỗi Page đọc xong là cập nhật luôn.
    const partial = new Map();
    const paint = async () => {
      if (run !== S.loading) return;
      const all = pages.flatMap(p => partial.get(p.id) || S.convs.filter(c => c.page.id === p.id));
      S.convs = [...new Map([...S.extra.values(), ...all].map(c => [c.id, c])).values()].sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
      await drawList();
    };
    if (viaBs) {
      const saved = await Promise.all(pages.map(p => bsSaved(p).catch(() => [])));
      if (run !== S.loading) return;
      pages.forEach((p, i) => { if (saved[i].length && !S.convs.some(c => c.page.id === p.id)) partial.set(p.id, saved[i]); });
      if (partial.size) { S.crm = await App.crm.all(); await paint(); partial.clear(); }
    }
    const lists = await pool(pages, viaBs ? 4 : 3, async p => (viaBs && await bsThreads(p, { force }).then(l => { if (l?.length) { partial.set(p.id, l); paint(); } return l; })
      .catch(async e => { errors.push(`${p.name}: Business Suite — ${e.message}`); const saved = await bsSaved(p).catch(() => []); return saved.length ? saved : null; })) || convsFor(p, { maxAge: force ? 0 : silent ? listInterval(p) : 30e3, force, low: silent }).catch(async e => {
      const why = `${p.name}: ${e.message}${e.code ? ` (mã ${e.code}${e.sub ? '/' + e.sub : ''})` : ''}`;
      const bs = viaBs ? null : await bsThreads(p).catch(() => null);
      if (bs?.length) { errors.push(`${why} → đang hiện ${bs.length} hội thoại đọc từ Business Suite (bấm để mở trong cột Meta).`); return bs; }
      errors.push(why); errorPages.push(p);
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

    S.errorPages = errorPages; S.errors = errors;
    // Hội thoại đang mở có tin mới → đọc lại luôn.
    const fresh = S.conv && S.convs.find(c => c.id === S.conv.id);
    if (fresh && (fresh.bs ? fresh.snippet !== S.conv.snippet : fresh.updated_time !== S.conv.updated_time)) { fresh.unread_count = 0; fresh.bs ? openBs(fresh, { silent: true }) : openConv(fresh, { silent: true }); }
    queuePics(S.convs);
    if (S.pending) { $('ibSearch').value = S.pending; const hit = S.convs.find(c => norm(c.other.name) === norm(S.pending)); S.pending = ''; if (hit) openConv(hit); }
    drawList();
    } finally { if (run === S.loading) S.listBusy = false; }
  }
  async function loadMore() {
    if (S.moreBusy) return;
    // Còn khách đã tải nhưng đang ẩn: hiện thêm 15. Hết thì đọc thêm 15 khách mỗi Page từ Business Suite.
    if (S.hiddenMore > 0) { S.showN = (S.showN || 15) + 15; return drawList(); }
    if (bsFirst()) {
      S.moreBusy = true; $('ibMore').disabled = true; $('ibMore').textContent = 'Đang tải…';
      try { S.bsMax = (S.bsMax || 15) + 15; S.showN = (S.showN || 15) + 15; await load(true, { force: true }); }
      finally { S.moreBusy = false; $('ibMore').disabled = false; $('ibMore').textContent = 'Tải thêm hội thoại'; }
      return;
    }
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
      if (c.bs || !c.other.id || S.manual?.[pictureKey(c)]) continue;
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
    if ($('ibOrderBtn')) $('ibOrderBtn').disabled = !c;
    if (c.bs) return $('ibTitle').replaceChildren(h('span', { className: 'thread-head' }, custAvatar(c, 32),
      h('span', { className: 'th-text' }, h('div', { className: 'card-title', textContent: c.other.name }),
        h('div', { className: 'th-meta' }, h('span', { className: 'th-page', title: c.page.name, textContent: c.page.name }), h('span', { className: 'th-dot', textContent: '·' }),
          h('a', { href: 'https://www.facebook.com/profile.php?id=' + c.uid, target: '_blank', rel: 'noopener noreferrer', title: 'Mở trang cá nhân của khách', textContent: 'UID ' + c.uid }))),
      h('button', { type: 'button', className: 'th-btn', title: 'Mở hội thoại này trong cột Meta', textContent: 'Meta ↗', onclick: () => window.metaDesktop.openThread({ pageId: String(c.page.id), uid: c.uid }) })));
    const identity=S.identities.get(pictureKey(c));
    $('ibTitle').replaceChildren(h('span', { className: 'thread-head' }, custAvatar(c, 32),
      h('span', { style: 'min-width:0' }, h('div', { className: 'card-title', textContent: c.other.name || 'Khách' }), h('div', { className: 'hint', textContent: c.page.name }),
        !S.manual?.[pictureKey(c)]?.uid && S.manual?.[pictureKey(c)]?.profileUrl ? h('a',{className:'hint',href:S.manual[pictureKey(c)].profileUrl,target:'_blank',rel:'noopener noreferrer',textContent:'Trang cá nhân ↗'})
        : S.manual?.[pictureKey(c)]?.uid ? h('a',{className:'hint',href:'https://www.facebook.com/profile.php?id='+S.manual[pictureKey(c)].uid,target:'_blank',rel:'noopener noreferrer',textContent:'UID '+S.manual[pictureKey(c)].uid})
          : identity?h('a',{className:'hint',href:identity.profileUrl,target:'_blank',rel:'noopener noreferrer',textContent:'UID '+identity.uid}):null),
      h('button',{type:'button',className:'btn btn-ghost btn-sm',title:'Nhập UID Facebook của khách để hiện ảnh đại diện',textContent:S.manual?.[pictureKey(c)]?.uid?'Đổi UID':'Gắn UID',onclick:()=>setCustomerUid(c)}),
      App.metaLink(App.businessInboxUrl(c.page.id, c.other.id), 'Hộp thư Meta ↗')));
  }
  // Ô lọc nhãn: chỉ nhãn đang có trong danh sách, kèm số khách; vẽ lại mỗi lần danh sách đổi (nhãn mới / nhãn gỡ hiện ngay).
  function drawLabelFilter() {
    const sel = $('ibLabel'); if (!sel) return;
    const cur = sel.value, count = new Map(), seen = new Set();
    for (const c of S.convs) { if (seen.has(c.key)) continue; seen.add(c.key); for (const l of S.crm?.[c.key]?.labels || []) count.set(l, (count.get(l) || 0) + 1); }
    const labels = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b, 'vi'));
    const sig = JSON.stringify([cur, ...labels.map(l => [l, count.get(l)])]);
    if (sel.dataset.sig !== sig) {
      sel.replaceChildren(h('option', { value: '', textContent: labels.length ? 'Nhãn' : 'Chưa có nhãn' }),
        ...labels.map(l => h('option', { value: l, textContent: `${l} (${count.get(l)})`, selected: l === cur })));
      if (cur && !count.has(cur)) sel.value = ''; // nhãn đang lọc không còn khách nào
      sel.dataset.sig = JSON.stringify([sel.value, ...labels.map(l => [l, count.get(l)])]);
    }
    sel.classList.toggle('on', !!sel.value); sel.title = sel.value ? `Đang lọc nhãn: ${sel.value} (chọn "Nhãn" để bỏ lọc)` : 'Lọc theo nhãn';
  }
  async function drawList() {
    const st = await settings();
    drawLabelFilter();
    const q = norm($('ibSearch').value), lab = $('ibLabel').value, today = new Date().toDateString();
    [...$('ibFilter').children].forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === S.filter)));
    const list = S.convs.filter(c =>
      (S.filter !== 'unread' || c.unread_count) && (S.filter !== 'unanswered' || c.fromCustomer) &&
      (S.filter !== 'today' || new Date(c.updated_time).toDateString() === today) &&
      (!lab || (S.crm?.[c.key]?.labels || []).includes(lab)) &&
      (!q || norm(`${c.other.name} ${c.snippet} ${(S.crm?.[c.key]?.labels || []).join(' ')}`).includes(q)));
    // Mở Hộp thư chỉ hiện 15 khách mới nhất (tìm kiếm thì hiện hết kết quả); bấm "Tải thêm hội thoại" để hiện thêm 15.
    const total = list.length;
    if (!q) list.splice(S.showN || 15);
    S.hiddenMore = total - list.length;
    $('ibMore').hidden = !S.hiddenMore && ![...S.more.values()].some(x => x.after) && !bsFirst();
    const errors = S.errors?.length ? [h('details', { className: 'status err' },
      h('summary', { textContent: `${S.errors.length} Page chưa tải được tin mới.${S.convs.length ? ' Đang giữ danh sách đã tải.' : ''} Bấm xem chi tiết.` }),
      ...S.errors.map(e => h('div', { style: 'margin-top:8px', textContent: e })),
      // API lỗi: xem / trả lời tin của Page đó ngay trong Business Suite (cột Meta trong app, tab mới trên trình duyệt).
      ...(S.errorPages || []).map(p => h('div', { style: 'margin-top:6px' }, App.metaLink(`https://business.facebook.com/latest/inbox/all?asset_id=${p.id}`, `Mở hộp thư ${p.name.slice(0, 30)} trong Business Suite ↗`))))] : [];
    $('ibList').replaceChildren(...errors,
      ...(list.length ? list.map(c => {
        const wait = c.fromCustomer ? (Date.now() - c.lastAt) / 60e3 : null;
        const labels = S.crm?.[c.key]?.labels || [];
        return h('div', { className: 'item' + (c.unread_count ? ' unread' : '') + (S.conv?.id === c.id ? ' active' : ''), onclick: () => c.bs ? openBs(c) : openConv(c) },
          custAvatar(c),
          h('div', { className: 'body' },
            h('div', { className: 'top' }, h('span', { className: 'name', textContent: c.other.name || 'Khách' }),
              c.unread_count ? h('span', { className: 'badge', title: `Khách đã nhắn ${c.unread_count} tin chưa đọc`, textContent: c.unread_count > 99 ? '99+' : c.unread_count }) : null,
              h('span', { className: 'time', textContent: c.timeText || (new Date(c.updated_time).toDateString() === today ? new Date(c.updated_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : fmtShort(c.updated_time)) })),
            // Tin cuối + nhãn cùng một hàng (dòng nào cũng cao bằng nhau): tối đa 2 nhãn, còn lại gộp "+n".
            (() => {
              const chips = [S.orderMap?.has(c.key) ? h('span', { className: 'ord-chip ' + S.orderMap.get(c.key).kind, title: 'Đơn dịch vụ của khách', textContent: S.orderMap.get(c.key).chip }) : null,
                wait != null && wait < 7 * 1440 ? h('span', { className: 'wait' + (wait > st.waitMinutes ? ' late' : ''), title: 'Khách đang chờ trả lời', textContent: '⏳ ' + InboxRules.formatWait(wait) }) : null,
                ...labels.map(l => h('span', { className: 'lbl', title: 'Nhãn: ' + l, textContent: l }))].filter(Boolean);
              const more = chips.splice(2);
              return h('div', { className: 'snip-row' }, h('div', { className: 'snippet', textContent: c.snippet || '' }),
                chips.length ? h('div', { className: 'tags' }, ...chips, more.length ? h('span', { className: 'lbl more', title: more.map(x => x.textContent).join(' · '), textContent: '+' + more.length }) : null) : null);
            })()));
      }) : [empty(S.convs.length ? 'Không có hội thoại khớp bộ lọc.' : 'Chưa có tin nhắn.')]));
  }
  function resetThread() {
    S.draftReady = false; S.image = ''; S.tpl = null;
    if(!$('ibText'))return; // Đổi Page trước khi mở Hộp thư vẫn hợp lệ.
    $('ibText').value = ''; $('ibText').disabled = true; drawAttach();
    if ($('ibOrder')) $('ibOrder').hidden = true;
    if ($('ibOrderBtn')) $('ibOrderBtn').disabled = true;
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
    if (switching) { saveDraft(); App.services?.closeDock?.(); }
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
      let data = res.messages?.data || [];
      // Có lúc trường messages lồng trong hội thoại trả thiếu vài tin mới nhất (khác snippet ở danh sách): đọc lại qua /messages.
      const newest = [...data].sort((a, b) => new Date(b.created_time) - new Date(a.created_time))[0];
      if (c.snippet && newest && norm(newest.message || '') !== norm(c.snippet)) {
        const edge = await api(`/${c.id}/messages`, { fields: 'message,from,created_time,attachments{image_data,mime_type,name,file_url}', limit: 40 }, 'GET', c.page.access_token).catch(() => null);
        if (edge?.data?.length) data = edge.data;
      }
      if (S.conv !== c) return;
      // Sắp theo giờ gửi thay vì tin vào thứ tự Graph trả về.
      const msgs = data.slice().sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
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
        m.message || null, me(m) ? null : linkActions(c, m.message),
        ...(m.attachments?.data || []).map(a => a.image_data?.url ? picEl(a.image_data.url)
          : h('a', { href: a.file_url || '#', target: '_blank', rel: 'noopener', textContent: `📎 ${a.name || 'Tệp đính kèm'}` })),
        !m.message && !m.attachments?.data?.length ? '(nhãn dán / tin đặc biệt)' : null))));
      drawSeen(c);
      loadSeen(c);
      thread.scrollTop = !silent || atBottom ? thread.scrollHeight : oldTop;
      c.unread_count = 0;
      S.messages = msgs.map(m => ({ isCustomer: m.from?.id !== c.page.id, text: m.message || '' }));
      // Tải tin mới không dựng lại biểu mẫu CRM đang nhập dở.
      await tagAndCrm(c, { render: !silent || switching });
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
  // Tab khác (vd Dịch vụ › gửi đơn cho khách) gửi tin + ảnh vào đúng hội thoại đang mở; khác khách thì không gửi.
  App.inbox.compose = async ({ key, text = '', image = '', autoSend = true }) => {
    const c = S.conv;
    if (!c || !key || c.key !== key) return 'Hội thoại của khách không còn mở trong Hộp thư.';
    if (!S.draftReady || S.sending) return 'Hộp thư đang bận gửi tin khác, thử lại sau vài giây.';
    $('ibText').value = text; S.image = image; S.tpl = null; drawAttach(); await saveDraft(); updateSendState();
    if (!autoSend) return true;
    S.sendError = '';
    await send();
    // send() tự bắt lỗi và chỉ xoá ô nhập khi gửi thành công → còn chữ/ảnh nghĩa là chưa gửi được.
    // Ô nhập giờ trống ngay khi bấm gửi → xét lỗi gửi trước, ô nhập trống chỉ là dấu hiệu phụ.
    if (!S.sendError && S.conv === c && !$('ibText').value.trim() && !S.image) return true;
    return S.sendError || 'Chưa gửi được (nội dung vẫn nằm trong ô nhập của Hộp thư).';
  };
  App.inbox.openKey = () => S.conv?.key || '';
  async function send() {
    const c = S.conv, text = $('ibText').value.trim();
    if (S.sending || !S.draftReady || !c?.other.id || (!text && !S.image)) return;
    if (c.bs) return sendBs(c, text);
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
      const message = S.sendError = (e.partialTextSent ? 'Chữ đã gửi, nhưng ảnh chưa gửi được. Gửi lại ảnh để tránh lặp nội dung. ' : '') + (e.window ? e.message : e.sub === 2018278 ? 'Đã quá 24 giờ kể từ tin cuối của khách, Meta không cho Page nhắn tiếp.' : e.message) + (e.code ? ` (mã ${e.code}${e.sub ? '/' + e.sub : ''})` : '');
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
      const convs = (bsFirst() && await bsThreads(p).catch(() => null)) || await convsFor(p, { maxAge: Math.max(30e3, pollEvery(st, App.pages) - 10e3), low: true }).catch(e => e.cache || []);
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
  let bsLive = false, bsAgain = false;
  // App Windows báo danh sách hội thoại của một Page vừa đổi (khách nhắn mới) → đọc lại danh sách Page đó ngay, vẽ lại, báo tin.
  let bsListBusy = new Set(), bsListAgain = new Set();
  App.inbox.bsListChanged = async pageId => {
    if (!bsFirst()) return;
    const p = App.selected().find(x => String(x.id) === String(pageId)); if (!p) return;
    if (bsListBusy.has(p.id)) { bsListAgain.add(p.id); return; }
    bsListBusy.add(p.id);
    try {
      const list = await bsThreads(p, { force: true }).catch(() => null);
      if (list?.length) {
        for (const c of list) { const o = S.convs.find(x => x.id === c.id), held = unreadHold.get(c.id) || 0;
          if (o && o.lastMid) c.lastMid = o.lastMid;
          if (Math.max(held, o?.unread_count || 0) > (c.unread_count || 0) && (held || c.unread_count) && !/^(bạn|you)\s*:/i.test(c.snippet || '')) c.unread_count = Math.max(held, o?.unread_count || 0); }
        S.convs = [...new Map([...S.convs.filter(c => c.page.id !== p.id), ...list].map(c => [c.id, c])).values()].sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
        if (App.current() === 'inbox') await drawList();
        const fresh = S.conv && list.find(c => c.id === S.conv.id);
        if (fresh && fresh.snippet !== S.conv.snippet && !S.sending) { fresh.unread_count = 0; openBs(fresh, { silent: true }).catch(() => {}); }
      }
    } finally { bsListBusy.delete(p.id); if (bsListAgain.delete(p.id)) App.inbox.bsListChanged(p.id); }
  };
  // App Windows báo hội thoại đang mở trong khung ẩn vừa đổi (tin mới, đã gửi…) → đọc lại ngay.
  // Số tin chưa đọc app đã đếm: giữ tới khi BẠN mở khách trong app hoặc Page trả lời — đọc lại danh sách (Business Suite có khi coi là đã xem) không xoá.
  const unreadHold = new Map();
  App.inbox.bsChanged = (id, info) => {
    // Tin mới từ dữ liệu gốc: sửa ngay dòng khách trong danh sách (tin cuối, giờ, chưa đọc, đưa lên đầu) và báo tin.
    if (info?.ts && bsFirst()) {
      const row = S.convs.find(x => x.id === 'bs:' + id), pageId = id.split(':')[0];
      // Tin vừa đến (2 phút gần đây) mới được đếm/báo; tin cũ (đọc lại lịch sử) chỉ sửa dòng nếu mới hơn.
      const fresh = Date.now() - info.ts < 120e3;
      if (row && (info.mid == null || info.mid !== row.lastMid) && (fresh ? info.ts >= (row.lastAt || 0) - 1000 : info.ts > (row.lastAt || 0) + 60e3)) {
        row.lastMid = info.mid;
        row.snippet = (info.mine ? 'Bạn: ' : '') + info.text; row.fromCustomer = !info.mine;
        row.updated_time = new Date(info.ts).toISOString(); row.lastAt = info.ts; row.timeText = '';
        const viewing = S.conv?.id === row.id && App.current() === 'inbox' && !document.hidden;
        if (!info.mine && fresh) prefetchHot(row);
        if (!info.mine && fresh && (info.pic || /^Đã gửi một ảnh/.test(info.text) || PAY_SAID.test(info.text || ''))) notePay(row.key, info.pic || /^Đã gửi một ảnh/.test(info.text) ? 'pic' : 'text');
        if (info.mine) { row.unread_count = 0; unreadHold.delete(row.id); } // Page đã trả lời → hết chờ
        else if (!viewing && fresh) {
          // Đếm số câu khách đã nhắn (chưa đọc): cộng dồn từng tin mới, không thấp hơn số câu liên tiếp đọc từ dữ liệu gốc.
          row.unread_count = Math.max((row.unread_count || 0) + 1, info.streak || 1);
          unreadHold.set(row.id, row.unread_count);
          settings().then(st => { if (st.webNotify && !st.mutedPages?.includes(row.page.id) && InboxRules.notifyAllowed(st, row.page.id)) App.notify(`💬 ${row.other.name} · ${row.page.name}`, info.text || 'Tin nhắn mới'); }).catch(() => {});
        }
        bsNotified.set(row.id, `${row.snippet}|${row.timeText}`);
        S.convs.sort((a, b) => new Date(b.updated_time) - new Date(a.updated_time));
        const hit = bsCache.get(row.page.id); if (hit) hit.at = Date.now();
        if (App.current() === 'inbox') drawList();
      } else if (!row && !info.mine && Date.now() - info.ts < 10 * 60e3) App.inbox.bsListChanged(pageId); // khách mới chưa có trong danh sách
    }
    const c = S.conv;
    if (!c?.bs || `${c.page.id}:${c.uid}` !== id || S.sending || document.hidden) return;
    if (bsLive) { bsAgain = true; return; }
    bsLive = true; openBs(c, { silent: true }).catch(() => {}).finally(() => { bsLive = false; if (bsAgain) { bsAgain = false; App.inbox.bsChanged(id); } });
  };
  // Hội thoại Business Suite đang mở: đọc lại 20 giây/lần để tin mới của khách tự hiện (khung ẩn của Meta cập nhật trực tiếp).
  setInterval(async () => {
    const c = S.conv;
    if (bsLive || !c?.bs || S.sending || document.hidden || App.current() !== 'inbox') return;
    bsLive = true; try { await openBs(c, { silent: true }); } catch {} finally { bsLive = false; }
  }, 20e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick().catch(() => {}); });
  App.onLogin.push(async () => { lastPoll = Date.now(); await poll().catch(() => {}); });
  // App Windows: vừa mở app là các khung ẩn tải Business Suite + đọc danh sách + đọc trước tin luôn (không đợi bạn vào Hộp thư).
  App.onLogin.push(() => setTimeout(() => {
    if (!bsFirst()) return;
    for (const p of App.selected()) bsThreads(p).catch(() => {});
  }, 2500));
})();
