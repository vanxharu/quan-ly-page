/* Nhóm tab "Tự động": cấu hình bot chạy trên máy chủ (bảng rules, flows, page_settings, logs, bot_orders của Supabase).
 * Máy chủ (server/fb-webhook.ts) đọc các bảng này mỗi khi Facebook báo tin nhắn / bình luận mới. */
(() => {
  const S = App.server, sb = () => S.sb, q = (...a) => S.q(...a);
  let flowsCache = [], connected = [];
  const loadShared = async () => {
    [flowsCache, connected] = await Promise.all([q(sb().from('flows').select('*').order('created_at')), q(sb().from('pages').select('id,name,picture'))]);
  };
  const pageName = id => id ? (App.pageById(id)?.name || connected.find(p => p.id === id)?.name || id) : 'Mọi Page';
  const scopeSelect = (value = '') => h('select', { name: 'page_id' }, h('option', { value: '', textContent: 'Mọi Page' }),
    ...connected.map(p => h('option', { value: p.id, textContent: p.name, selected: p.id === value })));
  const flowSelect = (name, value = '', none = '— không —') => h('select', { name }, h('option', { value: '', textContent: none }),
    ...flowsCache.map(f => h('option', { value: f.id, textContent: f.name, selected: f.id === value })));
  const lines = v => String(v || '').split('\n').map(s => s.trim()).filter(Boolean);
  const notConnected = () => connected.length ? null : h('div', { className: 'status pending', textContent: 'Chưa có Page nào kết nối với máy chủ: vào Quản lý › Cài đặt › Máy chủ bot › "Kết nối … Page".' });
  const tplInsert = async target => {
    const tpls = await App.templates.list();
    return h('select', { style: 'width:auto', onchange: e => { const t = tpls.find(x => x.id === e.target.value); if (t) target.value = t.content; e.target.value = ''; } },
      h('option', { value: '', textContent: 'Chèn mẫu tin…' }), ...tpls.map(t => h('option', { value: t.id, textContent: t.title })));
  };
  const panel = (id, render) => App.tab(id, {
    mount(el) { el.append(h('div', { id: id + 'Body' })); },
    async refresh() {
      const el = $(id + 'Body');
      if (S.gate(el)) return;
      await guard(el, async () => { await loadShared(); await render(el); });
    }
  });

  // ── Quy tắc (dùng chung cho từ khoá tin nhắn và bình luận) ──
  function ruleList(el, kind, rerender) {
    let editing = null;
    const draw = async () => {
      const rules = await q(sb().from('rules').select('*').eq('kind', kind).order('priority', { ascending: false }).order('created_at'));
      const box = h('div', {});
      el.replaceChildren(...[notConnected(), box].filter(Boolean));
      box.append(
        h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: kind === 'message' ? `Quy tắc trả lời tin nhắn (${rules.length})` : `Quy tắc trả lời bình luận (${rules.length})` }),
          h('button', { className: 'btn btn-primary', textContent: '+ Quy tắc mới', onclick: () => { editing = {}; draw(); } })),
        editing ? await editor(editing) : '',
        rules.length ? h('div', { className: 'card scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['Tên', 'Từ khoá', 'Page', kind === 'message' ? 'Trả lời' : 'Công khai / Nhắn riêng', 'Lượt', 'Bật', ''].map((t, i) => h('th', { className: i < 4 ? 'left' : '', textContent: t })))),
          h('tbody', {}, ...rules.map(r => h('tr', {},
            h('td', { className: 'left', textContent: r.name || '—' }),
            h('td', { className: 'left' }, r.keywords.length ? h('div', { className: 'tags' }, ...r.keywords.map(k => h('span', { className: 'tag', textContent: k }))) : h('span', { className: 'hint', textContent: kind === 'message' ? 'mọi tin' : 'mọi bình luận' })),
            h('td', { className: 'left', textContent: pageName(r.page_id) + (r.post_id ? ` · bài ${r.post_id}` : '') }),
            h('td', { className: 'left', textContent: (r.flow_id ? `▶ ${flowsCache.find(f => f.id === r.flow_id)?.name || 'kịch bản'}` : '') + [r.public_reply, r.reply].filter(Boolean).join(' / ').slice(0, 90) }),
            h('td', { textContent: r.hits }),
            h('td', {}, h('input', { type: 'checkbox', checked: r.enabled, onchange: async e => { await q(sb().from('rules').update({ enabled: e.target.checked }).eq('id', r.id)); } })),
            h('td', {}, h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Sửa', onclick: () => { editing = r; draw(); } }),
              h('button', { className: 'btn btn-danger btn-sm', style: 'margin-left:4px', textContent: 'Xoá', onclick: async () => {
                if (!confirm('Xoá quy tắc này?')) return; await q(sb().from('rules').delete().eq('id', r.id)); draw();
              } }))))))) : empty(kind === 'message' ? 'Chưa có quy tắc. Ví dụ: từ khoá "giá, bao nhiêu" → gửi bảng giá.' : 'Chưa có quy tắc. Ví dụ: mọi bình luận → trả lời "Shop đã inbox bạn ạ" + nhắn riêng bảng giá.'));
    };
    async function editor(r) {
      const reply = h('textarea', { name: 'reply', value: r.reply || '', placeholder: kind === 'message' ? 'Nội dung bot gửi. Dùng được {tên}, {tên_khách}.' : 'Tin nhắn riêng gửi vào Messenger người bình luận (để trống = không nhắn).' });
      const form = h('form', { className: 'card', onsubmit: async e => {
        e.preventDefault(); const f = new FormData(form);
        const row = { kind, name: String(f.get('name')).trim(), keywords: String(f.get('keywords')).split(',').map(s => s.trim()).filter(Boolean),
          match: f.get('match'), page_id: f.get('page_id') || null, reply: String(f.get('reply')), flow_id: f.get('flow_id') || null,
          image_url: String(f.get('image_url') || '').trim(), priority: Number(f.get('priority')) || 0, enabled: !!f.get('enabled'),
          quick_replies: lines(f.get('quick')).map(t => ({ title: t.slice(0, 20), payload: `TEXT:${t}` })),
          ...(kind === 'comment' ? { public_reply: String(f.get('public_reply')), post_id: String(f.get('post_id') || '').trim() || null } : {}) };
        if (!row.reply && !row.flow_id && !row.public_reply) return toast('Cần nội dung trả lời hoặc kịch bản.');
        if (r.id) await q(sb().from('rules').update(row).eq('id', r.id)); else await q(sb().from('rules').insert(row));
        editing = null; toast('Đã lưu quy tắc. Bot dùng ngay, không cần tải lại.'); draw();
      } },
        h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: r.id ? 'Sửa quy tắc' : 'Quy tắc mới' })),
        h('div', { className: 'form-grid' },
          h('label', { className: 'field' }, 'Tên quy tắc', h('input', { type: 'text', name: 'name', value: r.name || '', placeholder: 'VD: Hỏi giá' })),
          h('label', { className: 'field' }, 'Từ khoá (cách nhau dấu phẩy, trống = tất cả)', h('input', { type: 'text', name: 'keywords', value: (r.keywords || []).join(', '), placeholder: 'giá, bao nhiêu, bảng giá' })),
          h('label', { className: 'field' }, 'Cách khớp', h('select', { name: 'match' }, h('option', { value: 'contains', textContent: 'Có chứa từ khoá' }), h('option', { value: 'exact', textContent: 'Đúng nguyên câu', selected: r.match === 'exact' }))),
          h('label', { className: 'field' }, 'Áp dụng cho', scopeSelect(r.page_id || '')),
          kind === 'comment' ? h('label', { className: 'field' }, 'ID bài viết (trống = mọi bài)', h('input', { type: 'text', name: 'post_id', value: r.post_id || '', placeholder: 'VD: 1234567890_9876543210' })) : null,
          kind === 'comment' ? h('label', { className: 'field wide' }, 'Trả lời công khai dưới bình luận (trống = không trả lời)', h('input', { type: 'text', name: 'public_reply', value: r.public_reply || '', placeholder: 'Shop đã inbox {tên} rồi ạ ❤️' })) : null,
          h('label', { className: 'field wide' }, kind === 'message' ? 'Bot trả lời' : 'Nhắn riêng (Facebook cho 1 tin trong 7 ngày kể từ bình luận)', reply),
          h('label', { className: 'field' }, 'Hoặc chạy kịch bản', flowSelect('flow_id', r.flow_id || '')),
          h('label', { className: 'field' }, 'Nút trả lời nhanh (mỗi dòng một nút)', h('textarea', { name: 'quick', value: (r.quick_replies || []).map(x => x.title).join('\n'), style: 'min-height:60px', placeholder: 'Đặt hàng\nXem thêm' })),
          kind === 'message' ? h('label', { className: 'field' }, 'Link ảnh gửi kèm (tuỳ chọn)', h('input', { type: 'url', name: 'image_url', value: r.image_url || '', placeholder: 'https://…' })) : null,
          h('label', { className: 'field' }, 'Ưu tiên (số lớn khớp trước)', h('input', { type: 'number', name: 'priority', value: r.priority || 0 })),
          h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', name: 'enabled', checked: r.enabled !== false }), 'Bật')),
        h('div', { className: 'row section-gap' }, h('button', { className: 'btn btn-primary', textContent: 'Lưu quy tắc' }), await tplInsert(reply),
          h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: () => { editing = null; draw(); } })));
      return form;
    }
    return draw();
  }

  panel('botrules', el => ruleList(el, 'message'));

  panel('botcomments', async el => {
    const settings = await q(sb().from('page_settings').select('*'));
    const top = h('div', { className: 'card' }, h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Với mọi bình luận (các Page đang chọn)' })));
    const rows = App.selected().filter(p => connected.some(c => c.id === p.id));
    const toggle = (s, key, label) => h('label', { className: 'row', style: 'gap:4px' }, h('input', { type: 'checkbox', checked: s[key], onchange: async e => {
      await q(sb().from('page_settings').update({ [key]: e.target.checked, updated_at: new Date().toISOString() }).eq('page_id', s.page_id)); toast('Đã lưu.');
    } }), label);
    top.append(rows.length ? h('div', { style: 'display:grid;gap:6px' }, ...rows.map(p => { const s = settings.find(x => x.page_id === p.id) || {};
      return h('div', { className: 'row', style: 'gap:14px' }, h('span', { className: 'row grow', style: 'gap:6px' }, App.avatar(p.name, App.pageAvatarUrl(p), 22), p.name),
        toggle(s, 'hide_phone', 'Ẩn bình luận có SĐT'), toggle(s, 'hide_link', 'Ẩn bình luận có link'), toggle(s, 'like_comments', 'Tự thích')); }))
      : h('p', { className: 'hint', textContent: 'Không có Page đang chọn nào đã kết nối máy chủ.' }));
    const list = h('div', { className: 'section-gap' });
    el.replaceChildren(top, list);
    await ruleList(list, 'comment');
    list.append(h('p', { className: 'hint', textContent: 'Mỗi người chỉ được bot trả lời 1 lần trên mỗi bài (bình luận thêm không bị trả lời lặp). Bình luận ẩn chỉ người viết và bạn bè họ thấy.' }));
  });

  // ── Kịch bản ──────────────────────────────────────────────
  const SAMPLE = () => ({ name: 'Chào & chốt đơn', steps: [
    { id: 's1', text: 'Chào {tên} 👋 Shop có thể giúp gì cho bạn?', buttons: [{ title: 'Xem bảng giá', next: 's2' }, { title: 'Đặt hàng', next: 's3' }, { title: 'Gặp nhân viên', next: 's7' }] },
    { id: 's2', text: 'Bảng giá của shop: …(sửa nội dung ở đây)…', buttons: [{ title: 'Đặt hàng', next: 's3' }] },
    { id: 's3', text: 'Bạn cho shop xin tên người nhận nhé?', ask: 'name', next: 's4' },
    { id: 's4', text: 'Số điện thoại của {tên} là?', ask: 'phone', next: 's5' },
    { id: 's5', text: 'Địa chỉ nhận hàng ạ?', ask: 'address', next: 's6' },
    { id: 's6', text: 'Cảm ơn {tên}! Shop đã nhận đơn, nhân viên sẽ gọi {sdt} để xác nhận ạ.', action: 'order' },
    { id: 's7', text: 'Nhân viên sẽ trả lời bạn ngay khi có thể ạ 🙏' }] });
  let editingFlow = null;
  panel('botflows', async function draw(el) {
    const body = h('div', {});
    el.replaceChildren(body);
    body.append(h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: `Kịch bản (${flowsCache.length})` }),
      h('button', { className: 'btn btn-soft', textContent: '+ Tạo từ mẫu "Chào & chốt đơn"', onclick: () => { editingFlow = SAMPLE(); draw(el); } }),
      h('button', { className: 'btn btn-primary', textContent: '+ Kịch bản trống', onclick: () => { editingFlow = { name: '', steps: [{ id: 's1', text: '' }] }; draw(el); } })));
    if (editingFlow) body.append(flowEditor(editingFlow, async () => { editingFlow = null; await loadShared(); draw(el); }));
    body.append(flowsCache.length ? h('div', { className: 'tpl-cards' }, ...flowsCache.map(f => h('div', { className: 'tpl-card' },
      h('strong', { textContent: f.name }), h('div', { className: 'hint', textContent: `${f.steps.length} bước · ${f.steps.filter(s => s.ask).map(s => ({ name: 'tên', phone: 'SĐT', address: 'địa chỉ' })[s.ask]).join(', ') || 'không hỏi thông tin'}${f.steps.some(s => s.action === 'order') ? ' · tạo đơn' : ''}` }),
      h('div', { className: 'content', textContent: f.steps[0]?.text || '' }),
      h('div', { className: 'actions' }, h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Sửa', onclick: () => { editingFlow = structuredClone(f); draw(el); scrollTo({ top: 0, behavior: 'smooth' }); } }),
        h('button', { className: 'btn btn-danger btn-sm', textContent: 'Xoá', onclick: async () => { if (!confirm(`Xoá kịch bản "${f.name}"?`)) return; await q(sb().from('flows').delete().eq('id', f.id)); await loadShared(); draw(el); } })))))
      : empty('Chưa có kịch bản. Bấm "Tạo từ mẫu" để có sẵn luồng chào khách → hỏi tên, SĐT, địa chỉ → tạo đơn.'));
  });
  function flowEditor(f, done) {
    const wrap = h('div', { className: 'card' });
    const draw = () => {
      const ids = f.steps.map(s => s.id);
      const stepSel = (value, onchange, none = '— kết thúc —') => h('select', { style: 'width:auto', onchange: e => onchange(e.target.value) },
        h('option', { value: '', textContent: none }), ...ids.map(id => h('option', { value: id, textContent: `Bước ${id}`, selected: id === value })));
      wrap.replaceChildren(
        h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: f.id ? 'Sửa kịch bản' : 'Kịch bản mới' })),
        h('label', { className: 'field' }, 'Tên kịch bản', h('input', { type: 'text', value: f.name, oninput: e => { f.name = e.target.value; } })),
        ...f.steps.map((s, i) => h('div', { className: 'qitem', style: 'grid-template-columns:auto minmax(0,1fr) auto;margin-top:10px' },
          h('span', { className: 'badge', textContent: s.id }),
          h('div', { style: 'display:grid;gap:6px' },
            h('textarea', { value: s.text || '', placeholder: 'Bot nói gì ở bước này? Dùng {tên}, {sdt}, {địa_chỉ}.', style: 'min-height:56px', oninput: e => { s.text = e.target.value; } }),
            h('div', { className: 'meta' },
              h('label', { className: 'row', style: 'gap:4px' }, 'Hỏi khách:', h('select', { style: 'width:auto', onchange: e => { s.ask = e.target.value || undefined; draw(); } },
                ...[['', 'không hỏi'], ['name', 'tên'], ['phone', 'SĐT'], ['address', 'địa chỉ'], ['note', 'ghi chú']].map(([v, t]) => h('option', { value: v, textContent: t, selected: (s.ask || '') === v })))),
              h('label', { className: 'row', style: 'gap:4px' }, s.ask ? 'Trả lời xong sang:' : 'Rồi sang:', stepSel(s.next, v => { s.next = v || undefined; })),
              h('label', { className: 'row', style: 'gap:4px' }, h('input', { type: 'checkbox', checked: s.action === 'order', onchange: e => { s.action = e.target.checked ? 'order' : undefined; } }), 'Tạo đơn ở bước này'),
              h('input', { type: 'url', placeholder: 'Link ảnh (tuỳ chọn)', value: s.image || '', style: 'width:180px', oninput: e => { s.image = e.target.value.trim() || undefined; } })),
            ...(s.buttons || []).map((b, j) => h('div', { className: 'meta' }, '🔘',
              h('input', { type: 'text', value: b.title, placeholder: 'Chữ trên nút (≤ 20 ký tự)', maxLength: 20, style: 'width:170px', oninput: e => { b.title = e.target.value; } }),
              h('select', { style: 'width:auto', onchange: e => { const k = e.target.value; delete b.next; delete b.url; delete b.flow; if (k === 'url') b.url = 'https://'; draw(); } },
                h('option', { value: 'step', textContent: 'sang bước', selected: !b.url && !b.flow }), h('option', { value: 'url', textContent: 'mở link', selected: !!b.url })),
              b.url != null ? h('input', { type: 'url', value: b.url, style: 'width:200px', oninput: e => { b.url = e.target.value; } }) : stepSel(b.next, v => { b.next = v || undefined; }, '— chọn bước —'),
              h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '×', onclick: () => { s.buttons.splice(j, 1); draw(); } }))),
            (s.buttons || []).length < 13 && !s.ask ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: 'justify-self:start', textContent: '+ Nút bấm', onclick: () => { (s.buttons ||= []).push({ title: '' }); draw(); } }) : null),
          h('button', { type: 'button', className: 'btn btn-danger btn-sm', textContent: 'Xoá bước', disabled: f.steps.length < 2, onclick: () => { f.steps.splice(i, 1); draw(); } }))),
        h('div', { className: 'row section-gap' },
          h('button', { type: 'button', className: 'btn btn-ghost', textContent: '+ Thêm bước', onclick: () => {
            let n = f.steps.length + 1; while (ids.includes('s' + n)) n++; f.steps.push({ id: 's' + n, text: '' }); draw();
          } }),
          h('span', { className: 'grow' }),
          h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: () => done() }),
          h('button', { type: 'button', className: 'btn btn-primary', textContent: 'Lưu kịch bản', onclick: async () => {
            if (!f.name.trim()) return toast('Đặt tên kịch bản.');
            const steps = f.steps.map(s => ({ ...s, buttons: (s.buttons || []).filter(b => b.title) }));
            if (steps.some(s => s.buttons.some(b => !b.url && !b.next))) return toast('Có nút chưa chọn bước đích.');
            const row = { name: f.name.trim(), steps };
            if (f.id) await q(sb().from('flows').update(row).eq('id', f.id)); else await q(sb().from('flows').insert(row));
            toast('Đã lưu kịch bản.'); done();
          } })),
        h('p', { className: 'hint', textContent: '≤ 3 nút: hiện dạng nút bấm (có thể mở link). Nhiều hơn: hiện dạng nút trả lời nhanh. Bước có "Hỏi khách" sẽ chờ khách gõ trả lời; SĐT sai định dạng bot hỏi lại.' }));
    };
    draw();
    return wrap;
  }

  // ── Áp Menu & lời chào lên Messenger (làm ngay trên web bằng token Page vừa đăng nhập) ──
  // Facebook: lệnh xoá chỉ nhận tên viết hoa (PERSISTENT_MENU, ICE_BREAKERS…) và không có GREETING; menu cố định cần app là
  // "ứng dụng chính" của Page. Lỗi menu không được làm hỏng lời chào, nút Bắt đầu và câu hỏi gợi ý.
  const NOT_PRIMARY = /ứng dụng chính|primary|default app|chưa đặt ứng dụng|not.*(primary|default).*app|thread owner/i;
  App.messengerProfileBody = s => {
    const action = m => m.type === 'url' ? { type: 'web_url', title: m.title.slice(0, 30), url: m.value } : { type: 'postback', title: m.title.slice(0, 30), payload: m.type === 'flow' ? `FLOW:${m.value}` : `TEXT:${m.value || m.title}` };
    const body = { get_started: { payload: 'GET_STARTED' } };
    if (s.greeting) body.greeting = [{ locale: 'default', text: s.greeting.slice(0, 160) }];
    const menu = (s.persistent_menu || []).filter(m => m.title && m.value).slice(0, 20);
    if (menu.length) body.persistent_menu = [{ locale: 'default', composer_input_disabled: false, call_to_actions: menu.map(action) }];
    const ice = (s.ice_breakers || []).filter(q => q.question).slice(0, 4);
    if (ice.length) body.ice_breakers = [{ locale: 'default', call_to_actions: ice.map(q => ({ question: q.question.slice(0, 80), payload: q.flow_id ? `FLOW:${q.flow_id}` : `TEXT:${q.question}` })) }];
    return body;
  };
  App.applyMessengerProfile = async (page, s, call = api) => {
    const body = App.messengerProfileBody(s), notes = [];
    try { await call('/me/messenger_profile', body, 'POST', page.access_token); }
    catch (e) {
      if (!body.persistent_menu || !NOT_PRIMARY.test(e.message)) throw e;
      delete body.persistent_menu;
      await call('/me/messenger_profile', body, 'POST', page.access_token);
      notes.push('Chưa đặt được menu cố định: Facebook yêu cầu VNPAGE là ứng dụng nhận tin chính của Page (xem hướng dẫn bên dưới). Lời chào, nút Bắt đầu và câu hỏi gợi ý đã áp dụng.');
    }
    // Mục để trống thì xoá khỏi Messenger. Lời chào không xoá được qua API (Facebook không có GREETING trong danh sách xoá).
    const remove = [['persistent_menu', 'PERSISTENT_MENU'], ['ice_breakers', 'ICE_BREAKERS']].filter(([k]) => !body[k] && !(k === 'persistent_menu' && notes.length)).map(([, f]) => f);
    if (remove.length) await call('/me/messenger_profile', { fields: remove }, 'DELETE', page.access_token);
    if (!s.greeting) notes.push('Lời chào để trống: Messenger giữ lời chào cũ (Facebook không cho xoá lời chào qua API).');
    return { notes, menuBlocked: notes.length > 0 && !!(s.persistent_menu || []).some(m => m.title && m.value) && !body.persistent_menu };
  };

  // ── Menu & lời chào ────────────────────────────────────────
  panel('botmenu', async el => {
    const pages = App.selected().filter(p => connected.some(c => c.id === p.id));
    if (!pages.length) return el.replaceChildren(notConnected() || h('div', { className: 'status pending', textContent: 'Các Page đang chọn chưa kết nối máy chủ. Kết nối ở Quản lý › Cài đặt › Máy chủ bot.' }));
    const all = await q(sb().from('page_settings').select('*').in('page_id', pages.map(p => p.id)));
    const s = { ...(all.find(x => x.page_id === pages[0].id) || {}) };
    s.persistent_menu ||= []; s.ice_breakers ||= [];
    const form = h('div', { className: 'card' });
    const draw = () => form.replaceChildren(
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: `Cài đặt bot cho ${pages.length} Page đang chọn` }), h('div', { className: 'tags' }, ...pages.map(App.pageTag))),
      pages.length > 1 ? h('p', { className: 'hint', textContent: `Đang hiện cài đặt của ${pages[0].name}; bấm Lưu sẽ áp cùng cài đặt cho cả ${pages.length} Page.` }) : null,
      h('div', { className: 'form-grid' },
        h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: s.bot_enabled !== false, onchange: e => { s.bot_enabled = e.target.checked; } }), 'Bật bot'),
        h('label', { className: 'field' }, 'Bot im lặng khi bạn chat tay (phút)', h('input', { type: 'number', min: 0, value: s.pause_minutes ?? 30, oninput: e => { s.pause_minutes = Number(e.target.value) || 0; } })),
        h('label', { className: 'field' }, 'Kịch bản khi khách bấm "Bắt đầu"', (() => { const sel = flowSelect('w', s.welcome_flow_id || '', '— không có —'); sel.onchange = e => { s.welcome_flow_id = e.target.value || null; }; return sel; })()),
        h('label', { className: 'field wide' }, 'Lời chào (hiện trước khi khách nhắn, ≤ 160 ký tự)', h('input', { type: 'text', maxLength: 160, value: s.greeting || '', placeholder: 'Chào {{user_first_name}}! Shop sẵn sàng hỗ trợ bạn.', oninput: e => { s.greeting = e.target.value; } })),
        h('label', { className: 'field wide' }, 'Trả lời mặc định khi không khớp từ khoá (tối đa 1 lần/12 giờ/khách; trống = im lặng)', h('input', { type: 'text', value: s.fallback_text || '', placeholder: 'Shop đã nhận tin, nhân viên sẽ trả lời ngay ạ!', oninput: e => { s.fallback_text = e.target.value; } }))),
      h('h4', { className: 'card-title section-gap', textContent: 'Menu cố định (≤ 20 mục)' }),
      ...s.persistent_menu.map((m, i) => h('div', { className: 'meta', style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' },
        h('input', { type: 'text', value: m.title || '', placeholder: 'Tên mục (≤ 30 ký tự)', maxLength: 30, style: 'width:180px', oninput: e => { m.title = e.target.value; } }),
        h('select', { style: 'width:auto', onchange: e => { m.type = e.target.value; m.value = ''; draw(); } }, ...[['flow', 'chạy kịch bản'], ['url', 'mở link'], ['text', 'như khách gõ chữ']].map(([v, t]) => h('option', { value: v, textContent: t, selected: (m.type || 'flow') === v }))),
        (m.type || 'flow') === 'flow' ? (() => { const sel = flowSelect('m', m.value || '', '— chọn kịch bản —'); sel.style.width = 'auto'; sel.onchange = e => { m.value = e.target.value; }; return sel; })()
          : h('input', { type: m.type === 'url' ? 'url' : 'text', value: m.value || '', placeholder: m.type === 'url' ? 'https://…' : 'VD: giá', style: 'width:200px', oninput: e => { m.value = e.target.value; } }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '×', onclick: () => { s.persistent_menu.splice(i, 1); draw(); } }))),
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: 'margin-top:6px', textContent: '+ Mục menu', onclick: () => { s.persistent_menu.push({ title: '', type: 'flow', value: '' }); draw(); } }),
      h('h4', { className: 'card-title section-gap', textContent: 'Câu hỏi gợi ý khi khách mở chat lần đầu (≤ 4)' }),
      ...s.ice_breakers.map((b, i) => h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' },
        h('input', { type: 'text', value: b.question || '', placeholder: 'VD: Shop ship tỉnh không?', maxLength: 80, style: 'width:240px', oninput: e => { b.question = e.target.value; } }),
        (() => { const sel = flowSelect('i', b.flow_id || '', '→ như khách gõ câu này'); sel.style.width = 'auto'; sel.onchange = e => { b.flow_id = e.target.value || undefined; }; return sel; })(),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '×', onclick: () => { s.ice_breakers.splice(i, 1); draw(); } }))),
      s.ice_breakers.length < 4 ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: 'margin-top:6px', textContent: '+ Câu hỏi gợi ý', onclick: () => { s.ice_breakers.push({ question: '' }); draw(); } }) : null,
      h('div', { className: 'row section-gap' }, h('button', { className: 'btn btn-primary', textContent: `Lưu & áp dụng cho ${pages.length} Page`, onclick: save })),
      h('div', { className: 'log', id: 'bmLog' }));
    async function save(e) {
      e.target.disabled = true; $('bmLog').replaceChildren(); let blocked = false;
      const row = { bot_enabled: s.bot_enabled !== false, pause_minutes: s.pause_minutes ?? 30, welcome_flow_id: s.welcome_flow_id || null, greeting: s.greeting || '',
        fallback_text: s.fallback_text || '', persistent_menu: s.persistent_menu.filter(m => m.title && m.value), ice_breakers: s.ice_breakers.filter(b => b.question), updated_at: new Date().toISOString() };
      for (const p of pages) {
        try {
          await q(sb().from('page_settings').upsert({ page_id: p.id, ...row }));
          // Áp lên Messenger bằng token Page của phiên đăng nhập hiện tại (luôn mới), không phụ thuộc token lưu trên máy chủ.
          const live = App.pageById(p.id);
          if (live?.access_token) {
            const { notes, menuBlocked } = await App.applyMessengerProfile(live, row);
            if (menuBlocked) blocked = true;
            $('bmLog').append(h('div', { className: 'status ' + (menuBlocked ? 'pending' : 'ok'), textContent: `${menuBlocked ? '⚠' : '✓'} ${p.name}${notes.length ? ' · ' + notes.join(' ') : ''}` }));
          } else {
            const { refreshed } = await S.callWithFreshToken('profile', { pageId: p.id });
            $('bmLog').append(h('div', { className: 'status ok', textContent: `✓ ${p.name}${refreshed ? ' (đã làm mới token)' : ''}` }));
          }
        } catch (err) { $('bmLog').append(h('div', { className: 'status err', textContent: `✗ ${p.name}: ${err.message}` })); }
      }
      if (blocked) $('bmLog').append(h('div', { className: 'hint', style: 'margin-top:8px', textContent:
        'Cách đặt VNPAGE làm ứng dụng nhận tin chính: mở Meta Business Suite của Page → Cài đặt → Nhắn tin nâng cao (Advanced messaging) → Định tuyến cuộc trò chuyện / Ứng dụng đã kết nối → chọn VNPAGE làm ứng dụng nhận tin chính (Primary receiver) → Lưu. Rồi bấm Lưu & áp dụng lại. Khi VNPAGE chưa là ứng dụng chính, Facebook cũng không chuyển tin của khách cho bot, nên bot sẽ không tự trả lời.' }));
      e.target.disabled = false;
    }
    draw();
    el.replaceChildren(form, h('p', { className: 'hint', textContent: 'Messenger có thể mất vài phút mới hiện menu / lời chào mới; khách cũ cần mở lại khung chat.' }));
  });

  // ── Nhật ký & đơn bot ──────────────────────────────────────
  panel('botlog', async el => {
    const ids = App.selected().map(p => p.id);
    const [orders, logs] = await Promise.all([
      q(sb().from('bot_orders').select('*').in('page_id', ids).order('created_at', { ascending: false }).limit(100)),
      q(sb().from('logs').select('*').order('created_at', { ascending: false }).limit(150))]);
    const KIND = { keyword: ['Từ khoá', 'blue'], order: ['Đơn', 'green'], comment: ['Bình luận', 'purple'], comment_reply: ['Trả lời bình luận', 'teal'], error: ['Lỗi', 'red'] };
    const detail = d => [d.name, d.rule, d.text, (d.done || []).join(', '), d.message, d.phone].filter(Boolean).join(' · ');
    el.replaceChildren(
      h('div', { className: 'card' }, h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: `Đơn bot thu được (${orders.filter(o => !o.imported).length} chưa đưa vào Bán hàng)` })),
        orders.length ? h('div', { className: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Lúc', 'Page', 'Tên', 'SĐT', 'Địa chỉ', ''].map((t, i) => h('th', { className: i > 0 && i < 5 ? 'left' : '', textContent: t })))),
          h('tbody', {}, ...orders.map(o => h('tr', {}, h('td', { textContent: fmtShort(o.created_at) }), h('td', { className: 'left', textContent: pageName(o.page_id) }),
            h('td', { className: 'left', textContent: o.name }), h('td', { className: 'left', textContent: o.phone }), h('td', { className: 'left', textContent: o.address }),
            h('td', {}, o.imported ? h('span', { className: 'tag tone-green', textContent: 'Đã đưa vào' }) : h('button', { className: 'btn btn-soft btn-sm', textContent: 'Đưa vào Bán hàng', onclick: async e => {
              e.target.disabled = true;
              const page = App.pageById(o.page_id);
              await DB.set('shopOrdersV1', [...await DB.get('shopOrdersV1', []), { id: uid('ord'), at: new Date(o.created_at).getTime(), updatedAt: Date.now(), source: 'bot',
                customerKey: App.crmKey(o.page_id, o.name), pageKey: o.page_id, customer: { name: o.name, phone: o.phone, address: o.address }, items: [], discount: 0, shipFee: 0, shipCost: 0, status: 'new', note: o.note || `Đơn bot ${page?.name || ''}` }]);
              await q(sb().from('bot_orders').update({ imported: true }).eq('id', o.id));
              toast('Đã thêm vào Bán hàng (nhớ điền sản phẩm & giá).'); App.tabs.botlog.refresh();
            } }))))))) : empty('Chưa có đơn. Kịch bản có bước "Tạo đơn" sẽ ghi đơn vào đây.')),
      h('div', { className: 'card' }, h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Nhật ký bot (150 việc gần nhất)' }), h('button', { className: 'btn btn-soft', onclick: () => App.tabs.botlog.refresh() }, icon('i-sync'), 'Tải lại')),
        logs.length ? h('div', { className: 'list' }, ...logs.filter(l => !l.page_id || ids.includes(l.page_id)).map(l => { const [t, tone] = KIND[l.kind] || [l.kind, 'gray'];
          return h('div', { className: 'item', style: 'cursor:default' }, h('span', { className: 'tag tone-' + tone, textContent: t }),
            h('div', { className: 'body' }, h('div', { className: 'snippet', textContent: detail(l.detail) || JSON.stringify(l.detail) }), h('div', { className: 'hint', textContent: `${fmtTime(l.created_at)} · ${pageName(l.page_id)}` }))); }))
          : empty('Bot chưa làm gì. Khi có tin nhắn / bình luận khớp quy tắc, việc bot làm sẽ hiện ở đây.')));
  });

})();
