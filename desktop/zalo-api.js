// SPDX-License-Identifier: AGPL-3.0-or-later
// Zalo cá nhân qua API KHÔNG chính thức (zca-js): NHIỀU nick Zalo trong một Hộp thư — nghe tin, gửi chữ / ảnh / video / tệp,
// trả lời, cảm xúc, lịch sử tin nhắn riêng + nhóm, sticker, nhãn Zalo.
// Một phần chuyển từ ZaloCRM (https://github.com/locphamnguyen/ZaloCRM, AGPL-3.0, © 2026 Nguyễn Tiến Lộc):
// detectContentType / extractAlbumInfo (zalo-message-helpers.ts), pickNextCursors + pumpOldMessages (zalo-history-backfill.ts),
// luồng đăng nhập QR (zalo-pool.ts). Xem NOTICE.
// Lưu ý: không phải API chính thức (Zalo có thể khoá nick); mỗi nick chỉ có MỘT kết nối web — mở Zalo Web của nick đó nơi khác là app tạm ngắt.
const USER = 0, GROUP = 1;
const EMO = { '👍': '/-strong', '❤️': '/-heart', '😆': ':>', '😮': ':o', '😢': ':-((', '😡': ':-h' };
const MAX_MSG = 150, MAX_CONV = 600, MAX_GROUPS = 50, GROUP_MSGS = 50, DM_MAX_PAGES = 50, DM_PAGE_TIMEOUT = 15e3;

// ── Từ ZaloCRM zalo-message-helpers.ts ──
function detectContentType(msgType, content) {
  if (!msgType) return 'text';
  if (content && typeof content === 'object') {
    const action = typeof content.action === 'string' ? content.action : '';
    if (action.includes('calltime') || action.includes('misscall')) return 'call';
    if (action === 'zinstant.bankcard') return 'bank_transfer';
    if (typeof content.description === 'string' && content.description.includes('qrCodeUrl')) return 'qr_code';
    if ((action === 'recommened.link' || action === 'recommended.link') && /^http/.test(content.href || '')) return 'link';
    if (content.callDuration !== undefined || content.callType !== undefined) return 'call';
  }
  for (const [k, t] of [['photo', 'image'], ['image', 'image'], ['sticker', 'sticker'], ['video', 'video'], ['voice', 'voice'], ['gif', 'gif'], ['link', 'link'],
    ['location', 'location'], ['file', 'file'], ['doc', 'file'], ['recommended', 'contact_card'], ['card', 'contact_card'], ['bank', 'bank_transfer'],
    ['transfer', 'bank_transfer'], ['call', 'call'], ['voip', 'call'], ['qr', 'qr_code'], ['remind', 'reminder'], ['todo', 'reminder'], ['poll', 'poll'],
    ['vote', 'poll'], ['note', 'note'], ['forward', 'forwarded']]) if (msgType.includes(k)) return t;
  if (content && typeof content === 'object') {
    if (content.action === 'msginfo.actionlist') return 'reminder';
    if (content.bankCode || content.bankName) return 'bank_transfer';
    if (/^http/.test(content.href || '') && (typeof content.thumb === 'string' || typeof content.title === 'string') && !content.action) return 'link';
    return 'rich';
  }
  return 'text';
}
function extractAlbumInfo(type, raw) {
  if (type !== 'image' || !raw || typeof raw !== 'object') return null;
  let p = raw.params; try { if (typeof p === 'string') p = JSON.parse(p); } catch { return null; }
  return p?.is_group_layout && p.group_layout_id ? { key: String(p.group_layout_id), i: Number(p.id_in_group), n: Number(p.total_item_in_group) } : null;
}
// ── Từ ZaloCRM zalo-history-backfill.ts: nhiều con trỏ trang (cũ nhất / cuối / đầu) để Zalo trả tiếp trang tin cũ ──
function pickNextCursors(messages) {
  const out = [], seen = new Set(), add = c => { c = String(c || '').trim(); if (c && !seen.has(c)) { seen.add(c); out.push(c); } };
  const cur = m => m?.data?.msgId || m?.data?.actionId || m?.data?.cliMsgId || '';
  let oldest = null; for (const m of messages) if (!oldest || Number(m?.data?.ts || 0) < Number(oldest?.data?.ts || 0)) oldest = m;
  if (oldest) add(cur(oldest)); add(cur(messages[messages.length - 1])); add(cur(messages[0]));
  return out;
}

const LABEL = { image: '[Ảnh]', video: '[Video]', voice: '[Ghi âm]', gif: '[GIF]', sticker: '[Sticker]', file: '[Tệp]', location: '[Vị trí]', contact_card: '[Danh thiếp]',
  bank_transfer: '[Chuyển khoản]', qr_code: '[Mã QR]', call: '[Cuộc gọi]', reminder: '[Nhắc hẹn]', poll: '[Bình chọn]', note: '[Ghi chú]', forwarded: '[Chuyển tiếp]', rich: '[Tin nhắn]' };
const parse = s => { try { return typeof s === 'string' ? JSON.parse(s) : s || {}; } catch { return {}; } };

function toMsg(m) {
  const d = m.data || {}, c = d.content, ts = Number(d.ts) || Date.now(), type = detectContentType(d.msgType, c);
  const x = { mine: !!m.isSelf, ts, mid: 'z' + ts, msgId: String(d.msgId || ''), text: '', kind: type,
    q: { content: c, msgType: d.msgType, propertyExt: d.propertyExt, uidFrom: d.uidFrom, msgId: d.msgId, cliMsgId: d.cliMsgId, ts: d.ts, ttl: d.ttl || 0 } };
  if (m.type === GROUP && !m.isSelf && d.dName) x.from = d.dName;
  if (typeof c === 'string') x.text = c;
  else if (c && typeof c === 'object') {
    const p = parse(c.params);
    if (type === 'image' || type === 'gif') { x.pic = p.hd || c.href || c.thumb || ''; const al = extractAlbumInfo(type, c); if (al) x.album = al; }
    else if (type === 'sticker') { x.sticker = Number(c.id) || 0; x.text = LABEL.sticker; }
    else if (type === 'video' || type === 'voice' || type === 'file') { x.share = c.href || ''; x.text = `${LABEL[type]} ${c.title || ''}`.trim(); if (c.thumb && type === 'video') x.pic = c.thumb; }
    else if (/^https?:/.test(c.href || '')) { x.share = c.href; x.text = c.title || ''; }
    else x.text = LABEL[type] + (c.title ? ' ' + c.title : '');
  }
  if (!x.text && !x.pic && !x.share) x.text = LABEL[type] || '[Tin nhắn]';
  return x;
}

// Khoá hội thoại: "<nick>_<g?><id>" (nick = id Zalo của tài khoản, g = nhóm).
const keyOf = (acc, thread, group) => `${acc}_${group ? 'g' : ''}${thread}`;
const splitKey = k => { const m = String(k || '').match(/^(\d+)_(g?)(\d+)$/); return m ? { acc: m[1], group: !!m[2], thread: m[3] } : null; };

function createZaloApi({ Zalo, load = () => null, save = () => {}, onList = () => {}, onThread = () => {}, onEvent = () => {}, imageSize = () => ({}) }) {
  let db = load() || {}, saveT = 0, listT = 0;
  if (db.v !== 2) db = { v: 2, accounts: [], convs: {}, msgs: {}, stickers: {} };
  const live = new Map(); // id nick → { api, state, err }
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => save(db), 1500); };
  const accName = id => db.accounts.find(a => a.id === id)?.name || id;
  const rows = () => Object.values(db.convs).sort((a, b) => b.ts - a.ts).slice(0, 100)
    .map(c => ({ id: c.key, name: c.name || c.thread, pic: c.pic || '', snippet: c.snippet || '', time: '', ts: c.ts, unread: c.unread || 0, group: !!c.group,
      muted: false, oa: false, api: true, nick: db.accounts.length > 1 ? accName(c.acc) : '', nickId: c.acc, labels: c.labels || [] }));
  const pushList = () => { clearTimeout(listT); listT = setTimeout(() => onList(rows()), 300); };
  const L = acc => live.get(acc)?.api;

  // Tên + ảnh đại diện (khách hoặc nhóm), hỏi Zalo một lần.
  const asked = new Set();
  const lookup = async c => {
    const api = L(c.acc); if (!api || asked.has(c.key)) return; asked.add(c.key);
    try {
      if (c.group) { const g = (await api.getGroupInfo(c.thread))?.gridInfoMap?.[c.thread]; if (g) { c.name = g.name || c.name; c.pic = g.fullAvt || g.avt || c.pic; } }
      else { const r = await api.getUserInfo(c.thread), p = r?.changed_profiles?.[c.thread] || r?.changed_profiles?.[c.thread + '_0'];
        if (p) { c.name = p.displayName || p.zaloName || c.name; c.pic = p.avatar || c.pic; } }
      persist(); pushList();
    } catch { asked.delete(c.key); }
  };
  const stickerUrl = async (acc, id) => {
    if (!id) return ''; if (db.stickers[id]) return db.stickers[id];
    try { const s = (await L(acc)?.getStickersDetail(id))?.[0]; const u = s?.stickerWebpUrl || s?.stickerUrl || ''; if (u) { db.stickers[id] = u; persist(); } return u; } catch { return ''; }
  };
  // Thêm tin (bỏ trùng msgId); trả về khoá hội thoại nếu có tin mới.
  const add = (acc, m, fresh) => {
    if (!m?.threadId || (m.type !== USER && m.type !== GROUP)) return '';
    const group = m.type === GROUP, key = keyOf(acc, String(m.threadId), group), x = toMsg(m), list = db.msgs[key] ||= [];
    if (x.msgId && list.some(y => y.msgId === x.msgId)) return '';
    list.push(x); list.sort((a, b) => a.ts - b.ts); list.splice(0, Math.max(0, list.length - MAX_MSG));
    const c = db.convs[key] ||= { key, acc, thread: String(m.threadId), group, name: '', ts: 0, unread: 0 };
    if (!group && !x.mine && m.data?.dName && !c.name) c.name = m.data.dName;
    if (x.ts >= c.ts) { c.ts = x.ts; c.snippet = (x.mine ? 'Bạn: ' : x.from ? x.from + ': ' : '') + (x.text || (x.pic ? LABEL.image : x.share || '')); }
    if (fresh && !x.mine) c.unread = (c.unread || 0) + 1;
    if (x.sticker) Object.defineProperty(x, 'wait', { configurable: true, value: stickerUrl(acc, x.sticker).then(u => { if (u) { x.pic = u; persist(); } delete x.wait; }) }); // không lưu ra file
    if (!c.name || !c.pic) lookup(c);
    const keys = Object.keys(db.convs); if (keys.length > MAX_CONV) for (const k of keys.sort((a, b) => db.convs[a].ts - db.convs[b].ts).slice(0, keys.length - MAX_CONV)) { delete db.convs[k]; delete db.msgs[k]; }
    return key;
  };

  // Lịch sử tin riêng: lật trang requestOldMessages tới khi Zalo hết tin / 50 trang (ZaloCRM pumpOldMessages).
  const pumpOld = (acc, api, type) => new Promise(resolve => {
    const st = { pages: 0, added: 0 }, done = new Set(); let timer = 0, fin = false;
    const finish = () => { if (fin) return; fin = true; try { api.listener.off('old_messages', onPage); } catch {} clearTimeout(timer); resolve(st); };
    const req = c => { c = String(c || '').trim(); if (c && done.has(c)) return false; if (c) done.add(c);
      try { api.listener.requestOldMessages(type, c || null); st.pages++; clearTimeout(timer); timer = setTimeout(finish, DM_PAGE_TIMEOUT); return true; } catch { return false; } };
    const onPage = (msgs, t) => { if (fin || t !== type) return; if (!msgs?.length) return finish();
      for (const m of msgs) if (add(acc, m, false)) st.added++;
      persist(); pushList();
      if (st.pages >= DM_MAX_PAGES || !pickNextCursors(msgs).some(req)) finish(); };
    api.listener.on('old_messages', onPage);
    if (!req(null)) finish();
  });
  const history = async acc => {
    const api = L(acc); if (!api) return { error: 'Nick chưa kết nối.' };
    const r = { dm: 0, groups: 0, groupMsgs: 0 };
    r.dm = (await pumpOld(acc, api, USER)).added;
    try {
      const all = Object.keys((await api.getAllGroups())?.gridVerMap || {}).slice(0, MAX_GROUPS);
      for (const gid of all) {
        try { const h = await api.getGroupChatHistory(gid, GROUP_MSGS); for (const m of h?.groupMsgs || []) if (add(acc, m, false)) r.groupMsgs++; r.groups++; } catch {}
      }
    } catch {}
    persist(); pushList(); return r;
  };

  const attach = (acc, api) => {
    const s = live.get(acc), Lr = api.listener;
    // Sticker: chờ có ảnh sticker rồi mới báo Hộp thư / Telegram (không thì chỉ hiện chữ [Sticker]).
    Lr.on('message', async m => { const k = add(acc, m, true); if (!k) return; await db.msgs[k]?.at(-1)?.wait?.catch(() => {}); persist(); pushList(); onThread(k); });
    Lr.on('reaction', r => { const d = r?.data, key = keyOf(acc, String(r?.threadId || ''), r?.isGroup), list = db.msgs[key]; if (!list || !d) return;
      const t = list.find(x => x.msgId && (d.content?.rMsg || []).some(y => String(y.gMsgID) === x.msgId)); if (!t) return;
      const e = Object.keys(EMO).find(k => EMO[k] === d.content?.rIcon); if (e) { t.re = [...(t.re || []).filter(z => z.mine !== !!r.isSelf), { e, mine: !!r.isSelf }]; persist(); onThread(key); } });
    // Lịch sử chỉ lấy được khi kết nối đã mở (gọi sớm hơn thì Zalo không trả gì): nick mới kéo cả nhóm, nick cũ chỉ tin lỡ khi app tắt.
    Lr.on('connected', () => { s.state = 'ready'; s.err = ''; if (s.pumped) return; s.pumped = true;
      (s.first ? history(acc) : pumpOld(acc, api, USER)).catch(() => {}); });
    Lr.on('closed', code => { s.state = 'paused'; s.err = code === 3000 || code === 3003 ? 'Zalo Web của nick này đang mở ở nơi khác (cột Zalo / máy khác): tạm ngắt, đóng nơi đó là app nghe lại.' : 'Mất kết nối Zalo (' + code + ').'; });
    Lr.on('error', e => { s.err = String(e?.message || e).slice(0, 120); });
    Lr.start({ retryOnClose: true });
  };
  // Đăng nhập một nick bằng phiên đã có (cookie + imei). Trả về id nick.
  const login = async (creds, { web = false } = {}) => {
    const api = await new Zalo({ selfListen: true, logging: false, checkUpdate: false }).login(creds);
    return use(api, creds, web);
  };
  const use = async (api, creds, web) => {
    const id = String(await api.getOwnId());
    let name = id, avatar = '';
    try { const r = await api.getUserInfo(id), p = r?.changed_profiles?.[id] || r?.changed_profiles?.[id + '_0']; if (p) { name = p.displayName || p.zaloName || id; avatar = p.avatar || ''; } } catch {}
    const old = live.get(id); if (old?.api && old.api !== api) try { old.api.listener.stop(); } catch {}
    const first = !Object.values(db.convs).some(c => c.acc === id); // chưa có tin nào của nick này: kéo cả lịch sử nhóm
    db.accounts = [...db.accounts.filter(a => a.id !== id), { id, name, avatar, creds, web: web || !!db.accounts.find(a => a.id === id)?.web }];
    live.set(id, { api, state: 'ready', err: '', first }); attach(id, api); persist(); pushList();
    return id;
  };
  // Thêm nick bằng mã QR (ZaloCRM zalo-pool.ts loginQR): QR hiện trong app, không ghi ra đĩa; hết hạn tự tạo lại tối đa 3 lần.
  let qrBusy = null;
  const addQR = async () => {
    if (qrBusy) return { error: 'Đang chờ quét một mã QR khác.' };
    let creds = null, expired = 0;
    const z = new Zalo({ selfListen: true, logging: false, checkUpdate: false });
    qrBusy = z.loginQR({}, ev => {
      if (ev.type === 0) onEvent({ type: 'qr', image: 'data:image/png;base64,' + ev.data.image });
      else if (ev.type === 1) { if (++expired >= 3) { onEvent({ type: 'qr-dead' }); ev.actions?.abort?.(); } else { onEvent({ type: 'qr-expired' }); ev.actions?.retry?.(); } }
      else if (ev.type === 2) onEvent({ type: 'scanned', name: ev.data?.display_name || '', avatar: ev.data?.avatar || '' });
      else if (ev.type === 3) onEvent({ type: 'declined' });
      else if (ev.type === 4) creds = { cookie: ev.data.cookie, imei: ev.data.imei, userAgent: ev.data.userAgent };
    });
    try { const api = await qrBusy; if (!api) return { error: 'Chưa quét mã.' };
      const id = await use(api, creds, false); onEvent({ type: 'added', id, name: accName(id) }); return { ok: true, id };
    } catch (e) { onEvent({ type: 'error', error: String(e?.message || e).slice(0, 160) }); return { error: String(e?.message || e).slice(0, 160) }; }
    finally { qrBusy = null; }
  };
  // Bật app: đăng nhập lại mọi nick đã lưu.
  const start = async () => {
    for (const a of db.accounts) if (!live.get(a.id)?.api) {
      live.set(a.id, { state: 'loading', err: '' });
      try { await login(a.creds, { web: a.web }); } catch (e) { live.set(a.id, { state: 'login', err: 'Phiên Zalo hết hạn: quét QR lại. (' + String(e?.message || e).slice(0, 80) + ')' }); }
    }
    return [...live.values()].some(s => s.api);
  };
  const resume = () => { for (const s of live.values()) if (s.api && s.state !== 'ready') try { s.api.listener.start({ retryOnClose: true }); s.state = 'ready'; s.err = ''; } catch {} };
  const stop = () => { for (const s of live.values()) try { s.api?.listener.stop(); } catch {} live.clear(); };
  const remove = id => { try { live.get(id)?.api?.listener.stop(); } catch {} live.delete(id);
    db.accounts = db.accounts.filter(a => a.id !== id); for (const k of Object.keys(db.convs)) if (db.convs[k].acc === id) { delete db.convs[k]; delete db.msgs[k]; }
    persist(); pushList(); return { ok: true }; };
  const accounts = () => db.accounts.map(a => ({ id: a.id, name: a.name, avatar: a.avatar, web: !!a.web, state: live.get(a.id)?.state || 'closed', err: live.get(a.id)?.err || '',
    convs: Object.values(db.convs).filter(c => c.acc === a.id).length }));

  const list = async () => ({ rows: rows() });
  // Danh sách hội thoại đọc từ Zalo Web ngay trước khi chuyển sang API (Zalo không có API "danh sách hội thoại"): giữ lại để Hộp thư không trống.
  const seed = (acc, list) => { const now = Date.now();
    (list || []).forEach((r, i) => { if (r.oa || !/^g?\d+$/.test(r.id || '')) return; const group = r.id[0] === 'g', key = keyOf(acc, r.id.replace(/^g/, ''), group);
      if (!db.convs[key]) db.convs[key] = { key, acc, thread: r.id.replace(/^g/, ''), group, name: r.name, pic: r.pic, snippet: r.snippet, ts: now - (i + 1) * 60e3, unread: r.unread || 0 }; });
    persist(); pushList(); };
  const read = async ({ uid } = {}) => {
    const c = db.convs[uid]; if (c?.unread) { c.unread = 0; persist(); }
    return { messages: (db.msgs[uid] || []).map(({ q, msgId, wait, ...m }) => { if (m.sticker && m.pic) m = { ...m, text: '' }; return m.from ? { ...m, text: m.from + ': ' + m.text } : m; }) };
  };
  // Gửi: chữ, ảnh / video / tệp (dataURL → Buffer, không ghi ra đĩa), trả lời tin.
  const send = async ({ uid, text, image, file, fileName, replyTo } = {}) => {
    const k = splitKey(uid), api = k && L(k.acc); if (!api) return { error: 'login' };
    text = String(text || '').trim();
    const q = replyTo ? (db.msgs[uid] || []).find(x => x.mid === replyTo)?.q : null, msg = { msg: text, ...(q ? { quote: q } : {}) };
    const att = [];
    for (const [src, name] of [[image, ''], [file, fileName]]) { if (!src) continue;
      const m = String(src).match(/^data:([\w.+-]+\/[\w.+-]+)?(?:;[^,]*)?;base64,(.+)$/); if (!m) return { error: 'Tệp không đọc được.' };
      const data = Buffer.from(m[2], 'base64'), ext = (name && /\.(\w{1,6})$/.exec(name)?.[1]) || (m[1] || '').split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
      att.push({ data, filename: (name ? name.replace(/[\\/:*?"<>|]/g, '_') : 'anh.' + ext), metadata: { totalSize: data.length, ...(/^image\//.test(m[1] || '') ? imageSize(data) : {}) } }); }
    if (!text && !att.length) return { error: 'Tin trống.' };
    if (att.length) msg.attachments = att;
    try {
      const r = await api.sendMessage(msg, k.thread, k.group ? GROUP : USER), now = Date.now(), type = k.group ? GROUP : USER;
      if (text) add(k.acc, { type, threadId: k.thread, isSelf: true, data: { msgId: r?.message?.msgId, ts: now, content: text, msgType: 'webchat' } }, false);
      att.forEach((a, i) => add(k.acc, { type, threadId: k.thread, isSelf: true, data: { msgId: r?.attachment?.[i]?.msgId, ts: now + 1 + i,
        content: { href: i === 0 && image && image.length < 400e3 ? image : '', title: a.filename }, msgType: i === 0 && image ? 'chat.photo' : 'share.file' } }, false));
      persist(); pushList();
      return { ok: true, ...(await read({ uid })) };
    } catch (x) { return { error: 'Zalo không nhận tin: ' + String(x?.message || x).slice(0, 160) }; }
  };
  const react = async ({ uid, mid, emoji } = {}) => {
    const k = splitKey(uid), api = k && L(k.acc); if (!api) return { error: 'login' };
    const icon = EMO[emoji]; if (!icon) return { error: 'Zalo chỉ có 6 cảm xúc: ' + Object.keys(EMO).join(' ') };
    const t = (db.msgs[uid] || []).find(x => x.mid === mid); if (!t?.q?.msgId) return { error: 'Không xác định được tin.' };
    try { await api.addReaction(icon, { data: { msgId: String(t.q.msgId), cliMsgId: String(t.q.cliMsgId || '') }, threadId: k.thread, type: k.group ? GROUP : USER }); }
    catch (x) { return { error: String(x?.message || x).slice(0, 160) }; }
    t.re = [...(t.re || []).filter(z => !z.mine), { e: emoji, mine: true }]; persist();
    return { ok: true, ...(await read({ uid })) };
  };
  // Nhãn Zalo 2 chiều: đọc nhãn của nick; gắn / gỡ nhãn cho một hội thoại (tạo nhãn mới nếu chưa có).
  const labels = async ({ acc } = {}) => {
    const api = L(acc); if (!api) return { error: 'login' };
    try { const r = await api.getLabels(); const by = {};
      for (const l of r?.labelData || []) for (const cid of l.conversations || []) { const g = /^g/.test(cid), key = keyOf(acc, cid.replace(/^g/, ''), g); (by[key] ||= []).push(l.text); }
      for (const c of Object.values(db.convs)) if (c.acc === acc) c.labels = by[c.key] || [];
      persist(); pushList(); return { labels: (r?.labelData || []).map(l => ({ id: l.id, text: l.text, color: l.color, emoji: l.emoji, n: (l.conversations || []).length })), byConv: by };
    } catch (e) { return { error: String(e?.message || e).slice(0, 160) }; }
  };
  const setLabel = async ({ uid, text, on } = {}) => {
    const k = splitKey(uid), api = k && L(k.acc); if (!api) return { error: 'login' };
    text = String(text || '').trim(); if (!text) return { error: 'Nhãn trống.' };
    try {
      const r = await api.getLabels(), data = r?.labelData || [], cid = (k.group ? 'g' : '') + k.thread;
      let l = data.find(x => x.text.toLowerCase() === text.toLowerCase());
      if (!l) { if (!on) return { ok: true }; l = { id: Math.max(0, ...data.map(x => x.id)) + 1, text, textKey: '', conversations: [], color: '#4bb0f7', offset: data.length, emoji: '', createTime: Date.now() }; data.push(l); }
      l.conversations = on ? [...new Set([...l.conversations, cid])] : l.conversations.filter(x => x !== cid);
      await api.updateLabels({ labelData: data, version: r.version });
      const c = db.convs[uid]; if (c) { c.labels = on ? [...new Set([...(c.labels || []), l.text])] : (c.labels || []).filter(x => x !== l.text); persist(); pushList(); }
      return { ok: true };
    } catch (e) { return { error: String(e?.message || e).slice(0, 160) }; }
  };
  const status = () => { const a = accounts(), on = a.filter(x => x.state === 'ready').length;
    return { state: on ? 'ready' : a.some(x => x.state === 'loading') ? 'loading' : a.length ? (a.some(x => x.state === 'paused') ? 'paused' : 'login') : 'closed',
      api: true, rows: Object.keys(db.convs).length, accounts: a, err: a.map(x => x.err).filter(Boolean).join(' · ') }; };
  return { start, stop, resume, login, seed, addQR, remove, accounts, history, list, read, send, react, labels, setLabel, ready: async () => status().state, status,
    hasAccounts: () => db.accounts.length > 0 };
}

module.exports = { createZaloApi, toMsg, detectContentType, pickNextCursors, splitKey };
