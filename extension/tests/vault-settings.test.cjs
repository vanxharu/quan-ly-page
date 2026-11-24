// Cài đặt lưu theo tài khoản Facebook: máy A lưu Telegram/kế hoạch/shop AI/hộp thư/lịch đăng → máy B đăng nhập cùng Facebook khôi phục đủ;
// bật/tắt kế hoạch và mở cùng Windows giữ riêng từng máy (2 máy không cùng chạy kế hoạch).
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const src = fs.readFileSync(__dirname + '/../../js/vault.js', 'utf8');
const cloud = {}; // máy chủ user_vault (1 tài khoản)
function machine(initial) {
  const db = structuredClone(initial), listeners = {}, toasts = [];
  const DB = { get: async (k, f) => structuredClone(db[k] ?? f), set: async (k, v) => { db[k] = structuredClone(v); (listeners[k] || []).forEach(fn => fn(v)); } };
  const sb = { functions: { invoke: async (_n, { body }) => {
    if (body.action === 'vault_get') return { data: { data: structuredClone(cloud) } };
    for (const [k, v] of Object.entries(body.parts)) if (!cloud[k] || v.at >= cloud[k].at) cloud[k] = structuredClone(v);
    return { data: { ok: true } };
  } } };
  const App = { server: { sb }, userToken: 'tok', onLogin: [], on: (k, fn) => (listeners[k] ||= []).push(fn), current: () => '', tabs: {} };
  const ctx = vm.createContext({ DB, App, api: async () => ({ id: '123', name: 'Văn' }), toast: m => toasts.push(m), window: {}, h: () => ({}), fmtTime: String,
    setTimeout: fn => { fn(); return 0; }, clearTimeout: () => {}, setInterval: () => {}, document: { hidden: false }, Date, JSON, Object, Array, Promise, String, Number, Error });
  vm.runInContext(src, ctx);
  return { db, DB, App, toasts, sync: () => App.vault.syncNow() };
}
(async () => {
  const A = machine({ autoPlanV1: { on: true, sys: { openAtLogin: true }, tg: { token: '123:ABC', chat: '42', daily: true }, reply: { from: '07:00' } },
    aiShopV1: { name: 'Shop Văn', policy: 'Bảo hành 30 ngày' }, inboxSettingsV1: { autoTag: false }, fbScheduleSettingsV1: { perDay: 2 } });
  await A.sync();
  assert.equal(cloud.auto.value.tg.token, '123:ABC'); assert.equal(cloud.auto.value.on, undefined, 'on/off stays on each machine');
  assert.equal(cloud.shop.value.name, 'Shop Văn'); assert.equal(cloud.plan.value.perDay, 2);
  const B = machine({ autoPlanV1: { on: false } });
  await B.sync();
  assert.deepEqual(B.db.autoPlanV1, { tg: { token: '123:ABC', chat: '42', daily: true }, reply: { from: '07:00' }, on: false }, 'Telegram + plan restored, plan stays off on machine B');
  assert.equal(B.db.aiShopV1.policy, 'Bảo hành 30 ngày'); assert.equal(B.db.inboxSettingsV1.autoTag, false); assert.equal(B.db.fbScheduleSettingsV1.perDay, 2);
  assert.match(B.toasts.join(' '), /Telegram/);
  // Máy B sửa Chat ID → máy A kéo về; máy A vẫn đang bật kế hoạch.
  await new Promise(r => setTimeout(r, 5));
  await B.DB.set('autoPlanV1', { ...B.db.autoPlanV1, tg: { ...B.db.autoPlanV1.tg, chat: '99' } });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(cloud.auto.value.tg.chat, '99', 'edit on B pushed');
  await A.sync();
  assert.equal(A.db.autoPlanV1.tg.chat, '99'); assert.equal(A.db.autoPlanV1.on, true); assert.deepEqual(A.db.autoPlanV1.sys, { openAtLogin: true });
  console.log('PASS: Telegram/auto plan, AI shop, inbox and planner settings follow the Facebook account; plan on/off stays per machine.');
})().catch(e => { console.error(e); process.exitCode = 1; });
