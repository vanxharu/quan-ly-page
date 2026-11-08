// @ts-nocheck
// Supabase Edge Function "fb-webhook": Facebook gọi vào đây mỗi khi Page có tin nhắn / bình luận.
// Tắt "Verify JWT" cho hàm này (Facebook không gửi JWT); thay vào đó kiểm tra chữ ký X-Hub-Signature-256 bằng FB_APP_SECRET.
// Viết bằng JS thuần (TS hợp lệ), gọi CSDL qua REST bằng service role để chạy thử được trong Node.

const GRAPH = 'https://graph.facebook.com/v25.0';
const VERIFY_TOKEN = 'ma-c4fff574ff450b501732aa93'; // chuỗi xác minh nhập ở mục Webhooks của ứng dụng Meta
const BOT_TAG = 'mabot';                            // gắn vào tin bot gửi để phân biệt với tin nhân viên gõ tay
const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){9}\b/;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|vn|net|org|me|shop|store|xyz|info)\b)/i;
const env = k => (globalThis.Deno ? Deno.env.get(k) : process.env[k]) || '';

// ── CSDL qua PostgREST ─────────────────────────────────────
async function db(path, { method = 'GET', body, prefer } = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) } });
  if (!r.ok) throw new Error(`db ${method} ${path.split('?')[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const one = async path => (await db(path))?.[0] || null;
const log = (page_id, kind, detail) => db('logs', { method: 'POST', body: { page_id, kind, detail } }).catch(() => {});

// ── Graph API ──────────────────────────────────────────────
async function fb(path, token, body, method = body ? 'POST' : 'GET') {
  const url = new URL(GRAPH + path); url.searchParams.set('access_token', token);
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error.message);
  return j;
}

// ── Phần thuần (có test) ───────────────────────────────────
const fold = s => String(s || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
// Quy tắc khớp đầu tiên theo priority (cao trước), quy tắc riêng Page/bài trước quy tắc chung.
function matchRule(rules, text, { pageId, postId } = {}) {
  const t = fold(text);
  return rules.filter(r => r.enabled && (!r.page_id || r.page_id === pageId) && (!r.post_id || r.post_id === postId))
    .sort((a, b) => (b.priority - a.priority) || ((b.page_id ? 1 : 0) + (b.post_id ? 1 : 0) - (a.page_id ? 1 : 0) - (a.post_id ? 1 : 0)))
    .find(r => !r.keywords?.length || r.keywords.some(k => k && (r.match === 'exact' ? t === fold(k) : t.includes(fold(k))))) || null;
}
const fill = (text, data = {}) => String(text || '').replace(/\{(tên|tên_khách|name|sdt|phone|địa_chỉ|address)\}/g, (_, k) =>
  ({ 'tên': data.first, 'tên_khách': data.name, name: data.name, sdt: data.phone, phone: data.phone, 'địa_chỉ': data.address, address: data.address })[k] || (k.startsWith('tên') || k === 'name' ? 'bạn' : ''));
// Tin Messenger cho một bước kịch bản: ≤3 nút → mẫu nút (có link được); nhiều hơn → nút trả lời nhanh.
function stepMessage(flow, step, data) {
  const text = fill(step.text, data).slice(0, 2000) || '…';
  const buttons = (step.buttons || []).filter(b => b.title);
  if (!buttons.length) return { text };
  const payload = b => b.next ? `STEP:${flow.id}:${b.next}` : b.flow ? `FLOW:${b.flow}` : `TEXT:${b.payload || b.title}`;
  if (buttons.length <= 3) return { attachment: { type: 'template', payload: { template_type: 'button', text: text.slice(0, 640),
    buttons: buttons.map(b => b.url ? { type: 'web_url', url: b.url, title: b.title.slice(0, 20) } : { type: 'postback', title: b.title.slice(0, 20), payload: payload(b) }) } } };
  return { text, quick_replies: buttons.filter(b => !b.url).slice(0, 13).map(b => ({ content_type: 'text', title: b.title.slice(0, 20), payload: payload(b) })) };
}
function ruleMessage(rule) {
  const qr = (rule.quick_replies || []).filter(q => q.title).slice(0, 13).map(q => ({ content_type: 'text', title: q.title.slice(0, 20), payload: q.payload || `TEXT:${q.title}` }));
  return { text: rule.reply, ...(qr.length ? { quick_replies: qr } : {}) };
}

// ── Gửi tin ────────────────────────────────────────────────
async function send(ctx, message) {
  const res = await fb(`/${ctx.pageId}/messages`, ctx.token, { recipient: { id: ctx.psid }, messaging_type: 'RESPONSE', message: { ...message, metadata: BOT_TAG } });
  await db('messages', { method: 'POST', body: { page_id: ctx.pageId, psid: ctx.psid, from_page: true, by_bot: true, mid: res.message_id || null,
    text: message.text || message.attachment?.payload?.text || (message.attachment ? '[ảnh]' : ''), payload: message } }).catch(() => {});
  return res;
}
const sendImage = (ctx, url) => url ? send(ctx, { attachment: { type: 'image', payload: { url, is_reusable: true } } }) : null;
const setFlow = (ctx, flow) => db(`conversations?page_id=eq.${ctx.pageId}&psid=eq.${ctx.psid}`, { method: 'PATCH', body: { flow } });

async function runStep(ctx, flowId, stepId, data = {}, hops = 0) {
  const flow = await one(`flows?id=eq.${flowId}&select=*`);
  const step = flow?.steps?.find(s => s.id === stepId) || (!stepId && flow?.steps?.[0]);
  if (!step || hops > 6) return setFlow(ctx, null);
  if (step.action === 'order') {
    await db('bot_orders', { method: 'POST', body: { page_id: ctx.pageId, psid: ctx.psid, name: data.name || ctx.name || '', phone: data.phone || '', address: data.address || '', note: data.note || '' } });
    await log(ctx.pageId, 'order', { psid: ctx.psid, ...data });
  }
  if (step.text || step.buttons?.length) await send(ctx, stepMessage(flow, step, { ...data, name: data.name || ctx.name, first: (data.name || ctx.name || '').split(' ').at(-1) }));
  if (step.image) await sendImage(ctx, step.image);
  if (step.ask) return setFlow(ctx, { flow_id: flow.id, step: step.id, ask: step.ask, data });
  if (step.next && !step.buttons?.length) return runStep(ctx, flow.id, step.next, data, hops + 1);
  return setFlow(ctx, step.buttons?.length ? { flow_id: flow.id, step: step.id, data } : null);
}

// ── Tin nhắn ───────────────────────────────────────────────
async function onMessaging(pageId, token, settings, ev) {
  // Khách đã xem tin của Page (message_reads): chỉ lưu mốc thời gian, không chạy bot.
  if (ev.read?.watermark) {
    const psid = String(ev.sender?.id || ''), at = new Date(Number(ev.read.watermark));
    if (!psid || psid === pageId || Number.isNaN(at.getTime())) return;
    const iso = at.toISOString();
    // Chỉ tiến mốc lên, không lùi khi Facebook gửi sự kiện cũ muộn.
    const updated = await db(`conversations?page_id=eq.${pageId}&psid=eq.${psid}&or=(read_watermark.is.null,read_watermark.lt.%22${encodeURIComponent(iso)}%22)`, { method: 'PATCH', prefer: 'return=representation', body: { read_watermark: iso } });
    if (!updated?.length && !(await one(`conversations?page_id=eq.${pageId}&psid=eq.${psid}&select=psid`)))
      await db('conversations', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { page_id: pageId, psid, read_watermark: iso } });
    return;
  }
  if (ev.message?.is_echo) {
    const psid = ev.recipient.id;
    if (ev.message.metadata === BOT_TAG) return;
    // Nhân viên trả lời tay (Business Suite, trang web…): lưu tin và cho bot im lặng với khách này.
    await db('messages', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { page_id: pageId, psid, from_page: true, mid: ev.message.mid, text: ev.message.text || '' } }).catch(() => {});
    await db(`conversations?page_id=eq.${pageId}&psid=eq.${psid}`, { method: 'PATCH', body: { bot_paused_until: new Date(Date.now() + (settings.pause_minutes ?? 30) * 60e3).toISOString(), unread: 0, last_text: ev.message.text || '', last_at: new Date().toISOString() } });
    return;
  }
  const psid = ev.sender?.id; if (!psid || psid === pageId) return;
  const text = ev.message?.text || '';
  const payload = ev.message?.quick_reply?.payload || ev.postback?.payload || '';
  const shown = ev.postback?.title || text || (ev.message?.attachments ? '[tệp đính kèm]' : '');
  let conv = await one(`conversations?page_id=eq.${pageId}&psid=eq.${psid}&select=*`);
  if (conv && !conv.name) {
    // Hội thoại tạo trước từ sự kiện "đã xem": bổ sung tên/ảnh khi khách nhắn lần đầu.
    const prof = await fb(`/${psid}?fields=name,first_name,last_name,profile_pic`, token, null).catch(() => ({}));
    const name = prof.name || [prof.first_name, prof.last_name].filter(Boolean).join(' ');
    if (name || prof.profile_pic) { conv = { ...conv, name, pic: prof.profile_pic || conv.pic || '' }; await db(`conversations?page_id=eq.${pageId}&psid=eq.${psid}`, { method: 'PATCH', body: { name, pic: conv.pic } }).catch(() => {}); }
  }
  if (!conv) {
    const prof = await fb(`/${psid}?fields=name,first_name,last_name,profile_pic`, token, null).catch(() => ({}));
    conv = { page_id: pageId, psid, name: prof.name || [prof.first_name, prof.last_name].filter(Boolean).join(' '), pic: prof.profile_pic || '', unread: 0 };
    await db('conversations', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: conv });
  }
  const now = new Date().toISOString();
  await db('messages', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { page_id: pageId, psid, mid: ev.message?.mid || null, text: shown, payload: payload ? { payload } : null } });
  await db(`conversations?page_id=eq.${pageId}&psid=eq.${psid}`, { method: 'PATCH', body: { last_text: shown, last_at: now, last_customer_at: now, unread: (conv.unread || 0) + 1 } });

  if (!settings.bot_enabled) return;
  if (conv.bot_paused_until && new Date(conv.bot_paused_until) > new Date()) return;
  const ctx = { pageId, psid, token, name: conv.name };
  // 1) Nút bấm / Bắt đầu
  if (payload === 'GET_STARTED') return settings.welcome_flow_id ? runStep(ctx, settings.welcome_flow_id, null) : null;
  if (payload.startsWith('FLOW:')) return runStep(ctx, payload.slice(5), null);
  if (payload.startsWith('STEP:')) { const [, fid, sid] = payload.split(':'); return runStep(ctx, fid, sid, conv.flow?.data || {}); }
  // 2) Đang chờ khách trả lời câu hỏi của kịch bản
  if (conv.flow?.ask && text) {
    if (conv.flow.ask === 'phone' && !PHONE.test(text)) return send(ctx, { text: 'Số điện thoại chưa đúng, bạn nhập lại giúp shop nhé (VD: 0912345678).' });
    const data = { ...(conv.flow.data || {}), [conv.flow.ask]: conv.flow.ask === 'phone' ? text.match(PHONE)[0].replace(/[\s.-]/g, '') : text.trim() };
    const flow = await one(`flows?id=eq.${conv.flow.flow_id}&select=*`);
    const step = flow?.steps?.find(s => s.id === conv.flow.step);
    return step?.next ? runStep(ctx, flow.id, step.next, data) : setFlow(ctx, null);
  }
  // 3) Từ khoá
  const rules = await db(`rules?kind=eq.message&enabled=eq.true&select=*`);
  const rule = matchRule(rules, payload.startsWith('TEXT:') ? payload.slice(5) : text, { pageId });
  if (rule) {
    await db('rpc/rule_hit', { method: 'POST', body: { rid: rule.id } }).catch(() => {});
    await log(pageId, 'keyword', { psid, rule: rule.name || rule.keywords.join(', '), text });
    if (rule.flow_id) return runStep(ctx, rule.flow_id, null);
    if (rule.reply) await send(ctx, ruleMessage(rule));
    return sendImage(ctx, rule.image_url);
  }
  // 4) Không khớp: câu trả lời mặc định, tối đa 1 lần / 12 giờ / khách.
  if (settings.fallback_text && text) {
    const recent = await one(`messages?page_id=eq.${pageId}&psid=eq.${psid}&by_bot=eq.true&created_at=gt.${new Date(Date.now() - 12 * 3600e3).toISOString()}&select=id&limit=1`);
    if (!recent) await send(ctx, { text: settings.fallback_text });
  }
}

// ── Bình luận ──────────────────────────────────────────────
async function onComment(pageId, token, settings, v) {
  if (v.item !== 'comment' || v.verb !== 'add' || !v.comment_id || v.from?.id === pageId) return;
  const text = v.message || '', cid = v.comment_id, done = [];
  if ((settings.hide_phone && PHONE.test(text)) || (settings.hide_link && LINK.test(text))) {
    await fb(`/${cid}`, token, { is_hidden: true }).then(() => done.push('ẩn')).catch(e => done.push('ẩn lỗi: ' + e.message));
  }
  if (settings.like_comments) await fb(`/${cid}/likes`, token, {}).then(() => done.push('thích')).catch(() => {});
  if (settings.bot_enabled) {
    const rules = await db(`rules?kind=eq.comment&enabled=eq.true&select=*`);
    const rule = matchRule(rules, text, { pageId, postId: v.post_id });
    // Mỗi người chỉ được bot trả lời 1 lần trên mỗi bài (khách bình luận nhiều lần không bị spam).
    const already = rule && await one(`logs?kind=eq.comment_reply&page_id=eq.${pageId}&detail->>post=eq.${v.post_id}&detail->>user=eq.${v.from?.id}&select=id&limit=1`);
    if (rule && !already) {
      await db('rpc/rule_hit', { method: 'POST', body: { rid: rule.id } }).catch(() => {});
      if (rule.public_reply) await fb(`/${cid}/comments`, token, { message: fill(rule.public_reply, { name: v.from?.name, first: (v.from?.name || '').split(' ').at(-1) }) }).then(() => done.push('trả lời')).catch(e => done.push('trả lời lỗi: ' + e.message));
      // Nhắn riêng: Facebook cho 1 tin trong 7 ngày kể từ bình luận; khách trả lời thì mở khung 24 giờ bình thường.
      let msg = rule.reply ? { ...ruleMessage(rule), text: fill(rule.reply, { name: v.from?.name, first: (v.from?.name || '').split(' ').at(-1) }) } : null;
      if (rule.flow_id) { const flow = await one(`flows?id=eq.${rule.flow_id}&select=*`); if (flow?.steps?.[0]) msg = stepMessage(flow, flow.steps[0], { name: v.from?.name }); }
      if (msg) await fb(`/${pageId}/messages`, token, { recipient: { comment_id: cid }, message: { ...msg, metadata: BOT_TAG } }).then(() => done.push('nhắn riêng')).catch(e => done.push('nhắn riêng lỗi: ' + e.message));
      await log(pageId, 'comment_reply', { post: v.post_id, user: v.from?.id, name: v.from?.name, text, rule: rule.name });
    }
  }
  if (done.length) await log(pageId, 'comment', { post: v.post_id, name: v.from?.name, text, done });
}

// ── Điểm vào ───────────────────────────────────────────────
async function validSignature(raw, header) {
  const secret = env('FB_APP_SECRET');
  if (!secret || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const want = header.slice(7);
  return sig.length === want.length && [...sig].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0;
}
const tokenCache = new Map();
async function pageContext(pageId) {
  if (!tokenCache.has(pageId)) tokenCache.set(pageId, (await one(`page_tokens?page_id=eq.${pageId}&select=token`))?.token || '');
  const settings = (await one(`page_settings?page_id=eq.${pageId}&select=*`)) || { bot_enabled: false };
  return { token: tokenCache.get(pageId), settings };
}
const standbyWarned = new Set();
async function handle(body) {
  if (body.object !== 'page') return;
  for (const entry of body.entry || []) {
    const { token, settings } = await pageContext(String(entry.id));
    if (!token) { await log(entry.id, 'error', { message: 'Page chưa kết nối với máy chủ (thiếu token).' }); continue; }
    for (const ev of entry.messaging || []) await onMessaging(String(entry.id), token, settings, ev).catch(e => log(entry.id, 'error', { where: 'message', message: e.message }));
    // App không phải ứng dụng nhận tin chính → Facebook chỉ gửi bản "standby" để theo dõi, bot không được trả lời.
    if ((entry.standby || []).some(ev => ev.message && !ev.message.is_echo) && !standbyWarned.has(String(entry.id))) {
      standbyWarned.add(String(entry.id));
      await log(entry.id, 'error', { where: 'standby', message: 'VNPAGE chưa là ứng dụng nhận tin chính của Page nên Facebook không chuyển tin cho bot. Đặt VNPAGE làm Primary receiver ở Meta Business Suite › Cài đặt › Nhắn tin nâng cao.' });
    }
    for (const ch of entry.changes || []) if (ch.field === 'feed') await onComment(String(entry.id), token, settings, ch.value || {}).catch(e => log(entry.id, 'error', { where: 'comment', message: e.message }));
  }
}
async function serve(req) {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    return url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN
      ? new Response(url.searchParams.get('hub.challenge') || '') : new Response('forbidden', { status: 403 });
  }
  const raw = await req.text();
  if (!await validSignature(raw, req.headers.get('x-hub-signature-256'))) return new Response('bad signature', { status: 401 });
  // Trả lời Facebook ngay (giới hạn vài giây), xử lý tiếp ở nền.
  const work = handle(JSON.parse(raw)).catch(e => log(null, 'error', { message: e.message }));
  if (globalThis.EdgeRuntime?.waitUntil) globalThis.EdgeRuntime.waitUntil(work); else await work;
  return new Response('ok');
}
if (globalThis.Deno) Deno.serve(serve);
if (typeof module !== 'undefined') module.exports = { serve, handle, matchRule, stepMessage, fill, validSignature, VERIFY_TOKEN };
