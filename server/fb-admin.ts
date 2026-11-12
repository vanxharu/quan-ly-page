// @ts-nocheck
// Supabase Edge Function "fb-admin": trang web (đã đăng nhập Supabase) gọi để
//  - connect: đổi token Facebook của bạn thành token Page dài hạn, lưu vào page_tokens, đăng ký webhook cho Page;
//  - profile: cài nút Bắt đầu, lời chào, menu cố định, câu hỏi gợi ý cho Messenger của Page;
//  - status: Page đã kết nối và trạng thái đăng ký webhook.
// Cần secret FB_APP_SECRET (dán ở Edge Functions › Secrets). Tắt "Verify JWT": hàm tự kiểm tra phiên đăng nhập qua /auth/v1/user.

const GRAPH = 'https://graph.facebook.com/v25.0';
const APP_ID = '1062977306762250';
const FIELDS = 'messages,messaging_postbacks,message_echoes,message_reads,feed';
const env = k => (globalThis.Deno ? Deno.env.get(k) : process.env[k]) || '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function db(path, { method = 'GET', body, prefer } = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) } });
  if (!r.ok) throw new Error(`db ${path.split('?')[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function fb(path, token, body, method = body ? 'POST' : 'GET') {
  const url = new URL(path.startsWith('http') ? path : GRAPH + path); if (token) url.searchParams.set('access_token', token);
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error.message);
  return j;
}
const pageToken = async id => (await db(`page_tokens?page_id=eq.${id}&select=token`))?.[0]?.token;

async function connect({ userToken, pageIds }) {
  const secret = env('FB_APP_SECRET');
  if (!secret) throw new Error('Chưa dán FB_APP_SECRET vào Secrets của Edge Functions.');
  // Token người dùng dài hạn (60 ngày) → token Page lấy từ đó không hết hạn.
  const long = await fb(`/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(userToken)}`);
  let next = `${GRAPH}/me/accounts?fields=id,name,access_token,picture.width(64){url}&limit=100&access_token=${long.access_token}`, pages = [];
  for (let i = 0; next && i < 5; i++) { const r = await fb(next); pages.push(...(r.data || [])); next = r.paging?.next; }
  if (pageIds?.length) pages = pages.filter(p => pageIds.includes(p.id));
  const out = [];
  for (const p of pages) {
    const row = { id: p.id, name: p.name, ok: true, error: '' };
    try {
      await db('pages', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { id: p.id, name: p.name, picture: p.picture?.data?.url || '' } });
      await db('page_tokens', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { page_id: p.id, token: p.access_token, updated_at: new Date().toISOString() } });
      await db('page_settings', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { page_id: p.id } });
      await fb(`/${p.id}/subscribed_apps`, p.access_token, { subscribed_fields: FIELDS });
    } catch (e) { row.ok = false; row.error = e.message; }
    out.push(row);
  }
  return { pages: out };
}

async function profile({ pageId }) {
  const token = await pageToken(pageId);
  if (!token) throw new Error('Page chưa kết nối với máy chủ.');
  const s = (await db(`page_settings?page_id=eq.${pageId}&select=*`))?.[0] || {};
  const action = m => m.type === 'url' ? { type: 'web_url', title: m.title.slice(0, 30), url: m.value } : { type: 'postback', title: m.title.slice(0, 30), payload: m.type === 'flow' ? `FLOW:${m.value}` : `TEXT:${m.value || m.title}` };
  const body = { get_started: { payload: 'GET_STARTED' } };
  if (s.greeting) body.greeting = [{ locale: 'default', text: s.greeting.slice(0, 160) }];
  const menu = (s.persistent_menu || []).filter(m => m.title && m.value).slice(0, 20); // giống trang web: mục chưa có đích bị Facebook từ chối cả menu
  if (menu.length) body.persistent_menu = [{ locale: 'default', composer_input_disabled: false, call_to_actions: menu.map(action) }];
  const ice = (s.ice_breakers || []).filter(q => q.question).slice(0, 4);
  if (ice.length) body.ice_breakers = [{ locale: 'default', call_to_actions: ice.map(q => ({ question: q.question.slice(0, 80), payload: q.flow_id ? `FLOW:${q.flow_id}` : `TEXT:${q.text || q.question}` })) }];
  let menuBlocked = false;
  try { await fb('/me/messenger_profile', token, body); }
  catch (e) {
    // Menu cố định cần app là "ứng dụng chính" của Page: vẫn áp lời chào, nút Bắt đầu, câu hỏi gợi ý.
    if (!body.persistent_menu || !/ứng dụng chính|primary|default app|chưa đặt ứng dụng|not.*(primary|default).*app|thread owner/i.test(e.message)) throw e;
    delete body.persistent_menu; menuBlocked = true;
    await fb('/me/messenger_profile', token, body);
  }
  // Mục để trống thì xoá. Facebook chỉ nhận tên viết hoa và không cho xoá lời chào qua API.
  const remove = [['persistent_menu', 'PERSISTENT_MENU'], ['ice_breakers', 'ICE_BREAKERS']].filter(([k]) => !body[k] && !(k === 'persistent_menu' && menuBlocked)).map(([, f]) => f);
  if (remove.length) await fb('/me/messenger_profile', token, { fields: remove }, 'DELETE');
  return { ok: true, menuBlocked };
}

async function status() {
  const pages = await db('pages?select=id,name,picture');
  const rows = [];
  for (const p of pages) {
    const token = await pageToken(p.id);
    let subscribed = false, error = '';
    try { subscribed = !!(await fb(`/${p.id}/subscribed_apps`, token)).data?.some(a => a.id === APP_ID); } catch (e) { error = e.message; }
    rows.push({ ...p, subscribed, error });
  }
  return { secret: !!env('FB_APP_SECRET'), pages: rows };
}

// Bài có ảnh + nút Gửi tin nhắn (bài ẩn tạo từ mẫu quảng cáo): Facebook không hẹn giờ được loại bài này,
// nên máy chủ giữ lịch và đăng (is_published=true) khi tới giờ. pg_cron gọi publish_due mỗi phút.
async function schedule_post({ pageId, postId, at }) {
  if (!/^\d+$/.test(String(pageId)) || !/^\d+_\d+$/.test(String(postId)) || !Date.parse(at)) throw new Error('Thiếu Page, bài hoặc giờ đăng.');
  if (!(await pageToken(pageId))) throw new Error('Page chưa kết nối với máy chủ bot (Cài đặt › Máy chủ bot › Kết nối Page).');
  await db('scheduled_posts', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { post_id: postId, page_id: pageId, publish_at: new Date(at).toISOString(), status: 'pending', error: '' } });
  return { ok: true };
}
async function publish_due() {
  const due = await db(`scheduled_posts?status=eq.pending&publish_at=lte.${new Date().toISOString()}&select=post_id,page_id&limit=20`);
  for (const p of due || []) {
    let patch = { status: 'published', error: '', done_at: new Date().toISOString() };
    try { await fb(`/${p.post_id}`, await pageToken(p.page_id), { is_published: true }); }
    catch (e) { patch = { ...patch, status: 'error', error: e.message }; }
    await db(`scheduled_posts?post_id=eq.${p.post_id}`, { method: 'PATCH', body: patch });
  }
  return { published: (due || []).length };
}

async function serve(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // Lịch đăng bài (pg_cron): khoá bí mật lưu trong bảng app_config, chỉ máy chủ đọc được.
  const cronKey = req.headers.get('x-cron-key');
  if (cronKey) {
    const want = (await db('app_config?key=eq.cron_key&select=value'))?.[0]?.value;
    if (!want || cronKey !== want) return json({ error: 'Sai khoá.' }, 401);
    try { return json(await publish_due()); } catch (e) { return json({ error: e.message }, 500); }
  }
  // Chỉ tài khoản đã đăng nhập (chủ / nhân viên) mới gọi được.
  const user = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: req.headers.get('authorization') || '' } });
  if (!user.ok) return json({ error: 'Chưa đăng nhập máy chủ.' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const fn = { connect, profile, status, schedule_post }[body.action];
    if (!fn) return json({ error: 'Thiếu action.' }, 400);
    return json(await fn(body));
  } catch (e) { return json({ error: e.message }, 400); }
}
if (globalThis.Deno) Deno.serve(serve);
if (typeof module !== 'undefined') module.exports = { serve };
