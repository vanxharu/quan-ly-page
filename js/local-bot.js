/* Bot chạy ngay trong app máy tính (không cần Meta duyệt ứng dụng, không cần máy chủ nhận webhook):
 *  - Tin nhắn: app vốn nhận tin mới tức thì qua Business Suite chạy ngầm → khớp quy tắc Từ khoá / Kịch bản / trả lời mặc định
 *    (đọc từ máy chủ bot như cũ) → gửi bằng đường gửi thẳng của Hộp thư (~1 giây).
 *  - Bình luận: 90 giây / lần đọc bình luận mới trên các bài gần đây của Page (Graph API, token Page) → ẩn SĐT/link, thích,
 *    trả lời công khai, nhắn riêng theo quy tắc Bình luận tự động.
 *  - Chỉ chạy cho các Page đang chọn ở góc trên; chạy cả khi app đang khoá; tắt / bật ở tab Từ khoá.
 *  - Nút bấm của kịch bản: Business Suite không gửi được nút → bot gửi dạng danh sách đánh số, khách trả lời số hoặc tên nút. */
(() => {
  if (!window.metaDesktop?.sendThread) return; // chỉ trong app máy tính
  const S = () => App.server, sb = () => S().sb, q = p => S().q(p);
  const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){9}\b/;
  const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|vn|net|org|me|shop|store|xyz|info)\b)/i;
  const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const fold = s => String(s || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  const key40 = s => fold(s).replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40);
  const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const B = App.localBot = { on: ls.get('localBotOn', true), status: '', log: [] };
  B.setOn = v => { B.on = !!v; ls.set('localBotOn', B.on); };
  const note = (s) => { B.status = s; B.log.unshift(`${new Date().toLocaleTimeString('vi-VN')} ${s}`); B.log.splice(30); };
  const started = Date.now();

  // ── Dữ liệu từ máy chủ bot (quy tắc, kịch bản, cài đặt Page), đọc lại tối đa 1 lần / 60 giây ──
  let cache = { at: 0, rules: [], flows: [], settings: [] };
  const load = async () => {
    if (!S()?.user) throw Error('chưa đăng nhập máy chủ bot (Quản lý › Cài đặt)');
    if (Date.now() - cache.at < 60e3) return cache;
    const [rules, flows, settings] = await Promise.all([q(sb().from('rules').select('*').eq('enabled', true)), q(sb().from('flows').select('*')), q(sb().from('page_settings').select('*'))]);
    return cache = { at: Date.now(), rules: rules || [], flows: flows || [], settings: settings || [] };
  };
  const settingsOf = (c, pageId) => c.settings.find(s => String(s.page_id) === String(pageId)) || {};
  const enabledFor = (c, pageId) => settingsOf(c, pageId).bot_enabled !== false; // chưa có cài đặt = bật (như ô "Bật bot")
  const selectedPage = pageId => App.selected().find(p => String(p.id) === String(pageId));
  const matchRule = (rules, text, { pageId, postId, kind }) => {
    const t = fold(text);
    return rules.filter(r => r.kind === kind && r.enabled && (!r.page_id || String(r.page_id) === String(pageId)) && (!r.post_id || r.post_id === postId))
      .sort((a, b) => ((Number(b.priority) || 0) - (Number(a.priority) || 0)) || ((b.page_id ? 1 : 0) + (b.post_id ? 1 : 0) - (a.page_id ? 1 : 0) - (a.post_id ? 1 : 0)))
      .find(r => !r.keywords?.length || r.keywords.some(k => k && (r.match === 'exact' ? t === fold(k) : t.includes(fold(k))))) || null;
  };
  const fill = (text, d = {}) => String(text || '').replace(/\{(tên|tên_khách|name|sdt|phone|địa_chỉ|address)\}/g, (_, k) =>
    ({ 'tên': d.first, 'tên_khách': d.name, name: d.name, sdt: d.phone, phone: d.phone, 'địa_chỉ': d.address, address: d.address })[k] || (k.startsWith('tên') || k === 'name' ? 'bạn' : ''));
  const firstName = n => String(n || '').trim().split(/\s+/).at(-1) || '';
  const logRow = (page_id, kind, detail) => q(sb().from('logs').insert({ page_id: String(page_id), kind, detail: { ...detail, via: 'app' } })).catch(() => {});
  const hit = rule => { rule.hits = (Number(rule.hits) || 0) + 1; sb().from('rules').update({ hits: rule.hits }).eq('id', rule.id).then(() => {}, () => {}); }; // đếm lượt (rule_hit chỉ máy chủ gọi được)

  // ── Trạng thái hội thoại (đang ở bước nào của kịch bản, im lặng tới khi nào) ──
  const convs = ls.get('localBotConvs', {});
  const saveConvs = () => { const now = Date.now(); for (const [k, v] of Object.entries(convs)) if (now - (v.at || 0) > 3 * 86400e3) delete convs[k]; ls.set('localBotConvs', convs); };
  const conv = id => (convs[id] ||= { at: Date.now() });
  const done = new Set(ls.get('localBotDone', []));
  const markDone = mid => { done.add(mid); if (done.size > 600) done.delete(done.values().next().value); ls.set('localBotDone', [...done]); };
  const sent = new Map(); // id → [{k, at}] tin bot vừa gửi (để không nhầm là bạn chat tay)

  // ── Gửi ──
  const toDataUrl = async url => { const r = await fetch(url); if (!r.ok) throw Error('HTTP ' + r.status); const b = await r.blob(); return await new Promise((ok, bad) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = bad; f.readAsDataURL(b); }); };
  const send = async (id, text, image = '') => {
    const [pageId, uid] = id.split(':');
    text = String(text || '').trim().slice(0, 2000);
    if (text) { const arr = sent.get(id) || []; arr.push({ k: key40(text), at: Date.now() }); sent.set(id, arr.filter(x => Date.now() - x.at < 5 * 60e3)); }
    if (text) { const r = await window.metaDesktop.sendThread({ pageId, uid, text }); if (r?.error) throw Error(r.error); }
    if (image) {
      let data = ''; try { data = await toDataUrl(image); } catch {}
      const r = data ? await window.metaDesktop.sendThread({ pageId, uid, text: '', image: data }) : await window.metaDesktop.sendThread({ pageId, uid, text: image });
      if (r?.error) throw Error(r.error);
    }
  };
  // Bước kịch bản → chữ: nút thành danh sách đánh số (nút mở link thì kèm link).
  const stepText = (step, d) => {
    const text = fill(step.text, d), btns = (step.buttons || []).filter(b => b.title);
    if (!btns.length) return text;
    return `${text}\n\n${btns.map((b, i) => `${NUM[i] || (i + 1) + '.'} ${b.title}${b.url ? ': ' + b.url : ''}`).join('\n')}\n(Bạn trả lời số hoặc tên mục nhé)`;
  };
  const ruleText = (rule, d) => { const qr = (rule.quick_replies || []).filter(x => x.title); const t = fill(rule.reply, d);
    return qr.length ? `${t}\n\n${qr.map((x, i) => `${NUM[i] || (i + 1) + '.'} ${x.title}`).join('\n')}` : t; };
  const runStep = async (c, id, flowId, stepId, data = {}, hops = 0) => {
    const st = conv(id), flow = c.flows.find(f => f.id === flowId), step = flow?.steps?.find(s => s.id === stepId) || (!stepId && flow?.steps?.[0]);
    if (!step || hops > 6) { st.flow = null; return saveConvs(); }
    const [pageId, uid] = id.split(':'), d = { ...data, name: data.name || st.name, first: firstName(data.name || st.name) };
    if (step.action === 'order') {
      await q(sb().from('bot_orders').insert({ page_id: pageId, psid: uid, name: d.name || '', phone: d.phone || '', address: d.address || '', note: d.note || '' })).catch(() => {});
      logRow(pageId, 'order', { psid: uid, ...data });
      App.notify?.(`🧾 Bot nhận đơn · ${selectedPage(pageId)?.name || ''}`, `${d.name || ''} ${d.phone || ''}`);
    }
    if (step.text || step.buttons?.length) await send(id, stepText(step, d), step.image || '');
    else if (step.image) await send(id, '', step.image);
    if (step.ask) st.flow = { flow_id: flow.id, step: step.id, ask: step.ask, data };
    else if (step.next && !step.buttons?.length) return runStep(c, id, flow.id, step.next, data, hops + 1);
    else st.flow = step.buttons?.length ? { flow_id: flow.id, step: step.id, data } : null;
    st.at = Date.now(); saveConvs();
  };

  // ── Tin nhắn mới ──
  const queue = new Map(); // id → promise (xử lý lần lượt từng khách)
  const onMessage = (id, info) => {
    if (!B.on || !info?.mid || !id.includes(':') || id.startsWith('zalo')) return;
    const [pageId] = id.split(':'); if (!selectedPage(pageId)) return;
    if (done.has(info.mid) || info.ts < started - 5000 || Date.now() - info.ts > 3 * 60e3) return;
    markDone(info.mid);
    const job = (queue.get(id) || Promise.resolve()).then(() => handle(id, info)).catch(e => { note(`Lỗi: ${e.message}`); logRow(pageId, 'error', { where: 'app-bot', message: e.message }); });
    queue.set(id, job); job.finally(() => { if (queue.get(id) === job) queue.delete(id); });
  };
  const handle = async (id, info) => {
    const [pageId] = id.split(':'), st = conv(id), text = String(info.text || '').trim();
    if (info.name) st.name = info.name;
    if (info.mine) {
      // Tin của Page: tin bot vừa gửi thì bỏ qua; bạn chat tay → bot im lặng với khách này một lúc.
      const k = key40(text), mine = (sent.get(id) || []).some(x => x.k && k && (x.k.startsWith(k.slice(0, 20)) || k.startsWith(x.k.slice(0, 20))));
      if (!mine && text) { const c = await load().catch(() => null); st.pausedUntil = Date.now() + (settingsOf(c || cache, pageId).pause_minutes ?? 30) * 60e3; st.flow = null; st.at = Date.now(); saveConvs(); }
      return;
    }
    const c = await load();
    if (!enabledFor(c, pageId) || (st.pausedUntil || 0) > Date.now() || !text || /^Đã gửi một ảnh/.test(text)) return;
    const s = settingsOf(c, pageId), d = { name: st.name, first: firstName(st.name) };
    // 1) Đang chờ trả lời câu hỏi / chọn nút của kịch bản
    if (st.flow) {
      const flow = c.flows.find(f => f.id === st.flow.flow_id), step = flow?.steps?.find(x => x.id === st.flow.step);
      if (st.flow.ask && step) {
        if (st.flow.ask === 'phone' && !PHONE.test(text)) return send(id, 'Số điện thoại chưa đúng, bạn nhập lại giúp shop nhé (VD: 0912345678).');
        const data = { ...(st.flow.data || {}), [st.flow.ask]: st.flow.ask === 'phone' ? text.match(PHONE)[0].replace(/[\s.-]/g, '') : text };
        return step.next ? runStep(c, id, flow.id, step.next, data) : (st.flow = null, saveConvs());
      }
      const btns = (step?.buttons || []).filter(b => b.title), n = parseInt(text.replace(/[^\d]/g, ''), 10);
      const b = btns.find(x => fold(x.title) === fold(text)) || (/^\D*\d{1,2}\D*$/.test(text) && btns[n - 1]) || null;
      if (b) {
        if (b.next) return runStep(c, id, flow.id, b.next, st.flow.data || {});
        if (b.flow) return runStep(c, id, b.flow, null);
        if (b.url) return send(id, `${b.title}: ${b.url}`);
      }
      st.flow = null; saveConvs(); // khách nói chuyện khác → thoát kịch bản, xét từ khoá bên dưới
    }
    // 2) Bấm "Bắt đầu" / câu hỏi gợi ý / mục menu (tới app dưới dạng chữ)
    if (/^(bắt đầu|get started)$/i.test(text) && s.welcome_flow_id) return runStep(c, id, s.welcome_flow_id, null);
    const ice = (s.ice_breakers || []).find(x => x.flow_id && fold(x.question) === fold(text)); if (ice) return runStep(c, id, ice.flow_id, null);
    const menu = (s.persistent_menu || []).find(m => fold(m.title) === fold(text));
    if (menu?.type === 'flow' && menu.value) return runStep(c, id, menu.value, null);
    const said = menu?.type === 'text' && menu.value ? menu.value : text;
    // 3) Từ khoá
    const rule = matchRule(c.rules, said, { pageId, kind: 'message' });
    if (rule) {
      hit(rule); logRow(pageId, 'keyword', { psid: id.split(':')[1], name: st.name, rule: rule.name || (rule.keywords || []).join(', '), text });
      note(`Trả lời "${(rule.name || rule.keywords?.[0] || '').slice(0, 20)}" cho ${st.name || 'khách'}`);
      if (rule.flow_id) return runStep(c, id, rule.flow_id, null);
      return send(id, rule.reply ? ruleText(rule, d) : '', rule.image_url || '');
    }
    // 4) Không khớp: trả lời mặc định, tối đa 1 lần / 12 giờ / khách
    if (s.fallback_text && Date.now() - (st.fallbackAt || 0) > 12 * 3600e3) { st.fallbackAt = Date.now(); saveConvs(); return send(id, fill(s.fallback_text, d)); }
  };
  // Móc vào luồng tin mới của Hộp thư (Business Suite chạy ngầm báo về).
  const hook = () => {
    const orig = App.inbox?.bsChanged; if (!orig || orig.__bot) return !!orig;
    const wrapped = (id, info) => { try { orig(id, info); } finally { try { onMessage(String(id), info); } catch {} } };
    wrapped.__bot = true; App.inbox.bsChanged = wrapped; return true;
  };
  const hookTimer = setInterval(() => { if (hook()) clearInterval(hookTimer); }, 1000);

  // ── Bình luận mới (90 giây / lần) ──
  const seenC = new Set(ls.get('localBotComments', [])), repliedC = new Set(ls.get('localBotCReplied', []));
  const saveC = () => { while (seenC.size > 3000) seenC.delete(seenC.values().next().value); while (repliedC.size > 3000) repliedC.delete(repliedC.values().next().value); ls.set('localBotComments', [...seenC]); ls.set('localBotCReplied', [...repliedC]); };
  const primed = new Set(); // Page đã đánh dấu bình luận cũ (lần đầu chạy không trả lời bình luận cũ)
  const pollComments = async () => {
    if (!B.on || !S()?.user || typeof api !== 'function') return;
    const c = await load().catch(() => null); if (!c) return;
    for (const p of App.selected()) {
      if (!p.access_token) continue;
      const s = settingsOf(c, p.id), hasRules = enabledFor(c, p.id) && c.rules.some(r => r.kind === 'comment' && (!r.page_id || String(r.page_id) === String(p.id)));
      if (!hasRules && !s.hide_phone && !s.hide_link && !s.like_comments) continue;
      let posts = [];
      try { posts = (await api(`/${p.id}/posts`, { fields: 'id,created_time,comments.order(reverse_chronological).limit(25){id,message,from,created_time}', limit: 8 }, 'GET', p.access_token, { background: true, low: true, pageId: p.id })).data || []; }
      catch (e) { note(`Không đọc được bình luận ${p.name}: ${e.message}`); continue; }
      const first = !primed.has(p.id); primed.add(p.id);
      for (const post of posts) for (const cm of post.comments?.data || []) {
        if (seenC.has(cm.id)) continue; seenC.add(cm.id);
        if (first && new Date(cm.created_time).getTime() < started - 60e3) continue; // bình luận có trước khi bật app
        if (!cm.from?.id || String(cm.from.id) === String(p.id)) continue;
        await onComment(c, p, post.id, cm).catch(e => logRow(p.id, 'error', { where: 'app-bot comment', message: e.message }));
      }
    }
    saveC();
  };
  const onComment = async (c, p, postId, cm) => {
    const s = settingsOf(c, p.id), text = cm.message || '', did = [], tok = p.access_token, opt = { pageId: p.id };
    const name = cm.from?.name || '', d = { name, first: firstName(name) };
    if ((s.hide_phone && PHONE.test(text)) || (s.hide_link && LINK.test(text))) await api(`/${cm.id}`, { is_hidden: true }, 'POST', tok, opt).then(() => did.push('ẩn'), e => did.push('ẩn lỗi: ' + e.message));
    if (s.like_comments) await api(`/${cm.id}/likes`, {}, 'POST', tok, opt).then(() => did.push('thích'), () => {});
    if (enabledFor(c, p.id)) {
      const rule = matchRule(c.rules, text, { pageId: p.id, postId, kind: 'comment' }), once = `${postId}:${cm.from.id}`;
      if (rule && !repliedC.has(once)) {
        repliedC.add(once); hit(rule);
        if (rule.public_reply) await api(`/${cm.id}/comments`, { message: fill(rule.public_reply, d) }, 'POST', tok, opt).then(() => did.push('trả lời'), e => did.push('trả lời lỗi: ' + e.message));
        let msg = rule.reply ? ruleText(rule, d) : '';
        if (rule.flow_id) { const f = c.flows.find(x => x.id === rule.flow_id); if (f?.steps?.[0]) msg = stepText(f.steps[0], d); }
        // Nhắn riêng theo bình luận (Facebook cho 1 tin trong 7 ngày kể từ bình luận).
        if (msg) await api(`/${p.id}/messages`, { recipient: { comment_id: cm.id }, message: { text: msg.slice(0, 2000) } }, 'POST', tok, opt).then(() => did.push('nhắn riêng'), e => did.push('nhắn riêng lỗi: ' + e.message));
        logRow(p.id, 'comment_reply', { post: postId, user: cm.from.id, name, text, rule: rule.name });
        note(`Trả lời bình luận của ${name} · ${p.name}`);
      }
    }
    if (did.length) logRow(p.id, 'comment', { post: postId, name, text, done: did });
  };
  setTimeout(function loop() { pollComments().catch(() => {}).finally(() => setTimeout(loop, 90e3)); }, 20e3);
})();
