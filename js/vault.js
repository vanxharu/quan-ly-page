/* Lưu theo tài khoản Facebook: tin mẫu (+ nhóm, thẻ, biến mặc định), gói bán / bảng giá / API key dịch vụ, tài khoản ngân hàng hoá đơn.
 * Đăng nhập Facebook ở máy nào (hoặc sau khi xoá dữ liệu, cài lại app) cũng tự khôi phục, không phải làm lại từ đầu.
 * Hai nơi lưu: file trên máy (app Windows, mã hoá bằng khoá Windows) + máy chủ (bảng user_vault, hàm fb-admin xác minh token Facebook).
 * Mỗi phần có mốc giờ sửa; khi đăng nhập lấy bản mới nhất trong 3 nơi (trên app, file, máy chủ); sửa trên app → lưu lại sau 3 giây. */
(() => {
  const META = 'vaultMetaV1'; // { user, at: { tpl, vars, svc } }
  const PARTS = {
    tpl: { name: 'tin mẫu', keys: ['templates', 'categories', 'tags'],
      get: async () => ({ templates: await DB.get('templates', []), categories: await DB.get('categories', []), tags: await DB.get('tags', []) }),
      set: async v => { for (const k of ['templates', 'categories', 'tags']) if (Array.isArray(v?.[k])) await DB.set(k, v[k]); },
      empty: v => !v?.templates?.length },
    vars: { name: 'biến mẫu tin', keys: ['settings'],
      get: async () => (await DB.get('settings', {})).templateVars || {},
      set: async v => { await DB.set('settings', { ...(await DB.get('settings', {})), templateVars: v || {} }); App.templateVars = v || {}; },
      empty: v => !Object.values(v || {}).some(Boolean) },
    svc: { name: 'gói bán, bảng giá, API key, tài khoản ngân hàng', keys: ['svcSettingsV1'],
      get: async () => DB.get('svcSettingsV1', {}),
      set: async v => DB.set('svcSettingsV1', v || {}),
      empty: v => !v?.apiKey && !v?.packages?.length && !v?.invoice?.acc && !Object.keys(v?.prices || {}).length }
  };
  const V = App.vault = { user: '', name: '', state: '', error: '', cloud: '', at: 0 };
  let applying = false, pushTimer = 0, last = {};
  const sb = () => App.server?.sb;
  const redraw = () => { try { if (App.current?.() === 'settings') App.tabs.settings?.refresh?.(); } catch {} };
  async function cloud(action, extra = {}) {
    if (!sb()) throw new Error('Không kết nối được máy chủ.');
    const { data, error } = await sb().functions.invoke('fb-admin', { body: { action, userToken: App.userToken, ...extra } });
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  const oldServer = e => /Thiếu action|user_vault|schema cache|PGRST205|42P01|FB_APP_SECRET/i.test(String(e?.message || e));
  const snapshot = async () => Object.fromEntries(await Promise.all(Object.entries(PARTS).map(async ([k, p]) => [k, JSON.stringify(await p.get())])));

  async function push() {
    if (!V.user) return;
    const meta = await DB.get(META, {}), parts = {};
    for (const [k, p] of Object.entries(PARTS)) { const value = await p.get(); if (!p.empty(value) || meta.at?.[k]) parts[k] = { at: meta.at?.[k] || Date.now(), value }; }
    if (!Object.keys(parts).length) return;
    if (window.metaDesktop?.vaultSet) {
      const file = (await window.metaDesktop.vaultGet(V.user).catch(() => null))?.data || {};
      for (const [k, v] of Object.entries(parts)) if (!file[k] || v.at >= (file[k].at || 0)) file[k] = v;
      await window.metaDesktop.vaultSet(V.user, file).catch(() => {});
    }
    try { await cloud('vault_set', { parts }); V.cloud = 'ok'; V.error = ''; }
    catch (e) { V.cloud = oldServer(e) ? 'old' : 'err'; V.error = e.message; }
    V.at = Date.now(); V.state = 'ok'; redraw();
  }
  const schedule = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => push().catch(() => {}), 3000); };

  // Sửa trên app → đánh dấu phần đó vừa đổi (mốc giờ mới) rồi lưu.
  for (const [k, p] of Object.entries(PARTS)) for (const key of p.keys) App.on(key, async () => {
    if (applying || !V.user) return;
    const now = JSON.stringify(await p.get()); if (now === last[k]) return; // vd đổi cài đặt khác trong "settings", biến mẫu tin không đổi
    last[k] = now;
    const meta = await DB.get(META, {}); await DB.set(META, { user: V.user, at: { ...(meta.user === V.user ? meta.at : {}), [k]: Date.now() } });
    schedule();
  });

  // Đăng nhập: lấy bản mới nhất của từng phần trong 3 nơi, khôi phục nếu bản trên app cũ hơn / trống, rồi lưu lại cả 2 nơi.
  async function restore() {
    V.state = 'loading'; redraw();
    const me = await api('/me', { fields: 'id,name' }, 'GET', App.userToken);
    V.user = String(me.id); V.name = me.name || '';
    const meta = await DB.get(META, {}), mine = meta.user === V.user ? meta.at || {} : {}; // đổi tài khoản Facebook: bản trên app coi như cũ nhất
    const file = window.metaDesktop?.vaultGet ? (await window.metaDesktop.vaultGet(V.user).catch(() => null))?.data || {} : {};
    let remote = {};
    try { remote = (await cloud('vault_get')).data || {}; V.cloud = 'ok'; V.error = ''; } catch (e) { V.cloud = oldServer(e) ? 'old' : 'err'; V.error = e.message; }
    const at = { ...mine }, got = [];
    applying = true;
    try {
      for (const [k, p] of Object.entries(PARTS)) {
        const best = [file[k], remote[k]].filter(x => x && typeof x.at === 'number' && !p.empty(x.value)).sort((a, b) => b.at - a.at)[0];
        const local = await p.get();
        if (best && (best.at > (mine[k] || 0) || p.empty(local))) {
          // Trên app có sửa chưa lưu cùng mốc mới hơn → giữ bản trên app.
          if (JSON.stringify(local) !== JSON.stringify(best.value)) { await p.set(best.value); got.push(p.name); }
          at[k] = best.at;
        } else if (!p.empty(local) && !at[k]) at[k] = Date.now();
      }
    } finally { applying = false; }
    await DB.set(META, { user: V.user, at });
    last = await snapshot();
    if (got.length) { toast(`Đã khôi phục ${got.join(', ')} theo tài khoản Facebook ${V.name}.`, 7000); try { App.tabs[App.current?.()]?.refresh?.(); } catch {} }
    await push();
  }
  V.syncNow = () => restore().catch(e => { V.state = 'err'; V.error = e.message; redraw(); });
  App.onLogin.push(() => setTimeout(V.syncNow, 1500));
  // Mở lại app / quay lại cửa sổ sau lâu: kéo bản mới (máy khác vừa sửa).
  setInterval(() => { if (V.user && !document.hidden) V.syncNow(); }, 10 * 60e3);

  // Thẻ trạng thái (tab Cài đặt).
  V.card = () => h('div', { className: 'card', style: 'margin-top:12px' },
    h('h3', { className: 'card-title', textContent: '☁ Lưu theo tài khoản Facebook' }),
    h('p', { className: 'hint', textContent: 'Tin mẫu, gói bán, bảng giá, API key dịch vụ và tài khoản ngân hàng tự lưu theo tài khoản Facebook đang đăng nhập. Đăng nhập ở máy khác hoặc sau khi cài lại app sẽ tự khôi phục.' }),
    h('div', { className: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
      h('span', { className: 'status ' + (V.state === 'err' ? 'err' : V.cloud === 'ok' ? 'ok' : 'pending'), textContent:
        !V.user ? 'Chưa đăng nhập Facebook' : V.state === 'loading' ? 'Đang đồng bộ…' : V.state === 'err' ? 'Lỗi: ' + V.error
          : V.cloud === 'ok' ? `Đã lưu theo ${V.name || 'tài khoản'} (máy này + máy chủ) · ${V.at ? fmtTime(V.at) : ''}`
          : V.cloud === 'old' ? `Đã lưu trên máy này theo ${V.name || 'tài khoản'}. Máy chủ chưa cập nhật để lưu sang máy khác (chạy SQL user_vault + cập nhật hàm fb-admin).`
          : `Đã lưu trên máy này. Máy chủ: ${V.error || 'chưa kết nối'}` }),
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Đồng bộ ngay', disabled: !V.user, onclick: () => V.syncNow() })));
})();
