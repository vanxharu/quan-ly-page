// Zalo qua API (zca-js giả): nhận tin → danh sách + hội thoại, bỏ trùng tin của mình, gửi chữ / ảnh (Buffer, không ghi ra đĩa), trả lời, cảm xúc, mất kết nối.
const assert = require('assert/strict'), { EventEmitter } = require('events');
const { createZaloApi } = require('../zalo-api');
const sent = [], reacts = []; let L;
class Zalo { constructor(o) { assert.equal(o.selfListen, true); }
  async login(c) { assert.equal(c.imei, 'IMEI'); L = Object.assign(new EventEmitter(), { start() { this.started = (this.started || 0) + 1; }, stop() {}, requestOldMessages() { this.asked = true; } });
    return { listener: L, getUserInfo: async uid => ({ changed_profiles: { [uid]: { displayName: 'Khách ' + uid, avatar: 'https://a/' + uid } } }),
      sendMessage: async (m, uid, t) => { sent.push({ m, uid, t }); return { message: { msgId: 900 + sent.length }, attachment: m.attachments ? [{ msgId: 990 }] : [] }; },
      addReaction: async (icon, d) => { reacts.push({ icon, d }); return {}; } }; } }
const lists = [], threads = []; let saved = null;
const z = createZaloApi({ Zalo, getCreds: async () => ({ imei: 'IMEI', cookie: [{}], userAgent: 'x' }), save: db => { saved = db; },
  onList: r => lists.push(r), onThread: id => threads.push(id), imageSize: () => ({ width: 2, height: 3 }) });
const msg = (o) => ({ type: 0, threadId: '111', isSelf: false, data: { msgId: '1', cliMsgId: 'c1', uidFrom: '111', dName: 'Lan', ts: '1700000000000', msgType: 'webchat', content: 'Chưa thấy tăng tim', ...o } });
(async () => {
  assert.deepEqual((await z.send({ uid: '1', text: 'x' })), { error: 'login' }, 'not started → login');
  assert.equal(await z.start(), true); L.emit('connected'); assert.ok(L.asked, 'asks for recent history');
  L.emit('message', msg());
  L.emit('message', msg()); // trùng
  L.emit('message', { type: 1, threadId: 'g1', data: { msgId: '5', content: 'nhóm' } }); // nhóm: bỏ
  L.emit('message', msg({ msgId: '2', ts: '1700000001000', msgType: 'chat.photo', content: { href: 'https://f/p.jpg', title: '' } }));
  await new Promise(r => setTimeout(r, 350));
  const { rows } = await z.list();
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Khách 111', 'profile name'); assert.equal(rows[0].pic, 'https://a/111'); assert.equal(rows[0].unread, 2); assert.equal(rows[0].snippet, '[Ảnh]'); assert.equal(rows[0].ts, 1700000001000);
  assert.equal(lists.length >= 1, true); assert.deepEqual(threads, ['111', '111']);
  let r = await z.read({ uid: '111' });
  assert.equal(r.messages.length, 2); assert.equal(r.messages[0].text, 'Chưa thấy tăng tim'); assert.equal(r.messages[1].pic, 'https://f/p.jpg'); assert.ok(!('q' in r.messages[0]), 'raw quote not sent to page');
  assert.equal((await z.list()).rows[0].unread, 0, 'read clears unread');
  r = await z.send({ uid: '111', text: 'Đang lên tim nha', replyTo: 'z1700000000000' });
  assert.equal(sent[0].m.msg, 'Đang lên tim nha'); assert.equal(sent[0].m.quote.msgId, '1'); assert.equal(sent[0].t, 0);
  assert.equal(r.messages.at(-1).mine, true);
  L.emit('message', msg({ msgId: 901, ts: String(Date.now()), content: 'Đang lên tim nha' }), true); // tiếng vọng của tin mình gửi
  assert.equal((await z.read({ uid: '111' })).messages.length, 3, 'own echo deduped by msgId');
  await z.send({ uid: '111', image: 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64') });
  const a = sent[1].m.attachments[0]; assert.ok(Buffer.isBuffer(a.data)); assert.equal(a.filename, 'anh.png'); assert.deepEqual(a.metadata, { totalSize: 7, width: 2, height: 3 });
  r = await z.react({ uid: '111', mid: 'z1700000000000', emoji: '❤️' });
  assert.equal(reacts[0].icon, '/-heart'); assert.equal(reacts[0].d.data.msgId, '1'); assert.equal(r.messages[0].re[0].e, '❤️');
  L.emit('closed', 3000); assert.equal(z.status().state, 'paused'); assert.match(z.status().err, /nơi khác/);
  z.resume(); assert.equal(L.started, 2); assert.equal(z.status().state, 'ready');
  await new Promise(r => setTimeout(r, 1600)); assert.ok(saved?.msgs?.['111']?.length, 'messages persisted');
  // Đăng nhập hỏng → trạng thái login, không ném lỗi.
  const bad = createZaloApi({ Zalo: class { async login() { throw Error('cookie hết hạn'); } }, getCreds: async () => ({}) });
  assert.equal(await bad.start(), false); assert.equal(bad.status().state, 'login');
  console.log('PASS: Zalo API: list/read/send/reply/image/react, dedupe, groups skipped, paused on duplicate connection, login failure handled.');
})().catch(e => { console.error(e); process.exitCode = 1; });
