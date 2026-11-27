// Zalo cá nhân qua API KHÔNG chính thức (thư viện zca-js, giả làm Zalo Web): nghe tin mới và gửi tin thẳng, không cần khung Zalo Web ngầm.
// Lưu ý: Zalo có thể khoá tài khoản dùng cách này; Zalo chỉ cho MỘT kết nối web — mở Zalo Web nơi khác (hoặc cột Zalo) là kết nối này tạm ngắt.
// Cùng giao diện với zalo-auto.js (list / read / send / react / status / ready) để Hộp thư không phải đổi.
const USER = 0; // ThreadType.User (bỏ nhóm: Hộp thư chỉ lấy khách 1-1)
const EMO = { '👍': '/-strong', '❤️': '/-heart', '😆': ':>', '😮': ':o', '😢': ':-((', '😡': ':-h' };
const MAX_MSG = 100, MAX_CONV = 300;

function toMsg(m) {
  const d = m.data || {}, c = d.content, ts = Number(d.ts) || Date.now();
  const x = { mine: !!m.isSelf, ts, mid: 'z' + ts, msgId: String(d.msgId || ''), text: '',
    q: { content: c, msgType: d.msgType, propertyExt: d.propertyExt, uidFrom: d.uidFrom, msgId: d.msgId, cliMsgId: d.cliMsgId, ts: d.ts, ttl: d.ttl || 0 } };
  if (typeof c === 'string') x.text = c;
  else if (c && typeof c === 'object') {
    if (d.msgType === 'chat.photo') x.pic = c.href || c.thumb || '';
    else if (/^https?:/.test(c.href || '') && d.msgType !== 'chat.sticker') { x.share = c.href; x.text = c.title || ''; }
    else x.text = d.msgType === 'chat.sticker' ? '[Sticker]' : '[' + (c.title || 'Tin nhắn') + ']';
  }
  if (!x.text && !x.pic && !x.share) x.text = x.pic === '' ? '[Ảnh]' : '[Tin nhắn]';
  return x;
}

function createZaloApi({ Zalo, getCreds, load = () => null, save = () => {}, onList = () => {}, onThread = () => {}, imageSize = () => ({}) }) {
  const stat = { state: 'closed', rows: 0, err: '', listAt: 0, events: 0, api: true };
  let api = null, db = load() || {}, saveT = 0, listT = 0;
  db.convs ||= {}; db.msgs ||= {};
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => save(db), 1500); };
  const rows = () => Object.values(db.convs).sort((a, b) => b.ts - a.ts).slice(0, 50)
    .map(c => ({ id: c.id, name: c.name || c.id, pic: c.pic || '', snippet: c.snippet || '', time: '', ts: c.ts, unread: c.unread || 0, group: false, muted: false, oa: false }));
  const pushList = () => { clearTimeout(listT); listT = setTimeout(() => onList(rows()), 300); };
  const lookup = async uid => { // tên + ảnh đại diện của khách (tin của mình không có tên khách)
    try { const r = await api.getUserInfo(uid), p = r?.changed_profiles?.[uid] || r?.changed_profiles?.[uid + '_0'];
      if (p && db.convs[uid]) { db.convs[uid].name = p.displayName || p.zaloName || db.convs[uid].name; db.convs[uid].pic = p.avatar || db.convs[uid].pic; persist(); pushList(); } } catch {}
  };
  // Thêm tin vào hội thoại (bỏ trùng theo msgId); trả về true nếu có tin mới.
  const add = (m, fresh) => {
    if (m.type !== USER || !m.threadId) return false;
    const uid = String(m.threadId), x = toMsg(m), list = db.msgs[uid] ||= [];
    if (x.msgId && list.some(y => y.msgId === x.msgId)) return false;
    list.push(x); list.sort((a, b) => a.ts - b.ts); list.splice(0, Math.max(0, list.length - MAX_MSG));
    const c = db.convs[uid] ||= { id: uid, name: '', ts: 0, unread: 0 };
    if (!x.mine && m.data?.dName) c.name = m.data.dName;
    if (x.ts >= c.ts) { c.ts = x.ts; c.snippet = (x.mine ? 'Bạn: ' : '') + (x.text || (x.pic ? '[Ảnh]' : x.share || '')); }
    if (fresh && !x.mine) c.unread = (c.unread || 0) + 1;
    if (!c.name || !c.pic) lookup(uid);
    const ids = Object.keys(db.convs); if (ids.length > MAX_CONV) for (const id of ids.sort((a, b) => db.convs[a].ts - db.convs[b].ts).slice(0, ids.length - MAX_CONV)) { delete db.convs[id]; delete db.msgs[id]; }
    return true;
  };
  const start = async () => {
    if (api) { resume(); return true; }
    stat.state = 'loading';
    try {
      const creds = await getCreds(); if (!creds) { stat.state = 'login'; stat.err = 'Chưa đăng nhập Zalo Web (quét QR trong cột Zalo một lần).'; return false; }
      api = await new Zalo({ selfListen: true, logging: false, checkUpdate: false }).login(creds);
      const L = api.listener;
      L.on('message', m => { stat.events++; if (add(m, true)) { persist(); pushList(); onThread(String(m.threadId)); } });
      L.on('old_messages', (list, type) => { if (type !== USER) return; let n = 0; for (const m of list || []) n += add(m, false) ? 1 : 0; if (n) { persist(); pushList(); } });
      L.on('reaction', r => { const d = r?.data, uid = String(r?.threadId || ''), list = db.msgs[uid]; if (!list || !d) return;
        const t = list.find(x => x.msgId && (d.content?.rMsg || []).some(y => String(y.gMsgID) === x.msgId)); if (!t) return;
        const e = Object.keys(EMO).find(k => EMO[k] === d.content?.rIcon); if (e) { t.re = [...(t.re || []).filter(z => z.mine !== !!r.isSelf), { e, mine: !!r.isSelf }]; persist(); onThread(uid); } });
      L.on('connected', () => { stat.state = 'ready'; stat.err = ''; try { L.requestOldMessages(USER); } catch {} });
      L.on('closed', code => { stat.state = 'paused'; stat.err = code === 3000 || code === 3003 ? 'Zalo Web đang mở ở nơi khác (cột Zalo / máy khác): tạm ngắt, đóng nơi đó là app nghe lại.' : 'Mất kết nối Zalo (' + code + ').'; });
      L.on('error', e => { stat.err = String(e?.message || e).slice(0, 120); });
      L.start({ retryOnClose: true });
      stat.state = 'ready'; stat.err = ''; pushList();
      return true;
    } catch (e) { api = null; stat.state = 'login'; stat.err = 'Không đăng nhập được Zalo qua API: ' + String(e?.message || e).slice(0, 120); return false; }
  };
  const resume = () => { if (api && stat.state !== 'ready') try { api.listener.start({ retryOnClose: true }); stat.state = 'ready'; stat.err = ''; } catch {} };
  const stop = () => { try { api?.listener.stop(); } catch {} api = null; stat.state = 'closed'; };
  const need = () => api ? null : { error: 'login' };
  const list = async () => { stat.listAt = Date.now(); const r = rows(); stat.rows = r.length; return { rows: r }; };
  const read = async ({ uid } = {}) => {
    const c = db.convs[uid]; if (c?.unread) { c.unread = 0; persist(); }
    return { messages: (db.msgs[uid] || []).map(({ q, msgId, ...m }) => m) };
  };
  const send = async ({ uid, text, image, replyTo } = {}) => {
    const e = need(); if (e) return e;
    uid = String(uid || ''); text = String(text || '').trim();
    const list = db.msgs[uid] ||= [], q = replyTo ? list.find(x => x.mid === replyTo)?.q : null;
    const msg = { msg: text, ...(q ? { quote: q } : {}) };
    const m = String(image || '').match(/^data:image\/(\w+);base64,(.+)$/);
    if (image && !m) return { error: 'Ảnh không đọc được.' };
    if (m) { const data = Buffer.from(m[2], 'base64'); msg.attachments = [{ data, filename: 'anh.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), metadata: { totalSize: data.length, ...imageSize(data) } }]; }
    if (!text && !m) return { error: 'Tin trống.' };
    try {
      const r = await api.sendMessage(msg, uid, USER), now = Date.now();
      // Hiện ngay trong Hộp thư; tin "của mình" từ kết nối Zalo về sau bị bỏ vì trùng msgId.
      if (text) add({ type: USER, threadId: uid, isSelf: true, data: { msgId: r?.message?.msgId, ts: now, content: text, msgType: 'webchat' } }, false);
      if (m) add({ type: USER, threadId: uid, isSelf: true, data: { msgId: r?.attachment?.[0]?.msgId, ts: now + 1, content: { href: image.length < 400e3 ? image : '' }, msgType: 'chat.photo' } }, false);
      persist(); pushList();
      return { ok: true, ...(await read({ uid })) };
    } catch (x) { return { error: 'Zalo không nhận tin: ' + String(x?.message || x).slice(0, 160) }; }
  };
  const react = async ({ uid, mid, emoji } = {}) => {
    const e = need(); if (e) return e;
    const icon = EMO[emoji]; if (!icon) return { error: 'Zalo chỉ có 6 cảm xúc: ' + Object.keys(EMO).join(' ') };
    const t = (db.msgs[uid] || []).find(x => x.mid === mid); if (!t?.q?.msgId) return { error: 'Không xác định được tin.' };
    try { await api.addReaction(icon, { data: { msgId: String(t.q.msgId), cliMsgId: String(t.q.cliMsgId || '') }, threadId: String(uid), type: USER }); }
    catch (x) { return { error: String(x?.message || x).slice(0, 160) }; }
    t.re = [...(t.re || []).filter(z => !z.mine), { e: emoji, mine: true }]; persist();
    return { ok: true, ...(await read({ uid })) };
  };
  return { start, stop, resume, list, read, send, react, ready: async () => stat.state, status: () => ({ ...stat, rows: Object.keys(db.convs).length }) };
}

module.exports = { createZaloApi, toMsg };
