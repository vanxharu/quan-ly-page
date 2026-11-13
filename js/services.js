/* Dịch vụ (SMM, vd Baostar): tạo đơn tăng like/follow… cho khách ngay từ Hộp thư qua API, theo dõi giá gốc (tiền web trừ),
 * giá bán (bảng giá của bạn), lời, thời gian tạo/hoàn thành. Đơn lưu chung shopOrdersV1 (source 'service') nên tab Bán hàng
 * cộng luôn doanh thu/lời. API chuẩn SMM v2: services · add · status · balance. App Windows gọi API qua tiến trình chính (tránh CORS).
 * Lưu: svcSettingsV1 { home, apiUrl, apiKey, prices: { [serviceId]: giá bán/1 đơn vị } }, svcServicesV1 { at, list }. */
(() => {
  const SET = 'svcSettingsV1', CACHE = 'svcServicesV1', ORDERS = 'shopOrdersV1';
  // Báo giá (khách trả tiền trước rồi mới tạo đơn Baostar): kho riêng, không tính doanh thu.
  // { id, payCode, at, expiresAt, state: 'quote' | 'paid' (đã thu, chưa tạo đơn), paidAmount, paidAt, payNote, lastError,
  //   link, qty, sell, cost, costManual, displayName, packageId, serviceId, serviceName, customerKey, pageKey, pageName, pageAvatar, customer, sentAt }
  const QUOTES = 'svcQuotesV1', QUOTE_TTL = 24 * 3600e3;
  const quotes = () => DB.get(QUOTES, []);
  const saveQuote = async q => { const all = await quotes(), i = all.findIndex(x => x.id === q.id); if (i < 0) all.push(q); else all[i] = q; await DB.set(QUOTES, all); return q; };
  const dropQuote = async id => DB.set(QUOTES, (await quotes()).filter(x => x.id !== id));
  const expired = q => q.state === 'quote' && Date.now() > (q.expiresAt || Infinity);
  const newPayCode = () => 'DV' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
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
  // Gói bán của tôi: { id, name, kind: 'fixed' (qty + price tổng) | 'unit' (unitPrice / đv), qty, price, unitPrice, serviceId }.
  // Dịch vụ có hạn (VIP theo tháng): số tháng lấy từ tên máy chủ con "( 2 tháng )", gói "1 tháng | Mua theo bài", nhóm Vip…; gói của bạn đặt tay được.
  const isVip = svc => /\bvip\b/i.test(`${svc?.name || ''} ${svc?.category || ''}`);
  function termOf(svc, pkg) {
    if (pkg && pkg.term !== undefined && pkg.term !== '') return Math.max(0, Number(pkg.term) || 0);
    const m = String(svc?.name || '').match(/(\d+)\s*tháng/i);
    return m ? Number(m[1]) : isVip(svc) ? 1 : 0;
  }
  const addMonths = (t, n) => { const d = new Date(t); d.setMonth(d.getMonth() + n); return d.getTime(); };
  const vsList = o => o.listPrice ? Math.round(orderSell(o) - o.listPrice) : null;
  const vsCell = o => { const d = vsList(o); return h('td', { className: 'num' + (d < 0 ? ' neg' : d > 0 ? ' pos' : ''), title: o.listPrice ? 'Giá gói / bảng giá: ' + money(o.listPrice) : 'Không có giá gói để so', textContent: d == null ? '—' : (d > 0 ? '+' : '') + money(d) }); };
  // Giá bán mặc định: gốc × (1 + k%) tính cho 1.000 đơn vị, làm tròn LÊN chục nghìn, rồi chia lại / đơn vị.
  // Vd gốc 9đ/like → 9.000/1.000 × 7 = 63.000 → 70.000 → 70đ/like.
  const ROUND = 10000;
  const autoUnitPrice = (cost, k) => cost > 0 ? Math.ceil(cost * 1000 * (1 + k / 100) / ROUND) * ROUND / 1000 : 0;
  // Gói sẵn: mỗi loại dịch vụ trên web 1 gói; loại có cả VIP/thường hoặc Việt/Tây thì tách gói. Mỗi gói gắn máy chủ đang chạy rẻ nhất.
  const originOf = svc => { const v = /\b(việt|viet|vn)\b|việt nam/i.test(svc.name), t = /\b(tây|tay)\b/i.test(svc.name); return v && t ? '' : v ? 'Việt' : t ? 'Tây' : ''; };
  const vipKindOf = svc => /mua theo bài/i.test(svc.name) ? 'mua theo bài' : /\bvip\b/i.test(svc.name) ? 'VIP' : '';
  function suggestPackages(list, s, k) {
    const heads = list.filter(x => x.web && !x.webOnly && !x.parent && stateOf(x)[1] !== 'err' && x.unitCost > 0);
    const groups = new Map();
    for (const x of heads) { const g = `${x.platform}|${x.category}`; (groups.get(g) || groups.set(g, []).get(g)).push(x); }
    const out = [];
    for (const [g, svs] of groups) {
      const [plat, cat] = g.split('|'), vipCat = /\bvip\b/i.test(cat);
      const splitVip = new Set(svs.map(vipKindOf)).size > 1 || (!vipCat && svs.some(vipKindOf));
      const origins = new Set(svs.map(originOf)), splitOrigin = origins.has('Việt') && origins.has('Tây');
      const buckets = new Map();
      for (const x of svs) { const key = `${splitVip ? vipKindOf(x) : ''}|${splitOrigin ? originOf(x) : ''}`; (buckets.get(key) || buckets.set(key, []).get(key)).push(x); }
      for (const [key, b] of buckets) {
        const [vk, org] = key.split('|'), best = b.sort((a, c) => a.unitCost - c.unitCost)[0];
        const vipLabel = !vk ? '' : vk === 'mua theo bài' ? 'mua theo bài' : vipCat ? 'theo tháng' : 'VIP';
        const name = [`${plat} · ${cat.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim()}`, vipLabel, org].filter(Boolean).join(' · ');
        out.push({ id: uid('pkg'), name, kind: 'unit', unitPrice: s.prices[best.id] ?? autoUnitPrice(best.unitCost, k), serviceId: best.id, auto: true });
      }
    }
    return out;
  }
  const pkgCost = (pkg, list) => { const svc = list.find(x => x.id === String(pkg.serviceId)); return svc ? svc.unitCost : 0; };
  async function createDialog(ctx = {}, link = '') {
    const s = await settings();
    let list = [];
    try { list = await services(); } catch (e) { return toast(e.message, 7000); }
    const pkgs = s.packages || [];
    const dlg = h('dialog', { className: 'svc-dialog', onclose: () => dlg.remove() });
    const linkIn = h('input', { type: 'text', inputMode: 'url', value: link, placeholder: 'Link cần làm (bài viết, trang cá nhân, video…)', required: true });
    const pkgSel = h('select', {}, h('option', { value: '', textContent: '— Chọn máy chủ trực tiếp —' }),
      ...pkgs.map(p => { const svc = list.find(x => x.id === String(p.serviceId)), off = svc && stateOf(svc)[1] === 'err';
        return h('option', { value: p.id, textContent: `${p.name} · ${p.kind === 'fixed' ? `${Number(p.qty).toLocaleString('vi-VN')} = ${money(p.price)}` : `${m2(p.unitPrice)}/đv`}${off ? ' · máy chủ gốc đang bảo trì' : ''}` }); }));
    const search = h('input', { type: 'search', placeholder: 'Tìm máy chủ (vd: follow, like page, view tiktok)…' });
    const pick = h('select', { size: 7, style: 'width:100%' });
    const qty = h('input', { type: 'number', min: 1, step: 1, value: 1000, required: true });
    const unit = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Giá bán / 1 đơn vị (đ)' });
    const total = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Khách trả (đ)', required: true });
    const costIn = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Giá gốc cả đơn (đ)' });
    const shown = h('input', { type: 'text', placeholder: 'Tên dịch vụ khách thấy (vd: Tăng like bài viết)' });
    const termIn = h('input', { type: 'number', min: 0, step: 1, placeholder: '0 = không nhắc' });
    let listPrice = 0;
    const remember = h('input', { type: 'checkbox', checked: true });
    const noteBox = h('div', { className: 'svc-notes' }), info = h('div', { className: 'svc-sum' }), err = h('div', { className: 'status err', hidden: true });
    const svcBox = h('div', { className: 'field' }, 'Máy chủ', search, pick);
    const unitBox = h('label', { className: 'field', style: 'flex:1' }, 'Giá bán / 1 đơn vị', unit);
    const rememberBox = h('label', { className: 'row', style: 'gap:6px' }, remember, 'Lưu giá / đv này vào bảng giá của máy chủ');
    const pkg = () => pkgs.find(p => p.id === pkgSel.value);
    const chosen = () => { const p = pkg(); return list.find(x => x.id === (p ? String(p.serviceId) : pick.value)); };
    const touched = el => el.dataset.touched === '1';
    const draw = () => {
      const q = norm(search.value), plat = platformOf(linkIn.value);
      const rows = [...list].sort((a, b) => a.groupIndex - b.groupIndex || a.pos - b.pos || Number(a.id) - Number(b.id)).filter(x => stateOf(x)[1] !== 'err' && (!q || norm(x.name + ' ' + x.category + ' ' + x.id).includes(q))).sort((a, b) => (plat && norm(b.category + b.name).includes(plat)) - (plat && norm(a.category + a.name).includes(plat)));
      const keep = pick.value;
      pick.replaceChildren(...rows.slice(0, 300).map(x => { const [st] = stateOf(x);
        return h('option', { value: x.id, textContent: `#${x.id} · ${x.name} · gốc ${m2(x.unitCost)}/đv · ${x.min}–${x.max}${x.web ? ' · ' + st : ''}`, selected: x.id === keep }); }));
      if (!pkg() && !list.some(x => x.id === pick.value) && rows[0]) { pick.value = rows[0].id; unit.dataset.touched = ''; } // máy chủ hợp link nhất được chọn sẵn
      recalc();
    };
    const recalc = () => {
      const p = pkg(), svc = chosen();
      svcBox.hidden = !!p; rememberBox.hidden = !!p; unitBox.hidden = p?.kind === 'fixed';
      qty.readOnly = p?.kind === 'fixed';
      if (p?.kind === 'fixed') qty.value = p.qty;
      if (!touched(unit)) unit.value = p ? (p.kind === 'unit' ? p.unitPrice : '') : (svc ? s.prices[svc.id] ?? '' : '');
      if (!touched(shown)) shown.value = p ? p.name : svc ? (svc.category || '') : '';
      const n = Math.max(0, Number(qty.value) || 0);
      if (!touched(total)) total.value = p?.kind === 'fixed' ? p.price : unit.value === '' ? '' : Math.round(Number(unit.value) * n);
      if (!touched(costIn)) costIn.value = svc ? Math.round(estCost(svc, n)) : '';
      if (!touched(termIn)) termIn.value = svc ? termOf(svc, p) : 0;
      listPrice = p ? (p.kind === 'fixed' ? Number(p.price) || 0 : (Number(p.unitPrice) || 0) * n) : svc && s.prices[svc.id] != null ? s.prices[svc.id] * n : 0;
      const sell = Number(total.value) || 0, cost = Number(costIn.value) || 0;
      if (svc) { const [st, cls] = stateOf(svc), sp = speedOf(svc);
        noteBox.replaceChildren(
          h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap' }, p ? h('span', { className: 'svc-pill', textContent: `Gốc: MC ${svc.id} · ${svc.name}` }) : null,
            h('span', { className: 'status ' + cls + ' svc-pill', textContent: st }),
            sp.text ? h('span', { className: 'svc-pill svc-speed ' + sp.kind, textContent: '⚡ ' + sp.text }) : null,
            svc.avgTime ? h('span', { className: 'svc-pill', textContent: '⏱ TB ' + svc.avgTime }) : null,
            h('span', { className: 'svc-pill', textContent: `Gốc ${m2(svc.unitCost)}/đv` })),
          svc.notes ? safeNotes(svc.notes) : null); }
      else noteBox.replaceChildren(p ? h('div', { className: 'neg', textContent: 'Máy chủ gốc của gói không còn trong danh sách. Đổi máy chủ gốc ở Cài đặt dịch vụ › Gói bán của tôi.' }) : '');
      info.replaceChildren(
        h('span', {}, 'Giá gốc ', h('strong', { textContent: money(cost) + (touched(costIn) ? '' : ' ≈') })), h('span', {}, 'Khách trả ', h('strong', { textContent: money(sell) })),
        h('span', {}, 'Lãi ', h('strong', { className: sell - cost < 0 ? 'neg' : '', textContent: money(sell - cost) + pct(sell, cost) })),
        listPrice ? h('span', {}, 'So với giá gói ', h('strong', { className: sell - listPrice < 0 ? 'neg' : '', textContent: (sell - listPrice > 0 ? '+' : '') + money(sell - listPrice) })) : null,
        Number(termIn.value) > 0 ? h('span', {}, '🔔 Hạn ', h('strong', { textContent: `${termIn.value} tháng` }), ' (nhắc gia hạn)') : null,
        svc && (n < svc.min || n > svc.max) ? h('span', { className: 'neg', textContent: `Số lượng phải từ ${svc.min} đến ${svc.max}` }) : null);
    };
    const reset = (...els) => els.forEach(el => { el.dataset.touched = ''; });
    pkgSel.onchange = () => { reset(unit, total, costIn, shown, termIn); recalc(); };
    search.oninput = draw; pick.onchange = () => { reset(unit, total, costIn, shown, termIn); recalc(); }; linkIn.oninput = draw;
    qty.oninput = () => { reset(total, costIn); recalc(); };
    unit.oninput = () => { unit.dataset.touched = '1'; reset(total); recalc(); };
    for (const el of [total, costIn, shown, termIn]) el.oninput = () => { el.dataset.touched = '1'; recalc(); };
    const form = h('form', { method: 'dialog', onsubmit: async e => {
      e.preventDefault(); err.hidden = true;
      const p = pkg(), svc = chosen(), n = Math.round(Number(qty.value) || 0), sell = Number(total.value) || 0, cost = Number(costIn.value) || 0;
      const fail = m => { err.textContent = m; err.hidden = false; };
      if (!svc) return fail(p ? 'Máy chủ gốc của gói không còn. Đổi ở Cài đặt dịch vụ.' : 'Chọn máy chủ.');
      if (!/^https?:\/\//i.test(linkIn.value.trim())) return fail('Link phải bắt đầu bằng http(s)://');
      if (n < svc.min || n > svc.max) return fail(`Số lượng phải từ ${svc.min} đến ${svc.max}.`);
      if (stateOf(svc)[1] === 'err') return fail(`Máy chủ #${svc.id} đang bảo trì trên web. Chọn máy chủ khác hoặc đổi máy chủ gốc của gói.`);
      if (!(sell > 0)) return fail('Nhập thành tiền khách trả.');
      if (!p && remember.checked && unit.value !== '' && touched(unit)) await saveSettings({ prices: { ...(await settings()).prices, [svc.id]: Number(unit.value) } });
      const label = shown.value.trim() || p?.name || svc.category || 'Dịch vụ', now = Date.now();
      const q = await saveQuote({ id: uid('quo'), payCode: newPayCode(), at: now, expiresAt: now + QUOTE_TTL, state: 'quote', paidAmount: 0,
        link: linkIn.value.trim(), qty: n, sell, cost, costManual: touched(costIn), listPrice, termMonths: Math.max(0, Number(termIn.value) || 0), renewOf: ctx.renewOf || '', renewEnd: ctx.renewEnd || 0, displayName: label, packageId: p?.id || '', serviceId: svc.id, serviceName: svc.name,
        customerKey: ctx.key || '', pageKey: ctx.page?.id || '', pageName: ctx.page?.name || '', pageAvatar: App.pageAvatarUrl(ctx.page) || '', customer: { name: ctx.name || '' } });
      if (ctx.key) App.crm?.update?.(ctx.key, { pageId: ctx.page?.id, pageName: ctx.page?.name, name: ctx.name, orderStatus: 'Chờ thanh toán' }).catch(() => {});
      dlg.close(); toast(`Đã tạo báo giá ${q.payCode}. Gửi cho khách, khi nhận tiền bấm "Đã nhận tiền".`, 6000);
      App.tabs.services?.refresh?.();
      invoiceDialog(q, 'quote');
    } },
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Báo giá dịch vụ' + (ctx.name ? ' · ' + ctx.name : '') }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('label', { className: 'field' }, 'Link cần làm', linkIn),
      h('label', { className: 'field' }, 'Gói của tôi', pkgSel),
      svcBox, noteBox,
      h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' }, h('label', { className: 'field', style: 'flex:1' }, 'Số lượng', qty), unitBox),
      h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
        h('label', { className: 'field', style: 'flex:1' }, 'Thành tiền khách trả (sửa được)', total),
        h('label', { className: 'field', style: 'flex:1' }, 'Giá gốc cả đơn (sửa được)', costIn)),
      h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
        h('label', { className: 'field', style: 'flex:3' }, 'Tên dịch vụ trên đơn gửi khách (khách không thấy tên máy chủ gốc)', shown),
        h('label', { className: 'field', style: 'flex:1' }, 'Thời hạn (tháng) để nhắc gia hạn', termIn)),
      rememberBox, info, err,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end' },
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Mở web dịch vụ ↗', onclick: () => { if (linkIn.value) navigator.clipboard?.writeText(linkIn.value).catch(() => {}); openWeb(); } }),
        h('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Tạo báo giá' })));
    dlg.append(form); document.body.append(dlg); draw(); dlg.showModal(); (link ? pkgSel : linkIn).focus();
  }
  // ── Xuất đơn gửi khách: tin nhắn chữ + ảnh hoá đơn (tên gói của bạn, không lộ máy chủ gốc) ──
  const BANKS = [['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'], ['970422', 'MBBank'], ['970407', 'Techcombank'],
    ['970416', 'ACB'], ['970432', 'VPBank'], ['970423', 'TPBank'], ['970403', 'Sacombank'], ['970437', 'HDBank'], ['970441', 'VIB'], ['970443', 'SHB'],
    ['970431', 'Eximbank'], ['970426', 'MSB'], ['970448', 'OCB'], ['970440', 'SeABank'], ['970449', 'LPBank'], ['970428', 'NamABank'], ['970409', 'BacABank'],
    ['970454', 'VietCapitalBank'], ['970429', 'SCB'], ['970452', 'KienLongBank'], ['970425', 'ABBANK'], ['970412', 'PVcomBank'], ['970419', 'NCB'],
    ['970433', 'VietBank'], ['970427', 'VietABank'], ['970430', 'PGBank'], ['970438', 'BaoVietBank'], ['970400', 'SaigonBank'], ['970424', 'ShinhanBank'],
    ['546034', 'CAKE'], ['546035', 'Ubank'], ['963388', 'Timo'], ['970406', 'Vikki'], ['970414', 'MBV'], ['971005', 'ViettelMoney'], ['971011', 'VNPTMoney']];
  const bankName = bin => (BANKS.find(b => b[0] === String(bin)) || [, ''])[1];
  // Dùng chung cho báo giá (sell, qty) và đơn đã tạo (items).
  const payCode = o => o.payCode || 'DV' + o.providerOrderId;
  const qtyOf = o => o.qty ?? o.items?.[0]?.qty ?? 0;
  const orderSell = o => o.sell ?? (o.items?.[0]?.price || 0) * (o.items?.[0]?.qty || 0);
  const amountDue = o => Math.max(0, Math.round(orderSell(o) - (o.paidAmount || 0)));
  const hasPayBlock = kind => kind === 'quote' || kind === 'new';
  const qrUrl = (inv, o) => inv.bin && inv.acc ? `https://img.vietqr.io/image/${inv.bin}-${encodeURIComponent(inv.acc)}-qr_only.png?amount=${amountDue(o)}&addInfo=${encodeURIComponent(payCode(o))}&accountName=${encodeURIComponent(inv.holder || '')}` : '';
  const progressLine = o => { if (o.payCode && !o.providerOrderId) return o.paidAmount ? `Đã nhận ${money(o.paidAmount)} · còn thiếu ${money(amountDue(o))}` : 'Chờ thanh toán';
    const st = statusVi(o.svcStatus), q = qtyOf(o);
    const done = o.startCount != null && o.remains != null ? ` · đã lên ${Math.max(0, q - Number(o.remains)).toLocaleString('vi-VN')}/${q.toLocaleString('vi-VN')}` : '';
    return st + done + (o.completedAt ? ` · xong lúc ${fmtTime(o.completedAt)}` : ''); };
  const KIND_TITLE = { quote: '🧾 BÁO GIÁ', paid: '✅ ĐÃ NHẬN THANH TOÁN · ĐƠN ĐANG CHẠY', progress: '📊 CẬP NHẬT ĐƠN', new: '✅ XÁC NHẬN ĐƠN HÀNG' };
  const KIND_HEAD = { quote: 'BÁO GIÁ · CHỜ THANH TOÁN', paid: 'ĐÃ NHẬN THANH TOÁN · ĐƠN ĐANG CHẠY', progress: 'CẬP NHẬT TIẾN ĐỘ ĐƠN HÀNG', new: 'XÁC NHẬN ĐƠN HÀNG' };
  function invoiceText(o, inv, kind) {
    const q = qtyOf(o), name = o.displayName || o.items?.[0]?.name || 'Dịch vụ';
    const L = [`${kind === 'quote' && o.renewOf ? '🔔 GIA HẠN DỊCH VỤ' : KIND_TITLE[kind] || KIND_TITLE.new} #${payCode(o)}`,
      `• Dịch vụ: ${name}`, o.link ? `• Link: ${o.link}` : '', `• Số lượng: ${q.toLocaleString('vi-VN')}`, `• Thành tiền: ${money(orderSell(o))}`];
    if (kind === 'quote') {
      if (o.renewEnd) L.push(`• Gói hiện tại hết hạn: ${fmtTime(o.renewEnd)}`);
      if (o.termMonths) L.push(`• Thời hạn: ${o.termMonths} tháng`);
      if (o.paidAmount) L.push(`• Đã nhận: ${money(o.paidAmount)} · Còn thiếu: ${money(amountDue(o))}`);
      L.push(`• Hạn thanh toán: ${fmtTime(o.expiresAt)}`);
    } else if (kind === 'paid') L.push(`• Đã thanh toán: ${money(o.paidAmount || orderSell(o))}`, `• Lên đơn lúc: ${fmtTime(o.at)}`, o.vipEnd ? `• Hạn sử dụng đến: ${fmtTime(o.vipEnd)}` : '', `• Trạng thái: ${progressLine(o)}`);
    else L.push(`• Tạo lúc: ${fmtTime(o.at)}`, `• Trạng thái: ${progressLine(o)}`);
    if (hasPayBlock(kind) && inv.acc) L.push('', `💳 Chuyển khoản ${money(amountDue(o))}: ${bankName(inv.bin) || 'Ngân hàng'} · STK ${inv.acc}${inv.holder ? ' · ' + inv.holder : ''}`, `   Nội dung CK: ${payCode(o)}`);
    if (kind === 'quote') L.push('', '⏳ Shop lên đơn ngay khi nhận được thanh toán.');
    if (inv.note) L.push('', '📌 Lưu ý: ' + inv.note.trim());
    return L.filter((l, i) => l !== '' || L[i - 1] !== '').join('\n').replace(/^\n+|\n+$/g, '');
  }
  async function loadImg(url) {
    if (!url) return null;
    let src = url;
    if (!url.startsWith('data:')) {
      if (window.metaDesktop?.svcImage) { const r = await window.metaDesktop.svcImage(url).catch(() => null); if (!r?.dataUrl) return null; src = r.dataUrl; }
      else { try { const b = await fetch(url, { mode: 'cors' }).then(r => r.ok ? r.blob() : Promise.reject()); src = URL.createObjectURL(b); } catch { return null; } }
    }
    return new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
  }
  async function invoiceImage(o, inv, kind) {
    const page = App.pageById(o.pageKey), shop = page?.name || o.pageName || inv.shop || 'Cửa hàng';
    const [logo, qr] = await Promise.all([loadImg(App.pageAvatarUrl(page) || o.pageAvatar), hasPayBlock(kind) ? loadImg(qrUrl(inv, o)) : null]);
    const W = 760, P = 36, c = document.createElement('canvas'), x = c.getContext('2d');
    const font = (w, sz) => `${w} ${sz}px "Plus Jakarta Sans","Inter","Segoe UI",Arial,sans-serif`;
    const wrap = (text, maxW, f) => { x.font = f; const out = []; for (const para of String(text).split('\n')) { let line = '';
      for (const w of para.split(/(\s+)/)) { const t = line + w; if (x.measureText(t).width > maxW && line.trim()) { out.push(line.trim()); line = w.trimStart(); } else line = t; }
      out.push(line.trim()); } return out; };
    const q = qtyOf(o);
    const rows = [[kind === 'quote' ? 'Mã thanh toán' : 'Mã đơn', '#' + payCode(o)], [kind === 'quote' ? 'Ngày báo giá' : 'Ngày tạo', fmtTime(o.at)], o.customer?.name ? ['Khách hàng', o.customer.name] : null, ['Dịch vụ', o.displayName || o.items?.[0]?.name || 'Dịch vụ'],
      o.link ? ['Link', o.link] : null, ['Số lượng', q.toLocaleString('vi-VN')], kind === 'quote' ? ['Hạn thanh toán', fmtTime(o.expiresAt)] : null,
      kind === 'quote' && o.renewEnd ? ['Gói hiện tại hết hạn', fmtTime(o.renewEnd)] : null, o.termMonths && kind === 'quote' ? ['Thời hạn', o.termMonths + ' tháng'] : null,
      kind === 'paid' ? ['Đã thanh toán', money(o.paidAmount || orderSell(o))] : null, kind !== 'quote' && o.vipEnd ? ['Hạn sử dụng đến', fmtTime(o.vipEnd)] : null, ['Trạng thái', progressLine(o)]].filter(Boolean);
    const valW = W - P * 2 - 150, rowLines = rows.map(([, v]) => wrap(v, valW, font(600, 16)));
    const noteLinesW = inv.note ? wrap(inv.note.trim(), W - P * 2 - 24, font(500, 14)) : [];
    const hasPay = hasPayBlock(kind) && inv.acc;
    let H = 120 + 50 + rowLines.reduce((s, l) => s + l.length * 24 + 12, 0) + 90 + (hasPay ? 230 : 0) + (noteLinesW.length ? noteLinesW.length * 21 + 50 : 0) + 60;
    c.width = W * 2; c.height = H * 2; x.scale(2, 2);
    x.fillStyle = '#f3f1ff'; x.fillRect(0, 0, W, H);
    const card = (y, hgt) => { x.fillStyle = '#fff'; x.beginPath(); x.roundRect(P / 2, y, W - P, hgt, 18); x.fill(); };
    card(P / 2, H - P);
    // Đầu: ảnh + tên Page
    const grad = x.createLinearGradient(P / 2, 0, W - P / 2, 0); grad.addColorStop(0, '#6c5ce7'); grad.addColorStop(1, '#00b894');
    x.fillStyle = grad; x.beginPath(); x.roundRect(P / 2, P / 2, W - P, 100, [18, 18, 0, 0]); x.fill();
    if (logo) { x.save(); x.beginPath(); x.arc(P + 32, P / 2 + 50, 32, 0, Math.PI * 2); x.clip(); x.drawImage(logo, P, P / 2 + 18, 64, 64); x.restore(); }
    x.fillStyle = '#fff'; x.font = font(800, 24); x.fillText(shop.length > 34 ? shop.slice(0, 33) + '…' : shop, logo ? P + 80 : P, P / 2 + 46);
    x.font = font(600, 15); x.fillText(kind === 'quote' && o.renewOf ? 'GIA HẠN DỊCH VỤ · CHỜ THANH TOÁN' : KIND_HEAD[kind] || KIND_HEAD.new, logo ? P + 80 : P, P / 2 + 72);
    let y = P / 2 + 140;
    rows.forEach(([k], i) => { x.fillStyle = '#6b7280'; x.font = font(600, 14); x.fillText(k, P + 8, y);
      x.fillStyle = '#111827'; x.font = font(600, 16); rowLines[i].forEach((l, j) => x.fillText(l, P + 158, y + j * 24));
      y += rowLines[i].length * 24 + 12; });
    x.strokeStyle = '#e5e7eb'; x.beginPath(); x.moveTo(P + 8, y); x.lineTo(W - P - 8, y); x.stroke(); y += 40;
    const due = kind === 'quote' && o.paidAmount;
    x.fillStyle = '#6b7280'; x.font = font(700, 15); x.fillText(due ? 'CÒN PHẢI TRẢ' : kind === 'paid' ? 'ĐÃ THANH TOÁN' : 'THÀNH TIỀN', P + 8, y);
    x.fillStyle = kind === 'paid' ? '#00a37a' : '#6c5ce7'; x.font = font(800, 30); x.textAlign = 'right'; x.fillText(money(due ? amountDue(o) : kind === 'paid' ? (o.paidAmount || orderSell(o)) : orderSell(o)), W - P - 8, y + 4); x.textAlign = 'left'; y += 46;
    if (hasPay) {
      x.fillStyle = '#f8f7ff'; x.beginPath(); x.roundRect(P + 4, y, W - P * 2 - 8, 210, 14); x.fill();
      if (qr) x.drawImage(qr, P + 18, y + 14, 182, 182);
      const tx = qr ? P + 220 : P + 22; x.fillStyle = '#111827';
      [['Ngân hàng', bankName(inv.bin) || inv.bin], ['Số tài khoản', inv.acc], inv.holder ? ['Chủ tài khoản', inv.holder] : null, ['Nội dung CK', payCode(o)], ['Số tiền', money(amountDue(o))]].filter(Boolean)
        .forEach(([k, v], i) => { x.fillStyle = '#6b7280'; x.font = font(600, 13); x.fillText(k, tx, y + 36 + i * 36); x.fillStyle = '#111827'; x.font = font(700, 16); x.fillText(String(v), tx, y + 54 + i * 36); });
      y += 230;
    }
    if (noteLinesW.length) {
      x.fillStyle = '#fff7e6'; x.beginPath(); x.roundRect(P + 4, y, W - P * 2 - 8, noteLinesW.length * 21 + 34, 12); x.fill();
      x.fillStyle = '#8a5a00'; x.font = font(700, 14); x.fillText('📌 Lưu ý', P + 18, y + 24); x.font = font(500, 14);
      noteLinesW.forEach((l, i) => x.fillText(l, P + 18, y + 46 + i * 21)); y += noteLinesW.length * 21 + 50;
    }
    x.fillStyle = '#9ca3af'; x.font = font(600, 13); x.textAlign = 'center'; x.fillText('Cảm ơn quý khách! ' + shop, W / 2, H - P / 2 - 18);
    return { dataUrl: c.toDataURL('image/png'), qrMissing: hasPay && !qr };
  }
  async function invoiceDialog(o, kind = 'new') {
    const inv = (await settings()).invoice || {};
    const dlg = h('dialog', { className: 'svc-dialog svc-invoice', onclose: () => dlg.remove() });
    const text = h('textarea', { rows: 11, value: invoiceText(o, inv, kind) });
    const img = h('img', { alt: 'Ảnh hoá đơn', className: 'svc-inv-img' }), hint = h('div', { className: 'hint' }), withImg = h('input', { type: 'checkbox', checked: true });
    let image = '';
    const render = async () => { hint.textContent = 'Đang vẽ ảnh hoá đơn…'; const r = await invoiceImage(o, inv, kind); image = r.dataUrl; img.src = image;
      hint.textContent = [r.qrMissing ? 'Không tải được mã QR (kiểm tra mạng hoặc số tài khoản); đơn vẫn có thông tin chuyển khoản.' : '', !inv.acc && hasPayBlock(kind) ? 'Chưa có thông tin thanh toán: thêm ở Dịch vụ › Cài đặt › Hoá đơn gửi khách.' : ''].filter(Boolean).join(' '); };
    const openKey = App.inbox?.openKey?.() || '', canSend = o.customerKey && openKey === o.customerKey;
    const sendBtn = h('button', { type: 'button', className: 'btn btn-primary', textContent: '📨 Gửi vào hội thoại', disabled: !canSend,
      title: canSend ? 'Gửi chữ + ảnh vào hội thoại đang mở' : 'Mở hội thoại của khách này trong Hộp thư để gửi thẳng; hoặc Copy / Tải ảnh',
      onclick: async () => { sendBtn.disabled = true; sendBtn.textContent = 'Đang gửi…';
        const ok = await App.inbox.compose({ key: o.customerKey, text: text.value.trim(), image: withImg.checked ? image : '' });
        if (ok) { toast('Đã gửi đơn vào hội thoại.'); await markSent(o, kind); dlg.close(); } else { sendBtn.disabled = false; sendBtn.textContent = '📨 Gửi vào hội thoại'; toast('Hội thoại của khách không còn mở trong Hộp thư.', 5000); } } });
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: ({ quote: 'Gửi báo giá', paid: 'Báo khách đã nhận tiền', progress: 'Báo tiến độ' }[kind] || 'Gửi đơn cho khách') + ` · #${payCode(o)}` }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('div', { className: 'svc-inv-grid' },
        h('div', { className: 'field' }, 'Tin nhắn (sửa được)', text, h('label', { className: 'row', style: 'gap:6px;font-weight:500' }, withImg, 'Gửi kèm ảnh hoá đơn')),
        h('div', {}, img, hint)),
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' },
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: '📋 Copy chữ', onclick: () => navigator.clipboard.writeText(text.value).then(() => toast('Đã copy tin nhắn.')) }),
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: '🖼 Copy ảnh', onclick: async () => { try { const b = await (await fetch(image)).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Đã copy ảnh.'); } catch { toast('Không copy được ảnh, dùng Tải ảnh.', 5000); } } }),
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: '⬇ Tải ảnh', onclick: () => { const a = h('a', { href: image, download: `don-${payCode(o)}.png` }); a.click(); } }),
        sendBtn));
    document.body.append(dlg); dlg.showModal(); render();
  }
  // ── Đã nhận tiền → (lệch thì hỏi) → kiểm tra → bạn bấm tạo đơn Baostar ──
  function paymentDialog(q) {
    const dlg = h('dialog', { className: 'svc-dialog', onclose: () => dlg.remove() });
    const amt = h('input', { type: 'number', min: 0, step: 'any', value: amountDue(q), required: true });
    const note = h('input', { type: 'text', placeholder: 'Ghi chú (vd: CK lúc 19:05, Vietcombank)' });
    const msg = h('div', { className: 'svc-sum' }), acts = h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' });
    const record = async (state, extra = '') => {
      const add = Number(amt.value) || 0, total = (q.paidAmount || 0) + add;
      Object.assign(q, { paidAmount: total, paidAt: Date.now(), state, payNote: [q.payNote, note.value.trim(), extra].filter(Boolean).join(' · ') });
      await saveQuote(q); dlg.close(); App.tabs.services?.refresh?.();
      if (state === 'paid') confirmCreate(q); else { toast(`Đã ghi nhận ${money(add)}. Còn thiếu ${money(amountDue(q))}.`, 6000); invoiceDialog(q, 'quote'); }
    };
    const draw = () => {
      const add = Number(amt.value) || 0, total = (q.paidAmount || 0) + add, diff = Math.round(total - q.sell);
      msg.replaceChildren(h('span', {}, 'Khách phải trả ', h('strong', { textContent: money(q.sell) })), q.paidAmount ? h('span', {}, 'Đã nhận trước ', h('strong', { textContent: money(q.paidAmount) })) : null,
        h('span', {}, 'Tổng đã nhận ', h('strong', { textContent: money(total) })),
        diff ? h('span', { className: 'neg' }, diff < 0 ? `Thiếu ${money(-diff)}` : `Thừa ${money(diff)}`) : h('span', { className: 'status ok svc-pill', textContent: 'Đủ tiền' }));
      const cancel = h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: () => dlg.close() });
      acts.replaceChildren(cancel, ...(diff === 0 ? [h('button', { type: 'button', className: 'btn btn-primary', textContent: 'Xác nhận đủ tiền → kiểm tra & tạo đơn', onclick: () => record('paid') })]
        : diff < 0 ? [h('button', { type: 'button', className: 'btn btn-soft', textContent: 'Ghi nhận, chờ khách chuyển thêm', disabled: !add, onclick: () => record('quote') }),
          h('button', { type: 'button', className: 'btn btn-danger', textContent: `Vẫn lên đơn (thiếu ${money(-diff)})`, onclick: () => confirm(`Khách còn thiếu ${money(-diff)}. Vẫn coi là đã thanh toán và sang bước tạo đơn?`) && record('paid', `thiếu ${money(-diff)}`) })]
        : [h('button', { type: 'button', className: 'btn btn-primary', textContent: `Ghi nhận thừa ${money(diff)} → kiểm tra & tạo đơn`, onclick: () => confirm(`Khách chuyển thừa ${money(diff)}. App ghi chú số thừa để bạn xử lý (trả lại / trừ đơn sau). Tiếp tục?`) && record('paid', `thừa ${money(diff)}`) })]));
    };
    amt.oninput = draw;
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: `Đã nhận tiền · ${q.payCode}` }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('p', { className: 'hint', textContent: `${q.customer?.name || 'Khách'} · ${q.displayName} · ${qtyOf(q).toLocaleString('vi-VN')} · nội dung CK ${q.payCode}${expired(q) ? ' · báo giá đã quá hạn' : ''}` }),
      h('label', { className: 'field' }, 'Số tiền vừa nhận (đ)', amt), h('label', { className: 'field', style: 'margin-top:8px' }, 'Ghi chú', note), msg, acts);
    document.body.append(dlg); dlg.showModal(); draw(); amt.select();
  }
  async function confirmCreate(q) {
    const s = await settings();
    let list = []; try { list = await services(); } catch (e) { return toast(e.message, 7000); }
    const dlg = h('dialog', { className: 'svc-dialog', onclose: () => dlg.remove() });
    const opts = list.filter(x => stateOf(x)[1] !== 'err' || x.id === String(q.serviceId)).sort((a, b) => a.groupIndex - b.groupIndex || a.pos - b.pos || Number(a.id) - Number(b.id));
    const pick = h('select', {}, ...opts.map(x => h('option', { value: x.id, selected: x.id === String(q.serviceId), textContent: `MC ${x.id} · ${x.name} · ${m2(x.unitCost)}/đv${stateOf(x)[1] === 'err' ? ' · ' + stateOf(x)[0] : ''}` })));
    const checks = h('div', { className: 'svc-checks' }), err = h('div', { className: 'status err', hidden: true });
    const btn = h('button', { type: 'button', className: 'btn btn-primary', textContent: 'Tạo đơn Baostar' });
    let balance = null; call('balance').then(b => { balance = Number(b.balance); draw(); }).catch(e => { balance = e.message; draw(); });
    const svc = () => list.find(x => x.id === pick.value);
    const draw = () => {
      const x = svc(), n = qtyOf(q), now = x ? estCost(x, n) : 0, quoted = q.cost || 0;
      const [st, cls] = x ? stateOf(x) : ['Không còn máy chủ này', 'err'];
      const rows = [
        [cls === 'err' ? '✗' : '✓', `Máy chủ MC ${pick.value}: ${st}`, cls === 'err'],
        [x && n >= x.min && n <= x.max ? '✓' : '✗', `Số lượng ${n.toLocaleString('vi-VN')} (cho phép ${x?.min ?? '?'}–${x?.max ?? '?'})`, !(x && n >= x.min && n <= x.max)],
        [now > quoted * 1.001 && !q.costManual ? '!' : '✓', `Giá gốc bây giờ ≈ ${money(now)} (lúc báo giá ${money(quoted)}) · lãi ≈ ${money(q.sell - now)}${pct(q.sell, now)}`, q.sell - now < 0],
        [typeof balance === 'number' ? (balance >= now ? '✓' : '✗') : '…', typeof balance === 'number' ? `Số dư Baostar ${money(balance)}` : balance ? 'Không đọc được số dư: ' + balance : 'Đang đọc số dư…', typeof balance === 'number' && balance < now],
        ['💰', `Đã thu ${money(q.paidAmount)} / ${money(q.sell)}${q.payNote ? ' · ' + q.payNote : ''}`, false]];
      checks.replaceChildren(...rows.map(([ic, t, bad]) => h('div', { className: bad ? 'neg' : '' }, h('strong', { textContent: ic + ' ' }), t)));
      btn.disabled = cls === 'err' || !(x && n >= x.min && n <= x.max);
    };
    pick.onchange = draw;
    btn.onclick = async () => {
      const x = svc(), n = qtyOf(q); if (!x) return;
      if (!confirm(`Tạo đơn trên Baostar?\n\nMC ${x.id} · ${x.name}\nSố lượng: ${n.toLocaleString('vi-VN')}\nLink: ${q.link}\nBaostar sẽ trừ khoảng ${money(estCost(x, n))}.`)) return;
      btn.disabled = true; btn.textContent = 'Đang tạo đơn…'; err.hidden = true;
      try {
        const r = await call('add', { service: Number(x.id), link: q.link, quantity: n });
        if (r && !r.order) r.order = r.order_id ?? r.orderId ?? r.id;
        if (!r?.order) throw Error('Web dịch vụ không trả mã đơn.');
        const cost = q.costManual && String(x.id) === String(q.serviceId) ? q.cost : estCost(x, n);
        const order = { id: uid('ord'), at: Date.now(), updatedAt: Date.now(), source: 'service', provider: new URL(s.apiUrl).hostname, providerOrderId: String(r.order),
          payCode: q.payCode, quoteAt: q.at, paidAmount: q.paidAmount, paidAt: q.paidAt, payNote: q.payNote || '', listPrice: q.listPrice || 0,
          termMonths: q.termMonths || 0, vipEnd: q.termMonths ? addMonths(Date.now(), q.termMonths) : 0, renewOf: q.renewOf || '',
          serviceId: x.id, serviceName: x.name, displayName: q.displayName, packageId: q.packageId, link: q.link, customerKey: q.customerKey, pageKey: q.pageKey, pageName: q.pageName, pageAvatar: q.pageAvatar,
          customer: { name: q.customer?.name || '', phone: '', address: '' }, items: [{ name: q.displayName, qty: n, price: q.sell / n, cost: cost / n }], costManual: q.costManual,
          discount: 0, shipFee: 0, shipCost: 0, status: 'new', svcStatus: 'Pending', note: `Đơn dịch vụ #${r.order} · ${q.payCode}` };
        await DB.set(ORDERS, [...await DB.get(ORDERS, []), order]);
        await dropQuote(q.id);
        if (q.renewOf) { const all = await DB.get(ORDERS, []), old = all.find(o => o.id === q.renewOf); if (old) { old.renewedBy = order.id; await DB.set(ORDERS, all); } }
        if (q.customerKey) App.crm?.update?.(q.customerKey, { orderStatus: 'Đã đặt hàng' }).catch(() => {});
        dlg.close(); toast(`Đã tạo đơn Baostar #${r.order}.`, 5000);
        await refreshStatus([order]).catch(() => {});
        App.tabs.services?.refresh?.();
        invoiceDialog((await DB.get(ORDERS, [])).find(o => o.id === order.id) || order, 'paid');
      } catch (e2) {
        q.lastError = e2.message; await saveQuote(q); App.tabs.services?.refresh?.();
        err.textContent = 'Chưa tạo được đơn: ' + e2.message + ' · Báo giá vẫn ở trạng thái "Đã thu, chưa tạo đơn".'; err.hidden = false; btn.disabled = false; btn.textContent = 'Thử lại';
      }
    };
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: `Kiểm tra & tạo đơn · ${q.payCode}` }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('p', { className: 'hint', textContent: `${q.customer?.name || 'Khách'} · ${q.displayName} · ${q.link}` }),
      h('label', { className: 'field' }, 'Máy chủ (đổi được nếu máy chủ gốc bảo trì)', pick), checks, err,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end' }, h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Để sau', onclick: () => dlg.close() }), btn));
    document.body.append(dlg); dlg.showModal(); draw();
  }
  async function markSent(o, kind) {
    const field = kind === 'progress' ? 'progressSentAt' : kind === 'quote' ? 'sentAt' : 'invoiceSentAt';
    const store = kind === 'quote' ? QUOTES : ORDERS, all = await DB.get(store, []), x = all.find(y => y.id === o.id); if (!x) return;
    x[field] = Date.now(); await DB.set(store, all); App.tabs.services?.refresh?.();
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
    const links = linksIn(ctx.messages), qBox = h('div', { className: 'svc-inbox-quotes' });
    if (ctx.key) Promise.all([quotes(), DB.get(ORDERS, [])]).then(([qs, orders]) => { const mine = qs.filter(q => q.customerKey === ctx.key);
      const vips = orders.filter(o => o.customerKey === ctx.key && vipSoon(o));
      qBox.replaceChildren(...mine.map(q => { const [st, cls] = quoteState(q); return h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
        h('strong', { textContent: q.payCode }), h('span', { textContent: `${q.displayName} · ${money(q.sell)}` }), h('span', { className: 'status svc-pill ' + cls, textContent: st }), quoteActions(q)); }),
        ...vips.map(o => h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, h('strong', { textContent: '🔔 ' + (o.displayName || o.serviceName) }),
          h('span', { className: 'status svc-pill ' + (daysLeft(o) <= 1 ? 'err' : 'pending'), textContent: leftText(o) }), vipActions(o, qs)))); });
    return h('div', { className: 'svc-inbox' }, qBox,
      h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
        h('strong', { textContent: 'Dịch vụ' }),
        h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: '＋ Báo giá dịch vụ', onclick: () => createDialog(ctx, links[0] || '') })),
      links.length ? h('div', { className: 'svc-links' }, ...links.slice(0, 5).map(l => h('div', { className: 'row', style: 'gap:6px' },
        h('a', { href: l, target: '_blank', rel: 'noopener noreferrer', className: 'hint', textContent: l.length > 60 ? l.slice(0, 57) + '…' : l, title: l }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '📋 Copy', onclick: () => navigator.clipboard.writeText(l).then(() => toast('Đã copy link.')) }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Báo giá', onclick: () => createDialog(ctx, l) })))) : h('p', { className: 'hint', textContent: 'Chưa thấy link nào khách gửi trong hội thoại này.' }));
  }

  // ── Tab Dịch vụ ──
  const PERIODS = [['7d', '7 ngày'], ['30d', '30 ngày'], ['month', 'Tháng này'], ['all', 'Tất cả']];
  let period = '30d', q = '';
  const since = () => { const d = new Date(); if (period === '7d') return Date.now() - 7 * 864e5; if (period === '30d') return Date.now() - 30 * 864e5; if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return 0; };
  const quoteState = q => q.state === 'paid' ? ['Đã thu, chưa tạo đơn', 'err'] : expired(q) ? ['Hết hạn', 'pending'] : q.paidAmount ? ['Thiếu ' + money(amountDue(q)), 'pending'] : ['Chờ thanh toán', 'pending'];
  const quoteActions = q => h('div', { className: 'row', style: 'gap:4px;flex-wrap:wrap' },
    q.state === 'paid' ? h('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '🚀 Tạo đơn', onclick: () => confirmCreate(q) })
      : h('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '✅ Đã nhận tiền', onclick: () => paymentDialog(q) }),
    q.state === 'quote' ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: q.sentAt ? 'Đã gửi lúc ' + fmtTime(q.sentAt) : 'Gửi báo giá cho khách', textContent: q.sentAt ? '📤 Gửi lại' : '📤 Gửi', onclick: () => invoiceDialog(q, 'quote') }) : null,
    expired(q) ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '⏱ Gia hạn 24h', onclick: async () => { q.expiresAt = Date.now() + QUOTE_TTL; await saveQuote(q); App.tabs.services?.refresh?.(); } }) : null,
    h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Huỷ', onclick: async () => {
      if (!confirm(q.state === 'paid' || q.paidAmount ? `Huỷ báo giá ${q.payCode}? Khách đã chuyển ${money(q.paidAmount)}: nhớ hoàn tiền cho khách.` : `Huỷ báo giá ${q.payCode}?`)) return;
      await dropQuote(q.id); if (q.customerKey) App.crm?.update?.(q.customerKey, { orderStatus: '' }).catch(() => {}); App.tabs.services?.refresh?.(); } }));
  // ── VIP / dịch vụ có hạn: nhắc gia hạn (1 ngày trước + ngày hết hạn) ──
  const DAY = 864e5, startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const vipDue = o => o.source === 'service' && o.vipEnd && !o.renewedBy && !o.renewDismissed && o.status !== 'cancelled';
  const vipSoon = (o, now = Date.now()) => vipDue(o) && o.vipEnd - now <= 3 * DAY && now - o.vipEnd <= 14 * DAY;
  const daysLeft = o => Math.ceil((startOfDay(o.vipEnd) - startOfDay(Date.now())) / DAY);
  const leftText = o => { const d = daysLeft(o); return d > 1 ? `còn ${d} ngày` : d === 1 ? 'hết hạn ngày mai' : d === 0 ? 'hết hạn hôm nay' : `đã hết hạn ${-d} ngày`; };
  async function renewQuote(o) {
    const open = (await quotes()).find(q => q.renewOf === o.id);
    if (open) return invoiceDialog(open, 'quote');
    const now = Date.now(), q = await saveQuote({ id: uid('quo'), payCode: newPayCode(), at: now, expiresAt: now + QUOTE_TTL, state: 'quote', paidAmount: 0,
      link: o.link, qty: qtyOf(o), sell: Math.round(orderSell(o)), cost: Math.round((o.items?.[0]?.cost || 0) * qtyOf(o)), costManual: false, listPrice: o.listPrice || 0,
      termMonths: o.termMonths || 0, renewOf: o.id, renewEnd: o.vipEnd, displayName: o.displayName || o.items?.[0]?.name || 'Dịch vụ', packageId: o.packageId || '',
      serviceId: o.serviceId, serviceName: o.serviceName, customerKey: o.customerKey, pageKey: o.pageKey, pageName: o.pageName, pageAvatar: o.pageAvatar, customer: { name: o.customer?.name || '' } });
    App.tabs.services?.refresh?.();
    invoiceDialog(q, 'quote');
  }
  const vipActions = (o, qs) => { const pending = qs.find(q => q.renewOf === o.id);
    return h('div', { className: 'row', style: 'gap:4px;flex-wrap:wrap' },
      h('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: pending ? '📤 Gửi lại báo giá gia hạn' : '🔁 Gia hạn', onclick: () => renewQuote(o) }),
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Không gia hạn', onclick: async () => {
        const all = await DB.get(ORDERS, []), x = all.find(y => y.id === o.id); if (x) { x.renewDismissed = Date.now(); await DB.set(ORDERS, all); } App.tabs.services?.refresh?.(); } })); };
  function drawVip(orders, qs) {
    const box = $('svVip'); if (!box) return;
    const list = orders.filter(o => vipSoon(o)).sort((a, b) => a.vipEnd - b.vipEnd);
    box.hidden = !list.length;
    box.replaceChildren(h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: `🔔 Sắp hết hạn · cần nhắc gia hạn (${list.length})` })),
      h('div', { className: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Khách / Page', 'Dịch vụ', 'Hết hạn', 'Đã bán', ''].map(t => h('th', { textContent: t })))),
        h('tbody', {}, ...list.map(o => h('tr', {},
          h('td', {}, o.customer?.name || '—', h('div', { className: 'hint', textContent: App.pageById(o.pageKey)?.name || o.pageName || '' })),
          h('td', {}, o.displayName || o.serviceName, h('div', { className: 'hint', textContent: `${o.termMonths} tháng · MC ${o.serviceId}` })),
          h('td', { className: daysLeft(o) <= 1 ? 'neg' : '' }, fmtTime(o.vipEnd), h('div', { className: 'hint', textContent: leftText(o) })),
          h('td', { textContent: money(orderSell(o)) }), h('td', {}, vipActions(o, qs))))))));
  }
  // Nhắc 2 lần mỗi đơn: 1 ngày trước (≤ 24h) và ngày hết hạn. Đánh dấu trên đơn nên không nhắc lặp, kể cả mở lại app.
  async function vipTick() {
    const all = await DB.get(ORDERS, []), now = Date.now(); let changed = false;
    for (const o of all) {
      if (!vipDue(o)) continue;
      const who = `${o.customer?.name || 'Khách'} · ${o.displayName || o.serviceName}`;
      if (!o.remindDay0 && now >= startOfDay(o.vipEnd)) { o.remindDay0 = now; o.remindDay1 ||= now; changed = true; App.notify?.('🔔 Hết hạn hôm nay: ' + who, 'Mở tab Dịch vụ để gửi báo giá gia hạn.'); }
      else if (!o.remindDay1 && now >= o.vipEnd - DAY) { o.remindDay1 = now; changed = true; App.notify?.('🔔 Ngày mai hết hạn: ' + who, 'Mở tab Dịch vụ để gửi báo giá gia hạn.'); }
    }
    if (changed) { await DB.set(ORDERS, all); App.tabs.services?.refresh?.(); }
  }
  setTimeout(() => { vipTick().catch(() => {}); setInterval(() => vipTick().catch(() => {}), 15 * 60e3); }, 8000);
  function drawQuotes(qs) {
    const box = $('svQuotes'); if (!box) return;
    const rank = q => q.state === 'paid' ? 0 : expired(q) ? 2 : 1;
    const list = [...qs].sort((a, b) => rank(a) - rank(b) || b.at - a.at);
    box.replaceChildren(h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: 'Báo giá & chờ thanh toán' }),
        h('span', { className: 'hint', textContent: 'Khách trả tiền trước → bấm "Đã nhận tiền" → kiểm tra → tạo đơn Baostar.' })),
      list.length ? h('div', { className: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['Mã TT', 'Báo giá / hạn', 'Khách / Page', 'Dịch vụ', 'Link', 'SL', 'Khách trả', 'So với giá gói', 'Lãi dự kiến', 'Trạng thái', ''].map(t => h('th', { textContent: t })))),
        h('tbody', {}, ...list.map(q => { const [st, cls] = quoteState(q); return h('tr', { className: rank(q) === 2 ? 'svc-row off' : '' },
          h('td', {}, h('strong', { textContent: q.payCode })),
          h('td', {}, fmtTime(q.at), h('div', { className: 'hint', textContent: 'hạn ' + fmtTime(q.expiresAt) })),
          h('td', {}, q.customer?.name || '—', h('div', { className: 'hint', textContent: App.pageById(q.pageKey)?.name || q.pageName || '' })),
          h('td', {}, (q.renewOf ? '🔁 ' : '') + q.displayName, h('div', { className: 'hint', textContent: 'MC ' + q.serviceId + (q.termMonths ? ` · ${q.termMonths} tháng` : '') })),
          h('td', {}, q.link ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: q.link, textContent: '📋 Copy', onclick: () => navigator.clipboard.writeText(q.link).then(() => toast('Đã copy link.')) }) : ''),
          h('td', { textContent: qtyOf(q).toLocaleString('vi-VN') }),
          h('td', {}, money(q.sell), q.paidAmount ? h('div', { className: 'hint', textContent: 'đã nhận ' + money(q.paidAmount) }) : null),
          vsCell(q), h('td', { className: q.sell - q.cost < 0 ? 'neg' : '', textContent: money(q.sell - q.cost) }),
          h('td', {}, h('span', { className: 'status svc-pill ' + cls, textContent: st }), q.lastError ? h('div', { className: 'neg hint', textContent: q.lastError }) : null, q.payNote ? h('div', { className: 'hint', textContent: q.payNote }) : null),
          h('td', {}, quoteActions(q))); })))) : h('p', { className: 'hint', textContent: 'Chưa có báo giá nào đang chờ.' }));
  }
  App.tab('services', {
    mount(el) {
      el.append(
        h('div', { className: 'toolbar' },
          h('div', { className: 'chips', id: 'svPeriod' }), h('span', { className: 'grow' }),
          h('span', { className: 'hint', id: 'svBalance' }),
          h('button', { className: 'btn btn-ghost', textContent: '↻ Cập nhật trạng thái', onclick: async () => { try { toast(`Đã cập nhật ${await refreshStatus()} đơn.`); this.refresh(); } catch (e) { toast(e.message, 6000); } } }),
          h('button', { className: 'btn btn-ghost', textContent: '＋ Thêm đơn theo mã', title: 'Đơn đã tạo thẳng trên web dịch vụ: nhập mã đơn để app theo dõi giá gốc, trạng thái', onclick: () => importById() }),
          h('button', { className: 'btn btn-ghost', textContent: 'Mở web dịch vụ ↗', onclick: () => openWeb() }),
          h('button', { className: 'btn btn-primary', textContent: '＋ Báo giá', onclick: () => createDialog() })),
        h('div', { className: 'kpis', id: 'svKpis' }),
        h('div', { className: 'card', id: 'svVip', hidden: true }),
        h('div', { className: 'card', id: 'svQuotes' }),
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
      const qs = await quotes(), waiting = qs.filter(x => x.state === 'quote' && !expired(x));
      drawQuotes(qs); drawVip(await DB.get(ORDERS, []), qs);
      $('svKpis').replaceChildren(...[['Chờ thanh toán', `${waiting.length} · ${money(waiting.reduce((t, x) => t + amountDue(x), 0))}`], ['Đã thu, chưa tạo đơn', qs.filter(x => x.state === 'paid').length], ['Đơn', all.length], ['Đang chạy', running], ['So với giá gói', (d => (d > 0 ? '+' : '') + money(d))(all.reduce((t, o) => t + (vsList(o) || 0), 0))], ['Doanh thu', money(sum.revenue)], ['Giá gốc', money(sum.cost)], ['Lời', money(sum.profit)]]
        .map(([l, v]) => h('div', { className: 'kpi' }, h('div', { className: 'label', textContent: l }), h('div', { className: 'value', textContent: v }))));
      $('svOrders').replaceChildren(list.length ? h('table', {},
        h('thead', {}, h('tr', {}, ...['Tạo lúc', 'Khách / Page', 'Dịch vụ', 'Link', 'SL', 'Giá bán', 'So với giá gói', 'Giá gốc', 'Lời', 'Trạng thái', 'Hoàn thành', 'Gửi khách'].map(t => h('th', { textContent: t })))),
        h('tbody', {}, ...list.map(o => { const { sell, cost } = orderOf(o); return h('tr', {},
          h('td', { textContent: fmtTime(o.at) }),
          h('td', {}, o.customer?.name || '—', h('div', { className: 'hint', textContent: App.pageById(o.pageKey)?.name || '' })),
          h('td', {}, o.displayName || o.serviceName || '', h('div', { className: 'hint', textContent: `#${o.providerOrderId}${o.displayName ? ' · MC ' + o.serviceId : ''}` })),
          h('td', {}, o.link ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: o.link, textContent: '📋 Copy', onclick: () => navigator.clipboard.writeText(o.link).then(() => toast('Đã copy link.')) }) : ''),
          h('td', { textContent: (o.items?.[0]?.qty || 0).toLocaleString('vi-VN') }),
          h('td', { textContent: money(sell) }), vsCell(o), h('td', { textContent: money(cost) + (o.charge ? '' : ' ≈') }),
          h('td', { className: sell - cost < 0 ? 'neg' : '', textContent: money(sell - cost) }),
          h('td', {}, h('span', { className: 'status ' + (o.status === 'done' ? 'ok' : o.status === 'cancelled' ? 'err' : 'pending'), textContent: statusVi(o.svcStatus) }),
            o.vipEnd ? h('div', { className: 'hint' + (!o.renewedBy && o.vipEnd - Date.now() < 864e5 ? ' neg' : ''), textContent: o.renewedBy ? '🔁 đã gia hạn' : '🔔 hạn ' + fmtTime(o.vipEnd) }) : null),
          h('td', { textContent: o.completedAt ? fmtTime(o.completedAt) : '' }),
          h('td', {}, h('div', { className: 'row', style: 'gap:4px;flex-wrap:nowrap' },
            h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: o.invoiceSentAt ? 'Đã gửi đơn lúc ' + fmtTime(o.invoiceSentAt) : 'Xuất đơn gửi khách', textContent: o.invoiceSentAt ? '📤 ✓' : '📤 Đơn', onclick: () => invoiceDialog(o, o.payCode ? 'paid' : 'new') }),
            h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: o.progressSentAt ? 'Đã báo tiến độ lúc ' + fmtTime(o.progressSentAt) : 'Báo tiến độ cho khách', textContent: '📊', onclick: async () => { await refreshStatus([o]).catch(() => {}); const f = (await DB.get(ORDERS, [])).find(y => y.id === o.id) || o; invoiceDialog(f, 'progress'); } })))); }))) : h('div', { className: 'empty', textContent: 'Chưa có đơn dịch vụ trong khoảng này. Tạo đơn từ Hộp thư (nút "＋ Tạo đơn dịch vụ") hoặc nút ＋ Tạo đơn.' }));
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
    const markup = h('input', { type: 'number', min: 0, step: 'any', value: s.markup ?? 600, style: 'width:80px', title: '% lãi trên giá gốc' });
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
      for (const x of shown) if (x.unitCost > 0 && (!onlyEmpty || p[x.id] == null)) { p[x.id] = autoUnitPrice(x.unitCost, k); n++; }
      await saveSettings({ prices: p, markup: k }); toast(`Đã đặt giá cho ${n} dịch vụ (gốc + ${k}%).`); drawPrices();
    };
    const pkgBox = h('div', { className: 'svc-pkgs' }), invBox = h('div', { className: 'svc-inv-set' });
    const savePkgs = async list => saveSettings({ packages: list });
    const drawPkgs = async () => {
      let list = []; try { list = await services(); } catch { list = []; }
      list = [...list].sort((a, b) => a.groupIndex - b.groupIndex || a.pos - b.pos || Number(a.id) - Number(b.id));
      const st = await settings(); let pk = st.packages || [];
      // Lần đầu (chưa có gói, đã đọc web): tạo sẵn gói cho bạn chỉnh sau.
      if (!pk.length && !st.autoPkgDone && list.some(x => x.web)) {
        pk = suggestPackages(list, st, st.markup ?? 600);
        await saveSettings({ packages: pk, autoPkgDone: Date.now() });
        toast(`Đã tạo sẵn ${pk.length} gói từ Baostar. Kiểm tra lại tên, giá và máy chủ gốc.`, 7000);
      }
      const upd = async (id, change) => { const cur = (await settings()).packages || []; await savePkgs(cur.map(p => p.id === id ? { ...p, ...change } : p)); drawPkgs(); };
      const row = p => {
        const svc = list.find(x => x.id === String(p.serviceId)), base = svc?.unitCost || 0;
        const q = p.kind === 'fixed' ? Number(p.qty) || 0 : 1000, sell = p.kind === 'fixed' ? Number(p.price) || 0 : (Number(p.unitPrice) || 0) * 1000, cost = base * q;
        const sel = h('select', { style: 'max-width:340px', onchange: e => upd(p.id, { serviceId: e.target.value }) },
          h('option', { value: '', textContent: '— Chọn máy chủ gốc —' }),
          ...list.map(x => { const [st, cls] = stateOf(x); return h('option', { value: x.id, selected: x.id === String(p.serviceId), textContent: `MC ${x.id} · ${x.name} · ${m2(x.unitCost)}/đv${cls === 'err' ? ' · ' + st : ''}` }); }));
        return h('tr', {},
          h('td', {}, h('input', { type: 'text', value: p.name || '', placeholder: 'Tên gói (khách thấy)', style: 'min-width:170px', onchange: e => upd(p.id, { name: e.target.value.trim() }) })),
          h('td', {}, h('select', { onchange: e => upd(p.id, { kind: e.target.value }) }, h('option', { value: 'fixed', textContent: 'Cố định', selected: p.kind === 'fixed' }), h('option', { value: 'unit', textContent: 'Theo đơn vị', selected: p.kind === 'unit' }))),
          h('td', {}, p.kind === 'fixed' ? h('input', { type: 'number', min: 1, step: 1, value: p.qty ?? '', placeholder: 'Số lượng', style: 'width:100px', onchange: e => upd(p.id, { qty: Number(e.target.value) || 0 }) }) : h('span', { className: 'hint', textContent: 'Nhập khi tạo đơn' })),
          h('td', {}, p.kind === 'fixed'
            ? h('input', { type: 'number', min: 0, step: 'any', value: p.price ?? '', placeholder: 'Giá cả gói (đ)', style: 'width:120px', onchange: e => upd(p.id, { price: Number(e.target.value) || 0 }) })
            : h('input', { type: 'number', min: 0, step: 'any', value: p.unitPrice ?? '', placeholder: 'đ / đv', style: 'width:100px', onchange: e => upd(p.id, { unitPrice: Number(e.target.value) || 0 }) })),
          h('td', {}, sel, svc && stateOf(svc)[1] === 'err' ? h('div', { className: 'neg', textContent: 'Máy chủ gốc đang bảo trì: đổi máy chủ khác.' }) : !svc && p.serviceId ? h('div', { className: 'neg', textContent: 'Máy chủ gốc không còn trong danh sách.' }) : null),
          h('td', {}, h('input', { type: 'number', min: 0, step: 1, value: p.term ?? '', placeholder: svc ? `tự: ${termOf(svc)}` : 'tự nhận', title: 'Số tháng để nhắc gia hạn. Để trống = tự nhận theo máy chủ; 0 = không nhắc', style: 'width:80px', onchange: e => upd(p.id, { term: e.target.value }) })),
          h('td', { className: 'num' }, svc ? h('div', {}, money(cost), h('div', { className: 'hint', textContent: p.kind === 'fixed' ? 'gốc cả gói' : 'gốc / 1.000' })) : '—'),
          h('td', { className: 'num' + (sell - cost < 0 ? ' neg' : '') }, svc && sell ? money(sell - cost) + pct(sell, cost) : '—'),
          h('td', {}, h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Xoá', onclick: async () => { if (confirm(`Xoá gói "${p.name || 'chưa đặt tên'}"?`)) { await savePkgs(((await settings()).packages || []).filter(x => x.id !== p.id)); drawPkgs(); } } })));
      };
      pkgBox.replaceChildren(
        pk.length ? h('div', { className: 'scroll' }, h('table', { className: 'svc-table' }, h('thead', {}, h('tr', {}, ...['Tên gói', 'Kiểu', 'Số lượng', 'Giá bán', 'Máy chủ gốc', 'Theo tháng', 'Giá gốc', 'Lãi', ''].map(t => h('th', { textContent: t })))), h('tbody', {}, ...pk.map(row))))
          : h('p', { className: 'hint', textContent: 'Chưa có gói nào.' }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: 'margin:8px 8px 0 0', textContent: '⚡ Tạo sẵn gói còn thiếu từ Baostar', title: 'Mỗi loại dịch vụ 1 gói (tách VIP/thường, Việt/Tây), gắn máy chủ rẻ nhất; giá theo cột Giá của tôi hoặc gốc ×(1+%) làm tròn lên chục nghìn / 1.000 đv', onclick: async () => {
          const cur = await settings(), have = new Set((cur.packages || []).map(p => p.name));
          const add = suggestPackages(list, cur, cur.markup ?? 600).filter(p => !have.has(p.name));
          await savePkgs([...(cur.packages || []), ...add]); toast(add.length ? `Đã thêm ${add.length} gói.` : 'Không còn loại dịch vụ nào thiếu gói.'); drawPkgs(); } }),
        h('button', { type: 'button', className: 'btn btn-soft btn-sm', style: 'margin-top:8px', textContent: '＋ Thêm gói', onclick: async () => { await savePkgs([...((await settings()).packages || []), { id: uid('pkg'), name: '', kind: 'fixed', qty: 1000, price: 0, serviceId: '' }]); drawPkgs(); } }));
    };
    const drawInvoiceSettings = st => {
      const inv = st.invoice || {};
      const bin = h('select', {}, h('option', { value: '', textContent: '— Ngân hàng —' }), ...BANKS.map(([b, n]) => h('option', { value: b, textContent: n, selected: b === inv.bin })));
      const acc = h('input', { type: 'text', value: inv.acc || '', placeholder: 'Số tài khoản', autocomplete: 'off' });
      const holder = h('input', { type: 'text', value: inv.holder || '', placeholder: 'Tên chủ tài khoản (KHÔNG DẤU)' });
      const shop = h('input', { type: 'text', value: inv.shop || '', placeholder: 'Tên shop (đơn tạo ngoài Hộp thư)' });
      const note = h('textarea', { rows: 3, value: inv.note || '', placeholder: 'Lưu ý / bảo hành in trên đơn (vd: Đơn chạy trong 1–24 giờ. Bảo hành 30 ngày nếu tụt.)' });
      invBox.replaceChildren(
        h('p', { className: 'hint', textContent: 'Ảnh hoá đơn dùng tên và ảnh của Page khách đang nhắn. Mã QR VietQR tự điền số tiền và nội dung DV<mã đơn>; app tải ảnh QR từ img.vietqr.io (gửi số tài khoản, số tiền, nội dung lên đó).' }),
        h('div', { className: 'form-grid' }, h('label', { className: 'field' }, 'Ngân hàng', bin), h('label', { className: 'field' }, 'Số tài khoản', acc), h('label', { className: 'field' }, 'Chủ tài khoản', holder), h('label', { className: 'field' }, 'Tên shop dự phòng', shop)),
        h('label', { className: 'field', style: 'margin-top:10px' }, 'Lưu ý / bảo hành', note),
        h('button', { type: 'button', className: 'btn btn-primary btn-sm', style: 'margin-top:8px', textContent: 'Lưu thông tin hoá đơn', onclick: async () => {
          await saveSettings({ invoice: { bin: bin.value, acc: acc.value.replace(/\s+/g, ''), holder: holder.value.trim().toUpperCase(), shop: shop.value.trim(), note: note.value.trim() } }); toast('Đã lưu thông tin hoá đơn.'); } }));
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
        h('span', { className: 'hint', textContent: 'Giá của tôi = gốc +' }), markup, h('span', { className: 'hint', textContent: '% (giá 1.000 đv làm tròn lên chục nghìn)' }),
        h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: 'Điền cho dịch vụ chưa có giá', onclick: () => applyMarkup(true) }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Đặt lại tất cả đang lọc', onclick: () => { if (confirm(`Đặt lại giá của tôi cho ${shown.length} dịch vụ đang lọc = giá gốc + ${markup.value}%?`)) applyMarkup(false); } })),
      priceBox,
      h('h4', { className: 'card-title', style: 'margin:22px 0 6px', textContent: 'Gói bán của tôi' }),
      h('p', { className: 'hint', textContent: 'Gói là tên + giá bạn bán cho khách, gắn với một máy chủ gốc. Đổi máy chủ gốc bất cứ lúc nào (vd máy chủ cũ bảo trì); khách chỉ thấy tên gói.' }),
      pkgBox,
      h('h4', { className: 'card-title', style: 'margin:22px 0 6px', textContent: 'Hoá đơn gửi khách' }),
      invBox);
    if (s.apiKey) drawPrices(); else priceBox.replaceChildren(h('p', { className: 'hint', textContent: 'Nhập API key rồi Lưu để tải danh sách dịch vụ.' }));
    drawPkgs(); drawInvoiceSettings(s);
  }
  App.services = { createDialog, inboxBox, refreshStatus, linksIn, call, openWeb, mapStatus, catalogProgress, noteLines, speedOf, invoiceDialog, invoiceText, paymentDialog, confirmCreate, quotes, renewQuote, vipTick, termOf };
})();
