/* Dịch vụ (SMM, vd Baostar): tạo đơn tăng like/follow… cho khách ngay từ Hộp thư qua API, theo dõi giá gốc (tiền web trừ),
 * giá bán (bảng giá của bạn), lời, thời gian tạo/hoàn thành. Đơn lưu chung shopOrdersV1 (source 'service') nên tab Bán hàng
 * cộng luôn doanh thu/lời. API chuẩn SMM v2: services · add · status · balance. App Windows gọi API qua tiến trình chính (tránh CORS).
 * Lưu: svcSettingsV1 { home, apiUrl, apiKey, prices: { [serviceId]: giá bán/1 đơn vị } }, svcServicesV1 { at, list }. */
(() => {
  const SET = 'svcSettingsV1', CACHE = 'svcServicesV1', ORDERS = 'shopOrdersV1';
  const DEFAULTS = { home: 'https://dichvu.baostar.net', apiUrl: 'https://smm.baostar.net/api/v2', apiKey: '', prices: {} };
  const settings = async () => ({ ...DEFAULTS, ...(await DB.get(SET, {})) });
  const saveSettings = async change => DB.set(SET, { ...(await settings()), ...change });
  // Trạng thái của web dịch vụ → trạng thái đơn chung (Bán hàng chỉ tính tiền đơn done/returned).
  const FINAL = /^(completed|partial|canceled|cancelled|refunded)$/i;
  const mapStatus = s => /^(completed|partial)$/i.test(s) ? 'done' : /^(canceled|cancelled|refunded)$/i.test(s) ? 'cancelled' : /progress|processing/i.test(s) ? 'shipping' : 'new';
  const STATUS_VI = { pending: 'Chờ chạy', 'in progress': 'Đang chạy', processing: 'Đang xử lý', completed: 'Hoàn thành', partial: 'Hoàn thành một phần', canceled: 'Đã huỷ', cancelled: 'Đã huỷ', refunded: 'Đã hoàn tiền' };
  const statusVi = s => STATUS_VI[String(s || '').toLowerCase()] || s || 'Chờ chạy';

  async function call(action, params = {}) {
    const s = await settings();
    if (!s.apiKey) throw Error('Chưa nhập API key: tab Dịch vụ › Cài đặt.');
    const body = { key: s.apiKey, action, ...params };
    let r;
    if (window.metaDesktop?.svcApi) r = await window.metaDesktop.svcApi({ url: s.apiUrl, body });
    else {
      try { const res = await fetch(s.apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); r = { status: res.status, json: await res.json() }; }
      catch (e) { throw Error('Trình duyệt chặn gọi API dịch vụ (CORS). Dùng app Windows để tạo đơn dịch vụ.'); }
    }
    if (r.error) throw Error(r.error);
    const j = r.json;
    if (j?.error) throw Error('Web dịch vụ: ' + j.error);
    // Baostar bọc kết quả: { success, message, status, data }. API SMM chuẩn thì trả thẳng.
    if (j && typeof j === 'object' && !Array.isArray(j) && 'success' in j) {
      if (j.success === false || j.success === 0 || j.success === 'false') throw Error('Web dịch vụ: ' + (j.message || j.msg || `lỗi HTTP ${j.status || r.status}`));
      return j.data ?? j;
    }
    return j;
  }
  // Danh sách dịch vụ có thể là mảng, { data: [...] }, { services: [...] } hoặc object theo mã dịch vụ.
  const asList = v => Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : Array.isArray(v?.services) ? v.services
    : v && typeof v === 'object' ? Object.values(v).filter(x => x && typeof x === 'object') : [];
  async function services(force = false) {
    const c = await DB.get(CACHE, null);
    if (!force && c?.list?.length && Date.now() - c.at < 864e5) return c.list;
    const raw = asList(await call('services'));
    if (!raw.length) throw Error('Web dịch vụ không trả về dịch vụ nào. Kiểm tra lại API key và URL API.');
    const list = raw.map(x => ({ id: String(x.service ?? x.id ?? x.service_id), name: String(x.name || ''), category: String(x.category || ''), rate: Number(x.rate) || 0, min: Number(x.min) || 1, max: Number(x.max) || 1e9 }));
    await DB.set(CACHE, { at: Date.now(), list });
    return list;
  }
  // Giá gốc ước tính: SMM tính rate cho 1000 đơn vị. Giá thật lấy theo "charge" khi web đã nhận đơn.
  const estCost = (svc, qty) => svc ? svc.rate * qty / 1000 : 0;
  const orderOf = o => ({ sell: (o.items?.[0]?.price || 0) * (o.items?.[0]?.qty || 0), cost: (o.items?.[0]?.cost || 0) * (o.items?.[0]?.qty || 0) });

  // Link khách gửi trong hội thoại (Facebook, TikTok, Instagram, YouTube, Shopee… hoặc link bất kỳ).
  function linksIn(messages) {
    const out = [];
    for (const m of messages || []) for (const u of String(m.text || '').match(/https?:\/\/[^\s<>"')]+/g) || []) { const clean = u.replace(/[.,;!?]+$/, ''); if (!out.includes(clean)) out.push(clean); }
    return out.reverse(); // mới nhất trước
  }
  const platformOf = link => /tiktok/i.test(link) ? 'tiktok' : /instagram/i.test(link) ? 'instagram' : /youtu/i.test(link) ? 'youtube' : /shopee/i.test(link) ? 'shopee' : /t\.me|telegram/i.test(link) ? 'telegram' : /facebook|fb\.(com|watch|me)/i.test(link) ? 'facebook' : '';

  // ── Tạo đơn (hộp thoại) ── ctx: { page, name, key } khi mở từ Hộp thư; link: link khách gửi.
  async function createDialog(ctx = {}, link = '') {
    const s = await settings();
    let list = [];
    try { list = await services(); } catch (e) { return toast(e.message, 7000); }
    const dlg = h('dialog', { className: 'svc-dialog', onclose: () => dlg.remove() });
    const linkIn = h('input', { type: 'text', inputMode: 'url', value: link, placeholder: 'Link cần làm (bài viết, trang cá nhân, video…)', required: true });
    const search = h('input', { type: 'search', placeholder: 'Tìm dịch vụ (vd: follow, like page, view tiktok)…' });
    const pick = h('select', { size: 7, required: true, style: 'width:100%' });
    const qty = h('input', { type: 'number', min: 1, step: 1, value: 1000, required: true });
    const unit = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Giá bán / 1 đơn vị (đ)', required: true });
    const remember = h('input', { type: 'checkbox', checked: true });
    const info = h('div', { className: 'svc-sum' }), err = h('div', { className: 'status err', hidden: true });
    const chosen = () => list.find(x => x.id === pick.value);
    const draw = () => {
      const q = norm(search.value), plat = platformOf(linkIn.value);
      const rows = list.filter(x => !q || norm(x.name + ' ' + x.category + ' ' + x.id).includes(q)).sort((a, b) => (plat && norm(b.category + b.name).includes(plat)) - (plat && norm(a.category + a.name).includes(plat)));
      const keep = pick.value;
      pick.replaceChildren(...rows.slice(0, 300).map(x => h('option', { value: x.id, textContent: `#${x.id} · ${x.name} · ${money(x.rate)}/1000 · ${x.min}–${x.max}`, selected: x.id === keep })));
      if (!chosen() && rows[0]) { pick.value = rows[0].id; unit.dataset.touched = ''; } // dịch vụ hợp link nhất được chọn sẵn
      recalc();
    };
    const recalc = () => {
      const svc = chosen(), n = Math.max(0, Number(qty.value) || 0);
      if (svc && !unit.dataset.touched) unit.value = s.prices[svc.id] ?? '';
      const sell = (Number(unit.value) || 0) * n, cost = estCost(svc, n);
      info.replaceChildren(
        h('span', {}, 'Giá gốc ≈ ', h('strong', { textContent: money(cost) })), h('span', {}, 'Giá bán ', h('strong', { textContent: money(sell) })),
        h('span', {}, 'Lời ≈ ', h('strong', { className: sell - cost < 0 ? 'neg' : '', textContent: money(sell - cost) })),
        svc && (n < svc.min || n > svc.max) ? h('span', { className: 'neg', textContent: `Số lượng phải từ ${svc.min} đến ${svc.max}` }) : null);
    };
    search.oninput = draw; pick.onchange = () => { unit.dataset.touched = ''; recalc(); }; qty.oninput = recalc; unit.oninput = () => { unit.dataset.touched = '1'; recalc(); }; linkIn.oninput = draw;
    const form = h('form', { method: 'dialog', onsubmit: async e => {
      e.preventDefault(); err.hidden = true;
      const svc = chosen(), n = Math.round(Number(qty.value) || 0), price = Number(unit.value) || 0;
      if (!svc) { err.textContent = 'Chọn dịch vụ.'; err.hidden = false; return; }
      if (!/^https?:\/\//i.test(linkIn.value.trim())) { err.textContent = 'Link phải bắt đầu bằng http(s)://'; err.hidden = false; return; }
      if (n < svc.min || n > svc.max) { err.textContent = `Số lượng phải từ ${svc.min} đến ${svc.max}.`; err.hidden = false; return; }
      if (!confirm(`Tạo đơn trên web dịch vụ?\n\n${svc.name}\nSố lượng: ${n.toLocaleString('vi-VN')}\nLink: ${linkIn.value.trim()}\n\nWeb sẽ trừ khoảng ${money(estCost(svc, n))} trong số dư.`)) return;
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Đang tạo đơn…';
      try {
        const r = await call('add', { service: Number(svc.id), link: linkIn.value.trim(), quantity: n });
        if (r && !r.order) r.order = r.order_id ?? r.orderId ?? r.id;
        if (!r?.order) throw Error('Web dịch vụ không trả mã đơn.');
        if (remember.checked && price) await saveSettings({ prices: { ...(await settings()).prices, [svc.id]: price } });
        const order = { id: uid('ord'), at: Date.now(), updatedAt: Date.now(), source: 'service', provider: new URL(s.apiUrl).hostname, providerOrderId: String(r.order),
          serviceId: svc.id, serviceName: svc.name, link: linkIn.value.trim(), customerKey: ctx.key || '', pageKey: ctx.page?.id || '',
          customer: { name: ctx.name || '', phone: '', address: '' }, items: [{ name: svc.name, qty: n, price, cost: estCost(svc, n) / n }],
          discount: 0, shipFee: 0, shipCost: 0, status: 'new', svcStatus: 'Pending', note: 'Đơn dịch vụ #' + r.order };
        await DB.set(ORDERS, [...await DB.get(ORDERS, []), order]);
        if (ctx.key) App.crm?.update?.(ctx.key, { pageId: ctx.page?.id, pageName: ctx.page?.name, name: ctx.name, orderStatus: 'Đã đặt hàng' }).catch(() => {});
        dlg.close(); toast(`Đã tạo đơn dịch vụ #${r.order}.`, 5000);
        refreshStatus([order]).catch(() => {});
        App.tabs.services?.refresh?.();
      } catch (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Tạo đơn'; }
    } },
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Tạo đơn dịch vụ' + (ctx.name ? ' · ' + ctx.name : '') }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('label', { className: 'field' }, 'Link cần làm', linkIn),
      h('label', { className: 'field' }, 'Dịch vụ', search, pick),
      h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' }, h('label', { className: 'field', style: 'flex:1' }, 'Số lượng', qty), h('label', { className: 'field', style: 'flex:1' }, 'Giá bán / 1 đơn vị', unit)),
      h('label', { className: 'row', style: 'gap:6px' }, remember, 'Lưu giá bán này vào bảng giá của dịch vụ'),
      info, err,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end' },
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Mở web dịch vụ ↗', onclick: () => { if (linkIn.value) navigator.clipboard?.writeText(linkIn.value).catch(() => {}); openWeb(); } }),
        h('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Tạo đơn' })));
    dlg.append(form); document.body.append(dlg); draw(); dlg.showModal(); (link ? search : linkIn).focus();
  }
  async function openWeb() {
    const s = await settings();
    if (window.metaDesktop?.openService) window.metaDesktop.openService(s.home); else window.open(s.home, '_blank', 'noopener');
  }

  // ── Trạng thái ── Đơn chưa xong: hỏi web (tối đa 100 đơn/lần). Hoàn thành lần đầu → ghi thời gian hoàn thành; charge → giá gốc thật.
  async function refreshStatus(only) {
    const all = await DB.get(ORDERS, []);
    const open = (only || all).filter(o => o.source === 'service' && o.providerOrderId && !FINAL.test(o.svcStatus || ''));
    if (!open.length) return 0;
    let changed = 0;
    for (let i = 0; i < open.length; i += 100) {
      const ids = open.slice(i, i + 100).map(o => o.providerOrderId);
      const r = ids.length === 1 ? { [ids[0]]: await call('status', { order: Number(ids[0]) }) } : await call('status', { orders: ids.join(',') });
      const fresh = await DB.get(ORDERS, []);
      for (const o of fresh) {
        const st = o.source === 'service' && r[o.providerOrderId]; if (!st || st.error) continue;
        const next = { ...o, svcStatus: st.status || o.svcStatus, startCount: st.start_count ?? o.startCount, remains: st.remains ?? o.remains, updatedAt: Date.now() };
        const charge = Number(st.charge);
        if (Number.isFinite(charge) && charge > 0 && o.items?.[0]?.qty) next.items = [{ ...o.items[0], cost: charge / o.items[0].qty }], next.charge = charge;
        next.status = mapStatus(next.svcStatus);
        if (FINAL.test(next.svcStatus) && !o.completedAt && next.status === 'done') next.completedAt = Date.now();
        if (JSON.stringify(next) !== JSON.stringify(o)) { Object.assign(o, next); changed++; }
      }
      await DB.set(ORDERS, fresh);
    }
    return changed;
  }
  // Theo dõi ngầm 3 phút/lần khi có đơn chưa xong (chỉ khi đã nhập API key).
  setInterval(async () => { try { if ((await settings()).apiKey && await refreshStatus() && App.current() === 'services') App.tabs.services.refresh(); } catch {} }, 3 * 60e3);

  // ── Hộp thư: link khách gửi + nút tạo đơn ── (gắn dưới khung CRM của hội thoại)
  function inboxBox(ctx) {
    const links = linksIn(ctx.messages);
    return h('div', { className: 'svc-inbox' },
      h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
        h('strong', { textContent: 'Dịch vụ' }),
        h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: '＋ Tạo đơn dịch vụ', onclick: () => createDialog(ctx, links[0] || '') })),
      links.length ? h('div', { className: 'svc-links' }, ...links.slice(0, 5).map(l => h('div', { className: 'row', style: 'gap:6px' },
        h('a', { href: l, target: '_blank', rel: 'noopener noreferrer', className: 'hint', textContent: l.length > 60 ? l.slice(0, 57) + '…' : l, title: l }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '📋 Copy', onclick: () => navigator.clipboard.writeText(l).then(() => toast('Đã copy link.')) }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Tạo đơn', onclick: () => createDialog(ctx, l) })))) : h('p', { className: 'hint', textContent: 'Chưa thấy link nào khách gửi trong hội thoại này.' }));
  }

  // ── Tab Dịch vụ ──
  const PERIODS = [['7d', '7 ngày'], ['30d', '30 ngày'], ['month', 'Tháng này'], ['all', 'Tất cả']];
  let period = '30d', q = '';
  const since = () => { const d = new Date(); if (period === '7d') return Date.now() - 7 * 864e5; if (period === '30d') return Date.now() - 30 * 864e5; if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return 0; };
  App.tab('services', {
    mount(el) {
      el.append(
        h('div', { className: 'toolbar' },
          h('div', { className: 'chips', id: 'svPeriod' }), h('span', { className: 'grow' }),
          h('span', { className: 'hint', id: 'svBalance' }),
          h('button', { className: 'btn btn-ghost', textContent: '↻ Cập nhật trạng thái', onclick: async () => { try { toast(`Đã cập nhật ${await refreshStatus()} đơn.`); this.refresh(); } catch (e) { toast(e.message, 6000); } } }),
          h('button', { className: 'btn btn-ghost', textContent: '＋ Thêm đơn theo mã', title: 'Đơn đã tạo thẳng trên web dịch vụ: nhập mã đơn để app theo dõi giá gốc, trạng thái', onclick: () => importById() }),
          h('button', { className: 'btn btn-ghost', textContent: 'Mở web dịch vụ ↗', onclick: () => openWeb() }),
          h('button', { className: 'btn btn-primary', textContent: '＋ Tạo đơn', onclick: () => createDialog() })),
        h('div', { className: 'kpis', id: 'svKpis' }),
        h('div', { className: 'card' },
          h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: 'Đơn dịch vụ' }),
            h('input', { type: 'search', placeholder: '🔍 Khách, link, dịch vụ, mã đơn…', style: 'width:240px', oninput: e => { q = norm(e.target.value); this.refresh(); } })),
          h('div', { className: 'scroll', id: 'svOrders' })),
        h('div', { className: 'card', id: 'svSettings' }));
    },
    async refresh() {
      if (!$('svOrders')) return;
      const s = await settings(), from = since();
      $('svPeriod').replaceChildren(...PERIODS.map(([k, t]) => h('button', { type: 'button', className: 'chip', 'aria-pressed': String(period === k), textContent: t, onclick: () => { period = k; this.refresh(); } })));
      const all = (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.at >= from);
      const list = all.filter(o => !q || norm([o.customer?.name, o.link, o.serviceName, o.providerOrderId, App.pageById(o.pageKey)?.name].join(' ')).includes(q)).sort((a, b) => b.at - a.at);
      const sum = Pure.summarize(all), running = all.filter(o => ['new', 'shipping'].includes(o.status)).length;
      $('svKpis').replaceChildren(...[['Đơn', all.length], ['Đang chạy', running], ['Doanh thu', money(sum.revenue)], ['Giá gốc', money(sum.cost)], ['Lời', money(sum.profit)]]
        .map(([l, v]) => h('div', { className: 'kpi' }, h('div', { className: 'label', textContent: l }), h('div', { className: 'value', textContent: v }))));
      $('svOrders').replaceChildren(list.length ? h('table', {},
        h('thead', {}, h('tr', {}, ...['Tạo lúc', 'Khách / Page', 'Dịch vụ', 'Link', 'SL', 'Giá bán', 'Giá gốc', 'Lời', 'Trạng thái', 'Hoàn thành'].map(t => h('th', { textContent: t })))),
        h('tbody', {}, ...list.map(o => { const { sell, cost } = orderOf(o); return h('tr', {},
          h('td', { textContent: fmtTime(o.at) }),
          h('td', {}, o.customer?.name || '—', h('div', { className: 'hint', textContent: App.pageById(o.pageKey)?.name || '' })),
          h('td', {}, o.serviceName || '', h('div', { className: 'hint', textContent: '#' + o.providerOrderId })),
          h('td', {}, o.link ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: o.link, textContent: '📋 Copy', onclick: () => navigator.clipboard.writeText(o.link).then(() => toast('Đã copy link.')) }) : ''),
          h('td', { textContent: (o.items?.[0]?.qty || 0).toLocaleString('vi-VN') }),
          h('td', { textContent: money(sell) }), h('td', { textContent: money(cost) + (o.charge ? '' : ' ≈') }),
          h('td', { className: sell - cost < 0 ? 'neg' : '', textContent: money(sell - cost) }),
          h('td', {}, h('span', { className: 'status ' + (o.status === 'done' ? 'ok' : o.status === 'cancelled' ? 'err' : 'pending'), textContent: statusVi(o.svcStatus) })),
          h('td', { textContent: o.completedAt ? fmtTime(o.completedAt) : '' })); }))) : h('div', { className: 'empty', textContent: 'Chưa có đơn dịch vụ trong khoảng này. Tạo đơn từ Hộp thư (nút "＋ Tạo đơn dịch vụ") hoặc nút ＋ Tạo đơn.' }));
      drawSettings(s, this);
      if (s.apiKey) call('balance').then(b => { $('svBalance').textContent = `Số dư: ${Number(b.balance).toLocaleString('vi-VN')} ${b.currency || ''}`; }).catch(e => { $('svBalance').textContent = e.message; });
      else $('svBalance').textContent = 'Chưa nhập API key';
    }
  });
  async function importById() {
    const box = h('dialog', { className: 'svc-dialog', onclose: () => box.remove() });
    const id = h('input', { type: 'text', inputMode: 'numeric', placeholder: 'Mã đơn trên web dịch vụ', required: true }), price = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Giá bán cho khách (tổng, đ)' });
    const name = h('input', { type: 'text', placeholder: 'Tên khách (không bắt buộc)' }), err = h('div', { className: 'status err', hidden: true });
    box.append(h('form', { onsubmit: async e => {
      e.preventDefault(); err.hidden = true;
      try {
        const st = await call('status', { order: Number(id.value) });
        if (!st || st.error) throw Error(st?.error || 'Không thấy đơn này.');
        const charge = Number(st.charge) || 0, total = Number(price.value) || 0;
        const order = { id: uid('ord'), at: Date.now(), updatedAt: Date.now(), source: 'service', providerOrderId: String(id.value).trim(), serviceName: 'Đơn #' + id.value, link: '',
          customer: { name: name.value.trim(), phone: '', address: '' }, items: [{ name: 'Đơn dịch vụ #' + id.value, qty: 1, price: total, cost: charge }], charge,
          discount: 0, shipFee: 0, shipCost: 0, svcStatus: st.status, status: mapStatus(st.status), completedAt: /^(completed|partial)$/i.test(st.status) ? Date.now() : 0, note: 'Nhập theo mã đơn' };
        await DB.set(ORDERS, [...await DB.get(ORDERS, []), order]); box.close(); App.tabs.services.refresh(); toast('Đã thêm đơn #' + id.value);
      } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    } }, h('h3', { className: 'card-title', textContent: 'Thêm đơn đã tạo trên web' }), id, price, name, err,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end' }, h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: () => box.close() }), h('button', { className: 'btn btn-primary', textContent: 'Thêm' }))));
    document.body.append(box); box.showModal(); id.focus();
  }
  function drawSettings(s, tab) {
    const box = $('svSettings'); if (box.contains(document.activeElement)) return; // đang gõ thì không vẽ lại
    const home = h('input', { type: 'text', inputMode: 'url', value: s.home }), api = h('input', { type: 'text', inputMode: 'url', value: s.apiUrl });
    const key = h('input', { type: 'password', value: s.apiKey, placeholder: 'Dán API key (web dịch vụ › Tạo web con và API › Tích hợp API)', autocomplete: 'off' });
    const priceBox = h('div', { className: 'svc-prices' });
    const drawPrices = async filter => {
      let list = []; try { list = await services(); } catch (e) { return priceBox.replaceChildren(h('p', { className: 'hint', textContent: e.message })); }
      const f = norm(filter || '');
      priceBox.replaceChildren(...list.filter(x => !f || norm(x.name + ' ' + x.category + ' ' + x.id).includes(f)).slice(0, 80).map(x => h('label', { className: 'row', style: 'gap:8px' },
        h('span', { className: 'grow', textContent: `#${x.id} · ${x.name}`, title: x.category }), h('span', { className: 'hint', textContent: `gốc ${money(x.rate)}/1000` }),
        h('input', { type: 'number', min: 0, step: 'any', style: 'width:120px', placeholder: 'đ / đơn vị', value: s.prices[x.id] ?? '',
          onchange: async e => { const p = { ...(await settings()).prices }; if (e.target.value === '') delete p[x.id]; else p[x.id] = Number(e.target.value); await saveSettings({ prices: p }); } }))));
    };
    box.replaceChildren(
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Cài đặt dịch vụ' })),
      h('div', { className: 'form-grid' },
        h('label', { className: 'field' }, 'Trang chủ web dịch vụ', home),
        h('label', { className: 'field' }, 'URL API', api),
        h('label', { className: 'field' }, 'API key', key)),
      h('div', { className: 'row', style: 'gap:8px;margin-top:10px' },
        h('button', { className: 'btn btn-primary btn-sm', textContent: 'Lưu', onclick: async () => {
          for (const [el, label] of [[home, 'Trang chủ'], [api, 'URL API']]) if (!/^https:\/\//i.test(el.value.trim())) return toast(label + ' phải bắt đầu bằng https://', 5000);
          await saveSettings({ home: home.value.trim(), apiUrl: api.value.trim(), apiKey: key.value.trim() }); await DB.set(CACHE, null); toast('Đã lưu cài đặt dịch vụ.'); tab.refresh();
        } }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Tải lại danh sách dịch vụ', onclick: async () => { try { await services(true); drawPrices(); toast('Đã tải danh sách dịch vụ.'); } catch (e) { toast(e.message, 6000); } } })),
      h('h4', { className: 'card-title', style: 'margin:16px 0 6px', textContent: 'Bảng giá bán (đ / 1 đơn vị: 1 like, 1 follow…)' }),
      h('input', { type: 'search', placeholder: 'Tìm dịch vụ…', oninput: e => drawPrices(e.target.value) }), priceBox);
    if (s.apiKey) drawPrices(); else priceBox.replaceChildren(h('p', { className: 'hint', textContent: 'Nhập API key rồi Lưu để tải danh sách dịch vụ.' }));
  }
  App.services = { createDialog, inboxBox, refreshStatus, linksIn, call, openWeb, mapStatus };
})();
