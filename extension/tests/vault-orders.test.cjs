// Đơn hàng + báo giá đồng bộ giữa 2 máy cùng tài khoản Facebook: gộp theo id (không mất đơn máy kia vừa tạo),
// bản sửa sau thắng, xoá ở 1 máy thì máy kia xoá theo (báo giá đã thành đơn không hồi sinh).
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const src = fs.readFileSync(__dirname + '/../../js/vault.js', 'utf8');
const cloud = {};
const tick = () => new Promise(r => setImmediate(r));
function machine(initial) {
  const db = structuredClone(initial), listeners = {};
  const DB = { get: async (k, f) => structuredClone(db[k] ?? f), set: async (k, v) => { db[k] = structuredClone(v); for (const fn of listeners[k] || []) await fn(v); } };
  const sb = { functions: { invoke: async (_n, { body }) => {
    if (body.action === 'vault_get') return { data: { data: structuredClone(cloud) } };
    for (const [k, v] of Object.entries(body.parts)) if (!cloud[k] || v.at >= cloud[k].at) cloud[k] = structuredClone(v);
    return { data: { ok: true } }; } } };
  const App = { server: { sb }, userToken: 't', onLogin: [], on: (k, fn) => (listeners[k] ||= []).push(fn), current: () => '', tabs: {} };
  const timers = [];
  const ctx = vm.createContext({ DB, App, api: async () => ({ id: '1', name: 'V' }), toast() {}, window: {}, h: () => ({}), fmtTime: String,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() {}, document: { hidden: false }, Date, JSON, Object, Array, Promise, String, Number, Error, Map, Set, Math });
  vm.runInContext(src, ctx);
  const flush = async () => { while (timers.length) await timers.shift()(); };
  return { db, DB, sync: async () => { await App.vault.syncNow(); await flush(); }, flush };
}
(async () => {
  const A = machine({ shopOrdersV1: [{ id: 'o1', at: 1, source: 'service', providerOrderId: '11' }], svcQuotesV1: [{ id: 'q1', at: 1, state: 'paid' }] });
  await A.sync();
  const B = machine({ shopOrdersV1: [{ id: 'o2', at: 2, source: 'service', providerOrderId: '22' }] });
  await B.sync();
  assert.deepEqual(B.db.shopOrdersV1.map(o => o.id).sort(), ['o1', 'o2'], 'B has A order and keeps its own');
  assert.deepEqual(B.db.svcQuotesV1.map(q => q.id), ['q1']);
  await A.sync();
  assert.deepEqual(A.db.shopOrdersV1.map(o => o.id).sort(), ['o1', 'o2'], 'A gets B order');
  // A: quote q1 → đơn o3, xoá q1; B sửa o2 (không đổi mốc) cùng lúc
  await A.DB.set('svcQuotesV1', []); await A.DB.set('shopOrdersV1', [...A.db.shopOrdersV1, { id: 'o3', at: 3 }]); await A.flush();
  await B.DB.set('shopOrdersV1', B.db.shopOrdersV1.map(o => o.id === 'o2' ? { ...o, note: 'bảo hành' } : o)); await B.flush();
  await B.sync(); await A.sync();
  for (const M of [A, B]) {
    assert.deepEqual(M.db.shopOrdersV1.map(o => o.id).sort(), ['o1', 'o2', 'o3']);
    assert.equal(M.db.svcQuotesV1.length, 0, 'deleted quote does not come back');
    assert.equal(M.db.shopOrdersV1.find(o => o.id === 'o2').note, 'bảo hành', 'edit without stamp still wins');
  }
  console.log('PASS: orders + quotes merge between machines, edits and deletions follow.');
})().catch(e => { console.error(e); process.exitCode = 1; });
