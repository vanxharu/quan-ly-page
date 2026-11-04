/* Lõi trang web Meta Assistant: tiện ích DOM, kho dữ liệu (IndexedDB), Graph API, đăng nhập, điều hướng.
 * Mỗi tính năng là một file js/*.js gọi App.tab(id, { mount, refresh }) để đăng ký tab. */
'use strict';
const App = window.App = { tabs: {}, pages: [], listeners: {} };

App.VERSION = 'v25.0';
App.GRAPH = `https://graph.facebook.com/${App.VERSION}`;
// Ứng dụng "INBOX" dùng Facebook Login for Business: quyền nằm trong cấu hình (config_id), không truyền scope.
App.DEFAULT_APP_ID = '1062977306762250';
App.CONFIG_ID = '1092800303751533';

// Điều hướng 2 tầng giống tiện ích: nhóm → tab con [id, nhãn, biểu tượng].
App.NAV = {
  messages: ['Tin nhắn', [['inbox', 'Hộp thư', 'i-msg'], ['templates', 'Mẫu tin', 'i-msg'], ['crm', 'Khách hàng', 'i-user'], ['bulk', 'Gửi hàng loạt', 'i-send']]],
  publishing: ['Đăng bài', [['post', 'Đăng Fanpage', 'i-pen'], ['planner', 'Lịch đăng', 'i-cal'], ['scheduled', 'Đã hẹn trên FB', 'i-cal'], ['topics', 'Chủ đề', 'i-grid']]],
  auto: ['Tự động', [['botrules', 'Từ khoá', 'i-msg'], ['botcomments', 'Bình luận tự động', 'i-like'], ['botflows', 'Kịch bản', 'i-grid'], ['botmenu', 'Menu & lời chào', 'i-gear'], ['botlog', 'Nhật ký & đơn bot', 'i-cal']]],
  engage: ['Tương tác', [['comments', 'Bình luận', 'i-like'], ['scanner', 'Quét bài viết', 'i-search']]],
  manage: ['Quản lý', [['dashboard', 'Tổng quan', 'i-grid'], ['calendar', 'Lịch nội dung', 'i-cal'], ['stats', 'Số liệu', 'i-grid'], ['sales', 'Bán hàng', 'i-cart'], ['settings', 'Cài đặt', 'i-gear']]]
};

// ── Tiện ích DOM ───────────────────────────────────────────
const $ = id => document.getElementById(id);
// Dựng DOM bằng textContent: nội dung tin nhắn/bình luận là của người lạ, không được chèn làm HTML.
function h(tag, { dataset, style, ...props } = {}, ...kids) {
  const el = document.createElement(tag);
  // aria-*, list… là thuộc tính HTML (không có property ghi được) nên phải setAttribute.
  for (const [k, v] of Object.entries(props)) if (k.includes('-') || k === 'list') { if (v != null) el.setAttribute(k, v); } else el[k] = v;
  if (dataset) Object.assign(el.dataset, dataset);
  if (style) el.style.cssText = style;
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
  return el;
}
// replaceChildren/append biến null thành chữ "null"; bỏ qua null/false để viết được `cond ? el : null`.
for (const fn of ['replaceChildren', 'append']) {
  const orig = Element.prototype[fn];
  Element.prototype[fn] = function (...kids) { return orig.apply(this, kids.filter(k => k != null && k !== false)); };
}
function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ico');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#' + id);
  svg.append(use); return svg;
}
const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const fmtTime = t => t ? new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fmtShort = t => t ? new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
const money = v => `${Math.round(Number(v) || 0).toLocaleString('vi-VN')}đ`;
const num = v => Number(v || 0).toLocaleString('vi-VN');
const initials = name => (name || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase();
const empty = text => h('div', { className: 'empty', textContent: text });
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toLocalInput = at => at ? new Date(at - new Date(at).getTimezoneOffset() * 60e3).toISOString().slice(0, 16) : '';
const LABEL_TONE = { 'tiếp nhận': 'blue', 'đủ tiêu chuẩn': 'amber', 'đã chuyển đổi': 'green', 'không hoạt động': 'gray', 'khách hàng mới': 'purple', 'vip': 'red', 'hỏi giá': 'orange', 'có sđt': 'teal' };
const TONES = ['blue', 'green', 'amber', 'purple', 'pink', 'teal', 'orange', 'red'];
const toneOf = name => LABEL_TONE[norm(name)] || TONES[[...norm(name)].reduce((x, ch) => (x * 31 + ch.codePointAt(0)) >>> 0, 7) % TONES.length];
const tag = (text, onRemove) => h('span', { className: 'tag tone-' + toneOf(text) }, text, onRemove ? h('button', { type: 'button', textContent: '×', title: 'Bỏ nhãn', onclick: onRemove }) : null);

function toast(text, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { className: 'toast', role: 'status', textContent: text });
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvDownload = (name, rows) => download(name, Pure.csv(rows), 'text/csv;charset=utf-8');
// Chạy fn cho từng phần tử, tối đa n việc cùng lúc.
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const fileToDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });

// ── Kho dữ liệu: IndexedDB (mẫu tin có ảnh vượt giới hạn 5MB của localStorage). Hỏng thì dùng bộ nhớ tạm. ──
const DB = (() => {
  let dbp = null; const mem = new Map();
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('meta-assistant', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }).catch(() => null);
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const os = async mode => (await open())?.transaction('kv', mode).objectStore('kv');
  return {
    async get(key, fallback) { const s = await os('readonly'); const v = s ? await req(s.get(key)) : mem.get(key); return v === undefined ? fallback : v; },
    async set(key, value) { const s = await os('readwrite'); if (s) await req(s.put(value, key)); else mem.set(key, value); (App.listeners[key] || []).forEach(fn => fn(value)); },
    async del(key) { const s = await os('readwrite'); if (s) await req(s.delete(key)); else mem.delete(key); },
    async all() {
      const s = await os('readonly'); if (!s) return Object.fromEntries(mem);
      const [keys, vals] = await Promise.all([req(s.getAllKeys()), req((await os('readonly')).getAll())]);
      return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
    },
    async clear() { const s = await os('readwrite'); if (s) await req(s.clear()); mem.clear(); }
  };
})();
App.on = (key, fn) => (App.listeners[key] ||= []).push(fn);
const local = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ── Graph API ──────────────────────────────────────────────
// Các Page đang chọn ở trên cùng: mọi tab chạy theo danh sách này. App.page() = Page đầu tiên (cho thao tác cần 1 Page).
let selected = new Set();
// Nhớ lựa chọn ở cả localStorage và IndexedDB để khôi phục qua các phiên đăng nhập.
function parseSelectedPages(value) {
  try {
    const ids = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' || typeof id === 'number').map(String))] : [];
  } catch { return []; }
}
async function restoreSelectedPages() {
  let ids = parseSelectedPages(local.get('selPages'));
  if (!ids.length) ids = parseSelectedPages(await DB.get('selectedPagesV1', []).catch(() => []));
  return ids.filter(id => App.pages.some(p => String(p.id) === id));
}
function rememberSelectedPages() {
  const ids = [...selected];
  local.set('selPages', JSON.stringify(ids));
  DB.set('selectedPagesV1', ids).catch(() => {});
}
App.selected = () => App.pages.filter(p => selected.has(p.id));
App.isSelected = id => selected.has(String(id));
App.page = () => App.selected()[0] || App.pages[0];
App.pageById = id => App.pages.find(p => p.id === String(id));
async function api(path, params = {}, method = 'GET', token = App.page()?.access_token) {
  const url = new URL(path.startsWith('http') ? path : App.GRAPH + path);
  let body;
  const enc = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (params instanceof FormData) { body = params; body.append('access_token', token); }
  else if (method === 'GET' || method === 'DELETE') { for (const [k, v] of Object.entries(params)) url.searchParams.set(k, enc(v)); url.searchParams.set('access_token', token); }
  else { body = new URLSearchParams(); for (const [k, v] of Object.entries(params)) body.set(k, enc(v)); body.set('access_token', token); }
  const res = await fetch(url, { method, body });
  const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  if (json.error) throw Object.assign(new Error(json.error.error_user_msg || json.error.message), { code: json.error.code, sub: json.error.error_subcode });
  return json;
}
async function guard(target, fn) {
  try { await fn(); } catch (e) { target.replaceChildren(h('div', { className: 'status err', textContent: e.message })); }
}
// Đọc hết các trang kết quả (tối đa maxPages lần gọi).
async function apiPaged(path, params, token, maxPages = 5) {
  let res = await api(path, params, 'GET', token), out = [...(res.data || [])];
  for (let i = 1; i < maxPages && res.paging?.next; i++) { res = await api(res.paging.next, {}, 'GET', token); out.push(...(res.data || [])); }
  return out;
}

// ── Tin nhắn & biến mẫu ────────────────────────────────────
App.crmKey = (pageId, name) => `${pageId || ''}|${norm(name)}`;
// Giống resolveVariables của tiện ích: {tên_khách}, {tên}, {họ}, {tên_page}… lấy theo khách đang mở + biến mặc định.
App.resolveVars = (text, { name = '', pageName = '' } = {}, vars = App.templateVars || {}) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(-1) || '', last = parts.length > 1 ? parts[0] : '';
  const map = {
    '{tên_khách}': name || vars.name || 'bạn', '{full_name}': name || vars.name || 'bạn', '{tên}': first || vars.name || 'bạn', '{first_name}': first || vars.name || 'bạn',
    '{họ}': last, '{last_name}': last, '{danh_xưng}': 'Anh/Chị', '{gender}': 'Anh/Chị', '{tên_page}': pageName || vars.pageName || 'Shop', '{page_name}': pageName || vars.pageName || 'Shop',
    '{sản_phẩm}': vars.product, '{giá}': vars.price, '{sdt}': vars.phone, '{địa_chỉ}': vars.address, '{hotline}': vars.hotline,
    '{đơn_vị_ship}': vars.shipper, '{mã_vận_đơn}': vars.trackingCode, '{link_tra_cứu}': vars.trackingLink
  };
  let out = String(text || '');
  for (const [k, v] of Object.entries(map)) if (v != null && v !== '') out = out.replaceAll(k, v);
  return out;
};
// Gửi chữ rồi ảnh (nếu có) vào hội thoại Messenger. Ngoài 24 giờ kể từ tin cuối của khách, Meta sẽ từ chối.
// Hội thoại do app khác (chatbot cũ: Fchat, AhaChat, ManyChat…) giữ quyền: giành lại quyền rồi gửi lại một lần.
App.sendMessage = async (page, psid, text, imageData) => {
  try { return await sendRaw(page, psid, text, imageData); } catch (e) {
    if (e.sub !== 2018300) throw e;
    try { await api(`/${page.id}/take_thread_control`, { recipient: { id: psid }, metadata: 'mabot' }, 'POST', page.access_token); }
    catch { throw Object.assign(new Error('Hội thoại này đang do một ứng dụng chatbot khác giữ (Fchat, AhaChat, ManyChat…). Vào Cài đặt Page › Nhắn tin nâng cao / Định tuyến cuộc trò chuyện, đặt ứng dụng này làm ứng dụng chính hoặc gỡ ứng dụng kia.'), { code: e.code, sub: e.sub }); }
    return sendRaw(page, psid, text, imageData);
  }
};
async function sendRaw(page, psid, text, imageData) {
  if (text) await api(`/${page.id}/messages`, { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } }, 'POST', page.access_token);
  if (imageData) {
    const blob = await (await fetch(imageData)).blob();
    const form = new FormData();
    form.append('recipient', JSON.stringify({ id: psid }));
    form.append('messaging_type', 'RESPONSE');
    form.append('message', JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: false } } }));
    form.append('filedata', blob, `anh.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`);
    await api(`/${page.id}/messages`, form, 'POST', page.access_token);
  }
}
App.recordTemplateUse = async (tpl, customerKey) => {
  const stats = await DB.get('templateStatsV1', {});
  const s = stats[tpl.id] ||= { title: tpl.title, sent: 0, customers: [], lastAt: 0 };
  s.title = tpl.title; s.sent++; s.lastAt = Date.now();
  if (customerKey && !s.customers.includes(customerKey)) s.customers.push(customerKey);
  await DB.set('templateStatsV1', stats);
};
// Đăng (hoặc hẹn) một bài lên Page. when: giây Unix, 0 = đăng ngay.
App.publish = async (page, text, imageData, when = 0) => {
  const sched = when ? { published: false, scheduled_publish_time: when } : {};
  if (imageData) {
    const form = new FormData();
    form.append('source', imageData instanceof Blob ? imageData : await (await fetch(imageData)).blob());
    if (text) form.append('caption', text);
    for (const [k, v] of Object.entries(sched)) form.append(k, String(v));
    return api(`/${page.id}/photos`, form, 'POST', page.access_token);
  }
  return api(`/${page.id}/feed`, { message: text, ...sched }, 'POST', page.access_token);
};

// ── Sáng / Tối ─────────────────────────────────────────────
function setDark(on) {
  document.body.classList.toggle('dark-mode', on);
  $('btnDark').querySelector('use').setAttribute('href', on ? '#i-sun' : '#i-moon');
  local.set('darkMode', on ? '1' : '0');
}
setDark(local.get('darkMode') ? local.get('darkMode') === '1' : matchMedia('(prefers-color-scheme: dark)').matches);
$('btnDark').onclick = () => setDark(!document.body.classList.contains('dark-mode'));

// ── Đăng nhập ──────────────────────────────────────────────
function loadSdk(appId) {
  if (!/^\d+$/.test(appId)) return;
  window.fbAsyncInit = () => {
    FB.init({ appId, version: App.VERSION });
    $('fbLogin').disabled = false;
    $('loginStatus').textContent = 'Trang không lưu token. Lần sau mở trang sẽ tự vào nếu Facebook còn đăng nhập.';
    // Tự vào bằng phiên Facebook sẵn có (SDK cấp token mới), trừ khi người dùng vừa bấm Đăng xuất.
    if (local.get('autoLogin') !== '0' && !App.pages.length) {
      $('loginStatus').textContent = 'Đang kiểm tra phiên Facebook…';
      const saved = local.get('fbTok');
      const viaSdk = () => FB.getLoginStatus(r => {
        if (r.status === 'connected' && !App.pages.length) start(r.authResponse.accessToken);
        else $('loginStatus').textContent = 'Bấm nút để đăng nhập.';
      }, true);
      // Ưu tiên token đã lưu (Facebook Login for Business thường không báo "connected" sau khi tải lại trang).
      if (saved) start(saved).then(ok => { if (!ok) viaSdk(); }); else viaSdk();
    }
  };
  if (window.FB) return window.fbAsyncInit();
  document.head.append(h('script', { src: 'https://connect.facebook.net/vi_VN/sdk.js', async: true, crossOrigin: 'anonymous',
    onerror: () => { $('loginStatus').textContent = 'Không tải được Facebook SDK. Dùng "Tuỳ chọn khác" để dán token.'; } }));
}
$('appId').value = local.get('appId') || App.DEFAULT_APP_ID;
loadSdk($('appId').value);
$('saveApp').onclick = () => { local.set('appId', $('appId').value.trim()); loadSdk($('appId').value.trim()); };
$('fbLogin').onclick = () => {
  local.set('autoLogin', '1');
  FB.login(r => r.authResponse ? start(r.authResponse.accessToken) : ($('loginStatus').textContent = 'Đăng nhập bị huỷ.'), { config_id: App.CONFIG_ID });
};
$('useToken').onclick = () => start($('token').value.trim());
// Chỉ thoát khỏi trang, không gọi FB.logout (sẽ đăng xuất luôn facebook.com).
$('btnLogout').onclick = () => { local.set('autoLogin', '0'); local.set('fbTok', ''); location.reload(); };

async function start(userToken) {
  $('loginStatus').textContent = 'Đang tải danh sách Page…';
  try {
    App.pages = await apiPaged('/me/accounts', { fields: 'id,name,access_token,picture.width(64){url}', limit: 100 }, userToken, 3);
    if (!App.pages.length) throw new Error('Tài khoản không quản lý Page nào, hoặc chưa cấp quyền pages_show_list.');
  } catch (e) { $('loginStatus').textContent = `Lỗi: ${e.message}`; local.set('fbTok', ''); return false; }
  local.set('fbTok', userToken);
  $('token').value = '';
  App.userToken = userToken; // chỉ giữ trong bộ nhớ tab, dùng để kết nối Page với máy chủ bot
  App.templateVars = (await DB.get('settings', {})).templateVars || {};
  const saved = await restoreSelectedPages();
  selected = new Set(saved.length ? saved : App.pages.map(p => p.id));
  rememberSelectedPages();
  $('login').hidden = true;
  $('pagePicker').hidden = $('btnLogout').hidden = $('nav').hidden = false;
  $('dot').className = 'dot on'; $('dot').title = `Đã kết nối ${App.pages.length} Page`;
  for (const fn of App.onLogin || []) fn();
  const [g, t] = (local.get('lastTab') || 'messages:inbox').split(':');
  showGroup(App.NAV[g] ? g : 'messages', t);
  return true;
}
App.onLogin = [];

// ── Điều hướng ─────────────────────────────────────────────
App.tab = (id, mod) => { App.tabs[id] = mod; };
let current = '';
$('groups').replaceChildren(...Object.entries(App.NAV).map(([g, [label]]) => h('button', { type: 'button', textContent: label, dataset: { g }, onclick: () => showGroup(g) })));
function showGroup(g, tabId) {
  [...$('groups').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.g === g));
  $('subnav').replaceChildren(...App.NAV[g][1].map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', dataset: { tab: id }, onclick: () => showTab(id) }, icon(ic), label)));
  showTab(App.NAV[g][1].some(([id]) => id === tabId) ? tabId : App.NAV[g][1][0][0]);
}
function showTab(id) {
  const g = Object.keys(App.NAV).find(k => App.NAV[k][1].some(([t]) => t === id));
  if (![...$('subnav').children].some(b => b.dataset.tab === id)) return showGroup(g, id);
  current = id;
  local.set('lastTab', `${g}:${id}`);
  [...$('subnav').children].forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id));
  let panel = document.querySelector(`[data-panel="${id}"]`);
  const mod = App.tabs[id];
  if (!panel) { panel = h('section', { className: 'panel', dataset: { panel: id } }); $('main').append(panel); mod?.mount?.(panel); }
  document.querySelectorAll('[data-panel]').forEach(s => s.hidden = s !== panel);
  mod?.refresh?.(panel);
}
App.show = showTab;
App.current = () => current;
App.setSelected = ids => {
  const next = new Set(ids.map(String).filter(id => App.pageById(id)));
  if (!next.size) return drawPicker();
  if ([...next].join() === [...selected].join()) { rememberSelectedPages(); return drawPicker(); }
  selected = next; rememberSelectedPages();
  drawPicker();
  for (const fn of App.onPageChange || []) fn();
  App.tabs[current]?.refresh?.(document.querySelector(`[data-panel="${current}"]`));
};
App.onPageChange = [];
App.pageChecks = (selected = []) => h('div', { className: 'pages' }, ...App.pages.map(p => h('label', { title: p.name }, h('input', { type: 'checkbox', value: p.id, checked: selected.includes(p.id) }), App.avatar(p.name, App.pageAvatarUrl(p), 20), p.name)));

// ── Ảnh đại diện ───────────────────────────────────────────
App.pageAvatarUrl = p => p?.picture?.data?.url || '';
// Ảnh tròn; chưa có ảnh (hoặc ảnh lỗi) thì hiện chữ cái đầu trên nền gradient.
App.avatar = (name, url, size = 36) => {
  const el = h('span', { className: 'avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * .36)}px`, textContent: initials(name) });
  if (url) { const img = h('img', { src: url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => img.remove() }); el.append(img); }
  return el;
};
// Ảnh khách Messenger (User Profile API, field profile_pic) theo PSID. Gom 50 PSID/lần gọi bằng Graph batch,
// nhớ 3 ngày trong IndexedDB vì link ảnh của Facebook hết hạn sau vài ngày.
const PIC_TTL = 3 * 864e5;
const avatarWarnings = new Set();
function reportAvatarError(error) {
  const detail = JSON.stringify({ code: error.code, subcode: error.error_subcode ?? error.sub, message: String(error.message || 'Phản hồi ảnh không hợp lệ.').replace(/access_token=[^&\s]+/g, 'access_token=[ẩn]') });
  if (!avatarWarnings.has(detail)) { avatarWarnings.add(detail); console.warn('[Avatar khách]', detail); }
}
App.customerPics = async (page, psids) => {
  const cache = await DB.get('avatarCacheV2', {});
  const out = new Map(), need = [];
  for (const id of new Set(psids.filter(Boolean))) {
    const c = cache[id];
    if (c && Date.now() - c.at < (c.url ? PIC_TTL : 10 * 60e3)) out.set(id, c.url); else need.push(id); // ảnh lỗi chỉ nhớ 10 phút để thử lại
  }
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    try {
      const res = await api('/', { batch: chunk.map(id => ({ method: 'GET', relative_url: `${id}?fields=profile_pic` })), include_headers: false }, 'POST', page.access_token);
      res.forEach((r, k) => {
        let url = '';
        try {
          const profile = JSON.parse(r.body);
          url = r?.code === 200 ? profile.profile_pic || '' : '';
          if (!url && profile.error) reportAvatarError(profile.error);
        } catch { reportAvatarError({}); }
        cache[chunk[k]] = { url, at: Date.now() }; out.set(chunk[k], url);
      });
    } catch (e) { reportAvatarError(e); }
  }
  if (need.length) await DB.set('avatarCacheV2', cache);
  return out;
};
// Dòng Page nhỏ: ảnh + tên (dùng trong danh sách bài, bình luận…).
App.pageTag = p => h('span', { className: 'page-chip', style: 'display:inline-flex;align-items:center;gap:4px', title: p?.name || '' }, App.avatar(p?.name, App.pageAvatarUrl(p), 14), p?.name || 'Page không rõ');

// ── Bộ chọn nhiều Page trên cùng ───────────────────────────
let pickerQuery = '';
function drawPicker() {
  const list = App.selected();
  $('pageBtn').replaceChildren(
    h('span', { className: 'stack' }, ...list.slice(0, 4).map(p => App.avatar(p.name, App.pageAvatarUrl(p), 24))),
    h('span', { className: 'label', textContent: list.length === App.pages.length ? `Tất cả ${list.length} Page` : list.length === 1 ? list[0].name : `${list.length} Page` }),
    h('span', { className: 'caret', textContent: '▾' }));
  if ($('pageMenu').hidden) return;
  const draft = new Set(selected);
  const rows = h('div', { className: 'page-menu-list' });
  const drawRows = () => rows.replaceChildren(...App.pages.filter(p => !pickerQuery || norm(p.name).includes(norm(pickerQuery))).map(p => h('label', { className: 'page-row' + (draft.has(p.id) ? ' on' : '') },
    h('input', { type: 'checkbox', checked: draft.has(p.id), onchange: e => { e.target.checked ? draft.add(p.id) : draft.delete(p.id); e.target.closest('label').classList.toggle('on', e.target.checked); count.textContent = `${draft.size} đã chọn`; } }),
    App.avatar(p.name, App.pageAvatarUrl(p), 28), h('span', { className: 'grow', textContent: p.name }),
    h('button', { type: 'button', className: 'btn btn-ghost btn-sm only', textContent: 'Chỉ Page này', onclick: e => { e.preventDefault(); closePicker(); App.setSelected([p.id]); } }))));
  const count = h('span', { className: 'hint', textContent: `${draft.size} đã chọn` });
  $('pageMenu').replaceChildren(
    h('input', { type: 'search', placeholder: '🔍 Tìm Page…', value: pickerQuery, oninput: e => { pickerQuery = e.target.value; drawRows(); } }),
    h('div', { className: 'row', style: 'margin:8px 0;gap:6px' },
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Chọn hết', onclick: () => { App.pages.forEach(p => draft.add(p.id)); drawRows(); count.textContent = `${draft.size} đã chọn`; } }),
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Bỏ hết', onclick: () => { draft.clear(); drawRows(); count.textContent = '0 đã chọn'; } }), count),
    rows,
    h('div', { className: 'row', style: 'margin-top:10px;justify-content:flex-end' },
      h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: closePicker }),
      h('button', { type: 'button', className: 'btn btn-primary', textContent: 'Áp dụng', onclick: () => { if (!draft.size) return toast('Chọn ít nhất 1 Page.'); closePicker(); App.setSelected([...draft]); } })));
  drawRows();
}
function closePicker() { $('pageMenu').hidden = true; $('pageBtn').setAttribute('aria-expanded', 'false'); }
$('pageBtn').onclick = () => { const open = $('pageMenu').hidden; $('pageMenu').hidden = !open; $('pageBtn').setAttribute('aria-expanded', String(open)); drawPicker(); if (open) $('pageMenu').querySelector('input')?.focus(); };
// composedPath: phần tử bị bấm có thể đã được vẽ lại (rời DOM) khi sự kiện tới document.
document.addEventListener('click', e => { if (!e.composedPath().includes($('pagePicker'))) closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
App.onLogin.push(drawPicker);
App.checkedPages = box => [...box.querySelectorAll('input:checked')].map(i => App.pageById(i.value)).filter(Boolean);
