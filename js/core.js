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
  publishing: ['Đăng bài', [['planner', 'Lịch đăng', 'i-cal'], ['scheduled', 'Đã hẹn trên FB', 'i-cal'], ['topics', 'Cách AI viết', 'i-grid']]],
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
// Hạn mức Meta có hai tầng: cả ứng dụng (mã 4/17/613, x-app-usage) và từng Page (mã 32/800xx, x-business-use-case-usage).
// Page bị chặn chỉ khoá đúng Page đó; Page khác, đăng nhập và đăng bài vẫn chạy. Giữ trạng thái qua F5/tab mới.
App.graphTraffic = (() => {
  const key = () => 'graphTrafficV1:' + ($('appId')?.value?.trim() || App.DEFAULT_APP_ID);
  const read = () => { try { return JSON.parse(local.get(key()) || '{}'); } catch { return {}; } };
  const save = value => local.set(key(), JSON.stringify(value));
  const appCodes = new Set([4, 17, 613]);
  const pageCodes = new Set([32, 80001, 80002, 80004, 80005, 80006, 80008, 80014]);
  const rateCodes = new Set([...appCodes, ...pageCodes]);
  const SLOW_PERCENT = 75, PAUSE = 15 * 60e3;
  const clock = at => new Date(at).toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'});
  const message = at => 'Meta đang giới hạn yêu cầu của ứng dụng. Web đã tạm dừng gọi Facebook; bạn có thể thử lại sau ' + clock(at) + '. Thời điểm Meta mở lại có thể lâu hơn; không cần đăng nhập liên tục.';
  const pageMessage = (id, at) => 'Meta đang giới hạn Page ' + (App.pageById?.(id)?.name || id) + '. Tạm dừng gọi Facebook cho Page này đến ' + clock(at) + '; các Page khác vẫn dùng bình thường.';
  const pageOf = token => { const p = token && (App.pages || []).find(x => x.access_token === token); return p ? String(p.id) : ''; };
  const pages = s => (s.pages && typeof s.pages === 'object') ? s.pages : (s.pages = {});
  const percent = u => Math.max(...['call_count','total_cputime','total_time'].map(k => Number(u?.[k]) || 0));
  const until = () => Number(read().until) || 0;
  const pageUntil = id => id ? Number(read().pages?.[id]?.until) || 0 : 0;
  // Mức dùng cao: giãn việc chạy nền (quét hộp thư, avatar) để dành hạn mức cho thao tác người dùng.
  const slowUntil = id => { const s = read(); return Math.max(Number(s.slowUntil) || 0, id ? Number(s.pages?.[id]?.slowUntil) || 0 : 0); };
  return {
    until, pageUntil, slowUntil, pageOf,
    blockedUntil(id) { return Math.max(until(), pageUntil(id)); },
    avatarUntil(id) { const s=read(), now=Date.now(), calls=(Array.isArray(s.avatarCalls)?s.avatarCalls:[]).filter(at=>Number.isFinite(at)&&at>now-3600e3);return Math.max(Number(s.until)||0,Number(s.avatarUntil)||0,calls.length>=40?calls[0]+3600e3:0,pageUntil(id),id?slowUntil(id):0); },
    before(options = {}) {
      if (typeof options !== 'object') options = { background: options === true };
      const now=Date.now(), s=read(), id=options.pageId ? String(options.pageId) : '';
      if(Number(s.until)>now)throw Object.assign(Error(message(s.until)),{code:Number(s.code)||4,retryAt:s.until,rateLimited:true});
      const p = id && s.pages?.[id];
      if(p && Number(p.until)>now)throw Object.assign(Error(pageMessage(id,p.until)),{code:Number(p.code)||80001,retryAt:p.until,rateLimited:true,pageId:id});
      if(options.low){const at=slowUntil(id);if(at>now)throw Object.assign(Error('Đang giãn quét nền vì Page gần chạm hạn mức Meta.'),{code:'BACKGROUND_PAUSED',retryAt:at});}
      if(!options.background)return;
      const calls=(Array.isArray(s.avatarCalls)?s.avatarCalls:[]).filter(at=>Number.isFinite(at)&&at>now-3600e3);
      const retryAt=Math.max(Number(s.avatarUntil)||0,calls.length>=40?calls[0]+3600e3:0,id?slowUntil(id):0);
      if(retryAt>now)throw Object.assign(Error('Đang tạm nghỉ tải avatar để dành hạn mức cho đăng nhập, tin nhắn và đăng bài.'),{code:'AVATAR_BUDGET',retryAt});
      calls.push(now);save({...s,avatarCalls:calls});
    },
    observe(res, error, pageId = '') {
      const now=Date.now(), s=read(), code=Number(error?.code), id=pageId ? String(pageId) : '';
      let changed = false, regainAt = 0;
      // x-business-use-case-usage: {ID Page/doanh nghiệp: [{type, call_count, total_time, total_cputime, estimated_time_to_regain_access}]}
      try {
        const buc = JSON.parse(res.headers?.get?.('x-business-use-case-usage') || '{}');
        for (const [owner, rows] of Object.entries(buc || {})) for (const row of Array.isArray(rows) ? rows : []) {
          const target = /^\d+$/.test(owner) ? owner : id;
          if (!target) continue;
          const st = pages(s)[target] ||= {}, wait = Number(row?.estimated_time_to_regain_access) || 0;
          if (wait > 0) { st.until = Math.max(Number(st.until) || 0, now + wait * 60e3); if (target === id) regainAt = Math.max(regainAt, st.until); changed = true; }
          if (percent(row) >= SLOW_PERCENT) { st.slowUntil = Math.max(Number(st.slowUntil) || 0, now + PAUSE); changed = true; }
        }
      } catch {}
      if(rateCodes.has(code)||res.status===429){
        const raw=res.headers?.get?.('retry-after'), seconds=Number(raw), date=Date.parse(raw||'');
        const retry=raw?(Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:date):0;
        const safeRetry=Number.isFinite(retry)?retry:0;
        if (pageCodes.has(code) && id) {
          const st = pages(s)[id] ||= {};
          st.until = Math.max(Number(st.until) || 0, regainAt || now + PAUSE, safeRetry); st.code = code; st.slowUntil = Math.max(Number(st.slowUntil) || 0, st.until + PAUSE);
          save(s);
          return Object.assign(Error(pageMessage(id, st.until)), { code, retryAt: st.until, rateLimited: true, pageId: id });
        }
        s.until=Math.max(Number(s.until)||0,now+PAUSE,safeRetry);s.code=rateCodes.has(code)?code:4;save(s);
        return Object.assign(Error(message(s.until)),{code:s.code,retryAt:s.until,rateLimited:true});
      }
      // Chỉ lưu mức sử dụng; không lưu header thô, token hoặc URL yêu cầu.
      try { const usage = JSON.parse(res.headers?.get?.('x-app-usage') || '{}');
        if (percent(usage) >= 80) { s.avatarUntil = Math.max(Number(s.avatarUntil) || 0, now + PAUSE); changed = true; }
        if (percent(usage) >= SLOW_PERCENT) { s.slowUntil = Math.max(Number(s.slowUntil) || 0, now + PAUSE); changed = true; }
      } catch {}
      try { const usage = JSON.parse(res.headers?.get?.('x-page-usage') || '{}');
        if (percent(usage) >= 80) { s.avatarUntil = Math.max(Number(s.avatarUntil) || 0, now + PAUSE); changed = true; }
        if (id && percent(usage) >= SLOW_PERCENT) { const st = pages(s)[id] ||= {}; st.slowUntil = Math.max(Number(st.slowUntil) || 0, now + PAUSE); changed = true; }
      } catch {}
      // Bỏ bản ghi Page đã hết hạn để localStorage không phình.
      for (const [pid, st] of Object.entries(s.pages || {})) if (Math.max(Number(st.until) || 0, Number(st.slowUntil) || 0) < now) { delete s.pages[pid]; changed = true; }
      if (changed) save(s);
      return null;
    }
  };
})();
async function api(path, params = {}, method = 'GET', token = App.page()?.access_token, options = {}) {
  const pageId = options.pageId ? String(options.pageId) : App.graphTraffic.pageOf(token);
  App.graphTraffic.before({ background: options.background === true, low: options.low === true, pageId });
  const url = new URL(path.startsWith('http') ? path : App.GRAPH + path);
  let body;
  const enc = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (params instanceof FormData) { body = params; body.append('access_token', token); }
  else if (method === 'GET' || method === 'DELETE') { for (const [k, v] of Object.entries(params)) url.searchParams.set(k, enc(v)); url.searchParams.set('access_token', token); }
  else { body = new URLSearchParams(); for (const [k, v] of Object.entries(params)) body.set(k, enc(v)); body.set('access_token', token); }
  const res = await fetch(url, { method, body, ...(options.signal?{signal:options.signal}:{}) });
  const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  const limited=App.graphTraffic.observe(res,json.error,pageId);
  if(limited)throw limited;
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
    if (e.sub !== 2018300 || e.partialTextSent) throw e;
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
    try { await api(`/${page.id}/messages`, form, 'POST', page.access_token); }
    catch (e) { if (text) e.partialTextSent = true; throw e; }
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
  const sched = when ? { published: false, scheduled_publish_time: when, unpublished_content_type:'SCHEDULED' } : {};
  if (imageData) {
    const image=imageData instanceof Blob?imageData:await (await fetch(imageData)).blob();
    if(!image.size||!/^image\//.test(image.type))throw Error('Không đọc được ảnh bài viết. Chưa gửi bài lên Facebook.');
    const form = new FormData();form.append('source',image,'bai-viet.'+(image.type.split('/')[1]||'jpg'));
    if(when){
      form.append('published','false');
      const upload=await api(`/${page.id}/photos`,form,'POST',page.access_token);
      if(!upload.id)throw Error('Facebook chưa trả mã ảnh; chưa tạo bài hẹn.');
      return api(`/${page.id}/feed`,{message:text||'',attached_media:[{media_fbid:String(upload.id)}],...sched},'POST',page.access_token);
    }
    if(text)form.append('caption',text);
    return api(`/${page.id}/photos`,form,'POST',page.access_token);
  }
  return api(`/${page.id}/feed`, { message: text, ...sched }, 'POST', page.access_token);
};
App.scheduledPostImage=post=>{
  if(post.full_picture)return post.full_picture;
  const find=items=>{for(const item of items||[]){if(item.media?.image?.src)return item.media.image.src;const nested=find(item.subattachments?.data);if(nested)return nested;}return '';};
  return find(post.attachments?.data);
};

// ── Sáng / Tối ─────────────────────────────────────────────
function setDark(on) {
  document.body.classList.toggle('dark-mode', on);
  $('btnDark').querySelector('use').setAttribute('href', on ? '#i-sun' : '#i-moon');
  $('btnDark').setAttribute('aria-label',on?'Chuyển sang giao diện sáng':'Chuyển sang giao diện tối');
  $('btnDark').title=on?'Đang dùng giao diện tối · Chuyển sang sáng':'Đang dùng giao diện sáng · Chuyển sang tối';
  local.set('darkMode', on ? '1' : '0');
  window.dispatchEvent(new Event('meta-theme-changed'));
}
setDark(local.get('darkMode') ? local.get('darkMode') === '1' : matchMedia('(prefers-color-scheme: dark)').matches);
$('btnDark').onclick = () => setDark(!document.body.classList.contains('dark-mode'));

// ── Đăng nhập ──────────────────────────────────────────────
let loginInFlight = null, loginPrompt = false, loginCooldownTimer;
function syncLoginCooldown() {
  clearTimeout(loginCooldownTimer);
  const blocked = App.graphTraffic.until() > Date.now();
  $('fbLogin').disabled = blocked || !!loginInFlight || loginPrompt || !window.FB;
  $('useToken').disabled = blocked || !!loginInFlight || loginPrompt;
  if(blocked){
    try{App.graphTraffic.before();}catch(error){$('loginStatus').textContent=error.message;}
    loginCooldownTimer=setTimeout(syncLoginCooldown,1000);
  }
}
function loadSdk(appId) {
  if (!/^\d+$/.test(appId)) return;
  window.fbAsyncInit = () => {
    FB.init({ appId, version: App.VERSION });
    syncLoginCooldown();
    if(App.graphTraffic.until()>Date.now())return;
    $('loginStatus').textContent = 'Phiên đăng nhập được ghi nhớ trên trình duyệt này. Bấm Đăng xuất để xoá phiên.';
    // Tự vào bằng phiên Facebook sẵn có (SDK cấp token mới), trừ khi người dùng vừa bấm Đăng xuất.
    if (local.get('autoLogin') !== '0' && !App.pages.length) {
      $('loginStatus').textContent = 'Đang kiểm tra phiên Facebook…';
      const saved = local.get('fbTok');
      const viaSdk = () => FB.getLoginStatus(r => {
        if (r.status === 'connected' && !App.pages.length) start(r.authResponse.accessToken);
        else $('loginStatus').textContent = 'Bấm nút để đăng nhập.';
      }, true);
      // Ưu tiên token đã lưu (Facebook Login for Business thường không báo "connected" sau khi tải lại trang).
      if (saved) start(saved).then(ok => { if (!ok && [102,190].includes(Number(start.lastError?.code))) viaSdk(); }); else viaSdk();
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
  if(loginInFlight||loginPrompt||App.graphTraffic.until()>Date.now()){syncLoginCooldown();return;}
  local.set('autoLogin', '1');
  loginPrompt=true;syncLoginCooldown();
  const finish=r=>{
    loginPrompt=false;
    if(r.authResponse)start(r.authResponse.accessToken);
    else{
      const error=r.error||{};const limited=App.graphTraffic.observe({status:200},error);
      $('loginStatus').textContent=limited?.message||error.message||'Đăng nhập bị huỷ.';
    }
    syncLoginCooldown();
  };
  try{FB.login(finish,{config_id:App.CONFIG_ID});}catch(error){finish({error});}
};
$('useToken').onclick = () => start($('token').value.trim());
// Chỉ thoát khỏi trang, không gọi FB.logout (sẽ đăng xuất luôn facebook.com).
$('btnLogout').onclick = () => { local.set('autoLogin', '0'); local.set('fbTok', ''); location.reload(); };

function start(userToken) {
  if(loginInFlight)return loginInFlight;
  if(App.pages.length)return Promise.resolve(true);
  start.lastError=null;
  loginInFlight=startSession(userToken).finally(()=>{loginInFlight=null;syncLoginCooldown();});
  syncLoginCooldown();
  return loginInFlight;
}
async function startSession(userToken) {
  $('loginStatus').textContent = 'Đang tải danh sách Page…';
  try {
    App.pages = await apiPaged('/me/accounts', { fields: 'id,name,access_token,picture.width(64){url}', limit: 100 }, userToken, 3);
    if (!App.pages.length) throw new Error('Tài khoản không quản lý Page nào, hoặc chưa cấp quyền pages_show_list.');
  } catch (e) {
    start.lastError=e;$('loginStatus').textContent = `Lỗi: ${e.message}`;
    // Hết hạn mức không làm token mất hiệu lực. Chỉ xoá phiên khi Meta báo token sai/hết hạn.
    if([102,190].includes(Number(e.code)))local.set('fbTok','');
    else if(e.rateLimited)local.set('fbTok',userToken);
    return false;
  }
  local.set('fbTok', userToken);
  $('token').value = '';
  App.userToken = userToken; // dùng để kết nối Page với máy chủ bot
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
App.tab = (id, mod) => {
  App.tabs[id] = mod;
  // Phiên khôi phục nhanh có thể mở tab trước khi tệp chức năng tải xong.
  const panel = document.querySelector(`[data-panel="${id}"]`);
  if (panel && !panel.dataset.mounted) {
    mod.mount?.(panel); panel.dataset.mounted = '1';
    if (current === id) mod.refresh?.(panel);
  }
};
let current = '';
$('groups').replaceChildren(...Object.entries(App.NAV).map(([g, [label]]) => h('button', { type: 'button', textContent: label, dataset: { g }, onclick: () => showGroup(g) })));
function showGroup(g, tabId) {
  if(tabId==='post'){g='publishing';tabId='planner';}
  [...$('groups').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.g === g));
  $('subnav').replaceChildren(...App.NAV[g][1].map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', dataset: { tab: id }, onclick: () => showTab(id) }, icon(ic), label)));
  showTab(App.NAV[g][1].some(([id]) => id === tabId) ? tabId : App.NAV[g][1][0][0]);
}
function showTab(id) {
  if(id==='post')id='planner';
  const g = Object.keys(App.NAV).find(k => App.NAV[k][1].some(([t]) => t === id));
  if (![...$('subnav').children].some(b => b.dataset.tab === id)) return showGroup(g, id);
  current = id;
  local.set('lastTab', `${g}:${id}`);
  [...$('subnav').children].forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id));
  let panel = document.querySelector(`[data-panel="${id}"]`);
  const mod = App.tabs[id];
  if (!panel) { panel = h('section', { className: 'panel', dataset: { panel: id } }); $('main').append(panel); }
  if (mod && !panel.dataset.mounted) { mod.mount?.(panel); panel.dataset.mounted = '1'; }
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
App.avatar = (name, url, size = 36, onError) => {
  const el = h('span', { className: 'avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * .36)}px`, textContent: initials(name) });
  if (url) { const img = h('img', { src: url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => { img.remove(); onError?.(url); } }); el.append(img); }
  return el;
};
// Ảnh khách Messenger: lấy bằng link picture của đúng ID khách và Page; không đưa token vào img.src.
const PIC_TTL = 3 * 864e5;
const MISSING_PIC_TTL = 6 * 3600e3;
const avatarWarnings = new Set();
function reportAvatarError(error) {
  const detail = JSON.stringify({ code: error.code, subcode: error.error_subcode ?? error.sub, message: String(error.message || 'Phản hồi ảnh không hợp lệ.').replace(/access_token=[^&\s]+/g, 'access_token=[ẩn]') });
  if (!avatarWarnings.has(detail)) { avatarWarnings.add(detail); console.warn('[Avatar khách]', detail); }
}
App.customerAvatarLink = id => {
  if (!/^\d+$/.test(String(id))) return '';
  const link = new URL(`${App.GRAPH}/${id}/picture`);
  link.searchParams.set('width', '128'); link.searchParams.set('height', '128');
  link.searchParams.set('redirect', 'false');
  return link.href;
};
const customerIdentityStatus = App.customerIdentityStatus = new Map();
let identityWrites=Promise.resolve();
function publicIdentity(profile){
  const uid=String(profile?.uid||''),image=new URL(profile?.avatar),url=new URL(profile?.profileUrl);
  if(!/^\d{5,30}$/.test(uid)||image.protocol!=='https:'||!image.hostname.endsWith('.fbcdn.net')||image.username||image.password||url.origin!=='https://www.facebook.com'||/(?:[?&])(access_token|token|authorization)=/i.test(image.search))throw Error('UID hoặc ảnh công khai chưa hợp lệ.');
  const avatarData=typeof profile.avatarData==='string'&&profile.avatarData.length<=200000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(profile.avatarData)?profile.avatarData:'';
  return {...(avatarData?{avatarData}:{}),uid,name:String(profile.name||'').slice(0,200),profileUrl:url.href,avatar:image.href,...(/^\d{5,30}$/.test(String(profile.sourceId||''))?{sourceId:String(profile.sourceId)}:{}),verifiedAt:Date.now()};
}
async function rememberCustomerIdentities(changes){
  const write=identityWrites.catch(()=>{}).then(async()=>DB.set('customerIdentitiesV1',{...await DB.get('customerIdentitiesV1',{}),...changes}));identityWrites=write;await write;
}
App.customerIdentity = async (page,id) => (await DB.get('customerIdentitiesV1',{}))[page.id+':'+id];
const customerContexts = new Map(), customerEvidence = new Map(), dirtyCustomerEvidence = new Set();
const avatarDiagnostics = new Map(), avatarReportTimers = new Map();
function recordAvatarDiagnostic(page,id,hasPhoto,error,stage=''){
  const key=page.id+':'+id,row=avatarDiagnostics.get(key)||{pageId:String(page.id),id:String(id),hasPhoto:false,errors:[]};
  if(typeof hasPhoto==='boolean')row.hasPhoto=hasPhoto;if(stage)row.stage=stage;row.updatedAt=Date.now();
  const text=value=>{let result=String(value||'');if(page.access_token)result=result.split(page.access_token).join('[ẩn]');return result.replace(/https?:\/\/\S+/gi,'[link]').replace(/(?:access_token|authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi,'[ẩn]').replace(/EA[A-Za-z0-9_-]{20,}/g,'[ẩn]').slice(0,120);};
  if(error){const item={stage:text(stage),code:text(error.code),subcode:text(error.error_subcode??error.sub),message:text(error.message||'Không có phản hồi ảnh.')};if(!row.errors.some(e=>JSON.stringify(e)===JSON.stringify(item)))row.errors.push(item);row.errors=row.errors.slice(-8);}
  avatarDiagnostics.set(key,row);if(avatarDiagnostics.size>2000)avatarDiagnostics.delete(avatarDiagnostics.keys().next().value);
  if(typeof App.reportCustomerAvatarDiagnostics!=='function'||avatarReportTimers.has(page.id))return;
  avatarReportTimers.set(page.id,setTimeout(()=>{
    avatarReportTimers.delete(page.id);
    const items=[...avatarDiagnostics.values()].filter(r=>r.pageId===String(page.id)).slice(0,50).map(r=>({id:r.id,hasPhoto:r.hasPhoto,errors:r.errors.length>1?[r.errors[0],r.errors.at(-1)]:r.errors}));
    App.reportCustomerAvatarDiagnostics(String(page.id),items).catch(()=>{});
  },1500));
}
App.customerAvatarDiagnostic = () => ({capturedAt:new Date().toISOString(),sourceVersion:'avatar-pipeline250',transport:App.avatarDiagnosticTransport||{ok:false,error:'Chưa gửi báo lỗi qua tiện ích.'},items:[...avatarDiagnostics.values()].map(row=>({...row,errors:row.errors.map(e=>({...e}))}))});
App.flushCustomerAvatarDiagnostics=()=>{for(const row of avatarDiagnostics.values())recordAvatarDiagnostic({id:row.pageId},row.id,row.hasPhoto);};
App.noteCustomerAvatarImageError=(page,id)=>recordAvatarDiagnostic(page,String(id),false,Error('Ảnh đã có URL nhưng trình duyệt tải thất bại.'),'image_load');
async function avatarRequest(page,id,path,params={},method='GET'){
  recordAvatarDiagnostic(page,id,null,null,params.fields||'picture');
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),12000):null;
  try{return await api(path,params,method,page.access_token,{background:true,...(controller?{signal:controller.signal}:{})});}
  catch(error){if(controller?.signal.aborted)error=Object.assign(Error('Facebook chưa phản hồi ảnh sau 12 giây; đang thử nguồn khác.'),{code:'AVATAR_TIMEOUT'});recordAvatarDiagnostic(page,id,null,error,params.fields||'picture');throw error;}
  finally{if(timer!==null)clearTimeout(timer);}
}
function facebookCustomerLink(value){
  try{const u=new URL(value);if(u.protocol!=='https:'||!['www.facebook.com','facebook.com','m.facebook.com'].includes(u.hostname)||u.username||u.password)return '';
    const p=u.pathname.replace(/^\/+|\/+$/g,'');
    if(p==='profile.php'&&/^\d{5,30}$/.test(u.searchParams.get('id')||''))return 'https://www.facebook.com/profile.php?id='+u.searchParams.get('id');
    if(/^app_scoped_user_id\/\d{5,30}$/.test(p))return 'https://www.facebook.com/'+p+'/';
    if(/^[a-zA-Z0-9.]{3,100}$/.test(p)&&!['login','checkpoint','help','privacy','settings','photo.php','l.php','home.php','watch','reel','groups','pages','recover','dialog','share'].includes(p.toLowerCase()))return 'https://www.facebook.com/'+p;
  }catch{}return '';
}
App.noteCustomerConversation = (page,c,other) => {
  if(!other?.id)return;const participants=(c.participants?.data||[]).filter(p=>String(p.id)!==String(page.id));
  if(participants.length!==1||String(participants[0].id)!==String(other.id))return;
  const ids=[...new Set((c.messages?.data||[]).map(m=>String(m.from?.id||'')).filter(id=>/^\d{5,30}$/.test(id)&&id!==String(page.id)))];
  const key=page.id+':'+other.id,previous=customerContexts.get(key),conversationId=String(c.id||previous?.conversationId||'');
  const same=previous&&previous.conversationId===conversationId;
  const next={conversationId,profileLink:facebookCustomerLink(other.link||other.profile_url)||(same?previous.profileLink:''),senderIds:ids.length===1?ids:(!ids.length&&same?previous.senderIds:[])};
  if(JSON.stringify(previous)===JSON.stringify(next))return false;
  customerContexts.set(key,next);customerEvidence.delete(key);dirtyCustomerEvidence.add(key);return true;
};
async function automaticCustomerEvidence(page,id,force=false){
  const key=page.id+':'+id,ctx=customerContexts.get(key),cached=customerEvidence.get(key);
  const signature=JSON.stringify(ctx||{});
  if(!force&&cached&&Date.now()-cached.at<600e3&&cached.signature===signature)return cached;
  const result={at:Date.now(),signature,conversationId:ctx?.conversationId||'',links:new Set(),ids:new Set(ctx?.senderIds||[]),avatar:''};
  if(ctx?.profileLink)result.links.add(ctx.profileLink);
  // Dùng bằng chứng đã có, không tiếp tục dò Graph khi đang phải nghỉ tải ảnh.
  if((App.graphTraffic?.avatarUntil?.(page.id)||0)>Date.now())return result;
  const mayTryFields=error=>!error.rateLimited&&error.code!=='AVATAR_BUDGET'&&Number(error.code)!==3&&!(Number(error.code)===100&&Number(error.sub??error.error_subcode)===33);
  const acceptProfile=profile=>{if(!/^\d{5,30}$/.test(String(profile?.id||'')))return;result.ids.add(String(profile.id));const link=facebookCustomerLink(profile.link);if(link)result.links.add(link);if(profile.picture?.data?.is_silhouette===false)result.avatar=profile.picture.data.url;};
  try{acceptProfile(await avatarRequest(page,id,'/'+encodeURIComponent(id),{fields:'id,link,picture.width(128).height(128)'},'GET'));}
  catch(error){reportAvatarError(error);
    // Một trường không được cấp quyền không được làm mất trường ảnh/link vẫn đọc được.
    if(mayTryFields(error))for(const fields of ['id,picture.width(128).height(128)','id,link'])try{acceptProfile(await avatarRequest(page,id,'/'+encodeURIComponent(id),{fields},'GET'));}catch(e){reportAvatarError(e);if(!mayTryFields(e))break;}
  }
  if(ctx?.conversationId)try{
    let thread;
    try{thread=await avatarRequest(page,id,'/'+encodeURIComponent(ctx.conversationId),{fields:'id,participants,senders,link'},'GET');}
    catch(error){reportAvatarError(error);if(!mayTryFields(error))throw error;thread=await avatarRequest(page,id,'/'+encodeURIComponent(ctx.conversationId),{fields:'id,participants'},'GET');try{const extra=await avatarRequest(page,id,'/'+encodeURIComponent(ctx.conversationId),{fields:'id,senders'},'GET');if(!extra.id||String(extra.id)===ctx.conversationId)thread={...thread,senders:extra.senders};}catch(e){reportAvatarError(e);}}
    const others=(thread.participants?.data||[]).filter(p=>String(p.id)!==String(page.id));
    if(others.length===1&&(!thread.id||String(thread.id)===ctx.conversationId)){
      if(/^\d{5,30}$/.test(String(others[0].id)))result.ids.add(String(others[0].id));
      const link=facebookCustomerLink(others[0].link);if(link)result.links.add(link);
      const senders=(thread.senders?.data||[]).filter(p=>String(p.id)!==String(page.id));if(senders.length===1){const sender=senders[0],profileLink=facebookCustomerLink(sender.link);if(profileLink)result.links.add(profileLink);if(/^\d{5,30}$/.test(String(sender.id)))result.ids.add(String(sender.id));}
      try{const u=new URL(thread.link);if(['facebook.com','www.facebook.com','business.facebook.com'].includes(u.hostname)){const match=u.pathname.match(/^\/messages\/t\/(\d{5,30})\/?$/),selected=u.searchParams.get('selected_item_id');if(match)result.ids.add(match[1]);if(/^\d{5,30}$/.test(selected||''))result.ids.add(selected);}}catch{}
    }
  }catch(error){reportAvatarError(error);}
  customerEvidence.set(key,result);return result;
}
let avatarWrites = Promise.resolve();
App.customerPics = async (page, psids, { force = false, onResult, onIdentity } = {}) => {
  const cache = await DB.get('avatarCacheV7', {}), changes = {}, identities=await DB.get('customerIdentitiesV1',{}), identityChanges={};
  const safeURL = value => { if(typeof value==='string'&&value.length<=200000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))return value;try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ![...u.searchParams.keys()].some(k => /^(access_token|token|authorization)$/i.test(k)) ? u.href : ''; } catch { return ''; } };
  const out = new Map(), need = [];
  const emit = (id, url) => { out.set(id, url); recordAvatarDiagnostic(page,id,!!url);onResult?.(id, url); };
  for (const id of new Set(psids.filter(Boolean).map(String).filter(id => /^\d+$/.test(id)))) {
    const c = cache[page.id + ':' + id];
    if(identities[page.id+':'+id])onIdentity?.(id,identities[page.id+':'+id]);
    const evidenceChanged=dirtyCustomerEvidence.delete(page.id+':'+id);
    const fresh=c&&(c.url?Date.now()-c.at<PIC_TTL:c.retryAt?Date.now()<c.retryAt:Date.now()-c.at<MISSING_PIC_TTL);
    if (!force && fresh && (c.url||!evidenceChanged)) emit(id, safeURL(c.url)); else need.push(id);
  }
  const knownTargets=[...new Set([...need,...[...out].filter(([,url])=>!url).map(([id])=>id)])];
  if(knownTargets.length&&typeof App.lookupKnownCustomerProfiles==='function')try{
    const known=await App.lookupKnownCustomerProfiles(knownTargets);
    for(const entry of known){const profile=publicIdentity(entry),id=profile.sourceId||profile.uid;if(!knownTargets.includes(id)||!profile.avatarData)continue;
      const key=page.id+':'+id;identityChanges[key]=profile;changes[key]={url:profile.avatarData,at:Date.now()};customerIdentityStatus.delete(key);onIdentity?.(id,profile);emit(id,profile.avatarData);
    }
  }catch(error){reportAvatarError(error);}
  const writes=[],publicTasks=[],publicWaiters=[];let publicActive=0;
  const save = (id,url,profile) => {
    const key=page.id+':'+id;changes[key]={url,at:Date.now()};emit(id,url);
    const retryAt=App.graphTraffic?.avatarUntil?.(page.id)||0;if(!url&&retryAt>Date.now())changes[key].retryAt=retryAt;
    if(url)customerIdentityStatus.delete(key);
    if(profile){identityChanges[key]=profile;onIdentity?.(id,profile);writes.push(rememberCustomerIdentities({[key]:profile}));}
    const snapshot={...changes[key]};const write=avatarWrites.catch(()=>{}).then(async()=>{const latest=await DB.get('avatarCacheV7',{});await DB.set('avatarCacheV7',{...latest,[key]:snapshot});});avatarWrites=write;writes.push(write);
  };
  // Lưu từng ảnh ngay khi nhận; không đợi các khách/API còn lại.
  for(const [key,value] of Object.entries(changes)){const id=key.slice(String(page.id).length+1);save(id,value.url,identityChanges[key]);}
  async function publicFallback(id){
    if(publicActive<2)publicActive++;else await new Promise(resolve=>publicWaiters.push(resolve));
    const key=page.id+':'+id;
    try {
      const saved=identities[key],evidence=await automaticCustomerEvidence(page,id,force);
      const graphPhoto=safeURL(evidence.avatar);if(graphPhoto){save(id,graphPhoto);return;}
      for(const senderId of evidence.ids){if(senderId===id||senderId===String(page.id))continue;let photo='';
        try{const profile=await avatarRequest(page,id,'/'+encodeURIComponent(senderId),{fields:'profile_pic'});if(!profile.id||String(profile.id)===senderId)photo=safeURL(profile.profile_pic);}catch(error){reportAvatarError(error);}
        if(!photo)try{const picture=await avatarRequest(page,id,App.customerAvatarLink(senderId));if(picture.data?.is_silhouette===false)photo=safeURL(picture.data.url);}catch(error){reportAvatarError(error);}
        if(photo){save(id,photo);return;}
      }
      if(typeof App.lookupCustomerProfile!=='function')throw Error('Facebook chưa trả ảnh qua API.');
      const candidates=saved?[{target:saved.profileUrl,linked:true}]:[...evidence.links].map(target=>({target,linked:true})).concat([...new Set([id,...evidence.ids])].map(target=>({target,linked:false})));
      let profile,lastError;
      for(const candidate of candidates){try{const found=publicIdentity(await App.lookupCustomerProfile(candidate.target,force));
        if(saved&&found.uid!==saved.uid)throw Error('UID công khai đã đổi; chưa dùng ảnh khác.');
        if(!candidate.linked&&found.uid!==String(candidate.target)&&found.sourceId!==String(candidate.target))throw Error('Chưa có bằng chứng Facebook nối ID hội thoại với UID này.');
        profile=found;break;
      }catch(error){lastError=error;recordAvatarDiagnostic(page,id,null,error,'public_profile');}}
      if(!profile)throw lastError||Error('Facebook chưa trả đủ dữ liệu để tự xác minh UID.');
      save(id,profile.avatarData||profile.avatar,profile);
    }catch(error){customerIdentityStatus.set(key,String(error.message||'Chưa xác minh được UID.'));save(id,'');}
    finally{if(publicWaiters.length)publicWaiters.shift()();else publicActive--;}
  }
  await pool(need.filter(id=>!out.get(id)),4,async id=>{
    let url='';
    // PSID của Messenger dùng User Profile API; /picture chỉ là nguồn dự phòng.
    try{const profile=await avatarRequest(page,id,'/'+encodeURIComponent(id),{fields:'profile_pic'});if(!profile.id||String(profile.id)===id)url=safeURL(profile.profile_pic);}catch(error){reportAvatarError(error);}
    if(!url)try{const picture=await avatarRequest(page,id,App.customerAvatarLink(id));if(picture.data?.is_silhouette===false)url=safeURL(picture.data.url);}catch(error){reportAvatarError(error);}
    if(url)save(id,url);else publicTasks.push(publicFallback(id));
  });
  await Promise.all(publicTasks);await Promise.all(writes);
  return out;
};
// Dòng Page nhỏ: ảnh + tên (dùng trong danh sách bài, bình luận…).
App.pageTag = p => h('span', { className: 'page-chip', style: 'display:inline-flex;align-items:center;gap:4px', title: p?.name || '' }, App.avatar(p?.name, App.pageAvatarUrl(p), 14), p?.name || 'Page không rõ');

// ── Bộ chọn nhiều Page trên cùng ───────────────────────────
App.pageSearchField = props => {
  const field=h('input',{type:'search',name:'meta-assistant-page-filter',readOnly:true,...props});
  for(const [key,value] of Object.entries({autocomplete:'off',autocapitalize:'off',spellcheck:'false','data-lpignore':'true','data-1p-ignore':'true','data-form-type':'other'}))field.setAttribute(key,value);
  field.onpointerdown=()=>{field.readOnly=false;};
  field.onkeydown=e=>{if(e.key!=='Tab')field.readOnly=false;};
  const input=props?.oninput;field.oninput=e=>{if(field.readOnly){field.value='';return;}input?.(e);};
  return field;
};
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
  const drawRows = () => rows.replaceChildren(...App.pages.filter(p => !pickerQuery || norm(p.name+' '+p.id).includes(norm(pickerQuery))).map(p => h('label', { className: 'page-row' + (draft.has(p.id) ? ' on' : '') },
    h('input', { type: 'checkbox', checked: draft.has(p.id), onchange: e => { e.target.checked ? draft.add(p.id) : draft.delete(p.id); e.target.closest('label').classList.toggle('on', e.target.checked); count.textContent = `${draft.size} đã chọn`; } }),
    App.avatar(p.name, App.pageAvatarUrl(p), 28), h('span', { className: 'grow', textContent: p.name }),
    h('button', { type: 'button', className: 'btn btn-ghost btn-sm only', textContent: 'Chỉ Page này', onclick: e => { e.preventDefault(); closePicker(); App.setSelected([p.id]); } }))));
  const count = h('span', { className: 'hint', textContent: `${draft.size} đã chọn` });
  $('pageMenu').replaceChildren(
    App.pageSearchField({placeholder:'Tìm tên hoặc ID Page…','aria-label':'Tìm Page',value:pickerQuery,oninput:e=>{pickerQuery=e.target.value;drawRows();}}),
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
$('pageBtn').onclick = () => { const open = $('pageMenu').hidden; if(open)pickerQuery=''; $('pageMenu').hidden = !open; $('pageBtn').setAttribute('aria-expanded', String(open)); drawPicker(); if (open) $('pageMenu').querySelector('input')?.focus(); };
// composedPath: phần tử bị bấm có thể đã được vẽ lại (rời DOM) khi sự kiện tới document.
document.addEventListener('click', e => { if (!e.composedPath().includes($('pagePicker'))) closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
App.onLogin.push(drawPicker);
App.checkedPages = box => [...box.querySelectorAll('input:checked')].map(i => App.pageById(i.value)).filter(Boolean);
