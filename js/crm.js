/* CRM khách (giống inbox-crm.js của tiện ích): giai đoạn, trạng thái đơn, nhãn, ghi chú, nhắc hẹn, tạo đơn.
 * Lưu: metaCrmV1 { "<pageId>|<tên>": {...} }, inboxApptsV1 [nhắc hẹn], shopOrdersV1 [đơn, dùng chung tab Bán hàng].
 * Khác tiện ích: dữ liệu chỉ nằm trên trình duyệt này, không ghi ngược lên bảng thông tin khách của Business Suite. */
(() => {
  const STAGES = ['Tiếp nhận', 'Đủ tiêu chuẩn', 'Đã chuyển đổi', 'Không hoạt động'];
  const ORDER_STATUSES = ['Đã đặt hàng', 'Đã thanh toán', 'Đã vận chuyển', 'Đã đặt lịch'];
  const LOCAL_STATUS = { new: 'Mới', shipping: 'Đang giao', done: 'Hoàn thành' };
  const CRM = 'metaCrmV1', APPT = 'inboxApptsV1', ORDERS = 'shopOrdersV1';

  App.notify = (title, body) => {
    try { if (Notification.permission === 'granted') { new Notification(title, { body, icon: 'https://www.facebook.com/favicon.ico' }); return; } } catch {}
    toast(`${title}: ${body}`, 5000);
  };

  const crm = App.crm = {
    STAGES, ORDER_STATUSES,
    async all() { return DB.get(CRM, {}); },
    async get(key) { return (await DB.get(CRM, {}))[key] || {}; },
    async update(key, patch) {
      const all = await DB.get(CRM, {});
      all[key] = { labels: [], notes: [], ...(all[key] || {}), ...patch, readAt: Date.now() };
      await DB.set(CRM, all);
      return all[key];
    },
    async addLabels(key, labels, base) {
      const cur = await crm.get(key);
      const next = [...new Set([...(cur.labels || []), ...labels])];
      if (next.length !== (cur.labels || []).length || !cur.name) await crm.update(key, { ...base, labels: next });
      return next;
    },
    async allLabels() { return [...new Set(Object.values(await crm.all()).flatMap(c => c.labels || []))].sort(); }
  };

  // ── Khung CRM dưới hội thoại ──────────────────────────────
  let form = '', expanded = local.get('crmExpanded') === '1';
  crm.renderPanel = async function render(box, ctx) {
    const key = App.crmKey(ctx.page.id, ctx.name);
    const base = { pageId: ctx.page.id, pageName: ctx.page.name, name: ctx.name, psid: ctx.psid };
    const c = await crm.get(key);
    const orders = (await DB.get(ORDERS, [])).filter(o => o.customerKey === key || (o.source !== 'inbox' && norm(o.customer?.name) === norm(ctx.name)));
    const appts = (await DB.get(APPT, [])).filter(a => a.key === key && !a.done).sort((a, b) => a.at - b.at);
    const settings = InboxRules.withDefaults(await DB.get(InboxRules.SETTINGS_KEY));
    const suggested = InboxRules.detectAutoLabels(ctx.messages, settings.rules).filter(l => !(c.labels || []).includes(l));
    const rerender = () => render(box, ctx);
    const save = async patch => { await crm.update(key, { ...base, ...patch }); rerender(); };

    const sel = (field, options, label) => h('select', { title: label, 'aria-label': label, onchange: e => save({ [field]: e.target.value }) },
      h('option', { value: '', textContent: label + '…' }), ...[...new Set([c[field], ...options].filter(Boolean))].map(o => h('option', { value: o, textContent: o, selected: o === c[field] })));
    const labelInput = h('input', { type: 'text', placeholder: '+ nhãn', list: 'crmLabelList',
      onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); save({ labels: [...new Set([...(c.labels || []), e.target.value.trim()])] }); } } });
    const datalist = h('datalist', { id: 'crmLabelList' }, ...(await crm.allLabels()).map(l => h('option', { value: l })));
    const btn = (k, text, title) => h('button', { type: 'button', className: 'btn btn-sm ' + (form === k ? 'btn-soft' : 'btn-ghost'), textContent: text, title,
      onclick: () => { form = form === k ? '' : k; rerender(); } });
    const extra = orders.length + appts.length + (c.notes || []).length;

    box.replaceChildren(
      h('div', { className: 'crm-row' },
        sel('stage', STAGES, 'Giai đoạn'), sel('orderStatus', ORDER_STATUSES, 'Đơn'),
        ...(c.labels || []).map(l => tag(l, () => save({ labels: c.labels.filter(x => x !== l) }))),
        ...suggested.map(l => h('button', { type: 'button', className: 'tag', textContent: '+ ' + l, title: 'Gợi ý theo lời khách', onclick: () => save({ labels: [...(c.labels || []), l] }) })),
        labelInput, datalist,
        h('span', { style: 'margin-left:auto;display:flex;gap:4px;flex-wrap:wrap' }, btn('order', '＋ Đơn', 'Tạo đơn'), btn('note', '📝', 'Ghi chú'), btn('remind', '⏰', 'Nhắc hẹn'),
          h('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: (expanded ? '▴' : '▾') + (extra ? ` ${extra}` : ''), title: 'Đơn, nhắc hẹn, ghi chú',
            onclick: () => { expanded = !expanded; local.set('crmExpanded', expanded ? '1' : '0'); rerender(); } }))),
      form ? formEl() : null,
      expanded ? h('div', { className: 'crm-detail' },
        ...orders.slice(0, 5).map(o => h('div', {}, `🧾 ${fmtShort(o.at)} · ${(o.items || []).map(i => `${i.name} x${i.qty}`).join(', ')} · ${money(Pure.orderTotals(o).revenue)} · ${LOCAL_STATUS[o.status] || Pure.STATUS[o.status] || o.status}`)),
        ...appts.map(a => h('div', {}, `⏰ ${fmtShort(a.at)} · ${a.text} `, h('button', { className: 'btn btn-sm btn-ghost', textContent: 'Xong', onclick: async () => {
          const all = await DB.get(APPT, []); const x = all.find(y => y.id === a.id); if (x) x.done = true; await DB.set(APPT, all); rerender();
        } }))),
        ...(c.notes || []).map((n, i) => h('div', {}, `📝 ${fmtShort(n.at)} · ${n.text} `, h('button', { className: 'btn btn-sm btn-ghost', textContent: '×', title: 'Xoá ghi chú',
          onclick: () => save({ notes: c.notes.filter((_, j) => j !== i) }) }))),
        extra ? null : h('div', { className: 'hint', textContent: 'Chưa có đơn, nhắc hẹn hay ghi chú.' })) : null);

    function formEl() {
      const done = async e => { e.preventDefault(); const f = new FormData(e.target); await submit(f); form = ''; rerender(); };
      if (form === 'note') return h('form', { onsubmit: done }, h('textarea', { name: 'text', required: true, placeholder: 'Ghi chú về khách…', style: 'min-height:60px' }),
        h('div', { className: 'row' }, h('button', { className: 'btn btn-primary btn-sm', textContent: 'Lưu ghi chú' })));
      if (form === 'remind') return h('form', { onsubmit: done }, h('div', { className: 'row' },
        h('input', { type: 'datetime-local', name: 'at', required: true, value: toLocalInput(Date.now() + 3600e3), style: 'width:auto' }),
        h('input', { type: 'text', name: 'text', className: 'grow', placeholder: 'Nhắc gì? (VD: gọi lại báo giá)', required: true }),
        h('button', { className: 'btn btn-primary btn-sm', textContent: 'Đặt nhắc' })), h('div', { className: 'hint', textContent: 'Trang sẽ báo khi đến giờ nếu đang mở.' }));
      const hint = InboxRules.parseOrderHints(ctx.messages);
      const items = h('div', { style: 'display:grid;gap:6px' });
      const addItem = (name = '') => items.append(h('div', { className: 'row' },
        h('input', { name: 'iname', className: 'grow', placeholder: 'Sản phẩm / gói', value: name, required: true }),
        h('input', { name: 'iqty', type: 'number', min: 1, value: 1, style: 'width:70px', title: 'Số lượng' }),
        h('input', { name: 'iprice', type: 'number', min: 0, step: 1000, placeholder: 'Giá', style: 'width:110px' }),
        h('input', { name: 'icost', type: 'number', min: 0, step: 1000, placeholder: 'Giá vốn', style: 'width:110px' })));
      (hint.items.length ? hint.items : [{ name: '' }]).forEach(i => addItem(i.name));
      return h('form', { onsubmit: done }, items,
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '+ Thêm dòng', onclick: () => addItem(), style: 'justify-self:start' }),
        h('div', { className: 'form-grid' },
          h('label', { className: 'field' }, 'SĐT', h('input', { name: 'phone', type: 'text', value: hint.phone })),
          h('label', { className: 'field' }, 'Địa chỉ', h('input', { name: 'address', type: 'text', value: hint.address })),
          h('label', { className: 'field' }, 'Phí ship khách trả', h('input', { name: 'shipFee', type: 'number', min: 0, step: 1000 })),
          h('label', { className: 'field' }, 'Giảm giá', h('input', { name: 'discount', type: 'number', min: 0, step: 1000 })),
          h('label', { className: 'field' }, 'Trạng thái', h('select', { name: 'status' }, ...Object.entries(LOCAL_STATUS).map(([v, t]) => h('option', { value: v, textContent: t })))),
          h('label', { className: 'field wide' }, 'Ghi chú', h('input', { name: 'note', type: 'text' }))),
        h('div', { className: 'row' }, h('button', { className: 'btn btn-primary btn-sm', textContent: 'Lưu đơn' }), h('span', { className: 'hint', textContent: 'Đơn hiện ở tab Quản lý › Bán hàng.' })));
    }
    async function submit(f) {
      if (form === 'note') return crm.update(key, { ...base, notes: [...(c.notes || []), { text: String(f.get('text')).trim(), at: Date.now() }] });
      if (form === 'remind') {
        const all = await DB.get(APPT, []);
        all.push({ id: uid('appt'), key, name: ctx.name, pageId: ctx.page.id, psid: ctx.psid, at: new Date(f.get('at')).getTime(), text: String(f.get('text')).trim(), done: false });
        return DB.set(APPT, all);
      }
      const names = f.getAll('iname'), qty = f.getAll('iqty'), price = f.getAll('iprice'), cost = f.getAll('icost');
      const order = { id: uid('ord'), at: Date.now(), updatedAt: Date.now(), source: 'inbox', customerKey: key, pageKey: ctx.page.id,
        customer: { name: ctx.name, phone: String(f.get('phone')).trim(), address: String(f.get('address')).trim() },
        items: names.map((n, i) => ({ name: n.trim(), qty: Number(qty[i]) || 1, price: Number(price[i]) || 0, cost: Number(cost[i]) || 0 })).filter(i => i.name),
        discount: Number(f.get('discount')) || 0, shipFee: Number(f.get('shipFee')) || 0, shipCost: 0, status: String(f.get('status')), note: String(f.get('note')).trim() };
      await DB.set(ORDERS, [...await DB.get(ORDERS, []), order]);
      if (!c.orderStatus) await crm.update(key, { ...base, orderStatus: 'Đã đặt hàng' });
      toast('Đã lưu đơn.');
    }
  };

  // ── Báo nhắc hẹn khi trang đang mở ────────────────────────
  App.onLogin.push(() => setInterval(async () => {
    const all = await DB.get(APPT, []);
    const due = all.filter(a => !a.done && !a.notified && a.at <= Date.now());
    if (!due.length) return;
    due.forEach(a => { a.notified = true; App.notify(`⏰ Nhắc hẹn: ${a.name}`, a.text); });
    await DB.set(APPT, all);
  }, 30e3));

  // ── Tab Khách hàng: Kanban theo giai đoạn ─────────────────
  App.tab('crm', {
    mount(el) {
      el.append(
        h('div', { className: 'toolbar' },
          h('input', { type: 'search', className: 'grow', id: 'crmSearch', placeholder: '🔍 Tìm khách, nhãn, ghi chú…', oninput: () => this.refresh() }),
          Object.assign(App.pageSelect('Tất cả Page'), { id: 'crmPage', onchange: () => this.refresh() }),
          h('select', { id: 'crmLabel', style: 'width:auto', onchange: () => this.refresh() })),
        h('div', { className: 'card', id: 'crmAppts' }),
        h('div', { className: 'kanban', id: 'crmBoard' }),
        h('p', { className: 'hint', textContent: 'Kéo thẻ sang cột khác để đổi giai đoạn. Bấm tên khách để mở hội thoại trong Hộp thư.' }));
    },
    async refresh() {
      const all = await crm.all();
      const q = norm($('crmSearch').value), page = $('crmPage').value, lab = $('crmLabel').value;
      const labels = await crm.allLabels();
      $('crmLabel').replaceChildren(h('option', { value: '', textContent: 'Mọi nhãn' }), ...labels.map(l => h('option', { value: l, textContent: l, selected: l === lab })));
      const orders = await DB.get(ORDERS, []);
      const rows = Object.entries(all).filter(([, c]) => (!page || c.pageId === page) && (!lab || (c.labels || []).includes(lab)) &&
        (!q || norm([c.name, c.pageName, ...(c.labels || []), ...(c.notes || []).map(n => n.text)].join(' ')).includes(q)));
      const cols = [['', 'Chưa phân loại'], ...STAGES.map(s => [s, s])];
      $('crmBoard').replaceChildren(...cols.map(([stage, title]) => {
        const list = rows.filter(([, c]) => (STAGES.includes(c.stage) ? c.stage : '') === stage).sort((a, b) => (b[1].readAt || 0) - (a[1].readAt || 0));
        const col = h('div', { className: 'kcol', dataset: { stage },
          ondragover: e => { e.preventDefault(); col.classList.add('over'); }, ondragleave: () => col.classList.remove('over'),
          ondrop: async e => { e.preventDefault(); col.classList.remove('over'); const key = e.dataTransfer.getData('text/plain'); if (key) { await crm.update(key, { stage }); this.refresh(); } } },
          h('h4', {}, h('span', { textContent: title }), h('span', { className: 'badge', textContent: list.length })),
          ...list.slice(0, 200).map(([key, c]) => h('div', { className: 'kcard', draggable: true, ondragstart: e => e.dataTransfer.setData('text/plain', key) },
            h('a', { href: '#', className: 'n', textContent: c.name || '(không tên)', onclick: e => { e.preventDefault(); App.openConversation?.(c.pageId, c.name); } }),
            h('div', { className: 'hint', textContent: [c.pageName, c.orderStatus, orders.filter(o => o.customerKey === key).length ? `${orders.filter(o => o.customerKey === key).length} đơn` : ''].filter(Boolean).join(' · ') }),
            (c.labels || []).length ? h('div', { className: 'tags' }, ...c.labels.map(l => tag(l))) : null)));
        return col;
      }));
      const appts = (await DB.get(APPT, [])).filter(a => !a.done && (!page || a.pageId === page)).sort((a, b) => a.at - b.at);
      $('crmAppts').replaceChildren(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: `Nhắc hẹn sắp tới (${appts.length})` })),
        ...(appts.length ? appts.slice(0, 20).map(a => h('div', { className: 'row', style: 'padding:4px 0' },
          h('span', { className: 'status ' + (a.at < Date.now() ? 'err' : 'pending'), textContent: fmtShort(a.at) }),
          h('a', { href: '#', textContent: a.name, onclick: e => { e.preventDefault(); App.openConversation?.(a.pageId, a.name); } }),
          h('span', { className: 'muted grow', textContent: a.text }),
          h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Xong', onclick: async () => {
            const list = await DB.get(APPT, []); const x = list.find(y => y.id === a.id); if (x) x.done = true; await DB.set(APPT, list); this.refresh();
          } }))) : [h('div', { className: 'hint', textContent: 'Không có nhắc hẹn. Đặt nhắc trong khung CRM dưới mỗi hội thoại.' })]));
    }
  });
})();
