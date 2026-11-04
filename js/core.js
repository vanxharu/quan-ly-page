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
App.page = () => App.pages.find(p => p.id === $('page').value);
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
App.sendMessage = async (page, psid, text, imageData) => {
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
};
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
      FB.getLoginStatus(r => {
        if (r.status === 'connected' && !App.pages.length) start(r.authResponse.accessToken);
        else $('loginStatus').textContent = 'Bấm nút để đăng nhập.';
      }, true);
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
$('btnLogout').onclick = () => { local.set('autoLogin', '0'); location.reload(); };

async function start(userToken) {
  $('loginStatus').textContent = 'Đang tải danh sách Page…';
  try {
    App.pages = await apiPaged('/me/accounts', { fields: 'id,name,access_token,picture.width(64){url}', limit: 100 }, userToken, 3);
    if (!App.pages.length) throw new Error('Tài khoản không quản lý Page nào, hoặc chưa cấp quyền pages_show_list.');
  } catch (e) { $('loginStatus').textContent = `Lỗi: ${e.message}`; return; }
  $('token').value = '';
  App.templateVars = (await DB.get('settings', {})).templateVars || {};
  $('page').replaceChildren(...App.pages.map(p => h('option', { value: p.id, textContent: p.name })));
  const saved = local.get('lastPage'); if (App.pages.some(p => p.id === saved)) $('page').value = saved;
  $('login').hidden = true;
  $('page').hidden = $('btnLogout').hidden = $('nav').hidden = false;
  $('dot').className = 'dot on'; $('dot').title = `Đã kết nối ${App.pages.length} Page`;
  for (const fn of App.onLogin || []) fn();
  const [g, t] = (local.get('lastTab') || 'messages:inbox').split(':');
  showGroup(App.NAV[g] ? g : 'messages', t);
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
$('page').onchange = () => { local.set('lastPage', $('page').value); for (const fn of App.onPageChange || []) fn(); App.tabs[current]?.refresh?.(document.querySelector(`[data-panel="${current}"]`)); };
App.onPageChange = [];
// Ô chọn Page dùng lại trong các tab (value '' = tất cả).
App.pageSelect = (allLabel, value = '') => h('select', { style: 'width:auto;max-width:240px' },
  allLabel ? h('option', { value: '', textContent: allLabel }) : null,
  ...App.pages.map(p => h('option', { value: p.id, textContent: p.name, selected: p.id === value })));
App.pageChecks = (selected = []) => h('div', { className: 'pages' }, ...App.pages.map(p => h('label', { title: p.name }, h('input', { type: 'checkbox', value: p.id, checked: selected.includes(p.id) }), p.name)));
App.checkedPages = box => [...box.querySelectorAll('input:checked')].map(i => App.pageById(i.value)).filter(Boolean);
