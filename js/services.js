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
  const creating = new Set(); // khoá trong bộ nhớ: mỗi báo giá chỉ một lượt tạo đơn tại một thời điểm
  const quotes = () => DB.get(QUOTES, []);
  let pingT = 0; const ping = () => { clearTimeout(pingT); pingT = setTimeout(() => App.inbox?.orderChanged?.(), 300); }; // báo Hộp thư vẽ lại thanh trạng thái đơn
  const saveQuote = async q => { q.updatedAt = Date.now(); const all = await quotes(), i = all.findIndex(x => x.id === q.id); if (i < 0) all.push(q); else all[i] = q; await DB.set(QUOTES, all); ping(); return q; };
  const dropQuote = async id => { await DB.set(QUOTES, (await quotes()).filter(x => x.id !== id)); ping(); };
  const expired = q => q.state === 'quote' && Date.now() > (q.expiresAt || Infinity);
  const newPayCode = () => 'DV' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
  const DEFAULTS = { home: 'https://smm.baostar.net', apiUrl: 'https://smm.baostar.net/api/v2', apiKey: '', prices: {}, usdRate: 27000 };
  // dichvu.baostar.net là hệ thống khác; key API thuộc smm.baostar.net → tự đổi cài đặt cũ.
  const settings = async () => { const s = { ...DEFAULTS, ...(await DB.get(SET, {})) };
    if (/^https?:\/\/dichvu\.baostar\.net/i.test(s.home)) { s.home = DEFAULTS.home; await DB.set(SET, s); }
    platIcons = s.platformIcons || {};
    return s; };
  let platIcons = {};
  const saveSettings = async change => DB.set(SET, { ...(await settings()), ...change });
  // Trạng thái của web dịch vụ → trạng thái đơn chung (Bán hàng chỉ tính tiền đơn done/returned).
  const FINAL = /^(completed|partial|canceled|cancelled|refunded)$/i;
  const mapStatus = s => /^(completed|partial)$/i.test(s) ? 'done' : /^(canceled|cancelled|refunded)$/i.test(s) ? 'cancelled' : /progress|processing/i.test(s) ? 'shipping' : 'new';
  const STATUS_VI = { pending: 'Chờ chạy', 'in progress': 'Đang chạy', processing: 'Đang xử lý', completed: 'Hoàn thành', partial: 'Hoàn thành một phần', canceled: 'Đã huỷ', cancelled: 'Đã huỷ', refunded: 'Đã hoàn tiền' };
  const statusVi = s => STATUS_VI[String(s || '').toLowerCase()] || s || 'Chờ chạy';

  // API key sai / hết hạn: báo rõ (dải cảnh báo ở tab Dịch vụ + thông báo máy tính 1 lần), tự tắt khi gọi API lại thành công.
  const KEY_BAD = /key|api ?key|unauthori[sz]ed|forbidden|invalid|không hợp lệ|hết hạn|expired|token|xác thực|authentication|401|403|không tồn tại|incorrect/i;
  let apiBad = '';
  function setApiBad(msg) {
    const was = apiBad; apiBad = msg || '';
    const box = $('svApiAlert');
    if (box) { box.hidden = !apiBad; box.replaceChildren(...(apiBad ? [h('strong', { textContent: '⚠ API key Baostar sai hoặc đã hết hạn' }), h('span', { textContent: ' · ' + apiBad + ' · ' }),
      h('button', { type: 'button', className: 'btn btn-sm btn-primary', textContent: 'Dán API key mới', onclick: () => document.querySelector('#svSettings input[type=password]')?.scrollIntoView({ block: 'center' }) || document.querySelector('#svSettings input[type=password]')?.focus() })] : [])); }
    if (apiBad && !was) { toast('⚠ API key Baostar sai hoặc đã hết hạn: ' + apiBad, 12000); App.notify?.('⚠ API key Baostar có vấn đề', apiBad); }
  }
  async function call(action, params = {}) {
    try { const r = await callRaw(action, params); if (apiBad) setApiBad(''); return r; }
    catch (e) { if (KEY_BAD.test(e.message) && !/CORS|Chưa nhập API key/.test(e.message)) setApiBad(e.message.replace(/^Web dịch vụ: /, '')); throw e; }
  }
  async function callRaw(action, params = {}) {
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
    if (!force && c?.origin === origin && c.list?.length) { if (Date.now() - c.at > 864e5) refreshServicesBg(); return c; } // cũ thì đọc lại web ngầm
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

  // Danh sách máy chủ: dùng bản đã lưu ngay (mở hộp tạo đơn không phải chờ); quá 1 ngày thì tải lại ngầm, lần mở sau có bản mới.
  let svcMemo = null, svcRefresh = null;
  async function fetchServices() {
    const raw = asList(await call('services'));
    if (!raw.length) throw Error('Web dịch vụ không trả về dịch vụ nào. Kiểm tra lại API key và URL API.');
    const list = raw.map(x => ({ id: String(x.service ?? x.id ?? x.service_id), name: String(x.name || ''), category: String(x.category || ''),
      rate: Number(x.rate ?? x.price) || 0, min: Number(x.min) || 1, max: Number(x.max) || 1e9, refill: !!x.refill, type: String(x.type || '') }));
    await DB.set(CACHE, { at: Date.now(), list }); svcMemo = null;
    return list;
  }
  const refreshServicesBg = () => svcRefresh ||= (async () => { try { await fetchServices(); await webCatalog(true); } catch {} finally { svcMemo = null; svcRefresh = null; } })();
  async function services(force = false) {
    if (!force && svcMemo && Date.now() - svcMemo.at < 60e3) return svcMemo.list;
    const c = await DB.get(CACHE, null);
    let list = c?.list;
    if (force || !list?.length) list = await fetchServices();
    else if (Date.now() - c.at > 864e5) refreshServicesBg();
    // Gộp thông tin web theo mã dịch vụ. Giá gốc = giá web (đ/1 đơn vị, đúng cấp tài khoản đang đăng nhập);
    // không có web thì lấy giá API (giá cho 1000 đơn vị) chia 1000.
    let cat = null; try { cat = await webCatalog(force); } catch (e) { catalogMsg = e.message; }
    const byId = new Map((cat?.list || []).map(w => [w.id, w]));
    const merged = list.map(x => { const w = byId.get(x.id);
      return { ...x, web: !!w, webChecked: !!cat, name: w?.name || x.name, category: w?.group || x.category, platform: w?.platform || '',
        notes: w?.notes || '', status: w?.status || '', avgTime: w?.avgTime || '', startTime: w?.startTime || '', refill: w ? w.refill : x.refill,
        min: w?.min || x.min, max: w?.max || x.max, unitCost: w?.rate || (x.rate ? x.rate / 1000 : 0), costFromWeb: !!w?.rate,
        groupIndex: w?.groupIndex ?? 999, pos: w?.pos ?? 0, parent: w?.parent || '', child: w?.child || '', labels: w?.labels || '', type: w?.type || x.type || '' }; });
    // Dịch vụ chỉ có trên web (API chưa liệt kê) vẫn hiện để xem ghi chú, giá.
    const ids = new Set(list.map(x => x.id));
    for (const w of cat?.list || []) if (!ids.has(w.id)) merged.push({ id: w.id, name: w.name, category: w.group, platform: w.platform, web: true, webChecked: true, webOnly: true,
      notes: w.notes, status: w.status, avgTime: w.avgTime, startTime: w.startTime, refill: w.refill, min: w.min || 1, max: w.max || 1e9, rate: 0, unitCost: w.rate, costFromWeb: true,
      groupIndex: w.groupIndex ?? 999, pos: w.pos ?? 0, parent: w.parent || '', child: w.child || '', labels: w.labels || '', type: w.type || '' });
    checkPrices(merged).catch(() => {});
    svcMemo = { at: Date.now(), list: merged };
    return merged;
  }
  // ── Báo giá gốc thay đổi: máy chủ đang dùng trong gói bán / bảng giá của bạn đổi giá (hoặc bị gỡ) → báo + ghi lại để kiểm tra giá bán ──
  const SNAP = 'svcCostSnapV1', ALERTS = 'svcPriceAlertsV1'; // SNAP { id: giá gốc/đv } · ALERTS [{ id, name, old, now, at, pkgs, gone }]
  async function checkPrices(list) {
    const s = await settings(), watch = new Set([...(s.packages || []).map(p => String(p.serviceId)), ...Object.keys(s.prices || {})].filter(Boolean));
    if (!watch.size || !list.length) return;
    const snap = await DB.get(SNAP, null), byId = new Map(list.map(x => [x.id, x])), next = { ...(snap || {}) };
    const alerts = await DB.get(ALERTS, []), fresh = [];
    for (const id of watch) {
      const x = byId.get(id), now = x ? Number(x.unitCost) || 0 : null, old = snap?.[id];
      if (now) next[id] = now;
      if (!snap || old == null) continue; // lần đầu chỉ ghi lại giá
      const gone = !x, changed = now && Math.abs(now - old) / old > 0.005;
      if (!gone && !changed) continue;
      if (gone) delete next[id];
      const pkgs = (s.packages || []).filter(p => String(p.serviceId) === id).map(p => p.name);
      const a = { id, name: x?.name || `Máy chủ ${id}`, old, now: now || 0, at: Date.now(), pkgs, gone, sell: s.prices?.[id] ?? null };
      const i = alerts.findIndex(y => y.id === id); if (i >= 0) { a.old = alerts[i].old; alerts.splice(i, 1); } // gộp các lần đổi chưa xem: giữ giá ban đầu
      if (!gone && Math.abs(a.now - a.old) / a.old <= 0.005) continue; // đổi rồi đổi lại như cũ
      alerts.unshift(a); fresh.push(a);
    }
    await DB.set(SNAP, next);
    if (!fresh.length) return;
    await DB.set(ALERTS, alerts.slice(0, 50));
    const one = fresh[0];
    App.notify?.(`⚠ Giá gốc dịch vụ thay đổi (${fresh.length})`, one.gone ? `${one.name}: web dịch vụ không còn máy chủ này.` : `${one.name}: ${m2(one.old)} → ${m2(one.now)}/đv${one.pkgs.length ? ' · gói ' + one.pkgs.join(', ') : ''}. Kiểm tra lại giá bán.`);
    if (App.current?.() === 'services') App.tabs.services?.refresh?.();
  }
  // Kiểm tra giá định kỳ khi app mở (6 giờ/lần), chỉ khi đã có API key.
  setInterval(async () => { try { if ((await settings()).apiKey) await services(true); } catch {} }, 6 * 3600e3);
  function priceAlertCard(alerts, s) {
    if (!alerts.length) return null;
    const pct2 = a => a.gone ? 'Không còn trên web' : `${a.now > a.old ? '+' : ''}${Math.round((a.now - a.old) / a.old * 1000) / 10}%`;
    return h('div', { className: 'card svc-price-alerts' },
      h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: `⚠ Giá gốc thay đổi · ${alerts.length} máy chủ` }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Đã kiểm tra hết', onclick: async () => { await DB.set(ALERTS, []); App.tabs.services.refresh(); } })),
      h('p', { className: 'hint', style: 'margin:0 0 6px', textContent: 'Máy chủ dùng trong gói bán / bảng giá của bạn vừa đổi giá gốc. Xem lại giá bán để không bán lỗ.' }),
      ...alerts.map(a => {
        const pk = (s.packages || []).filter(p => String(p.serviceId) === a.id);
        const margin = pk.map(p => { const q = p.kind === 'fixed' ? Number(p.qty) || 0 : 1000, sell = p.kind === 'fixed' ? Number(p.price) || 0 : (Number(p.unitPrice) || 0) * 1000;
          return `${p.name}: lãi ${money(sell - a.old * q)} → ${money(sell - a.now * q)}${p.kind === 'fixed' ? '' : ' /1000'}`; });
        return h('div', { className: 'svc-pa-row' + (a.now > a.old || a.gone ? ' up' : ' down') },
          h('div', { className: 'grow' }, h('strong', { textContent: `MC ${a.id} · ${a.name}` }),
            h('div', { className: 'hint', textContent: a.gone ? 'Web dịch vụ không còn máy chủ này: đổi máy chủ gốc cho gói.' : `${m2(a.old)} → ${m2(a.now)}/đv (${pct2(a)}) · ${fmtTime(a.at)}` }),
            margin.length ? h('div', { className: 'hint', textContent: margin.join(' · ') }) : a.sell != null ? h('div', { className: 'hint', textContent: `Giá bán bảng giá: ${m2(a.sell)}/đv → lãi ${m2(a.sell - a.now)}/đv` }) : null),
          h('span', { className: 'svc-pa-pct', textContent: pct2(a) }),
          h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Đã xem', onclick: async () => { await DB.set(ALERTS, (await DB.get(ALERTS, [])).filter(x => x.id !== a.id)); App.tabs.services.refresh(); } }));
      }));
  }
  // Giá gốc ước tính = giá gốc 1 đơn vị × số lượng. Giá thật lấy theo "charge" khi web đã nhận đơn.
  // Máy chủ bình luận/đánh giá: phải gửi nội dung (mỗi dòng 1 bình luận), số lượng = số dòng.
  const needsComments = svc => /custom comments?/i.test(svc?.type || '');
  const commentLines = t => String(t || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Bảo hành (refill): máy chủ có cờ refill trên web/API hoặc tên ghi "Bảo hành N ngày".
  const warrantyName = name => /bảo hành\s*\d+|\bbh\s*\d+/i.test(name || '') && !/không bảo hành|\bkbh\b/i.test(name || '');
  const REFILL_DONE = /^(completed|rejected|canceled|cancelled|error)$/i;
  const REFILL_VI = { pending: 'Chờ xử lý', 'in progress': 'Đang bù', processing: 'Đang bù', completed: 'Đã bù xong', rejected: 'Bị từ chối', canceled: 'Đã huỷ', cancelled: 'Đã huỷ' };
  const refillVi = st => REFILL_VI[String(st || '').toLowerCase()] || st || 'Chờ xử lý';
  async function requestRefill(o) {
    const last = o.refills?.[o.refills.length - 1];
    if (last && !REFILL_DONE.test(last.status || '')) return toast('Đơn này đang có yêu cầu bảo hành chưa xong.', 5000);
    if (!confirm(`Gửi yêu cầu bảo hành (bù số lượng tụt) cho đơn #${o.providerOrderId}?\n\n${o.displayName || o.serviceName}\nLink: ${o.link}`)) return;
    try {
      const r = await call('refill', { order: Number(o.providerOrderId) });
      const id = String(r?.refill ?? r?.id ?? r?.refill_id ?? '');
      if (!id || id === '0' || r?.error) throw Error(r?.error || 'Web dịch vụ không nhận yêu cầu bảo hành (máy chủ có thể không hỗ trợ hoặc chưa đến lúc bảo hành).');
      const all = await DB.get(ORDERS, []), x = all.find(y => y.id === o.id);
      if (x) { x.refills = [...(x.refills || []), { id, at: Date.now(), status: 'Pending' }]; await DB.set(ORDERS, all); }
      toast(`Đã gửi yêu cầu bảo hành (mã ${id}). App tự theo dõi kết quả.`, 6000);
      App.tabs.services?.refresh?.();
    } catch (e) { toast('Không gửi được bảo hành: ' + e.message, 8000); }
  }
  // Theo dõi các yêu cầu bảo hành chưa xong; xong/bị từ chối thì báo.
  async function refreshRefills() {
    const all = await DB.get(ORDERS, []); let changed = 0;
    for (const o of all) {
      const last = o.refills?.[o.refills.length - 1];
      if (!last || REFILL_DONE.test(last.status || '')) continue;
      try {
        const r = await call('refill_status', { refill: Number(last.id) || last.id });
        const st = String((Array.isArray(r) ? r[0]?.status : r?.status) || '');
        if (st && st !== last.status) { last.status = st; last.updatedAt = Date.now(); changed++;
          if (REFILL_DONE.test(st)) App.notify?.(`🛡 Bảo hành ${refillVi(st).toLowerCase()}: ${o.customer?.name || 'Khách'} · ${o.displayName || o.serviceName}`, `Đơn #${o.providerOrderId}`); }
      } catch {}
    }
    if (changed) await DB.set(ORDERS, all);
    return changed;
  }
  const estCost = (svc, qty) => svc ? (svc.unitCost || 0) * qty : 0;
  const num = v => Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  // Số tiền có thể ghi kiểu Việt "2.450.000" / "12.448" (dấu chấm ngăn nghìn), kiểu Anh "2,450,000.50" hoặc số thường "2450000.0000".
  // Số dư lấy từ API theo tài liệu Baostar: action=balance → { "balance": "343423", "currency": "VND" }.
  // Chỉ khi API ghi rõ currency "USD" mới đổi theo tỉ giá (mặc định 27.000đ/USD, sửa trong Cài đặt dịch vụ). API lỗi mới đọc số dư trên trang web.
  let webBal = null;
  async function vndBalance() {
    const s = await settings(), rate = Number(s.usdRate) || 27000;
    try {
      // Ưu tiên số dư VND: xin API trả theo VND (currency=VND); API vẫn trả tiền khác thì mới đổi / đọc web.
      let b = await call('balance', { currency: 'VND' }).catch(() => null);
      if (!b) b = await call('balance'); // web không nhận tham số currency → gọi như tài liệu
      const raw = b?.balance ?? b?.data?.balance ?? b?.money ?? b?.amount ?? b, cur = String(b?.currency || '').toUpperCase(), v = money0(raw);
      if (Number.isFinite(v)) {
        if (cur === 'USD') {
          // API chỉ có 2 số lẻ USD (1.87 ≈ 50.490đ, lệch tới ±135đ) → lấy đúng số VND trên web nếu đọc được, không thì hiện "≈".
          // Số dư web đọc từ trang đã chạy (mở ẩn vài giây) → nhớ 2 phút; số dư USD của API đổi thì đọc lại ngay.
          const fresh = webBal && webBal.usd === raw && Date.now() - webBal.at < 120e3;
          const w = fresh ? webBal.w : window.metaDesktop?.svcWebBalance && s.home ? await window.metaDesktop.svcWebBalance({ origin: s.home }).catch(() => null) : null, wv = w?.raw ? money0(w.raw) : NaN;
          if (w?.raw) webBal = { w, usd: raw, at: Date.now() };
          if (Number.isFinite(wv) && wv > 0) return { v: wv, src: 'web', note: `Số dư trên web: ${wv.toLocaleString('vi-VN')}đ · API: ${raw} USD × ${rate.toLocaleString('vi-VN')}đ ≈ ${Math.round(v * rate).toLocaleString('vi-VN')}đ` };
          return { v: Math.round(v * rate), approx: true, src: 'api', note: `API: ${raw} USD × ${rate.toLocaleString('vi-VN')}đ (gần đúng; đăng nhập web ở cột Dịch vụ để có số chính xác)` };
        }
        return { v, src: 'api', note: `API trả: ${JSON.stringify(b).slice(0, 120)}` };
      }
    } catch (e) { if (!window.metaDesktop?.svcWebBalance) throw e; }
    if (window.metaDesktop?.svcWebBalance && s.home) { const w = await window.metaDesktop.svcWebBalance({ origin: s.home }).catch(() => null);
      if (w?.raw) { const v = money0(w.raw); if (Number.isFinite(v)) return { v, src: 'web', note: 'Đọc từ trang web dịch vụ (API lỗi)' }; } }
    return { v: NaN, why: 'Không đọc được số dư' };
  }
  // Kiểm tra số dư: gọi API thật (như tài liệu, và xin VND), hiện NGUYÊN VĂN JSON Baostar trả (API key che bớt) + số đọc được trên web.
  async function balanceCheck() {
    const s = await settings(), out = h('pre', { className: 'svc-raw', textContent: 'Đang gọi API Baostar…' });
    const dlg = h('dialog', { className: 'svc-dialog', onclose: () => dlg.remove() }, h('h3', { className: 'card-title', textContent: '💰 Kiểm tra số dư Baostar' }),
      h('p', { className: 'hint', textContent: 'Đây là đúng dữ liệu Baostar trả về cho API key trong Cài đặt dịch vụ. Bấm "Sao chép" để gửi người hỗ trợ.' }), out,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:10px' },
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Sao chép', onclick: () => navigator.clipboard.writeText(out.textContent).then(() => toast('Đã sao chép.')) }),
        h('button', { type: 'button', className: 'btn btn-primary', textContent: 'Đóng', onclick: () => dlg.close() })));
    document.body.append(dlg); dlg.showModal();
    const lines = [`API: ${s.apiUrl} · key …${String(s.apiKey || '').slice(-4)}`];
    const raw = async body => { try { const r = window.metaDesktop?.svcApi ? await window.metaDesktop.svcApi({ url: s.apiUrl, body: { key: s.apiKey, ...body } })
        : await fetch(s.apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: s.apiKey, ...body }) }).then(async x => ({ status: x.status, json: await x.json() }));
      return r.error ? 'Lỗi: ' + r.error : `HTTP ${r.status} · ` + JSON.stringify(r.json); } catch (e) { return 'Lỗi: ' + e.message; } };
    lines.push('', '① action=balance (đúng tài liệu):', await raw({ action: 'balance' }));
    out.textContent = lines.join('\n');
    lines.push('', '② action=balance + currency=VND:', await raw({ action: 'balance', currency: 'VND' }));
    out.textContent = lines.join('\n');
    if (window.metaDesktop?.svcWebBalance && s.home) { const w = await window.metaDesktop.svcWebBalance({ origin: s.home }).catch(e => ({ error: e.message }));
      lines.push('', '③ Số dư trên web (' + s.home + '):', w?.raw ? w.raw + 'đ' : 'không đọc được (' + (w?.error || '?') + ')', ...(w?.all || []).map(a => `   · "${a.ctx}"`)); }
    out.textContent = lines.join('\n');
  }
  const money0 = v => { if (typeof v === 'number') return v; let t = String(v ?? '').replace(/[^0-9.,\-]/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
    else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
    else t = t.replace(/,/g, '');
    return Number(t); };
  const m2 = v => `${(Number(v) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`;
  const pct = (sell, cost) => cost > 0 ? ` (${Math.round((sell - cost) / cost * 100)}%)` : '';
  const orderOf = o => ({ sell: (o.items?.[0]?.price || 0) * (o.items?.[0]?.qty || 0), cost: (o.items?.[0]?.cost || 0) * (o.items?.[0]?.qty || 0) });

  // Link khách gửi trong hội thoại (Facebook, TikTok, Instagram, YouTube, Shopee… hoặc link bất kỳ).
  // Link khách gửi: CHỈ lấy từ tin của khách (tin của shop — báo giá, bài viết của Page — không tính), mới nhất trước.
  // Nhận cả link gõ không có https:// (facebook.com/…, fb.watch/…, tiktok.com/…, vt.tiktok.com/…, instagram.com/…, youtu.be/…).
  const LINK_RE = /(?:https?:\/\/[^\s<>"')]+)|(?:(?:www\.|m\.|web\.|vt\.|vm\.)?(?:facebook\.com|fb\.com|fb\.watch|fb\.me|tiktok\.com|instagram\.com|youtube\.com|youtu\.be|shopee\.vn|t\.me)\/[^\s<>"')]+)/gi;
  function linksIn(messages) {
    const out = [];
    const fromCustomer = m => m.isCustomer === true || m.mine === false || (m.isCustomer == null && m.mine == null && !m.fromPage);
    for (const m of messages || []) {
      if (!fromCustomer(m)) continue;
      for (const u of String(m.text || '').match(LINK_RE) || []) {
        let clean = u.replace(/[.,;!?…]+$/, '');
        if (!/^https?:\/\//i.test(clean)) clean = 'https://' + clean;
        if (!out.includes(clean)) out.push(clean);
      }
    }
    return out.reverse(); // mới nhất trước
  }
  // Chia chữ tin nhắn thành đoạn chữ và link (để hiện link bấm được + nút tạo đơn ngay sau link).
  function splitLinks(text) {
    const t = String(text || ''), out = []; let i = 0;
    for (const m of t.matchAll(LINK_RE)) { const raw = m[0].replace(/[.,;!?…]+$/, ''); if (m.index < i) continue;
      if (m.index > i) out.push(t.slice(i, m.index)); out.push({ raw, link: /^https?:\/\//i.test(raw) ? raw : 'https://' + raw }); i = m.index + raw.length; }
    if (i < t.length) out.push(t.slice(i));
    return out.length ? out : [t];
  }
  const platformOf = link => /tiktok/i.test(link) ? 'tiktok' : /instagram/i.test(link) ? 'instagram' : /youtu/i.test(link) ? 'youtube' : /shopee/i.test(link) ? 'shopee' : /t\.me|telegram/i.test(link) ? 'telegram' : /facebook|fb\.(com|watch|me)/i.test(link) ? 'facebook' : /threads\.(net|com)/i.test(link) ? 'threads' : /(^|\/\/|\.)(x|twitter)\.com/i.test(link) ? 'x' : /lazada/i.test(link) ? 'lazada' : '';

  // ── Tạo đơn (hộp thoại) ── ctx: { page, name, key } khi mở từ Hộp thư; link: link khách gửi.
  // Gói bán của tôi: { id, name, kind: 'fixed' (qty + price tổng) | 'unit' (unitPrice / đv), qty, price, unitPrice, serviceId }.
  // Dịch vụ có hạn (VIP theo tháng): số tháng lấy từ tên máy chủ con "( 2 tháng )", gói "1 tháng | Mua theo bài", nhóm Vip…; gói của bạn đặt tay được.
  const isVip = svc => /\bvip\b/i.test(`${svc?.name || ''} ${svc?.category || ''}`);
  function termOf(svc, pkg) {
    if (pkg && pkg.term !== undefined && pkg.term !== '') return Math.max(0, Number(pkg.term) || 0);
    // Chữ "vip" trong tên (vd "Mắt live … vip", "Mem vip nhanh") không có nghĩa là gói tháng.
    const m = String(svc?.name || '').match(/(\d+)\s*tháng/i);
    return m ? Number(m[1]) : /theo tháng/i.test(svc?.category || '') ? 1 : 0;
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
  // ── Bộ chọn dạng thẻ: lọc theo nền tảng (huy hiệu màu), tìm kiếm, nhóm nền tảng › loại, nhãn màu, giá nổi bật ──
  const PLAT = { Facebook: ['FB', '#1877f2'], TikTok: ['TT', '#0f172a'], Instagram: ['IG', '#d62976'], Youtube: ['YT', '#ff0000'], Shopee: ['SP', '#ee4d2d'],
    Google: ['GG', '#4285f4'], Telegram: ['TG', '#229ed9'], 'X-Twitter': ['X', '#000000'], Threads: ['TH', '#101010'], Lazada: ['LZ', '#0f146d'] };
  const LINK_PLAT = { facebook: 'Facebook', tiktok: 'TikTok', instagram: 'Instagram', youtube: 'Youtube', shopee: 'Shopee', telegram: 'Telegram', threads: 'Threads', x: 'X-Twitter', lazada: 'Lazada' };
  // Huy hiệu nền tảng: ảnh bạn tải trong Cài đặt dịch vụ › logo gắn sẵn trong app (img/platforms/svc/<tên>.png) › chữ tắt.
  const platSlug = p => String(p || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const platBadge = (p, size = 26) => { const [ab, c] = PLAT[p] || [String(p || '?').slice(0, 2).toUpperCase(), '#64748b'];
    const letters = () => h('span', { className: 'plat-badge', title: p || '', textContent: ab, style: `background:${c};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px` });
    if (platIcons[p]) return h('img', { className: 'plat-badge img', src: platIcons[p], alt: p, title: p, style: `width:${size}px;height:${size}px` });
    if (!p || noLogo.has(platSlug(p))) return letters();
    const sl = platSlug(p), exts = logoExt.has(sl) ? [logoExt.get(sl)] : ['webp', 'png'];
    const img = h('img', { className: 'plat-badge img', src: `img/platforms/svc/${sl}.${exts[0]}`, alt: p, title: p, draggable: false, style: `width:${size}px;height:${size}px` });
    let i = 0; img.onload = () => logoExt.set(sl, exts[i]);
    img.onerror = () => { if (++i < exts.length) { img.src = `img/platforms/svc/${sl}.${exts[i]}`; return; } noLogo.add(sl); img.replaceWith(letters()); };
    return img; };
  const noLogo = new Set(), logoExt = new Map(); // logo động (.webp) hoặc tĩnh (.png)
  // Nền tảng của đơn / báo giá: theo link khách, không có thì theo tên gói "Facebook · …".
  const platOfOrder = o => LINK_PLAT[platformOf(o?.link || o?.lines?.[0]?.link || '')] || (PLAT[String(o?.displayName || '').split(' · ')[0]] ? String(o.displayName).split(' · ')[0] : '');
  const TAGS = [[/\bvip\b/i, 'VIP', 'vip'], [/theo tháng|\d+\s*tháng/i, 'Theo tháng', 'month'], [/mua theo bài/i, 'Theo bài', 'month'], [/\b(việt|viet|vn)\b|việt nam/i, 'Việt', 'vn'],
    [/\b(tây|tay)\b/i, 'Tây', 'west'], [/không bảo hành|\bkbh\b/i, 'Không BH', 'nowarr'], [/bảo hành \d+|bảo hành 30|bh \d+/i, 'Bảo hành', 'warr'], [/cực nhanh|siêu tốc|siêu nhanh/i, 'Nhanh', 'fast']];
  const tagsOf = text => { const out = [], seen = new Set(); for (const [re, label, cls] of TAGS) if (re.test(text) && !seen.has(label)) { seen.add(label); out.push([label, cls]); } return out; };
  // items: [{ value, label, sub, platform, group, tags: [[label, cls]], price, warn, always, kids: [{ value, label, price }] }]
  // collapsible: đã chọn thì thu thành 1 dòng (bấm "Đổi" để mở danh sách), chọn xong tự thu lại.
  // Loại dịch vụ của 1 mục: "Facebook › Tăng like bài viết" → "Tăng like bài viết"; gói "TikTok · Tăng theo dõi · Việt" → "Tăng theo dõi".
  const typeOf = i => i.type || (String(i.group || '').includes('›') ? String(i.group).split('›').pop().trim() : '');
  // Đoán loại từ lời khách / tên: follow, like, view, bình luận, chia sẻ, thành viên nhóm, mắt live…
  const TYPE_HINTS = [[/follow|theo dõi|sub|đăng ký/i, /follow|theo dõi|sub|đăng ký/i], [/mắt|live|livestream/i, /mắt|live/i], [/view|lượt xem|\bxem\b/i, /view|xem/i],
    [/bình luận|comment|cmt/i, /bình luận|comment|cmt/i], [/chia sẻ|share/i, /chia sẻ|share/i], [/thành viên|mem/i, /thành viên|mem/i], [/like page|thích trang/i, /like page|fanpage|trang/i], [/like|thích|tim|cảm xúc/i, /like|thích|tim|cảm xúc/i]];
  function cardPicker({ items, value = '', onPick, plat = '', height = 320, placeholder = 'Tìm…', collapsible = false }) {
    let cur = value, pf = items.some(i => i.platform === plat) ? plat : '', tf = '', q = '', open = !collapsible;
    const find = v => { for (const i of items) { if (i.value === v) return [i, null]; const k = i.kids?.find(k => k.value === v); if (k) return [i, k]; } return [null, null]; };
    const chips = h('div', { className: 'cp-chips' }), types = h('div', { className: 'cp-chips cp-types' }), list = h('div', { className: 'cp-list', style: `max-height:${height}px` });
    const searchIn = h('input', { type: 'search', placeholder, oninput: e => { q = e.target.value; draw(); } });
    const step = (n, t, el) => h('div', { className: 'cp-step' }, h('span', { className: 'cp-step-no', textContent: n }), h('span', { className: 'cp-step-t', textContent: t }), el);
    const panel = h('div', { className: 'cp-panel' }, searchIn, step('1', 'Nền tảng', chips), step('2', 'Loại', types), step('3', 'Gói / máy chủ', list)), summary = h('div', { className: 'cp-sum-wrap' });
    const plats = [...new Set(items.map(i => i.platform).filter(Boolean))];
    const chip = (p, label, n) => h('button', { type: 'button', className: 'cp-chip' + (pf === p ? ' on' : ''), onclick: () => { pf = p; if (tf && !items.some(i => (!pf || i.platform === pf) && typeOf(i) === tf)) tf = ''; draw(); } },
      p ? platBadge(p, 16) : null, h('span', { textContent: label }), h('small', { textContent: n }));
    const choose = v => { cur = v; if (collapsible) open = false; draw(); onPick(v); };
    // Số lượt đã bán gói: gói hay dùng (top 5, từ 2 lượt) có ★ + số, gói khác chỉ số nhỏ.
    const useEl = i => i.uses ? h('span', { className: 'cp-uses' + (i.star ? ' star' : ''), title: `Đã dùng ${i.uses} lần`, textContent: (i.star ? '★ ' : '') + i.uses }) : null;
    const tagEls = i => [...(i.tags || []).map(([t, c]) => h('span', { className: 'cp-tag ' + c, textContent: t })), i.warn ? h('span', { className: 'cp-tag off', textContent: i.warn }) : null];
    const draw = () => {
      const [ci, ck] = find(cur);
      summary.replaceChildren(collapsible && ci ? h('button', { type: 'button', className: 'cp-current cp-sum', title: open ? 'Thu gọn' : 'Bấm để đổi', onclick: () => { open = !open; draw(); if (open) searchIn.focus(); } },
        ci.always ? h('span', { className: 'plat-badge any', textContent: '⚙' }) : platBadge(ci.platform, 22),
        h('span', { className: 'cp-main' }, h('span', { className: 'cp-line' }, h('span', { className: 'cp-title', textContent: ci.label + (ck ? ` · ${ck.label}` : '') }), useEl(ci)), ci.sub ? h('span', { className: 'cp-sub', textContent: ci.sub }) : null),
        (ck?.price || ci.price) ? h('span', { className: 'cp-price', textContent: ck?.price || ci.price }) : null,
        h('span', { className: 'cp-caret', textContent: open ? '▴ Thu gọn' : '▾ Đổi' })) : '');
      panel.hidden = collapsible && !open && !!ci;
      if (panel.hidden) return;
      chips.replaceChildren(chip('', 'Tất cả', items.filter(i => !i.always).length), ...plats.map(p => chip(p, p, items.filter(i => i.platform === p).length)));
      // Bước 2: loại dịch vụ của nền tảng đang chọn (ẩn nếu chỉ có 1 loại).
      const inPlat = items.filter(i => !i.always && (!pf || i.platform === pf)), tl = [...new Set(inPlat.map(typeOf).filter(Boolean))];
      types.parentElement.hidden = tl.length < 2;
      types.replaceChildren(h('button', { type: 'button', className: 'cp-chip' + (!tf ? ' on' : ''), onclick: () => { tf = ''; draw(); } }, h('span', { textContent: 'Tất cả loại' }), h('small', { textContent: inPlat.length })),
        ...tl.map(t => h('button', { type: 'button', className: 'cp-chip' + (tf === t ? ' on' : ''), onclick: () => { tf = t; draw(); } }, h('span', { textContent: t }), h('small', { textContent: inPlat.filter(i => typeOf(i) === t).length }))));
      const f = norm(q), shown = items.filter(i => i.always || ((!pf || i.platform === pf) && (!tf || typeOf(i) === tf) && (!f || norm(`${i.label} ${i.sub || ''} ${i.group || ''} ${(i.kids || []).map(k => k.label + ' ' + k.value).join(' ')}`).includes(f))));
      let last = null; const out = [];
      for (const i of shown) {
        if (!i.always && i.group && i.group !== last) { out.push(h('div', { className: 'cp-group' }, platBadge(i.platform, 14), h('span', { textContent: i.group }))); last = i.group; }
        const on = i.value === cur || i.kids?.some(k => k.value === cur);
        out.push(h('div', { className: 'cp-card' + (on ? ' on' : '') + (i.warn ? ' warn' : '') + (i.always ? ' always' : ''), role: 'button', tabIndex: 0,
          onclick: () => choose(i.value), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i.value); } } },
          i.always ? h('span', { className: 'plat-badge any', textContent: '⚙' }) : platBadge(i.platform, 22),
          h('span', { className: 'cp-main' },
            h('span', { className: 'cp-line' }, h('span', { className: 'cp-title', textContent: i.label }), useEl(i), ...tagEls(i)),
            i.sub ? h('span', { className: 'cp-sub', textContent: i.sub }) : null,
            i.kids?.length ? h('span', { className: 'cp-kids' }, ...[{ value: i.value, label: i.kidLabel || 'mặc định', price: i.price }, ...i.kids].map(k =>
              h('button', { type: 'button', className: 'cp-kid' + (k.value === cur ? ' on' : ''), title: k.price || '', textContent: k.label, onclick: e => { e.stopPropagation(); choose(k.value); } }))) : null),
          i.price ? h('span', { className: 'cp-price', textContent: (on && find(cur)[1]?.price) || i.price }) : null));
      }
      list.replaceChildren(...(out.length ? out : [h('div', { className: 'hint', style: 'padding:12px', textContent: 'Không có mục nào khớp.' })]));
      list.querySelector('.cp-card.on')?.scrollIntoView?.({ block: 'nearest' });
    };
    draw();
    // Tự chọn loại theo lời khách: chỉ khi có đúng loại khớp trong nền tảng đang chọn.
    const setType = text => { const hit = TYPE_HINTS.find(([re]) => re.test(String(text || ''))); if (!hit) return;
      const tl = [...new Set(items.filter(i => !i.always && (!pf || i.platform === pf)).map(typeOf).filter(Boolean))], t = tl.find(x => hit[1].test(x)); if (t && t !== tf) { tf = t; draw(); } };
    return { el: h('div', { className: 'cp' }, summary, panel), set: v => { cur = v; draw(); }, setType,
      setPlat: p => { if (items.some(i => i.platform === p) && p !== pf) { pf = p; if (tf && !items.some(i => i.platform === pf && typeOf(i) === tf)) tf = ''; draw(); } } };
  }
  const serverItem = x => { const [st, cls] = stateOf(x);
    return { value: x.id, label: x.name, sub: `MC ${x.id} · ${Number(x.min).toLocaleString('vi-VN')}–${Number(x.max).toLocaleString('vi-VN')} · gốc ${m2(x.unitCost)}/đv (${money(Math.round((x.unitCost || 0) * 1000))}/1000)`, platform: x.platform || '', group: [x.platform, x.category].filter(Boolean).join(' › '),
      tags: tagsOf(x.name), price: `${m2(x.unitCost)}/đv`, warn: cls === 'err' ? st : '' }; };
  // Máy chủ cha + cảm xúc / số tháng gộp 1 thẻ (chọn bằng nút nhỏ trong thẻ).
  const serverItems = arr => { const sorted = sortWeb(arr), ids = new Set(sorted.map(x => x.id));
    return sorted.filter(x => !x.parent || !ids.has(x.parent)).map(x => ({ ...serverItem(x), kidLabel: x.child || '',
      kids: sorted.filter(k => k.parent === x.id).map(k => ({ value: k.id, label: k.child || ('MC ' + k.id), price: `${m2(k.unitCost)}/đv` })) })); };
  const sortWeb = arr => [...arr].sort((a, b) => a.groupIndex - b.groupIndex || a.pos - b.pos || (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || Number(a.id) - Number(b.id));
  function pickServerDialog(list, current) {
    return new Promise(done => {
      const dlg = h('dialog', { className: 'svc-dialog svc-pickserver', onclose: () => { dlg.remove(); done(null); } });
      const p = cardPicker({ items: serverItems(list), value: String(current || ''), height: 460, placeholder: 'Tìm máy chủ (tên, mã MC)…',
        plat: list.find(x => x.id === String(current))?.platform || '', onPick: v => { done(v); dlg.onclose = () => dlg.remove(); dlg.close(); } });
      dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Chọn máy chủ gốc' }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })), p.el);
      document.body.append(dlg); dlg.showModal();
    });
  }
  // ── Đơn nhiều dịch vụ: báo giá có lines[] (mỗi dòng = 1 đơn Baostar). Báo giá cũ 1 dịch vụ → 1 dòng. ──
  const linesOf = q => q.lines?.length ? q.lines : [{ id: 'l1', serviceId: q.serviceId, serviceName: q.serviceName, link: q.link, qty: q.qty, comments: q.comments || '', sell: q.sell, cost: q.cost,
    costManual: q.costManual, displayName: q.displayName, packageId: q.packageId, listPrice: q.listPrice || 0, termMonths: q.termMonths || 0 }];
  const sumOf = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  // Cảm xúc: máy chủ cha + con là like/love/care…; mỗi cảm xúc là 1 mã máy chủ riêng → 1 đơn Baostar riêng.
  const REACTION = /^(like|love|care|haha|wow|sad|angry|thương thương|tim|thả tim)$/i;
  const reactionFamily = (list, svc) => { if (!svc) return []; const root = svc.parent ? list.find(x => x.id === svc.parent) : svc; if (!root) return [];
    const fam = [root, ...list.filter(x => x.parent === root.id)]; return fam.length > 1 && fam.every(x => REACTION.test(x.child || '')) ? fam : []; };
  const pkgCost = (pkg, list) => { const svc = list.find(x => x.id === String(pkg.serviceId)); return svc ? svc.unitCost : 0; };
  // Đoán dịch vụ + số lượng từ lời khách ("1k like", "500 follow", "2 nghìn view"): tin mới nhất trước.
  const GUESS = [['like', /^(like|lượt thích|thích|tim|thả tim)$/i, /like|thích|cảm xúc|reaction/],
    ['follow', /^(follow|fl|theo dõi|sub|subscriber|member|thành viên)$/i, /follow|theo dõi|sub|thành viên|member/],
    ['view', /^(view|lượt xem|mắt|xem)$/i, /view|xem|mắt/], ['share', /^(share|chia sẻ)$/i, /share|chia sẻ/],
    ['comment', /^(comment|cmt|bình luận)$/i, /comment|bình luận|cmt/]];
  function guessOrder(messages) {
    const said = (messages || []).filter(m => (m.isCustomer || m.mine === false) && m.text).map(m => String(m.text)).reverse().slice(0, 10);
    for (const t of said) for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn)?\s*(like|lượt thích|thích|thả tim|tim|follow|fl|theo dõi|subscriber|sub|member|thành viên|view|lượt xem|mắt|share|chia sẻ|comment|cmt|bình luận)/gi)) {
      const qty = Math.round(Number(m[1].replace(',', '.')) * (m[2] ? 1000 : 1)), g = GUESS.find(([, re]) => re.test(m[3]));
      if (qty > 0 && g) return { kind: g[0], match: g[2], qty, said: m[0].trim() };
    }
    return null;
  }
  // Đơn gần nhất của khách (để "Lặp lại đơn trước"): bản lưu lúc tạo báo giá, không có thì ghép từ các đơn đã tạo cùng mã thanh toán.
  async function lastOrderOf(key) {
    if (!key) return null;
    const saved = await DB.get('svcLast:' + key, null).catch(() => null);
    if (saved?.lines?.length) return saved;
    const mine = (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.customerKey === key).sort((a, b) => b.at - a.at);
    if (!mine.length) return null;
    const same = mine.filter(o => o.payCode && o.payCode === mine[0].payCode), use = same.length ? same : [mine[0]];
    return { at: mine[0].at, link: mine[0].link, lines: use.map(o => ({ serviceId: String(o.serviceId || o.items?.[0]?.serviceId || ''), serviceName: o.serviceName || '', displayName: o.displayName || o.serviceName || 'Dịch vụ',
      qty: qtyOf(o), sell: orderSell(o), cost: Number(o.cost ?? o.items?.[0]?.cost) || 0, link: o.link, packageId: o.packageId || '', termMonths: o.termMonths || 0, comments: o.comments || '', listPrice: 0 })).filter(l => l.serviceId) };
  }
  const closeDock = () => document.querySelectorAll('dialog.svc-dock').forEach(d => d.close());
  // Lưu báo giá mới (1 hoặc nhiều dòng; mỗi dòng = 1 đơn Baostar khi khách đã trả tiền). Dùng chung cho Tạo đơn và Tạo đơn hàng loạt.
  async function makeQuote(ctx, lines, mainLink, label = 'dịch vụ') {
    const first = lines[0], now = Date.now(), names = [...new Set(lines.map(l => l.displayName))];
    const q = await saveQuote({ id: uid('quo'), payCode: newPayCode(), at: now, expiresAt: now + QUOTE_TTL, state: 'quote', paidAmount: 0, lines,
      link: mainLink || first.link, qty: sumOf(lines, 'qty'), sell: sumOf(lines, 'sell'), cost: sumOf(lines, 'cost'), listPrice: sumOf(lines, 'listPrice'),
      costManual: lines.some(l => l.costManual), comments: first.comments, termMonths: Math.max(0, ...lines.map(l => l.termMonths || 0)),
      displayName: lines.length === 1 ? first.displayName : `${lines.length} ${label}: ${names.join(', ')}`.slice(0, 120), packageId: first.packageId, serviceId: first.serviceId, serviceName: first.serviceName,
      renewOf: ctx.renewOf || '', renewEnd: ctx.renewEnd || 0,
      customerKey: ctx.key || '', pageKey: ctx.page?.id || '', pageName: ctx.page?.name || '', pageAvatar: App.pageAvatarUrl(ctx.page) || '', customer: { name: ctx.name || '' } });
    if (ctx.key) App.crm?.update?.(ctx.key, { pageId: ctx.page?.id, pageName: ctx.page?.name, name: ctx.name, orderStatus: 'Chờ thanh toán' }).catch(() => {});
    if (ctx.key) DB.set('svcLast:' + ctx.key, { at: now, link: q.link, lines: lines.map(({ id, done, error, order, ...l }) => l) }).catch(() => {});
    App.inbox?.orderChanged?.();
    App.tabs.services?.refresh?.();
    return q;
  }

  // ── Tạo đơn hàng loạt: khách gửi nhiều link → 1 báo giá chung (mỗi link 1 dòng = 1 đơn Baostar; 1 QR, tổng tiền). ──
  // Link chưa lên đơn: chưa có trong đơn dịch vụ / báo giá 7 ngày qua. So link bỏ tham số theo dõi, giữ id / fbid / story_fbid / v.
  const linkKey = l => { try { const u = new URL(String(l).trim());
      const keep = [...u.searchParams].filter(([k]) => /^(id|story_fbid|fbid|v|set|multi_permalinks)$/i.test(k)).map(([k, v]) => k + '=' + v).sort().join('&');
      return (u.hostname.replace(/^(www|m|web|mbasic|vt|vm)\./i, '') + u.pathname.replace(/\/+$/, '') + (keep ? '?' + keep : '')).toLowerCase(); } catch { return String(l || '').trim().toLowerCase(); } };
  let orderedCache = null;
  async function orderedLinks() {
    if (orderedCache && Date.now() - orderedCache.at < 5000) return orderedCache.map;
    const since = Date.now() - 7 * 864e5, map = new Map();
    for (const o of await DB.get(ORDERS, []).catch(() => [])) if (o.source === 'service' && o.at > since && o.link) map.set(linkKey(o.link), `đơn #${o.providerOrderId || o.payCode || ''} (${fmtTime(o.at)})`);
    for (const q of await quotes().catch(() => [])) if (q.at > since && !expired(q)) for (const l of linesOf(q)) if (l.link) map.set(linkKey(l.link), `báo giá ${q.payCode} (${fmtTime(q.at)})`);
    orderedCache = { at: Date.now(), map }; return map;
  }
  // Loại việc đoán theo dạng link: bài viết → like, video / reel → view, trang cá nhân / kênh → follow, nhóm → thành viên.
  const KIND_RE = { like: /like|thích|cảm xúc|tim|reaction/, follow: /follow|theo dõi|sub|đăng ký|like page|thích trang/, member: /thành viên|mem|nhóm/, view: /view|xem|mắt/, share: /share|chia sẻ/, comment: /bình luận|comment|cmt/ };
  function linkKind(link) {
    const u = String(link || '').toLowerCase(), p = platformOf(link);
    if (p === 'facebook') { if (/\/groups\/[^/?#]+\/?($|[?#])/.test(u)) return 'member';
      if (/\/(videos?|reel|reels|watch)\b|fb\.watch|\/share\/(v|r)\//.test(u)) return 'view';
      if (/\/(posts|permalink|photos?|story\.php|share\/p)\b|fbid=|story_fbid|\/groups\/[^/]+\/(posts|permalink)/.test(u)) return 'like';
      return 'follow'; }
    if (p === 'tiktok') return /\/video\/|vt\.tiktok|vm\.tiktok|\/t\//.test(u) ? 'view' : 'follow';
    if (p === 'instagram') return /\/(p|reel|reels|tv)\//.test(u) ? 'like' : 'follow';
    if (p === 'youtube') return /watch|shorts|youtu\.be|\/live\//.test(u) ? 'view' : 'follow';
    if (p === 'threads') return /\/post\//.test(u) ? 'like' : 'follow';
    if (p === 'telegram') return 'member';
    return '';
  }
  const RX_ALL = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'];
  const RX_EMO = { like: '👍', love: '❤️', care: '🥰', haha: '😆', wow: '😮', sad: '😢', angry: '😡' }, RX_NAME = { like: 'Like', love: 'Love', care: 'Care', haha: 'Haha', wow: 'Wow', sad: 'Sad', angry: 'Angry' };
  const RX_KEY = t => { t = String(t || '').toLowerCase(); return /thương thương|care/.test(t) ? 'care' : /tim|love|yêu/.test(t) ? 'love' : /buồn|sad/.test(t) ? 'sad' : /phẫn nộ|angry/.test(t) ? 'angry' : /haha/.test(t) ? 'haha' : /wow/.test(t) ? 'wow' : /like|thích/.test(t) ? 'like' : t; };
  const RX_WEIGHT = { like: 50, love: 25, care: 10, haha: 8, wow: 4, sad: 2, angry: 1, tim: 25, 'thả tim': 25, 'thương thương': 10 };
  // Chip chọn nhiều cảm xúc (bấm bật / tắt, giữ ít nhất 1) + Chia đều / Tự nhiên. items: [[giá trị, nhãn]]. empty: cho phép không chọn (hàng Áp dụng).
  function rxChips(items, set, mode = 'deu', onChange, parts = null, empty = false) {
    set = new Set(set || []);
    const cnt = new Map((parts || []).map(([x, k]) => [x.id, k]));
    return h('div', { className: 'svc-rx' }, ...items.map(([v, label]) => { const on = set.has(v);
        return h('button', { type: 'button', className: 'svc-rx-chip' + (on ? ' on' : ''), 'aria-pressed': String(on), title: label + (cnt.has(v) ? ` · ${cnt.get(v).toLocaleString('vi-VN')}` : ''),
          onclick: () => { const n = new Set(set); if (n.has(v)) { if (n.size > 1 || empty) n.delete(v); } else n.add(v); onChange(n, mode); } },
          RX_EMO[RX_KEY(label)] || '•', cnt.has(v) ? h('small', { textContent: cnt.get(v) >= 1000 ? (cnt.get(v) / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'K' : cnt.get(v) }) : null); }),
      (set.size > 1 || empty) ? h('button', { type: 'button', className: 'svc-rx-mode', title: mode === 'tn' ? 'Tự nhiên: Like nhiều nhất, rồi Love, Care… như bài thật. Bấm để chia đều.' : 'Chia đều cho các cảm xúc đã chọn. Bấm để chia tự nhiên.',
        textContent: mode === 'tn' ? 'Tự nhiên' : 'Chia đều', onclick: () => onChange(set, mode === 'tn' ? 'deu' : 'tn') }) : null);
  }
  // Tạo / sửa gói ngay trong bảng tạo đơn: tên, kiểu (theo đơn vị / cố định), giá, số lượng, server gốc. Trả về gói đã lưu (hoặc null).
  function pkgDialog(list, { pkg = null, serviceId = '', unitPrice = 0, qty = 0, price = 0 } = {}) {
    return new Promise(done => {
      const cur = pkg || { id: uid('pkg'), name: '', kind: 'unit', serviceId, unitPrice, qty, price };
      let sid = String(cur.serviceId || serviceId || '');
      const svcOf = () => list.find(x => x.id === sid);
      const guessName = x => x ? [x.platform, String(x.category || x.name).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · ') : '';
      const name = h('input', { type: 'text', value: cur.name || guessName(svcOf()), placeholder: 'Tên gói hiện trên báo giá (vd TikTok · Tăng view)', required: true });
      const kindU = h('input', { type: 'radio', name: 'pkk', checked: cur.kind !== 'fixed' }), kindF = h('input', { type: 'radio', name: 'pkk', checked: cur.kind === 'fixed' });
      const unit = h('input', { type: 'number', min: 0, step: 'any', value: cur.unitPrice || '', placeholder: 'đ / 1 đơn vị' });
      const fq = h('input', { type: 'number', min: 1, step: 1, value: cur.qty || qty || 1000, placeholder: 'Số lượng' }), fp = h('input', { type: 'number', min: 0, step: 'any', value: cur.price || price || '', placeholder: 'Giá trọn gói (đ)' });
      const srvBtn = h('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: 'text-align:left' });
      const info = h('p', { className: 'hint' });
      const draw = () => { const x = svcOf(); srvBtn.textContent = x ? `⚙ Server ${x.id} · ${x.name}`.slice(0, 80) + ' ▾' : '⚙ Chọn server gốc ▾';
        unitBox.hidden = kindF.checked; fixBox.hidden = !kindF.checked;
        const cost = x ? kindF.checked ? estCost(x, Number(fq.value) || 0) : (x.unitCost || 0) : 0;
        info.textContent = x ? (kindF.checked ? `Giá gốc ≈ ${money(cost)} cho ${(Number(fq.value) || 0).toLocaleString('vi-VN')}` : `Giá gốc ≈ ${m2(cost)}/đv`) + (stateOf(x)[1] === 'err' ? ' · ⚠ server đang bảo trì' : '') : 'Chưa chọn server gốc.'; };
      srvBtn.onclick = async () => { const v = await pickServerDialog(list.filter(y => stateOf(y)[1] !== 'err' || y.id === sid), sid); if (v) { const auto = name.value === guessName(svcOf()); sid = v; if (auto || !name.value) name.value = guessName(svcOf()); draw(); } };
      const unitBox = h('label', { className: 'field' }, 'Giá bán / 1 đơn vị (đ)', unit), fixBox = h('div', { className: 'row', style: 'gap:8px' }, h('label', { className: 'field', style: 'flex:1' }, 'Số lượng', fq), h('label', { className: 'field', style: 'flex:1' }, 'Giá trọn gói (đ)', fp));
      for (const el of [kindU, kindF, fq, unit, fp]) el.oninput = draw;
      const dlg = h('dialog', { className: 'svc-dialog', onclose: () => { dlg.remove(); done(null); } });
      dlg.append(h('form', { method: 'dialog', onsubmit: async e => { e.preventDefault();
          if (!name.value.trim()) return toast('Nhập tên gói.', 3000); if (!sid) return toast('Chọn server gốc cho gói.', 3000);
          const next = { ...cur, name: name.value.trim(), serviceId: sid, kind: kindF.checked ? 'fixed' : 'unit', auto: false,
            ...(kindF.checked ? { qty: Math.round(Number(fq.value) || 0), price: Number(fp.value) || 0 } : { unitPrice: Number(unit.value) || 0 }) };
          if (next.kind === 'fixed' ? !(next.qty > 0 && next.price > 0) : !(next.unitPrice > 0)) return toast('Nhập giá bán (và số lượng nếu là gói cố định).', 3500);
          const all = (await settings()).packages || [], i = all.findIndex(p => p.id === next.id);
          await saveSettings({ packages: i >= 0 ? all.map(p => p.id === next.id ? next : p) : [...all, next] });
          toast(i >= 0 ? `Đã sửa gói "${next.name}".` : `Đã tạo gói "${next.name}".`, 3500);
          dlg.onclose = () => dlg.remove(); dlg.close(); done(next); } },
        h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: pkg ? '✎ Sửa gói' : '💾 Lưu thành gói' }),
          h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
        h('label', { className: 'field' }, 'Tên gói', name),
        h('div', { className: 'row', style: 'gap:14px' }, h('label', { className: 'row', style: 'gap:6px' }, kindU, 'Theo đơn vị'), h('label', { className: 'row', style: 'gap:6px' }, kindF, 'Cố định (vd 1000 like = 50k)')),
        unitBox, fixBox, h('label', { className: 'field' }, 'Server gốc', srvBtn), info,
        pkg ? h('p', { className: 'hint', textContent: 'Sửa gói áp cho các báo giá tạo sau; báo giá đã tạo giữ nguyên.' }) : null,
        h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end' }, h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: () => dlg.close() }),
          h('button', { className: 'btn btn-primary', textContent: pkg ? 'Lưu gói' : 'Tạo gói' }))));
      document.body.append(dlg); draw(); dlg.showModal(); name.focus();
    });
  }
  let bulkOpening = false;
  async function bulkDialog(ctx = {}, preset = []) {
    if (!ctx.headless) { if (bulkOpening) return; bulkOpening = true; } // bấm nhiều lần khi đang mở: không mở chồng nhiều hộp
    const slow = ctx.headless ? 0 : setTimeout(() => toast('Đang mở bảng tạo đơn…', 2500), 400);
    try { return await bulkDialogInner(ctx, preset); } finally { clearTimeout(slow); if (!ctx.headless) bulkOpening = false; }
  }
  async function bulkDialogInner(ctx = {}, preset = []) {
    const s = await settings();
    let list = []; try { list = await services(); } catch (e) { return ctx.headless ? { error: e.message } : toast(e.message, 7000); }
    const pkgs = s.packages || [], ok = svc => svc && stateOf(svc)[1] !== 'err';
    if (!pkgs.length && !Object.keys(s.prices || {}).length) toast('Chưa có gói bán: mỗi dòng phải chọn máy chủ trực tiếp. Tạo gói ở Dịch vụ › Cài đặt › Gói bán của tôi.', 7000);
    const svcOfPkg = pk => list.find(x => x.id === String(pk?.serviceId));
    const platOfPkg = pk => svcOfPkg(pk)?.platform || (PLAT[pk.name.split(' · ')[0]] ? pk.name.split(' · ')[0] : '');
    const uses = new Map(); for (const o of await DB.get(ORDERS, []).catch(() => [])) if (o.source === 'service' && o.packageId) uses.set(o.packageId, (uses.get(o.packageId) || 0) + 1);
    const ordered = await orderedLinks(), last = await lastOrderOf(ctx.key), guess = guessOrder(ctx.messages);
    const markup = Number(s.markup ?? 600);
    // Gói đoán cho 1 link: lời khách ("1k like") › gói khách dùng lần trước cùng nền tảng › dạng link. Ưu tiên gói hay bán, không phải gói theo tháng.
    const pickFor = link => {
      // Gợi ý AI (✨ trong Hộp thư): gói + số lượng AI đọc được từ tin khách, nếu gói còn bán.
      const hint = ctx.hint; if (hint?.pkgId && pkgs.some(p => p.id === hint.pkgId) && ok(svcOfPkg(pkgs.find(p => p.id === hint.pkgId))) && (!hint.links?.length || hint.links.some(l => linkKey(l) === linkKey(link))))
        return { pkgId: hint.pkgId, qty: Number(hint.qty) || 0, why: 'theo gợi ý AI' };
      const plat = LINK_PLAT[platformOf(link)] || '';
      const lastLine = last?.lines?.find(l => (LINK_PLAT[platformOf(l.link)] || '') === plat && pkgs.some(p => p.id === l.packageId) && ok(svcOfPkg(pkgs.find(p => p.id === l.packageId))));
      const lk = linkKind(link);
      // Lời khách ("1k like") chỉ áp cho link hợp loại: nhóm → thành viên, trang cá nhân / kênh → follow; không có gói hợp thì đoán theo dạng link.
      const fits = k => !lk || lk === k || (['like', 'view', 'share', 'comment'].includes(lk) && ['like', 'view', 'share', 'comment'].includes(k));
      const kinds = [...new Set([guess && fits(guess.kind) ? guess.kind : '', lk].filter(Boolean))];
      // Gói lần trước chỉ dùng lại khi hợp việc cần làm (vd lần trước follow trang cá nhân, lần này link bài viết → không dùng).
      if (lastLine && (!kinds.length || KIND_RE[kinds[0]].test(norm(lastLine.displayName))))
        return { pkgId: lastLine.packageId, qty: (guess && kinds[0] === guess.kind ? guess.qty : 0) || Number(lastLine.qty) || 0, why: 'như đơn trước của khách' };
      for (const kind of kinds) {
        const re = KIND_RE[kind], pk = pkgs.filter(pk => (!plat || norm(platOfPkg(pk)) === norm(plat)) && re.test(norm(pk.name)) && ok(svcOfPkg(pk))
          && !(kind === 'like' && /like page|thích trang|fanpage/.test(norm(pk.name))))
          .sort((a, b) => (uses.get(b.id) || 0) - (uses.get(a.id) || 0) || termOf(svcOfPkg(a), a) - termOf(svcOfPkg(b), b) || (svcOfPkg(a)?.unitCost || 0) - (svcOfPkg(b)?.unitCost || 0))[0];
        if (pk) return { pkgId: pk.id, qty: guess && kind === guess.kind ? guess.qty : 0, why: guess && kind === guess.kind ? `theo tin khách “${guess.said}”` : 'theo dạng link' };
      }
      return { pkgId: '', qty: 0, why: '' };
    };
    const rows = [];
    const addLink = (link, on = true) => { link = String(link || '').trim(); if (!link) return false; if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
      if (rows.some(r => linkKey(r.link) === linkKey(link))) return false;
      rows.push({ id: uid('bl'), link, on, svcId: '', sell: null, ...pickFor(link) }); return true; };
    for (const l of preset) addLink(l);
    // Thêm 1 dịch vụ nữa cho cùng link: dòng mới ngay dưới các dòng của link đó (mỗi dòng 1 đơn Baostar, giá riêng).
    const addService = (link, at) => { let i = at ?? rows.map(r => linkKey(r.link)).lastIndexOf(linkKey(link)); const r = { id: uid('bl'), link, on: true, svcId: '', pkgId: '', qty: 0, sell: null, why: '', extra: true };
      rows.splice(i + 1, 0, r); return r; };
    // Dòng → số liệu: gói cố định (số lượng + giá theo gói), gói theo đơn vị, hoặc máy chủ trực tiếp (giá của tôi / gốc + % lãi).
    const calc = r => {
      const pk = pkgs.find(p => p.id === r.pkgId), svc = pk ? svcOfPkg(pk) : list.find(x => x.id === r.svcId);
      let qty = pk?.kind === 'fixed' ? Number(pk.qty) || 0 : Math.round(Number(r.qty) || 0);
      if (!qty && svc) qty = Math.min(Math.max(1000, Number(svc.min) || 1), Number(svc.max) || 1000);
      const unitSell = pk ? (pk.kind === 'fixed' ? 0 : Number(pk.unitPrice) || 0) : svc ? (s.prices[svc.id] ?? autoUnitPrice(svc.unitCost, markup)) : 0;
      const autoSell = pk?.kind === 'fixed' ? Number(pk.price) || 0 : Math.round(unitSell * qty);
      const sell = r.sell != null ? Number(r.sell) || 0 : autoSell;
      // Cảm xúc (máy chủ có like / love / care…): chọn nhiều loại, mỗi loại 1 đơn Baostar; tổng số lượng chia đều hoặc tự nhiên.
      const fam = svc ? reactionFamily(list, svc) : [];
      let parts = null;
      if (fam.length) { if (!r.reacts?.size || ![...r.reacts].some(id => fam.some(x => x.id === id))) r.reacts = new Set([svc.id]);
        const ids = fam.filter(x => r.reacts.has(x.id)), w = ids.map(x => r.rmode === 'tn' ? RX_WEIGHT[String(x.child).toLowerCase()] || 5 : 1), W = w.reduce((a, b) => a + b, 0);
        const ks = ids.map((x, i) => Math.floor(qty * w[i] / W)); let rest = qty - ks.reduce((a, b) => a + b, 0); for (let i = 0; rest > 0; i = (i + 1) % ks.length, rest--) ks[i]++;
        parts = ids.map((x, i) => [x, ks[i]]); }
      const cost = Math.round(parts ? parts.reduce((t, [x, k]) => t + estCost(x, k), 0) : estCost(svc, qty));
      const lowRx = parts?.find(([x, k]) => k < x.min);
      const listPrice = pk ? autoSell : svc && s.prices[svc.id] != null ? Math.round(s.prices[svc.id] * qty) : 0;
      const lp = LINK_PLAT[platformOf(r.link)] || '', sp = svc?.platform || (pk ? platOfPkg(pk) : '');
      const error = !/^https?:\/\/\S+\.\S+/i.test(r.link) ? 'Link không hợp lệ' : !svc ? (pk ? 'Máy chủ gốc của gói không còn' : 'Chọn gói / server') : stateOf(svc)[1] === 'err' ? 'Máy chủ đang bảo trì'
        : needsComments(svc) ? 'Máy chủ cần nội dung bình luận: tạo riêng bằng nút Tạo đơn' : lowRx ? `${lowRx[0].child}: ${lowRx[1]} dưới mức tối thiểu ${lowRx[0].min}`
        : !parts && (qty < svc.min || qty > svc.max) ? `Số lượng ${Number(svc.min).toLocaleString('vi-VN')}–${Number(svc.max).toLocaleString('vi-VN')}` : !(sell > 0) ? 'Nhập tiền khách trả' : '';
      const dup = svc && rows.some(o => o !== r && o.on && rows.indexOf(o) < rows.indexOf(r) && linkKey(o.link) === linkKey(r.link) && (o.pkgId ? o.pkgId === r.pkgId : o.svcId && o.svcId === r.svcId));
      const warns = [lp && sp && norm(lp) !== norm(sp) ? `Link ${lp}, dịch vụ ${sp}` : '', ordered.get(linkKey(r.link)) ? 'Đã có ' + ordered.get(linkKey(r.link)) : '', dup ? 'Trùng dịch vụ với dòng trên của cùng link' : ''].filter(Boolean);
      return { pk, svc, qty, sell, cost, listPrice, error, warns, fixed: pk?.kind === 'fixed', fam, parts };
    };
    const toLines = on => on.flatMap(([r, c]) => { const label = c.pk?.name || c.svc.category || 'Dịch vụ', base = { link: r.link, costManual: false, packageId: c.pk?.id || '', termMonths: termOf(c.svc, c.pk), comments: '' };
        if (!c.parts || c.parts.length < 2) { const [x] = c.parts?.[0] || [c.svc];
          return [{ ...base, id: uid('ln'), serviceId: x.id, serviceName: x.name, ...(c.parts ? { reaction: x.child } : {}), qty: c.qty, sell: c.sell, cost: c.cost, listPrice: c.listPrice, displayName: c.parts && x.id !== c.svc.id ? `${label} (${x.child})` : label }]; }
        // Nhiều cảm xúc: mỗi loại 1 dòng (1 đơn Baostar), chia tiền khách trả / giá gói theo số lượng.
        let restS = c.sell, restL = c.listPrice;
        return c.parts.map(([x, k], i) => { const last = i === c.parts.length - 1, sl = last ? restS : Math.round(c.sell * k / c.qty), lp = last ? restL : Math.round(c.listPrice * k / c.qty); restS -= sl; restL -= lp;
          return { ...base, id: uid('ln'), serviceId: x.id, serviceName: x.name, reaction: x.child, qty: k, sell: sl, cost: Math.round(estCost(x, k)), listPrice: lp, displayName: `${label} (${x.child})` }; }); });
    // Không mở hộp (điều khiển qua Telegram): đoán gói + số lượng như hộp tạo đơn, trả về xem trước + hàm tạo báo giá.
    if (ctx.headless) {
      const on = rows.map(r => [r, calc(r)]), bad = on.filter(([, c]) => c.error);
      const sum = on.map(([r, c]) => `${shortLink(r.link)} · ${c.pk?.name || c.svc?.name || '?'} · ${Number(c.qty || 0).toLocaleString('vi-VN')}${c.sell ? ' = ' + money(c.sell) : ''}${c.error ? ' ✗ ' + c.error : ''}`);
      if (!on.length) return { error: 'Chưa có link.' };
      if (bad.length) return { error: 'Cần sửa: ' + bad.map(([r, c]) => `${shortLink(r.link)}: ${c.error}`).join(' · '), summary: sum };
      const lines = toLines(on);
      return { summary: sum, total: sumOf(lines, 'sell'), warns: on.flatMap(([, c]) => c.warns), make: async () => { const q = await makeQuote(ctx, lines, lines[0].link, 'link'); orderedCache = null; App.inbox?.bulkDone?.(lines.map(l => l.link)); return q; } };
    }
    const dlg = h('dialog', { className: 'svc-dialog svc-bulk', onclose: () => dlg.remove() });
    const body = h('tbody'), sum = h('div', { className: 'svc-sum' }), err = h('div', { className: 'status err', hidden: true });
    // Ô chọn gói: gói cùng nền tảng của link trước, rồi gói khác; cuối cùng "Máy chủ trực tiếp…".
    const pkgSelect = (plat, value, onchange, any = false) => {
      const same = pkgs.filter(pk => !plat || norm(platOfPkg(pk)) === norm(plat)), other = pkgs.filter(pk => !same.includes(pk));
      const opt = pk => { const svc = svcOfPkg(pk); return h('option', { value: pk.id, selected: pk.id === value,
        textContent: `${pk.name}${pk.kind === 'fixed' ? ` · ${Number(pk.qty).toLocaleString('vi-VN')} = ${money(pk.price)}` : ` · ${m2(pk.unitPrice)}/đv`}${!svc ? ' · thiếu máy chủ' : !ok(svc) ? ' · bảo trì' : ''}` }); };
      return h('select', { onchange },
        h('option', { value: '', textContent: any ? '— Chọn gói / server áp dụng —' : '— Chọn gói / server —', selected: !value }),
        h('option', { value: '__svc', textContent: '⚙ Chọn server Baostar trực tiếp…' }),
        ...(same.length && other.length ? [h('optgroup', { label: plat ? `Gói ${plat}` : 'Gói' }, ...same.map(opt)), h('optgroup', { label: 'Gói nền tảng khác' }, ...other.map(opt))] : pkgs.map(opt)),
        );
    };
    const draw = () => {
      body.replaceChildren(...rows.map((r, i) => { const c = calc(r), plat = LINK_PLAT[platformOf(r.link)] || '';
        const sel = pkgSelect(plat, r.pkgId, async e => { const v = e.target.value;
          if (v === '__keep') return;
          if (v === '__svc') { const pickd = await pickServerDialog(list.filter(ok), r.svcId || c.svc?.id); if (pickd) { r.svcId = pickd; r.pkgId = ''; } }
          else { r.pkgId = v; r.svcId = ''; }
          r.sell = null; draw(); });
        if (!r.pkgId && r.svcId) { sel.querySelector('option[value=""]').selected = false; sel.prepend(h('option', { value: r.svcId ? '__keep' : '', selected: true, textContent: `⚙ Server ${r.svcId} · ${c.svc?.name || ''}`.slice(0, 70) })); }
        return h('tr', { className: (r.on ? '' : 'off') + (r.on && c.error ? ' bad' : '') },
          h('td', {}, h('input', { type: 'checkbox', checked: r.on, title: 'Tạo đơn cho link này', onchange: e => { r.on = e.target.checked; draw(); } })),
          h('td', { className: 'svc-bulk-link' }, ...(i > 0 && linkKey(rows[i - 1].link) === linkKey(r.link)
            ? [h('span', { className: 'hint svc-bulk-same', title: r.link, textContent: '↳ cùng link trên' })]
            : [plat ? platBadge(plat, 18) : h('span', { className: 'plat-badge any', textContent: '?' }),
              h('input', { type: 'text', value: r.link, title: r.link, onchange: e => { const old = linkKey(r.link); r.link = e.target.value.trim(); for (const o of rows) if (o !== r && linkKey(o.link) === old) o.link = r.link; draw(); } })]),
            rows[i + 1] && linkKey(rows[i + 1].link) === linkKey(r.link) ? null
              : h('button', { type: 'button', className: 'btn btn-ghost btn-sm svc-bulk-addsvc', title: 'Thêm 1 dịch vụ nữa cho link này (thêm 1 dòng, 1 đơn riêng)', textContent: '＋ Dịch vụ', onclick: () => { addService(r.link, i); draw(); } })),
          h('td', {}, h('div', { className: 'row svc-bulk-pick', style: 'gap:6px;flex-wrap:nowrap' }, sel,
            c.pk ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '✎', title: 'Sửa gói này (tên, giá, kiểu, server gốc)', onclick: async () => {
                const v = await pkgDialog(list, { pkg: c.pk }); if (v) { pkgs.splice(pkgs.findIndex(p => p.id === v.id), 1, v); for (const o of rows) if (o.pkgId === v.id) o.sell = null; draw(); } } })
            : c.svc && r.svcId ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '💾 Lưu thành gói', title: 'Lưu server này thành gói để lần sau chọn nhanh', onclick: async () => {
                const u = c.qty ? Math.round(c.sell / c.qty * 100) / 100 : 0;
                const v = await pkgDialog(list, { serviceId: c.svc.id, unitPrice: u, qty: c.qty, price: c.sell }); if (v) { pkgs.push(v); for (const o of rows) if (!o.pkgId && o.svcId === v.serviceId) { o.pkgId = v.id; o.svcId = ''; o.sell = null; } draw(); } } }) : null),
            c.fam.length ? rxChips(c.fam.map(x => [x.id, x.child]), r.reacts, r.rmode, (set, mode) => { r.reacts = set; r.rmode = mode; draw(); }, c.parts) : null,
            r.why && r.pkgId ? h('div', { className: 'hint', textContent: 'Tự chọn ' + r.why }) : null),
          h('td', {}, h('input', { type: 'number', min: 1, step: 1, value: c.qty || '', readOnly: c.fixed, title: c.fixed ? 'Số lượng theo gói' : '', style: 'width:96px',
            onchange: e => { r.qty = Number(e.target.value) || 0; r.sell = null; draw(); } })),
          h('td', {}, h('input', { type: 'number', min: 0, step: 'any', value: c.sell || '', style: 'width:110px', title: 'Tiền khách trả cho dòng này',
            onchange: e => { r.sell = e.target.value === '' ? null : Number(e.target.value); draw(); } })),
          h('td', { className: 'num', textContent: c.svc ? money(c.cost) : '—' }),
          h('td', { className: 'num' + (c.sell - c.cost < 0 ? ' neg' : ''), textContent: c.svc ? money(c.sell - c.cost) : '—' }),
          h('td', { className: 'svc-bulk-st' }, r.on && c.error ? h('span', { className: 'status err', textContent: c.error }) : r.on ? h('span', { className: 'status ok', textContent: 'OK' }) : h('span', { className: 'hint', textContent: 'Bỏ qua' }),
            ...c.warns.map(w => h('div', { className: 'hint warn', textContent: '⚠ ' + w }))),
          h('td', {}, h('button', { type: 'button', className: 'icon-btn', title: 'Xoá dòng', textContent: '×', onclick: () => { rows.splice(i, 1); draw(); } })));
      }));
      const on = rows.filter(r => r.on).map(r => [r, calc(r)]), good = on.filter(([, c]) => !c.error);
      const sell = good.reduce((t, [, c]) => t + c.sell, 0), cost = good.reduce((t, [, c]) => t + c.cost, 0);
      if (document.activeElement !== totalIn) totalIn.value = sell || '';
      sum.replaceChildren(h('span', {}, h('strong', { textContent: `${good.length}/${rows.length}` }), ' dòng sẽ lên đơn'),
        h('label', { className: 'svc-bulk-total' }, 'Tổng khách trả ', totalIn, 'đ'), h('span', {}, 'Gốc ≈ ', h('strong', { textContent: money(cost) })),
        h('span', {}, 'Lãi ', h('strong', { className: sell - cost < 0 ? 'neg' : '', textContent: money(sell - cost) + pct(sell, cost) })),
        on.length > good.length ? h('span', { className: 'neg', textContent: `${on.length - good.length} dòng cần sửa` }) : null);
      const nl = new Set(good.map(([r]) => linkKey(r.link))).size;
      go.disabled = !good.length; go.textContent = good.length ? `Tạo 1 báo giá chung (${nl} link${good.length > nl ? `, ${good.length} đơn` : ''}) & gửi →` : 'Tạo báo giá & gửi →';
      allBox.hidden = !rows.length; empty0.hidden = rows.length > 0;
    };
    // Áp dụng cho tất cả dòng đang chọn: gói + số lượng.
    let allRx = new Set(), allMode = 'deu';
    // Mỗi mục = 1 dịch vụ áp cho mọi link đã tích: gói hoặc server + số lượng. 2 mục trở lên → mỗi link thành 2+ dòng.
    const entries = [], entryBox = h('div', { className: 'svc-bulk-entries' });
    const addEntry = () => { const en = { pkg: '', svc: '' };
      en.qty = h('input', { type: 'number', min: 1, step: 1, placeholder: 'Số lượng', style: 'width:100px' });
      en.sel = pkgSelect('', '', async e => { const sel = e.target, v = sel.value; if (v === '__chosen') return;
        if (v !== '__svc') { en.pkg = v; en.svc = ''; sel.querySelector('[value="__chosen"]')?.remove(); return; }
        const id = await pickServerDialog(list.filter(ok), en.svc); sel.querySelector('[value="__chosen"]')?.remove();
        if (!id) { sel.value = en.pkg; return; }
        const x = list.find(y => y.id === id); en.svc = id; en.pkg = '';
        sel.prepend(h('option', { value: '__chosen', selected: true, textContent: `⚙ Server ${id} · ${x?.name || ''}`.slice(0, 70) })); sel.value = '__chosen'; }, true);
      en.el = h('div', { className: 'row svc-bulk-entry', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, en.sel, en.qty,
        entries.length ? h('button', { type: 'button', className: 'icon-btn', title: 'Bỏ dịch vụ này', textContent: '×', onclick: () => { entries.splice(entries.indexOf(en), 1); en.el.remove(); } }) : null);
      entries.push(en); entryBox.append(en.el); };
    addEntry();
    const allQty = { get value() { return entries[0].qty.value; } };
    const allSell = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Khách trả / dòng', style: 'width:130px', title: 'Số tiền khách trả cho MỖI dòng (mỗi dịch vụ của mỗi link); để trống = tự tính theo gói / bảng giá' });
    const allRxBox = h('span', { className: 'svc-bulk-allrx' });
    const drawAllRx = () => allRxBox.replaceChildren(rxChips(RX_ALL.map(k => [k, RX_NAME[k]]), allRx, allMode, (set, mode) => { allRx = set; allMode = mode; drawAllRx(); }, null, true));
    drawAllRx();
    const allBox = h('div', { className: 'svc-bulk-all' }, h('strong', { textContent: 'Áp dụng cho tất cả' }),
      entryBox, h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '＋ Thêm dịch vụ', title: 'Mỗi link làm thêm 1 dịch vụ nữa (vd like + view): mỗi link thành nhiều dòng, mỗi dòng 1 đơn, giá riêng', onclick: () => addEntry() }),
      allSell, allRxBox,
      h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: 'Áp dụng cho các dòng đã tích', onclick: () => {
        const n = Number(allQty.value) || 0, money1 = allSell.value === '' ? null : Number(allSell.value);
        const allPkg = entries[0].pkg, allSvc = entries[0].svc, multi = entries.filter(en => en.pkg || en.svc);
        if (multi.length > 1) { // nhiều dịch vụ: mỗi link đã tích có đúng các dòng theo thứ tự mục (dùng lại dòng có sẵn, thiếu thì thêm)
          const links = [...new Set(rows.filter(r => r.on).map(r => linkKey(r.link)))];
          for (const k of links) {
            const mine = rows.filter(r => linkKey(r.link) === k);
            multi.forEach((en, j) => { const r = mine[j] || addService(mine[0].link);
              r.on = true; r.pkgId = en.pkg; r.svcId = en.svc; r.why = ''; r.reacts = null; r.qty = Number(en.qty.value) || 0; r.sell = money1; });
          }
          draw(); return toast(`Đã áp ${multi.length} dịch vụ cho ${links.length} link (${multi.length * links.length} dòng).`, 3500);
        }
        if (!allPkg && !allSvc && !n && money1 == null && !allRx.size) return toast('Chọn gói / server, số lượng, tiền khách trả hoặc cảm xúc để áp dụng.', 3500);
        let rxMiss = 0;
        for (const r of rows) if (r.on) {
          if (allPkg) { r.pkgId = allPkg; r.svcId = ''; r.why = ''; r.reacts = null; }
          if (allSvc) { r.svcId = allSvc; r.pkgId = ''; r.why = ''; r.reacts = null; }
          if (n) r.qty = n;
          if (allRx.size) { const fam = calc(r).fam; const ids = fam.filter(x => allRx.has(RX_KEY(x.child))).map(x => x.id); if (ids.length) { r.reacts = new Set(ids); r.rmode = allMode; } else if (fam.length) rxMiss++; }
          r.sell = money1 != null ? money1 : (allPkg || allSvc || n || allRx.size) ? null : r.sell;
        }
        draw(); if (rxMiss && allRx.size) toast(`${rxMiss} dòng có gói không chọn được cảm xúc (máy chủ không có loại đó).`, 5000); } }));
    // Tổng khách trả: nhập tổng → chia cho các link theo tỷ lệ tiền từng link (làm tròn nghìn, dòng cuối nhận phần lẻ).
    const totalIn = h('input', { type: 'number', min: 0, step: 'any', style: 'width:140px', title: 'Tổng tiền khách trả cho cả báo giá: app chia cho các link theo tỷ lệ',
      onchange: () => { const T = Math.round(Number(totalIn.value) || 0), good = rows.filter(r => r.on).map(r => [r, calc(r)]).filter(([, c]) => c.svc && !(/Chọn gói|Link|bảo trì|không còn|bình luận/.test(c.error)));
        if (!(T > 0) || !good.length) return draw();
        const base = good.map(([, c]) => c.sell > 0 ? c.sell : 1), B = base.reduce((a, b) => a + b, 0); let rest = T;
        good.forEach(([r], i) => { const v = i === good.length - 1 ? rest : Math.round(T * base[i] / B / 1000) * 1000; r.sell = Math.max(0, v); rest -= r.sell; });
        draw(); } });
    const paste = h('textarea', { rows: 1, style: 'min-height:38px;resize:vertical', placeholder: 'Dán thêm link: mỗi dòng một link (hoặc dán cả đoạn tin, app tự lọc link)' });
    const addPaste = () => { const found = linksIn([{ isCustomer: true, text: paste.value }]).reverse(); const raw = found.length ? found : paste.value.split(/\s+/).filter(x => /\.\w{2,}\//.test(x));
      let n = 0; for (const l of raw) if (addLink(l)) n++; paste.value = ''; draw(); toast(n ? `Đã thêm ${n} link.` : 'Không thấy link mới nào.', 3000); };
    const empty0 = h('p', { className: 'hint', textContent: 'Chưa có link nào. Dán danh sách link vào ô trên rồi bấm Thêm link.' });
    const go = h('button', { type: 'submit', className: 'btn btn-primary' });
    const form = h('form', { method: 'dialog', noValidate: true, onsubmit: async e => {
      e.preventDefault(); err.hidden = true;
      const on = rows.filter(r => r.on).map(r => [r, calc(r)]), bad = on.filter(([, c]) => c.error);
      if (bad.length) { err.textContent = `${bad.length} dòng cần sửa (dòng đỏ) hoặc bỏ tích trước khi tạo báo giá.`; err.hidden = false; return; }
      if (!on.length) return;
      const warns = on.flatMap(([r, c]) => c.warns.map(w => `• ${r.link.replace(/^https?:\/\/(www\.|m\.)?/, '').slice(0, 50)}: ${w}`));
      if (warns.length && !confirm(['Kiểm tra trước khi tạo:', ...warns, '', 'Vẫn tạo báo giá?'].join('\n'))) return;
      const lines = toLines(on);
      go.disabled = true;
      const q = await makeQuote(ctx, lines, lines[0].link, 'link');
      orderedCache = null; App.inbox?.bulkDone?.(lines.map(l => l.link));
      dlg.close(); toast(`Đã tạo báo giá ${q.payCode}: ${lines.length} link, tổng ${money(q.sell)}. Khi khách trả đủ, bấm "Đã nhận tiền" để tạo ${lines.length} đơn.`, 7000);
      invoiceDialog(q, 'quote');
    } },
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '🧾 Tạo đơn hàng loạt' + (ctx.name ? ' · ' + ctx.name : '') }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('p', { className: 'hint', style: 'margin:0', textContent: 'Mỗi dòng là 1 đơn Baostar (một link làm nhiều dịch vụ: bấm ＋ Dịch vụ ở link đó, hoặc ＋ Thêm dịch vụ ở Áp dụng cho tất cả). Tất cả gộp vào 1 báo giá chung (1 mã QR, tổng tiền); khách trả đủ thì bấm "Đã nhận tiền" để tạo lần lượt các đơn, đơn nào lỗi được giữ lại để thử lại.' }),
      guess ? h('div', { className: 'svc-hintline' }, '✨ Theo tin khách ', h('strong', { textContent: `“${guess.said}”` }), ` → ${guess.kind} · ${guess.qty.toLocaleString('vi-VN')} cho mỗi link. Kiểm tra lại từng dòng.`) : null,
      h('div', { className: 'row', style: 'gap:8px;align-items:flex-end' }, h('label', { className: 'field', style: 'flex:1' }, 'Thêm link', paste),
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Thêm link', onclick: addPaste })),
      allBox,
      h('div', { className: 'scroll svc-bulk-wrap' }, h('table', { className: 'svc-table svc-bulk-table' },
        h('thead', {}, h('tr', {}, ...['', 'Link', 'Gói / server', 'Số lượng', 'Khách trả', 'Gốc ≈', 'Lãi', 'Kiểm tra', ''].map(t => h('th', { textContent: t })))), body), empty0),
      sum, err,
      h('div', { className: 'row svc-actions', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' },
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: () => dlg.close() }), go));
    dlg.append(form); document.body.append(dlg); draw(); dlg.showModal();
    if (!rows.length) paste.focus();
  }
  async function createDialog(ctx = {}, link = '') {
    const s = await settings();
    const dock = !!ctx.dock; if (dock) closeDock();
    let list = [];
    try { list = await services(); } catch (e) { return toast(e.message, 7000); }
    const pkgs = s.packages || [];
    const dlg = h('dialog', { className: 'svc-dialog' + (dock ? ' svc-dock' : ''), onclose: () => dlg.remove() });
    const chatLinks = linksIn(ctx.messages);
    if (!link && chatLinks[0]) link = chatLinks[0];
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
    const commentsIn = h('textarea', { rows: 5, placeholder: 'Mỗi dòng 1 bình luận / đánh giá. Số lượng = số dòng.' });
    const commentsBox = h('label', { className: 'field', hidden: true }, 'Nội dung bình luận (máy chủ này cần nội dung)', commentsIn);
    const lineLink = h('input', { type: 'text', inputMode: 'url', placeholder: 'Để trống = dùng link chung ở trên' });
    const lineLinkBox = h('label', { className: 'field' }, 'Link riêng cho dịch vụ này (nếu khác link chung)', lineLink);
    const reactBox = h('div', { className: 'svc-react', hidden: true }); let reactIns = new Map(), reactRoot = '';
    const cart = []; let dirty = true;
    const dayAgo = Date.now() - 864e5, recent = new Map(); // link|máy chủ → mô tả đơn/báo giá trong 24 giờ
    const normLink = l => String(l || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    for (const o of await DB.get(ORDERS, []).catch(() => [])) if (o.source === 'service' && o.at > dayAgo) recent.set(normLink(o.link) + '|' + String(o.serviceId || o.items?.[0]?.serviceId), `đơn #${o.providerOrderId || o.payCode || ''} lúc ${fmtTime(o.at)}`);
    for (const q of await quotes().catch(() => [])) if (q.at > dayAgo) for (const l of linesOf(q)) recent.set(normLink(l.link) + '|' + String(l.serviceId), `báo giá ${q.payCode} lúc ${fmtTime(q.at)}`);
    const dupOf = (lk, sid) => recent.get(normLink(lk) + '|' + String(sid)) || '';
    const last = await lastOrderOf(ctx.key);
    const cartBox = h('div', { className: 'svc-cart', hidden: true });
    let listPrice = 0;
    const remember = h('input', { type: 'checkbox', checked: true });
    const noteBox = h('div', { className: 'svc-notes' }), info = h('div', { className: 'svc-sum' }), err = h('div', { className: 'status err', hidden: true }), warnBox = h('div', { className: 'status pending svc-warn', hidden: true });
    pkgSel.hidden = true; search.hidden = true; pick.hidden = true;
    const linkPlat = () => LINK_PLAT[platformOf(linkIn.value)] || '';
    const pkgItems = [{ value: '', label: 'Chọn máy chủ trực tiếp', sub: 'Không dùng gói, chọn máy chủ Baostar bên dưới', always: true },
      ...pkgs.map(pk => { const svc = list.find(x => x.id === String(pk.serviceId)), plat = svc?.platform || (PLAT[pk.name.split(' · ')[0]] ? pk.name.split(' · ')[0] : '');
        return { value: pk.id, label: plat ? pk.name.replace(plat + ' · ', '') : pk.name, sub: svc ? `Gốc: MC ${svc.id} · ${m2(svc.unitCost)}/đv` : 'Chưa gắn máy chủ gốc', platform: plat, group: plat,
          type: svc?.category || (plat ? pk.name.replace(plat + ' · ', '') : pk.name).split(' · ')[0],
          tags: tagsOf(pk.name), price: pk.kind === 'fixed' ? `${Number(pk.qty).toLocaleString('vi-VN')} = ${money(pk.price)}` : `${m2(pk.unitPrice)}/đv`, warn: svc && stateOf(svc)[1] === 'err' ? 'Gốc bảo trì' : !svc ? 'Thiếu máy chủ' : '' }; })];
    const uses = new Map(), bump = id => id && uses.set(id, (uses.get(id) || 0) + 1);
    for (const o of await DB.get(ORDERS, []).catch(() => [])) if (o.source === 'service') bump(o.packageId);
    for (const q of await quotes().catch(() => [])) for (const l of linesOf(q)) if (!l.done) bump(l.packageId);
    const top = [...uses.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
    for (const it of pkgItems) if (uses.get(it.value)) { it.uses = uses.get(it.value); it.star = top.includes(it.value); }
    // Gói hay dùng lên đầu trong cùng nền tảng (giữ thứ tự nhóm).
    const platOrder = [...new Set(pkgItems.map(i => i.platform || ''))];
    pkgItems.sort((a, b) => (b.always ? 1 : 0) - (a.always ? 1 : 0) || platOrder.indexOf(a.platform || '') - platOrder.indexOf(b.platform || '') || (b.uses || 0) - (a.uses || 0));
    const pkgPick = cardPicker({ items: pkgItems, value: '', plat: linkPlat(), height: 240, collapsible: true, placeholder: 'Tìm gói…', onPick: v => { pkgSel.value = v; pkgSel.onchange(); } });
    const svcPick = cardPicker({ items: serverItems(list.filter(x => stateOf(x)[1] !== 'err')), value: '', plat: linkPlat(), height: 260, collapsible: true, placeholder: 'Tìm máy chủ (vd: follow, like page, view tiktok, MC 6560)…',
      onPick: v => { pick.value = v; pick.onchange(); } });
    const svcBox = h('div', { className: 'field' }, 'Máy chủ', search, pick, svcPick.el);
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
      svcPick.set(pick.value);
      recalc();
    };
    const recalc = () => {
      const p = pkg(), svc = chosen();
      svcBox.hidden = !!p; rememberBox.hidden = !!p; unitBox.hidden = p?.kind === 'fixed';
      const cm = needsComments(svc), fam = cm ? [] : reactionFamily(list, svc);
      commentsBox.hidden = !cm;
      // Cảm xúc: ô số lượng từng cảm xúc; tổng = số lượng.
      if (!fam.length) { reactBox.hidden = true; reactRoot = ''; reactIns = new Map(); }
      else if (fam[0].id !== reactRoot) {
        // Chọn nhiều cảm xúc: bấm chip để bật / tắt từng cảm xúc, nhập TỔNG một lần, app chia tự động (Chia đều / Tự nhiên).
        // Sửa tay ô của một cảm xúc vẫn được; tổng luôn hiện "đã chia x/y". Mỗi cảm xúc vẫn là 1 đơn Baostar riêng.
        reactRoot = fam[0].id; reactIns = new Map();
        const EMO = { like: '👍', love: '❤️', care: '🥰', haha: '😆', wow: '😮', sad: '😢', angry: '😡', tim: '❤️', 'thả tim': '❤️', 'thương thương': '🥰' };
        const WEIGHT = { like: 50, love: 25, care: 10, haha: 8, wow: 4, sad: 2, angry: 1, tim: 25, 'thả tim': 25, 'thương thương': 10 };
        const fixedQty = p?.kind === 'fixed' ? Number(p.qty) : 0;
        const on = new Set([svc.id]); let mode = 'deu';
        const totalIn = h('input', { type: 'number', min: 1, step: 1, value: fixedQty || Number(qty.value) || 1000, readOnly: !!fixedQty, className: 'svc-react-total', title: fixedQty ? 'Số lượng của gói' : 'Tổng số cảm xúc cần tăng' });
        const sumEl = h('span', { className: 'svc-react-sum' });
        const chips = new Map(), cells = new Map();
        const split = () => { const ids = fam.filter(x => on.has(x.id)), T = Math.max(0, Math.round(Number(totalIn.value) || 0)); if (!ids.length) return;
          const w = ids.map(x => mode === 'deu' ? 1 : WEIGHT[String(x.child).toLowerCase()] || 5), W = w.reduce((a, b) => a + b, 0);
          const parts = ids.map((x, i) => Math.floor(T * w[i] / W)); let rest = T - parts.reduce((a, b) => a + b, 0);
          for (let i = 0; rest > 0; i = (i + 1) % parts.length, rest--) parts[i]++;
          ids.forEach((x, i) => { reactIns.get(x.id).value = parts[i]; }); };
        const sync = () => {
          for (const x of fam) { const c = chips.get(x.id), sel = on.has(x.id); c.classList.toggle('on', sel); c.setAttribute('aria-pressed', String(sel)); cells.get(x.id).hidden = !sel; if (!sel) reactIns.get(x.id).value = ''; }
          const sum = fam.reduce((t, x) => t + (on.has(x.id) ? Math.round(Number(reactIns.get(x.id).value)) || 0 : 0), 0), T = Math.round(Number(totalIn.value) || 0);
          const low = fam.filter(x => on.has(x.id) && (Number(reactIns.get(x.id).value) || 0) > 0 && Number(reactIns.get(x.id).value) < x.min);
          sumEl.className = 'svc-react-sum ' + (sum === T && !low.length ? 'ok' : 'bad');
          sumEl.textContent = (sum === T ? `✓ Đã chia ${sum.toLocaleString('vi-VN')}/${T.toLocaleString('vi-VN')}` : `Đã chia ${sum.toLocaleString('vi-VN')}/${T.toLocaleString('vi-VN')}`) + (low.length ? ` · ${low.map(x => x.child).join(', ')} dưới mức tối thiểu ${low[0].min}` : '');
          for (const [m, b] of modeBtns) b.setAttribute('aria-pressed', String(m === mode));
          dirty = true; reset(total, costIn); recalc(); };
        const modeBtns = [['deu', 'Chia đều'], ['tn', 'Tự nhiên'], ['tay', 'Tự nhập']].map(([m, t]) => [m, h('button', { type: 'button', className: 'svc-chip', textContent: t,
          title: m === 'tn' ? 'Like nhiều nhất, rồi Love, Care, Haha… như bài thật' : m === 'tay' ? 'Tự gõ số từng cảm xúc' : 'Chia đều cho các cảm xúc đã chọn',
          onclick: () => { mode = m; if (m !== 'tay') split(); sync(); } })]);
        for (const x of fam) {
          const inp = h('input', { type: 'number', min: 0, step: 1, placeholder: '0', oninput: () => { mode = 'tay'; sync(); } }); reactIns.set(x.id, inp);
          chips.set(x.id, h('button', { type: 'button', className: 'svc-react-chip', title: `${x.child} · tối thiểu ${x.min}`,
            onclick: () => { if (on.has(x.id) && on.size > 1) on.delete(x.id); else on.add(x.id); if (mode !== 'tay') split(); sync(); } },
            h('span', { className: 'e', textContent: EMO[String(x.child).toLowerCase()] || '•' }), h('span', { textContent: x.child })));
          cells.set(x.id, h('label', { className: 'svc-react-cell' }, h('span', { textContent: (EMO[String(x.child).toLowerCase()] || '') + ' ' + x.child }), inp));
        }
        totalIn.oninput = () => { if (mode === 'tay') mode = 'deu'; split(); sync(); };
        reactBox.replaceChildren(
          h('div', { className: 'svc-react-head' }, h('strong', { textContent: 'Cảm xúc' }), h('span', { className: 'hint', textContent: ' · bấm để chọn nhiều loại · mỗi loại là 1 đơn Baostar' })),
          h('div', { className: 'svc-react-chips' }, ...chips.values(),
            h('button', { type: 'button', className: 'svc-chip', textContent: 'Tất cả', onclick: () => { fam.forEach(x => on.add(x.id)); if (mode !== 'tay') split(); sync(); } })),
          h('div', { className: 'svc-react-ctl' }, h('label', {}, 'Tổng ', totalIn), ...modeBtns.map(([, b]) => b), sumEl),
          h('div', { className: 'svc-react-grid' }, ...cells.values()));
        split(); reactBox.hidden = false; setTimeout(sync, 0);
      }
      const reactSum = fam.length ? [...reactIns.values()].reduce((t, i) => t + (Math.round(Number(i.value)) || 0), 0) : 0;
      qty.readOnly = p?.kind === 'fixed' || cm || !!fam.length;
      if (cm) qty.value = commentLines(commentsIn.value).length;
      else if (p?.kind === 'fixed') qty.value = p.qty;
      else if (fam.length) qty.value = reactSum;
      if (!touched(unit)) unit.value = p ? (p.kind === 'unit' ? p.unitPrice : '') : (svc ? s.prices[svc.id] ?? '' : '');
      if (!touched(shown)) shown.value = p ? p.name : svc ? (svc.category || '') : '';
      const n = Math.max(0, Number(qty.value) || 0);
      if (!touched(total)) total.value = p?.kind === 'fixed' ? p.price : unit.value === '' ? '' : Math.round(Number(unit.value) * n);
      if (!touched(costIn)) costIn.value = svc ? Math.round(fam.length ? fam.reduce((t, x) => t + estCost(x, Math.round(Number(reactIns.get(x.id)?.value)) || 0), 0) : estCost(svc, n)) : '';
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
          svc.notes ? h('details', { className: 'svc-note-fold' }, h('summary', { textContent: 'Ghi chú gốc của máy chủ' }), safeNotes(svc.notes)) : null); }
      else noteBox.replaceChildren(p ? h('div', { className: 'neg', textContent: 'Máy chủ gốc của gói không còn trong danh sách. Đổi máy chủ gốc ở Cài đặt dịch vụ › Gói bán của tôi.' }) : '');
      info.replaceChildren(
        h('span', {}, 'Giá gốc ', h('strong', { textContent: money(cost) + (touched(costIn) ? '' : ' ≈') })), h('span', {}, 'Khách trả ', h('strong', { textContent: money(sell) })),
        h('span', {}, 'Lãi ', h('strong', { className: sell - cost < 0 ? 'neg' : '', textContent: money(sell - cost) + pct(sell, cost) })),
        listPrice ? h('span', {}, 'So với giá gói ', h('strong', { className: sell - listPrice < 0 ? 'neg' : '', textContent: (sell - listPrice > 0 ? '+' : '') + money(sell - listPrice) })) : null,
        Number(termIn.value) > 0 ? h('span', {}, '🔔 Hạn ', h('strong', { textContent: `${termIn.value} tháng` }), ' (nhắc gia hạn)') : null,
        fam.length && p?.kind === 'fixed' && reactSum !== Number(p.qty) ? h('span', { className: 'neg', textContent: `Tổng cảm xúc ${reactSum} phải bằng ${p.qty}` }) : null,
        svc && !fam.length && (n < svc.min || n > svc.max) ? h('span', { className: 'neg', textContent: `Số lượng phải từ ${svc.min} đến ${svc.max}` }) : null);
      // Kiểm tra trước khi tạo: link khác nền tảng của dịch vụ, trùng đơn cùng link + dịch vụ trong 24 giờ.
      const lk = lineLink.value.trim() || linkIn.value.trim(), lp = LINK_PLAT[platformOf(lk)] || '', sp = svc?.platform || p && pkgItems.find(i => i.value === p.id)?.platform || '';
      const warns = [lp && sp && norm(lp) !== norm(sp) ? `Link là ${lp} nhưng dịch vụ là ${sp}` : '', svc && dupOf(lk, svc.id) ? `Link này đã có ${dupOf(lk, svc.id)} cùng dịch vụ` : ''].filter(Boolean);
      warnBox.hidden = !warns.length; warnBox.replaceChildren(...warns.map(w => h('div', { textContent: '⚠ ' + w })));
      drawCart();
    };
    const reset = (...els) => els.forEach(el => { el.dataset.touched = ''; });
    pkgSel.onchange = () => { dirty = true; reset(unit, total, costIn, shown, termIn); recalc(); };
    search.oninput = draw; pick.onchange = () => { dirty = true; reset(unit, total, costIn, shown, termIn); recalc(); }; linkIn.oninput = () => { drawChips(); draw(); pkgPick.setPlat(linkPlat()); svcPick.setPlat(linkPlat()); };
    qty.oninput = () => { dirty = true; reset(total, costIn); recalc(); };
    unit.oninput = () => { dirty = true; unit.dataset.touched = '1'; reset(total); recalc(); };
    commentsIn.oninput = () => { dirty = true; reset(total, costIn); recalc(); };
    lineLink.oninput = () => { dirty = true; };
    for (const el of [total, costIn, shown, termIn]) el.oninput = () => { dirty = true; el.dataset.touched = '1'; recalc(); };
    // Dòng đang soạn → 1 hoặc nhiều dòng đơn (cảm xúc tách theo từng mã máy chủ, chia tiền theo số lượng).
    const editorLines = () => {
      const p = pkg(), svc = chosen(), n = Math.round(Number(qty.value) || 0), sell = Number(total.value) || 0, cost = Number(costIn.value) || 0;
      if (!svc) return { error: p ? 'Máy chủ gốc của gói không còn. Đổi ở Cài đặt dịch vụ.' : 'Chọn máy chủ.' };
      const lk = lineLink.value.trim() || linkIn.value.trim();
      if (!/^https?:\/\//i.test(lk)) return { error: 'Link phải bắt đầu bằng http(s)://' };
      if (needsComments(svc) && !commentLines(commentsIn.value).length) return { error: 'Máy chủ này cần nội dung bình luận: mỗi dòng 1 bình luận.' };
      if (stateOf(svc)[1] === 'err') return { error: `Máy chủ #${svc.id} đang bảo trì trên web. Chọn máy chủ khác hoặc đổi máy chủ gốc của gói.` };
      if (!(sell > 0)) return { error: 'Nhập thành tiền khách trả.' };
      const label = shown.value.trim() || p?.name || svc.category || 'Dịch vụ';
      const base = { link: lk, costManual: touched(costIn), displayName: label, packageId: p?.id || '', termMonths: Math.max(0, Number(termIn.value) || 0), comments: '' };
      const fam = reactIns.size ? reactionFamily(list, svc) : [];
      if (fam.length) {
        const parts = fam.map(x => [x, Math.round(Number(reactIns.get(x.id)?.value)) || 0]).filter(([, k]) => k > 0);
        if (!parts.length) return { error: 'Nhập số lượng ít nhất 1 cảm xúc.' };
        const sum = parts.reduce((t, [, k]) => t + k, 0);
        if (p?.kind === 'fixed' && sum !== Number(p.qty)) return { error: `Tổng các cảm xúc (${sum}) phải bằng số lượng gói (${p.qty}).` };
        for (const [x, k] of parts) if (k < x.min || k > x.max) return { error: `${x.child}: số lượng phải từ ${x.min} đến ${x.max} (mỗi cảm xúc là 1 đơn).` };
        let restS = sell, restC = cost, restL = listPrice;
        return { lines: parts.map(([x, k], i) => { const last = i === parts.length - 1;
          const sl = last ? restS : Math.round(sell * k / sum); restS -= sl;
          const cl = touched(costIn) ? (last ? restC : Math.round(cost * k / sum)) : Math.round(estCost(x, k)); if (touched(costIn)) restC -= cl;
          const lp = listPrice ? (last ? restL : Math.round(listPrice * k / sum)) : 0; restL -= lp;
          return { ...base, id: uid('ln'), serviceId: x.id, serviceName: x.name, reaction: x.child, qty: k, sell: sl, cost: cl, listPrice: lp, displayName: `${label} (${x.child})` }; }) };
      }
      if (n < svc.min || n > svc.max) return { error: `Số lượng phải từ ${svc.min} đến ${svc.max}.` };
      return { lines: [{ ...base, id: uid('ln'), serviceId: svc.id, serviceName: svc.name, qty: n, sell, cost, listPrice, comments: needsComments(svc) ? commentLines(commentsIn.value).join('\n') : '' }] };
    };
    const fail = m => { err.textContent = m; err.hidden = false; };
    const resetEditor = () => { lineLink.value = ''; commentsIn.value = ''; reactRoot = ''; reset(unit, total, costIn, shown, termIn); dirty = false; recalc(); };
    const rememberPrice = async () => { const p = pkg(), svc = chosen(); if (svc && !p && remember.checked && unit.value !== '' && touched(unit)) await saveSettings({ prices: { ...(await settings()).prices, [svc.id]: Number(unit.value) } }); };
    // Bước nhỏ: tiêu đề có số; link khách gửi thành nút bấm chọn; nút số lượng nhanh.
    const step = (n, t) => h('div', { className: 'svc-step' }, h('b', { textContent: String(n) }), t);
    const linkChips = h('div', { className: 'svc-chips', hidden: !chatLinks.length });
    const drawChips = () => linkChips.replaceChildren(h('span', { className: 'hint', textContent: 'Link khách gửi:' }), ...chatLinks.slice(0, 6).map(l => h('button', { type: 'button', className: 'svc-chip' + (l === linkIn.value.trim() ? ' on' : ''), title: l,
      onclick: () => { linkIn.value = l; linkIn.oninput(); } }, LINK_PLAT[platformOf(l)] ? platBadge(LINK_PLAT[platformOf(l)], 14) : null, h('span', { textContent: l.replace(/^https?:\/\/(www\.|m\.)?/, '').slice(0, 34) + (l.length > 44 ? '…' : '') }))));
    const qtyQuick = h('div', { className: 'svc-chips' }, h('span', { className: 'hint', textContent: 'Nhanh:' }), ...[100, 500, 1000, 2000, 5000, 10000].map(n => h('button', { type: 'button', className: 'svc-chip', textContent: n >= 1000 ? n / 1000 + 'K' : String(n),
      onclick: () => { if (qty.readOnly) return; qty.value = n; qty.oninput(); } })));
    // Gợi ý từ lời khách + lặp lại đơn trước (đầu khung).
    const quick = h('div', { className: 'svc-quick' });
    const guess = guessOrder(ctx.messages);
    // Tự chọn sẵn loại dịch vụ theo lời khách gần đây (vd "tăng follow" → loại Follow); bạn vẫn đổi được.
    { const said = (ctx.messages || []).filter(m => m.isCustomer).slice(-6).map(m => m.text || '').join(' \n ');
      if (said) setTimeout(() => { try { pkgPick.setType(said); svcPick.setType(said); } catch {} }, 0); }
    const applyGuess = () => {
      if (!guess) return false;
      const plat = linkPlat(), cands = pkgs.filter(pk => guess.match.test(norm(pk.name)) && (!plat || !pkgItems.find(i => i.value === pk.id)?.platform || norm(pkgItems.find(i => i.value === pk.id).platform) === norm(plat)));
      const pk = cands.find(x => x.kind === 'fixed' && Number(x.qty) === guess.qty) || cands.find(x => x.kind !== 'fixed') || null;
      if (pk) { pkgSel.value = pk.id; pkgPick.set?.(pk.id); pkgSel.onchange(); }
      else { search.value = guess.kind; draw(); }
      if (!qty.readOnly) { qty.value = guess.qty; qty.oninput(); }
      return true;
    };
    quick.replaceChildren(
      guess ? h('div', { className: 'svc-hintline' }, '✨ Theo tin khách ', h('strong', { textContent: `“${guess.said}”` }), ` → điền sẵn ${guess.kind} · ${guess.qty.toLocaleString('vi-VN')}. Kiểm tra lại gói trước khi tạo.`) : '',
      last?.lines?.length ? h('button', { type: 'button', className: 'btn btn-soft btn-sm svc-repeat', title: 'Tạo báo giá giống lần trước (link, dịch vụ, số lượng, giá)',
        textContent: `↻ Lặp lại đơn trước: ${[...new Set(last.lines.map(l => l.displayName))].join(', ').slice(0, 60)} · ${money(sumOf(last.lines, 'sell'))}`,
        onclick: () => { cart.splice(0, cart.length, ...last.lines.map(l => ({ ...l, id: uid('ln') }))); if (last.link) linkIn.value = last.link; drawChips(); dirty = false; drawCart(); toast('Đã chép đơn trước vào đơn. Kiểm tra rồi bấm Tạo báo giá & gửi.', 4000); } }) : '');
    quick.hidden = !guess && !last?.lines?.length;
    const addBtn = h('button', { type: 'button', className: 'btn btn-soft', textContent: '＋ Thêm dịch vụ khác', title: 'Thêm dòng đang soạn vào đơn rồi chọn dịch vụ tiếp theo',
      onclick: async () => { err.hidden = true; const r = editorLines(); if (r.error) return fail(r.error); await rememberPrice(); cart.push(...r.lines); resetEditor(); toast(`Đã thêm ${r.lines.length} dòng. Chọn dịch vụ tiếp theo hoặc bấm Tạo báo giá.`, 3500); } });
    function drawCart() {
      if (!cart.length) { cartBox.hidden = true; return; }
      const sell = sumOf(cart, 'sell'), cost = sumOf(cart, 'cost');
      cartBox.hidden = false;
      cartBox.replaceChildren(h('div', { className: 'svc-cart-head' }, h('strong', { textContent: `Đơn gồm ${cart.length} dịch vụ` }),
          h('span', { className: 'hint', textContent: ` · khách trả ${money(sell)} · gốc ≈ ${money(cost)} · lãi ${money(sell - cost)}` })),
        ...cart.map((l, i) => { const x = list.find(y => y.id === String(l.serviceId));
          return h('div', { className: 'svc-line' }, h('span', { className: 'svc-line-no', textContent: String(i + 1) }), x ? platBadge(x.platform, 20) : null,
            h('span', { className: 'cp-main' }, h('span', { className: 'cp-title', textContent: `${l.displayName} · ${Number(l.qty).toLocaleString('vi-VN')}` }),
              h('span', { className: 'cp-sub', textContent: `MC ${l.serviceId}${l.link !== linkIn.value.trim() ? ' · ' + l.link : ''}` })),
            h('span', { className: 'cp-price', textContent: money(l.sell) }),
            h('button', { type: 'button', className: 'icon-btn', title: 'Bỏ dòng này', textContent: '×', onclick: () => { cart.splice(i, 1); drawCart(); } })); }),
        dirty ? h('p', { className: 'hint', style: 'margin:4px 0 0', textContent: 'Dịch vụ đang soạn bên dưới cũng sẽ được thêm khi bấm Tạo báo giá.' }) : null);
    }
    const form = h('form', { method: 'dialog', noValidate: true, onsubmit: async e => {
      e.preventDefault(); err.hidden = true;
      const lines = [...cart];
      if (!cart.length || dirty) { const r = editorLines(); if (r.error) return fail(cart.length ? r.error + ' (hoặc đưa các ô về như cũ để chỉ tạo các dòng đã thêm)' : r.error); await rememberPrice(); lines.push(...r.lines); }
      if (!lines.length) return fail('Đơn chưa có dịch vụ nào.');
      const dups = lines.map(l => dupOf(l.link, l.serviceId) && `• ${l.displayName}: đã có ${dupOf(l.link, l.serviceId)}`).filter(Boolean);
      const wrong = lines.map(l => { const x = list.find(y => y.id === String(l.serviceId)), lp = LINK_PLAT[platformOf(l.link)] || ''; return x?.platform && lp && norm(x.platform) !== norm(lp) ? `• ${l.displayName}: link ${lp}, dịch vụ ${x.platform}` : ''; }).filter(Boolean);
      if ((dups.length || wrong.length) && !confirm(['Kiểm tra trước khi tạo:', ...(dups.length ? ['Trùng đơn trong 24 giờ (cùng link + dịch vụ):', ...dups] : []), ...(wrong.length ? ['Link không hợp nền tảng dịch vụ:', ...wrong] : []), '', 'Vẫn tạo báo giá?'].join('\n'))) return;
      const q = await makeQuote(ctx, lines, linkIn.value.trim() || lines[0].link);
      dlg.close(); toast(`Đã tạo báo giá ${q.payCode} (${lines.length} dịch vụ). Gửi cho khách, khi nhận tiền bấm "Đã nhận tiền".`, 6000);
      invoiceDialog(q, 'quote');
    } },
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: (dock ? '🧾 Tạo đơn' : 'Báo giá dịch vụ') + (ctx.name ? ' · ' + ctx.name : '') }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      quick,
      step(1, 'Link cần làm'), linkIn, linkChips,
      cartBox,
      step(2, 'Dịch vụ'),
      pkgs.length ? h('div', { className: 'field' }, pkgSel, pkgPick.el) : h('p', { className: 'hint', style: 'margin:0' }, pkgSel, 'Chưa có gói bán: chọn máy chủ trực tiếp bên dưới (tạo gói ở tab Dịch vụ › Gói bán của tôi).'),
      svcBox, noteBox, reactBox, commentsBox,
      step(3, 'Số lượng & giá'),
      h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:flex-end' }, h('label', { className: 'field', style: 'flex:1;min-width:110px' }, 'Số lượng', qty), unitBox,
        h('label', { className: 'field', style: 'flex:1;min-width:120px' }, 'Khách trả', total)),
      qtyQuick,
      h('details', { className: 'svc-adv' }, h('summary', { textContent: 'Tuỳ chỉnh (giá gốc, tên khách thấy, nhắc gia hạn, link riêng)' }),
        h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
          h('label', { className: 'field', style: 'flex:1' }, 'Giá gốc cả đơn', costIn),
          h('label', { className: 'field', style: 'flex:1' }, 'Nhắc gia hạn (tháng)', termIn)),
        h('label', { className: 'field' }, 'Tên dịch vụ khách thấy trên đơn', shown),
        lineLinkBox, rememberBox),
      info, warnBox, err,
      h('div', { className: 'row svc-actions', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' },
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Web dịch vụ ↗', title: 'Copy link rồi mở web dịch vụ', onclick: () => { if (linkIn.value) navigator.clipboard?.writeText(linkIn.value).catch(() => {}); openWeb(); } }),
        addBtn, h('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Tạo báo giá & gửi →' })));
    // Khung neo: phủ đúng cột danh sách khách của Hộp thư (hội thoại bên phải vẫn đọc được); không có thì neo mép phải.
    const place = () => { const host = document.querySelector('[data-panel=inbox]:not([hidden]) .split>.card'), r = host?.getBoundingClientRect();
      if (r?.width > 250) { const top = Math.max(12, Math.min(r.top, innerHeight - 520)); Object.assign(dlg.style, { left: r.left + 'px', top: top + 'px', width: Math.max(r.width, 360) + 'px', height: Math.max(420, innerHeight - top - 12) + 'px', right: 'auto' }); }
      else Object.assign(dlg.style, { left: 'auto', right: '12px', top: '12px', width: 'min(440px, calc(100vw - 24px))', height: 'calc(100vh - 24px)' }); };
    if (dock) { place(); addEventListener('resize', place); dlg.addEventListener('close', () => removeEventListener('resize', place)); }
    dlg.append(form); document.body.append(dlg); drawChips(); draw(); if (dock) dlg.show(); else dlg.showModal();
    if (!applyGuess()) (link ? pkgSel : linkIn).focus();
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
  // Mã hiện cho khách / tra cứu: đơn đã tạo → mã đơn Baostar (#123456, nhiều đơn: #1, #2…); báo giá / chưa có đơn → mã thanh toán DV….
  const docCode = (o, kind) => { const ids = kind === 'quote' ? [] : (o.group ? o.lines.map(l => l.order?.providerOrderId) : [o.providerOrderId]).filter(Boolean);
    return ids.length ? ids.slice(0, 4).map(i => '#' + i).join(', ') + (ids.length > 4 ? ` +${ids.length - 4}` : '') : '#' + payCode(o); };
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
  const KIND_HEAD = { done: 'HOÀN THÀNH ĐƠN HÀNG ✓', quote: 'BÁO GIÁ · CHỜ THANH TOÁN', paid: 'ĐÃ NHẬN THANH TOÁN · ĐƠN ĐANG CHẠY', progress: 'CẬP NHẬT TIẾN ĐỘ ĐƠN HÀNG', new: 'XÁC NHẬN ĐƠN HÀNG' };
  // Đơn nhiều dịch vụ: từng dòng (tên · số lượng · tiền), link riêng nếu khác link chung, đơn đã tạo thì kèm tiến độ.
  const multi = o => (o.lines?.length || 0) > 1;
  const lineText = (o, l, i) => `${i + 1}. ${l.displayName} · ${Number(l.qty).toLocaleString('vi-VN')}${Number(l.sell) ? ` · ${money(l.sell)}` : ''}${l.link && l.link !== o.link ? ` · ${l.link}` : ''}${l.order ? ` · ${progressLine(l.order)}` : ''}`;
  // Báo giá / đơn nhiều link: gộp các cảm xúc của cùng link thành 1 dòng; mọi link giống nhau (cùng gói, số lượng, tiền) thì ghi 1 dòng "Mỗi link".
  // Link hiện gọn: bỏ https://www., bỏ tham số theo dõi (giữ id / story_fbid / fbid / v).
  const shortLink = l => { try { const u = new URL(l); const keep = [...u.searchParams].filter(([k]) => /^(id|story_fbid|fbid|v)$/i.test(k)).map(([k, v]) => k + '=' + v).join('&');
    return u.hostname.replace(/^(www|m|web)\./i, '') + u.pathname.replace(/\/+$/, '') + (keep ? '?' + keep : ''); } catch { return String(l || ''); } };
  const RX_SHORT = r => String(r || '').toLowerCase();
  function linkGroups(o) {
    const byLink = new Map();
    for (const l of linesOf(o)) { const k = l.link || o.link || ''; if (!byLink.has(k)) byLink.set(k, []); byLink.get(k).push(l); }
    const groups = [...byLink].map(([link, ls]) => {
      const pk = [...new Set(ls.map(l => String(l.displayName || '').replace(/\s*\((like|love|care|haha|wow|sad|angry|thương thương|tim|thả tim)\)\s*$/i, '')))].join(', ');
      const what = ls.map(l => `${Number(l.qty).toLocaleString('vi-VN')}${l.reaction ? ' ' + RX_SHORT(l.reaction) : ''}`).join(' + ');
      const sell = sumOf(ls, 'sell'), ords = ls.map(l => l.order).filter(Boolean);
      let st = '';
      if (ords.length) { const all = ords.length === ls.length && ords.every(x => x.status === 'done'), tot = sumOf(ls, 'qty'), dn = ords.reduce((t, x) => t + (doneOf(x) ?? 0), 0);
        st = all ? 'Hoàn thành' : ords.some(x => /progress|processing/i.test(x.svcStatus || '')) || dn ? `Đang chạy${dn ? ` · ${dn.toLocaleString('vi-VN')}/${tot.toLocaleString('vi-VN')}` : ''}` : 'Chờ chạy'; }
      else if (ls.some(l => l.error && !l.done)) st = 'Chưa tạo được';
      return { link, pk, what, sell, st, sig: `${pk}|${what}|${sell}` };
    });
    return { groups, same: groups.length > 1 && groups.every(g => g.sig === groups[0].sig) };
  }
  function multiText(o, kind) {
    const { groups, same } = linkGroups(o), out = [], g0 = groups[0];
    if (groups.length === 1) out.push(`• Dịch vụ: ${g0.pk}`, g0.link ? `• Link: ${shortLink(g0.link)}` : null, `• Số lượng: ${g0.what}`, g0.st ? `• Trạng thái: ${g0.st}` : null);
    else if (same) out.push(`• Dịch vụ: ${g0.pk}`, `• Mỗi link: ${g0.what} · ${money(g0.sell)}`, `• ${groups.length} link:`, ...groups.map((g, i) => `   ${i + 1}. ${shortLink(g.link)}${g.st ? ' · ' + g.st : ''}`));
    else out.push(`• ${groups.length} link:`, ...groups.map((g, i) => `   ${i + 1}. ${shortLink(g.link)} · ${g.pk} · ${g.what} · ${money(g.sell)}${g.st ? ' · ' + g.st : ''}`));
    if (kind !== 'progress') out.push(`• Tổng tiền: ${money(orderSell(o))}`);
    return out;
  }
  function invoiceText(o, inv, kind) {
    const q = qtyOf(o), name = o.displayName || o.items?.[0]?.name || 'Dịch vụ';
    const L = [`${kind === 'quote' && o.renewOf ? '🔔 GIA HẠN DỊCH VỤ' : KIND_TITLE[kind] || KIND_TITLE.new} ${docCode(o, kind)}`,
      ...(multi(o) ? multiText(o, kind)
        : [`• Dịch vụ: ${name}`, o.link ? `• Link: ${o.link}` : null, `• Số lượng: ${q.toLocaleString('vi-VN')}`, kind === 'progress' ? null : `• Thành tiền: ${money(orderSell(o))}`])];
    if (kind === 'quote') {
      if (o.renewEnd) L.push(`• Gói hiện tại hết hạn: ${fmtTime(o.renewEnd)}`);
      if (o.termMonths) L.push(`• Thời hạn: ${o.termMonths} tháng`);
      if (o.paidAmount) L.push(`• Đã nhận: ${money(o.paidAmount)} · Còn thiếu: ${money(amountDue(o))}`);
      L.push(`• Hạn thanh toán: ${fmtTime(o.expiresAt)}`);
    } else if (kind === 'paid') L.push(`• Đã thanh toán: ${money(o.paidAmount || orderSell(o))}`, `• Lên đơn lúc: ${fmtTime(o.at)}`, o.vipEnd ? `• Hạn sử dụng đến: ${fmtTime(o.vipEnd)}` : null, multi(o) ? null : `• Trạng thái: ${progressLine(o)}`);
    else L.push(`• Tạo lúc: ${fmtTime(o.at)}`, multi(o) ? null : `• Trạng thái: ${progressLine(o)}`);
    if (hasPayBlock(kind) && inv.acc) L.push('', `💳 Chuyển khoản ${money(amountDue(o))}: ${bankName(inv.bin) || 'Ngân hàng'} · STK ${inv.acc}${inv.holder ? ' · ' + inv.holder : ''}`, `   Nội dung CK: ${payCode(o)}`);
    if (kind === 'quote') L.push('', '⏳ Shop lên đơn ngay khi nhận được thanh toán.');
    if (inv.note) L.push('', '📌 Lưu ý: ' + inv.note.trim());
    const T = L.filter(l => l != null);
    return T.filter((l, i) => l !== '' || T[i - 1] !== '').join('\n').replace(/^\n+|\n+$/g, '');
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
  // Ảnh hoá đơn / báo giá. Có chuyển khoản: mã QR to chiếm phần lớn ảnh (khách quét ngay), số tiền + nội dung CK nổi bật;
  // mỗi loại thông tin một màu (dịch vụ tím, link xanh dương, số lượng cam, hạn vàng, mã CK đỏ, ngân hàng xanh lá…).
  // Ảnh báo tiến độ / hoàn thành: gọn, không có tiền. Thanh tiến độ to (đã lên / tổng, %), số ban đầu → hiện tại, trạng thái.
  async function progressImage(o, inv, kind) {
    const page = App.pageById(o.pageKey), shop = page?.name || o.pageName || inv.shop || 'Cửa hàng';
    const logo = await loadImg(App.pageAvatarUrl(page) || o.pageAvatar);
    const W = 720, P = 28, c = document.createElement('canvas'); let x = c.getContext('2d');
    const font = (w, sz) => `${w} ${sz}px "Plus Jakarta Sans","Inter","Segoe UI",Arial,sans-serif`;
    const fit = (t, maxW, f) => { x.font = f; t = String(t); if (x.measureText(t).width <= maxW) return t; while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    const items = multi(o) ? o.lines.map(l => ({ name: l.displayName, link: l.link || o.link, ord: l.order || l })) : [{ name: o.displayName || o.serviceName || 'Dịch vụ', link: o.link, ord: o }];
    const info = it => { const q = qtyOf(it.ord), d = doneOf(it.ord), st = it.ord.status === 'done' || kind === 'done' && !multi(o) ? 'done' : /pending/i.test(it.ord.svcStatus || '') ? 'wait' : 'run';
      const start = it.ord.startCount != null ? num(it.ord.startCount) : it.ord.baseCount ?? null, real = o._real && items.length === 1 ? o._real.v : null;
      // Số thật trên trang (đã chụp) mới hơn số Baostar báo: đã lên = số thật − số ban đầu.
      const dd = st === 'done' ? q : real != null && start != null ? Math.min(q, Math.max(d ?? 0, real - start)) : d;
      const pct = st === 'done' ? 100 : dd != null && q ? Math.min(100, Math.round(dd / q * 100)) : 0; return { q, d: dd, pct, st, start, real }; };
    const ST = { done: ['HOÀN THÀNH', '#059669', '#d1fae5'], run: ['ĐANG CHẠY', '#6c5ce7', '#ede9fe'], wait: ['CHỜ CHẠY', '#b45309', '#fef3c7'] };
    const one = items.length === 1, rowH = one ? 200 : 120;
    const H = 96 + 24 + items.length * (rowH + 14) + 70;
    c.width = W * 2; c.height = H * 2; x = c.getContext('2d'); x.scale(2, 2);
    x.fillStyle = '#f5f3ff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(P / 2, P / 2, W - P, H - P, 20); x.fill();
    // Đầu
    const g = x.createLinearGradient(P / 2, 0, W - P / 2, 0); g.addColorStop(0, '#6c5ce7'); g.addColorStop(1, '#00b894');
    x.fillStyle = g; x.beginPath(); x.roundRect(P / 2, P / 2, W - P, 82, [20, 20, 0, 0]); x.fill();
    if (logo) { x.save(); x.beginPath(); x.arc(P + 26, P / 2 + 41, 26, 0, Math.PI * 2); x.clip(); x.drawImage(logo, P, P / 2 + 15, 52, 52); x.restore(); }
    const tx = logo ? P + 66 : P + 4;
    x.fillStyle = '#fff'; x.fillText(fit(shop, W - tx - P - 120, font(800, 20)), tx, P / 2 + 38);
    x.font = font(700, 13); x.fillStyle = '#ecfdf5'; x.fillText(kind === 'done' ? 'ĐƠN HÀNG ĐÃ HOÀN THÀNH ✓' : 'CẬP NHẬT TIẾN ĐỘ ĐƠN HÀNG', tx, P / 2 + 62);
    x.font = font(800, 14); x.textAlign = 'right'; x.fillStyle = '#fff'; { const dc = docCode(o, kind); x.fillText(dc.length > 26 ? dc.slice(0, 25) + '…' : dc, W - P - 6, P / 2 + 38); } x.font = font(600, 12); x.fillText(fmtTime(Date.now()), W - P - 6, P / 2 + 60); x.textAlign = 'left';
    let y = P / 2 + 82 + 24;
    for (const it of items) {
      const m = info(it), [stTxt, stCol, stBg] = ST[m.st];
      x.fillStyle = '#fafafe'; x.beginPath(); x.roundRect(P, y, W - P * 2, rowH, 16); x.fill();
      x.strokeStyle = '#ece9fb'; x.lineWidth = 1; x.stroke();
      // Tên dịch vụ + trạng thái
      x.font = font(800, 12); const sw = x.measureText(stTxt).width + 22;
      x.fillStyle = stBg; x.beginPath(); x.roundRect(W - P - 16 - sw, y + 16, sw, 26, 13); x.fill(); x.fillStyle = stCol; x.fillText(stTxt, W - P - 16 - sw + 11, y + 34);
      x.fillStyle = '#111827'; x.fillText(fit(String(it.name).replace(/\s*·\s*\d[\d.,]*\s*$/, ''), W - P * 2 - sw - 48, font(800, one ? 18 : 15)), P + 16, y + 35);
      if (it.link) { x.fillStyle = '#2563eb'; x.fillText(fit(it.link.replace(/^https?:\/\/(www\.)?/, ''), W - P * 2 - 32, font(600, 12)), P + 16, y + 56); }
      // Số lớn: đã lên / tổng
      const by = one ? y + 74 : y + 66;
      if (one) { x.font = font(900, 46); x.fillStyle = stCol; const big = (m.d != null ? m.d : 0).toLocaleString('vi-VN'); x.fillText(big, P + 16, by + 44);
        const bw = x.measureText(big).width; x.font = font(700, 20); x.fillStyle = '#9ca3af'; x.fillText(' / ' + m.q.toLocaleString('vi-VN'), P + 16 + bw, by + 44);
        x.font = font(900, 30); x.textAlign = 'right'; x.fillStyle = stCol; x.fillText(m.pct + '%', W - P - 16, by + 42); x.textAlign = 'left'; }
      // Thanh tiến độ
      const barY = one ? by + 62 : by, barW = W - P * 2 - 32;
      x.fillStyle = '#ece9fb'; x.beginPath(); x.roundRect(P + 16, barY, barW, one ? 16 : 12, 8); x.fill();
      if (m.pct > 0) { const gb = x.createLinearGradient(P + 16, 0, P + 16 + barW, 0); gb.addColorStop(0, m.st === 'done' ? '#10b981' : '#6c5ce7'); gb.addColorStop(1, m.st === 'done' ? '#059669' : '#00b894');
        x.fillStyle = gb; x.beginPath(); x.roundRect(P + 16, barY, Math.max(16, barW * m.pct / 100), one ? 16 : 12, 8); x.fill(); }
      if (!one) { x.font = font(700, 12); x.fillStyle = '#6b7280'; x.fillText(`${(m.d ?? 0).toLocaleString('vi-VN')} / ${m.q.toLocaleString('vi-VN')} · ${m.pct}%`, P + 16, barY + 34); }
      // Số ban đầu → hiện tại
      if (one) { const yy = barY + 46; x.font = font(600, 13); x.fillStyle = '#6b7280';
        x.fillText(m.start != null ? `Ban đầu ${m.start.toLocaleString('vi-VN')}  →  hiện tại ${(m.real ?? (m.start + (m.d || 0))).toLocaleString('vi-VN')}${m.real != null ? ' (số thật trên trang)' : ''}  ·  mục tiêu ${(m.start + m.q).toLocaleString('vi-VN')}` : m.st === 'wait' ? 'Hệ thống đang xếp đơn, thường bắt đầu chạy trong ít phút' : 'Đang cập nhật số ban đầu…', P + 16, yy); }
      y += rowH + 14;
    }
    x.font = font(700, 13); x.fillStyle = '#6c5ce7'; x.textAlign = 'center';
    x.fillText(kind === 'done' ? 'Cảm ơn quý khách đã tin tưởng ủng hộ shop! ❤️' : 'Shop sẽ báo ngay khi đơn hoàn thành · Cảm ơn quý khách!', W / 2, H - P / 2 - 24); x.textAlign = 'left';
    return { dataUrl: c.toDataURL('image/png'), qrMissing: false };
  }
  // Ghép "ảnh thực tế" (app chụp ngầm link của khách: trang TikTok, bài Facebook…) vào dưới ảnh phiếu: báo giá, tiến độ, hoàn thành.
  // Số thật trên trang khách (vd TikTok 56 follower) theo loại dịch vụ: follow → followers, like/tim → likes, view → views, bình luận → comments.
  const metricOf = name => /follow|theo dõi/i.test(name) ? 'followers' : /view|lượt xem|mắt/i.test(name) ? 'views' : /bình luận|comment|cmt/i.test(name) ? 'comments' : /share|chia sẻ/i.test(name) ? 'shares' : /like|tim|thích|cảm xúc/i.test(name) ? 'likes' : '';
  // Đơn "đã chỉnh theo số thật": còn lại = tổng − (số thật − số ban đầu) (không thấp hơn số Baostar đã báo).
  const LABEL = { followers: 'follower', following: 'following', likes: 'lượt thích', views: 'lượt xem', comments: 'bình luận', shares: 'chia sẻ' };
  // Lưu số gốc (trước khi chạy) vào đơn: lần báo tiến độ sau dùng làm "ban đầu" nếu Baostar chưa có số bắt đầu.
  async function saveBase(o, real) {
    const all = await DB.get(ORDERS, []), ids = o.groupIds || [o.id]; let ch = false;
    for (const x of all) if (ids.includes(x.id) && x.baseCount == null) { x.baseCount = real.v; x.baseKey = real.key; x.baseAt = Date.now(); ch = true; }
    if (ch) await DB.set(ORDERS, all);
  }
  function withReal(o, real) {
    if (!real || multi(o) || (o.startCount == null && o.baseCount == null)) return null;
    const q = qtyOf(o), start = o.startCount != null ? num(o.startCount) : o.baseCount, d = doneOf(o) ?? 0, dd = Math.min(q, Math.max(d, real.v - start));
    return { ...o, remains: q - dd, _real: real };
  }
  async function invoiceImage(o, inv, kind, { snap = true } = {}) {
    const link = o.link || o.lines?.find(l => l.link)?.link || '';
    const want = snap && link && ['quote', 'progress', 'done', 'paid', 'new'].includes(kind) && window.metaDesktop?.svcSnap;
    const sn = want ? await window.metaDesktop.svcSnap({ url: link }).catch(() => null) : null;
    // Chụp được số thật → phiếu tiến độ dùng số thật (Baostar báo tiến độ thường chậm hơn trang thật).
    const key = metricOf(o.displayName || o.serviceName || ''), real = sn?.metrics && key && Number.isFinite(sn.metrics[key]) ? { key, v: sn.metrics[key] } : null;
    const res = await invoiceImage0(real && !multi(o) ? { ...o, _real: real } : o, inv, kind);
    if (real) res.real = real;
    if (!want) return res;
    if (!sn?.dataUrl) return { ...res, snapError: sn?.error || 'không chụp được' };
    const [card, shot] = await Promise.all([loadImg(res.dataUrl), loadImg(sn.dataUrl)]); if (!card || !shot) return res;
    const W = card.width, pad = 28 * 2, sw = Math.min(W - pad * 2, 430 * 2 * 1.1), sh = Math.round(shot.height * sw / shot.width), cap = 64;
    const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = W; c.height = card.height + cap + sh + pad;
    x.fillStyle = '#f5f3ff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(card, 0, 0);
    const y0 = card.height - 20;
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(pad / 2, y0, W - pad, cap + sh + pad / 2, 36); x.fill();
    x.fillStyle = '#6c5ce7'; x.font = '800 30px "Plus Jakarta Sans","Inter","Segoe UI",Arial,sans-serif'; x.textAlign = 'center';
    const when = `${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${new Date().toLocaleDateString('vi-VN')}`;
    x.fillText(['paid', 'new', 'quote'].includes(kind) ? `📸 Ảnh gốc trước khi chạy · ${when}${real ? ` · ${real.v.toLocaleString('vi-VN')} ${LABEL[real.key] || ''}` : ''}` : `📸 Ảnh thực tế lúc ${when}`, W / 2, y0 + 46);
    const sx = (W - sw) / 2, sy = y0 + cap;
    x.save(); x.beginPath(); x.roundRect(sx, sy, sw, sh, 24); x.clip(); x.drawImage(shot, sx, sy, sw, sh); x.restore();
    x.strokeStyle = '#e5e7eb'; x.lineWidth = 3; x.beginPath(); x.roundRect(sx, sy, sw, sh, 24); x.stroke();
    return { ...res, dataUrl: c.toDataURL('image/jpeg', 0.9), snapped: true };
  }
  async function invoiceImage0(o, inv, kind) {
    if (kind === 'progress' || kind === 'done') return progressImage(o, inv, kind);
    const page = App.pageById(o.pageKey), shop = page?.name || o.pageName || inv.shop || 'Cửa hàng';
    const [logo, qr] = await Promise.all([loadImg(App.pageAvatarUrl(page) || o.pageAvatar), hasPayBlock(kind) ? loadImg(qrUrl(inv, o)) : null]);
    const W = 760, P = 28, c = document.createElement('canvas'); let x = c.getContext('2d');
    const font = (w, sz) => `${w} ${sz}px "Plus Jakarta Sans","Inter","Segoe UI",Arial,sans-serif`;
    const wrap = (text, maxW, f) => { x.font = f; const out = []; for (const para of String(text).split('\n')) { let line = '';
      for (const w of para.split(/(\s+)/)) { const t = line + w; if (x.measureText(t).width > maxW && line.trim()) { out.push(line.trim()); line = w.trimStart(); } else line = t; }
      out.push(line.trim()); } return out; };
    const C = { violet: '#6c5ce7', blue: '#2563eb', orange: '#ea580c', amber: '#b45309', red: '#dc2626', green: '#059669', teal: '#0d9488', pink: '#db2777', gray: '#6b7280', ink: '#111827' };
    const q = qtyOf(o), hasPay = hasPayBlock(kind) && inv.acc;
    // [nhãn, giá trị, màu]
    const rows = [[kind === 'quote' ? 'Mã thanh toán' : 'Mã đơn', docCode(o, kind), C.red], o.customer?.name ? ['Khách hàng', o.customer.name, C.pink] : null,
      // Ảnh: chỉ tóm tắt (gói, mỗi link, số link) + 3 link đầu; danh sách đủ nằm trong tin nhắn chữ.
      ...(multi(o) ? (({ groups, same }) => groups.length === 1 ? [['Dịch vụ', groups[0].pk, C.violet], ['Link', shortLink(groups[0].link), C.blue], ['Số lượng', groups[0].what, C.orange]]
        : [same ? ['Dịch vụ', groups[0].pk, C.violet] : null, same ? ['Mỗi link', `${groups[0].what} · ${money(groups[0].sell)}`, C.orange] : null, ['Số link', `${groups.length} link`, C.orange],
          ...groups.slice(0, 3).map((g, i) => [`Link ${i + 1}`, shortLink(g.link) + (same ? '' : ` · ${g.what} · ${money(g.sell)}`), C.blue]),
          groups.length > 3 ? ['Còn lại', `${groups.length - 3} link khác (xem tin nhắn)`, C.gray] : null])(linkGroups(o))
        : [['Dịch vụ', o.displayName || o.items?.[0]?.name || 'Dịch vụ', C.violet], o.link ? ['Link', o.link, C.blue] : null, ['Số lượng', q.toLocaleString('vi-VN'), C.orange]]),
      [kind === 'quote' ? 'Ngày báo giá' : 'Ngày tạo', fmtTime(o.at), C.gray],
      kind === 'quote' ? ['Hạn thanh toán', fmtTime(o.expiresAt), C.amber] : null,
      kind === 'quote' && o.renewEnd ? ['Gói hiện tại hết hạn', fmtTime(o.renewEnd), C.amber] : null, o.termMonths && kind === 'quote' ? ['Thời hạn', o.termMonths + ' tháng', C.teal] : null,
      kind === 'paid' ? ['Đã thanh toán', money(o.paidAmount || orderSell(o)), C.green] : null, kind !== 'quote' && o.vipEnd ? ['Hạn sử dụng đến', fmtTime(o.vipEnd), C.amber] : null,
      multi(o) && o.group ? null : ['Trạng thái', progressLine(o), C.teal]].filter(Boolean);
    const due = kind === 'quote' && o.paidAmount, amount = money(due ? amountDue(o) : kind === 'paid' ? (o.paidAmount || orderSell(o)) : orderSell(o));
    const amountLabel = due ? 'CÒN PHẢI TRẢ' : kind === 'paid' ? 'ĐÃ THANH TOÁN' : hasPay ? 'SỐ TIỀN CẦN CHUYỂN' : 'THÀNH TIỀN';
    const QR = 470;
    // Vẽ 2 lượt: lượt 1 chỉ đo chiều cao, lượt 2 vẽ thật.
    const render = draw => {
      const fill = (col, f) => { x.fillStyle = col; if (f) x.font = f; };
      const text = (t, tx, ty, col, f, align = 'left') => { if (!draw) return; fill(col, f); x.textAlign = align; x.fillText(t, tx, ty); x.textAlign = 'left'; };
      const box = (bx, by, bw, bh, r, col) => { if (!draw) return; x.fillStyle = col; x.beginPath(); x.roundRect(bx, by, bw, bh, r); x.fill(); };
      let y = P / 2;
      // Đầu: dải màu + ảnh Page + tên + loại phiếu
      if (draw) { const g = x.createLinearGradient(P / 2, 0, W - P / 2, 0); g.addColorStop(0, '#6c5ce7'); g.addColorStop(1, '#00b894'); x.fillStyle = g; x.beginPath(); x.roundRect(P / 2, y, W - P, 84, [18, 18, 0, 0]); x.fill();
        if (logo) { x.save(); x.beginPath(); x.arc(P + 28, y + 42, 28, 0, Math.PI * 2); x.clip(); x.drawImage(logo, P, y + 14, 56, 56); x.restore(); } }
      const tx0 = logo ? P + 70 : P + 4;
      text(shop.length > 36 ? shop.slice(0, 35) + '…' : shop, tx0, y + 38, '#fff', font(800, 22));
      text(kind === 'quote' && o.renewOf ? 'GIA HẠN DỊCH VỤ · CHỜ THANH TOÁN' : KIND_HEAD[kind] || KIND_HEAD.new, tx0, y + 64, '#ecfdf5', font(700, 14));
      y += 84 + 22;
      // Số tiền nổi bật
      text(amountLabel, W / 2, y + 4, C.gray, font(800, 14), 'center');
      text(amount, W / 2, y + 46, kind === 'paid' ? C.green : C.violet, font(900, 40), 'center');
      y += hasPay ? 80 : 66;
      if (hasPay) {
        // Mã QR to ở giữa, viền màu
        const qx = (W - QR) / 2;
        if (draw) { const g = x.createLinearGradient(qx, y, qx + QR, y + QR); g.addColorStop(0, '#6c5ce7'); g.addColorStop(1, '#00b894'); x.fillStyle = g; x.beginPath(); x.roundRect(qx - 10, y - 10, QR + 20, QR + 20, 22); x.fill(); }
        box(qx - 4, y - 4, QR + 8, QR + 8, 16, '#fff');
        if (draw && qr) x.drawImage(qr, qx + 6, y + 6, QR - 12, QR - 12);
        if (!qr) text('Không tải được mã QR — chuyển khoản theo thông tin bên dưới', W / 2, y + QR / 2, C.red, font(700, 15), 'center');
        y += QR + 26;
        text('📱 Mở app ngân hàng › Quét mã QR', W / 2, y, C.gray, font(700, 14), 'center'); y += 22;
        // Nội dung chuyển khoản: thẻ đỏ to
        const code = 'Nội dung CK: ' + payCode(o); x.font = font(900, 22); const cw = x.measureText(code).width + 40;
        box((W - cw) / 2, y, cw, 42, 21, '#fee2e2'); text(code, W / 2, y + 29, C.red, font(900, 22), 'center'); y += 58;
        // Ngân hàng · STK · chủ TK: 3 ô màu
        const cells = [['Ngân hàng', bankName(inv.bin) || inv.bin, C.blue, '#eff6ff'], ['Số tài khoản', inv.acc, C.ink, '#f3f4f6'], inv.holder ? ['Chủ tài khoản', inv.holder, C.green, '#ecfdf5'] : null].filter(Boolean);
        const gap = 10, cw2 = (W - P * 2 - gap * (cells.length - 1)) / cells.length;
        cells.forEach(([k, v, col, bg], i) => { const bx = P + i * (cw2 + gap); box(bx, y, cw2, 62, 12, bg); text(k, bx + 12, y + 22, C.gray, font(700, 12));
          x.font = font(800, 16); let t = String(v); while (t.length > 3 && x.measureText(t).width > cw2 - 24) t = t.slice(0, -2) + '…'; text(t, bx + 12, y + 46, col, font(800, 16)); });
        y += 62 + 22;
      }
      // Chi tiết đơn: nhãn màu (chấm + chữ), giá trị đậm
      const valW = W - P * 2 - 160;
      if (draw) { x.strokeStyle = '#e5e7eb'; x.beginPath(); x.moveTo(P + 4, y - 8); x.lineTo(W - P - 4, y - 8); x.stroke(); }
      y += 14;
      for (const [k, v, col] of rows) {
        const lines = wrap(v, valW, font(700, 15));
        if (draw) { x.fillStyle = col; x.beginPath(); x.arc(P + 10, y - 5, 4, 0, Math.PI * 2); x.fill(); }
        text(k, P + 22, y, col, font(800, 13));
        lines.forEach((l, j) => text(l, P + 160, y + j * 22, k === 'Link' || k === 'Link chung' ? C.blue : C.ink, font(700, 15)));
        y += lines.length * 22 + 10;
      }
      if (inv.note) {
        const nl = wrap(inv.note.trim(), W - P * 2 - 28, font(500, 13)); y += 6;
        box(P, y, W - P * 2, nl.length * 19 + 34, 12, '#fff7e6');
        text('📌 Lưu ý', P + 14, y + 22, '#8a5a00', font(800, 13)); nl.forEach((l, i) => text(l, P + 14, y + 42 + i * 19, '#8a5a00', font(500, 13)));
        y += nl.length * 19 + 46;
      }
      y += 8; text(kind === 'quote' ? '⏳ Shop lên đơn ngay khi nhận được thanh toán · Cảm ơn quý khách!' : 'Cảm ơn quý khách! ' + shop, W / 2, y + 10, C.violet, font(700, 13), 'center');
      return y + 30;
    };
    const H = Math.ceil(render(false) + P / 2);
    c.width = W * 2; c.height = H * 2; x = c.getContext('2d'); x.scale(2, 2);
    x.fillStyle = '#f3f1ff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(P / 2, P / 2, W - P, H - P, 18); x.fill();
    render(true);
    return { dataUrl: c.toDataURL('image/png'), qrMissing: hasPay && !qr };
  }
  async function invoiceDialog(o, kind = 'new') {
    const inv = (await settings()).invoice || {};
    const dlg = h('dialog', { className: 'svc-dialog svc-invoice', onclose: () => dlg.remove() });
    const text = h('textarea', { rows: 11, value: invoiceText(o, inv, kind) }); text.dataset.orig = text.value;
    const img = h('img', { alt: 'Ảnh hoá đơn', className: 'svc-inv-img' }), hint = h('div', { className: 'hint' }), withImg = h('input', { type: 'checkbox', checked: true });
    let image = '';
    // Vẽ phiếu ngay; rồi chụp "ảnh thực tế" link khách (vài giây) và ghép vào nếu được.
    const snapNow = async () => { if (!window.metaDesktop?.svcSnap || !['quote', 'progress', 'done', 'paid', 'new'].includes(kind) || !(o.link || o.lines?.some(l => l.link))) return;
      const keep = hint.textContent; hint.textContent = (keep ? keep + ' ' : '') + '📸 Đang chụp ảnh thực tế của link khách…';
      const r = await invoiceImage(o, inv, kind).catch(() => null);
      if (r?.snapped) { image = r.dataUrl; img.src = image; hint.textContent = keep + (keep ? ' ' : '') + '📸 Đã ghép ảnh thực tế.';
        // Tin chữ chưa sửa tay → viết lại theo số thật trên trang (vd "đã lên 17/500", "Số thật trên trang: 63 follower").
        const o2 = ['paid', 'new', 'quote'].includes(kind) ? null : withReal(o, r.real);
        if (r.real && !o2 && ['paid', 'new', 'quote'].includes(kind) && text.value === text.dataset.orig) {
          // Báo đã nhận tiền / xác nhận đơn: ghi SỐ GỐC (số trên trang trước khi chạy) để khách đối chiếu, lưu vào đơn.
          const line = `• Số gốc trước khi chạy (${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}): ${r.real.v.toLocaleString('vi-VN')} ${LABEL[r.real.key] || ''}`, t0 = text.value, cut = t0.indexOf('\n\n');
          text.value = cut > 0 ? t0.slice(0, cut) + '\n' + line + t0.slice(cut) : t0 + '\n' + line; text.dataset.orig = text.value; hint.textContent += ' Đã thêm số gốc.';
          saveBase(o, r.real).catch(() => {});
        }
        if (o2 && text.value === text.dataset.orig) { const line = `• Số thật trên trang lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}: ${r.real.v.toLocaleString('vi-VN')} ${LABEL[r.real.key] || ''}`, t0 = invoiceText(o2, inv, kind), cut = t0.indexOf('\n\n');
          text.value = cut > 0 ? t0.slice(0, cut) + '\n' + line + t0.slice(cut) : t0 + '\n' + line; text.dataset.orig = text.value; hint.textContent += ' Tin chữ đã cập nhật theo số thật.'; } }
      else hint.textContent = keep + (keep ? ' ' : '') + `📸 Không chụp được ảnh thực tế (${r?.snapError || 'lỗi'}), gửi ảnh phiếu thôi.`; };
    const render = async () => { hint.textContent = 'Đang vẽ ảnh hoá đơn…'; const r = await invoiceImage(o, inv, kind, { snap: false }); image = r.dataUrl; img.src = image; setTimeout(() => snapNow(), 0);
      hint.textContent = [r.qrMissing ? 'Không tải được mã QR (kiểm tra mạng hoặc số tài khoản); đơn vẫn có thông tin chuyển khoản.' : '', !inv.acc && hasPayBlock(kind) ? 'Chưa có thông tin thanh toán: thêm ở Dịch vụ › Cài đặt › Hoá đơn gửi khách.' : ''].filter(Boolean).join(' '); };
    const openKey = App.inbox?.openKey?.() || '', canSend = o.customerKey && openKey === o.customerKey;
    const sendBtn = h('button', { type: 'button', className: 'btn btn-primary', textContent: '📨 Gửi vào hội thoại', disabled: !canSend,
      title: canSend ? 'Gửi chữ + ảnh vào hội thoại đang mở' : 'Mở hội thoại của khách này trong Hộp thư để gửi thẳng; hoặc Copy / Tải ảnh',
      onclick: async () => { sendBtn.disabled = true; sendBtn.textContent = 'Đang gửi…';
        let ok = await App.inbox.compose({ key: o.customerKey, text: text.value.trim(), image: withImg.checked ? image : '' });
        // Ảnh không vào được Business Suite (chưa gửi gì): hỏi gửi chữ trước, ảnh gửi tay bằng Copy ảnh.
        if (ok !== true && withImg.checked && /ảnh/i.test(String(ok)) && !/Chữ đã gửi/.test(String(ok)) && confirm(`${ok}\n\nGửi riêng phần chữ (không kèm ảnh) ngay bây giờ?`)) {
          withImg.checked = false; ok = await App.inbox.compose({ key: o.customerKey, text: text.value.trim(), image: '' });
          if (ok === true) toast('Đã gửi chữ. Ảnh: bấm Copy ảnh rồi dán vào hội thoại trong cột Meta.', 8000);
        }
        if (ok === true) { toast('Đã gửi đơn vào hội thoại.'); await markSent(o, kind); dlg.close(); }
        else { sendBtn.disabled = false; sendBtn.textContent = '📨 Gửi vào hội thoại'; toast(`Chưa gửi được: ${typeof ok === 'string' ? ok : 'hội thoại của khách không còn mở trong Hộp thư.'}`, 8000); } } });
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
  function paymentDialog(q0) {
    let q = q0;
    const dlg = h('dialog', { className: 'svc-dialog', onclose: () => dlg.remove() });
    const amt = h('input', { type: 'number', min: 0, step: 'any', value: amountDue(q), required: true });
    const note = h('input', { type: 'text', placeholder: 'Ghi chú (vd: CK lúc 19:05, Vietcombank)' });
    const msg = h('div', { className: 'svc-sum' }), acts = h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' });
    const record = async (state, extra = '') => {
      const fresh = (await quotes()).find(x => x.id === q.id);
      if (!fresh) { dlg.close(); return toast('Báo giá này đã được tạo đơn hoặc đã huỷ.', 5000); }
      if (fresh.state === 'paid' && fresh.paidAmount !== q.paidAmount) { dlg.close(); return toast('Báo giá vừa được ghi nhận tiền ở nơi khác. Mở lại để xem số mới.', 6000); }
      q = fresh;
      const add = Number(amt.value) || 0, total = (q.paidAmount || 0) + add;
      Object.assign(q, { paidAmount: total, paidAt: Date.now(), state, payNote: [q.payNote, note.value.trim(), extra].filter(Boolean).join(' · ') });
      await saveQuote(q); dlg.close(); App.tabs.services?.refresh?.();
      if (state === 'paid') addNudge(q.customerKey, 'paid', q.id).catch(() => {});
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
  // Kiểm tra & tạo đơn: mỗi dòng của báo giá = 1 đơn Baostar. Tạo lần lượt; dòng lỗi giữ lại để thử lại, dòng khác vẫn tạo.
  async function confirmCreate(q0, opts = {}) {
    let q = q0;
    const s = await settings();
    let list = []; try { list = await services(); } catch (e) { return toast(e.message, 7000); }
    const dlg = h('dialog', { className: 'svc-dialog', onclose: () => dlg.remove() });
    const box = h('div', { className: 'svc-lines' }), checks = h('div', { className: 'svc-checks' }), err = h('div', { className: 'status err', hidden: true });
    const btn = h('button', { type: 'button', className: 'btn btn-primary' });
    const alt = new Map(); // máy chủ đổi tay cho từng dòng (khi máy chủ gốc bảo trì)
    // Sửa tay từng dòng khi tạo đơn: số lượng, link, bình luận, tên khách thấy. Chỉ dùng cho đơn Baostar lần này — báo giá đã lưu và tiền khách không đổi
    // (đổi số lượng thì giá gốc / lãi tính lại theo số mới).
    const edits = new Map(), opened = new Set();
    // Tách / thêm lúc tạo đơn: mỗi phần là 1 đơn Baostar riêng (máy chủ, link, số lượng riêng). Phần thêm không tính tiền khách (sell 0)
    // → tổng tiền khách giữ nguyên, giá gốc / lãi tính theo các phần thực tạo.
    const extras = [];
    const isExtra = l => extras.some(x => x.id === l.id);
    const eff = l => { const e = edits.get(l.id); return !e || l.done ? l : { ...l, ...e, ...(e.qty != null && Number(e.qty) !== Number(l.qty) ? { costManual: false } : {}) }; };
    let balance = null, balNote = '', busy = false;
    const sid = l => alt.get(l.id) || String(l.serviceId);
    const svcOf = l => list.find(x => x.id === sid(l));
    const lines = () => [...linesOf(q).map(eff), ...extras.filter(x => !linesOf(q).some(y => y.id === x.id))];
    const setEdit = (l, k, v) => { const ex = extras.find(x => x.id === l.id); if (ex) { ex[k] = k === 'qty' ? Math.max(0, Math.round(Number(v) || 0)) : v; return; }
      const base = linesOf(q).find(y => y.id === l.id) || {}, e = { ...(edits.get(l.id) || {}) };
      if (String(v) === String(base[k] ?? '')) delete e[k]; else e[k] = k === 'qty' ? Math.max(0, Math.round(Number(v) || 0)) : v;
      if (Object.keys(e).length) edits.set(l.id, e); else edits.delete(l.id); };
    const editForm = l => { const x = svcOf(l), base = linesOf(q).find(y => y.id === l.id) || l, extra = isExtra(l);
      const inp = (k, label, attrs = {}) => h('label', { className: 'field', style: attrs.style || '' }, label,
        h(attrs.area ? 'textarea' : 'input', { ...(attrs.area ? { rows: 4 } : { type: attrs.type || 'text' }), value: l[k] ?? '', ...(attrs.min ? { min: attrs.min } : {}),
          oninput: e => setEdit(l, k, e.target.value), onchange: () => draw() }));
      return h('div', { className: 'svc-line-edit' },
        h('div', { className: 'row', style: 'gap:8px;flex-wrap:wrap' },
          inp('qty', `Số lượng${x ? ` (${Number(x.min).toLocaleString('vi-VN')}–${Number(x.max).toLocaleString('vi-VN')})` : ''}`, { type: 'number', min: 1, style: 'flex:1;min-width:120px' }),
          inp('displayName', 'Tên dịch vụ khách thấy', { style: 'flex:2;min-width:180px' })),
        inp('link', 'Link'),
        x && needsComments(x) ? inp('comments', 'Nội dung bình luận (mỗi dòng 1 bình luận)', { area: true }) : null,
        h('div', { className: 'row', style: 'gap:8px;align-items:center' },
          h('span', { className: 'hint', style: 'flex:1', textContent: extra ? 'Phần tách / thêm: tạo thành 1 đơn Baostar riêng, không tính thêm tiền khách. Đổi máy chủ ở nút bên trên.'
            : `Gốc: ${base.displayName} · ${Number(base.qty).toLocaleString('vi-VN')} · ${base.link}. Tiền khách giữ nguyên; chỉ dùng khi tạo đơn lần này (báo giá không đổi).` }),
          !extra && edits.has(l.id) ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Hoàn tác', onclick: () => { edits.delete(l.id); draw(); } }) : null,
          h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: 'Xong', onclick: () => { opened.delete(l.id); draw(); } }))); };
    let checking = false;
    const cat = await DB.get(WEBCAT, null);
    if (window.metaDesktop?.svcCatalog && (!cat?.at || Date.now() - cat.at > 30 * 60e3)) {
      checking = true;
      webCatalog(true).then(() => services()).then(l => { list = l; }).catch(() => {}).finally(() => { checking = false; draw(); });
    }
    // Tiến độ khi đang tạo: thanh % + số đã tạo / lỗi; từng dòng ghi Đang tạo… / ✓ Đã tạo #mã / ✗ Lỗi (kèm lý do).
    let run = null; const runErr = new Set();
    const prog = h('div', { className: 'svc-prog', hidden: true });
    const drawProg = () => { prog.hidden = !run; if (!run) return; const pct = run.total ? Math.round(run.done / run.total * 100) : 0;
      prog.replaceChildren(h('div', { className: 'svc-prog-top' },
          h('strong', { textContent: run.cur ? `Đang tạo đơn ${Math.min(run.done + 1, run.total)}/${run.total}…` : `Xong: ${run.ok}/${run.total} đơn đã tạo` }),
          h('span', {}, h('span', { className: 'pos', textContent: `✓ ${run.ok} thành công` }), run.fail ? h('span', { className: 'neg', textContent: ` · ✗ ${run.fail} lỗi` }) : null)),
        h('div', { className: 'svc-prog-bar' }, h('span', { style: `width:${pct}%`, className: run.fail ? 'warn' : '' })),
        run.last ? h('div', { className: 'hint', textContent: run.last }) : null); };
    const lineCheck = l => { const x = svcOf(l), n = Number(l.qty) || 0;
      if (l.done) return null;
      if (!x) return 'Không còn máy chủ này';
      if (!checking && stateOf(x)[1] === 'err') return 'Máy chủ đang bảo trì';
      if (n < x.min || n > x.max) return `Số lượng phải ${x.min}–${x.max}`;
      if (needsComments(x) && !commentLines(l.comments).length) return 'Máy chủ cần nội dung bình luận';
      return ''; };
    const draw = () => {
      const ls = lines(), pending = ls.filter(l => !l.done), bad = pending.filter(l => lineCheck(l));
      const nowCost = pending.reduce((t, l) => t + (svcOf(l) ? estCost(svcOf(l), Number(l.qty) || 0) : 0), 0);
      const quotedCost = pending.reduce((t, l) => t + (Number(l.cost) || 0), 0), sell = sumOf(ls, 'sell');
      drawProg();
      box.replaceChildren(...ls.map((l, i) => { const x = svcOf(l), why = lineCheck(l), now = run?.cur === l.id, failed = run && runErr.has(l.id) && !l.done;
        const [st, cls] = now ? ['⏳ Đang tạo…', 'pending'] : l.done ? [`✓ Đã tạo #${l.done.providerOrderId}`, 'ok'] : failed ? ['✗ Lỗi', 'err'] : run && run.todo.has(l.id) ? ['Chờ tạo', 'pending'] : x ? stateOf(x) : ['Không còn máy chủ', 'err'];
        return h('div', { className: 'svc-line' + (l.done ? ' done' : why || failed ? ' bad' : '') + (now ? ' now' : ''), dataset: { lid: l.id } },
          h('span', { className: 'svc-line-no', textContent: String(i + 1) }), x ? platBadge(x.platform, 20) : null,
          h('span', { className: 'cp-main' }, h('span', { className: 'cp-title', textContent: `${l.displayName} · ${Number(l.qty).toLocaleString('vi-VN')}` }),
            h('span', { className: 'cp-sub', textContent: `${l.extra ? '⑂ phần thêm · ' : ''}MC ${sid(l)}${alt.has(l.id) ? ' (đã đổi)' : ''} · ${l.link}${edits.has(l.id) && !l.done ? ' · ✏ đã sửa' : ''}` }),
            l.error && !l.done ? h('span', { className: 'neg hint', textContent: (failed ? '✗ ' : 'Lỗi lần trước: ') + l.error }) : null,
            why ? h('span', { className: 'neg hint', textContent: '✗ ' + why }) : null),
          h('span', { className: 'status svc-pill ' + (l.done ? 'ok' : cls), textContent: checking && !l.done ? '…' : st }),
          l.done || busy ? null : h('span', { className: 'row', style: 'gap:4px;flex:none' },
            h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '⑂ Tách', title: 'Chia dòng này thành 2 đơn (khác máy chủ / link / số lượng)', disabled: busy, onclick: () => {
              const n = Number(l.qty) || 0, half = Math.floor(n / 2);
              if (!isExtra(l) && n > 1) setEdit(l, 'qty', n - half); else if (isExtra(l) && n > 1) l.qty = n - half;
              const part = { ...l, id: uid('ln'), qty: half || n, sell: 0, listPrice: 0, cost: 0, costManual: false, done: null, error: '', extra: true };
              if (alt.has(l.id)) alt.set(part.id, alt.get(l.id));
              extras.splice(extras.indexOf(extras.find(x => x.id === l.id)) + 1 || extras.length, 0, part); opened.add(part.id); draw(); } }),
            isExtra(l) ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '✕', title: 'Bỏ phần này', disabled: busy, onclick: () => { extras.splice(extras.findIndex(x => x.id === l.id), 1); opened.delete(l.id); alt.delete(l.id); draw(); } }) : null,
            h('button', { type: 'button', className: 'btn btn-ghost btn-sm' + (opened.has(l.id) ? ' on' : ''), textContent: '✏ Sửa', title: 'Sửa số lượng, link, bình luận, tên khách thấy', disabled: busy,
              onclick: () => { if (opened.has(l.id)) opened.delete(l.id); else opened.add(l.id); draw(); } }),
            h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Đổi máy chủ', disabled: busy, onclick: async () => {
              const v = await pickServerDialog(list.filter(y => stateOf(y)[1] !== 'err' || y.id === sid(l)), sid(l)); if (v) { alt.set(l.id, v); draw(); } } })),
          !l.done && opened.has(l.id) && !busy ? editForm(l) : null); }));
      const rows = [
        [checking ? '…' : bad.length ? '✗' : '✓', checking ? 'Đang kiểm tra trạng thái máy chủ mới nhất trên web…' : bad.length ? `${bad.length} dòng chưa tạo được (xem dòng đỏ, bấm Đổi máy chủ)` : `${pending.length} đơn sẵn sàng tạo`, !checking && !!bad.length],
        [nowCost > quotedCost * 1.001 ? '!' : '✓', `Giá gốc bây giờ ≈ ${money(nowCost)} (lúc báo giá ${money(quotedCost)}) · lãi cả báo giá ≈ ${money(sell - sumOf(ls.filter(l => l.done), 'cost') - nowCost)}`, sell - nowCost < 0],
        [typeof balance === 'number' ? (balance >= nowCost ? '✓' : '✗') : '…', typeof balance === 'number' ? `Số dư Baostar ${money(balance)}${balNote ? ` (${balNote})` : ''}${balance < nowCost ? ` · thiếu ${money(nowCost - balance)} cho ${pending.length} đơn` : ''}` : balance ? 'Không đọc được số dư: ' + balance : 'Đang đọc số dư…', typeof balance === 'number' && balance < nowCost],
        ['💰', `Đã thu ${money(q.paidAmount)} / ${money(q.sell)}${q.payNote ? ' · ' + q.payNote : ''}`, false]];
      checks.replaceChildren(...rows.map(([ic, t, b]) => h('div', { className: b ? 'neg' : '' }, h('strong', { textContent: ic + ' ' }), t)));
      const ok = pending.filter(l => !lineCheck(l)).length;
      btn.textContent = busy ? 'Đang tạo đơn…' : ls.some(l => l.error && !l.done) ? `Thử lại ${ok} đơn` : `Tạo ${ok} đơn Baostar`;
      btn.disabled = busy || checking || !ok;
    };
    vndBalance().then(r => { balance = Number.isFinite(r.v) ? r.v : (r.why || 'không rõ'); balNote = r.note || ''; draw(); }).catch(e => { balance = e.message; draw(); });
    const orderFor = (x, l, r, q, ls) => {
      const n = Number(l.qty), cost = l.costManual && String(x.id) === String(l.serviceId) ? Number(l.cost) : estCost(x, n);
      const share = q.sell ? (Number(l.sell) || 0) / q.sell : 1 / ls.length;
      return { id: uid('ord'), at: Date.now(), updatedAt: Date.now(), source: 'service', provider: new URL(s.apiUrl).hostname, providerOrderId: String(r.order),
        payCode: q.payCode, quoteLineId: l.id, groupSize: ls.length, quoteAt: q.at, paidAmount: Math.round((q.paidAmount || 0) * share), paidAt: q.paidAt, payNote: q.payNote || '', listPrice: l.listPrice || 0,
        comments: l.comments || '', refillable: !!x.refill || warrantyName(x.name), termMonths: l.termMonths || 0, vipEnd: l.termMonths ? addMonths(Date.now(), l.termMonths) : 0, renewOf: q.renewOf || '',
        serviceId: x.id, serviceName: x.name, displayName: l.displayName, packageId: l.packageId, link: l.link, customerKey: q.customerKey, pageKey: q.pageKey, pageName: q.pageName, pageAvatar: q.pageAvatar,
        customer: { name: q.customer?.name || '', phone: '', address: '' }, items: [{ name: l.displayName, qty: n, price: (Number(l.sell) || 0) / n, cost: cost / n }], costManual: !!l.costManual,
        discount: 0, shipFee: 0, shipCost: 0, status: 'new', svcStatus: 'Pending', note: `Đơn dịch vụ #${r.order} · ${q.payCode}${ls.length > 1 ? ` · dòng ${ls.findIndex(y => y.id === l.id) + 1}/${ls.length}` : ''}` };
    };
    btn.onclick = async () => {
      const todo = lines().filter(l => !l.done && !lineCheck(l));
      if (!todo.length) return;
      if (creating.has(q.id)) return toast('Báo giá này đang được tạo đơn ở cửa sổ khác. Đợi vài giây rồi xem lại danh sách.', 7000);
      const est = todo.reduce((t, l) => t + estCost(svcOf(l), Number(l.qty)), 0);
      if (!confirm(`Tạo ${todo.length} đơn trên Baostar?\n\n${todo.map((l, i) => `${i + 1}. MC ${sid(l)} · ${l.displayName} · ${Number(l.qty).toLocaleString('vi-VN')}${edits.has(l.id) ? `\n   ✏ đã sửa · ${l.link}` : ''}`).join('\n')}\n\nBaostar sẽ trừ khoảng ${money(est)}.`)) return;
      if (creating.has(q.id)) return toast('Báo giá này đang được tạo đơn ở cửa sổ khác.', 7000);
      creating.add(q.id); busy = true; err.hidden = true; runErr.clear();
      run = { total: todo.length, done: 0, ok: 0, fail: 0, cur: '', last: '', todo: new Set(todo.map(l => l.id)) }; draw();
      const made = [];
      try {
        // Chống tạo trùng: báo giá phải còn, không cửa sổ nào khác đang tạo; mỗi dòng kiểm tra đơn cùng mã thanh toán + dòng.
        const fresh = (await quotes()).find(y => y.id === q.id);
        if (!fresh) { dlg.close(); App.tabs.services?.refresh?.(); return toast('Báo giá này đã được tạo đơn hoặc đã huỷ.', 7000); }
        if (fresh.creatingAt && Date.now() - fresh.creatingAt < 180e3) return toast('Báo giá này đang được tạo đơn ở cửa sổ khác. Đợi vài giây rồi xem lại danh sách.', 7000);
        q = fresh; q.lines = linesOf(q);
        for (const x of extras) if (!q.lines.some(y => y.id === x.id) && todo.some(t => t.id === x.id)) { const { extra, ...keep } = x; q.lines.push({ ...keep, serviceId: sid(x), split: true }); } // phần tách / thêm thành dòng thật (thử lại không tạo trùng)
        q.creatingAt = Date.now(); await saveQuote(q);
        const multi = !!fresh.lines?.length;
        for (const l of q.lines) {
          if (l.done || !todo.some(t => t.id === l.id)) continue;
          const L = eff(l), x = svcOf(L); if (!x || lineCheck(L)) { run.done++; continue; } // L = dòng đã sửa tay (số lượng, link…), l = dòng của báo giá (ghi trạng thái đã tạo)
          run.cur = l.id; draw(); box.querySelector(`[data-lid="${l.id}"]`)?.scrollIntoView({ block: 'nearest' });
          const short = `${L.displayName} · ${Number(L.qty).toLocaleString('vi-VN')} · ${shortLink(L.link)}`;
          const dup = (await DB.get(ORDERS, [])).find(o => o.payCode === q.payCode && (multi ? o.quoteLineId === l.id : true));
          if (dup) { l.done = { orderId: dup.id, providerOrderId: dup.providerOrderId }; l.error = ''; await saveQuote(q); run.done++; run.ok++; run.last = `✓ Đã có sẵn #${dup.providerOrderId}: ${short}`; continue; }
          try {
            const r = await call('add', { service: Number(x.id), link: L.link, quantity: Number(L.qty), ...(needsComments(x) ? { comments: L.comments || '' } : {}) });
            if (r && !r.order) r.order = r.order_id ?? r.orderId ?? r.id;
            if (!r?.order) throw Error('Web dịch vụ không trả mã đơn.');
            const order = orderFor(x, L, r, q, q.lines);
            await DB.set(ORDERS, [...await DB.get(ORDERS, []), order]);
            made.push(order); l.done = { orderId: order.id, providerOrderId: order.providerOrderId }; l.error = '';
            run.ok++; run.last = `✓ Đã tạo #${order.providerOrderId}: ${short}`;
          } catch (e2) { l.error = e2.message; runErr.add(l.id); run.fail++; run.last = `✗ Lỗi: ${short} · ${e2.message}`; }
          run.done++; await saveQuote(q); draw();
        }
        run.cur = ''; draw();
        const left = q.lines.filter(l => !l.done);
        q.creatingAt = 0;
        if (q.customerKey && made.length) App.crm?.update?.(q.customerKey, { orderStatus: 'Đã đặt hàng' }).catch(() => {});
        if (!left.length) {
          await dropQuote(q.id);
          if (q.renewOf) { const all = await DB.get(ORDERS, []), old = all.find(o => o.id === q.renewOf); if (old) { old.renewedBy = made[0]?.id || q.lines[0].done.orderId; await DB.set(ORDERS, all); } }
          await new Promise(r => setTimeout(r, 1200)); // để thấy "Xong: n/n" trước khi chuyển sang khung gửi khách
          dlg.close(); toast(`Đã tạo ${q.lines.length > 1 ? `đủ ${q.lines.length} đơn` : `đơn #${made[0]?.providerOrderId || ''}`} trên Baostar.`, 5000);
          await refreshStatus(made).catch(() => {});
          App.tabs.services?.refresh?.();
          const group = await groupOf(q.payCode);
          if (group) invoiceDialog(group, 'paid');
        } else {
          q.lastError = `Đã tạo ${q.lines.length - left.length}/${q.lines.length} đơn · ${left.length} dòng lỗi chờ thử lại`; await saveQuote(q); App.tabs.services?.refresh?.();
          err.textContent = `${made.length ? `Đã tạo ${made.length} đơn. ` : ''}Còn ${left.length} dòng chưa tạo được (lỗi ghi ở từng dòng). Báo giá vẫn ở "Đã thu, chưa tạo đơn". Nếu lỗi do mạng, xem Lịch sử đơn trên Baostar trước khi bấm Thử lại để tránh tạo trùng.`;
          err.hidden = false;
          if (made.length) refreshStatus(made).catch(() => {});
        }
      } finally { busy = false; creating.delete(q.id); if (dlg.open) draw(); }
    };
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: `Kiểm tra & tạo đơn · ${q.payCode}` }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('p', { className: 'hint', textContent: `${q.customer?.name || 'Khách'} · ${lines().length} dịch vụ · mỗi dòng là 1 đơn Baostar` }),
      prog, box,
      h('div', { className: 'row', style: 'gap:6px;margin:-2px 0 4px' }, h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: '＋ Thêm dịch vụ / máy chủ', title: 'Thêm 1 đơn Baostar nữa vào lần tạo này (không tính thêm tiền khách)',
        onclick: async () => { if (busy) return; const v = await pickServerDialog(list.filter(y => stateOf(y)[1] !== 'err'), ''); if (!v) return; const x = list.find(y => y.id === v), first = linesOf(q)[0] || {};
          const part = { id: uid('ln'), serviceId: v, serviceName: x?.name || '', displayName: x?.category || x?.name || 'Dịch vụ', link: first.link || q.link || '', qty: x?.min || 100, sell: 0, cost: 0, listPrice: 0,
            costManual: false, comments: '', packageId: '', termMonths: 0, extra: true };
          extras.push(part); opened.add(part.id); draw(); } }),
        h('span', { className: 'hint', textContent: '⑂ Tách: chia 1 dòng ra nhiều máy chủ / link / số lượng. Tiền khách không đổi.' })),
      checks, err,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end' }, h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Để sau', onclick: () => dlg.close() }), btn));
    document.body.append(dlg); dlg.showModal(); draw();
    // Tự tạo đơn (Telegram đã xác nhận): bấm nút tạo, tự đồng ý các hộp hỏi lại trong lúc tạo, trả kết quả.
    if (opts.auto) { const c0 = window.confirm; window.confirm = () => true; try { await btn.onclick(); } finally { window.confirm = c0; }
      const r = { ok: run?.ok || 0, fail: run?.fail || 0, total: run?.total || 0, last: run?.last || '' }; setTimeout(() => { if (dlg.open) dlg.close(); }, 3000); return r; }
  }
  // Nhóm các đơn cùng mã thanh toán thành 1 "đơn" để gửi khách 1 hoá đơn (lines = từng đơn).
  async function groupOf(code, orders) {
    const all = (orders || await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.payCode === code);
    if (!all.length) return null;
    if (all.length === 1) return all[0];
    const f = all[0];
    return { ...f, group: true, groupIds: all.map(o => o.id), lines: all.map(o => ({ id: o.id, displayName: o.displayName || o.serviceName, qty: qtyOf(o), sell: orderSell(o), link: o.link, order: o })),
      qty: sumOf(all.map(o => ({ q: qtyOf(o) })), 'q'), sell: all.reduce((t, o) => t + orderSell(o), 0), paidAmount: all.reduce((t, o) => t + (o.paidAmount || 0), 0),
      displayName: `${all.length} dịch vụ`, vipEnd: Math.max(0, ...all.map(o => o.vipEnd || 0)), at: Math.min(...all.map(o => o.at)) };
  }
  async function markSent(o, kind) {
    const field = kind === 'progress' ? 'progressSentAt' : kind === 'quote' ? 'sentAt' : 'invoiceSentAt';
    const store = kind === 'quote' ? QUOTES : ORDERS, all = await DB.get(store, []), ids = o.groupIds || [o.id];
    const xs = all.filter(y => ids.includes(y.id)); if (!xs.length) return;
    for (const x of xs) x[field] = Date.now(); await DB.set(store, all); App.tabs.services?.refresh?.(); ping();
  }
  // ── Nạp tiền Baostar ── Mỗi lần bấm: đọc lại trang Nạp tiền của web (phiên đăng nhập cột Dịch vụ) và hiện đúng QR / số tài khoản web đang
  // hiện lúc đó. Không lưu thông tin ngân hàng (web đổi tài khoản thì lần sau tự đúng). Không đọc được → mở trang nạp tiền của web, không đoán.
  function parseTopup(html, base) {
    const doc = new DOMParser().parseFromString(html, 'text/html'), out = [];
    const seen = new Set();
    for (const el of doc.querySelectorAll('body *')) {
      if (el.children.length > 3 || !/STK\s*:?/i.test(el.textContent) || el.textContent.length > 60) continue;
      // Khối tài khoản: đi lên tới khi có cả "Nội dung" (và ảnh QR nếu có), nhưng chưa chứa 2 STK.
      let card = el; while (card.parentElement && !(/Nội dung/i.test(card.textContent) && card.querySelector('img')) && (card.parentElement.textContent.match(/STK\s*:/gi) || []).length < 2) card = card.parentElement;
      if (seen.has(card) || (card.textContent.match(/STK\s*:/gi) || []).length > 1) continue; seen.add(card);
      const lines = (card.innerText || card.textContent).split(/\n|(?=STK\s*:)|(?=Tên\s*:)|(?=Nội dung\s*:)|(?=Lưu ý)/i).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const get = re => (lines.find(l => re.test(l)) || '').replace(re, '').trim();
      const acc = get(/^STK\s*:?\s*/i).replace(/[^\d]/g, ''), content = get(/^Nội dung\s*:?\s*/i), holder = get(/^Tên\s*:?\s*/i);
      const bank = lines.find(l => /ngân hàng|bank|\([A-Z]{2,}\)/i.test(l) && !/STK|Tên|Nội dung/i.test(l)) || lines[0] || '';
      const img = [...card.querySelectorAll('img')].find(i => /qr|vietqr|data:image/i.test(i.getAttribute('src') + ' ' + i.className + ' ' + i.alt)) || card.querySelector('img');
      let qr = img?.getAttribute('src') || ''; try { if (qr && !qr.startsWith('data:')) qr = new URL(qr, base).href; } catch { qr = ''; }
      const note = lines.find(l => /^Lưu ý/i.test(l)) || '';
      if (acc.length >= 6) out.push({ bank, acc, holder, content, qr, note });
    }
    const txt = (doc.title + ' ' + doc.body?.textContent).slice(0, 20000);
    const login = !out.length && (!!doc.querySelector('input[type=password]') || (/Đăng nhập|login/i.test(txt) && /Mật khẩu|password/i.test(txt)));
    return { cards: out, login };
  }
  async function topupDialog() {
    // Trang chủ (nơi bạn đăng nhập trong cột Dịch vụ, vd dichvu.baostar.net) trước, rồi tới miền của API (smm.baostar.net).
    const s = await settings(), origins = [...new Set([(() => { try { return new URL(s.home).origin; } catch { return ''; } })(), webOrigin(s)].filter(Boolean))];
    let origin = origins[0], page = origin + '/nap-tien';
    const openPage = () => window.metaDesktop?.openService ? window.metaDesktop.openService(page) : window.open(page, '_blank', 'noopener');
    if (!window.metaDesktop?.svcTopup) return openPage();
    let stop = false;
    const dlg = h('dialog', { className: 'svc-dialog svc-topup', onclose: () => { stop = true; dlg.remove(); } });
    const body = h('div', { className: 'svc-topup-cards' }, h('p', { className: 'hint', textContent: 'Đang lấy thông tin nạp tiền mới nhất từ ' + new URL(origin).host + '…' }));
    const st = h('p', { className: 'hint' });
    const copyBtn = (v, what) => h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '📋', title: 'Chép ' + what, onclick: () => navigator.clipboard.writeText(v).then(() => toast('Đã chép ' + what + '.')) });
    // Chuyển xong: dò số dư mỗi 10 giây (tối đa 5 phút), báo khi tăng.
    const watch = async () => { let base = null; try { base = (await vndBalance()).v; } catch {}
      st.textContent = '⏳ Đang chờ Baostar cộng tiền…' + (Number.isFinite(base) ? ` (số dư hiện tại ${money(base)})` : '');
      for (let i = 0; i < 30 && !stop; i++) { await new Promise(r => setTimeout(r, 10e3)); if (stop) return;
        let v = null; try { v = (await vndBalance()).v; } catch {}
        if (Number.isFinite(v) && Number.isFinite(base) && v > base) { st.textContent = `✅ Đã cộng ${money(v - base)} · số dư mới ${money(v)}`; toast(`Baostar đã cộng ${money(v - base)}.`, 6000); App.tabs.services?.refresh?.(); return; }
        if (!Number.isFinite(base) && Number.isFinite(v)) base = v; }
      if (!stop) st.textContent = 'Chưa thấy số dư tăng sau 5 phút. Kiểm tra lại nội dung chuyển khoản, hoặc xem Lịch sử giao dịch trên web.'; };
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '💳 Nạp tiền Baostar' }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      body, st,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' },
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Mở trang nạp tiền trên web ↗', onclick: () => { dlg.close(); openPage(); } }),
        h('button', { type: 'button', className: 'btn btn-primary', textContent: 'Tôi đã chuyển khoản', onclick: e => { e.target.disabled = true; watch().finally(() => { e.target.disabled = false; }); } })));
    document.body.append(dlg); dlg.showModal();
    const fail = why => { body.replaceChildren(h('p', { className: 'status err', textContent: why }),
      h('p', { className: 'hint', textContent: 'Để an toàn, app không dùng thông tin cũ. Đang mở trang Nạp tiền của web ở cột bên phải: quét QR ngay trên đó.' })); openPage(); };
    let cards = [], login = false, lastErr = '';
    for (const o of origins) {
      const r = await window.metaDesktop.svcTopup({ origin: o }).catch(e => ({ error: e.message }));
      if (stop) return;
      if (r?.error) { lastErr = r.error; continue; }
      const got = parseTopup(r.html || '', r.url || o + '/nap-tien');
      if (got.cards.length) { cards = got.cards; origin = o; page = o + '/nap-tien'; break; }
      login ||= got.login || /\/(login|dang-nhap)/i.test(r.url || '');
    }
    if (!cards.length) return fail(login ? `Chưa đăng nhập web dịch vụ trong app (${new URL(origin).host}). Đăng nhập ở cột bên phải rồi bấm lại Nạp tiền.` : lastErr || 'Không đọc được thông tin tài khoản nhận tiền trên trang (web có thể đã đổi giao diện).');
    body.replaceChildren(
      h('p', { className: 'hint', textContent: `Lấy trực tiếp từ ${new URL(origin).host}/nap-tien lúc ${new Date().toLocaleTimeString('vi-VN')}. Mỗi mã QR chỉ dùng cho 1 lần chuyển khoản: lần nạp sau bấm lại nút Nạp tiền để lấy mã mới.` }),
      h('div', { className: 'svc-topup-grid' }, ...cards.map(c => { const img = h('img', { className: 'svc-topup-qr', alt: 'QR nạp tiền ' + c.bank });
        if (c.qr.startsWith('data:')) img.src = c.qr;
        else if (c.qr) window.metaDesktop.svcImg({ url: c.qr }).then(x => { if (x?.dataUrl) img.src = x.dataUrl; else img.replaceWith(h('p', { className: 'hint', textContent: 'Không tải được ảnh QR: chuyển khoản theo số tài khoản + nội dung bên dưới.' })); });
        return h('div', { className: 'svc-topup-card' }, h('strong', { textContent: c.bank }), c.qr ? img : null,
          h('div', { className: 'svc-topup-info' },
            h('div', {}, 'STK: ', h('strong', { textContent: c.acc }), ' ', copyBtn(c.acc, 'số tài khoản')),
            c.holder ? h('div', {}, 'Tên: ', h('strong', { textContent: c.holder })) : null,
            c.content ? h('div', {}, 'Nội dung: ', h('strong', { textContent: c.content }), ' ', copyBtn(c.content, 'nội dung')) : null)); })));
  }
  async function openWeb() {
    const s = await settings();
    if (window.metaDesktop?.openService) window.metaDesktop.openService(s.home); else window.open(s.home, '_blank', 'noopener');
  }

  // ── Trạng thái ── Đơn chưa xong: hỏi web (tối đa 100 đơn/lần). Hoàn thành lần đầu → ghi thời gian hoàn thành; charge → giá gốc thật.
  const nudgeQ = [];
  const flushNudges = async () => { const seen = new Set(); while (nudgeQ.length) { const [k, kind, ref] = nudgeQ.shift(); if (seen.has(k + kind + ref)) continue; seen.add(k + kind + ref); await addNudge(k, kind, ref).catch(() => {}); } };
  async function refreshStatus(only) {
    try { return await refreshStatus0(only); } finally { await flushNudges(); }
  }
  async function refreshStatus0(only) {
    const all = await DB.get(ORDERS, []);
    const open = (only || all).filter(o => o.source === 'service' && o.providerOrderId && !FINAL.test(o.svcStatus || ''));
    if (!open.length) return 0;
    let changed = 0;
    for (let i = 0; i < open.length; i += 100) {
      const ids = open.slice(i, i + 100).map(o => o.providerOrderId);
      let r = ids.length === 1 ? { [ids[0]]: await call('status', { order: Number(ids[0]) }) } : await call('status', { orders: ids.join(',') });
      // Không đúng dạng chuẩn { "<mã đơn>": {...} }: thử dạng mảng, không được thì hỏi từng đơn.
      if (Array.isArray(r)) r = Object.fromEntries(r.map(x => [String(x.order ?? x.id ?? x.order_id), x]));
      if (ids.length > 1 && !ids.some(id => r?.[id])) { r = {}; for (const id of ids) { try { r[id] = await call('status', { order: Number(id) }); } catch {} } }
      const fresh = await DB.get(ORDERS, []);
      for (const o of fresh) {
        const st = o.source === 'service' && r[o.providerOrderId]; if (!st || st.error) continue;
        const next = { ...o, svcStatus: st.status || o.svcStatus, startCount: st.start_count ?? o.startCount, remains: st.remains ?? o.remains };
        // Số tiền Baostar trừ thật: chỉ nhận khi hợp lý so với giá gốc ước tính (0,2×–5×), tránh lệch đơn vị (vd USD).
        const charge = num(st.charge), qty = o.items?.[0]?.qty || 0, est = (o.items?.[0]?.cost || 0) * qty;
        if (Number.isFinite(charge) && charge > 0 && qty) {
          if (!(est > 0) || o.charge || (charge >= est * 0.2 && charge <= est * 5)) { next.items = [{ ...o.items[0], cost: charge / qty }]; next.charge = charge; delete next.chargeOdd; }
          else next.chargeOdd = charge;
        }
        next.status = mapStatus(next.svcStatus);
        // Đơn đã thu tiền khách mà Baostar huỷ / hoàn tiền / chạy thiếu: báo ngay để hoàn tiền hoặc tạo lại.
        const who = `${o.customer?.name || 'Khách'} · ${o.displayName || o.serviceName} · #${o.providerOrderId}`;
        if (next.status === 'cancelled' && o.status !== 'cancelled' && !o.cancelAlertAt) { next.cancelAlertAt = Date.now(); App.notify?.('⚠ Baostar huỷ/hoàn tiền đơn: ' + who, `Khách đã trả ${money(o.paidAmount || orderSell(o))}. Tạo lại đơn hoặc hoàn tiền cho khách.`); }
        if (/^partial$/i.test(next.svcStatus) && !o.partialAlertAt) { next.partialAlertAt = Date.now(); App.notify?.('⚠ Đơn chạy thiếu: ' + who, `Còn thiếu ${num(next.remains).toLocaleString('vi-VN')}. Baostar hoàn phần thiếu; cân nhắc bù hoặc hoàn tiền khách.`); }
        if (FINAL.test(next.svcStatus) && !o.completedAt && next.status === 'done') next.completedAt = Date.now();
        // Gợi ý nhắn khách theo bước đơn (mỗi bước 1 lần / đơn; đơn nhiều dịch vụ cùng mã TT gộp 1 tin hoàn thành).
        const nd = { ...(o.nudged || {}) }, ref = o.payCode && o.groupSize > 1 ? 'pc:' + o.payCode : o.id, d = doneOf(next), q = qtyOf(o);
        if (o.customerKey && !o.warrantyFor) { // đơn bù bảo hành: không gợi ý từng bước (lượt bảo hành có tin "đã bảo hành xong" riêng)
          if (/in progress|processing/i.test(next.svcStatus || '') && !nd.start) { nd.start = Date.now(); nudgeQ.push([o.customerKey, 'start', ref]); }
          if (d != null && q && d >= q / 2 && next.status !== 'done' && !nd.half) { nd.half = Date.now(); nudgeQ.push([o.customerKey, 'half', ref]); }
          if (next.status === 'done' && /completed/i.test(next.svcStatus || '') && !nd.done) { nd.done = Date.now(); nd.half ||= 1; nudgeQ.push([o.customerKey, 'done', ref]); }
          next.nudged = nd;
        }
        if (JSON.stringify(next) !== JSON.stringify(o)) { next.updatedAt = Date.now(); Object.assign(o, next); changed++; }
      }
      await DB.set(ORDERS, fresh); if (changed) ping();
    }
    return changed;
  }
  // Theo dõi ngầm 3 phút/lần khi có đơn chưa xong (chỉ khi đã nhập API key).
  setInterval(async () => { try {
      // Hỏi thăm 1 ngày sau hoàn thành (đơn hoàn thành trong 3 ngày gần đây, chưa hỏi).
      const os = await DB.get(ORDERS, []); let ch = false;
      for (const o of os) if (o.source === 'service' && o.customerKey && !o.warrantyFor && o.completedAt && o.status === 'done' && Date.now() - o.completedAt > 864e5 && Date.now() - o.completedAt < 3 * 864e5 && !o.nudged?.follow) {
        o.nudged = { ...(o.nudged || {}), follow: Date.now() }; ch = true; nudgeQ.push([o.customerKey, 'follow', o.payCode && o.groupSize > 1 ? 'pc:' + o.payCode : o.id]); }
      if (ch) { await DB.set(ORDERS, os); await flushNudges(); }
    } catch {}
    try { if (!(await settings()).apiKey) return; const a = await refreshStatus().catch(() => 0), b = await refreshRefills(); await checkWarranty().catch(() => 0); if ((a || b) && App.current() === 'services') App.tabs.services.refresh(); } catch {} }, 3 * 60e3);

  // ── Hộp thư: link khách gửi + nút tạo đơn ── (gắn dưới khung CRM của hội thoại)
  function inboxBox(ctx) {
    const links = linksIn(ctx.messages), qBox = h('div', { className: 'svc-inbox-quotes' });
    if (ctx.key) Promise.all([quotes(), DB.get(ORDERS, [])]).then(([qs, orders]) => { const mine = qs.filter(q => q.customerKey === ctx.key);
      const vips = orders.filter(o => o.customerKey === ctx.key && vipSoon(o));
      // Báo giá / đơn đang chạy đã hiện ở thanh đơn ngay trên ô nhập tin → ở đây chỉ còn dịch vụ sắp hết hạn (gia hạn).
      qBox.replaceChildren(
        ...vips.map(o => h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, h('strong', { textContent: '🔔 ' + (o.displayName || o.serviceName) }),
          h('span', { className: 'status svc-pill ' + (daysLeft(o) <= 1 ? 'err' : 'pending'), textContent: leftText(o) }), vipActions(o, qs)))); });
    // Nút tạo đơn + link khách gửi đã chuyển vào nút "🧾 Tạo đơn" (khung bên phải); ở đây chỉ còn báo giá / dịch vụ sắp hết hạn của khách.
    const wBtn = h('div', { className: 'svc-inbox-warr', hidden: true });
    if (ctx.key) warrGroups(ctx.key).then(gs => { if (!gs.length) return; wBtn.hidden = false;
      wBtn.replaceChildren(h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: `🛡 Bảo hành (${gs.filter(g => g.ok).length}/${gs.length} link còn bảo hành)`, onclick: () => warrantyDialog(ctx) })); }).catch(() => {});
    return h('div', { className: 'svc-inbox' }, wBtn, qBox);
  }

  // ── Trạng thái đơn của từng khách (Hộp thư): báo giá chờ thanh toán / đã thu chưa tạo đơn / đơn đang chạy ──
  // Mỗi khách lấy việc cần làm gấp nhất: đã thu chưa tạo đơn > chờ thanh toán > đang chạy.
  // ── Gợi ý nhắn khách (bấm 1 lần): đơn bắt đầu chạy · đạt 50% · khách hỏi tiến độ · hoàn thành (+ ảnh phiếu, cảm ơn)
  //    · đã nhận tiền (cảm ơn) · 1 ngày sau hoàn thành (hỏi thăm). Hiện trên ô soạn tin của khách đó trong Hộp thư.
  const NUDGES = 'svcNudgesV1';
  const NUDGE_TITLE = { wdone: '🛡 Báo khách đã bảo hành xong', start: '🚀 Báo đơn bắt đầu chạy', half: '📊 Báo đơn đã lên 50%', ask: '💬 Khách hỏi tiến độ', done: '✅ Báo hoàn thành + cảm ơn', paid: '🙏 Cảm ơn đã thanh toán', follow: '❤️ Hỏi thăm sau 1 ngày' };
  const nudges = () => DB.get(NUDGES, []).catch(() => []);
  async function addNudge(key, kind, ref, uniq = '') {
    if (!key) return;
    const all = (await nudges()).filter(n => Date.now() - n.at < 3 * 864e5);
    const id = `${kind}:${ref}${uniq}`; if (all.some(n => n.id === id && n.key === key)) return;
    // Tin mới thay gợi ý cũ cùng đơn (vd đã hoàn thành thì bỏ gợi ý "50%" chưa gửi).
    const keep = all.filter(n => !(n.key === key && n.ref === ref && ['start', 'half', 'ask'].includes(n.kind) && ['half', 'done', 'ask'].includes(kind)));
    keep.push({ id, key, kind, ref, at: Date.now() }); await DB.set(NUDGES, keep);
    App.inbox?.orderChanged?.();
  }
  async function dropNudge(id, key) { await DB.set(NUDGES, (await nudges()).filter(n => !(n.id === id && n.key === key))); App.inbox?.orderChanged?.(); }
  const shortSvc = o => String(o.displayName || o.serviceName || 'dịch vụ').replace(/\s*·\s*\d[\d.,]*\s*$/, '');
  const doneOf = o => o.startCount != null && o.remains != null ? Math.max(0, qtyOf(o) - num(o.remains)) : null;
  // Nội dung tin: viết lúc hiện (luôn lấy số mới nhất của đơn).
  async function nudgeText(n, withImage = false) {
    if (n.kind === 'wdone') { const b = (await warrBatches()).find(x => 'wb:' + x.id === n.ref); if (!b) return null;
      const text = ['✅ ĐÃ BẢO HÀNH XONG', `Dạ shop đã bảo hành xong ${b.items.length} link cho mình rồi ạ:`, ...b.items.map((it, i) => `   ${i + 1}. ${shortLink(it.link)} · ✓`), '', 'Mình kiểm tra lại giúp em nha, có gì cần hỗ trợ cứ nhắn em ạ 🙏'].join('\n');
      if (!withImage) return { text, hasImage: true, image: '' };
      const g = await snapGrid(b.items.map(it => ({ link: it.link, name: it.name })), '✅ Đã bảo hành xong').catch(() => null);
      return { text, hasImage: true, image: g?.dataUrl || '' }; }
    const orders = await DB.get(ORDERS, []), group = n.ref && String(n.ref).startsWith('pc:') ? orders.filter(o => o.payCode === String(n.ref).slice(3)) : orders.filter(o => o.id === n.ref);
    const o = group[0], qs = n.kind === 'paid' ? (await quotes()).find(q => q.id === n.ref) : null;
    if (n.kind === 'paid') return qs ? { text: `Dạ em đã nhận được ${money(qs.paidAmount || qs.sell)} của mình rồi ạ 🙏 Cảm ơn mình đã tin tưởng shop! Em lên đơn ${shortSvc(qs)} cho mình ngay đây ạ.` } : null;
    if (!o) return null;
    const q = qtyOf(o), d = doneOf(o), name = shortSvc(o), link = o.link ? `\n• Link: ${o.link}` : '';
    const prog = () => d != null ? `đã lên ${d.toLocaleString('vi-VN')}/${q.toLocaleString('vi-VN')} (${Math.min(100, Math.round(d / q * 100))}%)` : 'đang chạy';
    const progImg = async () => { try { const inv = (await settings()).invoice || {}; return await invoiceImage(group.length > 1 && o.payCode ? await groupOf(o.payCode) : o, inv, o.status === 'done' ? 'done' : 'progress'); } catch { return null; } };
    if (['start', 'half', 'ask'].includes(n.kind)) {
      if (!withImage) { const r = nudgeText0(n, o, q, d, name, link, prog); return r ? { ...r, hasImage: true, image: '' } : null; }
      // Lúc gửi: chụp trang khách → viết tin theo số thật (Baostar báo chậm hơn).
      const im = await progImg(), o2 = withReal(o, im?.real) || o, d2 = doneOf(o2);
      const prog2 = () => d2 != null ? `đã lên ${d2.toLocaleString('vi-VN')}/${q.toLocaleString('vi-VN')} (${Math.min(100, Math.round(d2 / q * 100))}%)` : 'đang chạy';
      const r = nudgeText0(n, o2, q, d2, name, link, prog2); if (!r) return null;
      return { ...r, text: r.text + (im?.real ? `\n• Hiện tại trên trang: ${im.real.v.toLocaleString('vi-VN')} ${LABEL[im.real.key] || ''}` : ''), hasImage: true, image: im?.dataUrl || '' };
    }
    return nudgeText1(n, o, group, q, name, link, withImage);
  }
  function nudgeText0(n, o, q, d, name, link, prog) {
    if (n.kind === 'start') return { text: `Dạ đơn ${name} của mình đã bắt đầu chạy rồi ạ 🚀${link}\n• Số ban đầu: ${o.startCount != null ? num(o.startCount).toLocaleString('vi-VN') : '—'}\n• Số lượng tăng: ${q.toLocaleString('vi-VN')}\nEm sẽ báo mình khi đơn hoàn thành ạ.` };
    if (n.kind === 'half') return { text: `Dạ đơn ${name} của mình ${prog()} rồi ạ 💪 Hệ thống vẫn đang chạy tiếp, xong em báo mình liền ạ.` };
    if (n.kind === 'ask') return { text: o.status === 'done' ? `Dạ đơn ${name} của mình đã hoàn thành rồi ạ ✅ Mình kiểm tra lại giúp em nha.`
      : /pending/i.test(o.svcStatus || '') || d == null ? `Dạ đơn ${name} của mình đang chờ hệ thống xử lý, thường bắt đầu chạy trong ít phút ạ. Em theo dõi và báo mình ngay khi lên ạ 🙏`
      : `Dạ đơn ${name} của mình ${prog()} ạ, hệ thống vẫn đang chạy tiếp ạ. Mình chờ thêm chút giúp em nha 🙏` };
    return null;
  }
  async function nudgeText1(n, o, group, q, name, link, withImage) {
    if (n.kind === 'done') {
      const start = o.startCount != null ? num(o.startCount) : null;
      const text = `Dạ đơn ${name} của mình đã HOÀN THÀNH ✅${link}\n• Đã tăng: ${q.toLocaleString('vi-VN')}${start != null ? ` (từ ${start.toLocaleString('vi-VN')} → ${(start + q).toLocaleString('vi-VN')})` : ''}\nMình kiểm tra giúp em nha. Cảm ơn mình đã tin tưởng và ủng hộ shop ạ 🙏❤️`;
      let image = ''; if (withImage) try { const inv = (await settings()).invoice || {}; image = (await invoiceImage(group.length > 1 && o.payCode ? await groupOf(o.payCode) : o, inv, 'done')).dataUrl; } catch {}
      return { text, image, hasImage: true };
    }
    if (n.kind === 'follow') return { text: `Dạ đơn ${name} hôm qua mình thấy ổn không ạ? Có gì cần hỗ trợ thêm mình cứ nhắn em nha. Lần sau cần tăng tương tác mình nhớ ủng hộ shop tiếp nhé ạ ❤️` };
    return null;
  }
  // Thẻ gợi ý trên ô soạn tin của khách đang mở.
  async function nudgeCard(key) {
    const list = (await nudges()).filter(n => n.key === key).sort((a, b) => b.at - a.at); if (!list.length) return null;
    let n = null, m = null;
    for (const x of list) { m = await nudgeText(x); if (m) { n = x; break; } await dropNudge(x.id, key); } // đơn đã xoá: bỏ gợi ý
    if (!n) return null;
    // Ảnh (phiếu + ảnh thực tế chụp link khách) chỉ tạo khi bấm Gửi / Sửa: chụp mất vài giây.
    const send = async (auto, btn) => { const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = m.hasImage ? '📸 Đang chụp ảnh…' : '…'; }
      const full = m.hasImage ? await nudgeText(n, true).catch(() => m) || m : m;
      if (btn) { btn.disabled = false; btn.textContent = old; }
      const r = await App.inbox.compose({ key, text: full.text, image: full.image || '', autoSend: auto });
      if (r === true) { await dropNudge(n.id, key); if (auto) toast('Đã gửi: ' + NUDGE_TITLE[n.kind].replace(/^\S+ /, ''), 4000); } else toast(r, 6000); };
    return h('div', { className: 'nudge-card' },
      h('div', { className: 'nudge-head' }, h('strong', { textContent: '📣 Gợi ý: ' + NUDGE_TITLE[n.kind] }), list.length > 1 ? h('span', { className: 'hint', textContent: ` · còn ${list.length - 1} gợi ý` }) : null),
      h('div', { className: 'nudge-text', textContent: m.text + (m.hasImage ? '\n[+ ảnh phiếu' + (window.metaDesktop?.svcSnap ? ' + ảnh thực tế chụp link khách]' : ']') : '') }),
      h('div', { className: 'nudge-acts' },
        h('button', { type: 'button', className: 'btn btn-sm btn-primary', textContent: 'Gửi', onclick: e => send(true, e.currentTarget) }),
        h('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Sửa trước khi gửi', onclick: e => send(false, e.currentTarget) }),
        h('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Bỏ qua', onclick: () => dropNudge(n.id, key) })));
  }
  // Khách hỏi tiến độ ("lên chưa", "sao chưa chạy", "bao giờ xong"…) mà đang có đơn: cập nhật trạng thái rồi gợi ý tin trả lời.
  const ASK_RE = /(lên|chạy|tăng|xong|hoàn thành|nhận)\s*(chưa|chưa ạ|chưa vậy|chưa shop|chưa ad)|sao chưa (lên|chạy|tăng|thấy)|bao giờ (xong|lên|chạy)|đơn (sao|tới đâu|thế nào)|chưa thấy (lên|tăng|chạy)|khi nào (xong|lên|chạy)/i;
  async function askCheck(key, text) {
    if (!key || !ASK_RE.test(String(text || ''))) return false;
    const os = (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.customerKey === key && Date.now() - o.at < 7 * 864e5).sort((a, b) => b.at - a.at);
    const o = os.find(x => x.status !== 'done' && x.status !== 'cancelled') || os[0]; if (!o) return false;
    await refreshStatus([o]).catch(() => {});
    await addNudge(key, 'ask', o.payCode && o.groupSize > 1 ? 'pc:' + o.payCode : o.id, ':' + Math.floor(Date.now() / 60e3)); return true;
  }
  async function orderStates() {
    const map = new Map(), rank = { paid: 3, pay: 2, run: 1 };
    const put = (key, st) => { if (key && (!map.has(key) || rank[st.kind] > rank[map.get(key).kind])) map.set(key, st); };
    for (const q of await quotes()) put(q.customerKey, q.state === 'paid' ? { kind: 'paid', chip: '💰 Đã thu', q } : { kind: 'pay', chip: expired(q) ? '⌛ Hết hạn' : '💳 Chờ TT', q });
    const run = (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.customerKey && o.status !== 'done' && o.status !== 'cancelled' && Date.now() - o.at < 30 * 864e5);
    for (const o of run) { const cur = map.get(o.customerKey); if (cur?.kind === 'run') cur.orders.push(o); else put(o.customerKey, { kind: 'run', chip: '🚀 Đang chạy', orders: [o] }); }
    return map;
  }
  // Thanh ghim trên ô nhập tin: đơn hiện tại của khách + đúng 1 nút cho bước tiếp theo.
  const cancelBtn = q => h('button', { type: 'button', className: 'btn btn-sm btn-ghost ord-cancel', title: `Huỷ báo giá ${q.payCode} (để làm báo giá mới)`, 'aria-label': 'Huỷ báo giá', textContent: 'Huỷ',
    onclick: () => cancelQuote(q, { fromInbox: true }) });
  function orderBar(st, hint) {
    if (!st) return null;
    const btn = (t, fn, cls = 'btn-primary') => h('button', { type: 'button', className: 'btn btn-sm ' + cls, textContent: t, onclick: fn });
    if (st.q) { const q = st.q, [label] = quoteState(q);
      // Khách vừa gửi ảnh / báo đã chuyển khoản → nút Đã nhận tiền nổi bật (bạn vẫn tự kiểm tra tài khoản rồi mới xác nhận).
      const payHint = hint && q.state === 'quote' && !expired(q);
      if (payHint) { const b = btn('✅ Đã nhận tiền', () => paymentDialog(q)); b.classList.add('ord-pulse');
        return h('div', { className: 'ord-bar pay hinted' }, h('span', { className: 'ord-main' }, platOfOrder(q) ? platBadge(platOfOrder(q), 16) : null, h('strong', { textContent: '#' + q.payCode }), ` · ${money(amountDue(q) || q.sell)} `,
          h('span', { className: 'ord-hint', textContent: hint.why === 'pic' ? '📷 Khách vừa gửi ảnh, có thể là chuyển khoản: kiểm tra tài khoản' : '💬 Khách báo đã chuyển khoản: kiểm tra tài khoản' })),
          !q.sentAt ? btn('📤', () => invoiceDialog(q, 'quote'), 'btn-ghost') : null, b, cancelBtn(q)); }
      const act = q.state === 'paid' ? btn('🚀 Tạo đơn', () => confirmCreate(q))
        : expired(q) ? btn('⏱ Gia hạn 24h', async () => { q.expiresAt = Date.now() + QUOTE_TTL; await saveQuote(q); App.tabs.services?.refresh?.(); }, 'btn-soft')
        : !q.sentAt ? btn('📤 Gửi báo giá', () => invoiceDialog(q, 'quote'))
        : btn('✅ Đã nhận tiền', () => paymentDialog(q));
      return h('div', { className: 'ord-bar ' + st.kind }, h('span', { className: 'ord-main', title: q.displayName }, platOfOrder(q) ? platBadge(platOfOrder(q), 16) : null, h('strong', { textContent: '#' + q.payCode }), ` · ${quoteShort(q)} · `, h('strong', { textContent: money(amountDue(q) || q.sell) }),
        h('span', { className: 'ord-state', textContent: label + (q.state === 'quote' && q.sentAt && !expired(q) ? ' · đã gửi' : '') })),
        q.state === 'quote' && q.sentAt && !expired(q) ? btn('📤', () => invoiceDialog(q, 'quote'), 'btn-ghost') : null, act, cancelBtn(q)); }
    const os = st.orders, o = os[0], code = o.payCode || '', done = os.filter(x => x.svcStatus && /progress|processing/i.test(x.svcStatus)).length;
    return h('div', { className: 'ord-bar run' }, h('span', { className: 'ord-main' }, h('strong', { textContent: '#' + (o.providerOrderId || code) }), ` · ${os.length > 1 ? os.length + ' dịch vụ' : o.displayName || o.serviceName}`,
      h('span', { className: 'ord-state', textContent: os.length > 1 ? `Đang chạy${done ? ` · ${done}/${os.length} đã bắt đầu` : ''}` : progressLine(o) })),
      btn('📊 Gửi tiến độ', async () => { const g = code ? await groupOf(code) : o; invoiceDialog(g || o, 'progress'); }, 'btn-soft'));
  }

  // ── Tab Dịch vụ ──
  const PERIODS = [['7d', '7 ngày'], ['30d', '30 ngày'], ['month', 'Tháng này'], ['all', 'Tất cả']];
  let period = '30d', q = '', refillOk = new Set();
  const since = () => { const d = new Date(); if (period === '7d') return Date.now() - 7 * 864e5; if (period === '30d') return Date.now() - 30 * 864e5; if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return 0; };
  const quoteState = q => q.state === 'paid' ? ['Đã thu, chưa tạo đơn', 'err'] : expired(q) ? ['Hết hạn', 'pending'] : q.paidAmount ? ['Thiếu ' + money(amountDue(q)), 'pending'] : ['Chờ thanh toán', 'pending'];
  const quoteActions = q => h('div', { className: 'row', style: 'gap:4px;flex-wrap:wrap' },
    q.state === 'paid' ? h('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '🚀 Tạo đơn', onclick: () => confirmCreate(q) })
      : h('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '✅ Đã nhận tiền', onclick: () => paymentDialog(q) }),
    q.state === 'quote' ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: q.sentAt ? 'Đã gửi lúc ' + fmtTime(q.sentAt) : 'Gửi báo giá cho khách', textContent: q.sentAt ? '📤 Gửi lại' : '📤 Gửi', onclick: () => invoiceDialog(q, 'quote') }) : null,
    expired(q) ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '⏱ Gia hạn 24h', onclick: async () => { q.expiresAt = Date.now() + QUOTE_TTL; await saveQuote(q); App.tabs.services?.refresh?.(); } }) : null,
    h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Huỷ', onclick: () => cancelQuote(q) }));
  // Huỷ báo giá (chưa tạo đơn Baostar). Từ Hộp thư: hỏi mở lại hộp tạo đơn với đúng các link đó để làm báo giá mới.
  async function cancelQuote(q, { fromInbox = false } = {}) {
    const links = [...new Set(linesOf(q).map(l => l.link || q.link).filter(Boolean))];
    if (!confirm(q.state === 'paid' || q.paidAmount ? `Huỷ báo giá ${q.payCode}? Khách đã chuyển ${money(q.paidAmount)}: nhớ hoàn tiền cho khách.` : `Huỷ báo giá ${q.payCode} (${money(q.sell)})?`)) return false;
    await dropQuote(q.id); orderedCache = null;
    if (q.customerKey) App.crm?.update?.(q.customerKey, { orderStatus: '' }).catch(() => {});
    App.tabs.services?.refresh?.(); App.inbox?.orderChanged?.();
    if (fromInbox && links.length && App.inbox?.reopenBulk && confirm(`Đã huỷ báo giá ${q.payCode}.\n\nMở hộp tạo đơn với ${links.length} link này để làm báo giá mới?`)) App.inbox.reopenBulk(links);
    else toast(`Đã huỷ báo giá ${q.payCode}.`, 4000);
    return true;
  }
  // Tên ngắn của báo giá trên thanh trạng thái: nhiều link → "14 link · gói · 50 like + 50 love/link".
  const quoteShort = q => { if (!multi(q)) return q.displayName; const { groups, same } = linkGroups(q);
    return groups.length === 1 ? `${groups[0].pk} · ${groups[0].what}` : same ? `${groups.length} link · ${groups[0].pk} · ${groups[0].what}/link` : `${groups.length} link`; };
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
      link: o.link, comments: o.comments || '', qty: qtyOf(o), sell: Math.round(orderSell(o)), cost: Math.round((o.items?.[0]?.cost || 0) * qtyOf(o)), costManual: false, listPrice: o.listPrice || 0,
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
          h('td', {}, h('span', { className: 'svc-name-cell' }, platOfOrder(q) ? platBadge(platOfOrder(q), 18) : null, h('span', { textContent: (q.renewOf ? '🔁 ' : '') + q.displayName })), h('div', { className: 'hint', textContent: multi(q) ? q.lines.map(l => `${l.done ? '✓' : l.error ? '✗' : '·'} MC ${l.serviceId} × ${Number(l.qty).toLocaleString('vi-VN')}`).join(' · ') : 'MC ' + q.serviceId + (q.termMonths ? ` · ${q.termMonths} tháng` : '') })),
          h('td', {}, q.link ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: q.link, textContent: '📋 Copy', onclick: () => navigator.clipboard.writeText(q.link).then(() => toast('Đã copy link.')) }) : ''),
          h('td', { textContent: qtyOf(q).toLocaleString('vi-VN') }),
          h('td', {}, money(q.sell), q.paidAmount ? h('div', { className: 'hint', textContent: 'đã nhận ' + money(q.paidAmount) }) : null),
          vsCell(q), h('td', { className: q.sell - q.cost < 0 ? 'neg' : '', textContent: money(q.sell - q.cost) }),
          h('td', {}, h('span', { className: 'status svc-pill ' + cls, textContent: st }), q.lastError ? h('div', { className: 'neg hint', textContent: q.lastError }) : null, q.payNote ? h('div', { className: 'hint', textContent: q.payNote }) : null),
          h('td', {}, quoteActions(q))); })))) : h('p', { className: 'hint', textContent: 'Chưa có báo giá nào đang chờ.' }));
  }
  // Thẻ "📉 Đơn bị tụt" (app tự phát hiện): mỗi khách 1 dòng, bấm 1 nút bảo hành (refill miễn phí) + nhắn khách.
  async function drawDrops() {
    const box = $('svDrops'); if (!box) return;
    const gs = (await dropGroups()).filter(g => g.drop), by = new Map();
    for (const g of gs) { const k = g.orders[0].customerKey || g.orders[0].id; if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
    box.replaceChildren(...(by.size || window.metaDesktop?.svcSnap ? [h('div', { className: 'card svc-drops' },
      h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: by.size ? `📉 Phát hiện tụt · ${by.size} khách` : '📉 Theo dõi tụt' }),
        h('span', { className: 'hint', textContent: 'App tự đo số thật các đơn còn bảo hành (12 giờ/lần)' }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '↻ Quét ngay', onclick: async e => { e.target.disabled = true; e.target.textContent = 'Đang quét…';
          const f = await dropScan({ max: 20, force: true }).catch(() => []); toast(f.length ? `Phát hiện ${f.length} link bị tụt.` : 'Không thấy link nào bị tụt.', 4000); drawDrops(); } })),
      ...[...by.entries()].map(([k, list]) => { const o0 = list[0].orders[0];
        return h('div', { className: 'svc-drop-row' },
          h('div', { className: 'grow' }, h('strong', { textContent: o0.customer?.name || 'Khách' }), h('span', { className: 'hint', textContent: ' · ' + (App.pageById?.(o0.pageKey)?.name || o0.pageName || '') }),
            ...list.map(g => h('div', { className: 'hint', textContent: `${shortLink(g.link)} · đang ${g.drop.now.toLocaleString('vi-VN')}/${g.drop.expected.toLocaleString('vi-VN')} ${LABEL[g.metric] || ''} · thiếu ${g.drop.lost.toLocaleString('vi-VN')} · ${g.ok ? 'còn bảo hành' : 'hết bảo hành'}` }))),
          list.some(g => g.ok) ? h('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '🛡 Bảo hành + nhắn khách', title: 'Gửi refill Baostar (miễn phí) cho các link tụt còn bảo hành, rồi nhắn khách', onclick: async e => { e.target.disabled = true; await quickWarranty(o0.customerKey, { groups: list }); drawDrops(); } }) : null,
          h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '🔎 Kiểm tra', onclick: () => checkDialog({ key: o0.customerKey, name: o0.customer?.name || '' }) })); }),
      !by.size ? h('p', { className: 'hint', textContent: 'Chưa thấy đơn nào bị tụt.' }) : null)] : []));
  }
  App.tab('services', {
    mount(el) {
      el.append(
        h('div', { className: 'toolbar' },
          h('div', { className: 'chips', id: 'svPeriod' }), h('span', { className: 'grow' }),
          h('button', { type: 'button', className: 'svc-balance', id: 'svBalance', title: 'Bấm để xem nguyên văn API Baostar trả về', textContent: '💰 Số dư: …',
            onclick: () => balanceCheck() }),
          h('button', { className: 'btn btn-soft', textContent: '💳 Nạp tiền (QR)', title: 'Nạp tiền vào tài khoản Baostar bằng mã QR ngân hàng', onclick: () => topupDialog() }),
          h('button', { className: 'btn btn-ghost', textContent: '↻ Cập nhật trạng thái', onclick: async () => { try { const n = await refreshStatus(), r = await refreshRefills(); toast(`Đã cập nhật ${n} đơn${r ? `, ${r} yêu cầu bảo hành` : ''}.`); this.refresh(); } catch (e) { toast(e.message, 6000); } } }),
          h('button', { className: 'btn btn-ghost', textContent: '＋ Thêm đơn theo mã', title: 'Đơn đã tạo thẳng trên web dịch vụ: nhập mã đơn để app theo dõi giá gốc, trạng thái', onclick: () => importById() }),
          h('button', { className: 'btn btn-ghost', textContent: 'Mở web dịch vụ ↗', onclick: () => openWeb() }),
          h('button', { className: 'btn btn-soft', textContent: '＋ Báo giá hàng loạt', title: 'Nhiều link → 1 báo giá chung (mỗi link 1 đơn)', onclick: () => bulkDialog() }),
          h('button', { className: 'btn btn-primary', textContent: '＋ Báo giá', onclick: () => createDialog() })),
        h('div', { id: 'svApiAlert', className: 'svc-api-alert', hidden: true }),
        h('div', { id: 'svPriceAlerts' }),
        h('div', { id: 'svDrops' }),
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
      { const pa = priceAlertCard(await DB.get(ALERTS, []), s); $('svPriceAlerts').replaceChildren(...(pa ? [pa] : [])); }
      drawDrops().catch(() => {});
      $('svPeriod').replaceChildren(...PERIODS.map(([k, t]) => h('button', { type: 'button', className: 'chip', 'aria-pressed': String(period === k), textContent: t, onclick: () => { period = k; this.refresh(); } })));
      const all = (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.at >= from);
      refillOk = new Set(); if (s.apiKey) try { for (const x of await services()) if (x.refill || warrantyName(x.name)) refillOk.add(x.id); } catch {}
      const list = all.filter(o => !q || norm([o.customer?.name, o.link, o.serviceName, o.displayName, '#' + o.providerOrderId, o.payCode, App.pageById(o.pageKey)?.name].join(' ')).includes(q.replace(/^#/, '')) || norm('#' + o.providerOrderId).includes(q)).sort((a, b) => b.at - a.at);
      // Dịch vụ thu tiền TRƯỚC khi tạo đơn → tính doanh thu / giá gốc / lời ngay khi có đơn (trừ đơn bị huỷ), không chờ hoàn thành.
      const live = all.filter(o => o.status !== 'cancelled' && o.status !== 'returned');
      const revenue = live.reduce((t, o) => t + orderSell(o), 0), costSum = live.reduce((t, o) => t + orderOf(o).cost, 0);
      const sum = { revenue, cost: costSum, profit: revenue - costSum }, running = all.filter(o => ['new', 'shipping'].includes(o.status)).length;
      // Dọn báo giá quá hạn hơn 7 ngày mà khách chưa trả đồng nào.
      let qs = await quotes();
      const stale = qs.filter(x => x.state === 'quote' && !x.paidAmount && Date.now() - (x.expiresAt || 0) > 7 * 864e5);
      if (stale.length) { qs = qs.filter(x => !stale.includes(x)); await DB.set(QUOTES, qs); }
      const waiting = qs.filter(x => x.state === 'quote' && !expired(x));
      drawQuotes(qs); drawVip(await DB.get(ORDERS, []), qs);
      // Thẻ số liệu có biểu tượng + màu; doanh thu / lời / số đơn so với kỳ trước cùng độ dài (▲ tăng xanh, ▼ giảm đỏ).
      const prevFrom = from ? from - (Date.now() - from) : 0;
      const prev = from ? (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.at >= prevFrom && o.at < from && o.status !== 'cancelled' && o.status !== 'returned') : null;
      const pRev = prev ? prev.reduce((t, o) => t + orderSell(o), 0) : 0, pCost = prev ? prev.reduce((t, o) => t + orderOf(o).cost, 0) : 0;
      const delta = (cur, old) => { if (!prev) return null; if (!old) return cur ? { up: true, txt: 'mới' } : null; const p = Math.round((cur - old) / Math.abs(old) * 100); return { up: p >= 0, txt: (p >= 0 ? '+' : '') + p + '%' }; };
      const vs = all.reduce((t, o) => t + (vsList(o) || 0), 0), margin = sum.revenue ? Math.round(sum.profit / sum.revenue * 100) : 0;
      const K = [
        { l: 'Chờ thanh toán', v: `${waiting.length} · ${money(waiting.reduce((t, x) => t + amountDue(x), 0))}`, i: '⏳', tone: waiting.length ? 'amber' : 'muted' },
        { l: 'Đã thu, chưa tạo đơn', v: String(qs.filter(x => x.state === 'paid').length), i: '💰', tone: qs.some(x => x.state === 'paid') ? 'red' : 'muted', sub: qs.some(x => x.state === 'paid') ? 'cần tạo đơn ngay' : '' },
        { l: 'Đơn', v: String(all.length), i: '🧾', tone: 'violet', d: delta(live.length, prev?.length || 0) },
        { l: 'Đang chạy', v: String(running), i: '🚀', tone: 'blue' },
        { l: 'Doanh thu (đã thu)', v: money(sum.revenue), i: '💵', tone: 'teal', d: delta(sum.revenue, pRev) },
        { l: 'Giá gốc', v: money(sum.cost), i: '📦', tone: 'muted' },
        { l: 'Lời', v: money(sum.profit), i: sum.profit >= 0 ? '📈' : '📉', tone: sum.profit >= 0 ? 'green' : 'red', sub: sum.revenue ? `biên lời ${margin}%` : '', d: delta(sum.profit, pRev - pCost), big: true },
        { l: 'So với giá gói', v: (vs > 0 ? '+' : '') + money(vs), i: vs >= 0 ? '🏷️' : '🔻', tone: vs > 0 ? 'green' : vs < 0 ? 'orange' : 'muted', sub: vs < 0 ? 'bán rẻ hơn giá gói' : vs > 0 ? 'bán cao hơn giá gói' : '' }];
      const per = { '7d': '7 ngày trước', '30d': '30 ngày trước', month: 'tháng trước' }[period] || '';
      $('svKpis').replaceChildren(...K.map(k => h('div', { className: `kpi svc-kpi tone-${k.tone}${k.big ? ' big' : ''}` },
        h('div', { className: 'svc-kpi-top' }, h('span', { className: 'svc-kpi-ico', textContent: k.i }), h('div', { className: 'label', textContent: k.l })),
        h('div', { className: 'value', textContent: k.v }),
        h('div', { className: 'svc-kpi-foot' }, k.d ? h('span', { className: 'svc-delta ' + (k.d.up ? 'up' : 'down'), title: 'So với ' + per, textContent: (k.d.up ? '▲ ' : '▼ ') + k.d.txt }) : null,
          k.d && per ? h('span', { className: 'hint', textContent: ' kỳ trước' }) : null, k.sub ? h('span', { className: 'hint', textContent: (k.d ? ' · ' : '') + k.sub }) : null))));
      $('svOrders').replaceChildren(list.length ? h('table', {},
        h('thead', {}, h('tr', {}, ...['Mã đơn', 'Tạo lúc', 'Khách / Page', 'Dịch vụ', 'Link', 'SL', 'Giá bán', 'So với giá gói', 'Giá gốc', 'Lời', 'Trạng thái', 'Hoàn thành', 'Gửi khách'].map(t => h('th', { textContent: t })))),
        h('tbody', {}, ...list.map(o => { const { sell, cost } = orderOf(o); return h('tr', {},
          h('td', {}, h('button', { type: 'button', className: 'svc-code', title: 'Mã đơn Baostar · bấm để chép', textContent: o.providerOrderId ? '#' + o.providerOrderId : '—',
            onclick: () => o.providerOrderId && navigator.clipboard.writeText(String(o.providerOrderId)).then(() => toast('Đã chép mã đơn ' + o.providerOrderId)) }),
            o.payCode ? h('div', { className: 'hint', textContent: 'báo giá ' + o.payCode }) : null),
          h('td', { textContent: fmtTime(o.at) }),
          h('td', {}, o.customer?.name || '—', h('div', { className: 'hint', textContent: App.pageById(o.pageKey)?.name || '' })),
          h('td', {}, h('span', { className: 'svc-name-cell' }, platOfOrder(o) ? platBadge(platOfOrder(o), 18) : null, h('span', { textContent: o.displayName || o.serviceName || '' })), h('div', { className: 'hint', textContent: o.serviceId ? 'MC ' + o.serviceId : '' })),
          h('td', {}, o.link ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: o.link, textContent: '📋 Copy', onclick: () => navigator.clipboard.writeText(o.link).then(() => toast('Đã copy link.')) }) : ''),
          h('td', { textContent: (o.items?.[0]?.qty || 0).toLocaleString('vi-VN') }),
          h('td', { textContent: money(sell) }), vsCell(o), h('td', { textContent: money(cost) + (o.charge ? '' : ' ≈') }),
          h('td', { className: sell - cost < 0 ? 'neg' : '', textContent: money(sell - cost) }),
          h('td', {}, h('span', { className: 'status ' + (o.status === 'done' ? 'ok' : o.status === 'cancelled' ? 'err' : 'pending'), textContent: statusVi(o.svcStatus) }),
            o.vipEnd ? h('div', { className: 'hint' + (!o.renewedBy && o.vipEnd - Date.now() < 864e5 ? ' neg' : ''), textContent: o.renewedBy ? '🔁 đã gia hạn' : '🔔 hạn ' + fmtTime(o.vipEnd) }) : null,
            o.status === 'cancelled' && (o.paidAmount || o.payCode) ? h('div', { className: 'neg hint', textContent: `⚠ Đã thu ${money(o.paidAmount || orderSell(o))}: tạo lại hoặc hoàn tiền khách` }) : null,
            /^partial$/i.test(o.svcStatus) ? h('div', { className: 'neg hint', textContent: `⚠ Chạy thiếu ${num(o.remains).toLocaleString('vi-VN')}` }) : null,
            o.refills?.length ? (r => h('div', { className: 'hint' + (/rejected/i.test(r.status) ? ' neg' : ''), title: `Mã bảo hành ${r.id} · gửi lúc ${fmtTime(r.at)}`, textContent: `🛡 Bảo hành: ${refillVi(r.status)}${o.refills.length > 1 ? ` (lần ${o.refills.length})` : ''}` }))(o.refills[o.refills.length - 1]) : null,
            o.chargeOdd ? h('div', { className: 'neg hint', title: 'Số tiền Baostar trả về lệch quá nhiều so với giá gốc ước tính (có thể khác đơn vị tiền). App giữ giá gốc ước tính.', textContent: `⚠ Baostar báo trừ ${o.chargeOdd} (lệch đơn vị?)` }) : null),
          h('td', { textContent: o.completedAt ? fmtTime(o.completedAt) : '' }),
          h('td', {}, h('div', { className: 'row', style: 'gap:4px;flex-wrap:nowrap' },
            h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: o.invoiceSentAt ? 'Đã gửi đơn lúc ' + fmtTime(o.invoiceSentAt) : 'Xuất đơn gửi khách', textContent: o.invoiceSentAt ? '📤 ✓' : '📤 Đơn', onclick: () => invoiceDialog(o, o.payCode ? 'paid' : 'new') }),
            (o.refillable || refillOk.has(String(o.serviceId))) && o.status !== 'cancelled' ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: 'Yêu cầu Baostar bảo hành (bù số lượng tụt)', textContent: '🛡', onclick: () => requestRefill(o) }) : null,
            h('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: o.progressSentAt ? 'Đã báo tiến độ lúc ' + fmtTime(o.progressSentAt) : 'Báo tiến độ cho khách', textContent: '📊', onclick: async () => { await refreshStatus([o]).catch(() => {}); const f = (o.payCode && o.groupSize > 1 && await groupOf(o.payCode)) || (await DB.get(ORDERS, [])).find(y => y.id === o.id) || o; invoiceDialog(f, 'progress'); } })))); }))) : h('div', { className: 'empty', textContent: 'Chưa có đơn dịch vụ trong khoảng này. Tạo đơn từ Hộp thư (nút "＋ Tạo đơn dịch vụ") hoặc nút ＋ Tạo đơn.' }));
      drawSettings(s, this);
      if (s.apiKey) vndBalance().then(r => { const b = $('svBalance'); b.textContent = Number.isFinite(r.v) ? `💰 Số dư Baostar: ${r.approx ? '≈ ' : ''}${r.v.toLocaleString('vi-VN')}đ` : '⚠ ' + r.why; b.dataset.note = r.note || r.why || ''; })
        .catch(e => { const b = $('svBalance'); b.textContent = apiBad ? '⚠ API key lỗi' : '⚠ Số dư: ' + e.message; b.dataset.note = e.message; });
      else $('svBalance').textContent = '💰 Chưa nhập API key';
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
    const usd = h('input', { type: 'number', min: 1000, step: 100, value: s.usdRate || 27000, title: 'API Baostar trả số dư theo USD: app nhân với tỉ giá này để ra số dư VND' });
    const key = h('input', { type: 'password', value: s.apiKey, placeholder: 'Dán API key (web dịch vụ › Tạo web con và API › Tích hợp API)', autocomplete: 'off' });
    const priceBox = h('div', { className: 'svc-prices scroll' });
    const filt = { q: '', plat: '', type: '', state: '', limit: 100 };
    const platSel = h('select', { style: 'width:auto', onchange: e => { filt.plat = e.target.value; filt.type = ''; filt.limit = 100; drawPrices(); } });
    const typeSel = h('select', { style: 'width:auto', title: 'Loại dịch vụ', onchange: e => { filt.type = e.target.value; filt.limit = 100; drawPrices(); } });
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
      { const tl = [...new Set(list.filter(x => !filt.plat || x.platform === filt.plat).map(x => x.category).filter(Boolean))];
        typeSel.replaceChildren(h('option', { value: '', textContent: 'Mọi loại' }), ...tl.map(t => h('option', { value: t, textContent: t, selected: t === filt.type }))); typeSel.hidden = tl.length < 2; }
      const ok = x => (!f || norm(x.name + ' ' + x.category + ' ' + x.id + ' ' + noteLines(x.notes).join(' ')).includes(f)) && (!filt.plat || x.platform === filt.plat) && (!filt.type || x.category === filt.type)
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
    const pkgBox = h('div', { className: 'svc-pkgs' }), invBox = h('div', { className: 'svc-inv-set' }), iconBox = h('div', { className: 'plat-icons' });
    const toIcon = file => new Promise((ok, no) => { const r = new FileReader(); r.onerror = no; r.onload = () => { const im = new Image(); im.onerror = () => no(Error('Không đọc được ảnh.'));
      im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), k = Math.min(64 / im.width, 64 / im.height) || 1, w = im.width * k, hh = im.height * k;
        x.drawImage(im, (64 - w) / 2, (64 - hh) / 2, w, hh); ok(c.toDataURL('image/png')); }; im.src = r.result; }; r.readAsDataURL(file); });
    const drawIcons = async () => {
      const cur = (await settings()).platformIcons || {};
      let list = []; try { list = await services(); } catch {}
      const plats = [...new Set([...Object.keys(PLAT), ...list.map(x => x.platform).filter(Boolean)])];
      const saveIcon = async (p, v) => { const icons = { ...((await settings()).platformIcons || {}) }; if (v) icons[p] = v; else delete icons[p]; await saveSettings({ platformIcons: icons }); platIcons = icons; drawIcons(); drawPrices(); };
      iconBox.replaceChildren(...plats.map(p => { const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => { const f = e.target.files[0]; if (!f) return;
          try { await saveIcon(p, await toIcon(f)); toast('Đã lưu huy hiệu ' + p + '.'); } catch (err) { toast(err.message, 5000); } } });
        return h('div', { className: 'plat-icon-row' }, platBadge(p, 32), h('span', { className: 'grow', textContent: p }), file,
          h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: cur[p] ? 'Đổi ảnh' : '⬆ Tải ảnh', onclick: () => file.click() }),
          cur[p] ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Xoá', onclick: () => saveIcon(p, '') }) : null); }));
    };
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
        const sel = h('button', { type: 'button', className: 'cp-current', title: 'Bấm để đổi máy chủ gốc', onclick: async () => { const v = await pickServerDialog(list, p.serviceId); if (v) upd(p.id, { serviceId: v }); } },
          svc ? platBadge(svc.platform, 22) : h('span', { className: 'plat-badge any', textContent: '?' }),
          h('span', { className: 'cp-main' }, h('span', { className: 'cp-title', textContent: svc ? svc.name : 'Chọn máy chủ gốc' }), svc ? h('span', { className: 'cp-sub', textContent: `MC ${svc.id} · ${m2(svc.unitCost)}/đv` }) : null),
          h('span', { className: 'cp-caret', textContent: '▾' }));
        const _unusedSel = h('select', { onchange: e => upd(p.id, { serviceId: e.target.value }) },
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
        h('label', { className: 'field' }, 'API key', key),
        h('label', { className: 'field' }, 'Tỉ giá USD của Baostar (đ)', usd)),
      h('div', { className: 'row', style: 'gap:8px;margin-top:10px' },
        h('button', { className: 'btn btn-primary btn-sm', textContent: 'Lưu', onclick: async () => {
          for (const [el, label] of [[home, 'Trang chủ'], [api, 'URL API']]) if (!/^https:\/\//i.test(el.value.trim())) return toast(label + ' phải bắt đầu bằng https://', 5000);
          await saveSettings({ home: home.value.trim(), apiUrl: api.value.trim(), apiKey: key.value.trim(), usdRate: Number(usd.value) || 27000 }); await DB.set(CACHE, null); toast('Đã lưu cài đặt dịch vụ.'); tab.refresh();
        } }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Tải lại danh sách dịch vụ', onclick: async () => { try { await services(true); catMsg.textContent = catalogMsg; drawPrices(); toast('Đã tải danh sách dịch vụ.'); } catch (e) { toast(e.message, 6000); } } }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: '↻ Đọc lại web dịch vụ (ghi chú, bảo trì, giá)', title: 'Đọc trang web của URL API bằng phiên đăng nhập ở cột Dịch vụ', onclick: reloadWeb }), catMsg),
      h('h4', { className: 'card-title', style: 'margin:16px 0 6px', textContent: 'Bảng giá bán (đ / 1 đơn vị: 1 like, 1 follow…)' }),
      h('p', { className: 'hint', textContent: `Giá gốc lấy từ web ${webOrigin(s) || 'dịch vụ'} theo tài khoản đang đăng nhập ở cột Dịch vụ (Mở web dịch vụ ↗). Chưa đăng nhập thì là giá cấp Khách hàng. Bấm tên dịch vụ để xem ghi chú gốc.` }),
      h('div', { className: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:8px' },
        h('input', { type: 'search', placeholder: 'Tìm tên, mã, ghi chú…', style: 'flex:1;min-width:200px', oninput: e => { filt.q = e.target.value; filt.limit = 100; drawPrices(); } }),
        platSel, typeSel, stateSel),
      h('div', { className: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center' },
        h('span', { className: 'hint', textContent: 'Giá của tôi = gốc +' }), markup, h('span', { className: 'hint', textContent: '% (giá 1.000 đv làm tròn lên chục nghìn)' }),
        h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: 'Điền cho dịch vụ chưa có giá', onclick: () => applyMarkup(true) }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Đặt lại tất cả đang lọc', onclick: () => { if (confirm(`Đặt lại giá của tôi cho ${shown.length} dịch vụ đang lọc = giá gốc + ${markup.value}%?`)) applyMarkup(false); } })),
      priceBox,
      h('h4', { className: 'card-title', style: 'margin:22px 0 6px', textContent: 'Gói bán của tôi' }),
      h('p', { className: 'hint', textContent: 'Gói là tên + giá bạn bán cho khách, gắn với một máy chủ gốc. Đổi máy chủ gốc bất cứ lúc nào (vd máy chủ cũ bảo trì); khách chỉ thấy tên gói.' }),
      pkgBox,
      h('h4', { className: 'card-title', style: 'margin:22px 0 6px', textContent: 'Huy hiệu nền tảng' }),
      h('p', { className: 'hint', textContent: 'Tải ảnh riêng cho từng nền tảng (PNG/JPG/SVG). App thu nhỏ còn 64×64 và dùng ở mọi bộ chọn. Chưa tải thì dùng huy hiệu chữ.' }),
      iconBox,
      h('h4', { className: 'card-title', style: 'margin:22px 0 6px', textContent: 'Hoá đơn gửi khách' }),
      invBox);
    if (s.apiKey) drawPrices(); else priceBox.replaceChildren(h('p', { className: 'hint', textContent: 'Nhập API key rồi Lưu để tải danh sách dịch vụ.' }));
    drawPkgs(); drawInvoiceSettings(s); drawIcons();
  }
  // ══ Bảo hành khi khách báo tụt ══
  // Thời hạn theo máy chủ Baostar: tên ghi "Bảo hành 30 ngày" / "BH 7 ngày" / "BH 1 tháng"; có cờ refill mà không ghi số → 30 ngày.
  // Bảo hành được khi: đơn đã xong, còn hạn (tính từ lúc xong), đã qua 24 giờ (Baostar thường chỉ nhận refill sau 24 giờ), không có yêu cầu bảo hành đang chạy.
  // Cách bù: refill Baostar; máy chủ không bảo hành / hết hạn / bị từ chối → bạn chọn tạo đơn bù miễn phí (khách không trả, tiền gốc tính là chi phí).
  const WARR = 'svcWarrantyV1', warrBatches = () => DB.get(WARR, []).catch(() => []);
  const COMPLAIN = /tụt|tuột|giảm|bị mất|mất (like|follow|tim|view|mem|lượt|sub)|rơi|rớt|hụt|không còn đủ|bảo hành|\bbh\b/i;
  const warrDays = (o, svc) => { const name = `${o.serviceName || ''} ${svc?.name || ''}`;
    if (/không bảo hành|\bkbh\b/i.test(name)) return 0;
    const m = name.match(/(?:bảo hành|\bbh)\s*(\d+)\s*(ngày|tháng|năm|d|m)?/i);
    if (m) return Number(m[1]) * (/tháng|^m$/i.test(m[2] || '') ? 30 : /năm/i.test(m[2] || '') ? 365 : 1);
    return o.refillable || svc?.refill ? 30 : 0; };
  const doneAt = o => o.completedAt || (o.status === 'done' ? o.updatedAt || o.at : 0);
  function warrState(o, svc) {
    if (o.status === 'cancelled') return { ok: false, code: 'cancel', text: 'Đơn đã huỷ' };
    const days = warrDays(o, svc), last = o.refills?.[o.refills.length - 1];
    if (last && !REFILL_DONE.test(last.status || '')) return { ok: false, code: 'running', text: `Đang bảo hành (${refillVi(last.status)})` };
    if (!days) return { ok: false, code: 'none', text: 'Máy chủ không bảo hành', bu: true };
    const t = doneAt(o);
    if (!t) return { ok: false, code: 'notdone', text: 'Đơn chưa chạy xong', bu: false };
    const end = t + days * 864e5;
    if (Date.now() > end) return { ok: false, code: 'expired', text: `Hết hạn bảo hành (${fmtTime(end).split(' ').pop()})`, bu: true };
    if (Date.now() - t < 864e5) return { ok: false, code: 'wait', text: `Chưa đủ 24 giờ (còn ${Math.ceil((t + 864e5 - Date.now()) / 36e5)} giờ)`, bu: true };
    return { ok: true, code: 'ok', text: `Còn ${Math.ceil((end - Date.now()) / 864e5)} ngày bảo hành`, days };
  }
  // Đơn dịch vụ của khách, gộp theo link (90 ngày gần đây, không tính đơn bù).
  async function warrGroups(key) {
    if (!key) return [];
    let list = []; try { list = await services(); } catch {}
    const since = Date.now() - 90 * 864e5, by = new Map();
    for (const o of (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.customerKey === key && o.at > since && !o.warrantyFor && o.link).sort((a, b) => b.at - a.at)) {
      const k = linkKey(o.link); if (!by.has(k)) by.set(k, { link: o.link, orders: [] }); by.get(k).orders.push(o); }
    return [...by.values()].map(g => { const st = g.orders.map(o => warrState(o, list.find(x => x.id === String(o.serviceId))));
      return { ...g, st, ok: st.some(s => s.ok), allOk: st.every(s => s.ok || s.code === 'cancel'), canBu: st.some(s => s.bu), when: Math.max(...g.orders.map(o => o.at)) }; });
  }
  // Hộp thư: khách nhắn "tụt / giảm / bảo hành…" và có đơn dịch vụ → thanh "🛡 Khách báo tụt".
  async function complaintInfo(key, messages) {
    const said = (messages || []).filter(m => m.isCustomer || m.mine === false).slice(-5).map(m => String(m.text || ''));
    if (!said.some(t => COMPLAIN.test(t))) return null;
    if ((await warrBatches()).some(b => b.key === key && Date.now() - b.at < 864e5)) return null; // vừa bảo hành trong 24 giờ: không nhắc lại
    const groups = await warrGroups(key); if (!groups.length) return null;
    return { groups, ok: groups.filter(g => g.ok).length, said: said.find(t => COMPLAIN.test(t)) };
  }
  // Ảnh bằng chứng: chụp trang của từng link (tối đa 4), ghi số hiện tại (like / follow / view…) và giờ chụp.
  async function snapGrid(items, title) {
    if (!window.metaDesktop?.svcSnap) return { dataUrl: '', lines: [] };
    const shots = [], lines = [];
    for (const it of items.slice(0, 4)) { const r = await window.metaDesktop.svcSnap({ url: it.link }).catch(() => null);
      const key = metricOf(it.name || ''), v = r?.metrics && key && Number.isFinite(r.metrics[key]) ? r.metrics[key] : null;
      lines.push(v != null ? `${shortLink(it.link)}: hiện ${v.toLocaleString('vi-VN')} ${LABEL[key] || ''}` : '');
      if (r?.dataUrl) { const img = await loadImg(r.dataUrl); if (img) shots.push({ img, cap: `${shortLink(it.link)}${v != null ? ` · ${v.toLocaleString('vi-VN')} ${LABEL[key] || ''}` : ''}` }); } }
    if (!shots.length) return { dataUrl: '', lines };
    const W = 760, P = 24, cols = shots.length > 1 ? 2 : 1, cw = (W - P * (cols + 1)) / cols;
    const rows = []; for (let i = 0; i < shots.length; i += cols) rows.push(shots.slice(i, i + cols));
    const rh = rows.map(r => Math.max(...r.map(s => s.img.height * cw / s.img.width)) + 34);
    const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = W * 2; c.height = (70 + rh.reduce((a, b) => a + b + P, 0) + P) * 2; x.scale(2, 2);
    x.fillStyle = '#f5f3ff'; x.fillRect(0, 0, W, c.height / 2);
    x.fillStyle = '#4f46e5'; x.font = '800 20px "Segoe UI",Arial,sans-serif'; x.fillText(title, P, 38);
    x.fillStyle = '#6b7280'; x.font = '600 13px "Segoe UI",Arial,sans-serif'; x.fillText(`Ảnh thực tế lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${new Date().toLocaleDateString('vi-VN')}`, P, 58);
    let y = 70;
    rows.forEach((r, ri) => { r.forEach((s, ci) => { const xx = P + ci * (cw + P), hh = s.img.height * cw / s.img.width;
      x.fillStyle = '#111827'; x.font = '700 12px "Segoe UI",Arial,sans-serif'; x.fillText(s.cap.length > 70 ? s.cap.slice(0, 69) + '…' : s.cap, xx, y + 16);
      x.save(); x.beginPath(); x.roundRect(xx, y + 24, cw, hh, 10); x.clip(); x.drawImage(s.img, xx, y + 24, cw, hh); x.restore(); });
      y += rh[ri] + P; });
    return { dataUrl: c.toDataURL('image/jpeg', .88), lines };
  }
  // Khung gửi khách (chữ sửa được + ảnh) dùng cho tin bảo hành.
  function sendDialog({ title, key, text, image = '', makeImage = null }) {
    const dlg = h('dialog', { className: 'svc-dialog svc-invoice', onclose: () => dlg.remove() });
    const ta = h('textarea', { rows: 11, value: text }), img = h('img', { alt: '', className: 'svc-inv-img', hidden: !image, src: image || '' }), hint = h('div', { className: 'hint' });
    const withImg = h('input', { type: 'checkbox', checked: true }); let pic = image;
    if (makeImage) { hint.textContent = '📸 Đang chụp ảnh thực tế các link…'; makeImage().then(r => { if (r?.dataUrl) { pic = r.dataUrl; img.src = pic; img.hidden = false; hint.textContent = ''; } else hint.textContent = '📸 Không chụp được ảnh thực tế, gửi chữ thôi.'; }).catch(() => { hint.textContent = '📸 Không chụp được ảnh.'; }); }
    const canSend = key && App.inbox?.openKey?.() === key;
    const send = h('button', { type: 'button', className: 'btn btn-primary', textContent: '📨 Gửi vào hội thoại', disabled: !canSend, title: canSend ? '' : 'Mở hội thoại của khách này trong Hộp thư để gửi thẳng',
      onclick: async () => { send.disabled = true; const ok = await App.inbox.compose({ key, text: ta.value.trim(), image: withImg.checked ? pic : '' });
        if (ok === true) { toast('Đã gửi vào hội thoại.'); dlg.close(); } else { send.disabled = false; toast('Chưa gửi được: ' + (typeof ok === 'string' ? ok : 'hội thoại không còn mở.'), 7000); } } });
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: title }), h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('div', { className: 'svc-inv-grid' }, h('div', { className: 'field' }, 'Tin nhắn (sửa được)', ta, h('label', { className: 'row', style: 'gap:6px;font-weight:500' }, withImg, 'Gửi kèm ảnh thực tế')), h('div', {}, img, hint)),
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' },
        h('button', { type: 'button', className: 'btn btn-ghost', textContent: '📋 Copy chữ', onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast('Đã copy.')) }), send));
    document.body.append(dlg); dlg.showModal();
  }
  // Hộp bảo hành: mỗi link 1 dòng (các đơn cùng link, kể cả từng cảm xúc), kiểm tra hạn, chọn Refill / Đơn bù, chạy hàng loạt có tiến độ.
  async function warrantyDialog(ctx = {}) {
    let list = []; try { list = await services(); } catch (e) { return toast(e.message, 7000); }
    const groups = await warrGroups(ctx.key);
    if (!groups.length) return toast('Khách này chưa có đơn dịch vụ nào trong 90 ngày.', 5000);
    // Link khách nhắc trong tin báo tụt (5 tin gần nhất có chữ "tụt / giảm / bảo hành…") → tích sẵn; không có thì tích các link còn bảo hành.
    const said = new Set(linksIn((ctx.messages || []).filter(m => m.isCustomer || m.mine === false).slice(-5).filter(m => COMPLAIN.test(m.text || ''))).map(linkKey));
    const anySaid = groups.some(g => said.has(linkKey(g.link)));
    const rows = groups.map(g => { const q = sumOf(g.orders, 'qty') || g.orders.reduce((t, o) => t + qtyOf(o), 0);
      return { g, on: anySaid ? said.has(linkKey(g.link)) && (g.ok || g.canBu) : g.ok, mode: g.allOk ? 'refill' : g.canBu ? 'bu' : 'refill', bu: Math.max(10, Math.ceil(q * 0.1 / 10) * 10), res: '', cls: '' }; });
    const dlg = h('dialog', { className: 'svc-dialog svc-bulk', onclose: () => dlg.remove() });
    const body = h('tbody'), prog = h('div', { className: 'svc-prog', hidden: true }), sum = h('div', { className: 'svc-sum' }), err = h('div', { className: 'status err', hidden: true });
    const snapIn = h('input', { type: 'checkbox', checked: !!window.metaDesktop?.svcSnap, disabled: !window.metaDesktop?.svcSnap });
    let busy = false, run = null;
    const what = g => g.orders.map(o => `${qtyOf(o).toLocaleString('vi-VN')}${o.reaction || /\((like|love|care|haha|wow|sad|angry)\)/i.test(o.displayName || '') ? ' ' + (String(o.displayName).match(/\((\w+)\)\s*$/)?.[1] || '').toLowerCase() : ''}`).join(' + ');
    const draw = () => {
      body.replaceChildren(...rows.map(r => { const g = r.g, o0 = g.orders[0], plat = LINK_PLAT[platformOf(g.link)] || '';
        const chip = r.res ? h('span', { className: 'status ' + r.cls, textContent: r.res }) : h('div', {}, ...g.st.map((s, i) => h('div', { className: 'hint' + (s.ok ? ' pos' : s.code === 'cancel' ? '' : ' neg'), textContent: (g.orders.length > 1 ? `#${g.orders[i].providerOrderId}: ` : '') + (s.ok ? '✓ ' : '✗ ') + s.text })));
        return h('tr', { className: r.on ? '' : 'off' },
          h('td', {}, h('input', { type: 'checkbox', checked: r.on, disabled: busy, onchange: e => { r.on = e.target.checked; draw(); } })),
          h('td', { className: 'svc-bulk-link' }, plat ? platBadge(plat, 18) : null, h('span', { className: 'svc-w-link' }, h('a', { href: g.link, target: '_blank', rel: 'noopener', textContent: shortLink(g.link) }),
            h('small', { className: 'hint', textContent: `${String(o0.displayName || o0.serviceName).replace(/\s*\((\w+)\)\s*$/, '')} · ${what(g)} · ${fmtTime(g.when)}${said.has(linkKey(g.link)) ? ' · khách vừa gửi link này' : ''}` }))),
          h('td', {}, chip),
          h('td', {}, h('select', { disabled: busy, onchange: e => { r.mode = e.target.value; draw(); } },
            h('option', { value: 'refill', selected: r.mode === 'refill', disabled: !g.ok, textContent: '🛡 Refill Baostar' + (g.ok ? '' : ' (không được)') }),
            h('option', { value: 'bu', selected: r.mode === 'bu', textContent: '🎁 Đơn bù miễn phí' })),
            r.mode === 'bu' ? h('label', { className: 'row', style: 'gap:6px;margin-top:4px;font-size:12px' }, 'Số bù', h('input', { type: 'number', min: 1, step: 1, value: r.bu, style: 'width:90px', disabled: busy, onchange: e => { r.bu = Math.max(1, Number(e.target.value) || 0); draw(); } })) : null,
            r.mode === 'bu' ? h('div', { className: 'hint', textContent: `Gốc ≈ ${money(buCost(r))} (tính chi phí bảo hành)` }) : null));
      }));
      const on = rows.filter(r => r.on), nR = on.filter(r => r.mode === 'refill' && r.g.ok).length, nB = on.filter(r => r.mode === 'bu').length;
      sum.replaceChildren(h('span', {}, h('strong', { textContent: String(on.length) }), ' link'), nR ? h('span', {}, `🛡 ${nR} refill`) : null, nB ? h('span', {}, `🎁 ${nB} đơn bù · gốc ≈ ${money(on.filter(r => r.mode === 'bu').reduce((t, r) => t + buCost(r), 0))}`) : null);
      go.disabled = busy || !on.some(r => r.mode === 'bu' || r.g.ok); go.textContent = busy ? 'Đang gửi bảo hành…' : `Bảo hành ${on.length} link`;
      prog.hidden = !run; if (run) prog.replaceChildren(h('div', { className: 'svc-prog-top' }, h('strong', { textContent: run.cur ? `Đang xử lý ${Math.min(run.done + 1, run.total)}/${run.total}…` : `Xong: ${run.ok}/${run.total} link` }),
        h('span', {}, h('span', { className: 'pos', textContent: `✓ ${run.ok}` }), run.fail ? h('span', { className: 'neg', textContent: ` · ✗ ${run.fail} lỗi` }) : null)),
        h('div', { className: 'svc-prog-bar' }, h('span', { style: `width:${Math.round(run.done / run.total * 100)}%`, className: run.fail ? 'warn' : '' })), run.last ? h('div', { className: 'hint', textContent: run.last }) : null);
    };
    // Đơn bù: chia số bù cho các đơn của link theo tỷ lệ số lượng (vd like + love), mỗi phần ≥ mức tối thiểu của máy chủ.
    const buParts = r => { const os = r.g.orders.filter(o => o.status !== 'cancelled'), Q = os.reduce((t, o) => t + qtyOf(o), 0) || 1;
      return os.map(o => { const x = list.find(y => y.id === String(o.serviceId)); return [o, x, Math.max(x?.min || 1, Math.round(r.bu * qtyOf(o) / Q))]; }).filter(([, x]) => x); };
    const buCost = r => buParts(r).reduce((t, [, x, k]) => t + estCost(x, k), 0);
    const go = h('button', { type: 'button', className: 'btn btn-primary', onclick: async () => {
      const todo = rows.filter(r => r.on && (r.mode === 'bu' || r.g.ok)); if (!todo.length) return;
      if (!confirm(`Bảo hành ${todo.length} link?\n\n${todo.map((r, i) => `${i + 1}. ${shortLink(r.g.link)} · ${r.mode === 'bu' ? `đơn bù ${r.bu.toLocaleString('vi-VN')}` : 'refill Baostar'}`).join('\n')}`)) return;
      busy = true; err.hidden = true; run = { total: todo.length, done: 0, ok: 0, fail: 0, cur: '', last: '' }; draw();
      const batch = { id: uid('wb'), at: Date.now(), key: ctx.key || '', name: ctx.name || '', pageKey: ctx.page?.id || '', items: [], done: false };
      for (const r of todo) {
        run.cur = r.g.link; draw();
        const item = { link: r.g.link, name: r.g.orders[0].displayName || r.g.orders[0].serviceName || '', mode: r.mode, refill: [], bu: [], qty: r.mode === 'bu' ? r.bu : 0 };
        try {
          if (r.mode === 'refill') {
            // Mỗi đơn của link (vd like + love) gửi riêng, lưu ngay; đơn nào Baostar từ chối thì ghi lại, không làm hỏng các đơn khác.
            const fails = [], tried = r.g.orders.filter(o => o.status !== 'cancelled' && warrState(o, list.find(x => x.id === String(o.serviceId))).ok);
            for (const o of tried) {
              try { const res = await call('refill', { order: Number(o.providerOrderId) }); const id = String(res?.refill ?? res?.id ?? res?.refill_id ?? '');
                if (!id || id === '0' || res?.error) throw Error(res?.error || 'Baostar không nhận bảo hành');
                const all = await DB.get(ORDERS, []), x = all.find(y => y.id === o.id); if (x) { x.refills = [...(x.refills || []), { id, at: Date.now(), status: 'Pending', batch: batch.id }]; await DB.set(ORDERS, all); }
                item.refill.push(o.id); }
              catch (e1) { fails.push(`#${o.providerOrderId}: ${e1.message}`); } }
            if (!item.refill.length) throw Error(fails.join(' · ') || 'Không có đơn nào bảo hành được');
            r.res = fails.length ? `🛡 Đã gửi refill ${item.refill.length}/${tried.length} · lỗi ${fails.join(' · ')}` : '🛡 Đã gửi refill'; r.cls = fails.length ? 'pending' : 'ok';
            if (fails.length) item.note = `${item.refill.length}/${tried.length} đơn`;
          } else {
            for (const [o, x, k] of buParts(r)) {
              const res = await call('add', { service: Number(x.id), link: o.link, quantity: k }); const oid = res?.order ?? res?.order_id ?? res?.id;
              if (!oid) throw Error(res?.error || 'Web dịch vụ không trả mã đơn.');
              const cost = estCost(x, k);
              const bo = { id: uid('ord'), at: Date.now(), updatedAt: Date.now(), source: 'service', provider: new URL((await settings()).apiUrl).hostname, providerOrderId: String(oid), payCode: '',
                warrantyFor: o.id, warrantyBatch: batch.id, serviceId: x.id, serviceName: x.name, displayName: '🛡 Bù bảo hành · ' + (o.displayName || o.serviceName || ''), packageId: '', link: o.link,
                customerKey: o.customerKey, pageKey: o.pageKey, pageName: o.pageName, pageAvatar: o.pageAvatar, customer: o.customer || { name: ctx.name || '' },
                items: [{ name: 'Bù bảo hành', qty: k, price: 0, cost: cost / k }], costManual: false, discount: 0, shipFee: 0, shipCost: 0, status: 'new', svcStatus: 'Pending', paidAmount: 0,
                note: `Đơn bù bảo hành cho #${o.providerOrderId} (khách không trả tiền; tiền gốc là chi phí bảo hành)` };
              await DB.set(ORDERS, [...await DB.get(ORDERS, []), bo]); item.bu.push(bo.id); }
            r.res = `🎁 Đã tạo đơn bù ${r.bu.toLocaleString('vi-VN')}`; r.cls = 'ok';
          }
          run.ok++; run.last = `✓ ${shortLink(r.g.link)}: ${r.res.replace(/^\S+ /, '')}`; batch.items.push(item);
        } catch (e) { r.res = '✗ ' + e.message; r.cls = 'err'; run.fail++; run.last = `✗ ${shortLink(r.g.link)}: ${e.message}`; if (item.refill.length || item.bu.length) batch.items.push(item); }
        run.done++; draw();
      }
      run.cur = ''; busy = false;
      if (batch.items.length) { await DB.set(WARR, [...(await warrBatches()).filter(b => Date.now() - b.at < 60 * 864e5), batch]); App.tabs.services?.refresh?.(); App.inbox?.orderChanged?.(); }
      draw();
      if (!batch.items.length) { err.textContent = 'Chưa bảo hành được link nào (lỗi ghi ở từng dòng). Đổi sang Đơn bù miễn phí hoặc thử lại sau.'; err.hidden = false; return; }
      // Tin "đã nhận bảo hành" + ảnh số hiện tại của các link.
      const text = ['🛡 BẢO HÀNH ĐƠN HÀNG', `Dạ shop đã nhận bảo hành ${batch.items.length} link cho mình ạ:`,
        ...batch.items.map((it, i) => `   ${i + 1}. ${shortLink(it.link)} · ${it.mode === 'bu' ? `bù thêm ${it.qty.toLocaleString('vi-VN')}` : 'đã gửi bảo hành'}`),
        '', '⏳ Hệ thống bù trong 24–72 giờ, xong em báo mình ngay ạ 🙏'].join('\n');
      await new Promise(r => setTimeout(r, 900)); dlg.close();
      sendDialog({ title: '🛡 Báo khách đã nhận bảo hành', key: ctx.key, text,
        makeImage: snapIn.checked ? () => snapGrid(batch.items.map(it => ({ link: it.link, name: it.name })), '🛡 Ghi nhận lúc nhận bảo hành') : null });
    } });
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '🛡 Bảo hành · ' + (ctx.name || 'Khách') }), h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('p', { className: 'hint', style: 'margin:0', textContent: 'Thời hạn theo máy chủ Baostar (tên ghi "BH 30 ngày"…), tính từ lúc đơn chạy xong; Baostar chỉ nhận refill sau 24 giờ. Không refill được thì chọn Đơn bù miễn phí: khách không trả thêm, tiền gốc tính là chi phí bảo hành.' }),
      prog,
      h('div', { className: 'scroll svc-bulk-wrap' }, h('table', { className: 'svc-table svc-bulk-table' }, h('thead', {}, h('tr', {}, ...['', 'Link · đơn', 'Bảo hành', 'Cách bù'].map(t => h('th', { textContent: t })))), body)),
      h('label', { className: 'row', style: 'gap:6px' }, snapIn, 'Chụp số like / follow hiện tại của từng link làm bằng chứng (gửi kèm tin cho khách)'),
      sum, err, h('div', { className: 'row svc-actions', style: 'gap:8px;justify-content:flex-end' }, h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Đóng', onclick: () => dlg.close() }), go));
    document.body.append(dlg); draw(); dlg.showModal();
  }
  // Lượt bảo hành xong hết (refill xong / bị từ chối, đơn bù chạy xong) → báo bạn + gợi ý "Báo khách đã bảo hành xong" trên ô soạn tin.
  async function checkWarranty() {
    const bs = await warrBatches(); if (!bs.some(b => !b.done)) return 0;
    const orders = await DB.get(ORDERS, []), byId = new Map(orders.map(o => [o.id, o])); let ch = 0;
    for (const b of bs) { if (b.done) continue;
      const states = b.items.flatMap(it => [...it.refill.map(id => { const r = byId.get(id)?.refills?.filter(x => x.batch === b.id).pop(); return r ? (REFILL_DONE.test(r.status || '') ? (/completed/i.test(r.status) ? 'ok' : 'bad') : 'run') : 'ok'; }),
        ...it.bu.map(id => { const o = byId.get(id); return !o ? 'ok' : o.status === 'done' ? 'ok' : o.status === 'cancelled' ? 'bad' : 'run'; })]);
      if (states.some(s => s === 'run')) continue;
      b.done = Date.now(); b.bad = states.filter(s => s === 'bad').length; ch++;
      App.notify?.(`🛡 Bảo hành xong: ${b.name || 'Khách'}`, b.bad ? `${b.bad} phần bị từ chối / huỷ: mở hộp Bảo hành để tạo đơn bù` : `${b.items.length} link đã bù xong`);
      if (b.key && !b.bad) addNudge(b.key, 'wdone', 'wb:' + b.id);
    }
    if (ch) await DB.set(WARR, bs);
    return ch;
  }

  // ── Dụ khách chốt đơn: Chưa chốt / Phân vân / Đã báo giá chưa chuyển tiền ──
  const plain = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ');
  const WHO = '(minh|em|e|anh|a|chi|c|t|toi|tui|tao|m|ac|bac|co)';
  const HESITATE = new RegExp([`\\bde ${WHO}? ?(suy nghi|xem (lai|da|sao|the nao)|tinh (lai|da|sau)|hoi (lai|y|chong|vo|sep|ban)|can nhac|coi lai)`, 'suy nghi (them|da|lai)', 'can nhac', 'phan van', 'ban khoan', 'luong lu', 'chua chac',
    'gia (cao|chat) (qua|the|vay)', 'giam (gia|chut xiu|chut|duoc|dc|it|xiu) (khong|ko|k|hong|di|nha|nhe|duoc|dc|cho)', 'bot (chut|duoc|dc|it|xiu|cho|gia)', 'co giam (gia|duoc|dc|khong|ko|k|hong)', 're hon', 'cho (xin )?(gia|giam) (tot|mem|re)',
    'uy tin (khong|ko|k|hong|ha|ko\\?)', 'co uy tin', 'lua dao', 'co lua', 'co that (khong|ko|k|hong)', 'an toan (khong|ko|k|hong)', 'co bi (khoa|die|tut|mat|checkpoint|chet|block|giam)[^.!]{0,25}(khong|ko|k|hong|\\?)', 'so (bi lua|bi khoa|bi die|mat tien)', 'lo bi (lua|khoa|die)',
    'tinh sau', 'luc khac', 'de sau', 'hom khac', 'bua khac', 'chua can', 'chua co tien', 'het tien', 'cuoi thang', 'dau thang', 'luong ve', '\\bde (mai|toi|chieu|tuan sau)', '\\bhmm+', '\\buhm+'].join('|'));
  const PRICE = /gia (cao|chat)|giam|bot (chut|duoc|dc|it|xiu|cho|gia)|re hon|chua co tien|het tien|cuoi thang|dau thang|luong ve/;
  // "đắt" và "đặt" (đặt đơn) giống nhau khi bỏ dấu: chỉ nhận "đắt / mắc" có dấu, hoặc tin gõ không dấu cả câu.
  const PRICY = /(đắt|mắc|chát)\s*(quá|thế|vậy|vại|nhỉ|ha|ghê|xỉu|v\b)|hơi (đắt|mắc|cao)|(?:^|\s)(dat|mac) (qua|ghe|xiu)(?:\s|$|[!?.])/i;
  const accented = t => /[^\x00-\x7f]/.test(t);
  // Xét 3 tin gần nhất của khách (chuỗi hoặc { text, ts }).
  const hesitation = texts => { for (const x of (texts || []).slice(-3).reverse()) { const t = typeof x === 'string' ? x : x?.text || '', p = plain(t);
    const pricy = PRICY.test(t.toLowerCase()) && (accented(t) ? /đắt|mắc|chát|cao/i.test(t) : true);
    if (pricy || HESITATE.test(p)) return { text: t, price: pricy || PRICE.test(p) }; } return null; };
  // Khách đã từng mua (đơn bất kỳ còn hiệu lực, hoặc báo giá đã thu tiền): không còn là "chưa chốt".
  // lastBuy: lần mua gần nhất theo khách (đơn tạo từ Hộp thư có customerKey; đơn nhập tay / tab Dịch vụ thì ghép theo Page + tên khách).
  async function salesInfo() {
    const bought = new Set(), lastBuy = new Map(), mark = (k, at) => { if (!k) return; bought.add(k); if ((at || 0) > (lastBuy.get(k) || 0)) lastBuy.set(k, at || 1); };
    for (const o of await DB.get(ORDERS, [])) { if (o.status === 'cancelled' || o.warrantyFor) continue;
      mark(o.customerKey, o.at); const n = o.customer?.name; if (n) { mark(App.crmKey(o.pageKey || '', n), o.at); if (!o.pageKey) bought.add('*|' + norm(n)); } }
    for (const q of await quotes()) if (q.state === 'paid') mark(q.customerKey, q.paidAt || q.at);
    return { bought: { has: k => bought.has(k) || bought.has('*|' + String(k).split('|').slice(1).join('|')) }, lastBuy };
  }
  const dukBonus = () => Math.max(1, Math.min(100, Number(local.get('dukBonus')) || 10));
  const callName = n => { const w = String(n || '').trim().split(/\s+/).filter(Boolean); return !w.length || /^kh[aá]ch$/i.test(n) ? 'mình' : w[w.length - 1]; };
  // Tin soạn sẵn theo giai đoạn. {ten} {ma} {tien} {dv} {tang} được thay theo từng khách (dùng cả khi gửi hàng loạt).
  const DUK = {
    quoted: [
      ['Nhắc khéo', 'Dạ {ten} ơi, báo giá #{ma} ({dv}) em vẫn đang giữ cho mình ạ. Mình chuyển khoản {tien} là em lên đơn ngay, thường vài phút là bắt đầu chạy rồi ạ 🙏'],
      ['Tặng thêm {tang}%', 'Dạ {ten} ơi, mình chốt đơn #{ma} trong hôm nay em tặng thêm {tang}% số lượng cho mình nha 🎁 Giá vẫn {tien} thôi ạ, ưu đãi em giữ đến hết hôm nay ạ.'],
      ['Hỏi vướng gì', 'Dạ {ten} còn băn khoăn chỗ nào không ạ? Đơn bên em đều có bảo hành, số lượng tụt là em bù miễn phí nên mình yên tâm nha. Cần em tư vấn thêm cứ nhắn em ạ 😊']],
    hesitant: [
      ['Trấn an', 'Dạ em hiểu ạ 🙏 Bên em làm lâu rồi, đơn nào cũng có bảo hành: số lượng tụt là em bù miễn phí. Mình cần em gửi ảnh đơn khách cũ để xem trước không ạ?'],
      ['Về giá + tặng {tang}%', 'Dạ giá bên em đã gồm bảo hành rồi ạ, gói rẻ hơn ngoài kia thường tụt nhanh mà không ai bù. Mình chốt trong hôm nay em tặng thêm {tang}% số lượng cho mình nha 🎁'],
      ['Tặng thêm {tang}%', 'Dạ {ten} ơi, nếu mình chốt trong hôm nay em tặng thêm {tang}% số lượng nha 🎁 Mình gửi em link là em lên đơn liền ạ.']],
    open: [
      ['Hỏi lại', 'Dạ em chào {ten} 😊 Hôm trước mình có hỏi dịch vụ bên em, không biết mình đã chọn được gói chưa ạ? Mình gửi em link bài/trang, em báo giá chính xác cho mình liền nha.'],
      ['Tặng thêm {tang}%', 'Dạ {ten} ơi, hôm nay bên em tặng thêm {tang}% số lượng cho đơn đầu tiên ạ 🎁 Mình gửi em link là em lên đơn luôn nha.'],
      ['Nhắc khéo', 'Dạ {ten} cần tăng like, follow hay tương tác cho trang nào cứ nhắn em nha, em tư vấn gói vừa túi tiền cho mình ạ 🙏']]
  };
  const STAGE_NAME = { quoted: 'Đã báo giá, chưa chuyển tiền', hesitant: 'Khách đang phân vân', open: 'Chưa chốt đơn' };
  function dukFill(tpl, { name, q } = {}) {
    const v = { ten: callName(name), tang: String(dukBonus()), ma: q?.payCode || '', tien: q ? money(amountDue(q) || q.sell) : '', dv: q ? shortSvc({ displayName: quoteShort(q) }) : '' };
    let t = String(tpl).replace(/\{(ten|tang|ma|tien|dv)\}/g, (_, k) => v[k]);
    if (!q) t = t.replace(/ ?#\s*(?=[ ,.(])/g, ' ').replace(/ \(\)/g, '').replace(/ {2,}/g, ' ');
    return t;
  }
  // stage: quoted | hesitant | open → [{ label, text }]. Khách phân vân vì giá: mẫu "Về giá" lên đầu.
  function dukTexts(stage, ctx = {}) {
    let list = DUK[stage] || [];
    if (stage === 'hesitant') list = ctx.price ? [list[1], list[0], list[2]] : [list[0], list[2], list[1]];
    if (stage === 'hesitant' && ctx.q) list = list.map(([l, t]) => /^Tặng/.test(l) ? [l, 'Dạ {ten} ơi, mình chuyển khoản {tien} cho đơn #{ma} trong hôm nay em tặng thêm {tang}% số lượng nha 🎁 Em lên đơn liền cho mình ạ.'] : [l, t]);
    return list.map(([l, t]) => ({ label: l.replace('{tang}', dukBonus()), tpl: t, text: dukFill(t, ctx) }));
  }

  // ── Dữ liệu cho ✨ Gợi ý AI trong Hộp thư: bảng giá gói bán + đơn / báo giá của khách + thông tin hoá đơn ──
  async function aiContext(key) {
    const s = await settings(); let list = []; try { list = await services(); } catch {}
    const byId = new Map(list.map(x => [x.id, x])), vnd = n => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';
    const prices = (s.packages || []).map(p => ({ p, v: byId.get(String(p.serviceId)) })).filter(({ v }) => !v || stateOf(v)[1] !== 'err').slice(0, 80).map(({ p, v }) => {
      const days = v ? warrDays({}, v) : 0;
      const price = p.kind === 'fixed' ? `${Number(p.qty || 0).toLocaleString('vi-VN')} = ${vnd(p.price)}` : `${vnd(Number(p.unitPrice) * 1000)} / 1.000 (đơn giá ${p.unitPrice}đ)`;
      return `- [${p.id}] ${p.name}: ${price}${v ? `; mua từ ${Number(v.min).toLocaleString('vi-VN')} đến ${Number(v.max).toLocaleString('vi-VN')}` : ''}${days ? `; bảo hành ${days} ngày` : ''}${v?.avgTime ? `; thời gian chạy ${v.avgTime}` : ''}`; });
    const os = key ? (await DB.get(ORDERS, [])).filter(o => o.customerKey === key && !o.warrantyFor).sort((a, b) => b.at - a.at).slice(0, 8) : [];
    const orders = os.map(o => `- ${new Date(o.at).toLocaleDateString('vi-VN')}: ${o.displayName || o.serviceName || 'đơn'} · ${vnd(orderSell(o))} · ${o.status === 'done' ? 'đã xong' : o.status === 'cancelled' ? 'đã huỷ' : 'đang chạy'}${o.link ? ' · ' + o.link : ''}`);
    const qs = key ? (await quotes()).filter(q => q.customerKey === key) : [];
    const pending = qs.map(q => `- Báo giá #${q.payCode}: ${quoteShort(q)} · ${q.state === 'paid' ? 'đã chuyển tiền, chờ lên đơn' : `chờ chuyển ${vnd(amountDue(q) || q.sell)}${expired(q) ? ' (đã hết hạn giữ giá)' : ''}`}`);
    return { prices, orders, pending, invoice: s.invoice || {}, bank: s.invoice?.acc ? `${bankName(s.invoice.bin) || 'Ngân hàng'} · STK ${s.invoice.acc}${s.invoice.holder ? ' · ' + s.invoice.holder : ''}` : '' };
  }

  // ── Dùng cho Kế hoạch tự động (js/auto.js): bảo hành tự động + gửi gợi ý đơn tự động, không mở hộp thoại ──
  // Bảo hành tự động: chỉ REFILL Baostar (không tốn tiền) cho link khách nhắc trong tin báo tụt và còn bảo hành; đơn bù (tốn tiền) để bạn tự làm.
  // Gửi refill Baostar (miễn phí) cho các đơn còn bảo hành của 1 link; lưu mã refill vào đơn. Trả về { item, fails }.
  async function refillGroup(g, list, batchId) {
    const item = { link: g.link, name: g.orders[0].displayName || g.orders[0].serviceName || '', mode: 'refill', refill: [], bu: [], qty: 0 }, fails = [];
    for (const o of g.orders.filter(o => o.status !== 'cancelled' && warrState(o, list.find(x => x.id === String(o.serviceId))).ok)) {
      try { const res = await call('refill', { order: Number(o.providerOrderId) }); const id = String(res?.refill ?? res?.id ?? res?.refill_id ?? '');
        if (!id || id === '0' || res?.error) throw Error(res?.error || 'Baostar không nhận bảo hành');
        const all = await DB.get(ORDERS, []), x = all.find(y => y.id === o.id); if (x) { x.refills = [...(x.refills || []), { id, at: Date.now(), status: 'Pending', batch: batchId }]; x.updatedAt = Date.now(); x.drop = null; await DB.set(ORDERS, all); }
        item.refill.push(o.id); } catch (e) { fails.push(`#${o.providerOrderId}: ${e.message}`); }
    }
    return { item, fails };
  }
  async function saveBatch(batch) { await DB.set(WARR, [...(await warrBatches()).filter(b => Date.now() - b.at < 60 * 864e5), batch]); App.tabs.services?.refresh?.(); App.inbox?.orderChanged?.(); }

  // ── Tự phát hiện tụt ── Đơn đã xong, còn bảo hành: app tự chụp trang của link (12 giờ / lần), so số thật với số bắt đầu + số đã mua.
  // Thiếu ≥ 10% (tối thiểu 10) → đánh dấu tụt, báo bạn; bấm 1 nút là gửi refill Baostar (miễn phí) + nhắn khách.
  const DROP_EVERY = 12 * 36e5;
  async function dropGroups(key) {
    let list = []; try { list = await services(); } catch { return []; }
    const by = new Map();
    for (const o of (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && !o.warrantyFor && o.status === 'done' && o.link && (!key || o.customerKey === key))) {
      const m = metricOf(o.displayName || o.serviceName || ''), st = o.startCount != null ? num(o.startCount) : o.baseCount; if (!m || !Number.isFinite(st)) continue;
      const k = linkKey(o.link) + '|' + m; if (!by.has(k)) by.set(k, { link: o.link, metric: m, orders: [] }); by.get(k).orders.push(o); }
    return [...by.values()].map(g => { const sts = g.orders.map(o => warrState(o, list.find(x => x.id === String(o.serviceId))));
      const expected = Math.min(...g.orders.map(o => o.startCount != null ? num(o.startCount) : o.baseCount)) + g.orders.reduce((t, o) => t + qtyOf(o), 0);
      return { ...g, ok: sts.some(x => x.ok), st: sts, expected, drop: g.orders.find(o => o.drop)?.drop || null, checkedAt: Math.max(0, ...g.orders.map(o => o.dropAt || 0)) }; })
      .filter(g => g.ok || g.drop);
  }
  let dropRunning = false;
  async function dropScan({ max = 6, key = '', force = false } = {}) {
    if (!window.metaDesktop?.svcSnap || dropRunning || !(await settings()).apiKey) return [];
    dropRunning = true; const found = [];
    try {
      const todo = (await dropGroups(key)).filter(g => g.ok && (force || Date.now() - g.checkedAt > DROP_EVERY)).sort((a, b) => a.checkedAt - b.checkedAt).slice(0, max);
      for (const g of todo) {
        const r = await window.metaDesktop.svcSnap({ url: g.link }).catch(() => null), v = r?.metrics?.[g.metric];
        const qty = g.orders.reduce((t, o) => t + qtyOf(o), 0), lost = Number.isFinite(v) ? g.expected - v : 0;
        const drop = Number.isFinite(v) && lost >= Math.max(10, qty * 0.1) ? { at: Date.now(), now: v, expected: g.expected, lost, metric: g.metric } : null;
        const all = await DB.get(ORDERS, []), ids = new Set(g.orders.map(o => o.id));
        for (const o of all) if (ids.has(o.id)) { o.dropAt = Date.now(); if (Number.isFinite(v)) o.drop = drop; o.updatedAt = Date.now(); }
        await DB.set(ORDERS, all);
        if (drop && !g.drop) { found.push({ ...g, drop }); const c = g.orders[0].customer?.name || 'Khách';
          App.notify?.(`📉 Phát hiện tụt: ${c}`, `${shortLink(g.link)} đang ${v.toLocaleString('vi-VN')}/${g.expected.toLocaleString('vi-VN')} ${LABEL[g.metric] || ''} (thiếu ${lost.toLocaleString('vi-VN')}) · còn bảo hành`); }
      }
    } finally { dropRunning = false; }
    if (found.length) { App.tabs.services?.refresh?.(); App.inbox?.orderChanged?.(); }
    return found;
  }
  setTimeout(() => { dropScan().catch(() => {}); setInterval(() => dropScan().catch(() => {}), 2 * 36e5); }, 90e3);
  // Bấm 1 nút: refill Baostar (miễn phí, chỉ đơn còn bảo hành) cho các link bị tụt của khách, rồi nhắn khách ngay.
  async function quickWarranty(key, { notify = true, groups = null } = {}) {
    let list = []; try { list = await services(); } catch (e) { return toast(e.message, 6000); }
    const gs = (groups || (await dropGroups(key)).filter(g => g.drop)).filter(g => g.ok);
    if (!gs.length) return toast('Không còn link nào bị tụt mà còn bảo hành.', 5000);
    const name = gs[0].orders[0].customer?.name || '';
    const batch = { id: uid('wb'), at: Date.now(), key: key || '', name, pageKey: gs[0].orders[0].pageKey || '', items: [], done: false }, fails = [];
    for (const g of gs) { const r = await refillGroup(g, list, batch.id); fails.push(...r.fails); if (r.item.refill.length) batch.items.push({ ...r.item, drop: g.drop }); }
    if (!batch.items.length) return toast('Baostar chưa nhận bảo hành: ' + (fails.join(' · ') || 'không rõ lý do') + '. Dùng nút Kiểm tra / gửi hỗ trợ.', 9000);
    await saveBatch(batch);
    const text = ['🛡 BẢO HÀNH ĐƠN HÀNG', `Dạ shop kiểm tra thấy ${batch.items.length > 1 ? `${batch.items.length} link` : 'link'} của mình bị tụt nên đã gửi bảo hành bù miễn phí ạ:`,
      ...batch.items.map((it, i) => `   ${i + 1}. ${shortLink(it.link)}${it.drop ? ` · đang ${it.drop.now.toLocaleString('vi-VN')}/${it.drop.expected.toLocaleString('vi-VN')} ${LABEL[it.drop.metric] || ''}, bù ${it.drop.lost.toLocaleString('vi-VN')}` : ''}`),
      '', '⏳ Hệ thống bù trong 24–72 giờ, xong em báo mình ngay ạ 🙏'].join('\n');
    toast(`🛡 Đã gửi bảo hành ${batch.items.length} link${fails.length ? ` (lỗi: ${fails.join(' · ')})` : ''}.`, 6000);
    if (!notify || !key) return batch;
    try { await App.inbox.auto.sendKey(key, text); toast('Đã nhắn khách: shop đã bảo hành.', 4000); }
    catch { sendDialog({ title: '🛡 Báo khách đã bảo hành', key, text }); } // không gửi thẳng được (khách không có trong danh sách…) → mở khung gửi
    return batch;
  }
  // Kiểm tra đơn của khách + gửi hỗ trợ Baostar (ngay tại hội thoại khách khiếu nại).
  const PROBLEMS = ['Tụt sau khi hoàn thành', 'Chạy chậm / đứng lâu', 'Chưa chạy', 'Báo hoàn thành nhưng thiếu số lượng', 'Khác'];
  async function checkDialog(ctx = {}) {
    let list = []; try { list = await services(); } catch (e) { return toast(e.message, 6000); }
    const groups = await warrGroups(ctx.key); if (!groups.length) return toast('Khách này chưa có đơn dịch vụ nào trong 90 ngày.', 5000);
    const said = (ctx.messages || []).filter(m => m.isCustomer || m.mine === false).slice(-5).map(m => m.text || '').filter(t => COMPLAIN.test(t) || /chưa|chậm|lâu|lỗi|không lên|ko lên/i.test(t)).pop() || '';
    const dlg = h('dialog', { className: 'svc-dialog svc-bulk', onclose: () => dlg.remove() }), body = h('div', { className: 'svc-check' });
    dlg.append(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '🔎 Kiểm tra đơn · ' + (ctx.name || 'Khách') }), h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      said ? h('div', { className: 'svc-hintline' }, 'Khách nhắn: ', h('strong', { textContent: `“${said.slice(0, 160)}”` })) : null, body);
    document.body.append(dlg); dlg.showModal();
    body.replaceChildren(h('p', { className: 'hint', textContent: 'Đang hỏi Baostar trạng thái đơn…' }));
    const ids = groups.flatMap(g => g.orders.map(o => o.providerOrderId)).filter(Boolean).slice(0, 100);
    let live = {}; try { live = ids.length === 1 ? { [ids[0]]: await call('status', { order: Number(ids[0]) }) } : await call('status', { orders: ids.join(',') }); } catch (e) { body.prepend(h('p', { className: 'status err', textContent: 'Không hỏi được Baostar: ' + e.message })); }
    const card = g => { const o0 = g.orders[0], m = metricOf(o0.displayName || o0.serviceName || ''), real = h('span', { className: 'hint' });
      const rows = g.orders.map(o => { const st = live?.[o.providerOrderId] || {}, ws = warrState(o, list.find(x => x.id === String(o.serviceId))), last = o.refills?.[o.refills.length - 1];
        return h('div', { className: 'svc-check-row' },
          h('div', {}, h('strong', { textContent: `#${o.providerOrderId}` }), ` · ${o.displayName || o.serviceName || ''} · SL ${qtyOf(o).toLocaleString('vi-VN')}`),
          h('div', { className: 'hint', textContent: [st.error ? 'Baostar: ' + st.error : `Baostar: ${statusVi(st.status || o.svcStatus)}`, st.start_count != null ? `bắt đầu ${num(st.start_count).toLocaleString('vi-VN')}` : '',
            st.remains != null ? `còn thiếu ${num(st.remains).toLocaleString('vi-VN')}` : '', ws.text, last ? `bảo hành: ${refillVi(last.status)}` : '', o.drop ? `📉 tụt ${o.drop.lost.toLocaleString('vi-VN')} (${fmtTime(o.drop.at)})` : ''].filter(Boolean).join(' · ') })); });
      const problem = h('select', {}, ...PROBLEMS.map(t => h('option', { textContent: t, selected: g.orders.some(o => o.drop) ? t === PROBLEMS[0] : /chưa/i.test(said) ? t === PROBLEMS[2] : false })));
      const note = h('input', { type: 'text', placeholder: 'Ghi thêm cho Baostar (không bắt buộc)' });
      const ticket = () => [`Đơn ${g.orders.map(o => '#' + o.providerOrderId).join(', ')} – ${o0.displayName || o0.serviceName || ''}`, `Link: ${g.link}`, `Vấn đề: ${problem.value}`,
        ...g.orders.map(o => { const st = live?.[o.providerOrderId] || {}; return `#${o.providerOrderId}: SL ${qtyOf(o)}, trạng thái ${st.status || o.svcStatus || '?'}${st.start_count != null ? `, start ${st.start_count}` : ''}${st.remains != null ? `, remains ${st.remains}` : ''}`; }),
        real.dataset.v ? `Hiện tại trên trang: ${real.dataset.v} ${LABEL[m] || ''} (kiểm tra lúc ${new Date().toLocaleString('vi-VN')})` : '', note.value.trim(), 'Nhờ shop kiểm tra và xử lý giúp. Cảm ơn!'].filter(Boolean).join('\n');
      return h('div', { className: 'svc-check-card' },
        h('div', { className: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, h('a', { href: g.link, target: '_blank', rel: 'noopener', textContent: shortLink(g.link) }), real,
          m && window.metaDesktop?.svcSnap ? h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '📏 Đo số thật', onclick: async e => { e.target.disabled = true; real.textContent = 'Đang mở trang…';
            const r = await window.metaDesktop.svcSnap({ url: g.link }).catch(() => null), v = r?.metrics?.[m];
            const st0 = g.orders.map(o => live?.[o.providerOrderId]?.start_count ?? o.startCount ?? o.baseCount).filter(x => x != null).map(num), exp = st0.length ? Math.min(...st0) + g.orders.reduce((t, o) => t + qtyOf(o), 0) : null;
            if (Number.isFinite(v)) { real.dataset.v = v; real.textContent = `Hiện ${v.toLocaleString('vi-VN')} ${LABEL[m] || ''}${exp ? ` / cần ${exp.toLocaleString('vi-VN')}${exp - v > 0 ? ` · thiếu ${(exp - v).toLocaleString('vi-VN')}` : ' · đủ'}` : ''}`; }
            else real.textContent = r?.error || 'Không đọc được số trên trang'; e.target.disabled = false; } }) : null),
        ...rows,
        h('div', { className: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:6px' },
          g.ok ? h('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '🛡 Bảo hành (refill, miễn phí)', onclick: async e => { e.target.disabled = true; await quickWarranty(ctx.key, { groups: [g] }); dlg.close(); } }) : null,
          problem, note,
          h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: '📨 Gửi hỗ trợ Baostar', title: 'Chép nội dung hỗ trợ (mã đơn, link, số liệu) rồi mở trang Hỗ trợ của Baostar để dán và gửi', onclick: () => supportBaostar(ticket()) }))); };
    body.replaceChildren(...groups.map(card));
  }
  // Trang Hỗ trợ của web: tìm link "Hỗ trợ" trong menu trang (phiên đăng nhập cột Dịch vụ); không thấy thì mở trang chủ.
  async function supportBaostar(text) {
    await navigator.clipboard.writeText(text).catch(() => {});
    const s = await settings(), origin = webOrigin(s); let url = origin;
    try { const r = await window.metaDesktop?.svcTopup?.({ origin }); const doc = new DOMParser().parseFromString(r?.html || '', 'text/html');
      const a = [...doc.querySelectorAll('a[href]')].find(x => /^\s*(hỗ trợ|ticket|support)\s*$/i.test(x.textContent)); if (a) url = new URL(a.getAttribute('href'), origin).href; } catch {}
    if (window.metaDesktop?.openService) window.metaDesktop.openService(url); else window.open(url, '_blank', 'noopener');
    toast('Đã chép nội dung hỗ trợ (mã đơn, link, số liệu). Dán vào ô nội dung ở trang Hỗ trợ của Baostar rồi gửi.', 9000);
  }
  async function autoWarranty(ctx = {}) {
    const info = await complaintInfo(ctx.key, ctx.messages); if (!info) return null;
    let list = []; try { list = await services(); } catch (e) { return { error: e.message }; }
    const said = new Set(linksIn((ctx.messages || []).filter(m => m.isCustomer || m.mine === false).slice(-5).filter(m => COMPLAIN.test(m.text || ''))).map(linkKey));
    const pick = info.groups.filter(g => g.ok && (!said.size || said.has(linkKey(g.link))));
    if (!pick.length) return { skipped: info.ok ? 'link khách nhắc không còn bảo hành' : 'không link nào còn bảo hành (cần bạn xem: đơn bù / hết hạn)' };
    const batch = { id: uid('wb'), at: Date.now(), key: ctx.key || '', name: ctx.name || '', pageKey: ctx.page?.id || '', items: [], done: false, auto: true }, fails = [];
    for (const g of pick) { const r = await refillGroup(g, list, batch.id); fails.push(...r.fails); if (r.item.refill.length) batch.items.push(r.item); }
    if (!batch.items.length) return { error: fails.join(' · ') || 'Baostar không nhận refill' };
    await saveBatch(batch);
    const text = ['🛡 BẢO HÀNH ĐƠN HÀNG', `Dạ shop đã nhận bảo hành ${batch.items.length} link cho mình ạ:`, ...batch.items.map((it, i) => `   ${i + 1}. ${shortLink(it.link)} · đã gửi bảo hành`),
      '', '⏳ Hệ thống bù trong 24–72 giờ, xong em báo mình ngay ạ 🙏'].join('\n');
    const img = await snapGrid(batch.items.map(it => ({ link: it.link, name: it.name })), '🛡 Ghi nhận lúc nhận bảo hành').catch(() => null);
    return { text, image: img?.dataUrl || '', n: batch.items.length, fails };
  }
  // Gợi ý đơn đang chờ gửi (đã bắt đầu / xong / đã nhận tiền / bảo hành xong…) → nội dung đầy đủ (kèm ảnh) để gửi tự động.
  const autoNudgeList = async () => (await nudges()).filter(n => n.key && Date.now() - n.at < 3 * 864e5);
  async function autoNudgeFull(n) { const m = await nudgeText(n, true).catch(() => null); if (!m) { await dropNudge(n.id, n.key); return null; } return { ...m, title: NUDGE_TITLE[n.kind] || n.kind }; }
  const autoNudgeDone = n => dropNudge(n.id, n.key);

  // ── Điều khiển từ xa (Telegram) ──
  const remote = {
    quotes: async () => (await quotes()).filter(q => q.state !== 'paid' || !q.lines?.every(l => l.done)).sort((a, b) => b.at - a.at),
    async payAndCreate(id, amount) {
      const q = (await quotes()).find(x => x.id === id); if (!q) return { error: 'Báo giá không còn (đã tạo đơn hoặc đã huỷ).' };
      const add = amount == null ? amountDue(q) : Number(amount) || 0;
      Object.assign(q, { paidAmount: (q.paidAmount || 0) + add, paidAt: Date.now(), state: 'paid', payNote: [q.payNote, 'Xác nhận qua Telegram'].filter(Boolean).join(' · ') });
      await saveQuote(q); App.tabs.services?.refresh?.(); addNudge(q.customerKey, 'paid', q.id).catch(() => {});
      return confirmCreate(q, { auto: true });
    },
    async cancel(id) { const q = (await quotes()).find(x => x.id === id); if (!q) return { error: 'Báo giá không còn.' };
      await dropQuote(q.id); orderedCache = null; if (q.customerKey) App.crm?.update?.(q.customerKey, { orderStatus: '' }).catch(() => {}); App.tabs.services?.refresh?.(); App.inbox?.orderChanged?.(); return { ok: true, q }; },
    preview: (ctx, links) => bulkDialog({ ...ctx, headless: true }, links),
    async quoteMessage(q) { const s = await settings(), inv = s.invoice || {}; const img = await invoiceImage(q, inv, 'quote').catch(() => null); return { text: invoiceText(q, inv, 'quote'), image: img?.dataUrl || '' }; },
    async orders(days = 3) { return (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && Date.now() - o.at < days * 864e5).sort((a, b) => b.at - a.at); },
    async stats() {
      const os = (await DB.get(ORDERS, [])).filter(o => o.source === 'service' && o.status !== 'cancelled' && !o.warrantyFor), d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const m0 = new Date(d0); m0.setDate(1);
      const sum = list => ({ n: list.length, sell: list.reduce((t, o) => t + orderSell(o), 0), cost: list.reduce((t, o) => t + (Number(o.items?.[0]?.cost) || 0) * (Number(o.items?.[0]?.qty) || 0), 0) });
      let bal = null; try { bal = await vndBalance(); } catch {}
      return { today: sum(os.filter(o => o.at >= d0.getTime())), month: sum(os.filter(o => o.at >= m0.getTime())), running: os.filter(o => !['done', 'cancelled'].includes(o.status)).length,
        pending: (await quotes()).filter(q => q.state === 'quote').length, balance: bal };
    },
    guess: text => guessOrder([{ isCustomer: true, text }]), linksIn: t => splitLinks(t), money
  };

  App.services = { dropScan, dropGroups, quickWarranty, checkDialog, topupDialog, parseTopup, remote, autoWarranty, autoNudgeList, autoNudgeFull, autoNudgeDone, aiContext, hesitation, salesInfo, dukTexts, dukFill, dukBonus, DUK, STAGE_NAME, warrantyDialog, complaintInfo, checkWarranty, splitLinks, bulkDialog, orderedLinks, linkKey, nudgeCard, askCheck, platBadge, linkPlatform: l => LINK_PLAT[platformOf(l)] || '', createDialog, closeDock, orderStates, orderBar, inboxBox, refreshStatus, linksIn, call, openWeb, mapStatus, catalogProgress, noteLines, speedOf, invoiceDialog, invoiceText, paymentDialog, confirmCreate, quotes, renewQuote, vipTick, termOf, requestRefill, refreshRefills };
})();
