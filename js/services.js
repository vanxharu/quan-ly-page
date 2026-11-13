/* Dịch vụ (SMM, vd Baostar): tạo đơn tăng like/follow… cho khách ngay từ Hộp thư qua API, theo dõi giá gốc (tiền web trừ),
 * giá bán (bảng giá của bạn), lời, thời gian tạo/hoàn thành. Đơn lưu chung shopOrdersV1 (source 'service') nên tab Bán hàng
 * cộng luôn doanh thu/lời. API chuẩn SMM v2: services · add · status · balance. App Windows gọi API qua tiến trình chính (tránh CORS).
 * Lưu: svcSettingsV1 { home, apiUrl, apiKey, prices: { [serviceId]: giá bán/1 đơn vị } }, svcServicesV1 { at, list }. */
(() => {
  const SET = 'svcSettingsV1', CACHE = 'svcServicesV1', ORDERS = 'shopOrdersV1';
  const DEFAULTS = { home: 'https://smm.baostar.net', apiUrl: 'https://smm.baostar.net/api/v2', apiKey: '', prices: {} };
  // dichvu.baostar.net là hệ thống khác; key API thuộc smm.baostar.net → tự đổi cài đặt cũ.
  const settings = async () => { const s = { ...DEFAULTS, ...(await DB.get(SET, {})) };
    if (/^https?:\/\/dichvu\.baostar\.net/i.test(s.home)) { s.home = DEFAULTS.home; await DB.set(SET, s); }
    return s; };
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
  // ── Danh mục trên web (chỉ app Windows): ghi chú gốc, giá web đ/1 đơn vị, trạng thái (bảo trì), thời gian TB. ──
  const WEBCAT = 'svcWebCatalogV1';
  const webOrigin = s => { try { return new URL(s.apiUrl).origin; } catch { return ''; } };
  let catalogMsg = '';
  async function webCatalog(force = false) {
    const s = await settings(), origin = webOrigin(s);
    const c = await DB.get(WEBCAT, null);
    if (!force && c?.origin === origin && c.list?.length && Date.now() - c.at < 864e5) return c;
    if (!window.metaDesktop?.svcCatalog || !origin) return c?.origin === origin ? c : null;
    const r = await window.metaDesktop.svcCatalog({ origin });
    if (r?.error) throw Error(r.error);
    const next = { at: Date.now(), origin, list: r.list || [] };
    await DB.set(WEBCAT, next);
    return next;
  }
  function catalogProgress(done, total) { catalogMsg = `Đang đọc web dịch vụ ${done}/${total} nhóm…`; const el = $('svCatMsg'); if (el) el.textContent = catalogMsg; }
  // Ghi chú HTML của web → các dòng chữ (không chạy gì của trang web: DOMParser chỉ dựng cây, không chạy script/style).
  function noteLines(html) {
    if (!html) return [];
    const d = new DOMParser().parseFromString(String(html), 'text/html');
    d.querySelectorAll('style,script').forEach(x => x.remove());
    d.querySelectorAll('div,li,p,br,h1,h2,h3,h4,h5,h6,tr').forEach(x => x.append('\n'));
    return d.body.textContent.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  // Ghi chú gốc hiển thị như web: dựng lại từ thẻ định dạng an toàn + lớp màu của web (note-row note-green, alert, badge bg-…).
  // Không giữ script/style/thuộc tính sự kiện/link/ảnh; mọi chữ đi vào bằng textContent.
  const NOTE_TAGS = new Set(['DIV', 'SPAN', 'STRONG', 'B', 'EM', 'U', 'SMALL', 'P', 'UL', 'OL', 'LI', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'CODE', 'MARK', 'TABLE', 'TBODY', 'TR', 'TD', 'TH']);
  function safeNotes(html) {
    const wrap = document.createElement('div'); wrap.className = 'svc-web-note';
    if (!html) return wrap;
    const src = new DOMParser().parseFromString(String(html), 'text/html').body;
    const copy = (from, to) => { for (const n of from.childNodes) {
      if (n.nodeType === 3) { to.append(n.nodeValue); continue; }
      if (n.nodeType !== 1 || /^(STYLE|SCRIPT|TEMPLATE|IFRAME|OBJECT|SVG|IMG|VIDEO|AUDIO|LINK|META)$/.test(n.tagName)) continue;
      if (n.tagName === 'I' && /\b(ri|fa[a-z]*|bi|ti)-/.test(n.className)) continue; // biểu tượng font của web: app không có
      const el = document.createElement(NOTE_TAGS.has(n.tagName) ? n.tagName : (n.tagName === 'I' ? 'EM' : 'SPAN'));
      const cls = String(n.getAttribute('class') || '').split(/\s+/).filter(c => /^[\w-]{1,40}$/.test(c)).join(' ');
      if (cls) el.className = cls;
      copy(n, el); to.append(el);
    } };
    copy(src, wrap);
    return wrap;
  }
  // Tốc độ: dòng "Tốc độ" trong ghi chú gốc, không có thì đoán theo tên dịch vụ.
  function speedOf(svc) {
    const lines = noteLines(svc.notes);
    const SP = /^[^\p{L}]*tốc độ(?![\p{L}])\s*:?\s*/iu, i = lines.findIndex(l => SP.test(l));
    let text = i < 0 ? '' : lines[i].replace(SP, '') || lines[i + 1] || '';
    if (!text) text = (svc.name.match(/cực nhanh|siêu nhanh|nhanh|chậm|lên ngay|tức thì/i) || [''])[0];
    const kind = /chậm|lâu|slow/i.test(text) ? 'slow' : /nhanh|ngay|tức thì|fast/i.test(text) ? 'fast' : '';
    return { text, kind };
  }
  const STATE = { active: ['Đang chạy', 'ok'], maintenance: ['Bảo trì', 'err'] };
  const stateOf = svc => !svc.web ? (svc.webChecked ? ['Không thấy trên web', 'pending'] : ['Chưa đọc web', 'pending'])
    : STATE[String(svc.status).toLowerCase()] || (/active|on|1/i.test(svc.status) ? STATE.active : ['Bảo trì (' + (svc.status || '?') + ')', 'err']);

  async function services(force = false) {
    const c = await DB.get(CACHE, null);
    let list = c?.list;
    if (force || !list?.length || Date.now() - c.at > 864e5) {
      const raw = asList(await call('services'));
      if (!raw.length) throw Error('Web dịch vụ không trả về dịch vụ nào. Kiểm tra lại API key và URL API.');
      list = raw.map(x => ({ id: String(x.service ?? x.id ?? x.service_id), name: String(x.name || ''), category: String(x.category || ''),
        rate: Number(x.rate ?? x.price) || 0, min: Number(x.min) || 1, max: Number(x.max) || 1e9, refill: !!x.refill }));
      await DB.set(CACHE, { at: Date.now(), list });
    }
    // Gộp thông tin web theo mã dịch vụ. Giá gốc = giá web (đ/1 đơn vị, đúng cấp tài khoản đang đăng nhập);
    // không có web thì lấy giá API (giá cho 1000 đơn vị) chia 1000.
    let cat = null; try { cat = await webCatalog(force); } catch (e) { catalogMsg = e.message; }
    const byId = new Map((cat?.list || []).map(w => [w.id, w]));
    const merged = list.map(x => { const w = byId.get(x.id);
      return { ...x, web: !!w, webChecked: !!cat, name: w?.name || x.name, category: w?.group || x.category, platform: w?.platform || '',
        notes: w?.notes || '', status: w?.status || '', avgTime: w?.avgTime || '', startTime: w?.startTime || '', refill: w ? w.refill : x.refill,
        min: w?.min || x.min, max: w?.max || x.max, unitCost: w?.rate || (x.rate ? x.rate / 1000 : 0), costFromWeb: !!w?.rate,
        groupIndex: w?.groupIndex ?? 999, pos: w?.pos ?? 0, parent: w?.parent || '', child: w?.child || '', labels: w?.labels || '' }; });
    // Dịch vụ chỉ có trên web (API chưa liệt kê) vẫn hiện để xem ghi chú, giá.
    const ids = new Set(list.map(x => x.id));
    for (const w of cat?.list || []) if (!ids.has(w.id)) merged.push({ id: w.id, name: w.name, category: w.group, platform: w.platform, web: true, webChecked: true, webOnly: true,
      notes: w.notes, status: w.status, avgTime: w.avgTime, startTime: w.startTime, refill: w.refill, min: w.min || 1, max: w.max || 1e9, rate: 0, unitCost: w.rate, costFromWeb: true,
      groupIndex: w.groupIndex ?? 999, pos: w.pos ?? 0, parent: w.parent || '', child: w.child || '', labels: w.labels || '' });
    return merged;
  }
  // Giá gốc ước tính = giá gốc 1 đơn vị × số lượng. Giá thật lấy theo "charge" khi web đã nhận đơn.
  const estCost = (svc, qty) => svc ? (svc.unitCost || 0) * qty : 0;
  const m2 = v => `${(Number(v) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`;
  const pct = (sell, cost) => cost > 0 ? ` (${Math.round((sell - cost) / cost * 100)}%)` : '';
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
    const noteBox = h('div', { className: 'svc-notes' }), info = h('div', { className: 'svc-sum' }), err = h('div', { className: 'status err', hidden: true });
    const chosen = () => list.find(x => x.id === pick.value);
    const draw = () => {
      const q = norm(search.value), plat = platformOf(linkIn.value);
      const rows = [...list].sort((a, b) => a.groupIndex - b.groupIndex || a.pos - b.pos || Number(a.id) - Number(b.id)).filter(x => stateOf(x)[1] !== 'err' && (!q || norm(x.name + ' ' + x.category + ' ' + x.id).includes(q))).sort((a, b) => (plat && norm(b.category + b.name).includes(plat)) - (plat && norm(a.category + a.name).includes(plat)));
      const keep = pick.value;
      pick.replaceChildren(...rows.slice(0, 300).map(x => { const [st] = stateOf(x);
        return h('option', { value: x.id, textContent: `#${x.id} · ${x.name} · gốc ${m2(x.unitCost)}/đv · ${x.min}–${x.max}${x.web ? ' · ' + st : ''}`, selected: x.id === keep }); }));
      if (!chosen() && rows[0]) { pick.value = rows[0].id; unit.dataset.touched = ''; } // dịch vụ hợp link nhất được chọn sẵn
      recalc();
    };
    const recalc = () => {
      const svc = chosen(), n = Math.max(0, Number(qty.value) || 0);
      if (svc && !unit.dataset.touched) unit.value = s.prices[svc.id] ?? '';
      const sell = (Number(unit.value) || 0) * n, cost = estCost(svc, n);
      if (svc) { const [st, cls] = stateOf(svc), sp = speedOf(svc);
        noteBox.replaceChildren(
          h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('span', { className: 'status ' + cls + ' svc-pill', textContent: st }),
            sp.text ? h('span', { className: 'svc-pill svc-speed ' + sp.kind, textContent: '⚡ ' + sp.text }) : null,
            svc.avgTime ? h('span', { className: 'svc-pill', textContent: '⏱ TB ' + svc.avgTime }) : null,
            h('span', { className: 'svc-pill', textContent: `Gốc ${m2(svc.unitCost)}/đv` })),
          svc.notes ? safeNotes(svc.notes) : null); }
      else noteBox.replaceChildren();
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
      if (stateOf(svc)[1] === 'err' && !confirm(`Dịch vụ #${svc.id} đang ${stateOf(svc)[0].toLowerCase()} trên web. Vẫn tạo đơn?`)) return;
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
      h('label', { className: 'field' }, 'Dịch vụ', search, pick), noteBox,
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
    const priceBox = h('div', { className: 'svc-prices scroll' });
    const filt = { q: '', plat: '', state: '', limit: 100 };
    const platSel = h('select', { style: 'width:auto', onchange: e => { filt.plat = e.target.value; filt.limit = 100; drawPrices(); } });
    const stateSel = h('select', { style: 'width:auto', onchange: e => { filt.state = e.target.value; filt.limit = 100; drawPrices(); } },
      ...[['', 'Mọi trạng thái'], ['ok', 'Đang chạy'], ['err', 'Bảo trì'], ['nofill', 'Chưa có giá của tôi'], ['fast', 'Nhanh'], ['slow', 'Chậm']].map(([v, t]) => h('option', { value: v, textContent: t })));
    const markup = h('input', { type: 'number', min: 0, step: 'any', value: s.markup ?? 50, style: 'width:80px', title: '% lãi trên giá gốc' });
    const catMsg = h('span', { className: 'hint', id: 'svCatMsg', textContent: catalogMsg });
    let shown = [];
    const savePrice = async (id, v) => { const p = { ...(await settings()).prices }; if (v === '' || v == null) delete p[id]; else p[id] = Number(v); await saveSettings({ prices: p }); };
    const COLS = 7;
    const rowOf = (x, prices, kids = []) => {
      const [st, cls] = stateOf(x), sp = speedOf(x), mine = prices[x.id];
      const profit = h('td', { className: 'num' });
      const drawProfit = v => { const sell = Number(v); profit.className = 'num' + (v !== '' && v != null && sell < x.unitCost ? ' neg' : '');
        profit.textContent = v === '' || v == null ? '—' : m2(sell - x.unitCost) + pct(sell, x.unitCost); };
      const kidInputs = [];
      // Dòng cha có cảm xúc: nhập giá ở đây là áp cho mọi cảm xúc cùng máy chủ.
      const input = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'đ / đv', value: mine ?? '', style: 'width:96px',
        title: kids.length ? 'Áp cho mọi cảm xúc của máy chủ này' : '',
        oninput: e => { drawProfit(e.target.value); for (const k of kidInputs) { k.value = e.target.value; k.oninput({ target: k }); } },
        onchange: async e => { await savePrice(x.id, e.target.value); for (const k of kids) await savePrice(k.id, e.target.value); } });
      drawProfit(mine ?? '');
      const noteRow = h('tr', { className: 'svc-note-row', hidden: true }, h('td', { colSpan: COLS },
        x.notes ? safeNotes(x.notes) : h('div', { className: 'hint', textContent: x.web ? 'Web không có ghi chú cho máy chủ này.' : 'Chưa có ghi chú: bấm "Đọc lại web dịch vụ" (cần app Windows).' }),
        h('div', { className: 'hint', style: 'margin-top:6px', textContent: [`Mã API ${x.id}`, `Min ${x.min.toLocaleString('vi-VN')} – Max ${x.max.toLocaleString('vi-VN')}`, x.refill ? 'Có bảo hành (refill)' : '', x.startTime ? 'Bắt đầu ' + x.startTime : '', x.webOnly ? 'Chỉ thấy trên web, API chưa liệt kê' : ''].filter(Boolean).join(' · ') })));
      const kidRows = kids.map(k => { const [r] = rowOf(k, prices); r.classList.add('svc-kid'); r.hidden = true; kidInputs.push(r.querySelector('input')); return r; });
      const toggle = kids.length ? h('button', { type: 'button', className: 'btn btn-primary btn-sm svc-plus', title: 'Xem từng cảm xúc', textContent: '+',
        onclick: e => { e.stopPropagation(); const open = kidRows[0].hidden; kidRows.forEach(r => { r.hidden = !open; }); e.target.textContent = open ? '−' : '+'; } }) : null;
      const main = h('tr', { className: 'svc-row' + (cls === 'err' ? ' off' : '') },
        h('td', {}, h('span', { className: 'svc-mc', textContent: 'MC ' + x.id })),
        h('td', { className: 'svc-name', title: x.parent ? '' : 'Bấm để xem ghi chú gốc', onclick: () => { if (!x.parent) noteRow.hidden = !noteRow.hidden; } },
          h('div', { className: 'svc-name-in' }, toggle, h('span', { className: 'svc-title', textContent: x.parent ? `( ${x.child} )` : x.name }),
            x.labels ? h('span', { className: 'svc-pill', textContent: x.labels }) : null,
            !x.parent && x.notes ? h('span', { className: 'hint', textContent: 'ghi chú ▾' }) : null)),
        h('td', { className: 'num' }, h('span', { className: 'svc-price', textContent: m2(x.unitCost).replace('đ', '') + ' VND' + (x.costFromWeb || !x.unitCost ? '' : ' ≈'), title: x.costFromWeb ? 'Giá trên web (đ / 1 đơn vị)' : 'Giá API ÷ 1000' })),
        h('td', {}, input), profit,
        h('td', {}, h('span', { className: 'status svc-pill ' + cls, textContent: st })),
        h('td', {}, sp.text && !x.parent ? h('span', { className: 'svc-pill svc-speed ' + sp.kind, title: sp.text, textContent: sp.text.length > 40 ? sp.text.slice(0, 38) + '…' : sp.text }) : null,
          x.avgTime && !x.parent ? h('div', { className: 'hint', textContent: '⏱ TB ' + x.avgTime }) : null));
      return [main, ...kidRows, noteRow];
    };
    const drawPrices = async () => {
      let list = []; try { list = await services(); } catch (e) { return priceBox.replaceChildren(h('p', { className: 'hint', textContent: e.message })); }
      const prices = (await settings()).prices, f = norm(filt.q);
      list = [...list].sort((a, b) => a.groupIndex - b.groupIndex || a.pos - b.pos || (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || Number(a.id) - Number(b.id));
      const plats = [...new Set(list.map(x => x.platform).filter(Boolean))];
      if (platSel.options.length !== plats.length + 1) platSel.replaceChildren(h('option', { value: '', textContent: 'Mọi nền tảng' }), ...plats.map(p => h('option', { value: p, textContent: p, selected: p === filt.plat })));
      const ok = x => (!f || norm(x.name + ' ' + x.category + ' ' + x.id + ' ' + noteLines(x.notes).join(' ')).includes(f)) && (!filt.plat || x.platform === filt.plat)
        && (!filt.state || (filt.state === 'nofill' ? prices[x.id] == null : filt.state === 'fast' || filt.state === 'slow' ? speedOf(x).kind === filt.state : stateOf(x)[1] === filt.state));
      const kidsOf = new Map(); for (const x of list) if (x.parent) (kidsOf.get(x.parent) || kidsOf.set(x.parent, []).get(x.parent)).push(x);
      const heads = list.filter(x => !x.parent || !list.some(y => y.id === x.parent));
      const top = heads.filter(x => ok(x) || (kidsOf.get(x.id) || []).some(ok));
      shown = top.flatMap(x => [x, ...(kidsOf.get(x.id) || [])]);
      const body = []; let lastPlat = null, lastGroup = null, n = 0;
      for (const x of top) {
        if (n++ >= filt.limit) break;
        const plat = x.web ? x.platform : 'Không thấy trên web', group = x.web ? x.category : '';
        if (plat !== lastPlat) { body.push(h('tr', { className: 'svc-plat' }, h('td', { colSpan: COLS, textContent: plat }))); lastPlat = plat; lastGroup = null; }
        if (group && group !== lastGroup) { body.push(h('tr', { className: 'svc-group' }, h('td', { colSpan: COLS, textContent: group }))); lastGroup = group; }
        body.push(...rowOf(x, prices, kidsOf.get(x.id) || []));
      }
      const head = h('thead', {}, h('tr', {}, ...['Máy chủ', 'Dịch vụ (bấm xem ghi chú gốc)', 'Giá gốc / đv', 'Giá của tôi / đv', 'Lãi / đv', 'Trạng thái', 'Tốc độ'].map(t => h('th', { textContent: t }))));
      priceBox.replaceChildren(top.length ? h('table', { className: 'svc-table' }, head, h('tbody', {}, ...body)) : h('p', { className: 'hint', textContent: 'Không có dịch vụ nào khớp bộ lọc.' }),
        top.length > filt.limit ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: 'margin:8px', textContent: `Xem thêm (${top.length - filt.limit} máy chủ)`, onclick: () => { filt.limit += 200; drawPrices(); } }) : null);
    };
    const applyMarkup = async onlyEmpty => {
      const k = Number(markup.value); if (!(k >= 0)) return toast('Nhập % lãi hợp lệ.', 4000);
      const p = { ...(await settings()).prices }; let n = 0;
      for (const x of shown) if (x.unitCost > 0 && (!onlyEmpty || p[x.id] == null)) { p[x.id] = Math.round(x.unitCost * (1 + k / 100) * 100) / 100; n++; }
      await saveSettings({ prices: p, markup: k }); toast(`Đã đặt giá cho ${n} dịch vụ (gốc + ${k}%).`); drawPrices();
    };
    const reloadWeb = async () => {
      if (!window.metaDesktop?.svcCatalog) return toast('Đọc web dịch vụ chỉ có trong app Windows.', 5000);
      catalogMsg = 'Đang đọc web dịch vụ…'; catMsg.textContent = catalogMsg;
      try { const c = await webCatalog(true); catalogMsg = `Đã đọc ${c.list.length} dịch vụ từ web lúc ${fmtTime(c.at)}.`; } catch (e) { catalogMsg = e.message; }
      catMsg.textContent = catalogMsg; drawPrices();
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
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Tải lại danh sách dịch vụ', onclick: async () => { try { await services(true); catMsg.textContent = catalogMsg; drawPrices(); toast('Đã tải danh sách dịch vụ.'); } catch (e) { toast(e.message, 6000); } } }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: '↻ Đọc lại web dịch vụ (ghi chú, bảo trì, giá)', title: 'Đọc trang web của URL API bằng phiên đăng nhập ở cột Dịch vụ', onclick: reloadWeb }), catMsg),
      h('h4', { className: 'card-title', style: 'margin:16px 0 6px', textContent: 'Bảng giá bán (đ / 1 đơn vị: 1 like, 1 follow…)' }),
      h('p', { className: 'hint', textContent: `Giá gốc lấy từ web ${webOrigin(s) || 'dịch vụ'} theo tài khoản đang đăng nhập ở cột Dịch vụ (Mở web dịch vụ ↗). Chưa đăng nhập thì là giá cấp Khách hàng. Bấm tên dịch vụ để xem ghi chú gốc.` }),
      h('div', { className: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:8px' },
        h('input', { type: 'search', placeholder: 'Tìm tên, mã, ghi chú…', style: 'flex:1;min-width:200px', oninput: e => { filt.q = e.target.value; filt.limit = 100; drawPrices(); } }),
        platSel, stateSel),
      h('div', { className: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center' },
        h('span', { className: 'hint', textContent: 'Giá của tôi = gốc +' }), markup, h('span', { className: 'hint', textContent: '%' }),
        h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: 'Điền cho dịch vụ chưa có giá', onclick: () => applyMarkup(true) }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Đặt lại tất cả đang lọc', onclick: () => { if (confirm(`Đặt lại giá của tôi cho ${shown.length} dịch vụ đang lọc = giá gốc + ${markup.value}%?`)) applyMarkup(false); } })),
      priceBox);
    if (s.apiKey) drawPrices(); else priceBox.replaceChildren(h('p', { className: 'hint', textContent: 'Nhập API key rồi Lưu để tải danh sách dịch vụ.' }));
  }
  App.services = { createDialog, inboxBox, refreshStatus, linksIn, call, openWeb, mapStatus, catalogProgress, noteLines, speedOf };
})();
