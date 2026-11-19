/* Kế hoạch tự động (24/7 khi app Windows đang mở):
 *  - 💬 AI tự trả lời khách đang chờ (ngoài giờ làm việc, hoặc khi bạn rời máy), kèm bảng giá nếu khách hỏi giá.
 *  - 📣 Remarketing theo lịch (giờ + thứ trong tuần, lọc nhóm / Page / nhãn / số ngày im lặng, AI viết hoặc mẫu).
 *  - 📦 Đơn & bảo hành: tự gửi tin cập nhật đơn (đã nhận tiền, chạy, xong, bảo hành xong…), tự refill khi khách báo tụt.
 *  - 📝 Đăng bài & quét bài: tự lên lịch bài đã duyệt; quét bình luận chưa trả lời / SĐT khách để lại.
 *  - 🔔 Báo cáo Telegram (lỗi ngay + tóm tắt mỗi ngày) và 📜 Nhật ký trong app.
 * Việc phải mở hội thoại để gửi chỉ chạy khi bạn không dùng máy (rảnh ≥ 90 giây), để không giành chuột / ô nhập với bạn.
 * Lưu: autoPlanV1 (cài đặt), autoLogV1 (nhật ký), autoStateV1 (đã làm gì hôm nay), autoLeadsV1 (khách từ quét bình luận). */
(() => {
  const CFG = 'autoPlanV1', LOG = 'autoLogV1', STATE = 'autoStateV1', LEADS = 'autoLeadsV1', NO_AI = 'Không AI';
  const D = window.metaDesktop || {};
  const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const NUDGE_KINDS = [['paid', 'Đã nhận tiền'], ['start', 'Bắt đầu chạy'], ['half', 'Chạy được 50%'], ['done', 'Hoàn thành'], ['wdone', 'Bảo hành xong'], ['ask', 'Trả lời khách hỏi tiến độ'], ['follow', 'Hỏi thăm hôm sau']];
  const GOAL = {
    open: 'Nhắn lại khách chưa chốt đơn: nhắc khéo nhu cầu khách đã hỏi, trấn an khách yên tâm, mời chốt đơn hôm nay.',
    done: 'Hỏi thăm khách cũ về kết quả đơn trước, mời mua lại hoặc thử thêm dịch vụ phù hợp với trang của khách.',
    all: 'Hỏi thăm khách, giới thiệu ngắn dịch vụ phù hợp, mời khách nhắn khi cần.'
  };
  const defaults = () => ({
    on: false,
    sys: { openAtLogin: true, keepAwake: true, watchdog: true },
    reply: { on: true, from: '08:00', to: '22:00', away: true, awayMin: 10, waitMin: 3, perHour: 30 },
    remarket: { gapDays: 7, pageLimit: 50, rules: [] },
    orders: { nudges: true, kinds: NUDGE_KINDS.map(([k]) => k), warranty: true },
    post: { schedule: false, scheduleAt: '07:30', pages: [], ai: false, aiAt: '06:30', aiPages: [], aiPer: 1, aiTopic: '', aiApprove: true, scan: false, scanAt: '21:00', scanDays: 3, scanPages: [] },
    tg: { token: '', chat: '', errors: true, daily: true, dailyAt: '21:30', notify: true, control: true }
  });
  const merge = (a, b) => { for (const k of Object.keys(b || {})) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge({ ...a[k] }, b[k]) : b[k]; return a; };
  const getCfg = async () => merge(defaults(), await DB.get(CFG, {}));
  const setCfg = async c => { await DB.set(CFG, c); applySys(c).catch(() => {}); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const hm = s => { const [a, b] = String(s || '0:0').split(':').map(Number); return (a || 0) * 60 + (b || 0); };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const today = () => new Date().toDateString();
  const inWork = c => { const n = nowMin(), a = hm(c.reply.from), b = hm(c.reply.to); return a <= b ? n >= a && n < b : n >= a || n < b; };
  const day = c => (Date.now() - new Date(c.updated_time || 0)) / 864e5;
  let lastInput = Date.now();
  ['keydown', 'mousedown', 'wheel', 'touchstart'].forEach(t => addEventListener(t, () => { lastInput = Date.now(); }, { capture: true, passive: true }));
  const idleSec = async () => { const sys = D.sysIdle ? await D.sysIdle().catch(() => null) : null; return Number.isFinite(sys) ? sys : (Date.now() - lastInput) / 1000; };

  // ── Nhật ký + Telegram ──
  const lastErr = {};
  async function tg(text, c) { c ||= await getCfg(); if (!c.tg.token || !c.tg.chat) return { error: 'Chưa nhập Bot token / Chat ID' };
    const args = { token: c.tg.token.trim(), chat: c.tg.chat.trim(), text };
    if (D.tgSend) return D.tgSend(args);
    try { const r = await fetch(`https://api.telegram.org/bot${args.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: args.chat, text, disable_web_page_preview: true }) });
      const j = await r.json(); return j.ok ? { ok: true } : { error: j.description }; } catch (e) { return { error: e.message }; } }
  async function log(task, kind, msg) {
    const all = await DB.get(LOG, []); all.push({ at: Date.now(), task, kind, msg: String(msg).slice(0, 600) }); await DB.set(LOG, all.slice(-1500));
    if (App.current() === 'autoplan') drawLog();
    if (kind === 'err') { const c = await getCfg(); if (c.tg.errors && Date.now() - (lastErr[task] || 0) > 20 * 60e3) { lastErr[task] = Date.now(); tg(`⚠️ Get Helps · ${TASK[task] || task}\n${msg}`, c).catch(() => {}); } }
  }
  const TASK = { reply: '💬 AI trả lời', remarket: '📣 Remarketing', orders: '📦 Đơn hàng', warranty: '🛡 Bảo hành', post: '📝 Đăng bài', scan: '🔎 Quét bài', report: '🔔 Báo cáo', sys: '⚙ Hệ thống' };
  const getState = async () => { const s = await DB.get(STATE, {}); if (s.day !== today()) { s.day = today(); s.ran = {}; } s.replied ||= {}; s.failed ||= {}; s.remarketed ||= {}; s.warrSeen ||= {}; s.hour ||= []; return s; };

  // ── Hệ thống (app Windows) ──
  async function applySys(c) { c ||= await getCfg(); if (!D.autoSys) return null;
    return D.autoSys({ openAtLogin: c.on && c.sys.openAtLogin, keepAwake: c.on && c.sys.keepAwake, watchdog: c.on && c.sys.watchdog }); }

  // ── Việc 1: AI trả lời khách đang chờ ──
  async function taskReply(c, st, A) {
    if (!c.reply.on) return;
    const idle = await idleSec(), outside = !inWork(c);
    if (!outside && !(c.reply.away && idle >= c.reply.awayMin * 60)) return;
    st.hour = st.hour.filter(t => Date.now() - t < 3600e3); if (st.hour.length >= c.reply.perHour) return;
    const list = A.convs().filter(x => x.fromCustomer && !A.labels(x).includes(NO_AI)).filter(x => { const w = (Date.now() - new Date(x.updated_time || 0)) / 60e3;
      return w >= c.reply.waitMin && w <= 24 * 60 && st.replied[x.id] !== x.updated_time && !(st.failed[x.id] && Date.now() - st.failed[x.id] < 30 * 60e3); })
      .sort((a, b) => new Date(a.updated_time) - new Date(b.updated_time));
    for (const x of list.slice(0, 3)) {
      if (!await canDrive() || st.hour.length >= c.reply.perHour) return;
      const mark = x.updated_time;
      try {
        const msgs = await A.messagesOf(x);
        const last = [...msgs].reverse().find(m => m.text || m.pic);
        if (!last || !last.isCustomer) { st.replied[x.id] = mark; continue; } // đã có người trả lời
        // Khách gửi ảnh / nói "bài đầu" mà không có link: tự tìm bài trên trang khách, tìm được thì hỏi xác nhận + báo giá; không thì xin link.
        let note = '';
        if (A.needLink(x, msgs)) { const f = await A.findPost(x, msgs).catch(() => ({ need: true }));
          note = f.link ? `Khách chưa gửi link, app đã tìm thấy bài khách nói trên trang của khách${f.byImage ? ' (khớp ảnh khách gửi)' : ''}: ${f.link}\nHãy gửi lại đúng link này, hỏi khách xác nhận có phải bài này không, và báo giá theo dịch vụ + số lượng khách đã nói.`
            : 'Khách chưa gửi link bài và app không tự tìm được bài. Hãy xin khách link bài, kèm hướng dẫn ngắn: bấm "Chia sẻ" dưới bài (hoặc dấu ⋯) → "Sao chép liên kết" → dán vào đây.';
          await log('reply', 'info', `${x.other.name || 'Khách'}: chưa có link bài → ${f.link ? 'tìm thấy ' + f.link : 'không tìm được, xin link'}`); }
        const r = await A.aiReply(x, msgs, note);
        if (!r.text?.trim()) throw Error('AI không soạn được câu trả lời');
        await A.send(x, r.text, r.image || '');
        st.replied[x.id] = mark; st.hour.push(Date.now()); await DB.set(STATE, st);
        await log('reply', 'ok', `${x.other.name || 'Khách'}: "${String(last.text || '[ảnh]').slice(0, 60)}" → ${r.text.slice(0, 120)}${r.pt ? ' + 📎 ' + (r.pt.t.title || 'bảng giá') : ''}`);
      } catch (e) { st.failed[x.id] = Date.now(); await DB.set(STATE, st); await log('reply', 'err', `${x.other.name || 'Khách'}: ${e.message}`); if (/đăng nhập|Windows/.test(e.message)) return; }
    }
  }

  // ── Việc 2: Remarketing theo lịch ──
  const ruleDue = (r, st) => r.on && (r.days || []).includes(new Date().getDay()) && nowMin() >= hm(r.at) && st.ran['rm:' + r.id] !== 'done';
  function pickFor(r, c, st, A) {
    return A.convs().filter(x => { const s = A.stage(x), d = day(x);
      return !x.fromCustomer && (r.group === 'all' || s[r.group]) && d >= (Number(r.min) || 0) && d <= (r.max === '' || r.max == null ? 1e9 : Number(r.max))
        && (!r.page || String(x.page?.id || A.plat(x)) === r.page) && (!r.label || A.labels(x).includes(r.label)) && !A.labels(x).includes(NO_AI)
        && !(st.remarketed[x.key] && Date.now() - st.remarketed[x.key] < (Number(c.remarket.gapDays) || 0) * 864e5); });
  }
  async function taskRemarket(c, st, A) {
    for (const r of c.remarket.rules) { if (!ruleDue(r, st)) continue; if ((await runRule(r, c, st, A)).stop) return; }
  }
  // Chạy 1 lịch remarketing (theo giờ hẹn, hoặc "chạy ngay" từ app / Telegram). Trả { sent, stop }.
  async function runRule(r, c, st, A) {
    st.ran['rm:' + r.id] = Number(st.ran['rm:' + r.id]) || 0; // số tin đã gửi hôm nay theo lịch này
    const max = Math.max(1, Number(r.limit) || 30), left = max - st.ran['rm:' + r.id];
    const cand = pickFor(r, c, st, A).slice(0, left); let sent = 0;
    if (!cand.length) { st.ran['rm:' + r.id] = 'done'; await DB.set(STATE, st); await log('remarket', 'info', `${r.name || 'Lịch'}: không còn khách nào khớp bộ lọc hôm nay.`); return { sent }; }
    if (!await canDrive()) return { sent, stop: true };
    let texts = new Map();
    try {
      if (r.mode === 'tpl') cand.forEach(x => texts.set(x.id, { text: A.fill(r.text || '', x), image: '' }));
      else texts = await A.aiMass(cand, { mode: r.mode, goal: r.text || GOAL[r.group] || GOAL.all });
    } catch (e) { await log('remarket', 'err', `${r.name || 'Lịch'}: ${e.message}`); return { sent, stop: true }; }
    for (const x of cand) {
      if (!r.adhoc && !(await getCfg()).on) return { sent, stop: true };
      if (!await canDrive()) return { sent, stop: true }; // bạn quay lại dùng máy: tạm dừng, lần sau chạy tiếp
      const m = texts.get(x.id); if (!m?.text?.trim()) { st.remarketed[x.key] = Date.now(); continue; }
      const pk = String(x.page?.id || A.plat(x)), day = await A.sentToday();
      if ((day.n[pk] || 0) >= (Number(c.remarket.pageLimit) || 50)) continue;
      try {
        await A.send(x, m.text, m.image || '');
        day.n[pk] = (day.n[pk] || 0) + 1; await DB.set(A.MASS_SENT, day); sent++;
        st.remarketed[x.key] = Date.now(); st.ran['rm:' + r.id] = (Number(st.ran['rm:' + r.id]) || 0) + 1; await DB.set(STATE, st);
        await log('remarket', 'ok', `${r.name || 'Lịch'} → ${x.other.name || 'Khách'}: ${m.text.slice(0, 120)}`);
      } catch (e) { st.remarketed[x.key] = Date.now(); await DB.set(STATE, st); await log('remarket', 'err', `${r.name || 'Lịch'} → ${x.other.name || 'Khách'}: ${e.message}`); }
      // AI viết: thời gian soạn đã giãn cách; mẫu chung: chờ 20–40 giây.
      await wait(r.mode === 'tpl' ? 20e3 + Math.random() * 20e3 : 6e3 + Math.random() * 6e3);
    }
    if ((Number(st.ran['rm:' + r.id]) || 0) >= max || !pickFor(r, c, st, A).length) { st.ran['rm:' + r.id] = 'done'; await DB.set(STATE, st); }
    return { sent };
  }

  // ── Việc 3: Đơn & bảo hành ──
  async function taskOrders(c, st, A) {
    const P = App.services; if (!P?.autoNudgeList) return;
    if (c.orders.warranty) {
      for (const x of A.convs().filter(x => x.fromCustomer && st.warrSeen[x.id] !== x.updated_time).slice(0, 30)) {
        const msgs = await A.texts(x); st.warrSeen[x.id] = x.updated_time;
        if (!await P.complaintInfo(x.key, msgs).catch(() => null)) continue;
        if (!await canDrive()) { delete st.warrSeen[x.id]; return; }
        const full = await A.messagesOf(x).catch(() => msgs);
        const r = await P.autoWarranty({ key: x.key, name: x.other.name, page: x.page, messages: full }).catch(e => ({ error: e.message }));
        await DB.set(STATE, st);
        if (!r) continue;
        if (r.skipped) { await log('warranty', 'info', `${x.other.name || 'Khách'} báo tụt: ${r.skipped}. Bạn xem giúp (Đơn bù / hết hạn).`); tg(`🛡 ${x.other.name || 'Khách'} báo tụt: ${r.skipped}. Cần bạn xử lý.`, c).catch(() => {}); continue; }
        if (r.error) { await log('warranty', 'err', `${x.other.name || 'Khách'}: ${r.error}`); continue; }
        try { await A.sendKey(x.key, r.text, r.image || ''); await log('warranty', 'ok', `${x.other.name || 'Khách'}: đã gửi refill ${r.n} link + báo khách${r.fails?.length ? ' (lỗi: ' + r.fails.join(' · ') + ')' : ''}`); }
        catch (e) { await log('warranty', 'err', `${x.other.name || 'Khách'}: đã refill ${r.n} link nhưng chưa báo được khách: ${e.message}`); }
      }
    }
    if (c.orders.nudges) {
      const list = (await P.autoNudgeList()).filter(n => c.orders.kinds.includes(n.kind)).sort((a, b) => a.at - b.at);
      for (const n of list.slice(0, 4)) {
        if (!await canDrive()) return;
        const m = await P.autoNudgeFull(n); if (!m) continue;
        try { await A.sendKey(n.key, m.text, m.image || ''); await P.autoNudgeDone(n); await log('orders', 'ok', `${m.title}: ${m.text.slice(0, 120)}`); }
        catch (e) { if (/không còn trong danh sách/.test(e.message)) { await P.autoNudgeDone(n); await log('orders', 'info', `${m.title}: bỏ qua, ${e.message}`); } else await log('orders', 'err', `${m.title}: ${e.message}`); }
      }
    }
  }

  // ── Việc 4: Đăng bài & quét bài ──
  async function taskPost(c, st) {
    if (c.post.schedule && nowMin() >= hm(c.post.scheduleAt) && !st.ran.post && App.planner?.scheduleAll) {
      st.ran.post = 1; await DB.set(STATE, st);
      try { const r = await App.planner.scheduleAll(c.post.pages?.length ? c.post.pages : App.pages.map(p => p.id)); await log('post', /lỗi|không/i.test(r) && !/Đã|đã hẹn/.test(r) ? 'info' : 'ok', r || 'Đã chạy lên lịch bài đã duyệt.'); }
      catch (e) { await log('post', 'err', e.message); }
    }
    if (c.post.ai && nowMin() >= hm(c.post.aiAt) && !st.ran.aipost) {
      st.ran.aipost = 1; await DB.set(STATE, st);
      try { await aiPosts(c); } catch (e) { await log('post', 'err', 'AI viết bài: ' + e.message); }
    }
    if (c.post.scan && nowMin() >= hm(c.post.scanAt) && !st.ran.scan) {
      st.ran.scan = 1; await DB.set(STATE, st);
      try { await scanComments(c); } catch (e) { await log('scan', 'err', e.message); }
    }
  }
  // AI viết bài mới cho từng Page đã chọn → hàng chờ Lịch đăng; "tự duyệt" thì lên lịch luôn (Facebook đăng vào giờ trống của Page).
  async function aiPosts(c) {
    if (!D.gptAsk) throw Error('Cần app Get Helps trên Windows (ChatGPT trong app).');
    const pages = App.pages.filter(p => !c.post.aiPages?.length || c.post.aiPages.includes(String(p.id))), per = Math.max(1, Math.min(5, Number(c.post.aiPer) || 1));
    const shop = { ...(await DB.get('aiShopV1', {})) }, made = [];
    for (const p of pages) {
      let recent = []; try { recent = (await apiPaged(`/${p.id}/posts`, { fields: 'message,created_time', limit: 8 }, p.access_token, 1)).map(x => String(x.message || '').replace(/\s+/g, ' ').slice(0, 220)).filter(Boolean); } catch {}
      const prompt = [`Bạn là người viết nội dung cho Fanpage "${p.name}"${shop.name ? ' của shop ' + shop.name : ''} (dịch vụ tăng tương tác mạng xã hội: like, follow, view…).`,
        `Viết ${per} bài đăng Facebook MỚI, khác nhau, tiếng Việt tự nhiên, hấp dẫn, có lời kêu gọi nhắn tin cho Page, 3–8 câu, emoji vừa phải, 2–4 hashtag cuối bài.`,
        c.post.aiTopic ? 'Chủ đề / ý chính muốn đăng: ' + c.post.aiTopic : 'Chủ đề: chọn góc nhìn hữu ích cho người bán hàng online / người làm nội dung (mẹo tăng tương tác, lợi ích dịch vụ, ưu đãi, cảm nhận khách…).',
        shop.policy ? 'Chính sách shop (được nhắc khi hợp): ' + shop.policy : '', shop.notes ? 'Lưu ý: ' + shop.notes : '',
        'Không bịa giá cụ thể, không hứa điều shop không có. Không lặp lại ý các bài gần đây:', ...recent.map(t => '- ' + t),
        `Chỉ trả về MỘT khối JSON: {"posts":["bài 1"${per > 1 ? ',"bài 2"' : ''}]}`].filter(Boolean).join('\n');
      let posts = [];
      for (let k = 0; k < 3 && !posts.length; k++) {
        const r = await D.gptAsk({ prompt, fresh: k > 0 }); if (r?.error === 'login') throw Error('Chưa đăng nhập ChatGPT trong app');
        try { const t = String(r?.text || '').replace(/```(?:json)?/gi, ''), j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); posts = (j.posts || []).map(x => String(x).trim()).filter(x => x.length > 20).slice(0, per); } catch {}
      }
      if (!posts.length) { await log('post', 'err', `${p.name}: AI chưa viết được bài.`); continue; }
      await App.planner.addItems(posts.map(text => ({ pageKey: p.id, pageName: p.name, status: c.post.aiApprove ? 'approved' : 'draft', text, source: 'auto-ai' })));
      made.push(`${p.name}: ${posts.length}`);
      await log('post', 'ok', `✨ AI viết ${posts.length} bài cho ${p.name}${c.post.aiApprove ? '' : ' (chờ bạn duyệt trong Lịch đăng)'}: ${posts[0].slice(0, 100)}…`);
    }
    if (c.post.aiApprove && made.length) {
      const r = await App.planner.scheduleAll(pages.map(p => p.id)); await log('post', 'ok', 'Lên lịch bài AI vừa viết: ' + (r || 'xong'));
      tg(`📝 AI đã viết và lên lịch bài mới: ${made.join(' · ')}`, c).catch(() => {});
    } else if (made.length) tg(`📝 AI đã viết bài mới (chờ duyệt trong Lịch đăng): ${made.join(' · ')}`, c).catch(() => {});
  }
  const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){9}\b/g;
  async function scanComments(c) {
    const since = Math.floor((Date.now() - (Number(c.post.scanDays) || 3) * 864e5) / 1000), found = [], old = await DB.get(LEADS, []), seen = new Set(old.map(l => l.id));
    for (const p of App.pages.filter(p => !c.post.scanPages?.length || c.post.scanPages.includes(String(p.id)))) {
      let posts = []; try { posts = await apiPaged(`/${p.id}/posts`, { since, limit: 50, fields: 'id,permalink_url,message,comments.summary(true).limit(0)' }, p.access_token, 2); } catch (e) { await log('scan', 'err', `${p.name}: ${e.message}`); continue; }
      for (const post of posts.filter(x => x.comments?.summary?.total_count)) {
        let cm = []; try { cm = await apiPaged(`/${post.id}/comments`, { filter: 'toplevel', limit: 100, fields: 'id,from{id,name},message,created_time,permalink_url,comments.limit(25){from{id}}' }, p.access_token, 5); } catch { continue; }
        for (const x of cm) { if (String(x.from?.id) === String(p.id)) continue;
          const phones = [...new Set((String(x.message || '').match(PHONE) || []).map(s => s.replace(/\D/g, '')))], answered = (x.comments?.data || []).some(y => String(y.from?.id) === String(p.id));
          if (!phones.length && answered) continue;
          found.push({ id: x.id, page: p.name, name: x.from?.name || '(ẩn danh)', msg: String(x.message || '').slice(0, 200), phones, answered, link: x.permalink_url || post.permalink_url, at: new Date(x.created_time).getTime(), isNew: !seen.has(x.id) }); }
      }
    }
    const fresh = found.filter(f => f.isNew), un = found.filter(f => !f.answered), ph = found.filter(f => f.phones.length);
    await DB.set(LEADS, [...old.filter(o => !found.some(f => f.id === o.id)), ...found.map(({ isNew, ...f }) => f)].slice(-2000));
    await log('scan', 'ok', `Quét ${App.pages.length} Page, ${Number(c.post.scanDays) || 3} ngày: ${un.length} bình luận chưa trả lời, ${ph.length} bình luận có SĐT (${fresh.length} mới).`);
    if (fresh.length) tg([`🔎 Quét bình luận: ${fresh.length} mới · ${un.length} chưa trả lời · ${ph.length} có SĐT`, ...fresh.slice(0, 15).map(f => `• ${f.page} · ${f.name}${f.phones.length ? ' · ☎ ' + f.phones.join(', ') : ''}${f.answered ? '' : ' · chưa trả lời'}\n  ${f.msg.slice(0, 80)}\n  ${f.link}`)].join('\n'), c).catch(() => {});
  }

  // ── Việc 5: Tóm tắt mỗi ngày ──
  async function taskReport(c, st) {
    if (!c.tg.daily || !c.tg.token || nowMin() < hm(c.tg.dailyAt) || st.ran.report) return;
    st.ran.report = 1; await DB.set(STATE, st);
    const since = Date.now() - 864e5, L = (await DB.get(LOG, [])).filter(l => l.at >= since), n = (t, k = 'ok') => L.filter(l => l.task === t && l.kind === k).length;
    const text = [`📊 Get Helps · tóm tắt 24 giờ (${new Date().toLocaleDateString('vi-VN')})`, `💬 AI trả lời: ${n('reply')} khách`, `📣 Remarketing: ${n('remarket')} tin`, `📦 Tin cập nhật đơn: ${n('orders')}`,
      `🛡 Bảo hành tự động: ${n('warranty')}`, `📝 Đăng bài: ${n('post')} lần`, `🔎 Quét bình luận: ${n('scan')} lần`, `⚠️ Lỗi: ${L.filter(l => l.kind === 'err').length}`].join('\n');
    const r = await tg(text, c); await log('report', r?.ok ? 'ok' : 'err', r?.ok ? 'Đã gửi tóm tắt ngày về Telegram.' : 'Chưa gửi được tóm tắt: ' + (r?.error || ''));
  }


  // ── 📱 Điều khiển qua Telegram: báo tin nhắn mới, trả lời khách (trả lời vào tin báo), AI soạn, lệnh bật/tắt ──
  // Chỉ nhận lệnh từ đúng Chat ID đã nhập. Tin của khách → tin báo có nút; bạn "Trả lời" (reply) tin báo đó = gửi cho khách.
  const tgApi = async (method, params, c) => { c ||= await getCfg(); const token = c.tg.token.trim();
    if (D.tgApi) return D.tgApi({ token, method, params });
    try { const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) }); return await r.json(); }
    catch (e) { return { ok: false, description: e.message }; } };
  const RC = { map: {}, drafts: {}, seen: null, mute: {} }; // map: id tin Telegram → khoá khách
  const kb = rows => ({ inline_keyboard: rows });
  const custBtns = k => kb([[{ text: '✨ AI soạn', callback_data: 'ai|' + k }, { text: '📋 5 tin gần đây', callback_data: 'his|' + k }, { text: '🔕 Tắt báo', callback_data: 'mute|' + k }], [{ text: '🧾 Báo giá', callback_data: 'quo|' + k }, { text: '🛡 Bảo hành', callback_data: 'war|' + k }]]);
  const shortKey = key => { const id = Object.keys(RC.ref || {}).find(k => RC.ref[k] === key); if (id) return id; RC.ref ||= {}; const k = Math.random().toString(36).slice(2, 9); RC.ref[k] = key; return k; };
  const convOf = key => App.inbox?.auto?.convs().find(c => c.key === key);
  const nm = c => `${c.other?.name || 'Khách'}${c.page?.name ? ' · ' + c.page.name : ''}`;
  async function tgNotify(c) {
    if (!c.tg.notify || !c.tg.token || !c.tg.chat) return;
    const A = App.inbox?.auto; if (!A) return;
    const list = A.convs().filter(x => x.fromCustomer);
    if (!RC.seen) { RC.seen = {}; list.forEach(x => { RC.seen[x.id] = x.updated_time; }); return; } // lần đầu: chỉ ghi mốc, không báo tin cũ
    for (const x of list) {
      if (RC.seen[x.id] === x.updated_time) continue; RC.seen[x.id] = x.updated_time;
      if (RC.mute[x.key] && Date.now() < RC.mute[x.key]) continue;
      const k = shortKey(x.key), snip = String(x.snippet || '').replace(/^Bạn:\s*/, '').slice(0, 300);
      const r = await tgApi('sendMessage', { chat_id: c.tg.chat, text: `💬 ${nm(x)}\n${snip}\n\n↩️ Trả lời (reply) tin này để nhắn lại khách`, reply_markup: custBtns(k) }, c);
      if (r?.ok) { RC.map[r.result.message_id] = x.key; trimMap(); }
    }
  }
  const trimMap = () => { const ks = Object.keys(RC.map); if (ks.length > 400) ks.slice(0, ks.length - 400).forEach(k => delete RC.map[k]); };
  const say = (c, text, extra = {}) => tgApi('sendMessage', { chat_id: c.tg.chat, text: String(text).slice(0, 4000), ...extra }, c);
  async function tgSendToCustomer(c, key, text, image = '') {
    const A = App.inbox.auto, x = convOf(key); if (!x) return say(c, '✗ Không tìm thấy khách trong danh sách hội thoại (có thể đã cũ).');
    try { await A.send(x, text, image); await log('reply', 'ok', `📱 Từ Telegram → ${x.other.name || 'Khách'}: ${text.slice(0, 120)}`); return say(c, `✓ Đã gửi cho ${nm(x)}`); }
    catch (e) { await log('reply', 'err', `📱 Từ Telegram → ${x.other.name || 'Khách'}: ${e.message}`); return say(c, '✗ Chưa gửi được: ' + e.message); }
  }
  async function tgWaiting(c) {
    const A = App.inbox.auto; await A.refresh();
    const list = A.convs().filter(x => x.fromCustomer && Date.now() - new Date(x.updated_time) < 3 * 864e5).slice(0, 10);
    if (!list.length) return say(c, '✓ Không có khách nào đang chờ trả lời.');
    for (const x of list) { const r = await say(c, `⏳ ${nm(x)} · ${Math.round((Date.now() - new Date(x.updated_time)) / 60e3)} phút\n${String(x.snippet || '').slice(0, 200)}`, { reply_markup: custBtns(shortKey(x.key)) }); if (r?.ok) RC.map[r.result.message_id] = x.key; }
  }
  async function tgStatus(c) {
    const st = await getState(), L = (await DB.get(LOG, [])).filter(l => l.at > Date.now() - 864e5), n = t => L.filter(l => l.task === t && l.kind === 'ok').length;
    const wait = App.inbox?.auto?.convs().filter(x => x.fromCustomer).length || 0;
    return say(c, [`${c.on ? '▶ Kế hoạch đang BẬT' : '⏸ Kế hoạch đang TẮT'} · AI trả lời: ${c.reply.on ? 'bật' : 'tắt'}`, status ? 'Trạng thái: ' + status : '', `⏳ Khách đang chờ: ${wait}`,
      `24 giờ: 💬 ${n('reply')} · 📣 ${n('remarket')} · 📦 ${n('orders')} · 🛡 ${n('warranty')} · ⚠️ ${L.filter(l => l.kind === 'err').length} lỗi`, st.hour?.length ? `AI đã trả lời ${st.hour.length} tin trong 1 giờ qua` : ''].filter(Boolean).join('\n'));
  }
  const HELP = ['📱 Điều khiển Get Helps', '/menu – bảng nút điều khiển', '/cho – khách đang chờ', '/baogia – báo giá chờ tiền', '/don – đơn gần đây', '/solieu – doanh thu, số dư Baostar',
    '/bai – bài chờ duyệt', '/vietbai – AI viết bài mới', '/nhan – nhắn hàng loạt', '/lich – lịch remarketing', '/trangthai, /bat, /tat, /aibat, /aitat, /tomtat', '',
    '↩️ Trả lời (reply) tin báo của khách = nhắn lại khách (gửi được cả ảnh).', '🧾 Gửi link + số lượng (vd "1k like https://…") = tạo báo giá; reply tin báo khách bằng "báo giá 1k like https://…" = báo giá cho khách đó.',
    '🖼 Gửi ảnh (kèm chữ) = đăng bài lên Page.', '💬 Hoặc nói tự nhiên: "doanh thu hôm nay", "viết bài cho Page X về ưu đãi"…', '', 'Việc tốn tiền / không hoàn tác được luôn hỏi lại bằng nút ✅ Xác nhận.'].join('\n');
  const rid = () => Math.random().toString(36).slice(2, 9);
  const B = (text, data) => ({ text, callback_data: data });
  RC.pend = {}; RC.q = {}; RC.posts = {}; RC.photos = {}; RC.wait = null;
  // Hỏi lại trước việc tốn tiền / không hoàn tác: nút ✅ Xác nhận mới chạy.
  const confirmAsk = (c, text, run) => { const id = rid(); RC.pend[id] = run; return say(c, text, { reply_markup: kb([[B('✅ Xác nhận', 'ok|' + id), B('✖ Huỷ', 'no|' + id)]]) }); };
  const MENU = kb([[B('💬 Khách chờ', 'm|cho'), B('🧾 Báo giá chờ tiền', 'm|q')], [B('📦 Đơn gần đây', 'm|od'), B('💰 Số liệu', 'm|st')],
    [B('📝 Bài chờ duyệt', 'm|pd'), B('✨ AI viết bài', 'm|pa')], [B('📣 Nhắn hàng loạt', 'm|mb'), B('🗓 Lịch remarketing', 'm|rl')], [B('⚙ Kế hoạch', 'm|pl')]]);
  const S_ = () => App.services?.remote;
  const QUEUE_KEY = 'fbScheduleQueueV1';
  const pageBy = id => App.pages.find(p => String(p.id) === String(id));
  const pageByName = n => { const t = String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (!t) return null;
    return App.pages.find(p => p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(t)) || null; };

  async function tgQuotes(c) {
    const qs = (await S_().quotes()).slice(0, 8); if (!qs.length) return say(c, '✓ Không có báo giá nào đang chờ.');
    for (const q of qs) { const k = rid(); RC.q[k] = q.id;
      await say(c, `🧾 #${q.payCode} · ${q.customer?.name || 'Khách'}${q.pageName ? ' · ' + q.pageName : ''}\n${q.displayName}\n💵 ${money(q.sell)}${q.paidAmount ? ` · đã nhận ${money(q.paidAmount)}` : ''}${q.state === 'paid' ? ' · ĐÃ TRẢ, chờ tạo đơn' : ''}`,
        { reply_markup: kb([[B('✅ Đã nhận tiền → tạo đơn', 'qp|' + k)], [B('📨 Gửi lại báo giá cho khách', 'qs|' + k), B('❌ Huỷ', 'qc|' + k)]]) }); }
  }
  async function tgOrders(c) {
    const os = await S_().orders(3); if (!os.length) return say(c, 'Không có đơn nào trong 3 ngày qua.');
    const st = o => o.status === 'done' ? '✅' : o.status === 'cancelled' ? '⛔' : /error|lỗi|fail/i.test(o.svcStatus || '') ? '⚠️' : '⏳';
    return say(c, ['📦 Đơn 3 ngày qua (' + os.length + ')', ...os.slice(0, 15).map(o => `${st(o)} #${o.providerOrderId} · ${o.customer?.name || '-'} · ${o.displayName || o.serviceName} · ${money(o.sell ?? 0)} · ${o.svcStatus || o.status}`)].join('\n'));
  }
  async function tgStats(c) {
    const x = await S_().stats(), b = x.balance;
    return say(c, ['💰 Số liệu', `Hôm nay: ${x.today.n} đơn · doanh thu ${money(x.today.sell)} · lãi ≈ ${money(x.today.sell - x.today.cost)}`, `Tháng này: ${x.month.n} đơn · doanh thu ${money(x.month.sell)} · lãi ≈ ${money(x.month.sell - x.month.cost)}`,
      `⏳ Đơn đang chạy: ${x.running} · 🧾 Báo giá chờ tiền: ${x.pending}`, `🏦 Số dư Baostar: ${b && Number.isFinite(b.v) ? (b.approx ? '≈ ' : '') + money(b.v) : 'không đọc được'}`].join('\n'));
  }
  async function tgDrafts(c) {
    const q = (await DB.get(QUEUE_KEY, [])).filter(i => ['draft', 'error', 'missed'].includes(i.status) && String(i.text || '').trim()).slice(0, 6);
    if (!q.length) return say(c, '✓ Không có bài nào chờ duyệt.', { reply_markup: kb([[B('✨ AI viết bài mới', 'm|pa')]]) });
    for (const i of q) await say(c, `📝 ${i.pageName || pageBy(i.pageKey)?.name || '?'} · ${i.status === 'error' ? '⚠️ ' + (i.error || 'lỗi') : 'chờ duyệt'}\n\n${String(i.text).slice(0, 900)}`,
      { reply_markup: kb([[B('✅ Duyệt', 'pk|' + i.id), B('🗑 Xoá', 'px|' + i.id)]]) });
    return say(c, 'Duyệt xong bấm để Facebook đăng vào giờ trống của từng Page:', { reply_markup: kb([[B('🕒 Lên lịch tất cả bài đã duyệt', 'pall|x')]]) });
  }
  const patchQ = async (id, ch) => { const q = await DB.get(QUEUE_KEY, []), i = q.find(x => x.id === id); if (!i) return null; Object.assign(i, ch); await DB.set(QUEUE_KEY, q); if (App.current() === 'planner') App.tabs.planner?.refresh?.(); return i; };
  async function aiOnePost(page, topic, image) {
    const shop = await DB.get('aiShopV1', {});
    let recent = []; try { recent = (await apiPaged(`/${page.id}/posts`, { fields: 'message', limit: 6 }, page.access_token, 1)).map(x => String(x.message || '').replace(/\s+/g, ' ').slice(0, 200)).filter(Boolean); } catch {}
    const prompt = [`Viết 1 bài đăng Facebook MỚI cho Fanpage "${page.name}"${shop.name ? ' của shop ' + shop.name : ''} (dịch vụ tăng tương tác mạng xã hội).`, 'Tiếng Việt tự nhiên, 3–8 câu, emoji vừa phải, kêu gọi nhắn tin cho Page, 2–4 hashtag cuối bài. Không bịa giá cụ thể.',
      topic ? 'Chủ đề / ý chính: ' + topic : 'Chủ đề: tự chọn góc nhìn hữu ích.', image ? 'Bài có kèm 1 ảnh (bạn không thấy ảnh): viết chữ hợp chủ đề, không tả chi tiết ảnh.' : '',
      shop.policy ? 'Chính sách shop: ' + shop.policy : '', recent.length ? 'Không lặp ý các bài gần đây:\n' + recent.map(t => '- ' + t).join('\n') : '', 'Chỉ trả về MỘT khối JSON: {"post":"nội dung bài"}'].filter(Boolean).join('\n');
    for (let k = 0; k < 3; k++) { const r = await D.gptAsk({ prompt, fresh: k > 0 }); if (r?.error === 'login') throw Error('Chưa đăng nhập ChatGPT trong app');
      try { const t = String(r?.text || '').replace(/```(?:json)?/gi, ''), j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); if (String(j.post || '').trim().length > 20) return String(j.post).trim(); } catch {} }
    throw Error('AI chưa viết được bài');
  }
  async function showPost(c, d) { // d = { page, text, image }
    const id = rid(); RC.posts[id] = d;
    const body = `📝 Bài cho ${d.page.name}${d.image ? ' (kèm ảnh)' : ''}:\n\n${d.text || '(chưa có chữ)'}\n\n↩️ Muốn sửa chữ: trả lời (reply) tin này bằng nội dung mới.`;
    const r = await say(c, body, { reply_markup: kb([[B('🚀 Đăng ngay', 'pn|' + id), B('🕒 Lên lịch (giờ trống)', 'ps|' + id)], [B('✨ AI viết lại', 'pr|' + id), B('🗑 Bỏ', 'pdel|' + id)]]) });
    if (r?.ok) RC.map[r.result.message_id] = 'post:' + id;
  }
  const pagesKb = (prefix, extra = '') => kb(App.pages.map(p => [B(p.name, prefix + '|' + p.id + (extra ? '|' + extra : ''))]));
  async function tgMassAsk(c, group) {
    const A = App.inbox.auto; await A.refresh(); const st = await getState(), cfg = await getCfg();
    const r = { id: 'tg' + Date.now(), adhoc: true, name: 'Nhắn hàng loạt (Telegram)', group, min: 0, max: 7, limit: 30, mode: 'ai', text: '', page: '', label: '' };
    const n = pickFor(r, cfg, st, A).length; if (!n) return say(c, 'Không có khách nào hợp (nhắn trong 7 ngày, chưa nhắn lại trong ' + cfg.remarket.gapDays + ' ngày).');
    r.limit = Math.min(n, 30);
    return confirmAsk(c, `📣 ${group === 'open' ? 'Khách CHƯA chốt' : group === 'done' ? 'Khách ĐÃ chốt' : 'Mọi khách'} nhắn trong 7 ngày: ${n} người.\nAI viết riêng từng tin và gửi ${r.limit} khách (tối đa ${cfg.remarket.pageLimit} tin/Page/ngày)?`,
      async () => { const res = await runRule(r, cfg, await getState(), A); return `📣 Xong: đã gửi ${res.sent} tin${res.stop ? ' (dừng giữa chừng: máy đang có người dùng hoặc AI lỗi, xem Nhật ký)' : ''}.`; });
  }
  async function tgRules(c) {
    const cfg = await getCfg(); if (!cfg.remarket.rules.length) return say(c, 'Chưa có lịch remarketing nào (tạo trong app: Tự động › Kế hoạch).');
    for (const r of cfg.remarket.rules) await say(c, `🗓 ${r.name || 'Lịch'} · ${r.on ? 'BẬT' : 'tắt'} · ${r.at} ${(r.days || []).map(d => DAYS[d]).join(',')}\nNhóm ${r.group} · im lặng ${r.min}–${r.max} ngày · tối đa ${r.limit} tin`,
      { reply_markup: kb([[B('▶ Chạy ngay', 'rr|' + r.id), B(r.on ? '⏸ Tắt' : '▶ Bật', 'rt|' + r.id)]]) });
  }
  const tgPlan = async c => { const cfg = await getCfg(); return say(c, `⚙ Kế hoạch: ${cfg.on ? 'BẬT' : 'TẮT'} · AI trả lời: ${cfg.reply.on ? 'bật' : 'tắt'} · AI viết bài: ${cfg.post.ai ? 'bật' : 'tắt'}`,
    { reply_markup: kb([[B(cfg.on ? '⏸ Tắt kế hoạch' : '▶ Bật kế hoạch', 'pl|on'), B(cfg.reply.on ? '💬 Tắt AI trả lời' : '💬 Bật AI trả lời', 'pl|ai')], [B('📊 Trạng thái', 'm|ts')]]) }); };
  async function menuAct(c, k) {
    if (k === 'cho') return tgWaiting(c); if (k === 'q') return tgQuotes(c); if (k === 'od') return tgOrders(c); if (k === 'st') return tgStats(c);
    if (k === 'pd') return tgDrafts(c); if (k === 'pa') return say(c, '✨ AI viết bài cho Page nào?', { reply_markup: pagesKb('pw') });
    if (k === 'mb') return say(c, '📣 Nhắn hàng loạt cho nhóm nào?', { reply_markup: kb([[B('Chưa chốt', 'mb|open'), B('Đã chốt (khách cũ)', 'mb|done'), B('Tất cả', 'mb|all')]]) });
    if (k === 'rl') return tgRules(c); if (k === 'pl') return tgPlan(c); if (k === 'ts') return tgStatus(c);
  }
  // Báo giá từ chữ có link: xem trước (gói + số lượng + tiền) → nút tạo / tạo & gửi khách.
  async function tgQuoteFrom(c, text, key) {
    const links = (S_().linksIn(text) || []).filter(x => typeof x === 'object').map(x => x.link);
    if (!links.length) return say(c, 'Gửi kèm link bài / trang cần chạy, vd: "1k like https://facebook.com/…".');
    const x = key ? convOf(key) : null, ctx = x ? { page: x.page, key: x.key, name: x.other.name || '' } : {};
    const p = await S_().preview({ ...ctx, messages: [{ isCustomer: true, text }] }, links);
    if (p?.error) return say(c, '✗ ' + p.error + (p.summary ? '\n' + p.summary.join('\n') : '') + '\n\nGhi rõ số lượng + loại, vd "500 follow", "1k like", "2k view".');
    const id = rid(); RC.q[id] = { make: p.make, key: x?.key };
    return say(c, [`🧾 Báo giá${x ? ' cho ' + nm(x) : ''}:`, ...p.summary, `Tổng: ${money(p.total)}`, ...p.warns.map(w => '⚠️ ' + w)].join('\n'),
      { reply_markup: kb([[B('✅ Tạo báo giá', 'qn|' + id), ...(x ? [B('📨 Tạo & gửi khách', 'qg|' + id)] : [])], [B('✖ Bỏ', 'qx|' + id)]]) });
  }
  // Nói tự nhiên: AI đọc câu lệnh → việc cần làm.
  async function tgNatural(c, text) {
    if (!D.gptAsk) return say(c, 'Không hiểu lệnh này.\n\n' + HELP);
    say(c, '🤔 Đang hiểu lệnh…');
    const prompt = ['Bạn là bộ điều khiển app bán dịch vụ tăng tương tác. Đọc lệnh của chủ shop và trả về MỘT khối JSON {"intent":"...","page":"","topic":"","group":""}.',
      'intent là một trong: waiting (khách đang chờ), quotes (báo giá chờ tiền), orders (đơn gần đây), stats (doanh thu / số dư / số liệu), drafts (bài chờ duyệt), write_post (viết bài: page = tên Page, topic = chủ đề), mass (nhắn hàng loạt: group = open | done | all), rules (lịch remarketing), plan_on, plan_off, ai_on, ai_off, summary, help, unknown.',
      'Các Page: ' + App.pages.map(p => p.name).join(', '), 'Lệnh: ' + text].join('\n');
    let j = null; try { const r = await D.gptAsk({ prompt }); const t = String(r?.text || '').replace(/```(?:json)?/gi, ''); j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch {}
    const it = j?.intent || 'unknown', map = { waiting: 'cho', quotes: 'q', orders: 'od', stats: 'st', drafts: 'pd', rules: 'rl' };
    if (map[it]) return menuAct(c, map[it]);
    if (it === 'write_post') { const p = pageByName(j.page); if (!p) return say(c, '✨ Viết bài cho Page nào?', { reply_markup: pagesKb('pw') });
      say(c, `✨ AI đang viết bài cho ${p.name}…`); try { return showPost(c, { page: p, text: await aiOnePost(p, j.topic || ''), image: '' }); } catch (e) { return say(c, '✗ ' + e.message); } }
    if (it === 'mass') return tgMassAsk(c, ['open', 'done', 'all'].includes(j.group) ? j.group : 'open');
    if (it === 'plan_on' || it === 'plan_off') return tgHandle({ message: { chat: { id: c.tg.chat }, text: it === 'plan_on' ? '/bat' : '/tat' } }, c);
    if (it === 'ai_on' || it === 'ai_off') return tgHandle({ message: { chat: { id: c.tg.chat }, text: it === 'ai_on' ? '/aibat' : '/aitat' } }, c);
    if (it === 'summary') return tgHandle({ message: { chat: { id: c.tg.chat }, text: '/tomtat' } }, c);
    return say(c, 'Chưa hiểu lệnh này. Gõ /menu để chọn bằng nút.', { reply_markup: MENU });
  }
  async function tgHandle(u, c) {
    const chat = String(u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? '');
    if (chat !== String(c.tg.chat).trim()) return; // chỉ nghe đúng Chat ID của bạn
    if (u.callback_query) {
      const q = u.callback_query, [act, k, k2] = String(q.data || '').split('|'); tgApi('answerCallbackQuery', { callback_query_id: q.id }, c);
      if (act === 'ok' || act === 'no') { const run = RC.pend[k]; delete RC.pend[k]; if (!run) return say(c, 'Yêu cầu đã hết hạn.'); if (act === 'no') return say(c, '✖ Đã huỷ.');
        say(c, '⏳ Đang làm…'); try { return say(c, (await run()) || '✓ Xong.'); } catch (e) { return say(c, '✗ ' + e.message); } }
      if (act === 'm') return menuAct(c, k);
      if (act === 'send' || act === 'drop') { const d = RC.drafts[k]; delete RC.drafts[k]; if (!d) return say(c, 'Bản nháp đã hết hạn.');
        return act === 'send' ? tgSendToCustomer(c, d.key, d.text, d.image) : say(c, '🗑 Đã bỏ bản nháp.'); }
      // Báo giá
      if (['qp', 'qs', 'qc'].includes(act)) { const id = RC.q[k]; if (!id) return say(c, 'Hết hạn, gõ /baogia để xem lại.'); const qq = (await S_().quotes()).find(x => x.id === id); if (!qq) return say(c, 'Báo giá không còn.');
        if (act === 'qp') return confirmAsk(c, `✅ Xác nhận đã nhận ${money(Math.max(0, qq.sell - (qq.paidAmount || 0)))} cho #${qq.payCode} (${qq.customer?.name || 'Khách'}) và TẠO ĐƠN trên Baostar (trừ tiền số dư)?`,
          async () => { const r = await S_().payAndCreate(id); if (r?.error) return '✗ ' + r.error; await log('orders', r.fail ? 'err' : 'ok', `📱 Telegram: #${qq.payCode} tạo ${r.ok}/${r.total} đơn${r.fail ? ', lỗi ' + r.fail : ''}`); return `🧾 #${qq.payCode}: tạo ${r.ok}/${r.total} đơn${r.fail ? ` · ⚠️ ${r.fail} lỗi (${r.last})` : ' ✓'}`; });
        if (act === 'qc') return confirmAsk(c, `❌ Huỷ báo giá #${qq.payCode} (${money(qq.sell)})?${qq.paidAmount ? ` Khách đã chuyển ${money(qq.paidAmount)}: nhớ hoàn tiền.` : ''}`, async () => { const r = await S_().cancel(id); return r.error ? '✗ ' + r.error : `Đã huỷ #${qq.payCode}.`; });
        if (act === 'qs') { if (!qq.customerKey) return say(c, 'Báo giá này không gắn với khách nào trong hộp thư.'); const mm = await S_().quoteMessage(qq); return tgSendToCustomer(c, qq.customerKey, mm.text, mm.image); } }
      if (['qn', 'qg', 'qx'].includes(act)) { const d = RC.q[k]; delete RC.q[k]; if (!d?.make) return say(c, 'Hết hạn, gửi lại link.'); if (act === 'qx') return say(c, '✖ Đã bỏ.');
        const qq = await d.make(); await log('orders', 'ok', `📱 Telegram: tạo báo giá #${qq.payCode} ${money(qq.sell)}`);
        if (act === 'qg' && d.key) { const mm = await S_().quoteMessage(qq); await tgSendToCustomer(c, d.key, mm.text, mm.image); }
        const kk = rid(); RC.q[kk] = qq.id;
        return say(c, `🧾 Đã tạo báo giá #${qq.payCode} · ${money(qq.sell)} · nội dung CK: ${qq.payCode}`, { reply_markup: kb([[B('✅ Đã nhận tiền → tạo đơn', 'qp|' + kk)]]) }); }
      // Bài đăng
      if (act === 'pk') { const i = await patchQ(k, { status: 'approved', error: '' }); return say(c, i ? '✅ Đã duyệt. Bấm "Lên lịch tất cả" để hẹn lên Facebook.' : 'Bài không còn.', { reply_markup: kb([[B('🕒 Lên lịch tất cả bài đã duyệt', 'pall|x')]]) }); }
      if (act === 'px') return confirmAsk(c, '🗑 Xoá bài này khỏi Lịch đăng?', async () => { await DB.set(QUEUE_KEY, (await DB.get(QUEUE_KEY, [])).filter(x => x.id !== k)); return 'Đã xoá.'; });
      if (act === 'pall') return confirmAsk(c, '🕒 Lên lịch TẤT CẢ bài đã duyệt lên Facebook (đăng vào giờ trống của từng Page)?', async () => 'Lên lịch: ' + (await App.planner.scheduleAll(App.pages.map(p => p.id)) || 'xong'));
      if (act === 'pw') { const p = pageBy(k); if (!p) return; const img = k2 ? RC.photos[k2] : null; say(c, `✨ AI đang viết bài cho ${p.name}…`);
        try { return showPost(c, { page: p, text: img?.caption || await aiOnePost(p, '', img?.dataUrl), image: img?.dataUrl || '' }); } catch (e) { return say(c, '✗ ' + e.message); } }
      if (['pn', 'ps', 'pr', 'pdel'].includes(act)) { const d = RC.posts[k]; if (!d) return say(c, 'Bài nháp đã hết hạn.');
        if (act === 'pdel') { delete RC.posts[k]; return say(c, '🗑 Đã bỏ.'); }
        if (act === 'pr') { say(c, '✨ AI đang viết lại…'); try { d.text = await aiOnePost(d.page, '', d.image); return showPost(c, d); } catch (e) { return say(c, '✗ ' + e.message); } }
        if (act === 'ps') { delete RC.posts[k]; await App.planner.addItems([{ pageKey: d.page.id, pageName: d.page.name, status: 'approved', text: d.text, imageData: d.image || '', source: 'telegram' }]);
          const r = await App.planner.scheduleAll([d.page.id]); await log('post', 'ok', `📱 Telegram: lên lịch bài cho ${d.page.name}`); return say(c, '🕒 ' + (r || 'Đã lên lịch.')); }
        if (act === 'pn') return confirmAsk(c, `🚀 Đăng NGAY bài này lên ${d.page.name}?`, async () => { const r = await App.publish(d.page, d.text, d.image || '', 0); delete RC.posts[k];
          await log('post', 'ok', `📱 Telegram: đăng ngay lên ${d.page.name}`); return `🚀 Đã đăng lên ${d.page.name}${r?.post_id || r?.id ? ': https://www.facebook.com/' + (r.post_id || r.id) : ''}`; }); }
      // Nhắn hàng loạt & lịch
      if (act === 'mb') return tgMassAsk(c, k);
      if (act === 'rr' || act === 'rt') { const cfg = await getCfg(), r = cfg.remarket.rules.find(x => x.id === k); if (!r) return say(c, 'Lịch không còn.');
        if (act === 'rt') { r.on = !r.on; await setCfg(cfg); if (C) { C = cfg; draw(); } return say(c, `🗓 ${r.name}: ${r.on ? 'BẬT' : 'TẮT'}`); }
        return confirmAsk(c, `▶ Chạy ngay lịch "${r.name}" (gửi tối đa ${r.limit} tin)?`, async () => { const st = await getState(); delete st.ran['rm:' + r.id]; const res = await runRule(r, cfg, st, App.inbox.auto); return `🗓 ${r.name}: đã gửi ${res.sent} tin${res.stop ? ' (dừng giữa chừng, xem Nhật ký)' : ''}.`; }); }
      if (act === 'pl') { const cfg = await getCfg(); if (k === 'on') cfg.on = !cfg.on; else cfg.reply.on = !cfg.reply.on; await setCfg(cfg); if (C) { C = cfg; draw(); } return tgPlan(c); }
      // Nút trên tin báo khách
      const key = RC.ref?.[k]; if (!key) return say(c, 'Tin báo này đã cũ, gõ /cho để xem lại khách đang chờ.');
      const x = convOf(key); if (!x) return say(c, '✗ Không tìm thấy khách.');
      if (act === 'mute') { RC.mute[key] = Date.now() + 864e5; return say(c, `🔕 Tắt báo ${nm(x)} trong 24 giờ.`); }
      if (act === 'quo') { RC.wait = { kind: 'quote', key }; return say(c, `🧾 Gửi link + số lượng cho ${nm(x)}, vd: "1k like https://facebook.com/…"`); }
      if (act === 'war') return confirmAsk(c, `🛡 Bảo hành (refill Baostar) các link còn hạn của ${nm(x)} và báo khách?`, async () => {
        const msgs = await App.inbox.auto.messagesOf(x), r = await App.services.autoWarranty({ key: x.key, name: x.other.name, page: x.page, messages: msgs });
        if (!r) return 'Khách không có tin báo tụt hoặc không có đơn nào để bảo hành.'; if (r.skipped) return '⚠️ ' + r.skipped; if (r.error) return '✗ ' + r.error;
        await App.inbox.auto.sendKey(x.key, r.text, r.image || ''); return `🛡 Đã refill ${r.n} link và báo khách.`; });
      if (act === 'his') { const m = (await App.inbox.auto.texts(x)).filter(m => m.text).slice(-5);
        const r = await say(c, `📋 ${nm(x)}\n` + (m.map(m => (m.isCustomer ? '👤 ' : '🏪 ') + String(m.text).slice(0, 300)).join('\n') || '(chưa có tin đã lưu)'), { reply_markup: custBtns(k) }); if (r?.ok) RC.map[r.result.message_id] = key; return; }
      if (act === 'ai') {
        say(c, `✨ AI đang soạn cho ${nm(x)}…`);
        try { const msgs = await App.inbox.auto.messagesOf(x), r = await App.inbox.auto.aiReply(x, msgs), id = rid();
          RC.drafts[id] = { key, text: r.text, image: r.image || '' };
          const m = await say(c, `✨ Nháp cho ${nm(x)}:\n\n${r.text}${r.pt ? '\n\n📎 kèm ' + (r.pt.t.title || 'bảng giá') : ''}\n\n↩️ Muốn sửa: trả lời (reply) tin này bằng nội dung mới.`,
            { reply_markup: kb([[B('✅ Gửi', 'send|' + id), B('🗑 Bỏ', 'drop|' + id)]]) });
          if (m?.ok) RC.map[m.result.message_id] = key; }
        catch (e) { say(c, '✗ AI chưa soạn được: ' + e.message); }
        return;
      }
      return;
    }
    const m = u.message, text = String(m?.text || m?.caption || '').trim();
    const to = m?.reply_to_message && RC.map[m.reply_to_message.message_id];
    // Ảnh từ Telegram
    if (m?.photo?.length) {
      const f = await (D.tgFile ? D.tgFile({ token: c.tg.token.trim(), fileId: m.photo[m.photo.length - 1].file_id }) : Promise.resolve({ error: 'Cần app bản mới nhất' }));
      if (f?.error) return say(c, '✗ Chưa tải được ảnh: ' + f.error);
      if (to && String(to).startsWith('post:')) { const d = RC.posts[String(to).slice(5)]; if (d) { d.image = f.dataUrl; return showPost(c, d); } }
      if (to) return tgSendToCustomer(c, to, text, f.dataUrl);
      const id = rid(); RC.photos[id] = { dataUrl: f.dataUrl, caption: text.replace(/^\/?(đăng|dang)\s*:?\s*/i, '') };
      return say(c, '🖼 Đăng ảnh này lên Page nào?' + (text ? '' : ' (chưa có chữ: AI sẽ viết)'), { reply_markup: pagesKb('pw', id) });
    }
    if (!text) return;
    if (to && String(to).startsWith('post:')) { const d = RC.posts[String(to).slice(5)]; if (!d) return say(c, 'Bài nháp đã hết hạn.'); d.text = text; return showPost(c, d); }
    if (to && /^\/?(báo giá|bao gia|baogia)\b/i.test(text)) return tgQuoteFrom(c, text, to);
    if (to) return tgSendToCustomer(c, to, text);
    if (RC.wait?.kind === 'quote') { const w = RC.wait; RC.wait = null; return tgQuoteFrom(c, text, w.key); }
    const cmd = text.split(/\s|@/)[0].toLowerCase();
    if (cmd === '/start' || cmd === '/help' || cmd === '/trogiup') return say(c, HELP, { reply_markup: MENU });
    if (cmd === '/menu' || /^menu$/i.test(text)) return say(c, '📱 Bảng điều khiển Get Helps', { reply_markup: MENU });
    const short = { '/cho': 'cho', '/baogia': 'q', '/don': 'od', '/solieu': 'st', '/bai': 'pd', '/vietbai': 'pa', '/nhan': 'mb', '/lich': 'rl', '/trangthai': 'ts' };
    if (short[cmd]) return menuAct(c, short[cmd]);
    if (cmd === '/bat' || cmd === '/tat') { c.on = cmd === '/bat'; await setCfg(c); if (C) { C.on = c.on; draw(); } await log('sys', 'info', `📱 Telegram: ${c.on ? 'bật' : 'tắt'} kế hoạch.`); return say(c, c.on ? '▶ Đã BẬT kế hoạch tự động.' : '⏸ Đã TẮT kế hoạch tự động.'); }
    if (cmd === '/aibat' || cmd === '/aitat') { c.reply.on = cmd === '/aibat'; await setCfg(c); if (C) { C.reply.on = c.reply.on; draw(); } return say(c, `💬 AI tự trả lời: ${c.reply.on ? 'BẬT' : 'TẮT'}${c.on ? '' : ' (kế hoạch đang tắt: gõ /bat để chạy)'}`); }
    if (cmd === '/tomtat') { const st = await getState(); delete st.ran.report; await DB.set(STATE, st); c.tg.daily = true; c.tg.dailyAt = '00:00'; return taskReport(c, st); }
    if (/https?:\/\/|\b(fb|facebook|tiktok|youtube|instagram)\.(com|me|be)\//i.test(text)) return tgQuoteFrom(c, text, null);
    return tgNatural(c, text);
  }
  let tgLoop = false;
  async function tgPoll() {
    if (tgLoop) return; tgLoop = true;
    try {
      const c0 = await getCfg(); tgApi('setMyCommands', { commands: [['menu', 'Bảng nút điều khiển'], ['cho', 'Khách đang chờ trả lời'], ['baogia', 'Báo giá chờ tiền'], ['don', 'Đơn gần đây'], ['solieu', 'Doanh thu, số dư'], ['bai', 'Bài chờ duyệt'], ['vietbai', 'AI viết bài'], ['nhan', 'Nhắn hàng loạt'], ['lich', 'Lịch remarketing'], ['trangthai', 'Tình hình hôm nay'], ['bat', 'Bật kế hoạch tự động'], ['tat', 'Tắt kế hoạch tự động'], ['aibat', 'Bật AI tự trả lời'], ['aitat', 'Tắt AI tự trả lời'], ['tomtat', 'Tóm tắt 24 giờ'], ['help', 'Hướng dẫn']].map(([command, description]) => ({ command, description })) }, c0).catch(() => {});
      while (true) {
        const c = await getCfg(); if (!c.tg.control || !c.tg.token || !c.tg.chat) break;
        const off = Number(local.get('tgOffset')) || 0;
        const r = await tgApi('getUpdates', { offset: off, timeout: 25, allowed_updates: ['message', 'callback_query'] }, c);
        if (!r?.ok) { if (/terminated by other|Conflict/i.test(r?.description || '')) await wait(30e3); else await wait(15e3); continue; }
        for (const u of r.result || []) { local.set('tgOffset', String(u.update_id + 1)); await tgHandle(u, c).catch(e => log('sys', 'err', 'Telegram: ' + e.message)); }
      }
    } finally { tgLoop = false; }
  }
  setInterval(async () => { const c = await getCfg().catch(() => null); if (!c?.tg.token || !c.tg.chat) return; if (c.tg.control) tgPoll(); if (c.tg.notify) { await App.inbox?.auto?.refresh().catch(() => {}); tgNotify(c).catch(() => {}); } }, 20e3);

  // ── Vòng chạy ──
  let running = false, status = '';
  const canDrive = async () => (await idleSec()) >= 90;
  async function tick() {
    const c = await getCfg(); if (!c.on) { status = 'Đang tắt'; return; }
    D.autoBeat?.();
    if (running || !App.pages.length) return;
    running = true;
    try {
      const A = App.inbox?.auto; if (!A) return;
      const st = await getState();
      await taskPost(c, st).catch(e => log('post', 'err', e.message));
      if (!await canDrive()) { status = 'Đang chờ bạn rời máy (việc gửi tin chỉ chạy khi máy rảnh ≥ 90 giây)'; await taskReport(c, st).catch(e => log('report', 'err', e.message)); return; }
      await A.refresh();
      status = 'Đang chạy: đơn & bảo hành'; await taskOrders(c, st, A).catch(e => log('orders', 'err', e.message));
      status = 'Đang chạy: AI trả lời'; await taskReply(c, st, A).catch(e => log('reply', 'err', e.message));
      status = 'Đang chạy: remarketing'; await taskRemarket(c, st, A).catch(e => log('remarket', 'err', e.message));
      await DB.set(STATE, st);
      await taskReport(c, st).catch(e => log('report', 'err', e.message));
      status = `Đang bật · lần quét gần nhất ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    } finally { running = false; if (App.current() === 'autoplan') drawStatus(); }
  }
  setTimeout(() => { getCfg().then(c => c.on && applySys(c)).catch(() => {}); setInterval(() => tick().catch(e => log('sys', 'err', e.message)), 30e3); }, 15e3);

  // ── Giao diện tab Kế hoạch ──
  let C = null;
  const save = async () => { await setCfg(C); drawStatus(); };
  const inp = (obj, key, type = 'text', w) => h('input', { type, value: obj[key] ?? '', style: w ? `width:${w}px` : '', onchange: e => { obj[key] = type === 'number' ? Number(e.target.value) : e.target.value; save(); } });
  const chk = (obj, key, label, title = '') => h('label', { className: 'ap-chk', title }, h('input', { type: 'checkbox', checked: !!obj[key], onchange: e => { obj[key] = e.target.checked; save(); if (key === 'on') draw(); } }), ' ', label);
  const sel = (obj, key, opts) => h('select', { onchange: e => { obj[key] = e.target.value; save(); } }, ...opts.map(([v, t]) => h('option', { value: v, textContent: t, selected: String(obj[key] ?? '') === v })));
  // Chọn Page (không chọn Page nào = mọi Page).
  const pagePick = (obj, key) => h('span', { className: 'ap-pages' }, ...App.pages.map(p => h('button', { type: 'button', className: 'chip', 'aria-pressed': String((obj[key] || []).includes(String(p.id))), textContent: p.name, title: 'Bấm để chọn / bỏ Page này (không chọn Page nào = mọi Page)',
    onclick: e => { const s = new Set(obj[key] || []), id = String(p.id); s.has(id) ? s.delete(id) : s.add(id); obj[key] = [...s]; e.target.setAttribute('aria-pressed', String(s.has(id))); e.target.parentNode.dataset.all = String(!s.size); save(); } })));
  const card = (title, ...kids) => h('section', { className: 'card ap-card' }, h('h3', { className: 'card-title', textContent: title }), ...kids);
  const row = (...kids) => h('div', { className: 'ap-row' }, ...kids);
  function drawStatus() {
    const el = $('apStatus'); if (!el || !C) return;
    el.className = 'status ' + (C.on ? 'ok' : 'pending');
    el.textContent = C.on ? (status || 'Đang bật') : 'Kế hoạch đang tắt: bật công tắc phía trên để app tự làm các việc bên dưới.';
    if (D.autoSys) D.autoSys(null).then(s => { const x = $('apSys'); if (x && s) x.textContent = `Windows: ${s.loginNow ? '✓ tự mở cùng Windows' : '✗ chưa tự mở cùng Windows'} · ${s.awake ? '✓ đang giữ máy thức' : '✗ không giữ máy thức'} · ${s.watchdog ? '✓ tự tải lại khi treo' : '✗ không tự tải lại'}${s.packaged ? '' : ' (bản thử nghiệm)'}`; }).catch(() => {});
  }
  async function drawLog() {
    const box = $('apLog'); if (!box) return;
    const f = $('apLogF')?.value || '', L = (await DB.get(LOG, [])).filter(l => !f || l.task === f).slice(-250).reverse();
    box.replaceChildren(...(L.length ? L.map(l => h('div', { className: 'ap-log-i ' + l.kind },
      h('span', { className: 'hint', textContent: new Date(l.at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }),
      h('span', { className: 'ap-log-t', textContent: TASK[l.task] || l.task }), h('span', { textContent: (l.kind === 'err' ? '✗ ' : l.kind === 'ok' ? '✓ ' : '') + l.msg }))) : [h('div', { className: 'hint', textContent: 'Chưa có việc nào.' })]));
  }
  function ruleCard(r, pages, labels) {
    const days = h('span', { className: 'ap-days' }, ...DAYS.map((d, i) => h('button', { type: 'button', className: 'chip', 'aria-pressed': String((r.days || []).includes(i)), textContent: d,
      onclick: e => { const s = new Set(r.days || []); s.has(i) ? s.delete(i) : s.add(i); r.days = [...s].sort(); e.target.setAttribute('aria-pressed', String(s.has(i))); save(); } })));
    const text = h('textarea', { rows: 2, value: r.text || '', placeholder: r.mode === 'tpl' ? 'Mẫu tin: {ten} {tang} {ma} {tien} {dv}' : 'Mục tiêu cho AI (để trống = mặc định theo nhóm)', onchange: e => { r.text = e.target.value; save(); } });
    return h('div', { className: 'ap-rule' + (r.on ? '' : ' off') },
      row(chk(r, 'on', ''), inp(r, 'name', 'text', 160), h('span', { className: 'hint' }, 'lúc'), inp(r, 'at', 'time'), days,
        h('span', { className: 'grow' }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '▶ Chạy ngay', title: 'Chạy lịch này ngay (khi máy rảnh), bỏ qua giờ hẹn hôm nay',
          onclick: async () => { const st = await getState(); delete st.ran['rm:' + r.id]; await DB.set(STATE, st); const keep = { at: r.at, days: r.days }; r.at = '00:00'; r.days = [0, 1, 2, 3, 4, 5, 6]; await save();
            toast('Sẽ chạy ở lượt quét tới (khi bạn không dùng máy ≥ 90 giây).', 6000); setTimeout(async () => { Object.assign(r, keep); await save(); }, 35e3); } }),
        h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Xoá', onclick: () => { if (!confirm('Xoá lịch này?')) return; C.remarket.rules = C.remarket.rules.filter(x => x !== r); save(); draw(); } })),
      row(h('label', {}, 'Nhóm ', sel(r, 'group', [['open', 'Chưa chốt'], ['done', 'Đã chốt (khách cũ)'], ['all', 'Tất cả']])),
        h('label', {}, 'Page ', sel(r, 'page', [['', 'Mọi Page'], ...pages])), h('label', {}, 'Nhãn ', sel(r, 'label', [['', 'Mọi nhãn'], ...labels.map(l => [l, l])])),
        h('label', {}, 'Im lặng ', inp(r, 'min', 'number', 52), '–', inp(r, 'max', 'number', 52), ' ngày'),
        h('label', {}, 'Tối đa ', inp(r, 'limit', 'number', 60), ' tin/ngày'),
        h('label', {}, 'Cách viết ', sel(r, 'mode', [['ai', '✨ AI viết riêng'], ['rewrite', '✨ Mẫu, AI viết lại'], ['tpl', 'Mẫu chung']]))),
      text);
  }
  function draw() {
    const panel = document.querySelector('[data-panel="autoplan"]'); if (!panel || !C) return;
    const A = App.inbox?.auto, convs = A?.convs() || [];
    const pages = [...new Map(convs.map(c => [String(c.page?.id || A.plat(c)), c.page?.name || 'Zalo'])).entries()];
    const labels = [...new Set(convs.flatMap(c => A.labels(c)))].sort((a, b) => a.localeCompare(b, 'vi'));
    const master = h('label', { className: 'ap-master' }, h('input', { type: 'checkbox', checked: C.on, onchange: async e => { C.on = e.target.checked; await save(); log('sys', 'info', C.on ? 'Bật kế hoạch tự động.' : 'Tắt kế hoạch tự động.'); draw(); } }),
      h('span', { textContent: C.on ? '▶ Kế hoạch đang BẬT' : '⏸ Kế hoạch đang TẮT' }));
    panel.replaceChildren(
      h('div', { className: 'card ap-head' }, master, h('div', { id: 'apStatus' }),
        D.autoSys ? h('div', {}, row(chk(C.sys, 'openAtLogin', 'Tự mở cùng Windows (thu nhỏ)'), chk(C.sys, 'keepAwake', 'Giữ máy không ngủ khi kế hoạch bật', 'Màn hình vẫn tắt được; máy không vào chế độ ngủ'), chk(C.sys, 'watchdog', 'Tự tải lại khi app treo / lỗi')), h('div', { className: 'hint', id: 'apSys' }))
          : h('div', { className: 'status pending', textContent: 'Kế hoạch chỉ chạy trong app Get Helps trên Windows (máy phải bật và mở app).' }),
        h('div', { className: 'hint', textContent: 'Việc cần mở hội thoại để gửi tin chỉ chạy khi bạn không dùng máy ≥ 90 giây, để không giành chuột / ô nhập với bạn. Khách gắn nhãn "Không AI" sẽ được bỏ qua.' })),
      card('💬 AI tự trả lời khách đang chờ',
        row(chk(C.reply, 'on', 'Bật'), h('span', {}, 'Giờ làm việc của tôi từ ', inp(C.reply, 'from', 'time'), ' đến ', inp(C.reply, 'to', 'time'), ' — AI trả lời ngoài giờ này')),
        row(chk(C.reply, 'away', 'Trong giờ làm việc, nếu tôi rời máy quá'), inp(C.reply, 'awayMin', 'number', 56), h('span', {}, 'phút thì AI vẫn trả lời')),
        row(h('span', {}, 'Chờ khách '), inp(C.reply, 'waitMin', 'number', 56), h('span', {}, ' phút sau tin cuối rồi mới trả lời · tối đa '), inp(C.reply, 'perHour', 'number', 56), h('span', {}, ' tin/giờ')),
        h('div', { className: 'hint', textContent: 'AI dùng bảng giá, đơn cũ của khách, thông tin shop và mẫu bảng giá trong ⚙ Thông tin shop cho AI (Hộp thư › ✨). Chỉ trả lời khách nhắn trong 24 giờ.' })),
      card('📣 Remarketing theo lịch',
        row(h('span', {}, 'Không nhắn lại cùng khách trong '), inp(C.remarket, 'gapDays', 'number', 56), h('span', {}, ' ngày · tối đa '), inp(C.remarket, 'pageLimit', 'number', 60), h('span', {}, ' tin/Page/ngày (tính chung với Nhắn hàng loạt)')),
        ...C.remarket.rules.map(r => ruleCard(r, pages, labels)),
        h('button', { type: 'button', className: 'btn btn-soft', textContent: '+ Thêm lịch', onclick: () => { C.remarket.rules.push({ id: uid('rm'), on: true, name: 'Nhắn khách chưa chốt', at: '09:00', days: [1, 2, 3, 4, 5, 6], group: 'open', page: '', label: '', min: 1, max: 7, limit: 30, mode: 'ai', text: '' }); save(); draw(); } })),
      card('📦 Đơn hàng & bảo hành',
        row(chk(C.orders, 'nudges', 'Tự gửi tin cập nhật đơn cho khách:')),
        row(...NUDGE_KINDS.map(([k, t]) => h('label', { className: 'ap-chk' }, h('input', { type: 'checkbox', checked: C.orders.kinds.includes(k), onchange: e => { C.orders.kinds = e.target.checked ? [...new Set([...C.orders.kinds, k])] : C.orders.kinds.filter(x => x !== k); save(); } }), ' ', t))),
        row(chk(C.orders, 'warranty', 'Khách báo tụt → tự refill Baostar link còn bảo hành + báo khách (kèm ảnh số hiện tại)')),
        h('div', { className: 'hint', textContent: 'Link hết hạn / không refill được sẽ không tự tạo đơn bù (tốn tiền): app ghi vào nhật ký và báo Telegram để bạn xử lý.' })),
      card('📝 Đăng bài & quét bài',
        row(chk(C.post, 'ai', 'Mỗi ngày lúc'), inp(C.post, 'aiAt', 'time'), h('span', {}, '✨ AI viết'), inp(C.post, 'aiPer', 'number', 52), h('span', {}, 'bài mới cho mỗi Page:'), pagePick(C.post, 'aiPages')),
        row(h('span', { className: 'hint' }, 'Chủ đề / ý chính:'), h('textarea', { rows: 2, value: C.post.aiTopic || '', placeholder: 'Để trống = AI tự chọn chủ đề hữu ích. VD: ưu đãi tăng like cuối tuần, mẹo làm video TikTok lên xu hướng…', style: 'flex:1;min-width:260px', onchange: e => { C.post.aiTopic = e.target.value; save(); } }),
          chk(C.post, 'aiApprove', 'Tự duyệt & lên lịch luôn', 'Bỏ tích: bài nằm ở Lịch đăng chờ bạn duyệt')),
        row(chk(C.post, 'schedule', 'Mỗi ngày lúc'), inp(C.post, 'scheduleAt', 'time'), h('span', {}, 'tự lên lịch các bài đã duyệt trong Lịch đăng (Facebook tự đăng đúng giờ):'), pagePick(C.post, 'pages')),
        row(chk(C.post, 'scan', 'Mỗi ngày lúc'), inp(C.post, 'scanAt', 'time'), h('span', {}, 'quét bình luận bài '), inp(C.post, 'scanDays', 'number', 52), h('span', {}, ' ngày gần đây: bình luận chưa trả lời + SĐT khách để lại (báo Telegram):'), pagePick(C.post, 'scanPages'))),
      card('🔔 Báo cáo Telegram',
        row(h('label', {}, 'Bot token ', inp(C.tg, 'token', 'password', 260)), h('label', {}, 'Chat ID ', inp(C.tg, 'chat', 'text', 140)),
          h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: 'Gửi thử', onclick: async () => { const r = await tg('✅ Get Helps: kết nối Telegram thành công.', C); toast(r?.ok ? 'Đã gửi tin thử về Telegram.' : 'Chưa gửi được: ' + (r?.error || ''), 6000); } })),
        row(chk(C.tg, 'errors', 'Báo ngay khi có lỗi'), chk(C.tg, 'daily', 'Tóm tắt mỗi ngày lúc'), inp(C.tg, 'dailyAt', 'time')),
        row(chk(C.tg, 'notify', '📱 Báo tin nhắn mới của khách'), chk(C.tg, 'control', '📱 Điều khiển & trả lời khách từ Telegram')),
        h('div', { className: 'hint', textContent: 'Trên Telegram: trả lời (reply) vào tin báo của khách = nhắn lại khách đó; nút ✨ AI soạn → ✅ Gửi. Lệnh: /cho (khách đang chờ), /trangthai, /bat, /tat, /aibat, /aitat, /tomtat, /help. Bot chỉ nghe đúng Chat ID của bạn. Chạy được cả khi kế hoạch đang tắt, miễn là app đang mở.' }),
        h('div', { className: 'hint', textContent: 'Tạo bot: nhắn @BotFather trên Telegram → /newbot → chép token. Lấy Chat ID: nhắn bot của bạn 1 tin, rồi nhắn @userinfobot để xem ID. (Báo qua Zalo cá nhân chưa hỗ trợ: Zalo không có cách gửi tự động cho tài khoản cá nhân.)' })),
      card('📜 Nhật ký',
        row(h('select', { id: 'apLogF', onchange: drawLog }, h('option', { value: '', textContent: 'Tất cả việc' }), ...Object.entries(TASK).map(([k, t]) => h('option', { value: k, textContent: t }))),
          h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Xoá nhật ký', onclick: async () => { if (confirm('Xoá toàn bộ nhật ký?')) { await DB.set(LOG, []); drawLog(); } } })),
        h('div', { className: 'ap-log', id: 'apLog' })));
    drawStatus(); drawLog();
  }
  App.tab('autoplan', { async refresh() { C = await getCfg(); draw(); } });
  App.auto = { tick, log, tg, getCfg, tgHandle, tgNotify, RC };
})();
