// Nhiều nick Zalo qua API (zca-js giả): đăng nhập phiên web + thêm nick bằng QR, tin riêng + nhóm, bỏ trùng, gửi chữ / ảnh / tệp (Buffer),
// trả lời, cảm xúc, lịch sử (lật trang), sticker, nhãn Zalo 2 chiều, tạm ngắt khi Zalo Web mở nơi khác, đăng nhập hỏng.
const assert = require('assert/strict'), { EventEmitter } = require('events');
const { createZaloApi, detectContentType, pickNextCursors } = require('../zalo-api');
const sent = [], reacts = [], L = {}; let labelStore = { labelData: [{ id: 1, text: 'VIP', conversations: ['111'] }], version: 3 };
function fakeApi(own) {
  const l = L[own] = Object.assign(new EventEmitter(), { start() { this.started = (this.started || 0) + 1; }, stop() {},
    requestOldMessages(t, cur) { (this.reqs ||= []).push(cur); setImmediate(() => this.emit('old_messages', cur ? [] : [
      { type: 0, threadId: '222', isSelf: false, data: { msgId: 'o1', ts: '1600000000000', dName: 'Cũ', msgType: 'webchat', content: 'tin cũ' } }], 0)); } });
  return { listener: l, getOwnId: async () => own,
    getUserInfo: async uid => ({ changed_profiles: { [uid]: { displayName: 'Tên ' + uid, avatar: 'https://a/' + uid } } }),
    getGroupInfo: async gid => ({ gridInfoMap: { [gid]: { name: 'Nhóm ' + gid, avt: 'https://g/' + gid } } }),
    getAllGroups: async () => ({ gridVerMap: { 555: '1' } }),
    getGroupChatHistory: async gid => ({ groupMsgs: [{ type: 1, threadId: gid, isSelf: false, data: { msgId: 'g1', ts: '1600000001000', dName: 'An', msgType: 'webchat', content: 'chào nhóm' } }] }),
    getStickersDetail: async id => [{ stickerWebpUrl: 'https://st/' + id }],
    sendMessage: async (m, uid, t) => { sent.push({ own, m, uid, t }); return { message: m.msg ? { msgId: 900 + sent.length } : null, attachment: (m.attachments || []).map((_, i) => ({ msgId: 980 + i })) }; },
    addReaction: async (icon, d) => { reacts.push({ icon, d }); return {}; },
    getLabels: async () => structuredClone(labelStore), updateLabels: async p => { labelStore = structuredClone({ ...p, version: p.version + 1 }); return labelStore; } };
}
let qrCb;
class Zalo { constructor(o) { assert.equal(o.selfListen, true); }
  async login(c) { if (c.imei === 'BAD') throw Error('cookie hết hạn'); return fakeApi('1001'); }
  loginQR(_o, cb) { qrCb = cb; return new Promise(r => setTimeout(() => { cb({ type: 0, data: { image: 'QRB64' } }); cb({ type: 2, data: { display_name: 'Nick 2' } });
    cb({ type: 4, data: { cookie: [{ k: 1 }], imei: 'I2', userAgent: 'u' } }); r(fakeApi('2002')); }, 5)); } }
const lists = [], threads = [], events = []; let saved = null;
const tick = ms => new Promise(r => setTimeout(r, ms));
const z = createZaloApi({ Zalo, save: db => { saved = db; }, onList: r => lists.push(r), onThread: id => threads.push(id), onEvent: e => events.push(e), imageSize: () => ({ width: 2, height: 3 }) });
const msg = o => ({ type: 0, threadId: '111', isSelf: false, data: { msgId: '1', cliMsgId: 'c1', uidFrom: '111', dName: 'Lan', ts: '1700000000000', msgType: 'webchat', content: 'Chưa thấy tăng tim', ...o } });
(async () => {
  assert.equal(detectContentType('chat.photo', {}), 'image'); assert.equal(detectContentType('chat.recommended', { action: 'recommened.misscall' }), 'call');
  assert.equal(detectContentType('webchat', { href: 'https://x', title: 't' }), 'link'); assert.deepEqual(pickNextCursors([{ data: { msgId: 'b', ts: 2 } }, { data: { msgId: 'a', ts: 1 } }]), ['a', 'b']);
  assert.deepEqual(await z.send({ uid: '1001_111', text: 'x' }), { error: 'login' }, 'no nick → login');
  assert.equal(await z.login({ imei: 'IMEI', cookie: [{}], userAgent: 'x' }, { web: true }), '1001');
  await tick(50); assert.deepEqual(L['1001'].reqs, [null, 'o1'], 'first login: DM history pages until empty');
  L['1001'].emit('message', msg()); L['1001'].emit('message', msg());
  L['1001'].emit('message', msg({ msgId: '2', ts: '1700000001000', msgType: 'chat.photo', content: { href: 'https://f/p.jpg', params: '{"hd":"https://f/hd.jpg"}' } }));
  L['1001'].emit('message', { type: 1, threadId: '555', isSelf: false, data: { msgId: '5', ts: '1700000002000', dName: 'Bình', msgType: 'webchat', content: 'hi cả nhóm' } });
  L['1001'].emit('message', msg({ msgId: '6', ts: '1700000003000', msgType: 'chat.sticker', content: { id: 77, catId: 1 } }));
  await tick(350);
  let { rows } = await z.list();
  const dm = rows.find(r => r.id === '1001_111'), grp = rows.find(r => r.id === '1001_g555');
  assert.equal(dm.name, 'Tên 111'); assert.equal(dm.unread, 3); assert.equal(dm.snippet, '[Sticker]'); assert.equal(dm.pic, 'https://a/111');
  assert.ok(grp.group); assert.equal(grp.name, 'Nhóm 555'); assert.equal(grp.snippet, 'Bình: hi cả nhóm');
  assert.ok(rows.find(r => r.id === '1001_222'), 'old DM imported'); assert.equal(rows.find(r => r.id === '1001_g555').nick, '', 'one nick → no nick label');
  let r = await z.read({ uid: '1001_111' });
  assert.equal(r.messages.length, 3); assert.equal(r.messages[1].pic, 'https://f/hd.jpg', 'HD photo'); assert.equal(r.messages[2].pic, 'https://st/77', 'sticker image');
  assert.equal((await z.read({ uid: '1001_g555' })).messages.at(-1).text, 'Bình: hi cả nhóm');
  r = await z.send({ uid: '1001_111', text: 'Đang lên tim nha', replyTo: 'z1700000000000' });
  assert.equal(sent[0].m.quote.msgId, '1'); assert.equal(sent[0].uid, '111'); assert.equal(sent[0].t, 0);
  L['1001'].emit('message', msg({ msgId: 901, ts: String(Date.now()), content: 'Đang lên tim nha' }));
  assert.equal((await z.read({ uid: '1001_111' })).messages.length, 4, 'own echo deduped');
  await z.send({ uid: '1001_g555', text: 'ok nhóm' }); assert.equal(sent[1].t, 1, 'group send uses group type');
  await z.send({ uid: '1001_111', file: 'data:application/pdf;base64,' + Buffer.from('%PDF').toString('base64'), fileName: 'bao gia.pdf' });
  const f = sent[2].m.attachments[0]; assert.ok(Buffer.isBuffer(f.data)); assert.equal(f.filename, 'bao gia.pdf'); assert.deepEqual(f.metadata, { totalSize: 4 });
  await z.send({ uid: '1001_111', image: 'data:image/png;base64,' + Buffer.from('PNG').toString('base64') }); assert.deepEqual(sent[3].m.attachments[0].metadata, { totalSize: 3, width: 2, height: 3 });
  r = await z.react({ uid: '1001_111', mid: 'z1700000000000', emoji: '❤️' }); assert.equal(reacts[0].icon, '/-heart'); assert.equal(r.messages[0].re[0].e, '❤️');
  // Nhãn: đọc từ Zalo, gắn mới (tạo nhãn), gỡ.
  const lb = await z.labels({ acc: '1001' }); assert.deepEqual(lb.labels.map(l => l.text), ['VIP']);
  await tick(350); assert.deepEqual(lists.at(-1).find(x => x.id === '1001_111').labels, ['VIP']);
  assert.deepEqual(await z.setLabel({ uid: '1001_g555', text: 'Khách sỉ', on: true }), { ok: true });
  assert.deepEqual(labelStore.labelData.find(l => l.text === 'Khách sỉ').conversations, ['g555']); assert.equal(labelStore.version, 4);
  await z.setLabel({ uid: '1001_111', text: 'vip', on: false }); assert.deepEqual(labelStore.labelData[0].conversations, []);
  // Thêm nick 2 bằng QR: QR gửi lên app (không ghi file), nick có lịch sử nhóm.
  const add = await z.addQR(); assert.deepEqual(add, { ok: true, id: '2002' });
  assert.deepEqual(events.map(e => e.type), ['qr', 'scanned', 'added']); assert.equal(events[0].image, 'data:image/png;base64,QRB64');
  await tick(400); rows = (await z.list()).rows;
  assert.ok(rows.find(r => r.id === '2002_g555'), 'nick 2 group history'); assert.equal(rows.find(r => r.id === '1001_111').nick, 'Tên 1001', 'two nicks → nick label');
  assert.deepEqual(z.accounts().map(a => [a.id, a.web]), [['1001', true], ['2002', false]]);
  // Tạm ngắt / nghe lại; gỡ nick.
  L['1001'].emit('closed', 3000); assert.equal(z.accounts()[0].state, 'paused'); assert.match(z.status().err, /nơi khác/);
  z.resume(); assert.equal(z.accounts()[0].state, 'ready');
  z.remove('2002'); assert.ok(!(await z.list()).rows.some(r => r.id.startsWith('2002_')));
  await tick(1600); assert.equal(saved.accounts.length, 1); assert.ok(saved.accounts[0].creds, 'creds persisted (file is encrypted by main)');
  // Bật lại app: đăng nhập lại nick đã lưu; phiên hỏng → cần quét QR, không ném lỗi.
  const z2 = createZaloApi({ Zalo, load: () => ({ ...structuredClone(saved), accounts: [{ ...saved.accounts[0], creds: { imei: 'BAD' } }] }) });
  assert.equal(await z2.start(), false); assert.equal(z2.accounts()[0].state, 'login'); assert.ok((await z2.list()).rows.length, 'stored messages still listed');
  console.log('PASS: Zalo multi-nick API: QR add, DM + group, history pages, media/file send, reply, react, sticker, Zalo labels 2-way, pause/resume, remove, expired session.');
})().catch(e => { console.error(e); process.exitCode = 1; });
